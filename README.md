# realtime-pose-triton

React + WebRTC + FastAPI/aiortc + Triton + RTMPose のリアルタイム姿勢推定SPAです。

## Architecture

```text
React camera preview
  -> downscaled WebRTC video track
  -> FastAPI aiortc
  -> Triton gRPC
  -> RTMPose keypoints
  -> WebRTC DataChannel
  -> React canvas overlay
```

## Features

- Browser camera preview
- 640x360 WebRTC video transmission
- FastAPI + aiortc signaling endpoint
- Triton gRPC inference bridge
- System Shared Memory input for Triton
- Mock pose mode for CPU-only development
- DataChannel pose result streaming
- Canvas keypoint overlay
- Optional ONNX startup download

## Setup

Docker Compose:

```bash
cp .env.example .env
docker compose up --build
```

Local frontend development:

```bash
npm install
cp .env.example .env.local
npm run dev
```

## WebRTC / Triton

The frontend keeps the local camera preview on the device and sends only a downscaled 640x360 stream to the backend. The backend receives frames through WebRTC, converts frames to RGB NumPy arrays, and forwards them to Triton. Pose keypoints are returned through a WebRTC DataChannel.

```bash
docker compose up --build
curl http://localhost:8080/healthz
curl http://localhost:8080/triton/health
```

`POSE_MOCK_MODE=1` lets you verify camera, WebRTC, DataChannel, and Canvas rendering without an RTMPose model. To use a real ONNX artifact, place it at `models/rtmpose/1/model.onnx` or set `RTMPOSE_ONNX_URL`, then switch to `POSE_MOCK_MODE=0`.

See `docs/triton.md` and `docs/rtmpose-onnx.md` for details.

## Development commands

```bash
npm run dev
npm run typecheck
npm run build
npm test
npm run test:local
npm run preview
```
