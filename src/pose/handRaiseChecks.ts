import type { PoseMessage, PosePoint } from './types';

const MIN_SCORE = 0.2;
const HEAD_KEYPOINT_INDICES = [0, 1, 2, 3, 4] as const;
const LEFT_WRIST_INDEX = 9;
const RIGHT_WRIST_INDEX = 10;
const HEAD_CLEARANCE_RATIO = 0.06;
const MIN_HEAD_CLEARANCE_PX = 16;

export const HAND_RAISE_CHECKS = [
  {
    id: 'rightOnly',
    label: '右手のみを頭の上より高く上げる',
    description: '右手首だけが推定頭頂ラインより上にある状態',
  },
  {
    id: 'leftOnly',
    label: '左手のみを頭の上より高く上げる',
    description: '左手首だけが推定頭頂ラインより上にある状態',
  },
  {
    id: 'bothHands',
    label: '両手を頭の上より高く上げる',
    description: '左右の手首がどちらも推定頭頂ラインより上にある状態',
  },
] as const;

export type HandRaiseCheckId = (typeof HAND_RAISE_CHECKS)[number]['id'];
export type HandRaiseCheckStatus = Record<HandRaiseCheckId, boolean>;

const emptyStatus = (): HandRaiseCheckStatus => ({
  rightOnly: false,
  leftOnly: false,
  bothHands: false,
});

const isConfidentPoint = (point: PosePoint | undefined): point is PosePoint => Boolean(point && point.score >= MIN_SCORE);

const getHeadTopY = (pose: PoseMessage): number | null => {
  const confidentHeadPoints = HEAD_KEYPOINT_INDICES
    .map((index) => pose.keypoints[index])
    .filter(isConfidentPoint);

  if (confidentHeadPoints.length === 0) {
    return null;
  }

  return Math.min(...confidentHeadPoints.map((point) => point.y));
};

const isWristAboveHead = (pose: PoseMessage, wristIndex: number, headTopY: number): boolean => {
  const wrist = pose.keypoints[wristIndex];
  if (!isConfidentPoint(wrist)) {
    return false;
  }

  const clearancePx = Math.max(MIN_HEAD_CLEARANCE_PX, pose.sourceHeight * HEAD_CLEARANCE_RATIO);
  return wrist.y < headTopY - clearancePx;
};

export const evaluateHandRaiseChecks = (pose: PoseMessage | null): HandRaiseCheckStatus => {
  if (!pose) {
    return emptyStatus();
  }

  const headTopY = getHeadTopY(pose);
  if (headTopY === null) {
    return emptyStatus();
  }

  const leftHandRaised = isWristAboveHead(pose, LEFT_WRIST_INDEX, headTopY);
  const rightHandRaised = isWristAboveHead(pose, RIGHT_WRIST_INDEX, headTopY);

  return {
    rightOnly: rightHandRaised && !leftHandRaised,
    leftOnly: leftHandRaised && !rightHandRaised,
    bothHands: leftHandRaised && rightHandRaised,
  };
};
