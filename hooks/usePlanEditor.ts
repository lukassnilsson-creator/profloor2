import { useEffect, useState } from 'react';
import { Point } from '../types';
import { addOrInsertPoint, deletePointAtIndex, getClosestEdgeInsertIndex, getDraggedPoint, getHoverPointIndex } from '../pointEditing';
import { computeEdgeNormal, translateEdgeInPolygon } from '../geometry';

interface UsePlanEditorOptions {
  points: Point[];
  setPoints: (points: Point[]) => void;
  snapToGrid: boolean;
  gridSize: number;
  interactionScale: number;
  planLocked?: boolean;
}

interface PrimaryDownResult {
  startedDrag: boolean;
  insertedPoint: boolean;
}

interface UsePlanEditorResult {
  hoverIdx: number | null;
  closestEdgeIdx: number | null;
  draggingIdx: number | null;
  draggingEdgeIdx: number | null;
  handlePrimaryDown: (cursor: Point) => PrimaryDownResult;
  handleTouchDown: (cursor: Point) => PrimaryDownResult;
  handlePointerMove: (cursor: Point) => { hoverIdx: number | null; isDragging: boolean };
  handlePointerUp: () => void;
  deletePoint: (idx: number) => Point[];
  clearInteractionState: () => void;
}

const MIN_SCALE = 0.0001;
const MAX_ROOM_SIZE_MM = 18000;

const withinSizeLimit = (pts: Point[]): boolean => {
  if (pts.length === 0) return true;
  let minX = pts[0].x, maxX = pts[0].x;
  let minY = pts[0].y, maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return (maxX - minX) <= MAX_ROOM_SIZE_MM && (maxY - minY) <= MAX_ROOM_SIZE_MM;
};

