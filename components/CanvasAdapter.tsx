import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Canvas from './Canvas';
import ImportWizard from './ImportWizard';
import CanvasOverlayControls from './CanvasOverlayControls';
import { calculateLayout } from '../flooringEngine';
import { getPolygonArea, getBoundingBox } from '../geometry';
import { Point, PlankSettings, Stats, ProductInfo, ImportedDrawingBackground } from '../types';

const MIN_SCALE = 0.005;
const ENABLED_VISUAL_CONTRAST = 0.6;

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
  const staggerLevels: number[] = [];
  for (let value = staggerCeiling; value >= staggerFloor; value -= 10) {
    staggerLevels.push(value);
  }
  if (staggerLevels.length === 0 || staggerLevels[staggerLevels.length - 1] !== staggerFloor) {
    staggerLevels.push(staggerFloor);
  }
  const effectivePoints = settings.layoutRotated
    ? points.map((p) => ({ x: p.y, y: -p.x }))
    : points;

  type LayoutCandidate = Pick<PlankSettings, 'startOffset' | 'startOffsetVertical' | 'minStagger'> & {
    totalPlanksOpened: number;
    packageCount: number;
  };

  const packageSize = Math.max(1, settings.planksPerPackage || 1);
  const samplesPerLevel = Math.max(4, Math.floor(constraints.iterations / Math.max(1, staggerLevels.length)));
  const seen = new Set<string>();
  const candidates: LayoutCandidate[] = [];

  const evaluateCandidate = (startOffset: number, startOffsetVertical: number, minStagger: number) => {
    const key = `${startOffset}|${startOffsetVertical}|${minStagger}`;
    if (seen.has(key)) return;
    seen.add(key);

    const candidate: PlankSettings = {
      ...settings,
      startOffset,
      startOffsetVertical,
      minStagger,
    };
    const { totalPlanksOpened } = calculateLayout(effectivePoints, candidate);
    candidates.push({
      startOffset,
      startOffsetVertical,
      minStagger,
      totalPlanksOpened,
      packageCount: Math.ceil(totalPlanksOpened / packageSize),
    });
  };

  staggerLevels.forEach((minStagger) => {
    evaluateCandidate(0, 0, minStagger);
    for (let sampleIdx = 1; sampleIdx < samplesPerLevel; sampleIdx++) {
      evaluateCandidate(
        Math.round(Math.random() * settings.length),
        Math.round(Math.random() * settings.width),
        minStagger
      );
    }
  });

  if (candidates.length === 0) {
    return { startOffset: 0, startOffsetVertical: 0, minStagger: staggerCeiling };
  }

  const minPackageCount = Math.min(...candidates.map((candidate) => candidate.packageCount));
  const packageSafeCandidates = candidates.filter((candidate) => candidate.packageCount === minPackageCount);
  const minOpened = Math.min(...packageSafeCandidates.map((candidate) => candidate.totalPlanksOpened));
  const allowedOpened = minOpened + 1;
  const staggerPreferredCandidates = packageSafeCandidates.filter((candidate) => candidate.totalPlanksOpened <= allowedOpened);

  staggerPreferredCandidates.sort((a, b) =>
    b.minStagger - a.minStagger ||
    a.totalPlanksOpened - b.totalPlanksOpened ||
    a.startOffset - b.startOffset ||
    a.startOffsetVertical - b.startOffsetVertical
  );

  const best = staggerPreferredCandidates[0] ?? packageSafeCandidates[0];
  return {
    startOffset: best.startOffset,
    startOffsetVertical: best.startOffsetVertical,
    minStagger: best.minStagger,
  };
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
  const didAutoZoomRef = useRef(false);

  const [points, setPoints] = useState<Point[]>(DEFAULT_POINTS);
  const [settings, setSettings] = useState<PlankSettings>({ ...INITIAL_SETTINGS });
  const [scale, setScale] = useState(0.09);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showEdgeLengths, setShowEdgeLengths] = useState(true);
  const [showPlanks, setShowPlanks] = useState(true);
  const [gridSize] = useState(100);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [backgroundDrawing, setBackgroundDrawing] = useState<ImportedDrawingBackground | null>(null);
  const [showBackgroundDrawing, setShowBackgroundDrawing] = useState(false);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.4);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [undoStack, setUndoStack] = useState<Point[][]>([]);
  const [redoStack, setRedoStack] = useState<Point[][]>([]);

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
      ? Math.max(300, Math.ceil(settings.length * 0.25 / 10) * 10)
      : 300;
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

  const handleToggleContrast = useCallback(() => {
    setSettings(s => ({ ...s, visualContrast: s.visualContrast > 0 ? 0 : ENABLED_VISUAL_CONTRAST }));
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
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const effectiveCanvasHeight = isTouchDevice ? containerHeight + 20 : containerHeight;

  return (
    <>
    <div
      ref={containerRef}
      style={{ width: '100%' }}
      className="relative"
    >
      {/* Canvas area */}
      <div
        style={{ height: `${effectiveCanvasHeight}px` }}
        className="rounded-t-xl border border-b-0 border-[#EAE6E3] bg-white relative overflow-hidden"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handleImportFile(file); }}
      >
        <input
          ref={importInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.pdf,image/*"
          className="hidden"
          aria-hidden="true"
          onChange={(e) => { handleImportFile(e.target.files?.[0]); e.currentTarget.value = ''; }}
        />

        <CanvasOverlayControls
          importLabel={backgroundDrawing ? 'Justera ritning' : 'Importera ritning'}
          onImportClick={() => {
            if (backgroundDrawing) {
              setIsImporting(true);
              return;
            }
            importInputRef.current?.click();
          }}
          drawingAvailable={Boolean(backgroundDrawing)}
          drawingVisible={Boolean(backgroundDrawing && showBackgroundDrawing)}
          onToggleDrawing={onToggleBackgroundDrawing}
          contrastEnabled={settings.visualContrast > 0}
          onToggleContrast={handleToggleContrast}
          isLocked={isLocked}
          onToggleLock={() => setIsLocked((prev) => !prev)}
          shareCopied={shareCopied}
          onShareClick={handleShare}
          saveLabel="Spara"
          saveTitle={isAuthed ? 'Spara design' : 'Logga in för att spara'}
          onSaveClick={() => {
            if (!isAuthed) {
              onRequestSignIn?.();
              return;
            }
            alert('Design sparad (demo)');
          }}
          onZoomIn={() => handleZoomStep(1)}
          onZoomExtents={handleZoomExtents}
          onZoomOut={() => handleZoomStep(-1)}
          showEdgeLengths={showEdgeLengths}
          onToggleEdgeLengths={() => setShowEdgeLengths(p => !p)}
          showPlanks={showPlanks}
          onTogglePlanks={() => setShowPlanks(p => !p)}
          onResetDesign={onResetDesign}
          isMobile={typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches}
          onOptimize={handleOptimize}
          onRotate={handleToggleRotate}
          isRotated={settings.layoutRotated}
          minStagger={settings.minStagger}
          maxStagger={Math.max(0, settings.length)}
          startOffset={settings.startOffset}
          maxOffset={maxOffset}
          startOffsetVertical={settings.startOffsetVertical}
          maxVerticalOffset={maxVerticalOffset}
          minEndPiece={settings.minEndPiece}
          maxMinPiece={maxMinPiece}
          onMinStaggerChange={(value) => setSettings(s => ({ ...s, minStagger: Math.max(0, value) }))}
          onStartOffsetChange={(value) => setSettings(s => ({ ...s, startOffset: Math.min(Math.max(0, value), maxOffset) }))}
          onStartOffsetVerticalChange={(value) => setSettings(s => ({ ...s, startOffsetVertical: Math.min(Math.max(0, value), maxVerticalOffset) }))}
          onMinEndPieceChange={(value) => setSettings(s => ({ ...s, minEndPiece: Math.min(Math.max(0, value), maxMinPiece) }))}
        />

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
          showPlanks={showPlanks}
          onTogglePlanks={() => setShowPlanks(p => !p)}
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
          planLocked={isLocked}
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
