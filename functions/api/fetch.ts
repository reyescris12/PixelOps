/**
 * Cloudflare Pages Function: Safehouse Web Crawler & Fetch Proxy
 * Route: /api/fetch
 * 
 * Enforces strict domain whitelisting (SSRF Mitigation) to prevent proxy abuse
 * while securely proxying authorized intelligence feeds, models, and OSINT APIs.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-target-url',
};

/**
 * Cloudflare Worker SSRF Whitelist Enforcement
 * Restricts external fetch proxy to verified safehouse domains and API hosts.
 */
export const ALLOWED_DOMAINS = [
  'understandingwar.org', 
  'api.anthropic.com', 
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.openai.com',
  'api.groq.com',
  'feeds.buzzsprout.com',
  'api.github.com',
  'gitlab.com',
  'api.shodan.io',
  'api.securitytrails.com',
  'api.abuseipdb.com',
  'crt.sh',
  'api.bgpview.io',
  'ipinfo.io',
  'otx.alienvault.com',
  'www.virustotal.com',
  'earthquake.usgs.gov',
  'services.swpc.noaa.gov',
  'en.wikipedia.org',
  'hn.algolia.com',
  'api.duckduckgo.com',
  'news.google.com',
];

export function isAllowedDomain(hostname: string): boolean {
  const host = (hostname || '').toLowerCase().trim();
  return ALLOWED_DOMAINS.some(
    (allowed) => host === allowed || host.endsWith('.' + allowed)
  );
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

/**
 * Cloudflare Worker SSRF whitelist enforcement handler
 */
export async function handleFetchProxy(request: Request): Promise<Response> {
  const urlParam = new URL(request.url).searchParams.get('url');
  if (!urlParam) {
    return new Response(JSON.stringify({ error: 'Missing target URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(
      urlParam.startsWith('http://') || urlParam.startsWith('https://') ? urlParam : `https://${urlParam}`
    );
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  if (!isAllowedDomain(targetUrl.hostname)) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: Target domain is not whitelisted' }),
      { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  // Proceed with safe fetch execution
  return fetch(targetUrl.toString());
}

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

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return new Response(
      JSON.stringify({ error: 'INVALID_URL', message: 'Target URL is malformed.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  // SSRF Mitigation: Enforce strict domain whitelist
  if (!isAllowedDomain(parsedTarget.hostname)) {
    return new Response(
      JSON.stringify({
        error: 'Forbidden: Target domain is not whitelisted',
        message: `SSRF Guard: Domain "${parsedTarget.hostname}" is not authorized.`,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
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
