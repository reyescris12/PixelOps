/**
 * Cloudflare Pages Function: Hardened OSINT Sensor Fetch Proxy
 * Route: /api/fetch
 *
 * Enforces:
 * - GET / HEAD only (unless matching an explicit allowlisted POST endpoint)
 * - HTTPS-only target URLs (http: and non-standard ports rejected with 403)
 * - Private, loopback, link-local, and cloud metadata IP blocking (127.0.0.0/8, 10.0.0.0/8,
 *   172.16.0.0/12, 192.168.0.0/16, 169.254.169.254, ::1, localhost)
 * - Strict ALLOWED_SENSOR_HOSTS hostname allowlist (returns 403 { error: "Host not in OSINT sensor allowlist" }
 *   unless caller holds a valid D1 `station_chief` session)
 * - 8,000 ms AbortSignal.timeout per upstream hop
 * - 2 MB (2,097,152 bytes) max response payload guard
 */

import { requireTier } from './_entitlements';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-target-url',
};

export const PROXY_TIMEOUT_MS = 8000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Strict OSINT & Pre-Media Sensor Hostname Allowlist
 */
export const ALLOWED_SENSOR_HOSTS: readonly string[] = [
  // Airspace
  'api.adsb.lol',
  'api.airplanes.live',
  'opensky-network.org',
  // Seismic & Thermal
  'earthquake.usgs.gov',
  'www.seismicportal.eu',
  'firms.modaps.eosdis.nasa.gov',
  // UK/EU Civic
  'environment.data.gov.uk',
  'webtris.highwaysengland.co.uk',
  'api.tfl.gov.uk',
  'data.police.uk',
  // US Civic
  'api.weather.gov',
  // Infra & Cyber
  'api.ioda.inetintel.cc.gatech.edu',
  'www.cisa.gov',
  'urlhaus-api.abuse.ch',
  'internetdb.shodan.io',
  'crt.sh',
  'cloudflare-dns.com',
  // Background Briefings (on-demand only)
  'www.understandingwar.org',
  'understandingwar.org',
  'api.gdeltproject.org',
];

// Backward-compatible alias for security verification suites
export const ALLOWED_DOMAINS = ALLOWED_SENSOR_HOSTS;

/**
 * Explicit allowlist of sensor endpoints that require HTTP POST (e.g. URLhaus v1 lookup API).
 * All other proxy traffic is strictly restricted to GET and HEAD.
 */
const ALLOWED_POST_URL_PREFIXES: readonly string[] = [
  'https://urlhaus-api.abuse.ch/v1/',
];

export function isExplicitlyAllowedPostUrl(urlStr: string): boolean {
  const clean = (urlStr || '').trim().toLowerCase();
  return ALLOWED_POST_URL_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

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
    ip === '0:0:0:0:0:0:0:1' ||
    ip === '0:0:0:0:0:0:0:0' ||
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
    return true;
  }

  // Parse standard IPv4
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);
  if (match) {
    const [_, o1, o2, o3, o4] = match.map(Number);
    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return true;

    // 0.0.0.0/8
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
    // 192.0.0.0/24 & 192.0.2.0/24
    if (o1 === 192 && o2 === 0 && (o3 === 0 || o3 === 2)) return true;
    // 192.168.0.0/16 (RFC 1918 Private)
    if (o1 === 192 && o2 === 168) return true;
    // 198.18.0.0/15 & 198.51.100.0/24
    if (o1 === 198 && (o2 === 18 || o2 === 19 || (o2 === 51 && o3 === 100))) return true;
    // 203.0.113.0/24
    if (o1 === 203 && o2 === 0 && o3 === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast)
    if (o1 >= 224) return true;
  }

  return false;
}

export function isAllowedDomain(hostname: string): boolean {
  const host = (hostname || '').toLowerCase().trim();
  return ALLOWED_SENSOR_HOSTS.includes(host);
}

