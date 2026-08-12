# realtime-pose-triton

React + WebRTC + FastAPI/aiortc + Triton + RTMPose のリアルタイム姿勢推定SPAと、MediaMTX + RTSP + SmolVLM を使った映像ナレーション検証を収録しています。

## Architecture

既存のRTMPoseデモ:

```text
React camera preview
  -> downscaled WebRTC video track
  -> FastAPI aiortc
  -> Triton gRPC
  -> RTMPose keypoints
  -> WebRTC DataChannel
  -> React canvas overlay
```

MediaMTX + VLMナレーション経路:

```text
Smartphone browser
  -> WebRTC / WHIP
  -> MediaMTX
  -> RTSP
  -> narration backend (latest frame only)
  -> SmolVLM / Triton CPU
  -> WebSocket
  -> browser narration overlay
```

VLMナレーション経路ではFastAPI/aiortcをWebRTC終端に使用しません。WebRTCはMediaMTXが終端し、推論バックエンドはRTSP readerとして動作します。

## Features

- Browser camera preview
- 640x360 WebRTC video transmission
- FastAPI + aiortc signaling endpoint
- Triton gRPC inference bridge
- Triton model metadata based input/output auto-detection
- RTMPose-style preprocessing and SimCC output decoding
- Real Triton inference by default
- Optional mock pose mode for CPU-only development
- DataChannel pose result streaming
- Canvas keypoint overlay
- Optional ONNX startup download
- MediaMTX WHIP publisher UI
- MediaMTX RTSP reader for VLM narration
- stream pathごとの独立RTSP reader / WebSocket
- Latest-frame-only VLM scheduling without inference backlog
- SmolVLM narration delivery over WebSocket
- Performance-oriented timestamps for RTSP receive / VLM inference / result send
- `mediamtx-playground` performance runner向けapplication hook

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

Mobile HTTPS testing:

```bash
bash scripts/create-local-https-cert.sh <host-lan-ip>
docker compose -f docker-compose.https.yml up --build
```

Open `https://<host-lan-ip>:5173` from a smartphone on the same network. See `docs/mobile-https.md` for certificate trust steps.

## WebRTC / Triton

The frontend keeps the local camera preview on the device and sends only a downscaled 640x360 stream to the backend. The backend receives frames through WebRTC, converts frames to RGB NumPy arrays, preprocesses them for the loaded Triton model, and forwards inference requests over Triton gRPC. Pose keypoints are returned through a WebRTC DataChannel.

```bash
docker compose up --build
curl http://localhost:8080/healthz
curl http://localhost:8080/triton/health
```

`POSE_MOCK_MODE=0` is the default. To use a real ONNX artifact, place it at `models/rtmpose/1/model.onnx` or set `RTMPOSE_ONNX_URL`.

For camera, WebRTC, DataChannel, and Canvas rendering checks without an RTMPose model, set `POSE_MOCK_MODE=1`.

By default, `POSE_INPUT_NAME` and `POSE_OUTPUT_NAME` are empty so the backend uses Triton model metadata to auto-detect the first model input and all model outputs. Set those variables only when you need to force a specific ONNX contract.

See `docs/triton.md` and `docs/rtmpose-onnx.md` for details.

## CPU-only VLM sample

A separate Triton sample serves `HuggingFaceTB/SmolVLM-256M-Instruct` on CPU using its quantized ONNX artifacts. It does not change the existing pose/WebRTC path.

```bash
docker compose -f docker-compose.vlm-cpu.yml up --build
python3 examples/vlm/client.py ./path/to/image.jpg
```

See `docs/vlm-cpu-triton.md` for startup, CPU tuning, and limitations.

## MediaMTX + VLMリアルタイムナレーション

スマートフォン映像をMediaMTXへWebRTC / WHIPでpublishし、backendが同じstream pathをRTSPで購読します。RTSP readerは映像を継続decodeし、VLM workerは既定で3秒ごとにその時点の最新フレームだけをSmolVLMへ渡します。

VLM推論が更新間隔より遅い場合でも古いフレームをキューへ積まず、次回は最新フレームへ追従します。複数クライアントの性能測定に合わせ、`live/` 配下のstream pathごとにreaderとWebSocketを分離できます。

ナレーション確認用ComposeはRTMPose用Tritonを起動せず、HTTPS web + backend + CPU-only VLM Tritonだけを起動します。

```bash
COMPOSE_PROJECT_NAME=rtpose-narration \
  docker compose -f docker-compose.narration.yml up -d --build
```

スマートフォンから直接ナレーション画面を開く場合:

```text
https://<host-lan-ip>:5173/?mode=narration
```

外部MediaMTXとのDockerネットワーク接続、RTSP設定、スマートフォンでの確認手順、performance runnerとの契約は `docs/mediamtx-vlm-narration.md` を参照してください。

実RTSP base URLや認証情報は `.env` / `.env.local` にのみ置き、public repositoryへ登録しません。

## Development commands

```bash
npm run dev
npm run typecheck
npm run build
npm test
npm run test:local
npm run preview
```
