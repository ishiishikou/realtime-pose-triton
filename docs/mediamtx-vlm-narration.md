# MediaMTX + SmolVLM リアルタイム映像ナレーション

## 目的

スマートフォンのカメラ映像をブラウザから MediaMTX へ WebRTC / WHIP で publish し、MediaMTX の RTSP 出力を推論バックエンドが購読する。推論バックエンドは最新フレームだけを数秒間隔で SmolVLM / Triton へ渡し、生成された説明文を WebSocket でブラウザへ返して映像上に表示する。

この経路では FastAPI / aiortc は WebRTC の終端に使用しない。WebRTC は MediaMTX が終端し、推論バックエンドは RTSP reader として動作する。

```text
Smartphone browser
  ├─ camera preview
  └─ WebRTC / WHIP
          │
          ▼
       MediaMTX
          │
          │ RTSP
          ▼
  narration backend
    ├─ RTSP reader
    ├─ latest frame only
    └─ every N seconds
          │
          ▼
  SmolVLM / Triton CPU
          │
          │ narration text
          ▼
       WebSocket
          │
          ▼
Smartphone browser overlay
```

既存の `FastAPI / aiortc -> RTMPose -> DataChannel` 経路は別デモとして残す。性能測定対象の MediaMTX / VLM 経路では使用しない。

## 最新フレーム方式

RTSP reader と VLM worker は分離する。

- RTSP reader は映像を継続 decode し、常に最新フレーム1枚だけを保持する
- VLM worker は既定で3秒間隔に最新フレームを読む
- VLM推論中に新しいフレームが到着してもキューへ積まない
- 次回推論では、その時点の最新フレームを使う

VLM推論時間が更新間隔より長い場合でも、古いフレームの推論待ちが積み上がらないことを優先する。

## 設定

主な環境変数:

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `NARRATION_RTSP_URL` | 空 | backendコンテナから到達できるMediaMTX RTSP URL |
| `NARRATION_RTSP_TRANSPORT` | `tcp` | RTSP transport |
| `NARRATION_RTSP_RECONNECT_SECONDS` | `2` | RTSP再接続間隔 |
| `VLM_TRITON_GRPC_URL` | `vlm-triton:8001` | VLM Triton gRPC endpoint |
| `VLM_MODEL_NAME` | `smolvlm_256m_cpu` | Triton model name |
| `VLM_NARRATION_INTERVAL_SECONDS` | `3` | ナレーション更新間隔 |
| `VLM_NARRATION_PROMPT` | 英文1文説明 | VLM prompt |
| `VLM_NARRATION_JPEG_QUALITY` | `80` | Tritonへ送るJPEG品質 |
| `VLM_MAX_NEW_TOKENS` | `24` | VLM生成token上限 |
| `VITE_MEDIAMTX_WEBRTC_BASE_URL` | 空 | ブラウザから見たMediaMTX HTTPS URL。空なら現在のhostの`:8889`を使用 |
| `VITE_MEDIAMTX_STREAM_PATH` | `live/iphone-001` | WHIP publish path |

実RTSP URL、認証情報、実IPアドレスは `.env` / `.env.local` 等のローカル設定へ置き、Gitへ登録しない。

## `mediamtx-playground` と組み合わせるスマートフォン検証

以下は2つのリポジトリをローカルで別Composeとして起動する確認方法。最終的な性能測定では `realtime-inference-benchmark` 側から同一Dockerネットワークへオーケストレーションする想定とする。

### 1. MediaMTXスマートフォン環境を起動

`mediamtx-playground` で以下を実行する。

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$(wslpath -w scripts/smartphone/start.ps1)"
```

PowerShellは停止せず、そのまま起動状態を維持する。

この公開用サンプル構成では次を使用する。

```text
container: mediamtx-smartphone
stream path: live/iphone-001
publisher user: poc-publisher
publisher password: poc-publisher-pass
RTSP reader user: poc-viewer
RTSP reader password: poc-viewer-pass
```

これらは `mediamtx-playground` のローカルPoC用example credentialであり、本番認証情報として使用しない。

### 2. このリポジトリでHTTPS証明書を作る

スマートフォンから到達できるPCのLAN IPを指定する。

```bash
cd ~/realtime-inference-benchmark/components/realtime-pose-triton
bash scripts/create-local-https-cert.sh <PC-LAN-IP>
```

生成される `certs/` はGit管理対象外。

### 3. ローカル設定を作る

`.env.example` をコピーし、実行環境だけで使う `.env` を編集する。

```bash
cp .env.example .env
```

`mediamtx-playground` のexample credentialを使う場合のローカル設定例:

```dotenv
NARRATION_RTSP_URL=rtsp://poc-viewer:poc-viewer-pass@mediamtx-smartphone:8554/live/iphone-001
VITE_MEDIAMTX_STREAM_PATH=live/iphone-001
VLM_NARRATION_INTERVAL_SECONDS=3
VLM_MAX_NEW_TOKENS=24
```

`NARRATION_RTSP_URL` は `.env` のみに置き、commitしない。

### 4. HTTPS UI + backend + VLM Tritonを起動

```bash
COMPOSE_PROJECT_NAME=rtpose-narration \
  docker compose \
    -f docker-compose.https.yml \
    -f docker-compose.narration.yml \
    up -d --build
