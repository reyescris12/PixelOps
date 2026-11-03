/**
 * Cloudflare Pages Function: /api/auth
 * Handles user registration, login, logout, session verification (/me),
 * profile updates, password reset, and rate limiting with Cloudflare D1 & KV support.
 */

interface Env {
  DB?: any;
  SYNC_KV?: any;
  PIXELOPS_KV?: any;
  KV?: any;
  STORAGE?: any;
  DATA?: any;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-username, x-device-id, x-device-name, x-device-type',
};

function getKv(env: Env) {
  return env.SYNC_KV || env.PIXELOPS_KV || env.KV || env.STORAGE || env.DATA;
}

function getD1(env: Env) {
  return env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
}

// In-memory fallback if neither D1 nor KV is bound
const memoryUsers = new Map<string, any>();
const memoryTokens = new Map<string, any>();
const memoryRateLimits = new Map<string, { attempts: number; firstAttempt: number; blockedUntil: number }>();

/**
 * PBKDF2 Password Hashing (100,000 iterations, Web Crypto API)
 */
async function hashPasswordPBKDF2(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Legacy SHA-256 fallback hash for existing credentials
 */
async function hashPasswordLegacy(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}:pixelops_satcom_secret`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies a password against hash, checking PBKDF2 first, then legacy SHA-256
 */
async function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  const pbkdf2 = await hashPasswordPBKDF2(password, salt);
  if (pbkdf2 === storedHash) return true;
  const legacy = await hashPasswordLegacy(password, salt);
  return legacy === storedHash;
}

/**
 * Rate Limiter to protect /login and /register from brute-force attacks
 * Limits requests to 10 attempts per 5 minutes per IP.
 */
async function checkRateLimit(request: Request, db: any): Promise<{ allowed: boolean; retryAfter?: number }> {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'default_ip';
  const now = Math.floor(Date.now() / 1000);
  const windowSec = 300; // 5 min
  const maxAttempts = 10;

  if (db) {
    try {
      const rec = await db.prepare('SELECT attempts, first_attempt_at, blocked_until FROM rate_limits WHERE ip = ?').bind(ip).first();
      if (rec) {
        if (rec.blocked_until && rec.blocked_until > now) {
          return { allowed: false, retryAfter: rec.blocked_until - now };
        }
        if (now - rec.first_attempt_at > windowSec) {
          await db.prepare('UPDATE rate_limits SET attempts = 1, first_attempt_at = ?, blocked_until = 0 WHERE ip = ?').bind(now, ip).run();
        } else if (rec.attempts >= maxAttempts) {
          const blockedUntil = now + 900; // block for 15 minutes
          await db.prepare('UPDATE rate_limits SET blocked_until = ? WHERE ip = ?').bind(blockedUntil, ip).run();
          return { allowed: false, retryAfter: 900 };
        } else {
          await db.prepare('UPDATE rate_limits SET attempts = attempts + 1 WHERE ip = ?').bind(ip).run();
        }
      } else {
        await db.prepare('INSERT INTO rate_limits (ip, attempts, first_attempt_at, blocked_until) VALUES (?, 1, ?, 0)').bind(ip, now).run();
      }
    } catch {}
  } else {
    const mem = memoryRateLimits.get(ip);
    if (mem) {
      if (mem.blockedUntil && mem.blockedUntil > now) {
        return { allowed: false, retryAfter: mem.blockedUntil - now };
      }
      if (now - mem.firstAttempt > windowSec) {
        memoryRateLimits.set(ip, { attempts: 1, firstAttempt: now, blockedUntil: 0 });
      } else if (mem.attempts >= maxAttempts) {
        mem.blockedUntil = now + 900;
        return { allowed: false, retryAfter: 900 };
      } else {
        mem.attempts += 1;
      }
    } else {
      memoryRateLimits.set(ip, { attempts: 1, firstAttempt: now, blockedUntil: 0 });
    }
  }

  return { allowed: true };
}

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  const d1 = getD1(env);
  const kv = getKv(env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const actionParam = (url.searchParams.get('action') || '').toLowerCase();

  try {
    // 1. REGISTER: POST /api/register, /api/auth/register, or action=register
    const isRegister =
      request.method === 'POST' &&
      (path.endsWith('/register') || actionParam === 'register');

    if (isRegister) {
      const rateCheck = await checkRateLimit(request, d1);
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({ error: 'RATE_LIMITED', message: `Too many attempts. Locked out for ${rateCheck.retryAfter || 900}s.` }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter || 900), ...CORS_HEADERS } }
        );
      }

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
      const operativeCallsign = (callsign || cleanUser).toUpperCase();

      // Check existence
      let existing: any = null;
      if (d1) {
        existing = await d1.prepare('SELECT id, username FROM users WHERE username = ? OR email = ?').bind(cleanUser, cleanEmail).first();
      } else if (kv) {
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

      const salt = Math.random().toString(36).substring(2, 14);
      const passwordHash = await hashPasswordPBKDF2(password, salt);
      const userId = `usr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      const now = new Date().toISOString();
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
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      if (d1) {
        await d1.prepare(`
          INSERT INTO users (id, username, email, callsign, password_hash, salt, recovery_key, security_clearance, created_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'COMMANDER', ?, ?)
        `).bind(userId, cleanUser, cleanEmail, operativeCallsign, passwordHash, salt, recoveryKey, now, now).run();

        await d1.prepare('INSERT INTO sessions (token, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(token, userId, device?.deviceId || null, now, expiresAt).run();

        if (device) {
          await d1.prepare(`
            INSERT INTO devices (device_id, user_id, device_name, device_type, last_active)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, device_id) DO UPDATE SET last_active = excluded.last_active, device_name = excluded.device_name
          `).bind(device.deviceId, userId, device.deviceName || 'Node', device.deviceType || 'desktop', now).run();
        }
      }

      if (kv) {
        await kv.put(`user:${cleanUser}`, JSON.stringify(userRecord));
        if (cleanEmail) await kv.put(`user:${cleanEmail}`, JSON.stringify(userRecord));
        if (operativeCallsign) await kv.put(`user:${operativeCallsign.toLowerCase()}`, JSON.stringify(userRecord));
        await kv.put(`token:${token}`, JSON.stringify({ userId, cleanUser }));
        await kv.put(`devices:${cleanUser}`, JSON.stringify(userRecord.devices));
        await kv.put(`devices:${userId}`, JSON.stringify(userRecord.devices));
      } else {
        memoryUsers.set(cleanUser, userRecord);
        if (cleanEmail) memoryUsers.set(cleanEmail, userRecord);
        if (operativeCallsign) memoryUsers.set(operativeCallsign.toLowerCase(), userRecord);
        memoryTokens.set(token, { userId, cleanUser });
      }

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
        expiresAt,
      };

      return new Response(JSON.stringify({ ok: true, session, devices: userRecord.devices }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // 2. LOGIN: POST /api/login, /api/auth/login, or action=login
    const isLogin =
      request.method === 'POST' &&
      (path.endsWith('/login') || actionParam === 'login');

    if (isLogin) {
      const rateCheck = await checkRateLimit(request, d1);
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({ error: 'RATE_LIMITED', message: `Too many attempts. Locked out for ${rateCheck.retryAfter || 900}s.` }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter || 900), ...CORS_HEADERS } }
        );
      }

      const body = await request.json().catch(() => ({})) as any;
      const { usernameOrEmail, password, device } = body;
      const cleanQuery = String(usernameOrEmail || '').toLowerCase().trim();

      let userRecord: any = null;

      if (d1) {
        userRecord = await d1.prepare(`
          SELECT id, username, email, callsign, password_hash as passwordHash, salt, recovery_key as recoveryKey, security_clearance as securityClearance, created_at as createdAt, last_login_at as lastLoginAt
          FROM users
          WHERE username = ? OR email = ? OR callsign = ?
        `).bind(cleanQuery, cleanQuery, cleanQuery).first();
      }

      if (!userRecord && kv) {
        const raw = await kv.get(`user:${cleanQuery}`);
        if (raw) {
          try {
            userRecord = JSON.parse(raw);
            if (d1 && userRecord) {
              // Auto-migrate account from KV into Cloudflare D1
              await d1.prepare(`
                INSERT INTO users (id, username, email, callsign, password_hash, salt, recovery_key, security_clearance, created_at, last_login_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING
              `).bind(
                userRecord.id,
                userRecord.username,
                userRecord.email || `${userRecord.username}@pixelops.local`,
                userRecord.callsign || userRecord.username,
                userRecord.passwordHash,
                userRecord.salt,
                userRecord.recoveryKey || null,
                userRecord.securityClearance || 'COMMANDER',
                userRecord.createdAt || new Date().toISOString(),
                userRecord.lastLoginAt || new Date().toISOString()
              ).run();
            }
          } catch {}
        }
      }

      if (!userRecord) {
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
        if (d1 && userRecord) {
          try {
            // Auto-migrate account from memory into Cloudflare D1
            await d1.prepare(`
              INSERT INTO users (id, username, email, callsign, password_hash, salt, recovery_key, security_clearance, created_at, last_login_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO NOTHING
            `).bind(
              userRecord.id,
              userRecord.username,
              userRecord.email || `${userRecord.username}@pixelops.local`,
              userRecord.callsign || userRecord.username,
              userRecord.passwordHash,
              userRecord.salt,
              userRecord.recoveryKey || null,
              userRecord.securityClearance || 'COMMANDER',
              userRecord.createdAt || new Date().toISOString(),
              userRecord.lastLoginAt || new Date().toISOString()
            ).run();
          } catch {}
        }
      }

      if (!userRecord) {
        return new Response(
          JSON.stringify({ error: 'INVALID_CREDENTIALS', message: 'No operative found matching credentials.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const isPasswordValid = await verifyPassword(password, userRecord.salt, userRecord.passwordHash);
      if (!isPasswordValid) {
        return new Response(
          JSON.stringify({ error: 'INVALID_PASSWORD', message: 'Invalid operative password key.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const token = `tok_${userRecord.id}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;

      // Update devices list
      userRecord.devices = userRecord.devices || [];
      if (device) {
        const existingIdx = userRecord.devices.findIndex((d: any) => d.deviceId === device.deviceId);
        if (existingIdx >= 0) userRecord.devices[existingIdx] = device;
        else userRecord.devices.push(device);
      }

      if (d1) {
        await d1.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, userRecord.id).run();
        await d1.prepare('INSERT INTO sessions (token, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(token, userRecord.id, device?.deviceId || null, now, expiresAt).run();

        if (device) {
          await d1.prepare(`
            INSERT INTO devices (device_id, user_id, device_name, device_type, last_active)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, device_id) DO UPDATE SET last_active = excluded.last_active, device_name = excluded.device_name
          `).bind(device.deviceId, userRecord.id, device.deviceName || 'Node', device.deviceType || 'desktop', now).run();
        }
      }

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

      const session = {
        token,
        user: {
          id: userRecord.id,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance || 'COMMANDER',
          recoveryKey: userRecord.recoveryKey,
          createdAt: userRecord.createdAt,
          lastLoginAt: now,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: now },
        expiresAt,
      };

      return new Response(JSON.stringify({ ok: true, session, devices: userRecord.devices }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // 3. ME (SESSION VALIDATION): GET /api/me or /api/auth/me
    const isMe =
      request.method === 'GET' &&
      (path.endsWith('/me') || actionParam === 'me');

    if (isMe) {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();

      if (!token) {
        return new Response(JSON.stringify({ ok: false, error: 'NO_TOKEN' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      if (d1) {
        const sessionRow = await d1.prepare(`
          SELECT s.token, s.expires_at, u.id, u.username, u.email, u.callsign, u.recovery_key, u.security_clearance, u.created_at, u.last_login_at
          FROM sessions s
          JOIN users u ON s.user_id = u.id
          WHERE s.token = ?
        `).bind(token).first();

        if (sessionRow && new Date(sessionRow.expires_at).getTime() > Date.now()) {
          const devs = await d1.prepare('SELECT device_id as deviceId, device_name as deviceName, device_type as deviceType, last_active as lastActive FROM devices WHERE user_id = ?').bind(sessionRow.id).all();
          return new Response(JSON.stringify({
            ok: true,
            user: {
              id: sessionRow.id,
              username: sessionRow.username,
              email: sessionRow.email,
              callsign: sessionRow.callsign,
              recoveryKey: sessionRow.recovery_key,
              securityClearance: sessionRow.security_clearance,
              createdAt: sessionRow.created_at,
              lastLoginAt: sessionRow.last_login_at,
            },
            devices: devs?.results || [],
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
        }
      }

      return new Response(JSON.stringify({ ok: true, message: 'Valid token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // 4. LOGOUT: POST /api/logout, /api/auth/logout, or action=logout
    const isLogout =
      request.method === 'POST' &&
      (path.endsWith('/logout') || actionParam === 'logout');

    if (isLogout) {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();

      if (token) {
        if (d1) {
          await d1.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        }
        if (kv) {
          await kv.delete(`token:${token}`);
        }
        memoryTokens.delete(token);
      }

      return new Response(JSON.stringify({ ok: true, message: 'Logged out successfully.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // 5. RESET PASSWORD: POST /api/auth/reset-password or action=reset-password
    if (request.method === 'POST' && (path.endsWith('/reset-password') || actionParam === 'reset-password')) {
      const body = await request.json().catch(() => ({})) as any;
      const { usernameOrEmail, recoveryKey, newPassword } = body;
      const cleanQuery = String(usernameOrEmail || '').toLowerCase().trim();
      const cleanKey = String(recoveryKey || '').trim().toUpperCase();

      if (!cleanQuery || !cleanKey || !newPassword) {
        return new Response(
          JSON.stringify({ error: 'MISSING_FIELDS', message: 'Username, recovery key, and new password are required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      let userRecord: any = null;
      if (d1) {
        userRecord = await d1.prepare('SELECT * FROM users WHERE username = ? OR email = ?').bind(cleanQuery, cleanQuery).first();
      } else if (kv) {
        const raw = await kv.get(`user:${cleanQuery}`);
        if (raw) userRecord = JSON.parse(raw);
      } else {
        userRecord = memoryUsers.get(cleanQuery);
      }

      if (!userRecord) {
        return new Response(
          JSON.stringify({ error: 'USER_NOT_FOUND', message: 'No operative found with that identifier.' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const storedKey = String(userRecord.recovery_key || userRecord.recoveryKey || '').trim().toUpperCase();
      if (storedKey !== cleanKey) {
        return new Response(
          JSON.stringify({ error: 'INVALID_RECOVERY_KEY', message: 'Satellite Recovery Key does not match our records.' }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const newSalt = Math.random().toString(36).substring(2, 14);
      const newHash = await hashPasswordPBKDF2(newPassword, newSalt);

      if (d1) {
        await d1.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').bind(newHash, newSalt, userRecord.id).run();
      }
      if (kv) {
        userRecord.passwordHash = newHash;
        userRecord.salt = newSalt;
        await kv.put(`user:${userRecord.username}`, JSON.stringify(userRecord));
      } else {
        userRecord.passwordHash = newHash;
        userRecord.salt = newSalt;
        memoryUsers.set(userRecord.username, userRecord);
      }

      return new Response(
        JSON.stringify({ ok: true, message: 'Password encryption key reset successfully. Please sign in.' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
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
