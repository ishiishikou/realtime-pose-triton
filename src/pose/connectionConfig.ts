export const getPeerConnectionConfiguration = (): RTCConfiguration => {
  const raw = import.meta.env['VITE_WEBRTC_CONFIG']?.trim();
  if (!raw) {
    return {};
  }

  try {
    return { iceServers: JSON.parse(raw) as RTCIceServer[] };
  } catch {
    return {};
  }
};
