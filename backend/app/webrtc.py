import asyncio
import json
import os
import time
import uuid
from typing import Any

from aiortc import RTCPeerConnection, RTCSessionDescription
from fastapi import APIRouter
from tritonclient.utils import InferenceServerException

from app.pose_triton import run_pose
from app.pose_types import WebRtcOffer
from app.vlm_triton import run_vlm

router = APIRouter()
POSE_TARGET_FPS = float(os.getenv('POSE_TARGET_FPS', '10'))
VLM_TARGET_INTERVAL_SECONDS = float(os.getenv('VLM_TARGET_INTERVAL_SECONDS', '30'))
pcs: set[RTCPeerConnection] = set()


async def close_pc(pc: RTCPeerConnection) -> None:
    pcs.discard(pc)
    await pc.close()


def get_active_peer_count() -> int:
    return len(pcs)


async def _run_vlm_and_send(
    frame_rgb,
    frame_id: int,
    channel_ref: dict[str, Any],
) -> None:
    infer_started_at = time.perf_counter()
    try:
        payload = await asyncio.to_thread(run_vlm, frame_rgb, frame_id)
        payload['inferenceMs'] = round((time.perf_counter() - infer_started_at) * 1000, 2)
    except Exception as exc:
        payload = {
            'type': 'vlm-error',
            'frameId': frame_id,
            'message': f'VLM inference failed: {exc}',
        }

    channel = channel_ref.get('channel')
    if channel and channel.readyState == 'open':
        channel.send(json.dumps(payload))


async def consume_video(track, channel_ref: dict[str, Any]) -> None:
    pose_min_interval = 1.0 / max(POSE_TARGET_FPS, 1.0)
    last_pose_infer_at = 0.0
    last_vlm_infer_at = float('-inf')
    vlm_task: asyncio.Task | None = None
    frame_id = 0

    try:
        while True:
            try:
                frame = await track.recv()
            except Exception:
                return

            now = time.monotonic()
            pose_due = now - last_pose_infer_at >= pose_min_interval
            vlm_due = (
                VLM_TARGET_INTERVAL_SECONDS > 0
                and now - last_vlm_infer_at >= VLM_TARGET_INTERVAL_SECONDS
                and (vlm_task is None or vlm_task.done())
            )
            if not pose_due and not vlm_due:
                continue

            channel = channel_ref.get('channel')
            if not channel or channel.readyState != 'open':
                continue

            frame_id += 1
            frame_rgb = frame.to_ndarray(format='rgb24')

            if vlm_due:
                last_vlm_infer_at = now
                vlm_task = asyncio.create_task(
                    _run_vlm_and_send(frame_rgb.copy(), frame_id, channel_ref)
                )

            if not pose_due:
                continue

            last_pose_infer_at = now
            infer_started_at = time.perf_counter()
            try:
                payload = await asyncio.to_thread(run_pose, frame_rgb, frame_id)
                payload['inferenceMs'] = round((time.perf_counter() - infer_started_at) * 1000, 2)
            except InferenceServerException as exc:
                payload = {'type': 'pose-error', 'frameId': frame_id, 'message': str(exc)}
            except Exception as exc:
                payload = {'type': 'pose-error', 'frameId': frame_id, 'message': f'Pose inference failed: {exc}'}

            channel.send(json.dumps(payload))
    finally:
        if vlm_task and not vlm_task.done():
            vlm_task.cancel()


@router.post('/webrtc/offer')
async def webrtc_offer(offer: WebRtcOffer) -> dict[str, str]:
    pc = RTCPeerConnection()
    pc_id = f'pc-{uuid.uuid4()}'
    channel_ref: dict[str, Any] = {'channel': None}
    pcs.add(pc)

    @pc.on('connectionstatechange')
    async def on_connectionstatechange() -> None:
        if pc.connectionState in {'failed', 'closed', 'disconnected'}:
            await close_pc(pc)

    @pc.on('datachannel')
    def on_datachannel(channel) -> None:
        channel_ref['channel'] = channel

    @pc.on('track')
    def on_track(track) -> None:
        if track.kind == 'video':
            asyncio.create_task(consume_video(track, channel_ref))

    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer.sdp, type=offer.type))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {'id': pc_id, 'sdp': pc.localDescription.sdp, 'type': pc.localDescription.type}


async def shutdown_peer_connections() -> None:
    await asyncio.gather(*(pc.close() for pc in pcs), return_exceptions=True)
    pcs.clear()
