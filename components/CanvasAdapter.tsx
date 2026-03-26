import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Canvas from './Canvas';
import ImportWizard from './ImportWizard';
import { calculateLayout } from '../flooringEngine';
import { getPolygonArea, getBoundingBox } from '../geometry';
import { Point, PlankSettings, Stats, ProductInfo, ImportedDrawingBackground } from '../types';

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
  visualContrast: 0,
  originPointIdx: 0,
  layoutRotated: false
};

// Same default room as standalone app
const DEFAULT_POINTS: Point[] = [
  { x: -2000, y: -1500 },
  { x:  2000, y: -1500 },
  { x:  2000, y:  1500 },
  { x: -2000, y:  1500 },
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
  onFirstEdit?: () => void;
  pricePerM2?: number;
}

export default function CanvasAdapter({
  productInfo = null,
  containerHeight = 480,
  isAuthed = false,
  onRequestSignIn,
  onAddToCart,
  onFirstEdit,
  pricePerM2 = 479,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const justeraRef = useRef<HTMLDivElement>(null);
  const didAutoZoomRef = useRef(false);

  const [points, setPoints] = useState<Point[]>(DEFAULT_POINTS);
  const [settings, setSettings] = useState<PlankSettings>({ ...INITIAL_SETTINGS });
  const [scale, setScale] = useState(0.09);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showEdgeLengths, setShowEdgeLengths] = useState(true);
  const [gridSize] = useState(100);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [backgroundDrawing, setBackgroundDrawing] = useState<ImportedDrawingBackground | null>(null);
  const [showBackgroundDrawing, setShowBackgroundDrawing] = useState(false);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.4);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [isJusteraOpen, setIsJusteraOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<Point[][]>([]);
  const [redoStack, setRedoStack] = useState<Point[][]>([]);

  // Close Justera panel on outside click/tap
  useEffect(() => {
    if (!isJusteraOpen) return;
    const handle = (e: PointerEvent) => {
      if (justeraRef.current && !justeraRef.current.contains(e.target as Node)) {
        setIsJusteraOpen(false);
      }
    };
    document.addEventListener('pointerdown', handle);
    return () => document.removeEventListener('pointerdown', handle);
  }, [isJusteraOpen]);

  const onToggleBackgroundDrawing = useCallback(() => setShowBackgroundDrawing((v) => !v), []);
  const onToggleEdgeLengths = useCallback(() => setShowEdgeLengths((v) => !v), []);
  const onToggleSnapToGrid = useCallback(() => setSnapToGrid((v) => !v), []);
  const firstEditFired = useRef(false);
  const onRequestHistorySnapshot = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-19), points.map(p => ({ ...p }))]);
    setRedoStack([]);
    if (!firstEditFired.current) {
      firstEditFired.current = true;
      onFirstEdit?.();
    }
  }, [points, onFirstEdit]);

  const handleUndo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setRedoStack(r => [...r.slice(-19), points.map(p => ({ ...p }))]);
      setPoints(snapshot.map(p => ({ ...p })));
      return prev.slice(0, -1);
    });
  }, [points]);

  const handleRedo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setUndoStack(u => [...u.slice(-19), points.map(p => ({ ...p }))]);
      setPoints(snapshot.map(p => ({ ...p })));
      return prev.slice(0, -1);
    });
  }, [points]);

  // Keyboard shortcuts Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);
  const onRemoveBackgroundDrawing = useCallback(() => setBackgroundDrawing(null), []);
  const onResetDesign = useCallback(() => setPoints(DEFAULT_POINTS.map((p) => ({ ...p }))), []);

  // Auto zoom-extents on mobile on first render
  useEffect(() => {
    if (didAutoZoomRef.current) return;
    const isMobileView = typeof window !== 'undefined' && window.innerWidth < 640;
    if (!isMobileView) return;
    // Small delay to let canvas size settle
    const timer = setTimeout(() => {
      didAutoZoomRef.current = true;
      handleZoomExtents();
    }, 150);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setImportFile(file);
    setIsImporting(true);
  }, []);

  const handleImportComplete = useCallback((bg: ImportedDrawingBackground) => {
    // Center background on existing room bounding box
    const xs = points.map((p: Point) => p.x), ys = points.map((p: Point) => p.y);
    const roomCx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const roomCy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const centeredBg: ImportedDrawingBackground = {
      ...bg,
      x: roomCx - bg.width / 2,
      y: roomCy - bg.height / 2,
    };
    setBackgroundDrawing(centeredBg);
    setShowBackgroundDrawing(true);
    setIsImporting(false);
    setImportFile(null);
  }, [points]);

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

  // Whole planks left over after buying complete packages
  // e.g. 33 planks needed → 6 packages × 6 = 36 bought → 3 whole boards left
  const leftoverPlanks = useMemo(() => {
    const plankCount = layout.totalPlanksOpened;
    const packageCount = Math.ceil(plankCount / settings.planksPerPackage);
    return packageCount * settings.planksPerPackage - plankCount;
  }, [layout.totalPlanksOpened, settings.planksPerPackage]);

  // Total spill % = (all bought material - room area) / all bought material
  // Includes both cutting waste AND leftover whole planks from full-package purchase
  const spillTotPercent = useMemo(() => {
    const plankAreaMM2 = settings.length * settings.width;
    const roomAreaMM2 = getPolygonArea(points);
    const plankCount = layout.totalPlanksOpened;
    const packageCount = Math.ceil(plankCount / settings.planksPerPackage);
    const totalBoughtMM2 = packageCount * settings.planksPerPackage * plankAreaMM2;
    if (totalBoughtMM2 === 0) return 0;
    return parseFloat(((totalBoughtMM2 - roomAreaMM2) / totalBoughtMM2 * 100).toFixed(1));
  }, [layout.totalPlanksOpened, points, settings.planksPerPackage, settings.length, settings.width]);

  const totalPrice = Math.round(stats.area * pricePerM2);

  // Justera panel computed values
  const maxOffset = Math.max(0, settings.length - settings.minEndPiece);
  const maxVerticalOffset = Math.max(0, settings.width);
  const maxMinPiece = Math.max(0, settings.length / 2);

  const BOTTOM_BAR_H = 56;

  return (
    <>
    <div
      ref={containerRef}
      style={{ width: '100%' }}
      className="relative"
    >
      {/* Canvas area */}
      <div
        style={{ height: `${containerHeight}px` }}
        className="rounded-t-xl border border-b-0 border-[#EAE6E3] bg-white relative overflow-hidden"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleImportFile(file); }}
      >
        {/* ── Top bar: single row left↔right, never overlaps on mobile ── */}
        <div className="absolute top-3 left-3 right-3 z-40 flex items-center justify-between gap-1.5 pointer-events-none">
        <div className="flex items-center gap-1.5 pointer-events-auto">
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
        <div className="flex items-center gap-1.5 pointer-events-auto">
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
            onClick={() => {
              if (backgroundDrawing) { setIsImporting(true); }
              else { importInputRef.current?.click(); }
            }}
            className="hidden sm:flex h-8 px-3 rounded-full bg-white border border-[#DAD6D2] shadow-sm items-center gap-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] transition-colors"
            aria-label={backgroundDrawing ? 'Justera ritning' : 'Importera ritning'}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span className="hidden sm:inline">{backgroundDrawing ? 'Justera ritning' : 'Importera ritning'}</span>
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="h-8 px-2 sm:px-3 rounded-full bg-white border border-[#DAD6D2] shadow-sm flex items-center gap-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] transition-colors"
            aria-label="Dela golvdesign"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            <span className="hidden sm:inline">{shareCopied ? 'Kopierat!' : 'Dela'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isAuthed) { onRequestSignIn?.(); return; }
              alert('Design sparad (demo)');
            }}
            className="hidden sm:flex h-8 px-3 rounded-full bg-white border border-[#DAD6D2] shadow-sm items-center gap-1.5 text-[11px] font-medium hover:bg-[#f5f5f5] transition-colors"
            aria-label="Spara design"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span className="hidden sm:inline">Spara</span>
          </button>
        </div>
        </div>{/* end top bar wrapper */}

        {/* ── Bottom center: Ångra / Gör om ── */}
        <div className="absolute bottom-3 left-1/2 z-40 flex items-center gap-1.5" style={{ transform: 'translateX(-50%)' }}>
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9d9d9] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.07)] text-[#4a4a4a] hover:bg-[#f0f0f0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Ångra (Cmd+Z)"
            aria-label="Ångra"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 7H5v4M5 11c1.5-3.2 4.6-5 8.2-5 5 0 8.8 3.9 8.8 8.8" /></svg>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9d9d9] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.07)] text-[#4a4a4a] hover:bg-[#f0f0f0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Gör om (Cmd+Shift+Z)"
            aria-label="Gör om"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 7h4v4M19 11c-1.5-3.2-4.6-5-8.2-5C5.8 6 2 9.9 2 14.8" /></svg>
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
          disableEdgeEditing={true}
          stats={stats}
          productInfo={productInfo ?? null}
        />

        {/* Import wizard — contained within canvas area */}
        {isImporting && (
          <ImportWizard
            initialFile={importFile}
            existingBackground={backgroundDrawing}
            onComplete={handleImportComplete}
            onCancel={() => { setIsImporting(false); setImportFile(null); }}
            contained={true}
          />
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div className="rounded-b-xl border border-t border-[#EAE6E3] bg-white">

        {/* Mobile: 2-row layout */}
        <div className="flex sm:hidden flex-col">
          <div className="flex items-center justify-around px-3 py-2 border-b border-[#EAE6E3]">
            <StatCell label="Förp." value={`${stats.packageCount} st`} />
            <Divider />
            <StatCell label="Åtgång br." value={`${stats.plankCount} st`} />
            <Divider />
            <StatCell label="Överskott br." value={`${leftoverPlanks} st`} />
            <Divider />
            <StatCell
              label="Spill tot"
              value={`${spillTotPercent}%`}
              valueClass={spillTotPercent <= 15 ? 'text-[#3D8B37]' : 'text-[#c8001a]'}
            />
          </div>
          <div className="flex items-center px-3 py-2 gap-2">
            <StatCell label="Area" value={`${stats.area.toFixed(2)} m²`} />
            <Divider />
            <div className="flex items-baseline gap-1.5 px-2">
              <span className="text-[10px] text-[#aaa] whitespace-nowrap">Summa</span>
              <span className="text-[15px] font-black text-[#c8001a] whitespace-nowrap leading-none">
                {totalPrice.toLocaleString('sv-SE')} kr
              </span>
            </div>
            <div className="flex-shrink-0 ml-auto">
              <button
                type="button"
                onClick={() => onAddToCart?.(stats.area)}
                className="h-[36px] px-4 rounded-full text-white text-[12px] font-semibold flex items-center transition-colors whitespace-nowrap"
                style={{ backgroundColor: '#666666' }}
              >
                Uppdatera m²
              </button>
            </div>
          </div>
        </div>

        {/* Desktop: single scrollable row */}
        <div className="hidden sm:block overflow-x-auto" style={{ height: `${BOTTOM_BAR_H}px` }}>
          <div className="flex items-center px-5 gap-0 min-w-max h-full">
            <StatCell label="Area" value={`${stats.area.toFixed(2)} m²`} />
            <Divider />
            <StatCell label="Förp." value={`${stats.packageCount} st`} />
            <Divider />
            <StatCell label="Åtgång br." value={`${stats.plankCount} st`} />
            <Divider />
            <StatCell label="Överskott br." value={`${leftoverPlanks} st`} />
            <Divider />
            <StatCell
              label="Spill tot"
              value={`${spillTotPercent}%`}
              valueClass={spillTotPercent <= 15 ? 'text-[#3D8B37]' : 'text-[#c8001a]'}
            />
            <Divider />
            <div className="flex items-baseline gap-2 px-4 flex-shrink-0">
              <span className="text-[10px] text-[#aaa] whitespace-nowrap">Summa</span>
              <span className="text-[15px] font-black text-[#c8001a] whitespace-nowrap leading-none">
                {totalPrice.toLocaleString('sv-SE')} kr
              </span>
            </div>
            <div className="flex-shrink-0 ml-auto">
              <button
                type="button"
                onClick={() => onAddToCart?.(stats.area)}
                className="h-[38px] px-5 rounded-full text-white text-[12px] font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
                style={{ backgroundColor: '#666666' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#555')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#666666')}
              >
                Uppdatera m²
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>

    </>
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
