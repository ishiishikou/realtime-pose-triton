#!/usr/bin/env sh
set -eu

MODEL_NAME="${POSE_MODEL_NAME:-rtmpose}"
MODEL_STORE_DIR="${TRITON_MODEL_DIR:-/models/${MODEL_NAME}/1}"
MODEL_PATH="${RTMPOSE_ONNX_PATH:-${MODEL_STORE_DIR}/model.onnx}"
RUNTIME_REPOSITORY="${TRITON_RUNTIME_REPOSITORY:-/models-runtime}"
EMPTY_REPOSITORY="${TRITON_EMPTY_REPOSITORY:-/models-empty}"
RUNTIME_MODEL_DIR="${RUNTIME_REPOSITORY}/${MODEL_NAME}/1"
RUNTIME_CONFIG_PATH="${RUNTIME_REPOSITORY}/${MODEL_NAME}/config.pbtxt"
DOWNLOAD_DIR="${RTMPOSE_DOWNLOAD_DIR:-/tmp/rtmpose-download}"

mkdir -p "${MODEL_STORE_DIR}" "${RUNTIME_MODEL_DIR}" "${EMPTY_REPOSITORY}" "${DOWNLOAD_DIR}"

copy_first_onnx_from_dir() {
  source_dir="$1"
  found_onnx="$(find "${source_dir}" -type f -name '*.onnx' | sort | head -n 1 || true)"
  if [ -z "${found_onnx}" ]; then
    echo "No .onnx file found under ${source_dir}" >&2
    return 1
  fi
  echo "Using ONNX artifact: ${found_onnx}"
  cp "${found_onnx}" "${MODEL_PATH}"
}

if [ ! -f "${MODEL_PATH}" ] && [ -n "${RTMPOSE_ONNX_URL:-}" ]; then
  downloaded_artifact="${DOWNLOAD_DIR}/artifact"
  wget -O "${downloaded_artifact}" "${RTMPOSE_ONNX_URL}"

  if echo "${RTMPOSE_ONNX_URL}" | grep -Eiq '\.zip($|[?#])'; then
    unzip_dir="${DOWNLOAD_DIR}/unzipped"
    mkdir -p "${unzip_dir}"
    unzip -q "${downloaded_artifact}" -d "${unzip_dir}"
    copy_first_onnx_from_dir "${unzip_dir}"
  else
    cp "${downloaded_artifact}" "${MODEL_PATH}"
  fi
fi

if [ -f "${MODEL_PATH}" ]; then
  cp "${MODEL_PATH}" "${RUNTIME_MODEL_DIR}/model.onnx"
  cat > "${RUNTIME_CONFIG_PATH}" <<EOF
name: "${MODEL_NAME}"
platform: "onnxruntime_onnx"
max_batch_size: 0
input [
  {
    name: "${POSE_INPUT_NAME:-image}"
    data_type: TYPE_UINT8
    dims: [1, -1, -1, 3]
  }
]
output [
  {
    name: "${POSE_OUTPUT_NAME:-keypoints}"
    data_type: TYPE_FP32
    dims: [1, 17, 3]
  }
]
EOF
  exec tritonserver --model-repository="${RUNTIME_REPOSITORY}" --strict-readiness=false
fi

exec tritonserver --model-repository="${EMPTY_REPOSITORY}" --strict-readiness=false
