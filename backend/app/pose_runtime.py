from typing import Any, Literal

import numpy as np

ImageLayout = Literal['NCHW', 'NHWC']

RTMPOSE_MEAN = np.array([123.675, 116.28, 103.53], dtype=np.float32)
RTMPOSE_STD = np.array([58.395, 57.12, 57.375], dtype=np.float32)


def resize_nearest_rgb(frame_rgb: np.ndarray, width: int, height: int) -> np.ndarray:
    if frame_rgb.ndim != 3 or frame_rgb.shape[2] != 3:
        raise ValueError(f'Expected RGB frame with shape HxWx3, got {frame_rgb.shape}')
    if width <= 0 or height <= 0:
        raise ValueError(f'Invalid target size: {width}x{height}')

    y_index = np.linspace(0, frame_rgb.shape[0] - 1, height).round().astype(np.int64)
    x_index = np.linspace(0, frame_rgb.shape[1] - 1, width).round().astype(np.int64)
    return frame_rgb[y_index[:, None], x_index[None, :], :]


def preprocess_frame(
    frame_rgb: np.ndarray,
    *,
    input_width: int,
    input_height: int,
    layout: ImageLayout,
    datatype: str,
    normalize: bool,
) -> np.ndarray:
    resized = resize_nearest_rgb(frame_rgb, input_width, input_height)
    normalized_datatype = datatype.upper()

    if normalized_datatype == 'UINT8':
        tensor = resized.astype(np.uint8, copy=False)
    else:
        tensor = resized.astype(np.float32, copy=False)
        if normalize:
            tensor = (tensor - RTMPOSE_MEAN) / RTMPOSE_STD

    if layout == 'NCHW':
        tensor = np.transpose(tensor, (2, 0, 1))
    elif layout != 'NHWC':
        raise ValueError(f'Unsupported image layout: {layout}')

    return np.expand_dims(tensor, axis=0)


def extract_points(output: Any) -> list[dict[str, float]]:
    array = np.asarray(output)
    if array.ndim == 3:
        array = array[0]
    if array.ndim != 2 or array.shape[1] < 2:
        return []

    points: list[dict[str, float]] = []
    for row in array:
        score = float(row[2]) if row.shape[0] >= 3 else 1.0
        points.append({'x': float(row[0]), 'y': float(row[1]), 'score': score})
    return points


def _sigmoid(value: np.ndarray) -> np.ndarray:
    clipped = np.clip(value, -50.0, 50.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def _squeeze_batch(array: np.ndarray) -> np.ndarray:
    if array.ndim >= 3 and array.shape[0] == 1:
        return array[0]
    return array


def _scale_direct_points(
    output: np.ndarray,
    *,
    source_width: int,
    source_height: int,
    input_width: int,
    input_height: int,
) -> list[dict[str, float]]:
    points = extract_points(output)
    if not points:
        return []

    max_x = max(point['x'] for point in points)
    max_y = max(point['y'] for point in points)
    should_scale = max_x <= input_width * 1.25 and max_y <= input_height * 1.25
    if not should_scale:
        return points

    scale_x = source_width / input_width
    scale_y = source_height / input_height
    return [
        {'x': point['x'] * scale_x, 'y': point['y'] * scale_y, 'score': point['score']}
        for point in points
    ]


def _decode_simcc_pair(
    x_logits: np.ndarray,
    y_logits: np.ndarray,
    *,
    source_width: int,
    source_height: int,
    input_width: int,
    input_height: int,
) -> list[dict[str, float]]:
    if x_logits.ndim != 2 or y_logits.ndim != 2 or x_logits.shape[0] != y_logits.shape[0]:
        return []

    x_length = x_logits.shape[1]
    y_length = y_logits.shape[1]
    if x_length <= 0 or y_length <= 0:
        return []

    x_index = np.argmax(x_logits, axis=1).astype(np.float32)
    y_index = np.argmax(y_logits, axis=1).astype(np.float32)
    x_score = np.max(x_logits, axis=1).astype(np.float32)
    y_score = np.max(y_logits, axis=1).astype(np.float32)

    split_x = x_length / input_width
    split_y = y_length / input_height
    x_in_input = x_index / split_x
    y_in_input = y_index / split_y

    points: list[dict[str, float]] = []
    scores = ((_sigmoid(x_score) + _sigmoid(y_score)) * 0.5).astype(np.float32)
    for x_value, y_value, score in zip(x_in_input, y_in_input, scores):
        points.append(
            {
                'x': float(x_value * source_width / input_width),
                'y': float(y_value * source_height / input_height),
                'score': float(score),
            }
        )
    return points


def decode_pose_outputs(
    outputs: list[Any],
    *,
    source_width: int,
    source_height: int,
    input_width: int,
    input_height: int,
) -> list[dict[str, float]]:
    arrays = [_squeeze_batch(np.asarray(output)) for output in outputs if output is not None]
    simcc_candidates = [array for array in arrays if array.ndim == 2]

    if len(simcc_candidates) >= 2:
        first, second = simcc_candidates[0], simcc_candidates[1]
        first_as_x_cost = abs((first.shape[1] / input_width) - (second.shape[1] / input_height))
        second_as_x_cost = abs((second.shape[1] / input_width) - (first.shape[1] / input_height))
        x_logits, y_logits = (second, first) if second_as_x_cost < first_as_x_cost else (first, second)
        decoded = _decode_simcc_pair(
            x_logits,
            y_logits,
            source_width=source_width,
            source_height=source_height,
            input_width=input_width,
            input_height=input_height,
        )
        if decoded:
            return decoded

    for array in arrays:
        decoded = _scale_direct_points(
            array,
            source_width=source_width,
            source_height=source_height,
            input_width=input_width,
            input_height=input_height,
        )
        if decoded:
            return decoded

    return []
