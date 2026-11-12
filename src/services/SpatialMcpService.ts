/**
 * Spatial MCP Stations & Physical Room Tool Leash Service
 * (src/services/SpatialMcpService.ts)
 *
 * 1. Stateless Model Context Protocol (MCP) JSON-RPC 2.0 client over HTTP / Streamable-HTTP:
 *    Users can attach any OSINT, code-audit, or security MCP server by URL, discover its
 *    `tools/list` schema, and invoke `tools/call` dynamically without custom API wrappers.
 * 2. Spatial Tool Leashes:
 *    Scopes both native safehouse capabilities and attached MCP servers to physical rooms:
 *    - External network & OSINT sweeps unlock inside `comms_tower` (Comms Tower).
 *    - VFS decryption, vault secret checks, & code sandboxes unlock inside `server_vault` (Server Vault).
 *    - Cross-dossier Evidence Graph & cold storage forensics unlock inside `archive_basement` / `war_room` / `library`.
 */

import { ledgerDb, type McpStationDbEntry } from './CommandLedgerDb';
import { storeSecureCredential, getSecureCredential } from './SecureVaultService';
import type { RoomId } from '../engine/roomData';

export type { McpStationDbEntry };

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface SpatialLeashPolicyConfig {
  /** When true, calls made while the operative is outside the required physical room are hard-blocked. */
  strictEnforcement: boolean;
  /** Room assignments for core sensitive capability groups. */
  roomLeashes: {
    externalNetworkSweeps: RoomId[];
    vfsVaultDecryption: RoomId[];
    evidenceForensics: RoomId[];
    cartridgeArmory: RoomId[];
  };
}

export interface SpatialLeashAuditEntry {
  id: string;
  timestamp: string;
  agentName: string;
  agentRoom: string;
  toolName: string;
  requiredRooms: string[];
  decision: 'ALLOWED' | 'BLOCKED_BY_SPATIAL_LEASH' | 'ROUTED_TO_ROOM';
  reason: string;
}

const MCP_STATIONS_LS_KEY = 'pixelops_spatial_mcp_stations_v1';
const SPATIAL_LEASH_POLICY_KEY = 'pixelops_spatial_leash_policy_v1';
const SPATIAL_LEASH_AUDIT_KEY = 'pixelops_spatial_leash_audit_v1';

const memoryMcpStations = new Map<string, McpStationDbEntry>();
let mcpHydrated = false;

export const DEFAULT_SPATIAL_LEASH_POLICY: SpatialLeashPolicyConfig = {
  strictEnforcement: false,
  roomLeashes: {
    externalNetworkSweeps: ['comms_tower'],
    vfsVaultDecryption: ['server_vault'],
    evidenceForensics: ['archive_basement', 'war_room', 'library'],
    cartridgeArmory: ['armory', 'war_room'],
  },
};

const EXTERNAL_NETWORK_SWEEP_TOOLS = new Set([
  'osint_shodan_host_lookup',
  'osint_crtsh_subdomain_discovery',
  'osint_bgp_route_lookup',
  'osint_ip_reputation_audit',
  'osint_virustotal_threat_check',
  'osint_code_leak_audit',
  'osint_spectrum_analyzer',
  'osint_satellite_recon',
  'api_fetch_gateway',
  'crawl_url',
  'extract_dom_elements',
]);

const VAULT_DECRYPTION_AND_SANDBOX_TOOLS = new Set([
  'decrypt_vault_secret',
  'verify_hash_checksum',
  'generate_secure_nonce',
  'code_sandbox_eval',
  'execute_shell_cmd',
  'memory_vector_lookup',
]);

const EVIDENCE_FORENSICS_TOOLS = new Set([
  'query_evidence_graph',
  'inspect_db_schema',
  'analyze_query_plan',
]);

function hydrateMcpFallback() {
  if (mcpHydrated) return;
  mcpHydrated = true;
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(MCP_STATIONS_LS_KEY);
    if (raw) {
      const list: McpStationDbEntry[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) memoryMcpStations.set(item.id, item);
      }
    }
  } catch {}
}

function persistMcpFallback() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      MCP_STATIONS_LS_KEY,
      JSON.stringify(Array.from(memoryMcpStations.values()))
    );
  } catch {}
}

function emitMcpChanged() {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('pixelops:mcp_stations_changed'));
    } catch {}
  }
}

