
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import ImportWizard from './components/ImportWizard';
import {
  Point,
  PlankSettings,
  Stats,
  ProductInfo,
  SavedProduct,
  FloorDesign,
  ProductDesignSettings,
  ImportedDrawingBackground
} from './types';
import { calculateLayout } from './flooringEngine';
import { getPolygonArea, getBoundingBox } from './geometry';
import { supabase } from './lib/supabase';
import { logEvent } from './lib/analytics';
import type { User } from '@supabase/supabase-js';

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

const DEFAULT_SCALE = 0.08;
const DEFAULT_OFFSET = { x: 0, y: 0 };
const MIN_SCALE = 0.01;
const MAX_SCALE = 0.5;
const MIN_ZOOM_PERCENT = 10;
const MAX_ZOOM_PERCENT = 500;
const MAX_DESIGNS = 3;
const MAX_DESIGN_NAME_LENGTH = 25;
const DESIGN_LIMIT_MESSAGE = 'max 3 golvdesigner samtidigt.';
const DEFAULT_BACKGROUND_OPACITY = 0.1;
const UNDO_HISTORY_LIMIT = 20;

const FLOOR_DESIGNS_STORAGE_KEY = 'profloor.floor-designs';

// --- Share URL helpers ---
function encodeSharePayload(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodeSharePayload(encoded: string): unknown {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

interface FloorDesignState {
  designs: FloorDesign[];
  activeDesignId: string;
}

interface DesignHistorySnapshot {
  points: Point[];
  scale: number;
  offset: { x: number; y: number };
  originPointIdx: number;
  backgroundDrawing: ImportedDrawingBackground | null;
  showBackgroundDrawing: boolean;
  backgroundOpacity: number;
}

interface TabContextMenuState {
  x: number;
  y: number;
  designId: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const asNumber = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) ? value : fallback;

const createDesignId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface LayoutOptimizationConstraints {
  minStaggerMin: number;   // mm — minimum allowed minStagger
  minStaggerMax: number;   // mm — upper bound (also clamped to length/2)
  iterations: number;      // number of random samples to evaluate
  // Future: manufacturer-specific rules (e.g. requiredStaggerStep, maxStartOffset)
}

const DEFAULT_OPTIMIZATION_CONSTRAINTS: LayoutOptimizationConstraints = {
  minStaggerMin: 250,
  minStaggerMax: 500,
  iterations: 120,
};

const findOptimizedLayout = (
  points: Point[],
  settings: PlankSettings,
  constraints: LayoutOptimizationConstraints
): Pick<PlankSettings, 'startOffset' | 'startOffsetVertical' | 'minStagger'> => {
  const staggerCeiling = Math.min(constraints.minStaggerMax, Math.floor(settings.length / 2));
  const staggerFloor = Math.min(constraints.minStaggerMin, staggerCeiling);
  const staggerRange = Math.max(0, staggerCeiling - staggerFloor);

  // Apply the same room-rotation the main layout path uses
  const effectivePoints = settings.layoutRotated
    ? points.map((p) => ({ x: p.y, y: -p.x }))
    : points;

  let bestPlanksOpened = Infinity;
  let best = {
    startOffset: settings.startOffset,
    startOffsetVertical: settings.startOffsetVertical,
    minStagger: settings.minStagger,
  };

  for (let i = 0; i < constraints.iterations; i++) {
    const candidate: PlankSettings = {
      ...settings,
      startOffset: Math.round(Math.random() * settings.length),
      startOffsetVertical: Math.round(Math.random() * settings.width),
      minStagger: Math.round(staggerFloor + Math.random() * staggerRange),
    };
    const { totalPlanksOpened } = calculateLayout(effectivePoints, candidate);
    if (totalPlanksOpened < bestPlanksOpened) {
      bestPlanksOpened = totalPlanksOpened;
      best = {
        startOffset: candidate.startOffset,
        startOffsetVertical: candidate.startOffsetVertical,
        minStagger: candidate.minStagger,
      };
    }
  }

  return best;
};

const toProductDesignSettings = (settings: PlankSettings): ProductDesignSettings => ({
  minStagger: settings.minStagger,
  startOffset: settings.startOffset,
  startOffsetVertical: settings.startOffsetVertical,
  minEndPiece: settings.minEndPiece,
  layoutRotated: settings.layoutRotated
});

const getProductDefaults = (product: SavedProduct): ProductDesignSettings => ({
  minStagger: product.minStagger,
  startOffset: product.startOffset,
  startOffsetVertical: product.startOffsetVertical,
  minEndPiece: product.minEndPiece,
  layoutRotated: false
});

const DEFAULT_FLOOR_POINTS: Point[] = [
  { x: -2000, y: -1500 },
  { x: 2000, y: -1500 },
  { x: 2000, y: 1500 },
  { x: -2000, y: 1500 }
];

const getDesignStateKey = (design: Pick<FloorDesign, 'points' | 'settings' | 'activeProductId' | 'productSettingsById' | 'products'>): string =>
  JSON.stringify({ points: design.points, settings: design.settings, activeProductId: design.activeProductId, productSettingsById: design.productSettingsById, products: design.products });

const DEFAULT_STATE_KEY = getDesignStateKey({
  points: DEFAULT_FLOOR_POINTS,
  settings: INITIAL_SETTINGS,
  activeProductId: null,
  productSettingsById: {},
  products: [],
});

const isDesignDirty = (design: FloorDesign): boolean => {
  const current = getDesignStateKey(design);
  if (design.savedStateKey) return design.savedStateKey !== current;
  // Never saved: dirty only if meaningfully changed from blank default
  return current !== DEFAULT_STATE_KEY;
};

const createDefaultDesign = (name: string): FloorDesign => ({
  id: createDesignId(),
  name,
  points: DEFAULT_FLOOR_POINTS.map((p) => ({ ...p })),
  settings: { ...INITIAL_SETTINGS },
  products: [],
  productSettingsById: {},
  activeProductId: null,
  productInfo: null,
  scale: DEFAULT_SCALE,
  offset: { ...DEFAULT_OFFSET },
  backgroundDrawing: null,
  showBackgroundDrawing: false,
  backgroundOpacity: DEFAULT_BACKGROUND_OPACITY
});

const getNextDesignName = (designs: FloorDesign[]): string => {
  for (let i = 1; i <= MAX_DESIGNS; i++) {
    const candidate = `Golv ${i}`;
    if (!designs.some((design) => design.name === candidate)) {
      return candidate;
    }
  }
  return `Golv ${designs.length + 1}`;
};

const sanitizePlankSettings = (value: unknown): PlankSettings => {
  const raw = isRecord(value) ? value : {};
  const planksPerPackage = Math.max(1, Math.round(asNumber(raw.planksPerPackage, INITIAL_SETTINGS.planksPerPackage)));
  const originPointIdx = Math.max(0, Math.round(asNumber(raw.originPointIdx, INITIAL_SETTINGS.originPointIdx)));

  return {
    ...INITIAL_SETTINGS,
    length: asNumber(raw.length, INITIAL_SETTINGS.length),
    width: asNumber(raw.width, INITIAL_SETTINGS.width),
    minEndPiece: asNumber(raw.minEndPiece, INITIAL_SETTINGS.minEndPiece),
    minStagger: asNumber(raw.minStagger, INITIAL_SETTINGS.minStagger),
    gap: asNumber(raw.gap, INITIAL_SETTINGS.gap),
    startOffset: asNumber(raw.startOffset, INITIAL_SETTINGS.startOffset),
    startOffsetVertical: asNumber(raw.startOffsetVertical, INITIAL_SETTINGS.startOffsetVertical),
    planksPerPackage,
    visualContrast: asNumber(raw.visualContrast, INITIAL_SETTINGS.visualContrast),
    originPointIdx,
    layoutRotated: raw.layoutRotated === true
  };
};

const parsePoint = (value: unknown): Point | null => {
  if (!isRecord(value)) return null;
  const x = value.x;
  const y = value.y;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return { x, y };
};

const clonePoints = (points: Point[]): Point[] => points.map((point) => ({ x: point.x, y: point.y }));

const arePointsEqual = (a: Point[], b: Point[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) {
      return false;
    }
  }
  return true;
};

const areBackgroundDrawingsEqual = (
  a: ImportedDrawingBackground | null,
  b: ImportedDrawingBackground | null
) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.src === b.src &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
};

const areSnapshotsEqual = (a: DesignHistorySnapshot, b: DesignHistorySnapshot): boolean =>
  a.scale === b.scale &&
  a.offset.x === b.offset.x &&
  a.offset.y === b.offset.y &&
  a.originPointIdx === b.originPointIdx &&
  a.showBackgroundDrawing === b.showBackgroundDrawing &&
  a.backgroundOpacity === b.backgroundOpacity &&
  areBackgroundDrawingsEqual(a.backgroundDrawing, b.backgroundDrawing) &&
  arePointsEqual(a.points, b.points);

const toHistorySnapshot = (design: FloorDesign): DesignHistorySnapshot => ({
  points: clonePoints(design.points),
  scale: design.scale,
  offset: { ...design.offset },
  originPointIdx: design.settings.originPointIdx,
  backgroundDrawing: design.backgroundDrawing ? { ...design.backgroundDrawing } : null,
  showBackgroundDrawing: design.showBackgroundDrawing,
  backgroundOpacity: design.backgroundOpacity
});

const parseImportedDrawingBackground = (value: unknown): ImportedDrawingBackground | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.src !== 'string' ||
    !value.src.trim() ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height)
  ) {
    return null;
  }
  if (value.width <= 0 || value.height <= 0) {
    return null;
  }

  return {
    src: value.src,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height
  };
};

const parseProductInfo = (value: unknown): ProductInfo | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.name !== 'string' ||
    !isFiniteNumber(value.pricePerPackage) ||
    typeof value.currency !== 'string' ||
    typeof value.url !== 'string'
  ) {
    return null;
  }

  return {
    name: value.name,
    pricePerPackage: value.pricePerPackage,
    currency: value.currency,
    url: value.url,
    stockStatus: typeof value.stockStatus === 'string' && value.stockStatus.trim() ? value.stockStatus : undefined,
    deliveryEstimate: typeof value.deliveryEstimate === 'string' && value.deliveryEstimate.trim() ? value.deliveryEstimate : undefined,
    isCampaignPrice: typeof value.isCampaignPrice === 'boolean' ? value.isCampaignPrice : undefined,
    imageUrl: typeof value.imageUrl === 'string' && value.imageUrl.trim() ? value.imageUrl : undefined
  };
};

const parseProductDesignSettings = (value: unknown): ProductDesignSettings | null => {
  if (!isRecord(value)) return null;
  if (
    !isFiniteNumber(value.minStagger) ||
    !isFiniteNumber(value.startOffset) ||
    !isFiniteNumber(value.startOffsetVertical) ||
    !isFiniteNumber(value.minEndPiece)
  ) {
    return null;
  }

  return {
    minStagger: value.minStagger,
    startOffset: value.startOffset,
    startOffsetVertical: value.startOffsetVertical,
    minEndPiece: value.minEndPiece,
    layoutRotated: value.layoutRotated === true
  };
};

const parseProductSettingsById = (value: unknown): Record<string, ProductDesignSettings> => {
  if (!isRecord(value)) return {};

  const productSettingsById: Record<string, ProductDesignSettings> = {};
  Object.entries(value).forEach(([productId, productSettings]) => {
    const parsed = parseProductDesignSettings(productSettings);
    if (parsed) {
      productSettingsById[productId] = parsed;
    }
  });

  return productSettingsById;
};

