import React, { useEffect, useRef, useState } from 'react';

interface CanvasOverlayControlsProps {
  importLabel: string;
  importError?: string | null;
  importDropActive?: boolean;
  onImportClick: () => void;
  onImportDragEnter?: React.DragEventHandler<HTMLButtonElement>;
  onImportDragOver?: React.DragEventHandler<HTMLButtonElement>;
  onImportDragLeave?: React.DragEventHandler<HTMLButtonElement>;
  onImportDrop?: React.DragEventHandler<HTMLButtonElement>;
  drawingAvailable: boolean;
  drawingVisible: boolean;
  onToggleDrawing: () => void;
  contrastEnabled: boolean;
  onToggleContrast: () => void;
  isLocked: boolean;
  onToggleLock: () => void;
  shareCopied?: boolean;
  onShareClick: () => void;
  saveLabel: string;
  saveTitle: string;
  saveDisabled?: boolean;
  saveDone?: boolean;
  onSaveClick: () => void;
  onZoomIn: () => void;
  onZoomExtents: () => void;
  onZoomOut: () => void;
  showEdgeLengths: boolean;
  onToggleEdgeLengths: () => void;
  showPlanks: boolean;
  onTogglePlanks: () => void;
  isMobile?: boolean;
  onResetDesign?: () => void;
  onOptimize: () => void;
  onRotate: () => void;
  isRotated: boolean;
  minStagger: number;
  maxStagger: number;
  startOffset: number;
  maxOffset: number;
  startOffsetVertical: number;
  maxVerticalOffset: number;
  minEndPiece: number;
  maxMinPiece: number;
  onMinStaggerChange: (value: number) => void;
  onStartOffsetChange: (value: number) => void;
  onStartOffsetVerticalChange: (value: number) => void;
  onMinEndPieceChange: (value: number) => void;
}

interface ActionButtonProps {
  label: string;
  open: boolean;
  active?: boolean;
  disabled?: boolean;
  success?: boolean;
  warning?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title?: string;
  onDragEnter?: React.DragEventHandler<HTMLButtonElement>;
  onDragOver?: React.DragEventHandler<HTMLButtonElement>;
  onDragLeave?: React.DragEventHandler<HTMLButtonElement>;
  onDrop?: React.DragEventHandler<HTMLButtonElement>;
}

const railButtonBase =
  'flex h-10 w-full items-center rounded-md text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230]';

function ActionButton({
  label,
  open,
  active = false,
  disabled = false,
  success = false,
  warning = false,
  onClick,
  icon,
  title,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: ActionButtonProps) {
  const stateClass = disabled
    ? 'cursor-not-allowed text-[#b6b6b6]'
    : success
      ? 'text-[#3D8B37]'
      : warning
        ? 'text-[#C41230]'
        : active
          ? 'text-[#1a1a1a]'
          : 'text-[#5b5b5b] hover:text-[#1a1a1a]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`${railButtonBase} ${stateClass} ${open ? 'justify-start gap-3 px-1.5' : 'justify-center px-0'}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      {open && <span className="truncate whitespace-nowrap">{label}</span>}
    </button>
  );
}

function HamburgerIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10V7a4 4 0 118 0v3m-9 0h10a1 1 0 011 1v8a1 1 0 01-1 1H7a1 1 0 01-1-1v-8a1 1 0 011-1z" />
      </svg>
    );
  }
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h10a1 1 0 011 1v8a1 1 0 01-1 1H8a1 1 0 01-1-1v-8a1 1 0 011-1z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 10V7a4 4 0 017.2-2.4" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.1" d="M12 4v10m0 0l-4-4m4 4l4-4M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
    </svg>
  );
}

function ImageIcon({ visible }: { visible: boolean }) {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.4" strokeWidth="1.8" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M6.5 16l3.5-3.5 2.5 2.5 2.5-2.5 2.5 3" />
      {!visible && <path strokeLinecap="round" strokeWidth="2" d="M5 19L19 5" />}
    </svg>
  );
}

function ShareIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
  );
}

function SaveIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.1" d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.1" points="17 21 17 13 7 13 7 21" />
      <polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.1" points="7 3 7 8 15 8" />
    </svg>
  );
}

function ContrastIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" strokeWidth="1.8" />
      {enabled ? (
        <>
          <path fill="currentColor" stroke="none" d="M12 4.5a7.5 7.5 0 010 15z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 4.5a7.5 7.5 0 010 15" />
        </>
      ) : (
        <path strokeLinecap="round" strokeWidth="2" d="M6 18L18 6" />
      )}
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 7h12M9 7V5h6v2m-8 0l1 12h8l1-12M10 11v6m4-6v6" />
    </svg>
  );
}

function MeasureIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 17h18M3 17l3-3m-3 3l3 3M21 17l-3-3m3 3l-3 3M7 17V7m4 10V11m4 6V9m4 8V5" />
    </svg>
  );
}

