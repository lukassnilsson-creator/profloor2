import React, { useRef, useState } from 'react';
import { PlankSettings, SavedProduct } from '../types';
import { logEvent } from '../lib/analytics';

const formatCurrencyLabel = (currency: string) =>
  currency.trim().toUpperCase() === 'SEK' ? 'kr' : currency;

const formatPrice = (value: number, currency: string) =>
  `${Math.round(value).toLocaleString()} ${formatCurrencyLabel(currency)}`;

interface Props {
  products: SavedProduct[];
  activeProductId: string | null;
  activeDesignId: string;
  activeDesignName: string;
  isManualActive: boolean;
  manualFloorSettings: { length: number; width: number; planksPerPackage: number; pricePerPackage: number };
  onActivateManual: () => void;
  onManualFloorSettingsChange: (next: { length: number; width: number; planksPerPackage: number; pricePerPackage: number }) => void;
  onAddProduct: (product: SavedProduct, targetDesignId: string) => void;
  onRemoveProduct: (productId: string) => void;
  onSelectProduct: (product: SavedProduct) => void;
  settings: PlankSettings;
}

export default function MobileProductPanel({
  products,
  activeProductId,
  activeDesignId,
  activeDesignName,
  isManualActive,
  manualFloorSettings,
  onActivateManual,
  onManualFloorSettingsChange,
  onAddProduct,
  onRemoveProduct,
  onSelectProduct,
  settings,
}: Props) {
  // Fetch state
  const [productUrl, setProductUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [fetchElapsed, setFetchElapsed] = useState(0);
  const fetchTimerRef = useRef<number | null>(null);

  // Accordion: which item is expanded ('manual' | product.id | null)
  const defaultExpanded = isManualActive ? 'manual' : (activeProductId ?? 'manual');
  const [expandedId, setExpandedId] = useState<string>(defaultExpanded);

  const isProductLimitReached = products.length >= 5;

  const fetchProductData = async () => {
    const rawUrl = productUrl.trim();
    if (!rawUrl || isProductLimitReached) return;

    setProductError(null);
    let normalizedUrl = rawUrl;
    try {
      const parsedUrl = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('unsupported-protocol');
      normalizedUrl = parsedUrl.href;
    } catch {
      setProductError('Ange en giltig URL som börjar med http:// eller https://.');
      return;
    }

    const duplicate = products.find((p) => p.url.trim() === normalizedUrl);
    if (duplicate) {
      onSelectProduct(duplicate);
      setProductUrl('');
      setProductError('Produkten finns redan och aktiverades.');
      return;
    }

    const targetDesignId = activeDesignId;
    setIsFetching(true);
    setFetchElapsed(0);
    fetchTimerRef.current = window.setInterval(() => setFetchElapsed((s) => s + 1), 1000);

    try {
      const res = await fetch('/api/product-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productUrl: normalizedUrl }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Kunde inte hämta produktdata just nu.');
      }
      const data = await res.json();
      const fetched: SavedProduct = {
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
        minEndPiece: settings.minEndPiece,
      };
      onAddProduct(fetched, targetDesignId);
      setExpandedId(fetched.id);
      setProductUrl('');
      try {
        const hostname = new URL(normalizedUrl).hostname.replace(/^www\./, '');
        logEvent('product_fetched', null, hostname);
      } catch { /* skip */ }
    } catch (error) {
      setProductError(error instanceof Error ? error.message : 'Kunde inte hämta produktdata automatiskt via servern.');
    } finally {
      if (fetchTimerRef.current !== null) { window.clearInterval(fetchTimerRef.current); fetchTimerRef.current = null; }
      setIsFetching(false);
      setFetchElapsed(0);
    }
  };

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? '' : id));

  const activateAndExpand = (id: string, activate: () => void) => {
    activate();
    setExpandedId(id);
  };

  return (
    <div className="bg-white border-t border-[#d9d9d9]">
      {/* Section heading */}
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-[11px] font-semibold text-[#767676] uppercase tracking-wider">
          Golv för: <span className="text-[#1a1a1a]">{activeDesignName}</span>
        </h2>
      </div>

      {/* Accordion */}
      <div className="border-t border-[#d9d9d9]">

        {/* Products first (fetched) */}
        {products.map((product) => {
          const isActive = activeProductId === product.id;
          const isExpanded = expandedId === product.id;
          const pricePerM2 = (() => {
            const pkgAreaM2 = (product.lengthMm * product.widthMm * product.planksPerPackage) / 1_000_000;
            return Number.isFinite(pkgAreaM2) && pkgAreaM2 > 0 ? product.pricePerPackage / pkgAreaM2 : null;
          })();

          return (
            <div key={product.id} className={`border-b border-[#d9d9d9] ${isActive ? 'border-l-2 border-l-[#C41230]' : ''}`}>
              {/* Accordion header — click activates + expands */}
              <button
                type="button"
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${isActive ? 'bg-[#fff8f8]' : 'hover:bg-[#f9f9f9]'}`}
                onClick={() => activateAndExpand(product.id, () => onSelectProduct(product))}
                aria-expanded={isExpanded}
              >
                <img
                  src={product.imageUrl ? `/api/image-proxy?url=${encodeURIComponent(product.imageUrl)}` : 'https://placehold.co/40x40/ede8e3/9a9a9a'}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = 'https://placehold.co/40x40/ede8e3/9a9a9a'; }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[#1a1a1a] truncate">{product.name}</p>
                  <p className="text-[9px] text-[#767676]">
                    {Number.isFinite(product.pricePerPackage) ? `${formatPrice(product.pricePerPackage, product.currency)} / pkt` : '–'}
                    {pricePerM2 ? ` · ${Math.round(pricePerM2).toLocaleString()} ${formatCurrencyLabel(product.currency)} / m²` : ''}
                  </p>
                </div>
                {isActive && (
                  <span className="text-[8px] font-semibold text-[#C41230] bg-[#fff0f2] border border-[#fad0d5] rounded-full px-2 py-0.5 flex-shrink-0">Valt</span>
                )}
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
                  aria-hidden="true"
                >
                  <polyline points="2,4 6,8 10,4" />
                </svg>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="bg-[#fafafa] border-t border-[#efefef] px-4 py-3 space-y-3">
                  {/* Specs */}
                  <div className="text-[9px] text-[#767676] space-y-0.5">
                    <p>{product.lengthMm} × {product.widthMm} mm{product.thicknessMm ? ` · ${product.thicknessMm} mm tjock` : ''} · {product.planksPerPackage} st/förp.</p>
                    {product.stockStatus && <p>{product.stockStatus}</p>}
                    {product.deliveryEstimate && <p>Leverans: {product.deliveryEstimate}</p>}
                  </div>
                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => onRemoveProduct(product.id)}
                    className="text-[9px] text-[#C41230] hover:underline"
                  >
                    Ta bort produkt
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Eget golv — always last in accordion */}
        <div className={`border-b border-[#d9d9d9] ${isManualActive ? 'border-l-2 border-l-[#C41230]' : ''}`}>
          <button
            type="button"
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${isManualActive ? 'bg-[#fff8f8]' : 'hover:bg-[#f9f9f9]'}`}
            onClick={() => activateAndExpand('manual', onActivateManual)}
            aria-expanded={expandedId === 'manual'}
          >
            <div className="h-10 w-10 flex-shrink-0 rounded bg-[#f0f0f0] flex items-center justify-center">
              <svg className="h-5 w-5 text-[#767676]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-[#1a1a1a]">Eget golv</p>
              <p className="text-[9px] text-[#767676]">Egna mått och pris</p>
            </div>
            {isManualActive && (
              <span className="text-[8px] font-semibold text-[#C41230] bg-[#fff0f2] border border-[#fad0d5] rounded-full px-2 py-0.5 flex-shrink-0">Valt</span>
            )}
            <svg
              width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: expandedId === 'manual' ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
              aria-hidden="true"
            >
              <polyline points="2,4 6,8 10,4" />
            </svg>
          </button>

          {expandedId === 'manual' && (
            <div className="bg-[#fafafa] border-t border-[#efefef] px-4 py-3 space-y-3">
              {/* Manual floor inputs */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Längd (mm)', key: 'length', value: manualFloorSettings.length, min: 0, isInt: false },
                  { label: 'Bredd (mm)', key: 'width', value: manualFloorSettings.width, min: 0, isInt: false },
                  { label: 'St/förp.', key: 'planksPerPackage', value: manualFloorSettings.planksPerPackage, min: 1, isInt: true },
                  { label: 'Pris/pkt (kr)', key: 'pricePerPackage', value: manualFloorSettings.pricePerPackage, min: 0, isInt: false },
                ].map(({ label, key, value, min, isInt }) => (
                  <div key={key}>
                    <span className="text-[8px] text-[#767676] block mb-1">{label}</span>
                    <input
                      type="number"
                      min={min}
                      value={value === 0 ? '' : value}
                      onChange={(e) => {
                        const v = isInt ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                        onManualFloorSettingsChange({ ...manualFloorSettings, [key]: isNaN(v) ? 0 : (isInt ? Math.max(1, v) : v) });
                      }}
                      className="w-full bg-white border-b border-[#d9d9d9] py-1.5 text-[11px] focus:outline-none focus:border-[#C41230] transition text-[#1a1a1a]"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* URL input — fetch new product */}
      <div className="px-4 pt-4 pb-4 space-y-2 border-t border-[#d9d9d9]">
        <p className="text-[10px] font-semibold text-[#767676]">Hämta nytt golv</p>
        <input
          type="url"
          placeholder={isProductLimitReached ? 'Max 5 produkter per design' : 'Klistra in länk till golv…'}
          value={productUrl}
          disabled={isProductLimitReached}
          onChange={(e) => { setProductUrl(e.target.value); if (productError) setProductError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') fetchProductData(); }}
          className="w-full bg-white border border-[#d9d9d9] rounded-full px-4 py-2.5 text-[11px] focus:outline-none focus:border-[#C41230] transition disabled:opacity-50"
        />
        <button
          type="button"
          onClick={fetchProductData}
          disabled={isFetching || !productUrl.trim() || isProductLimitReached}
          className="w-full py-2.5 rounded-full bg-[#3D8B37] text-white text-[12px] font-semibold transition-colors hover:bg-[#2e6a2a] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isFetching ? `Hämtar… ${fetchElapsed}s` : 'Hämta produkt'}
        </button>
        {productError && <p className="text-[9px] text-[#C41230]">{productError}</p>}
      </div>
      {/* Bottom spacer — ensures button clears the browser nav bar on iOS/Android */}
      <div className="bg-white" style={{ height: '100px' }} />
    </div>
  );
}
