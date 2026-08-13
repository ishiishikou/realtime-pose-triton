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
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from PIL import Image


router = APIRouter()
_STREAM_PATH_PATTERN = re.compile(r'^[A-Za-z0-9._/-]+$')
_RTSP_URL_PATTERN = re.compile(r'(?i)rtsp://[^\s\]\[(){}<>"\']+')


def _epoch_ms() -> float:
    return time.time_ns() / 1_000_000


def _redact_rtsp_details(message: str) -> str:
    return _RTSP_URL_PATTERN.sub('rtsp://***', message)


def _normalize_stream_path(stream_path: str, allowed_prefix: str) -> str:
    normalized = stream_path.strip().strip('/')
    if not normalized:
        raise ValueError('stream_path is required')
    if not _STREAM_PATH_PATTERN.fullmatch(normalized):
        raise ValueError('stream_path contains unsupported characters')
    if any(segment in {'.', '..'} for segment in normalized.split('/')):
        raise ValueError('stream_path contains an invalid path segment')

    normalized_prefix = allowed_prefix.strip().strip('/')
    if normalized_prefix and not (
        normalized == normalized_prefix or normalized.startswith(f'{normalized_prefix}/')
    ):
        raise ValueError(f'stream_path must be under {normalized_prefix}/')
    return normalized


@dataclass(frozen=True)
class LatestFrame:
    frame_id: int
    received_ts_ms: float
    rgb: np.ndarray


