
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productUrl } = req.body;
  if (!productUrl) {
    return res.status(400).json({ error: 'Missing product URL' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing (API_KEY fallback is also unset).' });
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
      } catch (error: any) {
        const status = error?.status;
        const statusText = String(status ?? '').toUpperCase();
        const messageText = String(error?.message ?? '').toUpperCase();
        const isUnavailableError =
          status === 503 ||
          statusText === '503' ||
          statusText === 'UNAVAILABLE' ||
          messageText.includes('UNAVAILABLE');

        const isLastAttempt = attempt === retryDelaysMs.length - 1;
        if (isUnavailableError && isLastAttempt) {
          console.error("Gemini Error after retries (UNAVAILABLE):", error);
          return res.status(503).json({ error: 'Produkttjänsten är tillfälligt otillgänglig. Försök igen om en stund.' });
        }

        if (!isUnavailableError) {
          throw error;
        }
      }
    }
  } catch (error: any) {
    console.error("Gemini Error:", error);
    return res.status(500).json({ error: 'Failed to fetch product data' });
  }
}
