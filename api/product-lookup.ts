
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

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
        error: 'Server configuration error: GEMINI_API_KEY is missing (API_KEY fallback is also unset).',
        code: 'MISSING_API_KEY'
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const requestPayload = {
      model: 'gemini-3-flash-preview',
      contents: `Search for this flooring product and extract its technical specifications: ${productUrl}. 
      I need the plank length in mm, plank width in mm, the number of planks per package (pieces), and the current price per package (excluding any bulk discounts).
      Return the data in Swedish context if possible.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            productName: { type: Type.STRING },
            lengthMm: { type: Type.NUMBER },
            widthMm: { type: Type.NUMBER },
            planksPerPackage: { type: Type.NUMBER },
            pricePerPackage: { type: Type.NUMBER },
            currency: { type: Type.STRING }
          },
          required: ["productName", "lengthMm", "widthMm", "planksPerPackage", "pricePerPackage", "currency"]
        }
      }
    };

    const retryDelaysMs = [0, 400, 900];
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
      if (retryDelaysMs[attempt] > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt]));
      }

      try {
        const response = await ai.models.generateContent(requestPayload);
        return res.status(200).json(JSON.parse(response.text));
      } catch (error: unknown) {
        const { isUnavailableError } = getErrorInfo(error);
        const isLastAttempt = attempt === retryDelaysMs.length - 1;
        if (isUnavailableError && isLastAttempt) {
          console.error("Gemini Error after retries (UNAVAILABLE):", error);
          return res.status(503).json({
            error: 'Produkttjänsten är tillfälligt otillgänglig. Försök igen om en stund.',
            code: 'UNAVAILABLE'
          });
        }

        if (!isUnavailableError) {
          throw error;
        }
      }
    }
  } catch (error: unknown) {
    console.error("Gemini Error:", error);
    return res.status(500).json({ error: 'Failed to fetch product data', code: 'INTERNAL_ERROR' });
  }
}
