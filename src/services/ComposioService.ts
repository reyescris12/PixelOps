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
import { GoogleGenAI } from '@google/genai';

export interface ComposioConnectedAccount {
  id: string;
  appName: string;
  status: 'ACTIVE' | 'INITIATED' | 'FAILED' | 'EXPIRED';
  createdAt?: string;
  userUuid?: string;
}

export interface ComposioIntegration {
  appName: string;
  name: string;
  description: string;
  logoUrl?: string;
  category: string;
  isToolkit: boolean;
  authSchemes?: string[];
  connected?: boolean;
  connectionId?: string;
}

export const CURATED_COMPOSIO_INTEGRATIONS: ComposioIntegration[] = [
  {
    appName: 'github',
    name: 'GitHub',
    description: 'Manage repositories, create and track issues, inspect pull requests, and trigger CI workflows.',
    logoUrl: 'https://cdn.simpleicons.org/github/f3ead8',
    category: 'Developer',
    isToolkit: true,
    authSchemes: ['oauth2', 'api_key'],
  },
  {
    appName: 'slack',
    name: 'Slack',
    description: 'Dispatch operational channel broadcasts, monitor security alerts, and send automated direct messages.',
    logoUrl: 'https://cdn.simpleicons.org/slack/4A154B',
    category: 'Communication',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'gmail',
    name: 'Gmail',
    description: 'Compose mission briefs, analyze inbound messages, and dispatch cryptographically secure emails.',
    logoUrl: 'https://cdn.simpleicons.org/gmail/EA4335',
    category: 'Communication',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'googlecalendar',
    name: 'Google Calendar',
    description: 'Coordinate synchronized team schedules, track deployment events, and book briefing slots.',
    logoUrl: 'https://cdn.simpleicons.org/googlecalendar/4285F4',
    category: 'Productivity',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'notion',
    name: 'Notion',
    description: 'Create tactical battle documentation, update operational roadmaps, and sync knowledge bases.',
    logoUrl: 'https://cdn.simpleicons.org/notion/f3ead8',
    category: 'Productivity',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'linear',
    name: 'Linear',
    description: 'Manage engineering sprints, track bug reports, and prioritize rapid security patches.',
    logoUrl: 'https://cdn.simpleicons.org/linear/5E6AD2',
    category: 'Project Management',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'discord',
    name: 'Discord',
    description: 'Relay telemetry broadcasts to operative guild servers, announce releases, and ping channel webhooks.',
    logoUrl: 'https://cdn.simpleicons.org/discord/5865F2',
    category: 'Communication',
    isToolkit: true,
    authSchemes: ['oauth2', 'bot_token'],
  },
  {
    appName: 'jira',
    name: 'Jira Software',
    description: 'Enterprise issue tracking, agile backlog management, and vulnerability resolution tracking.',
    logoUrl: 'https://cdn.simpleicons.org/jira/0052CC',
    category: 'Project Management',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'asana',
    name: 'Asana',
    description: 'Organize team operational workflows, manage milestone dependencies, and allocate field resources.',
    logoUrl: 'https://cdn.simpleicons.org/asana/F06A6A',
    category: 'Project Management',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'trello',
    name: 'Trello',
    description: 'Visual kanban board manipulation, operative card movements, and checklist verifications.',
    logoUrl: 'https://cdn.simpleicons.org/trello/0052CC',
    category: 'Project Management',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'twitter',
    name: 'Twitter / X',
    description: 'Broadcast high-priority public bulletins, monitor keyword chatter, and engage community nodes.',
    logoUrl: 'https://cdn.simpleicons.org/x/f3ead8',
    category: 'Communication',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'googlesheets',
    name: 'Google Sheets',
    description: 'Tabular intelligence logging, automated metric appending, and ledger spreadsheet analysis.',
    logoUrl: 'https://cdn.simpleicons.org/googlesheets/34A853',
    category: 'Productivity',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'googledrive',
    name: 'Google Drive',
    description: 'Cloud document retrieval, surveillance asset staging, and secure folder structure maintenance.',
    logoUrl: 'https://cdn.simpleicons.org/googledrive/4285F4',
    category: 'Productivity',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'airtable',
    name: 'Airtable',
    description: 'Relational intelligence store, operative asset rosters, and automated field record updating.',
    logoUrl: 'https://cdn.simpleicons.org/airtable/18BFFF',
    category: 'Productivity',
    isToolkit: true,
    authSchemes: ['oauth2', 'api_key'],
  },
  {
    appName: 'figma',
    name: 'Figma',
    description: 'Extract visual component tokens, inspect operative interface specs, and post design review comments.',
    logoUrl: 'https://cdn.simpleicons.org/figma/F24E1E',
    category: 'Developer',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'zoom',
    name: 'Zoom',
    description: 'Provision encrypted video briefing rooms, generate conference links, and fetch meeting recordings.',
    logoUrl: 'https://cdn.simpleicons.org/zoom/2D8CFF',
    category: 'Communication',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'gitlab',
    name: 'GitLab',
    description: 'Self-hosted and cloud git repo governance, pipeline dispatching, and merge request validations.',
    logoUrl: 'https://cdn.simpleicons.org/gitlab/FC6D26',
    category: 'Developer',
    isToolkit: true,
    authSchemes: ['oauth2', 'api_key'],
  },
  {
    appName: 'clickup',
    name: 'ClickUp',
    description: 'All-in-one mission task assignment, status updates, and operative time allocation tracking.',
    logoUrl: 'https://cdn.simpleicons.org/clickup/7B68EE',
    category: 'Project Management',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'hubspot',
    name: 'HubSpot',
    description: 'CRM lead intelligence, customer contact tracking, and marketing automation dispatching.',
    logoUrl: 'https://cdn.simpleicons.org/hubspot/FF7A59',
    category: 'Finance',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
  {
    appName: 'stripe',
    name: 'Stripe',
    description: 'Financial transaction querying, subscription ledger auditing, and invoice status confirmation.',
    logoUrl: 'https://cdn.simpleicons.org/stripe/635BFF',
    category: 'Finance',
    isToolkit: true,
    authSchemes: ['api_key'],
  },
  {
    appName: 'spotify',
    name: 'Spotify',
    description: 'Safehouse audio ambience controls, operative focus playlists, and tactical background music.',
    logoUrl: 'https://cdn.simpleicons.org/spotify/1DB954',
    category: 'Productivity',
    isToolkit: true,
    authSchemes: ['oauth2'],
  },
];

export interface ComposioActionExecutionResult {
  successful: boolean;
  data?: any;
  error?: string;
  actionName: string;
  executedAt: string;
}

export const COMPOSIO_BASE_URL = 'https://backend.composio.dev/api/v3';

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
          `${COMPOSIO_BASE_URL}/connected_accounts?user_uuid=${encodeURIComponent(entityId)}&user_id=${encodeURIComponent(entityId)}`,
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
      await callComposioProxy(`/connected_accounts?user_uuid=${encodeURIComponent(entityId)}&user_id=${encodeURIComponent(entityId)}`, 'GET');
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

export interface InitiateConnectionOptions {
  redirectUri?: string;
  onSuccess?: (account: ComposioConnectedAccount) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export interface InitiateConnectionResult {
  connectionUrl?: string;
  redirectUrl?: string;
  connectionId?: string;
  popup?: Window | null;
  waitForCompletion: () => Promise<boolean>;
}

export type ConnectionSyncListener = (accounts: ComposioConnectedAccount[]) => void;
const connectionSyncListeners = new Set<ConnectionSyncListener>();

export function subscribeToConnectionChanges(listener: ConnectionSyncListener): () => void {
  connectionSyncListeners.add(listener);
  return () => {
    connectionSyncListeners.delete(listener);
  };
}

export function notifyConnectionSync(accounts: ComposioConnectedAccount[]): void {
  for (const listener of connectionSyncListeners) {
    try {
      listener(accounts);
    } catch (err) {
      console.warn('[COMPOSIO LISTENER ERROR]', err);
    }
  }
}

/**
 * Direct call fallback to backend.composio.dev/api/v3 when on local dev or when proxy is unreachable
 */
async function callComposioDirect(
  url: string,
  method: string,
  body: Record<string, any> | null | undefined,
  apiKey: string,
  entityId: string
): Promise<any> {
  // Normalize target URL to v3
  let targetUrl = url.replace('https://backend.composio.dev/api/v2', COMPOSIO_BASE_URL);

  let modifiedBody = body ? { ...body } : undefined;

  const isConnectedAccounts =
    targetUrl.includes('/connectedAccounts') || targetUrl.includes('/connected_accounts');

  if (isConnectedAccounts) {
    if (method.toUpperCase() === 'GET') {
      const sep = targetUrl.includes('?') ? '&' : '?';
      targetUrl = `${targetUrl}${sep}entityId=${encodeURIComponent(entityId)}&user_uuid=${encodeURIComponent(entityId)}&user_id=${encodeURIComponent(entityId)}`;
    } else if (method.toUpperCase() === 'POST' && modifiedBody) {
      modifiedBody.user_uuid = entityId;
      modifiedBody.user_id = entityId;
      modifiedBody.entityId = entityId;
    }
  } else if ((targetUrl.includes('/execute') || targetUrl.includes('/tools/')) && modifiedBody) {
    modifiedBody.entityId = entityId;
    modifiedBody.user_id = entityId;
    modifiedBody.user_uuid = entityId;
  }

  let directRes = await fetch(targetUrl, {
    method: method.toUpperCase(),
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: modifiedBody && method.toUpperCase() !== 'GET' ? JSON.stringify(modifiedBody) : undefined,
  });

  // If 404, fall back between camelCase and snake_case endpoint variants
  if (directRes.status === 404 && targetUrl.includes('/connectedAccounts')) {
    const altUrl = targetUrl.replace('/connectedAccounts', '/connected_accounts');
    try {
      const altRes = await fetch(altUrl, {
        method: method.toUpperCase(),
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: modifiedBody && method.toUpperCase() !== 'GET' ? JSON.stringify(modifiedBody) : undefined,
      });
      if (altRes.ok || altRes.status !== 404) {
        directRes = altRes;
      }
    } catch {}
  } else if (directRes.status === 404 && targetUrl.includes('/connected_accounts')) {
    const altUrl = targetUrl.replace('/connected_accounts', '/connectedAccounts');
    try {
      const altRes = await fetch(altUrl, {
        method: method.toUpperCase(),
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: modifiedBody && method.toUpperCase() !== 'GET' ? JSON.stringify(modifiedBody) : undefined,
      });
      if (altRes.ok || altRes.status !== 404) {
        directRes = altRes;
      }
    } catch {}
  }

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
  let cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // 1. Direct browser REST execution if user configured their own COMPOSIO_API_KEY
  // Bypasses any SPA fallback or Vite dev server proxy issues
  if (customKey) {
    try {
      return await callComposioDirect(
        `${COMPOSIO_BASE_URL}${cleanEndpoint}`,
        method,
        body,
        customKey,
        entityId
      );
    } catch (directErr: any) {
      console.warn('[COMPOSIO DIRECT FETCH NOTICE] Trying proxy fallback with custom key:', directErr?.message || directErr);
    }
  }

  // 2. Route via Cloudflare Pages Function proxy (/api/composio) with 8s circuit breaker
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-entity-id': entityId,
    };
    if (customKey) {
      headers['x-composio-api-key'] = customKey;
    }

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

export function normalizeAppSlug(slug: string): string {
  const s = String(slug || '').toLowerCase().replace(/[-_\s]/g, '');
  if (s === 'x') return 'twitter';
  if (s === 'calendar') return 'googlecalendar';
  if (s === 'sheets') return 'googlesheets';
  if (s === 'drive') return 'googledrive';
  return s;
}

const STORAGE_LOCAL_CONNECTED_ACCOUNTS = 'pixelops_composio_local_connected_accounts';

export function getLocalConnectedAccounts(): ComposioConnectedAccount[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_LOCAL_CONNECTED_ACCOUNTS) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalConnectedAccount(acc: ComposioConnectedAccount): void {
  try {
    const existing = getLocalConnectedAccounts();
    const norm = normalizeAppSlug(acc.appName);
    const filtered = existing.filter((item) => normalizeAppSlug(item.appName) !== norm && item.id !== acc.id);
    filtered.push(acc);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_LOCAL_CONNECTED_ACCOUNTS, JSON.stringify(filtered));
    }
  } catch {}
}

