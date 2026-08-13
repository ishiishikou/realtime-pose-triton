import { useCallback, useEffect, useRef, useState } from 'react';

import { sendWebRtcOffer } from '../api/backend';
import {
  getCameraStream,
  SEND_FPS,
  SEND_HEIGHT,
  SEND_WIDTH,
  type CameraFacingMode,
} from './camera';
import { getPeerConnectionConfiguration } from './connectionConfig';
import { waitForIceGatheringComplete } from './ice';
import type { PoseDataChannelMessage, PoseMessage } from './types';

export type PoseSessionStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export type PoseInputSource =
  | { type: 'camera' }
  | { type: 'video'; url: string };

const parsePoseMessage = (raw: string): PoseDataChannelMessage => JSON.parse(raw) as PoseDataChannelMessage;

export const usePoseWebRtc = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeSourceTypeRef = useRef<PoseInputSource['type'] | null>(null);
  const cameraFacingModeRef = useRef<CameraFacingMode>('environment');
  const [status, setStatus] = useState<PoseSessionStatus>('idle');
  const [latestPose, setLatestPose] = useState<PoseMessage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>('environment');
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);

  const stop = useCallback(() => {
    setStatus('stopping');
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      if (activeSourceTypeRef.current === 'camera') {
        videoRef.current.srcObject = null;
      }
    }
    activeSourceTypeRef.current = null;
    setIsSwitchingCamera(false);
    setLatestPose(null);
    setErrorMessage(null);
    setStatus('idle');
  }, []);

  const switchCamera = useCallback(async () => {
    const previousFacingMode = cameraFacingModeRef.current;
    const nextFacingMode: CameraFacingMode = previousFacingMode === 'environment' ? 'user' : 'environment';
    const video = videoRef.current;
    const previousStream = cameraStreamRef.current;

    if (activeSourceTypeRef.current !== 'camera' || !video || !previousStream) {
      cameraFacingModeRef.current = nextFacingMode;
      setCameraFacingMode(nextFacingMode);
      return;
    }

    setIsSwitchingCamera(true);
    setErrorMessage(null);
    previousStream.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;

    try {
      const nextStream = await getCameraStream(nextFacingMode);
      cameraStreamRef.current = nextStream;
      video.srcObject = nextStream;
      await video.play();
      cameraFacingModeRef.current = nextFacingMode;
      setCameraFacingMode(nextFacingMode);
    } catch (error) {
      try {
        const fallbackStream = await getCameraStream(previousFacingMode);
        cameraStreamRef.current = fallbackStream;
        video.srcObject = fallbackStream;
        await video.play();
      } catch {
        // Preserve the original switching error so the user can stop/restart explicitly.
      }
      setErrorMessage(error instanceof Error ? `カメラ切替に失敗しました: ${error.message}` : 'カメラ切替に失敗しました');
    } finally {
      setIsSwitchingCamera(false);
    }
  }, []);

  const start = useCallback(async (source: PoseInputSource = { type: 'camera' }) => {
    setStatus('starting');
    setErrorMessage(null);

    try {
      const video = videoRef.current;
      if (!video) {
        throw new Error('video element is not ready');
      }

      if (source.type === 'camera') {
        const cameraStream = await getCameraStream(cameraFacingModeRef.current);
        cameraStreamRef.current = cameraStream;
        video.loop = false;
        video.srcObject = cameraStream;
      } else {
        if (!source.url) {
          throw new Error('video file is not selected');
        }
        video.pause();
        video.srcObject = null;
        video.src = source.url;
        video.loop = true;
        video.currentTime = 0;
      }

      activeSourceTypeRef.current = source.type;
      await video.play();

      const sendCanvas = document.createElement('canvas');
      sendCanvas.width = SEND_WIDTH;
      sendCanvas.height = SEND_HEIGHT;
      const context = sendCanvas.getContext('2d');
      if (!context) {
        throw new Error('send canvas context is not ready');
      }

      const drawSendFrame = () => {
        if (video.readyState >= 2) {
          context.drawImage(video, 0, 0, SEND_WIDTH, SEND_HEIGHT);
        }
        animationFrameRef.current = requestAnimationFrame(drawSendFrame);
      };
      drawSendFrame();

      const sendStream = sendCanvas.captureStream(SEND_FPS);
      const peerConnection = new RTCPeerConnection(getPeerConnectionConfiguration());
      peerConnectionRef.current = peerConnection;

      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
          setErrorMessage(null);
          setStatus('running');
          return;
        }
        if (peerConnection.connectionState === 'failed') {
          setStatus('error');
          setErrorMessage('WebRTC connection failed');
          return;
        }
        if (peerConnection.connectionState === 'disconnected') {
          setErrorMessage('WebRTC connection disconnected');
        }
      };

      const channel = peerConnection.createDataChannel('pose');
      channel.onmessage = (event) => {
        try {
          const payload = parsePoseMessage(event.data as string);
          if (payload.type === 'pose') {
            setLatestPose(payload as PoseMessage);
            setErrorMessage(null);
            return;
          }
          if (payload.type === 'pose-error') {
            setErrorMessage('message' in payload ? payload.message : 'Pose inference error');
          }
        } catch (error) {
          setErrorMessage(error instanceof Error ? `Invalid pose message: ${error.message}` : 'Invalid pose message');
        }
      };
      channel.onerror = () => setErrorMessage('Pose DataChannel error');
      channel.onclose = () => {
        if (peerConnection.connectionState !== 'closed') {
          setErrorMessage('Pose DataChannel closed');
        }
      };

      for (const track of sendStream.getVideoTracks()) {
        peerConnection.addTrack(track, sendStream);
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);
      if (!peerConnection.localDescription) {
        throw new Error('local description is not ready');
      }
      const answer = await sendWebRtcOffer(peerConnection.localDescription);
      await peerConnection.setRemoteDescription(answer);
      setStatus('running');
    } catch (error) {
      stop();
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return {
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
  };
};
