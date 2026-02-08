
import React, { useRef, useState } from 'react';
import { PlankSettings, Stats, ProductInfo, SavedProduct } from '../types';

interface SidebarProps {
  settings: PlankSettings;
  setSettings: (s: PlankSettings) => void;
  stats: Stats;
  onReset: () => void;
  onStartImport: (file: File) => void;
  savedProducts: SavedProduct[];
  activeProductId: string | null;
  productTotalsById: Record<string, number>;
  onAddProduct: (product: SavedProduct) => void;
  onRemoveProduct: (productId: string) => void;
  onSelectProduct: (product: SavedProduct) => void;
  productInfo: ProductInfo | null;
}

const KahrsInput: React.FC<{
  title: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
}> = ({ title, leftLabel, rightLabel, value, min, max, step = 1, onChange }) => (
  <div className="space-y-1">
    <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em]">{title}</label>
    <input 
      type="range" 
      min={min} 
      max={max} 
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="kahrs-slider"
    />
    <div className="flex justify-between text-[10px] text-[#444] font-medium">
      <span className="opacity-60">{leftLabel}</span>
      <span>{rightLabel}</span>
    </div>
  </div>
);

const Sidebar: React.FC<SidebarProps> = ({
  settings,
  setSettings,
  stats,
  onReset,
  onStartImport,
  savedProducts,
  activeProductId,
  productTotalsById,
  onAddProduct,
  onRemoveProduct,
  onSelectProduct,
  productInfo
}) => {
  const [productUrl, setProductUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const supportedImportMimeTypes = ['image/png', 'image/jpeg', 'application/pdf'];

  const startImportFromFile = (file: File | undefined) => {
    if (!file) return;
    if (supportedImportMimeTypes.includes(file.type) || /\.(png|jpe?g|pdf)$/i.test(file.name)) {
      setImportError(null);
      onStartImport(file);
      return;
    }
    setImportError('Filformat stöds inte. Välj PNG, JPG eller PDF.');
  };

  const handleChange = (key: keyof PlankSettings, val: string | number) => {
    let num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num) && val !== '') return;
    const finalVal = val === '' ? 0 : num;
    if (key === 'planksPerPackage') {
      setSettings({ ...settings, [key]: Math.max(1, Math.round(finalVal)) });
    } else {
      setSettings({ ...settings, [key]: finalVal });
    }
  };

  const fetchProductData = async () => {
    const rawUrl = productUrl.trim();
    if (!rawUrl || savedProducts.length >= 3) return;

    setProductError(null);
    let normalizedUrl = rawUrl;
    try {
      const parsedUrl = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('unsupported-protocol');
      }
      normalizedUrl = parsedUrl.href;
    } catch {
      setProductError('Ange en giltig URL som börjar med http:// eller https://.');
      return;
    }

    const duplicate = savedProducts.find((product) => product.url.trim() === normalizedUrl);
    if (duplicate) {
      onSelectProduct(duplicate);
      setProductUrl('');
      setProductError('Produkten finns redan i listan och aktiverades.');
      return;
    }

    setIsFetching(true);
    try {
      const res = await fetch('/api/product-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productUrl: normalizedUrl })
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Kunde inte hämta produktdata just nu.');
      }
      const data = await res.json();
      
      const fetchedProduct: SavedProduct = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: data.productName,
        pricePerPackage: data.pricePerPackage,
        currency: data.currency,
        url: normalizedUrl,
        stockStatus: typeof data.stockStatus === 'string' && data.stockStatus.trim() ? data.stockStatus : undefined,
        deliveryEstimate: typeof data.deliveryEstimate === 'string' && data.deliveryEstimate.trim() ? data.deliveryEstimate : undefined,
        isCampaignPrice: typeof data.isCampaignPrice === 'boolean' ? data.isCampaignPrice : undefined,
        lengthMm: data.lengthMm,
        widthMm: data.widthMm,
        planksPerPackage: data.planksPerPackage,
        minStagger: settings.minStagger,
        startOffset: settings.startOffset,
        startOffsetVertical: settings.startOffsetVertical,
        minEndPiece: settings.minEndPiece
      };

      onAddProduct(fetchedProduct);
      setProductUrl('');

    } catch (error) {
      console.error("Failed to fetch product data", error);
      setProductError(error instanceof Error ? error.message : 'Kunde inte hämta produktdata automatiskt via servern.');
    } finally {
      setIsFetching(false);
    }
  };

  const maxOffset = Math.max(0, settings.length - settings.minEndPiece);
  const maxVerticalOffset = Math.max(0, settings.width);
  const maxMinPiece = Math.max(0, settings.length / 2);
  const isProductLimitReached = savedProducts.length >= 3;
  const isWasteLow = stats.wastePercent <= 15;
  const getStoreName = (productUrlValue: string) => {
    try {
      return new URL(productUrlValue).hostname.replace(/^www\./i, '') || 'Okänt';
    } catch {
      return 'Okänt';
    }
  };

  return (
    <div className="w-80 h-full bg-white flex flex-col overflow-y-auto border-r border-[#E5E5E5] px-8 py-10">
      <div className="mb-12">
        <h1 className="serif text-3xl font-bold tracking-tight text-[#1A1A1A]">ProFloor CAD</h1>
        <p className="text-[10px] text-[#A0A0A0] mt-2 font-medium uppercase tracking-[0.15em] leading-relaxed">
          Planera rätt, lägg snyggt,<br/>minimera spill.
        </p>
      </div>

      <div className="flex flex-col gap-10">
        <section className="space-y-6">
          <div className="bg-[#FDF9F8] border border-[#EAD8D1]">
            <div className="p-4 space-y-3">
              <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em]">Produktinfo via URL</label>
              <input
                type="text"
                placeholder="Klistra in länk till golv..."
                value={productUrl}
                onChange={(e) => {
                  setProductUrl(e.target.value);
                  if (productError) setProductError(null);
                }}
                className="w-full bg-white border border-[#E5E5E5] px-3 py-2 text-[10px] focus:outline-none focus:border-[#D2B7AC] transition"
              />
              <button
                onClick={fetchProductData}
                disabled={isFetching || !productUrl.trim() || isProductLimitReached}
                className="w-full py-3 bg-[#D2B7AC] text-white text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-[#C5A599] transition-colors disabled:opacity-50"
              >
                {isFetching ? 'Hämtar data...' : 'Hämta Produktdata'}
              </button>
              {productError && (
                <p className="text-[9px] text-red-600 leading-relaxed">{productError}</p>
              )}
              {isProductLimitReached && (
                <p className="text-[9px] text-[#A0A0A0] leading-relaxed">Max 3 produkter samtidigt.</p>
              )}
            </div>
            {savedProducts.length > 0 && (
              <div className="pt-1">
                <div className="border-t border-[#EAD8D1]"></div>
                {savedProducts.map((product, index) => {
                  const totalPrice = productTotalsById[product.id] ?? 0;
                  const isActive = activeProductId === product.id;
                  const storeName = getStoreName(product.url);
                  const deliveryEstimate = product.deliveryEstimate?.trim() || 'Okänt';
                  return (
                    <div
                      key={product.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectProduct(product)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectProduct(product);
                        }
                      }}
                      className={`w-full px-4 py-2.5 text-left transition-colors cursor-pointer hover:bg-white/40 ${
                        isActive ? 'bg-white' : ''
                      } ${
                        index > 0 ? 'border-t border-[#EAD8D1]' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-[#A0A0A0] truncate">{storeName}</p>
                          {product.isCampaignPrice && (
                            <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.1em] text-white bg-[#1A1A1A] px-1.5 py-0.5">
                              Kampanj
                            </span>
                          )}
                        </div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-[9px] font-bold truncate ${isActive ? 'text-[#1A1A1A]' : 'text-[#333]'}`}>{product.name}</p>
                              <p className="text-[9px] font-bold text-[#1A1A1A] text-right shrink-0">
                                {Math.round(totalPrice).toLocaleString()} {product.currency}
                              </p>
                            </div>
                            <p className="text-[9px] text-[#A0A0A0]">
                              {product.pricePerPackage} {product.currency} / pkt
                            </p>
                            <div className="mt-1 text-[8px] uppercase tracking-[0.1em] text-[#A0A0A0]">
                              <span className="truncate block">Leverans: {deliveryEstimate}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveProduct(product.id);
                            }}
                            className="w-4 h-4 text-[10px] leading-none text-[#A0A0A0] hover:text-[#1A1A1A] shrink-0 mt-0.5"
                            aria-label={`Ta bort ${product.name}`}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            onDragEnter={(e) => { e.preventDefault(); setIsDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
            onDragLeave={(e) => {
              e.preventDefault();
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragActive(false);
              startImportFromFile(e.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={importInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
              className="hidden"
              onChange={(e) => {
                startImportFromFile(e.target.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className={`w-full py-4 bg-white border text-[11px] font-bold uppercase tracking-[0.2em] transition-colors flex items-center justify-center gap-2 ${isDragActive ? 'border-[#1A1A1A] text-[#1A1A1A] bg-[#FDF9F8]' : 'border-[#D2B7AC] text-[#D2B7AC] hover:bg-[#FDF9F8]'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              Importera Ritning
            </button>
	          </div>
            {importError && (
              <p className="text-[9px] text-red-600 mt-2">{importError}</p>
            )}

	          <div className="space-y-8">
	            <div>
	              <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em] mb-4">Plankmått (mm)</label>
              <div className="flex gap-4">
                <div className="flex-1">
                  <span className="text-[9px] text-[#A0A0A0] block mb-1 uppercase font-bold">Längd</span>
                  <input 
                    type="number" 
                    min="0"
                    value={settings.length === 0 ? '' : settings.length}
                    onChange={(e) => handleChange('length', e.target.value)}
                    className="w-full bg-[#FBFBFB] border-b border-[#E5E5E5] py-2 text-sm focus:outline-none focus:border-[#D2B7AC] transition text-[#1A1A1A]"
                  />
                </div>
                <div className="flex-1">
                  <span className="text-[9px] text-[#A0A0A0] block mb-1 uppercase font-bold">Bredd</span>
                  <input 
                    type="number" 
                    min="0"
                    value={settings.width === 0 ? '' : settings.width}
                    onChange={(e) => handleChange('width', e.target.value)}
                    className="w-full bg-[#FBFBFB] border-b border-[#E5E5E5] py-2 text-sm focus:outline-none focus:border-[#D2B7AC] transition text-[#1A1A1A]"
	                  />
	                </div>
	              </div>
                <div className="mt-4">
                  <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em] mb-2">Antal per förpackning</label>
                  <input 
                    type="number" 
                    min="1"
                    value={settings.planksPerPackage === 0 ? '' : settings.planksPerPackage}
                    onChange={(e) => handleChange('planksPerPackage', e.target.value)}
                    className="w-full bg-[#FBFBFB] border-b border-[#E5E5E5] py-2 text-sm focus:outline-none focus:border-[#D2B7AC] transition text-[#1A1A1A]"
                  />
                </div>
	            </div>

            <KahrsInput 
              title="Skarvförskjutning"
              leftLabel="Standard"
              rightLabel={`${settings.minStagger} mm`}
              value={settings.minStagger}
              min={0}
              max={settings.length}
              step={10}
              onChange={(val) => handleChange('minStagger', val)}
            />

            <KahrsInput 
              title="Startförskjutning horizontellt"
              leftLabel="Ingen"
              rightLabel={`${settings.startOffset} mm`}
              value={settings.startOffset}
              min={0}
              max={maxOffset}
              step={10}
              onChange={(val) => handleChange('startOffset', val)}
            />

            <KahrsInput 
              title="Startförskjutning vertikalt"
              leftLabel="Ingen"
              rightLabel={`${settings.startOffsetVertical} mm`}
              value={settings.startOffsetVertical}
              min={0}
              max={maxVerticalOffset}
              step={10}
              onChange={(val) => handleChange('startOffsetVertical', val)}
            />

            <KahrsInput 
              title="Minsta ändbit"
              leftLabel="Standard"
              rightLabel={`${settings.minEndPiece} mm`}
              value={settings.minEndPiece}
              min={0}
              max={maxMinPiece}
              step={10}
              onChange={(val) => handleChange('minEndPiece', val)}
            />
	          </div>
	        </section>

        <section className="pt-8 border-t border-[#F1F1F1]">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A0A0A0] mb-6">Specifikation</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Total Area</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.area.toFixed(2)} m²</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Materialåtgång</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.plankCount} st</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Förpackningar</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.packageCount} st</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Spillprocent</span>
              <span className={`text-lg font-bold flex items-center gap-1 ${isWasteLow ? 'text-[#2E9B4A]' : 'text-[#D2B7AC]'}`}>
                {isWasteLow && (
                  <svg className="w-4 h-4 text-[#2E9B4A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 20v-6" />
                    <path strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 14c0-3 2.3-5.5 5.2-5.9-.5 2.9-2.1 5.5-5.2 5.9Z" />
                    <path strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 14c0-2.8-2.2-5.1-5-5.4.4 2.7 1.9 5.1 5 5.4Z" />
                    <path strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M9.5 20h5" />
                  </svg>
                )}
                {stats.wastePercent.toFixed(1)}%
              </span>
            </div>
            {productInfo && stats.totalPrice && (
              <>
                <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2 pt-4">
                  <span className="text-[11px] text-[#1A1A1A] font-bold uppercase tracking-wider">Total Kostnad</span>
                  <span className="text-xl font-black text-[#1A1A1A]">{Math.round(stats.totalPrice).toLocaleString()} {productInfo.currency}</span>
                </div>
                {stats.area > 0 && (
                  <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
                    <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Pris per m²</span>
                    <span className="text-base font-bold text-[#1A1A1A]">
                      {Math.round(stats.totalPrice / stats.area).toLocaleString()} {productInfo.currency}/m²
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <button 
          onClick={onReset}
          className="mt-4 w-full py-4 bg-[#1A1A1A] text-white text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-[#333] transition-colors active:scale-[0.98]"
        >
          Nollställ Ritning
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
