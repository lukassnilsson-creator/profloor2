import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

interface UserRow {
  id: string;
  email: string;
  createdAt: string;
  lastSignIn: string | null;
  lastSave: string | null;
  lastActivity: string | null;
  savedFloorCount: number;
  loginCount: number;
}

interface StoreEntry {
  store: string;
  count: number;
}

interface ShareEntry {
  id: string;
  createdAt: string;
  createdBy: string | null;
  userEmail: string | null;
}

interface TimeSeries {
  labels: string[];
  users: number[];
  floors: number[];
}

interface Stats {
  totalUsers: number;
  totalSavedFloors: number;
  totalSharedFloors: number;
  sharedByLoggedIn: number;
  sharedByAnonymous: number;
  avgFloorAreaM2: string | null;
  avgWastePercent: string | null;
  avgProductsPerFloor: string | null;
  floorsWithProductPercent: number;
  avgPointsPerFloor: string | null;
  activeUsersLast30Days: number;
  totalBackgroundUploads: number;
  totalPlanCancellations: number;
  anonymousFloorSessions: number;
  demoToolOpenedLoggedIn: number;
  demoToolOpenedAnonymous: number;
  demoFloorDesignedLoggedIn: number;
  demoFloorDesignedAnonymous: number;
}

interface AdminData {
  users: UserRow[];
  stats: Stats;
  topStores: StoreEntry[];
  recentShares: ShareEntry[];
  timeSeries: TimeSeries;
}

const fmt = (iso: string | null) => {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const StatCard = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
  <div className="bg-white rounded-xl border border-[#e5e5e5] px-5 py-4">
    <p className="text-[10px] font-medium text-[#9a9a9a] uppercase tracking-wide mb-1">{label}</p>
    <p className="text-[26px] font-bold text-[#1a1a1a] leading-none">{value}</p>
    {sub && <p className="text-[9px] text-[#9a9a9a] mt-1">{sub}</p>}
  </div>
);

// Simple SVG line chart
const LineChart = ({ labels, series }: {
  labels: string[];
  series: { label: string; values: number[]; color: string }[];
}) => {
  const W = 600;
  const H = 120;
  const PAD = { top: 10, right: 16, bottom: 28, left: 28 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const allValues = series.flatMap((s) => s.values);
  const maxVal = Math.max(...allValues, 1);

  const toX = (i: number) => PAD.left + (i / Math.max(labels.length - 1, 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - (v / maxVal) * chartH;

  const makePath = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  const gridLines = [0, 0.5, 1].map((f) => Math.round(maxVal * f));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {gridLines.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left} y1={toY(v).toFixed(1)}
            x2={W - PAD.right} y2={toY(v).toFixed(1)}
            stroke="#f0f0f0" strokeWidth="1"
          />
          <text x={PAD.left - 4} y={toY(v)} dy="0.35em" textAnchor="end" fontSize="7" fill="#c0c0c0">{v}</text>
        </g>
      ))}
      {series.map((s) => (
        <path key={s.label} d={makePath(s.values)} fill="none" stroke={s.color} strokeWidth="1.5" strokeLinejoin="round" />
      ))}
      {series.map((s) =>
        s.values.map((v, i) => (
          <circle key={`${s.label}-${i}`} cx={toX(i)} cy={toY(v)} r="2.5" fill={s.color} />
        ))
      )}
      {labels.map((l, i) =>
        i % 2 === 0 ? (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="7" fill="#b0b0b0">{l}</text>
        ) : null
      )}
    </svg>
  );
};

