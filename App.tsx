
import React, { useState, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import ImportWizard from './components/ImportWizard';
import { Point, PlankSettings, Stats, ProductInfo } from './types';
import { calculateLayout } from './flooringEngine';
import { getPolygonArea, getBoundingBox } from './geometry';

const INITIAL_SETTINGS: PlankSettings = {
  length: 2000,
  width: 190,
  minEndPiece: 300,
  minStagger: 500,
  gap: 5, // Default 5mm expansion gap
  startOffset: 0,
  planksPerPackage: 6,
  visualContrast: 0.6,
  originPointIdx: 0
};

const App: React.FC = () => {
  const [points, setPoints] = useState<Point[]>([]);
  const [settings, setSettings] = useState<PlankSettings>(INITIAL_SETTINGS);
  const [scale, setScale] = useState(0.08); // mm to px
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showEdgeLengths, setShowEdgeLengths] = useState(true);
  const [gridSize, setGridSize] = useState(100);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [productInfo, setProductInfo] = useState<ProductInfo | null>(null);

  const { planks, wastePieces, totalPlanksOpened } = useMemo(() => {
    if (points.length < 3) return { planks: [], wastePieces: [], totalPlanksOpened: 0 };
    return calculateLayout(points, settings);
  }, [points, settings]);

  const stats = useMemo<Stats>(() => {
    if (points.length < 3) return { area: 0, plankCount: 0, packageCount: 0, wasteArea: 0, wastePercent: 0 };
    
    const areaMm2 = getPolygonArea(points);
    const areaM2 = areaMm2 / 1000000;
    
    const singlePlankAreaM2 = (settings.length * settings.width) / 1000000;
    const materialConsumedM2 = totalPlanksOpened * singlePlankAreaM2;
    
    const wasteArea = Math.max(0, materialConsumedM2 - areaM2);
    const wastePercent = materialConsumedM2 > 0 ? (wasteArea / materialConsumedM2) * 100 : 0;
    const packageCount = Math.ceil(totalPlanksOpened / settings.planksPerPackage);

    let totalPrice = undefined;
    if (productInfo) {
      totalPrice = packageCount * productInfo.pricePerPackage;
    }

    return {
      area: areaM2,
      plankCount: totalPlanksOpened,
      packageCount,
      wasteArea,
      wastePercent,
      totalPrice
    };
  }, [points, totalPlanksOpened, settings, productInfo]);

  const handleReset = () => {
    setPoints([]);
    setOffset({ x: 0, y: 0 });
    setScale(0.08);
    setSettings({...settings, originPointIdx: 0});
    setProductInfo(null);
  };

  const handleImportComplete = (newPoints: Point[]) => {
    setPoints(newPoints);
    setIsImporting(false);
    // Auto zoom extents after import
    setTimeout(handleZoomExtents, 100);
  };

  const handleZoomExtents = () => {
    if (points.length === 0) {
      setOffset({ x: 0, y: 0 });
      setScale(0.08);
      return;
    }

    const { minX, minY, maxX, maxY } = getBoundingBox(points);
    const roomW = maxX - minX;
    const roomH = maxY - minY;
    
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    
    const padding = 120; // pixels
    const availableW = canvas.clientWidth - padding;
    const availableH = canvas.clientHeight - padding;
    
    const scaleW = availableW / (roomW || 1);
    const scaleH = availableH / (roomH || 1);
    const newScale = Math.min(scaleW, scaleH, 0.4); 

    setScale(newScale);
    
    const roomCenterX = (minX + maxX) / 2;
    const roomCenterY = (minY + maxY) / 2;
    
    setOffset({
      x: -(roomCenterX * newScale),
      y: -(roomCenterY * newScale)
    });
  };

  return (
    <div className="w-full h-screen bg-[#F0F0F0] flex items-center justify-center">
      <div className="flex h-screen w-full max-w-[1200px] bg-white text-[#1A1A1A] overflow-hidden shadow-[0_30px_100px_rgba(0,0,0,0.1)] relative">
        <Sidebar 
          settings={settings} 
          setSettings={setSettings} 
          stats={stats} 
          onReset={handleReset} 
          onStartImport={() => setIsImporting(true)}
          productInfo={productInfo}
          setProductInfo={setProductInfo}
        />
        
        <main className="flex-1 relative flex flex-col bg-[#F9F9F9]">
          <header className="h-20 bg-white border-b border-[#F1F1F1] flex items-center justify-between px-8 z-10">
            <div className="flex items-center gap-6">
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold flex items-center gap-3">
                <span className="text-[#A0A0A0]">Status</span>
                <span className={`w-1.5 h-1.5 rounded-full ${points.length >= 3 ? "bg-[#1A1A1A]" : "bg-[#DDD]"}`}></span>
                <span className={points.length >= 3 ? "text-[#1A1A1A]" : "text-[#A0A0A0]"}>
                  {points.length < 3 ? "Rita Projekt" : "Layout Klar"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4">
               {/* Grid & Snap Controls */}
               <div className="flex items-center gap-3 bg-[#FBFBFB] border border-[#F1F1F1] px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-bold text-[#A0A0A0] uppercase tracking-widest">Grid</span>
                    <input 
                      type="number" 
                      value={gridSize}
                      onChange={(e) => setGridSize(Math.max(10, parseInt(e.target.value) || 10))}
                      className="w-10 h-6 bg-white border border-[#E5E5E5] text-[9px] font-bold text-center focus:outline-none focus:border-[#D2B7AC]"
                    />
                    <span className="text-[8px] font-bold text-[#A0A0A0]">mm</span>
                  </div>
                  <div className="w-px h-3 bg-[#E5E5E5]"></div>
                  <button 
                    onClick={() => setSnapToGrid(!snapToGrid)}
                    className={`flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest transition-colors ${snapToGrid ? 'text-[#1A1A1A]' : 'text-[#A0A0A0]'}`}
                  >
                    <div className={`w-2.5 h-2.5 border ${snapToGrid ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-[#E5E5E5]'}`}></div>
                    Snap
                  </button>
               </div>

               <button 
                 onClick={() => setShowEdgeLengths(!showEdgeLengths)} 
                 className={`text-[9px] uppercase tracking-widest font-bold transition-colors ${showEdgeLengths ? 'text-[#1A1A1A]' : 'text-[#A0A0A0]'}`}
               >
                 {showEdgeLengths ? 'Dölj Mått' : 'Visa Mått'}
               </button>
               
               <div className="w-px h-6 bg-[#F1F1F1]"></div>
               
               <div className="flex items-center gap-3">
                 <button onClick={() => setScale(s => Math.min(0.5, s + 0.01))} className="text-[#A0A0A0] hover:text-[#1A1A1A] transition-colors" title="Zooma in">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                 </button>
                 <button onClick={() => setScale(s => Math.max(0.01, s - 0.01))} className="text-[#A0A0A0] hover:text-[#1A1A1A] transition-colors" title="Zooma ut">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M20 12H4"/></svg>
                 </button>
                 <button 
                   onClick={handleZoomExtents} 
                   className="text-[#A0A0A0] hover:text-[#1A1A1A] transition-colors"
                   title="Zooma till extents"
                 >
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
                 </button>
                 <div className="text-[9px] font-bold text-[#1A1A1A] tracking-widest bg-[#F9F9F9] px-2 py-1 border border-[#E5E5E5] min-w-[45px] text-center">
                   {Math.round(scale * 1000)}%
                 </div>
               </div>
            </div>
          </header>

          <Canvas 
            points={points} 
            setPoints={setPoints} 
            settings={settings} 
            setSettings={setSettings}
            planks={planks} 
            wastePieces={wastePieces} 
            scale={scale} 
            offset={offset} 
            setOffset={setOffset} 
            showEdgeLengths={showEdgeLengths}
            gridSize={gridSize}
            snapToGrid={snapToGrid}
          />
        </main>

        {isImporting && (
          <ImportWizard 
            onComplete={handleImportComplete} 
            onCancel={() => setIsImporting(false)} 
          />
        )}
      </div>
    </div>
  );
};

export default App;
