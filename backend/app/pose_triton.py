import os
from dataclasses import dataclass
from typing import Any

import numpy as np
import tritonclient.grpc as grpcclient

from app.pose_runtime import ImageLayout, decode_pose_outputs, preprocess_frame

TRITON_GRPC_URL = os.getenv('TRITON_GRPC_URL', 'triton:8001')
POSE_MODEL_NAME = os.getenv('POSE_MODEL_NAME', 'rtmpose')
POSE_MODEL_VERSION = os.getenv('POSE_MODEL_VERSION', '')
POSE_MOCK_MODE = os.getenv('POSE_MOCK_MODE', '1') == '1'
POSE_INPUT_WIDTH = int(os.getenv('POSE_INPUT_WIDTH', '192'))
POSE_INPUT_HEIGHT = int(os.getenv('POSE_INPUT_HEIGHT', '256'))
POSE_NORMALIZE = os.getenv('POSE_NORMALIZE', '1') == '1'
POSE_INPUT_NAME_OVERRIDE = os.getenv('POSE_INPUT_NAME', '').strip()
POSE_OUTPUT_NAME_OVERRIDE = os.getenv('POSE_OUTPUT_NAME', '').strip()


@dataclass(frozen=True)
class TensorMetadata:
    name: str
    datatype: str
    shape: list[int]


@dataclass(frozen=True)
class ModelIO:
    input_name: str
    input_datatype: str
    input_width: int
    input_height: int
    layout: ImageLayout
    output_names: list[str]


_model_io: ModelIO | None = None


def mock_keypoints(width: int, height: int) -> list[dict[str, float]]:
    cx = width * 0.5
    cy = height * 0.42
    return [
        {'x': cx, 'y': cy - height * 0.22, 'score': 0.9},
        {'x': cx - width * 0.04, 'y': cy - height * 0.24, 'score': 0.8},
        {'x': cx + width * 0.04, 'y': cy - height * 0.24, 'score': 0.8},
        {'x': cx - width * 0.08, 'y': cy - height * 0.18, 'score': 0.8},
        {'x': cx + width * 0.08, 'y': cy - height * 0.18, 'score': 0.8},
        {'x': cx - width * 0.12, 'y': cy, 'score': 0.9},
        {'x': cx + width * 0.12, 'y': cy, 'score': 0.9},
        {'x': cx - width * 0.2, 'y': cy + height * 0.16, 'score': 0.85},
        {'x': cx + width * 0.2, 'y': cy + height * 0.16, 'score': 0.85},
        {'x': cx - width * 0.24, 'y': cy + height * 0.32, 'score': 0.8},
        {'x': cx + width * 0.24, 'y': cy + height * 0.32, 'score': 0.8},
        {'x': cx - width * 0.1, 'y': cy + height * 0.34, 'score': 0.9},
        {'x': cx + width * 0.1, 'y': cy + height * 0.34, 'score': 0.9},
        {'x': cx - width * 0.12, 'y': cy + height * 0.55, 'score': 0.85},
        {'x': cx + width * 0.12, 'y': cy + height * 0.55, 'score': 0.85},
        {'x': cx - width * 0.14, 'y': cy + height * 0.75, 'score': 0.8},
        {'x': cx + width * 0.14, 'y': cy + height * 0.75, 'score': 0.8},
    ]


def build_payload(frame_id: int, width: int, height: int, keypoints: list[dict[str, float]]) -> dict[str, Any]:
    return {'type': 'pose', 'frameId': frame_id, 'sourceWidth': width, 'sourceHeight': height, 'keypoints': keypoints}


def _metadata_value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _normalize_shape(shape: Any) -> list[int]:
    dims: list[int] = []
    for dim in shape:
        try:
            dims.append(int(dim))
        except (TypeError, ValueError):
            dims.append(-1)
    return dims


def _parse_tensor_metadata(item: Any) -> TensorMetadata:
    return TensorMetadata(
        name=str(_metadata_value(item, 'name', '')),
        datatype=str(_metadata_value(item, 'datatype', 'FP32')).upper(),
        shape=_normalize_shape(_metadata_value(item, 'shape', [])),
    )


def _get_metadata_items(metadata: Any, key: str) -> list[Any]:
    if isinstance(metadata, dict):
        return list(metadata.get(key, []))
    return list(getattr(metadata, key, []))


