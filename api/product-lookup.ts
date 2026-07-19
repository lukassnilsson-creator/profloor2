
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from '@supabase/supabase-js';

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  status: (statusCode: number) => {
    json: (payload: unknown) => void;
  };
}

interface ErrorLike {
  status?: unknown;
  message?: unknown;
}

interface JsonLdPriceSpec {
  price?: number | string;
  priceCurrency?: string;
}

interface JsonLdOffer {
  price?: number | string;
  priceCurrency?: string;
  availability?: string;
  priceSpecification?: JsonLdPriceSpec | JsonLdPriceSpec[];
}

interface JsonLdProduct {
  name?: string;
  image?: string | string[];
  offers?: JsonLdOffer | JsonLdOffer[];
}

interface CacheRow {
  url: string;
  name: string;
  length_mm: number;
  width_mm: number;
  thickness_mm: number | null;
  planks_per_package: number;
  image_url: string | null;
  price_per_package: number;
  currency: string;
  stock_status: string | null;
  delivery_estimate: string | null;
  is_campaign_price: boolean;
}

interface ProductLookupResult {
  productName: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm?: number;
  planksPerPackage: number;
  imageUrl?: string;
  pricePerPackage: number;
  currency: string;
  stockStatus?: string;
  deliveryEstimate?: string;
  isCampaignPrice: boolean;
}

interface ProductCacheTable {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<{ data: CacheRow | null; error: unknown }>;
    };
  };
  upsert: (payload: CacheRow, options: { onConflict: string }) => Promise<unknown>;
  update: (payload: Partial<CacheRow>) => {
    eq: (column: string, value: string) => Promise<unknown>;
  };
}

interface Supabase {
  from: (relation: 'product_cache') => ProductCacheTable;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const toLookupResult = (value: Record<string, unknown>): ProductLookupResult | null => {
  const productName = isNonEmptyString(value.productName) ? value.productName : null;
  const lengthMm = isPositiveNumber(value.lengthMm) ? value.lengthMm : null;
  const widthMm = isPositiveNumber(value.widthMm) ? value.widthMm : null;
  const planksPerPackage = isPositiveNumber(value.planksPerPackage) ? value.planksPerPackage : null;
  const pricePerPackage = isPositiveNumber(value.pricePerPackage) ? value.pricePerPackage : null;
  const currency = isNonEmptyString(value.currency) ? value.currency : null;

  if (!productName || !lengthMm || !widthMm || !planksPerPackage || !pricePerPackage || !currency) {
    return null;
  }

  return {
    productName,
    lengthMm,
    widthMm,
    thicknessMm: isPositiveNumber(value.thicknessMm) ? value.thicknessMm : undefined,
    planksPerPackage,
    imageUrl: isNonEmptyString(value.imageUrl) ? value.imageUrl : undefined,
    pricePerPackage,
    currency,
    stockStatus: isNonEmptyString(value.stockStatus) ? value.stockStatus : undefined,
    deliveryEstimate: isNonEmptyString(value.deliveryEstimate) ? value.deliveryEstimate : undefined,
    isCampaignPrice: typeof value.isCampaignPrice === 'boolean' ? value.isCampaignPrice : false,
  };
};

// ─── Supabase cache ───────────────────────────────────────────────────────────

const getSupabase = (): Supabase | null => {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as Supabase;
};

const getCached = async (sb: Supabase, url: string): Promise<CacheRow | null> => {
  const { data, error } = await sb.from('product_cache').select('*').eq('url', url).maybeSingle();
  if (error || !data) return null;
  return data;
};

const saveCache = async (sb: Supabase, url: string, d: ProductLookupResult) => {
  const payload: CacheRow = {
    url,
    name: d.productName,
    length_mm: d.lengthMm,
    width_mm: d.widthMm,
    thickness_mm: d.thicknessMm ?? null,
    planks_per_package: d.planksPerPackage,
    image_url: d.imageUrl ?? null,
    price_per_package: d.pricePerPackage,
    currency: d.currency,
    stock_status: d.stockStatus ?? null,
    delivery_estimate: d.deliveryEstimate ?? null,
    is_campaign_price: d.isCampaignPrice,
  };
  await sb.from('product_cache').upsert(payload, { onConflict: 'url' });
};

const updateCachePrice = async (sb: Supabase, url: string, d: {
  pricePerPackage: number; currency: string; stockStatus: string | null;
  deliveryEstimate: string | null; isCampaignPrice: boolean;
}) => {
  const payload: Partial<CacheRow> = {
    price_per_package: d.pricePerPackage,
    currency: d.currency,
    stock_status: d.stockStatus,
    delivery_estimate: d.deliveryEstimate,
    is_campaign_price: d.isCampaignPrice,
  };
  await sb.from('product_cache').update(payload).eq('url', url);
};

// ─── HTML fetching ────────────────────────────────────────────────────────────

const fetchHtml = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (
      text.includes('cf-browser-verification') ||
      text.includes('challenge-platform') ||
      text.includes('__cf_chl') ||
      (text.length < 5000 && text.includes('Checking your browser'))
    ) {
      return null;
    }
    return text;
  } catch {
    return null;
  }
};

