
import React, { useEffect, useRef, useState } from 'react';
import { PlankSettings, SavedProduct } from '../types';

interface SidebarProps {
  settings: PlankSettings;
  setSettings: (s: PlankSettings) => void;
  savedProducts: SavedProduct[];
  activeProductId: string | null;
  productTotalsById: Record<string, number>;
  onAddProduct: (product: SavedProduct) => void;
  onRemoveProduct: (productId: string) => void;
  onSelectProduct: (product: SavedProduct) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  settings,
  setSettings,
  savedProducts,
  activeProductId,
  productTotalsById,
  onAddProduct,
  onRemoveProduct,
  onSelectProduct
}) => {
  const [productUrl, setProductUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [fetchElapsed, setFetchElapsed] = useState(0);
  const fetchTimerRef = useRef<number | null>(null);
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
    setFetchElapsed(0);
    fetchTimerRef.current = window.setInterval(() => {
      setFetchElapsed((s) => s + 1);
    }, 1000);
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
        imageUrl: typeof data.imageUrl === 'string' && data.imageUrl.trim() ? data.imageUrl : undefined,
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
      if (fetchTimerRef.current !== null) {
        window.clearInterval(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
      setIsFetching(false);
      setFetchElapsed(0);
    }
  };

  const isProductLimitReached = savedProducts.length >= 3;
  const getPricePerSquareMeter = (product: SavedProduct) => {
    const packageAreaM2 = (product.lengthMm * product.widthMm * product.planksPerPackage) / 1_000_000;
    if (!Number.isFinite(packageAreaM2) || packageAreaM2 <= 0) {
      return null;
    }
    return product.pricePerPackage / packageAreaM2;
  };
  const formatCurrencyLabel = (currency: string) => (currency.trim().toUpperCase() === 'SEK' ? 'kr' : currency);
  const getPromotionLabel = (product: SavedProduct) => {
    if (!product.isCampaignPrice) {
      return null;
    }
    const textBlob = [product.name, product.stockStatus, product.deliveryEstimate]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (textBlob.includes('utförsälj') || textBlob.includes('utforsalj')) {
      return 'Utförsäljning';
    }
    if (textBlob.includes('extrapris')) {
      return 'Extrapris';
    }
    return 'Kampanj';
  };
  const formatPrice = (value: number, currency: string) =>
    `${Math.round(value).toLocaleString()} ${formatCurrencyLabel(currency)}`;

  return (
    <div
      data-scrolling={isSidebarScrolling ? 'true' : 'false'}
      onScroll={handleSidebarScroll}
      className="pf-scrollbar-on-scroll h-full min-h-0 w-full overflow-y-auto bg-white"
    >
      <div className="flex flex-col">
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-[13px] font-semibold text-[#1a1a1a]">Valda produkter</h2>
        </div>

        <section className="space-y-0">
          <div className="px-5 pb-4 space-y-2.5">
            <input
              type="text"
              placeholder={isProductLimitReached ? 'Max 3 produkter samtidigt' : 'Klistra in länk till golv...'}
              value={productUrl}
              onChange={(e) => {
                setProductUrl(e.target.value);
                if (productError) setProductError(null);
              }}
              className="w-full bg-white border border-[#d9d9d9] rounded-full px-4 py-2 text-[10px] focus:outline-none focus:border-[#C41230] transition"
            />
            <button
              onClick={fetchProductData}
              disabled={isFetching || !productUrl.trim() || isProductLimitReached}
              className={`pf-action-heading pf-loading-button w-full py-2.5 rounded-full bg-[#3D8B37] text-white font-semibold transition-colors hover:bg-[#2e6a2a] disabled:cursor-not-allowed disabled:opacity-55 ${isFetching ? 'is-loading' : ''}`}
            >
              {isFetching ? `Hämtar produktdata… ${fetchElapsed}s` : 'Hämta produkt'}
            </button>
            {productError && (
              <p className="text-[9px] text-[#C41230] leading-relaxed">{productError}</p>
            )}
            {isProductLimitReached && (
              <p className="text-[9px] text-[#767676] leading-relaxed">Max 3 produkter samtidigt</p>
            )}
          </div>

          {(isFetching || savedProducts.length > 0) && (
            <div className="border-t border-[#d9d9d9]">
              {isFetching && (
                <div className="w-full border-b border-[#d9d9d9]">
                  <div className="flex gap-3 px-4 py-3">
                    <div className="pf-loading-button is-loading h-16 w-16 flex-shrink-0 rounded bg-[#ede8e3]" />
                    <div className="flex-1 min-w-0 space-y-2 pt-1">
                      <div className="pf-loading-button is-loading h-3 w-3/4 rounded bg-[#ede8e3]" />
                      <div className="pf-loading-button is-loading h-2.5 w-1/2 rounded bg-[#ede8e3]" />
                      <div className="pf-loading-button is-loading h-2.5 w-2/3 rounded bg-[#ede8e3]" />
                    </div>
                  </div>
                </div>
              )}
              {savedProducts.map((product) => {
                const totalPrice = productTotalsById[product.id] ?? 0;
                const isActive = activeProductId === product.id;
                const pricePerSquareMeter = getPricePerSquareMeter(product);
                const promotionLabel = getPromotionLabel(product);
                const deliveryEstimate = product.deliveryEstimate?.trim() || 'Okänd leveranstid';

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
                    className={`w-full border-b text-left transition-colors cursor-pointer ${
                      isActive ? 'bg-[#fff8f8] border-l-2 border-l-[#C41230]' : 'border-[#d9d9d9] hover:bg-[#f9f9f9]'
                    }`}
                  >
                    {/* Main card row */}
                    <div className="px-4 pt-3 pb-0">
                      <div className="text-[8px] mb-1.5 pl-[76px]">
                        <a
                          href={product.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#767676] hover:text-[#1a1a1a] hover:underline truncate block"
                        >
                          {(() => { try { return new URL(product.url).hostname.replace(/^www\./, ''); } catch { return product.url; } })()}
                        </a>
                      </div>
                    </div>
                    <div className="flex gap-3 px-4 pb-3">
                      <img
                        src={product.imageUrl ? `/api/image-proxy?url=${encodeURIComponent(product.imageUrl)}` : "https://placehold.co/64x64/ede8e3/9a9a9a"}
                        alt=""
                        className="h-16 w-16 flex-shrink-0 rounded object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).src = "https://placehold.co/64x64/ede8e3/9a9a9a"; }}
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`min-w-0 text-[10px] font-semibold leading-snug ${isActive ? 'text-[#1a1a1a]' : 'text-[#1a1a1a]'}`}
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden'
                            }}
                          >
                            {product.name}
                          </p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveProduct(product.id);
                            }}
                            className="flex-shrink-0 inline-flex h-5 w-5 items-center justify-center text-[14px] leading-none text-[#767676] hover:text-[#1a1a1a]"
                            aria-label={`Ta bort ${product.name}`}
                          >
                            ×
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px]">
                          <span className="font-medium text-[#4a4a4a]">{Number.isFinite(product.pricePerPackage) ? `${formatPrice(product.pricePerPackage, product.currency)} / pkt` : '–'}</span>
                          <span className="text-[#767676]">
                            {pricePerSquareMeter ? `${Math.round(pricePerSquareMeter).toLocaleString()} ${formatCurrencyLabel(product.currency)} / m²` : ''}
                          </span>
                          {promotionLabel && (
                            <span className="border border-[#C41230] rounded-sm px-1 py-0.5 text-[8px] font-semibold text-[#C41230]">
                              {promotionLabel}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[8px]">
                          <span className="text-[#767676]">Leverans: {deliveryEstimate}</span>
                          <span className="text-[12px] font-bold text-[#C41230]">{formatPrice(totalPrice, product.currency)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Kundfavorit banner */}
                    {product.isCampaignPrice && (
                      <div className="flex items-center gap-1.5 bg-[#fff0f2] border-t border-[#fad0d5] px-4 py-1.5 text-[9px] font-medium text-[#C41230]">
                        <span>★</span>
                        <span>Kundfavorit! Över 867 köp den senaste veckan</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-[#d9d9d9] px-5 py-4">
            <label className="block text-[9px] font-medium text-[#767676] mb-3">Plankmått (mm)</label>
            <div className="flex gap-4">
              <div className="flex-1">
                <span className="text-[9px] text-[#767676] block mb-1 font-medium">Längd</span>
                <input
                  type="number"
                  min="0"
                  value={settings.length === 0 ? '' : settings.length}
                  onChange={(e) => handleChange('length', e.target.value)}
                  className="w-full bg-white border-b border-[#d9d9d9] py-2 text-sm focus:outline-none focus:border-[#C41230] transition text-[#1a1a1a]"
                />
              </div>
              <div className="flex-1">
                <span className="text-[9px] text-[#767676] block mb-1 font-medium">Bredd</span>
                <input
                  type="number"
                  min="0"
                  value={settings.width === 0 ? '' : settings.width}
                  onChange={(e) => handleChange('width', e.target.value)}
                  className="w-full bg-white border-b border-[#d9d9d9] py-2 text-sm focus:outline-none focus:border-[#C41230] transition text-[#1a1a1a]"
                />
              </div>
              <div className="flex-1">
                <span className="text-[9px] text-[#767676] block mb-1 font-medium">Antal per förpackning</span>
                <input
                  type="number"
                  min="1"
                  value={settings.planksPerPackage === 0 ? '' : settings.planksPerPackage}
                  onChange={(e) => handleChange('planksPerPackage', e.target.value)}
                  className="w-full bg-white border-b border-[#d9d9d9] py-2 text-sm focus:outline-none focus:border-[#C41230] transition text-[#1a1a1a]"
                />
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
};

export default Sidebar;
