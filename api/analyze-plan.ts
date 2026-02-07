
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image } = req.body;
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing image data' });
  }

  const dataUrlMatch = image.match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!dataUrlMatch) {
    return res.status(400).json({ error: 'Invalid file format. Expected a base64 data URL (for example data:image/...;base64,... or data:application/pdf;base64,...)' });
  }

  const mimeType = dataUrlMatch[1];
  const base64Data = dataUrlMatch[2];

  try {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing (API_KEY fallback is also unset).' });
    }

    const ai = new GoogleGenAI({ apiKey });

    const requestPayload = {
      model: 'gemini-3-flash-preview',
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
        if (!isUnavailableError || isLastAttempt) {
          throw error;
        }
      }
    }
  } catch (error: any) {
    console.error("Gemini Analysis Error:", error);
    return res.status(500).json({ error: 'Failed to analyze plan' });
  }
}
