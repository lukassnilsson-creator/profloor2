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
  handlePointerMove: (cursor: Point) => { hoverIdx: number | null; isDragging: boolean };
  handlePointerUp: () => void;
  deletePoint: (idx: number) => Point[];
  clearInteractionState: () => void;
}

const MIN_SCALE = 0.0001;

export const usePlanEditor = ({
  points,
  setPoints,
  snapToGrid,
  gridSize,
  interactionScale
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

  const handlePrimaryDown = (cursor: Point): PrimaryDownResult => {
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

  const handlePointerMove = (cursor: Point) => {
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
      setPoints(nextPoints);
      return { hoverIdx, isDragging: true };
    }

    if (draggingEdgeIdx !== null && edgeDragState) {
      const delta = { x: cursor.x - edgeDragState.startCursor.x, y: cursor.y - edgeDragState.startCursor.y };
      const t = delta.x * edgeDragState.normal.x + delta.y * edgeDragState.normal.y;
      setPoints(translateEdgeInPolygon(edgeDragState.originalPoints, draggingEdgeIdx, t));
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
    handlePointerMove,
    handlePointerUp,
    deletePoint,
    clearInteractionState
  };
};
