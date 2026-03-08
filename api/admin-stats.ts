import { createClient } from '@supabase/supabase-js';

interface ApiRequest {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status: (code: number) => { json: (data: unknown) => void };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object';

// ISO week number
function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader =
    typeof req.headers?.authorization === 'string'
      ? req.headers.authorization
      : undefined;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase credentials' });
  }

  if (!adminEmail) {
    return res.status(500).json({ error: 'Server misconfigured: ADMIN_EMAIL not set' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify token
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Admin gate
  if (user.email !== adminEmail) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    // ── Fetch all data in parallel ────────────────────────────────────────────
    const [authUsersResult, savedFloorsResult, sharedFloorsResult, eventsResult] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
      supabaseAdmin.from('saved_floors').select('id, user_id, created_at, data'),
      supabaseAdmin.from('shared_floors').select('id, created_by, created_at'),
      supabaseAdmin.from('app_events').select('event_type, user_id, session_id, value, created_at'),
    ]);

    if (authUsersResult.error) throw authUsersResult.error;
    if (savedFloorsResult.error) throw savedFloorsResult.error;
    if (sharedFloorsResult.error) throw sharedFloorsResult.error;
    // app_events degrades gracefully if table not yet created
    const events = eventsResult.error ? [] : (eventsResult.data ?? []);

    const authUsers = authUsersResult.data.users ?? [];
    const savedFloors = savedFloorsResult.data ?? [];
    const sharedFloors = sharedFloorsResult.data ?? [];

    // ── Aggregate saved floors per user ───────────────────────────────────────
    const savedFloorsByUser: Record<string, number> = {};
    const lastSaveByUser: Record<string, string> = {};

    for (const floor of savedFloors) {
      if (floor.user_id) {
        savedFloorsByUser[floor.user_id] = (savedFloorsByUser[floor.user_id] ?? 0) + 1;
        const ts = floor.created_at;
        if (!lastSaveByUser[floor.user_id] || ts > lastSaveByUser[floor.user_id]) {
          lastSaveByUser[floor.user_id] = ts;
        }
      }
    }

    // ── Extract product & floor stats from saved floors ───────────────────────
    const productUrlCounts: Record<string, number> = {};
    let totalAreaMm2 = 0;
    let floorsWithArea = 0;
    let totalWastePercent = 0;
    let floorsWithWaste = 0;
    let totalProductCount = 0;
    let floorsWithProducts = 0;
    let totalPointCount = 0;

    for (const floor of savedFloors) {
      const data = isRecord(floor.data) ? floor.data : null;
      if (!data) continue;

      // Points
      const points = Array.isArray(data.points) ? data.points : [];
      totalPointCount += points.length;

      // Products
      const products = Array.isArray(data.products) ? data.products : [];
      totalProductCount += products.length;
      if (products.length > 0) floorsWithProducts++;

      for (const p of products) {
        if (isRecord(p) && typeof p.url === 'string' && p.url) {
          try {
            const hostname = new URL(p.url).hostname.replace(/^www\./, '');
            productUrlCounts[hostname] = (productUrlCounts[hostname] ?? 0) + 1;
          } catch { /* invalid URL */ }
        }
      }

      // Summary
      if (isRecord(data.summary)) {
        // areaMm2 field is actually stored in m² (Stats.area is m²)
        if (typeof data.summary.areaMm2 === 'number' && data.summary.areaMm2 > 0) {
          totalAreaMm2 += data.summary.areaMm2;
          floorsWithArea++;
        }
        if (typeof data.summary.wastePercent === 'number' && data.summary.wastePercent >= 0) {
          totalWastePercent += data.summary.wastePercent;
          floorsWithWaste++;
        }
      }
    }

    // ── Event aggregations ────────────────────────────────────────────────────
    const loginCountByUser: Record<string, number> = {};
    for (const e of events) {
      if (e.event_type === 'login' && e.user_id) {
        loginCountByUser[e.user_id] = (loginCountByUser[e.user_id] ?? 0) + 1;
      }
      // Merge product_fetched events into productUrlCounts (catches anonymous + unsaved fetches)
      if (e.event_type === 'product_fetched' && typeof e.value === 'string' && e.value) {
        productUrlCounts[e.value] = (productUrlCounts[e.value] ?? 0) + 1;
      }
    }

    // Build topStores AFTER merging events so all fetches (incl. anonymous) are included
    const topStores = Object.entries(productUrlCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([store, count]) => ({ store, count }));

    const totalBackgroundUploads = events.filter((e) => e.event_type === 'background_uploaded').length;
    const totalPlanCancellations = events.filter((e) => e.event_type === 'plan_cancelled').length;
    const anonymousFloorSessions = new Set(
      events
        .filter((e) => e.event_type === 'floor_designed_anonymous' && e.session_id)
        .map((e) => e.session_id)
    ).size;

    // ── Build user list ───────────────────────────────────────────────────────
    const users = authUsers
      .map((u) => {
        const lastSignIn = u.last_sign_in_at ?? null;
        const lastSave = lastSaveByUser[u.id] ?? null;
        const lastActivity = [lastSignIn ?? '', lastSave ?? ''].sort().at(-1) || null;
        return {
          id: u.id,
          email: u.email ?? '—',
          createdAt: u.created_at,
          lastSignIn,
          lastSave,
          lastActivity,
          savedFloorCount: savedFloorsByUser[u.id] ?? 0,
          loginCount: loginCountByUser[u.id] ?? 0,
        };
      })
      .sort((a, b) => b.savedFloorCount - a.savedFloorCount || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // ── Shared floors breakdown ───────────────────────────────────────────────
    const sharedByLoggedIn = sharedFloors.filter((f) => f.created_by).length;
    const sharedByAnonymous = sharedFloors.filter((f) => !f.created_by).length;

    // Recent 20 shared floors
    const recentShares = sharedFloors
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20)
      .map((f) => ({
        id: f.id,
        createdAt: f.created_at,
        createdBy: f.created_by ?? null,
        userEmail: authUsers.find((u) => u.id === f.created_by)?.email ?? null,
      }));

    // ── Derived averages ──────────────────────────────────────────────────────
    const avgAreaM2 =
      floorsWithArea > 0 ? (totalAreaMm2 / floorsWithArea).toFixed(2) : null;
    const avgWastePercent =
      floorsWithWaste > 0 ? (totalWastePercent / floorsWithWaste).toFixed(1) : null;
    const avgProductsPerFloor =
      savedFloors.length > 0 ? (totalProductCount / savedFloors.length).toFixed(1) : null;
    const avgPointsPerFloor =
      savedFloors.length > 0 ? (totalPointCount / savedFloors.length).toFixed(1) : null;
    const floorsWithProductPercent =
      savedFloors.length > 0 ? Math.round((floorsWithProducts / savedFloors.length) * 100) : 0;

    // ── Weekly time series (last 12 weeks) ────────────────────────────────────
    const now = Date.now();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const NUM_WEEKS = 12;

    const weeklyUsers: number[] = new Array(NUM_WEEKS).fill(0);
    const weeklyFloors: number[] = new Array(NUM_WEEKS).fill(0);

    for (const u of authUsers) {
      const age = now - new Date(u.created_at).getTime();
      const weekIdx = Math.floor(age / WEEK_MS);
      if (weekIdx >= 0 && weekIdx < NUM_WEEKS) {
        weeklyUsers[NUM_WEEKS - 1 - weekIdx]++;
      }
    }
    for (const f of savedFloors) {
      const age = now - new Date(f.created_at).getTime();
      const weekIdx = Math.floor(age / WEEK_MS);
      if (weekIdx >= 0 && weekIdx < NUM_WEEKS) {
        weeklyFloors[NUM_WEEKS - 1 - weekIdx]++;
      }
    }

    const weekLabels = Array.from({ length: NUM_WEEKS }, (_, i) => {
      const d = new Date(now - (NUM_WEEKS - 1 - i) * WEEK_MS);
      return `v.${getISOWeek(d)}`;
    });

    return res.status(200).json({
      users,
      stats: {
        totalUsers: users.length,
        totalSavedFloors: savedFloors.length,
        totalSharedFloors: sharedFloors.length,
        sharedByLoggedIn,
        sharedByAnonymous,
        avgFloorAreaM2: avgAreaM2,
        avgWastePercent,
        avgProductsPerFloor,
        floorsWithProductPercent,
        avgPointsPerFloor,
        activeUsersLast30Days: users.filter(
          (u) => u.lastSignIn && Date.now() - new Date(u.lastSignIn).getTime() < 30 * 24 * 60 * 60 * 1000
        ).length,
        totalBackgroundUploads,
        totalPlanCancellations,
        anonymousFloorSessions,
      },
      topStores,
      recentShares,
      timeSeries: { labels: weekLabels, users: weeklyUsers, floors: weeklyFloors },
    });
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : (isRecord(err) && typeof err.message === 'string' ? err.message : JSON.stringify(err));
    console.error('admin-stats error:', msg);
    return res.status(500).json({ error: msg });
  }
}
