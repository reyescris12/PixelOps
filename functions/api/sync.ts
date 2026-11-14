/**
 * Cloudflare Pages Function: /api/sync
 * Handles multi-device cloud synchronization push, pull, and device fleet tracking
 * with full Cloudflare D1 SQL, Cloudflare KV, and memory fallback support.
 */

import { requireTier } from './_entitlements';

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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-username, x-device-id, x-device-name, x-device-type, x-entity-id, x-composio-api-key',
};

function getKv(env: Env) {
  return env.SYNC_KV || env.PIXELOPS_KV || env.KV || env.STORAGE || env.DATA;
}

function getD1(env: Env) {
  return env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
}

// Memory fallback store
const memoryVaults = new Map<string, any>();
const memoryDevices = new Map<string, any[]>();
const memoryTokens = new Map<string, any>();

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

  // Resolve userKey through x-username, Bearer token, or x-user-id
  let userKey = (request.headers.get('x-username') || url.searchParams.get('username') || '').toLowerCase().trim();
  const rawUserId = request.headers.get('x-user-id') || url.searchParams.get('userId') || '';
  const deviceId = request.headers.get('x-device-id') || 'default_device';
  const deviceName = request.headers.get('x-device-name') || 'Satellite Node';
  const deviceType = request.headers.get('x-device-type') || 'desktop';

  if (!userKey) {
    const authHeader = request.headers.get('Authorization') || '';
    let token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      const cookieHeader = request.headers.get('Cookie') || '';
      const match = cookieHeader.match(/(?:^|;\s*)pixelops_session=([^;]+)/);
      if (match) {
        token = decodeURIComponent(match[1].trim());
      }
    }
    if (token) {
      if (d1) {
        const row = await d1.prepare(`
          SELECT u.username, u.id FROM sessions s
          JOIN users u ON s.user_id = u.id
          WHERE s.token = ?
        `).bind(token).first();
        if (row) userKey = row.username || row.id;
      }
      if (!userKey && kv) {
        const rawToken = await kv.get(`token:${token}`);
        if (rawToken) {
          try {
            const parsed = JSON.parse(rawToken);
            userKey = parsed.cleanUser || parsed.userId;
          } catch {}
        }
      }
      if (!userKey) {
        const parsed = memoryTokens.get(token);
        if (parsed) userKey = parsed.cleanUser || parsed.userId;
      }
    }
  }

  if (!userKey) {
    userKey = (rawUserId || 'default_user').toLowerCase().trim();
  }

  try {
    // 1. PUSH: POST /api/sync/push, /api/sync?action=push, or POST /api/sync
    const isPush =
      request.method === 'POST' &&
      (path.endsWith('/push') || actionParam === 'push' || path.endsWith('/sync'));

    if (isPush) {
      // Enforce Pro+ entitlement so free 'operative' accounts remain 100% local-first at $0 server storage cost
      const tierGuard = await requireTier(request, env, 'pro');
      if (!tierGuard.ok) {
        return new Response(
          JSON.stringify({
            error: 'UPGRADE_REQUIRED',
            requiredTier: 'pro',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }
      if (tierGuard.user?.username) {
        userKey = tierGuard.user.username.toLowerCase().trim();
      }
      const syncPackage = await request.json().catch(() => null) as any;
      if (!syncPackage) {
        return new Response(
          JSON.stringify({ error: 'PACKAGE_REQUIRED', message: 'Sync payload is empty.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const now = new Date().toISOString();
      const incomingEntityId = syncPackage.composioEntityId || syncPackage.entityId || request.headers.get('x-entity-id') || null;
      if (incomingEntityId) {
        syncPackage.composioEntityId = incomingEntityId;
      }
      const incomingApiKey = syncPackage.composioApiKey || request.headers.get('x-composio-api-key') || null;
      if (incomingApiKey) {
        syncPackage.composioApiKey = incomingApiKey;
      }

      // Ensure deletedWorkspaceFilePaths tombstones strip any stale files in the pushed package
      const deletedFilesMap: Record<string, string> = syncPackage.deletedWorkspaceFilePaths || {};
      if (Array.isArray(syncPackage.workspaceFiles) && Object.keys(deletedFilesMap).length > 0) {
        syncPackage.workspaceFiles = syncPackage.workspaceFiles.filter((f: any) => {
          const norm = String(f?.path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
          const delTs = deletedFilesMap[norm];
          if (!delTs) return true;
          return new Date(f?.updatedAt || 0).getTime() > new Date(delTs).getTime();
        });
      }

      const incomingDevice = syncPackage.device || {
        deviceId,
        deviceName,
        deviceType,
        lastActive: now,
      };

      if (d1) {
        let dbUserId = rawUserId;
        const u = await d1.prepare('SELECT id FROM users WHERE username = ? OR id = ?').bind(userKey, userKey).first();
        if (u) dbUserId = u.id;
        if (!dbUserId) dbUserId = userKey;

        // Ensure user row exists in users table to satisfy foreign keys
        try {
          await d1.prepare(`
            INSERT INTO users (id, username, email, callsign, password_hash, salt, recovery_key, security_clearance, created_at, last_login_at)
            VALUES (?, ?, ?, ?, 'MIGRATED', 'MIGRATED', 'MIGRATED', 'COMMANDER', ?, ?)
            ON CONFLICT(id) DO NOTHING
          `).bind(dbUserId, userKey, `${userKey}@pixelops.local`, userKey.toUpperCase(), now, now).run();
        } catch {}

        // Store sync package alongside user's Composio entityId and custom API key in Cloudflare D1 user_data table
        try {
          await d1.prepare(`
            INSERT INTO user_data (user_id, entity_id, composio_api_key, sync_package, version, updated_at)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(user_id) DO UPDATE SET 
              entity_id = COALESCE(excluded.entity_id, user_data.entity_id),
              composio_api_key = COALESCE(excluded.composio_api_key, user_data.composio_api_key),
              sync_package = excluded.sync_package, 
              updated_at = excluded.updated_at
          `).bind(dbUserId, incomingEntityId, incomingApiKey, JSON.stringify(syncPackage), now).run();
        } catch {
          try {
            await d1.prepare("ALTER TABLE user_data ADD COLUMN entity_id TEXT").run();
          } catch {}
          try {
            await d1.prepare("ALTER TABLE user_data ADD COLUMN composio_api_key TEXT").run();
          } catch {}
          try {
            await d1.prepare(`
              INSERT INTO user_data (user_id, entity_id, composio_api_key, sync_package, version, updated_at)
              VALUES (?, ?, ?, ?, 1, ?)
              ON CONFLICT(user_id) DO UPDATE SET 
                entity_id = COALESCE(excluded.entity_id, user_data.entity_id),
                composio_api_key = COALESCE(excluded.composio_api_key, user_data.composio_api_key),
                sync_package = excluded.sync_package, 
                updated_at = excluded.updated_at
            `).bind(dbUserId, incomingEntityId, incomingApiKey, JSON.stringify(syncPackage), now).run();
          } catch {
            await d1.prepare(`
              INSERT INTO user_data (user_id, sync_package, version, updated_at)
              VALUES (?, ?, 1, ?)
              ON CONFLICT(user_id) DO UPDATE SET sync_package = excluded.sync_package, updated_at = excluded.updated_at
            `).bind(dbUserId, JSON.stringify(syncPackage), now).run();
          }
        }

        await d1.prepare(`
          INSERT INTO devices (device_id, user_id, device_name, device_type, last_active)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, device_id) DO UPDATE SET last_active = excluded.last_active, device_name = excluded.device_name
        `).bind(incomingDevice.deviceId, dbUserId, incomingDevice.deviceName, incomingDevice.deviceType, now).run();
      }

      const storageKey = `vault:${userKey}`;
      if (kv) {
        await kv.put(storageKey, JSON.stringify(syncPackage));
        if (rawUserId && rawUserId !== userKey) {
          await kv.put(`vault:${rawUserId}`, JSON.stringify(syncPackage));
        }
      } else {
        memoryVaults.set(storageKey, syncPackage);
        if (rawUserId && rawUserId !== userKey) {
          memoryVaults.set(`vault:${rawUserId}`, syncPackage);
        }
      }

      // Upsert into device fleet registry
      const devListKey = `devices:${userKey}`;
      let devicesList: any[] = [];
      if (kv) {
        const rawDevs = await kv.get(devListKey);
        if (rawDevs) {
          try { devicesList = JSON.parse(rawDevs); } catch {}
        }
      } else {
        devicesList = memoryDevices.get(devListKey) || [];
      }

      const devIdx = devicesList.findIndex((d: any) => d.deviceId === incomingDevice.deviceId);
      if (devIdx >= 0) {
        devicesList[devIdx] = {
          ...devicesList[devIdx],
          ...incomingDevice,
          lastActive: now,
        };
      } else {
        devicesList.push(incomingDevice);
      }

      if (kv) {
        await kv.put(devListKey, JSON.stringify(devicesList));
        if (rawUserId && rawUserId !== userKey) {
          await kv.put(`devices:${rawUserId}`, JSON.stringify(devicesList));
        }
      } else {
        memoryDevices.set(devListKey, devicesList);
        if (rawUserId && rawUserId !== userKey) {
          memoryDevices.set(`devices:${rawUserId}`, devicesList);
        }
      }

      return new Response(
        JSON.stringify({ ok: true, timestamp: now, devicesCount: devicesList.length }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 2. PULL: GET /api/sync/pull, /api/sync?action=pull, or GET /api/sync (without action or action=pull)
    const isPull =
      request.method === 'GET' &&
      (path.endsWith('/pull') || actionParam === 'pull' || (path.endsWith('/sync') && actionParam !== 'devices'));

    if (isPull) {
      // Enforce Pro+ entitlement on GET cloud state sync
      const tierGuard = await requireTier(request, env, 'pro');
      if (!tierGuard.ok) {
        return new Response(
          JSON.stringify({
            error: 'UPGRADE_REQUIRED',
            requiredTier: 'pro',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }
      if (tierGuard.user?.username) {
        userKey = tierGuard.user.username.toLowerCase().trim();
      }
      let pkg: any = null;
      let resolvedEntityId: string | null = null;
      let resolvedApiKey: string | null = null;

      if (d1) {
        let dbUserId = rawUserId;
        const u = await d1.prepare('SELECT id FROM users WHERE username = ? OR id = ?').bind(userKey, userKey).first();
        if (u) dbUserId = u.id;
        if (!dbUserId) dbUserId = userKey;

        let row: any = null;
        try {
          row = await d1.prepare('SELECT entity_id, composio_api_key, sync_package FROM user_data WHERE user_id = ?').bind(dbUserId).first();
        } catch {
          try {
            row = await d1.prepare('SELECT entity_id, sync_package FROM user_data WHERE user_id = ?').bind(dbUserId).first();
          } catch {
            row = await d1.prepare('SELECT sync_package FROM user_data WHERE user_id = ?').bind(dbUserId).first();
          }
        }

        if (row) {
          resolvedEntityId = row.entity_id || null;
          resolvedApiKey = row.composio_api_key || null;
          if (row.sync_package) {
            try {
              pkg = JSON.parse(row.sync_package);
              if (resolvedEntityId && pkg) {
                pkg.composioEntityId = resolvedEntityId;
              } else if (!resolvedEntityId && pkg?.composioEntityId) {
                resolvedEntityId = pkg.composioEntityId;
              }
              if (resolvedApiKey && pkg) {
                pkg.composioApiKey = resolvedApiKey;
              } else if (!resolvedApiKey && pkg?.composioApiKey) {
                resolvedApiKey = pkg.composioApiKey;
              }
            } catch {}
          }
        }
      }

      if (!pkg && kv) {
        const storageKey = `vault:${userKey}`;
        let raw = await kv.get(storageKey);
        if (!raw && rawUserId) raw = await kv.get(`vault:${rawUserId}`);
        if (raw) {
          try {
            pkg = JSON.parse(raw);
            if (!resolvedEntityId && pkg?.composioEntityId) {
              resolvedEntityId = pkg.composioEntityId;
            }
            if (!resolvedApiKey && pkg?.composioApiKey) {
              resolvedApiKey = pkg.composioApiKey;
            }
          } catch {}
        }
      }

      if (!pkg) {
        const storageKey = `vault:${userKey}`;
        pkg = memoryVaults.get(storageKey) || (rawUserId ? memoryVaults.get(`vault:${rawUserId}`) : null);
        if (!resolvedEntityId && pkg?.composioEntityId) {
          resolvedEntityId = pkg.composioEntityId;
        }
        if (!resolvedApiKey && pkg?.composioApiKey) {
          resolvedApiKey = pkg.composioApiKey;
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          package: pkg || null,
          entityId: resolvedEntityId || pkg?.composioEntityId || null,
          composioEntityId: resolvedEntityId || pkg?.composioEntityId || null,
          composioApiKey: resolvedApiKey || pkg?.composioApiKey || null,
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 3. DEVICES: GET /api/sync/devices or GET /api/sync?action=devices
    const isDevices =
      request.method === 'GET' &&
      (path.endsWith('/devices') || actionParam === 'devices');

    if (isDevices) {
      let devices: any[] = [];

      if (d1) {
        let dbUserId = rawUserId;
        const u = await d1.prepare('SELECT id FROM users WHERE username = ? OR id = ?').bind(userKey, userKey).first();
        if (u) dbUserId = u.id;
        if (!dbUserId) dbUserId = userKey;

        const rows = await d1.prepare('SELECT device_id as deviceId, device_name as deviceName, device_type as deviceType, last_active as lastActive FROM devices WHERE user_id = ?').bind(dbUserId).all();
        if (rows && rows.results && rows.results.length > 0) {
          devices = rows.results;
        }
      }

      if (devices.length === 0) {
        const devListKey = `devices:${userKey}`;
        if (kv) {
          let raw = await kv.get(devListKey);
          if (!raw && rawUserId) raw = await kv.get(`devices:${rawUserId}`);
          if (raw) {
            try { devices = JSON.parse(raw); } catch {}
          }
        } else {
          devices = memoryDevices.get(devListKey) || (rawUserId ? memoryDevices.get(`devices:${rawUserId}`) : []) || [];
        }

        if (devices.length === 0 && kv) {
          const rawUser = await kv.get(`user:${userKey}`);
          if (rawUser) {
            try {
              const u = JSON.parse(rawUser);
              if (Array.isArray(u.devices)) devices = u.devices;
            } catch {}
          }
        }
      }

      return new Response(
        JSON.stringify({ ok: true, devices }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 4. UNLINK: POST /api/sync/device/unlink or action=unlink
    const isUnlink =
      request.method === 'POST' &&
      (path.endsWith('/unlink') || actionParam === 'unlink');

    if (isUnlink) {
      const body = await request.json().catch(() => ({})) as any;
      const { targetDeviceId } = body;

      if (d1) {
        let dbUserId = rawUserId;
        const u = await d1.prepare('SELECT id FROM users WHERE username = ? OR id = ?').bind(userKey, userKey).first();
        if (u) dbUserId = u.id;
        if (!dbUserId) dbUserId = userKey;

        await d1.prepare('DELETE FROM devices WHERE user_id = ? AND device_id = ?').bind(dbUserId, targetDeviceId).run();
      }

      const devListKey = `devices:${userKey}`;
      if (kv) {
        const raw = await kv.get(devListKey);
        if (raw) {
          try {
            const list = JSON.parse(raw).filter((d: any) => d.deviceId !== targetDeviceId);
            await kv.put(devListKey, JSON.stringify(list));
            if (rawUserId && rawUserId !== userKey) {
              await kv.put(`devices:${rawUserId}`, JSON.stringify(list));
            }
          } catch {}
        }
      } else {
        const list = (memoryDevices.get(devListKey) || []).filter((d) => d.deviceId !== targetDeviceId);
        memoryDevices.set(devListKey, list);
        if (rawUserId && rawUserId !== userKey) {
          memoryDevices.set(`devices:${rawUserId}`, list);
        }
      }

      return new Response(
        JSON.stringify({ ok: true, unlinked: targetDeviceId }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    return new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'Unknown sync endpoint' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'SYNC_ERROR', message: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
};
