export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8080';

export type SessionDescriptionPayload = {
  sdp: string;
  type: RTCSdpType;
};

export type PoseRuntimeStatus = {
  mock_mode: boolean;
  model_name: string;
  model_version: string;
  triton_grpc_url: string;
  input_name_override: string;
  output_name_override: string;
  input_width_fallback: number;
  input_height_fallback: number;
  normalize: boolean;
  active_peer_connections: number;
  triton?: {
    ok: boolean | null;
    server_live?: boolean;
    server_ready?: boolean;
    reason?: string;
    error?: string;
  };
  model_io?: {
    input_name: string;
    input_datatype: string;
    input_width: number;
    input_height: number;
    layout: string;
    output_names: string[];
  };
};

export type NarrationRuntimeStatus = {
  configured: boolean;
  stream_path: string;
  source_connected: boolean;
  source_retry_count: number;
  rtsp_transport: string;
  interval_seconds: number;
  vlm_model_name: string;
  vlm_triton_grpc_url: string;
  latest_frame_id: number | null;
  latest_frame_received_ts_ms: number | null;
  last_inferred_frame_id: number | null;
  last_inference_ms: number | null;
  inference_in_progress: boolean;
  inference_started_ts_ms: number | null;
  last_error: string | null;
  websocket_clients: number;
};

export type NarrationMessage = {
  type: 'narration';
  streamPath: string;
  frameId: number;
  rtspReceiveTsMs: number;
  inferenceStartTsMs: number;
  inferenceEndTsMs: number;
  resultSendTsMs: number;
  inferenceMs: number;
  text: string;
};

export type NarrationErrorMessage = {
  type: 'narration-error';
  streamPath?: string;
  message: string;
};

export type NarrationStatusMessage = NarrationRuntimeStatus & {
  type: 'narration-status';
};

export type NarrationWebSocketMessage = NarrationMessage | NarrationErrorMessage | NarrationStatusMessage;

export const sendWebRtcOffer = async (offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
  const response = await fetch(`${API_BASE_URL}/webrtc/offer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sdp: offer.sdp, type: offer.type }),
  });

  if (!response.ok) {
    throw new Error(`WebRTC offer failed: ${response.status}`);
  }

  const payload = (await response.json()) as SessionDescriptionPayload;
  return { sdp: payload.sdp, type: payload.type };
};

export const fetchPoseStatus = async (): Promise<PoseRuntimeStatus> => {
  const response = await fetch(`${API_BASE_URL}/pose/status`);
  if (!response.ok) {
    throw new Error(`Pose status failed: ${response.status}`);
  }
  return (await response.json()) as PoseRuntimeStatus;
};

export const fetchNarrationStatus = async (streamPath: string): Promise<NarrationRuntimeStatus> => {
  const query = new URLSearchParams({ stream_path: streamPath });
  const response = await fetch(`${API_BASE_URL}/narration/status?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Narration status failed: ${response.status}`);
  }
  return (await response.json()) as NarrationRuntimeStatus;
};

export const getNarrationWebSocketUrl = (streamPath: string): string => {
  const url = new URL(API_BASE_URL, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = url.pathname.replace(/\/$/, '');
  url.pathname = `${basePath}/narration/ws`;
  url.search = new URLSearchParams({ stream_path: streamPath }).toString();
  url.hash = '';
  return url.toString();
};
