/**
 * Cloudflare Pages Function: /api/auth
 * Handles user registration, login, profile updates, password reset, and session validation.
 */

interface Env {
  SYNC_KV?: any;
  PIXELOPS_KV?: any;
  KV?: any;
  STORAGE?: any;
  DB?: any;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-device-id',
};

function getKv(env: Env) {
  return env.SYNC_KV || env.PIXELOPS_KV || env.KV || env.STORAGE || env.DB;
}

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

  const kv = getKv(env);
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
      if (kv) {
        const raw = await kv.get(`user:${cleanUser}`);
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

      const operativeCallsign = (callsign || cleanUser).toUpperCase();
      const recoveryKey = `SATCOM-${operativeCallsign.slice(0, 6).replace(/[^A-Z0-9]/g, '') || 'AGENT'}-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const userRecord = {
        id: userId,
        username: cleanUser,
        email: cleanEmail,
        callsign: operativeCallsign,
        salt,
        passwordHash,
        recoveryKey,
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
          recoveryKey: userRecord.recoveryKey,
          createdAt: now,
          lastLoginAt: now,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: now },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      if (kv) {
        await kv.put(`user:${cleanUser}`, JSON.stringify(userRecord));
        if (cleanEmail) {
          await kv.put(`user:${cleanEmail}`, JSON.stringify(userRecord));
        }
        if (operativeCallsign) {
          await kv.put(`user:${operativeCallsign.toLowerCase()}`, JSON.stringify(userRecord));
        }
        await kv.put(`token:${token}`, JSON.stringify({ userId, cleanUser }));
        await kv.put(`devices:${cleanUser}`, JSON.stringify(userRecord.devices));
        await kv.put(`devices:${userId}`, JSON.stringify(userRecord.devices));
      } else {
        memoryUsers.set(cleanUser, userRecord);
        if (cleanEmail) memoryUsers.set(cleanEmail, userRecord);
        if (operativeCallsign) memoryUsers.set(operativeCallsign.toLowerCase(), userRecord);
        memoryTokens.set(token, { userId, cleanUser });
      }

      return new Response(JSON.stringify({ ok: true, session, devices: userRecord.devices }), {
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

      if (kv) {
        const raw = await kv.get(`user:${cleanQuery}`);
        if (raw) userRecord = JSON.parse(raw);
      } else {
        userRecord = memoryUsers.get(cleanQuery);
        if (!userRecord) {
          for (const u of memoryUsers.values()) {
            if (
              u.username === cleanQuery ||
              u.email === cleanQuery ||
              u.callsign?.toLowerCase() === cleanQuery
            ) {
              userRecord = u;
              break;
            }
          }
        }
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

      if (!userRecord.recoveryKey) {
        userRecord.recoveryKey = `SATCOM-${userRecord.callsign.slice(0, 6).replace(/[^A-Z0-9]/g, '') || 'AGENT'}-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
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
          recoveryKey: userRecord.recoveryKey,
          createdAt: userRecord.createdAt,
          lastLoginAt: userRecord.lastLoginAt,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: new Date().toISOString() },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      if (kv) {
        await kv.put(`user:${cleanQuery}`, JSON.stringify(userRecord));
        await kv.put(`user:${userRecord.username}`, JSON.stringify(userRecord));
        await kv.put(`token:${token}`, JSON.stringify({ userId: userRecord.id, cleanUser: cleanQuery }));
        await kv.put(`devices:${userRecord.username}`, JSON.stringify(userRecord.devices));
        await kv.put(`devices:${userRecord.id}`, JSON.stringify(userRecord.devices));
      } else {
        memoryUsers.set(cleanQuery, userRecord);
        memoryUsers.set(userRecord.username, userRecord);
        memoryTokens.set(token, { userId: userRecord.id, cleanUser: cleanQuery });
      }

      return new Response(JSON.stringify({ ok: true, session, devices: userRecord.devices }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // 3. RESET PASSWORD: POST /api/auth/reset-password
    if (request.method === 'POST' && path.endsWith('/reset-password')) {
      const body = await request.json().catch(() => ({})) as any;
      const { usernameOrEmail, recoveryKey, newPassword } = body;
      const cleanQuery = String(usernameOrEmail || '').toLowerCase().trim();
      const cleanKey = String(recoveryKey || '').trim().toUpperCase();

      if (!cleanQuery || !cleanKey || !newPassword) {
        return new Response(
          JSON.stringify({ error: 'FIELDS_REQUIRED', message: 'Username/Email, Recovery Key, and New Password are required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      if (newPassword.length < 6) {
        return new Response(
          JSON.stringify({ error: 'PASSWORD_TOO_SHORT', message: 'New password must be at least 6 characters.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      let userRecord: any = null;
      if (kv) {
        const raw = await kv.get(`user:${cleanQuery}`);
        if (raw) userRecord = JSON.parse(raw);
      } else {
        userRecord = memoryUsers.get(cleanQuery);
        if (!userRecord) {
          for (const u of memoryUsers.values()) {
            if (
              u.username === cleanQuery ||
              u.email === cleanQuery ||
              u.callsign?.toLowerCase() === cleanQuery
            ) {
              userRecord = u;
              break;
            }
          }
        }
      }

      if (!userRecord) {
        return new Response(
          JSON.stringify({ error: 'USER_NOT_FOUND', message: 'No operative found matching credentials.' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const storedKey = String(userRecord.recoveryKey || '').trim().toUpperCase();
      if (!storedKey || storedKey !== cleanKey) {
        return new Response(
          JSON.stringify({ error: 'INVALID_RECOVERY_KEY', message: 'Invalid Satellite Recovery Key for this operative.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const newSalt = Math.random().toString(36).substring(2, 12);
      userRecord.salt = newSalt;
      userRecord.passwordHash = await hashPasswordNode(newPassword, newSalt);
      userRecord.lastUpdatedAt = new Date().toISOString();

      if (kv) {
        await kv.put(`user:${cleanQuery}`, JSON.stringify(userRecord));
      } else {
        memoryUsers.set(cleanQuery, userRecord);
      }

      return new Response(
        JSON.stringify({ ok: true, message: 'Password reset successfully. Please sign in with your new encryption key.' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 4. UPDATE PROFILE: POST /api/auth/update-profile
    if (request.method === 'POST' && path.endsWith('/update-profile')) {
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const body = await request.json().catch(() => ({})) as any;
      const { callsign, username, email, currentPassword, newPassword } = body;

      let tokenData: any = null;
      if (kv) {
        const raw = await kv.get(`token:${token}`);
        if (raw) tokenData = JSON.parse(raw);
      } else {
        tokenData = memoryTokens.get(token);
      }

      if (!tokenData) {
        return new Response(
          JSON.stringify({ error: 'UNAUTHORIZED', message: 'Session expired or invalid.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      let userRecord: any = null;
      if (kv) {
        const raw = await kv.get(`user:${tokenData.cleanUser}`);
        if (raw) userRecord = JSON.parse(raw);
      } else {
        userRecord = memoryUsers.get(tokenData.cleanUser);
      }

      if (!userRecord) {
        return new Response(
          JSON.stringify({ error: 'USER_NOT_FOUND', message: 'Operative profile not found.' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      if (newPassword) {
        if (!currentPassword) {
          return new Response(
            JSON.stringify({ error: 'CURRENT_PASSWORD_REQUIRED', message: 'Current password required to set a new password.' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
          );
        }
        const verifyHash = await hashPasswordNode(currentPassword, userRecord.salt);
        if (verifyHash !== userRecord.passwordHash) {
          return new Response(
            JSON.stringify({ error: 'INVALID_CURRENT_PASSWORD', message: 'Current password verification failed.' }),
            { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
          );
        }
        if (newPassword.length < 6) {
          return new Response(
            JSON.stringify({ error: 'NEW_PASSWORD_TOO_SHORT', message: 'New password must be at least 6 characters.' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
          );
        }
        const newSalt = Math.random().toString(36).substring(2, 12);
        userRecord.salt = newSalt;
        userRecord.passwordHash = await hashPasswordNode(newPassword, newSalt);
      }

      let oldUserKey = userRecord.username;
      if (username) {
        const cleanNewUser = String(username).toLowerCase().trim();
        if (cleanNewUser !== userRecord.username) {
          userRecord.username = cleanNewUser;
          tokenData.cleanUser = cleanNewUser;
        }
      }

      if (callsign) userRecord.callsign = String(callsign).trim().toUpperCase();
      if (email) userRecord.email = String(email).toLowerCase().trim();
      userRecord.lastUpdatedAt = new Date().toISOString();

      if (kv) {
        if (oldUserKey !== userRecord.username) {
          await kv.delete(`user:${oldUserKey}`);
        }
        await kv.put(`user:${userRecord.username}`, JSON.stringify(userRecord));
        await kv.put(`token:${token}`, JSON.stringify(tokenData));
      } else {
        if (oldUserKey !== userRecord.username) {
          memoryUsers.delete(oldUserKey);
        }
        memoryUsers.set(userRecord.username, userRecord);
        memoryTokens.set(token, tokenData);
      }

      const session = {
        token,
        user: {
          id: userRecord.id,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance,
          recoveryKey: userRecord.recoveryKey,
          createdAt: userRecord.createdAt,
          lastLoginAt: userRecord.lastLoginAt,
        },
        device: { deviceId: 'current', deviceName: 'Updated Node', deviceType: 'desktop', lastActive: new Date().toISOString() },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

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