const parseSavedProduct = (item: unknown): SavedProduct | null => {
  if (!isRecord(item)) return null;
  if (
    typeof item.id !== 'string' ||
    typeof item.name !== 'string' ||
    !isFiniteNumber(item.pricePerPackage) ||
    typeof item.currency !== 'string' ||
    typeof item.url !== 'string' ||
    !isFiniteNumber(item.lengthMm) ||
    !isFiniteNumber(item.widthMm) ||
    !isFiniteNumber(item.planksPerPackage)
  ) {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    pricePerPackage: item.pricePerPackage,
    currency: item.currency,
    url: item.url,
    stockStatus: typeof item.stockStatus === 'string' && item.stockStatus.trim() ? item.stockStatus : undefined,
    deliveryEstimate: typeof item.deliveryEstimate === 'string' && item.deliveryEstimate.trim() ? item.deliveryEstimate : undefined,
    isCampaignPrice: typeof item.isCampaignPrice === 'boolean' ? item.isCampaignPrice : undefined,
    imageUrl: typeof item.imageUrl === 'string' && item.imageUrl.trim() ? item.imageUrl : undefined,
    lengthMm: item.lengthMm,
    widthMm: item.widthMm,
    planksPerPackage: item.planksPerPackage,
    minStagger: isFiniteNumber(item.minStagger) ? item.minStagger : INITIAL_SETTINGS.minStagger,
    startOffset: isFiniteNumber(item.startOffset) ? item.startOffset : INITIAL_SETTINGS.startOffset,
    startOffsetVertical: isFiniteNumber(item.startOffsetVertical) ? item.startOffsetVertical : INITIAL_SETTINGS.startOffsetVertical,
    minEndPiece: isFiniteNumber(item.minEndPiece) ? item.minEndPiece : INITIAL_SETTINGS.minEndPiece,
    lastRefreshedAt: typeof item.lastRefreshedAt === 'string' ? item.lastRefreshedAt : undefined,
    isBrokenLink: item.isBrokenLink === true ? true : undefined,
  };
};

const parseFloorDesign = (item: unknown, index: number): FloorDesign | null => {
  if (!isRecord(item)) return null;

  const points = Array.isArray(item.points)
    ? item.points.map(parsePoint).filter((point): point is Point => point !== null)
    : [];

  const rawOffset = isRecord(item.offset) ? item.offset : {};
  const offset = {
    x: asNumber(rawOffset.x, DEFAULT_OFFSET.x),
    y: asNumber(rawOffset.y, DEFAULT_OFFSET.y)
  };

  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, asNumber(item.scale, DEFAULT_SCALE)));
  const backgroundDrawing = parseImportedDrawingBackground(item.backgroundDrawing);
  const backgroundOpacity = Math.max(0, Math.min(1, asNumber(item.backgroundOpacity, DEFAULT_BACKGROUND_OPACITY)));
  const name = typeof item.name === 'string' && item.name.trim() ? item.name : `Golv ${index + 1}`;
  const id = typeof item.id === 'string' && item.id ? item.id : createDesignId();

  const products = Array.isArray(item.products)
    ? item.products.map(parseSavedProduct).filter((p): p is SavedProduct => p !== null).slice(0, 5)
    : [];

  return {
    id,
    name,
    points,
    settings: sanitizePlankSettings(item.settings),
    products,
    productSettingsById: parseProductSettingsById(item.productSettingsById),
    activeProductId: typeof item.activeProductId === 'string' ? item.activeProductId : null,
    productInfo: parseProductInfo(item.productInfo),
    scale,
    offset,
    backgroundDrawing,
    showBackgroundDrawing: backgroundDrawing ? (typeof item.showBackgroundDrawing === 'boolean' ? item.showBackgroundDrawing : true) : false,
    backgroundOpacity
  };
};

const loadFloorDesignState = (): FloorDesignState => {
  const defaultDesign = createDefaultDesign('Golv 1');
  if (typeof window === 'undefined') {
    return { designs: [defaultDesign], activeDesignId: defaultDesign.id };
  }

  try {
    const raw = localStorage.getItem(FLOOR_DESIGNS_STORAGE_KEY);
    if (!raw) {
      return { designs: [defaultDesign], activeDesignId: defaultDesign.id };
    }

    const parsed = JSON.parse(raw);
    const parsedRecord = isRecord(parsed) ? parsed : {};
    const parsedDesignsRaw = Array.isArray(parsedRecord.designs)
      ? parsedRecord.designs
      : Array.isArray(parsed)
        ? parsed
        : [];

    const designs = parsedDesignsRaw
      .map((design, index) => parseFloorDesign(design, index))
      .filter((design): design is FloorDesign => design !== null)
      .slice(0, MAX_DESIGNS);

    if (designs.length === 0) {
      return { designs: [defaultDesign], activeDesignId: defaultDesign.id };
    }

    const activeDesignId =
      typeof parsedRecord.activeDesignId === 'string' && designs.some((design) => design.id === parsedRecord.activeDesignId)
        ? parsedRecord.activeDesignId
        : designs[0].id;

    return { designs, activeDesignId };
  } catch {
    return { designs: [defaultDesign], activeDesignId: defaultDesign.id };
  }
};

