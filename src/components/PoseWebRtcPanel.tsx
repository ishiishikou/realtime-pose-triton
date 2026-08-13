import { useEffect, useMemo, useState, type ChangeEvent } from 'react';

import { fetchPoseStatus, type PoseRuntimeStatus } from '../api/backend';
import { drawPose } from '../pose/drawPose';
import { evaluateHandRaiseChecks, HAND_RAISE_CHECKS, type HandRaiseCheckStatus } from '../pose/handRaiseChecks';
import { usePoseWebRtc, type PoseInputSource } from '../pose/usePoseWebRtc';

type PoseInputMode = PoseInputSource['type'];

const formatTritonStatus = (runtimeStatus: PoseRuntimeStatus | null) => {
  if (!runtimeStatus) {
    return 'unknown';
  }
  if (runtimeStatus.mock_mode) {
    return 'mock';
  }
  if (runtimeStatus.triton?.ok) {
    return 'ready';
  }
  return 'not ready';
};

const createEmptyHandRaiseStatus = (): HandRaiseCheckStatus => ({
  rightOnly: false,
  leftOnly: false,
  bothHands: false,
});

export const PoseWebRtcPanel = () => {
  const {
    videoRef,
    canvasRef,
    latestPose,
    status,
    errorMessage,
    cameraFacingMode,
    isSwitchingCamera,
    switchCamera,
    start,
    stop,
  } = usePoseWebRtc();
  const [runtimeStatus, setRuntimeStatus] = useState<PoseRuntimeStatus | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);
  const [isChecklistOpen, setIsChecklistOpen] = useState(true);
  const [inputMode, setInputMode] = useState<PoseInputMode>('camera');
  const [videoFileUrl, setVideoFileUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [completedHandRaiseChecks, setCompletedHandRaiseChecks] = useState<HandRaiseCheckStatus>(createEmptyHandRaiseStatus);
  const currentHandRaiseChecks = useMemo(() => evaluateHandRaiseChecks(latestPose), [latestPose]);

  useEffect(() => {
    const refresh = async () => {
      try {
        const nextStatus = await fetchPoseStatus();
        setRuntimeStatus(nextStatus);
        setRuntimeStatusError(null);
      } catch (error) {
        setRuntimeStatusError(error instanceof Error ? error.message : String(error));
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, 5000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    return () => {
      if (videoFileUrl) {
        URL.revokeObjectURL(videoFileUrl);
      }
    };
  }, [videoFileUrl]);

  useEffect(() => {
    setCompletedHandRaiseChecks((previousCompletedChecks) => {
      const nextCompletedChecks: HandRaiseCheckStatus = { ...previousCompletedChecks };
      let changed = false;

      for (const check of HAND_RAISE_CHECKS) {
        if (currentHandRaiseChecks[check.id] && !nextCompletedChecks[check.id]) {
          nextCompletedChecks[check.id] = true;
          changed = true;
        }
      }

      return changed ? nextCompletedChecks : previousCompletedChecks;
    });
  }, [currentHandRaiseChecks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
      drawPose(canvas, latestPose);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [canvasRef, latestPose, focusMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      drawPose(canvas, latestPose);
    }
  }, [canvasRef, latestPose]);

  const isRunning = status === 'running';
  const isBusy = status === 'starting' || status === 'stopping';
  const isSessionActive = isRunning || status === 'starting';
  const modeLabel = runtimeStatus?.mock_mode ? 'mock' : 'real';
  const tritonLabel = formatTritonStatus(runtimeStatus);
  const modelIo = runtimeStatus?.model_io;
  const completedHandRaiseCount = HAND_RAISE_CHECKS.filter((check) => completedHandRaiseChecks[check.id]).length;
  const inferenceLabel = latestPose?.inferenceMs !== undefined && latestPose.inferenceMs !== null ? `${latestPose.inferenceMs} ms` : '-';
  const selectedSourceLabel = inputMode === 'camera' ? 'camera' : videoFileName ?? 'video not selected';
  const cameraSwitchLabel = isSwitchingCamera
    ? '切替中…'
    : cameraFacingMode === 'environment'
      ? '前面へ'
      : '背面へ';
  const actionLabel = status === 'starting'
    ? '接続中…'
    : status === 'stopping'
      ? '停止中…'
      : isRunning
        ? '停止'
        : status === 'error'
          ? '再開'
          : '開始';
  const actionDisabled = isBusy || (!isRunning && inputMode === 'video' && !videoFileUrl);

  const handleVideoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setVideoFileUrl(file ? URL.createObjectURL(file) : null);
    setVideoFileName(file?.name ?? null);
  };

  const handleStart = () => {
    if (inputMode === 'video') {
      void start({ type: 'video', url: videoFileUrl ?? '' });
      return;
    }
    void start({ type: 'camera' });
  };

  const handleSessionAction = () => {
    if (isRunning) {
      stop();
      return;
    }
    handleStart();
  };

  const handleInputModeChange = (nextMode: PoseInputMode) => {
    if (status !== 'idle' && status !== 'error') {
      return;
    }
    setInputMode(nextMode);
  };

  return (
    <section className={`pose-card pose-card-pose${focusMode ? ' pose-focus-mode' : ''}`}>
      <div className="pose-header">
        <div>
          <p className="eyebrow">WebRTC + RTMPose + Triton</p>
          <h1>カメラ・動画でポーズ判定</h1>
          <p className="lead">カメラまたは動画ファイルに推論結果と実施状況を重ねて、右手・左手・両手の判定を確認します。</p>
        </div>
        <div className="button-row compact pose-session-controls">
          <button className="primary-button" type="button" onClick={handleStart} disabled={isSessionActive || (inputMode === 'video' && !videoFileUrl)}>開始</button>
          <button className="secondary-button" type="button" onClick={stop} disabled={status === 'idle'}>停止</button>
        </div>
      </div>

      <div className="source-panel" aria-label="input source">
        <div className="source-mode-row" role="group" aria-label="入力モード">
          <button
            className={inputMode === 'camera' ? 'source-mode-button active' : 'source-mode-button'}
            type="button"
            onClick={() => handleInputModeChange('camera')}
            disabled={status !== 'idle' && status !== 'error'}
          >
            カメラ
          </button>
          <button
            className={inputMode === 'video' ? 'source-mode-button active' : 'source-mode-button'}
            type="button"
            onClick={() => handleInputModeChange('video')}
            disabled={status !== 'idle' && status !== 'error'}
          >
            動画
          </button>
        </div>
        {inputMode === 'video' ? (
          <label className="video-file-picker">
            <span>{videoFileName ?? '動画ファイルを選択'}</span>
            <input type="file" accept="video/*" onChange={handleVideoFileChange} disabled={status !== 'idle' && status !== 'error'} />
          </label>
        ) : (
          <>
            <p className="source-note">端末のカメラ映像を入力にします。</p>
            <button
              className="secondary-button pose-camera-switch-button"
              type="button"
              onClick={() => void switchCamera()}
              disabled={isSwitchingCamera || isBusy}
            >
              {cameraSwitchLabel}
            </button>
          </>
        )}
      </div>

      <div className="status-grid" aria-label="runtime status">
        <div className="status-tile">
          <span className="status-label">session</span>
          <strong>{status}</strong>
        </div>
        <div className="status-tile">
          <span className="status-label">source</span>
          <strong>{selectedSourceLabel}</strong>
        </div>
        <div className="status-tile">
          <span className="status-label">mode</span>
          <strong>{modeLabel}</strong>
        </div>
        <div className="status-tile">
          <span className="status-label">triton</span>
          <strong>{tritonLabel}</strong>
        </div>
        <div className="status-tile">
          <span className="status-label">peers</span>
          <strong>{runtimeStatus?.active_peer_connections ?? 0}</strong>
        </div>
      </div>

      <div className="pose-stage pose-stage-pose">
        <video ref={videoRef} src={inputMode === 'video' ? videoFileUrl ?? undefined : undefined} className="pose-video" playsInline muted autoPlay />
        <canvas ref={canvasRef} className="pose-canvas" />

        <div className="pose-stage-controls" aria-label="ポーズ画面操作">
          {focusMode && inputMode === 'camera' ? (
            <button
              className="pose-stage-button"
              type="button"
              onClick={() => void switchCamera()}
              disabled={isSwitchingCamera || isBusy}
            >
              {cameraSwitchLabel}
            </button>
          ) : null}
          <button className="pose-stage-button" type="button" onClick={() => setFocusMode((current) => !current)}>
            {focusMode ? '戻る' : '全画面'}
          </button>
          {focusMode ? (
            <button
              className={`pose-stage-button${isRunning ? ' danger' : ' primary'}`}
              type="button"
              onClick={handleSessionAction}
              disabled={actionDisabled}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>

        <div className="pose-checklist-overlay">
          <button
            className="pose-checklist-summary"
            type="button"
            aria-expanded={isChecklistOpen}
            aria-controls="hand-raise-checklist"
            onClick={() => setIsChecklistOpen((nextOpen) => !nextOpen)}
          >
            <span className="pose-checklist-kicker">実施状況</span>
            <strong>{completedHandRaiseCount}/{HAND_RAISE_CHECKS.length}</strong>
            <span className="pose-checklist-hint">{isChecklistOpen ? 'タップで閉じる' : 'タップで詳細'}</span>
          </button>

          {isChecklistOpen ? (
            <div id="hand-raise-checklist" className="pose-checklist-detail" role="list" aria-label="hand raise checklist">
              {HAND_RAISE_CHECKS.map((check) => {
                const isCompleted = completedHandRaiseChecks[check.id];
                const isDetectedNow = currentHandRaiseChecks[check.id];
                const statusLabel = isCompleted ? 'できた' : isDetectedNow ? '判定中' : '未実施';

                return (
                  <div className={isCompleted ? 'pose-checklist-item done' : 'pose-checklist-item pending'} role="listitem" key={check.id}>
                    <span className="pose-checklist-mark" aria-hidden="true">{isCompleted ? '✓' : '—'}</span>
                    <div>
                      <strong>{check.label}</strong>
                      <span>{statusLabel} / {check.description}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="metrics-grid">
        <p className="note">frame: {latestPose?.frameId ?? '-'}</p>
        <p className="note">keypoints: {latestPose?.keypoints.length ?? '-'}</p>
        <p className="note">inference: {inferenceLabel}</p>
        <p className="note">model: {runtimeStatus?.model_name ?? '-'}</p>
        <p className="note">input: {modelIo ? `${modelIo.input_name} ${modelIo.layout} ${modelIo.input_width}x${modelIo.input_height}` : '-'}</p>
        <p className="note">outputs: {modelIo?.output_names.join(', ') || '-'}</p>
      </div>

      {runtimeStatusError ? <p className="error-text">status: {runtimeStatusError}</p> : null}
      {runtimeStatus?.triton?.error ? <p className="error-text">triton: {runtimeStatus.triton.error}</p> : null}
      {errorMessage ? <p className="error-text">session: {errorMessage}</p> : null}
    </section>
  );
};
