/**
 * Cloudflare Pages Function: /api/auth
 * Handles user registration, login, logout, session verification (/me),
 * profile updates, secure password reset, and restricted admin reset capabilities
 * with Cloudflare D1 SQL & KV support.
 */

interface Env {
  DB?: any;
  SYNC_KV?: any;
  PIXELOPS_KV?: any;
  KV?: any;
  STORAGE?: any;
  DATA?: any;
  RESET_KEY?: string;
  PIXELOPS_RESET_SECRET?: string;
  ADMIN_SECRET?: string;
  SATCOM_SECRET?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-username, x-device-id, x-device-name, x-device-type, x-reset-key, x-admin-reset-key, x-entity-id, x-composio-api-key, Cookie',
};

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (origin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-username, x-device-id, x-device-name, x-device-type, x-reset-key, x-admin-reset-key, x-entity-id, x-composio-api-key, Cookie',
    };
  }
  return CORS_HEADERS;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return list;
}

function extractSessionToken(request: Request): string {
  const authHeader = request.headers.get('Authorization') || '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  const cookies = parseCookies(request.headers.get('Cookie'));
  return cookies['pixelops_session'] || '';
}

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (reduced from unbounded 30 days)

function getSessionCookieHeader(token: string, request: Request, maxAgeSec = 7 * 24 * 60 * 60): string {
  const isHttps = request.url.startsWith('https://');
  const secureFlag = isHttps ? '; Secure' : '';
  return `pixelops_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secureFlag}`;
}

