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
- Triton model metadata based input/output auto-detection
- RTMPose-style preprocessing and SimCC output decoding
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

The frontend keeps the local camera preview on the device and sends only a downscaled 640x360 stream to the backend. The backend receives frames through WebRTC, converts frames to RGB NumPy arrays, preprocesses them for the loaded Triton model, and forwards inference requests over Triton gRPC. Pose keypoints are returned through a WebRTC DataChannel.

```bash
docker compose up --build
curl http://localhost:8080/healthz
curl http://localhost:8080/triton/health
```

`POSE_MOCK_MODE=1` lets you verify camera, WebRTC, DataChannel, and Canvas rendering without an RTMPose model. To use a real ONNX artifact, place it at `models/rtmpose/1/model.onnx` or set `RTMPOSE_ONNX_URL`, then switch to `POSE_MOCK_MODE=0`.

By default, `POSE_INPUT_NAME` and `POSE_OUTPUT_NAME` are empty so the backend uses Triton model metadata to auto-detect the first model input and all model outputs. Set those variables only when you need to force a specific ONNX contract.

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
