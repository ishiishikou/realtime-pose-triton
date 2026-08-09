# CPU-only VLM sample with Triton

This sample serves `HuggingFaceTB/SmolVLM-256M-Instruct` through Triton Inference Server on CPU.

The sample is intentionally separate from the existing RTMPose stack. It does not change the pose model, backend API, WebRTC path, or frontend.

## Why this model

SmolVLM-256M is a 256M-parameter image+text model intended for low-resource multimodal inference. The upstream model repository provides an ONNX Runtime example and quantized ONNX artifacts.

This sample uses the three quantized ONNX artifacts:

- `onnx/vision_encoder_quantized.onnx`
- `onnx/embed_tokens_quantized.onnx`
- `onnx/decoder_model_merged_quantized.onnx`

The Python backend orchestrates the autoregressive generation loop while ONNX Runtime executes all three subgraphs with `CPUExecutionProvider`. PyTorch is not installed.

## Architecture

```text
local JPEG/PNG
  -> base64 JSON
  -> Triton HTTP v2
  -> Python Backend (KIND_CPU)
  -> Transformers processor
  -> ONNX Runtime CPU
       - vision encoder
       - token embeddings
       - merged decoder
  -> generated text
```

## Start

The first startup needs internet access so the model config, tokenizer/processor files, and ONNX files can be downloaded from Hugging Face. They are cached in a named Docker volume for later starts.

```bash
docker compose -f docker-compose.vlm-cpu.yml up --build
```

Check Triton readiness:

```bash
curl http://localhost:8100/v2/health/ready
```

Check that the model is configured for CPU:

```bash
curl http://localhost:8100/v2/models/smolvlm_256m_cpu/config
```

The returned model config should contain `KIND_CPU`.

## Run one inference

Use any local JPEG or PNG:

```bash
python3 examples/vlm/client.py ./path/to/image.jpg
```

Custom prompt:

```bash
python3 examples/vlm/client.py ./path/to/image.jpg \
  --prompt "What is the person doing?"
```

SmolVLM-256M is primarily an English model, so English prompts are recommended.

## CPU tuning

`VLM_MAX_NEW_TOKENS` defaults to `48`. Smaller values reduce CPU generation time.

`VLM_ORT_THREADS` defaults to `0`, which leaves thread selection to ONNX Runtime. To cap CPU usage, for example:

```bash
VLM_ORT_THREADS=4 VLM_MAX_NEW_TOKENS=32 \
  docker compose -f docker-compose.vlm-cpu.yml up --build
```

## Notes

- No `--gpus` option or GPU reservation is used.
- `config.pbtxt` explicitly sets `instance_group.kind` to `KIND_CPU`.
- Triton's standard NGC image is still a large image with GPU-capable components; the model execution in this sample is CPU-only.
- This is a single-image request/response sample, not a real-time per-frame VLM pipeline.
- CPU latency depends heavily on processor generation, image size, prompt length, token limit, and the host CPU.
- The first model load is slower because Hugging Face artifacts must be downloaded and ONNX Runtime sessions must be initialized.

Stop the sample with:

```bash
docker compose -f docker-compose.vlm-cpu.yml down
```
