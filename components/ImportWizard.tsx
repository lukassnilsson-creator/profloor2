
import React, { useState, useRef, useEffect } from 'react';
import { Point } from '../types';
import { getDistance, getDistanceToSegment } from '../geometry';

interface ImportWizardProps {
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

const ImportWizard: React.FC<ImportWizardProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<'upload' | 'analyze' | 'refine'>('upload');
  const [image, setImage] = useState<string | null>(null);
  const [detectedPoints, setDetectedPoints] = useState<Point[]>([]);
  const [selectedEdgeIdx, setSelectedEdgeIdx] = useState<number | null>(null);
  const [hoverEdgeIdx, setHoverEdgeIdx] = useState<number | null>(null);
  const [scaleValue, setScaleValue] = useState<number>(3000);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const [imgDisplaySize, setImgDisplaySize] = useState({ w: 0, h: 0 });
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const b64 = event.target?.result as string;
      setImage(b64);
      setStep('analyze');
      runAIAnalysis(b64);
    };
    reader.readAsDataURL(file);
  };

  const runAIAnalysis = async (base64Image: string) => {
    try {
      const res = await fetch('/api/analyze-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image })
      });

      if (!res.ok) throw new Error('AI analysis failed on server');
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
      alert("Kunde inte tolka bilden via servern. Kontrollera nätverket eller försök med en annan bild.");
      onCancel();
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
    const pos = getCanvasMousePos(e);
    const hitRadius = 25; 
    const cornerIdx = detectedPoints.findIndex(p => getDistance(p, pos) < hitRadius);
    if (cornerIdx !== -1) {
      setIsDragging(cornerIdx);
    } else {
      let minEdgeDist = Infinity;
      let closestEdge = -1;
      for (let i = 0; i < detectedPoints.length; i++) {
        const p1 = detectedPoints[i];
        const p2 = detectedPoints[(i + 1) % detectedPoints.length];
        const dist = getDistanceToSegment(pos, p1, p2);
        if (dist < minEdgeDist) {
          minEdgeDist = dist;
          closestEdge = i;
        }
      }
      if (minEdgeDist < 30) setSelectedEdgeIdx(closestEdge);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const pos = getCanvasMousePos(e);
    if (isDragging !== null) {
      const newPoints = [...detectedPoints];
      newPoints[isDragging] = pos;
      setDetectedPoints(newPoints);
    } else {
      let minEdgeDist = Infinity;
      let closestEdge = -1;
      for (let i = 0; i < detectedPoints.length; i++) {
        const p1 = detectedPoints[i];
        const p2 = detectedPoints[(i + 1) % detectedPoints.length];
        const dist = getDistanceToSegment(pos, p1, p2);
        if (dist < minEdgeDist) {
          minEdgeDist = dist;
          closestEdge = i;
        }
      }
      setHoverEdgeIdx(minEdgeDist < 30 ? closestEdge : null);
    }
  };

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
      setImgDisplaySize({ w: drawW, h: drawH });
      
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
          const isHover = hoverEdgeIdx === i;
          if (isSelected || isHover) {
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = isSelected ? '#D2B7AC' : 'rgba(210, 183, 172, 0.8)';
            ctx.lineWidth = isSelected ? 6 : 4; ctx.stroke();
            if (isSelected) {
              const midX = (p1.x + p2.x) / 2; const midY = (p1.y + p2.y) / 2;
              ctx.fillStyle = '#1A1A1A'; ctx.font = 'bold 10px Inter'; ctx.textAlign = 'center';
              ctx.fillText(`${scaleValue} mm`, midX, midY - 10);
            }
          }
        });
        
        detectedPoints.forEach((p_norm, i) => {
          const pt = toPx(p_norm); ctx.beginPath();
          ctx.arc(pt.x, pt.y, isDragging === i ? 8 : 5, 0, Math.PI * 2);
          ctx.fillStyle = isDragging === i ? '#D2B7AC' : '#1A1A1A'; ctx.fill();
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.stroke();
        });
      }
    }
  }, [image, detectedPoints, step, selectedEdgeIdx, hoverEdgeIdx, isDragging, scaleValue]);

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

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-4 md:p-10">
      <div className="max-w-5xl w-full h-full flex flex-col bg-white overflow-hidden shadow-2xl border border-[#E5E5E5]">
        <header className="p-6 md:p-8 border-b border-[#F1F1F1] flex justify-between items-center">
          <div>
            <h2 className="serif text-xl md:text-2xl font-bold">Importera Ritning</h2>
            <p className="text-[9px] md:text-[10px] text-[#A0A0A0] uppercase tracking-widest mt-1">Säker AI-analys via Proxy</p>
          </div>
          <button onClick={onCancel} className="text-[10px] font-bold uppercase tracking-widest text-[#A0A0A0] hover:text-[#1A1A1A]">Avbryt</button>
        </header>

        <div className="flex-1 overflow-hidden relative bg-[#FBFBFB] flex items-center justify-center p-4">
          {step === 'upload' && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 md:w-20 md:h-20 bg-[#F1F1F1] rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-[#A0A0A0]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold">Ladda upp ritning</h3>
                <p className="text-sm text-[#888] max-w-xs mx-auto">Ladda upp en skärmdump. Din bild analyseras säkert på servern.</p>
              </div>
              <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" id="file-upload" />
              <label htmlFor="file-upload" className="inline-block px-8 py-4 bg-[#1A1A1A] text-white text-[11px] font-bold uppercase tracking-widest cursor-pointer hover:bg-[#333] transition-colors">
                Välj fil
              </label>
            </div>
          )}

          {step === 'analyze' && (
            <div className="text-center space-y-6">
              <div className="relative w-16 h-16 mx-auto">
                <div className="absolute inset-0 border-2 border-[#D2B7AC]/20 rounded-full"></div>
                <div className="absolute inset-0 border-2 border-[#D2B7AC] border-t-transparent rounded-full animate-spin"></div>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]">Anropar säker proxy...</p>
            </div>
          )}

          {step === 'refine' && (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              <canvas 
                ref={canvasRef} 
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={() => setIsDragging(null)}
                className="shadow-2xl border border-[#E5E5E5] cursor-crosshair max-w-full max-h-full object-contain"
              />
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
                  Kontrollera att AI:n hittat rätt hörn. Klicka på en linje för att ange dess verkliga längd.
                </p>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className={`flex flex-col gap-1 transition-opacity ${selectedEdgeIdx === null ? 'opacity-30' : 'opacity-100'}`}>
                  <label className="text-[9px] font-bold text-[#A0A0A0] uppercase tracking-widest">Verklig längd (mm)</label>
                  <div className="flex items-center gap-3 border-b-2 border-[#1A1A1A] pb-1">
                    <input 
                      type="number" 
                      disabled={selectedEdgeIdx === null}
                      value={scaleValue} 
                      onChange={(e) => setScaleValue(parseInt(e.target.value) || 0)}
                      className="w-24 bg-transparent text-xl font-bold focus:outline-none text-[#1A1A1A]"
                    />
                  </div>
                </div>
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
