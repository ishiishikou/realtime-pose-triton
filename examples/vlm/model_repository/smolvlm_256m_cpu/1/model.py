import base64
import io
import os

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from PIL import Image
from transformers import AutoConfig, AutoProcessor
import triton_python_backend_utils as pb_utils


_MODEL_FILES = {
    "vision": "onnx/vision_encoder_quantized.onnx",
    "embed": "onnx/embed_tokens_quantized.onnx",
    "decoder": "onnx/decoder_model_merged_quantized.onnx",
}


def _scalar_string(request, name):
    tensor = pb_utils.get_input_tensor_by_name(request, name)
    if tensor is None:
        raise ValueError(f"missing required input: {name}")

    values = tensor.as_numpy().reshape(-1)
    if values.size != 1:
        raise ValueError(f"{name} must contain exactly one value")

    value = values[0]
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


class TritonPythonModel:
    def initialize(self, args):
        self.model_id = os.getenv(
            "VLM_MODEL_ID",
            "HuggingFaceTB/SmolVLM-256M-Instruct",
        )
        self.max_new_tokens = int(os.getenv("VLM_MAX_NEW_TOKENS", "48"))
        if self.max_new_tokens < 1:
            raise ValueError("VLM_MAX_NEW_TOKENS must be at least 1")

        self.config = AutoConfig.from_pretrained(self.model_id)
        self.processor = AutoProcessor.from_pretrained(self.model_id)

        session_options = ort.SessionOptions()
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        ort_threads = int(os.getenv("VLM_ORT_THREADS", "0"))
        if ort_threads > 0:
            session_options.intra_op_num_threads = ort_threads
            session_options.inter_op_num_threads = 1

        paths = {
            key: hf_hub_download(repo_id=self.model_id, filename=filename)
            for key, filename in _MODEL_FILES.items()
        }
        providers = ["CPUExecutionProvider"]
        self.vision_session = ort.InferenceSession(
            paths["vision"],
            sess_options=session_options,
            providers=providers,
        )
        self.embed_session = ort.InferenceSession(
            paths["embed"],
            sess_options=session_options,
            providers=providers,
        )
        self.decoder_session = ort.InferenceSession(
            paths["decoder"],
            sess_options=session_options,
            providers=providers,
        )

        self.num_key_value_heads = self.config.text_config.num_key_value_heads
        self.head_dim = self.config.text_config.head_dim
        self.num_hidden_layers = self.config.text_config.num_hidden_layers
        self.eos_token_id = self.config.text_config.eos_token_id
        self.image_token_id = self.config.image_token_id

    def execute(self, requests):
        responses = []
        for request in requests:
            try:
                image_base64 = _scalar_string(request, "IMAGE_BASE64")
                prompt_text = _scalar_string(request, "PROMPT").strip()
                if not prompt_text:
                    raise ValueError("PROMPT must not be empty")

                image_bytes = base64.b64decode(image_base64, validate=True)
                image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                generated_text = self._generate(image, prompt_text)

                output = pb_utils.Tensor(
                    "TEXT",
                    np.array([generated_text.encode("utf-8")], dtype=object),
                )
                responses.append(pb_utils.InferenceResponse(output_tensors=[output]))
            except Exception as exc:
                responses.append(
                    pb_utils.InferenceResponse(
                        error=pb_utils.TritonError(
                            f"{type(exc).__name__}: {exc}"
                        )
                    )
                )
        return responses

    def _generate(self, image, prompt_text):
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "text", "text": prompt_text},
                ],
            }
        ]
        chat_prompt = self.processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
        )
        inputs = self.processor(
            text=chat_prompt,
            images=[image],
            return_tensors="np",
        )

        batch_size = inputs["input_ids"].shape[0]
        past_key_values = {
            f"past_key_values.{layer}.{kind}": np.zeros(
                [batch_size, self.num_key_value_heads, 0, self.head_dim],
                dtype=np.float32,
            )
            for layer in range(self.num_hidden_layers)
            for kind in ("key", "value")
        }

        input_ids = inputs["input_ids"]
        attention_mask = inputs["attention_mask"]
        position_ids = np.cumsum(attention_mask, axis=-1)
        generated_tokens = np.empty((batch_size, 0), dtype=np.int64)
        image_features = None

        for _ in range(self.max_new_tokens):
            inputs_embeds = self.embed_session.run(
                None,
                {"input_ids": input_ids},
            )[0]

            if image_features is None:
                image_features = self.vision_session.run(
                    ["image_features"],
                    {
                        "pixel_values": inputs["pixel_values"],
                        "pixel_attention_mask": inputs[
                            "pixel_attention_mask"
                        ].astype(np.bool_),
                    },
                )[0]
                image_mask = inputs["input_ids"] == self.image_token_id
                inputs_embeds[image_mask] = image_features.reshape(
                    -1,
                    image_features.shape[-1],
                )

            logits, *present_key_values = self.decoder_session.run(
                None,
                {
                    "inputs_embeds": inputs_embeds,
                    "attention_mask": attention_mask,
                    "position_ids": position_ids,
                    **past_key_values,
                },
            )

            input_ids = logits[:, -1].argmax(-1, keepdims=True).astype(np.int64)
            generated_tokens = np.concatenate(
                [generated_tokens, input_ids],
                axis=-1,
            )

            if (input_ids == self.eos_token_id).all():
                break

            attention_mask = np.ones_like(input_ids)
            position_ids = position_ids[:, -1:] + 1
            for index, key in enumerate(past_key_values):
                past_key_values[key] = present_key_values[index]

        return self.processor.batch_decode(
            generated_tokens,
            skip_special_tokens=True,
        )[0].strip()
