import numpy as np

from app.pose_runtime import decode_pose_outputs, extract_points, preprocess_frame, resize_nearest_rgb


def test_extract_points_from_batched_array():
    output = np.array([[[1.0, 2.0, 0.9], [3.0, 4.0, 0.8]]], dtype=np.float32)
    assert extract_points(output) == [
        {'x': 1.0, 'y': 2.0, 'score': 0.8999999761581421},
        {'x': 3.0, 'y': 4.0, 'score': 0.800000011920929},
    ]


def test_resize_nearest_rgb_changes_spatial_size():
    frame = np.arange(4 * 6 * 3, dtype=np.uint8).reshape(4, 6, 3)
    resized = resize_nearest_rgb(frame, width=3, height=2)
    assert resized.shape == (2, 3, 3)


def test_preprocess_frame_nchw_float32_normalized():
    frame = np.full((4, 4, 3), 128, dtype=np.uint8)
    tensor = preprocess_frame(
        frame,
        input_width=2,
        input_height=3,
        layout='NCHW',
        datatype='FP32',
        normalize=True,
    )
    assert tensor.shape == (1, 3, 3, 2)
    assert tensor.dtype == np.float32


def test_decode_simcc_outputs_scales_to_source_frame():
    simcc_x = np.zeros((1, 2, 8), dtype=np.float32)
    simcc_y = np.zeros((1, 2, 12), dtype=np.float32)
    simcc_x[0, 0, 2] = 10.0
    simcc_y[0, 0, 3] = 10.0
    simcc_x[0, 1, 6] = 10.0
    simcc_y[0, 1, 9] = 10.0

    points = decode_pose_outputs(
        [simcc_x, simcc_y],
        source_width=400,
        source_height=600,
        input_width=4,
        input_height=6,
    )

    assert len(points) == 2
    assert points[0]['x'] == 100.0
    assert points[0]['y'] == 150.0
    assert points[1]['x'] == 300.0
    assert points[1]['y'] == 450.0
    assert points[0]['score'] > 0.9


def test_decode_direct_points_scales_from_model_input_to_source_frame():
    output = np.array([[[1.0, 2.0, 0.9]]], dtype=np.float32)
    points = decode_pose_outputs(
        [output],
        source_width=400,
        source_height=600,
        input_width=4,
        input_height=6,
    )

    assert points == [{'x': 100.0, 'y': 200.0, 'score': 0.8999999761581421}]
