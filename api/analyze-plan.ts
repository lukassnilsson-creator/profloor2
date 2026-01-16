
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const base64Data = image.split(',')[1];
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            { inlineData: { data: base64Data, mimeType: 'image/png' } },
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
    });

    return res.status(200).json(JSON.parse(response.text));
  } catch (error: any) {
    console.error("Gemini Analysis Error:", error);
    return res.status(500).json({ error: 'Failed to analyze plan' });
  }
}
