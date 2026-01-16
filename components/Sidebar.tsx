
import React, { useState } from 'react';
import { PlankSettings, Stats, ProductInfo } from '../types';
import { GoogleGenAI, Type } from "@google/genai";

interface SidebarProps {
  settings: PlankSettings;
  setSettings: (s: PlankSettings) => void;
  stats: Stats;
  onReset: () => void;
  onStartImport: () => void;
  productInfo: ProductInfo | null;
  setProductInfo: (info: ProductInfo | null) => void;
}

const KahrsInput: React.FC<{
  title: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
}> = ({ title, leftLabel, rightLabel, value, min, max, step = 1, onChange }) => (
  <div className="space-y-1">
    <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em]">{title}</label>
    <input 
      type="range" 
      min={min} 
      max={max} 
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="kahrs-slider"
    />
    <div className="flex justify-between text-[10px] text-[#444] font-medium">
      <span className="opacity-60">{leftLabel}</span>
      <span>{rightLabel}</span>
    </div>
  </div>
);

const Sidebar: React.FC<SidebarProps> = ({ settings, setSettings, stats, onReset, onStartImport, productInfo, setProductInfo }) => {
  const [productUrl, setProductUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);

  const handleChange = (key: keyof PlankSettings, val: string | number) => {
    let num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num) && val !== '') return;
    
    const finalVal = val === '' ? 0 : num;

    if (key === 'planksPerPackage') {
      setSettings({ ...settings, [key]: Math.max(1, Math.round(finalVal)) });
    } else {
      setSettings({ ...settings, [key]: finalVal });
    }
  };

  const fetchProductData = async () => {
    if (!productUrl) return;
    setIsFetching(true);
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

      const data = JSON.parse(response.text);
      
      setSettings({
        ...settings,
        length: data.lengthMm,
        width: data.widthMm,
        planksPerPackage: data.planksPerPackage,
      });

      setProductInfo({
        name: data.productName,
        pricePerPackage: data.pricePerPackage,
        currency: data.currency,
        url: productUrl
      });

    } catch (error) {
      console.error("Failed to fetch product data", error);
      alert("Kunde inte hämta produktdata automatiskt. Kontrollera URL:en eller fyll i värdena manuellt.");
    } finally {
      setIsFetching(false);
    }
  };

  const maxOffset = Math.max(0, settings.length - settings.minEndPiece);
  const maxMinPiece = Math.max(0, settings.length / 2);

  return (
    <div className="w-80 h-full bg-white flex flex-col overflow-y-auto border-r border-[#E5E5E5] px-8 py-10">
      <div className="mb-12">
        <h1 className="serif text-3xl font-bold tracking-tight text-[#1A1A1A]">ProFloor CAD</h1>
        <p className="text-[10px] text-[#A0A0A0] mt-2 font-medium uppercase tracking-[0.15em] leading-relaxed">
          Planera rätt, lägg snyggt,<br/>minimera spill.
        </p>
      </div>

      <div className="flex flex-col gap-10">
        <section className="space-y-6">
          <div className="bg-[#FDF9F8] p-4 border border-[#EAD8D1] space-y-3">
             <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em]">Produktinfo via URL</label>
             <input 
               type="text" 
               placeholder="Klistra in länk till golv..."
               value={productUrl}
               onChange={(e) => setProductUrl(e.target.value)}
               className="w-full bg-white border border-[#E5E5E5] px-3 py-2 text-[10px] focus:outline-none focus:border-[#D2B7AC] transition"
             />
             <button 
               onClick={fetchProductData}
               disabled={isFetching || !productUrl}
               className="w-full py-3 bg-[#D2B7AC] text-white text-[10px] font-bold uppercase tracking-[0.15em] hover:bg-[#C5A599] transition-colors disabled:opacity-50"
             >
               {isFetching ? 'Hämtar data...' : 'Hämta Produktdata'}
             </button>
             {productInfo && (
               <div className="pt-1">
                 <p className="text-[9px] font-bold text-[#1A1A1A] line-clamp-1">{productInfo.name}</p>
                 <p className="text-[9px] text-[#A0A0A0]">{productInfo.pricePerPackage} {productInfo.currency} / pkt</p>
               </div>
             )}
          </div>

          <button 
            onClick={onStartImport}
            className="w-full py-4 bg-white border border-[#D2B7AC] text-[#D2B7AC] text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-[#FDF9F8] transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
            Importera Ritning
          </button>

          <div className="space-y-8">
            <div>
              <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em] mb-4">Plankmått (mm)</label>
              <div className="flex gap-4">
                <div className="flex-1">
                  <span className="text-[9px] text-[#A0A0A0] block mb-1 uppercase font-bold">Längd</span>
                  <input 
                    type="number" 
                    min="0"
                    value={settings.length === 0 ? '' : settings.length}
                    onChange={(e) => handleChange('length', e.target.value)}
                    className="w-full bg-[#FBFBFB] border-b border-[#E5E5E5] py-2 text-sm focus:outline-none focus:border-[#D2B7AC] transition text-[#1A1A1A]"
                  />
                </div>
                <div className="flex-1">
                  <span className="text-[9px] text-[#A0A0A0] block mb-1 uppercase font-bold">Bredd</span>
                  <input 
                    type="number" 
                    min="0"
                    value={settings.width === 0 ? '' : settings.width}
                    onChange={(e) => handleChange('width', e.target.value)}
                    className="w-full bg-[#FBFBFB] border-b border-[#E5E5E5] py-2 text-sm focus:outline-none focus:border-[#D2B7AC] transition text-[#1A1A1A]"
                  />
                </div>
              </div>
            </div>

            <KahrsInput 
              title="Startförskjutning"
              leftLabel="Ingen"
              rightLabel={`${settings.startOffset} mm`}
              value={settings.startOffset}
              min={0}
              max={maxOffset}
              step={10}
              onChange={(val) => handleChange('startOffset', val)}
            />

            <KahrsInput 
              title="Minsta ändbit"
              leftLabel="Standard"
              rightLabel={`${settings.minEndPiece} mm`}
              value={settings.minEndPiece}
              min={0}
              max={maxMinPiece}
              step={10}
              onChange={(val) => handleChange('minEndPiece', val)}
            />

            <KahrsInput 
              title="Skarvförskjutning"
              leftLabel="Standard"
              rightLabel={`${settings.minStagger} mm`}
              value={settings.minStagger}
              min={0}
              max={settings.length}
              step={10}
              onChange={(val) => handleChange('minStagger', val)}
            />

            <div>
              <label className="block text-[9px] font-bold text-[#A0A0A0] uppercase tracking-[0.2em] mb-2">Antal per förpackning</label>
              <input 
                type="number" 
                min="1"
                value={settings.planksPerPackage === 0 ? '' : settings.planksPerPackage}
                onChange={(e) => handleChange('planksPerPackage', e.target.value)}
                className="w-full bg-[#FBFBFB] border-b border-[#E5E5E5] py-2 text-sm focus:outline-none focus:border-[#D2B7AC] transition text-[#1A1A1A]"
              />
            </div>
          </div>
        </section>

        <section className="pt-8 border-t border-[#F1F1F1]">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A0A0A0] mb-6">Specifikation</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Total Area</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.area.toFixed(2)} m²</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Materialåtgång</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.plankCount} st</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Förpackningar</span>
              <span className="text-lg font-bold text-[#1A1A1A]">{stats.packageCount} st</span>
            </div>
            <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2">
              <span className="text-[11px] text-[#888] font-medium uppercase tracking-wider">Spillprocent</span>
              <span className="text-lg font-bold text-[#D2B7AC]">{stats.wastePercent.toFixed(1)}%</span>
            </div>
            {productInfo && stats.totalPrice && (
              <div className="flex justify-between items-end border-b border-[#F9F9F9] pb-2 pt-4">
                <span className="text-[11px] text-[#1A1A1A] font-bold uppercase tracking-wider">Total Kostnad</span>
                <span className="text-xl font-black text-[#1A1A1A]">{Math.round(stats.totalPrice).toLocaleString()} {productInfo.currency}</span>
              </div>
            )}
          </div>
        </section>

        <button 
          onClick={onReset}
          className="mt-4 w-full py-4 bg-[#1A1A1A] text-white text-[11px] font-bold uppercase tracking-[0.2em] hover:bg-[#333] transition-colors active:scale-[0.98]"
        >
          Nollställ Ritning
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