// ─── JSON-LD extraction ───────────────────────────────────────────────────────

const extractJsonLd = (html: string): JsonLdProduct | null => {
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const raw = JSON.parse(match[1]);
      const candidates = Array.isArray(raw) ? raw : [raw];
      const flattened = candidates.flatMap((item: Record<string, unknown>) =>
        Array.isArray(item['@graph']) ? (item['@graph'] as unknown[]) : [item]
      );
      const product = flattened.find((item) => {
        if (!isRecord(item)) return false;
        const t = item['@type'];
        return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
      }) as JsonLdProduct | undefined;
      if (product) return product;
    } catch {
      continue;
    }
  }
  return null;
};

const decodeHtml = (str: string): string =>
  str.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
     .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
     .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
     .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');

const parsePrice = (price: unknown): number | null => {
  if (typeof price === 'number') return Number.isFinite(price) ? price : null;
  if (typeof price !== 'string') return null;
  const cleaned = price.replace(/\s/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const mapAvailability = (url: string): string => {
  if (url.includes('InStock')) return 'I lager';
  if (url.includes('OutOfStock')) return 'Slut i lager';
  if (url.includes('PreOrder')) return 'Förbeställning';
  if (url.includes('LimitedAvailability')) return 'Begränsat lager';
  return url;
};

// ─── Image extraction ─────────────────────────────────────────────────────────

const toAbsolute = (src: string, baseUrl?: string): string | null => {
  const s = src.trim();
  if (s.startsWith('http')) return s;
  if (s.startsWith('//')) return 'https:' + s; // protocol-relative URL
  if (baseUrl && s.startsWith('/')) {
    try { return new URL(s, baseUrl).href; } catch { /* skip */ }
  }
  return null;
};

const extractOgImage = (html: string, baseUrl?: string): string | null => {
  const metaPatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const p of metaPatterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const abs = toAbsolute(m[1], baseUrl);
      if (abs) return abs;
    }
  }
  const microdata = html.match(/itemprop=["']image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/content=["']([^"']+)["'][^>]+itemprop=["']image["']/i);
  if (microdata?.[1]) {
    const abs = toAbsolute(microdata[1], baseUrl);
    if (abs) return abs;
  }
  return null;
};

const resolveImage = (html: string, jsonLd: JsonLdProduct | null, baseUrl: string): string | null => {
  const og = extractOgImage(html, baseUrl);
  if (og) return og;
  const ld = jsonLd?.image ? (Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image) : null;
  if (typeof ld === 'string' && ld) return toAbsolute(ld, baseUrl) ?? ld;
  return null;
};

// ─── Text extraction for Gemini ───────────────────────────────────────────────

const extractRelevantText = (html: string): string => {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const pageStart = text.slice(0, 2500);
  const mmIdx = text.search(/\d+\s*mm/i);
  if (mmIdx > 2500) {
    const specStart = Math.max(2500, mmIdx - 500);
    const specEnd = Math.min(text.length, mmIdx + 2000);
    return pageStart + ' ' + text.slice(specStart, specEnd);
  }
  return text.slice(0, 5000);
};

