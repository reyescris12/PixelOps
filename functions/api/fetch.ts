/**
 * Cloudflare Pages Function: Universal Web Crawler & URL Reader Proxy
 * Route: /api/fetch
 * 
 * Allows operatives to fetch and read content from ANY site on the entire web
 * (including Google, GitHub, Reddit, news portals, and company documentation)
 * without browser CORS restrictions.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-target-url',
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export const onRequest = async (context: {
  request: Request;
}): Promise<Response> => {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  let targetUrl = '';
  let method = 'GET';
  let customHeaders: Record<string, string> = {};
  let bodyData: any = null;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    targetUrl = (url.searchParams.get('url') || url.searchParams.get('u') || '').trim();
  } else if (request.method === 'POST') {
    try {
      const json: any = await request.json();
      targetUrl = (json.url || json.targetUrl || '').trim();
      method = (json.method || 'GET').toUpperCase();
      customHeaders = json.headers || {};
      bodyData = json.body;
    } catch {
      // Ignore
    }
  }

  if (!targetUrl) {
    return new Response(
      JSON.stringify({ error: 'MISSING_URL', message: 'A target "url" parameter is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  // Ensure protocol is present
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = `https://${targetUrl}`;
  }

  try {
    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 PixelOps-Intelligence/2.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      ...customHeaders,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
      redirect: 'follow',
    };

    if (method !== 'GET' && method !== 'HEAD' && bodyData) {
      fetchOptions.body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
    }

    const res = await fetch(targetUrl, fetchOptions);
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = await res.json();
      return new Response(
        JSON.stringify({
          ok: res.ok,
          status: res.status,
          url: targetUrl,
          contentType: 'application/json',
          data: json,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // HTML / Plaintext handling: Extract readable text and clean up scripts/styles
    const rawText = await res.text();
    let cleanText = rawText;

    if (contentType.includes('html') || rawText.includes('<html')) {
      cleanText = rawText
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return new Response(
      JSON.stringify({
        ok: res.ok,
        status: res.status,
        url: targetUrl,
        contentType: contentType || 'text/plain',
        text: cleanText.slice(0, 10000), // Return up to 10k characters of clean text
        totalLength: cleanText.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        status: 502,
        error: 'FETCH_FAILED',
        url: targetUrl,
        message: err?.message || 'Failed to fetch external website.',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
