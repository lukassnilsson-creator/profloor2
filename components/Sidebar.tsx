
import React, { useEffect, useRef, useState } from 'react';
import { PlankSettings, SavedProduct, Stats } from '../types';

interface SidebarProps {
  settings: PlankSettings;
  setSettings: (s: PlankSettings) => void;
  savedProducts: SavedProduct[];
  activeProductId: string | null;
  productStatsById: Record<string, Stats>;
  isManualActive: boolean;
  manualFloorSettings: { length: number; width: number; planksPerPackage: number; pricePerPackage: number };
  manualStats: Stats;
  onActivateManual: () => void;
  onManualFloorSettingsChange: (next: { length: number; width: number; planksPerPackage: number; pricePerPackage: number }) => void;
  onAddProduct: (product: SavedProduct) => void;
  onRemoveProduct: (productId: string) => void;
  onSelectProduct: (product: SavedProduct) => void;
  onOptimize: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  settings,
  setSettings,
  savedProducts,
  activeProductId,
  productStatsById,
  isManualActive,
  manualFloorSettings,
  manualStats,
  onActivateManual,
  onManualFloorSettingsChange,
  onAddProduct,
  onRemoveProduct,
  onSelectProduct,
  onOptimize
}) => {
  const [productUrl, setProductUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [fetchElapsed, setFetchElapsed] = useState(0);
  const fetchTimerRef = useRef<number | null>(null);
  const scrollRevealTimeoutRef = useRef<number | null>(null);
  const [isSidebarScrolling, setIsSidebarScrolling] = useState(false);
  const [isJusteraOpen, setIsJusteraOpen] = useState(false);
  const justeraRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (scrollRevealTimeoutRef.current !== null) {
        window.clearTimeout(scrollRevealTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isJusteraOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (justeraRef.current && !justeraRef.current.contains(e.target as Node)) {
        setIsJusteraOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isJusteraOpen]);

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
    if (!rawUrl || savedProducts.length >= 5) return;

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

  const isProductLimitReached = savedProducts.length >= 5;
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
    <div className="h-full min-h-0 w-full flex flex-col bg-white">
      <div className="flex-shrink-0 px-5 pt-4 pb-4 space-y-2.5 border-b border-[#d9d9d9] bg-white">
        <input
          type="text"
          placeholder={isProductLimitReached ? 'Max 5 produkter samtidigt' : 'Klistra in länk till golv...'}
          value={productUrl}
          onChange={(e) => {
            setProductUrl(e.target.value);
            if (productError) setProductError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') fetchProductData();
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
      </div>
    <div
      data-scrolling={isSidebarScrolling ? 'true' : 'false'}
      onScroll={handleSidebarScroll}
      className="pf-scrollbar-on-scroll flex-1 min-h-0 overflow-y-auto"
    >
      <div className="flex flex-col">

        <section className="space-y-0">

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
                const productStats = productStatsById[product.id] ?? { area: 0, plankCount: 0, packageCount: 0, wasteArea: 0, wastePercent: 0 };
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
                          className="text-[#767676] hover:text-[#1a1a1a] hover:underline"
                        >
                          {(() => { try { const u = new URL(product.url); const h = u.hostname.replace(/^www\./, ''); const p = u.pathname.slice(1); return h + '/' + p.slice(0, 9) + (p.length > 9 ? '…' : ''); } catch { return product.url.slice(0, 20) + '…'; } })()}
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

                        <div className="text-[8px] text-[#767676]">Leverans: {deliveryEstimate}</div>
                      </div>
                    </div>

                    {/* Kundfavorit banner */}
                    {product.isCampaignPrice && (
                      <div className="flex items-center gap-1.5 bg-[#fff0f2] border-t border-[#fad0d5] px-4 py-1.5 text-[9px] font-medium text-[#C41230]">
                        <span>★</span>
                        <span>Kundfavorit! Över 867 köp den senaste veckan</span>
                      </div>
                    )}

                    {/* Stats row */}
                    <div className="border-t border-[#EAE6E3] flex items-stretch px-4 py-2.5">
                      {[
                        { label: 'Area', value: `${productStats.area.toFixed(2)} m²` },
                        { label: 'Åtgång', value: `${productStats.plankCount} st` },
                        { label: 'Förp.', value: `${productStats.packageCount} st` },
                        { label: 'Spill', value: `${productStats.wastePercent.toFixed(1)}%`, isSpill: true },
                      ].map((stat, i) => (
                        <React.Fragment key={stat.label}>
                          {i > 0 && <div className="w-px self-stretch bg-[#EAE6E3] mx-2" />}
                          <div className="flex flex-col items-center flex-1">
                            <span className="text-[8px] font-medium text-[#9A9A9A] whitespace-nowrap">{stat.label}</span>
                            <span className={`mt-0.5 text-[11px] font-bold leading-none whitespace-nowrap ${stat.isSpill ? (productStats.wastePercent <= 15 ? 'text-[#3D8B37]' : 'text-[#1A1A1A]') : 'text-[#1A1A1A]'}`}>
                              {stat.value}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                      <div className="w-px self-stretch bg-[#EAE6E3] mx-2" />
                      <div className="flex flex-col items-end justify-center flex-shrink-0">
                        <span className="text-[8px] font-medium text-[#9A9A9A] whitespace-nowrap">Summa</span>
                        <span className="mt-0.5 text-[11px] font-bold leading-none text-[#C41230] whitespace-nowrap">
                          {productStats.totalPrice ? formatPrice(productStats.totalPrice, product.currency) : '–'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div
            role="button"
            tabIndex={0}
            onClick={onActivateManual}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivateManual();
              }
            }}
            className={`border-t border-[#d9d9d9] text-left cursor-pointer transition-colors ${
              isManualActive ? 'bg-[#fff8f8] border-l-2 border-l-[#C41230]' : 'hover:bg-[#f9f9f9]'
            }`}
          >
            <div className="px-5 pt-4 pb-3">
              <h2 className="text-[13px] font-semibold text-[#1a1a1a] mb-3">Eget golv</h2>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <span className="text-[9px] text-[#767676] block mb-1 font-medium">Längd</span>
                  <input
                    type="number"
                    min="0"
                    value={manualFloorSettings.length === 0 ? '' : manualFloorSettings.length}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onManualFloorSettingsChange({ ...manualFloorSettings, length: isNaN(val) ? 0 : val });
                    }}
                    className="w-full bg-white border-b border-[#d9d9d9] py-2 text-sm focus:outline-none focus:border-[#C41230] transition text-[#1a1a1a]"
                  />
                </div>
                <div>
                  <span className="text-[9px] text-[#767676] block mb-1 font-medium">Bredd</span>
                  <input
                    type="number"
                    min="0"
                    value={manualFloorSettings.width === 0 ? '' : manualFloorSettings.width}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onManualFloorSettingsChange({ ...manualFloorSettings, width: isNaN(val) ? 0 : val });
                    }}
                    className="w-full bg-white border-b border-[#d9d9d9] py-2 text-sm focus:outline-none focus:border-[#C41230] transition text-[#1a1a1a]"
                  />
                </div>
                <div>
                  <span className="text-[9px] text-[#767676] block mb-1 font-medium">St/frp</span>
                  <input
                    type="number"
                    min="1"
                    value={manualFloorSettings.planksPerPackage === 0 ? '' : manualFloorSettings.planksPerPackage}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      onManualFloorSettingsChange({ ...manualFloorSettings, planksPerPackage: isNaN(val) ? 0 : Math.max(1, val) });
                    }}
                    className="w-full bg-white border-b border-[#d9d9d9] py-2 text-sm focus:outline-none focus:border-[#C41230] transition text-[#1a1a1a]"
                  />
                </div>
                <div>
                  <span className="text-[9px] text-[#767676] block mb-1 font-medium">Pris/pkt</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="kr"
                    value={manualFloorSettings.pricePerPackage === 0 ? '' : manualFloorSettings.pricePerPackage}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      onManualFloorSettingsChange({ ...manualFloorSettings, pricePerPackage: isNaN(val) ? 0 : val });
                    }}
                    className="w-full bg-white border-b border-[#d9d9d9] py-2 text-sm focus:outline-none focus:border-[#C41230] transition text-[#1a1a1a]"
                  />
                </div>
              </div>
            </div>

            {/* Stats row for Eget golv */}
            <div className="border-t border-[#EAE6E3] flex items-stretch px-4 py-2.5">
              {[
                { label: 'Area', value: `${manualStats.area.toFixed(2)} m²` },
                { label: 'Åtgång', value: `${manualStats.plankCount} st` },
                { label: 'Förp.', value: `${manualStats.packageCount} st` },
                { label: 'Spill', value: `${manualStats.wastePercent.toFixed(1)}%`, isSpill: true },
              ].map((stat, i) => (
                <React.Fragment key={stat.label}>
                  {i > 0 && <div className="w-px self-stretch bg-[#EAE6E3] mx-2" />}
                  <div className="flex flex-col items-center flex-1">
                    <span className="text-[8px] font-medium text-[#9A9A9A] whitespace-nowrap">{stat.label}</span>
                    <span className={`mt-0.5 text-[11px] font-bold leading-none whitespace-nowrap ${stat.isSpill ? (manualStats.wastePercent <= 15 ? 'text-[#3D8B37]' : 'text-[#1A1A1A]') : 'text-[#1A1A1A]'}`}>
                      {stat.value}
                    </span>
                  </div>
                </React.Fragment>
              ))}
              <div className="w-px self-stretch bg-[#EAE6E3] mx-2" />
              <div className="flex flex-col items-end justify-center flex-shrink-0">
                <span className="text-[8px] font-medium text-[#9A9A9A] whitespace-nowrap">Summa</span>
                <span className="mt-0.5 text-[11px] font-bold leading-none text-[#C41230] whitespace-nowrap">
                  {manualStats.totalPrice ? formatPrice(manualStats.totalPrice, 'SEK') : '–'}
                </span>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>

    {/* Justera läggning accordion + sticky bottom bar */}
    <div ref={justeraRef} className="flex-shrink-0 relative">
      {/* Accordion panel — floats 14px above the button */}
      {isJusteraOpen && (() => {
        const maxOffset = Math.max(0, settings.length - settings.minEndPiece);
        const maxVerticalOffset = Math.max(0, settings.width);
        const maxMinPiece = Math.max(0, settings.length / 2);
        return (
          <div className="absolute left-5 bottom-[57px] w-[200px] bg-white rounded-2xl px-4 py-4 border border-[#aaaaaa] space-y-3">
            <div className="space-y-2.5">
              <div>
                <div className="mb-0.5 flex items-center justify-between">
                  <label className="text-[9px] font-medium text-[#767676]">Skarvförskjutning</label>
                  <span className="text-[10px] font-semibold text-[#333333]">{Math.round(settings.minStagger)} mm</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, settings.length)}
                  step="10"
                  value={settings.minStagger}
                  onChange={(event) => {
                    const next = Math.max(0, parseInt(event.target.value, 10) || 0);
                    setSettings({ ...settings, minStagger: next });
                  }}
                  className="kahrs-slider"
                />
              </div>
              <div>
                <div className="mb-0.5 flex items-center justify-between">
                  <label className="text-[9px] font-medium text-[#767676]">Startförskjutning hor.</label>
                  <span className="text-[10px] font-semibold text-[#333333]">{Math.round(settings.startOffset)} mm</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={maxOffset}
                  step="10"
                  value={settings.startOffset}
                  onChange={(event) => {
                    const next = Math.max(0, parseInt(event.target.value, 10) || 0);
                    setSettings({ ...settings, startOffset: Math.min(next, maxOffset) });
                  }}
                  className="kahrs-slider"
                />
              </div>
              <div>
                <div className="mb-0.5 flex items-center justify-between">
                  <label className="text-[9px] font-medium text-[#767676]">Startförskjutning vert.</label>
                  <span className="text-[10px] font-semibold text-[#333333]">{Math.round(settings.startOffsetVertical)} mm</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={maxVerticalOffset}
                  step="10"
                  value={settings.startOffsetVertical}
                  onChange={(event) => {
                    const next = Math.max(0, parseInt(event.target.value, 10) || 0);
                    setSettings({ ...settings, startOffsetVertical: Math.min(next, maxVerticalOffset) });
                  }}
                  className="kahrs-slider"
                />
              </div>
              <div>
                <div className="mb-0.5 flex items-center justify-between">
                  <label className="text-[9px] font-medium text-[#767676]">Minsta ändbit</label>
                  <span className="text-[10px] font-semibold text-[#333333]">{Math.round(settings.minEndPiece)} mm</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={maxMinPiece}
                  step="10"
                  value={settings.minEndPiece}
                  onChange={(event) => {
                    const next = Math.max(0, parseInt(event.target.value, 10) || 0);
                    setSettings({ ...settings, minEndPiece: Math.min(next, maxMinPiece) });
                  }}
                  className="kahrs-slider"
                />
              </div>
            </div>
          </div>
        );
      })()}
      {/* Sticky bottom bar */}
      <div className="border-t border-[#d9d9d9] px-5 py-4 flex items-center gap-2 bg-white">
        <button
          type="button"
          onClick={() => setIsJusteraOpen((v) => !v)}
          className="pf-action-heading h-8 w-[149px] px-3 rounded-full bg-white text-[10px] font-semibold text-[#333333] transition-colors hover:bg-[#f0f0f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230] flex items-center gap-1.5"
          aria-expanded={isJusteraOpen}
        >
          <img src="/icons/kugghjul-v01.svg" width="19" height="19" alt="" aria-hidden="true" style={{display:'block',flexShrink:0}} />
          <span className="leading-none">Justera läggning</span>
        </button>
        <button
          type="button"
          onClick={onOptimize}
          className="pf-action-heading h-8 w-[149px] px-3 rounded-full bg-white text-[10px] font-semibold text-[#333333] transition-colors hover:bg-[#f0f0f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C41230] flex items-center gap-1.5"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{display:'block',flexShrink:0}} aria-hidden="true">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            <path d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
          </svg>
          <span className="leading-none">Optimera läggning</span>
        </button>
        <button
          type="button"
          onClick={() => setSettings({ ...settings, layoutRotated: !settings.layoutRotated })}
          title={settings.layoutRotated ? 'Rotera 90° tillbaka' : 'Rotera 90°'}
          className="ml-auto flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full bg-white transition-colors hover:bg-[#f0f0f0]"
          aria-label={settings.layoutRotated ? 'Rotera 90° tillbaka' : 'Rotera 90°'}
        >
          <svg width="19" height="18" viewBox="0 0 26 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}>
            <rect x="1" y="1" width="5" height="14" rx="1" stroke={settings.layoutRotated ? '#333333' : '#CCCCCC'} />
            <rect x="8" y="13" width="14" height="5" rx="1" stroke={settings.layoutRotated ? '#CCCCCC' : '#333333'} />
            <path d="M7 4 C14 2, 18 5, 18 11.5" stroke="#CCCCCC" />
            <polyline points="15.5,10 18,11.5 16.5,14" stroke="#CCCCCC" />
          </svg>
        </button>
      </div>
    </div>
    </div>
  );
};

export default Sidebar;
