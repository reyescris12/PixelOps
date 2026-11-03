/**
 * Cloudflare Pages Function: /api/auth
 * Handles user registration, login, and session validation.
 */

interface Env {
  SYNC_KV?: any;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-device-id',
};

// In-memory fallback if KV is not bound
const memoryUsers = new Map<string, any>();
const memoryTokens = new Map<string, any>();

async function hashPasswordNode(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}:pixelops_satcom_secret`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  try {
    // 1. REGISTER: POST /api/auth/register or /api/auth?action=register
    if (request.method === 'POST' && (path.endsWith('/register') || url.searchParams.get('action') === 'register')) {
      const body = await request.json().catch(() => ({})) as any;
      const { username, email, password, callsign, device } = body;

      if (!username || !password) {
        return new Response(
          JSON.stringify({ error: 'USERNAME_AND_PASSWORD_REQUIRED', message: 'Username and password required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const cleanUser = String(username).toLowerCase().trim();
      const cleanEmail = String(email || `${cleanUser}@pixelops.local`).toLowerCase().trim();

      // Check if user exists
      let existing: any = null;
      if (env.SYNC_KV) {
        const raw = await env.SYNC_KV.get(`user:${cleanUser}`);
        if (raw) existing = JSON.parse(raw);
      } else {
        existing = memoryUsers.get(cleanUser);
      }

      if (existing) {
        return new Response(
          JSON.stringify({ error: 'USER_EXISTS', message: 'An operative with that username already exists.' }),
          { status: 409, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const salt = Math.random().toString(36).substring(2, 12);
      const passwordHash = await hashPasswordNode(password, salt);
      const userId = `usr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      const now = new Date().toISOString();

      const userRecord = {
        id: userId,
        username: cleanUser,
        email: cleanEmail,
        callsign: (callsign || cleanUser).toUpperCase(),
        salt,
        passwordHash,
        securityClearance: 'COMMANDER',
        createdAt: now,
        lastLoginAt: now,
        devices: device ? [device] : [],
      };

      const token = `tok_${userId}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;
      const session = {
        token,
        user: {
          id: userId,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance,
          createdAt: now,
          lastLoginAt: now,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: now },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      if (env.SYNC_KV) {
        await env.SYNC_KV.put(`user:${cleanUser}`, JSON.stringify(userRecord));
        await env.SYNC_KV.put(`token:${token}`, JSON.stringify({ userId, cleanUser }));
      } else {
        memoryUsers.set(cleanUser, userRecord);
        memoryTokens.set(token, { userId, cleanUser });
      }

      return new Response(JSON.stringify({ ok: true, session }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // 2. LOGIN: POST /api/auth/login or /api/auth?action=login
    if (request.method === 'POST' && (path.endsWith('/login') || url.searchParams.get('action') === 'login')) {
      const body = await request.json().catch(() => ({})) as any;
      const { usernameOrEmail, password, device } = body;

      const cleanQuery = String(usernameOrEmail || '').toLowerCase().trim();
      let userRecord: any = null;

      if (env.SYNC_KV) {
        const raw = await env.SYNC_KV.get(`user:${cleanQuery}`);
        if (raw) userRecord = JSON.parse(raw);
      } else {
        userRecord = memoryUsers.get(cleanQuery);
      }

      if (!userRecord) {
        return new Response(
          JSON.stringify({ error: 'INVALID_CREDENTIALS', message: 'No operative found matching credentials.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const computed = await hashPasswordNode(password, userRecord.salt);
      if (computed !== userRecord.passwordHash) {
        return new Response(
          JSON.stringify({ error: 'INVALID_PASSWORD', message: 'Invalid operative password key.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      // Update devices list
      userRecord.lastLoginAt = new Date().toISOString();
      if (device) {
        userRecord.devices = userRecord.devices || [];
        const existingIdx = userRecord.devices.findIndex((d: any) => d.deviceId === device.deviceId);
        if (existingIdx >= 0) {
          userRecord.devices[existingIdx] = device;
        } else {
          userRecord.devices.push(device);
        }
      }

      const token = `tok_${userRecord.id}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;
      const session = {
        token,
        user: {
          id: userRecord.id,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance,
          createdAt: userRecord.createdAt,
          lastLoginAt: userRecord.lastLoginAt,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: new Date().toISOString() },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      if (env.SYNC_KV) {
        await env.SYNC_KV.put(`user:${cleanQuery}`, JSON.stringify(userRecord));
        await env.SYNC_KV.put(`token:${token}`, JSON.stringify({ userId: userRecord.id, cleanUser: cleanQuery }));
      } else {
        memoryUsers.set(cleanQuery, userRecord);
        memoryTokens.set(token, { userId: userRecord.id, cleanUser: cleanQuery });
      }

      return new Response(JSON.stringify({ ok: true, session }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    return new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'Unknown auth endpoint' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'AUTH_ERROR', message: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
};