export function loadSpatialLeashPolicy(): SpatialLeashPolicyConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SPATIAL_LEASH_POLICY };
  try {
    const raw = localStorage.getItem(SPATIAL_LEASH_POLICY_KEY);
    if (!raw) return { ...DEFAULT_SPATIAL_LEASH_POLICY };
    const parsed = JSON.parse(raw);
    return {
      strictEnforcement: Boolean(parsed?.strictEnforcement),
      roomLeashes: {
        ...DEFAULT_SPATIAL_LEASH_POLICY.roomLeashes,
        ...(parsed?.roomLeashes || {}),
      },
    };
  } catch {
    return { ...DEFAULT_SPATIAL_LEASH_POLICY };
  }
}

export function saveSpatialLeashPolicy(policy: SpatialLeashPolicyConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SPATIAL_LEASH_POLICY_KEY, JSON.stringify(policy));
    emitMcpChanged();
  } catch {}
}

export function loadSpatialLeashAuditLog(): SpatialLeashAuditEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SPATIAL_LEASH_AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendSpatialLeashAudit(entry: Omit<SpatialLeashAuditEntry, 'id' | 'timestamp'>): SpatialLeashAuditEntry {
  const full: SpatialLeashAuditEntry = {
    id: `leash_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  if (typeof localStorage !== 'undefined') {
    try {
      const prev = loadSpatialLeashAuditLog();
      localStorage.setItem(SPATIAL_LEASH_AUDIT_KEY, JSON.stringify([full, ...prev].slice(0, 60)));
    } catch {}
  }
  return full;
}

/**
 * Evaluates whether an operative physically stationed in `currentAgentRoom` has spatial clearance
 * to execute `toolName` (including dynamic `mcp__<stationId>__<tool>` tools).
 */
export async function evaluateSpatialToolLeash(params: {
  toolName: string;
  fsAction?: string;
  agentName: string;
  currentAgentRoom: string;
  overrideStrict?: boolean;
}): Promise<{
  allowed: boolean;
  requiredRooms: string[];
  decision: SpatialLeashAuditEntry['decision'];
  reason: string;
}> {
  const policy = loadSpatialLeashPolicy();
  const strict = params.overrideStrict ?? policy.strictEnforcement;
  const currentRoom = String(params.currentAgentRoom || 'war_room').toLowerCase();
  const toolName = String(params.toolName || '').trim();

  let requiredRooms: string[] | null = null;
  let scopeLabel = '';

  // 1. Check MCP station room leash (`mcp__<stationId>__<remoteToolName>`)
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const stationSlug = parts[1] || '';
    const stations = await listMcpStations();
    const matched = stations.find(
      (s) => sanitizeMcpSlug(s.id) === stationSlug || s.id === stationSlug
    );
    if (matched) {
      requiredRooms = [matched.room];
      scopeLabel = `MCP Station "${matched.name}"`;
      if (matched.strictRoomLeash && !requiredRooms.includes(currentRoom)) {
        const reason = `${scopeLabel} is physically leashed to ${matched.room.toUpperCase()} (agent is in ${currentRoom.toUpperCase()}). Move operative to ${matched.room.toUpperCase()} to unlock.`;
        appendSpatialLeashAudit({
          agentName: params.agentName,
          agentRoom: currentRoom,
          toolName,
          requiredRooms,
          decision: 'BLOCKED_BY_SPATIAL_LEASH',
          reason,
        });
        return { allowed: false, requiredRooms, decision: 'BLOCKED_BY_SPATIAL_LEASH', reason };
      }
    }
  } else if (EXTERNAL_NETWORK_SWEEP_TOOLS.has(toolName)) {
    requiredRooms = policy.roomLeashes.externalNetworkSweeps;
    scopeLabel = 'External Network & OSINT Sweep';
  } else if (
    VAULT_DECRYPTION_AND_SANDBOX_TOOLS.has(toolName) ||
    (toolName === 'fs_storage_manager' &&
      ['delete', 'consolidate', 'prune'].includes(String(params.fsAction || '').toLowerCase()))
  ) {
    requiredRooms = policy.roomLeashes.vfsVaultDecryption;
    scopeLabel = 'Server Vault VFS Decryption & Sandbox';
  } else if (EVIDENCE_FORENSICS_TOOLS.has(toolName)) {
    requiredRooms = policy.roomLeashes.evidenceForensics;
    scopeLabel = 'Evidence Graph & Archive Forensics';
  }

  if (!requiredRooms || requiredRooms.length === 0) {
    return {
      allowed: true,
      requiredRooms: [],
      decision: 'ALLOWED',
      reason: 'Unrestricted safehouse utility tool.',
    };
  }

  if (requiredRooms.includes(currentRoom)) {
    const reason = `${scopeLabel} unlocked inside authorized sector ${currentRoom.toUpperCase()}.`;
    appendSpatialLeashAudit({
      agentName: params.agentName,
      agentRoom: currentRoom,
      toolName,
      requiredRooms,
      decision: 'ALLOWED',
      reason,
    });
    return { allowed: true, requiredRooms, decision: 'ALLOWED', reason };
  }

  if (strict) {
    const targetBadge = requiredRooms.map((r) => r.toUpperCase()).join(' or ');
    const reason = `SPATIAL LEASH BLOCKED: ${scopeLabel} (${toolName}) requires physical presence in ${targetBadge}, but ${params.agentName} is stationed in ${currentRoom.toUpperCase()}.`;
    appendSpatialLeashAudit({
      agentName: params.agentName,
      agentRoom: currentRoom,
      toolName,
      requiredRooms,
      decision: 'BLOCKED_BY_SPATIAL_LEASH',
      reason,
    });
    return { allowed: false, requiredRooms, decision: 'BLOCKED_BY_SPATIAL_LEASH', reason };
  }

  const routeTarget = requiredRooms[0];
  const reason = `Assisted Spatial Leash: routing ${params.agentName} from ${currentRoom.toUpperCase()} -> ${routeTarget.toUpperCase()} to unlock ${scopeLabel}.`;
  appendSpatialLeashAudit({
    agentName: params.agentName,
    agentRoom: currentRoom,
    toolName,
    requiredRooms,
    decision: 'ROUTED_TO_ROOM',
    reason,
  });
  return { allowed: true, requiredRooms, decision: 'ROUTED_TO_ROOM', reason };
}

export function sanitizeMcpSlug(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
}

export async function listMcpStations(): Promise<McpStationDbEntry[]> {
  hydrateMcpFallback();
  try {
    if (ledgerDb && ledgerDb.mcp_stations) {
      const rows = await ledgerDb.mcp_stations.toArray();
      if (rows.length > 0 || memoryMcpStations.size === 0) {
        return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
    }
  } catch {}
  return Array.from(memoryMcpStations.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

export async function saveMcpStation(
  station: Omit<McpStationDbEntry, 'updatedAt'> & { authTokenPlaintext?: string }
): Promise<McpStationDbEntry> {
  hydrateMcpFallback();
  const { authTokenPlaintext, ...rest } = station;

  let hasStoredToken = Boolean(rest.hasStoredToken);
  if (typeof authTokenPlaintext === 'string' && authTokenPlaintext.trim()) {
    await storeSecureCredential(`mcp_token_${rest.id}`, authTokenPlaintext.trim());
    hasStoredToken = true;
  }

  const record: McpStationDbEntry = {
    ...rest,
    hasStoredToken,
    updatedAt: new Date().toISOString(),
  };

  memoryMcpStations.set(record.id, record);
  persistMcpFallback();

  try {
    if (ledgerDb && ledgerDb.mcp_stations) {
      await ledgerDb.mcp_stations.put(record);
    }
  } catch {}

  emitMcpChanged();
  return record;
}

export async function deleteMcpStation(stationId: string): Promise<void> {
  hydrateMcpFallback();
  memoryMcpStations.delete(stationId);
  persistMcpFallback();
  try {
    if (ledgerDb && ledgerDb.mcp_stations) {
      await ledgerDb.mcp_stations.delete(stationId);
    }
  } catch {}
  emitMcpChanged();
}

function parseSseJsonRpc(rawSse: string): any {
  const blocks = rawSse.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (lines.length === 0) continue;
    try {
      const parsed = JSON.parse(lines.join('\n'));
      if (parsed && ('result' in parsed || 'error' in parsed)) return parsed;
    } catch {}
  }
  return null;
}

/**
 * Sends a single stateless JSON-RPC 2.0 request to an MCP HTTP / Streamable-HTTP endpoint,
 * automatically falling back to `/api/mcp` when direct browser fetch encounters CORS restrictions.
 */
export async function sendStatelessMcpRpc(params: {
  serverUrl: string;
  method: string;
  rpcParams?: Record<string, any>;
  sessionId?: string;
  authHeaderName?: string;
  authHeaderValue?: string;
}): Promise<{ rpc: any; sessionId?: string }> {
  const rpcBody = {
    jsonrpc: '2.0',
    id: `px_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    method: params.method,
    params: params.rpcParams ?? {},
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (params.sessionId) {
    headers['Mcp-Session-Id'] = params.sessionId;
  }
  if (params.authHeaderName && params.authHeaderValue) {
    headers[params.authHeaderName] = params.authHeaderValue;
  }

  // 1. Try direct fetch first (works for CORS-enabled remote MCP servers, localhost MCP servers, and Node tests)
  try {
    const directRes = await fetch(params.serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcBody),
    });
    if (directRes.ok) {
      const sid =
        directRes.headers.get('mcp-session-id') ||
        directRes.headers.get('Mcp-Session-Id') ||
        params.sessionId;
      const ct = directRes.headers.get('content-type') || '';
      if (ct.includes('text/event-stream')) {
        const sse = await directRes.text();
        return { rpc: parseSseJsonRpc(sse), sessionId: sid };
      }
      return { rpc: await directRes.json(), sessionId: sid };
    }
  } catch {
    // Fall through to /api/mcp proxy if running in browser
  }

  // 2. Fallback to safehouse `/api/mcp` CORS relay
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location?.protocol || '')) {
    const proxyRes = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverUrl: params.serverUrl,
        rpcBody,
        sessionId: params.sessionId,
        authHeaderName: params.authHeaderName,
        authHeaderValue: params.authHeaderValue,
      }),
    });
    const data: any = await proxyRes.json().catch(() => null);
    if (!proxyRes.ok || !data?.ok) {
      throw new Error(data?.error || `MCP relay failed (HTTP ${proxyRes.status})`);
    }
    return { rpc: data.rpc, sessionId: data.sessionId || params.sessionId };
  }

  throw new Error(`Unable to reach MCP server at ${params.serverUrl}`);
}

