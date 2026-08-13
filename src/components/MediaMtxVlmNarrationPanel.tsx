import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

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

type NarrationInputMode = 'camera' | 'video';

const DEFAULT_PUBLISHER_USER = import.meta.env.VITE_MEDIAMTX_PUBLISHER_USER?.trim() || 'poc-publisher';
const DEFAULT_PUBLISHER_PASSWORD = import.meta.env.VITE_MEDIAMTX_PUBLISHER_PASSWORD?.trim() || 'poc-publisher-pass';
const SOURCE_ERROR_THRESHOLD = 3;
const PROGRESS_RADIUS = 18;
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RADIUS;

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
  const [inputMode, setInputMode] = useState<NarrationInputMode>('camera');
  const [videoFileUrl, setVideoFileUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [completedFrameId, setCompletedFrameId] = useState<number | null>(null);
  const previousNarrationFrameRef = useRef<number | null>(null);

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
    const intervalId = window.setInterval(() => setClockMs(Date.now()), 200);
    return () => window.clearInterval(intervalId);
  }, [runtimeStatus?.inference_in_progress, runtimeStatus?.inference_started_ts_ms]);

  useEffect(() => {
    const nextFrameId = latestNarration?.frameId ?? null;
    if (nextFrameId === null || previousNarrationFrameRef.current === nextFrameId) {
      return undefined;
    }

    previousNarrationFrameRef.current = nextFrameId;
    setCompletedFrameId(nextFrameId);
    const timeoutId = window.setTimeout(() => setCompletedFrameId(null), 900);
    return () => window.clearTimeout(timeoutId);
  }, [latestNarration?.frameId]);

  useEffect(() => {
    return () => {
      if (videoFileUrl) {
        URL.revokeObjectURL(videoFileUrl);
      }
    };
  }, [videoFileUrl]);

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
        source: { type: 'camera' },
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
  const estimatedProgress = inferenceElapsedMs !== null && previousInferenceMs !== null && previousInferenceMs > 0
    ? Math.min(0.94, inferenceElapsedMs / previousInferenceMs)
    : null;
  const estimatedRemainingSeconds = inferenceElapsedMs !== null && previousInferenceMs !== null
    ? Math.max(0, Math.ceil((previousInferenceMs - inferenceElapsedMs) / 1000))
    : null;
  const inferenceComplete = completedFrameId !== null && completedFrameId === latestNarration?.frameId;
  const inferenceDialogVisible = Boolean(inferenceComplete || runtimeStatus?.inference_in_progress);
  const inferenceDialogProgress = inferenceComplete ? 1 : estimatedProgress;
  const inferenceDialogTitle = inferenceComplete ? 'ナレーション更新' : 'AI推論中';
  const inferenceDialogDetail = inferenceComplete
    ? '推論結果を更新しました'
    : estimatedRemainingSeconds !== null && estimatedRemainingSeconds > 0
      ? `目安あと ${estimatedRemainingSeconds}秒`
      : inferenceElapsedMs !== null && previousInferenceMs !== null
        ? '結果を待っています'
        : inferenceElapsedMs !== null
          ? `経過 ${(inferenceElapsedMs / 1000).toFixed(0)}秒`
          : '';
  const progressLabel = sourceConnecting
    ? '映像接続中…'
    : runtimeStatus?.source_connected && !latestNarration && !runtimeStatus.inference_in_progress
      ? '推論準備中…'
      : null;
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

  const handleVideoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setVideoFileUrl(file ? URL.createObjectURL(file) : null);
    setVideoFileName(file?.name ?? null);
  };

  const handleInputModeChange = (nextMode: NarrationInputMode) => {
    if (isConfigLocked) {
      return;
    }
    setInputMode(nextMode);
  };

  const handleStart = () => {
    void start({
      baseUrl: mediaMtxBaseUrl,
      streamPath,
      username: publisherUser,
      password: publisherPassword,
      source: inputMode === 'video'
        ? { type: 'video', url: videoFileUrl ?? '' }
        : { type: 'camera' },
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

  const actionDisabled = isBusy || (!isRunning && inputMode === 'video' && !videoFileUrl);
  const ringDashOffset = inferenceDialogProgress === null
    ? undefined
    : PROGRESS_CIRCUMFERENCE * (1 - inferenceDialogProgress);

  return (
    <section className={`pose-card narration-card${focusMode ? ' narration-focus-mode' : ''}`}>
      <div className="pose-header narration-header">
        <div>
          <p className="eyebrow">MediaMTX + RTSP + SmolVLM + Triton</p>
          <h1>リアルタイム映像ナレーション</h1>
          <p className="lead">
            スマートフォンのカメラまたは動画をMediaMTXへWebRTC publishし、RTSPで取得した最新フレームをVLMへ渡します。
          </p>
        </div>
        <button
          className={`${isRunning ? 'secondary-button' : 'primary-button'} narration-action-button`}
          type="button"
          onClick={handleSessionAction}
          disabled={actionDisabled}
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

      <div className="narration-input-bar" aria-label="VLM入力">
        <div className="source-mode-row" role="group" aria-label="入力モード">
          <button
            className={inputMode === 'camera' ? 'source-mode-button active' : 'source-mode-button'}
            type="button"
            onClick={() => handleInputModeChange('camera')}
            disabled={isConfigLocked}
          >
            カメラ
          </button>
          <button
            className={inputMode === 'video' ? 'source-mode-button active' : 'source-mode-button'}
            type="button"
            onClick={() => handleInputModeChange('video')}
            disabled={isConfigLocked}
          >
            動画
          </button>
        </div>
        {inputMode === 'video' ? (
          <label className="video-file-picker narration-video-picker">
            <span>{videoFileName ?? '動画ファイルを選択'}</span>
            <input type="file" accept="video/*" onChange={handleVideoFileChange} disabled={isConfigLocked} />
          </label>
        ) : (
          <span className="narration-input-note">{cameraFacingMode === 'environment' ? '背面カメラ' : '前面カメラ'}</span>
        )}
      </div>

      {runtimeStatusError ? <p className="error-text">status: {runtimeStatusError}</p> : null}
      {shouldShowBackendError ? <p className="error-text">backend: {runtimeStatus?.last_error}</p> : null}
      {errorMessage ? <p className="error-text">session: {errorMessage}</p> : null}

      <div className="pose-stage narration-stage">
        <video ref={videoRef} className="pose-video" playsInline muted autoPlay />
        <div className="narration-stage-controls" aria-label="映像操作">
          {inputMode === 'camera' ? (
            <button
              className="narration-stage-button"
              type="button"
              onClick={() => void switchCamera()}
              disabled={isSwitchingCamera || isBusy}
            >
              {cameraSwitchLabel}
            </button>
          ) : null}
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
              disabled={actionDisabled}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>

        {inferenceDialogVisible ? (
          <div className={`narration-inference-dialog${inferenceComplete ? ' complete' : ''}`} role="status" aria-live="polite">
            <svg className={`narration-inference-ring${inferenceDialogProgress === null ? ' indeterminate' : ''}`} viewBox="0 0 44 44" aria-hidden="true">
              <circle className="narration-inference-ring-track" cx="22" cy="22" r={PROGRESS_RADIUS} />
              <circle
                className="narration-inference-ring-value"
                cx="22"
                cy="22"
                r={PROGRESS_RADIUS}
                style={inferenceDialogProgress === null ? undefined : {
                  strokeDasharray: PROGRESS_CIRCUMFERENCE,
                  strokeDashoffset: ringDashOffset,
                }}
              />
            </svg>
            <div>
              <strong>{inferenceDialogTitle}</strong>
              <span>{inferenceDialogDetail}</span>
            </div>
          </div>
        ) : null}

        <div className="narration-overlay" aria-live="polite">
          <div className="narration-overlay-meta">
            <span className="narration-kicker">AI narration</span>
            {progressLabel ? <span className="narration-progress-text">{progressLabel}</span> : null}
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
          <small>{inferenceComplete ? 'ナレーション更新' : runtimeStatus?.inference_in_progress ? inferenceDialogDetail : latestNarration ? `VLM ${inferenceLabel}` : '推論待機中'}</small>
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
            <p className="note">input: {inputMode === 'video' ? videoFileName ?? 'video' : cameraFacingMode === 'environment' ? 'camera rear' : 'camera front'}</p>
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
