
import React, { useEffect, useState, useMemo } from 'react';
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
  ProductDesignSettings
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
const MAX_DESIGNS = 3;
const MAX_DESIGN_NAME_LENGTH = 25;
const DESIGN_LIMIT_MESSAGE = 'max 3 golvdesigner samtidigt.';

const PRODUCT_STORAGE_KEY = 'profloor.saved-products';
const FLOOR_DESIGNS_STORAGE_KEY = 'profloor.floor-designs';

interface FloorDesignState {
  designs: FloorDesign[];
  activeDesignId: string;
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
  offset: { ...DEFAULT_OFFSET }
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
    url: value.url
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

  const scale = Math.max(0.01, Math.min(0.5, asNumber(item.scale, DEFAULT_SCALE)));
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
    offset
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

  const activeDesign = useMemo(() => {
    return designState.designs.find((design) => design.id === designState.activeDesignId) ?? designState.designs[0];
  }, [designState]);

  const points = activeDesign.points;
  const settings = activeDesign.settings;
  const scale = activeDesign.scale;
  const offset = activeDesign.offset;
  const productInfo = activeDesign.productInfo;
  const activeProductId = activeDesign.activeProductId;

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

  const setActivePoints = (nextPoints: Point[]) => {
    updateActiveDesign((design) => ({ ...design, points: nextPoints }));
  };

  const setActiveSettings = (nextSettings: PlankSettings) => {
    updateActiveDesign((design) => ({ ...design, settings: nextSettings }));
  };

  const setActiveScale = (nextScale: number) => {
    updateActiveDesign((design) => ({ ...design, scale: nextScale }));
  };

