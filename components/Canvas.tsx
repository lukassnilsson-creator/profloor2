import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Point, PlankSettings, PlankInstance, WastePiece } from '../types';
import { getDistance, movePointByLength, isPointInPolygon } from '../geometry';
import { addOrInsertPoint, deletePointAtIndex, getClosestEdgeInsertIndex, getDraggedPoint, getHoverPointIndex } from '../pointEditing';

interface CanvasProps {
  points: Point[];
  setPoints: (pts: Point[]) => void;
  settings: PlankSettings;
  setSettings: (s: PlankSettings) => void;
  planks: PlankInstance[];
  wastePieces: WastePiece[];
  scale: number;
  offset: { x: number, y: number };
  setOffset: (off: { x: number, y: number }) => void;
  showEdgeLengths: boolean;
  gridSize: number;
  snapToGrid: boolean;
}

interface ContextMenu {
  x: number;
  y: number;
  pointIdx: number;
}

const Canvas: React.FC<CanvasProps> = ({ 
  points, setPoints, settings, setSettings, planks, wastePieces, 
  scale, offset, setOffset, showEdgeLengths, gridSize, snapToGrid 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPlank, setHoverPlank] = useState<PlankInstance | null>(null);
  const [closestEdgeIdx, setClosestEdgeIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [impossibleEdge, setImpossibleEdge] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [snapModifierActive, setSnapModifierActive] = useState(false);
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);

  // Kährs Palette
  const factoryColor = { r: 210, g: 183, b: 172 };
  const cutColorBase = { r: 245, g: 241, b: 239 };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setSnapModifierActive(true); };
    const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setSnapModifierActive(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const edgeLengths = useMemo(() => {
    if (points.length < 2) return [];
    return points.map((p, i) => getDistance(p, points[(i + 1) % points.length]));
  }, [points]);

  const highlightedPlankIds = useMemo(() => {
    if (!hoverPlank) return new Set<string>();
    const ids = new Set<string>();
    ids.add(hoverPlank.id);
    if (hoverPlank.sourcePlankId) ids.add(hoverPlank.sourcePlankId);
    planks.forEach(p => { if (p.sourcePlankId === hoverPlank.id) ids.add(p.id); });
    return ids;
  }, [hoverPlank, planks]);

  const getAngleAtVertex = (idx: number, pts: Point[]) => {
    if (pts.length < 3) return { angle: 0, labelPos: { x: 0, y: 0 } };
    const p = pts[idx];
    const prev = pts[(idx - 1 + pts.length) % pts.length];
    const next = pts[(idx + 1) % pts.length];
    const v1 = { x: prev.x - p.x, y: prev.y - p.y };
    const v2 = { x: next.x - p.x, y: next.y - p.y };
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    if (mag1 === 0 || mag2 === 0) return { angle: 0, labelPos: p };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
    let bisector = { x: (v1.x / mag1) + (v2.x / mag2), y: (v1.y / mag1) + (v2.y / mag2) };
    const bMag = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
    if (bMag < 0.001) bisector = { x: -v1.y / mag1, y: v1.x / mag1 };
    else { bisector.x /= bMag; bisector.y /= bMag; }
    if (isPointInPolygon({ x: p.x + bisector.x * 5, y: p.y + bisector.y * 5 }, pts)) {
      bisector.x = -bisector.x; bisector.y = -bisector.y;
    }
    return { angle: (angleRad * 180) / Math.PI, labelPos: { x: p.x + bisector.x * 35, y: p.y + bisector.y * 35 } };
  };

  // Centraliserad ritfunktion som körs vid behov
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false }); // Prestanda-optimering
    if (!ctx) return;

    // Hantera retina-skärmar och storleksändringar utan flimmer
    const parent = canvas.parentElement;
    if (parent && (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight)) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }

    ctx.fillStyle = '#FBFBFB';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2 + offset.x;
    const centerY = canvas.height / 2 + offset.y;

    // Grid
    ctx.strokeStyle = '#F0F0F0';
    ctx.lineWidth = 1;
    const visualGridSize = gridSize * scale;
    if (visualGridSize > 5) {
      ctx.beginPath();
      for (let x = (centerX % visualGridSize); x < canvas.width; x += visualGridSize) {
        ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
      }
      for (let y = (centerY % visualGridSize); y < canvas.height; y += visualGridSize) {
        ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
      }
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(centerX, centerY);

    if (points.length >= 3) {
      // Spill
      wastePieces.forEach(wp => {
        ctx.fillStyle = 'rgba(210, 183, 172, 0.08)';
        ctx.fillRect(wp.x * scale, wp.y * scale, wp.w * scale, wp.h * scale);
      });

      // Plankor
      const contrast = settings.visualContrast;
      planks.forEach(p => {
        const isHighlighted = highlightedPlankIds.has(p.id);
        const isFullLength = !p.isCut;
        
        if (isHighlighted) {
          ctx.fillStyle = hoverPlank?.id === p.id ? '#D2B7AC' : 'rgba(210, 183, 172, 0.6)';
        } else {
          if (isFullLength) {
            ctx.fillStyle = `rgba(${factoryColor.r}, ${factoryColor.g}, ${factoryColor.b}, ${0.4 + contrast * 0.5})`;
          } else {
            const r = factoryColor.r + (cutColorBase.r - factoryColor.r) * contrast;
            const g = factoryColor.g + (cutColorBase.g - factoryColor.g) * contrast;
            const b = factoryColor.b + (cutColorBase.b - factoryColor.b) * contrast;
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.4 - contrast * 0.2})`;
          }
        }
        
        ctx.fillRect(p.x * scale, p.y * scale, p.w * scale, p.h * scale);
        ctx.strokeStyle = isHighlighted ? '#D2B7AC' : 'rgba(0,0,0,0.12)';
        ctx.lineWidth = isHighlighted ? 2 : 0.5;
        ctx.strokeRect(p.x * scale, p.y * scale, p.w * scale, p.h * scale);
      });
    }

    // Väggar och hörn
    if (points.length > 0) {
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#2D2D2D';
      points.forEach((p, i) => {
        const next = points[(i + 1) % points.length];
        if (i === 0) ctx.moveTo(p.x * scale, p.y * scale);
        if (i < points.length - 1 || points.length >= 3) {
          ctx.lineTo(next.x * scale, next.y * scale);
        }
        if (impossibleEdge === i) {
          ctx.save();
          ctx.strokeStyle = '#CC0000'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(p.x * scale, p.y * scale); ctx.lineTo(next.x * scale, next.y * scale);
          ctx.stroke(); ctx.restore();
        }
      });
      ctx.stroke();

      if (closestEdgeIdx !== null) {
        const p1 = points[closestEdgeIdx];
        const p2 = points[(closestEdgeIdx + 1) % points.length];
        ctx.strokeStyle = '#D2B7AC'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p1.x * scale, p1.y * scale); ctx.lineTo(p2.x * scale, p2.y * scale);
        ctx.stroke();
      }

      points.forEach((p, idx) => {
        const isOrigin = settings.originPointIdx === idx;
        ctx.beginPath();
        ctx.arc(p.x * scale, p.y * scale, idx === hoverIdx ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = isOrigin ? '#1A1A1A' : (idx === hoverIdx ? '#333' : '#FFF');
        ctx.fill();
        ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 1.5; ctx.stroke();
        
        if (draggingIdx === idx) {
          const { angle, labelPos } = getAngleAtVertex(idx, points);
          ctx.fillStyle = '#1A1A1A'; ctx.font = 'bold 12px Inter'; ctx.textAlign = 'center';
          ctx.fillText(`${Math.round(angle)}°`, labelPos.x * scale, labelPos.y * scale);
        }
      });
    }

    ctx.restore();
  };

  // Kör ritning när props ändras eller vid resize
  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [points, hoverIdx, hoverPlank, closestEdgeIdx, scale, offset, planks, wastePieces, impossibleEdge, draggingIdx, settings, gridSize, snapToGrid]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (contextMenu) { setContextMenu(null); return; }
    if (hoverIdx !== null) { if (e.button === 0) setDraggingIdx(hoverIdx); return; }
    
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - canvas.width / 2 - offset.x) / scale;
    const my = (e.clientY - rect.top - canvas.height / 2 - offset.y) / scale;
    const cursor = { x: mx, y: my };

    if (e.button === 0) {
      const nextPoints = addOrInsertPoint(points, cursor, closestEdgeIdx, snapToGrid, gridSize);
      if (nextPoints) {
        setPoints(nextPoints);
      } else {
        setIsPanning(true); setLastPanPos({ x: e.clientX, y: e.clientY });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setMousePos({ x: e.clientX, y: e.clientY });
    
    if (isPanning) {
      setOffset({ x: offset.x + e.clientX - lastPanPos.x, y: offset.y + e.clientY - lastPanPos.y });
      setLastPanPos({ x: e.clientX, y: e.clientY });
      return;
    }

    const mx = (e.clientX - rect.left - canvas.width / 2 - offset.x) / scale;
    const my = (e.clientY - rect.top - canvas.height / 2 - offset.y) / scale;
    const cursor = { x: mx, y: my };

    if (draggingIdx !== null) {
      const n = [...points];
      n[draggingIdx] = getDraggedPoint(points, draggingIdx, cursor, snapToGrid, gridSize, snapModifierActive);
      setPoints(n);
      return;
    }

    // Hover-logik
    const foundIdx = getHoverPointIndex(points, cursor, scale);
    setHoverIdx(foundIdx);

    let foundPlank = null;
    if (points.length >= 3 && foundIdx === null) {
      for (const p of planks) if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) { foundPlank = p; break; }
    }
    setHoverPlank(foundPlank);

    setClosestEdgeIdx(getClosestEdgeInsertIndex(points, cursor, scale, foundIdx));
  };

  const deletePoint = (idx: number) => {
    const n = deletePointAtIndex(points, idx);
    if (n === points) return;
    setPoints(n);
    if (settings.originPointIdx === idx) setSettings({...settings, originPointIdx: 0});
    setContextMenu(null);
  };

  return (
    <div className="relative flex-1 bg-[#FBFBFB] overflow-hidden" 
         onContextMenu={(e) => { e.preventDefault(); if (hoverIdx !== null) setContextMenu({ x: e.clientX, y: e.clientY, pointIdx: hoverIdx }); }}
         style={{ cursor: isPanning ? 'grabbing' : draggingIdx !== null ? 'grabbing' : hoverIdx !== null ? 'pointer' : closestEdgeIdx !== null ? 'copy' : 'crosshair' }}>
      
      <canvas ref={canvasRef} 
              onMouseDown={handleMouseDown} 
              onMouseMove={handleMouseMove} 
              onMouseUp={() => { setDraggingIdx(null); setIsPanning(false); }}
              onMouseLeave={() => { setDraggingIdx(null); setIsPanning(false); }}
              className="w-full h-full block" />

      {showEdgeLengths && points.length >= 2 && points.map((p1, i) => {
        const p2 = points[(i + 1) % points.length];
        const canvas = canvasRef.current; if (!canvas) return null;
        const sx = ((p1.x + p2.x) / 2) * scale + canvas.width / 2 + offset.x;
        const sy = ((p1.y + p2.y) / 2) * scale + canvas.height / 2 + offset.y;
        return (
          <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto" style={{ left: sx, top: sy }}>
            <input type="number" value={Math.round(edgeLengths[i])} 
                   onChange={(e) => {
                     const v = parseFloat(e.target.value);
                     if (v > 0) setPoints(movePointByLength(points, i, v));
                   }}
                   className="w-14 h-6 bg-white border border-[#E5E5E5] text-[9px] font-bold text-center shadow-sm focus:border-[#D2B7AC] focus:outline-none" />
          </div>
        );
      })}

      {hoverPlank && (
        <div className="fixed z-50 pointer-events-none bg-white border border-[#E5E5E5] p-3 shadow-xl text-[10px] uppercase tracking-wider font-bold"
             style={{ left: mousePos.x + 15, top: mousePos.y + 15 }}>
          <div className="text-[#A0A0A0] mb-1">Längd: {Math.round(hoverPlank.w)} mm</div>
          <div className="text-[#D2B7AC]">{!hoverPlank.isCut ? 'Fabriksmått' : 'Anpassad'}</div>
        </div>
      )}

      {contextMenu && (
        <div className="fixed z-50 bg-white border border-[#E5E5E5] shadow-2xl py-1 min-w-[140px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => { setSettings({...settings, originPointIdx: contextMenu.pointIdx}); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-[9px] font-bold uppercase tracking-widest hover:bg-[#F9F9F9]">Välj som start</button>
          <button onClick={() => deletePoint(contextMenu.pointIdx)} className="w-full px-4 py-2 text-left text-[9px] font-bold uppercase tracking-widest text-red-600 hover:bg-[#FFF5F5]">Ta bort hörn</button>
        </div>
      )}

      <div className="absolute bottom-8 left-8 pointer-events-auto w-56">
        <div className="bg-white p-4 border border-[#E5E5E5] shadow-sm space-y-4">
          <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsLegendExpanded(!isLegendExpanded)}>
            <span className="text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em]">Förklaring</span>
            <svg className={`w-3 h-3 transition-transform ${isLegendExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="3"/></svg>
          </div>
          {isLegendExpanded && (
            <div className="space-y-2 pt-2 border-t border-[#F1F1F1] text-[9px] font-bold uppercase tracking-wider text-[#888]">
              <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-[#D2B7AC]/80"></div> Fulla plankor</div>
              <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-[#F5F1EF]"></div> Kapade bitar</div>
            </div>
          )}
          <div className="pt-2 border-t border-[#F1F1F1]">
            <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em] mb-1">Kontrast</label>
            <input type="range" min="0" max="1" step="0.1" value={settings.visualContrast} 
                   onChange={(e) => setSettings({...settings, visualContrast: parseFloat(e.target.value)})}
                   className="kahrs-slider" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Canvas;