export const usePlanEditor = ({
  points,
  setPoints,
  snapToGrid,
  gridSize,
  interactionScale,
  planLocked = false
}: UsePlanEditorOptions): UsePlanEditorResult => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [closestEdgeIdx, setClosestEdgeIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [draggingEdgeIdx, setDraggingEdgeIdx] = useState<number | null>(null);
  const [edgeDragState, setEdgeDragState] = useState<{
    startCursor: Point;
    originalPoints: Point[];
    normal: Point;
  } | null>(null);
  const [vertexDragStart, setVertexDragStart] = useState<Point | null>(null);

  useEffect(() => {
    if (draggingIdx !== null && draggingIdx >= points.length) {
      setDraggingIdx(null);
    }
    if (hoverIdx !== null && hoverIdx >= points.length) {
      setHoverIdx(null);
    }
    if (closestEdgeIdx !== null && closestEdgeIdx >= points.length) {
      setClosestEdgeIdx(null);
    }
  }, [points.length, draggingIdx, hoverIdx, closestEdgeIdx]);

  useEffect(() => {
    if (!planLocked) return;
    setDraggingIdx(null);
    setDraggingEdgeIdx(null);
    setEdgeDragState(null);
    setVertexDragStart(null);
    setClosestEdgeIdx(null);
  }, [planLocked]);

  const handlePrimaryDown = (cursor: Point): PrimaryDownResult => {
    if (planLocked) {
      return { startedDrag: false, insertedPoint: false };
    }

    if (hoverIdx !== null) {
      setDraggingIdx(hoverIdx);
      setVertexDragStart(cursor);
      return { startedDrag: true, insertedPoint: false };
    }

    if (closestEdgeIdx !== null && points.length >= 3) {
      const normal = computeEdgeNormal(points, closestEdgeIdx);
      setDraggingEdgeIdx(closestEdgeIdx);
      setEdgeDragState({ startCursor: cursor, originalPoints: [...points], normal });
      return { startedDrag: true, insertedPoint: false };
    }

    // Edge insertion is handled via right-click context menu — pass null to only allow polygon building
    const nextPoints = addOrInsertPoint(points, cursor, null, snapToGrid, gridSize);
    if (nextPoints) {
      setPoints(nextPoints);
      return { startedDrag: false, insertedPoint: true };
    }

    return { startedDrag: false, insertedPoint: false };
  };

  // Touch variant: computes hover state inline (no prior pointermove/hover phase on touch)
  const handleTouchDown = (cursor: Point): PrimaryDownResult => {
    // Points get a generous hit area (×3) — easy to tap corners with a finger
    const safePointScale = Math.max(MIN_SCALE, interactionScale);
    if (planLocked) {
      const immediateHoverIdx = getHoverPointIndex(points, cursor, safePointScale);
      setHoverIdx(immediateHoverIdx);
      setClosestEdgeIdx(null);
      return { startedDrag: false, insertedPoint: false };
    }

    // Edges use a tighter hit area (×1.5) to avoid accidental drags
    const safeEdgeScale = Math.max(MIN_SCALE, interactionScale * 2);

    const immediateHoverIdx = getHoverPointIndex(points, cursor, safePointScale);

    if (immediateHoverIdx !== null) {
      setHoverIdx(immediateHoverIdx);
      setDraggingIdx(immediateHoverIdx);
      setVertexDragStart(cursor);
      return { startedDrag: true, insertedPoint: false };
    }

    if (points.length >= 3) {
      const immediateEdgeIdx = getClosestEdgeInsertIndex(points, cursor, safeEdgeScale, null);
      if (immediateEdgeIdx !== null) {
        const normal = computeEdgeNormal(points, immediateEdgeIdx);
        setClosestEdgeIdx(immediateEdgeIdx);
        setDraggingEdgeIdx(immediateEdgeIdx);
        setEdgeDragState({ startCursor: cursor, originalPoints: [...points], normal });
        return { startedDrag: true, insertedPoint: false };
      }
    }

    // On touch, empty-canvas tap = pan (not add point — use long press context menu instead)
    return { startedDrag: false, insertedPoint: false };
  };

  const handlePointerMove = (cursor: Point) => {
    if (planLocked) {
      const scale = Math.max(MIN_SCALE, interactionScale);
      const nextHoverIdx = getHoverPointIndex(points, cursor, scale);
      setHoverIdx(nextHoverIdx);
      setClosestEdgeIdx(null);
      return { hoverIdx: nextHoverIdx, isDragging: false };
    }

    if (draggingIdx !== null) {
      let constrainedCursor = cursor;
      if (vertexDragStart !== null) {
        const totalDx = Math.abs(cursor.x - vertexDragStart.x);
        const totalDy = Math.abs(cursor.y - vertexDragStart.y);
        if (totalDx >= totalDy) {
          constrainedCursor = { x: cursor.x, y: vertexDragStart.y };
        } else {
          constrainedCursor = { x: vertexDragStart.x, y: cursor.y };
        }
      }
      const nextPoints = [...points];
      nextPoints[draggingIdx] = getDraggedPoint(points, draggingIdx, constrainedCursor, snapToGrid, gridSize, false);
      if (withinSizeLimit(nextPoints)) setPoints(nextPoints);
      return { hoverIdx, isDragging: true };
    }

    if (draggingEdgeIdx !== null && edgeDragState) {
      const delta = { x: cursor.x - edgeDragState.startCursor.x, y: cursor.y - edgeDragState.startCursor.y };
      const t = delta.x * edgeDragState.normal.x + delta.y * edgeDragState.normal.y;
      const nextPoints = translateEdgeInPolygon(edgeDragState.originalPoints, draggingEdgeIdx, t);
      if (withinSizeLimit(nextPoints)) setPoints(nextPoints);
      return { hoverIdx, isDragging: true };
    }

    const scale = Math.max(MIN_SCALE, interactionScale);
    const nextHoverIdx = getHoverPointIndex(points, cursor, scale);
    setHoverIdx(nextHoverIdx);
    setClosestEdgeIdx(getClosestEdgeInsertIndex(points, cursor, scale, nextHoverIdx));
    return { hoverIdx: nextHoverIdx, isDragging: false };
  };

  const handlePointerUp = () => {
    setDraggingIdx(null);
    setDraggingEdgeIdx(null);
    setEdgeDragState(null);
    setVertexDragStart(null);
  };

  const deletePoint = (idx: number): Point[] => {
    const nextPoints = deletePointAtIndex(points, idx);
    if (nextPoints === points) {
      return points;
    }
    setPoints(nextPoints);
    return nextPoints;
  };

  const clearInteractionState = () => {
    setHoverIdx(null);
    setClosestEdgeIdx(null);
    setDraggingIdx(null);
    setDraggingEdgeIdx(null);
    setEdgeDragState(null);
    setVertexDragStart(null);
  };

  return {
    hoverIdx,
    closestEdgeIdx,
    draggingIdx,
    draggingEdgeIdx,
    handlePrimaryDown,
    handleTouchDown,
    handlePointerMove,
    handlePointerUp,
    deletePoint,
    clearInteractionState
  };
};
