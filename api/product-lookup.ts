
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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
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
    });

    return res.status(200).json(JSON.parse(response.text));
  } catch (error: any) {
    console.error("Gemini Error:", error);
    return res.status(500).json({ error: 'Failed to fetch product data' });
  }
}