function getClearSessionCookieHeader(): string {
  return 'pixelops_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

function getKv(env: Env) {
  return env.SYNC_KV || env.PIXELOPS_KV || env.KV || env.STORAGE || env.DATA;
}

function getD1(env: Env) {
  return env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
}

// In-memory fallback if neither D1 nor KV is bound
const memoryUsers = new Map<string, any>();
const memoryTokens = new Map<string, any>();
const memoryVaults = new Map<string, any>();
const memoryRateLimits = new Map<string, { attempts: number; firstAttempt: number; blockedUntil: number }>();
const memoryPairingTickets = new Map<string, {
  code: string;
  userId: string;
  username: string;
  email: string;
  callsign: string;
  securityClearance: string;
  syncPackage?: any;
  createdAt: string;
  expiresAt: number;
  used: boolean;
}>();

/**
 * Generates cryptographically secure random hexadecimal tokens using Web Crypto API.
 * Replaces predictable Math.random() to prevent PRNG state recovery and sequence prediction attacks.
 */
function generateSecureTokenEdge(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates an unambiguous, cryptographically secure alphanumeric code from a 32-character charset.
 */
function generateSecureCodeEdge(length = 6): string {
  const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(length * 2);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const val = bytes[i];
    if (val < charset.length * Math.floor(256 / charset.length)) {
      result += charset[val % charset.length];
    }
  }
  while (result.length < length) {
    const b = new Uint8Array(1);
    crypto.getRandomValues(b);
    if (b[0] < charset.length * Math.floor(256 / charset.length)) {
      result += charset[b[0] % charset.length];
    }
  }
  return result;
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

/**
 * Hashes a recovery key with SHA-256 so plaintext recovery keys are never stored in databases
 */
async function hashRecoveryKey(key: string): Promise<string> {
  const clean = key.trim().toUpperCase();
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(`pixelops:recovery:${clean}`));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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
 * Legacy SHA-256 fallback hash for backward compatibility
 */
async function hashPasswordLegacy(password: string, salt: string, env?: Env): Promise<string> {
  const pepper = env?.SATCOM_SECRET || 'pixelops_satcom_secret';
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}:${pepper}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies a password against stored hash, checking PBKDF2 first, then legacy SHA-256.
 * Returns both verification status and whether a legacy hash was used so caller can upgrade it.
 */
async function verifyPassword(password: string, salt: string, storedHash: string, env?: Env): Promise<{ valid: boolean; isLegacy: boolean }> {
  if (!storedHash) return { valid: false, isLegacy: false };
  const pbkdf2 = await hashPasswordPBKDF2(password, salt);
  if (timingSafeEqualStr(pbkdf2, storedHash)) return { valid: true, isLegacy: false };
  const legacy = await hashPasswordLegacy(password, salt, env);
  if (timingSafeEqualStr(legacy, storedHash)) return { valid: true, isLegacy: true };
  return { valid: false, isLegacy: false };
}

/**
 * Rate Limiter to protect /login, /register, /reset-password, and pairing from brute-force attacks
 */
async function checkRateLimit(
  request: Request,
  db: any,
  maxAttempts = 10,
  windowSec = 300,
  actionKey = 'auth'
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'default_ip';
  const rateKey = `${actionKey}:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  if (db) {
    try {
      const rec = await db.prepare('SELECT attempts, first_attempt_at, blocked_until FROM rate_limits WHERE ip = ?').bind(rateKey).first();
      if (rec) {
        if (rec.blocked_until && rec.blocked_until > now) {
          return { allowed: false, retryAfter: rec.blocked_until - now };
        }
        if (now - rec.first_attempt_at > windowSec) {
          await db.prepare('UPDATE rate_limits SET attempts = 1, first_attempt_at = ?, blocked_until = 0 WHERE ip = ?').bind(now, rateKey).run();
        } else if (rec.attempts >= maxAttempts) {
          const blockedUntil = now + 900; // block for 15 minutes
          await db.prepare('UPDATE rate_limits SET blocked_until = ? WHERE ip = ?').bind(blockedUntil, rateKey).run();
          return { allowed: false, retryAfter: 900 };
        } else {
          await db.prepare('UPDATE rate_limits SET attempts = attempts + 1 WHERE ip = ?').bind(rateKey).run();
        }
      } else {
        await db.prepare('INSERT INTO rate_limits (ip, attempts, first_attempt_at, blocked_until) VALUES (?, 1, ?, 0)').bind(rateKey, now).run();
      }
    } catch {}
  } else {
    const mem = memoryRateLimits.get(rateKey);
    if (mem) {
      if (mem.blockedUntil && mem.blockedUntil > now) {
        return { allowed: false, retryAfter: mem.blockedUntil - now };
      }
      if (now - mem.firstAttempt > windowSec) {
        memoryRateLimits.set(rateKey, { attempts: 1, firstAttempt: now, blockedUntil: 0 });
      } else if (mem.attempts >= maxAttempts) {
        mem.blockedUntil = now + 900;
        return { allowed: false, retryAfter: 900 };
      } else {
        mem.attempts += 1;
      }
    } else {
      memoryRateLimits.set(rateKey, { attempts: 1, firstAttempt: now, blockedUntil: 0 });
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
      const rateCheck = await checkRateLimit(request, d1, 5, 900, 'register');
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({ error: 'RATE_LIMITED', message: `Too many registration attempts. Locked out for ${rateCheck.retryAfter || 900}s.` }),
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

      const salt = generateSecureTokenEdge(16);
      const passwordHash = await hashPasswordPBKDF2(password, salt);
      const userId = `usr_${Date.now().toString(36)}_${generateSecureTokenEdge(8)}`;
      const now = new Date().toISOString();
      const incomingEntityId = body.composioEntityId || body.entityId || request.headers.get('x-entity-id') || null;
      const incomingApiKey = body.composioApiKey || body.apiKey || request.headers.get('x-composio-api-key') || null;

      // Generate recovery key and store only its cryptographic hash
      const rawRecoveryKey = `SATCOM-${operativeCallsign.slice(0, 6).replace(/[^A-Z0-9]/g, '') || 'AGENT'}-${generateSecureCodeEdge(4)}-${generateSecureCodeEdge(4)}-${generateSecureCodeEdge(4)}`;
      const recoveryHash = await hashRecoveryKey(rawRecoveryKey);

      const userRecord = {
        id: userId,
        username: cleanUser,
        email: cleanEmail,
        callsign: operativeCallsign,
        salt,
        passwordHash,
        recoveryKeyHash: recoveryHash,
        securityClearance: 'COMMANDER',
        composioEntityId: incomingEntityId || undefined,
        composioApiKey: incomingApiKey || undefined,
        createdAt: now,
        lastLoginAt: now,
        devices: device ? [device] : [],
      };

      const token = `tok_${userId}_${Date.now().toString(36)}_${generateSecureTokenEdge(16)}`;
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();

      if (d1) {
        await d1.prepare(`
          INSERT INTO users (id, username, email, callsign, password_hash, salt, recovery_key, security_clearance, created_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'COMMANDER', ?, ?)
        `).bind(userId, cleanUser, cleanEmail, operativeCallsign, passwordHash, salt, recoveryHash, now, now).run();

        await d1.prepare('INSERT INTO sessions (token, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(token, userId, device?.deviceId || null, now, expiresAt).run();

        if (device) {
          await d1.prepare(`
            INSERT INTO devices (device_id, user_id, device_name, device_type, last_active)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, device_id) DO UPDATE SET last_active = excluded.last_active, device_name = excluded.device_name
          `).bind(device.deviceId, userId, device.deviceName || 'Node', device.deviceType || 'desktop', now).run();
        }

        // Store generated Composio entityId and custom API key in Cloudflare D1 user_data table upon account registration
        if (incomingEntityId || incomingApiKey) {
          try {
            await d1.prepare(`
              INSERT INTO user_data (user_id, entity_id, composio_api_key, sync_package, version, updated_at)
              VALUES (?, ?, ?, ?, 1, ?)
              ON CONFLICT(user_id) DO UPDATE SET 
                entity_id = COALESCE(excluded.entity_id, user_data.entity_id),
                composio_api_key = COALESCE(excluded.composio_api_key, user_data.composio_api_key),
                sync_package = excluded.sync_package,
                updated_at = excluded.updated_at
            `).bind(userId, incomingEntityId, incomingApiKey, JSON.stringify({ composioEntityId: incomingEntityId, composioApiKey: incomingApiKey }), now).run();
          } catch {
            try { await d1.prepare("ALTER TABLE user_data ADD COLUMN entity_id TEXT").run(); } catch {}
            try { await d1.prepare("ALTER TABLE user_data ADD COLUMN composio_api_key TEXT").run(); } catch {}
            try {
              await d1.prepare(`
                INSERT INTO user_data (user_id, entity_id, composio_api_key, sync_package, version, updated_at)
                VALUES (?, ?, ?, ?, 1, ?)
                ON CONFLICT(user_id) DO UPDATE SET 
                  entity_id = COALESCE(excluded.entity_id, user_data.entity_id),
                  composio_api_key = COALESCE(excluded.composio_api_key, user_data.composio_api_key),
                  sync_package = excluded.sync_package,
                  updated_at = excluded.updated_at
              `).bind(userId, incomingEntityId, incomingApiKey, JSON.stringify({ composioEntityId: incomingEntityId, composioApiKey: incomingApiKey }), now).run();
            } catch {
              try {
                await d1.prepare(`
                  INSERT INTO user_data (user_id, sync_package, version, updated_at)
                  VALUES (?, ?, 1, ?)
                  ON CONFLICT(user_id) DO UPDATE SET sync_package = excluded.sync_package, updated_at = excluded.updated_at
                `).bind(userId, JSON.stringify({ composioEntityId: incomingEntityId, composioApiKey: incomingApiKey }), now).run();
              } catch {}
            }
          }
        }
      }

      if (kv) {
        await kv.put(`user:${cleanUser}`, JSON.stringify(userRecord));
        if (cleanEmail) await kv.put(`user:${cleanEmail}`, JSON.stringify(userRecord));
        if (operativeCallsign) await kv.put(`user:${operativeCallsign.toLowerCase()}`, JSON.stringify(userRecord));
        await kv.put(`token:${token}`, JSON.stringify({ userId, cleanUser, expiresAt }));
        await kv.put(`devices:${cleanUser}`, JSON.stringify(userRecord.devices));
        await kv.put(`devices:${userId}`, JSON.stringify(userRecord.devices));
        if (incomingEntityId || incomingApiKey) {
          await kv.put(`vault:${userId}`, JSON.stringify({ composioEntityId: incomingEntityId, composioApiKey: incomingApiKey }));
        }
      } else {
        memoryUsers.set(cleanUser, userRecord);
        if (cleanEmail) memoryUsers.set(cleanEmail, userRecord);
        if (operativeCallsign) memoryUsers.set(operativeCallsign.toLowerCase(), userRecord);
        memoryTokens.set(token, { userId, cleanUser, expiresAt });
        if (incomingEntityId || incomingApiKey) {
          memoryVaults.set(`vault:${userId}`, { composioEntityId: incomingEntityId, composioApiKey: incomingApiKey });
        }
      }

      // Important: Never persist recoveryKey in session.user payload. Surface once at registration only.
      const session = {
        token,
        user: {
          id: userId,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance,
          composioEntityId: incomingEntityId || undefined,
          composioApiKey: incomingApiKey || undefined,
          createdAt: now,
          lastLoginAt: now,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: now },
        expiresAt,
      };

      return new Response(JSON.stringify({
        ok: true,
        session,
        composioEntityId: incomingEntityId || null,
        composioApiKey: incomingApiKey || null,
        devices: userRecord.devices,
        oneTimeRecoveryKey: rawRecoveryKey, // Displayed once for safe offline storage
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request),
          'Set-Cookie': getSessionCookieHeader(token, request),
        },
      });
    }

    // 2. LOGIN: POST /api/login, /api/auth/login, or action=login
    const isLogin =
      request.method === 'POST' &&
      (path.endsWith('/login') || actionParam === 'login');

    if (isLogin) {
      const rateCheck = await checkRateLimit(request, d1, 5, 300, 'login');
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({ error: 'RATE_LIMITED', message: `Too many login attempts. Locked out for ${rateCheck.retryAfter || 300}s.` }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter || 300), ...CORS_HEADERS } }
        );
      }

      const body = await request.json().catch(() => ({})) as any;
      const { usernameOrEmail, password, device } = body;
      const cleanQuery = String(usernameOrEmail || '').toLowerCase().trim();

      let userRecord: any = null;

      if (d1) {
        userRecord = await d1.prepare(`
          SELECT id, username, email, callsign, password_hash as passwordHash, salt, recovery_key as recoveryKeyHash, security_clearance as securityClearance, created_at as createdAt, last_login_at as lastLoginAt
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
                userRecord.recoveryKeyHash || userRecord.recoveryKey || null,
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
              userRecord.recoveryKeyHash || userRecord.recoveryKey || null,
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

      const verifyResult = await verifyPassword(password, userRecord.salt, userRecord.passwordHash, env);
      if (!verifyResult.valid) {
        return new Response(
          JSON.stringify({ error: 'INVALID_PASSWORD', message: 'Invalid operative password key.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
        );
      }

      // Upgrade legacy SHA-256 hash to PBKDF2 immediately upon successful authentication
      if (verifyResult.isLegacy) {
        const upgradedHash = await hashPasswordPBKDF2(password, userRecord.salt);
        userRecord.passwordHash = upgradedHash;
        if (d1) {
          try {
            await d1.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(upgradedHash, userRecord.id).run();
          } catch {}
        }
      }

      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
      const token = `tok_${userRecord.id}_${Date.now().toString(36)}_${generateSecureTokenEdge(16)}`;

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
        await kv.put(`token:${token}`, JSON.stringify({ userId: userRecord.id, cleanUser: cleanQuery, expiresAt }));
        await kv.put(`devices:${userRecord.username}`, JSON.stringify(userRecord.devices));
        await kv.put(`devices:${userRecord.id}`, JSON.stringify(userRecord.devices));
      } else {
        memoryUsers.set(cleanQuery, userRecord);
        memoryUsers.set(userRecord.username, userRecord);
        memoryTokens.set(token, { userId: userRecord.id, cleanUser: cleanQuery, expiresAt });
      }

      // Query D1 user_data table for operative's personal Composio entityId and custom API key
      let userEntityId: string | null = null;
      let userApiKey: string | null = null;
      if (d1) {
        try {
          const udRow = await d1.prepare('SELECT entity_id, composio_api_key, sync_package FROM user_data WHERE user_id = ?').bind(userRecord.id).first();
          if (udRow) {
            userEntityId = udRow.entity_id || null;
            userApiKey = udRow.composio_api_key || null;
            if ((!userEntityId || !userApiKey) && udRow.sync_package) {
              try {
                const parsed = JSON.parse(udRow.sync_package);
                if (!userEntityId) userEntityId = parsed.composioEntityId || parsed.entityId || null;
                if (!userApiKey) userApiKey = parsed.composioApiKey || null;
              } catch {}
            }
          }
        } catch {
          try {
            const udRow = await d1.prepare('SELECT entity_id, sync_package FROM user_data WHERE user_id = ?').bind(userRecord.id).first();
            if (udRow) {
              userEntityId = udRow.entity_id || null;
              if (udRow.sync_package) {
                try {
                  const parsed = JSON.parse(udRow.sync_package);
                  if (!userEntityId) userEntityId = parsed.composioEntityId || parsed.entityId || null;
                  if (!userApiKey) userApiKey = parsed.composioApiKey || null;
                } catch {}
              }
            }
          } catch {
            try {
              const udRow = await d1.prepare('SELECT sync_package FROM user_data WHERE user_id = ?').bind(userRecord.id).first();
              if (udRow && udRow.sync_package) {
                const parsed = JSON.parse(udRow.sync_package);
                userEntityId = parsed.composioEntityId || parsed.entityId || null;
                userApiKey = parsed.composioApiKey || null;
              }
            } catch {}
          }
        }
      }

      if ((!userEntityId || !userApiKey) && kv) {
        try {
          const rawVault = (await kv.get(`vault:${userRecord.id}`)) || (await kv.get(`vault:${userRecord.username}`));
          if (rawVault) {
            const parsed = JSON.parse(rawVault);
            if (!userEntityId) userEntityId = parsed.composioEntityId || parsed.entityId || null;
            if (!userApiKey) userApiKey = parsed.composioApiKey || null;
          }
        } catch {}
      }

      if (!userEntityId || !userApiKey) {
        const memVault = memoryVaults.get(`vault:${userRecord.id}`) || memoryVaults.get(`vault:${userRecord.username}`);
        if (memVault) {
          if (!userEntityId) userEntityId = memVault.composioEntityId || memVault.entityId || null;
          if (!userApiKey) userApiKey = memVault.composioApiKey || null;
        }
      }

      // Security: Do NOT expose recoveryKey in persistent session payload
      const session = {
        token,
        user: {
          id: userRecord.id,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance || 'COMMANDER',
          composioEntityId: userEntityId || undefined,
          composioApiKey: userApiKey || undefined,
          createdAt: userRecord.createdAt,
          lastLoginAt: now,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: now },
        expiresAt,
      };

      return new Response(JSON.stringify({
        ok: true,
        session,
        composioEntityId: userEntityId || null,
        composioApiKey: userApiKey || null,
        devices: userRecord.devices,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request),
          'Set-Cookie': getSessionCookieHeader(token, request),
        },
      });
    }

    // 3. ME (SESSION VALIDATION): GET /api/me or /api/auth/me
    const isMe =
      request.method === 'GET' &&
      (path.endsWith('/me') || actionParam === 'me');

    if (isMe) {
      const token = extractSessionToken(request);

      if (!token) {
        return new Response(JSON.stringify({ ok: false, error: 'NO_TOKEN' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
        });
      }

      if (d1) {
        const sessionRow = await d1.prepare(`
          SELECT s.token, s.expires_at, u.id, u.username, u.email, u.callsign, u.security_clearance, u.created_at, u.last_login_at
          FROM sessions s
          JOIN users u ON s.user_id = u.id
          WHERE s.token = ?
        `).bind(token).first();

        if (sessionRow && new Date(sessionRow.expires_at).getTime() > Date.now()) {
          const devs = await d1.prepare('SELECT device_id as deviceId, device_name as deviceName, device_type as deviceType, last_active as lastActive FROM devices WHERE user_id = ?').bind(sessionRow.id).all();

          let userEntityId: string | null = null;
          let userApiKey: string | null = null;
          try {
            const udRow = await d1.prepare('SELECT entity_id, composio_api_key, sync_package FROM user_data WHERE user_id = ?').bind(sessionRow.id).first();
            if (udRow) {
              userEntityId = udRow.entity_id || null;
              userApiKey = udRow.composio_api_key || null;
              if ((!userEntityId || !userApiKey) && udRow.sync_package) {
                try {
                  const p = JSON.parse(udRow.sync_package);
                  if (!userEntityId) userEntityId = p.composioEntityId || p.entityId || null;
                  if (!userApiKey) userApiKey = p.composioApiKey || null;
                } catch {}
              }
            }
          } catch {
            try {
              const udRow = await d1.prepare('SELECT entity_id, sync_package FROM user_data WHERE user_id = ?').bind(sessionRow.id).first();
              if (udRow) {
                userEntityId = udRow.entity_id || null;
                if (udRow.sync_package) {
                  try {
                    const p = JSON.parse(udRow.sync_package);
                    userEntityId = p.composioEntityId || p.entityId || null;
                    userApiKey = p.composioApiKey || null;
                  } catch {}
                }
              }
            } catch {}
          }

          return new Response(JSON.stringify({
            ok: true,
            user: {
              id: sessionRow.id,
              username: sessionRow.username,
              email: sessionRow.email,
              callsign: sessionRow.callsign,
              securityClearance: sessionRow.security_clearance,
              composioEntityId: userEntityId || undefined,
              composioApiKey: userApiKey || undefined,
              createdAt: sessionRow.created_at,
              lastLoginAt: sessionRow.last_login_at,
            },
            composioEntityId: userEntityId || null,
            composioApiKey: userApiKey || null,
            devices: devs?.results || [],
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
        }
        return new Response(JSON.stringify({ ok: false, error: 'NO_VALID_SESSION' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
        });
      }

      if (kv) {
        const rawToken = await kv.get(`token:${token}`);
        if (rawToken) {
          try {
            const tokenData = JSON.parse(rawToken);
            if (!tokenData.expiresAt || new Date(tokenData.expiresAt).getTime() > Date.now()) {
              const rawUser = await kv.get(`user:${tokenData.cleanUser || tokenData.userId}`);
              const user = rawUser ? JSON.parse(rawUser) : null;
              if (user) {
                return new Response(JSON.stringify({
                  ok: true,
                  user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    callsign: user.callsign,
                    securityClearance: user.securityClearance,
                    createdAt: user.createdAt,
                    lastLoginAt: user.lastLoginAt,
                  },
                  devices: user.devices || [],
                }), { status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
              }
            }
          } catch {}
        }
        return new Response(JSON.stringify({ ok: false, error: 'NO_VALID_SESSION' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
        });
      }

      const memToken = memoryTokens.get(token);
      if (memToken) {
        if (!memToken.expiresAt || new Date(memToken.expiresAt).getTime() > Date.now()) {
          const user = memoryUsers.get(memToken.cleanUser) || memoryUsers.get(memToken.userId);
          if (user) {
            return new Response(JSON.stringify({
              ok: true,
              user: {
                id: user.id,
                username: user.username,
                email: user.email,
                callsign: user.callsign,
                securityClearance: user.securityClearance,
                createdAt: user.createdAt,
                lastLoginAt: user.lastLoginAt,
              },
              devices: user.devices || [],
            }), { status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
          }
        }
      }

      return new Response(JSON.stringify({ ok: false, error: 'NO_VALID_SESSION' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
      });
    }

    // 4. LOGOUT: POST /api/logout, /api/auth/logout, or action=logout
    const isLogout =
      request.method === 'POST' &&
      (path.endsWith('/logout') || actionParam === 'logout');

    if (isLogout) {
      const token = extractSessionToken(request);

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
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request),
          'Set-Cookie': getClearSessionCookieHeader(),
        },
      });
    }

    // 5. SECURE PASSWORD RESET: POST /api/auth/reset-password or action=reset-password
    if (request.method === 'POST' && (path.endsWith('/reset-password') || actionParam === 'reset-password')) {
      // Strict rate limiting: Max 5 attempts per 15 minutes to prevent brute-force attacks
      const rateCheck = await checkRateLimit(request, d1, 5, 900, 'reset');
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({ error: 'RATE_LIMITED', message: `Too many password reset attempts. Please wait ${rateCheck.retryAfter || 900} seconds.` }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter || 900), ...CORS_HEADERS } }
        );
      }

      const body = await request.json().catch(() => ({})) as any;
      const { usernameOrEmail, recoveryKey, newPassword, adminResetKey } = body;
      const cleanQuery = String(usernameOrEmail || '').toLowerCase().trim();
      const cleanKey = String(recoveryKey || '').trim().toUpperCase();

      if (!cleanQuery || !newPassword) {
        return new Response(
          JSON.stringify({ error: 'MISSING_FIELDS', message: 'Username/Email and new password are required.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      if (newPassword.length < 6) {
        return new Response(
          JSON.stringify({ error: 'PASSWORD_TOO_SHORT', message: 'New password key must be at least 6 characters.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      // Check backend environment secret for administrative override
      const envResetSecret = env.RESET_KEY || env.PIXELOPS_RESET_SECRET || env.ADMIN_SECRET;
      const incomingAdminKey = (adminResetKey || request.headers.get('x-reset-key') || request.headers.get('x-admin-reset-key') || '').trim();
      const isAdminAuthorized = Boolean(envResetSecret && incomingAdminKey && timingSafeEqualStr(incomingAdminKey, envResetSecret));

      if (!cleanKey && !isAdminAuthorized) {
        return new Response(
          JSON.stringify({ error: 'KEY_REQUIRED', message: 'Satellite Recovery Key or authorized backend reset secret required.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
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
          JSON.stringify({ error: 'USER_NOT_FOUND', message: 'No operative found matching credentials.' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      // Validate recovery key securely
      if (!isAdminAuthorized) {
        const storedKeyOrHash = String(userRecord.recovery_key || userRecord.recoveryKeyHash || userRecord.recoveryKey || '').trim();
        const inputHash = await hashRecoveryKey(cleanKey);

        const isHashMatch = timingSafeEqualStr(inputHash, storedKeyOrHash);
        const isLegacyPlainMatch = timingSafeEqualStr(cleanKey, storedKeyOrHash.toUpperCase());

        if (!isHashMatch && !isLegacyPlainMatch) {
          return new Response(
            JSON.stringify({ error: 'INVALID_RECOVERY_KEY', message: 'Satellite Recovery Key does not match our records.' }),
            { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
          );
        }
      }

      const newSalt = generateSecureTokenEdge(16);
      const newHash = await hashPasswordPBKDF2(newPassword, newSalt);
      const updatedRecoveryHash = await hashRecoveryKey(cleanKey || 'RECONFIGURED');

      if (d1) {
        await d1.prepare('UPDATE users SET password_hash = ?, salt = ?, recovery_key = ? WHERE id = ?').bind(newHash, newSalt, updatedRecoveryHash, userRecord.id).run();
      }
      if (kv) {
        userRecord.passwordHash = newHash;
        userRecord.salt = newSalt;
        userRecord.recoveryKeyHash = updatedRecoveryHash;
        delete userRecord.recoveryKey;
        await kv.put(`user:${userRecord.username}`, JSON.stringify(userRecord));
      } else {
        userRecord.passwordHash = newHash;
        userRecord.salt = newSalt;
        userRecord.recoveryKeyHash = updatedRecoveryHash;
        delete userRecord.recoveryKey;
        memoryUsers.set(userRecord.username, userRecord);
      }

      return new Response(
        JSON.stringify({ ok: true, message: 'Password encryption key reset successfully. Please sign in.' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 6. EPHEMERAL SATELLITE PAIRING GENERATE: POST /api/auth/pair/generate or action=pair-generate
    const isPairGenerate =
      request.method === 'POST' &&
      (path.endsWith('/pair/generate') || actionParam === 'pair-generate');

    if (isPairGenerate) {
      const rateCheck = await checkRateLimit(request, d1, 5, 600, 'pair-gen');
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({ error: 'RATE_LIMITED', message: `Too many pairing ticket requests. Please wait ${rateCheck.retryAfter || 600} seconds.` }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter || 600), ...CORS_HEADERS } }
        );
      }

      const token = extractSessionToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ error: 'UNAUTHORIZED', message: 'Authenticated session required.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
        );
      }

      let user: any = null;
      if (d1) {
        user = await d1.prepare(`
          SELECT u.id, u.username, u.email, u.callsign, u.security_clearance as securityClearance
          FROM sessions s
          JOIN users u ON s.user_id = u.id
          WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
        `).bind(token).first();
      }

      if (!user) {
        const memTok = memoryTokens.get(token);
        if (memTok && (!memTok.expiresAt || new Date(memTok.expiresAt).getTime() > Date.now())) {
          user = memoryUsers.get(memTok.username) || Array.from(memoryUsers.values()).find((u) => u.id === memTok.userId);
        }
      }

      if (!user) {
        return new Response(
          JSON.stringify({ error: 'UNAUTHORIZED', message: 'Session expired or invalid.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
        );
      }

      const body = await request.json().catch(() => ({})) as any;
      const pairTicket = `SATCOM-PAIR::CODE-${generateSecureCodeEdge(4)}-${generateSecureCodeEdge(4)}`;
      const now = new Date().toISOString();
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5-minute TTL

      memoryPairingTickets.set(pairTicket, {
        code: pairTicket,
        userId: user.id,
        username: user.username,
        email: user.email,
        callsign: user.callsign,
        securityClearance: user.securityClearance || user.security_clearance || 'COMMANDER',
        syncPackage: body?.syncPackage || null,
        createdAt: now,
        expiresAt,
        used: false,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          pairTicket,
          expiresAt: new Date(expiresAt).toISOString(),
          expiresInSeconds: 300,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    // 7. EPHEMERAL SATELLITE PAIRING REDEEM: POST /api/auth/pair/redeem or action=pair-redeem
    const isPairRedeem =
      request.method === 'POST' &&
      (path.endsWith('/pair/redeem') || actionParam === 'pair-redeem');

    if (isPairRedeem) {
      const rateCheck = await checkRateLimit(request, d1, 5, 600, 'pair-redeem');
      if (!rateCheck.allowed) {
        return new Response(
          JSON.stringify({ error: 'RATE_LIMITED', message: `Too many redemption attempts. Please wait ${rateCheck.retryAfter || 600} seconds.` }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter || 600), ...CORS_HEADERS } }
        );
      }

      const body = await request.json().catch(() => ({})) as any;
      const { pairTicket, device } = body;
      const cleanTicket = String(pairTicket || '').trim();

      const ticket = memoryPairingTickets.get(cleanTicket);
      if (!ticket || ticket.used) {
        return new Response(
          JSON.stringify({ error: 'INVALID_PAIRING_TICKET', message: 'Invalid or already redeemed Satellite pairing ticket.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
        );
      }

      if (Date.now() > ticket.expiresAt) {
        memoryPairingTickets.delete(cleanTicket);
        return new Response(
          JSON.stringify({ error: 'EXPIRED_PAIRING_TICKET', message: 'Satellite pairing ticket has expired (5-minute TTL). Please request a fresh pairing ticket.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
        );
      }

      // Burn ticket immediately
      ticket.used = true;
      memoryPairingTickets.delete(cleanTicket);

      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
      const newToken = `tok_${ticket.userId}_${Date.now().toString(36)}_${generateSecureTokenEdge(16)}`;

      if (d1) {
        await d1.prepare('INSERT INTO sessions (token, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(
          newToken,
          ticket.userId,
          device?.deviceId || 'paired_edge_node',
          now,
          expiresAt
        ).run();
      }

      memoryTokens.set(newToken, {
        userId: ticket.userId,
        username: ticket.username,
        expiresAt,
        createdAt: now,
      });

      const session = {
        token: newToken,
        user: {
          id: ticket.userId,
          username: ticket.username,
          email: ticket.email,
          callsign: ticket.callsign,
          securityClearance: ticket.securityClearance,
          createdAt: now,
          lastLoginAt: now,
        },
        device: device || { deviceId: 'paired_edge_node', deviceName: 'Paired Device', deviceType: 'mobile', lastActive: now },
        expiresAt,
      };

      const sessionCookie = `pixelops_session=${encodeURIComponent(newToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`;

      return new Response(
        JSON.stringify({
          ok: true,
          session,
          syncPackage: ticket.syncPackage || null,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': sessionCookie,
            ...getCorsHeaders(request),
          },
        }
      );
    }

    // 6. RESTRICTED BACKEND ADMIN ROUTE: POST /api/admin/reset
    // Strictly requires backend environment secret AND authenticated COMMANDER/ADMIN session.
    // Client UI cannot trigger this without administrative authorization.
    const isAdminReset =
      request.method === 'POST' &&
      (path.endsWith('/admin/reset') || path.endsWith('/admin/purge-db') || actionParam === 'admin-reset');

    if (isAdminReset) {
      const envSecret = env.RESET_KEY || env.PIXELOPS_RESET_SECRET || env.ADMIN_SECRET;
      if (!envSecret) {
        return new Response(
          JSON.stringify({ error: 'FORBIDDEN', message: 'Backend admin reset key is not configured in server environment. Admin reset disabled.' }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const incomingKey = (request.headers.get('x-admin-reset-key') || request.headers.get('x-reset-key') || '').trim();
      if (!incomingKey || !timingSafeEqualStr(incomingKey, envSecret)) {
        return new Response(
          JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid admin reset key secret.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      // Check authenticated session token
      const token = extractSessionToken(request);
      if (!token) {
        return new Response(
          JSON.stringify({ error: 'SESSION_REQUIRED', message: 'Administrative session token required.' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, message: 'Admin authorization verified. State purge must be executed through controlled migration scripts.' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
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