function PlanksIcon() {
  // Staggered floorboard pattern: two rows with offset joints
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      {/* Top row: two planks with joint at x=13 */}
      <rect x="2" y="3" width="10" height="7" rx="1" strokeWidth="1.7" />
      <rect x="13" y="3" width="9" height="7" rx="1" strokeWidth="1.7" />
      {/* Bottom row: two planks with joint at x=8 (offset) */}
      <rect x="2" y="13" width="5" height="7" rx="1" strokeWidth="1.7" />
      <rect x="8" y="13" width="14" height="7" rx="1" strokeWidth="1.7" />
    </svg>
  );
}

function ZoomExtentsIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 10.5l8-6 8 6M6.5 9.75V19.5a1 1 0 001 1h9a1 1 0 001-1V9.75M10 20v-5a1 1 0 011-1h2a1 1 0 011 1v5" />
    </svg>
  );
}

function OptimizeIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  );
}

function RotateIcon({ rotated }: { rotated: boolean }) {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 26 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="1" width="5" height="14" rx="1" stroke={rotated ? '#333333' : '#C8C8C8'} />
      <rect x="8" y="13" width="14" height="5" rx="1" stroke={rotated ? '#C8C8C8' : '#333333'} />
      <path d="M7 4C14 2 18 5 18 11.5" stroke="#C8C8C8" />
      <polyline points="15.5,10 18,11.5 16.5,14" stroke="#C8C8C8" />
    </svg>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[10px] font-medium text-[#767676]">{label}</label>
        <span className="text-[11px] font-semibold text-[#333333]">{Math.round(value)} mm</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step="10"
        value={Math.min(Math.max(value, min), max)}
        onChange={(event) => onChange(parseInt(event.target.value, 10) || 0)}
        className="kahrs-slider w-full"
      />
    </div>
  );
}