export interface TargetUrlValidationResult {
  valid: boolean;
  code?: 'PROTOCOL_FORBIDDEN' | 'PORT_FORBIDDEN' | 'USERINFO_FORBIDDEN' | 'PRIVATE_HOST' | 'UNLISTED_HOST';
  reason?: string;
}

/**
 * Validates a target URL against SSRF attack vectors:
 * - HTTPS-only (`https:` strictly required)
 * - Default port 443 only
 * - No embedded credentials
 * - Rejects localhost, loopback, private, link-local, and cloud metadata IPs
 * - Checks strict `ALLOWED_SENSOR_HOSTS` allowlist (unless `allowStationChiefBypass` is true)
 */
export function validateTargetUrl(
  targetUrl: URL,
  options?: { allowStationChiefBypass?: boolean }
): TargetUrlValidationResult {
  if (targetUrl.protocol !== 'https:') {
    return {
      valid: false,
      code: 'PROTOCOL_FORBIDDEN',
      reason: `Protocol "${targetUrl.protocol}" is forbidden. Only HTTPS target URLs are permitted.`,
    };
  }

  if (targetUrl.port && targetUrl.port !== '443') {
    return {
      valid: false,
      code: 'PORT_FORBIDDEN',
      reason: `Port "${targetUrl.port}" is forbidden. Only standard HTTPS port 443 is permitted.`,
    };
  }

  if (targetUrl.username || targetUrl.password) {
    return {
      valid: false,
      code: 'USERINFO_FORBIDDEN',
      reason: 'Embedded user credentials in target URL are prohibited.',
    };
  }

  const hostname = targetUrl.hostname.toLowerCase().trim();

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'local' ||
    hostname.endsWith('.local') ||
    hostname === 'broadcasthost'
  ) {
    return {
      valid: false,
      code: 'PRIVATE_HOST',
      reason: 'Access to localhost and local network hostnames is prohibited.',
    };
  }

  if (isPrivateOrReservedIP(hostname)) {
    return {
      valid: false,
      code: 'PRIVATE_HOST',
      reason: `Target IP "${hostname}" is private, loopback, link-local, or cloud metadata. SSRF blocked.`,
    };
  }

  if (!options?.allowStationChiefBypass && !isAllowedDomain(hostname)) {
    return {
      valid: false,
      code: 'UNLISTED_HOST',
      reason: 'Host not in OSINT sensor allowlist',
    };
  }

  return { valid: true };
}

/**
 * Reads a Response body into UTF-8 text while enforcing a strict max-byte ceiling (2 MB).
 * Aborts immediately if Content-Length or streamed byte count exceeds `maxBytes`.
 */
export async function readBodyTextWithLimit(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES
): Promise<string> {
  const declaredLen = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    throw new Error(`PAYLOAD_TOO_LARGE: Upstream Content-Length (${declaredLen} bytes) exceeds 2 MB limit.`);
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel('Response exceeded 2 MB sensor payload limit');
          } catch {}
          throw new Error(`PAYLOAD_TOO_LARGE: Streamed payload exceeded ${maxBytes} bytes (2 MB limit).`);
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(combined);
}

/**
 * Executes a fetch request with 8,000 ms timeout and manual redirect validation on every hop.
 */
