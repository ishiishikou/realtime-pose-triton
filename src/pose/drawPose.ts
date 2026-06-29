import { COCO_SKELETON } from './skeleton';
import type { PoseMessage, PosePoint } from './types';

const MIN_SCORE = 0.2;

const scalePoint = (point: PosePoint, pose: PoseMessage, canvas: HTMLCanvasElement) => ({
  x: point.x * (canvas.width / pose.sourceWidth),
  y: point.y * (canvas.height / pose.sourceHeight),
});

export const drawPose = (canvas: HTMLCanvasElement, pose: PoseMessage | null) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!pose) {
    return;
  }

  ctx.lineWidth = Math.max(2, canvas.width * 0.004);
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.92)';
  ctx.fillStyle = 'rgba(253, 224, 71, 0.95)';

  for (const [a, b] of COCO_SKELETON) {
    const p1 = pose.keypoints[a];
    const p2 = pose.keypoints[b];
    if (!p1 || !p2 || p1.score < MIN_SCORE || p2.score < MIN_SCORE) {
      continue;
    }
    const s1 = scalePoint(p1, pose, canvas);
    const s2 = scalePoint(p2, pose, canvas);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
  }

  for (const point of pose.keypoints) {
    if (point.score < MIN_SCORE) {
      continue;
    }
    const scaled = scalePoint(point, pose, canvas);
    ctx.beginPath();
    ctx.arc(scaled.x, scaled.y, Math.max(4, canvas.width * 0.006), 0, Math.PI * 2);
    ctx.fill();
  }
};
