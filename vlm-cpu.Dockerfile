FROM nvcr.io/nvidia/tritonserver:24.12-py3

# Keep the VLM runtime CPU-oriented: ONNX Runtime + Transformers preprocessing only.
# PyTorch is intentionally not installed.
RUN python3 -m pip install --no-cache-dir \
    "numpy==1.26.4" \
    "onnxruntime==1.20.1" \
    "transformers==4.51.3" \
    "pillow==11.1.0" \
    "jinja2==3.1.6"

ENTRYPOINT ["tritonserver"]
CMD ["--model-repository=/models", "--strict-readiness=false"]
