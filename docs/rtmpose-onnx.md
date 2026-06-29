# RTMPose ONNX artifacts

This repository does not commit model weights or exported ONNX artifacts.

The supported CI path is the OpenMMLab ONNX SDK artifact path:

1. Download an official ONNX SDK `.zip` artifact.
2. Extract the first `.onnx` file from the zip.
3. Build a temporary Triton model repository.
4. Verify that Triton can load the ONNX model.

Checkpoint-to-ONNX export from `.pth` is intentionally not covered by this repository's GitHub Actions workflows. The OpenMMLab export stack depends on MMPose, MMDeploy, MMCV, MMDetection, PyTorch, NumPy, and ONNX Runtime versions that are brittle on current GitHub-hosted runners. Use the official ONNX SDK zip for smoke testing and runtime integration.

## Recommended Body8 RTMPose artifacts

Use `RTMPose-t 256x192` first because it is the smallest candidate and is suitable for smoke tests.

| Model | Input size | Checkpoint URL | ONNX SDK zip URL for Triton Smoke |
| --- | --- | --- | --- |
| RTMPose-t | 256x192 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.zip` |
| RTMPose-s | 256x192 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-s_simcc-body7_pt-body7_420e-256x192-acd4a1ef_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-s_simcc-body7_pt-body7_420e-256x192-acd4a1ef_20230504.zip` |
| RTMPose-m | 256x192 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip` |
| RTMPose-l | 256x192 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-l_simcc-body7_pt-body7_420e-256x192-4dba18fc_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-l_simcc-body7_pt-body7_420e-256x192-4dba18fc_20230504.zip` |
| RTMPose-m | 384x288 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504.zip` |
| RTMPose-l | 384x288 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-l_simcc-body7_pt-body7_420e-384x288-3f5a1437_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-l_simcc-body7_pt-body7_420e-384x288-3f5a1437_20230504.zip` |
| RTMPose-x | 384x288 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.zip` |

## Triton Smoke usage

Use the ONNX SDK zip URL as `onnx_url`:

```text
https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.zip
```

The Triton smoke workflow extracts the first `.onnx` from the zip, creates a Triton model repository, and lets Triton autocomplete the ONNX input/output contract.

## Runtime mode

After placing a usable ONNX artifact, disable mock mode:

```env
POSE_MOCK_MODE=0
```

Leave the input/output names empty to resolve them from Triton model metadata:

```env
POSE_INPUT_NAME=
POSE_OUTPUT_NAME=
```

The backend preprocesses camera frames to the model input shape, supports NCHW/NHWC image tensors, and decodes either direct `[x, y, score]` outputs or two-output SimCC-style RTMPose tensors. For dynamic input shapes, set the fallback dimensions explicitly:

```env
POSE_INPUT_WIDTH=192
POSE_INPUT_HEIGHT=256
POSE_NORMALIZE=1
```

The smoke workflow only verifies that Triton can load the ONNX model. Runtime correctness still depends on the exact ONNX artifact contract, preprocessing convention, and output tensor semantics.
