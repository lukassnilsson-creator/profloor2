import { useEffect, useState } from 'react';
import { Point } from '../types';
import { addOrInsertPoint, deletePointAtIndex, getClosestEdgeInsertIndex, getDraggedPoint, getHoverPointIndex } from '../pointEditing';

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
  const [snapModifierActive, setSnapModifierActive] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setSnapModifierActive(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setSnapModifierActive(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

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
      return { startedDrag: true, insertedPoint: false };
    }

    const nextPoints = addOrInsertPoint(points, cursor, closestEdgeIdx, snapToGrid, gridSize);
    if (nextPoints) {
      setPoints(nextPoints);
      return { startedDrag: false, insertedPoint: true };
    }

    return { startedDrag: false, insertedPoint: false };
  };

  const handlePointerMove = (cursor: Point) => {
    if (draggingIdx !== null) {
      const nextPoints = [...points];
      nextPoints[draggingIdx] = getDraggedPoint(points, draggingIdx, cursor, snapToGrid, gridSize, snapModifierActive);
      setPoints(nextPoints);
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
  };

  return {
    hoverIdx,
    closestEdgeIdx,
    draggingIdx,
    handlePrimaryDown,
    handlePointerMove,
    handlePointerUp,
    deletePoint,
    clearInteractionState
  };
};