export async function executeSafeFetch(
  rawUrl: string,
  options: RequestInit & { allowStationChiefBypass?: boolean } = {},
  maxRedirects = 3
): Promise<Response> {
  let currentUrl = rawUrl;
  let remainingRedirects = maxRedirects;
  const { allowStationChiefBypass, ...requestInit } = options;

  while (true) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new Error(`Malformed URL during safe fetch: ${currentUrl}`);
    }

    const validation = validateTargetUrl(parsed, { allowStationChiefBypass });
    if (!validation.valid) {
      throw new Error(`SSRF Blocked: ${validation.reason}`);
    }

    const timeoutSignal = AbortSignal.timeout(PROXY_TIMEOUT_MS);
    const signal = requestInit.signal
      ? typeof (AbortSignal as any).any === 'function'
        ? (AbortSignal as any).any([requestInit.signal, timeoutSignal])
        : timeoutSignal
      : timeoutSignal;

    const response = await fetch(currentUrl, {
      ...requestInit,
      redirect: 'manual',
      signal,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (remainingRedirects <= 0) {
        throw new Error('Maximum redirect limit (3 hops) exceeded during proxy fetch.');
      }

      const location = response.headers.get('location');
      if (!location) {
        return response;
      }

      currentUrl = new URL(location, currentUrl).toString();
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

function normalizeIncomingUrl(rawParam: string): string {
  const trimmed = (rawParam || '').trim();
  if (!trimmed) return '';
  // Preserve any explicit scheme (http://, file://, gopher://, https://) so non-HTTPS schemes are rejected
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Direct Worker SSRF & allowlist enforcement handler (used by edge tests & direct proxy callers)
 */
export async function handleFetchProxy(request: Request, env?: any): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed: /api/fetch permits GET and HEAD only' }),
      { status: 405, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const urlParam = new URL(request.url).searchParams.get('url');
  if (!urlParam) {
    return new Response(JSON.stringify({ error: 'Missing target URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const normalizedUrl = normalizeIncomingUrl(urlParam);
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  let allowStationChiefBypass = false;
  let validation = validateTargetUrl(parsed);

  if (!validation.valid && validation.code === 'UNLISTED_HOST' && env) {
    const tierGuard = await requireTier(request, env, 'station_chief');
    if (tierGuard.ok) {
      allowStationChiefBypass = true;
      validation = validateTargetUrl(parsed, { allowStationChiefBypass: true });
    }
  }

  if (!validation.valid) {
    if (validation.code === 'UNLISTED_HOST') {
      return new Response(
        JSON.stringify({ error: 'Host not in OSINT sensor allowlist' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
    return new Response(
      JSON.stringify({
        error: 'Forbidden: Target URL blocked by SSRF policy',
        reason: validation.reason,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    const upstreamRes = await executeSafeFetch(
      normalizedUrl,
      { method: request.method, allowStationChiefBypass },
      3
    );
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: upstreamRes.status,
        headers: {
          'Content-Type': upstreamRes.headers.get('content-type') || 'text/plain',
          ...CORS_HEADERS,
        },
      });
    }
    const bodyText = await readBodyTextWithLimit(upstreamRes, MAX_RESPONSE_BYTES);
    return new Response(bodyText, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') || 'text/plain',
        ...CORS_HEADERS,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || 'Safe fetch execution failed');
    if (msg.includes('PAYLOAD_TOO_LARGE')) {
      return new Response(
        JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: msg }),
        { status: 413, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
    return new Response(
      JSON.stringify({ error: 'FETCH_FAILED', message: msg }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
}

export const onRequest = async (context: {
  request: Request;
  env?: any;
}): Promise<Response> => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  let rawTargetUrl = '';
  let upstreamMethod = request.method.toUpperCase();
  let customHeaders: Record<string, string> = {};
  let bodyData: any = null;

  if (request.method === 'GET' || request.method === 'HEAD') {
    const url = new URL(request.url);
    rawTargetUrl = (url.searchParams.get('url') || url.searchParams.get('u') || '').trim();
  } else if (request.method === 'POST') {
    try {
      const json: any = await request.json();
      rawTargetUrl = (json.url || json.targetUrl || '').trim();
      upstreamMethod = String(json.method || 'POST').toUpperCase();
      customHeaders = json.headers || {};
      bodyData = json.body;
    } catch {
      return new Response(
        JSON.stringify({ error: 'Method not allowed: /api/fetch permits GET and HEAD only' }),
        { status: 405, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
  } else {
    return new Response(
      JSON.stringify({ error: 'Method not allowed: /api/fetch permits GET and HEAD only' }),
      { status: 405, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  if (!rawTargetUrl) {
    return new Response(
      JSON.stringify({ error: 'MISSING_URL', message: 'A target "url" parameter is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const targetUrl = normalizeIncomingUrl(rawTargetUrl);

  // Enforce GET / HEAD only unless the target matches an explicit allowlisted POST endpoint
  const isPermittedMethod =
    (request.method === 'GET' || request.method === 'HEAD') &&
    (upstreamMethod === 'GET' || upstreamMethod === 'HEAD');
  const isPermittedExplicitPost =
    request.method === 'POST' &&
    upstreamMethod === 'POST' &&
    isExplicitlyAllowedPostUrl(targetUrl);

  if (!isPermittedMethod && !isPermittedExplicitPost) {
    return new Response(
      JSON.stringify({ error: 'Method not allowed: /api/fetch permits GET and HEAD only' }),
      { status: 405, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
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

  let allowStationChiefBypass = false;
  let validation = validateTargetUrl(parsedTarget);

  if (!validation.valid && validation.code === 'UNLISTED_HOST' && env) {
    const tierGuard = await requireTier(request, env, 'station_chief');
    if (tierGuard.ok) {
      allowStationChiefBypass = true;
      validation = validateTargetUrl(parsedTarget, { allowStationChiefBypass: true });
    }
  }

  if (!validation.valid) {
    if (validation.code === 'UNLISTED_HOST') {
      return new Response(
        JSON.stringify({ error: 'Host not in OSINT sensor allowlist' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
    return new Response(
      JSON.stringify({
        error: 'Forbidden: Target URL blocked by SSRF policy',
        message: validation.reason,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    // Sanitize forwarded headers so caller cannot smuggle host/cookie/authorization overrides
    const safeCustomHeaders: Record<string, string> = {};
    for (const [hk, hv] of Object.entries(customHeaders || {})) {
      const lowerKey = hk.toLowerCase();
      if (['accept', 'accept-language', 'content-type'].includes(lowerKey) && typeof hv === 'string') {
        safeCustomHeaders[hk] = hv;
      }
    }

    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'PixelOps-SensorBus/2.1 (+https://pixelops.app; OSINT Pre-Media Collector)',
      Accept: 'application/json, application/geo+json, text/csv, text/xml, text/html;q=0.8, */*;q=0.5',
      ...safeCustomHeaders,
    };

    const fetchOptions: RequestInit & { allowStationChiefBypass?: boolean } = {
      method: upstreamMethod,
      headers: fetchHeaders,
      allowStationChiefBypass,
    };

    if (isPermittedExplicitPost && bodyData) {
      fetchOptions.body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
    }

    const res = await executeSafeFetch(targetUrl, fetchOptions, 3);
    const contentType = res.headers.get('content-type') || '';

    if (upstreamMethod === 'HEAD') {
      return new Response(null, {
        status: res.status,
        headers: {
          'Content-Type': contentType || 'application/json',
          ...CORS_HEADERS,
        },
      });
    }

    const rawText = await readBodyTextWithLimit(res, MAX_RESPONSE_BYTES);

    if (contentType.includes('json')) {
      try {
        const json = JSON.parse(rawText);
        return new Response(
          JSON.stringify({
            ok: res.ok,
            status: res.status,
            url: targetUrl,
            contentType: contentType || 'application/json',
            data: json,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      } catch {
        // Fall through to text handling if upstream mislabeled content-type
      }
    }

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
        text: cleanText.slice(0, 48000),
        totalLength: cleanText.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  } catch (err: any) {
    const msg = String(err?.message || 'Failed to fetch external sensor endpoint.');
    if (msg.includes('PAYLOAD_TOO_LARGE')) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 413,
          error: 'PAYLOAD_TOO_LARGE',
          url: targetUrl,
          message: msg,
        }),
        { status: 413, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
    if (msg.includes('SSRF Blocked')) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 403,
          error: msg.includes('Host not in OSINT sensor allowlist')
            ? 'Host not in OSINT sensor allowlist'
            : 'Forbidden: Target URL blocked by SSRF policy',
          url: targetUrl,
          message: msg,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
    return new Response(
      JSON.stringify({
        ok: false,
        status: 502,
        error: 'FETCH_FAILED',
        url: targetUrl,
        message: msg,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
