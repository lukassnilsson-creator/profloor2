
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

const INITIAL_SETTINGS: PlankSettings = {
  length: 2000,
  width: 190,
  minEndPiece: 300,
  minStagger: 500,
  gap: 5,
  startOffset: 0,
  startOffsetVertical: 0,
  planksPerPackage: 6,
  visualContrast: 0.6,
  originPointIdx: 0
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
const DEFAULT_BACKGROUND_OPACITY = 0.2;
const UNDO_HISTORY_LIMIT = 20;

const PRODUCT_STORAGE_KEY = 'profloor.saved-products';
const FLOOR_DESIGNS_STORAGE_KEY = 'profloor.floor-designs';

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

const toProductDesignSettings = (settings: PlankSettings): ProductDesignSettings => ({
  minStagger: settings.minStagger,
  startOffset: settings.startOffset,
  startOffsetVertical: settings.startOffsetVertical,
  minEndPiece: settings.minEndPiece
});

const getProductDefaults = (product: SavedProduct): ProductDesignSettings => ({
  minStagger: product.minStagger,
  startOffset: product.startOffset,
  startOffsetVertical: product.startOffsetVertical,
  minEndPiece: product.minEndPiece
});

const createDefaultDesign = (name: string): FloorDesign => ({
  id: createDesignId(),
  name,
  points: [],
  settings: { ...INITIAL_SETTINGS },
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
    originPointIdx
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
    isCampaignPrice: typeof value.isCampaignPrice === 'boolean' ? value.isCampaignPrice : undefined
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
    minEndPiece: value.minEndPiece
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
    lengthMm: item.lengthMm,
    widthMm: item.widthMm,
    planksPerPackage: item.planksPerPackage,
    minStagger: isFiniteNumber(item.minStagger) ? item.minStagger : INITIAL_SETTINGS.minStagger,
    startOffset: isFiniteNumber(item.startOffset) ? item.startOffset : INITIAL_SETTINGS.startOffset,
    startOffsetVertical: isFiniteNumber(item.startOffsetVertical) ? item.startOffsetVertical : INITIAL_SETTINGS.startOffsetVertical,
    minEndPiece: isFiniteNumber(item.minEndPiece) ? item.minEndPiece : INITIAL_SETTINGS.minEndPiece
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

  return {
    id,
    name,
    points,
    settings: sanitizePlankSettings(item.settings),
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

const loadSavedProducts = (): SavedProduct[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PRODUCT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseSavedProduct)
      .filter((product): product is SavedProduct => product !== null)
      .slice(0, 3);
  } catch {
    return [];
  }
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
  const [savedProducts, setSavedProducts] = useState<SavedProduct[]>(loadSavedProducts);
  const [editingDesignId, setEditingDesignId] = useState<string | null>(null);
  const [editingDesignName, setEditingDesignName] = useState('');
  const [zoomPercentInput, setZoomPercentInput] = useState(() => String(Math.round(DEFAULT_SCALE * 1000)));
  const [historyByDesignId, setHistoryByDesignId] = useState<Record<string, DesignHistorySnapshot[]>>({});
  const [redoByDesignId, setRedoByDesignId] = useState<Record<string, DesignHistorySnapshot[]>>({});
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(false);
  const [importLaunchError, setImportLaunchError] = useState<string | null>(null);
  const [isImportDropActive, setIsImportDropActive] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

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
  const maxOffset = Math.max(0, settings.length - settings.minEndPiece);
  const maxVerticalOffset = Math.max(0, settings.width);
  const maxMinPiece = Math.max(0, settings.length / 2);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(savedProducts));
    } catch {
      // Ignore storage write errors (e.g. private browsing quota limits).
    }
  }, [savedProducts]);

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

  const updateActiveDesign = (updater: (design: FloorDesign) => FloorDesign) => {
    setDesignState((prev) => ({
      ...prev,
      designs: prev.designs.map((design) => (design.id === prev.activeDesignId ? updater(design) : design))
    }));
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
    return calculateLayout(points, settings);
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

  const productTotalsById = useMemo(() => {
    const totals: Record<string, number> = {};

    savedProducts.forEach((product) => {
      if (points.length < 3) {
        totals[product.id] = 0;
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
      totals[product.id] = packageCount * product.pricePerPackage;
    });

    return totals;
  }, [savedProducts, points, settings, activeDesign.productSettingsById]);

  const activateProduct = (product: SavedProduct) => {
    updateActiveDesign((design) => {
      const existingSettings = design.productSettingsById[product.id] ?? getProductDefaults(product);
      const productSettingsById = design.productSettingsById[product.id]
        ? design.productSettingsById
        : {
            ...design.productSettingsById,
            [product.id]: existingSettings
          };

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
          isCampaignPrice: product.isCampaignPrice
        },
        productSettingsById,
        settings: {
          ...design.settings,
          length: product.lengthMm,
          width: product.widthMm,
          planksPerPackage: product.planksPerPackage,
          minStagger: existingSettings.minStagger,
          startOffset: existingSettings.startOffset,
          startOffsetVertical: existingSettings.startOffsetVertical,
          minEndPiece: existingSettings.minEndPiece
        }
      };
    });
  };

  const addProduct = (product: SavedProduct) => {
    const normalizedIncomingUrl = product.url.trim();
    const duplicate = savedProducts.find((existing) => existing.url.trim() === normalizedIncomingUrl);
    if (duplicate) {
      activateProduct(duplicate);
      return;
    }

    if (savedProducts.length >= 3) return;

    setSavedProducts((prev) => [...prev, product]);
    activateProduct(product);
  };

  const removeProduct = (productId: string) => {
    setSavedProducts((prev) => prev.filter((product) => product.id !== productId));

    setDesignState((prev) => ({
      ...prev,
      designs: prev.designs.map((design) => {
        const { [productId]: _removed, ...remainingProductSettingsById } = design.productSettingsById;
        if (design.activeProductId === productId) {
          return {
            ...design,
            activeProductId: null,
            productInfo: null,
            productSettingsById: remainingProductSettingsById
          };
        }

        if (_removed) {
          return {
            ...design,
            productSettingsById: remainingProductSettingsById
          };
        }

        return design;
      })
    }));
  };

  const handleSidebarSettingsChange = (nextSettings: PlankSettings) => {
    setActiveSettings(nextSettings);
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
    const extentsScale = Math.min(scaleW, scaleH, 0.4) * 0.75;
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
    if (!window.confirm('Ta bort detta golv?')) return;
    if (editingDesignId === designId) {
      setEditingDesignId(null);
      setEditingDesignName('');
    }
    if (tabContextMenu?.designId === designId) {
      setTabContextMenu(null);
    }

    setDesignState((prev) => {
      if (prev.designs.length <= 1) return prev;

      const removeIdx = prev.designs.findIndex((design) => design.id === designId);
      if (removeIdx === -1) return prev;

      const nextDesigns = prev.designs.filter((design) => design.id !== designId);
      const nextActiveDesignId =
        prev.activeDesignId === designId
          ? (nextDesigns[removeIdx] ?? nextDesigns[removeIdx - 1] ?? nextDesigns[0]).id
          : prev.activeDesignId;

      return {
        designs: nextDesigns,
        activeDesignId: nextActiveDesignId
      };
    });
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
    updateDesignById(design.id, (currentDesign) => ({
      ...currentDesign,
      name: nextName || fallbackName
    }));
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
      return;
    }
    setImportLaunchError('Filformat stöds inte. Välj PNG, JPG eller PDF.');
  };

  const toolsPanelContent = (
    <div className="space-y-2 rounded border border-[#D8D3CE] bg-white p-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.09)]">
      <div className="space-y-1.5">
        <p className="text-[9px] font-medium text-[#686868]">Optimering</p>
        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <label className="text-[9px] font-medium text-[#686868]">Skarvförskjutning</label>
            <span className="text-[10px] font-semibold text-[#1A1A1A]">{Math.round(settings.minStagger)} mm</span>
          </div>
          <input
            type="range"
            min="0"
            max={Math.max(0, settings.length)}
            step="10"
            value={settings.minStagger}
            onChange={(event) => {
              const next = Math.max(0, parseInt(event.target.value, 10) || 0);
              setActiveSettings({ ...settings, minStagger: next });
            }}
            className="kahrs-slider"
          />
        </div>

        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <label className="text-[9px] font-medium text-[#686868]">Startförskjutning hor.</label>
            <span className="text-[10px] font-semibold text-[#1A1A1A]">{Math.round(settings.startOffset)} mm</span>
          </div>
          <input
            type="range"
            min="0"
            max={Math.max(0, maxOffset)}
            step="10"
            value={settings.startOffset}
            onChange={(event) => {
              const next = Math.max(0, parseInt(event.target.value, 10) || 0);
              setActiveSettings({ ...settings, startOffset: Math.min(next, maxOffset) });
            }}
            className="kahrs-slider"
          />
        </div>

        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <label className="text-[9px] font-medium text-[#686868]">Startförskjutning vert.</label>
            <span className="text-[10px] font-semibold text-[#1A1A1A]">{Math.round(settings.startOffsetVertical)} mm</span>
          </div>
          <input
            type="range"
            min="0"
            max={Math.max(0, maxVerticalOffset)}
            step="10"
            value={settings.startOffsetVertical}
            onChange={(event) => {
              const next = Math.max(0, parseInt(event.target.value, 10) || 0);
              setActiveSettings({ ...settings, startOffsetVertical: Math.min(next, maxVerticalOffset) });
            }}
            className="kahrs-slider"
          />
        </div>

        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <label className="text-[9px] font-medium text-[#686868]">Minsta ändbit</label>
            <span className="text-[10px] font-semibold text-[#1A1A1A]">{Math.round(settings.minEndPiece)} mm</span>
          </div>
          <input
            type="range"
            min="0"
            max={Math.max(0, maxMinPiece)}
            step="10"
            value={settings.minEndPiece}
            onChange={(event) => {
              const next = Math.max(0, parseInt(event.target.value, 10) || 0);
              setActiveSettings({ ...settings, minEndPiece: Math.min(next, maxMinPiece) });
            }}
            className="kahrs-slider"
          />
        </div>
      </div>

      <div className="space-y-1 border-t border-[#ECE7E3] pt-2">
        <p className="text-[9px] font-medium text-[#686868]">Bedömning</p>
        <label className="block text-[9px] font-medium text-[#666]">Mönsterkontrast</label>
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

      <div className="grid grid-cols-[1fr_1fr] items-center gap-2 border-t border-[#ECE7E3] pt-2">
        <label className="text-[9px] font-medium text-[#686868]">Grid (mm)</label>
        <input
          type="number"
          value={gridSize}
          onChange={(event) => setGridSize(Math.max(10, parseInt(event.target.value, 10) || 10))}
          className="pf-no-spin h-8 w-full border border-[#D8D3CE] bg-white px-2 text-right text-[10px] font-semibold text-[#171717] focus:border-[#B69181] focus:outline-none"
        />
      </div>

      <label className="flex items-center gap-2 text-[10px] font-medium text-[#353535]">
        <input
          type="checkbox"
          checked={snapToGrid}
          onChange={() => setSnapToGrid((prev) => !prev)}
          className="h-3.5 w-3.5 rounded border-[#CFC7C1] text-[#B69181] focus:ring-[#B69181]"
        />
        Snap
      </label>

      <label className="flex items-center gap-2 text-[10px] font-medium text-[#353535]">
        <input
          type="checkbox"
          checked={showEdgeLengths}
          onChange={() => setShowEdgeLengths((prev) => !prev)}
          className="h-3.5 w-3.5 rounded border-[#CFC7C1] text-[#B69181] focus:ring-[#B69181]"
        />
        Golvmått
      </label>

      <label className={`flex items-center gap-2 text-[10px] font-medium ${backgroundDrawing ? 'text-[#353535]' : 'text-[#9A9A9A]'}`}>
        <input
          type="checkbox"
          checked={showBackgroundDrawing}
          disabled={!backgroundDrawing}
          onChange={handleToggleBackgroundDrawing}
          className="h-3.5 w-3.5 rounded border-[#CFC7C1] text-[#B69181] focus:ring-[#B69181]"
        />
        Bakgrundsritning
      </label>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[9px] font-medium text-[#666]">Opacitet</label>
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
        className="flex h-8 w-full items-center justify-center gap-1.5 border border-[#E0C6BC] bg-[#FFF8F6] text-[9px] font-medium text-[#8D4F3A] transition-colors hover:bg-[#FFF1ED] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B69181]"
        aria-label="Radera ritning"
        title="Radera ritning"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 7h12M9 7V5h6v2m-8 0l1 12h8l1-12M10 11v6m4-6v6" /></svg>
        <span>Radera ritning</span>
      </button>

      <div className="flex items-center gap-1 border-t border-[#ECE7E3] pt-2">
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          className="flex h-8 w-full items-center justify-center border border-[#D8D3CE] bg-white text-[#4D4D4D] transition-colors hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B69181] disabled:cursor-not-allowed disabled:opacity-45"
          title="Undo (Cmd/Ctrl+Z)"
          aria-label="Undo"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 7H5v4M5 11c1.5-3.2 4.6-5 8.2-5 5 0 8.8 3.9 8.8 8.8" /></svg>
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          className="flex h-8 w-full items-center justify-center border border-[#D8D3CE] bg-white text-[#4D4D4D] transition-colors hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B69181] disabled:cursor-not-allowed disabled:opacity-45"
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
    <div className="h-screen w-full overflow-hidden bg-[#F1EFEC]">
      <div className={`pf-app-shell relative grid h-full min-h-0 w-full ${contentColumns} grid-rows-[auto_minmax(0,1fr)] border border-[#DAD5D0] bg-white text-[#161616]`}>
        <div className="col-[1/-1] row-[1] z-20 bg-white">
          <div className={`grid h-[102px] min-w-0 ${topbarColumns} sm:h-[114px]`}>
            <div className="flex flex-col justify-center bg-white px-5 py-4 sm:px-6 sm:py-5">
              <h1 className="serif text-[23px] font-bold leading-none tracking-tight text-[#151515]">ProFloor CAD</h1>
              <p className="pf-label mt-2 text-[#646464]">Planera rätt, lägg snyggt, minimera spill.</p>
            </div>

            <div className="flex min-w-0 flex-col justify-end border-b border-[#D9D4CF]">
              <div className="pf-hide-scrollbar min-w-0 overflow-x-auto pl-0 pr-3 sm:pr-6">
                <div className="flex min-w-max items-end gap-1 pr-2">
                  {designState.designs.map((design, index) => {
                    const isActive = design.id === designState.activeDesignId;
                    const canRemove = designState.designs.length > 1;
                    const isEditing = design.id === editingDesignId;
                    const displayName = getDesignName(design, index);
                    const charsForWidth = Math.max((isEditing ? editingDesignName : displayName).length, 6);
                    const tabWidth = `clamp(168px, calc(${charsForWidth}ch + 6.5rem), 320px)`;

                    return (
                      <div key={design.id} className="group relative flex items-end">
                        <button
                          type="button"
                          onClick={() => {
                            setDesignState((prev) => ({ ...prev, activeDesignId: design.id }));
                            setTabContextMenu(null);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setTabContextMenu({ x: event.clientX, y: event.clientY, designId: design.id });
                          }}
                          style={{ width: tabWidth }}
                          className={`pf-action-heading relative flex h-8 min-w-[168px] max-w-[320px] items-center rounded-t-[4px] rounded-b-none border px-4 pr-9 font-medium whitespace-nowrap transition-colors ${
                            isActive
                              ? 'z-10 -mb-px border-[#D7CFC9] border-b-white bg-white text-[#171717]'
                              : 'border-transparent bg-[#E5DEDA] text-[#6A6A6A] hover:bg-[#ECE5E1] hover:text-[#1A1A1A]'
                          }`}
                        >
                          {isEditing ? (
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
                              className="w-full bg-transparent text-[#191919] outline-none"
                              aria-label="Byt namn på flik"
                            />
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
                        </button>

                        <button
                          type="button"
                          disabled={!canRemove}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRemoveDesign(design.id);
                          }}
                          className={`absolute right-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-[4px] text-[14px] leading-none transition-all ${
                            isActive
                              ? 'text-[#7A7A7A] hover:bg-[#EFEFEF] hover:text-[#181818]'
                              : 'text-[#8C8C8C] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[#DCD3CF] hover:text-[#161616]'
                          } disabled:cursor-not-allowed disabled:opacity-30`}
                          aria-label={`Ta bort ${displayName}`}
                          title={canRemove ? 'Ta bort flik' : 'Minst en flik måste finnas'}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}

                  <div className="mb-1.5 ml-1 h-4 w-px bg-[#DED6D1]"></div>

                  <button
                    type="button"
                    onClick={handleAddDesign}
                    disabled={isDesignLimitReached}
                    className="mb-0.5 flex h-7 w-7 items-center justify-center rounded-[4px] text-[22px] leading-none text-[#6E6E6E] transition-colors hover:bg-[#F3F1EF] hover:text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
                    title={isDesignLimitReached ? DESIGN_LIMIT_MESSAGE : 'Lägg till nytt golv'}
                    aria-label="Lägg till nytt golv"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="min-w-0 border-b border-[#D9D4CF]"></div>
          </div>
        </div>

        <div className={`col-[1/-1] row-[2] grid min-h-0 min-w-0 ${contentColumns}`}>
          <div className="col-[1] min-h-0 min-w-0 border-r border-[#D9D4CF] bg-white">
            <Sidebar
              settings={settings}
              setSettings={handleSidebarSettingsChange}
              stats={stats}
              savedProducts={savedProducts}
              activeProductId={activeProductId}
              productTotalsById={productTotalsById}
              onAddProduct={addProduct}
              onRemoveProduct={removeProduct}
              onSelectProduct={activateProduct}
              productInfo={productInfo}
            />
          </div>

          <main className="relative col-[2] min-h-0 min-w-0 overflow-hidden bg-[#FCFBFA]">
            <div className="relative h-full min-h-0 min-w-0">
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
                  className={`pf-action-heading flex h-8 items-center justify-center gap-1.5 border px-2.5 font-medium text-[#4D4D4D] transition-colors hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B69181] ${
                    isImportDropActive
                      ? 'border-[#B69181] bg-[#F7F4F1]'
                      : 'border-[#D8D3CE] bg-white'
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
                  onClick={() => setIsToolsPanelOpen((prev) => !prev)}
                  className="flex h-8 w-8 items-center justify-center border border-[#D8D3CE] bg-white text-[#4D4D4D] transition-colors hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B69181]"
                  aria-label="Visa canvasverktyg"
                  title="Canvasverktyg"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 7h16M4 12h16M4 17h16" /></svg>
                </button>
              </div>

              {importLaunchError && (
                <div className="absolute right-3 top-[3.35rem] z-30 max-w-[280px] border border-[#E0C6BC] bg-[#FFF8F6] px-2.5 py-1.5 text-[10px] font-semibold text-[#8D4F3A]">
                  {importLaunchError}
                </div>
              )}

                <div className="absolute bottom-3 left-3 z-30 flex h-8 items-center gap-1 rounded border border-[#D8D3CE] bg-white px-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                <button
                  type="button"
                  onClick={() => handleZoomExtents()}
                  className="flex h-6 w-6 items-center justify-center text-[#6A6A6A] transition-colors hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B69181]"
                  title="Zooma till extents"
                  aria-label="Zooma till extents"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 10.5l8-6 8 6M6.5 9.75V19.5a1 1 0 001 1h9a1 1 0 001-1V9.75M10 20v-5a1 1 0 011-1h2a1 1 0 011 1v5" />
                  </svg>
                </button>
                <div className="flex h-6 w-[60px] items-center justify-end gap-0.5 pr-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={zoomPercentInput}
                    onChange={(event) => setZoomPercentInput(event.target.value.replace(/[^0-9.,]/g, ''))}
                    onBlur={commitZoomPercent}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitZoomPercent();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setZoomPercentInput(String(Math.round(scale * 1000)));
                      }
                    }}
                    className="h-full w-10 bg-transparent text-right text-sm font-normal leading-none text-[#1A1A1A] focus:outline-none"
                    aria-label="Skala i procent"
                  />
                  <span className="pointer-events-none text-sm font-normal leading-none text-[#171717]">%</span>
                </div>
              </div>
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
            className="fixed z-50 min-w-[170px] border border-[#D8D3CE] bg-white py-1 shadow-2xl"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          >
            <button
              type="button"
              onClick={handleTabContextRename}
              className="pf-action-heading w-full px-4 py-2 text-left font-medium text-[#1A1A1A] hover:bg-[#F4F1EE]"
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
          />
        )}
      </div>
    </div>
  );
};

export default App;
