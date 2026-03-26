
import React, { useEffect, useRef, useState } from 'react';
import { PlankSettings, SavedProduct, Stats } from '../types';
import { logEvent } from '../lib/analytics';

interface SidebarProps {
  settings: PlankSettings;
  setSettings: (s: PlankSettings) => void;
  products: SavedProduct[];
  activeDesignName: string;
  activeDesignId: string;
  activeProductId: string | null;
  productStatsById: Record<string, Stats>;
  isManualActive: boolean;
  manualFloorSettings: { length: number; width: number; planksPerPackage: number; pricePerPackage: number };
  manualStats: Stats;
  onActivateManual: () => void;
  onManualFloorSettingsChange: (next: { length: number; width: number; planksPerPackage: number; pricePerPackage: number }) => void;
  onAddProduct: (product: SavedProduct, targetDesignId: string) => void;
  onRemoveProduct: (productId: string) => void;
  onSelectProduct: (product: SavedProduct) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  settings,
  setSettings,
  products,
  activeDesignName,
  activeDesignId,
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
}) => {
  const [productUrl, setProductUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [fetchElapsed, setFetchElapsed] = useState(0);
  const fetchTimerRef = useRef<number | null>(null);
  const scrollRevealTimeoutRef = useRef<number | null>(null);
  const [isSidebarScrolling, setIsSidebarScrolling] = useState(false);
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());
  const toggleProductExpanded = (id: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

  const fetchProductData = async () => {
    const rawUrl = productUrl.trim();
    if (!rawUrl || products.length >= 5) return;

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

    const duplicate = products.find((product) => product.url.trim() === normalizedUrl);
    if (duplicate) {
      onSelectProduct(duplicate);
      setProductUrl('');
      setProductError('Produkten finns redan i listan och aktiverades.');
      return;
    }

    // Capture the target design ID before any async work — prevents race condition
    // if the user switches tabs while the fetch is in progress.
    const targetDesignId = activeDesignId;

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
        thicknessMm: typeof data.thicknessMm === 'number' && data.thicknessMm > 0 ? data.thicknessMm : undefined,
        planksPerPackage: data.planksPerPackage,
        minStagger: settings.minStagger,
        startOffset: settings.startOffset,
        startOffsetVertical: settings.startOffsetVertical,
        minEndPiece: settings.minEndPiece
      };

      onAddProduct(fetchedProduct, targetDesignId);
      setProductUrl('');

      try {
        const hostname = new URL(normalizedUrl).hostname.replace(/^www\./, '');
        logEvent('product_fetched', null, hostname);
      } catch { /* invalid URL, skip */ }

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

  const isProductLimitReached = products.length >= 5;
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
      <div className="flex-shrink-0 px-5 pt-4 pb-4 space-y-2.5 bg-white">
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
      <div className="flex-shrink-0 px-5 pt-4 pb-2 bg-white">
        <h2 className="text-[13px] font-semibold text-[#1a1a1a] leading-tight">
          Valda produkter för: <span className="text-[#767676] font-medium">{activeDesignName}</span>
        </h2>
      </div>
    <div
      data-scrolling={isSidebarScrolling ? 'true' : 'false'}
      onScroll={handleSidebarScroll}
      className="pf-scrollbar-on-scroll flex-1 min-h-0 overflow-y-auto"
    >
      <div className="flex flex-col">

        <section className="space-y-0">

          {(isFetching || products.length > 0) && (
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
              {products.map((product) => {
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
                          <div className="min-w-0 flex-1">
                          <p
                            className="text-[10px] font-semibold leading-snug text-[#1a1a1a]"
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden'
                            }}
                          >
                            {product.name}
                          </p>
                          {product.isBrokenLink && (
                            <div className="flex items-center gap-1 mt-1">
                              <svg className="h-3 w-3 text-[#C41230] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                              </svg>
                              <span className="text-[9px] text-[#C41230]">Produkten hittades inte längre</span>
                            </div>
                          )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveProduct(product.id);
                            }}
                            className="flex-shrink-0 inline-flex h-5 w-5 items-center justify-center text-[14px] leading-none text-[#767676] hover:text-[#1a1a1a] self-start"
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

                    {/* Produktspecifikationer — dragspelsmeny */}
                    {(() => {
                      const isExpanded = expandedProductIds.has(product.id);
                      const packageAreaM2 = (product.lengthMm * product.widthMm * product.planksPerPackage) / 1_000_000;
                      const packageAreaFormatted = Number.isFinite(packageAreaM2) && packageAreaM2 > 0
                        ? packageAreaM2.toFixed(2)
                        : null;
                      return (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleProductExpanded(product.id); }}
                            className="w-full flex items-center justify-between px-4 py-1.5 text-[8px] text-[#767676] hover:text-[#1a1a1a] hover:bg-[#f5f5f5] transition-colors border-t border-[#EAE6E3]"
                            aria-expanded={isExpanded}
                          >
                            <span className="font-medium">Produktspecifikationer</span>
                            <svg
                              width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                              style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                              aria-hidden="true"
                            >
                              <polyline points="2,3.5 5,6.5 8,3.5" />
                            </svg>
                          </button>
                          {isExpanded && (
                            <div className="px-4 py-2 flex items-center gap-3 border-t border-[#EAE6E3] bg-[#fafafa] overflow-x-auto">
                              {[
                                { label: 'Längd', value: `${product.lengthMm} mm` },
                                { label: 'Bredd', value: `${product.widthMm} mm` },
                                ...(product.thicknessMm ? [{ label: 'Tjocklek', value: `${product.thicknessMm} mm` }] : []),
                                { label: 'St/förp.', value: `${product.planksPerPackage} st` },
                                ...(packageAreaFormatted ? [{ label: 'm²/förp.', value: `${packageAreaFormatted} m²` }] : []),
                              ].map(({ label, value }, i, arr) => (
                                <React.Fragment key={label}>
                                  <div className="flex flex-col items-center flex-shrink-0">
                                    <span className="text-[7px] text-[#9A9A9A] font-medium whitespace-nowrap">{label}</span>
                                    <span className="text-[9px] font-semibold text-[#1a1a1a] whitespace-nowrap">{value}</span>
                                  </div>
                                  {i < arr.length - 1 && <div className="w-px self-stretch bg-[#EAE6E3] flex-shrink-0" />}
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}

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

    </div>
  );
};

export default Sidebar;
