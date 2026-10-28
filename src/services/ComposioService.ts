/**
 * Composio Multi-User Integration Engine for PixelOps Agents
 * Provides isolated external tool access (GitHub, Slack, Gmail, Notion, Linear)
 * formatted strictly into Google Gemini (@google/genai) FunctionDeclaration schemas.
 *
 * Multi-User Security:
 * - Each client instance generates a local persistent entityId (e.g., 'commander_...').
 * - All actions and connected accounts are scoped strictly to the caller's entityId.
 * - Routes via Cloudflare Pages Function proxy (/api/composio).
 */

import { get, set } from 'idb-keyval';

export interface ComposioConnectedAccount {
  id: string;
  appName: string;
  status: 'ACTIVE' | 'INITIATED' | 'FAILED' | 'EXPIRED';
  createdAt?: string;
  userUuid?: string;
}

export interface ComposioActionExecutionResult {
  successful: boolean;
  data?: any;
  error?: string;
  actionName: string;
  executedAt: string;
}

const STORAGE_ENTITY_ID_KEY = 'pixelops_composio_entity_id';
const STORAGE_CUSTOM_KEY_KEY = 'pixelops_composio_custom_api_key';

let cachedEntityId: string | null = null;

/**
 * 1. Multi-User Isolation: Get or generate a persistent local entityId
 * Persisted in IndexedDB (idb-keyval) and localStorage.
 */
export function getOrCreateEntityId(): string {
  if (cachedEntityId && cachedEntityId.trim().length > 0) {
    return cachedEntityId;
  }

  try {
    const existing = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_ENTITY_ID_KEY) : null;
    if (existing && existing.trim().length > 0) {
      cachedEntityId = existing.trim();
      set(STORAGE_ENTITY_ID_KEY, cachedEntityId).catch(() => {});
      return cachedEntityId;
    }
  } catch {
    // Fallback if storage access is restricted
  }

  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `commander_${crypto.randomUUID()}`
      : `commander_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  cachedEntityId = generated;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_ENTITY_ID_KEY, generated);
    }
  } catch {
    // Ignore quota errors
  }

  try {
    set(STORAGE_ENTITY_ID_KEY, generated).catch(() => {});
  } catch {
    // Ignore
  }

  return generated;
}

// Background async hydration from idb-keyval in case localStorage was cleared
if (typeof window !== 'undefined') {
  get<string>(STORAGE_ENTITY_ID_KEY)
    .then((val) => {
      if (val && val.trim().length > 0) {
        cachedEntityId = val.trim();
        try {
          localStorage.setItem(STORAGE_ENTITY_ID_KEY, cachedEntityId);
        } catch {}
      }
    })
    .catch(() => {});
}

/**
 * Custom BYOK Composio API Key management
 */
export function getComposioApiKey(): string {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_CUSTOM_KEY_KEY)?.trim() || ''
      : '';
  } catch {
    return '';
  }
}

export function setComposioApiKey(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (!key || !key.trim()) {
        localStorage.removeItem(STORAGE_CUSTOM_KEY_KEY);
      } else {
        localStorage.setItem(STORAGE_CUSTOM_KEY_KEY, key.trim());
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Live connection ping to backend.composio.dev or Cloudflare proxy
 */
export async function pingComposio(): Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    const entityId = getOrCreateEntityId();
    const customKey = getComposioApiKey();

    if (customKey) {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(
          `https://backend.composio.dev/api/v2/connectedAccounts?user_uuid=${encodeURIComponent(entityId)}`,
          {
            method: 'GET',
            headers: {
              'x-api-key': customKey,
              Accept: 'application/json',
            },
            signal: controller.signal,
          }
        );
        const latencyMs = Math.round(performance.now() - start);
        return {
          ok: res.ok,
          status: res.status,
          latencyMs,
          error: res.ok ? undefined : `HTTP ${res.status}`,
        };
      } finally {
        clearTimeout(tid);
      }
    } else {
      await callComposioProxy(`/connectedAccounts?user_uuid=${encodeURIComponent(entityId)}`, 'GET');
      const latencyMs = Math.round(performance.now() - start);
      return {
        ok: true,
        status: 200,
        latencyMs,
      };
    }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      ok: false,
      status: 0,
      latencyMs,
      error: err?.message || String(err),
    };
  }
}

/**
 * Direct call fallback to backend.composio.dev/api/v2 when on local dev or when proxy is unreachable
 */
