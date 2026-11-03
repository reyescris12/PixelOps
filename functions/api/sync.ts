/**
 * Cloudflare Pages Function: /api/sync
 * Handles multi-device cloud synchronization push, pull, and device fleet tracking.
 */

interface Env {
  SYNC_KV?: any;
  PIXELOPS_KV?: any;
  KV?: any;
  STORAGE?: any;
  DB?: any;
  DATA?: any;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-username, x-device-id, x-device-name, x-device-type',
};

function getKv(env: Env) {
  return env.SYNC_KV || env.PIXELOPS_KV || env.KV || env.STORAGE || env.DB || env.DATA;
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
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      if (kv) {
        const rawToken = await kv.get(`token:${token}`);
        if (rawToken) {
          try {
            const parsed = JSON.parse(rawToken);
            userKey = parsed.cleanUser || parsed.userId;
          } catch {}
        }
      } else {
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
      const syncPackage = await request.json().catch(() => null) as any;
      if (!syncPackage) {
        return new Response(
          JSON.stringify({ error: 'PACKAGE_REQUIRED', message: 'Sync payload is empty.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
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

      const incomingDevice = syncPackage.device || {
        deviceId,
        deviceName,
        deviceType,
        lastActive: new Date().toISOString(),
      };

      const devIdx = devicesList.findIndex((d: any) => d.deviceId === incomingDevice.deviceId);
      if (devIdx >= 0) {
        devicesList[devIdx] = {
          ...devicesList[devIdx],
          ...incomingDevice,
          lastActive: new Date().toISOString(),
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
        JSON.stringify({ ok: true, timestamp: new Date().toISOString(), devicesCount: devicesList.length }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 2. PULL: GET /api/sync/pull, /api/sync?action=pull, or GET /api/sync (without action or action=pull)
    const isPull =
      request.method === 'GET' &&
      (path.endsWith('/pull') || actionParam === 'pull' || (path.endsWith('/sync') && actionParam !== 'devices'));

    if (isPull) {
      const storageKey = `vault:${userKey}`;
      let pkg: any = null;

      if (kv) {
        let raw = await kv.get(storageKey);
        if (!raw && rawUserId) raw = await kv.get(`vault:${rawUserId}`);
        if (raw) {
          try { pkg = JSON.parse(raw); } catch {}
        }
      } else {
        pkg = memoryVaults.get(storageKey) || (rawUserId ? memoryVaults.get(`vault:${rawUserId}`) : null);
      }

      return new Response(
        JSON.stringify({ ok: true, package: pkg || null, timestamp: new Date().toISOString() }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 3. DEVICES: GET /api/sync/devices or GET /api/sync?action=devices
    const isDevices =
      request.method === 'GET' &&
      (path.endsWith('/devices') || actionParam === 'devices');

    if (isDevices) {
      let devices: any[] = [];
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

      // If still empty, check user record devices
      if (devices.length === 0 && kv) {
        const rawUser = await kv.get(`user:${userKey}`);
        if (rawUser) {
          try {
            const u = JSON.parse(rawUser);
            if (Array.isArray(u.devices)) devices = u.devices;
          } catch {}
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
