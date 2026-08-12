# MediaMTX + SmolVLM リアルタイム映像ナレーション

## 目的

スマートフォンのカメラ映像をブラウザから MediaMTX へ WebRTC / WHIP で publish し、MediaMTX の RTSP 出力を推論バックエンドが購読する。推論バックエンドは最新フレームだけを数秒間隔で SmolVLM / Triton へ渡し、生成された説明文を WebSocket でブラウザへ返して映像上に表示する。

この経路では FastAPI / aiortc は WebRTC の終端に使用しない。WebRTC は MediaMTX が終端し、推論バックエンドは RTSP reader として動作する。既存の `FastAPI / aiortc -> RTMPose -> DataChannel` は別デモとして残す。

```text
Smartphone browser
  ├─ camera preview
  └─ WebRTC / WHIP
          │
          ▼
       MediaMTX
          │ RTSP
          ▼
  narration backend
    ├─ RTSP reader / stream path
    ├─ latest frame only
    └─ every N seconds
          │
          ▼
  SmolVLM / Triton CPU
          │ narration text
          ▼
       WebSocket
          │
          ▼
Smartphone browser overlay
```

## 最新フレーム方式

RTSP reader と VLM worker は分離する。

- RTSP reader は映像を継続 decode し、常に最新フレーム1枚だけを保持する
- VLM worker は既定で3秒間隔に最新フレームを読む
- VLM推論中に新しいフレームが到着してもキューへ積まない
- 次回推論では、その時点の最新フレームを使う

VLM推論時間が更新間隔より長い場合でも、古いフレームの推論待ちが積み上がらないことを優先する。

## 複数stream path

性能測定では `live/perf/.../webrtc-001` のようにクライアントごとにMediaMTX pathが変わるため、RTSP URL全体は固定しない。

```text
NARRATION_RTSP_BASE_URL
        +
検証済み stream_path
        ↓
実際に購読する RTSP URL
```

ブラウザから指定できるのは `stream_path` だけで、任意のRTSP URLは指定できない。既定では `live/` 配下だけを許可する。stream pathごとにRTSP reader、最新フレーム、VLM worker、WebSocket client集合を分離する。

## 設定

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `NARRATION_RTSP_BASE_URL` | 空 | backendから見たMediaMTX RTSP base URL。実値はローカル設定のみ |
| `NARRATION_ALLOWED_PATH_PREFIX` | `live/` | ブラウザから指定可能なstream pathのprefix |
| `NARRATION_RTSP_TRANSPORT` | `tcp` | RTSP transport |
| `NARRATION_RTSP_RECONNECT_SECONDS` | `2` | RTSP再接続間隔 |
| `VLM_TRITON_GRPC_URL` | `vlm-triton:8001` | VLM Triton gRPC endpoint |
| `VLM_MODEL_NAME` | `smolvlm_256m_cpu` | Triton model name |
| `VLM_NARRATION_INTERVAL_SECONDS` | `3` | ナレーション更新間隔 |
| `VLM_NARRATION_PROMPT` | 英文1文説明 | VLM prompt |
| `VLM_NARRATION_JPEG_QUALITY` | `80` | Tritonへ送るJPEG品質 |
| `VLM_MAX_NEW_TOKENS` | `24` | VLM生成token上限 |
| `VITE_MEDIAMTX_WEBRTC_BASE_URL` | 空 | ブラウザから見たMediaMTX HTTPS URL。空なら現在のhostの`:8889` |
| `VITE_MEDIAMTX_STREAM_PATH` | `live/iphone-001` | 手動確認時のWHIP publish path |

実RTSP base URL、実認証情報、実IPアドレスは `.env` / `.env.local` 等へ置き、Gitへ登録しない。

## `mediamtx-playground` と組み合わせるスマートフォン検証

最終的な性能測定では `realtime-inference-benchmark` 側から両リポジトリをオーケストレーションする。ここでは2つのComposeをローカルで接続して機能確認する。

### 1. MediaMTXスマートフォン環境を起動

`mediamtx-playground` で実行する。

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$(wslpath -w scripts/smartphone/start.ps1)"
```

PowerShellは停止せず、そのまま起動状態を維持する。公開用サンプル構成では次のexample値を使用する。

```text
container: mediamtx-smartphone
stream path: live/iphone-001
publisher user: poc-publisher
publisher password: poc-publisher-pass
RTSP reader user: poc-viewer
RTSP reader password: poc-viewer-pass
```

これらはローカルPoC用example credentialであり、本番認証情報として使用しない。

### 2. このリポジトリでHTTPS証明書を作る

```bash
bash scripts/create-local-https-cert.sh <PC-LAN-IP>
```

生成される `certs/` はGit管理対象外。

### 3. ローカル設定を作る

```bash
cp .env.example .env
```

`mediamtx-playground` のexample credentialを使うローカル設定例:

```dotenv
NARRATION_RTSP_BASE_URL=rtsp://poc-viewer:poc-viewer-pass@mediamtx-smartphone:8554
NARRATION_ALLOWED_PATH_PREFIX=live/
VITE_MEDIAMTX_STREAM_PATH=live/iphone-001
VLM_NARRATION_INTERVAL_SECONDS=3
VLM_MAX_NEW_TOKENS=24
```

`NARRATION_RTSP_BASE_URL` は `.env` のみに置き、commitしない。

### 4. HTTPS UI + backend + VLM Tritonを起動

ナレーション用ComposeはRTMPose用Tritonを起動しない。

```bash
COMPOSE_PROJECT_NAME=rtpose-narration \
  docker compose -f docker-compose.narration.yml up -d --build
