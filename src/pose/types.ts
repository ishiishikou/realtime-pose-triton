export type PosePoint = {
  x: number;
  y: number;
  score: number;
};

export type PoseMessage = {
  type: 'pose';
  frameId: number;
  sourceWidth: number;
  sourceHeight: number;
  keypoints: PosePoint[];
  inferenceMs?: number;
};

export type PoseErrorMessage = {
  type: 'pose-error';
  frameId?: number;
  message: string;
};

export type VlmMessage = {
  type: 'vlm';
  frameId: number;
  text: string;
  inferenceMs?: number;
};

export type VlmErrorMessage = {
  type: 'vlm-error';
  frameId?: number;
  message: string;
};

export type PoseDataChannelMessage = PoseMessage | PoseErrorMessage | VlmMessage | VlmErrorMessage;
