
import React, { useState, useRef, useEffect, useCallback, useId, useMemo } from 'react';
import { ImportedDrawingBackground } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = 'pdf-select' | 'crop' | 'scale';
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

interface CropRect { x: number; y: number; width: number; height: number; }
interface Layout { scale: number; displayW: number; displayH: number; offsetX: number; offsetY: number; }
interface NormPt { x: number; y: number; }

export interface ImportWizardProps {
  initialFile: File | null;
  existingBackground?: ImportedDrawingBackground | null;
  onComplete: (background: ImportedDrawingBackground) => void;
  onCancel: () => void;
  /** When true, renders as absolute (fills parent container) instead of fixed fullscreen */
  contained?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_CROP_DISPLAY = 80;  // px — min crop box in display space
const RATIO_WARN      = 3.5;  // warn when crop ratio exceeds this
const H               = 7;    // handle half-size in px
const MAX_PX          = 3000; // max natural px before downscale
const MIN_RES         = 300;  // warn if image smaller than this
const MIN_VIEW_ZOOM   = 0.5;
const MAX_VIEW_ZOOM   = 10;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function getBaseLayout(cw: number, ch: number, iw: number, ih: number): Layout {
  const scale = Math.min(cw / iw, ch / ih);
  const displayW = iw * scale;
  const displayH = ih * scale;
  return { scale, displayW, displayH, offsetX: (cw - displayW) / 2, offsetY: (ch - displayH) / 2 };
}

async function loadPdfJs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return w.pdfjsLib;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      w.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(w.pdfjsLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function rasterizePdf(doc: any, pageNum: number, maxPx: number): Promise<string> {
  const page = await doc.getPage(pageNum);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(maxPx / vp0.width, maxPx / vp0.height, 4);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
  return canvas.toDataURL('image/png');
}

function downscaleImage(src: string, maxPx: number): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxPx && h <= maxPx) { resolve(src); return; }
      const s = Math.min(maxPx / w, maxPx / h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * s); c.height = Math.round(h * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.src = src;
  });
}

function extractCrop(src: string, crop: CropRect): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(crop.width);
      c.height = Math.round(crop.height);
      c.getContext('2d')!.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      resolve(c.toDataURL('image/png'));
    };
    img.src = src;
  });
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ─── Component ────────────────────────────────────────────────────────────────

