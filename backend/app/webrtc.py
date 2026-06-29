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

router = APIRouter()
POSE_TARGET_FPS = float(os.getenv('POSE_TARGET_FPS', '10'))
pcs: set[RTCPeerConnection] = set()


async def close_pc(pc: RTCPeerConnection) -> None:
    pcs.discard(pc)
    await pc.close()


def get_active_peer_count() -> int:
    return len(pcs)


async def consume_video(track, channel_ref: dict[str, Any]) -> None:
    min_interval = 1.0 / max(POSE_TARGET_FPS, 1.0)
    last_infer_at = 0.0
    frame_id = 0

    while True:
        try:
            frame = await track.recv()
        except Exception:
            return

        now = time.monotonic()
        if now - last_infer_at < min_interval:
            continue
        last_infer_at = now
        frame_id += 1

        channel = channel_ref.get('channel')
        if not channel or channel.readyState != 'open':
            continue

        frame_rgb = frame.to_ndarray(format='rgb24')
        infer_started_at = time.perf_counter()
        try:
            payload = await asyncio.to_thread(run_pose, frame_rgb, frame_id)
            payload['inferenceMs'] = round((time.perf_counter() - infer_started_at) * 1000, 2)
        except InferenceServerException as exc:
            payload = {'type': 'pose-error', 'frameId': frame_id, 'message': str(exc)}
        except Exception as exc:
            payload = {'type': 'pose-error', 'frameId': frame_id, 'message': f'Pose inference failed: {exc}'}

        channel.send(json.dumps(payload))


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
