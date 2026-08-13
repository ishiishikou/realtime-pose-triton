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
const SOURCE_ERROR_THRESHOLD = 3;

const formatTimestamp = (timestampMs: number | null | undefined): string => {
  if (timestampMs === null || timestampMs === undefined) {
    return '-';
  }
  return new Date(timestampMs).toLocaleTimeString();
};

const getPublisherLabel = (status: string): string => {
  switch (status) {
    case 'starting':
      return '接続中';
    case 'running':
      return '配信中';
    case 'stopping':
      return '停止中';
    case 'error':
      return 'エラー';
    default:
      return '停止';
  }
};

export const MediaMtxVlmNarrationPanel = () => {
  const {
    videoRef,
    status,
    latestNarration,
    errorMessage,
    cameraFacingMode,
    isSwitchingCamera,
    switchCamera,
    start,
    stop,
  } = useMediaMtxNarration();
  const [mediaMtxBaseUrl, setMediaMtxBaseUrl] = useState(getDefaultMediaMtxBaseUrl);
  const [streamPath, setStreamPath] = useState(getDefaultMediaMtxStreamPath);
  const [publisherUser, setPublisherUser] = useState(DEFAULT_PUBLISHER_USER);
  const [publisherPassword, setPublisherPassword] = useState(DEFAULT_PUBLISHER_PASSWORD);
  const [runtimeStatus, setRuntimeStatus] = useState<NarrationRuntimeStatus | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(() => window.matchMedia('(min-width: 821px)').matches);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [clockMs, setClockMs] = useState(() => Date.now());

  useEffect(() => {
    const refresh = async () => {
      try {
        const nextStatus = await fetchNarrationStatus(streamPath);
        setRuntimeStatus(nextStatus);
        setRuntimeStatusError(null);
      } catch (error) {
        setRuntimeStatusError(error instanceof Error ? error.message : String(error));
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, 1000);
    return () => window.clearInterval(intervalId);
  }, [streamPath]);

  useEffect(() => {
    if (!runtimeStatus?.inference_in_progress || runtimeStatus.inference_started_ts_ms === null) {
      setClockMs(Date.now());
      return undefined;
    }

    setClockMs(Date.now());
    const intervalId = window.setInterval(() => setClockMs(Date.now()), 250);
    return () => window.clearInterval(intervalId);
  }, [runtimeStatus?.inference_in_progress, runtimeStatus?.inference_started_ts_ms]);

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

  const isRunning = status === 'running';
  const isBusy = status === 'starting' || status === 'stopping';
  const isConfigLocked = isRunning || isBusy;
  const sourceRetryCount = runtimeStatus?.source_retry_count ?? 0;
  const sourceFailed = Boolean(
    isRunning
      && runtimeStatus?.configured
      && !runtimeStatus.source_connected
      && sourceRetryCount >= SOURCE_ERROR_THRESHOLD,
  );
  const sourceConnecting = Boolean(
    isRunning
      && runtimeStatus?.configured
      && !runtimeStatus.source_connected
      && !sourceFailed,
  );
  const sourceLabel = runtimeStatus?.source_connected
    ? '接続中'
    : !runtimeStatus?.configured
      ? '未設定'
      : sourceConnecting
        ? '接続中'
        : sourceFailed
          ? '接続失敗'
          : '待機中';
  const publisherLabel = getPublisherLabel(status);
  const narrationText = latestNarration?.text || 'ナレーション待機中';
  const inferenceLabel = latestNarration ? `${latestNarration.inferenceMs.toFixed(0)} ms` : '-';
  const inferenceElapsedMs = runtimeStatus?.inference_in_progress && runtimeStatus.inference_started_ts_ms !== null
    ? Math.max(0, clockMs - runtimeStatus.inference_started_ts_ms)
    : null;
  const previousInferenceMs = runtimeStatus?.last_inference_ms ?? latestNarration?.inferenceMs ?? null;
  const estimatedRemainingSeconds = inferenceElapsedMs !== null && previousInferenceMs !== null
    ? Math.max(0, Math.ceil((previousInferenceMs - inferenceElapsedMs) / 1000))
    : null;
  const inferenceProgressLabel = runtimeStatus?.inference_in_progress && inferenceElapsedMs !== null
    ? estimatedRemainingSeconds !== null && estimatedRemainingSeconds > 0
      ? `目安あと ${estimatedRemainingSeconds}秒`
      : `推論中 ${(inferenceElapsedMs / 1000).toFixed(0)}秒`
    : null;
  const progressLabel = sourceConnecting
    ? '映像接続中…'
    : inferenceProgressLabel
      ?? (runtimeStatus?.source_connected && !latestNarration ? '推論準備中…' : null);
  const shouldShowBackendError = Boolean(
    runtimeStatus?.last_error
      && (runtimeStatus.source_connected || sourceFailed),
  );
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
    }).catch(() => undefined);
  };

  const handleSessionAction = () => {
    if (isRunning) {
      void stop();
      return;
    }
    handleStart();
  };

  const actionLabel = status === 'starting'
    ? '接続中…'
    : status === 'stopping'
      ? '停止中…'
      : isRunning
        ? '停止'
        : status === 'error'
          ? '再開'
          : '開始';

  const cameraSwitchLabel = isSwitchingCamera
    ? '切替中…'
    : cameraFacingMode === 'environment'
      ? '前面へ'
      : '背面へ';

  return (
    <section className={`pose-card narration-card${focusMode ? ' narration-focus-mode' : ''}`}>
      <div className="pose-header narration-header">
        <div>
          <p className="eyebrow">MediaMTX + RTSP + SmolVLM + Triton</p>
          <h1>リアルタイム映像ナレーション</h1>
          <p className="lead">
            スマートフォンの映像をMediaMTXへWebRTC publishし、RTSPで取得した最新フレームを数秒間隔でVLMへ渡します。
          </p>
        </div>
        <button
          className={`${isRunning ? 'secondary-button' : 'primary-button'} narration-action-button`}
          type="button"
          onClick={handleSessionAction}
          disabled={isBusy}
        >
          {actionLabel}
        </button>
      </div>

      <div className="narration-quick-status" aria-label="接続状態">
        <div className={`narration-status-pill ${status === 'running' ? 'ok' : status === 'error' ? 'error' : 'idle'}`}>
          <span>配信</span>
          <strong>{publisherLabel}</strong>
        </div>
        <div className={`narration-status-pill ${runtimeStatus?.source_connected ? 'ok' : sourceFailed ? 'error' : sourceConnecting ? 'working' : runtimeStatus?.configured ? 'idle' : 'error'}`}>
          <span>RTSP</span>
          <strong>{sourceLabel}</strong>
        </div>
      </div>

      {runtimeStatusError ? <p className="error-text">status: {runtimeStatusError}</p> : null}
      {shouldShowBackendError ? <p className="error-text">backend: {runtimeStatus?.last_error}</p> : null}
      {errorMessage ? <p className="error-text">session: {errorMessage}</p> : null}

      <div className="pose-stage narration-stage">
        <video ref={videoRef} className="pose-video" playsInline muted autoPlay />
        <div className="narration-stage-controls" aria-label="カメラ操作">
          <button
            className="narration-stage-button"
            type="button"
            onClick={() => void switchCamera()}
            disabled={isSwitchingCamera || isBusy}
          >
            {cameraSwitchLabel}
          </button>
          <button
            className="narration-stage-button"
            type="button"
            onClick={() => setFocusMode((current) => !current)}
          >
            {focusMode ? '戻る' : '全画面'}
          </button>
          {focusMode ? (
            <button
              className="narration-stage-button narration-stage-stop"
              type="button"
              onClick={handleSessionAction}
              disabled={isBusy}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
        <div className="narration-overlay" aria-live="polite">
          <div className="narration-overlay-meta">
            <span className="narration-kicker">AI narration</span>
            {progressLabel ? (
              <span className="narration-progress" aria-label={progressLabel}>
                <span className="narration-progress-ring" aria-hidden="true" />
                {progressLabel}
              </span>
            ) : null}
          </div>
          <strong>{narrationText}</strong>
        </div>
      </div>

      <details
        className="narration-disclosure"
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary>
          <span>配信設定</span>
          <small>{streamPath}</small>
        </summary>
        <div className="source-panel narration-source-panel" aria-label="MediaMTX publisher settings">
          <label className="narration-field">
            <span>MediaMTX WebRTC URL</span>
            <input
              type="url"
              value={mediaMtxBaseUrl}
              onChange={(event) => setMediaMtxBaseUrl(event.target.value)}
              disabled={isConfigLocked}
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
              disabled={isConfigLocked}
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
              disabled={isConfigLocked}
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
              disabled={isConfigLocked}
            />
          </label>
          <p className="source-note narration-source-note">
            backendはサーバ側の <code>NARRATION_RTSP_BASE_URL</code> にこのstream pathを連結してMediaMTXを購読します。表示中の認証情報はローカルPoC用example値で、ブラウザ内だけで使用し保存しません。
          </p>
        </div>
      </details>

      <details
        className="narration-disclosure"
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary>
          <span>詳細情報</span>
          <small>{progressLabel ?? (latestNarration ? `VLM ${inferenceLabel}` : '推論待機中')}</small>
        </summary>
        <div className="narration-detail-body">
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
              <span className="status-label">RTSP retries</span>
              <strong>{sourceRetryCount}</strong>
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

          <div className="metrics-grid">
            <p className="note">stream: {runtimeStatus?.stream_path ?? streamPath}</p>
            <p className="note">frame: {latestNarration?.frameId ?? runtimeStatus?.latest_frame_id ?? '-'}</p>
            <p className="note">RTSP received: {formatTimestamp(latestNarration?.rtspReceiveTsMs)}</p>
            <p className="note">VLM inference: {inferenceLabel}</p>
            <p className="note">RTSP receive → result send: {receiveToSendMs === null ? '-' : `${receiveToSendMs.toFixed(0)} ms`}</p>
            <p className="note">last backend inference: {runtimeStatus?.last_inference_ms === null || runtimeStatus?.last_inference_ms === undefined ? '-' : `${runtimeStatus.last_inference_ms.toFixed(0)} ms`}</p>
            <p className="note">result sent: {formatTimestamp(latestNarration?.resultSendTsMs)}</p>
          </div>
        </div>
      </details>
    </section>
  );
};