def _resolve_input_shape(input_metadata: TensorMetadata) -> tuple[int, int, ImageLayout]:
    shape = input_metadata.shape
    if len(shape) != 4:
        raise ValueError(f'Expected 4D image input for {input_metadata.name}, got shape {shape}')

    if shape[1] == 3:
        input_height = shape[2] if shape[2] > 0 else POSE_INPUT_HEIGHT
        input_width = shape[3] if shape[3] > 0 else POSE_INPUT_WIDTH
        return input_width, input_height, 'NCHW'

    if shape[3] == 3:
        input_height = shape[1] if shape[1] > 0 else POSE_INPUT_HEIGHT
        input_width = shape[2] if shape[2] > 0 else POSE_INPUT_WIDTH
        return input_width, input_height, 'NHWC'

    raise ValueError(f'Could not infer image layout from input shape {shape} for {input_metadata.name}')


def _select_input(inputs: list[TensorMetadata]) -> TensorMetadata:
    if not inputs:
        raise ValueError(f'Model {POSE_MODEL_NAME} has no inputs')

    if POSE_INPUT_NAME_OVERRIDE:
        for input_metadata in inputs:
            if input_metadata.name == POSE_INPUT_NAME_OVERRIDE:
                return input_metadata
        names = ', '.join(input_metadata.name for input_metadata in inputs)
        raise ValueError(f'POSE_INPUT_NAME={POSE_INPUT_NAME_OVERRIDE} was not found. Available inputs: {names}')

    return inputs[0]


def _select_output_names(outputs: list[TensorMetadata]) -> list[str]:
    if not outputs:
        raise ValueError(f'Model {POSE_MODEL_NAME} has no outputs')

    if POSE_OUTPUT_NAME_OVERRIDE:
        requested = [name.strip() for name in POSE_OUTPUT_NAME_OVERRIDE.split(',') if name.strip()]
        available = {output.name for output in outputs}
        missing = [name for name in requested if name not in available]
        if missing:
            raise ValueError(
                f'POSE_OUTPUT_NAME contains unavailable output(s): {missing}. '
                f'Available outputs: {sorted(available)}'
            )
        return requested

    return [output.name for output in outputs]


def _resolve_model_io(client: grpcclient.InferenceServerClient) -> ModelIO:
    global _model_io
    if _model_io is not None:
        return _model_io

    metadata = client.get_model_metadata(model_name=POSE_MODEL_NAME, model_version=POSE_MODEL_VERSION)
    inputs = [_parse_tensor_metadata(item) for item in _get_metadata_items(metadata, 'inputs')]
    outputs = [_parse_tensor_metadata(item) for item in _get_metadata_items(metadata, 'outputs')]
    input_metadata = _select_input(inputs)
    input_width, input_height, layout = _resolve_input_shape(input_metadata)
    output_names = _select_output_names(outputs)

    _model_io = ModelIO(
        input_name=input_metadata.name,
        input_datatype=input_metadata.datatype,
        input_width=input_width,
        input_height=input_height,
        layout=layout,
        output_names=output_names,
    )
    return _model_io


def reset_model_io_cache() -> None:
    global _model_io
    _model_io = None


def run_pose(frame_rgb: np.ndarray, frame_id: int) -> dict[str, Any]:
    height, width, _channels = frame_rgb.shape
    if POSE_MOCK_MODE:
        return build_payload(frame_id, width, height, mock_keypoints(width, height))

    client = grpcclient.InferenceServerClient(url=TRITON_GRPC_URL)
    model_io = _resolve_model_io(client)
    input_data = preprocess_frame(
        frame_rgb,
        input_width=model_io.input_width,
        input_height=model_io.input_height,
        layout=model_io.layout,
        datatype=model_io.input_datatype,
        normalize=POSE_NORMALIZE,
    )

    inference_input = grpcclient.InferInput(model_io.input_name, list(input_data.shape), model_io.input_datatype)
    inference_input.set_data_from_numpy(input_data)
    inference_outputs = [grpcclient.InferRequestedOutput(output_name) for output_name in model_io.output_names]
    result = client.infer(
        model_name=POSE_MODEL_NAME,
        model_version=POSE_MODEL_VERSION,
        inputs=[inference_input],
        outputs=inference_outputs,
    )
    raw_outputs = [result.as_numpy(output_name) for output_name in model_io.output_names]
    keypoints = decode_pose_outputs(
        raw_outputs,
        source_width=width,
        source_height=height,
        input_width=model_io.input_width,
        input_height=model_io.input_height,
    )
    return build_payload(frame_id, width, height, keypoints)