async function resolveStationAuth(station: McpStationDbEntry): Promise<{
  authHeaderName?: string;
  authHeaderValue?: string;
}> {
  if (!station.hasStoredToken) return {};
  const secret = await getSecureCredential(`mcp_token_${station.id}`);
  if (!secret) return {};
  const headerName = station.authHeaderName || 'Authorization';
  const headerValue =
    headerName.toLowerCase() === 'authorization' && !/^(bearer|basic|token)\s+/i.test(secret)
      ? `Bearer ${secret}`
      : secret;
  return { authHeaderName: headerName, authHeaderValue: headerValue };
}

/**
 * Performs stateless MCP handshake (`initialize` -> `tools/list`) to discover remote tools
 * and caches their JSON schemas on the station record.
 */
export async function probeMcpStationTools(station: McpStationDbEntry): Promise<{
  ok: boolean;
  tools: McpToolDescriptor[];
  serverInfo?: { name?: string; version?: string };
  error?: string;
}> {
  try {
    const auth = await resolveStationAuth(station);
    let sessionId: string | undefined;
    let serverInfo: { name?: string; version?: string } | undefined;

    // Step 1: MCP `initialize` (best-effort; stateless tool-only servers may jump straight to tools/list)
    try {
      const initRes = await sendStatelessMcpRpc({
        serverUrl: station.serverUrl,
        method: 'initialize',
        rpcParams: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'PixelOps-Spatial-MCP-Client', version: '1.0.0' },
        },
        ...auth,
      });
      sessionId = initRes.sessionId;
      serverInfo = initRes.rpc?.result?.serverInfo;
    } catch {
      // Proceed to tools/list directly if server is purely stateless per-method
    }

    // Step 2: MCP `tools/list`
    const listRes = await sendStatelessMcpRpc({
      serverUrl: station.serverUrl,
      method: 'tools/list',
      rpcParams: {},
      sessionId,
      ...auth,
    });

    if (listRes.rpc?.error) {
      throw new Error(listRes.rpc.error.message || 'MCP server returned JSON-RPC error on tools/list');
    }

    const rawTools = listRes.rpc?.result?.tools;
    const tools: McpToolDescriptor[] = Array.isArray(rawTools)
      ? rawTools
          .filter((t: any) => t && typeof t.name === 'string')
          .map((t: any) => ({
            name: t.name,
            description: String(t.description || `Remote MCP tool ${t.name}`),
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
          }))
      : [];

    await saveMcpStation({
      ...station,
      cachedToolsJson: JSON.stringify(tools),
      lastProbedAt: new Date().toISOString(),
      lastStatus: 'online',
      lastError: undefined,
    });

    return { ok: true, tools, serverInfo };
  } catch (err: any) {
    const msg = err?.message || 'MCP handshake failed';
    await saveMcpStation({
      ...station,
      lastProbedAt: new Date().toISOString(),
      lastStatus: 'error',
      lastError: msg,
    });
    return { ok: false, tools: [], error: msg };
  }
}

