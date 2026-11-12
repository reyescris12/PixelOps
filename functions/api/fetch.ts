/**
 * Cloudflare Pages Function: Safehouse Web Crawler & Fetch Proxy
 * Route: /api/fetch
 * 
 * Enforces strict domain allowlisting and private IP blocking (SSRF Mitigation)
 * to prevent proxy abuse while securely proxying authorized intelligence feeds, models, and OSINT APIs.
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

/**
 * Evaluates whether an IP address belongs to RFC 1918, RFC 3927 (link-local/cloud metadata),
 * loopback, IPv6 local, carrier-grade NAT, or other non-public reserved ranges.
 */
export function isPrivateOrReservedIP(ipStr: string): boolean {
  if (!ipStr) return false;
  let ip = ipStr.trim().toLowerCase();

  // Strip brackets from IPv6: [::1] -> ::1
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }

  // IPv6 local, link-local, unique-local, unspecified
  if (
    ip === '::1' ||
    ip === '::' ||
    ip.startsWith('fe80:') ||
    ip.startsWith('fe9') ||
    ip.startsWith('fea') ||
    ip.startsWith('feb') ||
    ip.startsWith('fc00:') ||
    ip.startsWith('fd')
  ) {
    return true;
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    const v4Part = ip.slice(7);
    if (isPrivateOrReservedIP(v4Part)) return true;
  }

  // Pure integer / hex decimal representations (e.g. 2130706433 or 0x7f000001)
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(ip)) {
    return true; // Block raw numeric IP notations
  }

  // Parse standard IPv4
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);
  if (match) {
    const [_, o1, o2, o3, o4] = match.map(Number);
    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return true; // Invalid IP -> block

    // 0.0.0.0/8 (Current network)
    if (o1 === 0) return true;
    // 10.0.0.0/8 (RFC 1918 Private)
    if (o1 === 10) return true;
    // 100.64.0.0/10 (Carrier-Grade NAT)
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (o1 === 127) return true;
    // 169.254.0.0/16 (Link-Local & Cloud Metadata 169.254.169.254)
    if (o1 === 169 && o2 === 254) return true;
    // 172.16.0.0/12 (RFC 1918 Private)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (o1 === 192 && o2 === 0 && o3 === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (o1 === 192 && o2 === 0 && o3 === 2) return true;
    // 192.168.0.0/16 (RFC 1918 Private)
    if (o1 === 192 && o2 === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (o1 === 198 && (o2 === 18 || o2 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (o1 === 198 && o2 === 51 && o3 === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (o1 === 203 && o2 === 0 && o3 === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (o1 >= 224 && o1 <= 239) return true;
    // 240.0.0.0/4 (Reserved / Future Use)
    if (o1 >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (o1 === 255 && o2 === 255 && o3 === 255 && o4 === 255) return true;
  }

  return false;
}

export function isAllowedDomain(hostname: string): boolean {
  const host = (hostname || '').toLowerCase().trim();
  return ALLOWED_DOMAINS.some(
    (allowed) => host === allowed || host.endsWith('.' + allowed)
  );
}

/**
 * Validates a target URL against SSRF attack vectors:
 * - Protocol must be http: or https: (blocks file:, gopher:, dict:, ftp:)
 * - Port must be default 80 or 443 (blocks internal port scanning on 8080, 22, 6379, etc.)
 * - Userinfo (credentials) forbidden in URL
 * - Localhost and private/reserved IPs strictly forbidden (RFC 1918, RFC 3927 link-local metadata)
 * - Hostname must be in ALLOWED_DOMAINS allowlist
 */
export function validateTargetUrl(targetUrl: URL): { valid: boolean; reason?: string } {
  // 1. Enforce safe protocol
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return { valid: false, reason: `Protocol "${targetUrl.protocol}" is forbidden. Only HTTP/HTTPS permitted.` };
  }

  // 2. Enforce standard ports (block port scanning e.g. :8080, :22, :6379)
  if (targetUrl.port && targetUrl.port !== '80' && targetUrl.port !== '443') {
    return { valid: false, reason: `Port "${targetUrl.port}" is forbidden. Only ports 80 and 443 are permitted.` };
  }

  // 3. Reject credentials in URL
  if (targetUrl.username || targetUrl.password) {
    return { valid: false, reason: 'Embedded user credentials in target URL are prohibited.' };
  }

  const hostname = targetUrl.hostname.toLowerCase().trim();

  // 4. Block local, loopback, and metadata hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'local' ||
    hostname.endsWith('.local') ||
    hostname === 'broadcasthost'
  ) {
    return { valid: false, reason: 'Access to localhost and local network hostnames is prohibited.' };
  }

  // 5. Block private and reserved IP addresses (RFC 1918, 169.254.169.254, loopback)
  if (isPrivateOrReservedIP(hostname)) {
    return { valid: false, reason: `Target IP "${hostname}" is private or reserved. SSRF access blocked.` };
  }

  // 6. Verify against authorized domain allowlist
  if (!isAllowedDomain(hostname)) {
    return { valid: false, reason: `Domain "${hostname}" is not authorized in safehouse allowlist.` };
  }

  return { valid: true };
}

/**
 * Executes a fetch request with manual redirect handling to prevent redirect-based SSRF.
 * Each redirect hop is explicitly re-validated against validateTargetUrl before following.
 */
export async function executeSafeFetch(
  rawUrl: string,
  options: RequestInit = {},
  maxRedirects = 3
): Promise<Response> {
  let currentUrl = rawUrl;
  let remainingRedirects = maxRedirects;

  while (true) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new Error(`Malformed URL during safe fetch: ${currentUrl}`);
    }

    const validation = validateTargetUrl(parsed);
    if (!validation.valid) {
      throw new Error(`SSRF Blocked: ${validation.reason}`);
    }

    // Force redirect: 'manual' to intercept any redirect hops
    const fetchOptions: RequestInit = {
      ...options,
      redirect: 'manual',
    };

    const response = await fetch(currentUrl, fetchOptions);

    // Check if response is a redirect (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (remainingRedirects <= 0) {
        throw new Error('Maximum redirect limit (3 hops) exceeded during proxy fetch.');
      }

      const location = response.headers.get('location');
      if (!location) {
        return response; // No location header, return redirect response as-is
      }

      // Resolve relative redirect against current URL
      const redirectUrl = new URL(location, currentUrl).toString();
      currentUrl = redirectUrl;
      remainingRedirects--;
      continue;
    }

    return response;
  }
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

  const normalizedUrl = urlParam.startsWith('http://') || urlParam.startsWith('https://')
    ? urlParam
    : `https://${urlParam}`;

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const validation = validateTargetUrl(parsed);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: Target URL blocked by SSRF policy', reason: validation.reason }),
      { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    return await executeSafeFetch(normalizedUrl);
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'FETCH_FAILED', message: err?.message || 'Safe fetch execution failed' }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
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

  // SSRF Mitigation: Validate protocol, port, userinfo, IP ranges, and domain allowlist
  const validation = validateTargetUrl(parsedTarget);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({
        error: 'Forbidden: Target URL blocked by SSRF policy',
        message: validation.reason,
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
    };

    if (method !== 'GET' && method !== 'HEAD' && bodyData) {
      fetchOptions.body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
    }

    const res = await executeSafeFetch(targetUrl, fetchOptions, 3);
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

    // HTML / Plaintext handling: Extract readable text and clean up scripts/styles/navigation chrome
    const rawText = await res.text();
    let cleanText = rawText;
    let pageTitle = '';

    if (contentType.includes('html') || rawText.includes('<html')) {
      const titleMatch = rawText.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        pageTitle = titleMatch[1]
          .replace(/&quot;/g, '"')
          .replace(/&#(?:39|8217|x27);/gi, "'")
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();
      }

      const strippedBoilerplate = rawText
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');

      const withoutNavFooter = strippedBoilerplate
        .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');

      const decodeHtmlToText = (html: string) =>
        html
          .replace(/<[^>]+>/g, ' ')
          .replace(/&quot;/g, '"')
          .replace(/&#(?:39|8217|x27);/gi, "'")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();

      const candidateClean = decodeHtmlToText(withoutNavFooter);
      cleanText = candidateClean.length >= 150 ? candidateClean : decodeHtmlToText(strippedBoilerplate);
    }

    return new Response(
      JSON.stringify({
        ok: res.ok,
        status: res.status,
        url: res.url || targetUrl,
        title: pageTitle,
        contentType: contentType || 'text/plain',
        text: cleanText.slice(0, 18000),
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
