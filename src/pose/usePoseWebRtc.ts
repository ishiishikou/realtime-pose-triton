import { useCallback, useEffect, useRef, useState } from 'react';

import { sendWebRtcOffer } from '../api/backend';
import { getCameraStream, SEND_FPS, SEND_HEIGHT, SEND_WIDTH } from './camera';
import { getPeerConnectionConfiguration } from './connectionConfig';
import { waitForIceGatheringComplete } from './ice';
import type { PoseDataChannelMessage, PoseMessage, VlmMessage } from './types';

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
  const [status, setStatus] = useState<PoseSessionStatus>('idle');
  const [latestPose, setLatestPose] = useState<PoseMessage | null>(null);
  const [latestVlm, setLatestVlm] = useState<VlmMessage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [vlmErrorMessage, setVlmErrorMessage] = useState<string | null>(null);

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
    setLatestPose(null);
    setLatestVlm(null);
    setErrorMessage(null);
    setVlmErrorMessage(null);
    setStatus('idle');
  }, []);

  const start = useCallback(async (source: PoseInputSource = { type: 'camera' }) => {
    setStatus('starting');
    setErrorMessage(null);
    setVlmErrorMessage(null);

    try {
      const video = videoRef.current;
      if (!video) {
        throw new Error('video element is not ready');
      }

      if (source.type === 'camera') {
        const cameraStream = await getCameraStream();
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
            setLatestPose(payload);
            setErrorMessage(null);
            return;
          }
          if (payload.type === 'vlm') {
            setLatestVlm(payload);
            setVlmErrorMessage(null);
            return;
          }
          if (payload.type === 'vlm-error') {
            setVlmErrorMessage(payload.message);
            return;
          }
          if (payload.type === 'pose-error') {
            setErrorMessage(payload.message);
          }
        } catch (error) {
          setErrorMessage(error instanceof Error ? `Invalid inference message: ${error.message}` : 'Invalid inference message');
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
    latestVlm,
    status,
    errorMessage,
    vlmErrorMessage,
    start,
    stop,
  };
};
