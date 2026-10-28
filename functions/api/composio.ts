/**
 * Cloudflare Pages Function Proxy for Multi-User Composio API
 * Route: /api/composio
 *
 * Proxies calls to https://backend.composio.dev/api/v3
 * Enforces per-user entityId isolation so multi-user external callers
 * on pixelops.app cannot access each other's OAuth connections.
 */

interface Env {
  COMPOSIO_API_KEY?: string;
}

interface ComposioProxyPayload {
  endpoint: string; // e.g., '/connectedAccounts', '/actions/GITHUB_CREATE_ISSUE/execute'
  method?: string; // 'GET' | 'POST' | 'DELETE' | 'PATCH'
  body?: Record<string, any> | null;
  entityId: string; // user's unique commander UUID (e.g., 'commander_...')
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-composio-api-key, x-entity-id',
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  // Read server-side key from Cloudflare env or caller-supplied header override
  const apiKey =
    request.headers.get('x-composio-api-key')?.trim() ||
    env.COMPOSIO_API_KEY?.trim();

  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'COMPOSIO_API_KEY_MISSING',
        message:
          'No Composio API key configured. Provide COMPOSIO_API_KEY in Cloudflare Pages environment variables, or supply x-composio-api-key in the request header via client BYOK.',
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      }
    );
  }

  try {
    let payload: ComposioProxyPayload;
    if (request.method === 'POST') {
      payload = (await request.json()) as ComposioProxyPayload;
    } else {
      const url = new URL(request.url);
      payload = {
        endpoint: url.searchParams.get('endpoint') || '',
        method: request.method,
        entityId:
          request.headers.get('x-entity-id') ||
          url.searchParams.get('entityId') ||
          '',
      };
    }

    const { endpoint, method = 'POST', body, entityId } = payload;

    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: 'ENDPOINT_REQUIRED', message: 'Missing target endpoint parameter.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    if (!entityId || !entityId.trim()) {
      return new Response(
        JSON.stringify({
          error: 'ENTITY_ID_REQUIRED',
          message: 'Caller unique entityId is mandatory for multi-user isolation.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Build target URL
    let cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    // Strip leading /api/v2 or /api/v3 if present in endpoint
    cleanEndpoint = cleanEndpoint.replace(/^\/api\/v2/, '').replace(/^\/api\/v3/, '');
    // Normalize v2 paths to v3
    if (cleanEndpoint.startsWith('/connectedAccounts')) {
      cleanEndpoint = cleanEndpoint.replace('/connectedAccounts', '/connected_accounts');
    }

    const baseUrl = 'https://backend.composio.dev/api/v3';
    
    // Enforce entityId scoping for connected_accounts and tool/action executions
    let targetUrl = `${baseUrl}${cleanEndpoint}`;
    let modifiedBody = body ? { ...body } : undefined;

    if (cleanEndpoint.startsWith('/connected_accounts')) {
      if (method.toUpperCase() === 'GET') {
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}user_uuid=${encodeURIComponent(entityId)}&user_id=${encodeURIComponent(entityId)}`;
      } else if (method.toUpperCase() === 'POST' && modifiedBody) {
        modifiedBody.user_uuid = entityId;
        modifiedBody.user_id = entityId;
        modifiedBody.entityId = entityId;
      }
    } else if ((cleanEndpoint.includes('/execute') || cleanEndpoint.includes('/tools/')) && modifiedBody) {
      modifiedBody.entityId = entityId;
      modifiedBody.user_uuid = entityId;
      modifiedBody.user_id = entityId;
    }

    const composioHeaders: Record<string, string> = {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: composioHeaders,
    };

    if (modifiedBody && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      fetchOptions.body = JSON.stringify(modifiedBody);
    }

    const composioResponse = await fetch(targetUrl, fetchOptions);
    const responseData = await composioResponse.text();

    return new Response(responseData, {
      status: composioResponse.status,
      headers: {
        'Content-Type': composioResponse.headers.get('Content-Type') || 'application/json',
        ...CORS_HEADERS,
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'COMPOSIO_PROXY_FAULT',
        message: err?.message || 'Failed to proxy request to Composio backend.',
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      }
    );
  }
};
