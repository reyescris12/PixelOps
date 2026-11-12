/**
 * Stateless Model Context Protocol (MCP) Relay Endpoint
 * Route: /api/mcp
 *
 * Relays JSON-RPC 2.0 MCP requests (`initialize`, `tools/list`, `tools/call`)
 * to user-attached remote HTTP / Streamable-HTTP MCP servers without CORS blocks,
 * while enforcing SSRF protection against internal/metadata addresses.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-mcp-auth-header, x-mcp-auth-value',
};

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.internal') ||
    lower.endsWith('.local') ||
    lower === 'metadata.google.internal'
  ) {
    return true;
  }

  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

function parseSseJsonRpcMessages(rawSse: string): any[] {
  const messages: any[] = [];
  const blocks = rawSse.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const dataLines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (dataLines.length === 0) continue;
    const joined = dataLines.join('\n');
    try {
      messages.push(JSON.parse(joined));
    } catch {}
  }
  return messages;
}

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const onRequestPost = async (context: { request: Request }) => {
  try {
    const payload = (await context.request.json()) as {
      serverUrl?: string;
      rpcBody?: Record<string, any>;
      sessionId?: string;
      authHeaderName?: string;
      authHeaderValue?: string;
    };

    const serverUrl = String(payload?.serverUrl || '').trim();
    if (!serverUrl) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing serverUrl' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(serverUrl);
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid MCP server URL' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Only HTTP/HTTPS MCP transports are supported' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    if (isBlockedHost(parsed.hostname)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Blocked private or metadata MCP host on edge proxy' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    if (payload.sessionId) {
      headers['Mcp-Session-Id'] = String(payload.sessionId);
    }
    if (payload.authHeaderName && payload.authHeaderValue) {
      headers[payload.authHeaderName] = payload.authHeaderValue;
    }

    const upstreamRes = await fetch(parsed.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload.rpcBody || {}),
    });

    const returnedSessionId =
      upstreamRes.headers.get('mcp-session-id') ||
      upstreamRes.headers.get('Mcp-Session-Id') ||
      undefined;
    const contentType = upstreamRes.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      const sseText = await upstreamRes.text();
      const parsedMsgs = parseSseJsonRpcMessages(sseText);
      const rpcResult =
        parsedMsgs.find((m) => m && ('result' in m || 'error' in m)) || parsedMsgs[0] || null;
      return new Response(
        JSON.stringify({
          ok: upstreamRes.ok,
          status: upstreamRes.status,
          sessionId: returnedSessionId,
          rpc: rpcResult,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const json = await upstreamRes.json().catch(async () => ({
      rawText: (await upstreamRes.text().catch(() => '')).slice(0, 2000),
    }));

    return new Response(
      JSON.stringify({
        ok: upstreamRes.ok,
        status: upstreamRes.status,
        sessionId: returnedSessionId,
        rpc: json,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        status: 502,
        error: err?.message || 'MCP upstream relay failed',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
