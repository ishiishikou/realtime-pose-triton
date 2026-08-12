from app.narration import NarrationService


def test_narration_status_does_not_expose_rtsp_url(monkeypatch):
    monkeypatch.setenv(
        'NARRATION_RTSP_URL',
        'rtsp://example-user:example-password@example.invalid:8554/live/camera-001',
    )

    service = NarrationService()
    status = service.status()

    assert status['configured'] is True
    assert status['source_connected'] is False
    assert 'rtsp_url' not in status
    assert 'example-user' not in str(status)
    assert 'example-password' not in str(status)


def test_narration_is_disabled_when_rtsp_url_is_empty(monkeypatch):
    monkeypatch.setenv('NARRATION_RTSP_URL', '')

    service = NarrationService()
    status = service.status()

    assert status['configured'] is False
    assert status['source_connected'] is False
    assert status['latest_frame_id'] is None
