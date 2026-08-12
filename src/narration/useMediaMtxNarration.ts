import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getNarrationWebSocketUrl,
  type NarrationMessage,
  type NarrationWebSocketMessage,
} from '../api/backend';
import { getCameraStream, SEND_FPS, SEND_HEIGHT, SEND_WIDTH } from '../pose/camera';
import { getPeerConnectionConfiguration } from '../pose/connectionConfig';
import { waitForIceGatheringComplete } from '../pose/ice';

export type MediaMtxNarrationStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export type MediaMtxPublisherOptions = {
  baseUrl: string;
  streamPath: string;
  username: string;
  password: string;
};

export type MediaMtxPublisherStartResult = {
  whipUrl: string;
  streamPath: string;
};

type PerfWindow = Window & {
  __perfPeerConnections?: RTCPeerConnection[];
};

const buildAuthorizationHeader = (username: string, password: string): string | null => {
  if (!username && !password) {
    return null;
  }
  return `Basic ${window.btoa(`${username}:${password}`)}`;
};

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/$/, '');
const normalizeStreamPath = (streamPath: string): string => streamPath.trim().replace(/^\/+|\/+$/g, '');

const parseNarrationMessage = (raw: string): NarrationWebSocketMessage => JSON.parse(raw) as NarrationWebSocketMessage;

const emitPerformanceResult = (payload: NarrationMessage) => {
  window.dispatchEvent(new CustomEvent('perf:inference-result', {
    detail: {
      frame_id: payload.frameId,
      server_receive_ts_ms: payload.rtspReceiveTsMs,
      inference_start_ts_ms: payload.inferenceStartTsMs,
      inference_end_ts_ms: payload.inferenceEndTsMs,
      result_send_ts_ms: payload.resultSendTsMs,
      inference_ms: payload.inferenceMs,
      narration_text: payload.text,
    },
  }));
};

export const getDefaultMediaMtxBaseUrl = (): string => {
  const configured = import.meta.env.VITE_MEDIAMTX_WEBRTC_BASE_URL?.trim().replace(/\/$/, '');
  if (configured) {
    return configured;
  }
  return `${window.location.protocol}//${window.location.hostname}:8889`;
};

export const getDefaultMediaMtxStreamPath = (): string => {
  return import.meta.env.VITE_MEDIAMTX_STREAM_PATH?.trim() || 'live/iphone-001';
};

export const useMediaMtxNarration = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const sendStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const whipResourceUrlRef = useRef<string | null>(null);
  const authorizationHeaderRef = useRef<string | null>(null);

  const [status, setStatus] = useState<MediaMtxNarrationStatus>('idle');
  const [latestNarration, setLatestNarration] = useState<NarrationMessage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const closeWebSocket = useCallback(() => {
    const websocket = websocketRef.current;
    websocketRef.current = null;
    if (websocket && websocket.readyState < WebSocket.CLOSING) {
      websocket.close();
    }
  }, []);

  const stop = useCallback(async () => {
    setStatus('stopping');
    closeWebSocket();

    const resourceUrl = whipResourceUrlRef.current;
    whipResourceUrlRef.current = null;
    if (resourceUrl) {
      const headers: HeadersInit = {};
      if (authorizationHeaderRef.current) {
        headers.Authorization = authorizationHeaderRef.current;
      }
      try {
        await fetch(resourceUrl, { method: 'DELETE', headers });
      } catch {
        // PeerConnection close still terminates the local publisher if WHIP cleanup fails.
      }
    }

    authorizationHeaderRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    sendStreamRef.current?.getTracks().forEach((track) => track.stop());
    sendStreamRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setLatestNarration(null);
    setErrorMessage(null);
    setStatus('idle');
  }, [closeWebSocket]);

  const connectNarrationWebSocket = useCallback((streamPath: string) => {
    closeWebSocket();
    const websocket = new WebSocket(getNarrationWebSocketUrl(streamPath));
    websocketRef.current = websocket;

    websocket.onmessage = (event) => {
      try {
        const payload = parseNarrationMessage(String(event.data));
        if (payload.type === 'narration') {
          setLatestNarration(payload);
          setErrorMessage(null);
          emitPerformanceResult(payload);
          return;
        }
        if (payload.type === 'narration-error') {
          setErrorMessage(payload.message);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? `Invalid narration message: ${error.message}` : 'Invalid narration message');
      }
    };

    websocket.onerror = () => {
      setErrorMessage('Narration WebSocket error');
    };
  }, [closeWebSocket]);

  const start = useCallback(async (options: MediaMtxPublisherOptions): Promise<MediaMtxPublisherStartResult> => {
    if (status !== 'idle' && status !== 'error') {
      throw new Error(`MediaMTX publisher is already active: ${status}`);
    }

    setStatus('starting');
    setLatestNarration(null);
    setErrorMessage(null);

    try {
      const baseUrl = normalizeBaseUrl(options.baseUrl);
      const streamPath = normalizeStreamPath(options.streamPath);
      if (!baseUrl) {
        throw new Error('MediaMTX WebRTC URL is required');
      }
      if (!streamPath) {
        throw new Error('MediaMTX stream path is required');
      }

      const video = videoRef.current;
      if (!video) {
        throw new Error('video element is not ready');
      }

      const cameraStream = await getCameraStream();
      cameraStreamRef.current = cameraStream;
      video.srcObject = cameraStream;
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
      sendStreamRef.current = sendStream;
      const peerConnection = new RTCPeerConnection(getPeerConnectionConfiguration());
      peerConnectionRef.current = peerConnection;
      const perfWindow = window as PerfWindow;
      if (Array.isArray(perfWindow.__perfPeerConnections)) {
        perfWindow.__perfPeerConnections.push(peerConnection);
      }

      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
          setStatus('running');
          return;
        }
        if (peerConnection.connectionState === 'failed') {
          setStatus('error');
          setErrorMessage('MediaMTX WebRTC connection failed');
        }
      };

      for (const track of sendStream.getVideoTracks()) {
        peerConnection.addTrack(track, sendStream);
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);
      if (!peerConnection.localDescription?.sdp) {
        throw new Error('WHIP local description is not ready');
      }

      const authorizationHeader = buildAuthorizationHeader(options.username, options.password);
      authorizationHeaderRef.current = authorizationHeader;
      const headers: HeadersInit = { 'Content-Type': 'application/sdp' };
      if (authorizationHeader) {
        headers.Authorization = authorizationHeader;
      }

      const whipUrl = `${baseUrl}/${streamPath}/whip`;
      const response = await fetch(whipUrl, {
        method: 'POST',
        headers,
        body: peerConnection.localDescription.sdp,
      });
      if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(`MediaMTX WHIP failed: ${response.status}${responseBody ? ` ${responseBody}` : ''}`);
      }

      const answerSdp = await response.text();
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      const resourceLocation = response.headers.get('Location');
      whipResourceUrlRef.current = resourceLocation ? new URL(resourceLocation, whipUrl).toString() : null;

      connectNarrationWebSocket(streamPath);
      setStatus('running');
      return { whipUrl, streamPath };
    } catch (error) {
      await stop();
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [connectNarrationWebSocket, status, stop]);

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return {
    videoRef,
    status,
    latestNarration,
    errorMessage,
    start,
    stop,
  };
};
