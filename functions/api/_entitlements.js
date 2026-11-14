/**
 * Cloudflare Pages Worker Session & Tier Entitlement Guard
 * (functions/api/_entitlements.js)
 *
 * Strictly uses Cloudflare D1 (`env.DB`) and Web Crypto session tokens (`sessions` + `users`).
 * Files prefixed with `_` in `functions/api/` are helper modules (not exposed as public HTTP routes).
 */

const TIER_RANK = {
  operative: 0,
  pro: 1,
  station_chief: 2,
};

const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-user-id, x-username, x-device-id, x-device-name, x-device-type, x-entity-id, x-composio-api-key',
};

/**
 * Normalizes a raw database tier value to 'operative' | 'pro' | 'station_chief'.
 * @param {unknown} raw
 * @returns {'operative' | 'pro' | 'station_chief'}
 */
export function normalizeTier(raw) {
  const clean = String(raw || '')
    .trim()
    .toLowerCase();
  if (clean === 'station_chief') return 'station_chief';
  if (clean === 'pro') return 'pro';
  return 'operative';
}

/**
 * Extracts session token from `Authorization: Bearer <token>` or `pixelops_session` cookie.
 * @param {Request} request
 * @returns {string}
 */
export function extractSessionTokenFromRequest(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (/^Bearer\s+/i.test(authHeader)) {
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (bearer) return bearer;
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)pixelops_session=([^;]+)/);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1].trim());
    } catch {
      return match[1].trim();
    }
  }

  return '';
}

/**
 * Ensures older D1 deployments have the 002_entitlements columns & indexes applied cleanly.
 * @param {any} d1
 */
export async function ensureD1EntitlementColumns(d1) {
  if (!d1 || typeof d1.prepare !== 'function') return;
  try {
    await d1
      .prepare("ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'operative'")
      .run();
  } catch {}
  try {
    await d1
      .prepare('ALTER TABLE users ADD COLUMN sweeps_remaining INTEGER NOT NULL DEFAULT 0')
      .run();
  } catch {}
  try {
    await d1.prepare('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT').run();
  } catch {}
  try {
    await d1.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)').run();
  } catch {}
  try {
    await d1
      .prepare('CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data(user_id)')
      .run();
  } catch {}
}

/**
 * Resolves the active D1 user session and entitlement columns for a request.
 * @param {Request} request
 * @param {any} env
 */
export async function resolveSessionUser(request, env) {
  const token = extractSessionTokenFromRequest(request);
  if (!token) return null;

  const d1 = env && env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
  if (!d1) return null;

  const nowIso = new Date().toISOString();
  const querySql = `
    SELECT u.id, u.username, u.subscription_tier, u.sweeps_remaining
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > ?
  `;

  let row = null;
  try {
    row = await d1.prepare(querySql).bind(token, nowIso).first();
  } catch (err) {
    const msg = String((err && err.message) || err || '');
    if (msg.includes('subscription_tier') || msg.includes('sweeps_remaining')) {
      await ensureD1EntitlementColumns(d1);
      row = await d1.prepare(querySql).bind(token, nowIso).first();
    } else {
      throw err;
    }
  }

  if (!row) return null;

  return {
    id: String(row.id),
    username: String(row.username),
    subscription_tier: normalizeTier(row.subscription_tier),
    sweeps_remaining:
      typeof row.sweeps_remaining === 'number' && Number.isFinite(row.sweeps_remaining)
        ? row.sweeps_remaining
        : Number(row.sweeps_remaining || 0) || 0,
  };
}

/**
 * Verifies that the request holds a valid non-expired D1 session with at least `minTier`.
 * Returns `{ ok: true, user }` when permitted, or `{ ok: false, status: 403, user, response }` when blocked.
 *
 * @param {Request} request
 * @param {any} env
 * @param {'operative' | 'pro' | 'station_chief'} minTier
 */
export async function requireTier(request, env, minTier = 'operative') {
  const requiredTier = normalizeTier(minTier);
  const user = await resolveSessionUser(request, env);

  if (!user) {
    const response = new Response(
      JSON.stringify({
        error: 'UPGRADE_REQUIRED',
        requiredTier,
        currentTier: 'operative',
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          ...DEFAULT_CORS_HEADERS,
        },
      }
    );
    return {
      ok: false,
      status: 403,
      user: null,
      currentTier: 'operative',
      requiredTier,
      response,
    };
  }

  const currentTier = normalizeTier(user.subscription_tier);
  if (TIER_RANK[currentTier] < TIER_RANK[requiredTier]) {
    const response = new Response(
      JSON.stringify({
        error: 'UPGRADE_REQUIRED',
        requiredTier,
        currentTier,
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          ...DEFAULT_CORS_HEADERS,
        },
      }
    );
    return {
      ok: false,
      status: 403,
      user,
      currentTier,
      requiredTier,
      response,
    };
  }

  return {
    ok: true,
    status: 200,
    user,
    currentTier,
    requiredTier,
  };
}
