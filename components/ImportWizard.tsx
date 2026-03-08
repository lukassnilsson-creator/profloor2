
import React, { useState, useRef, useEffect } from 'react';
import { Point, ImportedDrawingBackground } from '../types';
import { getDistance } from '../geometry';
import { usePlanEditor } from '../hooks/usePlanEditor';
import { addOrInsertPoint, forceSnapPointTo90 } from '../pointEditing';

interface ImportWizardProps {
  initialFile: File | null;
  onComplete: (points: Point[], backgroundDrawing: ImportedDrawingBackground | null) => void;
  onCancel: () => void;
  onAnalysisCancelled?: () => void;
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
  kind: 'point' | 'edge';
  pointIdx?: number;
  edgeIdx?: number;
  cursor?: Point;
}

// Must match --pf-sidebar-w in index.css
const SIDEBAR_W = 400;

const ImportWizard: React.FC<ImportWizardProps> = ({ initialFile, onComplete, onCancel, onAnalysisCancelled }) => {
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
    if (!initialFile) { onCancel(); return; }
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
      console.error('AI Analysis failed', error);
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

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    handlePointerMove(getCanvasMousePos(e));
  };

  const handleDeletePoint = (idx: number) => {
    deletePoint(idx);
    setContextMenu(null);
  };

  const handleAddPoint = (edgeIdx: number, cursor: Point) => {
    const nextPoints = addOrInsertPoint(detectedPoints, cursor, edgeIdx, snapToGrid, gridSize);
    if (nextPoints) setDetectedPoints(nextPoints);
    setContextMenu(null);
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
    if (gridSize < 10) setGridSize(10);
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
      if (!ctx) return;

      const containerW = canvas.parentElement?.clientWidth || 800;
      const containerH = canvas.parentElement?.clientHeight || 600;
      const ratio = img.width / img.height;
      let drawW = containerW;
      let drawH = containerW / ratio;
      if (drawH > containerH) { drawH = containerH; drawW = containerH * ratio; }

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
          const pt = toPx(p_norm);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, draggingIdx === i ? 8 : (hoverIdx === i ? 6 : 5), 0, Math.PI * 2);
          ctx.fillStyle = draggingIdx === i ? '#D2B7AC' : '#1A1A1A'; ctx.fill();
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.stroke();
        });
      }
    }
  }, [image, detectedPoints, step, selectedEdgeIdx, closestEdgeIdx, draggingIdx, hoverIdx, scaleValue]);

  const finalize = () => {
    if (selectedEdgeIdx === null || detectedPoints.length < 3) return;
    const imageWidth = imageRef.current?.naturalWidth || canvasRef.current?.width || 1000;
    const imageHeight = imageRef.current?.naturalHeight || canvasRef.current?.height || 1000;
    const toImageSpace = (point: Point) => ({
      x: (point.x / 1000) * imageWidth,
      y: (point.y / 1000) * imageHeight
    });

    const p1 = toImageSpace(detectedPoints[selectedEdgeIdx]);
    const p2 = toImageSpace(detectedPoints[(selectedEdgeIdx + 1) % detectedPoints.length]);
    const referenceDist = getDistance(p1, p2);
    if (referenceDist <= 0) return;
    const mmPerImageUnit = scaleValue / referenceDist;

    const firstPoint = detectedPoints[0];
    const firstPointImage = toImageSpace(firstPoint);
    const mmPoints = detectedPoints.map(p => ({
      x: (toImageSpace(p).x - firstPointImage.x) * mmPerImageUnit,
      y: (toImageSpace(p).y - firstPointImage.y) * mmPerImageUnit
    }));

    const backgroundDrawing: ImportedDrawingBackground | null = image ? {
      src: image,
      x: -firstPointImage.x * mmPerImageUnit,
      y: -firstPointImage.y * mmPerImageUnit,
      width: imageWidth * mmPerImageUnit,
      height: imageHeight * mmPerImageUnit
    } : null;

    onComplete(mmPoints, backgroundDrawing);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col">
      {/* Topbar area — grayed out, non-interactive */}
      <div
        className="h-[102px] sm:h-[114px] flex-shrink-0 bg-black/40"
        style={{ pointerEvents: 'none' }}
        aria-hidden="true"
      />

      {/* Content row */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar area — grayed out, non-interactive */}
        <div
          className="flex-shrink-0 bg-black/40"
          style={{ width: `${SIDEBAR_W}px`, pointerEvents: 'none' }}
          aria-hidden="true"
        />

        {/* Active canvas area */}
        <div className="flex flex-1 min-w-0 min-h-0 flex-col bg-[#FBFBFB]">

          {/* Header */}
          <div className="flex-shrink-0 px-6 py-4 border-b border-[#F1F1F1] bg-white flex items-center justify-between">
            <div>
              <h2 className="pf-action-heading text-sm font-bold text-[#1A1A1A]">Importera ritning</h2>
              <p className="text-[9px] text-[#A0A0A0] uppercase tracking-widest mt-0.5">Automatisk tolkning av planlösning</p>
            </div>
            <button
              onClick={() => { if (step === 'analyze') onAnalysisCancelled?.(); onCancel(); }}
              className="pf-action-heading text-[9px] font-bold uppercase tracking-widest text-[#A0A0A0] hover:text-[#1A1A1A] transition-colors"
            >
              Avbryt
            </button>
          </div>

          {/* Main content */}
          <div className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center">

            {step === 'analyze' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
                {/* Skeleton floor outline */}
                <svg
                  width="280" height="190"
                  viewBox="0 0 280 190"
                  fill="none"
                  className="flex-shrink-0 opacity-[0.15] animate-pulse"
                  aria-hidden="true"
                >
                  {/* L-shaped room outline */}
                  <polygon
                    points="24,22 256,22 256,100 156,100 156,168 24,168"
                    stroke="#1A1A1A" strokeWidth="2" fill="rgba(0,0,0,0.04)"
                  />
                  {/* Plank row lines */}
                  {[44,62,80,98,116,134,152].map((y) => (
                    <line
                      key={y}
                      x1="26" y1={y}
                      x2={y >= 100 ? 154 : 254} y2={y}
                      stroke="#1A1A1A" strokeWidth="0.8" strokeDasharray="6 3"
                    />
                  ))}
                  {/* Plank joint lines (vertical) */}
                  {[80,160,220].map((x) => (
                    <line key={x} x1={x} y1="22" x2={x} y2={x > 154 ? 100 : 95} stroke="#1A1A1A" strokeWidth="0.5" strokeDasharray="3 3" />
                  ))}
                </svg>

                {!analysisError && (
                  <div className="text-center space-y-5 px-6 max-w-sm">
                    <div className="relative w-14 h-14 mx-auto flex items-center justify-center">
                      <div className="absolute inset-0 border-2 border-[#D2B7AC]/20 rounded-full" />
                      <div className="absolute inset-0 border-2 border-[#D2B7AC] border-t-transparent rounded-full animate-spin" />
                      <div className="relative text-[10px] font-bold text-[#1A1A1A]">{analysisSeconds}s</div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]">Tolkar ritning…</p>
                      <p className="mt-2 text-[9px] text-[#A0A0A0] leading-relaxed">
                        AI-analysen tar vanligtvis <span className="font-semibold text-[#6A6A6A]">ca 30 sekunder</span> att slutföra. Håll fönstret öppet under tiden.
                      </p>
                    </div>
                  </div>
                )}

                {analysisError && (
                  <div className="text-center space-y-3 max-w-sm px-6">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">Kunde inte tolka ritningen</p>
                    <p className="text-[10px] text-[#666] leading-relaxed">{analysisError}</p>
                    <button
                      type="button"
                      onClick={() => { if (image) runAIAnalysis(image); }}
                      className="pf-action-heading px-6 py-2 bg-[#1A1A1A] text-white font-bold uppercase tracking-widest hover:bg-[#333] transition-colors"
                    >
                      Försök igen
                    </button>
                  </div>
                )}
              </div>
            )}

            {step === 'refine' && (
              <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handlePointerUp}
                  onMouseLeave={handlePointerUp}
                  onDoubleClick={() => {
                    if (hoverIdx !== null) {
                      const snapped = forceSnapPointTo90(detectedPoints, hoverIdx);
                      if (snapped !== detectedPoints) setDetectedPoints(snapped);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const cursor = getCanvasMousePos(e);
                    if (hoverIdx !== null) {
                      setContextMenu({ x: e.clientX, y: e.clientY, kind: 'point', pointIdx: hoverIdx });
                    } else if (closestEdgeIdx !== null) {
                      setContextMenu({ x: e.clientX, y: e.clientY, kind: 'edge', edgeIdx: closestEdgeIdx, cursor });
                    }
                  }}
                  className="shadow-2xl border border-[#E5E5E5] max-w-full max-h-full object-contain"
                  style={{ cursor: draggingIdx !== null ? 'grabbing' : hoverIdx !== null ? 'pointer' : 'crosshair' }}
                />

                {contextMenu && (
                  <div
                    className="fixed z-50 bg-white border border-[#E5E5E5] shadow-2xl py-1 min-w-[160px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {contextMenu.kind === 'edge' && (
                      <>
                        <button
                          onClick={() => handleAddPoint(contextMenu.edgeIdx!, contextMenu.cursor!)}
                          className="w-full px-4 py-2 text-left text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A] hover:bg-[#F6F2EF]"
                        >
                          Lägg till punkt
                        </button>
                        <button
                          onClick={() => { setSelectedEdgeIdx(contextMenu.edgeIdx!); setContextMenu(null); }}
                          className="w-full px-4 py-2 text-left text-[9px] font-bold uppercase tracking-widest text-[#1A1A1A] hover:bg-[#F6F2EF]"
                        >
                          Välj som referenskant
                        </button>
                      </>
                    )}
                    {contextMenu.kind === 'point' && detectedPoints.length > 3 && (
                      <button
                        onClick={() => handleDeletePoint(contextMenu.pointIdx!)}
                        className="w-full px-4 py-2 text-left text-[9px] font-bold uppercase tracking-widest text-red-600 hover:bg-[#FFF5F5]"
                      >
                        Ta bort hörn
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {step === 'refine' && (
            <div className="flex-shrink-0 px-6 py-4 border-t border-[#F1F1F1] bg-white flex items-center justify-between gap-6">
              <div className="flex items-center gap-6 min-w-0">
                <p className="text-[9px] text-[#888] uppercase tracking-wider leading-relaxed hidden md:block">
                  Dra hörn för att justera · Högerklicka kant för att lägga till punkt · Högerklicka hörn för att ta bort
                </p>
                <div className="flex-shrink-0 border border-[#D2B7AC] bg-white px-4 py-2.5">
                  <label className="block text-[8px] font-bold text-[#A0A0A0] uppercase tracking-widest mb-1.5">
                    Referenskantens längd
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={scaleValue}
                      onChange={(e) => setScaleValue(parseInt(e.target.value, 10) || 0)}
                      className="w-24 bg-transparent border-b border-[#1A1A1A] text-[13px] font-bold text-[#1A1A1A] focus:outline-none"
                    />
                    <span className="text-[9px] font-bold text-[#1A1A1A] uppercase tracking-widest">mm</span>
                  </div>
                  {selectedEdgeIdx !== null && (
                    <p className="text-[8px] text-[#D2B7AC] uppercase tracking-wider mt-1">
                      Kant {selectedEdgeIdx + 1} vald
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={finalize}
                disabled={selectedEdgeIdx === null || detectedPoints.length < 3}
                className="pf-action-heading flex-shrink-0 px-10 py-4 bg-[#1A1A1A] text-white text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-[#333] transition-all disabled:opacity-20 shadow-lg"
              >
                Importera
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportWizard;