```

初回は Hugging Face から SmolVLM の設定・processor・quantized ONNX artifactを取得するためインターネット接続が必要。取得物はnamed volumeへキャッシュされる。

### 5. MediaMTXを同じDockerネットワークへ追加

`mediamtx-playground` はRTSPをWindows/LANへ広く公開せず `127.0.0.1` bindにしているため、コンテナ間通信だけを追加する。

```bash
docker network connect rtpose-narration_default mediamtx-smartphone
```

すでに接続済みの場合はDockerがエラーを返すため、その場合はそのまま次へ進む。

backendはRTSP接続に失敗しても再接続を続けるため、Compose起動後にnetwork connectしてよい。

### 6. backend状態を確認

```bash
curl -k https://localhost:5173/api/narration/status | python3 -m json.tool
```

MediaMTXにまだpublishしていない場合は、概ね次の状態になる。

```json
{
  "configured": true,
  "source_connected": false
}
```

実RTSP URLやcredentialはstatusレスポンスに含めない。

### 7. スマートフォンからVLMナレーション画面を開く

スマートフォンでこのリポジトリの `certs/server.crt` を信頼したうえで、次を開く。

```text
https://<PC-LAN-IP>:5173/?mode=narration
```

画面では次を指定する。

```text
MediaMTX WebRTC URL: https://<PC-LAN-IP>:8889
stream path: live/iphone-001
publisher user: poc-publisher
publisher password: poc-publisher-pass
```

MediaMTX側のHTTPS証明書もスマートフォンから信頼済みにしておく。

「開始」を押すと次の順に動作する。

1. スマートフォンのカメラを取得
2. 640x360 / 10fps の送信用映像を作成
3. MediaMTXの `/<path>/whip` へWebRTC publish
4. backendが同じpathをRTSP購読
5. VLMが数秒間隔で最新フレームを説明
6. WebSocketで説明文をブラウザへ返す
7. 映像下部の `AI narration` を更新

### 8. 状態確認

```bash
curl -k https://localhost:5173/api/narration/status | python3 -m json.tool
```

publish後に確認したい項目:

```text
configured            true
source_connected      true
latest_frame_id       増加する
last_inferred_frame_id 更新される
last_inference_ms     数値になる
websocket_clients     1以上
```

ブラウザには `A child is ...` のようなナレーションが表示される。

## 性能測定向けtimestamp

WebSocketの `narration` messageには以下を含める。

```json
{
  "type": "narration",
  "frameId": 123,
  "rtspReceiveTsMs": 0,
  "inferenceStartTsMs": 0,
  "inferenceEndTsMs": 0,
  "resultSendTsMs": 0,
  "inferenceMs": 0,
  "text": "A child is holding a toy."
}
```

現段階で取得できる区間:

```text
RTSP受信 -> VLM開始
VLM開始 -> VLM終了
VLM終了 -> WebSocket送信
RTSP受信 -> WebSocket送信
```

ブラウザ側の受信・描画時刻と、MediaMTXより前の送信時刻は `realtime-inference-benchmark` 統合時に追加し、WebRTC / RTSPの相対比較に使用する。

## 停止

```bash
COMPOSE_PROJECT_NAME=rtpose-narration \
  docker compose \
    -f docker-compose.https.yml \
    -f docker-compose.narration.yml \
    down
```

`mediamtx-playground` 側は起動したPowerShellでEnterを押して停止する。

## セキュリティ

- `NARRATION_RTSP_URL` はAPIレスポンスへ返さない
- RTSP URLは環境変数だけで設定し、ブラウザから任意URLを指定できるAPIは提供しない
- RTSP readerのエラー文字列にcredentialが含まれる場合はマスクしてWebSocket/statusへ返す
- publisher credentialはブラウザの入力値としてのみ扱い、localStorage等へ保存しない
- 実IP、実ホスト名、実カメラURL、実認証情報、証明書、秘密鍵、ログ、キャプチャはpublic repositoryへcommitしない