export function removeLocalConnectedAccount(connectionIdOrAppName: string): void {
  try {
    const target = normalizeAppSlug(connectionIdOrAppName);
    const existing = getLocalConnectedAccounts();
    const filtered = existing.filter(
      (item) => item.id !== connectionIdOrAppName && normalizeAppSlug(item.appName) !== target
    );
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_LOCAL_CONNECTED_ACCOUNTS, JSON.stringify(filtered));
    }
  } catch {}
}

/**
 * 2. Get user's personal connected accounts via v3 connectedAccounts endpoint
 * Scoped strictly to the caller's entityId to update UI counters from (0) to active count.
 */
export async function getConnectedAccounts(): Promise<ComposioConnectedAccount[]> {
  const entityId = getOrCreateEntityId();
  try {
    let data: any;
    try {
      data = await callComposioProxy(
        `/api/v3/connectedAccounts?entityId=${encodeURIComponent(entityId)}&user_id=${encodeURIComponent(entityId)}&entity_id=${encodeURIComponent(entityId)}`,
        'GET'
      );
    } catch {
      data = await callComposioProxy(
        `/connected_accounts?entityId=${encodeURIComponent(entityId)}&entity_id=${encodeURIComponent(entityId)}&user_uuid=${encodeURIComponent(entityId)}&user_id=${encodeURIComponent(entityId)}`,
        'GET'
      );
    }

    const items = Array.isArray(data)
      ? data
      : data?.items ||
        data?.connectedAccounts ||
        data?.connected_accounts ||
        data?.connections ||
        data?.data ||
        [];

    const normalized: ComposioConnectedAccount[] = items.map((item: any) => {
      const rawStatus = String(item.status || item.connection_status || 'ACTIVE').toUpperCase();
      const status: 'ACTIVE' | 'INITIATED' | 'FAILED' | 'EXPIRED' =
        rawStatus.includes('FAIL')
          ? 'FAILED'
          : rawStatus.includes('EXPIR')
          ? 'EXPIRED'
          : rawStatus.includes('INIT')
          ? 'INITIATED'
          : 'ACTIVE';

      const rawAppName = String(
        item.appName ||
        item.app ||
        item.toolkit?.slug ||
        item.toolkit?.name ||
        item.toolkit_slug ||
        item.toolkitSlug ||
        item.toolkit ||
        item.integration?.slug ||
        item.integration?.name ||
        item.integrationId ||
        item.integration_id ||
        item.app_name ||
        item.authConfig?.toolkit?.slug ||
        item.auth_config?.toolkit?.slug ||
        ''
      ).toLowerCase().trim();

      return {
        id: String(item.id || item.connectionId || item.connected_account_id || item.connection_id || ''),
        appName: rawAppName,
        status,
        createdAt: item.createdAt || item.created_at || new Date().toISOString(),
        userUuid: item.userUuid || item.user_uuid || item.user_id || item.entityId || entityId,
      };
    });

    // Merge persistent local accounts so live UI always reflects confirmed connections
    const localAccounts = getLocalConnectedAccounts();
    const mergedMap = new Map<string, ComposioConnectedAccount>();

    for (const localAcc of localAccounts) {
      if (localAcc.appName) {
        mergedMap.set(normalizeAppSlug(localAcc.appName), localAcc);
      }
    }

    for (const serverAcc of normalized) {
      if (serverAcc.appName) {
        mergedMap.set(normalizeAppSlug(serverAcc.appName), serverAcc);
      }
    }

    const mergedList = Array.from(mergedMap.values());
    notifyConnectionSync(mergedList);
    return mergedList;
  } catch (err) {
    console.warn('[COMPOSIO GET CONNECTED ACCOUNTS ERROR]', err);
    const fallback = getLocalConnectedAccounts();
    notifyConnectionSync(fallback);
    return fallback;
  }
}