export default function AdminPage() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      if (session?.access_token) {
        fetchStats(session.access_token);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      if (session?.access_token) {
        fetchStats(session.access_token);
      } else {
        setLoading(false);
        setData(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchStats = async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin-stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        setError('Åtkomst nekad. Kontrollera att ADMIN_EMAIL matchar ditt Google-konto.');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/adminsida' },
    });
  };

  const handleSignOut = () => {
    supabase.auth.signOut();
  };

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!authUser && !loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-[#e5e5e5] p-10 text-center max-w-sm w-full">
          <div className="w-10 h-10 rounded-full bg-[#C41230] mx-auto mb-5 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
          <h1 className="text-[16px] font-semibold text-[#1a1a1a] mb-1">ProFloor Admin</h1>
          <p className="text-[11px] text-[#9a9a9a] mb-6">Logga in med ditt Google-konto för att fortsätta.</p>
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full py-2.5 rounded-full bg-[#1a1a1a] text-white text-[11px] font-semibold hover:bg-[#333] transition-colors disabled:opacity-50"
          >
            {signingIn ? 'Omdirigerar…' : 'Logga in med Google'}
          </button>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center">
        <p className="text-[12px] text-[#9a9a9a]">Hämtar statistik…</p>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-[#e5e5e5] p-8 max-w-sm w-full text-center">
          <p className="text-[12px] font-semibold text-[#C41230] mb-2">Fel</p>
          <p className="text-[11px] text-[#767676] mb-5">{error}</p>
          <button onClick={handleSignOut} className="text-[10px] text-[#9a9a9a] underline">Logga ut</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { stats, users, topStores, recentShares, timeSeries } = data;

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-white border-b border-[#e5e5e5] px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-[#1a1a1a]">ProFloor Admin</span>
          <span className="text-[9px] bg-[#f0f0f0] text-[#767676] px-2 py-0.5 rounded-full font-medium">Internt</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[#767676]">{authUser?.email}</span>
          <button
            onClick={handleSignOut}
            className="text-[10px] text-[#9a9a9a] hover:text-[#1a1a1a] transition-colors"
          >
            Logga ut
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8 space-y-8">

        {/* Stat cards — row 1: users & traffic */}
        <section>
          <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">Översikt</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Användare" value={stats.totalUsers} sub={`${stats.activeUsersLast30Days} aktiva senaste 30 d`} />
            <StatCard label="Sparade golv" value={stats.totalSavedFloors} />
            <StatCard
              label="Delade golv"
              value={stats.totalSharedFloors}
              sub={`${stats.sharedByLoggedIn} inloggade · ${stats.sharedByAnonymous} anonyma`}
            />
            <StatCard
              label="Anonyma designers"
              value={stats.anonymousFloorSessions}
              sub="unika sessioner med golvdesign"
            />
          </div>
        </section>

        {/* Stat cards — row 2: floor quality */}
        <section>
          <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">Golvkvalitet</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stats.avgFloorAreaM2 && (
              <StatCard label="Snitt golvarea" value={`${stats.avgFloorAreaM2} m²`} />
            )}
            {stats.avgWastePercent && (
              <StatCard label="Snitt spillprocent" value={`${stats.avgWastePercent}%`} />
            )}
            {stats.avgProductsPerFloor && (
              <StatCard
                label="Snitt produkter/golv"
                value={stats.avgProductsPerFloor}
                sub={`${stats.floorsWithProductPercent}% av golv har produkt`}
              />
            )}
            {stats.avgPointsPerFloor && (
              <StatCard label="Snitt punkter/golv" value={stats.avgPointsPerFloor} sub="polygonkomplexitet" />
            )}
          </div>
        </section>

        {/* Stat cards — row 3: ritnings-AI */}
        <section>
          <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">Ritnings-AI</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Bakgrundsritningar" value={stats.totalBackgroundUploads} sub="uppladdade totalt" />
            <StatCard
              label="Avbrutna tolkningar"
              value={stats.totalPlanCancellations}
              sub={
                stats.totalBackgroundUploads > 0
                  ? `${Math.round((stats.totalPlanCancellations / stats.totalBackgroundUploads) * 100)}% avbrottsgrad`
                  : undefined
              }
            />
          </div>
        </section>

        {/* Demo mockup analytics */}
        <section>
          <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">Demo — Produktmockup</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Öppnat ritverktyget"
              value={stats.demoToolOpenedLoggedIn + stats.demoToolOpenedAnonymous}
              sub={`${stats.demoToolOpenedLoggedIn} inloggade · ${stats.demoToolOpenedAnonymous} anonyma`}
            />
            <StatCard
              label="Designat ett golv"
              value={stats.demoFloorDesignedLoggedIn + stats.demoFloorDesignedAnonymous}
              sub={`${stats.demoFloorDesignedLoggedIn} inloggade · ${stats.demoFloorDesignedAnonymous} anonyma`}
            />
            <StatCard
              label="Konverteringsgrad"
              value={
                stats.demoToolOpenedLoggedIn + stats.demoToolOpenedAnonymous > 0
                  ? `${Math.round(
                      ((stats.demoFloorDesignedLoggedIn + stats.demoFloorDesignedAnonymous) /
                        (stats.demoToolOpenedLoggedIn + stats.demoToolOpenedAnonymous)) *
                        100
                    )}%`
                  : '–'
              }
              sub="öppnat → designat"
            />
          </div>
        </section>

        {/* Time series chart */}
        {timeSeries && (
          <section>
            <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">Tillväxt (senaste 12 veckor)</h2>
            <div className="bg-white rounded-xl border border-[#e5e5e5] px-5 pt-4 pb-3">
              <div className="flex items-center gap-5 mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 rounded bg-[#C41230] inline-block" />
                  <span className="text-[9px] text-[#767676]">Nya användare</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 rounded bg-[#1a1a1a] inline-block" />
                  <span className="text-[9px] text-[#767676]">Sparade golv</span>
                </div>
              </div>
              <LineChart
                labels={timeSeries.labels}
                series={[
                  { label: 'Användare', values: timeSeries.users, color: '#C41230' },
                  { label: 'Golv', values: timeSeries.floors, color: '#1a1a1a' },
                ]}
              />
            </div>
          </section>
        )}

        {/* Users table */}
        <section>
          <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">
            Användare ({users.length})
          </h2>
          <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#f0f0f0]">
                  {['E-post', 'Registrerad', 'Senaste aktivitet', 'Inloggningar', 'Sparade golv'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-[9px] font-semibold text-[#9a9a9a] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.id} className={`border-b border-[#f5f5f5] ${i % 2 === 0 ? '' : 'bg-[#fafafa]'}`}>
                    <td className="px-4 py-2.5 text-[10px] font-medium text-[#1a1a1a]">{u.email}</td>
                    <td className="px-4 py-2.5 text-[10px] text-[#767676]">{fmt(u.createdAt)}</td>
                    <td className="px-4 py-2.5 text-[10px] text-[#767676]">{fmtDateTime(u.lastActivity)}</td>
                    <td className="px-4 py-2.5 text-[10px]">
                      <span className={`font-semibold ${u.loginCount > 0 ? 'text-[#1a1a1a]' : 'text-[#9a9a9a]'}`}>
                        {u.loginCount > 0 ? u.loginCount : '–'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[10px]">
                      <span className={`font-semibold ${u.savedFloorCount > 0 ? 'text-[#1a1a1a]' : 'text-[#9a9a9a]'}`}>
                        {u.savedFloorCount}
                      </span>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[10px] text-[#9a9a9a]">
                      Inga användare ännu
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Bottom two columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

          {/* Top stores */}
          {topStores.length > 0 && (
            <section>
              <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">
                Mest använda butiker
              </h2>
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                {topStores.map((s, i) => (
                  <div key={s.store} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? 'border-t border-[#f5f5f5]' : ''}`}>
                    <span className="text-[10px] text-[#1a1a1a]">{s.store}</span>
                    <span className="text-[10px] font-semibold text-[#767676]">{s.count} st</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent shares */}
          {recentShares.length > 0 && (
            <section>
              <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">
                Senaste delningar
              </h2>
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                {recentShares.map((s, i) => (
                  <div key={s.id} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? 'border-t border-[#f5f5f5]' : ''}`}>
                    <div>
                      <p className="text-[10px] text-[#1a1a1a]">{s.userEmail ?? 'Anonym'}</p>
                      <p className="text-[9px] text-[#9a9a9a]">{fmt(s.createdAt)}</p>
                    </div>
                    {!s.createdBy && (
                      <span className="text-[8px] bg-[#f5f5f5] text-[#9a9a9a] px-2 py-0.5 rounded-full">Anonym</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <p className="text-[9px] text-[#c0c0c0] text-center pb-4">
          * Inloggningsräknaren börjar från när spårningen aktiverades — historiska inloggningar syns inte.
        </p>
      </main>
    </div>
  );
}
