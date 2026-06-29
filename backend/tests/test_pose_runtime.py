import numpy as np

from app.pose_runtime import extract_points


def test_extract_points_from_batched_array():
    output = np.array([[[1.0, 2.0, 0.9], [3.0, 4.0, 0.8]]], dtype=np.float32)
    assert extract_points(output) == [
        {'x': 1.0, 'y': 2.0, 'score': 0.8999999761581421},
        {'x': 3.0, 'y': 4.0, 'score': 0.800000011920929},
    ]