  const setActiveOffset = (nextOffset: { x: number; y: number }) => {
    updateActiveDesign((design) => ({ ...design, offset: nextOffset }));
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
    const materialConsumedM2 = totalPlanksOpened * singlePlankAreaM2;

    const wasteArea = Math.max(0, materialConsumedM2 - areaM2);
    const wastePercent = materialConsumedM2 > 0 ? (wasteArea / materialConsumedM2) * 100 : 0;
    const packageCount = Math.ceil(totalPlanksOpened / settings.planksPerPackage);

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
          url: product.url
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

  const handleReset = () => {
    updateActiveDesign((design) => ({
      ...design,
      points: [],
      offset: { ...DEFAULT_OFFSET },
      scale: DEFAULT_SCALE,
      settings: { ...design.settings, originPointIdx: 0 },
      activeProductId: null,
      productInfo: null
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
    const newScale = Math.min(scaleW, scaleH, 0.4);

    const roomCenterX = (minX + maxX) / 2;
    const roomCenterY = (minY + maxY) / 2;

    updateDesignById(designId, (design) => ({
      ...design,
      scale: newScale,
      offset: {
        x: -(roomCenterX * newScale),
        y: -(roomCenterY * newScale)
      }
    }));
  };

  const handleZoomExtents = (targetPoints: Point[] = points) => {
    handleZoomExtentsForDesign(activeDesign.id, targetPoints);
  };

  const handleImportComplete = (newPoints: Point[]) => {
    const currentDesignId = activeDesign.id;
    updateDesignById(currentDesignId, (design) => ({
      ...design,
      points: newPoints
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

  const isDesignLimitReached = designState.designs.length >= MAX_DESIGNS;

  return (
    <div className="w-full h-screen bg-[#F0F0F0] flex items-center justify-center">
      <div className="flex h-screen w-full max-w-[1200px] bg-white text-[#1A1A1A] overflow-hidden shadow-[0_30px_100px_rgba(0,0,0,0.1)] relative">
        <Sidebar
          settings={settings}
          setSettings={handleSidebarSettingsChange}
          stats={stats}
          onReset={handleReset}
          onStartImport={(file) => {
            setImportFile(file);
            setIsImporting(true);
          }}
          savedProducts={savedProducts}
          activeProductId={activeProductId}
          productTotalsById={productTotalsById}
          onAddProduct={addProduct}
          onRemoveProduct={removeProduct}
          onSelectProduct={activateProduct}
          productInfo={productInfo}
        />

        <main className="flex-1 relative flex flex-col bg-[#F9F9F9]">
          <header className="h-20 bg-white flex items-center justify-between px-8 z-10">
            <div className="flex items-center gap-6">
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold flex items-center gap-3">
                <span className="text-[#A0A0A0]">Status</span>
                <span className={`w-1.5 h-1.5 rounded-full ${points.length >= 3 ? 'bg-[#1A1A1A]' : 'bg-[#DDD]'}`}></span>
                <span className={points.length >= 3 ? 'text-[#1A1A1A]' : 'text-[#A0A0A0]'}>
                  {points.length < 3 ? 'Rita Projekt' : 'Layout Klar'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 bg-[#FBFBFB] border border-[#F1F1F1] px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-bold text-[#A0A0A0] uppercase tracking-widest">Grid</span>
                  <input
                    type="number"
                    value={gridSize}
                    onChange={(e) => setGridSize(Math.max(10, parseInt(e.target.value, 10) || 10))}
                    className="w-10 h-6 bg-white border border-[#E5E5E5] text-[9px] font-bold text-center focus:outline-none focus:border-[#D2B7AC]"
                  />
                  <span className="text-[8px] font-bold text-[#A0A0A0]">mm</span>
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

              <button
                onClick={() => setShowEdgeLengths(!showEdgeLengths)}
                className={`text-[9px] uppercase tracking-widest font-bold transition-colors ${showEdgeLengths ? 'text-[#1A1A1A]' : 'text-[#A0A0A0]'}`}
              >
                {showEdgeLengths ? 'Dölj Mått' : 'Visa Mått'}
              </button>

              <div className="w-px h-6 bg-[#F1F1F1]"></div>

              <div className="flex items-center gap-3">
                <button onClick={() => setActiveScale(Math.min(0.5, scale + 0.01))} className="text-[#A0A0A0] hover:text-[#1A1A1A] transition-colors" title="Zooma in">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                </button>
                <button onClick={() => setActiveScale(Math.max(0.01, scale - 0.01))} className="text-[#A0A0A0] hover:text-[#1A1A1A] transition-colors" title="Zooma ut">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 12H4"/></svg>
                </button>
                <button
                  onClick={() => handleZoomExtents()}
                  className="text-[#A0A0A0] hover:text-[#1A1A1A] transition-colors"
                  title="Zooma till extents"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
                </button>
                <div className="text-[9px] font-bold text-[#1A1A1A] tracking-widest bg-[#F9F9F9] px-2 py-1 border border-[#E5E5E5] min-w-[45px] text-center">
                  {Math.round(scale * 1000)}%
                </div>
              </div>
            </div>
          </header>

          <div className="border-b border-[#E2D7D2] bg-white px-6 pt-2">
            <div className="flex items-end gap-1">
              {designState.designs.map((design, index) => {
                const isActive = design.id === designState.activeDesignId;
                const canRemove = designState.designs.length > 1;
                const showCloseButton = isActive || canRemove;
                const isEditing = design.id === editingDesignId;
                const displayName = getDesignName(design, index);
                const charsForWidth = Math.max((isEditing ? editingDesignName : displayName).length, 6);
                const tabWidth = `clamp(172px, calc(${charsForWidth}ch + 7rem), 340px)`;
                return (
                  <div key={design.id} className="group relative flex items-end">
                    <button
                      type="button"
                      onClick={() => setDesignState((prev) => ({ ...prev, activeDesignId: design.id }))}
                      style={{ width: tabWidth }}
                      className={`relative flex h-10 min-w-[172px] max-w-[340px] items-center rounded-t-[2px] border px-5 pr-10 text-[10px] font-bold uppercase tracking-[0.14em] whitespace-nowrap transition-colors ${
                        isActive
                          ? 'z-10 -mb-px border-[#E2D7D2] border-b-white bg-white text-[#1A1A1A]'
                          : 'border-transparent bg-[#E4DDDA] text-[#757575] hover:bg-[#ECE5E2] hover:text-[#1A1A1A]'
                      }`}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editingDesignName}
                          maxLength={MAX_DESIGN_NAME_LENGTH}
                          onChange={(e) => setEditingDesignName(e.target.value.slice(0, MAX_DESIGN_NAME_LENGTH))}
                          onBlur={() => saveDesignNameEdit(design, index)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveDesignNameEdit(design, index);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelDesignNameEdit();
                            }
                          }}
                          className="w-full bg-transparent text-[#1A1A1A] outline-none"
                          aria-label="Byt namn på flik"
                        />
                      ) : (
                        <span
                          className="truncate"
                          title={displayName}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveDesign(design.id);
                      }}
                      className={`absolute right-2 top-2.5 flex h-5 w-5 items-center justify-center rounded-[2px] text-[14px] leading-none transition-all ${
                        isActive
                          ? 'text-[#8B8B8B] hover:bg-[#F2F2F2] hover:text-[#1A1A1A]'
                          : 'text-[#959595] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[#DDD5D1] hover:text-[#1A1A1A]'
                      } ${showCloseButton ? '' : 'pointer-events-none'} disabled:opacity-30 disabled:cursor-not-allowed`}
                      aria-label={`Ta bort ${displayName}`}
                      title={canRemove ? 'Ta bort flik' : 'Minst en flik måste finnas'}
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              <div className="mb-2 ml-1 h-5 w-px bg-[#E2D7D2]"></div>

              <button
                type="button"
                onClick={handleAddDesign}
                disabled={isDesignLimitReached}
                className="mb-1 flex h-8 w-8 items-center justify-center rounded-[2px] text-[24px] leading-none text-[#7A7A7A] transition-colors hover:bg-[#F5F5F5] hover:text-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-40"
                title={isDesignLimitReached ? DESIGN_LIMIT_MESSAGE : 'Lägg till nytt golv'}
                aria-label="Lägg till nytt golv"
              >
                +
              </button>
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
          />
        </main>

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
