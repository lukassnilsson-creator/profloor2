
import { GoogleGenAI, Type } from "@google/genai";
import { getClientIp, isRateLimited } from '../lib/server/rateLimit.ts';

interface ApiRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
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

  const clientIp = getClientIp(req.headers);
  if (isRateLimited(`analyze-plan:${clientIp}`, 5, 60_000)) {
    return res.status(429).json({ error: 'För många förfrågningar. Vänta en stund och försök igen.' });
  }

  const body = isRecord(req.body) ? req.body : {};
  const image = body.image;
  if (typeof image !== 'string' || !image) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  if (image.length > 11_000_000) {
    return res.status(400).json({ error: 'Filen är för stor. Max 8 MB.' });
  }

  const dataUrlMatch = image.match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!dataUrlMatch) {
    return res.status(400).json({ error: 'Invalid file format. Expected a base64 data URL (for example data:image/...;base64,... or data:application/pdf;base64,...)' });
  }

  const [, mimeType, base64Data] = dataUrlMatch;
  if (!mimeType || !base64Data) {
    return res.status(400).json({ error: 'Invalid file format. Missing mime type or file data.' });
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
      model: 'gemini-2.5-flash',
      contents: [
        {
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            { text: `Identify the main floor area in this floor plan. 
            1. Extract the outer boundary vertices as normalized coordinates (0-1000).
            2. Suggest one specific edge (by index) and its length in millimeters to use as a scale reference.
            Return a JSON object.` }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            points: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER }
                },
                required: ["x", "y"]
              }
            },
            referenceWall: {
              type: Type.OBJECT,
              properties: {
                edgeIndex: { type: Type.NUMBER },
                lengthMm: { type: Type.NUMBER }
              }
            }
          },
          required: ["points"]
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
        if (!response.text) {
          throw new Error('Empty Gemini response');
        }
        return res.status(200).json(JSON.parse(response.text));
      } catch (error: unknown) {
        const { isUnavailableError } = getErrorInfo(error);
        const isLastAttempt = attempt === retryDelaysMs.length - 1;
        if (isUnavailableError && isLastAttempt) {
          console.error("Gemini Analysis Error after retries (UNAVAILABLE):", error);
          return res.status(503).json({
            error: 'Analystjänsten är tillfälligt otillgänglig. Försök igen om en stund.',
            code: 'UNAVAILABLE'
          });
        }
        if (!isUnavailableError) {
          throw error;
        }
      }
    }
  } catch (error: unknown) {
    console.error("Gemini Analysis Error:", error);
    return res.status(500).json({ error: 'Failed to analyze plan', code: 'INTERNAL_ERROR' });
  }
}
