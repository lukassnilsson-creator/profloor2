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
    const [authUsersResult, savedFloorsResult, sharedFloorsResult] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
      supabaseAdmin.from('saved_floors').select('id, user_id, created_at, floor_data'),
      supabaseAdmin.from('shared_floors').select('id, created_by, created_at'),
    ]);

    if (authUsersResult.error) throw authUsersResult.error;
    if (savedFloorsResult.error) throw savedFloorsResult.error;
    if (sharedFloorsResult.error) throw sharedFloorsResult.error;

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

    // ── Extract product stats from saved floors ───────────────────────────────
    const productUrlCounts: Record<string, number> = {};
    let totalAreaMm2 = 0;
    let floorsWithArea = 0;

    for (const floor of savedFloors) {
      const data = isRecord(floor.floor_data) ? floor.floor_data : null;
      if (!data) continue;

      // Product URL counts
      const products = Array.isArray(data.products) ? data.products : [];
      for (const p of products) {
        if (isRecord(p) && typeof p.url === 'string' && p.url) {
          try {
            const hostname = new URL(p.url).hostname.replace(/^www\./, '');
            productUrlCounts[hostname] = (productUrlCounts[hostname] ?? 0) + 1;
          } catch { /* invalid URL */ }
        }
      }

      // Floor area from summary
      if (isRecord(data.summary) && typeof data.summary.areaMm2 === 'number' && data.summary.areaMm2 > 0) {
        totalAreaMm2 += data.summary.areaMm2;
        floorsWithArea++;
      }
    }

    const topStores = Object.entries(productUrlCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([store, count]) => ({ store, count }));

    // ── Build user list ───────────────────────────────────────────────────────
    const users = authUsers
      .map((u) => ({
        id: u.id,
        email: u.email ?? '—',
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at ?? null,
        lastSave: lastSaveByUser[u.id] ?? null,
        savedFloorCount: savedFloorsByUser[u.id] ?? 0,
      }))
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

    const avgAreaM2 =
      floorsWithArea > 0 ? (totalAreaMm2 / floorsWithArea / 1_000_000).toFixed(2) : null;

    return res.status(200).json({
      users,
      stats: {
        totalUsers: users.length,
        totalSavedFloors: savedFloors.length,
        totalSharedFloors: sharedFloors.length,
        sharedByLoggedIn,
        sharedByAnonymous,
        avgFloorAreaM2: avgAreaM2,
        activeUsersLast30Days: users.filter(
          (u) => u.lastSignIn && Date.now() - new Date(u.lastSignIn).getTime() < 30 * 24 * 60 * 60 * 1000
        ).length,
      },
      topStores,
      recentShares,
    });
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : (isRecord(err) && typeof err.message === 'string' ? err.message : JSON.stringify(err));
    console.error('admin-stats error:', msg);
    return res.status(500).json({ error: msg });
  }
}
