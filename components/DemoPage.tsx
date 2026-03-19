import React, { useEffect, useState, Suspense } from 'react';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
const CanvasAdapter = React.lazy(() => import('./CanvasAdapter'));

// Dev-only preview bypass: add ?preview=1 to URL to skip auth in local dev
const isPreview = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('preview') === '1';


export default function DemoPage() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [qty, setQty] = useState(10);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasEverOpened, setCanvasEverOpened] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/demo/produkt-mockup' }
    });
  };

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-[#999] text-[13px]">Laddar…</div>
    </div>
  );

  if (!authUser && !isPreview) return (
    <div className="min-h-screen bg-[#f5f4f3] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-[#e5e5e5] shadow-[0_4px_24px_rgba(0,0,0,0.06)] p-8 max-w-sm w-full text-center">
        <img src="/ref-assets/renoverahuset_logo.png" alt="renoverahuset.se" className="h-9 w-auto mx-auto mb-4 object-contain" />
        <h1 className="text-[15px] font-bold mb-1.5 text-[#1a1a1a]">Demo — ProFloor Golvredigerare</h1>
        <p className="text-[12px] text-[#9a9a9a] mb-6 leading-relaxed">Logga in med ditt Google-konto för att komma åt demo-sidan och använda ritverktyget.</p>
        <button onClick={handleSignIn} disabled={signingIn}
          className="w-full py-2.5 rounded-full bg-[#1a1a1a] text-white text-[13px] font-semibold hover:bg-[#333] transition-colors flex items-center justify-center gap-2">
          {signingIn ? 'Omdirigerar…' : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Logga in med Google
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <header className="bg-white border-b border-[#e8e8e8] sticky top-0 z-50 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
        <div className="max-w-[1500px] mx-auto px-6 h-[56px] flex items-center gap-6">
          <a href="#" aria-label="renoverahuset.se - till startsidan" className="flex-shrink-0">
            <img src="/ref-assets/renoverahuset_logo.png" alt="renoverahuset.se" className="h-[32px] w-auto object-contain" />
          </a>
          <nav className="hidden lg:flex items-center gap-5 text-[12px] font-medium text-[#333]" aria-label="Huvudmeny">
            {['Golv & Vägg', 'Kök & Bad', 'Byggmaterial', 'Trädgård', 'Verktyg'].map(l => (
              <a key={l} href="#" className="hover:text-[#e3000b] transition-colors whitespace-nowrap">{l}</a>
            ))}
          </nav>
          <div className="flex-1 max-w-md">
            <div className="relative">
              <input type="search" placeholder="Sök produkt, varumärke eller kategori..." aria-label="Sök"
                className="w-full h-[36px] pl-4 pr-10 text-[12px] rounded-full border border-[#d5d5d5] bg-[#f8f7f6] outline-none focus:border-[#e3000b] focus:bg-white transition-colors" />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[#bbb]" aria-hidden="true">
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 ml-auto">
            <button className="text-[#555] hover:text-[#e3000b] transition-colors" aria-label="Favoriter">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
            <button className="text-[#555] hover:text-[#e3000b] transition-colors" aria-label="Mitt konto">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </button>
            <button className="relative text-[#555] hover:text-[#e3000b] transition-colors" aria-label="Varukorg, 0 varor">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              <span className="absolute -top-1.5 -right-1.5 bg-[#e3000b] text-white text-[9px] w-[16px] h-[16px] rounded-full flex items-center justify-center font-bold">0</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Promo banner ── */}
      <div className="bg-[#c8001a] text-white py-2.5 px-6">
        <div className="max-w-[1500px] mx-auto flex items-center gap-4">
          <span className="font-black text-[13px] tracking-tight border border-white/50 rounded px-2 py-0.5 uppercase">FRI FRAKT!</span>
          <span className="text-[12px]">Just nu får du <strong>fri frakt</strong> på detta golv! Passa på! Gäller endast till 2026-03-31</span>
        </div>
      </div>

      <main>
        {/* ── Product hero ── */}
        <div className="max-w-[1500px] mx-auto px-6 pt-5 pb-0">

          {/* Breadcrumb */}
          <nav aria-label="Brödsmulor" className="text-[11px] text-[#999] mb-5 flex items-center gap-1 flex-wrap">
            {['Hem', 'Golv & Vägg', 'Golv', 'Trägolv', 'Parkettgolv'].map((c, i, arr) => (
              <React.Fragment key={c}>
                <a href="#" className="hover:text-[#e3000b] transition-colors">{c}</a>
                {i < arr.length - 1 && <span className="text-[#d5d5d5]">/</span>}
              </React.Fragment>
            ))}
            <span className="text-[#d5d5d5]">/</span>
            <span className="text-[#555]">Kährs Lecco</span>
          </nav>

          {/* Two-column product layout: left ~700px (5 cols), right ~800px (7 cols) */}
          <div className="grid grid-cols-12 gap-10">

            {/* ── Left: product images (5 cols ≈ 700px) ── */}
            <div className="col-span-5">
              <div className="rounded-lg overflow-hidden bg-[#f8f6f4] border border-[#eae6e2]">
                <img
                  src="/ref-assets/room-photo.png"
                  alt="Kährs Lecco Ek 3-stav Mattlack parkettgolv — rum med parkett"
                  className="w-full object-cover aspect-[4/3]"
                />
              </div>
              {/* Thumbnails */}
              <div className="flex gap-2 mt-3">
                <button className="w-[80px] h-[60px] rounded-md border-2 border-[#e3000b] overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e3000b]" aria-label="Produktbild 1 — rumsvy (vald)">
                  <img src="/ref-assets/room-photo.png" alt="" className="w-full h-full object-cover" />
                </button>
                <button className="w-[80px] h-[60px] rounded-md border-2 border-[#e5e0db] hover:border-[#e3000b] overflow-hidden transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e3000b]" aria-label="Produktbild 2 — golvstruktur">
                  <img src="/ref-assets/floor-texture.png" alt="" className="w-full h-full object-cover" />
                </button>
                <button className="w-[80px] h-[60px] rounded-md border-2 border-[#e5e0db] hover:border-[#e3000b] overflow-hidden transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e3000b]" aria-label="Produktbild 3 — golvstruktur närbild">
                  <img src="/ref-assets/floor-texture.png" alt="" className="w-full h-full object-cover object-right" />
                </button>
              </div>
            </div>

            {/* ── Right: product info (7 cols ≈ 800px) ── */}
            <div className="col-span-7">

              {/* Brand label */}
              <div className="text-[11px] font-semibold text-[#888] uppercase tracking-widest mb-1.5">Parkettgolv Kährs</div>

              {/* Title */}
              <h1 className="text-[26px] font-bold text-[#1a1a1a] leading-[1.15] mb-4">
                Lecco Ek 3-stav Mattlack Längd 2000 mm
              </h1>

              {/* FRI FRAKT badge */}
              <div className="inline-flex items-center gap-1.5 bg-[#fff0f0] border border-[#ffc0c0] rounded px-2.5 py-1 mb-4">
                <span className="text-[10px] font-black text-[#c8001a] uppercase tracking-wide">FRI FRAKT</span>
              </div>

              {/* Price row */}
              <div className="flex items-end gap-4 mb-1">
                <div>
                  <div className="text-[12px] text-[#aaa] line-through mb-0.5">599 kr/m²</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[36px] font-black text-[#1a1a1a] leading-none">479</span>
                    <span className="text-[18px] font-bold text-[#1a1a1a]">kr/m²</span>
                  </div>
                </div>
                <div className="mb-1 flex flex-col gap-1">
                  <span className="bg-[#c8001a] text-white text-[11px] font-black px-2.5 py-1 rounded-sm uppercase tracking-wide">KAMPANJ</span>
                  <span className="text-[10px] font-semibold text-[#c8001a]">SPARA 20%</span>
                </div>
              </div>
              <div className="text-[11px] text-[#aaa] mb-5">Pris/frp 1 437 kr · Inkl. moms, exkl. frakt</div>

              {/* ── Canvas module — above Lägg i varukorg ── */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                  <span className="text-[12px] font-semibold text-[#1a1a1a]">Beräkna ditt golv</span>
                  <span className="text-[11px] text-[#bbb]">· Rita din yta, se exakt åtgång</span>
                </div>
                <div className="flex justify-center mb-3">
                  <button
                    type="button"
                    onClick={() => { setCanvasEverOpened(true); setCanvasOpen(v => !v); }}
                    className="flex items-center gap-2 px-5 py-2 rounded-full border border-[#d0d0d0] bg-white text-[12px] font-semibold text-[#1a1a1a] hover:bg-[#f5f5f5] hover:border-[#bbb] transition-colors shadow-sm"
                    aria-expanded={canvasOpen}
                  >
                    {canvasOpen ? 'Stäng ritverktyg' : 'Öppna ritverktyg'}
                    <svg
                      width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"
                      className={`transition-transform duration-200 ${canvasOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                {canvasEverOpened && (
                  <Suspense fallback={
                    <div className="h-[520px] bg-[#FCFBFA] rounded-xl border border-[#EAE6E3] flex items-center justify-center text-[#bbb] text-[12px]">Laddar ritverktyg…</div>
                  }>
                    <div style={{ display: canvasOpen ? 'block' : 'none' }}>
                      <CanvasAdapter
                        isAuthed={!!(authUser || isPreview)}
                        onRequestSignIn={handleSignIn}
                        containerHeight={520}
                        pricePerM2={479}
                        onAddToCart={(area) => setQty(Math.max(1, Math.ceil(area)))}
                      />
                    </div>
                  </Suspense>
                )}
              </div>

              {/* Qty + Lägg i varukorg — below canvas */}
              <div className="space-y-2 mb-5">
                <div className="flex items-center gap-3">
                  <label className="text-[12px] text-[#777] whitespace-nowrap">Antal m²:</label>
                  <div className="flex items-center rounded-full border border-[#d0d0d0] overflow-hidden h-[40px]">
                    <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-10 h-full flex items-center justify-center text-[#555] hover:bg-[#f5f5f5] text-[18px] leading-none transition-colors" aria-label="Minska antal">−</button>
                    <input type="number" value={qty} min="1" onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="w-14 h-full text-center text-[14px] font-semibold border-x border-[#d0d0d0] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" aria-label="Antal kvadratmeter" />
                    <button onClick={() => setQty(q => q + 1)} className="w-10 h-full flex items-center justify-center text-[#555] hover:bg-[#f5f5f5] text-[18px] leading-none transition-colors" aria-label="Öka antal">+</button>
                  </div>
                  <span className="text-[12px] text-[#aaa]">= {(qty * 479).toLocaleString('sv-SE')} kr</span>
                </div>
                <button className="w-full h-[46px] rounded-full bg-[#3D8B37] text-white font-bold text-[14px] hover:bg-[#347a30] active:scale-[0.99] transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3D8B37]">
                  Lägg i varukorg
                </button>
              </div>

              {/* Kährs brand strip */}
              <div className="flex items-center justify-between border-t border-b border-[#f0ede9] py-3 mb-5">
                <span className="text-[11px] text-[#aaa]">Tillverkare</span>
                <div className="text-[18px] font-black italic text-[#8B6914] tracking-tight">Kährs</div>
              </div>

              {/* Specs table */}
              <div>
                <div className="text-[11px] font-semibold text-[#888] uppercase tracking-widest mb-3">Specifikationer</div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
                  {[
                    ['Ytbehandling', 'Mattlack'],
                    ['Träslag', 'Ek'],
                    ['Längd', '2000 mm'],
                    ['Bredd', '190 mm'],
                    ['Tjocklek', '15 mm'],
                    ['Garanti', '25 år'],
                    ['m²/förpackning', '2,28 m²'],
                    ['Klass', 'AC4'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-[#f5f2ee] pb-2">
                      <dt className="text-[#aaa]">{k}</dt>
                      <dd className="font-semibold text-[#333]">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>

            </div>
          </div>
        </div>

        {/* ── Beskrivning + Egenskaper ── */}
        <div className="max-w-[1500px] mx-auto px-6 py-10">
          <div className="grid grid-cols-12 gap-10">
            <div className="col-span-7">
              <h2 className="text-[19px] font-bold mb-4 text-[#1a1a1a]">Beskrivning</h2>
              <div className="text-[13px] text-[#555] leading-[1.9] space-y-3">
                <p>Kährs Lecco är ett klassiskt parkettgolv med ek 3-stavs design och en silkesmatt lackytybehandling som ger ett naturligt och tidlöst uttryck. Golvet är 15 mm tjockt och passar utmärkt i vardagsrum, sovrum och korridorer.</p>
                <p>Golvet är utrustat med Woodloc® 5S-fogsystem som möjliggör snabb och enkel installation. Det är godkänt för golvvärme och levereras som flytgolv.</p>
                <p>Produkten uppfyller kraven för Svanen-märkning och är tillverkad av FSC-certifierat virke.</p>
              </div>
            </div>
            <div className="col-span-5">
              <h3 className="text-[19px] font-bold mb-4 text-[#1a1a1a]">Egenskaper</h3>
              <table className="w-full text-[13px]" aria-label="Produktegenskaper">
                <tbody>
                  {[
                    ['Träslag', 'Ek'],
                    ['Ytbehandling', 'Mattlack'],
                    ['Längd', '2000 mm'],
                    ['Bredd', '190 mm'],
                    ['Tjocklek', '15 mm'],
                    ['St/förpackning', '6 st'],
                    ['m²/förpackning', '2,28 m²'],
                    ['Lämplig för golvvärme', 'Ja'],
                    ['Monteringssätt', 'Flytande'],
                    ['Klass', 'AC4'],
                    ['Svanen-märkt', 'Ja'],
                    ['Garanti', '25 år'],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-b border-[#f0ede9]">
                      <td className="py-2 pr-4 text-[#aaa] w-1/2">{k}</td>
                      <td className="py-2 font-semibold text-[#333]">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Related products ── */}
        <div className="bg-[#f8f6f4] border-t border-[#ede9e4] py-10 px-6">
          <div className="max-w-[1500px] mx-auto">
            <h2 className="text-[19px] font-bold mb-6 text-[#1a1a1a]">Andra produkter i serien Lecco från Kährs</h2>
            <div className="grid grid-cols-4 gap-5">
              {[
                { name: 'Lecco Ek Naturlack Längd 2000 mm', price: '459', img: '/ref-assets/floor-texture.png' },
                { name: 'Lecco Ask 3-stav Mattlack Längd 2000 mm', price: '489', img: '/ref-assets/room-photo.png' },
                { name: 'Lecco Ek Vit Olje Längd 2000 mm', price: '499', img: '/ref-assets/floor-texture.png' },
                { name: 'Lecco Bok Mattlack Längd 2000 mm', price: '449', img: '/ref-assets/room-photo.png' },
              ].map(p => (
                <article key={p.name} className="bg-white rounded-xl border border-[#ede9e5] overflow-hidden hover:shadow-[0_4px_20px_rgba(0,0,0,0.10)] transition-shadow cursor-pointer group">
                  <div className="h-[140px] overflow-hidden">
                    <img src={p.img} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] font-semibold text-[#aaa] uppercase tracking-widest mb-1">Kährs</div>
                    <div className="text-[12px] font-semibold text-[#1a1a1a] leading-snug mb-2">{p.name}</div>
                    <div className="text-[16px] font-black text-[#1a1a1a]">{p.price} <span className="text-[11px] font-normal text-[#aaa]">kr/m²</span></div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