```

初回は Hugging Face から SmolVLM の設定・processor・quantized ONNX artifactを取得するためインターネット接続が必要。取得物はnamed volumeへキャッシュされる。

### 5. MediaMTXを同じDockerネットワークへ追加

`mediamtx-playground` はRTSPをWindows/LANへ広く公開せず `127.0.0.1` bindにしているため、コンテナ間通信だけを追加する。

```bash
docker network connect rtpose-narration_default mediamtx-smartphone
```

すでに接続済みならそのまま次へ進む。backendはRTSP接続失敗時に再接続するため、Compose起動後にnetwork connectしてよい。

### 6. backend状態を確認

```bash
curl -kG \
  --data-urlencode 'stream_path=live/iphone-001' \
  https://localhost:5173/api/narration/status \
  | python3 -m json.tool
```

publish前は概ね次の状態になる。

```json
{
  "configured": true,
  "stream_path": "live/iphone-001",
  "source_connected": false
}
```

実RTSP URLやcredentialはstatusレスポンスに含めない。

### 7. スマートフォンから開く

このリポジトリの `certs/server.crt` とMediaMTX側のHTTPS証明書をスマートフォンで信頼したうえで開く。

```text
https://<PC-LAN-IP>:5173/?mode=narration
```

画面のexample値:

```text
MediaMTX WebRTC URL: https://<PC-LAN-IP>:8889
stream path: live/iphone-001
publisher user: poc-publisher
publisher password: poc-publisher-pass
```

「開始」で次の順に動作する。

1. スマートフォンのカメラを取得
2. 640x360 / 10fps の送信用映像を作成
3. MediaMTXの `/<path>/whip` へWebRTC publish
4. 同じstream pathを指定してbackend WebSocketへ接続
5. backendがRTSP base URL + stream pathでMediaMTXを購読
6. VLMが数秒間隔で最新フレームを説明
7. WebSocketで説明文を返す
8. 映像下部の `AI narration` を更新

### 8. publish後の状態確認

```bash
curl -kG \
  --data-urlencode 'stream_path=live/iphone-001' \
  https://localhost:5173/api/narration/status \
  | python3 -m json.tool
```

確認項目:

```text
configured             true
source_connected       true
stream_path             live/iphone-001
latest_frame_id        増加する
last_inferred_frame_id  更新される
last_inference_ms       数値になる
websocket_clients       1以上
```

## 性能測定との接続

`mediamtx-playground/scripts/performance/webrtc-publisher.mjs` のapplication-hook modeに合わせ、VLMナレーション画面は次を公開する。

```text
window.__PERF_START_PUBLISH(options)
```

runnerが渡す `streamPath` をWHIP publish先とbackendのRTSP購読pathの両方に利用する。複数クライアントはそれぞれ別pathを使える。RTCPeerConnectionはrunnerの `window.__perfPeerConnections` に登録し、WebRTC stats採取にも利用できる。

ナレーション受信時は次を発火する。

```text
perf:inference-result
```

イベントdetail:

```text
frame_id
server_receive_ts_ms
inference_start_ts_ms
inference_end_ts_ms
result_send_ts_ms
inference_ms
narration_text
```

runner側がブラウザ受信時刻と `requestAnimationFrame` 後の描画時刻を追加するため、RTSP受信以降は次を測定できる。

```text
RTSP受信 -> VLM開始
VLM開始 -> VLM終了
VLM終了 -> WebSocket送信
WebSocket送信 -> Browser受信/描画
RTSP受信 -> Browser描画
```

ブラウザからMediaMTXへ送信した個別フレームとRTSPでdecodeしたフレームは現時点では同じIDで相関できない。そのため `source_ts_ms` とMediaMTX受信時刻の厳密な対応付けは後続の `realtime-inference-benchmark` 統合で追加する。

## WebSocket message

```json
{
  "type": "narration",
  "streamPath": "live/iphone-001",
  "frameId": 123,
  "rtspReceiveTsMs": 0,
  "inferenceStartTsMs": 0,
  "inferenceEndTsMs": 0,
  "resultSendTsMs": 0,
  "inferenceMs": 0,
  "text": "A child is holding a toy."
}
```

## 停止

```bash
COMPOSE_PROJECT_NAME=rtpose-narration \
  docker compose -f docker-compose.narration.yml down
```

`mediamtx-playground` 側は起動したPowerShellでEnterを押して停止する。

## セキュリティ

- `NARRATION_RTSP_BASE_URL` はAPIレスポンスへ返さない
- RTSP base URLはサーバ側環境変数だけで設定する
- ブラウザから任意RTSP URLを指定するAPIは提供しない
- stream pathは文字種・path segment・`NARRATION_ALLOWED_PATH_PREFIX`を検証する
- RTSP readerのエラー文字列にcredentialが含まれる場合はマスクする
- publisher credentialはブラウザ内だけで使用し、localStorage等へ保存しない
- `poc-*` credentialは既存 `mediamtx-playground` と合わせた公開用ローカルPoC example値であり、本番利用しない
- 実IP、実ホスト名、実カメラURL、実認証情報、証明書、秘密鍵、ログ、キャプチャはpublic repositoryへcommitしない