// ─── Gemini: extract dimensions (fast, no googleSearch) ───────────────────────

const extractDimensionsWithGemini = async (
  ai: GoogleGenAI,
  productText: string,
  fallbackFields: { needName: boolean; needPrice: boolean }
): Promise<Record<string, unknown>> => {
  const extraFields = fallbackFields.needName || fallbackFields.needPrice
    ? `${fallbackFields.needName ? '\n- productName: product name' : ''}${fallbackFields.needPrice ? '\n- pricePerPackage: price per package as a number\n- currency: currency code (e.g. SEK)' : ''}`
    : '';

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Extract flooring product specifications from the following product page text. Return JSON only.\n\nFields to extract:\n- lengthMm: plank length in millimeters (number)\n- widthMm: plank width in millimeters (number)\n- thicknessMm: plank thickness in millimeters (number)\n- planksPerPackage: number of planks per package (number)\n- deliveryEstimate: estimated delivery time as a short string (e.g. "2-5 vardagar")\n- isCampaignPrice: true if the price is a campaign/discount price${extraFields}\n\nIf a value cannot be found, omit that field.\n\nProduct page text:\n${productText}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          lengthMm: { type: Type.NUMBER },
          widthMm: { type: Type.NUMBER },
          thicknessMm: { type: Type.NUMBER },
          planksPerPackage: { type: Type.NUMBER },
          deliveryEstimate: { type: Type.STRING },
          isCampaignPrice: { type: Type.BOOLEAN },
          ...(fallbackFields.needName ? { productName: { type: Type.STRING } } : {}),
          ...(fallbackFields.needPrice ? {
            pricePerPackage: { type: Type.NUMBER },
            currency: { type: Type.STRING },
          } : {}),
        },
        required: ['lengthMm', 'widthMm', 'planksPerPackage'],
      },
    },
  });
  if (!response.text) throw new Error('Empty Gemini response');
  return JSON.parse(response.text);
};

// ─── Gemini: full fallback with googleSearch ──────────────────────────────────

const extractWithGeminiSearch = async (
  ai: GoogleGenAI,
  productUrl: string
): Promise<Record<string, unknown>> => {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Search for this flooring product page and extract its technical specifications: ${productUrl}.
    Return ONLY a JSON object with these fields (no markdown, no explanation):
    {"productName":"...","lengthMm":0,"widthMm":0,"planksPerPackage":0,"pricePerPackage":0,"currency":"SEK","stockStatus":"...","deliveryEstimate":"...","isCampaignPrice":false,"imageUrl":"..."}
    Use Swedish context. Extract the price per package (förpackning), not per m².
    For imageUrl: return the main product image URL from the page (og:image or similar). Return empty string if not found.`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });
  if (!response.text) throw new Error('Empty Gemini response');
  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Gemini response');
  return JSON.parse(jsonMatch[0]);
};

// ─── Gemini: quick price/stock refresh (for cached products) ─────────────────

const refreshPriceWithGeminiSearch = async (
  ai: GoogleGenAI,
  productUrl: string
): Promise<Record<string, unknown>> => {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Check the current price and availability for this product: ${productUrl}.
    Return ONLY a JSON object (no markdown):
    {"pricePerPackage":0,"currency":"SEK","stockStatus":"...","deliveryEstimate":"...","isCampaignPrice":false}
    Swedish context. Price per package (förpackning), not per m².`,
    config: { tools: [{ googleSearch: {} }] },
  });
  if (!response.text) throw new Error('Empty Gemini response');
  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found');
  return JSON.parse(jsonMatch[0]);
};

// ─── Price extraction from HTML ───────────────────────────────────────────────

