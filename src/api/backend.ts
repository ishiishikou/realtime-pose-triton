const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8080';

export type SessionDescriptionPayload = {
  sdp: string;
  type: RTCSdpType;
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