const App: React.FC = () => {
  const [designState, setDesignState] = useState<FloorDesignState>(loadFloorDesignState);
  const [showEdgeLengths, setShowEdgeLengths] = useState(true);
  const [gridSize, setGridSize] = useState(100);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [editingDesignId, setEditingDesignId] = useState<string | null>(null);
  const [editingDesignName, setEditingDesignName] = useState('');
  const [tabNameError, setTabNameError] = useState(false);
  const [renamingFloorId, setRenamingFloorId] = useState<string | null>(null);
  const [renamingFloorName, setRenamingFloorName] = useState('');
  const [zoomPercentInput, setZoomPercentInput] = useState(() => String(Math.round(DEFAULT_SCALE * 1000)));
  const [historyByDesignId, setHistoryByDesignId] = useState<Record<string, DesignHistorySnapshot[]>>({});
  const [redoByDesignId, setRedoByDesignId] = useState<Record<string, DesignHistorySnapshot[]>>({});
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'SIGNED_IN' && session?.user) {
        logEvent('login', session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  const [importLaunchError, setImportLaunchError] = useState<string | null>(null);
  const [isImportDropActive, setIsImportDropActive] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [showSavedFloors, setShowSavedFloors] = useState(false);
  const [savedFloorsList, setSavedFloorsList] = useState<Array<{ id: string; name: string; updated_at: string; summary?: { areaMm2?: number; wastePercent?: number; packageCount?: number; totalPrice?: number | null; currency?: string | null; productName?: string | null } | null; thumbnail?: string | null }>>([]);
  const [savedFloorsLoading, setSavedFloorsLoading] = useState(false);
  const [pendingCloseDesignId, setPendingCloseDesignId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const anonymousFloorLoggedRef = useRef(false);
  const [isManualActive, setIsManualActive] = useState(false);
  const [manualFloorSettings, setManualFloorSettings] = useState({
    length: INITIAL_SETTINGS.length,
    width: INITIAL_SETTINGS.width,
    planksPerPackage: INITIAL_SETTINGS.planksPerPackage,
    pricePerPackage: 0
  });

  const activeDesign = useMemo(() => {
    return designState.designs.find((design) => design.id === designState.activeDesignId) ?? designState.designs[0];
  }, [designState]);

  const points = activeDesign.points;
  const settings = activeDesign.settings;
  const scale = activeDesign.scale;
  const offset = activeDesign.offset;
  const productInfo = activeDesign.productInfo;
  const activeProductId = activeDesign.activeProductId;
  const backgroundDrawing = activeDesign.backgroundDrawing;
  const showBackgroundDrawing = activeDesign.showBackgroundDrawing;
  const backgroundOpacity = activeDesign.backgroundOpacity;
  // Restore shared design from Supabase (?shared=<uuid>) on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('shared');
    if (!sharedId) return;
    supabase
      .from('shared_floors')
      .select('floor_data')
      .eq('id', sharedId)
      .single()
      .then(({ data, error }) => {
        if (error || !data?.floor_data) return;
        const payload = data.floor_data as {
          name?: string;
          points?: Point[];
          settings?: PlankSettings;
          products?: SavedProduct[];
          savedProducts?: SavedProduct[]; // legacy
          activeProductId?: string | null;
          productSettingsById?: Record<string, ProductDesignSettings>;
          backgroundDrawing?: ImportedDrawingBackground | null;
          showBackgroundDrawing?: boolean;
          backgroundOpacity?: number;
        };
        const restoredProducts = (payload.products ?? payload.savedProducts ?? [])
          .map(parseSavedProduct).filter((p): p is SavedProduct => p !== null).slice(0, 5);
        setDesignState((prev) => ({
          ...prev,
          designs: prev.designs.map((d) =>
            d.id === prev.activeDesignId
              ? {
                  ...d,
                  ...(payload.name ? { name: payload.name } : {}),
                  ...(payload.points ? { points: payload.points } : {}),
                  ...(payload.settings ? { settings: payload.settings } : {}),
                  ...(payload.activeProductId !== undefined ? { activeProductId: payload.activeProductId } : {}),
                  ...(payload.productSettingsById ? { productSettingsById: payload.productSettingsById } : {}),
                  ...(payload.backgroundDrawing !== undefined ? { backgroundDrawing: payload.backgroundDrawing } : {}),
                  ...(payload.showBackgroundDrawing !== undefined ? { showBackgroundDrawing: payload.showBackgroundDrawing } : {}),
                  ...(payload.backgroundOpacity !== undefined ? { backgroundOpacity: payload.backgroundOpacity } : {}),
                  products: restoredProducts,
                }
              : d
          ),
        }));
        history.replaceState(null, '', window.location.pathname);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore shared design from URL hash on mount (legacy fallback)
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith('s=')) return;
    const encoded = hash.slice(2);
    try {
      const payload = decodeSharePayload(encoded) as {
        name?: string;
        points?: Point[];
        settings?: PlankSettings;
        products?: SavedProduct[];
        savedProducts?: SavedProduct[]; // legacy
        activeProductId?: string | null;
        productSettingsById?: Record<string, ProductDesignSettings>;
      };
      const restoredProducts = (payload.products ?? payload.savedProducts ?? [])
        .map(parseSavedProduct).filter((p): p is SavedProduct => p !== null).slice(0, 5);
      setDesignState((prev) => ({
        ...prev,
        designs: prev.designs.map((d) =>
          d.id === prev.activeDesignId
            ? {
                ...d,
                ...(payload.name ? { name: payload.name } : {}),
                ...(payload.points ? { points: payload.points } : {}),
                ...(payload.settings ? { settings: payload.settings } : {}),
                ...(payload.activeProductId !== undefined ? { activeProductId: payload.activeProductId } : {}),
                ...(payload.productSettingsById ? { productSettingsById: payload.productSettingsById } : {}),
                products: restoredProducts,
              }
            : d
        ),
      }));
      history.replaceState(null, '', window.location.pathname);
    } catch {
      // Ignore malformed share URLs
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(FLOOR_DESIGNS_STORAGE_KEY, JSON.stringify(designState));
    } catch {
      // Ignore storage write errors (e.g. private browsing quota limits).
    }
  }, [designState]);

  useEffect(() => {
    if (!editingDesignId) return;
    const designExists = designState.designs.some((design) => design.id === editingDesignId);
    if (!designExists) {
      setEditingDesignId(null);
      setEditingDesignName('');
    }
  }, [designState.designs, editingDesignId]);

  useEffect(() => {
    setZoomPercentInput(String(Math.round(scale * 1000)));
  }, [scale, designState.activeDesignId]);

  useEffect(() => {
    setHistoryByDesignId((prev) => {
      const validIds = new Set(designState.designs.map((design) => design.id));
      let hasChanges = false;
      const next: Record<string, DesignHistorySnapshot[]> = {};
      Object.entries(prev).forEach(([designId, snapshots]) => {
        if (!validIds.has(designId)) {
          hasChanges = true;
          return;
        }
        next[designId] = snapshots;
      });
      return hasChanges ? next : prev;
    });
    setRedoByDesignId((prev) => {
      const validIds = new Set(designState.designs.map((design) => design.id));
      let hasChanges = false;
      const next: Record<string, DesignHistorySnapshot[]> = {};
      Object.entries(prev).forEach(([designId, snapshots]) => {
        if (!validIds.has(designId)) {
          hasChanges = true;
          return;
        }
        next[designId] = snapshots;
      });
      return hasChanges ? next : prev;
    });
  }, [designState.designs]);

  useEffect(() => {
    if (!tabContextMenu) return;
    const closeContextMenu = () => setTabContextMenu(null);
    window.addEventListener('click', closeContextMenu);
    return () => window.removeEventListener('click', closeContextMenu);
  }, [tabContextMenu]);

  // Track when an anonymous user makes their first floor design this session
  // Wait for authReady so we don't fire before we know if the user is logged in
  useEffect(() => {
    if (!authReady || user || anonymousFloorLoggedRef.current) return;
    if (activeDesign.points.length > 0) {
      anonymousFloorLoggedRef.current = true;
      logEvent('floor_designed_anonymous');
    }
  }, [authReady, user, activeDesign.points.length]);

  // Background refresh: when switching tabs, silently update price/stock for stale products
  const refreshingProductIds = useRef(new Set<string>());
  useEffect(() => {
    const design = designState.designs.find((d) => d.id === designState.activeDesignId);
    if (!design) return;
    const THIRTY_MIN_MS = 30 * 60 * 1000;
    const now = Date.now();
    const toRefresh = design.products.filter((p) => {
      if (!p.url || refreshingProductIds.current.has(p.id)) return false;
      const age = p.lastRefreshedAt ? now - new Date(p.lastRefreshedAt).getTime() : Infinity;
      return age > THIRTY_MIN_MS;
    });
    if (toRefresh.length === 0) return;

    toRefresh.forEach((product) => {
      refreshingProductIds.current.add(product.id);
      fetch('/api/product-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productUrl: product.url }),
      })
        .then(async (res) => {
          const isBrokenLink = res.status === 404;
          let updates: Partial<SavedProduct> = { lastRefreshedAt: new Date().toISOString(), isBrokenLink: isBrokenLink || undefined };
          if (res.ok) {
            const data = await res.json();
            updates = {
              ...updates,
              ...(data.pricePerPackage != null ? { pricePerPackage: data.pricePerPackage } : {}),
              ...(data.stockStatus !== undefined ? { stockStatus: data.stockStatus } : {}),
              ...(data.deliveryEstimate !== undefined ? { deliveryEstimate: data.deliveryEstimate } : {}),
              ...(data.isCampaignPrice !== undefined ? { isCampaignPrice: data.isCampaignPrice } : {}),
            };
          }
          setDesignState((prev) => ({
            ...prev,
            designs: prev.designs.map((d) => {
              if (d.id !== prev.activeDesignId) return d;
              const updatedProducts = d.products.map((p) =>
                p.id === product.id ? { ...p, ...updates } : p
              );
              const updatedProductInfo =
                d.activeProductId === product.id && d.productInfo && updates.pricePerPackage != null
                  ? { ...d.productInfo, pricePerPackage: updates.pricePerPackage }
                  : d.productInfo;
              return { ...d, products: updatedProducts, productInfo: updatedProductInfo };
            }),
          }));
        })
        .catch(() => { /* silent fail */ })
        .finally(() => { refreshingProductIds.current.delete(product.id); });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designState.activeDesignId]);

  useEffect(() => {
    if (!isToolsPanelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsToolsPanelOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isToolsPanelOpen]);

  const updateDesignById = (designId: string, updater: (design: FloorDesign) => FloorDesign) => {
    setDesignState((prev) => ({
      ...prev,
      designs: prev.designs.map((design) => (design.id === designId ? updater(design) : design))
    }));
  };

  const handleShare = async () => {
    let compressedBackground: ImportedDrawingBackground | null = null;
    if (activeDesign.backgroundDrawing?.src) {
      const compressedSrc = await compressBackgroundImage(activeDesign.backgroundDrawing.src);
      compressedBackground = { ...activeDesign.backgroundDrawing, src: compressedSrc };
    }
    const payload = {
      name: activeDesign.name,
      points,
      settings,
      products: activeDesign.products,
      activeProductId,
      productSettingsById: activeDesign.productSettingsById,
      backgroundDrawing: compressedBackground ?? activeDesign.backgroundDrawing,
      showBackgroundDrawing: activeDesign.showBackgroundDrawing,
      backgroundOpacity: activeDesign.backgroundOpacity,
    };
    let url: string;
    try {
      const { data, error } = await supabase
        .from('shared_floors')
        .insert({ floor_data: payload, created_by: user?.id ?? null })
        .select('id')
        .single();
      if (error || !data) throw error;
      url = `${window.location.origin}${window.location.pathname}?shared=${data.id}`;
    } catch {
      // Fallback: use URL hash with minimal payload (no background — too large for URL)
      const minimalPayload = { name: activeDesign.name, points, settings, products: activeDesign.products, activeProductId, productSettingsById: activeDesign.productSettingsById };
      const encoded = encodeSharePayload(minimalPayload);
      url = `${window.location.origin}${window.location.pathname}#s=${encoded}`;
      window.location.hash = `s=${encoded}`;
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard not available
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const generateFloorThumbnail = (pts: Point[], planksData: typeof planks, plankSettings: PlankSettings): string => {
    const W = 240;
    const H = 160;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx || pts.length < 3) return '';

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const floorW = maxX - minX, floorH = maxY - minY;
    if (floorW === 0 || floorH === 0) return '';

    // 15% extra padding so there's breathing room around the floor
    const pad = 22;
    const baseScale = Math.min((W - pad * 2) / floorW, (H - pad * 2) / floorH);
    const scale = baseScale * 0.85;
    const drawW = floorW * scale, drawH = floorH * scale;
    const ox = (W - drawW) / 2 - minX * scale;
    const oy = (H - drawH) / 2 - minY * scale;
    const tx = (x: number) => x * scale + ox;
    const ty = (y: number) => y * scale + oy;

    // Same background as canvas
    ctx.fillStyle = '#FCFBFA';
    ctx.fillRect(0, 0, W, H);

    // Floor fill + clip — same neutral as canvas background (planks paint over it)
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(tx(p.x), ty(p.y)) : ctx.lineTo(tx(p.x), ty(p.y))));
    ctx.closePath();
    ctx.fillStyle = '#F5F2EF';
    ctx.fill();
    ctx.save();
    ctx.clip();

    // Draw planks with same color logic as Canvas.tsx
    const contrast = plankSettings.visualContrast;
    const fc = { r: 210, g: 183, b: 172 }; // factoryColor
    const cc = { r: 245, g: 241, b: 239 }; // cutColorBase
    planksData.forEach((plank) => {
      if (!plank.isCut) {
        ctx.fillStyle = `rgba(${fc.r}, ${fc.g}, ${fc.b}, ${0.45 + contrast * 0.45})`;
      } else {
        const r = fc.r + (cc.r - fc.r) * contrast;
        const g = fc.g + (cc.g - fc.g) * contrast;
        const b = fc.b + (cc.b - fc.b) * contrast;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.38 - contrast * 0.14})`;
      }
      ctx.fillRect(tx(plank.x), ty(plank.y), plank.w * scale, plank.h * scale);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(tx(plank.x), ty(plank.y), plank.w * scale, plank.h * scale);
    });

    ctx.restore();

    // Floor outline
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(tx(p.x), ty(p.y)) : ctx.lineTo(tx(p.x), ty(p.y))));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    return canvas.toDataURL('image/png');
  };

  const compressBackgroundImage = (src: string): Promise<string> =>
    new Promise((resolve) => {
      if (!src.startsWith('data:')) { resolve(src); return; }
      const img = new Image();
      img.onload = () => {
        const MAX_W = 1200, MAX_H = 900;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX_W || h > MAX_H) {
          const ratio = Math.min(MAX_W / w, MAX_H / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });

  const buildSavePayload = (design: FloorDesign, compressedBackground: ImportedDrawingBackground | null | undefined, currentStats?: Stats, thumbnail?: string) => {
    const activeProduct = design.products.find((p) => p.id === design.activeProductId) ?? null;
    return {
      points: design.points,
      settings: design.settings,
      products: design.products,
      activeProductId: design.activeProductId,
      productSettingsById: design.productSettingsById,
      backgroundDrawing: compressedBackground ?? design.backgroundDrawing,
      showBackgroundDrawing: design.showBackgroundDrawing,
      backgroundOpacity: design.backgroundOpacity,
      activeProduct,
      summary: currentStats ? {
        areaMm2: currentStats.area,
        wastePercent: Math.round(currentStats.wastePercent * 10) / 10,
        packageCount: currentStats.packageCount,
        totalPrice: currentStats.totalPrice ?? null,
        currency: activeProduct?.currency ?? null,
        productName: activeProduct?.name ?? null,
      } : undefined,
      thumbnail: thumbnail || undefined,
    };
  };

  const handleSave = async () => {
    if (!user || isSaving) return;
    setIsSaving(true);
    const thumbnail = generateFloorThumbnail(activeDesign.points, planks, settings);
    let compressedBackground: ImportedDrawingBackground | null = null;
    if (activeDesign.backgroundDrawing?.src) {
      const compressedSrc = await compressBackgroundImage(activeDesign.backgroundDrawing.src);
      compressedBackground = { ...activeDesign.backgroundDrawing, src: compressedSrc };
    }
    const payload = buildSavePayload(activeDesign, compressedBackground, stats, thumbnail);
    const stateKey = getDesignStateKey(activeDesign);
    try {
      // Check for a different saved floor with the same name
      const nameQuery = supabase
        .from('saved_floors')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', activeDesign.name);
      if (activeDesign.savedFloorId) nameQuery.neq('id', activeDesign.savedFloorId);
      const { data: conflict } = await nameQuery.maybeSingle();

      if (conflict) {
        const overwrite = window.confirm(
          `Det finns redan ett sparat golv med namnet "${activeDesign.name}".\nVill du ersätta det?`
        );
        if (!overwrite) { setIsSaving(false); return; }
        // Delete the conflicting row before saving
        await supabase.from('saved_floors').delete().eq('id', conflict.id).eq('user_id', user.id);
        setSavedFloorsList((prev) => prev.filter((f) => f.id !== conflict.id));
      }

      if (activeDesign.savedFloorId) {
        await supabase
          .from('saved_floors')
          .update({ name: activeDesign.name, data: payload, updated_at: new Date().toISOString() })
          .eq('id', activeDesign.savedFloorId)
          .eq('user_id', user.id);
        updateActiveDesign((d) => ({ ...d, savedStateKey: stateKey }));
      } else {
        const { data } = await supabase
          .from('saved_floors')
          .insert({ user_id: user.id, name: activeDesign.name, data: payload })
          .select('id')
          .single();
        if (data) {
          updateActiveDesign((d) => ({ ...d, savedFloorId: data.id, savedStateKey: stateKey }));
        }
      }
      setSaveDone(true);
      setTimeout(() => setSaveDone(false), 2500);
    } catch {
      // Save failed silently
    } finally {
      setIsSaving(false);
    }
  };

  const updateActiveDesign = (updater: (design: FloorDesign) => FloorDesign) => {
    setDesignState((prev) => ({
      ...prev,
      designs: prev.designs.map((design) => (design.id === prev.activeDesignId ? updater(design) : design))
    }));
  };

  const loadSavedFloors = async () => {
    if (!user) return;
    setSavedFloorsLoading(true);
    const { data } = await supabase
      .from('saved_floors')
      .select('id, name, updated_at, data->summary, data->thumbnail')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (data) setSavedFloorsList(data as typeof savedFloorsList);
    setSavedFloorsLoading(false);
  };

  const handleLoadSavedFloor = async (entry: { id: string; name: string }) => {
    // If already open in a tab, just switch to it
    const alreadyOpenDesign = designState.designs.find((d) => d.savedFloorId === entry.id);
    if (alreadyOpenDesign) {
      setDesignState((prev) => ({ ...prev, activeDesignId: alreadyOpenDesign.id }));
      setShowSavedFloors(false);
      return;
    }

    if (designState.designs.length >= MAX_DESIGNS) {
      alert(`Stäng ett golv innan du öppnar ett nytt (max ${MAX_DESIGNS} flikar).`);
      return;
    }
    const { data, error } = await supabase
      .from('saved_floors')
      .select('data')
      .eq('id', entry.id)
      .single();
    if (error || !data?.data) return;

    const payload = data.data as {
      points?: Point[];
      settings?: PlankSettings;
      products?: SavedProduct[];
      activeProductId?: string | null;
      productSettingsById?: Record<string, ProductDesignSettings>;
      activeProduct?: SavedProduct | null; // legacy
      savedProducts?: SavedProduct[];      // legacy
      backgroundDrawing?: ImportedDrawingBackground | null;
      showBackgroundDrawing?: boolean;
      backgroundOpacity?: number;
    };

    // Restore products: new format first, then legacy fallbacks
    const restoredProducts = (
      payload.products ??
      (payload.activeProduct ? [payload.activeProduct] : null) ??
      payload.savedProducts ??
      []
    ).map(parseSavedProduct).filter((p): p is SavedProduct => p !== null).slice(0, 5);

    const newPoints = payload.points ?? DEFAULT_FLOOR_POINTS.map((p) => ({ ...p }));
    const newSettings = payload.settings ?? { ...INITIAL_SETTINGS };
    const newActiveProductId = payload.activeProductId ?? null;
    const newProductSettingsById = payload.productSettingsById ?? {};
    const newBackgroundDrawing = parseImportedDrawingBackground(payload.backgroundDrawing ?? null);

    const stateKey = getDesignStateKey({
      points: newPoints,
      settings: newSettings,
      activeProductId: newActiveProductId,
      productSettingsById: newProductSettingsById,
      products: restoredProducts,
    });

    // Auto-suffix tab name if a tab with that name already exists
    let tabName = entry.name;
    const existingTabNames = new Set(designState.designs.map((d) => d.name.trim().toLowerCase()));
    if (existingTabNames.has(tabName.trim().toLowerCase())) {
      let suffix = 2;
      while (existingTabNames.has(`${tabName} (${suffix})`.toLowerCase())) suffix++;
      tabName = `${tabName} (${suffix})`;
    }

    const newDesign: FloorDesign = {
      ...createDefaultDesign(tabName),
      savedFloorId: entry.id,
      savedStateKey: stateKey,
      points: newPoints,
      settings: newSettings,
      products: restoredProducts,
      activeProductId: newActiveProductId,
      productSettingsById: newProductSettingsById,
      backgroundDrawing: newBackgroundDrawing,
      showBackgroundDrawing: newBackgroundDrawing ? (payload.showBackgroundDrawing ?? true) : false,
      backgroundOpacity: typeof payload.backgroundOpacity === 'number'
        ? Math.max(0, Math.min(1, payload.backgroundOpacity))
        : DEFAULT_BACKGROUND_OPACITY,
    };

    setDesignState((prev) => ({ designs: [...prev.designs, newDesign], activeDesignId: newDesign.id }));
    setShowSavedFloors(false);
  };

  const handleDeleteSavedFloor = async (savedFloorId: string) => {
    if (!user) return;
    if (!window.confirm('Ta bort det sparade golvet permanent?')) return;
    await supabase.from('saved_floors').delete().eq('id', savedFloorId).eq('user_id', user.id);
    setSavedFloorsList((prev) => prev.filter((f) => f.id !== savedFloorId));
  };

  const handleRenameFloor = async (id: string, newName: string) => {
    if (!user) return;
    const trimmed = newName.trim();
    if (!trimmed) { setRenamingFloorId(null); return; }
    // Block duplicate names
    if (savedFloorsList.some((f) => f.id !== id && f.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      alert(`Det finns redan ett sparat golv med namnet "${trimmed}".`);
      return;
    }
    await supabase.from('saved_floors').update({ name: trimmed }).eq('id', id).eq('user_id', user.id);
    setSavedFloorsList((prev) => prev.map((f) => f.id === id ? { ...f, name: trimmed } : f));
    // Also update the name on any open tab with this savedFloorId
    setDesignState((prev) => ({
      ...prev,
      designs: prev.designs.map((d) => d.savedFloorId === id ? { ...d, name: trimmed } : d),
    }));
    setRenamingFloorId(null);
  };

  // Performs the actual removal of a design tab (no guards)
  const closeDesign = (designId: string) => {
    if (editingDesignId === designId) {
      setEditingDesignId(null);
      setEditingDesignName('');
    }
    if (tabContextMenu?.designId === designId) setTabContextMenu(null);
    setPendingCloseDesignId(null);
    setDesignState((prev) => {
      if (prev.designs.length <= 1) return prev;
      const removeIdx = prev.designs.findIndex((d) => d.id === designId);
      if (removeIdx === -1) return prev;
      const nextDesigns = prev.designs.filter((d) => d.id !== designId);
      const nextActiveId =
        prev.activeDesignId === designId
          ? (nextDesigns[removeIdx] ?? nextDesigns[removeIdx - 1] ?? nextDesigns[0]).id
          : prev.activeDesignId;
      return { designs: nextDesigns, activeDesignId: nextActiveId };
    });
  };

  const pushHistorySnapshot = useCallback((designId: string, snapshot: DesignHistorySnapshot) => {
    setHistoryByDesignId((prev) => {
      const current = prev[designId] ?? [];
      const lastSnapshot = current[current.length - 1];
      if (lastSnapshot && areSnapshotsEqual(lastSnapshot, snapshot)) {
        return prev;
      }
      return {
        ...prev,
        [designId]: [...current, snapshot].slice(-UNDO_HISTORY_LIMIT)
      };
    });
  }, []);

  const clearRedoHistoryForDesign = useCallback((designId: string) => {
    setRedoByDesignId((prev) => {
      const current = prev[designId] ?? [];
      if (current.length === 0) return prev;
      const { [designId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const recordActiveHistory = useCallback(() => {
    pushHistorySnapshot(activeDesign.id, toHistorySnapshot(activeDesign));
    clearRedoHistoryForDesign(activeDesign.id);
  }, [activeDesign, clearRedoHistoryForDesign, pushHistorySnapshot]);

  const handleUndo = useCallback(() => {
    const snapshots = historyByDesignId[activeDesign.id] ?? [];
    const snapshot = snapshots[snapshots.length - 1];
    if (!snapshot) return;
    const currentSnapshot = toHistorySnapshot(activeDesign);

    setHistoryByDesignId((prev) => ({
      ...prev,
      [activeDesign.id]: (prev[activeDesign.id] ?? []).slice(0, -1)
    }));

    setRedoByDesignId((prev) => {
      const current = prev[activeDesign.id] ?? [];
      return {
        ...prev,
        [activeDesign.id]: [...current, currentSnapshot].slice(-UNDO_HISTORY_LIMIT)
      };
    });

    const restoredPoints = clonePoints(snapshot.points);
    const maxOriginIdx = Math.max(0, restoredPoints.length - 1);
    updateDesignById(activeDesign.id, (design) => ({
      ...design,
      points: restoredPoints,
      scale: snapshot.scale,
      offset: { ...snapshot.offset },
      backgroundDrawing: snapshot.backgroundDrawing ? { ...snapshot.backgroundDrawing } : null,
      showBackgroundDrawing: snapshot.showBackgroundDrawing,
      backgroundOpacity: snapshot.backgroundOpacity,
      settings: {
        ...design.settings,
        originPointIdx: Math.min(Math.max(snapshot.originPointIdx, 0), maxOriginIdx)
      }
    }));
  }, [activeDesign, historyByDesignId]);

  const handleRedo = useCallback(() => {
    const snapshots = redoByDesignId[activeDesign.id] ?? [];
    const snapshot = snapshots[snapshots.length - 1];
    if (!snapshot) return;
    const currentSnapshot = toHistorySnapshot(activeDesign);

    setRedoByDesignId((prev) => ({
      ...prev,
      [activeDesign.id]: (prev[activeDesign.id] ?? []).slice(0, -1)
    }));

    setHistoryByDesignId((prev) => {
      const current = prev[activeDesign.id] ?? [];
      return {
        ...prev,
        [activeDesign.id]: [...current, currentSnapshot].slice(-UNDO_HISTORY_LIMIT)
      };
    });

    const restoredPoints = clonePoints(snapshot.points);
    const maxOriginIdx = Math.max(0, restoredPoints.length - 1);
    updateDesignById(activeDesign.id, (design) => ({
      ...design,
      points: restoredPoints,
      scale: snapshot.scale,
      offset: { ...snapshot.offset },
      backgroundDrawing: snapshot.backgroundDrawing ? { ...snapshot.backgroundDrawing } : null,
      showBackgroundDrawing: snapshot.showBackgroundDrawing,
      backgroundOpacity: snapshot.backgroundOpacity,
      settings: {
        ...design.settings,
        originPointIdx: Math.min(Math.max(snapshot.originPointIdx, 0), maxOriginIdx)
      }
    }));
  }, [activeDesign, redoByDesignId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) return;

      if ((event.shiftKey && key === 'z') || key === 'y') {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (!event.shiftKey && key === 'z') {
        event.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRedo, handleUndo]);

  const canUndo = (historyByDesignId[activeDesign.id]?.length ?? 0) > 0;
  const canRedo = (redoByDesignId[activeDesign.id]?.length ?? 0) > 0;

  const setActivePoints = (nextPoints: Point[]) => {
    updateActiveDesign((design) => ({ ...design, points: nextPoints }));
  };

  const setActiveSettings = (nextSettings: PlankSettings) => {
    updateActiveDesign((design) => {
      if (!design.activeProductId) {
        return {
          ...design,
          settings: nextSettings
        };
      }

      return {
        ...design,
        settings: nextSettings,
        productSettingsById: {
          ...design.productSettingsById,
          [design.activeProductId]: toProductDesignSettings(nextSettings)
        }
      };
    });
  };

  const setActiveScale = (nextScale: number) => {
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    updateActiveDesign((design) => ({ ...design, scale: clampedScale }));
  };

  const setActiveOffset = (nextOffset: { x: number; y: number }) => {
    updateActiveDesign((design) => ({ ...design, offset: nextOffset }));
  };

  const setActiveView = (nextScale: number, nextOffset: { x: number; y: number }) => {
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    updateActiveDesign((design) => ({
      ...design,
      scale: clampedScale,
      offset: nextOffset
    }));
  };

  const centerOffsetForPoints = (targetPoints: Point[], targetScale: number) => {
    if (targetPoints.length === 0) return { ...DEFAULT_OFFSET };
    const { minX, minY, maxX, maxY } = getBoundingBox(targetPoints);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return {
      x: -(centerX * targetScale),
      y: -(centerY * targetScale)
    };
  };

  const { planks, wastePieces, totalPlanksOpened } = useMemo(() => {
    if (points.length < 3) return { planks: [], wastePieces: [], totalPlanksOpened: 0 };
    if (!settings.layoutRotated) return calculateLayout(points, settings);
    // Rotate room 90° CW: (x, y) → (y, -x); settings unchanged — room rotation alone
    // transforms the coordinate space so planks end up running vertically after back-rotation
    const rotatedPoints = points.map(p => ({ x: p.y, y: -p.x }));
    const result = calculateLayout(rotatedPoints, settings);
    // Rotate planks back 90° CCW: rect at (px,py,pw,ph) → (-(py+ph), px, ph, pw)
    const rotatePlanks = result.planks.map(p => ({ ...p, x: -(p.y + p.h), y: p.x, w: p.h, h: p.w }));
    const rotateWaste = result.wastePieces.map(w => ({ ...w, x: -(w.y + w.h), y: w.x, w: w.h, h: w.w }));
    return { ...result, planks: rotatePlanks, wastePieces: rotateWaste };
  }, [points, settings]);

  const stats = useMemo<Stats>(() => {
    if (points.length < 3) {
      return { area: 0, plankCount: 0, packageCount: 0, wasteArea: 0, wastePercent: 0 };
    }

    const areaMm2 = getPolygonArea(points);
    const areaM2 = areaMm2 / 1000000;

    const singlePlankAreaM2 = (settings.length * settings.width) / 1000000;
    const packageCount = Math.ceil(totalPlanksOpened / settings.planksPerPackage);
    const purchasedPlanks = packageCount * settings.planksPerPackage;
    const purchasedMaterialM2 = purchasedPlanks * singlePlankAreaM2;

    const wasteArea = Math.max(0, purchasedMaterialM2 - areaM2);
    const wastePercent = purchasedMaterialM2 > 0 ? (wasteArea / purchasedMaterialM2) * 100 : 0;

    let totalPrice = undefined;
    if (productInfo) {
      totalPrice = packageCount * productInfo.pricePerPackage;
    }

    return {
      area: areaM2,
      plankCount: totalPlanksOpened,
      packageCount,
      wasteArea,
      wastePercent,
      totalPrice
    };
  }, [points, totalPlanksOpened, settings, productInfo]);

  const productStatsById = useMemo(() => {
    const statsMap: Record<string, Stats> = {};

    activeDesign.products.forEach((product) => {
      if (points.length < 3) {
        statsMap[product.id] = { area: 0, plankCount: 0, packageCount: 0, wasteArea: 0, wastePercent: 0 };
        return;
      }

      const productSpecificSettings =
        activeDesign.productSettingsById[product.id] ?? getProductDefaults(product);

      const productSettings: PlankSettings = {
        ...settings,
        length: product.lengthMm,
        width: product.widthMm,
        planksPerPackage: product.planksPerPackage,
        minStagger: productSpecificSettings.minStagger,
        startOffset: productSpecificSettings.startOffset,
        startOffsetVertical: productSpecificSettings.startOffsetVertical,
        minEndPiece: productSpecificSettings.minEndPiece
      };

      const { totalPlanksOpened: productPlanksOpened } = calculateLayout(points, productSettings);
      const packageCount = Math.ceil(productPlanksOpened / product.planksPerPackage);
      const areaMm2 = getPolygonArea(points);
      const areaM2 = areaMm2 / 1_000_000;
      const singlePlankAreaM2 = (product.lengthMm * product.widthMm) / 1_000_000;
      const purchasedPlanks = packageCount * product.planksPerPackage;
      const purchasedMaterialM2 = purchasedPlanks * singlePlankAreaM2;
      const wasteArea = Math.max(0, purchasedMaterialM2 - areaM2);
      const wastePercent = purchasedMaterialM2 > 0 ? (wasteArea / purchasedMaterialM2) * 100 : 0;
      const totalPrice = packageCount * product.pricePerPackage;

      statsMap[product.id] = { area: areaM2, plankCount: productPlanksOpened, packageCount, wasteArea, wastePercent, totalPrice };
    });

    return statsMap;
  }, [activeDesign.products, points, settings, activeDesign.productSettingsById]);

  const manualStats = useMemo((): Stats => {
    if (points.length < 3 || manualFloorSettings.length <= 0 || manualFloorSettings.width <= 0 || manualFloorSettings.planksPerPackage <= 0) {
      return { area: 0, plankCount: 0, packageCount: 0, wasteArea: 0, wastePercent: 0 };
    }
    const manualSettings: PlankSettings = {
      ...INITIAL_SETTINGS,
      length: manualFloorSettings.length,
      width: manualFloorSettings.width,
      planksPerPackage: manualFloorSettings.planksPerPackage
    };
    const { totalPlanksOpened } = calculateLayout(points, manualSettings);
    const packageCount = Math.ceil(totalPlanksOpened / manualFloorSettings.planksPerPackage);
    const areaMm2 = getPolygonArea(points);
    const areaM2 = areaMm2 / 1_000_000;
    const singlePlankAreaM2 = (manualFloorSettings.length * manualFloorSettings.width) / 1_000_000;
    const purchasedPlanks = packageCount * manualFloorSettings.planksPerPackage;
    const purchasedMaterialM2 = purchasedPlanks * singlePlankAreaM2;
    const wasteArea = Math.max(0, purchasedMaterialM2 - areaM2);
    const wastePercent = purchasedMaterialM2 > 0 ? (wasteArea / purchasedMaterialM2) * 100 : 0;
    const totalPrice = manualFloorSettings.pricePerPackage > 0 ? packageCount * manualFloorSettings.pricePerPackage : undefined;
    return { area: areaM2, plankCount: totalPlanksOpened, packageCount, wasteArea, wastePercent, totalPrice };
  }, [manualFloorSettings, points]);

  const activateProduct = (product: SavedProduct) => {
    setIsManualActive(false);
    updateActiveDesign((design) => {
      const isNewProduct = !design.productSettingsById[product.id];
      const existingSettings = design.productSettingsById[product.id] ?? getProductDefaults(product);
      const productSettingsById = design.productSettingsById[product.id]
        ? design.productSettingsById
        : {
            ...design.productSettingsById,
            [product.id]: existingSettings
          };

      const baseSettings: PlankSettings = {
        ...design.settings,
        length: product.lengthMm,
        width: product.widthMm,
        planksPerPackage: product.planksPerPackage,
        minStagger: existingSettings.minStagger,
        startOffset: existingSettings.startOffset,
        startOffsetVertical: existingSettings.startOffsetVertical,
        minEndPiece: existingSettings.minEndPiece,
        layoutRotated: existingSettings.layoutRotated
      };

      // Auto-optimize waste for freshly added products (no saved layout settings yet)
      let finalSettings = baseSettings;
      if (isNewProduct && design.points.length >= 3) {
        const minStaggerMin = baseSettings.length < 1000
          ? Math.ceil(baseSettings.length * 0.25 / 10) * 10
          : 250;
        const constraints = { ...DEFAULT_OPTIMIZATION_CONSTRAINTS, minStaggerMin };
        const optimized = findOptimizedLayout(design.points, baseSettings, constraints);
        finalSettings = { ...baseSettings, ...optimized };
      }

      return {
        ...design,
        activeProductId: product.id,
        productInfo: {
          name: product.name,
          pricePerPackage: product.pricePerPackage,
          currency: product.currency,
          url: product.url,
          stockStatus: product.stockStatus,
          deliveryEstimate: product.deliveryEstimate,
          isCampaignPrice: product.isCampaignPrice,
          imageUrl: product.imageUrl
        },
        productSettingsById,
        settings: finalSettings,
      };
    });
  };

  const activateManual = () => {
    setIsManualActive(true);
    updateActiveDesign((design) => ({
      ...design,
      activeProductId: null,
      productInfo: null,
      settings: {
        ...design.settings,
        length: manualFloorSettings.length,
        width: manualFloorSettings.width,
        planksPerPackage: manualFloorSettings.planksPerPackage
      }
    }));
  };

  // "Eget golv" is effectively active when no product is selected on the current design
  const effectiveIsManualActive = isManualActive || (activeDesign.products.length === 0 && !activeProductId);

  const handleManualSettingsChange = (next: { length: number; width: number; planksPerPackage: number; pricePerPackage: number }) => {
    setManualFloorSettings(next);
    if (effectiveIsManualActive) {
      updateActiveDesign((design) => ({
        ...design,
        settings: {
          ...design.settings,
          length: next.length,
          width: next.width,
          planksPerPackage: next.planksPerPackage
        }
      }));
    }
  };

  const addProduct = (product: SavedProduct, targetDesignId: string) => {
    const stamped: SavedProduct = { ...product, lastRefreshedAt: new Date().toISOString() };

    // Always use setDesignState with the captured targetDesignId so we never rely on
    // the closure's activeDesign — which may be stale if the user switched tabs.
    setDesignState((prev) => {
      const target = prev.designs.find((d) => d.id === targetDesignId);
      if (!target) return prev;

      const normalizedUrl = stamped.url.trim();
      if (target.products.some((p) => p.url.trim() === normalizedUrl) || target.products.length >= 5) return prev;

      const isNewProduct = !target.productSettingsById[stamped.id];
      const existingSettings = target.productSettingsById[stamped.id] ?? getProductDefaults(stamped);
      const productSettingsById = isNewProduct
        ? { ...target.productSettingsById, [stamped.id]: existingSettings }
        : target.productSettingsById;

      const baseSettings: PlankSettings = {
        ...target.settings,
        length: stamped.lengthMm,
        width: stamped.widthMm,
        planksPerPackage: stamped.planksPerPackage,
        minStagger: existingSettings.minStagger,
        startOffset: existingSettings.startOffset,
        startOffsetVertical: existingSettings.startOffsetVertical,
        minEndPiece: existingSettings.minEndPiece,
        layoutRotated: existingSettings.layoutRotated,
      };

      // Auto-optimize waste for new products that have a drawn room shape
      let finalSettings = baseSettings;
      if (isNewProduct && target.points.length >= 3) {
        const minStaggerMin = baseSettings.length < 1000
          ? Math.ceil(baseSettings.length * 0.25 / 10) * 10
          : 250;
        const optimized = findOptimizedLayout(target.points, baseSettings, { ...DEFAULT_OPTIMIZATION_CONSTRAINTS, minStaggerMin });
        finalSettings = { ...baseSettings, ...optimized };
      }

      const updatedDesign: FloorDesign = {
        ...target,
        products: [stamped, ...target.products],
        activeProductId: stamped.id,
        productInfo: {
          name: stamped.name,
          pricePerPackage: stamped.pricePerPackage,
          currency: stamped.currency,
          url: stamped.url,
          stockStatus: stamped.stockStatus,
          deliveryEstimate: stamped.deliveryEstimate,
          isCampaignPrice: stamped.isCampaignPrice,
          imageUrl: stamped.imageUrl,
        },
        productSettingsById,
        settings: finalSettings,
      };

      return { ...prev, designs: prev.designs.map((d) => (d.id === targetDesignId ? updatedDesign : d)) };
    });

    setIsManualActive(false);
  };

  const removeProduct = (productId: string) => {
    updateActiveDesign((design) => {
      const { [productId]: _removed, ...remainingProductSettingsById } = design.productSettingsById;
      return {
        ...design,
        products: design.products.filter((p) => p.id !== productId),
        productSettingsById: remainingProductSettingsById,
        ...(design.activeProductId === productId ? { activeProductId: null, productInfo: null } : {}),
      };
    });
  };

  const handleSidebarSettingsChange = (nextSettings: PlankSettings) => {
    setActiveSettings(nextSettings);
  };

  const handleOptimizeLayout = () => {
    if (points.length < 3) return;
    const minStaggerMin = settings.length < 1000
      ? Math.ceil(settings.length * 0.25 / 10) * 10
      : 250;
    const constraints = { ...DEFAULT_OPTIMIZATION_CONSTRAINTS, minStaggerMin };
    const optimized = findOptimizedLayout(points, settings, constraints);
    setActiveSettings({ ...settings, ...optimized });
  };

  const handleReset = () => {
    if (!window.confirm('Radera ritningen och bakgrundsritningen? Detta kan ångras med Undo.')) {
      return;
    }
    recordActiveHistory();
    updateActiveDesign((design) => ({
      ...design,
      points: [],
      offset: { ...DEFAULT_OFFSET },
      scale: DEFAULT_SCALE,
      settings: { ...design.settings, originPointIdx: 0 },
      activeProductId: null,
      productInfo: null,
      backgroundDrawing: null,
      showBackgroundDrawing: false,
      backgroundOpacity: DEFAULT_BACKGROUND_OPACITY
    }));
  };

  const handleZoomExtentsForDesign = (designId: string, targetPoints: Point[]) => {
    if (targetPoints.length === 0) {
      updateDesignById(designId, (design) => ({
        ...design,
        offset: { ...DEFAULT_OFFSET },
        scale: DEFAULT_SCALE
      }));
      return;
    }

    const { minX, minY, maxX, maxY } = getBoundingBox(targetPoints);
    const roomW = maxX - minX;
    const roomH = maxY - minY;

    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const padding = 120;
    const availableW = canvas.clientWidth - padding;
    const availableH = canvas.clientHeight - padding;

    const scaleW = availableW / (roomW || 1);
    const scaleH = availableH / (roomH || 1);
    const extentsScale = Math.min(scaleW, scaleH, 0.4) * 0.75 * 0.85;
    const newScale = Math.max(MIN_SCALE, extentsScale);
    const leftShiftPx = isToolsPanelOpen ? canvas.clientWidth * 0.10 : 0;

    const roomCenterX = (minX + maxX) / 2;
    const roomCenterY = (minY + maxY) / 2;

    updateDesignById(designId, (design) => ({
      ...design,
      scale: newScale,
      offset: {
        x: -(roomCenterX * newScale) - leftShiftPx,
        y: -(roomCenterY * newScale)
      }
    }));
  };

  const handleZoomExtents = (targetPoints: Point[] = points) => {
    handleZoomExtentsForDesign(activeDesign.id, targetPoints);
  };

  const handleImportComplete = (newPoints: Point[], importedBackground: ImportedDrawingBackground | null) => {
    const currentDesignId = activeDesign.id;
    recordActiveHistory();
    updateDesignById(currentDesignId, (design) => ({
      ...design,
      points: newPoints,
      backgroundDrawing: importedBackground ? { ...importedBackground } : design.backgroundDrawing,
      showBackgroundDrawing: importedBackground ? true : design.showBackgroundDrawing
    }));
    setIsImporting(false);
    setImportFile(null);
    setTimeout(() => handleZoomExtentsForDesign(currentDesignId, newPoints), 100);
  };

  const handleAddDesign = () => {
    setDesignState((prev) => {
      if (prev.designs.length >= MAX_DESIGNS) return prev;

      const newDesign = createDefaultDesign(getNextDesignName(prev.designs));
      return {
        designs: [...prev.designs, newDesign],
        activeDesignId: newDesign.id
      };
    });
  };

  const handleRemoveDesign = (designId: string) => {
    if (designState.designs.length <= 1) return;
    const design = designState.designs.find((d) => d.id === designId);
    if (!design) return;
    // If logged in and design has unsaved changes, show save-prompt dialog
    if (user && isDesignDirty(design)) {
      setPendingCloseDesignId(designId);
      return;
    }
    closeDesign(designId);
  };

  const getDesignName = (design: FloorDesign, index: number): string => {
    const trimmedName = design.name.trim();
    return trimmedName.length > 0 ? trimmedName : `Golv ${index + 1}`;
  };

  const beginDesignNameEdit = (design: FloorDesign, index: number) => {
    const fallbackName = getDesignName(design, index);
    setDesignState((prev) =>
      prev.activeDesignId === design.id
        ? prev
        : { ...prev, activeDesignId: design.id }
    );
    setEditingDesignId(design.id);
    setEditingDesignName(fallbackName.slice(0, MAX_DESIGN_NAME_LENGTH));
    setTabContextMenu(null);
  };

  const cancelDesignNameEdit = () => {
    setEditingDesignId(null);
    setEditingDesignName('');
  };

  const saveDesignNameEdit = (design: FloorDesign, index: number) => {
    const fallbackName = getDesignName(design, index).slice(0, MAX_DESIGN_NAME_LENGTH);
    const nextName = editingDesignName.trim().slice(0, MAX_DESIGN_NAME_LENGTH);
    const resolvedName = nextName || fallbackName;
    const duplicate = designState.designs.some(
      (d) => d.id !== design.id && d.name.trim().toLowerCase() === resolvedName.toLowerCase()
    );
    if (duplicate) {
      setTabNameError(true);
      setTimeout(() => setTabNameError(false), 2000);
      // Revert to original name
      cancelDesignNameEdit();
      return;
    }
    updateDesignById(design.id, (currentDesign) => ({ ...currentDesign, name: resolvedName }));
    cancelDesignNameEdit();
  };

  const handleTabContextRename = () => {
    if (!tabContextMenu) return;
    const index = designState.designs.findIndex((design) => design.id === tabContextMenu.designId);
    const design = designState.designs[index];
    if (!design || index < 0) {
      setTabContextMenu(null);
      return;
    }
    beginDesignNameEdit(design, index);
  };

  const isDesignLimitReached = designState.designs.length >= MAX_DESIGNS;

  const handleZoomStep = (direction: 1 | -1) => {
    const currentPercent = Math.round(scale * 1000);
    const nextPercent = Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, currentPercent + direction * 10));
    const nextScale = nextPercent / 1000;
    setActiveView(nextScale, centerOffsetForPoints(points, nextScale));
    setZoomPercentInput(String(nextPercent));
  };

  const commitZoomPercent = () => {
    const parsedPercent = Number.parseFloat(zoomPercentInput.replace(',', '.'));
    if (!Number.isFinite(parsedPercent)) {
      setZoomPercentInput(String(Math.round(scale * 1000)));
      return;
    }

    const clampedPercent = Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, parsedPercent));
    const nextScale = clampedPercent / 1000;
    setActiveView(nextScale, centerOffsetForPoints(points, nextScale));
    setZoomPercentInput(String(Math.round(clampedPercent)));
  };

  const handleToggleBackgroundDrawing = () => {
    if (!backgroundDrawing) return;
    updateActiveDesign((design) => {
      const nextShowBackground = !design.showBackgroundDrawing;
      const shouldResetOpacity = nextShowBackground && design.backgroundOpacity <= 0;
      return {
        ...design,
        showBackgroundDrawing: nextShowBackground,
        backgroundOpacity: shouldResetOpacity ? DEFAULT_BACKGROUND_OPACITY : design.backgroundOpacity
      };
    });
  };

  const handleBackgroundOpacityChange = (nextOpacity: number) => {
    const clampedOpacity = Math.max(0, Math.min(1, nextOpacity));
    updateActiveDesign((design) => ({
      ...design,
      showBackgroundDrawing: design.backgroundDrawing ? true : design.showBackgroundDrawing,
      backgroundOpacity: clampedOpacity
    }));
  };

  const handleRemoveBackgroundDrawing = () => {
    recordActiveHistory();
    updateActiveDesign((design) => ({
      ...design,
      backgroundDrawing: null,
      showBackgroundDrawing: false,
      backgroundOpacity: DEFAULT_BACKGROUND_OPACITY
    }));
  };

  const handleCanvasImportFile = (file: File | undefined) => {
    if (!file) return;
    const supportedImportMimeTypes = ['image/png', 'image/jpeg', 'application/pdf'];
    if (supportedImportMimeTypes.includes(file.type) || /\.(png|jpe?g|pdf)$/i.test(file.name)) {
      setImportLaunchError(null);
      setImportFile(file);
      setIsImporting(true);
      logEvent('background_uploaded', user?.id);
      return;
    }
    setImportLaunchError('Filformat stöds inte. Välj PNG, JPG eller PDF.');
  };

  const toolsPanelContent = (
    <div className="space-y-2 rounded-2xl border border-[#aaaaaa] bg-white p-2.5">
      <div className="space-y-1 border-[#e8e8e8]">
        <p className="text-[9px] font-medium text-[#767676]">Bedömning</p>
        <label className="block text-[9px] font-medium text-[#767676]">Mönsterkontrast</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={settings.visualContrast}
          onChange={(event) => setActiveSettings({ ...settings, visualContrast: parseFloat(event.target.value) })}
          className="kahrs-slider"
        />
      </div>

      <div className="grid grid-cols-[1fr_1fr] items-center gap-2 border-t border-[#e8e8e8] pt-2">
        <label className="text-[9px] font-medium text-[#767676]">Grid (mm)</label>
        <input
          type="number"
          value={gridSize}
          onChange={(event) => setGridSize(Math.max(10, parseInt(event.target.value, 10) || 10))}
          className="pf-no-spin h-8 w-full border border-[#d9d9d9] bg-white px-2 text-right text-[10px] font-semibold text-[#1a1a1a] focus:border-[#C41230] focus:outline-none"
        />
      </div>


      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setShowEdgeLengths((prev) => !prev)}
          className={`pf-action-heading rounded-full px-2 py-1.5 text-[10px] font-medium transition-colors ${
            showEdgeLengths
              ? 'border border-[#aaaaaa] bg-white text-[#333333]'
              : 'bg-white text-[#666] hover:bg-[#f0f0f0]'
          }`}
        >
          {showEdgeLengths ? 'Dölj mått' : 'Visa mått'}
        </button>
        <button
          type="button"
          disabled={!backgroundDrawing}
          onClick={handleToggleBackgroundDrawing}
          className={`pf-action-heading rounded-full px-2 py-1.5 text-[10px] font-medium transition-colors ${
            backgroundDrawing && showBackgroundDrawing
              ? 'border border-[#aaaaaa] bg-white text-[#333333]'
              : backgroundDrawing
                ? 'bg-white text-[#666] hover:bg-[#f0f0f0]'
                : 'cursor-not-allowed bg-white text-[#B0B0B0]'
          }`}
        >
          {backgroundDrawing && showBackgroundDrawing ? 'Dölj ritning' : 'Visa ritning'}
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[9px] font-medium text-[#666]">Opacitet ritning</label>
          <span className="text-[10px] font-semibold text-[#1A1A1A]">{Math.round(backgroundOpacity * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(backgroundOpacity * 100)}
          disabled={!backgroundDrawing}
          onChange={(event) => handleBackgroundOpacityChange((parseInt(event.target.value, 10) || 0) / 100)}
          className="kahrs-slider disabled:opacity-40"
        />
      </div>

      <button
        type="button"
        onClick={handleReset}
        className="pf-action-heading flex w-full items-center justify-center gap-1.5 rounded-full py-1.5 px-2 text-[10px] font-medium text-[#C41230] bg-[#fff5f6] transition-colors hover:bg-[#ffe8eb]"
        aria-label="Återställ design"
        title="Återställ design"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 7h12M9 7V5h6v2m-8 0l1 12h8l1-12M10 11v6m4-6v6" /></svg>
        <span>Återställ design</span>
      </button>

      <div className="flex items-center gap-1 border-t border-[#e8e8e8] pt-2">
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          className="flex h-8 w-full items-center justify-center rounded-full bg-white text-[#4a4a4a] transition-colors hover:bg-[#f0f0f0] hover:text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230] disabled:cursor-not-allowed disabled:opacity-45"
          title="Undo (Cmd/Ctrl+Z)"
          aria-label="Undo"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 7H5v4M5 11c1.5-3.2 4.6-5 8.2-5 5 0 8.8 3.9 8.8 8.8" /></svg>
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          className="flex h-8 w-full items-center justify-center rounded-full bg-white text-[#4a4a4a] transition-colors hover:bg-[#f0f0f0] hover:text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230] disabled:cursor-not-allowed disabled:opacity-45"
          title="Redo (Cmd/Ctrl+Shift+Z / Ctrl+Y)"
          aria-label="Redo"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 7h4v4M19 11c-1.5-3.2-4.6-5-8.2-5C5.8 6 2 9.9 2 14.8" /></svg>
        </button>
      </div>
    </div>
  );

  const contentColumns = 'grid-cols-[var(--pf-sidebar-w)_minmax(0,1fr)_0px]';
  const topbarColumns = 'grid-cols-[var(--pf-topbar-sidebar-w)_minmax(0,1fr)_0px]';

  return (
    <div className="h-screen w-full overflow-hidden bg-[#f5f5f5]">
      <div className={`pf-app-shell relative grid h-full min-h-0 w-full ${contentColumns} grid-rows-[auto_minmax(0,1fr)] border border-[#d9d9d9] bg-white text-[#4a4a4a]`}>
        <div className="col-[1/-1] row-[1] z-20 bg-white border-b border-[#d9d9d9]">
          <div className={`grid h-[102px] min-w-0 ${topbarColumns} sm:h-[114px]`}>
            <div className="flex flex-col bg-white px-5 pt-5 pb-2 sm:px-6 sm:pt-6">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center bg-[#C41230] text-white font-bold text-[14px] shrink-0">PF</div>
                <h1 className="text-[20px] font-semibold leading-none tracking-[-0.01em] text-[#1a1a1a]">ProFloor CAD</h1>
              </div>
              <div className="flex-1" />
            </div>

            <div className="flex min-w-0 flex-col">
              {/* Login button — top right of topbar */}
              <div className="flex items-center justify-end pr-3 sm:pr-6 pt-4 sm:pt-5 shrink-0">
                {user ? (
                  <div className="flex items-center gap-2">
                    {user.user_metadata?.avatar_url && (
                      <img src={user.user_metadata.avatar_url} alt={user.user_metadata?.full_name ?? 'Profilbild'} className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />
                    )}
                    <button
                      type="button"
                      onClick={() => supabase.auth.signOut()}
                      className="pf-action-heading text-[9px] font-medium text-[#767676] hover:text-[#1a1a1a] transition-colors"
                    >
                      Logga ut
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })}
                    className="pf-action-heading flex items-center gap-1.5 rounded-full border border-[#d9d9d9] bg-white px-3 py-1 text-[9px] font-semibold text-[#333333] transition-colors hover:bg-[#f0f0f0]"
                  >
                    <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Logga in med Google
                  </button>
                )}
              </div>
              {/* Tabs row */}
              <div className="pf-hide-scrollbar min-w-0 overflow-x-auto pl-0 pr-3 sm:pr-6 flex-1 flex items-end">
                <div className="flex min-w-max items-stretch gap-0 pr-2 h-full">
                  {designState.designs.map((design, index) => {
                    const isActive = design.id === designState.activeDesignId && !showSavedFloors;
                    const canRemove = designState.designs.length > 1;
                    const isEditing = design.id === editingDesignId;
                    const displayName = getDesignName(design, index);
                    const charsForWidth = Math.max((isEditing ? editingDesignName : displayName).length, 6);
                    const tabWidth = `clamp(168px, calc(${charsForWidth}ch + 6.5rem), 320px)`;

                    return (
                      <div key={design.id} className="group relative flex flex-col justify-end">
                        <span className="absolute left-0 bottom-0 w-px h-[22px] bg-[#d9d9d9]" />
                        <button
                          type="button"
                          onClick={() => {
                            setDesignState((prev) => ({ ...prev, activeDesignId: design.id }));
                            setTabContextMenu(null);
                            setShowSavedFloors(false);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setTabContextMenu({ x: event.clientX, y: event.clientY, designId: design.id });
                          }}
                          style={{ width: tabWidth }}
                          className={`pf-action-heading relative flex min-w-[168px] max-w-[320px] items-center border-0 bg-transparent px-4 pr-9 pb-2 pt-2 font-medium whitespace-nowrap transition-colors ${
                            isActive
                              ? 'text-[#1a1a1a]'
                              : 'text-[#767676] hover:text-[#4a4a4a]'
                          }`}
                        >
                          {isEditing ? (
                            <>
                              <input
                                autoFocus
                                value={editingDesignName}
                                maxLength={MAX_DESIGN_NAME_LENGTH}
                                onFocus={(event) => event.currentTarget.select()}
                                onChange={(event) => setEditingDesignName(event.target.value.slice(0, MAX_DESIGN_NAME_LENGTH))}
                                onBlur={() => saveDesignNameEdit(design, index)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    saveDesignNameEdit(design, index);
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    cancelDesignNameEdit();
                                  }
                                }}
                                className={`w-full bg-transparent outline-none ${tabNameError ? 'text-[#C41230]' : 'text-[#191919]'}`}
                                aria-label="Byt namn på flik"
                              />
                              {tabNameError && (
                                <span className="absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-[#C41230] px-2 py-0.5 text-[9px] font-semibold text-white">
                                  Namnet används redan
                                </span>
                              )}
                            </>
                          ) : (
                            <span
                              className="truncate"
                              title={displayName}
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                beginDesignNameEdit(design, index);
                              }}
                            >
                              {displayName}
                            </span>
                          )}
                          {isActive && (
                            <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#1a1a1a]" />
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={!canRemove}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRemoveDesign(design.id);
                          }}
                          className={`absolute right-1.5 bottom-[7px] z-20 flex h-5 w-5 items-center justify-center rounded-[4px] text-[14px] leading-none transition-all text-[#767676] hover:bg-[#f0f0f0] hover:text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-30`}
                          aria-label={`Ta bort ${displayName}`}
                          title={canRemove ? 'Ta bort flik' : 'Minst en flik måste finnas'}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}

                  <div className="h-[22px] self-end w-px bg-[#d9d9d9]"></div>

                  <button
                    type="button"
                    onClick={handleAddDesign}
                    disabled={isDesignLimitReached}
                    className="flex self-end h-9 w-9 items-center justify-center text-[22px] leading-none text-[#767676] transition-colors hover:bg-[#f0f0f0] hover:text-[#4a4a4a] disabled:cursor-not-allowed disabled:opacity-40"
                    title={isDesignLimitReached ? DESIGN_LIMIT_MESSAGE : 'Lägg till nytt golv'}
                    aria-label="Lägg till nytt golv"
                  >
                    +
                  </button>

                  {/* Sparade golv tab */}
                  <div className="h-[22px] self-end w-px bg-[#d9d9d9]"></div>
                  <button
                    type="button"
                    disabled={!user}
                    onClick={() => {
                      if (!user) return;
                      setShowSavedFloors((prev) => {
                        if (!prev) loadSavedFloors();
                        return !prev;
                      });
                    }}
                    title={!user ? 'Logga in för att se sparade golv' : 'Sparade golv'}
                    aria-label="Sparade golv"
                    className={`pf-action-heading relative flex self-end items-center gap-1.5 border-0 bg-transparent px-4 pb-2 pt-2 font-medium whitespace-nowrap transition-colors ${
                      user
                        ? showSavedFloors
                          ? 'text-[#1a1a1a]'
                          : 'text-[#767676] hover:text-[#4a4a4a] cursor-pointer'
                        : 'text-[#c0c0c0] cursor-not-allowed opacity-50'
                    }`}
                  >
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    Sparade golv
                    {showSavedFloors && <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#1a1a1a]" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="min-w-0 border-b border-[#d9d9d9]"></div>
          </div>
        </div>

        <div className={`col-[1/-1] row-[2] grid min-h-0 min-w-0 ${contentColumns}`}>
          <div className="col-[1] min-h-0 min-w-0 border-r border-[#d9d9d9] bg-white">
            <Sidebar
              settings={settings}
              setSettings={handleSidebarSettingsChange}
              products={activeDesign.products}
              activeDesignName={activeDesign.name}
              activeDesignId={activeDesign.id}
              activeProductId={activeProductId}
              productStatsById={productStatsById}
              isManualActive={effectiveIsManualActive}
              manualFloorSettings={manualFloorSettings}
              manualStats={manualStats}
              onActivateManual={activateManual}
              onManualFloorSettingsChange={handleManualSettingsChange}
              onAddProduct={addProduct}
              onRemoveProduct={removeProduct}
              onSelectProduct={activateProduct}
              onOptimize={handleOptimizeLayout}
            />
          </div>

          <main className="relative col-[2] min-h-0 min-w-0 overflow-hidden bg-[#f5f5f5]">
            {/* Sparade golv panel */}
            {showSavedFloors && (
              <div className="absolute inset-0 z-40 overflow-auto bg-white">
                <div className="px-8 py-7">
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-[18px] font-semibold text-[#1a1a1a] tracking-[-0.01em]">Sparade golv</h2>
                    <button
                      type="button"
                      onClick={() => setShowSavedFloors(false)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[#767676] hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
                      aria-label="Stäng"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {savedFloorsLoading ? (
                    <p className="text-[13px] text-[#767676]">Laddar…</p>
                  ) : savedFloorsList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <svg className="mb-4 h-10 w-10 text-[#d9d9d9]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                      <p className="text-[13px] font-medium text-[#767676]">Inga sparade golv än.</p>
                      <p className="mt-1 text-[12px] text-[#aaaaaa]">Tryck på "Spara" för att spara ett golv.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                      {savedFloorsList.map((floor) => {
                        const date = new Date(floor.updated_at);
                        const dateStr = date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
                        const timeStr = date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
                        const alreadyOpen = designState.designs.some((d) => d.savedFloorId === floor.id);
                        const s = floor.summary;
                        const areaMm2 = typeof s?.areaMm2 === 'number' ? s.areaMm2 : null;
                        const wasteGreen = typeof s?.wastePercent === 'number' && s.wastePercent <= 15;
                        return (
                          <div key={floor.id} className="group rounded-2xl border border-[#e8e8e8] bg-white p-4 flex flex-col gap-3 hover:border-[#c8c8c8] transition-colors">
                            <div className="flex h-[100px] items-center justify-center rounded-xl bg-[#f5f5f5] overflow-hidden">
                              {floor.thumbnail ? (
                                <img
                                  src={floor.thumbnail}
                                  alt={`Förhandsgranskning av ${floor.name || 'golv'}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <svg className="h-8 w-8 text-[#d9d9d9]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1">
                              {renamingFloorId === floor.id ? (
                                <input
                                  autoFocus
                                  value={renamingFloorName}
                                  maxLength={MAX_DESIGN_NAME_LENGTH}
                                  onChange={(e) => setRenamingFloorName(e.target.value)}
                                  onBlur={() => handleRenameFloor(floor.id, renamingFloorName)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleRenameFloor(floor.id, renamingFloorName); }
                                    if (e.key === 'Escape') { e.preventDefault(); setRenamingFloorId(null); }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full rounded border border-[#c8c8c8] bg-white px-2 py-0.5 text-[13px] font-semibold text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                                  aria-label="Byt namn på sparat golv"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onDoubleClick={() => { setRenamingFloorId(floor.id); setRenamingFloorName(floor.name); }}
                                  title="Dubbelklicka för att byta namn"
                                  className="w-full text-left text-[13px] font-semibold text-[#1a1a1a] truncate cursor-default"
                                >
                                  {floor.name || 'Namnlöst golv'}
                                </button>
                              )}
                              {s?.productName && (
                                <p className="mt-0.5 text-[11px] text-[#4a4a4a] truncate">{s.productName}</p>
                              )}
                              <div className="mt-1.5 flex items-center gap-2.5 flex-wrap">
                                {areaMm2 !== null && (
                                  <span className="text-[11px] text-[#767676]">{areaMm2.toFixed(1)} m²</span>
                                )}
                                {typeof s?.wastePercent === 'number' && (
                                  <span className={`text-[11px] font-medium ${wasteGreen ? 'text-[#3D8B37]' : 'text-[#767676]'}`}>
                                    Spill {s.wastePercent}%
                                  </span>
                                )}
                                {typeof s?.packageCount === 'number' && (
                                  <span className="text-[11px] text-[#767676]">{s.packageCount} förp.</span>
                                )}
                              </div>
                              {typeof s?.totalPrice === 'number' && s.totalPrice > 0 && (
                                <p className="mt-1 text-[11px] font-semibold text-[#1a1a1a]">
                                  {s.totalPrice.toLocaleString('sv-SE', { maximumFractionDigits: 0 })} {s.currency ?? 'kr'}
                                </p>
                              )}
                              <p className="mt-1 text-[10px] text-[#aaaaaa]">Sparad {dateStr} kl. {timeStr}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleLoadSavedFloor(floor)}
                                className="flex-1 rounded-full bg-[#1a1a1a] py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#333]"
                              >
                                {alreadyOpen ? 'Visa flik' : 'Öppna'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSavedFloor(floor.id)}
                                className="flex h-7 w-7 items-center justify-center rounded-full text-[#aaaaaa] hover:bg-[#fff0f0] hover:text-[#C41230] transition-colors"
                                aria-label="Ta bort"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Unsaved changes dialog */}
            {pendingCloseDesignId && (() => {
              const design = designState.designs.find((d) => d.id === pendingCloseDesignId);
              const idx = designState.designs.findIndex((d) => d.id === pendingCloseDesignId);
              const name = design ? getDesignName(design, idx) : 'Golvet';
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
                  <div className="rounded-2xl border border-[#aaaaaa] bg-white p-6 max-w-[320px] w-full mx-4 shadow-lg">
                    <h3 className="text-[14px] font-semibold text-[#1a1a1a] mb-1">Osparade ändringar</h3>
                    <p className="text-[12px] text-[#767676] mb-5">
                      <span className="font-medium text-[#1a1a1a]">"{name}"</span> har ändringar som inte är sparade. Vill du spara innan du stänger?
                    </p>
                    <div className="flex flex-col gap-2">
                      {design && !design.savedFloorId ? (
                        <button
                          type="button"
                          onClick={async () => {
                            // Switch to that design, save it, then close
                            setDesignState((prev) => ({ ...prev, activeDesignId: pendingCloseDesignId }));
                            await handleSave();
                            closeDesign(pendingCloseDesignId);
                          }}
                          className="rounded-full bg-[#1a1a1a] py-2 text-[12px] font-semibold text-white hover:bg-[#333] transition-colors"
                        >
                          Spara och stäng
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            setDesignState((prev) => ({ ...prev, activeDesignId: pendingCloseDesignId }));
                            await handleSave();
                            closeDesign(pendingCloseDesignId);
                          }}
                          className="rounded-full bg-[#1a1a1a] py-2 text-[12px] font-semibold text-white hover:bg-[#333] transition-colors"
                        >
                          Spara och stäng
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => closeDesign(pendingCloseDesignId)}
                        className="rounded-full border border-[#d9d9d9] py-2 text-[12px] font-medium text-[#4a4a4a] hover:bg-[#f0f0f0] transition-colors"
                      >
                        Stäng utan att spara
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingCloseDesignId(null)}
                        className="text-[11px] text-[#767676] hover:text-[#1a1a1a] transition-colors py-1"
                      >
                        Avbryt
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="relative h-full min-h-0 min-w-0">
              {/* Left: zoom controls */}
              <div className="absolute left-3 top-3 z-30 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleZoomStep(-1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9d9d9] bg-white text-[18px] leading-none text-[#767676] shadow-[0_2px_8px_rgba(0,0,0,0.07)] transition-colors hover:bg-[#f0f0f0] hover:text-[#1a1a1a]"
                  title="Zooma ut"
                  aria-label="Zooma ut"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => handleZoomStep(1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9d9d9] bg-white text-[18px] leading-none text-[#767676] shadow-[0_2px_8px_rgba(0,0,0,0.07)] transition-colors hover:bg-[#f0f0f0] hover:text-[#1a1a1a]"
                  title="Zooma in"
                  aria-label="Zooma in"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => handleZoomExtents()}
                  className="pf-action-heading flex h-8 items-center gap-1.5 rounded-full border border-[#d9d9d9] bg-white px-3 text-[#767676] shadow-[0_2px_8px_rgba(0,0,0,0.07)] transition-colors hover:bg-[#f0f0f0] hover:text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230]"
                  title="Zooma till extents"
                  aria-label="Zooma till extents"
                >
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 10.5l8-6 8 6M6.5 9.75V19.5a1 1 0 001 1h9a1 1 0 001-1V9.75M10 20v-5a1 1 0 011-1h2a1 1 0 011 1v5" />
                  </svg>
                  <span className="whitespace-nowrap font-medium">Visa hela</span>
                </button>
              </div>

              {/* Right: import, save, menu */}
              <div className="absolute right-3 top-3 z-30 flex items-center gap-2">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    handleCanvasImportFile(event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsImportDropActive(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                    if (!isImportDropActive) {
                      setIsImportDropActive(true);
                    }
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    const relatedTarget = event.relatedTarget as Node | null;
                    if (!event.currentTarget.contains(relatedTarget)) {
                      setIsImportDropActive(false);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsImportDropActive(false);
                    handleCanvasImportFile(event.dataTransfer.files?.[0]);
                  }}
                  className={`pf-action-heading flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 font-medium text-[#4a4a4a] transition-colors hover:text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230] ${
                    isImportDropActive
                      ? 'border-[#C41230] bg-[#fff5f6]'
                      : 'border-[#d9d9d9] bg-white'
                  }`}
                  aria-label="Importera ritning"
                  title="Importera ritning"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v10m0 0l-4-4m4 4l4-4M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
                  </svg>
                  <span className="whitespace-nowrap">Importera ritning</span>
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  title="Dela golvdesign"
                  aria-label="Dela golvdesign"
                  className="pf-action-heading flex h-8 items-center justify-center gap-1.5 rounded-full border border-[#d9d9d9] bg-white px-3 font-medium text-[#4a4a4a] transition-colors hover:text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230]"
                >
                  {shareCopied ? (
                    <svg className="h-3.5 w-3.5 text-[#3D8B37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  )}
                  <span className="whitespace-nowrap" style={{ color: shareCopied ? '#3D8B37' : undefined }}>
                    {shareCopied ? 'Kopierat!' : 'Dela'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!user || isSaving}
                  title={user ? 'Spara golvdesign' : 'Logga in för att spara'}
                  aria-label="Spara"
                  className={`pf-action-heading flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230] ${
                    user && !isSaving
                      ? saveDone
                        ? 'border-[#b8ddb5] bg-[#f0fbef] text-[#3D8B37]'
                        : 'border-[#d9d9d9] bg-white text-[#4a4a4a] hover:text-[#1a1a1a]'
                      : 'border-[#e8e8e8] bg-white text-[#c0c0c0] cursor-not-allowed opacity-50'
                  }`}
                >
                  {saveDone ? (
                    <svg className="h-3.5 w-3.5 text-[#3D8B37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                      <polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" points="17 21 17 13 7 13 7 21" />
                      <polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" points="7 3 7 8 15 8" />
                    </svg>
                  )}
                  <span className="whitespace-nowrap" style={{ color: saveDone ? '#3D8B37' : undefined }}>
                    {isSaving ? 'Sparar…' : saveDone ? 'Sparat!' : 'Spara'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsToolsPanelOpen((prev) => !prev)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d9d9d9] bg-white text-[#4a4a4a] transition-colors hover:text-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230]"
                  aria-label="Visa canvasverktyg"
                  title="Canvasverktyg"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 7h16M4 12h16M4 17h16" /></svg>
                </button>
              </div>

              {importLaunchError && (
                <div className="absolute right-3 top-[3.35rem] z-30 max-w-[280px] border border-[#fad0d5] bg-[#fff5f6] px-2.5 py-1.5 text-[10px] font-semibold text-[#C41230]">
                  {importLaunchError}
                </div>
              )}

              <Canvas
                points={points}
                setPoints={setActivePoints}
                settings={settings}
                setSettings={setActiveSettings}
                planks={planks}
                wastePieces={wastePieces}
                scale={scale}
                setScale={setActiveScale}
                offset={offset}
                setOffset={setActiveOffset}
                showEdgeLengths={showEdgeLengths}
                gridSize={gridSize}
                snapToGrid={snapToGrid}
                onToggleSnapToGrid={() => setSnapToGrid((prev) => !prev)}
                onToggleEdgeLengths={() => setShowEdgeLengths((prev) => !prev)}
                onRequestHistorySnapshot={recordActiveHistory}
                backgroundDrawing={backgroundDrawing}
                showBackgroundDrawing={showBackgroundDrawing}
                backgroundOpacity={backgroundOpacity}
                onToggleBackgroundDrawing={handleToggleBackgroundDrawing}
                onBackgroundOpacityChange={handleBackgroundOpacityChange}
                onRemoveBackgroundDrawing={handleRemoveBackgroundDrawing}
                onZoomExtents={handleZoomExtents}
                showFloatingToolPanel={false}
                stats={stats}
                productInfo={productInfo}
              />

              {isToolsPanelOpen && (
                <div className="absolute right-3 top-12 z-30 max-h-[calc(100%-60px)] w-[11.5rem] max-w-[calc(100%-1.5rem)] overflow-y-auto">
                  {toolsPanelContent}
                </div>
              )}
            </div>
          </main>

          <div className="col-[3] min-h-0 min-w-0"></div>
        </div>

        {tabContextMenu && (
          <div
            className="fixed z-50 min-w-[170px] border border-[#d9d9d9] bg-white py-1 shadow-2xl"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          >
            <button
              type="button"
              onClick={handleTabContextRename}
              className="pf-action-heading w-full px-4 py-2 text-left font-medium text-[#4a4a4a] hover:bg-[#f5f5f5]"
            >
              Byt namn
            </button>
          </div>
        )}

        {isImporting && (
          <ImportWizard
            initialFile={importFile}
            onComplete={handleImportComplete}
            onCancel={() => {
              setIsImporting(false);
              setImportFile(null);
            }}
            onAnalysisCancelled={() => logEvent('plan_cancelled', user?.id)}
          />
        )}
      </div>
    </div>
  );
};

export default App;
