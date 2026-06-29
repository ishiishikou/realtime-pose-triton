from app import main


def test_pose_status_shape(monkeypatch):
    monkeypatch.setenv('POSE_MOCK_MODE', '1')

    payload = main.pose_status()

    assert payload['mock_mode'] is True
    assert payload['triton']['ok'] is None
    assert isinstance(payload['active_peer_connections'], int)
