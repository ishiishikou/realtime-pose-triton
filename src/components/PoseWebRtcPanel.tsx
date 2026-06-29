import { useEffect, useState } from 'react';

import { fetchPoseStatus, type PoseRuntimeStatus } from '../api/backend';
import { drawPose } from '../pose/drawPose';
import { usePoseWebRtc } from '../pose/usePoseWebRtc';

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

export const PoseWebRtcPanel = () => {
  const { videoRef, canvasRef, latestPose, status, errorMessage, start, stop } = usePoseWebRtc();
  const [runtimeStatus, setRuntimeStatus] = useState<PoseRuntimeStatus | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);

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
  }, [canvasRef, latestPose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      drawPose(canvas, latestPose);
    }
  }, [canvasRef, latestPose]);

  const isRunning = status === 'running' || status === 'starting';
  const modeLabel = runtimeStatus?.mock_mode ? 'mock' : 'real';
  const tritonLabel = formatTritonStatus(runtimeStatus);
  const modelIo = runtimeStatus?.model_io;

  return (
    <section className="pose-card">
      <div className="pose-header">
        <div>
          <p className="eyebrow">WebRTC + RTMPose + Triton</p>
          <h1>Realtime Pose Triton</h1>
          <p className="lead">Camera preview stays local. A downscaled WebRTC stream is sent to the backend for pose inference.</p>
        </div>
        <div className="button-row compact">
          <button className="primary-button" type="button" onClick={start} disabled={isRunning}>Start</button>
          <button className="secondary-button" type="button" onClick={stop} disabled={status === 'idle'}>Stop</button>
        </div>
      </div>

      <div className="status-grid" aria-label="runtime status">
        <div className="status-tile">
          <span className="status-label">session</span>
          <strong>{status}</strong>
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

      <div className="pose-stage">
        <video ref={videoRef} className="pose-video" playsInline muted autoPlay />
        <canvas ref={canvasRef} className="pose-canvas" />
      </div>

      <div className="metrics-grid">
        <p className="note">frame: {latestPose?.frameId ?? '-'}</p>
        <p className="note">keypoints: {latestPose?.keypoints.length ?? '-'}</p>
        <p className="note">inference: {latestPose?.inferenceMs ? `${latestPose.inferenceMs} ms` : '-'}</p>
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
