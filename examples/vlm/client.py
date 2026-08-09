#!/usr/bin/env python3

import argparse
import base64
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_URL = "http://localhost:8100/v2/models/smolvlm_256m_cpu/infer"


def build_payload(image_bytes, prompt):
    return {
        "inputs": [
            {
                "name": "IMAGE_BASE64",
                "shape": [1],
                "datatype": "BYTES",
                "data": [base64.b64encode(image_bytes).decode("ascii")],
            },
            {
                "name": "PROMPT",
                "shape": [1],
                "datatype": "BYTES",
                "data": [prompt],
            },
        ],
        "outputs": [{"name": "TEXT"}],
    }


def parse_text(response):
    for output in response.get("outputs", []):
        if output.get("name") == "TEXT":
            data = output.get("data", [])
            if data:
                return data[0]
    raise RuntimeError(f"TEXT output was not found: {response}")


def main():
    parser = argparse.ArgumentParser(
        description="Send one image + prompt to the CPU SmolVLM Triton sample."
    )
    parser.add_argument("image", type=Path, help="Path to a local JPEG/PNG image")
    parser.add_argument(
        "--prompt",
        default="Describe this image in one short sentence.",
        help="Prompt sent with the image (English is recommended).",
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="Triton HTTP infer URL")
    args = parser.parse_args()

    payload = build_payload(args.image.read_bytes(), args.prompt)
    request = Request(
        args.url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=300) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Triton HTTP {exc.code}: {body}") from exc
    except URLError as exc:
        raise SystemExit(f"Could not reach Triton: {exc}") from exc

    print(parse_text(result))


if __name__ == "__main__":
    main()
