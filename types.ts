
export interface Point {
  x: number;
  y: number;
}

export interface ProductInfo {
  name: string;
  pricePerPackage: number;
  currency: string;
  url: string;
  stockStatus?: string;
  deliveryEstimate?: string;
  isCampaignPrice?: boolean;
  imageUrl?: string;
}

export interface SavedProduct {
  id: string;
  name: string;
  pricePerPackage: number;
  currency: string;
  url: string;
  stockStatus?: string;
  deliveryEstimate?: string;
  isCampaignPrice?: boolean;
  imageUrl?: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm?: number;
  planksPerPackage: number;
  minStagger: number;
  startOffset: number;
  startOffsetVertical: number;
  minEndPiece: number;
  lastRefreshedAt?: string; // ISO date — when price/stock was last refreshed
  isBrokenLink?: boolean;   // true if the product URL returned 404
}

export interface ProductDesignSettings {
  minStagger: number;
  startOffset: number;
  startOffsetVertical: number;
  minEndPiece: number;
  layoutRotated: boolean;
}

export interface PlankSettings {
  length: number; // mm
  width: number;  // mm
  minEndPiece: number; // mm
  minStagger: number; // mm
  gap: number; // mm expansion gap
  startOffset: number; // mm - shifting the start of the first row
  startOffsetVertical: number; // mm - shifting the row alignment vertically
  planksPerPackage: number; // pieces
  visualContrast: number; // 0 to 1
  originPointIdx: number; // Index of the point to start the layout from
  layoutRotated: boolean; // Rotate laying pattern 90°
}

export interface FloorDesign {
  id: string;
  name: string;
  savedFloorId?: string;    // Supabase saved_floors row ID, set after first save
  savedStateKey?: string;   // JSON snapshot of key state at last save, used to detect unsaved changes
  points: Point[];
  settings: PlankSettings;
  products: SavedProduct[]; // Per-design product list (max 5)
  productSettingsById: Record<string, ProductDesignSettings>;
  activeProductId: string | null;
  productInfo: ProductInfo | null; // Used by embedded canvas module
  scale: number;
  offset: { x: number; y: number };
  backgroundDrawing: ImportedDrawingBackground | null;
  showBackgroundDrawing: boolean;
  backgroundOpacity: number; // 0 to 1
}

export interface Stats {
  area: number; // m2
  plankCount: number; // total planks opened from box
  packageCount: number; // total packages needed
  wasteArea: number; // m2
  wastePercent: number;
  totalPrice?: number;
}

export interface WastePiece {
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'start-cut' | 'discarded-offcut';
  sourcePlankId?: string;
}

export interface PlankInstance {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  isCut: boolean;
  // Metadata for visualization
  fullWidth: number;fullLength: number;
  visualX: number; // The X coordinate of the physical plank start
  isFromOffcut: boolean; // Was this piece started from a previous row's offcut?
  sourcePlankId?: string; // ID of the plank that provided the offcut for this one
}

export interface ReferenceWall {
  p1: Point;
  p2: Point;
  lengthMm: number;
}

export interface ImportedDrawingBackground {
  src: string;            // Cropped image (base64)
  originalSrc?: string;   // Full original image before crop (for re-editing)
  cropRect?: { x: number; y: number; width: number; height: number }; // Crop in natural px
  x: number;
  y: number;
  width: number;
  height: number;
}
