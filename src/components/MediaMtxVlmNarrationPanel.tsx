import { useEffect, useMemo, useState } from 'react';

import { fetchNarrationStatus, type NarrationRuntimeStatus } from '../api/backend';
import {
  getDefaultMediaMtxBaseUrl,
  getDefaultMediaMtxStreamPath,
  useMediaMtxNarration,
} from '../narration/useMediaMtxNarration';

type PerfStartOptions = {
  clientId: string;
  streamPath: string;
  scenarioId: string;
  publishUser?: string;
  publishPass?: string;
  webRtcBase?: string;
};

type PerfWindow = Window & {
  __PERF_START_PUBLISH?: (options: PerfStartOptions) => Promise<Record<string, unknown>>;
};

const DEFAULT_PUBLISHER_USER = import.meta.env.VITE_MEDIAMTX_PUBLISHER_USER?.trim() || 'poc-publisher';
const DEFAULT_PUBLISHER_PASSWORD = import.meta.env.VITE_MEDIAMTX_PUBLISHER_PASSWORD?.trim() || 'poc-publisher-pass';

const formatTimestamp = (timestampMs: number | null | undefined): string => {
  if (timestampMs === null || timestampMs === undefined) {
    return '-';
  }
  return new Date(timestampMs).toLocaleTimeString();
};