export function getCachedMcpTools(station: McpStationDbEntry): McpToolDescriptor[] {
  if (!station.cachedToolsJson) return [];
  try {
    const parsed = JSON.parse(station.cachedToolsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Builds Gemini-compatible function declarations for enabled MCP stations accessible to the operative's room.
 */
export async function buildSpatialMcpFunctionDeclarations(currentAgentRoom?: string): Promise<
  Array<{
    name: string;
    description: string;
    parameters: {
      type: 'OBJECT';
      properties: Record<string, any>;
      required?: string[];
    };
    _mcpMeta: { stationId: string; stationRoom: string; remoteToolName: string };
  }>
> {
  const stations = (await listMcpStations()).filter((s) => s.enabled);
  const policy = loadSpatialLeashPolicy();
  const normRoom = currentAgentRoom ? currentAgentRoom.toLowerCase() : undefined;

  const declarations: Array<any> = [];
  for (const st of stations) {
    if (normRoom && (st.strictRoomLeash || policy.strictEnforcement) && st.room !== normRoom) {
      continue;
    }
    const tools = getCachedMcpTools(st);
    const stationSlug = sanitizeMcpSlug(st.id);

    for (const tool of tools) {
      const toolSlug = sanitizeMcpSlug(tool.name);
      const fnName = `mcp__${stationSlug}__${toolSlug}`;
      const rawProps = tool.inputSchema?.properties || {};
      const geminiProps: Record<string, any> = {};

      for (const [k, v] of Object.entries(rawProps)) {
        const rawType = String((v as any)?.type || 'string').toUpperCase();
        const mappedType = ['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'].includes(
          rawType
        )
          ? rawType
          : 'STRING';
        geminiProps[k] = {
          type: mappedType,
          description: String((v as any)?.description || k),
        };
      }

      declarations.push({
        name: fnName,
        description: `[Spatial MCP · ${st.name} @ ${st.room.toUpperCase()}] ${tool.description}`,
        parameters: {
          type: 'OBJECT',
          properties: geminiProps,
          required: Array.isArray(tool.inputSchema?.required)
            ? tool.inputSchema!.required.filter((r) => r in geminiProps)
            : [],
        },
        _mcpMeta: {
          stationId: st.id,
          stationRoom: st.room,
          remoteToolName: tool.name,
        },
      });
    }
  }
  return declarations;
}

/**
 * Invokes `tools/call` on a spatially-bound MCP station after verifying the physical room leash.
 */
export async function executeSpatialMcpToolCall(params: {
  compositeToolName: string;
  args: Record<string, any>;
  agentName: string;
  currentAgentRoom: string;
}): Promise<{
  ok: boolean;
  station?: McpStationDbEntry;
  remoteToolName?: string;
  result?: any;
  error?: string;
  leashBlocked?: boolean;
}> {
  const leashCheck = await evaluateSpatialToolLeash({
    toolName: params.compositeToolName,
    agentName: params.agentName,
    currentAgentRoom: params.currentAgentRoom,
  });

  if (!leashCheck.allowed) {
    return {
      ok: false,
      leashBlocked: true,
      error: leashCheck.reason,
    };
  }

  const parts = params.compositeToolName.split('__');
  const stationSlug = parts[1] || '';
  const toolSlug = parts.slice(2).join('__');

  const stations = await listMcpStations();
  const station = stations.find(
    (s) => sanitizeMcpSlug(s.id) === stationSlug || s.id === stationSlug
  );
  if (!station) {
    return { ok: false, error: `MCP station "${stationSlug}" not found.` };
  }

  const tools = getCachedMcpTools(station);
  const matchedTool = tools.find((t) => sanitizeMcpSlug(t.name) === toolSlug || t.name === toolSlug);
  const remoteToolName = matchedTool?.name || toolSlug;

  const auth = await resolveStationAuth(station);
  let sessionId: string | undefined;
  try {
    const initRes = await sendStatelessMcpRpc({
      serverUrl: station.serverUrl,
      method: 'initialize',
      rpcParams: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'PixelOps-Spatial-MCP-Client', version: '1.0.0' },
      },
      ...auth,
    });
    sessionId = initRes.sessionId;
  } catch {}

  const callRes = await sendStatelessMcpRpc({
    serverUrl: station.serverUrl,
    method: 'tools/call',
    rpcParams: {
      name: remoteToolName,
      arguments: params.args || {},
    },
    sessionId,
    ...auth,
  });

  if (callRes.rpc?.error) {
    return {
      ok: false,
      station,
      remoteToolName,
      error: callRes.rpc.error.message || 'MCP tools/call returned error',
    };
  }

  return {
    ok: true,
    station,
    remoteToolName,
    result: callRes.rpc?.result ?? callRes.rpc,
  };
}
