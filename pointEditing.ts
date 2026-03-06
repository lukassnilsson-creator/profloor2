import { Point } from './types';
import { findClosestEdge, getDistance, snapToAngle, projectPointOntoSegment } from './geometry';

const MIN_SCALE = 0.0001;

const getSafeScale = (scale: number) => Math.max(scale, MIN_SCALE);

export const getHoverPointIndex = (points: Point[], cursor: Point, scale: number): number | null => {
  const hitRadius = 12 / getSafeScale(scale);
  for (let i = 0; i < points.length; i++) {
    if (getDistance(cursor, points[i]) < hitRadius) return i;
  }
  return null;
};

export const getClosestEdgeInsertIndex = (
  points: Point[],
  cursor: Point,
  scale: number,
  hoverPointIdx: number | null
): number | null => {
  if (points.length < 3 || hoverPointIdx !== null) return null;
  const edge = findClosestEdge(cursor, points);
  return edge.distance < (25 / getSafeScale(scale)) ? edge.index : null;
};

export const snapPointToGrid = (point: Point, snapToGrid: boolean, gridSize: number): Point => {
  if (!snapToGrid) return point;
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize
  };
};

export const addOrInsertPoint = (
  points: Point[],
  cursor: Point,
  closestEdgeIdx: number | null,
  snapToGrid: boolean,
  gridSize: number
): Point[] | null => {
  if (points.length < 3) {
    const snapped = snapPointToGrid(cursor, snapToGrid, gridSize);
    return [...points, snapped];
  }

  if (closestEdgeIdx !== null) {
    const a = points[closestEdgeIdx];
    const b = points[(closestEdgeIdx + 1) % points.length];
    const snapped = projectPointOntoSegment(cursor, a, b);
    const next = [...points];
    next.splice(closestEdgeIdx + 1, 0, snapped);
    return next;
  }

  return null;
};

export const getDraggedPoint = (
  points: Point[],
  draggingIdx: number,
  cursor: Point,
  snapToGrid: boolean,
  gridSize: number,
  snapModifierActive: boolean
): Point => {
  let next = snapPointToGrid(cursor, snapToGrid, gridSize);
  if (snapModifierActive && points.length > 1) {
    const prev = points[(draggingIdx - 1 + points.length) % points.length];
    next = snapToAngle(next, prev);
  }
  return next;
};

export const deletePointAtIndex = (points: Point[], idx: number): Point[] => {
  if (points.length <= 3) return points;
  return points.filter((_, i) => i !== idx);
};

const SNAP_ANGLE_THRESHOLD = 4 * (Math.PI / 180); // 4 degrees in radians
const SNAP_STEP = Math.PI / 2; // 90 degrees

const nearestSnapAngle = (angle: number): number => Math.round(angle / SNAP_STEP) * SNAP_STEP;

const angleDiff = (a: number, b: number): number => {
  let d = ((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
};

/**
 * After releasing a dragged point, snaps it so adjacent edges align to the nearest
 * 45° angle if the current angle is within ±4° of a 45° multiple.
 * Picks the adjacent edge with the smallest angular deviation.
 */
export const snapDraggedPointToAngle = (points: Point[], idx: number): Point[] => {
  if (points.length < 3) return points;
  const n = points.length;
  const p = points[idx];

  let bestDelta = Infinity;
  let bestPos: Point | null = null;

  const trySnap = (anchor: Point, towards: Point) => {
    const angle = Math.atan2(towards.y - anchor.y, towards.x - anchor.x);
    const snapped = nearestSnapAngle(angle);
    if (angleDiff(angle, snapped) > SNAP_ANGLE_THRESHOLD) return;
    const len = getDistance(anchor, towards);
    // Compute where p would land to make the edge exactly snapped.
    // In both cases: new p = anchor + len * direction_from_anchor_to_p (snapped)
    const newP: Point = { x: anchor.x + len * Math.cos(snapped), y: anchor.y + len * Math.sin(snapped) };
    const d = getDistance(p, newP);
    if (d < bestDelta) {
      bestDelta = d;
      bestPos = newP;
    }
  };

  const prev = points[(idx - 1 + n) % n];
  const next = points[(idx + 1) % n];

  trySnap(prev, p);
  trySnap(next, p);

  if (bestPos) {
    const newPoints = [...points];
    newPoints[idx] = bestPos!;
    return newPoints;
  }
  return points;
};

/**
 * On double-click: moves the point so that BOTH adjacent edges become axis-aligned (90° multiples).
 * The new position is the intersection of:
 *   - the line through prev in the nearest 90° direction toward p
 *   - the line through next in the nearest 90° direction toward p
 * Does nothing if both edges are already at 90°, or if the two snapped directions are parallel
 * (no unique intersection).
 */
export const forceSnapPointTo90 = (points: Point[], idx: number): Point[] => {
  if (points.length < 3) return points;
  const n = points.length;
  const p = points[idx];
  const prev = points[(idx - 1 + n) % n];
  const next = points[(idx + 1) % n];

  const anglePrev = Math.atan2(p.y - prev.y, p.x - prev.x);
  const snapPrev = nearestSnapAngle(anglePrev);
  const angleNext = Math.atan2(next.y - p.y, next.x - p.x);
  const snapNext = nearestSnapAngle(angleNext);

  // Nothing to do if both edges are already at 90° multiples
  if (angleDiff(anglePrev, snapPrev) < 0.001 && angleDiff(angleNext, snapNext) < 0.001) {
    return points;
  }

  // Direction from prev toward new point (along snapped prev-edge angle)
  const D1 = { x: Math.cos(snapPrev), y: Math.sin(snapPrev) };
  // Direction from next toward new point (opposite of snapped next-edge angle)
  const D2 = { x: -Math.cos(snapNext), y: -Math.sin(snapNext) };

  // Solve: prev + t*D1 = next + s*D2  →  t*D1 - s*D2 = next - prev
  const denom = D1.x * (-D2.y) - (-D2.x) * D1.y;
  if (Math.abs(denom) < 0.0001) {
    // Parallel — can't satisfy both constraints; do nothing
    return points;
  }
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const t = (dx * (-D2.y) - (-D2.x) * dy) / denom;

  const newPoints = [...points];
  newPoints[idx] = { x: prev.x + t * D1.x, y: prev.y + t * D1.y };
  return newPoints;
};
