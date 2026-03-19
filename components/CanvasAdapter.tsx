import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Canvas from './Canvas';
import { calculateLayout } from '../flooringEngine';
import { getPolygonArea, getBoundingBox } from '../geometry';
import { Point, PlankSettings, Stats, ProductInfo } from '../types';

const MIN_SCALE = 0.005;

const INITIAL_SETTINGS: PlankSettings = {
  length: 2000,
  width: 190,
  minEndPiece: 50,
  minStagger: 500,
  gap: 5,
  startOffset: 0,
  startOffsetVertical: 0,
  planksPerPackage: 6,
  visualContrast: 0.6,
  originPointIdx: 0,
  layoutRotated: false
};

// Default L-shaped room
const DEFAULT_POINTS: Point[] = [
  { x: -2500, y: -2000 },
  { x: 2500,  y: -2000 },
  { x: 2500,  y:  0    },
  { x: 800,   y:  0    },
  { x: 800,   y:  2000 },
  { x: -2500, y:  2000 },
];

// Inline optimizer (mirrors App.tsx findOptimizedLayout)
function findOptimizedLayout(
  points: Point[],
  settings: PlankSettings,
  constraints: { minStaggerMin: number; minStaggerMax: number; iterations: number }
): Pick<PlankSettings, 'startOffset' | 'startOffsetVertical' | 'minStagger'> {
  const staggerCeiling = Math.min(constraints.minStaggerMax, Math.floor(settings.length / 2));
  const staggerFloor = Math.min(constraints.minStaggerMin, staggerCeiling);
  const staggerRange = Math.max(0, staggerCeiling - staggerFloor);
  const effectivePoints = settings.layoutRotated
    ? points.map((p) => ({ x: p.y, y: -p.x }))
    : points;
  const midStagger = Math.round(staggerFloor + staggerRange / 2);
  const zeroCandidate: PlankSettings = { ...settings, startOffset: 0, startOffsetVertical: 0, minStagger: midStagger };
  const { totalPlanksOpened: zeroOpened } = calculateLayout(effectivePoints, zeroCandidate);
  let bestOpened = zeroOpened;
  let best = { startOffset: 0, startOffsetVertical: 0, minStagger: midStagger };
  for (let i = 0; i < constraints.iterations; i++) {
    const candidate: PlankSettings = {
      ...settings,
      startOffset: Math.round(Math.random() * settings.length),
      startOffsetVertical: Math.round(Math.random() * settings.width),
      minStagger: Math.round(staggerFloor + Math.random() * staggerRange),
    };
    const { totalPlanksOpened } = calculateLayout(effectivePoints, candidate);
    if (totalPlanksOpened < bestOpened) {
      bestOpened = totalPlanksOpened;
      best = { startOffset: candidate.startOffset, startOffsetVertical: candidate.startOffsetVertical, minStagger: candidate.minStagger };
    }
  }
  return best;
}

interface Props {
  productInfo?: ProductInfo | null;
  containerWidth?: number;
  containerHeight?: number;
  isAuthed?: boolean;
  onRequestSignIn?: () => void;
  onAddToCart?: (areaMm2: number) => void;
  pricePerM2?: number;
}

