export const SEND_WIDTH = 640;
export const SEND_HEIGHT = 360;
export const SEND_FPS = 10;

export const getCameraStream = async (): Promise<MediaStream> => {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      facingMode: { ideal: 'environment' },
    },
  });
};
