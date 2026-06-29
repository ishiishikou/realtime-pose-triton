# RTMPose ONNX and checkpoint artifacts

This repository does not commit model weights or exported ONNX artifacts.

There are two different artifact types:

- **Checkpoint URL**: `.pth` file used as the source model for MMDeploy ONNX export.
- **ONNX URL**: direct `.onnx` file or zipped ONNX SDK archive used by the Triton smoke workflow.

Do not use an ONNX SDK zip URL as `checkpoint_url`. The `RTMPose ONNX Export` workflow expects a `.pth` checkpoint URL. The `Triton Smoke` workflow accepts an `.onnx` URL or an ONNX SDK `.zip` URL.

## Recommended Body8 RTMPose artifacts

Use `RTMPose-t 256x192` first because it is the smallest candidate and is suitable for smoke tests.

| Model | Input size | Checkpoint URL for ONNX export | ONNX SDK zip URL for Triton Smoke |
| --- | --- | --- | --- |
| RTMPose-t | 256x192 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.zip` |
| RTMPose-s | 256x192 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-s_simcc-body7_pt-body7_420e-256x192-acd4a1ef_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-s_simcc-body7_pt-body7_420e-256x192-acd4a1ef_20230504.zip` |
| RTMPose-m | 256x192 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip` |
| RTMPose-l | 256x192 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-l_simcc-body7_pt-body7_420e-256x192-4dba18fc_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-l_simcc-body7_pt-body7_420e-256x192-4dba18fc_20230504.zip` |
| RTMPose-m | 384x288 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504.zip` |
| RTMPose-l | 384x288 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-l_simcc-body7_pt-body7_420e-384x288-3f5a1437_20230504.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-l_simcc-body7_pt-body7_420e-384x288-3f5a1437_20230504.zip` |
| RTMPose-x | 384x288 | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.pth` | `https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.zip` |

## Workflow usage

### Triton Smoke

Use the ONNX SDK zip URL as `onnx_url`:

```text
https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.zip
```

The Triton smoke workflow extracts the first `.onnx` from the zip, creates a Triton model repository, and lets Triton autocomplete the ONNX input/output contract.

### RTMPose ONNX Export

Use the checkpoint URL as `checkpoint_url`:

```text
https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.pth
```

ONNX conversion can be done on CPU with MMDeploy by using `--device cpu`.

## Runtime mode

After placing a usable ONNX artifact, disable mock mode:

```env
POSE_MOCK_MODE=0
```

The OpenMMLab ONNX SDK artifact may not match the backend app's current simplified IO contract. The smoke workflow only verifies that Triton can load the ONNX model. Backend integration should inspect the loaded model's actual input/output names and shapes before wiring inference requests.
