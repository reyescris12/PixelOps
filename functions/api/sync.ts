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
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-device-id',
};

function getKv(env: Env) {
  return env.SYNC_KV || env.PIXELOPS_KV || env.KV || env.STORAGE || env.DB;
}

// Memory fallback store
const memoryVaults = new Map<string, any>();
const memoryDevices = new Map<string, any[]>();

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
  const userId = request.headers.get('x-user-id') || url.searchParams.get('userId') || 'default_user';
  const deviceId = request.headers.get('x-device-id') || 'default_device';

  try {
    // 1. PUSH: POST /api/sync/push or /api/sync?action=push
    if (request.method === 'POST' && (path.endsWith('/push') || url.searchParams.get('action') === 'push')) {
      const syncPackage = await request.json().catch(() => null);
      if (!syncPackage) {
        return new Response(
          JSON.stringify({ error: 'PACKAGE_REQUIRED', message: 'Sync payload is empty.' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const storageKey = `vault:${userId}`;
      if (kv) {
        await kv.put(storageKey, JSON.stringify(syncPackage));
      } else {
        memoryVaults.set(storageKey, syncPackage);
      }

      // Record device heartbeat
      const deviceEntry = {
        deviceId,
        lastActive: new Date().toISOString(),
      };
      if (kv) {
        await kv.put(`device:${userId}:${deviceId}`, JSON.stringify(deviceEntry));
      }

      return new Response(
        JSON.stringify({ ok: true, timestamp: new Date().toISOString() }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 2. PULL: GET /api/sync/pull or /api/sync?action=pull
    if (request.method === 'GET' && (path.endsWith('/pull') || url.searchParams.get('action') === 'pull' || path.endsWith('/sync'))) {
      const storageKey = `vault:${userId}`;
      let pkg: any = null;

      if (kv) {
        const raw = await kv.get(storageKey);
        if (raw) pkg = JSON.parse(raw);
      } else {
        pkg = memoryVaults.get(storageKey);
      }

      return new Response(
        JSON.stringify({ ok: true, package: pkg || null, timestamp: new Date().toISOString() }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 3. DEVICES: GET /api/sync/devices
    if (request.method === 'GET' && path.endsWith('/devices')) {
      let devices: any[] = [];
      const userKey = `devices:${userId}`;
      if (kv) {
        const raw = await kv.get(userKey);
        if (raw) devices = JSON.parse(raw);
      } else {
        devices = memoryDevices.get(userKey) || [];
      }

      return new Response(
        JSON.stringify({ ok: true, devices }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // 4. UNLINK: POST /api/sync/device/unlink
    if (request.method === 'POST' && path.endsWith('/unlink')) {
      const body = await request.json().catch(() => ({})) as any;
      const { targetDeviceId } = body;
      const userKey = `devices:${userId}`;

      if (kv) {
        const raw = await kv.get(userKey);
        if (raw) {
          const list = JSON.parse(raw).filter((d: any) => d.deviceId !== targetDeviceId);
          await kv.put(userKey, JSON.stringify(list));
        }
      } else {
        const list = (memoryDevices.get(userKey) || []).filter((d) => d.deviceId !== targetDeviceId);
        memoryDevices.set(userKey, list);
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
