import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Point, PlankSettings, PlankInstance, WastePiece, ImportedDrawingBackground } from '../types';
import { findClosestEdge, getDistance, movePointByLength, isPointInPolygon } from '../geometry';
import { getHoverPointIndex } from '../pointEditing';
import { usePlanEditor } from '../hooks/usePlanEditor';

interface CanvasProps {
  points: Point[];
  setPoints: (pts: Point[]) => void;
  settings: PlankSettings;
  setSettings: (s: PlankSettings) => void;
  planks: PlankInstance[];
  wastePieces: WastePiece[];
  scale: number;
  setScale: (scale: number) => void;
  offset: { x: number; y: number };
  setOffset: (off: { x: number; y: number }) => void;
  showEdgeLengths: boolean;
  gridSize: number;
  snapToGrid: boolean;
  onToggleSnapToGrid: () => void;
  onToggleEdgeLengths: () => void;
  onRequestHistorySnapshot: () => void;
  backgroundDrawing: ImportedDrawingBackground | null;
  showBackgroundDrawing: boolean;
  backgroundOpacity: number;
  onToggleBackgroundDrawing: () => void;
  onBackgroundOpacityChange: (opacity: number) => void;
  onRemoveBackgroundDrawing: () => void;
  onZoomExtents: () => void;
  showFloatingToolPanel?: boolean;
}

interface PointContextMenu {
  kind: 'point';
  x: number;
  y: number;
  pointIdx: number;
}

interface CanvasContextMenu {
  kind: 'canvas';
  x: number;
  y: number;
}

type ContextMenu = PointContextMenu | CanvasContextMenu;

interface GestureLikeEvent extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

interface ToolPanelDragState {
  startClientX: number;
  startClientY: number;
  startOffsetX: number;
  startOffsetY: number;
}

const TOOL_PANEL_STORAGE_KEY = 'profloor.canvas-controls-offset';
const TOOL_PANEL_MARGIN = 24;
const TOOL_PANEL_MIN_MARGIN = 8;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;
const GESTURE_ZOOM_GAIN = 1.12;
const EDGE_HIT_TOLERANCE_PX = 25;

const loadToolPanelOffset = () => {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  try {
    const raw = localStorage.getItem(TOOL_PANEL_STORAGE_KEY);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore malformed values
  }
  return { x: 0, y: 0 };
};

