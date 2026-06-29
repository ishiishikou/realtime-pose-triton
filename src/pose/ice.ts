export const waitForIceGatheringComplete = async (pc: RTCPeerConnection): Promise<void> => {
  if (pc.iceGatheringState === 'complete') {
    return;
  }

  await new Promise<void>((resolve) => {
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }
    };

    pc.addEventListener('icegatheringstatechange', onStateChange);
  });
};