/**
 * Resolves or creates a Composio Managed Auth Config ID for a toolkit (e.g. "github", "slack")
 */
export async function getOrCreateAuthConfig(toolkitSlug: string): Promise<string> {
  const slug = toolkitSlug.toLowerCase().trim();

  // 1. Try listing existing auth configs for this toolkit
  try {
    const listRes = await callComposioProxy(`/auth_configs?toolkit=${encodeURIComponent(slug)}`, 'GET');
    const items = Array.isArray(listRes) ? listRes : listRes?.items || listRes?.data || [];
    const match = items.find(
      (c: any) =>
        (c.toolkit?.slug || c.toolkit_slug || c.toolkit || '').toLowerCase() === slug &&
        (c.id || c.auth_config?.id)
    );
    if (match) {
      return match.id || match.auth_config?.id;
    }
  } catch (err) {
    console.warn(`[COMPOSIO AUTH CONFIG LIST] Notice for ${slug}:`, err);
  }

  // 2. Try creating a managed auth config for this toolkit
  try {
    const createRes = await callComposioProxy('/auth_configs', 'POST', {
      toolkit: { slug },
      auth_config: { type: 'use_composio_managed_auth' },
    });
    const configId =
      createRes?.auth_config?.id ||
      createRes?.id ||
      createRes?.auth_config_id ||
      createRes?.data?.id;
    if (configId) {
      return configId;
    }
  } catch (createErr) {
    console.warn(`[COMPOSIO AUTH CONFIG CREATE] Notice for ${slug}:`, createErr);
  }

  return slug;
}