const ImportWizard: React.FC<ImportWizardProps> = ({ initialFile, existingBackground, onComplete, onCancel, contained = false }) => {
  const uid = useId().replace(/:/g, '');

  // ── Image ─────────────────────────────────────────────────────────────────
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [lowRes, setLowRes] = useState(false);

  // ── PDF ───────────────────────────────────────────────────────────────────
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfThumbs, setPdfThumbs] = useState<string[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);

  // ── Step ──────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>('crop');

  // ── Crop ──────────────────────────────────────────────────────────────────
  const [crop, setCrop] = useState<CropRect | null>(null);
  const cropAreaRef = useRef<HTMLDivElement>(null);

  // View zoom/pan for the crop step
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });

  // Container size — updated by ResizeObserver
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Refs to avoid stale closures in wheel handler
  const viewZoomRef  = useRef(1);
  const viewPanRef   = useRef({ x: 0, y: 0 });
  const containerRef = useRef({ w: 0, h: 0 });
  const imgWRef      = useRef(0);
  const imgHRef      = useRef(0);
  const cropRef      = useRef<CropRect | null>(null);
  useEffect(() => { viewZoomRef.current  = viewZoom; }, [viewZoom]);
  useEffect(() => { viewPanRef.current   = viewPan;  }, [viewPan]);
  useEffect(() => { containerRef.current = containerSize; }, [containerSize]);
  useEffect(() => { imgWRef.current = imgW; imgHRef.current = imgH; }, [imgW, imgH]);
  useEffect(() => { cropRef.current = crop; }, [crop]);

  // Drag refs
  const cropDrag = useRef<{ handle: HandleId; mx: number; my: number; c0: CropRect } | null>(null);
  const viewPanDrag = useRef<{ startMX: number; startMY: number; startPan: { x: number; y: number } } | null>(null);
  const pinchRef = useRef<{ prevDist: number } | null>(null);

  const [cropHint, setCropHint] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Scale ─────────────────────────────────────────────────────────────────
  const [croppedSrc, setCroppedSrc] = useState<string | null>(null);
  const [croppedW, setCroppedW] = useState(0);
  const [croppedH, setCroppedH] = useState(0);
  const scaleAreaRef = useRef<HTMLDivElement>(null);
  const [scaleContainerSize, setScaleContainerSize] = useState({ w: 0, h: 0 });
  const [scaleViewZoom, setScaleViewZoom] = useState(1);
  const [scaleViewPan, setScaleViewPan] = useState({ x: 0, y: 0 });
  const scaleViewZoomRef  = useRef(1);
  const scaleViewPanRef   = useRef({ x: 0, y: 0 });
  const scaleContainerRef = useRef({ w: 0, h: 0 });
  const scalePanDrag = useRef<{ startMX: number; startMY: number; startPan: { x: number; y: number } } | null>(null);
  useEffect(() => { scaleViewZoomRef.current  = scaleViewZoom; }, [scaleViewZoom]);
  useEffect(() => { scaleViewPanRef.current   = scaleViewPan;  }, [scaleViewPan]);
  useEffect(() => { scaleContainerRef.current = scaleContainerSize; }, [scaleContainerSize]);
  const [pts, setPts] = useState<NormPt[]>([]);
  const draggingPtRef = useRef<number | null>(null);
  const [draggingPt, setDraggingPt] = useState<number | null>(null);
  const [lengthMm, setLengthMm] = useState('');
  const [scaleHint, setScaleHint] = useState<'p1' | 'p2' | 'len'>('p1');

  // ── Effective crop layout (base + zoom/pan) ───────────────────────────────
  const effectiveCropLayout = useMemo<Layout>(() => {
    const { w, h } = containerSize;
    if (!w || !h || !imgW || !imgH) return { scale: 1, displayW: 0, displayH: 0, offsetX: 0, offsetY: 0 };
    const baseScale = Math.min(w / imgW, h / imgH);
    const effectiveScale = baseScale * viewZoom;
    const displayW = imgW * effectiveScale;
    const displayH = imgH * effectiveScale;
    return {
      scale: effectiveScale,
      displayW,
      displayH,
      offsetX: (w - displayW) / 2 + viewPan.x,
      offsetY: (h - displayH) / 2 + viewPan.y,
    };
  }, [containerSize, viewZoom, viewPan, imgW, imgH]);

  // ── Effective scale layout (base + zoom/pan) ──────────────────────────────
  const effectiveScaleLayout = useMemo<Layout>(() => {
    const { w, h } = scaleContainerSize;
    if (!w || !h || !croppedW || !croppedH) return { scale: 1, displayW: 0, displayH: 0, offsetX: 0, offsetY: 0 };
    const baseScale = Math.min(w / croppedW, h / croppedH);
    const effectiveScale = baseScale * scaleViewZoom;
    const displayW = croppedW * effectiveScale;
    const displayH = croppedH * effectiveScale;
    return { scale: effectiveScale, displayW, displayH, offsetX: (w - displayW) / 2 + scaleViewPan.x, offsetY: (h - displayH) / 2 + scaleViewPan.y };
  }, [scaleContainerSize, scaleViewZoom, scaleViewPan, croppedW, croppedH]);

  // ── Init helpers ──────────────────────────────────────────────────────────
  const initFromSrc = useCallback(async (src: string, startStep: WizardStep, existingCrop?: CropRect) => {
    const resized = await downscaleImage(src, MAX_PX);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      setOriginalSrc(resized);
      setImgW(w); setImgH(h);
      setLowRes(Math.min(w, h) < MIN_RES);
      // Default crop: 10% inset so edges are visible
      const insetX = Math.round(w * 0.10), insetY = Math.round(h * 0.10);
      setCrop(existingCrop ?? { x: insetX, y: insetY, width: w - insetX * 2, height: h - insetY * 2 });
      setViewZoom(1); setViewPan({ x: 0, y: 0 });
      setCropHint(true);
      setStep(startStep);
    };
    img.src = resized;
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      setPdfDoc(null); setPdfThumbs([]); setPdfLoading(true); setStep('pdf-select');
      (async () => {
        try {
          const lib = await loadPdfJs();
          const buf = await file.arrayBuffer();
          const doc = await lib.getDocument({ data: buf }).promise;
          setPdfDoc(doc);
          const n = Math.min(doc.numPages, 12);
          const thumbs: string[] = [];
          for (let i = 1; i <= n; i++) thumbs.push(await rasterizePdf(doc, i, 180));
          setPdfThumbs(thumbs);
        } catch { /* remain */ }
        finally { setPdfLoading(false); }
      })();
      return;
    }
    const r = new FileReader();
    r.onload = e => initFromSrc(e.target!.result as string, 'crop');
    r.readAsDataURL(file);
  }, [initFromSrc]);

  // ── Mount ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (existingBackground) {
      const src = existingBackground.originalSrc ?? existingBackground.src;
      initFromSrc(src, 'scale', existingBackground.cropRect);
      return;
    }
    if (!initialFile) { onCancel(); return; }
    handleFileSelect(initialFile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Crop container resize ─────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'crop' || !cropAreaRef.current) return;
    const el = cropAreaRef.current;
    const update = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w && h) setContainerSize({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, imgW, imgH]);

  // ── Shared zoom helper: zoom by factor, pivoting around crop center ──────
  const zoomByCropCenter = useCallback((factor: number) => {
    const { w, h } = containerSize;
    const iw = imgW, ih = imgH;
    if (!w || !h || !iw || !ih) return;
    const oldZoom = viewZoom;
    const newZoom = clamp(oldZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    const baseScale = Math.min(w / iw, h / ih);
    const oldScale = baseScale * oldZoom;
    const newScale = baseScale * newZoom;
    const pan = viewPan;
    const oldLeft = (w - iw * oldScale) / 2 + pan.x;
    const oldTop  = (h - ih * oldScale) / 2 + pan.y;
    const c = crop;
    const pivotX = c ? oldLeft + (c.x + c.width  / 2) * oldScale : w / 2;
    const pivotY = c ? oldTop  + (c.y + c.height / 2) * oldScale : h / 2;
    const imgNatX = (pivotX - oldLeft) / oldScale;
    const imgNatY = (pivotY - oldTop)  / oldScale;
    const newLeft = pivotX - imgNatX * newScale;
    const newTop  = pivotY - imgNatY * newScale;
    const newPanX = newLeft - (w - iw * newScale) / 2;
    const newPanY = newTop  - (h - ih * newScale) / 2;
    setViewZoom(newZoom);
    setViewPan({ x: newPanX, y: newPanY });
  }, [containerSize, imgW, imgH, viewZoom, viewPan, crop]);

  // ── Wheel zoom (passive:false) ────────────────────────────────────────────
  useEffect(() => {
    const el = cropAreaRef.current;
    if (!el || step !== 'crop') return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { w, h } = containerRef.current;
      const iw = imgWRef.current, ih = imgHRef.current;
      if (!w || !h || !iw || !ih) return;
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      const oldZoom = viewZoomRef.current;
      const newZoom = clamp(oldZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
      const baseScale = Math.min(w / iw, h / ih);
      const oldScale = baseScale * oldZoom;
      const newScale = baseScale * newZoom;
      const pan = viewPanRef.current;
      // Image top-left in container coords
      const oldLeft = (w - iw * oldScale) / 2 + pan.x;
      const oldTop  = (h - ih * oldScale) / 2 + pan.y;
      // Pivot: center of the crop box in display space (fallback: container center)
      const c = cropRef.current;
      const pivotX = c ? oldLeft + (c.x + c.width  / 2) * oldScale : w / 2;
      const pivotY = c ? oldTop  + (c.y + c.height / 2) * oldScale : h / 2;
      // Natural image point under pivot
      const imgNatX = (pivotX - oldLeft) / oldScale;
      const imgNatY = (pivotY - oldTop)  / oldScale;
      // New pan so same image point stays under pivot
      const newLeft = pivotX - imgNatX * newScale;
      const newTop  = pivotY - imgNatY * newScale;
      const newPanX = newLeft - (w - iw * newScale) / 2;
      const newPanY = newTop  - (h - ih * newScale) / 2;
      setViewZoom(newZoom);
      setViewPan({ x: newPanX, y: newPanY });
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [step]);

  // ── Scale container resize ────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'scale' || !scaleAreaRef.current || !croppedW || !croppedH) return;
    const el = scaleAreaRef.current;
    const update = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w && h) setScaleContainerSize({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, croppedW, croppedH]);

  // ── Reset scale zoom/pan when entering scale step ─────────────────────────
  useEffect(() => {
    if (step === 'scale') { setScaleViewZoom(1); setScaleViewPan({ x: 0, y: 0 }); }
  }, [step]);

  // ── Scale wheel zoom ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = scaleAreaRef.current;
    if (!el || step !== 'scale') return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { w, h } = scaleContainerRef.current;
      const iw = croppedW, ih = croppedH;
      if (!w || !h || !iw || !ih) return;
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      const oldZoom = scaleViewZoomRef.current;
      const newZoom = clamp(oldZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
      const baseScale = Math.min(w / iw, h / ih);
      const oldScale = baseScale * oldZoom;
      const newScale = baseScale * newZoom;
      const pan = scaleViewPanRef.current;
      const rect = el.getBoundingClientRect();
      const pivotX = e.clientX - rect.left;
      const pivotY = e.clientY - rect.top;
      const oldLeft = (w - iw * oldScale) / 2 + pan.x;
      const oldTop  = (h - ih * oldScale) / 2 + pan.y;
      const imgNatX = (pivotX - oldLeft) / oldScale;
      const imgNatY = (pivotY - oldTop)  / oldScale;
      const newLeft = pivotX - imgNatX * newScale;
      const newTop  = pivotY - imgNatY * newScale;
      setScaleViewZoom(newZoom);
      setScaleViewPan({ x: newLeft - (w - iw * newScale) / 2, y: newTop - (h - ih * newScale) / 2 });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [step, croppedW, croppedH]);

  // ── Extract crop when entering scale ──────────────────────────────────────
  useEffect(() => {
    if (step !== 'scale' || !originalSrc || !crop) return;
    extractCrop(originalSrc, crop).then(src => {
      setCroppedSrc(src);
      setCroppedW(Math.round(crop.width));
      setCroppedH(Math.round(crop.height));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Crop: computed display rect ───────────────────────────────────────────
  const getCropDisplay = useCallback(() => {
    if (!crop) return { cx: 0, cy: 0, cw: 0, ch: 0 };
    const { scale: s, offsetX: ox, offsetY: oy } = effectiveCropLayout;
    return { cx: ox + crop.x * s, cy: oy + crop.y * s, cw: crop.width * s, ch: crop.height * s };
  }, [crop, effectiveCropLayout]);

  const getHandles = useCallback(() => {
    const { cx, cy, cw, ch } = getCropDisplay();
    return [
      { id: 'nw' as HandleId, x: cx,        y: cy,        cur: 'nw-resize' },
      { id: 'n'  as HandleId, x: cx + cw/2, y: cy,        cur: 'n-resize'  },
      { id: 'ne' as HandleId, x: cx + cw,   y: cy,        cur: 'ne-resize' },
      { id: 'e'  as HandleId, x: cx + cw,   y: cy + ch/2, cur: 'e-resize'  },
      { id: 'se' as HandleId, x: cx + cw,   y: cy + ch,   cur: 'se-resize' },
      { id: 's'  as HandleId, x: cx + cw/2, y: cy + ch,   cur: 's-resize'  },
      { id: 'sw' as HandleId, x: cx,        y: cy + ch,   cur: 'sw-resize' },
      { id: 'w'  as HandleId, x: cx,        y: cy + ch/2, cur: 'w-resize'  },
    ];
  }, [getCropDisplay]);

  // ── Crop: pointer events ──────────────────────────────────────────────────
  const onHandleDown = (e: React.PointerEvent, handle: HandleId) => {
    e.preventDefault(); e.stopPropagation();
    if (!crop) return;
    setCropHint(false);
    cropDrag.current = { handle, mx: e.clientX, my: e.clientY, c0: { ...crop } };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onSvgPointerDown = (e: React.PointerEvent) => {
    // Fires only when clicking outside handles/move-area (they call stopPropagation)
    viewPanDrag.current = { startMX: e.clientX, startMY: e.clientY, startPan: { ...viewPan } };
    setCropHint(false);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onCropSvgMove = (e: React.PointerEvent) => {
    if (cropDrag.current && crop) {
      const { handle, mx, my, c0 } = cropDrag.current;
      const s = effectiveCropLayout.scale;
      const minN = MIN_CROP_DISPLAY / s;
      const dx = (e.clientX - mx) / s;
      const dy = (e.clientY - my) / s;
      let { x, y, width: w, height: hh } = c0;
      const right = c0.x + c0.width, bottom = c0.y + c0.height;

      if (handle === 'move') {
        x = clamp(c0.x + dx, 0, imgW - c0.width);
        y = clamp(c0.y + dy, 0, imgH - c0.height);
      } else {
        if (handle === 'nw' || handle === 'w' || handle === 'sw') {
          const nx = clamp(c0.x + dx, 0, right - minN);
          w = right - nx; x = nx;
        }
        if (handle === 'ne' || handle === 'e' || handle === 'se') {
          w = clamp(c0.width + dx, minN, imgW - c0.x);
        }
        if (handle === 'nw' || handle === 'n' || handle === 'ne') {
          const ny = clamp(c0.y + dy, 0, bottom - minN);
          hh = bottom - ny; y = ny;
        }
        if (handle === 'sw' || handle === 's' || handle === 'se') {
          hh = clamp(c0.height + dy, minN, imgH - c0.y);
        }
      }
      setCrop({ x, y, width: w, height: hh });
    } else if (viewPanDrag.current) {
      const dx = e.clientX - viewPanDrag.current.startMX;
      const dy = e.clientY - viewPanDrag.current.startMY;
      setViewPan({
        x: viewPanDrag.current.startPan.x + dx,
        y: viewPanDrag.current.startPan.y + dy,
      });
    }
  };

  const onCropSvgUp = () => { cropDrag.current = null; viewPanDrag.current = null; };

  // ── Scale: coordinate helpers ─────────────────────────────────────────────
  const ptToDisplay = (p: NormPt) => ({
    x: effectiveScaleLayout.offsetX + p.x * croppedW * effectiveScaleLayout.scale,
    y: effectiveScaleLayout.offsetY + p.y * croppedH * effectiveScaleLayout.scale,
  });

  const clientToNorm = (cx: number, cy: number, rect: DOMRect): NormPt => {
    const relX = cx - rect.left - effectiveScaleLayout.offsetX;
    const relY = cy - rect.top - effectiveScaleLayout.offsetY;
    return {
      x: clamp(relX / (croppedW * effectiveScaleLayout.scale), 0, 1),
      y: clamp(relY / (croppedH * effectiveScaleLayout.scale), 0, 1),
    };
  };

  // ── Scale: pointer events ─────────────────────────────────────────────────
  const onScalePtrDown = (e: React.PointerEvent) => {
    if (!scaleAreaRef.current) return;
    const rect = scaleAreaRef.current.getBoundingClientRect();
    const HIT = 20;
    const hitIdx = pts.findIndex(p => {
      const d = ptToDisplay(p);
      return Math.hypot(d.x - (e.clientX - rect.left), d.y - (e.clientY - rect.top)) < HIT;
    });
    if (hitIdx !== -1) {
      setDraggingPt(hitIdx); draggingPtRef.current = hitIdx;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    // Start pan when zoomed in and clicking background
    if (scaleViewZoomRef.current > 1.05) {
      scalePanDrag.current = { startMX: e.clientX, startMY: e.clientY, startPan: { ...scaleViewPanRef.current } };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    const norm = clientToNorm(e.clientX, e.clientY, rect);
    if (pts.length < 2) {
      const next = [...pts, norm];
      setPts(next);
      setScaleHint(next.length === 1 ? 'p2' : 'len');
    } else {
      setPts([norm]); setScaleHint('p2');
    }
  };

  const onScalePtrMove = (e: React.PointerEvent) => {
    if (draggingPtRef.current !== null && scaleAreaRef.current) {
      const rect = scaleAreaRef.current.getBoundingClientRect();
      const norm = clientToNorm(e.clientX, e.clientY, rect);
      setPts(prev => { const n = [...prev]; n[draggingPtRef.current!] = norm; return n; });
    } else if (scalePanDrag.current) {
      const dx = e.clientX - scalePanDrag.current.startMX;
      const dy = e.clientY - scalePanDrag.current.startMY;
      setScaleViewPan({ x: scalePanDrag.current.startPan.x + dx, y: scalePanDrag.current.startPan.y + dy });
    }
  };

  const onScalePtrUp = () => { setDraggingPt(null); draggingPtRef.current = null; scalePanDrag.current = null; };

  // ── Finalize ──────────────────────────────────────────────────────────────
  const finalize = () => {
    if (!croppedSrc || !originalSrc || !crop || pts.length !== 2) return;
    const mm = parseFloat(lengthMm);
    if (!mm || mm <= 0) return;
    const dx = (pts[1].x - pts[0].x) * croppedW;
    const dy = (pts[1].y - pts[0].y) * croppedH;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    if (pixelDist <= 0) return;
    const mmPerPx = mm / pixelDist;
    onComplete({
      src: croppedSrc,
      originalSrc,
      cropRect: crop,
      x: 0, y: 0,
      width: croppedW * mmPerPx,
      height: croppedH * mmPerPx,
    });
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const { cx, cy, cw, ch } = getCropDisplay();
  const cropRatio = crop ? Math.max(crop.width / crop.height, crop.height / crop.width) : 1;
  const showRatioWarning = cropRatio > RATIO_WARN;
  const canFinalize = pts.length === 2 && !!lengthMm && parseFloat(lengthMm) > 0;
  const midPt = pts.length === 2 ? (() => {
    const d1 = ptToDisplay(pts[0]), d2 = ptToDisplay(pts[1]);
    return { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
  })() : null;
  const pt1Display = pts.length > 0 ? ptToDisplay(pts[0]) : null;
  const pt2Display = pts.length > 1 ? ptToDisplay(pts[1]) : null;
  const isZoomed = viewZoom > 1.05;
  const zoomPct = Math.round(viewZoom * 100);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: PDF page selector
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 'pdf-select') {
    return (
      <div className={`${contained ? 'absolute' : 'fixed'} inset-0 z-[100] bg-[#1C1C1C] flex flex-col`} role="dialog" aria-modal="true" aria-label="Välj PDF-sida">
        <header className="flex-shrink-0 px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-white">Välj sida</h2>
          <button
            onClick={onCancel}
            className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
            aria-label="Avbryt import"
          >
            Avbryt
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {pdfLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-white/40">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" aria-hidden="true" />
              <p className="text-[10px] uppercase tracking-widest">Laddar PDF…</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {pdfThumbs.map((src, i) => (
                <button
                  key={i}
                  onClick={() => rasterizePdf(pdfDoc, i + 1, MAX_PX).then(s => initFromSrc(s, 'crop'))}
                  className="group relative aspect-[3/4] bg-white/5 rounded overflow-hidden border border-white/10 hover:border-[#D2B7AC]/60 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
                  aria-label={`Välj sida ${i + 1}`}
                >
                  <img src={src} alt="" className="w-full h-full object-contain" />
                  <div className="absolute bottom-0 inset-x-0 py-1.5 bg-black/50 text-[9px] font-bold text-white/70 text-center uppercase tracking-wider group-hover:text-white transition-colors">
                    Sida {i + 1}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Crop step
  // ─────────────────────────────────────────────────────────────────────────
  if (step === 'crop') {
    const hs = getHandles();
    return (
      <div className={`${contained ? 'absolute' : 'fixed'} inset-0 z-[100] bg-[#1C1C1C] flex flex-col`} role="dialog" aria-modal="true" aria-label="Beskär ritning">
        {/* Header */}
        <header className="flex-shrink-0 px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5" aria-hidden="true">
              <div className="w-2 h-2 rounded-full bg-[#D2B7AC]" />
              <div className="w-2 h-2 rounded-full bg-white/20" />
            </div>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-white">
              Steg 1 av 2 — Beskär ritning
            </h2>
          </div>
          <div className="flex items-center gap-4">
            {/* Zoom level indicator */}
            {isZoomed && (
              <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest tabular-nums">{zoomPct}%</span>
            )}
            <button
              onClick={onCancel}
              className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
              aria-label="Avbryt import"
            >
              Avbryt
            </button>
          </div>
        </header>

        {/* Image + crop overlay */}
        <div
          ref={cropAreaRef}
          className="flex-1 min-h-0 relative overflow-hidden"
          style={{ touchAction: 'none' }}
          aria-label="Beskärningsyta — scrolla för att zooma, dra bakgrunden för att panorera"
          onTouchStart={e => {
            if (e.touches.length === 2) {
              const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
              pinchRef.current = { prevDist: dist };
            }
          }}
          onTouchMove={e => {
            if (e.touches.length === 2 && pinchRef.current) {
              const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
              const ratio = dist / pinchRef.current.prevDist;
              setViewZoom(prev => clamp(prev * ratio, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM));
              pinchRef.current.prevDist = dist;
            }
          }}
          onTouchEnd={() => { pinchRef.current = null; }}
        >
          {/* Image */}
          {originalSrc && (
            <img
              src={originalSrc}
              alt="Ritning att beskära"
              draggable={false}
              style={{
                position: 'absolute',
                left: effectiveCropLayout.offsetX,
                top: effectiveCropLayout.offsetY,
                width: effectiveCropLayout.displayW,
                height: effectiveCropLayout.displayH,
                maxWidth: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* SVG overlay */}
          {crop && (
            <svg
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
              onPointerDown={onSvgPointerDown}
              onPointerMove={onCropSvgMove}
              onPointerUp={onCropSvgUp}
              aria-hidden="true"
            >
              <defs>
                <mask id={`cm-${uid}`}>
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={cx} y={cy} width={Math.max(0, cw)} height={Math.max(0, ch)} fill="black" />
                </mask>
              </defs>

              {/* Dark overlay */}
              <rect
                width="100%" height="100%"
                fill="rgba(0,0,0,0.62)"
                mask={`url(#cm-${uid})`}
                style={{ cursor: viewPanDrag.current ? 'grabbing' : 'grab' }}
              />

              {/* Crop border — dark shadow + white line (visible on any background) */}
              <rect x={cx} y={cy} width={Math.max(0, cw)} height={Math.max(0, ch)} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="3.5" />
              <rect x={cx} y={cy} width={Math.max(0, cw)} height={Math.max(0, ch)} fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="1.5" />

              {/* Rule-of-thirds guide lines */}
              {([1/3, 2/3] as const).map((f, i) => (
                <React.Fragment key={i}>
                  <line x1={cx + cw * f} y1={cy} x2={cx + cw * f} y2={cy + ch} stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                  <line x1={cx} y1={cy + ch * f} x2={cx + cw} y2={cy + ch * f} stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                </React.Fragment>
              ))}

              {/* Move zone inside crop */}
              <rect
                x={cx + H * 2} y={cy + H * 2}
                width={Math.max(0, cw - H * 4)} height={Math.max(0, ch - H * 4)}
                fill="transparent"
                style={{ cursor: 'move' }}
                onPointerDown={e => onHandleDown(e, 'move')}
              />

              {/* Handles — white fill with dark border: visible on white AND dark backgrounds */}
              {hs.map(hd => (
                <g key={hd.id}>
                  {/* Drop shadow */}
                  <rect x={hd.x - H - 0.5} y={hd.y - H + 1} width={H*2+1} height={H*2+1} rx="2" fill="rgba(0,0,0,0.35)" />
                  {/* Handle */}
                  <rect
                    x={hd.x - H} y={hd.y - H}
                    width={H * 2} height={H * 2}
                    rx="1.5"
                    fill="white"
                    stroke="rgba(0,0,0,0.45)"
                    strokeWidth="1"
                    style={{ cursor: hd.cur }}
                    onPointerDown={e => onHandleDown(e, hd.id)}
                  />
                </g>
              ))}
            </svg>
          )}

          {/* Contextual hint */}
          {cropHint && originalSrc && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="bg-black/75 backdrop-blur-sm text-white rounded-md px-4 py-3 text-center max-w-xs shadow-xl">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5">Markera det rum du vill lägga golvet i</p>
                <p className="text-[9px] text-white/55 leading-relaxed">Dra i hörnen för att beskära. Scrolla eller nyp för att zooma. Dra bakgrunden för att panorera.</p>
              </div>
            </div>
          )}

          {/* Ratio warning */}
          {showRatioWarning && !cropHint && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="bg-amber-500/90 text-white rounded px-3 py-1.5 shadow-lg">
                <p className="text-[9px] font-bold uppercase tracking-wider">Ovanligt smal beskärning — stämmer det?</p>
              </div>
            </div>
          )}

          {/* Low-res warning */}
          {lowRes && (
            <div className="absolute top-4 right-4 pointer-events-none">
              <div className="bg-amber-500/90 text-white rounded px-3 py-1.5 shadow-lg">
                <p className="text-[9px] font-bold uppercase tracking-wider">Låg upplösning</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex-shrink-0 px-5 py-3.5 border-t border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
              className="hidden"
              aria-hidden="true"
              onChange={e => {
                const f = e.target.files?.[0];
                if (!f) return;
                e.currentTarget.value = '';
                handleFileSelect(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] font-bold uppercase tracking-widest text-white/35 hover:text-white/70 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
            >
              Ersätt ritning
            </button>
            {/* Zoom controls */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => zoomByCropCenter(1.35)}
                className="w-6 h-6 flex items-center justify-center bg-white/8 hover:bg-white/15 text-white rounded text-sm leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
                aria-label="Zooma in"
                title="Zooma in (scrolla uppåt)"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => zoomByCropCenter(0.75)}
                className="w-6 h-6 flex items-center justify-center bg-white/8 hover:bg-white/15 text-white rounded text-sm leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
                aria-label="Zooma ut"
                title="Zooma ut (scrolla nedåt)"
              >
                −
              </button>
              {isZoomed && (
                <button
                  type="button"
                  onClick={() => { setViewZoom(1); setViewPan({ x: 0, y: 0 }); }}
                  className="text-[9px] font-bold uppercase tracking-widest text-white/35 hover:text-white/70 transition-colors ml-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
                  aria-label="Återställ zoom"
                >
                  Återställ
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setStep('scale'); setPts([]); setLengthMm(''); setScaleHint('p1'); }}
            disabled={!crop}
            className="flex-shrink-0 px-8 py-2.5 bg-[#D2B7AC] text-[#1C1C1C] text-[10px] font-bold uppercase tracking-[0.18em] hover:bg-[#C4A99C] active:bg-[#b89989] transition-colors disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            Nästa →
          </button>
        </footer>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: Scale step
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={`${contained ? 'absolute' : 'fixed'} inset-0 z-[100] bg-[#1C1C1C] flex flex-col`} role="dialog" aria-modal="true" aria-label="Ange väggmått">
      {/* Header */}
      <header className="flex-shrink-0 px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            <div className="w-2 h-2 rounded-full bg-white/20" />
            <div className="w-2 h-2 rounded-full" style={{ background: '#E01B2F' }} />
          </div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-white">
            Steg 2 av 2 — Ange väggmått
          </h2>
        </div>
        <button
          onClick={onCancel}
          className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
          aria-label="Avbryt import"
        >
          Avbryt
        </button>
      </header>

      {/* Image + reference line */}
      <div
        ref={scaleAreaRef}
        className="flex-1 min-h-0 relative overflow-hidden"
        style={{ touchAction: 'none', cursor: scalePanDrag.current ? 'grabbing' : scaleViewZoom > 1.05 && pts.length < 2 ? 'grab' : pts.length === 2 ? 'default' : 'crosshair' }}
        onPointerDown={onScalePtrDown}
        onPointerMove={onScalePtrMove}
        onPointerUp={onScalePtrUp}
      >
        {croppedSrc ? (
          <img
            src={croppedSrc}
            alt="Beskärd ritning"
            draggable={false}
            style={{
              position: 'absolute',
              left: effectiveScaleLayout.offsetX,
              top: effectiveScaleLayout.offsetY,
              width: effectiveScaleLayout.displayW,
              height: effectiveScaleLayout.displayH,
              maxWidth: 'none',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" aria-hidden="true" />
          </div>
        )}

        {/* Reference line SVG */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
          aria-hidden="true"
        >
          {pt1Display && pt2Display && (
            <>
              <line x1={pt1Display.x} y1={pt1Display.y} x2={pt2Display.x} y2={pt2Display.y} stroke="rgba(255,255,255,0.7)" strokeWidth="5" strokeLinecap="round" />
              <line x1={pt1Display.x} y1={pt1Display.y} x2={pt2Display.x} y2={pt2Display.y} stroke="#E01B2F" strokeWidth="2" strokeLinecap="round" />
              {([pt1Display, pt2Display] as const).map((d, i) => {
                const angle = Math.atan2(pt2Display.y - pt1Display.y, pt2Display.x - pt1Display.x) + Math.PI / 2;
                const tx = Math.cos(angle) * 8, ty = Math.sin(angle) * 8;
                return <line key={i} x1={d.x - tx} y1={d.y - ty} x2={d.x + tx} y2={d.y + ty} stroke="#E01B2F" strokeWidth="2" strokeLinecap="round" />;
              })}
            </>
          )}
          {([pt1Display, pt2Display] as const).map((d, i) => {
            if (!d) return null;
            return (
              <g key={i} style={{ pointerEvents: 'auto', cursor: draggingPt === i ? 'grabbing' : 'grab' }}>
                <circle cx={d.x} cy={d.y} r={18} fill="transparent" />
                <circle cx={d.x} cy={d.y + 1} r={6} fill="rgba(0,0,0,0.35)" />
                <circle cx={d.x} cy={d.y} r={5.5} fill="#E01B2F" stroke="white" strokeWidth="1.5" />
              </g>
            );
          })}
          {pt1Display && !pt2Display && (
            <circle cx={pt1Display.x} cy={pt1Display.y} r={12} fill="none" stroke="rgba(224,27,47,0.35)" strokeWidth="1.5" />
          )}
        </svg>

        {/* Length input at line midpoint */}
        {pts.length === 2 && midPt && (
          <div
            style={{
              position: 'absolute',
              left: midPt.x,
              top: midPt.y,
              transform: 'translate(-50%, calc(-100% - 14px))',
              pointerEvents: 'auto',
              zIndex: 10,
            }}
          >
            <label className="sr-only" htmlFor="scale-length-input">Väggens längd i millimeter</label>
            <div className="flex items-center gap-1.5 backdrop-blur-sm rounded shadow-xl px-2.5 py-1.5" style={{ background: 'rgba(28,28,28,0.92)', border: '1px solid rgba(224,27,47,0.6)' }}>
              <input
                id="scale-length-input"
                type="number"
                min="1"
                value={lengthMm}
                onChange={e => setLengthMm(e.target.value)}
                onClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter' && canFinalize) { e.preventDefault(); finalize(); } }}
                placeholder="t.ex. 3600"
                className="w-24 bg-transparent text-white text-[12px] font-bold placeholder-white/60 focus:outline-none"
                autoFocus
              />
              <span className="text-[9px] font-bold uppercase tracking-widest flex-shrink-0" style={{ color: '#E01B2F' }}>mm</span>
            </div>
          </div>
        )}

        {/* Contextual hints */}
        {scaleHint === 'p1' && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="text-white rounded-md px-4 py-3 text-center max-w-sm shadow-xl" style={{ background: '#C41230' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5">Klicka på ena änden av en vägg</p>
              <p className="text-[9px] text-white/75 leading-relaxed">Välj en vägg vars längd du känner till. Yttervägg rekommenderas.</p>
            </div>
          </div>
        )}
        {scaleHint === 'p2' && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="text-white rounded-md px-4 py-3 text-center shadow-xl" style={{ background: '#C41230' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider">Klicka på väggens andra ände</p>
            </div>
          </div>
        )}
        {scaleHint === 'len' && !lengthMm && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="text-white rounded-md px-4 py-3 text-center shadow-xl" style={{ background: '#C41230' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider">Skriv in väggens verkliga längd</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="flex-shrink-0 px-5 py-3.5 border-t border-white/10 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => { setStep('crop'); setPts([]); setLengthMm(''); setScaleHint('p1'); setCropHint(false); }}
          className="text-[10px] font-bold uppercase tracking-widest text-white/35 hover:text-white/70 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
        >
          ← Tillbaka
        </button>
        {/* Zoom controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const { w, h } = scaleContainerSize;
              const iw = croppedW, ih = croppedH;
              if (!w || !h || !iw || !ih) return;
              const oldZoom = scaleViewZoom, factor = 1.35;
              const newZoom = clamp(oldZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
              const baseScale = Math.min(w / iw, h / ih);
              const oldScale = baseScale * oldZoom, newScale = baseScale * newZoom;
              const pan = scaleViewPan;
              const oldLeft = (w - iw * oldScale) / 2 + pan.x, oldTop = (h - ih * oldScale) / 2 + pan.y;
              const pivotX = w / 2, pivotY = h / 2;
              const imgNatX = (pivotX - oldLeft) / oldScale, imgNatY = (pivotY - oldTop) / oldScale;
              setScaleViewZoom(newZoom);
              setScaleViewPan({ x: pivotX - imgNatX * newScale - (w - iw * newScale) / 2, y: pivotY - imgNatY * newScale - (h - ih * newScale) / 2 });
            }}
            className="w-6 h-6 flex items-center justify-center bg-white/8 hover:bg-white/15 text-white rounded text-sm leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
            aria-label="Zooma in"
          >+</button>
          <button
            type="button"
            onClick={() => {
              const { w, h } = scaleContainerSize;
              const iw = croppedW, ih = croppedH;
              if (!w || !h || !iw || !ih) return;
              const oldZoom = scaleViewZoom, factor = 0.75;
              const newZoom = clamp(oldZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
              const baseScale = Math.min(w / iw, h / ih);
              const oldScale = baseScale * oldZoom, newScale = baseScale * newZoom;
              const pan = scaleViewPan;
              const oldLeft = (w - iw * oldScale) / 2 + pan.x, oldTop = (h - ih * oldScale) / 2 + pan.y;
              const pivotX = w / 2, pivotY = h / 2;
              const imgNatX = (pivotX - oldLeft) / oldScale, imgNatY = (pivotY - oldTop) / oldScale;
              setScaleViewZoom(newZoom);
              setScaleViewPan({ x: pivotX - imgNatX * newScale - (w - iw * newScale) / 2, y: pivotY - imgNatY * newScale - (h - ih * newScale) / 2 });
            }}
            className="w-6 h-6 flex items-center justify-center bg-white/8 hover:bg-white/15 text-white rounded text-sm leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
            aria-label="Zooma ut"
          >−</button>
          {scaleViewZoom > 1.05 && (
            <button
              type="button"
              onClick={() => { setScaleViewZoom(1); setScaleViewPan({ x: 0, y: 0 }); }}
              className="text-[9px] font-bold uppercase tracking-widest text-white/35 hover:text-white/70 transition-colors ml-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E01B2F]"
              aria-label="Återställ zoom"
            >Återställ</button>
          )}
        </div>
        <button
          type="button"
          onClick={finalize}
          disabled={!canFinalize}
          className="flex-shrink-0 px-8 py-2.5 bg-[#D2B7AC] text-[#1C1C1C] text-[10px] font-bold uppercase tracking-[0.18em] hover:bg-[#C4A99C] active:bg-[#b89989] transition-colors disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          Importera
        </button>
      </footer>
    </div>
  );
};

export default ImportWizard;
