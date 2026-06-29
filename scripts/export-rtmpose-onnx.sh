#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="${WORK_DIR:-rtmpose-ort/rtmpose-t}"
MMDEPLOY_DIR="${MMDEPLOY_DIR:-../mmdeploy}"
MMPOSE_DIR="${MMPOSE_DIR:-../mmpose}"
CHECKPOINT_PATH="${CHECKPOINT_PATH:?Set CHECKPOINT_PATH to a local RTMPose checkpoint path or URL}"
MODEL_CONFIG="${MODEL_CONFIG:-${MMPOSE_DIR}/projects/rtmpose/rtmpose/body_2d_keypoint/rtmpose-t_8xb256-420e_coco-256x192.py}"
OUTPUT_PATH="${OUTPUT_PATH:-models/rtmpose/1/model.onnx}"
DEMO_IMAGE="${DEMO_IMAGE:-${WORK_DIR}/demo-input.png}"

if [ ! -d "${MMDEPLOY_DIR}" ]; then
  echo "MMDEPLOY_DIR not found: ${MMDEPLOY_DIR}" >&2
  exit 1
fi

if [ ! -d "${MMPOSE_DIR}" ]; then
  echo "MMPOSE_DIR not found: ${MMPOSE_DIR}" >&2
  exit 1
fi

if [ ! -f "${MODEL_CONFIG}" ]; then
  echo "MODEL_CONFIG not found: ${MODEL_CONFIG}" >&2
  exit 1
fi

if [ ! -f "${DEMO_IMAGE}" ]; then
  mkdir -p "$(dirname "${DEMO_IMAGE}")"
  python - "${DEMO_IMAGE}" <<'PY'
import struct
import sys
import zlib

path = sys.argv[1]
width = 256
height = 192
row = bytes([0]) + bytes([240, 240, 240]) * width
raw = row * height

def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack('>I', len(data))
        + tag
        + data
        + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    )

png = (
    b'\x89PNG\r\n\x1a\n'
    + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    + chunk(b'IDAT', zlib.compress(raw, 9))
    + chunk(b'IEND', b'')
)
with open(path, 'wb') as f:
    f.write(png)
print(f'Generated demo image: {path}')
PY
fi

python "${MMDEPLOY_DIR}/tools/deploy.py" \
  "${MMDEPLOY_DIR}/configs/mmpose/pose-detection_simcc_onnxruntime_dynamic.py" \
  "${MODEL_CONFIG}" \
  "${CHECKPOINT_PATH}" \
  "${DEMO_IMAGE}" \
  --work-dir "${WORK_DIR}" \
  --device cpu \
  --dump-info

if [ ! -f "${WORK_DIR}/end2end.onnx" ]; then
  echo "Exported ONNX not found: ${WORK_DIR}/end2end.onnx" >&2
  find "${WORK_DIR}" -maxdepth 4 -type f -print || true
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"
cp "${WORK_DIR}/end2end.onnx" "${OUTPUT_PATH}"