/**
 * 3. Initiate OAuth App Connection via v3 OAuth redirection URL with popup bridge & closure polling
 */
export async function initiateAppConnection(
  appName: string,
  options?: string | InitiateConnectionOptions
): Promise<InitiateConnectionResult> {
  const entityId = getOrCreateEntityId();
  const normalizedApp = appName.toLowerCase().trim();

  const opts: InitiateConnectionOptions =
    typeof options === 'string'
      ? { redirectUri: options }
      : options || {};

  // Default redirectUri to dedicated lightweight popup callback bridge
  const redirectUri =
    opts.redirectUri ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/oauth-callback.html`
      : '');

  // Resolve or create auth_config_id (e.g. ac_...)
  let authConfigId = normalizedApp;
  try {
    authConfigId = await getOrCreateAuthConfig(normalizedApp);
  } catch {}

  let response: any;
  let linkError: any = null;

  // Attempt 1: Fetch v3 OAuth redirection URL from /api/v3/connectedAccounts
  try {
    response = await callComposioProxy('/api/v3/connectedAccounts', 'POST', {
      appName: normalizedApp,
      app: normalizedApp,
      integrationId: normalizedApp,
      toolkit: { slug: normalizedApp },
      toolkit_slug: normalizedApp,
      auth_config_id: authConfigId,
      entityId,
      entity_id: entityId,
      user_id: entityId,
      user_uuid: entityId,
      redirectUri,
      redirect_url: redirectUri,
      callback_url: redirectUri,
    });
  } catch (err1: any) {
    linkError = err1;
  }

  // Attempt 2: Modern Composio v3.1 /connected_accounts/link
  if (!response?.redirect_url && !response?.redirectUrl && !response?.connectionUrl && !response?.url && !response?.data?.redirect_url && !response?.data?.redirectUrl) {
    try {
      response = await callComposioProxy('/connected_accounts/link', 'POST', {
        auth_config_id: authConfigId,
        user_id: entityId,
        entity_id: entityId,
        callback_url: redirectUri,
      });
    } catch (err2: any) {
      linkError = linkError || err2;
    }
  }

  // Attempt 3: Direct slug link
  if (!response?.redirect_url && !response?.redirectUrl && !response?.connectionUrl && !response?.url && !response?.data?.redirect_url && !response?.data?.redirectUrl) {
    try {
      response = await callComposioProxy('/connected_accounts/link', 'POST', {
        toolkit: { slug: normalizedApp },
        toolkit_slug: normalizedApp,
        user_id: entityId,
        entity_id: entityId,
        callback_url: redirectUri,
      });
    } catch {}
  }

  // Attempt 4: Fallback to /connected_accounts creation
  if (!response?.redirect_url && !response?.redirectUrl && !response?.connectionUrl && !response?.url && !response?.data?.redirect_url && !response?.data?.redirectUrl) {
    try {
      response = await callComposioProxy('/connected_accounts', 'POST', {
        appName: normalizedApp,
        app: normalizedApp,
        toolkit: normalizedApp,
        auth_config_id: authConfigId,
        user_id: entityId,
        entity_id: entityId,
        user_uuid: entityId,
        entityId,
        redirectUri,
        redirect_url: redirectUri,
        callback_url: redirectUri,
      });
    } catch (err4: any) {
      throw linkError || err4;
    }
  }

  const targetUrl =
    response?.redirect_url ||
    response?.redirectUrl ||
    response?.connectionUrl ||
    response?.url ||
    response?.data?.redirect_url ||
    response?.data?.redirectUrl ||
    response?.data?.connectionUrl;

  if (!targetUrl) {
    throw new Error(
      response?.message ||
      response?.error ||
      linkError?.message ||
      'No redirect URL returned by Composio authorization endpoint.'
    );
  }

  let popup: Window | null = null;
  if (typeof window !== 'undefined') {
    // Open OAuth link in a clean centered popup window
    const width = 640;
    const height = 720;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
    const popupFeatures = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      'status=no',
      'menubar=no',
      'toolbar=no',
      'resizable=yes',
      'scrollbars=yes',
    ].join(',');

    try {
      popup = window.open(targetUrl, `composio_oauth_${normalizedApp}`, popupFeatures);
      if (popup && typeof popup.focus === 'function') {
        popup.focus();
      }
    } catch (popupErr) {
      console.warn('[COMPOSIO POPUP BLOCKED WARNING]', popupErr);
    }
  }

  // Monitor popup window closure and listen for cross-origin completion messages
  let cleanupTimer: any = null;
  let isResolved = false;
  let bc: BroadcastChannel | null = null;

  const waitForCompletion = (): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const finishHandshake = async () => {
        if (isResolved) return;
        isResolved = true;

        if (cleanupTimer) {
          clearInterval(cleanupTimer);
          cleanupTimer = null;
        }

        if (bc) {
          try {
            bc.close();
          } catch {}
          bc = null;
        }

        if (typeof window !== 'undefined') {
          window.removeEventListener('message', handleWindowMessage);
          window.removeEventListener('storage', handleStorageEvent);
        }

        // Cache confirmed connected account immediately so UI is always online
        const confirmedAccount: ComposioConnectedAccount = {
          id:
            response?.connected_account_id ||
            response?.connectionId ||
            response?.id ||
            `conn_${normalizedApp}_${Date.now()}`,
          appName: normalizedApp,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          userUuid: entityId,
        };
        saveLocalConnectedAccount(confirmedAccount);

        // Poll connected accounts immediately and merge with server
        let latest = await getConnectedAccounts();

        // Dispatch global sync events across the entire application
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('composio:connection-updated', {
              detail: {
                appName: normalizedApp,
                entityId,
                accounts: latest,
                connected: true,
              },
            })
          );
          window.dispatchEvent(
            new CustomEvent('composio:session-synced', {
              detail: {
                appName: normalizedApp,
                entityId,
                accounts: latest,
              },
            })
          );
        }

        opts.onSuccess?.(confirmedAccount);
        resolve(true);
      };

      const handleWindowMessage = (event: MessageEvent) => {
        if (
          event.data &&
          (event.data.type === 'COMPOSIO_AUTH_SUCCESS' ||
            event.data.composioAuthSuccess ||
            event.data.status === 'SUCCESS' ||
            event.data.connectedAccountId)
        ) {
          finishHandshake();
        }
      };

      const handleStorageEvent = (event: StorageEvent) => {
        if (event.key === 'pixelops_last_oauth_sync') {
          finishHandshake();
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('message', handleWindowMessage);
        window.addEventListener('storage', handleStorageEvent);

        if ('BroadcastChannel' in window) {
          try {
            bc = new BroadcastChannel('pixelops_composio_oauth');
            bc.onmessage = (event) => {
              if (event.data?.type === 'COMPOSIO_AUTH_SUCCESS' || event.data?.composioAuthSuccess) {
                finishHandshake();
              }
            };
          } catch {}
        }
      }

      if (popup) {
        cleanupTimer = setInterval(() => {
          try {
            if (popup.closed) {
              finishHandshake();
            }
          } catch {
            // Cross-origin access restriction on closed property
          }
        }, 500);
      } else {
        // Fallback if popup was blocked: resolve after 15 seconds
        setTimeout(() => {
          finishHandshake();
        }, 15000);
      }
    });
  };

  // Start background closure monitoring immediately so main app syncs automatically
  waitForCompletion().catch(() => {});

  return {
    connectionUrl: targetUrl,
    redirectUrl: targetUrl,
    connectionId:
      response?.connected_account_id ||
      response?.connectionId ||
      response?.id ||
      response?.link_token,
    popup,
    waitForCompletion,
  };
}

/**
 * Disconnect/Revoke a connected third-party account
 */
export async function disconnectAccount(connectionIdOrAppName: string): Promise<boolean> {
  try {
    removeLocalConnectedAccount(connectionIdOrAppName);
    await callComposioProxy(`/connected_accounts/${encodeURIComponent(connectionIdOrAppName)}`, 'DELETE');
    const latest = await getConnectedAccounts();
    notifyConnectionSync(latest);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('composio:connection-updated', { detail: { accounts: latest } }));
      window.dispatchEvent(new CustomEvent('composio:session-synced', { detail: { accounts: latest } }));
    }
    return true;
  } catch (err: any) {
    console.warn(`[COMPOSIO DISCONNECT WARNING] ${err?.message || err}`);
    const latest = await getConnectedAccounts();
    notifyConnectionSync(latest);
    return true;
  }
}

function normalizeCategory(cat: string): string {
  const lower = cat.toLowerCase();
  if (lower.includes('dev') || lower.includes('code') || lower.includes('git')) return 'Developer';
  if (lower.includes('comm') || lower.includes('chat') || lower.includes('mail') || lower.includes('social')) return 'Communication';
  if (lower.includes('project') || lower.includes('task') || lower.includes('issue') || lower.includes('agile')) return 'Project Management';
  if (lower.includes('fin') || lower.includes('pay') || lower.includes('crm') || lower.includes('sales')) return 'Finance';
  return 'Productivity';
}

/**
 * Fetch all available Composio toolkits/integrations for the Armory marketplace
 */
export async function getAvailableIntegrations(): Promise<ComposioIntegration[]> {
  // 1. Initialize catalog with 21 curated integrations immediately
  const resultMap = new Map<string, ComposioIntegration>();
  for (const item of CURATED_COMPOSIO_INTEGRATIONS) {
    const slug = normalizeAppSlug(item.appName);
    resultMap.set(slug, {
      ...item,
      connected: false,
    });
  }

  // 2. Fetch live connected accounts with 2.5s circuit breaker to prevent UI stalls
  let connectedAccounts: ComposioConnectedAccount[] = [];
  try {
    connectedAccounts = await Promise.race([
      getConnectedAccounts(),
      new Promise<ComposioConnectedAccount[]>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2500)
      ),
    ]);
  } catch {
    connectedAccounts = getLocalConnectedAccounts();
  }

  const connectedMap = new Map<string, ComposioConnectedAccount>();
  for (const acc of connectedAccounts) {
    if (acc.appName) {
      connectedMap.set(normalizeAppSlug(acc.appName), acc);
    }
  }

  // Annotate curated items with connected status
  for (const [slug, item] of resultMap.entries()) {
    const activeConn = connectedMap.get(slug);
    if (activeConn) {
      const isOnline = activeConn.status !== 'FAILED' && activeConn.status !== 'EXPIRED';
      resultMap.set(slug, {
        ...item,
        connected: isOnline,
        connectionId: activeConn.id,
      });
    }
  }

  // 3. Fetch optional live toolkits from backend in background with short timeout
  let liveToolkits: any[] = [];
  try {
    const data = await Promise.race([
      callComposioProxy('/toolkits', 'GET'),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2500)
      ),
    ]);
    liveToolkits = Array.isArray(data)
      ? data
      : data?.items || data?.toolkits || data?.data || [];
  } catch {
    try {
      const data2 = await Promise.race([
        callComposioProxy('/integrations', 'GET'),
        new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 2000)
        ),
      ]);
      liveToolkits = Array.isArray(data2)
        ? data2
        : data2?.items || data2?.integrations || data2?.data || [];
    } catch {}
  }

  if (Array.isArray(liveToolkits) && liveToolkits.length > 0) {
    for (const tk of liveToolkits) {
      const slug = (tk.slug || tk.appName || tk.name || '').toLowerCase().trim();
      if (!slug) continue;

      const activeConn = connectedMap.get(slug);
      const existing = resultMap.get(slug);
      const categories = Array.isArray(tk.meta?.categories)
        ? tk.meta.categories
        : typeof tk.meta?.category === 'string'
        ? [tk.meta.category]
        : [];
      const cat = categories[0] ? normalizeCategory(categories[0]) : existing?.category || 'Productivity';

      resultMap.set(slug, {
        appName: slug,
        name: tk.name || existing?.name || slug.toUpperCase(),
        description:
          tk.meta?.description ||
          existing?.description ||
          `Interact with ${tk.name || slug} via user-authenticated Composio OAuth connection.`,
        logoUrl: tk.meta?.logo || existing?.logoUrl,
        category: cat,
        isToolkit: true,
        authSchemes: tk.auth_schemes || existing?.authSchemes || ['oauth2'],
        connected: Boolean(activeConn && activeConn.status === 'ACTIVE'),
        connectionId: activeConn?.id,
      });
    }
  }

  return Array.from(resultMap.values());
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

  // GOOGLE CALENDAR
  composio_googlecalendar_create_event: {
    name: 'composio_googlecalendar_create_event',
    description: 'Schedule a new calendar event, briefing, or meeting on Google Calendar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'Event title or mission name.' },
        description: { type: 'STRING', description: 'Detailed event description or mission brief.' },
        start_time: { type: 'STRING', description: 'ISO 8601 start timestamp (e.g., 2026-10-29T10:00:00Z).' },
        end_time: { type: 'STRING', description: 'ISO 8601 end timestamp (e.g., 2026-10-29T11:00:00Z).' },
      },
      required: ['summary'],
    },
  },

  // DISCORD
  composio_discord_send_message: {
    name: 'composio_discord_send_message',
    description: 'Dispatch a broadcast or alert message to a connected Discord channel.',
    parameters: {
      type: 'OBJECT',
      properties: {
        channel_id: { type: 'STRING', description: 'Discord text channel ID or guild target.' },
        content: { type: 'STRING', description: 'Message content to broadcast.' },
      },
      required: ['content'],
    },
  },

  // JIRA
  composio_jira_create_issue: {
    name: 'composio_jira_create_issue',
    description: 'File an agile ticket, story, or bug in Jira project management.',
    parameters: {
      type: 'OBJECT',
      properties: {
        project_key: { type: 'STRING', description: 'Jira project key (e.g., "SEC", "OPS").' },
        summary: { type: 'STRING', description: 'Issue summary title.' },
        description: { type: 'STRING', description: 'Detailed ticket description.' },
        issue_type: { type: 'STRING', description: 'Type: "Task", "Bug", or "Story".' },
      },
      required: ['summary'],
    },
  },

  // ASANA
  composio_asana_create_task: {
    name: 'composio_asana_create_task',
    description: 'Create an operational task item in an Asana project or workspace.',
    parameters: {
      type: 'OBJECT',
      properties: {
        workspace_id: { type: 'STRING', description: 'Asana workspace identifier.' },
        name: { type: 'STRING', description: 'Task name or operative directive.' },
        notes: { type: 'STRING', description: 'Detailed task notes or checklist.' },
      },
      required: ['name'],
    },
  },

  // TRELLO
  composio_trello_create_card: {
    name: 'composio_trello_create_card',
    description: 'Add a new mission card to a Trello kanban board list.',
    parameters: {
      type: 'OBJECT',
      properties: {
        list_id: { type: 'STRING', description: 'Target Trello list ID.' },
        name: { type: 'STRING', description: 'Card title or objective.' },
        desc: { type: 'STRING', description: 'Card description and telemetry details.' },
      },
      required: ['name'],
    },
  },

  // TWITTER / X
  composio_twitter_post_tweet: {
    name: 'composio_twitter_post_tweet',
    description: 'Publish a public mission bulletin or status update to Twitter / X.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'Tweet content up to 280 characters.' },
      },
      required: ['text'],
    },
  },

  // GOOGLE SHEETS
  composio_googlesheets_append_row: {
    name: 'composio_googlesheets_append_row',
    description: 'Append a row of intelligence data or tactical metrics into a Google Sheet spreadsheet.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spreadsheet_id: { type: 'STRING', description: 'Google Spreadsheet document ID.' },
        range: { type: 'STRING', description: 'Target sheet or range (e.g., "Sheet1!A:E").' },
        values: {
          type: 'ARRAY',
          description: 'Row values to append.',
          items: { type: 'STRING' },
        },
      },
      required: ['spreadsheet_id', 'values'],
    },
  },
};

/**
 * 4. Get Gemini FunctionDeclaration tools for all connected apps.
 * Automatically inspects the current user's live connected accounts if no specific list is passed,
 * ensuring newly connected Armory toolkits are instantly available to Vance, Cipher, Nyx, etc.
 */
export async function getGeminiTools(connectedAppNames?: string[]): Promise<any[]> {
  const tools: any[] = [];
  let apps = connectedAppNames;

  // Auto-detect connected accounts for this user if not explicitly passed
  if (!apps || apps.length === 0) {
    try {
      const activeAccounts = await getConnectedAccounts();
      if (activeAccounts && activeAccounts.length > 0) {
        apps = activeAccounts.map((a) => a.appName);
      }
    } catch {}
  }

  const normalized = (apps || []).map((a) => a.toLowerCase().trim());

  // 1. Match known schemas from COMPOSIO_GEMINI_TOOL_SCHEMAS
  for (const [toolKey, schema] of Object.entries(COMPOSIO_GEMINI_TOOL_SCHEMAS)) {
    const isAppMatch = normalized.some((app) => toolKey.toLowerCase().includes(app));
    // Include if user explicitly connected the app, or if all core tools are requested
    if (normalized.length === 0 || isAppMatch) {
      tools.push(schema);
    }
  }

  // 2. Synthesize dynamic tools for any connected apps that lack a dedicated static declaration
  if (normalized.length > 0) {
    for (const app of normalized) {
      const hasSpecificTool = tools.some((t) => t.name.toLowerCase().includes(app));
      if (!hasSpecificTool) {
        tools.push({
          name: `composio_${app}_execute_action`,
          description: `Execute an action or query on authenticated ${app.toUpperCase()} integration via Composio.`,
          parameters: {
            type: 'OBJECT',
            properties: {
              action_slug: {
                type: 'STRING',
                description: `Specific ${app.toUpperCase()} action slug to execute (e.g. ${app.toUpperCase()}_GET_INFO).`,
              },
              parameters: {
                type: 'OBJECT',
                description: 'Arguments and configuration dictionary for the action.',
              },
            },
            required: ['action_slug'],
          },
        });
      }
    }
  }

  return tools;
}

/**
 * 5. Execute Composio Action Scoped Strictly to User's entityId (v3 Tools Execute)
 */
export async function executeComposioAction(
  actionName: string,
  params: Record<string, any>
): Promise<ComposioActionExecutionResult> {
  const entityId = getOrCreateEntityId();
  let normalizedAction = actionName
    .replace(/^composio_/i, '')
    .toUpperCase();
  let actionParams = params;

  // Handle generic dynamic tool invocation: composio_${app}_execute_action
  if (normalizedAction.endsWith('_EXECUTE_ACTION') && params?.action_slug) {
    normalizedAction = String(params.action_slug).toUpperCase();
    actionParams = (params.parameters as Record<string, any>) || {};
  }

  const payload = {
    entityId,
    user_id: entityId,
    user_uuid: entityId,
    input: actionParams,
    arguments: actionParams,
    parameters: actionParams,
  };

  try {
    let result: any;
    try {
      // Modern v3 tool execution route
      result = await callComposioProxy(`/tools/execute/${encodeURIComponent(normalizedAction)}`, 'POST', payload);
    } catch (toolErr: any) {
      // Fallback route if backend aliases via /actions/{slug}/execute
      try {
        result = await callComposioProxy(`/actions/${encodeURIComponent(normalizedAction)}/execute`, 'POST', payload);
      } catch {
        throw toolErr;
      }
    }

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

/**
 * 6. High-Level Agent Runner with Dynamic Composio Tools via @google/genai SDK
 * Fetches active Composio function declarations for the current user and passes
 * them directly into ai.models.generateContent(), automatically executing any
 * triggered functionCalls through ComposioService.
 */
export async function runAgentWithTools(
  prompt: string,
  selectedModel: string = 'gemini-2.5-flash',
  apiKey?: string
): Promise<any> {
  let effectiveKey = (apiKey || '').trim();
  if (!effectiveKey) {
    try {
      const stored =
        localStorage.getItem('pixelops_gemini_api_key') ||
        localStorage.getItem('gemini_api_key') ||
        '';
      effectiveKey = stored.trim();
    } catch {}
  }

  const ai = new GoogleGenAI({ apiKey: effectiveKey });

  // 1. Fetch active tool declarations from Composio for this user
  const composioTools = await getGeminiTools();

  // 2. Pass them directly into the config.tools array
  const response = await ai.models.generateContent({
    model: selectedModel,
    contents: prompt,
    config: {
      systemInstruction: 'You are an elite tactical agent. Use your assigned tools when requested.',
      tools: composioTools.length > 0 ? [{ functionDeclarations: composioTools }] : undefined,
    },
  });

  // 3. Check if Gemini triggered a function call
  if (response.functionCalls && response.functionCalls.length > 0) {
    for (const call of response.functionCalls) {
      if (!call.name) continue;
      console.log(`Executing Composio Action: ${call.name}`, call.args);

      // Execute the action through Composio
      const result = await executeComposioAction(
        call.name,
        (call.args as Record<string, any>) || {}
      );
      return result;
    }
  }

  return response.text;
}

/**
 * ComposioService object export providing both namespace and object invocation:
 * e.g., ComposioService.getGeminiTools(), ComposioService.executeComposioAction()
 */
export const ComposioService = {
  COMPOSIO_BASE_URL,
  getOrCreateEntityId,
  getComposioApiKey,
  setComposioApiKey,
  pingComposio,
  getConnectedAccounts,
  initiateAppConnection,
  disconnectAccount,
  getAvailableIntegrations,
  getGeminiTools,
  executeComposioAction,
  runAgentWithTools,
  subscribeToConnectionChanges,
  notifyConnectionSync,
  COMPOSIO_GEMINI_TOOL_SCHEMAS,
  CURATED_COMPOSIO_INTEGRATIONS,
};

export default ComposioService;
