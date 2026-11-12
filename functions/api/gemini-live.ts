/**
 * Cloudflare Pages Function: Gemini Multimodal Live WebSocket Proxy
 * Routes:
 *   - /api/gemini-live
 *   - /api/gemini-live/ws/*
 *
 * Bridges browser Push-To-Talk WebSockets from `@google/genai` (`ai.live.connect`)
 * to `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`
 * while keeping server-managed `GEMINI_API_KEY` off the client when available,
 * or forwarding a Commander-supplied BYOK Gemini key.
 */

interface Env {
  GEMINI_API_KEY?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gemini-api-key, x-goog-api-key',
};

const UPSTREAM_GEMINI_WS_PATH =
  '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

function resolveGeminiKey(request: Request, env?: Env): string {
  const url = new URL(request.url);
  const queryKey = (url.searchParams.get('key') || '').trim();
  if (queryKey && queryKey !== 'PROXY_MANAGED' && queryKey !== 'MY_GEMINI_API_KEY') {
    return queryKey;
  }

  const headerKey = (
    request.headers.get('x-gemini-api-key') ||
    request.headers.get('x-goog-api-key') ||
    ''
  ).trim();
  if (headerKey && headerKey !== 'PROXY_MANAGED' && headerKey !== 'MY_GEMINI_API_KEY') {
    return headerKey;
  }

  const envKey = String(env?.GEMINI_API_KEY || '').trim();
  if (envKey && envKey !== 'MY_GEMINI_API_KEY') {
    return envKey;
  }

  return '';
}

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const onRequest = async (context: { request: Request; env?: Env }) => {
  const { request, env } = context;
  const upgradeHeader = (request.headers.get('Upgrade') || '').toLowerCase();

  // Standard HTTP status probe so TacticalRadioModal knows whether edge key is provisioned
  if (upgradeHeader !== 'websocket') {
    const hasServerKey = Boolean(
      env?.GEMINI_API_KEY &&
        env.GEMINI_API_KEY.trim() !== '' &&
        env.GEMINI_API_KEY.trim() !== 'MY_GEMINI_API_KEY'
    );
    return new Response(
      JSON.stringify({
        ok: true,
        proxyReady: true,
        service: 'pixelops-gemini-live-proxy',
        runtime: 'cloudflare-pages-worker',
        hasServerKey,
        defaultModel: 'gemini-3.8-live',
        extendedThinkingModel: 'gemini-3.8-live-extended-thinking',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...CORS_HEADERS,
        },
      }
    );
  }

  const apiKey = resolveGeminiKey(request, env);
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'MISSING_GEMINI_API_KEY',
        message:
          'No Gemini API key configured on Cloudflare Worker proxy or BYOK Vault. Configure GEMINI_API_KEY in worker secrets or enter a Gemini key in Safehouse Settings.',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      }
    );
  }

  const WebSocketPairCtor = (globalThis as any).WebSocketPair;
  if (!WebSocketPairCtor) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'WEBSOCKET_PAIR_UNAVAILABLE',
        message: 'Runtime does not expose Cloudflare WebSocketPair.',
      }),
      { status: 501, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const upstreamUrl = `https://generativelanguage.googleapis.com${UPSTREAM_GEMINI_WS_PATH}?key=${encodeURIComponent(
    apiKey
  )}`;

  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Upgrade', 'websocket');
  const requestedProtocols = request.headers.get('Sec-WebSocket-Protocol');
  if (requestedProtocols) {
    upstreamHeaders.set('Sec-WebSocket-Protocol', requestedProtocols);
  }

  const upstreamRes: any = await fetch(upstreamUrl, {
    headers: upstreamHeaders,
  });

  const upstreamWs = upstreamRes?.webSocket;
  if (!upstreamWs) {
    const errText = await upstreamRes.text().catch(() => 'Upstream handshake rejected');
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'UPSTREAM_LIVE_HANDSHAKE_FAILED',
        status: upstreamRes.status,
        detail: errText.slice(0, 400),
      }),
      {
        status: upstreamRes.status >= 400 ? upstreamRes.status : 502,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      }
    );
  }

  const pair = new WebSocketPairCtor();
  const clientWs = pair[0];
  const serverWs = pair[1];

  // Attach listeners BEFORE calling accept() so initial setup frames are never dropped
  upstreamWs.addEventListener('message', (event: any) => {
    try {
      serverWs.send(event.data);
    } catch {}
  });

  serverWs.addEventListener('message', (event: any) => {
    try {
      upstreamWs.send(event.data);
    } catch {}
  });

  upstreamWs.addEventListener('close', (event: any) => {
    try {
      serverWs.close(event?.code || 1000, event?.reason || 'Upstream closed');
    } catch {}
  });

  serverWs.addEventListener('close', (event: any) => {
    try {
      upstreamWs.close(event?.code || 1000, event?.reason || 'Client closed');
    } catch {}
  });

  upstreamWs.addEventListener('error', () => {
    try {
      serverWs.close(1011, 'Upstream Gemini Live socket error');
    } catch {}
  });

  serverWs.addEventListener('error', () => {
    try {
      upstreamWs.close(1011, 'Client socket error');
    } catch {}
  });

  upstreamWs.accept();
  serverWs.accept();

  return new Response(null, {
    status: 101,
    webSocket: clientWs,
  } as any);
};
