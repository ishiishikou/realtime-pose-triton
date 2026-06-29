const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8080';

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