export const MediaMtxVlmNarrationPanel = () => {
  const { videoRef, status, latestNarration, errorMessage, start, stop } = useMediaMtxNarration();
  const [mediaMtxBaseUrl, setMediaMtxBaseUrl] = useState(getDefaultMediaMtxBaseUrl);
  const [streamPath, setStreamPath] = useState(getDefaultMediaMtxStreamPath);
  const [publisherUser, setPublisherUser] = useState(DEFAULT_PUBLISHER_USER);
  const [publisherPassword, setPublisherPassword] = useState(DEFAULT_PUBLISHER_PASSWORD);
  const [runtimeStatus, setRuntimeStatus] = useState<NarrationRuntimeStatus | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = async () => {
      try {
        const nextStatus = await fetchNarrationStatus();
        setRuntimeStatus(nextStatus);
        setRuntimeStatusError(null);
      } catch (error) {
        setRuntimeStatusError(error instanceof Error ? error.message : String(error));
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, 2000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const perfWindow = window as PerfWindow;
    perfWindow.__PERF_START_PUBLISH = async (options) => {
      const nextBaseUrl = options.webRtcBase?.trim() || mediaMtxBaseUrl;
      const nextUser = options.publishUser ?? publisherUser;
      const nextPassword = options.publishPass ?? publisherPassword;
      setMediaMtxBaseUrl(nextBaseUrl);
      setStreamPath(options.streamPath);
      setPublisherUser(nextUser);
      setPublisherPassword(nextPassword);

      const result = await start({
        baseUrl: nextBaseUrl,
        streamPath: options.streamPath,
        username: nextUser,
        password: nextPassword,
      });

      return {
        ...result,
        clientId: options.clientId,
        scenarioId: options.scenarioId,
      };
    };

    return () => {
      delete perfWindow.__PERF_START_PUBLISH;
    };
  }, [mediaMtxBaseUrl, publisherPassword, publisherUser, start]);

  const isRunning = status === 'running' || status === 'starting';
  const sourceLabel = runtimeStatus?.source_connected ? 'connected' : runtimeStatus?.configured ? 'waiting' : 'not configured';
  const narrationText = latestNarration?.text || 'ナレーション待機中';
  const inferenceLabel = latestNarration ? `${latestNarration.inferenceMs.toFixed(0)} ms` : '-';
  const receiveToSendMs = useMemo(() => {
    if (!latestNarration) {
      return null;
    }
    return latestNarration.resultSendTsMs - latestNarration.rtspReceiveTsMs;
  }, [latestNarration]);

  const handleStart = () => {
    void start({
      baseUrl: mediaMtxBaseUrl,
      streamPath,
      username: publisherUser,
      password: publisherPassword,
    });
  };

  return (
    <section className="pose-card narration-card">
      <div className="pose-header">
        <div>
          <p className="eyebrow">MediaMTX + RTSP + SmolVLM + Triton</p>
          <h1>リアルタイム映像ナレーション</h1>
          <p className="lead">
            スマートフォンの映像をMediaMTXへWebRTC publishし、RTSPで取得した最新フレームを数秒間隔でVLMへ渡します。
          </p>
        </div>
        <div className="button-row compact">
          <button className="primary-button" type="button" onClick={handleStart} disabled={isRunning}>開始</button>
          <button className="secondary-button" type="button" onClick={() => void stop()} disabled={status === 'idle'}>停止</button>
        </div>
      </div>

      <div className="source-panel narration-source-panel" aria-label="MediaMTX publisher settings">
        <label className="narration-field">
          <span>MediaMTX WebRTC URL</span>
          <input
            type="url"
            value={mediaMtxBaseUrl}
            onChange={(event) => setMediaMtxBaseUrl(event.target.value)}
            disabled={isRunning}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        <label className="narration-field">
          <span>stream path</span>
          <input
            type="text"
            value={streamPath}
            onChange={(event) => setStreamPath(event.target.value)}
            disabled={isRunning}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        <label className="narration-field">
          <span>publisher user</span>
          <input
            type="text"
            value={publisherUser}
            onChange={(event) => setPublisherUser(event.target.value)}
            disabled={isRunning}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        <label className="narration-field">
          <span>publisher password</span>
          <input
            type="password"
            value={publisherPassword}
            onChange={(event) => setPublisherPassword(event.target.value)}
            disabled={isRunning}
          />
        </label>
        <p className="source-note narration-source-note">
          backendの <code>NARRATION_RTSP_URL</code> は、このstream pathと同じMediaMTX pathを参照してください。表示中の認証情報はローカルPoC用example値で、ブラウザ内だけで使用し保存しません。
        </p>
      </div>

      <div className="status-grid" aria-label="narration runtime status">
        <div className="status-tile">
          <span className="status-label">publisher</span>
          <strong>{status}</strong>
        </div>
        <div className="status-tile">
          <span className="status-label">RTSP source</span>
          <strong>{sourceLabel}</strong>
        </div>
        <div className="status-tile">
          <span className="status-label">VLM</span>
          <strong>{runtimeStatus?.vlm_model_name ?? '-'}</strong>
        </div>
        <div className="status-tile">
          <span className="status-label">interval</span>
          <strong>{runtimeStatus ? `${runtimeStatus.interval_seconds}s` : '-'}</strong>
        </div>
        <div className="status-tile">
          <span className="status-label">WS clients</span>
          <strong>{runtimeStatus?.websocket_clients ?? 0}</strong>
        </div>
      </div>

      <div className="pose-stage narration-stage">
        <video ref={videoRef} className="pose-video" playsInline muted autoPlay />
        <div className="narration-overlay" aria-live="polite">
          <span className="narration-kicker">AI narration</span>
          <strong>{narrationText}</strong>
        </div>
      </div>

      <div className="metrics-grid">
        <p className="note">frame: {latestNarration?.frameId ?? runtimeStatus?.latest_frame_id ?? '-'}</p>
        <p className="note">RTSP received: {formatTimestamp(latestNarration?.rtspReceiveTsMs)}</p>
        <p className="note">VLM inference: {inferenceLabel}</p>
        <p className="note">RTSP receive → result send: {receiveToSendMs === null ? '-' : `${receiveToSendMs.toFixed(0)} ms`}</p>
        <p className="note">last backend inference: {runtimeStatus?.last_inference_ms === null || runtimeStatus?.last_inference_ms === undefined ? '-' : `${runtimeStatus.last_inference_ms.toFixed(0)} ms`}</p>
        <p className="note">result sent: {formatTimestamp(latestNarration?.resultSendTsMs)}</p>
      </div>

      {runtimeStatusError ? <p className="error-text">status: {runtimeStatusError}</p> : null}
      {runtimeStatus?.last_error ? <p className="error-text">backend: {runtimeStatus.last_error}</p> : null}
      {errorMessage ? <p className="error-text">session: {errorMessage}</p> : null}
    </section>
  );
};
