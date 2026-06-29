# WebRTC pose architecture

## Target flow

```text
React camera
  -> WebRTC video track
  -> FastAPI aiortc
  -> NumPy RGB frame
  -> Triton request
  -> RTMPose
  -> keypoints JSON
  -> WebRTC data channel
  -> React canvas overlay
```

## CPU development mode

`POSE_MOCK_MODE=1` returns synthetic keypoints without requiring RTMPose.
Set `POSE_MOCK_MODE=0` when RTMPose is ready.

## Optional ONNX download

Set `RTMPOSE_ONNX_URL` to download an ONNX file at Triton startup when the target file does not exist.
The local `models` directory is mounted to `/models`, so downloaded files are kept on the host.

```env
RTMPOSE_ONNX_URL=
RTMPOSE_ONNX_PATH=/models/rtmpose/1/model.onnx
```

## Triton contract

The current backend sends one RGB frame as NHWC UInt8.

```text
input name:  image
shape:       [1, height, width, 3]
datatype:    UINT8
```

Expected output:

```text
output name: keypoints
shape:       [1, K, 3] or [K, 3]
values:      x, y, score
```
