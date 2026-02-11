import { Point } from './types';
import { findClosestEdge, getDistance, snapToAngle } from './geometry';

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
    const next = [...points];
    next.splice(closestEdgeIdx + 1, 0, cursor);
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