const extractPriceFromHtml = (html: string) => {
  const jsonLd = extractJsonLd(html);
  const offer = jsonLd?.offers
    ? (Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers)
    : null;
  const priceSpec = offer?.priceSpecification
    ? (Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification)
    : null;
  const price = offer?.price != null ? parsePrice(offer.price) : priceSpec?.price != null ? parsePrice(priceSpec.price) : null;
  const currency = typeof offer?.priceCurrency === 'string' ? offer.priceCurrency
    : typeof priceSpec?.priceCurrency === 'string' ? priceSpec.priceCurrency : null;
  const stock = typeof offer?.availability === 'string' ? mapAvailability(offer.availability) : null;
  return { price, currency, stock };
};

// ─── Error helpers ────────────────────────────────────────────────────────────

const getErrorInfo = (error: unknown) => {
  const parsed = (isRecord(error) ? error : {}) as ErrorLike;
  const status = typeof parsed.status === 'number' ? parsed.status : null;
  const statusText = String(parsed.status ?? '').toUpperCase();
  const messageText = String(parsed.message ?? '').toUpperCase();
  const isUnavailableError =
    status === 503 ||
    statusText === '503' ||
    statusText === 'UNAVAILABLE' ||
    messageText.includes('UNAVAILABLE');
  return { isUnavailableError };
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = isRecord(req.body) ? req.body : {};
  const productUrl = body.productUrl;
  if (typeof productUrl !== 'string' || !productUrl) {
    return res.status(400).json({ error: 'Missing product URL' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Server configuration error: GEMINI_API_KEY is missing.',
        code: 'MISSING_API_KEY',
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const sb = getSupabase();

    // ── Cache lookup ──────────────────────────────────────────────────────────
    const cached = sb ? await getCached(sb, productUrl) : null;

    if (cached) {
      console.log('[product-lookup] cache hit:', productUrl);

      // Refresh price/stock/delivery — try HTML first, Gemini Search as fallback
      let pricePerPackage = cached.price_per_package;
      let currency = cached.currency;
      let stockStatus = cached.stock_status;
      let deliveryEstimate = cached.delivery_estimate;
      let isCampaignPrice = cached.is_campaign_price;

      let imageUrl = cached.image_url;

      const html = await fetchHtml(productUrl);
      if (html) {
        const { price, currency: cur, stock } = extractPriceFromHtml(html);
        if (price) pricePerPackage = price;
        if (cur) currency = cur;
        if (stock) stockStatus = stock;
        // Backfill image if it was missing when originally cached
        if (!imageUrl) {
          const jsonLd = extractJsonLd(html);
          imageUrl = resolveImage(html, jsonLd, productUrl);
          if (imageUrl && sb) {
            void (async () => {
              try {
                await sb.from('product_cache').update({ image_url: imageUrl }).eq('url', productUrl);
              } catch {
                // Non-critical cache backfill.
              }
            })();
          }
        }
      } else {
        try {
          const fresh = await refreshPriceWithGeminiSearch(ai, productUrl);
          if (typeof fresh.pricePerPackage === 'number' && fresh.pricePerPackage > 0) pricePerPackage = fresh.pricePerPackage;
          if (typeof fresh.currency === 'string' && fresh.currency) currency = fresh.currency;
          if (typeof fresh.stockStatus === 'string') stockStatus = fresh.stockStatus;
          if (typeof fresh.deliveryEstimate === 'string') deliveryEstimate = fresh.deliveryEstimate;
          if (typeof fresh.isCampaignPrice === 'boolean') isCampaignPrice = fresh.isCampaignPrice;
        } catch { /* use cached price */ }
      }

      // Update price in cache (fire-and-forget)
      if (sb) {
        updateCachePrice(sb, productUrl, { pricePerPackage, currency, stockStatus, deliveryEstimate, isCampaignPrice })
          .catch(() => { /* non-critical */ });
      }

      return res.status(200).json({
        productName: cached.name,
        lengthMm: cached.length_mm,
        widthMm: cached.width_mm,
        thicknessMm: cached.thickness_mm ?? undefined,
        planksPerPackage: cached.planks_per_package,
        imageUrl: imageUrl ?? undefined,
        pricePerPackage,
        currency,
        stockStatus: stockStatus ?? undefined,
        deliveryEstimate: deliveryEstimate ?? undefined,
        isCampaignPrice,
      });
    }

    // ── Cache miss: full lookup ───────────────────────────────────────────────
    console.log('[product-lookup] cache miss, full lookup:', productUrl);

    // Fast path: fetch HTML → JSON-LD + Gemini for dimensions
    const html = await fetchHtml(productUrl);

    if (html) {
      const jsonLd = extractJsonLd(html);
      const imageUrl = resolveImage(html, jsonLd, productUrl);
      console.log('[product-lookup] image sources:', { url: productUrl, imageUrl });
      const productText = extractRelevantText(html);

      const offer = jsonLd?.offers
        ? Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers
        : null;
      const nameFromLd = typeof jsonLd?.name === 'string' ? decodeHtml(jsonLd.name) : null;
      const priceSpec = offer?.priceSpecification
        ? Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification
        : null;
      const priceFromLd = offer?.price != null
        ? parsePrice(offer.price)
        : priceSpec?.price != null ? parsePrice(priceSpec.price) : null;
      const currencyFromLd = typeof offer?.priceCurrency === 'string'
        ? offer.priceCurrency
        : typeof priceSpec?.priceCurrency === 'string' ? priceSpec.priceCurrency : null;
      const stockFromLd = typeof offer?.availability === 'string' ? mapAvailability(offer.availability) : null;

      try {
        const dimensions = await extractDimensionsWithGemini(ai, productText, {
          needName: !nameFromLd,
          needPrice: !priceFromLd || !currencyFromLd,
        });

        const rawResult: Record<string, unknown> = {
          productName: nameFromLd ?? dimensions.productName,
          lengthMm: dimensions.lengthMm,
          widthMm: dimensions.widthMm,
          thicknessMm: typeof dimensions.thicknessMm === 'number' && dimensions.thicknessMm > 0 ? dimensions.thicknessMm : undefined,
          planksPerPackage: dimensions.planksPerPackage,
          pricePerPackage: priceFromLd ?? dimensions.pricePerPackage,
          currency: currencyFromLd ?? dimensions.currency ?? 'SEK',
          stockStatus: stockFromLd ?? undefined,
          deliveryEstimate: typeof dimensions.deliveryEstimate === 'string' && dimensions.deliveryEstimate.trim() ? dimensions.deliveryEstimate : undefined,
          isCampaignPrice: typeof dimensions.isCampaignPrice === 'boolean' ? dimensions.isCampaignPrice : false,
          imageUrl: imageUrl ?? undefined,
        };

        const result = toLookupResult(rawResult);
        if (!result) throw new Error('Fast path returned incomplete data');

        if (sb) void saveCache(sb, productUrl, result).catch(() => { /* non-critical */ });
        return res.status(200).json(result);
      } catch (fastErr) {
        console.error('Fast path failed, falling back to search:', fastErr);
      }
    }

    // Slow path: Gemini with googleSearch
    const retryDelaysMs = [0, 400, 900];
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
      if (retryDelaysMs[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }

      try {
        const rawData = await extractWithGeminiSearch(ai, productUrl);

        if (!rawData.imageUrl && html) {
          rawData.imageUrl = resolveImage(html, null, productUrl);
        }

        const data = toLookupResult(rawData);
        if (!data) throw new Error('Search fallback returned incomplete data');

        if (sb) void saveCache(sb, productUrl, data).catch(() => { /* non-critical */ });
        return res.status(200).json(data);
      } catch (error: unknown) {
        const { isUnavailableError } = getErrorInfo(error);
        const isLastAttempt = attempt === retryDelaysMs.length - 1;
        if (isUnavailableError && isLastAttempt) {
          return res.status(503).json({
            error: 'Produkttjänsten är tillfälligt otillgänglig. Försök igen om en stund.',
            code: 'UNAVAILABLE',
          });
        }
        if (!isUnavailableError) throw error;
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('product-lookup error:', msg);
    return res.status(500).json({ error: `Failed to fetch product data: ${msg}`, code: 'INTERNAL_ERROR' });
  }
}
