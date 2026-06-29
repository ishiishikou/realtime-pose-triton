# RTMPose ONNX artifact

The repository does not commit ONNX weights.

Use one of these options:

1. Set `RTMPOSE_ONNX_URL` and let the Triton container download the artifact at startup.
2. Copy an already converted ONNX file to `models/rtmpose/1/model.onnx`.
3. Convert an official MMPose checkpoint to ONNX with MMDeploy.

ONNX conversion can be done on CPU with MMDeploy by using `--device cpu`.

After placing a usable ONNX artifact, disable mock mode:

```env
POSE_MOCK_MODE=0
```

The current simple Triton startup config assumes this contract:

```text
input:  image UINT8 [1, height, width, 3]
output: keypoints FP32 [1, 17, 3]
```

A raw RTMPose ONNX may require preprocess and postprocess models in a Triton ensemble.
