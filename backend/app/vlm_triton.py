import base64
import io
import os
from typing import Any

import numpy as np
import tritonclient.grpc as grpcclient
from PIL import Image

VLM_TRITON_GRPC_URL = os.getenv('VLM_TRITON_GRPC_URL', 'vlm-triton:8001')
VLM_MODEL_NAME = os.getenv('VLM_MODEL_NAME', 'smolvlm_256m_cpu')
VLM_PROMPT = os.getenv(
    'VLM_PROMPT',
    'Describe the main person and what they are doing in one short sentence.',
)


def _encode_frame_base64(frame_rgb: np.ndarray) -> str:
    image = Image.fromarray(frame_rgb.astype(np.uint8, copy=False), mode='RGB')
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=85)
    return base64.b64encode(buffer.getvalue()).decode('ascii')


def _decode_text_output(output: Any) -> str:
    values = np.asarray(output).reshape(-1)
    if values.size == 0:
        raise ValueError('VLM TEXT output was empty')

    value = values[0]
    if isinstance(value, bytes):
        return value.decode('utf-8').strip()
    return str(value).strip()


def run_vlm(frame_rgb: np.ndarray, frame_id: int) -> dict[str, Any]:
    image_base64 = _encode_frame_base64(frame_rgb)
    client = grpcclient.InferenceServerClient(url=VLM_TRITON_GRPC_URL)

    image_input = grpcclient.InferInput('IMAGE_BASE64', [1], 'BYTES')
    image_input.set_data_from_numpy(
        np.array([image_base64.encode('utf-8')], dtype=object)
    )
    prompt_input = grpcclient.InferInput('PROMPT', [1], 'BYTES')
    prompt_input.set_data_from_numpy(
        np.array([VLM_PROMPT.encode('utf-8')], dtype=object)
    )

    result = client.infer(
        model_name=VLM_MODEL_NAME,
        inputs=[image_input, prompt_input],
        outputs=[grpcclient.InferRequestedOutput('TEXT')],
    )
    text_output = result.as_numpy('TEXT')
    if text_output is None:
        raise ValueError('VLM TEXT output was not returned')

    return {
        'type': 'vlm',
        'frameId': frame_id,
        'text': _decode_text_output(text_output),
    }
