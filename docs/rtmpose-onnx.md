# RTMPose ONNX artifact

The repository does not commit ONNX weights.

Use one of these options:

1. Set `RTMPOSE_ONNX_URL` and let the Triton container download the artifact at startup.
2. Copy an already converted ONNX file to `models/rtmpose/1/model.onnx`.
3. Convert an official MMPose checkpoint to ONNX with MMDeploy.

ONNX conversion can be done on CPU with MMDeploy by using `--device cpu`.

## OpenMMLab ONNX SDK zip URLs

The Triton entrypoint accepts either a direct `.onnx` URL or a zipped ONNX SDK archive URL. When the URL ends with `.zip`, the container downloads the archive, unzips it, finds the first `.onnx` file, and copies it to `models/rtmpose/1/model.onnx`.

Recommended first smoke-test URL:

```text
https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.zip
```

Other candidate URLs:

```text
https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-s_simcc-body7_pt-body7_420e-256x192-acd4a1ef_20230504.zip
https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip
https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-l_simcc-body7_pt-body7_420e-256x192-4dba18fc_20230504.zip
```

## Runtime mode

After placing a usable ONNX artifact, disable mock mode:

```env
POSE_MOCK_MODE=0
```

The current simple Triton startup config assumes this contract:

```text
input:  image UINT8 [1, height, width, 3]
output: keypoints FP32 [1, 17, 3]
```

A raw RTMPose ONNX may require preprocess and postprocess models in a Triton ensemble. If Triton fails to load the model, inspect the workflow logs and adjust `POSE_INPUT_NAME`, `POSE_OUTPUT_NAME`, and `config.pbtxt` expectations.
