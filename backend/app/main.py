import os
from typing import Any, Literal

import tritonclient.grpc as grpcclient
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from tritonclient.utils import InferenceServerException

from app.pose_triton import get_pose_runtime_status
from app.webrtc import get_active_peer_count
from app.webrtc import router as webrtc_router
from app.webrtc import shutdown_peer_connections

TRITON_GRPC_URL = os.getenv('TRITON_GRPC_URL', 'triton:8001')

app = FastAPI(title='realtime-pose-triton backend')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)
app.include_router(webrtc_router)


@app.get('/healthz')
def healthz() -> dict[str, Literal[True]]:
    return {'ok': True}


@app.get('/triton/health')
def triton_health() -> dict[str, Any]:
    try:
        triton = grpcclient.InferenceServerClient(url=TRITON_GRPC_URL)
        server_live = triton.is_server_live()
        server_ready = triton.is_server_ready()
        return {'ok': server_live and server_ready, 'server_live': server_live, 'server_ready': server_ready, 'triton_url': TRITON_GRPC_URL}
    except InferenceServerException as exc:
        return {'ok': False, 'server_live': False, 'server_ready': False, 'triton_url': TRITON_GRPC_URL, 'error': str(exc)}


@app.get('/pose/status')
def pose_status() -> dict[str, Any]:
    return {**get_pose_runtime_status(), 'active_peer_connections': get_active_peer_count()}


@app.on_event('shutdown')
async def on_shutdown() -> None:
    await shutdown_peer_connections()
