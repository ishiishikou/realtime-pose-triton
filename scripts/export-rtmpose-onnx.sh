#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="${WORK_DIR:-rtmpose-ort/rtmpose-m}"
MMDEPLOY_DIR="${MMDEPLOY_DIR:-../mmdeploy}"
MMPOSE_DIR="${MMPOSE_DIR:-../mmpose}"
CHECKPOINT_PATH="${CHECKPOINT_PATH:?Set CHECKPOINT_PATH to a local RTMPose checkpoint path or URL}"
OUTPUT_PATH="${OUTPUT_PATH:-models/rtmpose/1/model.onnx}"
DEMO_IMAGE="${DEMO_IMAGE:-${MMPOSE_DIR}/demo/resources/human-pose.jpg}"

if [ ! -d "${MMDEPLOY_DIR}" ]; then
  echo "MMDEPLOY_DIR not found: ${MMDEPLOY_DIR}" >&2
  exit 1
fi

if [ ! -d "${MMPOSE_DIR}" ]; then
  echo "MMPOSE_DIR not found: ${MMPOSE_DIR}" >&2
  exit 1
fi

if [ ! -f "${DEMO_IMAGE}" ]; then
  echo "DEMO_IMAGE not found: ${DEMO_IMAGE}" >&2
  exit 1
fi

python "${MMDEPLOY_DIR}/tools/deploy.py" \
  "${MMDEPLOY_DIR}/configs/mmpose/pose-detection_simcc_onnxruntime_dynamic.py" \
  "${MMPOSE_DIR}/projects/rtmpose/rtmpose/body_2d_keypoint/rtmpose-m_8xb256-420e_coco-256x192.py" \
  "${CHECKPOINT_PATH}" \
  "${DEMO_IMAGE}" \
  --work-dir "${WORK_DIR}" \
  --device cpu \
  --dump-info

mkdir -p "$(dirname "${OUTPUT_PATH}")"
cp "${WORK_DIR}/end2end.onnx" "${OUTPUT_PATH}"
