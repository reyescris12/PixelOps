/**
 * Cloudflare Pages Functions Universal API Middleware
 * Handles preflight OPTIONS (204) and injects CORS headers across all /api endpoints.
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-gemini-api-key, x-goog-api-key, x-composio-api-key, x-entity-id, x-user-id, x-username, x-device-id, x-device-name, x-device-type',
  'Access-Control-Max-Age': '86400',
};

export const onRequest = async (context: { request: Request; next: () => Promise<Response> }): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // Pass WebSocket upgrade requests directly through without re-wrapping the 101 Switching Protocols response
  if ((context.request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
    return context.next();
  }

  const response = await context.next();
  if (response.status === 101 || (response as any).webSocket) {
    return response;
  }

  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    if (!newHeaders.has(key)) {
      newHeaders.set(key, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};