async function callComposioDirect(
  url: string,
  method: string,
  body: Record<string, any> | null | undefined,
  apiKey: string,
  entityId: string
): Promise<any> {
  let targetUrl = url;
  let modifiedBody = body ? { ...body } : undefined;

  if (targetUrl.includes('/connectedAccounts')) {
    if (method.toUpperCase() === 'GET') {
      const sep = targetUrl.includes('?') ? '&' : '?';
      targetUrl = `${targetUrl}${sep}user_uuid=${encodeURIComponent(entityId)}`;
    } else if (method.toUpperCase() === 'POST' && modifiedBody) {
      modifiedBody.user_uuid = entityId;
      modifiedBody.entityId = entityId;
    }
  } else if (targetUrl.includes('/execute') && modifiedBody) {
    modifiedBody.entityId = entityId;
    modifiedBody.user_uuid = entityId;
  }

  const directRes = await fetch(targetUrl, {
    method: method.toUpperCase(),
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: modifiedBody && method.toUpperCase() !== 'GET' ? JSON.stringify(modifiedBody) : undefined,
  });

  if (!directRes.ok) {
    const txt = await directRes.text();
    throw new Error(`Composio API (${directRes.status}): ${txt.slice(0, 150)}`);
  }

  return await directRes.json();
}

/**
 * Core Proxy Request Dispatcher with 8s Circuit Breaker
 */