export default function CanvasAdapter({
  productInfo = null,
  containerHeight = 480,
  isAuthed = false,
  onRequestSignIn,
  onAddToCart,
  pricePerM2 = 479,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const justeraRef = useRef<HTMLDivElement>(null);

  const [points, setPoints] = useState<Point[]>(DEFAULT_POINTS);
  const [settings, setSettings] = useState<PlankSettings>({ ...INITIAL_SETTINGS });
  const [scale, setScale] = useState(0.09);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showEdgeLengths, setShowEdgeLengths] = useState(true);
  const [gridSize] = useState(50);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [backgroundDrawing, setBackgroundDrawing] = useState<any>(null);
  const [showBackgroundDrawing, setShowBackgroundDrawing] = useState(false);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.15);
  const [shareCopied, setShareCopied] = useState(false);
  const [isJusteraOpen, setIsJusteraOpen] = useState(false);

  // Close Justera panel on outside click
  useEffect(() => {
    if (!isJusteraOpen) return;
    const handle = (e: MouseEvent) => {
      if (justeraRef.current && !justeraRef.current.contains(e.target as Node)) {
        setIsJusteraOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [isJusteraOpen]);

  const onToggleBackgroundDrawing = useCallback(() => setShowBackgroundDrawing((v) => !v), []);
  const onToggleEdgeLengths = useCallback(() => setShowEdgeLengths((v) => !v), []);
  const onToggleSnapToGrid = useCallback(() => setSnapToGrid((v) => !v), []);
  const onRequestHistorySnapshot = useCallback(() => {}, []);
  const onRemoveBackgroundDrawing = useCallback(() => setBackgroundDrawing(null), []);
  const onResetDesign = useCallback(() => setPoints(DEFAULT_POINTS.map((p) => ({ ...p }))), []);

  const handleZoomExtents = useCallback(() => {
    if (points.length === 0) return;
    const el = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!el) return;
    const { minX, minY, maxX, maxY } = getBoundingBox(points);
    const roomW = maxX - minX || 1;
    const roomH = maxY - minY || 1;
    const padding = 80;
    const availW = el.clientWidth - padding;
    const availH = el.clientHeight - padding;
    const newScale = Math.max(MIN_SCALE, Math.min(availW / roomW, availH / roomH, 0.4) * 0.80);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setScale(newScale);
    setOffset({ x: -(cx * newScale), y: -(cy * newScale) });
  }, [points]);

  const handleZoomStep = useCallback((dir: 1 | -1) => {
    setScale(prev => {
      const next = Math.max(MIN_SCALE, Math.min(0.4, prev + dir * 0.01));
      setOffset(o => ({ x: o.x * (next / prev), y: o.y * (next / prev) }));
      return next;
    });
  }, []);

  const handleImportFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        setBackgroundDrawing({ src, x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight });
        setShowBackgroundDrawing(true);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }, []);

  const handleOptimize = useCallback(() => {
    if (points.length < 3) return;
    const minStaggerMin = settings.length < 1000
      ? Math.ceil(settings.length * 0.25 / 10) * 10
      : 250;
    const optimized = findOptimizedLayout(points, settings, {
      minStaggerMin,
      minStaggerMax: 500,
      iterations: 120,
    });
    setSettings(s => ({ ...s, ...optimized }));
  }, [points, settings]);

  const handleToggleRotate = useCallback(() => {
    setSettings(s => ({ ...s, layoutRotated: !s.layoutRotated }));
  }, []);

  const layout = useMemo(() => {
    if (points.length < 3) return { planks: [], wastePieces: [], totalPlanksOpened: 0 };
    if (!settings.layoutRotated) return calculateLayout(points, settings);
    // Rotate room 90° CW: (x,y) → (y,-x), then rotate planks back 90° CCW
    const rotatedPoints = points.map(p => ({ x: p.y, y: -p.x }));
    const result = calculateLayout(rotatedPoints, settings);
    const rotatePlanks = result.planks.map(p => ({ ...p, x: -(p.y + p.h), y: p.x, w: p.h, h: p.w }));
    const rotateWaste = result.wastePieces.map(w => ({ ...w, x: -(w.y + w.h), y: w.x, w: w.h, h: w.w }));
    return { ...result, planks: rotatePlanks, wastePieces: rotateWaste };
  }, [points, settings]);

  const stats: Stats = useMemo(() => {
    const areaMM2 = getPolygonArea(points);
    const areM2 = areaMM2 / 1_000_000;
    const plankCount = layout.totalPlanksOpened;
    const packageCount = Math.ceil(plankCount / settings.planksPerPackage);
    const plankAreaMM2 = settings.length * settings.width;
    const totalMaterialMM2 = plankCount * plankAreaMM2;
    const wasteAreaMM2 = Math.max(0, totalMaterialMM2 - areaMM2);
    const wastePercent = totalMaterialMM2 > 0 ? (wasteAreaMM2 / totalMaterialMM2) * 100 : 0;
    return {
      area: parseFloat(areM2.toFixed(1)),
      plankCount,
      packageCount,
      wasteArea: parseFloat((wasteAreaMM2 / 1_000_000).toFixed(2)),
      wastePercent: parseFloat(wastePercent.toFixed(1)),
      totalPrice: 0
    };
  }, [layout, points, settings.planksPerPackage, settings.length, settings.width]);

  const wastePlanksCount = useMemo(() => {
    const plankAreaMM2 = settings.length * settings.width;
    const areaMM2 = getPolygonArea(points);
    const totalMaterialMM2 = layout.totalPlanksOpened * plankAreaMM2;
    const wasteAreaMM2 = Math.max(0, totalMaterialMM2 - areaMM2);
    return parseFloat((wasteAreaMM2 / plankAreaMM2).toFixed(1));
  }, [layout.totalPlanksOpened, points, settings.length, settings.width]);

  const totalPrice = Math.round(stats.area * pricePerM2);

  // Justera panel computed values
  const maxOffset = Math.max(0, settings.length - settings.minEndPiece);
  const maxVerticalOffset = Math.max(0, settings.width);
  const maxMinPiece = Math.max(0, settings.length / 2);

  const BOTTOM_BAR_H = 56;

  return (
    <div
      ref={containerRef}
      style={{ width: '100%' }}
      className="relative"
    >
      {/* Canvas area */}
      <div
        style={{ height: `${containerHeight}px` }}
        className="rounded-t-xl border border-b-0 border-[#EAE6E3] bg-white relative overflow-hidden"
      >
        {/* ── Top-left: Optimera / Justera / Flip ── */}
        <div className="absolute top-3 left-3 z-40 flex items-center gap-1.5">
          {/* Optimera */}
          <button
            onClick={handleOptimize}
            className="h-8 px-3 rounded-full bg-white border border-[#DAD6D2] shadow-sm flex items-center gap-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] transition-colors"
            type="button"
            title="Optimera läggning för minst spill"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              <path d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
            Optimera
          </button>

          {/* Justera — with dropdown */}
          <div ref={justeraRef} className="relative">
            <button
              onClick={() => setIsJusteraOpen(v => !v)}
              className="h-8 px-3 rounded-full bg-white border border-[#DAD6D2] shadow-sm flex items-center gap-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] transition-colors"
              type="button"
              aria-expanded={isJusteraOpen}
              aria-haspopup="true"
            >
              <img src="/icons/kugghjul-v01.svg" width="15" height="15" alt="" aria-hidden="true" />
              Justera
            </button>

            {/* Justera dropdown panel */}
            {isJusteraOpen && (
              <div className="absolute left-0 top-full mt-2 w-[210px] bg-white rounded-2xl border border-[#aaaaaa] shadow-[0_4px_20px_rgba(0,0,0,0.12)] px-4 py-4 space-y-3 z-50">
                <div className="text-[10px] font-semibold text-[#777] uppercase tracking-wider mb-1">Justera läggning</div>
                <div>
                  <div className="mb-0.5 flex items-center justify-between">
                    <label className="text-[9px] font-medium text-[#767676]">Skarvförskjutning</label>
                    <span className="text-[10px] font-semibold text-[#333]">{Math.round(settings.minStagger)} mm</span>
                  </div>
                  <input type="range" min="0" max={Math.max(0, settings.length)} step="10"
                    value={settings.minStagger}
                    onChange={e => setSettings(s => ({ ...s, minStagger: Math.max(0, parseInt(e.target.value) || 0) }))}
                    className="kahrs-slider w-full" />
                </div>
                <div>
                  <div className="mb-0.5 flex items-center justify-between">
                    <label className="text-[9px] font-medium text-[#767676]">Startförskjutning hor.</label>
                    <span className="text-[10px] font-semibold text-[#333]">{Math.round(settings.startOffset)} mm</span>
                  </div>
                  <input type="range" min="0" max={maxOffset} step="10"
                    value={settings.startOffset}
                    onChange={e => { const next = Math.max(0, parseInt(e.target.value) || 0); setSettings(s => ({ ...s, startOffset: Math.min(next, maxOffset) })); }}
                    className="kahrs-slider w-full" />
                </div>
                <div>
                  <div className="mb-0.5 flex items-center justify-between">
                    <label className="text-[9px] font-medium text-[#767676]">Startförskjutning vert.</label>
                    <span className="text-[10px] font-semibold text-[#333]">{Math.round(settings.startOffsetVertical)} mm</span>
                  </div>
                  <input type="range" min="0" max={maxVerticalOffset} step="10"
                    value={settings.startOffsetVertical}
                    onChange={e => { const next = Math.max(0, parseInt(e.target.value) || 0); setSettings(s => ({ ...s, startOffsetVertical: Math.min(next, maxVerticalOffset) })); }}
                    className="kahrs-slider w-full" />
                </div>
                <div>
                  <div className="mb-0.5 flex items-center justify-between">
                    <label className="text-[9px] font-medium text-[#767676]">Minsta ändbit</label>
                    <span className="text-[10px] font-semibold text-[#333]">{Math.round(settings.minEndPiece)} mm</span>
                  </div>
                  <input type="range" min="0" max={maxMinPiece} step="10"
                    value={settings.minEndPiece}
                    onChange={e => { const next = Math.max(0, parseInt(e.target.value) || 0); setSettings(s => ({ ...s, minEndPiece: Math.min(next, maxMinPiece) })); }}
                    className="kahrs-slider w-full" />
                </div>
              </div>
            )}
          </div>

          {/* Flip / rotate */}
          <button
            onClick={handleToggleRotate}
            className="h-8 w-8 rounded-full bg-white border border-[#DAD6D2] shadow-sm flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
            type="button"
            aria-label="Rotera layout 90°"
            title={settings.layoutRotated ? 'Rotera 90° tillbaka' : 'Rotera 90°'}
          >
            <svg width="19" height="18" viewBox="0 0 26 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="1" y="1" width="5" height="14" rx="1" stroke={settings.layoutRotated ? '#333333' : '#CCCCCC'} />
              <rect x="8" y="13" width="14" height="5" rx="1" stroke={settings.layoutRotated ? '#CCCCCC' : '#333333'} />
              <path d="M7 4 C14 2, 18 5, 18 11.5" stroke="#CCCCCC" />
              <polyline points="15.5,10 18,11.5 16.5,14" stroke="#CCCCCC" />
            </svg>
          </button>
        </div>

        {/* ── Top-right: Importera / Dela / Spara ── */}
        <div className="absolute top-3 right-3 z-40 flex items-center gap-1.5">
          <input
            ref={importInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.pdf,image/*"
            className="hidden"
            aria-hidden="true"
            onChange={(e) => { handleImportFile(e.target.files?.[0]); e.currentTarget.value = ''; }}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="h-8 px-3 rounded-full bg-white border border-[#DAD6D2] shadow-sm flex items-center gap-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] transition-colors"
            aria-label="Importera ritning"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Importera ritning
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="h-8 px-3 rounded-full bg-white border border-[#DAD6D2] shadow-sm flex items-center gap-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] transition-colors"
            aria-label="Dela golvdesign"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            {shareCopied ? 'Kopierat!' : 'Dela'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isAuthed) { onRequestSignIn?.(); return; }
              alert('Design sparad (demo)');
            }}
            className="h-8 px-3 rounded-full bg-white border border-[#DAD6D2] shadow-sm flex items-center gap-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] transition-colors"
            aria-label="Spara design"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Spara
          </button>
        </div>

        {/* ── Right side: zoom controls ── */}
        <div className="absolute right-3 z-40 flex flex-col items-center gap-1" style={{ top: '50%', transform: 'translateY(-50%)' }}>
          <button type="button" onClick={() => handleZoomStep(1)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9d9d9] bg-white text-[18px] leading-none text-[#767676] shadow-[0_2px_8px_rgba(0,0,0,0.07)] hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
            aria-label="Zooma in">+</button>
          <button type="button" onClick={handleZoomExtents}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9d9d9] bg-white text-[#767676] shadow-[0_2px_8px_rgba(0,0,0,0.07)] hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
            aria-label="Visa hela">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 10.5l8-6 8 6M6.5 9.75V19.5a1 1 0 001 1h9a1 1 0 001-1V9.75M10 20v-5a1 1 0 011-1h2a1 1 0 011 1v5" />
            </svg>
          </button>
          <button type="button" onClick={() => handleZoomStep(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9d9d9] bg-white text-[18px] leading-none text-[#767676] shadow-[0_2px_8px_rgba(0,0,0,0.07)] hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
            aria-label="Zooma ut">−</button>
        </div>

        {/* ── Canvas ── */}
        <Canvas
          points={points}
          setPoints={setPoints}
          settings={settings}
          setSettings={setSettings}
          planks={layout.planks}
          wastePieces={layout.wastePieces}
          scale={scale}
          setScale={setScale}
          offset={offset}
          setOffset={setOffset}
          showEdgeLengths={showEdgeLengths}
          gridSize={gridSize}
          snapToGrid={snapToGrid}
          onToggleSnapToGrid={onToggleSnapToGrid}
          onToggleEdgeLengths={onToggleEdgeLengths}
          onRequestHistorySnapshot={onRequestHistorySnapshot}
          backgroundDrawing={backgroundDrawing}
          showBackgroundDrawing={showBackgroundDrawing}
          backgroundOpacity={backgroundOpacity}
          onToggleBackgroundDrawing={onToggleBackgroundDrawing}
          onBackgroundOpacityChange={setBackgroundOpacity}
          onRemoveBackgroundDrawing={onRemoveBackgroundDrawing}
          onZoomExtents={handleZoomExtents}
          onResetDesign={onResetDesign}
          showFloatingToolPanel={false}
          stats={stats}
          productInfo={productInfo ?? null}
        />
      </div>

      {/* ── Bottom bar: flat full-width stats + update button ── */}
      <div className="rounded-b-xl border border-t border-[#EAE6E3] bg-white flex items-center px-5 gap-0" style={{ height: `${BOTTOM_BAR_H}px` }}>

        <StatCell label="Area" value={`${stats.area.toFixed(2)} m²`} />
        <Divider />
        <StatCell label="Förp." value={`${stats.packageCount} st`} />
        <Divider />
        <StatCell label="Åtgång" value={`${stats.plankCount} st`} />
        <Divider />
        <StatCell label="Spill antal" value={`${wastePlanksCount} st`} />
        <Divider />
        <StatCell
          label="Spill"
          value={`${stats.wastePercent}%`}
          valueClass={stats.wastePercent <= 15 ? 'text-[#3D8B37]' : 'text-[#c8001a]'}
        />
        <Divider />

        {/* Sum tot — label + price inline */}
        <div className="flex items-baseline gap-2 px-4 flex-shrink-0">
          <span className="text-[10px] text-[#aaa] whitespace-nowrap">Sum tot</span>
          <span className="text-[15px] font-black text-[#c8001a] whitespace-nowrap leading-none">
            {totalPrice.toLocaleString('sv-SE')} kr
          </span>
        </div>

        {/* CTA */}
        <div className="flex-shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => onAddToCart?.(stats.area)}
            className="h-[38px] px-5 rounded-full text-white text-[12px] font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap" style={{ backgroundColor: '#666666' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor='#555')} onMouseLeave={e => (e.currentTarget.style.backgroundColor='#666666')}
          >
            Uppdatera m²
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, valueClass = 'text-[#1a1a1a]' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col items-center leading-none" style={{ width: 72, flexShrink: 0 }}>
      <span className="text-[9px] text-[#bbb] mb-0.5 whitespace-nowrap">{label}</span>
      <span className={`text-[11px] font-bold whitespace-nowrap ${valueClass}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-[#E5E0DB] flex-shrink-0" />;
}
