import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Point, PlankSettings, PlankInstance, WastePiece } from '../types';
import { getDistance, isGeometricallyPossible, movePointByLength, findClosestEdge, snapToAngle, isPointInPolygon } from '../geometry';

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

  // Kährs Palette from image
  const factoryColor = { r: 210, g: 183, b: 172 }; // Accent beige from thumb
  const cutColorBase = { r: 245, g: 241, b: 239 }; // Light cream

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { 
      if (e.key === 'Shift') setSnapModifierActive(true); 
    };
    const handleKeyUp = (e: KeyboardEvent) => { 
      if (e.key === 'Shift') setSnapModifierActive(false); 
    };
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

  const getAngleAtVertex = (idx: number, pts: Point[]): { angle: number, labelPos: Point } => {
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
    let angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
    
    const n1 = { x: v1.x / mag1, y: v1.y / mag1 };
    const n2 = { x: v2.x / mag2, y: v2.y / mag2 };
    let bisector = { x: n1.x + n2.x, y: n1.y + n2.y };
    const bMag = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
    
    if (bMag < 0.001) {
      bisector = { x: -n1.y, y: n1.x };
    } else {
      bisector.x /= bMag;
      bisector.y /= bMag;
    }

    const testPoint = { x: p.x + bisector.x * 5, y: p.y + bisector.y * 5 };
    if (isPointInPolygon(testPoint, pts)) {
      bisector.x = -bisector.x;
      bisector.y = -bisector.y;
    }

    return { 
      angle: (angleRad * 180) / Math.PI, 
      labelPos: { x: p.x + bisector.x * 35, y: p.y + bisector.y * 35 } 
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth || 800;
      canvas.height = canvas.parentElement?.clientHeight || 600;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2 + offset.x;
      const centerY = canvas.height / 2 + offset.y;

      ctx.strokeStyle = '#F3F3F3';
      ctx.lineWidth = 1;
      const visualGridSize = gridSize * scale;
      if (visualGridSize > 4) {
        for (let x = (centerX % visualGridSize); x < canvas.width; x += visualGridSize) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
        }
        for (let y = (centerY % visualGridSize); y < canvas.height; y += visualGridSize) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
        }
      }

      if (points.length >= 3) {
        ctx.save();
        ctx.translate(centerX, centerY);
        
        wastePieces.forEach(wp => {
          ctx.fillStyle = 'rgba(210, 183, 172, 0.06)';
          ctx.strokeStyle = 'rgba(210, 183, 172, 0.15)';
          ctx.lineWidth = 0.5;
          ctx.fillRect(wp.x * scale, wp.y * scale, wp.w * scale, wp.h * scale);
          ctx.strokeRect(wp.x * scale, wp.y * scale, wp.w * scale, wp.h * scale);
        });

        const contrast = settings.visualContrast;
        planks.forEach(p => {
          const isHighlighted = highlightedPlankIds.has(p.id);
          const isDirectHover = hoverPlank === p;
          const isFullLength = !p.isCut;
          
          let r, g, b, alpha;

          if (isFullLength) {
            r = factoryColor.r; g = factoryColor.g; b = factoryColor.b;
            alpha = 0.4 + (contrast * 0.5); 
          } else {
            const lerpVal = (start: number, end: number, t: number) => start + (end - start) * t;
            r = lerpVal(factoryColor.r, cutColorBase.r, contrast);
            g = lerpVal(factoryColor.g, cutColorBase.g, contrast);
            b = lerpVal(factoryColor.b, cutColorBase.b, contrast);
            alpha = 0.4 - (contrast * 0.2);
          }

          if (isHighlighted) {
            ctx.fillStyle = isDirectHover ? `rgba(210, 183, 172, 0.95)` : `rgba(210, 183, 172, 0.6)`;
          } else {
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          }
          
          ctx.fillRect(p.x * scale, p.y * scale, p.w * scale, p.h * scale);
          ctx.strokeStyle = isHighlighted ? '#D2B7AC' : 'rgba(0,0,0,0.18)';
          ctx.lineWidth = isHighlighted ? 2 : 0.8;
          ctx.strokeRect(p.x * scale, p.y * scale, p.w * scale, p.h * scale);

          if (isFullLength && scale > 0.03) {
             ctx.fillStyle = isHighlighted ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.1)';
             ctx.font = '7px Inter';
             ctx.fillText('•', p.x * scale + 5, p.y * scale + 10);
          }
        });
        ctx.restore();
      }

      ctx.save();
      ctx.translate(centerX, centerY);

      if (points.length > 0) {
        if (points.length >= 3) {
           ctx.beginPath();
           ctx.moveTo(points[0].x * scale, points[0].y * scale);
           points.slice(1).forEach(p => ctx.lineTo(p.x * scale, p.y * scale));
           ctx.closePath();
           ctx.fillStyle = 'rgba(0, 0, 0, 0.01)';
           ctx.fill();
        }

        for (let i = 0; i < points.length; i++) {
          const p1 = points[i];
          const p2 = points[(i + 1) % points.length];
          ctx.beginPath();
          ctx.lineWidth = (closestEdgeIdx === i && points.length >= 4) ? 3 : 1.5;
          ctx.strokeStyle = (impossibleEdge === i) ? '#CC0000' : (closestEdgeIdx === i && points.length >= 4) ? '#333333' : '#2D2D2D';
          ctx.moveTo(p1.x * scale, p1.y * scale);
          ctx.lineTo(p2.x * scale, p2.y * scale);
          ctx.stroke();
        }

        points.forEach((p, idx) => {
          const isOrigin = settings.originPointIdx === idx;
          ctx.beginPath();
          ctx.arc(p.x * scale, p.y * scale, idx === hoverIdx ? 5 : 3.5, 0, Math.PI * 2);
          ctx.fillStyle = isOrigin ? '#1A1A1A' : (idx === hoverIdx ? '#333333' : '#FFFFFF');
          ctx.fill();
          ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 1; ctx.stroke();

          if (isOrigin) {
             ctx.beginPath();
             ctx.arc(p.x * scale, p.y * scale, 7, 0, Math.PI * 2);
             ctx.strokeStyle = '#D2B7AC'; ctx.lineWidth = 1.5; ctx.stroke();
          }

          if (draggingIdx === idx) {
            const { angle, labelPos } = getAngleAtVertex(idx, points);
            ctx.save();
            ctx.font = '600 12px Inter';
            ctx.fillStyle = '#1A1A1A';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${Math.round(angle)}°`, labelPos.x * scale, labelPos.y * scale);
            ctx.restore();
          }
        });
      }
      ctx.restore();
    };

    let raf: number;
    const render = () => { draw(); raf = requestAnimationFrame(render); };
    render();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(raf); };
  }, [points, hoverIdx, hoverPlank, highlightedPlankIds, closestEdgeIdx, scale, offset, planks, wastePieces, impossibleEdge, snapModifierActive, draggingIdx, settings.visualContrast, settings.originPointIdx, gridSize]);

  const applySnap = (x: number, y: number) => {
    if (!snapToGrid) return { x, y };
    return {
      x: Math.round(x / gridSize) * gridSize,
      y: Math.round(y / gridSize) * gridSize
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (contextMenu) { setContextMenu(null); return; }
    if (hoverIdx !== null) { if (e.button === 0) setDraggingIdx(hoverIdx); return; }
    if (e.button === 0) {
      const canvas = canvasRef.current; if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      let x = (e.clientX - rect.left - canvas.width / 2 - offset.x) / scale;
      let y = (e.clientY - rect.top - canvas.height / 2 - offset.y) / scale;
      
      const snapped = applySnap(x, y);
      x = snapped.x; y = snapped.y;

      if (snapModifierActive && points.length > 0) {
        const angleSnapped = snapToAngle({ x, y }, points[points.length - 1]);
        x = angleSnapped.x; y = angleSnapped.y;
      }
      
      if (points.length < 4) { setPoints([...points, { x, y }]); } 
      else if (closestEdgeIdx !== null) { const n = [...points]; n.splice(closestEdgeIdx + 1, 0, { x, y }); setPoints(n); } 
      else { setIsPanning(true); setLastPanPos({ x: e.clientX, y: e.clientY }); }
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
    let mx = (e.clientX - rect.left - canvas.width / 2 - offset.x) / scale;
    let my = (e.clientY - rect.top - canvas.height / 2 - offset.y) / scale;
    
    if (draggingIdx !== null) {
      let finalX = mx, finalY = my;
      const snapped = applySnap(mx, my);
      finalX = snapped.x; finalY = snapped.y;

      if (snapModifierActive) {
        const prevIdx = (draggingIdx - 1 + points.length) % points.length;
        const nextIdx = (draggingIdx + 1) % points.length;
        const snappedPrev = snapToAngle({ x: mx, y: my }, points[prevIdx]);
        const snappedNext = snapToAngle({ x: mx, y: my }, points[nextIdx]);
        const distPrev = getDistance({ x: mx, y: my }, snappedPrev);
        const distNext = getDistance({ x: mx, y: my }, snappedNext);
        if (distPrev <= distNext) { finalX = snappedPrev.x; finalY = snappedPrev.y; } else { finalX = snappedNext.x; finalY = snappedNext.y; }
      }
      const n = [...points]; n[draggingIdx] = { x: finalX, y: finalY }; setPoints(n); return; 
    }
    let fp = null;
    for (let i = 0; i < points.length; i++) if (getDistance({ x: mx, y: my }, points[i]) < 15 / scale) { fp = i; break; }
    setHoverIdx(fp);
    let fpl = null;
    if (points.length >= 3) for (const p of planks) if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h) { fpl = p; break; }
    setHoverPlank(fpl);
    if (points.length >= 4 && fp === null) { const edge = findClosestEdge({ x: mx, y: my }, points); setClosestEdgeIdx(edge.distance < 30 / scale ? edge.index : null); } else setClosestEdgeIdx(null);
  };

  const handleMouseUp = () => { setDraggingIdx(null); setIsPanning(false); };
  const handleContextMenu = (e: React.MouseEvent) => { e.preventDefault(); if (hoverIdx !== null) setContextMenu({ x: e.clientX, y: e.clientY, pointIdx: hoverIdx }); };
  const deletePoint = (idx: number) => { 
    setPoints(points.filter((_, i) => i !== idx)); 
    if (settings.originPointIdx === idx) setSettings({...settings, originPointIdx: 0});
    setContextMenu(null); 
  };
  const setOriginPoint = (idx: number) => { setSettings({ ...settings, originPointIdx: idx }); setContextMenu(null); };

  const handleEdgeLengthChange = (idx: number, val: string) => {
    const v = parseFloat(val); if (isNaN(v) || v <= 0) return;
    const l = [...edgeLengths]; l[idx] = v;
    if (isGeometricallyPossible(l)) { setImpossibleEdge(null); setPoints(movePointByLength(points, idx, v)); } else setImpossibleEdge(idx);
  };

  const getCursor = () => { if (isPanning) return 'grabbing'; if (hoverIdx !== null || draggingIdx !== null) return 'pointer'; if (closestEdgeIdx !== null && points.length >= 4) return 'copy'; if (points.length < 4) return 'crosshair'; return 'grab'; };

  const contrast = settings.visualContrast;
  const lerpVal = (start: number, end: number, t: number) => start + (end - start) * t;

  return (
    <div className="relative flex-1 bg-[#FBFBFB] overflow-hidden" onContextMenu={handleContextMenu} style={{ cursor: getCursor() }}>
      <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} className="w-full h-full" />
      
      {showEdgeLengths && points.length >= 2 && points.map((p1, i) => {
        const p2 = points[(i + 1) % points.length];
        const canvas = canvasRef.current; if (!canvas) return null;
        const sx = ((p1.x + p2.x) / 2) * scale + canvas.width / 2 + offset.x;
        const sy = ((p1.y + p2.y) / 2) * scale + canvas.height / 2 + offset.y;
        if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) return null;
        return (
          <div key={`edge-${i}`} className="absolute -translate-x-1/2 -translate-y-1/2 z-20" style={{ left: sx, top: sy }} onMouseDown={(e) => e.stopPropagation()}>
            <input 
              type="number" 
              value={Math.round(edgeLengths[i])} 
              onChange={(e) => handleEdgeLengthChange(i, e.target.value)} 
              className={`w-14 h-6 bg-white border ${impossibleEdge === i ? 'border-red-500' : 'border-[#E5E5E5]'} text-[#333] text-[9px] font-bold text-center focus:outline-none shadow-sm transition-all focus:border-[#D2B7AC]`} 
            />
          </div>
        );
      })}

      {hoverPlank && !isPanning && (
        <div className="fixed z-50 pointer-events-none bg-white border border-[#E5E5E5] text-[#1A1A1A] px-4 py-3 shadow-xl text-[10px] min-w-[140px]" style={{ left: mousePos.x + 20, top: mousePos.y + 20 }}>
          <div className="flex justify-between font-bold mb-1 uppercase tracking-wider"><span>Längd</span><span>{hoverPlank.w.toFixed(0)} mm</span></div>
          <div className="text-[#D2B7AC] font-black uppercase tracking-widest">{!hoverPlank.isCut ? 'Fabrikslängd' : 'Anpassad bit'}</div>
        </div>
      )}

      {impossibleEdge !== null && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-white border border-red-500 text-red-600 px-6 py-2 shadow-lg text-[10px] font-black uppercase tracking-widest z-30">
          Ogiltig geometri
        </div>
      )}

      {contextMenu && (
        <div className="fixed z-50 bg-white border border-[#E5E5E5] shadow-xl py-1 min-w-[150px]" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => setOriginPoint(contextMenu.pointIdx)} className="w-full px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[#333] hover:bg-[#F9F9F9]">Välj som startpunkt</button>
          <button onClick={() => deletePoint(contextMenu.pointIdx)} className="w-full px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-red-600 hover:bg-[#FFF5F5]">Ta bort hörn</button>
        </div>
      )}

      <div className="absolute bottom-10 left-10 pointer-events-none space-y-4 z-10 w-[240px]">
        <div className="bg-white p-5 border border-[#E5E5E5] shadow-sm flex flex-col gap-4 pointer-events-auto overflow-hidden transition-all duration-300">
           
           <div className="flex justify-between items-center group cursor-pointer" onClick={() => setIsLegendExpanded(!isLegendExpanded)}>
              <span className="text-[9px] text-[#A0A0A0] font-bold uppercase tracking-[0.2em]">Visuell Finish</span>
              <button className="text-[#A0A0A0] group-hover:text-[#1A1A1A] transition-colors">
                <svg className={`w-3 h-3 transform transition-transform ${isLegendExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"/></svg>
              </button>
           </div>

           {isLegendExpanded && (
             <div className="flex flex-col gap-3 pt-2 text-[9px] text-[#888] font-bold uppercase tracking-[0.1em] border-t border-[#F1F1F1]">
               <div className="flex items-center gap-3">
                 <div className="w-3 h-3 border border-black/20" style={{ background: `rgba(${factoryColor.r}, ${factoryColor.g}, ${factoryColor.b}, ${0.4 + contrast * 0.5})` }}></div> 
                 Hellängder
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-3 h-3 border border-black/20" style={{ background: `rgba(${lerpVal(factoryColor.r, cutColorBase.r, contrast)}, ${lerpVal(factoryColor.g, cutColorBase.g, contrast)}, ${lerpVal(factoryColor.b, cutColorBase.b, contrast)}, ${0.4 - contrast * 0.2})` }}></div> 
                 Anpassade bitar
               </div>
               <div className="flex items-center gap-3">
                 <div className="w-3 h-3 bg-[#D2B7AC] opacity-10 border border-[#D2B7AC]"></div> 
                 Spillbitar
               </div>
             </div>
           )}
           
           <div className={`pt-2 ${isLegendExpanded ? 'border-t border-[#F1F1F1]' : ''} space-y-1`}>
             <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em]">Kontrast</label>
             <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05"
                value={settings.visualContrast}
                onChange={(e) => setSettings({ ...settings, visualContrast: parseFloat(e.target.value) })}
                className="kahrs-slider"
              />
              <div className="flex justify-between text-[10px] text-[#444] font-medium">
                <span className="opacity-60">Subtil</span>
                <span>Maximerad</span>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Canvas;
