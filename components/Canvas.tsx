import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Point, PlankSettings, PlankInstance, WastePiece, ImportedDrawingBackground, Stats, ProductInfo } from '../types';
import { findClosestEdge, getDistance, movePointByLength, isPointInPolygon } from '../geometry';
import { getHoverPointIndex, getClosestEdgeInsertIndex, addOrInsertPoint, forceSnapPointTo90 } from '../pointEditing';
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
  onResetDesign?: () => void;
  showFloatingToolPanel?: boolean;
  stats: Stats;
  productInfo: ProductInfo | null;
}

interface PointContextMenu {
  kind: 'point';
  x: number;
  y: number;
  pointIdx: number;
}

interface EdgeContextMenu {
  kind: 'edge';
  x: number;
  y: number;
  edgeIdx: number;
  cursor: { x: number; y: number };
}

interface CanvasContextMenu {
  kind: 'canvas';
  x: number;
  y: number;
}

type ContextMenu = PointContextMenu | EdgeContextMenu | CanvasContextMenu;

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
  onResetDesign,
  showFloatingToolPanel = true,
  stats,
  productInfo
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
  const [gridOpacity, setGridOpacity] = useState(0.4); // Admin: expose setGridOpacity via admin panel to let users adjust
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);
  const [toolPanelOffset, setToolPanelOffset] = useState(loadToolPanelOffset);
  const [showGrid, setShowGrid] = useState(true);

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
    draggingEdgeIdx,
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
    const offsetPx = 28 / scale; // constant pixel distance from the vertex
    return {
      angle: (angleRad * 180) / Math.PI,
      labelPos: { x: point.x + bisector.x * offsetPx, y: point.y + bisector.y * offsetPx }
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
    const edgeLength = Math.hypot(edgeDx, edgeDy);

    // Hide when edge is too short to fit the label without crowding
    if (edgeLength < 68) return null;

    const nx = -edgeDy / edgeLength;
    const ny = edgeDx / edgeLength;
    const midX = (s1.x + s2.x) / 2;
    const midY = (s1.y + s2.y) / 2;

    // Place label on the outside of the polygon (side away from centroid)
    const centX = points.reduce((sum, p) => sum + p.x * scale + centerX, 0) / points.length;
    const centY = points.reduce((sum, p) => sum + p.y * scale + centerY, 0) / points.length;
    const dot = nx * (centX - midX) + ny * (centY - midY);
    const offsetPx = dot > 0 ? -32 : 32;

    return { left: midX + nx * offsetPx, top: midY + ny * offsetPx };
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

    ctx.strokeStyle = `rgba(232, 227, 222, ${gridOpacity})`;
    ctx.lineWidth = 1;
    const visualGridSize = gridSize * scale;
    if (showGrid && visualGridSize > 5) {
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
      ctx.save();
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x * scale, point.y * scale);
        else ctx.lineTo(point.x * scale, point.y * scale);
      });
      ctx.closePath();
      ctx.clip();
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
      ctx.restore();
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
          ctx.font = '600 12px Public Sans';
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
    showGrid,
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

        if (points.length >= 3) {
          const safeScale = Math.max(currentScale, 0.0001);
          const edgeIdx = getClosestEdgeInsertIndex(points, cursor, safeScale, null);
          if (edgeIdx !== null) {
            setContextMenu({ kind: 'edge', x: event.clientX, y: event.clientY, edgeIdx, cursor });
            return;
          }
        }

        setContextMenu({ kind: 'canvas', x: event.clientX, y: event.clientY });
      }}
      style={{
        cursor: isPanning
          ? 'grabbing'
          : draggingIdx !== null || draggingEdgeIdx !== null
            ? 'grabbing'
            : hoverIdx !== null || hoverWastePieceIdx !== null
              ? 'pointer'
              : closestEdgeIdx !== null
                ? 'pointer'
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
        onDoubleClick={() => {
          if (hoverIdx !== null) {
            const snapped = forceSnapPointTo90(points, hoverIdx);
            if (snapped !== points) setPoints(snapped);
          }
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
            <div className="flex items-baseline gap-px">
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
                className="h-6 w-10 border-none bg-transparent pr-0 text-right text-[10px] font-semibold text-[#1A1A1A] outline-none focus:bg-white/80 focus:rounded-sm focus:outline focus:outline-1 focus:outline-[#B69181] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ textShadow: '0 0 4px rgba(255,255,255,0.95), 0 0 8px rgba(255,255,255,0.7)' }}
              />
              <span className="select-none text-[9px] font-medium text-[#1A1A1A]" style={{ textShadow: '0 0 4px rgba(255,255,255,0.95), 0 0 8px rgba(255,255,255,0.7)' }}>mm</span>
            </div>
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
              <div className="text-[#5F5F5F]">Längd: {Math.round(hoverPlank.w)} mm</div>
              <div className="mb-1 text-[#5F5F5F]">Bredd: {Math.round(hoverPlank.h)} mm</div>
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

      {/* Floating stats panel */}
      <div className="pointer-events-auto absolute bottom-5 left-1/2 z-30 -translate-x-1/2 hidden">
        <div className="flex items-stretch overflow-hidden rounded-full border border-[#D9D4CF] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.12)]">
          <div className="flex w-[108px] flex-shrink-0 flex-col items-center justify-center py-3">
            <span className="text-[9px] font-medium text-[#9A9A9A] whitespace-nowrap">Area</span>
            <span className="mt-0.5 text-[13px] font-bold leading-none text-[#1A1A1A] whitespace-nowrap">{stats.area.toFixed(2)} m²</span>
          </div>
          <div className="w-px self-stretch bg-[#EAE6E3] my-3" />
          <div className="flex w-[90px] flex-shrink-0 flex-col items-center justify-center py-3">
            <span className="text-[9px] font-medium text-[#9A9A9A] whitespace-nowrap">Åtgång</span>
            <span className="mt-0.5 text-[13px] font-bold leading-none text-[#1A1A1A] whitespace-nowrap">{stats.plankCount} st</span>
          </div>
          <div className="w-px self-stretch bg-[#EAE6E3] my-3" />
          <div className="flex w-[80px] flex-shrink-0 flex-col items-center justify-center py-3">
            <span className="text-[9px] font-medium text-[#9A9A9A] whitespace-nowrap">Förp.</span>
            <span className="mt-0.5 text-[13px] font-bold leading-none text-[#1A1A1A] whitespace-nowrap">{stats.packageCount} st</span>
          </div>
          <div className="w-px self-stretch bg-[#EAE6E3] my-3" />
          <div className="flex w-[84px] flex-shrink-0 flex-col items-center justify-center py-3">
            <span className="text-[9px] font-medium text-[#9A9A9A] whitespace-nowrap">Spill</span>
            <span className={`mt-0.5 text-[13px] font-bold leading-none whitespace-nowrap ${stats.wastePercent <= 15 ? 'text-[#3D8B37]' : 'text-[#C41230]'}`}>
              {stats.wastePercent.toFixed(1)}%
            </span>
          </div>
          {productInfo && stats.totalPrice ? (
            <>
              <div className="w-px self-stretch bg-[#EAE6E3] my-3" />
              <div className="flex w-[124px] flex-shrink-0 flex-col items-center justify-center py-3">
                <span className="text-[9px] font-medium text-[#9A9A9A] whitespace-nowrap">Sum tot</span>
                <span className="mt-0.5 text-[13px] font-bold leading-none text-[#1A1A1A] whitespace-nowrap">
                  {Math.round(stats.totalPrice).toLocaleString()} {productInfo.currency.trim().toUpperCase() === 'SEK' ? 'kr' : productInfo.currency}
                </span>
              </div>
              <button type="button" className="self-stretch rounded-full bg-[#3D8B37] px-8 mx-2 my-2 text-[10px] font-bold tracking-wide text-white whitespace-nowrap transition-colors hover:bg-[#2e6a2a]">LÄGG I VARUKORG</button>
            </>
          ) : (
            <button type="button" className="self-stretch rounded-full bg-[#3D8B37] px-8 mx-2 my-2 text-[10px] font-bold tracking-wide text-white whitespace-nowrap transition-colors hover:bg-[#2e6a2a]">LÄGG I VARUKORG</button>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 w-[150px] rounded-2xl border border-[#aaaaaa] bg-white py-1.5"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.kind === 'edge' ? (
            <div className="px-1.5 py-0.5">
              <button
                type="button"
                onClick={() => {
                  const nextPoints = addOrInsertPoint(points, contextMenu.cursor, contextMenu.edgeIdx, snapToGrid, gridSize);
                  if (nextPoints) {
                    onRequestHistorySnapshot();
                    setPoints(nextPoints);
                  }
                  setContextMenu(null);
                }}
                className="pf-action-heading w-full rounded-full px-3 py-1.5 text-left text-[10px] font-medium text-[#333333] hover:bg-[#f0f0f0] transition-colors"
              >
                Lägg till punkt
              </button>
            </div>
          ) : contextMenu.kind === 'point' ? (
            <>
              <div className="px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    if (settings.originPointIdx !== contextMenu.pointIdx) {
                      onRequestHistorySnapshot();
                      setSettings({ ...settings, originPointIdx: contextMenu.pointIdx });
                    }
                    setContextMenu(null);
                  }}
                  className="pf-action-heading w-full rounded-full px-3 py-1.5 text-left text-[10px] font-medium text-[#333333] hover:bg-[#f0f0f0] transition-colors"
                >
                  Välj som start
                </button>
              </div>
              {points.length > 3 && (
                <div className="px-1.5 py-0.5">
                  <button
                    type="button"
                    onClick={() => handleDeletePoint(contextMenu.pointIdx)}
                    className="pf-action-heading w-full rounded-full px-3 py-1.5 text-left text-[10px] font-medium text-[#C41230] hover:bg-[#fff0f1] transition-colors"
                  >
                    Ta bort punkt
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => { onToggleEdgeLengths(); setContextMenu(null); }}
                  className="pf-action-heading w-full rounded-full px-3 py-1.5 text-left text-[10px] font-medium text-[#333333] hover:bg-[#f0f0f0] transition-colors"
                >
                  {showEdgeLengths ? 'Dölj mått' : 'Visa mått'}
                </button>
              </div>

              <div className="px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => { setSettings({ ...settings, visualContrast: settings.visualContrast > 0 ? 0 : 0.3 }); setContextMenu(null); }}
                  className="pf-action-heading w-full rounded-full px-3 py-1.5 text-left text-[10px] font-medium text-[#333333] hover:bg-[#f0f0f0] transition-colors"
                >
                  {settings.visualContrast > 0 ? 'Dölj läggningskontrast' : 'Visa läggningskontrast'}
                </button>
              </div>

              <div className="px-1.5 py-0.5">
                <button
                  type="button"
                  disabled={!backgroundDrawing}
                  onClick={() => { if (!backgroundDrawing) return; onBackgroundOpacityChange(backgroundOpacity > 0 ? 0 : 0.15); setContextMenu(null); }}
                  className={`pf-action-heading w-full rounded-full px-3 py-1.5 text-left text-[10px] font-medium transition-colors ${
                    !backgroundDrawing ? 'cursor-not-allowed text-[#B0B0B0]' : 'text-[#333333] hover:bg-[#f0f0f0]'
                  }`}
                >
                  {backgroundDrawing && backgroundOpacity > 0 ? 'Dölj ritning' : 'Visa ritning'}
                </button>
              </div>

              <div className="px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => { setShowGrid((prev) => !prev); setContextMenu(null); }}
                  className="pf-action-heading w-full rounded-full px-3 py-1.5 text-left text-[10px] font-medium text-[#333333] hover:bg-[#f0f0f0] transition-colors"
                >
                  {showGrid ? 'Dölj stödraster' : 'Visa stödraster'}
                </button>
              </div>

              <div className="my-1 border-t border-[#ECE7E3]" />

              <div className="px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => { onResetDesign?.(); setContextMenu(null); }}
                  className="pf-action-heading w-full rounded-full px-3 py-1.5 text-left text-[10px] font-medium text-[#C41230] hover:bg-[#fff0f1] transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 7h12M9 7V5h6v2m-8 0l1 12h8l1-12M10 11v6m4-6v6" />
                  </svg>
                  <span>Återställ design</span>
                </button>
              </div>
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
          <div className="space-y-3 rounded-2xl border border-[#aaaaaa] bg-white p-3">
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
                  onClick={onToggleEdgeLengths}
                  className={`pf-action-heading rounded-full px-2 py-1.5 text-[10px] font-medium transition-colors ${
                    showEdgeLengths
                      ? 'border border-[#aaaaaa] bg-white text-[#333333]'
                      : 'bg-white text-[#666] hover:bg-[#f0f0f0]'
                  }`}
                >
                  {showEdgeLengths ? 'Dölj mått' : 'Visa mått'}
                </button>
                <button
                  type="button"
                  disabled={!backgroundDrawing}
                  onClick={onToggleBackgroundDrawing}
                  className={`pf-action-heading rounded-full px-2 py-1.5 text-[10px] font-medium transition-colors ${
                    backgroundDrawing && showBackgroundDrawing
                      ? 'border border-[#aaaaaa] bg-white text-[#333333]'
                      : backgroundDrawing
                        ? 'bg-white text-[#666] hover:bg-[#f0f0f0]'
                        : 'cursor-not-allowed bg-white text-[#B0B0B0]'
                  }`}
                >
                  {backgroundDrawing && showBackgroundDrawing ? 'Dölj ritning' : 'Visa ritning'}
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t border-[#ECE7E3] pt-2">
              {backgroundDrawing ? (
                <>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="pf-label text-[#666]">Opacitet ritning</label>
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
                    className="pf-action-heading w-full rounded-full py-1.5 px-2 text-[10px] font-medium text-[#333333] transition-colors hover:bg-[#f0f0f0]"
                  >
                    Radera ritning
                  </button>
                </>
              ) : (
                <p className="text-[10px] text-[#787878]">Ingen importerad bakgrund än.</p>
              )}
            </div>

            <div className="border-t border-[#ECE7E3] pt-2">
              <button
                type="button"
                className="pf-action-heading flex w-full items-center justify-between font-medium text-[#666]"
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
