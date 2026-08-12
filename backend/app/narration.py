import asyncio
import base64
import io
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

import av
import numpy as np
import tritonclient.grpc as grpcclient
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from PIL import Image


router = APIRouter()


def _epoch_ms() -> float:
    return time.time_ns() / 1_000_000


def _redact_rtsp_credentials(message: str) -> str:
    return re.sub(r'(?i)(rtsp://)([^/@:]+):([^/@]+)@', r'\1***:***@', message)


@dataclass(frozen=True)
class LatestFrame:
    frame_id: int
    received_ts_ms: float
    rgb: np.ndarray


class NarrationService:
    def __init__(self) -> None:
        self.rtsp_url = os.getenv('NARRATION_RTSP_URL', '').strip()
        self.rtsp_transport = os.getenv('NARRATION_RTSP_TRANSPORT', 'tcp').strip() or 'tcp'
        self.reconnect_seconds = max(float(os.getenv('NARRATION_RTSP_RECONNECT_SECONDS', '2')), 0.5)
        self.interval_seconds = max(float(os.getenv('VLM_NARRATION_INTERVAL_SECONDS', '3')), 0.5)
        self.prompt = os.getenv(
            'VLM_NARRATION_PROMPT',
            'Describe what is happening in this image in one short sentence.',
        ).strip()
        self.vlm_triton_grpc_url = os.getenv('VLM_TRITON_GRPC_URL', 'vlm-triton:8001').strip()
        self.vlm_model_name = os.getenv('VLM_MODEL_NAME', 'smolvlm_256m_cpu').strip()
        self.jpeg_quality = min(max(int(os.getenv('VLM_NARRATION_JPEG_QUALITY', '80')), 40), 95)

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._latest_frame: LatestFrame | None = None
        self._reader_thread: threading.Thread | None = None
        self._worker_task: asyncio.Task[None] | None = None
        self._clients: set[WebSocket] = set()
        self._frame_sequence = 0
        self._last_inferred_frame_id: int | None = None
        self._last_payload: dict[str, Any] | None = None
        self._source_connected = False
        self._last_error: str | None = None
        self._last_inference_ms: float | None = None

    def status(self) -> dict[str, Any]:
        with self._lock:
            latest_frame = self._latest_frame
            return {
                'configured': bool(self.rtsp_url),
                'source_connected': self._source_connected,
                'rtsp_transport': self.rtsp_transport,
                'interval_seconds': self.interval_seconds,
                'vlm_model_name': self.vlm_model_name,
                'vlm_triton_grpc_url': self.vlm_triton_grpc_url,
                'latest_frame_id': latest_frame.frame_id if latest_frame else None,
                'latest_frame_received_ts_ms': latest_frame.received_ts_ms if latest_frame else None,
                'last_inferred_frame_id': self._last_inferred_frame_id,
                'last_inference_ms': self._last_inference_ms,
                'last_error': self._last_error,
                'websocket_clients': len(self._clients),
            }

    async def start(self) -> None:
        if not self.rtsp_url or self._reader_thread is not None:
            return

        self._stop_event.clear()
        self._reader_thread = threading.Thread(
            target=self._reader_loop,
            name='narration-rtsp-reader',
            daemon=True,
        )
        self._reader_thread.start()
        self._worker_task = asyncio.create_task(self._inference_loop(), name='narration-vlm-worker')

    async def stop(self) -> None:
        self._stop_event.set()

        if self._worker_task is not None:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

        reader_thread = self._reader_thread
        self._reader_thread = None
        if reader_thread and reader_thread.is_alive():
            await asyncio.to_thread(reader_thread.join, 2.0)

        with self._lock:
            self._source_connected = False

    def _reader_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                options = {'rtsp_transport': self.rtsp_transport} if self.rtsp_transport else None
                with av.open(self.rtsp_url, options=options) as container:
                    video_stream = next((stream for stream in container.streams if stream.type == 'video'), None)
                    if video_stream is None:
                        raise RuntimeError('RTSP source has no video stream')

                    with self._lock:
                        self._source_connected = True
                        self._last_error = None

                    for frame in container.decode(video_stream):
                        if self._stop_event.is_set():
                            return

                        rgb = frame.to_ndarray(format='rgb24')
                        received_ts_ms = _epoch_ms()
                        with self._lock:
                            self._frame_sequence += 1
                            self._latest_frame = LatestFrame(
                                frame_id=self._frame_sequence,
                                received_ts_ms=received_ts_ms,
                                rgb=rgb,
                            )

                    raise RuntimeError('RTSP source ended')
            except Exception as exc:
                with self._lock:
                    self._source_connected = False
                    self._last_error = _redact_rtsp_credentials(f'{type(exc).__name__}: {exc}')
                if self._stop_event.wait(self.reconnect_seconds):
                    return

    def _snapshot_latest_frame(self) -> LatestFrame | None:
        with self._lock:
            return self._latest_frame

    async def _inference_loop(self) -> None:
        while not self._stop_event.is_set():
            cycle_started = time.monotonic()
            latest = self._snapshot_latest_frame()

            if latest is not None and latest.frame_id != self._last_inferred_frame_id:
                inference_started_ts_ms = _epoch_ms()
                try:
                    text = await asyncio.to_thread(self._infer_vlm, latest.rgb)
                    inference_ended_ts_ms = _epoch_ms()
                    inference_ms = round(inference_ended_ts_ms - inference_started_ts_ms, 2)
                    result_send_ts_ms = _epoch_ms()
                    payload: dict[str, Any] = {
                        'type': 'narration',
                        'frameId': latest.frame_id,
                        'rtspReceiveTsMs': round(latest.received_ts_ms, 3),
                        'inferenceStartTsMs': round(inference_started_ts_ms, 3),
                        'inferenceEndTsMs': round(inference_ended_ts_ms, 3),
                        'resultSendTsMs': round(result_send_ts_ms, 3),
                        'inferenceMs': inference_ms,
                        'text': text,
                    }
                    with self._lock:
                        self._last_inferred_frame_id = latest.frame_id
                        self._last_inference_ms = inference_ms
                        self._last_payload = payload
                        self._last_error = None
                    await self._broadcast(payload)
                except Exception as exc:
                    error_message = _redact_rtsp_credentials(f'{type(exc).__name__}: {exc}')
                    with self._lock:
                        self._last_error = error_message
                    await self._broadcast({'type': 'narration-error', 'message': error_message})

            elapsed = time.monotonic() - cycle_started
            await asyncio.sleep(max(self.interval_seconds - elapsed, 0.05))

    def _infer_vlm(self, rgb: np.ndarray) -> str:
        image = Image.fromarray(rgb)
        buffer = io.BytesIO()
        image.save(buffer, format='JPEG', quality=self.jpeg_quality)
        image_base64 = base64.b64encode(buffer.getvalue())

        image_input = grpcclient.InferInput('IMAGE_BASE64', [1], 'BYTES')
        image_input.set_data_from_numpy(np.array([image_base64], dtype=object))

        prompt_input = grpcclient.InferInput('PROMPT', [1], 'BYTES')
        prompt_input.set_data_from_numpy(np.array([self.prompt.encode('utf-8')], dtype=object))

        output = grpcclient.InferRequestedOutput('TEXT')
        triton = grpcclient.InferenceServerClient(url=self.vlm_triton_grpc_url)
        result = triton.infer(
            model_name=self.vlm_model_name,
            inputs=[image_input, prompt_input],
            outputs=[output],
        )
        values = result.as_numpy('TEXT')
        if values is None or values.size == 0:
            raise RuntimeError('VLM returned no TEXT output')

        value = values.reshape(-1)[0]
        if isinstance(value, bytes):
            return value.decode('utf-8').strip()
        return str(value).strip()

    async def add_client(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._clients.add(websocket)
        await websocket.send_json({'type': 'narration-status', **self.status()})
        if self._last_payload is not None:
            await websocket.send_json(self._last_payload)

    def remove_client(self, websocket: WebSocket) -> None:
        self._clients.discard(websocket)

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        disconnected: list[WebSocket] = []
        for websocket in list(self._clients):
            try:
                await websocket.send_json(payload)
            except Exception:
                disconnected.append(websocket)
        for websocket in disconnected:
            self._clients.discard(websocket)


narration_service = NarrationService()


@router.get('/narration/status')
def narration_status() -> dict[str, Any]:
    return narration_service.status()


@router.websocket('/narration/ws')
async def narration_websocket(websocket: WebSocket) -> None:
    await narration_service.add_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        narration_service.remove_client(websocket)
    except Exception:
        narration_service.remove_client(websocket)