export default function CanvasOverlayControls({
  importLabel,
  importError = null,
  importDropActive = false,
  onImportClick,
  onImportDragEnter,
  onImportDragOver,
  onImportDragLeave,
  onImportDrop,
  drawingAvailable,
  drawingVisible,
  onToggleDrawing,
  contrastEnabled,
  onToggleContrast,
  isLocked,
  onToggleLock,
  shareCopied = false,
  onShareClick,
  saveLabel,
  saveTitle,
  saveDisabled = false,
  saveDone = false,
  onSaveClick,
  onZoomIn,
  onZoomExtents,
  onZoomOut,
  showEdgeLengths,
  onToggleEdgeLengths,
  showPlanks,
  onTogglePlanks,
  isMobile = false,
  onResetDesign,
  onOptimize,
  onRotate,
  isRotated,
  minStagger,
  maxStagger,
  startOffset,
  maxOffset,
  startOffsetVertical,
  maxVerticalOffset,
  minEndPiece,
  maxMinPiece,
  onMinStaggerChange,
  onStartOffsetChange,
  onStartOffsetVerticalChange,
  onMinEndPieceChange,
}: CanvasOverlayControlsProps) {
  const [isRailOpen, setIsRailOpen] = useState(false);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isLayoutMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(event.target as Node)) {
        setIsLayoutMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isLayoutMenuOpen]);

  return (
    <>
      <div className="pointer-events-auto absolute left-3 top-3 z-40 flex items-start gap-1.5">
        <div ref={layoutMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setIsLayoutMenuOpen((prev) => !prev)}
            aria-label="Läggningsinställningar"
            aria-expanded={isLayoutMenuOpen}
            className="relative z-10 flex h-9 w-9 items-center justify-center text-[#4a4a4a] transition-colors hover:text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230]"
            title="Läggningsinställningar"
          >
            <GearIcon />
          </button>

          {isLayoutMenuOpen && (
            <div className="absolute left-[-6px] top-[-6px] z-0 w-[220px] max-w-[calc(100vw-6rem)] rounded-xl border border-[#d9d9d9] bg-white/96 px-3 pb-3 pt-11 backdrop-blur-sm">
            <div className="mb-2 space-y-1">
              <ActionButton
                label="Optimera läggning"
                open={true}
                onClick={onOptimize}
                icon={<OptimizeIcon />}
              />
              <ActionButton
                label={isRotated ? 'Rotera tillbaka' : 'Rotera brädor'}
                open={true}
                active={isRotated}
                onClick={onRotate}
                icon={<RotateIcon rotated={isRotated} />}
              />
            </div>

            <div className="mb-2 border-t border-[#ececec]" />

            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8a8a8a]">
              Justera
            </div>

            <div className="space-y-2.5">
              <SliderField
                label="Skarvförskjutning"
                value={minStagger}
                min={0}
                max={maxStagger}
                onChange={onMinStaggerChange}
              />
              <SliderField
                label="Startförskjutning hor."
                value={startOffset}
                min={0}
                max={maxOffset}
                onChange={onStartOffsetChange}
              />
              <SliderField
                label="Startförskjutning vert."
                value={startOffsetVertical}
                min={0}
                max={maxVerticalOffset}
                onChange={onStartOffsetVerticalChange}
              />
              <SliderField
                label="Minsta ändbit"
                value={minEndPiece}
                min={0}
                max={maxMinPiece}
                onChange={onMinEndPieceChange}
              />
            </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleLock}
          aria-label={isLocked ? 'Lås upp design' : 'Lås design'}
          aria-pressed={isLocked}
          className={`relative z-10 flex h-9 w-9 items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230] ${
            isLocked ? 'text-[#1a1a1a]' : 'text-[#6f6f6f] hover:text-[#1a1a1a]'
          }`}
          title={isLocked ? 'Lås upp design' : 'Lås design'}
        >
          <LockIcon locked={isLocked} />
        </button>
      </div>

      <aside className="pointer-events-auto absolute inset-y-0 right-0 z-40 flex">
        <div
          className={`flex h-full flex-col border-l border-[#d9d9d9] bg-white/92 backdrop-blur-sm transition-[width] duration-200 ease-out ${
            isRailOpen ? 'w-[188px]' : isMobile ? 'w-[46px]' : 'w-[54px]'
          }`}
        >
          <div className="px-3 py-3">
            <button
              type="button"
              onClick={() => setIsRailOpen((prev) => !prev)}
              aria-label={isRailOpen ? 'Fäll in verktygspanel' : 'Expandera verktygspanel'}
              aria-expanded={isRailOpen}
              className={`flex h-10 items-center text-[#4a4a4a] transition-colors hover:text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230] ${
                isRailOpen ? 'w-full justify-start gap-3 px-1.5' : 'w-full justify-center'
              }`}
              title={isRailOpen ? 'Fäll in panel' : 'Expandera panel'}
            >
              <span className="flex h-5 w-5 items-center justify-center">
                <HamburgerIcon />
              </span>
              {isRailOpen && <span className="truncate text-[12px] font-medium">Verktyg</span>}
            </button>
          </div>

          {importError && isRailOpen && (
            <div className="mx-3 mb-3 rounded-2xl border border-[#fad0d5] bg-[#fff5f6] px-3 py-2 text-[11px] font-medium text-[#C41230]">
              {importError}
            </div>
          )}

          <div className="flex flex-1 flex-col justify-between pb-3">
            <div className="space-y-0.5 px-3">
              {!isMobile && (
                <ActionButton
                  label={importLabel}
                  open={isRailOpen}
                  warning={importDropActive}
                  onClick={onImportClick}
                  icon={<ImportIcon />}
                  onDragEnter={onImportDragEnter}
                  onDragOver={onImportDragOver}
                  onDragLeave={onImportDragLeave}
                  onDrop={onImportDrop}
                />
              )}
              <ActionButton
                label={saveLabel}
                open={isRailOpen}
                disabled={saveDisabled}
                success={saveDone}
                onClick={onSaveClick}
                icon={<SaveIcon done={saveDone} />}
                title={saveTitle}
              />
              <ActionButton
                label={shareCopied ? 'Kopierat!' : 'Dela'}
                open={isRailOpen}
                success={shareCopied}
                onClick={onShareClick}
                icon={<ShareIcon copied={shareCopied} />}
              />
              <ActionButton
                label={drawingVisible ? 'Göm ritning' : 'Visa ritning'}
                open={isRailOpen}
                active={drawingAvailable && drawingVisible}
                disabled={!drawingAvailable}
                onClick={onToggleDrawing}
                icon={<ImageIcon visible={drawingVisible} />}
              />
              <ActionButton
                label={showEdgeLengths ? 'Dölj mått' : 'Visa mått'}
                open={isRailOpen}
                active={showEdgeLengths}
                onClick={onToggleEdgeLengths}
                icon={<MeasureIcon />}
              />
              <ActionButton
                label={showPlanks ? 'Dölj brädor' : 'Visa brädor'}
                open={isRailOpen}
                active={showPlanks}
                onClick={onTogglePlanks}
                icon={<PlanksIcon />}
              />
              <ActionButton
                label={contrastEnabled ? 'Kontrast av' : 'Kontrast på'}
                open={isRailOpen}
                active={contrastEnabled}
                onClick={onToggleContrast}
                icon={<ContrastIcon enabled={contrastEnabled} />}
              />
              {onResetDesign && !isLocked && (
                <>
                  <div className="my-1 border-t border-[#ececec]" />
                  <ActionButton
                    label="Återställ design"
                    open={isRailOpen}
                    onClick={onResetDesign}
                    icon={<ResetIcon />}
                  />
                </>
              )}
            </div>

            <div className="space-y-0.5 px-3">
              {!isMobile && (
                <>
                  <ActionButton
                    label="Zooma in"
                    open={isRailOpen}
                    onClick={onZoomIn}
                    icon={<span className="text-[22px] leading-none">+</span>}
                  />
                  <ActionButton
                    label="Zooma ut"
                    open={isRailOpen}
                    onClick={onZoomOut}
                    icon={<span className="text-[22px] leading-none">−</span>}
                  />
                </>
              )}
              <ActionButton
                label="Visa hela"
                open={isRailOpen}
                onClick={onZoomExtents}
                icon={<ZoomExtentsIcon />}
              />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
