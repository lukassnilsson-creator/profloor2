import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

interface UserRow {
  id: string;
  email: string;
  createdAt: string;
  lastSignIn: string | null;
  lastSave: string | null;
  savedFloorCount: number;
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

interface Stats {
  totalUsers: number;
  totalSavedFloors: number;
  totalSharedFloors: number;
  sharedByLoggedIn: number;
  sharedByAnonymous: number;
  avgFloorAreaM2: string | null;
  activeUsersLast30Days: number;
}

interface AdminData {
  users: UserRow[];
  stats: Stats;
  topStores: StoreEntry[];
  recentShares: ShareEntry[];
}

const fmt = (iso: string | null) => {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
};

const StatCard = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
  <div className="bg-white rounded-xl border border-[#e5e5e5] px-5 py-4">
    <p className="text-[10px] font-medium text-[#9a9a9a] uppercase tracking-wide mb-1">{label}</p>
    <p className="text-[26px] font-bold text-[#1a1a1a] leading-none">{value}</p>
    {sub && <p className="text-[9px] text-[#9a9a9a] mt-1">{sub}</p>}
  </div>
);

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

  const { stats, users, topStores, recentShares } = data;

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

        {/* Stat cards */}
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
            {stats.avgFloorAreaM2 && (
              <StatCard label="Snitt golvarea" value={`${stats.avgFloorAreaM2} m²`} />
            )}
          </div>
        </section>

        {/* Users table */}
        <section>
          <h2 className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wide mb-3">
            Användare ({users.length})
          </h2>
          <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#f0f0f0]">
                  {['E-post', 'Registrerad', 'Senaste inloggning', 'Senaste sparning', 'Sparade golv'].map((h) => (
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
                    <td className="px-4 py-2.5 text-[10px] text-[#767676]">{fmt(u.lastSignIn)}</td>
                    <td className="px-4 py-2.5 text-[10px] text-[#767676]">{fmt(u.lastSave)}</td>
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
          * Antal inloggningar per användare spåras inte ännu — bara senaste inloggningstidpunkt visas.
          Lägg till ett login-event i Supabase för att aktivera den statistiken.
        </p>
      </main>
    </div>
  );
}
