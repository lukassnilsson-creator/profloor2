
import React, { useEffect, useRef, useState } from 'react';
import { PlankSettings, Stats, ProductInfo, SavedProduct } from '../types';

interface SidebarProps {
  settings: PlankSettings;
  setSettings: (s: PlankSettings) => void;
  stats: Stats;
  savedProducts: SavedProduct[];
  activeProductId: string | null;
  productTotalsById: Record<string, number>;
  onAddProduct: (product: SavedProduct) => void;
  onRemoveProduct: (productId: string) => void;
  onSelectProduct: (product: SavedProduct) => void;
  productInfo: ProductInfo | null;
}

const Sidebar: React.FC<SidebarProps> = ({
  settings,
  setSettings,
  stats,
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
  const [productError, setProductError] = useState<string | null>(null);
  const scrollRevealTimeoutRef = useRef<number | null>(null);
  const [isSidebarScrolling, setIsSidebarScrolling] = useState(false);

  useEffect(() => {
    return () => {
      if (scrollRevealTimeoutRef.current !== null) {
        window.clearTimeout(scrollRevealTimeoutRef.current);
      }
    };
  }, []);

  const handleSidebarScroll = () => {
    setIsSidebarScrolling(true);
    if (scrollRevealTimeoutRef.current !== null) {
      window.clearTimeout(scrollRevealTimeoutRef.current);
    }
    scrollRevealTimeoutRef.current = window.setTimeout(() => {
      setIsSidebarScrolling(false);
      scrollRevealTimeoutRef.current = null;
    }, 650);
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
    <div
      data-scrolling={isSidebarScrolling ? 'true' : 'false'}
      onScroll={handleSidebarScroll}
      className="pf-scrollbar-on-scroll h-full min-h-0 w-full overflow-y-auto bg-white px-7 py-8"
    >
      <div className="flex flex-col gap-8">
        <section className="space-y-6">
          <div className="border border-[#DFCBC2] bg-[#FCF8F6]">
            <div className="p-4 space-y-3">
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
                className={`pf-loading-button w-full py-3 bg-[#C9A89A] text-white text-[10px] font-semibold transition-colors hover:bg-[#B69181] disabled:cursor-not-allowed disabled:opacity-55 ${isFetching ? 'is-loading' : ''}`}
              >
                {isFetching ? 'Hämtar produktdata…' : 'Hämta Produktdata'}
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
                          <p className="text-[8px] font-medium text-[#A0A0A0] truncate">{storeName}</p>
                          {product.isCampaignPrice && (
                            <span className="shrink-0 text-[8px] font-semibold text-white bg-[#1A1A1A] px-1.5 py-0.5">
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
                            <div className="mt-1 text-[8px] text-[#A0A0A0]">
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

		          <div className="space-y-8">
		            <div>
		              <label className="block text-[9px] font-medium text-[#8B8B8B] mb-4">Plankmått (mm)</label>
              <div className="flex gap-4">
                <div className="flex-1">
                  <span className="text-[9px] text-[#8B8B8B] block mb-1 font-medium">Längd</span>
                  <input 
                    type="number" 
                    min="0"
                    value={settings.length === 0 ? '' : settings.length}
                    onChange={(e) => handleChange('length', e.target.value)}
                    className="w-full bg-[#FBFBFB] border-b border-[#E5E5E5] py-2 text-sm focus:outline-none focus:border-[#D2B7AC] transition text-[#1A1A1A]"
                  />
                </div>
                <div className="flex-1">
                  <span className="text-[9px] text-[#8B8B8B] block mb-1 font-medium">Bredd</span>
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
                  <label className="block text-[9px] font-medium text-[#8B8B8B] mb-2">Antal per förpackning</label>
                  <input 
                    type="number" 
                    min="1"
                    value={settings.planksPerPackage === 0 ? '' : settings.planksPerPackage}
                    onChange={(e) => handleChange('planksPerPackage', e.target.value)}
                    className="w-full bg-[#FBFBFB] border-b border-[#E5E5E5] py-2 text-sm focus:outline-none focus:border-[#D2B7AC] transition text-[#1A1A1A]"
	                  />
	                </div>
		            </div>
		          </div>
		        </section>

        <section className="pt-8 border-t border-[#F1F1F1]">
          <h2 className="text-[9px] font-medium text-[#8B8B8B] mb-6">Specifikation</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium">Total Area</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.area.toFixed(2)} m²</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium">Materialåtgång</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.plankCount} st</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium">Förpackningar</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.packageCount} st</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium">Spillprocent</span>
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
                  <span className="text-[11px] text-[#1A1A1A] font-bold">Total Kostnad</span>
                  <span className="text-xl font-black text-[#1A1A1A]">{Math.round(stats.totalPrice).toLocaleString()} {productInfo.currency}</span>
                </div>
                {stats.area > 0 && (
                  <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
                    <span className="text-[11px] text-[#888] font-medium">Pris per m²</span>
                    <span className="text-base font-bold text-[#1A1A1A]">
                      {Math.round(stats.totalPrice / stats.area).toLocaleString()} {productInfo.currency}/m²
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

      </div>
    </div>
  );
};

export default Sidebar;
