from app import pose_triton


class FakeTritonClient:
    def __init__(self, metadata):
        self.metadata = metadata

    def get_model_metadata(self, model_name: str, model_version: str):
        assert model_name == pose_triton.POSE_MODEL_NAME
        assert model_version == pose_triton.POSE_MODEL_VERSION
        return self.metadata


def test_resolve_model_io_from_nchw_metadata():
    pose_triton.reset_model_io_cache()
    client = FakeTritonClient(
        {
            'inputs': [{'name': 'input', 'datatype': 'FP32', 'shape': [1, 3, 256, 192]}],
            'outputs': [
                {'name': 'simcc_x', 'datatype': 'FP32', 'shape': [1, 17, 384]},
                {'name': 'simcc_y', 'datatype': 'FP32', 'shape': [1, 17, 512]},
            ],
        }
    )

    model_io = pose_triton._resolve_model_io(client)

    assert model_io.input_name == 'input'
    assert model_io.input_datatype == 'FP32'
    assert model_io.input_width == 192
    assert model_io.input_height == 256
    assert model_io.layout == 'NCHW'
    assert model_io.output_names == ['simcc_x', 'simcc_y']


def test_resolve_model_io_from_dynamic_nhwc_metadata_uses_fallback_size():
    pose_triton.reset_model_io_cache()
    client = FakeTritonClient(
        {
            'inputs': [{'name': 'image', 'datatype': 'UINT8', 'shape': [1, -1, -1, 3]}],
            'outputs': [{'name': 'keypoints', 'datatype': 'FP32', 'shape': [1, 17, 3]}],
        }
    )

    model_io = pose_triton._resolve_model_io(client)

    assert model_io.input_name == 'image'
    assert model_io.input_datatype == 'UINT8'
    assert model_io.input_width == pose_triton.POSE_INPUT_WIDTH
    assert model_io.input_height == pose_triton.POSE_INPUT_HEIGHT
    assert model_io.layout == 'NHWC'
    assert model_io.output_names == ['keypoints']
