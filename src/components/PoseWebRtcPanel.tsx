import { useEffect } from 'react';

import { drawPose } from '../pose/drawPose';
import { usePoseWebRtc } from '../pose/usePoseWebRtc';

export const PoseWebRtcPanel = () => {
  const { videoRef, canvasRef, latestPose, status, errorMessage, start, stop } = usePoseWebRtc();

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

      <div className="pose-stage">
        <video ref={videoRef} className="pose-video" playsInline muted autoPlay />
        <canvas ref={canvasRef} className="pose-canvas" />
      </div>

      <p className="note">status: {status}</p>
      {latestPose ? <p className="note">frame: {latestPose.frameId} / keypoints: {latestPose.keypoints.length}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
};
