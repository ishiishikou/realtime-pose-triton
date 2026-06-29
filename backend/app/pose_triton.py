import os
from typing import Any

import numpy as np
import tritonclient.grpc as grpcclient

from app.pose_runtime import extract_points

TRITON_GRPC_URL = os.getenv('TRITON_GRPC_URL', 'triton:8001')
POSE_MODEL_NAME = os.getenv('POSE_MODEL_NAME', 'rtmpose')
POSE_MODEL_VERSION = os.getenv('POSE_MODEL_VERSION', '')
POSE_INPUT_NAME = os.getenv('POSE_INPUT_NAME', 'image')
POSE_OUTPUT_NAME = os.getenv('POSE_OUTPUT_NAME', 'keypoints')
POSE_MOCK_MODE = os.getenv('POSE_MOCK_MODE', '1') == '1'


def mock_keypoints(width: int, height: int) -> list[dict[str, float]]:
    cx = width * 0.5
    cy = height * 0.42
    return [
        {'x': cx, 'y': cy - height * 0.22, 'score': 0.9},
        {'x': cx - width * 0.12, 'y': cy, 'score': 0.9},
        {'x': cx + width * 0.12, 'y': cy, 'score': 0.9},
        {'x': cx - width * 0.2, 'y': cy + height * 0.16, 'score': 0.85},
        {'x': cx + width * 0.2, 'y': cy + height * 0.16, 'score': 0.85},
        {'x': cx - width * 0.1, 'y': cy + height * 0.34, 'score': 0.9},
        {'x': cx + width * 0.1, 'y': cy + height * 0.34, 'score': 0.9},
    ]


def build_payload(frame_id: int, width: int, height: int, keypoints: list[dict[str, float]]) -> dict[str, Any]:
    return {'type': 'pose', 'frameId': frame_id, 'sourceWidth': width, 'sourceHeight': height, 'keypoints': keypoints}


def run_pose(frame_rgb: np.ndarray, frame_id: int) -> dict[str, Any]:
    height, width, _channels = frame_rgb.shape
    if POSE_MOCK_MODE:
        return build_payload(frame_id, width, height, mock_keypoints(width, height))

    batched = np.expand_dims(frame_rgb.astype(np.uint8, copy=False), axis=0)
    client = grpcclient.InferenceServerClient(url=TRITON_GRPC_URL)
    inference_input = grpcclient.InferInput(POSE_INPUT_NAME, list(batched.shape), 'UINT8')
    inference_input.set_data_from_numpy(batched)
    inference_output = grpcclient.InferRequestedOutput(POSE_OUTPUT_NAME)
    result = client.infer(
        model_name=POSE_MODEL_NAME,
        model_version=POSE_MODEL_VERSION,
        inputs=[inference_input],
        outputs=[inference_output],
    )
    output = result.as_numpy(POSE_OUTPUT_NAME)
    keypoints = extract_points(output) if output is not None else []
    return build_payload(frame_id, width, height, keypoints)
