import asyncio

import pytest

from app.narration import NarrationManager, _redact_rtsp_details


def test_narration_status_does_not_expose_rtsp_base_or_credentials(monkeypatch):
    monkeypatch.setenv(
        'NARRATION_RTSP_BASE_URL',
        'rtsp://example-user:example-password@example.invalid:8554',
    )
    manager = NarrationManager()

    service = asyncio.run(manager.get_or_create('live/camera-001'))
    status = service.status(manager.configured)

    assert status['configured'] is True
    assert status['stream_path'] == 'live/camera-001'
    assert status['source_connected'] is False
    assert 'rtsp_url' not in status
    assert 'rtsp_base_url' not in status
    assert 'example-user' not in str(status)
    assert 'example-password' not in str(status)


def test_narration_is_disabled_when_rtsp_base_is_empty(monkeypatch):
    monkeypatch.setenv('NARRATION_RTSP_BASE_URL', '')
    manager = NarrationManager()

    service = asyncio.run(manager.get_or_create('live/camera-001'))
    status = service.status(manager.configured)

    assert status['configured'] is False
    assert status['source_connected'] is False
    assert status['latest_frame_id'] is None


def test_narration_accepts_dynamic_paths_under_allowed_prefix(monkeypatch):
    monkeypatch.setenv('NARRATION_ALLOWED_PATH_PREFIX', 'live/')
    manager = NarrationManager()

    assert manager.normalize_stream_path('/live/perf/p01/webrtc-001/') == 'live/perf/p01/webrtc-001'


@pytest.mark.parametrize(
    'stream_path',
    [
        '',
        '../secret',
        'live/../secret',
        'other/camera-001',
        'live/camera?token=secret',
        'rtsp://example.invalid/live/camera-001',
    ],
)
def test_narration_rejects_unsafe_or_out_of_scope_paths(monkeypatch, stream_path):
    monkeypatch.setenv('NARRATION_ALLOWED_PATH_PREFIX', 'live/')
    manager = NarrationManager()

    with pytest.raises(ValueError):
        manager.normalize_stream_path(stream_path)


def test_rtsp_error_redaction_hides_credentials_and_host():
    message = (
        'Could not open rtsp://example-user:example-password@private-host.example:8554/live/camera-001'
    )

    redacted = _redact_rtsp_details(message)

    assert 'example-user' not in redacted
    assert 'example-password' not in redacted
    assert 'private-host.example' not in redacted
    assert 'rtsp://***' in redacted
