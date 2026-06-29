import numpy as np

from app.pose_triton import mock_keypoints, run_pose


def test_mock_keypoints_return_coco_17_points():
    keypoints = mock_keypoints(width=640, height=360)

    assert len(keypoints) == 17
    assert all({'x', 'y', 'score'} <= point.keys() for point in keypoints)
    assert all(0 <= point['x'] <= 640 for point in keypoints)
    assert all(0 <= point['y'] <= 360 * 1.2 for point in keypoints)
    assert all(0 <= point['score'] <= 1 for point in keypoints)


def test_run_pose_mock_payload_shape():
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    payload = run_pose(frame, frame_id=42)

    assert payload['type'] == 'pose'
    assert payload['frameId'] == 42
    assert payload['sourceWidth'] == 640
    assert payload['sourceHeight'] == 360
    assert len(payload['keypoints']) == 17