class NarrationStreamService:
    def __init__(
        self,
        *,
        stream_path: str,
        rtsp_url: str,
        rtsp_transport: str,
        reconnect_seconds: float,
        interval_seconds: float,
        prompt: str,
        vlm_triton_grpc_url: str,
        vlm_model_name: str,
        jpeg_quality: int,
    ) -> None:
        self.stream_path = stream_path
        self.rtsp_url = rtsp_url
        self.rtsp_transport = rtsp_transport
        self.reconnect_seconds = reconnect_seconds
        self.interval_seconds = interval_seconds
        self.prompt = prompt
        self.vlm_triton_grpc_url = vlm_triton_grpc_url
        self.vlm_model_name = vlm_model_name
        self.jpeg_quality = jpeg_quality

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
        self._source_retry_count = 0
        self._last_error: str | None = None
        self._last_inference_ms: float | None = None
        self._inference_started_ts_ms: float | None = None

    def status(self, configured: bool) -> dict[str, Any]:
        with self._lock:
            latest_frame = self._latest_frame
            return {
                'configured': configured,
                'stream_path': self.stream_path,
                'source_connected': self._source_connected,
                'source_retry_count': self._source_retry_count,
                'rtsp_transport': self.rtsp_transport,
                'interval_seconds': self.interval_seconds,
                'vlm_model_name': self.vlm_model_name,
                'vlm_triton_grpc_url': self.vlm_triton_grpc_url,
                'latest_frame_id': latest_frame.frame_id if latest_frame else None,
                'latest_frame_received_ts_ms': latest_frame.received_ts_ms if latest_frame else None,
                'last_inferred_frame_id': self._last_inferred_frame_id,
                'last_inference_ms': self._last_inference_ms,
                'inference_in_progress': self._inference_started_ts_ms is not None,
                'inference_started_ts_ms': self._inference_started_ts_ms,
                'last_error': self._last_error,
                'websocket_clients': len(self._clients),
            }

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def start(self) -> None:
        if self._reader_thread is not None:
            return

        self._stop_event.clear()
        self._reader_thread = threading.Thread(
            target=self._reader_loop,
            name=f'narration-rtsp-reader-{self.stream_path.replace("/", "-")}',
            daemon=True,
        )
        self._reader_thread.start()
        self._worker_task = asyncio.create_task(
            self._inference_loop(),
            name=f'narration-vlm-worker-{self.stream_path.replace("/", "-")}',
        )

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
            self._inference_started_ts_ms = None

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
                        self._source_retry_count = 0
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
                    self._source_retry_count += 1
                    self._last_error = _redact_rtsp_details(f'{type(exc).__name__}: {exc}')
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
                with self._lock:
                    self._inference_started_ts_ms = inference_started_ts_ms
                try:
                    text = await asyncio.to_thread(self._infer_vlm, latest.rgb)
                    inference_ended_ts_ms = _epoch_ms()
                    inference_ms = round(inference_ended_ts_ms - inference_started_ts_ms, 2)
                    result_send_ts_ms = _epoch_ms()
                    payload: dict[str, Any] = {
                        'type': 'narration',
                        'streamPath': self.stream_path,
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
                    error_message = _redact_rtsp_details(f'{type(exc).__name__}: {exc}')
                    with self._lock:
                        self._last_error = error_message
                    await self._broadcast(
                        {
                            'type': 'narration-error',
                            'streamPath': self.stream_path,
                            'message': error_message,
                        }
                    )
                finally:
                    with self._lock:
                        self._inference_started_ts_ms = None

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

    async def add_client(self, websocket: WebSocket, configured: bool) -> None:
        await websocket.accept()
        self._clients.add(websocket)
        if configured:
            await self.start()
        await websocket.send_json({'type': 'narration-status', **self.status(configured)})
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


class NarrationManager:
    def __init__(self) -> None:
        self.rtsp_base_url = os.getenv('NARRATION_RTSP_BASE_URL', '').strip().rstrip('/')
        self.allowed_path_prefix = os.getenv('NARRATION_ALLOWED_PATH_PREFIX', 'live/').strip()
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
        self._services: dict[str, NarrationStreamService] = {}
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.rtsp_base_url)

    def normalize_stream_path(self, stream_path: str) -> str:
        return _normalize_stream_path(stream_path, self.allowed_path_prefix)

    def _create_service(self, normalized: str) -> NarrationStreamService:
        rtsp_url = f'{self.rtsp_base_url}/{normalized}' if self.rtsp_base_url else ''
        return NarrationStreamService(
            stream_path=normalized,
            rtsp_url=rtsp_url,
            rtsp_transport=self.rtsp_transport,
            reconnect_seconds=self.reconnect_seconds,
            interval_seconds=self.interval_seconds,
            prompt=self.prompt,
            vlm_triton_grpc_url=self.vlm_triton_grpc_url,
            vlm_model_name=self.vlm_model_name,
            jpeg_quality=self.jpeg_quality,
        )

    async def get_or_create(self, stream_path: str) -> NarrationStreamService:
        normalized = self.normalize_stream_path(stream_path)
        async with self._lock:
            service = self._services.get(normalized)
            if service is None:
                service = self._create_service(normalized)
                self._services[normalized] = service
            return service

    async def status(self, stream_path: str) -> dict[str, Any]:
        normalized = self.normalize_stream_path(stream_path)
        async with self._lock:
            service = self._services.get(normalized)
        if service is None:
            service = self._create_service(normalized)
        return service.status(self.configured)

    async def release_if_unused(self, stream_path: str, service: NarrationStreamService) -> None:
        if service.client_count > 0:
            return
        async with self._lock:
            if self._services.get(stream_path) is not service or service.client_count > 0:
                return
            self._services.pop(stream_path, None)
        await service.stop()

    async def shutdown(self) -> None:
        async with self._lock:
            services = list(self._services.values())
            self._services.clear()
        await asyncio.gather(*(service.stop() for service in services), return_exceptions=True)


narration_manager = NarrationManager()


def _stream_path_or_http_400(stream_path: str) -> str:
    try:
        return narration_manager.normalize_stream_path(stream_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/narration/status')
async def narration_status(stream_path: str) -> dict[str, Any]:
    normalized = _stream_path_or_http_400(stream_path)
    return await narration_manager.status(normalized)


@router.websocket('/narration/ws')
async def narration_websocket(websocket: WebSocket, stream_path: str) -> None:
    try:
        normalized = narration_manager.normalize_stream_path(stream_path)
    except ValueError:
        await websocket.close(code=1008, reason='invalid stream_path')
        return

    service = await narration_manager.get_or_create(normalized)
    await service.add_client(websocket, narration_manager.configured)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        service.remove_client(websocket)
        await narration_manager.release_if_unused(normalized, service)
