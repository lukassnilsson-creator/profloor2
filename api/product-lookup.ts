
import { GoogleGenAI, Type } from "@google/genai";

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

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
    // Detect Cloudflare/bot challenge pages — they have no useful product data
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
  // Handle Swedish decimal comma and thousands spaces
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

const extractOgImage = (html: string): string | null => {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m?.[1] ?? null;
};

// ─── Text extraction for Gemini ───────────────────────────────────────────────

const extractRelevantText = (html: string): string => {
  // Strip noisy sections
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // Strip tags, collapse whitespace
  text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Always include the page start (product name + price are typically near the top).
  // Also include the area around the first mm mention (where specs live).
  // On many e-commerce sites the price section is hundreds of chars before the spec table,
  // so a pure mm-anchor window misses it.
  const pageStart = text.slice(0, 2500);

  const mmIdx = text.search(/\d+\s*mm/i);
  if (mmIdx > 2500) {
    // Spec section is further down — append a window around it
    const specStart = Math.max(2500, mmIdx - 500);
    const specEnd = Math.min(text.length, mmIdx + 2000);
    return pageStart + ' ' + text.slice(specStart, specEnd);
  }

  // mm is within the first 2500 chars — page start already covers it
  return text.slice(0, 5000);
};

// ─── Gemini: extract dimensions from text (fast — no googleSearch) ────────────

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
  // Note: googleSearch + responseSchema are incompatible — use plain text + manual JSON parse
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Search for this flooring product page and extract its technical specifications: ${productUrl}.
    Return ONLY a JSON object with these fields (no markdown, no explanation):
    {"productName":"...","lengthMm":0,"widthMm":0,"planksPerPackage":0,"pricePerPackage":0,"currency":"SEK","stockStatus":"...","deliveryEstimate":"...","isCampaignPrice":false}
    Use Swedish context. Extract the price per package (förpackning), not per m².`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });
  if (!response.text) throw new Error('Empty Gemini response');

  // Extract JSON from the response (model may wrap it in text)
  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Gemini response');
  return JSON.parse(jsonMatch[0]);
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

    // ── Fast path: fetch HTML → JSON-LD + Gemini for dimensions ──────────────
    const html = await fetchHtml(productUrl);

    if (html) {
      const jsonLd = extractJsonLd(html);
      const imageUrl = extractOgImage(html);
      const productText = extractRelevantText(html);

      const offer = jsonLd?.offers
        ? Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers
        : null;

      const nameFromLd = typeof jsonLd?.name === 'string' ? decodeHtml(jsonLd.name) : null;

      // Try offer.price, then fall back to offer.priceSpecification.price
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

        const result = {
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

        // Quality gate: if key fields are missing the page was likely blocked/challenged.
        // Fall through to the Gemini googleSearch path which doesn't hit the site directly.
        const hasPrice = typeof result.pricePerPackage === 'number' && result.pricePerPackage > 0;
        const hasDimensions = result.lengthMm > 0 && result.widthMm > 0;
        if (!hasPrice || !hasDimensions) {
          throw new Error('Fast path returned incomplete data');
        }

        return res.status(200).json(result);
      } catch (fastErr) {
        console.error('Fast path failed, falling back to search:', fastErr);
      }
    }

    // ── Slow path: full Gemini with googleSearch ──────────────────────────────
    const retryDelaysMs = [0, 400, 900];
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
      if (retryDelaysMs[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }

      try {
        const data = await extractWithGeminiSearch(ai, productUrl);

        if (!data.imageUrl && html) {
          data.imageUrl = extractOgImage(html);
        }

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