const Canvas: React.FC<CanvasProps> = ({
  points,
  setPoints,
  settings,
  setSettings,
  planks,
  wastePieces,
  scale,
  setScale,
  offset,
  setOffset,
  showEdgeLengths,
  gridSize,
  snapToGrid,
  onToggleSnapToGrid,
  onToggleEdgeLengths,
  onRequestHistorySnapshot,
  backgroundDrawing,
  showBackgroundDrawing,
  backgroundOpacity,
  onToggleBackgroundDrawing,
  onBackgroundOpacityChange,
  onRemoveBackgroundDrawing,
  onZoomExtents,
  showFloatingToolPanel = true
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolPanelRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);
  const gestureScaleRef = useRef<number | null>(null);
  const toolPanelDragRef = useRef<ToolPanelDragState | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const [backgroundImageVersion, setBackgroundImageVersion] = useState(0);
  const [hoverPlank, setHoverPlank] = useState<PlankInstance | null>(null);
  const [hoverWastePieceIdx, setHoverWastePieceIdx] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);
  const [toolPanelOffset, setToolPanelOffset] = useState(loadToolPanelOffset);

  // Kährs palette
  const factoryColor = { r: 210, g: 183, b: 172 };
  const cutColorBase = { r: 245, g: 241, b: 239 };

  useEffect(() => {
    scaleRef.current = scale;
    offsetRef.current = offset;
  }, [scale, offset]);

  useEffect(() => {
    if (!backgroundDrawing?.src) {
      backgroundImageRef.current = null;
      return;
    }

    const image = new Image();
    image.onload = () => {
      backgroundImageRef.current = image;
      setBackgroundImageVersion((prev) => prev + 1);
    };
    image.src = backgroundDrawing.src;
  }, [backgroundDrawing?.src]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(TOOL_PANEL_STORAGE_KEY, JSON.stringify(toolPanelOffset));
    } catch {
      // ignore storage errors
    }
  }, [toolPanelOffset]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  const clampToolPanelOffset = useCallback((candidate: { x: number; y: number }) => {
    const container = containerRef.current;
    const panel = toolPanelRef.current;
    if (!container || !panel) return candidate;

    const baseLeft = container.clientWidth - panel.offsetWidth - TOOL_PANEL_MARGIN;
    const baseTop = container.clientHeight - panel.offsetHeight - TOOL_PANEL_MARGIN;
    const minLeft = TOOL_PANEL_MIN_MARGIN;
    const minTop = TOOL_PANEL_MIN_MARGIN;
    const maxLeft = Math.max(minLeft, container.clientWidth - panel.offsetWidth - TOOL_PANEL_MIN_MARGIN);
    const maxTop = Math.max(minTop, container.clientHeight - panel.offsetHeight - TOOL_PANEL_MIN_MARGIN);

    const clampedLeft = Math.min(maxLeft, Math.max(minLeft, baseLeft + candidate.x));
    const clampedTop = Math.min(maxTop, Math.max(minTop, baseTop + candidate.y));

    return {
      x: clampedLeft - baseLeft,
      y: clampedTop - baseTop
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setToolPanelOffset((prev) => clampToolPanelOffset(prev));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampToolPanelOffset]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const dragState = toolPanelDragRef.current;
      if (!dragState) return;
      setToolPanelOffset(
        clampToolPanelOffset({
          x: dragState.startOffsetX + event.clientX - dragState.startClientX,
          y: dragState.startOffsetY + event.clientY - dragState.startClientY
        })
      );
    };

    const handleMouseUp = () => {
      toolPanelDragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [clampToolPanelOffset]);

  const {
    hoverIdx,
    closestEdgeIdx,
    draggingIdx,
    handlePrimaryDown,
    handlePointerMove,
    handlePointerUp,
    deletePoint
  } = usePlanEditor({
    points,
    setPoints,
    snapToGrid,
    gridSize,
    interactionScale: scale
  });

  const edgeLengths = useMemo(() => {
    if (points.length < 2) return [];
    return points.map((point, index) => getDistance(point, points[(index + 1) % points.length]));
  }, [points]);

  const highlightedPlankIds = useMemo(() => {
    const ids = new Set<string>();
    if (hoverPlank) {
      ids.add(hoverPlank.id);
      if (hoverPlank.sourcePlankId) ids.add(hoverPlank.sourcePlankId);
      planks.forEach((plank) => {
        if (plank.sourcePlankId === hoverPlank.id) ids.add(plank.id);
      });
    }

    if (hoverWastePieceIdx !== null) {
      const sourceId = wastePieces[hoverWastePieceIdx]?.sourcePlankId;
      if (sourceId) {
        ids.add(sourceId);
        planks.forEach((plank) => {
          if (plank.sourcePlankId === sourceId) ids.add(plank.id);
        });
      }
    }
    return ids;
  }, [hoverPlank, hoverWastePieceIdx, planks, wastePieces]);

  const highlightedWastePieceIndices = useMemo(() => {
    const indices = new Set<number>();
    const sourceIds = new Set<string>();

    if (hoverWastePieceIdx !== null) {
      indices.add(hoverWastePieceIdx);
      const sourceId = wastePieces[hoverWastePieceIdx]?.sourcePlankId;
      if (sourceId) sourceIds.add(sourceId);
    }

    if (hoverPlank) {
      sourceIds.add(hoverPlank.id);
      if (hoverPlank.sourcePlankId) sourceIds.add(hoverPlank.sourcePlankId);
    }

    if (sourceIds.size === 0) return indices;

    wastePieces.forEach((piece, index) => {
      if (piece.sourcePlankId && sourceIds.has(piece.sourcePlankId)) {
        indices.add(index);
      }
    });

    return indices;
  }, [hoverPlank, hoverWastePieceIdx, wastePieces]);

  const hoverWastePiece = hoverWastePieceIdx !== null ? wastePieces[hoverWastePieceIdx] : null;

  const getAngleAtVertex = (idx: number, pts: Point[]) => {
    if (pts.length < 3) return { angle: 0, labelPos: { x: 0, y: 0 } };
    const point = pts[idx];
    const prev = pts[(idx - 1 + pts.length) % pts.length];
    const next = pts[(idx + 1) % pts.length];
    const v1 = { x: prev.x - point.x, y: prev.y - point.y };
    const v2 = { x: next.x - point.x, y: next.y - point.y };
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    if (mag1 === 0 || mag2 === 0) return { angle: 0, labelPos: point };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
    let bisector = { x: v1.x / mag1 + v2.x / mag2, y: v1.y / mag1 + v2.y / mag2 };
    const bMag = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
    if (bMag < 0.001) bisector = { x: -v1.y / mag1, y: v1.x / mag1 };
    else {
      bisector.x /= bMag;
      bisector.y /= bMag;
    }
    if (isPointInPolygon({ x: point.x + bisector.x * 5, y: point.y + bisector.y * 5 }, pts)) {
      bisector.x = -bisector.x;
      bisector.y = -bisector.y;
    }
    return {
      angle: (angleRad * 180) / Math.PI,
      labelPos: { x: point.x + bisector.x * 35, y: point.y + bisector.y * 35 }
    };
  };

  const getEdgeLabelPosition = useCallback((edgeIdx: number) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return null;

    const p1 = points[edgeIdx];
    const p2 = points[(edgeIdx + 1) % points.length];
    const centerX = canvas.width / 2 + offset.x;
    const centerY = canvas.height / 2 + offset.y;
    const s1 = { x: p1.x * scale + centerX, y: p1.y * scale + centerY };
    const s2 = { x: p2.x * scale + centerX, y: p2.y * scale + centerY };
    const edgeDx = s2.x - s1.x;
    const edgeDy = s2.y - s1.y;
    const edgeLength = Math.hypot(edgeDx, edgeDy) || 1;
    const nx = -edgeDy / edgeLength;
    const ny = edgeDx / edgeLength;
    const midX = (s1.x + s2.x) / 2;
    const midY = (s1.y + s2.y) / 2;

    const pointScreens = points.map((point) => ({
      x: point.x * scale + centerX,
      y: point.y * scale + centerY
    }));

    const candidates = [28, -28, 44, -44].map((offsetPx) => ({
      left: midX + nx * offsetPx,
      top: midY + ny * offsetPx
    }));

    const minHandleDistance = 24;
    for (const candidate of candidates) {
      const collidesWithHandle = pointScreens.some((screenPoint) => {
        const dx = candidate.left - screenPoint.x;
        const dy = candidate.top - screenPoint.y;
        return Math.hypot(dx, dy) < minHandleDistance;
      });
      if (!collidesWithHandle) return candidate;
    }
    return candidates[0];
  }, [offset.x, offset.y, points, scale]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const parent = canvas.parentElement;
    if (parent && (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight)) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }

    ctx.fillStyle = '#FCFBFA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2 + offset.x;
    const centerY = canvas.height / 2 + offset.y;

    if (backgroundDrawing && showBackgroundDrawing && backgroundOpacity > 0) {
      const image = backgroundImageRef.current;
      if (image) {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.globalAlpha = Math.max(0, Math.min(1, backgroundOpacity));
        ctx.drawImage(
          image,
          backgroundDrawing.x * scale,
          backgroundDrawing.y * scale,
          backgroundDrawing.width * scale,
          backgroundDrawing.height * scale
        );
        ctx.restore();
      }
    }

    ctx.strokeStyle = 'rgba(232, 227, 222, 0.58)';
    ctx.lineWidth = 1;
    const visualGridSize = gridSize * scale;
    if (visualGridSize > 5) {
      ctx.beginPath();
      for (let x = centerX % visualGridSize; x < canvas.width; x += visualGridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
      }
      for (let y = centerY % visualGridSize; y < canvas.height; y += visualGridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
      }
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(centerX, centerY);

    if (points.length >= 3) {
      wastePieces.forEach((piece, index) => {
        const isHighlighted = highlightedWastePieceIndices.has(index);
        ctx.fillStyle = isHighlighted ? 'rgba(209, 179, 166, 0.4)' : 'rgba(229, 219, 213, 0.26)';
        ctx.strokeStyle = isHighlighted ? 'rgba(155, 118, 103, 0.6)' : 'rgba(178, 155, 145, 0.32)';
        ctx.lineWidth = isHighlighted ? 1.2 : 0.8;
        ctx.fillRect(piece.x * scale, piece.y * scale, piece.w * scale, piece.h * scale);
        ctx.strokeRect(piece.x * scale, piece.y * scale, piece.w * scale, piece.h * scale);
      });

      const contrast = settings.visualContrast;
      planks.forEach((plank) => {
        const isHighlighted = highlightedPlankIds.has(plank.id);
        const isFullLength = !plank.isCut;

        if (isHighlighted) {
          ctx.fillStyle = hoverPlank?.id === plank.id ? '#C9A89A' : 'rgba(201, 168, 154, 0.74)';
        } else if (isFullLength) {
          ctx.fillStyle = `rgba(${factoryColor.r}, ${factoryColor.g}, ${factoryColor.b}, ${0.45 + contrast * 0.45})`;
        } else {
          const r = factoryColor.r + (cutColorBase.r - factoryColor.r) * contrast;
          const g = factoryColor.g + (cutColorBase.g - factoryColor.g) * contrast;
          const b = factoryColor.b + (cutColorBase.b - factoryColor.b) * contrast;
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.38 - contrast * 0.14})`;
        }

        ctx.fillRect(plank.x * scale, plank.y * scale, plank.w * scale, plank.h * scale);
        ctx.strokeStyle = isHighlighted ? '#8F6655' : 'rgba(0,0,0,0.18)';
        ctx.lineWidth = isHighlighted ? 2 : 0.8;
        ctx.strokeRect(plank.x * scale, plank.y * scale, plank.w * scale, plank.h * scale);
      });
    }

    if (points.length > 0) {
      ctx.beginPath();
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = '#1D1D1D';
      points.forEach((point, index) => {
        const next = points[(index + 1) % points.length];
        if (index === 0) ctx.moveTo(point.x * scale, point.y * scale);
        if (index < points.length - 1 || points.length >= 3) {
          ctx.lineTo(next.x * scale, next.y * scale);
        }
      });
      ctx.stroke();

      if (closestEdgeIdx !== null) {
        const p1 = points[closestEdgeIdx];
        const p2 = points[(closestEdgeIdx + 1) % points.length];
        ctx.strokeStyle = '#B78B78';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(p1.x * scale, p1.y * scale);
        ctx.lineTo(p2.x * scale, p2.y * scale);
        ctx.stroke();
      }

      points.forEach((point, index) => {
        const isOrigin = settings.originPointIdx === index;
        ctx.beginPath();
        ctx.arc(point.x * scale, point.y * scale, index === hoverIdx ? 6 : 4.2, 0, Math.PI * 2);
        ctx.fillStyle = isOrigin ? '#1A1A1A' : index === hoverIdx ? '#2E2E2E' : '#FFF';
        ctx.fill();
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        if (draggingIdx === index) {
          const { angle, labelPos } = getAngleAtVertex(index, points);
          ctx.fillStyle = '#1A1A1A';
          ctx.font = '600 12px Inter';
          ctx.textAlign = 'center';
          ctx.fillText(`${Math.round(angle)}°`, labelPos.x * scale, labelPos.y * scale);
        }
      });
    }

    ctx.restore();
  }, [
    backgroundDrawing,
    backgroundOpacity,
    closestEdgeIdx,
    draggingIdx,
    gridSize,
    highlightedPlankIds,
    highlightedWastePieceIndices,
    hoverIdx,
    hoverPlank,
    offset.x,
    offset.y,
    planks,
    points,
    scale,
    settings,
    showBackgroundDrawing,
    wastePieces
  ]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draw, backgroundImageVersion]);

  const handleMouseDown = (event: React.MouseEvent) => {
    if (contextMenu) {
      setContextMenu(null);
      return;
    }

    if (event.button !== 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left - canvas.width / 2 - offset.x) / scale;
    const my = (event.clientY - rect.top - canvas.height / 2 - offset.y) / scale;
    const cursor = { x: mx, y: my };

    const result = handlePrimaryDown(cursor);
    if (result.startedDrag || result.insertedPoint) {
      onRequestHistorySnapshot();
      return;
    }

    setIsPanning(true);
    setLastPanPos({ x: event.clientX, y: event.clientY });
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setMousePos({ x: event.clientX, y: event.clientY });

    if (isPanning) {
      setOffset({
        x: offset.x + event.clientX - lastPanPos.x,
        y: offset.y + event.clientY - lastPanPos.y
      });
      setLastPanPos({ x: event.clientX, y: event.clientY });
      return;
    }

    const mx = (event.clientX - rect.left - canvas.width / 2 - offset.x) / scale;
    const my = (event.clientY - rect.top - canvas.height / 2 - offset.y) / scale;
    const cursor = { x: mx, y: my };

    const moveState = handlePointerMove(cursor);

    let foundPlank: PlankInstance | null = null;
    let foundWastePiece: number | null = null;
    if (points.length >= 3 && !moveState.isDragging && moveState.hoverIdx === null) {
      for (const plank of planks) {
        if (mx >= plank.x && mx <= plank.x + plank.w && my >= plank.y && my <= plank.y + plank.h) {
          foundPlank = plank;
          break;
        }
      }

      if (!foundPlank) {
        for (let index = 0; index < wastePieces.length; index++) {
          const piece = wastePieces[index];
          if (mx >= piece.x && mx <= piece.x + piece.w && my >= piece.y && my <= piece.y + piece.h) {
            foundWastePiece = index;
            break;
          }
        }

        if (foundWastePiece !== null) {
          const sourceId = wastePieces[foundWastePiece]?.sourcePlankId;
          if (sourceId) {
            foundPlank = planks.find((plank) => plank.id === sourceId) ?? null;
          }
        }
      }
    }

    setHoverPlank(foundPlank);
    setHoverWastePieceIdx(foundWastePiece);
  };

  const handleDeletePoint = (idx: number) => {
    if (points.length <= 3) {
      setContextMenu(null);
      return;
    }
    onRequestHistorySnapshot();
    const nextPoints = deletePoint(idx);
    if (nextPoints === points) return;
    if (settings.originPointIdx === idx) {
      setSettings({ ...settings, originPointIdx: 0 });
    } else if (settings.originPointIdx > idx) {
      setSettings({ ...settings, originPointIdx: settings.originPointIdx - 1 });
    }
    setContextMenu(null);
  };

  const getCursorFromClientPosition = useCallback((clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    return {
      x: (clientX - rect.left - canvas.width / 2 - currentOffset.x) / currentScale,
      y: (clientY - rect.top - canvas.height / 2 - currentOffset.y) / currentScale
    };
  }, []);

  const zoomAtPointer = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const clampedScale = Math.max(0.01, Math.min(0.5, nextScale));
    if (Math.abs(clampedScale - currentScale) < 0.000001) return;

    const rect = canvas.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;

    const worldX = (pointerX - canvas.width / 2 - currentOffset.x) / currentScale;
    const worldY = (pointerY - canvas.height / 2 - currentOffset.y) / currentScale;

    const nextOffset = {
      x: pointerX - canvas.width / 2 - worldX * clampedScale,
      y: pointerY - canvas.height / 2 - worldY * clampedScale
    };

    scaleRef.current = clampedScale;
    offsetRef.current = nextOffset;

    setScale(clampedScale);
    setOffset(nextOffset);
  }, [setOffset, setScale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      const shouldZoom = event.ctrlKey || event.metaKey;
      const absDeltaX = Math.abs(event.deltaX);
      const absDeltaY = Math.abs(event.deltaY);

      if (gestureScaleRef.current !== null && !shouldZoom) {
        event.preventDefault();
        return;
      }

      if (absDeltaX < 0.0001 && absDeltaY < 0.0001) return;
      event.preventDefault();

      if (shouldZoom && absDeltaY > 0.0001) {
        const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
        zoomAtPointer(event.clientX, event.clientY, scaleRef.current * zoomFactor);
        return;
      }

      const currentOffset = offsetRef.current;
      const nextOffset = {
        x: currentOffset.x - event.deltaX,
        y: currentOffset.y - event.deltaY
      };
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
    };

    const handleGestureStart = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent;
      gestureEvent.preventDefault();
      gestureScaleRef.current = gestureEvent.scale ?? 1;
    };

    const handleGestureChange = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent;
      gestureEvent.preventDefault();
      const currentGestureScale = gestureEvent.scale ?? 1;
      const previousGestureScale = gestureScaleRef.current ?? currentGestureScale;
      if (previousGestureScale === 0) return;

      const relativeScale = currentGestureScale / previousGestureScale;
      const zoomFactor = Math.pow(relativeScale, GESTURE_ZOOM_GAIN);
      gestureScaleRef.current = currentGestureScale;

      const rect = container.getBoundingClientRect();
      const clientX = typeof gestureEvent.clientX === 'number' ? gestureEvent.clientX : rect.left + rect.width / 2;
      const clientY = typeof gestureEvent.clientY === 'number' ? gestureEvent.clientY : rect.top + rect.height / 2;
      zoomAtPointer(clientX, clientY, scaleRef.current * zoomFactor);
    };

    const handleGestureEnd = () => {
      gestureScaleRef.current = null;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('gesturestart', handleGestureStart as EventListener, { passive: false });
    container.addEventListener('gesturechange', handleGestureChange as EventListener, { passive: false });
    container.addEventListener('gestureend', handleGestureEnd as EventListener);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('gesturestart', handleGestureStart as EventListener);
      container.removeEventListener('gesturechange', handleGestureChange as EventListener);
      container.removeEventListener('gestureend', handleGestureEnd as EventListener);
    };
  }, [setOffset, zoomAtPointer]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-w-0 overflow-hidden bg-[#FCFBFA]"
      onContextMenu={(event) => {
        event.preventDefault();
        const cursor = getCursorFromClientPosition(event.clientX, event.clientY);
        if (!cursor) return;

        const currentScale = scaleRef.current;
        const pointIdx = getHoverPointIndex(points, cursor, currentScale);
        if (pointIdx !== null) {
          setContextMenu({ kind: 'point', x: event.clientX, y: event.clientY, pointIdx });
          return;
        }

        if (points.length >= 2) {
          const safeScale = Math.max(currentScale, 0.0001);
          const closestEdge = findClosestEdge(cursor, points);
          if (closestEdge.distance < (EDGE_HIT_TOLERANCE_PX / safeScale)) {
            setContextMenu(null);
            return;
          }
        }

        setContextMenu({ kind: 'canvas', x: event.clientX, y: event.clientY });
      }}
      style={{
        cursor: isPanning
          ? 'grabbing'
          : draggingIdx !== null
            ? 'grabbing'
            : hoverIdx !== null || hoverWastePieceIdx !== null
              ? 'pointer'
              : closestEdgeIdx !== null
                ? 'copy'
                : 'crosshair'
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => {
          handlePointerUp();
          setIsPanning(false);
        }}
        onMouseLeave={() => {
          handlePointerUp();
          setIsPanning(false);
        }}
        className="block h-full w-full"
      />

      {showEdgeLengths && points.length >= 2 && points.map((point, index) => {
        const labelPosition = getEdgeLabelPosition(index);
        if (!labelPosition) return null;
        return (
          <div
            key={index}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: labelPosition.left, top: labelPosition.top }}
          >
            <input
              type="number"
              value={Math.round(edgeLengths[index])}
              onChange={(event) => {
                const value = parseFloat(event.target.value);
                if (value > 0) {
                  onRequestHistorySnapshot();
                  setPoints(movePointByLength(points, index, value));
                }
              }}
              className="h-7 w-16 border border-[#D9D4CF] bg-white text-center text-[10px] font-semibold text-[#1A1A1A] shadow-[0_2px_8px_rgba(0,0,0,0.08)] focus:border-[#B69181] focus:outline-none"
            />
          </div>
        );
      })}

      {(hoverPlank || hoverWastePiece) && (
        <div
          className="pointer-events-none fixed z-50 border border-[#DDD8D4] bg-white p-3 text-[10px] font-medium shadow-xl"
          style={{ left: mousePos.x + 15, top: mousePos.y + 15 }}
        >
          {hoverPlank && (
            <>
              <div className="mb-1 text-[#5F5F5F]">Längd: {Math.round(hoverPlank.w)} mm</div>
              <div className="text-[#8F6655]">{!hoverPlank.isCut ? 'Fabriksmått' : 'Anpassad'}</div>
            </>
          )}
          {!hoverPlank && hoverWastePiece && (
            <>
              <div className="mb-1 text-[#5F5F5F]">Spillbit</div>
              <div className="text-[#8F6655]">{Math.round(hoverWastePiece.w)} × {Math.round(hoverWastePiece.h)} mm</div>
            </>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[190px] border border-[#D9D4CF] bg-white py-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.kind === 'point' ? (
            <>
              <button
                onClick={() => {
                  if (settings.originPointIdx !== contextMenu.pointIdx) {
                    onRequestHistorySnapshot();
                    setSettings({ ...settings, originPointIdx: contextMenu.pointIdx });
                  }
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-[10px] font-medium hover:bg-[#F6F2EF]"
              >
                Välj som start
              </button>
              {points.length > 3 && (
                <button
                  onClick={() => handleDeletePoint(contextMenu.pointIdx)}
                  className="w-full px-4 py-2 text-left text-[10px] font-medium text-red-700 hover:bg-[#FFF4F4]"
                >
                  Ta bort hörn
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  onToggleSnapToGrid();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-[10px] font-medium text-[#1A1A1A] hover:bg-[#F6F2EF]"
              >
                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center border text-[9px] ${snapToGrid ? 'border-[#B69181] bg-[#F6F0EC] text-[#8F6655]' : 'border-[#D9D4CF] bg-white text-transparent'}`}>✓</span>
                <span>Snap</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onToggleEdgeLengths();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-[10px] font-medium text-[#1A1A1A] hover:bg-[#F6F2EF]"
              >
                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center border text-[9px] ${showEdgeLengths ? 'border-[#B69181] bg-[#F6F0EC] text-[#8F6655]' : 'border-[#D9D4CF] bg-white text-transparent'}`}>✓</span>
                <span>Golvmått</span>
              </button>

              <button
                type="button"
                disabled={!backgroundDrawing}
                onClick={() => {
                  if (!backgroundDrawing) return;
                  onToggleBackgroundDrawing();
                  setContextMenu(null);
                }}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[10px] font-medium ${backgroundDrawing ? 'text-[#1A1A1A] hover:bg-[#F6F2EF]' : 'cursor-not-allowed text-[#A5A5A5]'}`}
              >
                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center border text-[9px] ${backgroundDrawing && showBackgroundDrawing ? 'border-[#B69181] bg-[#F6F0EC] text-[#8F6655]' : 'border-[#D9D4CF] bg-white text-transparent'}`}>✓</span>
                <span>Bakgrundsritning</span>
              </button>

              <div className="my-1 border-t border-[#ECE7E3]" />

              <button
                type="button"
                onClick={() => {
                  onZoomExtents();
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-[10px] font-medium text-[#1A1A1A] hover:bg-[#F6F2EF]"
              >
                Zoom extents
              </button>
            </>
          )}
        </div>
      )}

      {showFloatingToolPanel && (
        <div
          ref={toolPanelRef}
          className="pointer-events-auto absolute bottom-6 right-6 z-30 w-64"
          style={{ transform: `translate(${toolPanelOffset.x}px, ${toolPanelOffset.y}px)` }}
        >
          <div className="space-y-3 border border-[#D9D4CF] bg-white/96 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.1)] backdrop-blur-sm">
            <div
              className="flex cursor-grab items-center justify-between rounded bg-[#F3F0ED] px-2 py-1 text-[10px] font-medium text-[#595959] active:cursor-grabbing"
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                toolPanelDragRef.current = {
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  startOffsetX: toolPanelOffset.x,
                  startOffsetY: toolPanelOffset.y
                };
              }}
            >
              <span>Canvasverktyg</span>
              <span className="text-[9px] text-[#777]">Drag</span>
            </div>

            <div className="space-y-2">
              <div>
                <label className="pf-label block text-[#666]">Kontrast</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.visualContrast}
                  onChange={(event) => setSettings({ ...settings, visualContrast: parseFloat(event.target.value) })}
                  className="kahrs-slider"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onToggleSnapToGrid}
                  className={`rounded border px-2 py-1.5 text-[10px] font-medium transition-colors ${
                    snapToGrid
                      ? 'border-[#B69181] bg-[#F6F0EC] text-[#1A1A1A]'
                      : 'border-[#D9D4CF] bg-white text-[#666]'
                  }`}
                >
                  Magnet
                </button>
                <button
                  type="button"
                  onClick={onToggleEdgeLengths}
                  className={`rounded border px-2 py-1.5 text-[10px] font-medium transition-colors ${
                    showEdgeLengths
                      ? 'border-[#B69181] bg-[#F6F0EC] text-[#1A1A1A]'
                      : 'border-[#D9D4CF] bg-white text-[#666]'
                  }`}
                >
                  {showEdgeLengths ? 'Dölj mått' : 'Visa mått'}
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t border-[#ECE7E3] pt-2">
              <div className="flex items-center justify-between">
                <label className="pf-label text-[#666]">Bakgrundsritning</label>
                <button
                  type="button"
                  disabled={!backgroundDrawing}
                  onClick={onToggleBackgroundDrawing}
                  className={`text-[10px] font-medium ${
                    backgroundDrawing ? 'text-[#1A1A1A] hover:text-[#8F6655]' : 'text-[#9A9A9A]'
                  }`}
                >
                  {showBackgroundDrawing ? 'Dölj' : 'Visa'}
                </button>
              </div>

              {backgroundDrawing ? (
                <>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="pf-label text-[#666]">Opacitet</label>
                      <span className="text-[10px] font-semibold text-[#1A1A1A]">{Math.round(backgroundOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round(backgroundOpacity * 100)}
                      onChange={(event) => onBackgroundOpacityChange((parseInt(event.target.value, 10) || 0) / 100)}
                      className="kahrs-slider"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={onRemoveBackgroundDrawing}
                    className="w-full rounded border border-[#E0C6BC] bg-[#FFF8F6] px-2 py-1.5 text-[10px] font-medium text-[#8D4F3A] transition-colors hover:bg-[#FFF1ED]"
                  >
                    Ta bort bakgrund
                  </button>
                </>
              ) : (
                <p className="text-[10px] text-[#787878]">Ingen importerad bakgrund än.</p>
              )}
            </div>

            <div className="border-t border-[#ECE7E3] pt-2">
              <button
                type="button"
                className="flex w-full items-center justify-between text-[10px] font-medium text-[#666]"
                onClick={() => setIsLegendExpanded((prev) => !prev)}
              >
                <span>Förklaring</span>
                <svg className={`h-3 w-3 transition-transform ${isLegendExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="3" /></svg>
              </button>

              {isLegendExpanded && (
                <div className="mt-2 space-y-1.5 text-[10px] font-medium text-[#777]">
                  <div className="flex items-center gap-2"><div className="h-2.5 w-2.5 bg-[#D2B7AC]"></div> Fulla plankor</div>
                  <div className="flex items-center gap-2"><div className="h-2.5 w-2.5 bg-[#F5F1EF]"></div> Kapade bitar</div>
                  <div className="flex items-center gap-2"><div className="h-2.5 w-2.5 bg-[#E4D7D1]"></div> Spillbitar</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Canvas;
