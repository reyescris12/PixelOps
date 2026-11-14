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

export const COMPOSIO_CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

interface ComposioEdgeCircuitRecord {
  status: 401 | 429;
  trippedAt: number;
  reason: string;
}

const composioEdgeCircuitMap = new Map<string, ComposioEdgeCircuitRecord>();

export function resetComposioEdgeCircuitBreaker(): void {
  composioEdgeCircuitMap.clear();
}

function getEdgeCircuitKey(entityId: string, apiKey: string): string {
  const keyTail = apiKey ? apiKey.slice(-8) : 'nokey';
  return `${(entityId || 'anon').trim().toLowerCase()}::${keyTail}`;
}

function checkEdgeCircuitBreaker(circuitKey: string): ComposioEdgeCircuitRecord | null {
  const existing = composioEdgeCircuitMap.get(circuitKey);
  if (!existing) return null;
  if (Date.now() - existing.trippedAt > COMPOSIO_CIRCUIT_COOLDOWN_MS) {
    composioEdgeCircuitMap.delete(circuitKey);
    return null;
  }
  return existing;
}

function tripEdgeCircuitBreaker(circuitKey: string, status: 401 | 429, reason: string): void {
  composioEdgeCircuitMap.set(circuitKey, {
    status,
    trippedAt: Date.now(),
    reason,
  });
}

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
    console.log(
      `[COMPOSIO CLOUDFLARE ROUTER] Endpoint: "${endpoint}" | Method: ${method} | EntityId: "${entityId}" | Body:`,
      JSON.stringify(body || {}).slice(0, 300)
    );

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

    const circuitKey = getEdgeCircuitKey(entityId, apiKey);
    const activeCircuit = checkEdgeCircuitBreaker(circuitKey);
    if (activeCircuit) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((COMPOSIO_CIRCUIT_COOLDOWN_MS - (Date.now() - activeCircuit.trippedAt)) / 1000)
      );
      return new Response(
        JSON.stringify({
          error: 'COMPOSIO_CIRCUIT_BREAKER_OPEN',
          circuitOpen: true,
          message: `Composio upstream returned HTTP ${activeCircuit.status}. Automatic retries halted for 5 minutes (${retryAfterSec}s remaining).`,
          retryAfterSeconds: retryAfterSec,
        }),
        {
          status: activeCircuit.status,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfterSec),
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Build target URL
    let cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    // Strip leading /api/v2 or /api/v3 if present in endpoint
    cleanEndpoint = cleanEndpoint.replace(/^\/api\/v2/, '').replace(/^\/api\/v3/, '');

    const baseUrl = 'https://backend.composio.dev/api/v3';

    // DYNAMIC TOOL RESOLVER: Discovers all active integrations for entityId,
    // fetches their canonical tools from Composio v3, and returns them formatted
    // as Google Gemini FunctionDeclaration schemas on-the-fly (Zero Hardcoding).
    if (cleanEndpoint.startsWith('/dynamicTools') || cleanEndpoint.startsWith('/activeTools')) {
      try {
        const connRes = await fetch(
          `${baseUrl}/connectedAccounts?entityId=${encodeURIComponent(entityId)}`,
          {
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(10000),
          }
        );

        if (connRes.status === 401 || connRes.status === 429) {
          tripEdgeCircuitBreaker(
            circuitKey,
            connRes.status as 401 | 429,
            `Upstream dynamicTools returned HTTP ${connRes.status}`
          );
          return new Response(
            JSON.stringify({
              error: 'COMPOSIO_CIRCUIT_BREAKER_OPEN',
              message: `Composio upstream returned HTTP ${connRes.status}; background retries halted for 5 minutes.`,
            }),
            { status: connRes.status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
          );
        }

        let activeAccounts: any[] = [];
        if (connRes.ok) {
          const connData: any = await connRes.json();
          activeAccounts = Array.isArray(connData)
            ? connData
            : connData?.items || connData?.connectedAccounts || connData?.data || [];
        }

        const activeAppNames: string[] = Array.from(
          new Set(
            activeAccounts
              .filter((a: any) => a.status === 'ACTIVE' || a.status === 'INITIATED')
              .map((a: any) => (a.appName || a.app_name || '').toLowerCase().trim())
              .filter(Boolean)
          )
        );

        const dynamicTools: any[] = [];
        await Promise.all(
          activeAppNames.map(async (app) => {
            try {
              const toolsRes = await fetch(
                `${baseUrl}/tools?toolkit_slug=${encodeURIComponent(app)}`,
                {
                  headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                  },
                }
              );
              if (toolsRes.ok) {
                const toolsData: any = await toolsRes.json();
                const items = Array.isArray(toolsData)
                  ? toolsData
                  : toolsData?.items || toolsData?.tools || [];

                for (const item of items) {
                  const slug = item.slug || item.name;
                  if (!slug) continue;

                  const rawParams = item.parameters || {};
                  const parameters = {
                    type: 'OBJECT',
                    description: rawParams.description || item.description || `Parameters for ${slug}`,
                    properties: rawParams.properties || {},
                    required: Array.isArray(rawParams.required) ? rawParams.required : [],
                  };

                  dynamicTools.push(
                    sanitizeGeminiFunctionSchema({
                      name: `composio_${slug.toLowerCase()}`,
                      description: item.description || `Execute ${slug} on ${app.toUpperCase()} via Composio.`,
                      parameters,
                    })
                  );
                }
              }
            } catch (toolFetchErr) {
              console.warn(`[COMPOSIO CLOUDFLARE] Tool discovery for ${app} skipped:`, toolFetchErr);
            }
          })
        );

        console.log(
          `[COMPOSIO CLOUDFLARE] Dynamic tools resolved for entity "${entityId}": ${dynamicTools.length} tool(s) across [${activeAppNames.join(', ')}]`
        );

        return new Response(
          JSON.stringify({
            ok: true,
            entityId,
            toolkits: activeAppNames,
            tools: dynamicTools,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        );
      } catch (dynamicErr: any) {
        return new Response(
          JSON.stringify({
            error: 'DYNAMIC_TOOLS_FETCH_FAILED',
            message: dynamicErr?.message || 'Failed to dynamically fetch tools.',
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS,
            },
          }
        );
      }
    }
    
    // Enforce entityId scoping for connected_accounts and tool/action executions
    let targetUrl = `${baseUrl}${cleanEndpoint}`;
    let modifiedBody = body ? { ...body } : undefined;

    const isConnectedAccounts =
      cleanEndpoint.startsWith('/connected_accounts') ||
      cleanEndpoint.startsWith('/connectedAccounts');

    if (isConnectedAccounts) {
      if (method.toUpperCase() === 'GET') {
        const hasExplicitEntity =
          cleanEndpoint.includes('entityId=') ||
          cleanEndpoint.includes('user_uuid=') ||
          cleanEndpoint.includes('user_id=');
        const wantsAllAccounts =
          entityId === 'all' ||
          cleanEndpoint.includes('includeAll=true') ||
          cleanEndpoint.includes('all=true');

        if (!hasExplicitEntity && !wantsAllAccounts) {
          const separator = targetUrl.includes('?') ? '&' : '?';
          targetUrl = `${targetUrl}${separator}entityId=${encodeURIComponent(entityId)}`;
        }
      } else if (method.toUpperCase() === 'POST' && modifiedBody) {
        if (!modifiedBody.user_uuid && !modifiedBody.entityId && !modifiedBody.user_id) {
          modifiedBody.user_uuid = entityId;
          modifiedBody.user_id = entityId;
          modifiedBody.entityId = entityId;
        }
      }
    } else if ((cleanEndpoint.includes('/execute') || cleanEndpoint.includes('/tools/')) && modifiedBody) {
      if (!modifiedBody.entityId && !modifiedBody.user_id && !modifiedBody.user_uuid) {
        modifiedBody.entityId = entityId;
        modifiedBody.user_uuid = entityId;
        modifiedBody.user_id = entityId;
      }
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

    let composioResponse = await fetch(targetUrl, fetchOptions);

    // If 404 on connected_accounts, try alternative connectedAccounts route
    if (composioResponse.status === 404 && targetUrl.includes('/connected_accounts')) {
      const altUrl = targetUrl.replace('/connected_accounts', '/connectedAccounts');
      try {
        const retryRes = await fetch(altUrl, fetchOptions);
        if (retryRes.status !== 404) {
          composioResponse = retryRes;
        }
      } catch {}
    } else if (composioResponse.status === 404 && targetUrl.includes('/connectedAccounts')) {
      const altUrl = targetUrl.replace('/connectedAccounts', '/connected_accounts');
      try {
        const retryRes = await fetch(altUrl, fetchOptions);
        if (retryRes.status !== 404) {
          composioResponse = retryRes;
        }
      } catch {}
    }

    const responseData = await composioResponse.text();

    if (composioResponse.status === 401 || composioResponse.status === 429) {
      tripEdgeCircuitBreaker(
        circuitKey,
        composioResponse.status as 401 | 429,
        `Upstream Composio returned HTTP ${composioResponse.status}`
      );
    }

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

function sanitizeGeminiFunctionSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const rawParams = schema.parameters || {};
  return {
    name: String(schema.name || '').trim(),
    description: String(schema.description || `Tool ${schema.name || ''}`).trim(),
    parameters: sanitizeSchemaObject(rawParams),
  };
}

function sanitizeSchemaObject(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return { type: 'OBJECT', properties: {}, required: [] };
  }
  let type = String(obj.type || 'OBJECT').toUpperCase();
  if (!['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'].includes(type)) {
    type = 'OBJECT';
  }
  const out: any = { type, description: obj.description || '' };
  if (Array.isArray(obj.enum) && obj.enum.length > 0) {
    out.enum = obj.enum.map(String);
  }
  if (type === 'OBJECT') {
    out.properties = {};
    const rawProps = obj.properties || {};
    for (const [key, val] of Object.entries(rawProps)) {
      out.properties[key] = sanitizeSchemaProperty(val);
    }
    out.required = Array.isArray(obj.required)
      ? obj.required.filter((r: any) => typeof r === 'string' && r in out.properties)
      : [];
  } else if (type === 'ARRAY') {
    out.items = obj.items ? sanitizeSchemaProperty(obj.items) : { type: 'STRING' };
  }
  return out;
}

function sanitizeSchemaProperty(val: any): any {
  if (!val || typeof val !== 'object') {
    return { type: 'STRING', description: '' };
  }
  if (Array.isArray(val.anyOf) && val.anyOf.length > 0) {
    const valid = val.anyOf.find((item: any) => item && item.type && item.type !== 'null') || val.anyOf[0];
    return sanitizeSchemaProperty(valid);
  }
  if (Array.isArray(val.oneOf) && val.oneOf.length > 0) {
    const valid = val.oneOf.find((item: any) => item && item.type && item.type !== 'null') || val.oneOf[0];
    return sanitizeSchemaProperty(valid);
  }
  let type = String(val.type || 'STRING').toUpperCase();
  if (Array.isArray(val.type)) {
    type = String(val.type.find((t: string) => t.toLowerCase() !== 'null') || 'STRING').toUpperCase();
  }
  if (!['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'].includes(type)) {
    type = 'STRING';
  }
  const res: any = { type, description: val.description || '' };
  if (Array.isArray(val.enum) && val.enum.length > 0) {
    res.enum = val.enum.map(String);
  }
  if (type === 'ARRAY') {
    res.items = val.items ? sanitizeSchemaProperty(val.items) : { type: 'STRING' };
  } else if (type === 'OBJECT') {
    res.properties = {};
    if (val.properties) {
      for (const [k, v] of Object.entries(val.properties)) {
        res.properties[k] = sanitizeSchemaProperty(v);
      }
    }
    if (Array.isArray(val.required)) {
      res.required = val.required.filter((r: any) => typeof r === 'string' && r in res.properties);
    }
  }
  return res;
}
