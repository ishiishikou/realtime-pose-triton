import numpy as np

from app import vlm_triton


class FakeInferInput:
    created = []

    def __init__(self, name, shape, datatype):
        self.name = name
        self.shape = shape
        self.datatype = datatype
        self.data = None
        self.__class__.created.append(self)

    def set_data_from_numpy(self, data):
        self.data = data


class FakeRequestedOutput:
    def __init__(self, name):
        self.name = name


class FakeResult:
    def as_numpy(self, name):
        assert name == 'TEXT'
        return np.array([b'person raising a hand'], dtype=object)


class FakeClient:
    def __init__(self, url):
        assert url == vlm_triton.VLM_TRITON_GRPC_URL

    def infer(self, *, model_name, inputs, outputs):
        assert model_name == vlm_triton.VLM_MODEL_NAME
        assert [item.name for item in inputs] == ['IMAGE_BASE64', 'PROMPT']
        assert [item.name for item in outputs] == ['TEXT']
        return FakeResult()


def test_run_vlm_builds_bytes_inputs_and_text_payload(monkeypatch):
    FakeInferInput.created = []
    monkeypatch.setattr(vlm_triton, '_encode_frame_base64', lambda _frame: 'encoded-image')
    monkeypatch.setattr(vlm_triton.grpcclient, 'InferInput', FakeInferInput)
    monkeypatch.setattr(vlm_triton.grpcclient, 'InferRequestedOutput', FakeRequestedOutput)
    monkeypatch.setattr(vlm_triton.grpcclient, 'InferenceServerClient', FakeClient)

    payload = vlm_triton.run_vlm(np.zeros((8, 8, 3), dtype=np.uint8), frame_id=7)

    assert payload == {
        'type': 'vlm',
        'frameId': 7,
        'text': 'person raising a hand',
    }
    assert all(item.datatype == 'BYTES' for item in FakeInferInput.created)
    assert FakeInferInput.created[0].data.tolist() == [b'encoded-image']
    assert FakeInferInput.created[1].data.tolist() == [vlm_triton.VLM_PROMPT.encode('utf-8')]
