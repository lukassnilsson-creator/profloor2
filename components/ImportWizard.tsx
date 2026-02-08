
import React, { useState, useRef, useEffect } from 'react';
import { Point } from '../types';
import { getDistance } from '../geometry';
import { usePlanEditor } from '../hooks/usePlanEditor';

interface ImportWizardProps {
  initialFile: File | null;
  onComplete: (points: Point[]) => void;
  onCancel: () => void;
}

interface AISuggestion {
  points: { x: number, y: number }[];
  referenceWall?: {
    edgeIndex: number;
    lengthMm: number;
  };
}

interface ContextMenu {
  x: number;
  y: number;
  pointIdx: number;
}

const ImportWizard: React.FC<ImportWizardProps> = ({ initialFile, onComplete, onCancel }) => {
  const [step, setStep] = useState<'analyze' | 'refine'>('analyze');
  const [image, setImage] = useState<string | null>(null);
  const [detectedPoints, setDetectedPoints] = useState<Point[]>([]);
  const [selectedEdgeIdx, setSelectedEdgeIdx] = useState<number | null>(null);
  const [scaleValue, setScaleValue] = useState<number>(3000);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [gridSize, setGridSize] = useState(100);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [analysisSeconds, setAnalysisSeconds] = useState(0);
  const [editorScale, setEditorScale] = useState(1);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const analysisTimerRef = useRef<number | null>(null);

  const stopAnalysisTimer = () => {
    if (analysisTimerRef.current !== null) {
      window.clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
    }
  };

  const startAnalysisTimer = () => {
    stopAnalysisTimer();
    setAnalysisSeconds(0);
    analysisTimerRef.current = window.setInterval(() => {
      setAnalysisSeconds(s => s + 1);
    }, 1000);
  };

  const {
    hoverIdx,
    closestEdgeIdx,
    draggingIdx,
    handlePrimaryDown,
    handlePointerMove,
    handlePointerUp,
    deletePoint,
    clearInteractionState
  } = usePlanEditor({
    points: detectedPoints,
    setPoints: setDetectedPoints,
    snapToGrid,
    gridSize,
    interactionScale: editorScale
  });

  useEffect(() => () => stopAnalysisTimer(), []);

  const startImportFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const b64 = event.target?.result as string;
      imageRef.current = null;
      setImage(b64);
      setStep('analyze');
      setAnalysisError(null);
      runAIAnalysis(b64);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!initialFile) {
      onCancel();
      return;
    }
    startImportFromFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const runAIAnalysis = async (base64Image: string) => {
    startAnalysisTimer();
    setAnalysisError(null);
    try {
      const res = await fetch('/api/analyze-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image })
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Kunde inte tolka ritningen just nu.');
      }
      const result: AISuggestion = await res.json();
      
      const initialPoints = result.points.map(p => ({ x: p.x, y: p.y }));
      setDetectedPoints(initialPoints);
      
      if (result.referenceWall) {
        setSelectedEdgeIdx(result.referenceWall.edgeIndex);
        setScaleValue(result.referenceWall.lengthMm);
      } else {
        setSelectedEdgeIdx(0);
      }

      setStep('refine');
    } catch (error) {
      console.error("AI Analysis failed", error);
      setAnalysisError(error instanceof Error ? error.message : 'Kunde inte tolka ritningen. Försök igen.');
    } finally {
      stopAnalysisTimer();
    }
  };

  const getCanvasMousePos = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    return { x, y };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (contextMenu) { setContextMenu(null); return; }

    if (e.button !== 0) return;
    handlePrimaryDown(getCanvasMousePos(e));
  };

  const handleDeletePoint = (idx: number) => {
    deletePoint(idx);
    setContextMenu(null);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    handlePointerMove(getCanvasMousePos(e));
  };

  useEffect(() => {
    if (selectedEdgeIdx !== null && detectedPoints.length > 0 && selectedEdgeIdx >= detectedPoints.length) {
      setSelectedEdgeIdx(detectedPoints.length - 1);
    }
  }, [detectedPoints, selectedEdgeIdx]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  useEffect(() => {
    if (step !== 'refine') {
      clearInteractionState();
      setContextMenu(null);
    }
  }, [step]);

  useEffect(() => {
    if (!snapToGrid) return;
    if (gridSize < 10) {
      setGridSize(10);
    }
  }, [snapToGrid, gridSize]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    
    if (!imageRef.current) {
      const img = new Image();
      img.onload = () => { imageRef.current = img; draw(); };
      img.src = image;
    } else { 
      draw(); 
    }

    function draw() {
      const img = imageRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return; // TypeScript safety check

      const containerW = canvas.parentElement?.clientWidth || 800;
      const containerH = canvas.parentElement?.clientHeight || 600;
      const ratio = img.width / img.height;
      let drawW = containerW; 
      let drawH = containerW / ratio;
      
      if (drawH > containerH) { 
        drawH = containerH; 
        drawW = containerH * ratio; 
      }
      
      canvas.width = drawW; 
      canvas.height = drawH;
      const nextEditorScale = Math.max(0.0001, Math.min(drawW, drawH) / 1000);
      setEditorScale(prev => Math.abs(prev - nextEditorScale) > 0.0001 ? nextEditorScale : prev);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, drawW, drawH);
      
      const toPx = (p: Point) => ({ x: (p.x / 1000) * drawW, y: (p.y / 1000) * drawH });
      
      if (detectedPoints.length > 0) {
        ctx.beginPath();
        const start = toPx(detectedPoints[0]);
        ctx.moveTo(start.x, start.y);
        detectedPoints.slice(1).forEach(p => { const pt = toPx(p); ctx.lineTo(pt.x, pt.y); });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(210, 183, 172, 0.5)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = 'rgba(210, 183, 172, 0.15)'; ctx.fill();
        
        detectedPoints.forEach((p1_norm, i) => {
          const p2_norm = detectedPoints[(i + 1) % detectedPoints.length];
          const p1 = toPx(p1_norm); const p2 = toPx(p2_norm);
          const isSelected = selectedEdgeIdx === i;
          const isHover = closestEdgeIdx === i;
          if (isSelected || isHover) {
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = isSelected ? '#D2B7AC' : 'rgba(210, 183, 172, 0.8)';
            ctx.lineWidth = isSelected ? 6 : 4; ctx.stroke();
          }
        });
        
        detectedPoints.forEach((p_norm, i) => {
          const pt = toPx(p_norm); ctx.beginPath();
          ctx.arc(pt.x, pt.y, draggingIdx === i ? 8 : (hoverIdx === i ? 6 : 5), 0, Math.PI * 2);
          ctx.fillStyle = draggingIdx === i ? '#D2B7AC' : '#1A1A1A'; ctx.fill();
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.stroke();
        });
      }
    }
  }, [image, detectedPoints, step, selectedEdgeIdx, closestEdgeIdx, draggingIdx, hoverIdx, scaleValue]);

  const finalize = () => {
    if (selectedEdgeIdx === null || detectedPoints.length < 3) return;
    const p1 = detectedPoints[selectedEdgeIdx];
    const p2 = detectedPoints[(selectedEdgeIdx + 1) % detectedPoints.length];
    const normalizedDist = getDistance(p1, p2);
    const mmPerNormalizedUnit = scaleValue / normalizedDist;
    const firstPoint = detectedPoints[0];
    const mmPoints = detectedPoints.map(p => ({
      x: (p.x - firstPoint.x) * mmPerNormalizedUnit,
      y: (p.y - firstPoint.y) * mmPerNormalizedUnit
    }));
    onComplete(mmPoints);
  };

  const getReferenceOverlayPosition = () => {
    if (selectedEdgeIdx === null || detectedPoints.length < 2) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const p1 = detectedPoints[selectedEdgeIdx];
    const p2 = detectedPoints[(selectedEdgeIdx + 1) % detectedPoints.length];
    const midX = ((p1.x + p2.x) / 2000) * canvas.width;
    const midY = ((p1.y + p2.y) / 2000) * canvas.height;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const edgeLength = Math.hypot(dx, dy) || 1;
    const nx = -dy / edgeLength;
    const ny = dx / edgeLength;
    const labelOffset = 30;

    return {
      left: canvas.offsetLeft + midX + nx * labelOffset,
      top: canvas.offsetTop + midY + ny * labelOffset
    };
  };

  const referenceOverlayPos = step === 'refine' ? getReferenceOverlayPosition() : null;

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-4 md:p-10">
      <div className="max-w-5xl w-full h-full flex flex-col bg-white overflow-hidden shadow-2xl border border-[#E5E5E5]">
        <header className="p-6 md:p-8 border-b border-[#F1F1F1] flex justify-between items-center">
          <div>
            <h2 className="serif text-xl md:text-2xl font-bold">Importera Ritning</h2>
            <p className="text-[9px] md:text-[10px] text-[#A0A0A0] uppercase tracking-widest mt-1">Automatisk tolkning av ritning</p>
          </div>
          <button onClick={onCancel} className="text-[10px] font-bold uppercase tracking-widest text-[#A0A0A0] hover:text-[#1A1A1A]">Avbryt</button>
        </header>

        <div className="flex-1 overflow-hidden relative bg-[#FBFBFB] flex items-center justify-center p-4">
          {step === 'analyze' && (
            <div className="text-center space-y-6">
              {!analysisError && (
                <>
                  <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                    <div className="absolute inset-0 border-2 border-[#D2B7AC]/20 rounded-full"></div>
                    <div className="absolute inset-0 border-2 border-[#D2B7AC] border-t-transparent rounded-full animate-spin"></div>
                    <div className="relative text-[10px] font-bold text-[#1A1A1A]">{analysisSeconds}s</div>
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]">Tolkar ritning…</p>
                </>
              )}
              {analysisError && (
                <div className="space-y-3 max-w-md">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">Kunde inte tolka ritningen</p>
                  <p className="text-[10px] text-[#666] leading-relaxed">{analysisError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (image) {
                        runAIAnalysis(image);
                      }
                    }}
                    className="px-6 py-2 bg-[#1A1A1A] text-white text-[10px] font-bold uppercase tracking-widest hover:bg-[#333] transition-colors"
                  >
                    Försök igen
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'refine' && (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              <div className="absolute top-4 right-4 z-20 flex items-center gap-3 bg-white/95 border border-[#E5E5E5] px-3 py-1.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-bold text-[#A0A0A0] uppercase tracking-widest">Grid</span>
                  <input
                    type="number"
                    value={gridSize}
                    onChange={(e) => setGridSize(Math.max(10, parseInt(e.target.value, 10) || 10))}
                    className="w-10 h-6 bg-white border border-[#E5E5E5] text-[9px] font-bold text-center focus:outline-none focus:border-[#D2B7AC]"
                  />
                </div>
                <div className="w-px h-3 bg-[#E5E5E5]"></div>
                <button
                  onClick={() => setSnapToGrid(!snapToGrid)}
                  className={`flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest transition-colors ${snapToGrid ? 'text-[#1A1A1A]' : 'text-[#A0A0A0]'}`}
                >
                  <div className={`w-2.5 h-2.5 border ${snapToGrid ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-[#E5E5E5]'}`}></div>
                  Snap
                </button>
              </div>

              <canvas 
                ref={canvasRef} 
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (closestEdgeIdx !== null) {
                    setSelectedEdgeIdx(closestEdgeIdx);
                    setContextMenu(null);
                    return;
                  }
                  if (hoverIdx !== null) setContextMenu({ x: e.clientX, y: e.clientY, pointIdx: hoverIdx });
                }}
                className="shadow-2xl border border-[#E5E5E5] max-w-full max-h-full object-contain"
                style={{ cursor: draggingIdx !== null ? 'grabbing' : hoverIdx !== null ? 'pointer' : closestEdgeIdx !== null ? 'copy' : 'crosshair' }}
              />

              {referenceOverlayPos && (
                <div
                  className="absolute z-30 bg-white border border-[#D2B7AC] shadow-md px-3 py-2"
                  style={{ left: referenceOverlayPos.left, top: referenceOverlayPos.top, transform: 'translate(-50%, -120%)' }}
                >
                  <label className="block text-[8px] font-bold text-[#A0A0A0] uppercase tracking-widest mb-1">Referens</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={scaleValue}
                      onChange={(e) => setScaleValue(parseInt(e.target.value, 10) || 0)}
                      className="w-20 bg-transparent border-b border-[#1A1A1A] text-[11px] font-bold text-[#1A1A1A] focus:outline-none"
                    />
                    <span className="text-[9px] font-bold text-[#1A1A1A] uppercase tracking-widest">mm</span>
                  </div>
                  <div className="text-[8px] font-bold text-[#D2B7AC] uppercase tracking-wider mt-1">Referens: {scaleValue} mm</div>
                </div>
              )}

              {contextMenu && (
                <div className="fixed z-50 bg-white border border-[#E5E5E5] shadow-2xl py-1 min-w-[140px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
                  <button onClick={() => handleDeletePoint(contextMenu.pointIdx)} className="w-full px-4 py-2 text-left text-[9px] font-bold uppercase tracking-widest text-red-600 hover:bg-[#FFF5F5]">Ta bort hörn</button>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="p-6 md:p-8 border-t border-[#F1F1F1] bg-white">
          {step === 'refine' && (
            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="space-y-2 max-w-md">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#1A1A1A]"></div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]">Verifiera skala</span>
                </div>
                <p className="text-[10px] text-[#888] leading-relaxed uppercase tracking-wider">
                  Dra hörn för att flytta, klicka nära kant för att lägga till hörn, högerklicka hörn för att ta bort. Hovra en kant och högerklicka för att välja referenskant.
                </p>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-6">
                <button 
                  onClick={finalize}
                  disabled={selectedEdgeIdx === null || detectedPoints.length < 3}
                  className="px-10 py-4 bg-[#1A1A1A] text-white text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-[#333] transition-all disabled:opacity-20 shadow-lg"
                >
                  Importera
                </button>
              </div>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
};

export default ImportWizard;
