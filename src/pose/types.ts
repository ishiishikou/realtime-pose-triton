export type PosePoint = {
  x: number;
  y: number;
  score: number;
};

export type PoseMessage = {
  type: string;
  frameId: number;
  sourceWidth: number;
  sourceHeight: number;
  keypoints: PosePoint[];
};

export type PoseErrorMessage = {
  type: string;
  frameId?: number;
  message: string;
};

export type PoseDataChannelMessage = PoseMessage | PoseErrorMessage;
