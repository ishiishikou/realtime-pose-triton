import type { PoseMessage, PosePoint } from './types';

const MIN_FACE_SCORE = 0.2;
const MIN_WRIST_SCORE = 0.1;
const FACE_KEYPOINT_INDICES = [0, 1, 2, 3, 4] as const;
const NOSE_INDEX = 0;
const LEFT_SHOULDER_INDEX = 5;
const RIGHT_SHOULDER_INDEX = 6;
const LEFT_WRIST_INDEX = 9;
const RIGHT_WRIST_INDEX = 10;
const HEAD_TOP_FROM_NOSE_RATIO = 0.35;
const SHOULDER_FALLBACK_HEAD_RATIO = 0.75;
const MIN_HEAD_TOP_OFFSET_PX = 8;
const MAX_HEAD_TOP_OFFSET_PX = 40;
const HEAD_LINE_TOLERANCE_RATIO = 0.025;
const MIN_HEAD_LINE_TOLERANCE_PX = 8;

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

const isConfidentPoint = (point: PosePoint | undefined, minScore: number): point is PosePoint => Boolean(point && point.score >= minScore);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getAverageY = (points: PosePoint[]) => points.reduce((sum, point) => sum + point.y, 0) / points.length;

const getDistance = (a: PosePoint, b: PosePoint) => Math.hypot(a.x - b.x, a.y - b.y);

const estimateHeadLineY = (pose: PoseMessage): number | null => {
  const nose = pose.keypoints[NOSE_INDEX];
  const leftShoulder = pose.keypoints[LEFT_SHOULDER_INDEX];
  const rightShoulder = pose.keypoints[RIGHT_SHOULDER_INDEX];
  const confidentShoulders = [leftShoulder, rightShoulder].filter((point): point is PosePoint => isConfidentPoint(point, MIN_FACE_SCORE));

  if (isConfidentPoint(nose, MIN_FACE_SCORE) && confidentShoulders.length > 0) {
    const shoulderY = getAverageY(confidentShoulders);
    const noseToShoulderY = Math.max(0, shoulderY - nose.y);
    const headTopOffset = clamp(noseToShoulderY * HEAD_TOP_FROM_NOSE_RATIO, MIN_HEAD_TOP_OFFSET_PX, MAX_HEAD_TOP_OFFSET_PX);
    return nose.y - headTopOffset;
  }

  const confidentFacePoints = FACE_KEYPOINT_INDICES
    .map((index) => pose.keypoints[index])
    .filter((point): point is PosePoint => isConfidentPoint(point, MIN_FACE_SCORE));

  if (confidentFacePoints.length > 0) {
    return Math.min(...confidentFacePoints.map((point) => point.y));
  }

  if (isConfidentPoint(leftShoulder, MIN_FACE_SCORE) && isConfidentPoint(rightShoulder, MIN_FACE_SCORE)) {
    const shoulderY = getAverageY([leftShoulder, rightShoulder]);
    const shoulderWidth = getDistance(leftShoulder, rightShoulder);
    return shoulderY - shoulderWidth * SHOULDER_FALLBACK_HEAD_RATIO;
  }

  return null;
};

const isWristAboveHead = (pose: PoseMessage, wristIndex: number, headLineY: number): boolean => {
  const wrist = pose.keypoints[wristIndex];
  if (!isConfidentPoint(wrist, MIN_WRIST_SCORE)) {
    return false;
  }

  const tolerancePx = Math.max(MIN_HEAD_LINE_TOLERANCE_PX, pose.sourceHeight * HEAD_LINE_TOLERANCE_RATIO);
  return wrist.y <= headLineY + tolerancePx;
};

export const evaluateHandRaiseChecks = (pose: PoseMessage | null): HandRaiseCheckStatus => {
  if (!pose) {
    return emptyStatus();
  }

  const headLineY = estimateHeadLineY(pose);
  if (headLineY === null) {
    return emptyStatus();
  }

  const leftHandRaised = isWristAboveHead(pose, LEFT_WRIST_INDEX, headLineY);
  const rightHandRaised = isWristAboveHead(pose, RIGHT_WRIST_INDEX, headLineY);

  return {
    rightOnly: rightHandRaised && !leftHandRaised,
    leftOnly: leftHandRaised && !rightHandRaised,
    bothHands: leftHandRaised && rightHandRaised,
  };
};
