from app import main


class FakeTritonClient:
    def __init__(self, url: str):
        self.url = url

    def is_server_live(self) -> bool:
        return True

    def is_server_ready(self) -> bool:
        return False


def test_healthz_returns_ok():
    assert main.healthz() == {'ok': True}


def test_triton_health_uses_configured_client(monkeypatch):
    monkeypatch.setattr(main.grpcclient, 'InferenceServerClient', FakeTritonClient)

    payload = main.triton_health()

    assert payload['ok'] is False
    assert payload['server_live'] is True
    assert payload['server_ready'] is False
    assert payload['triton_url'] == main.TRITON_GRPC_URL