async function callComposioProxy(
  endpoint: string,
  method: string = 'GET',
  body?: Record<string, any> | null
): Promise<any> {
  const entityId = getOrCreateEntityId();
  const customKey = getComposioApiKey();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // 1. Direct browser REST execution if user configured their own COMPOSIO_API_KEY
  // Bypasses any SPA fallback or Vite dev server proxy issues
  if (customKey) {
    return await callComposioDirect(
      `https://backend.composio.dev/api/v2${cleanEndpoint}`,
      method,
      body,
      customKey,
      entityId
    );
  }

  // 2. Otherwise route via Cloudflare Pages Function proxy (/api/composio) with 8s circuit breaker
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-entity-id': entityId,
    };

    const proxyUrl = '/api/composio';
    let res: Response;

    try {
      res = await fetch(proxyUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpoint: cleanEndpoint,
          method,
          body: body || null,
          entityId,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      if (controller.signal.aborted) {
        throw new Error('Composio proxy request timed out (8s limit).');
      }
      throw new Error(`Composio proxy unreachable: ${fetchErr?.message || fetchErr}`);
    }

    const contentType = res.headers.get('content-type') || '';

    if (!res.ok) {
      const errorText = await res.text();
      let parsedError: any;
      try {
        parsedError = JSON.parse(errorText);
      } catch {
        parsedError = { message: errorText || `HTTP ${res.status}` };
      }
      throw new Error(parsedError.message || parsedError.error || `Composio proxy error (${res.status})`);
    }

    if (!contentType.includes('application/json')) {
      throw new Error('Composio proxy returned non-JSON response (SPA HTML fallback). Configure your Composio API key via "composio key <key>" to enable direct REST communication.');
    }

    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 2. Get user's personal connected accounts
 */
export async function getConnectedAccounts(): Promise<ComposioConnectedAccount[]> {
  const entityId = getOrCreateEntityId();
  try {
    const data = await callComposioProxy(`/connectedAccounts?user_uuid=${encodeURIComponent(entityId)}`, 'GET');
    const items = Array.isArray(data) ? data : data?.items || data?.connectedAccounts || [];
    return items.map((item: any) => ({
      id: item.id || item.connectionId,
      appName: (item.appName || item.app || '').toLowerCase(),
      status: item.status || 'ACTIVE',
      createdAt: item.createdAt,
      userUuid: item.user_uuid || item.entityId || entityId,
    }));
  } catch {
    // Return empty list if backend unconfigured
    return [];
  }
}

/**
 * 3. Initiate OAuth App Connection (e.g. GitHub, Slack, Gmail, Notion)
 */
export async function initiateAppConnection(
  appName: string,
  redirectUri: string = typeof window !== 'undefined' ? window.location.origin : ''
): Promise<{ connectionUrl?: string; redirectUrl?: string; connectionId?: string }> {
  const entityId = getOrCreateEntityId();
  const payload = {
    appName: appName.toLowerCase().trim(),
    entityId,
    user_uuid: entityId,
    redirectUri,
  };

  const response = await callComposioProxy('/connectedAccounts', 'POST', payload);
  const targetUrl =
    response.connectionUrl ||
    response.redirectUrl ||
    response.url ||
    response.data?.connectionUrl;

  if (targetUrl && typeof window !== 'undefined') {
    // Open OAuth link in a clean popup or redirect window
    const width = 640;
    const height = 720;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(
      targetUrl,
      `composio_auth_${appName}`,
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no`
    );
  }

  return {
    connectionUrl: targetUrl,
    connectionId: response.id || response.connectionId,
  };
}

/**
 * Pre-defined, production-ready Gemini FunctionDeclaration schemas for Composio integrations
 */
export const COMPOSIO_GEMINI_TOOL_SCHEMAS: Record<string, any> = {
  // GITHUB
  composio_github_create_issue: {
    name: 'composio_github_create_issue',
    description: 'Create a new issue on a GitHub repository using the user authenticated GitHub account via Composio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING', description: 'Repository owner or organization name (e.g. "octocat").' },
        repo: { type: 'STRING', description: 'Repository name (e.g. "Hello-World").' },
        title: { type: 'STRING', description: 'Title of the GitHub issue.' },
        body: { type: 'STRING', description: 'Markdown body content describing the issue or bug.' },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  composio_github_star_repo: {
    name: 'composio_github_star_repo',
    description: 'Star a repository on GitHub via user authenticated account.',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING', description: 'Repository owner.' },
        repo: { type: 'STRING', description: 'Repository name.' },
      },
      required: ['owner', 'repo'],
    },
  },

  // SLACK
  composio_slack_send_message: {
    name: 'composio_slack_send_message',
    description: 'Send a message to a Slack channel or DM using the user authenticated Slack connection.',
    parameters: {
      type: 'OBJECT',
      properties: {
        channel: { type: 'STRING', description: 'Channel name or ID (e.g. "#general", "C12345").' },
        text: { type: 'STRING', description: 'Message text to dispatch to the channel.' },
      },
      required: ['channel', 'text'],
    },
  },

  // GMAIL
  composio_gmail_send_email: {
    name: 'composio_gmail_send_email',
    description: 'Compose and dispatch an email via user authenticated Google Workspace / Gmail account.',
    parameters: {
      type: 'OBJECT',
      properties: {
        recipient_email: { type: 'STRING', description: 'Destination email address.' },
        subject: { type: 'STRING', description: 'Email subject title.' },
        body: { type: 'STRING', description: 'Email body text or plain content.' },
      },
      required: ['recipient_email', 'subject', 'body'],
    },
  },

  // NOTION
  composio_notion_create_page: {
    name: 'composio_notion_create_page',
    description: 'Create a new document or notes page in Notion workspace.',
    parameters: {
      type: 'OBJECT',
      properties: {
        parent_page_id: { type: 'STRING', description: 'Notion parent page or database ID.' },
        title: { type: 'STRING', description: 'Title of the new page.' },
        content: { type: 'STRING', description: 'Notes or markdown content for the page.' },
      },
      required: ['title'],
    },
  },

  // LINEAR
  composio_linear_create_issue: {
    name: 'composio_linear_create_issue',
    description: 'Create an engineering ticket or issue in Linear workspace.',
    parameters: {
      type: 'OBJECT',
      properties: {
        team_id: { type: 'STRING', description: 'Linear team identifier.' },
        title: { type: 'STRING', description: 'Title of the engineering ticket.' },
        description: { type: 'STRING', description: 'Detailed problem or task description.' },
      },
      required: ['title'],
    },
  },
};

/**
 * 4. Get Gemini FunctionDeclaration tools for all connected apps
 */
export async function getGeminiTools(connectedAppNames: string[] = []): Promise<any[]> {
  const tools: any[] = [];
  const normalized = connectedAppNames.map((a) => a.toLowerCase().trim());

  // Match connected apps to their Gemini function declarations
  for (const [toolKey, schema] of Object.entries(COMPOSIO_GEMINI_TOOL_SCHEMAS)) {
    const isAppMatch = normalized.some((app) => toolKey.toLowerCase().includes(app));
    // Include if user explicitly connected the app, or if all core tools are requested
    if (normalized.length === 0 || isAppMatch) {
      tools.push(schema);
    }
  }

  return tools;
}

/**
 * 5. Execute Composio Action Scoped Strictly to User's entityId
 */
export async function executeComposioAction(
  actionName: string,
  params: Record<string, any>
): Promise<ComposioActionExecutionResult> {
  const entityId = getOrCreateEntityId();
  // Map internal function name back to standard Composio action identifier if prefixed
  const normalizedAction = actionName
    .replace(/^composio_/, '')
    .toUpperCase();

  try {
    const result = await callComposioProxy(`/actions/${encodeURIComponent(normalizedAction)}/execute`, 'POST', {
      entityId,
      user_uuid: entityId,
      input: params,
    });

    return {
      successful: true,
      data: result?.data || result?.response || result,
      actionName,
      executedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      successful: false,
      error: err?.message || 'Composio execution failed.',
      actionName,
      executedAt: new Date().toISOString(),
    };
  }
}
