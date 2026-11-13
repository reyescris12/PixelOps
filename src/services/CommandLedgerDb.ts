import Dexie, { type Table } from 'dexie';

/**
 * Immutable Command Ledger Schema stored in IndexedDB via Dexie.js
 * Records: [timestamp, command_input, involved_agent, tool_used, result_summary, success_boost_achieved, ledger_hash]
 */
export interface CommandLedgerEntry {
  id?: number;
  timestamp: string;
  command_input: string;
  involved_agent: string;
  tool_used: string;
  result_summary: string;
  success_boost_achieved: number;
  ledger_hash: string;
}

/**
 * Isolated Agent Memory Schema stored in Dexie.js IndexedDB.
 * Separate memory tables per agent retaining distinct operational histories and reflections over time.
 */
export interface AgentMemoryDbEntry {
  id?: number;
  agentId: string;
  timestamp: string;
  prompt: string;
  summary: string;
  reflection?: string;
}

function computeImmutableHash(
  payload: Omit<CommandLedgerEntry, 'id' | 'ledger_hash'>
): string {
  const raw = `${payload.timestamp}|${payload.command_input}|${payload.involved_agent}|${payload.tool_used}|${payload.result_summary}|${payload.success_boost_achieved}`;
  let h1 = 0xdeadbeef ^ raw.length;
  let h2 = 0x41c6ce57 ^ raw.length;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `0x${hex1}${hex2}`;
}

/**
 * Workspace File Record Schema stored in Dexie.js IndexedDB.
 * Holds agent-generated markdown reports, logs, and workspace task files.
 */
export interface WorkspaceFileDbEntry {
  id?: number;
  path: string;
  category: string;
  format: string;
  content: string;
  sizeBytes: number;
  updatedAt: string;
}

/**
 * Encrypted Credential Schema stored in Dexie.js IndexedDB (encrypted_credentials).
 * Holds encrypted tokens and keys at rest using non-extractable WebCrypto AES-GCM 256-bit keys.
 */
export interface EncryptedCredentialDbEntry {
  key: string;
  ciphertextB4: string;
  ciphertextB64?: string;
  iv: number[];
  ivB64?: string;
  algorithm?: string;
  updatedAt: string;
  /** Non-extractable master CryptoKey persisted via structured clone (master-key record only). */
  cryptoKey?: CryptoKey;
  /** Legacy exported JWK master key material (migration only). */
  rawKeyData?: JsonWebKey;
}

export type EvidenceEntityType =
  | 'ip'
  | 'domain'
  | 'asn'
  | 'cve'
  | 'threat_actor'
  | 'mitre'
  | 'hash'
  | 'dossier';

export interface EvidenceNodeDbEntry {
  id: string; // e.g. "ip:185.220.101.45" or "dossier:intel/report.md"
  type: EvidenceEntityType;
  label: string;
  value: string;
  dossierPaths: string[];
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface EvidenceEdgeDbEntry {
  id: string; // e.g. "ip:1.2.3.4->dossier:intel/a.md:MENTIONED_IN"
  sourceId: string;
  targetId: string;
  relation: 'MENTIONED_IN' | 'CO_OCCURS_WITH';
  filePath: string;
  weight: number;
  contextSnippet?: string;
  updatedAt: string;
}

export interface McpStationDbEntry {
  id: string;
  name: string;
  serverUrl: string;
  room: string;
  stationId?: string;
  enabled: boolean;
  strictRoomLeash: boolean;
  authHeaderName?: string;
  hasStoredToken?: boolean;
  cachedToolsJson?: string;
  lastProbedAt?: string;
  lastStatus?: 'online' | 'offline' | 'untested' | 'error';
  lastError?: string;
  updatedAt: string;
}

export interface TripwireWatchDbEntry {
  id: string;
  label: string;
  category: 'dns' | 'ct_certs' | 'usgs_seismic' | 'maritime_ais' | 'web_hash';
  target: string;
  assignedRoom: string;
  assignedAgentId: string;
  intervalMinutes: number;
  enabled: boolean;
  requireHumanApproval: boolean;
  lastSha256?: string;
  lastNormalizedSnapshot?: string;
  lastCheckedAt?: string;
  unchangedChecksCount: number;
  deltaCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TripwireAlertDbEntry {
  id: string;
  watchId: string;
  watchLabel: string;
  category: TripwireWatchDbEntry['category'];
  target: string;
  previousHash: string;
  newHash: string;
  addedItems: string[];
  removedItems: string[];
  diffSummary: string;
  recommendedDirective: string;
  assignedAgentId: string;
  assignedRoom: string;
  status: 'pending_approval' | 'approved_dispatched' | 'acknowledged' | 'dismissed';
  detectedAt: string;
  resolvedAt?: string;
}

export type CorroborationSourceTrack =
  | 'WIDE_AREA'
  | 'SIGNALS_INFRA'
  | 'WRITTEN_WIRE'
  | 'CYBER_CVE';

export interface CorroborationGeoAnchor {
  lat: number;
  lon: number;
  radiusKm: number;
  precision: 'EXACT' | 'REGIONAL';
}

export interface EvidencePacketDbEntry {
  packetId: string;
  sourceTrack: CorroborationSourceTrack;
  sourceType: string;
  canonicalTargetKey: string;
  payloadTimestamp: string;
  sourceEndpoint: string;
  ingestedBy: string;
  capturedAt: string;
  ttlSeconds: number;
  geoAnchor: CorroborationGeoAnchor;
  sectorKey: string;
  entities: {
    mmsi: string[];
    noradId: string[];
    ipAsn: string[];
    domains: string[];
    cves: string[];
    gridSectors: string[];
    canonicalKeys: string[];
  };
  rawPayloadRef: string;
  rawPayloadJson?: string;
  summaryHeadline: string;
  structuralHash: string;
  structuralMetrics?: Record<string, string | number | boolean>;
}

export interface SnapshotBaselineDbEntry {
  snapshotKey: string;
  sourceTrack: CorroborationSourceTrack;
  sourceType: string;
  canonicalTargetKey: string;
  sectorKey: string;
  structuralHash: string;
  structuralMetrics: Record<string, string | number | boolean>;
  packetId: string;
  updatedAt: string;
}

export interface DeltaEventDbEntry {
  deltaId: string;
  packetId: string;
  sourceTrack: CorroborationSourceTrack;
  sourceType: string;
  sourceEndpoint: string;
  ingestedBy: string;
  sectorKey: string;
  capturedAt: string;
  ttlSeconds: number;
  expiresAt: string;
  geoAnchor: CorroborationGeoAnchor;
  entities: string[];
  thresholdReason: string;
  severityWeight: number;
  rawPayloadRef: string;
}

export type CorroborationClusterStatus =
  | 'CANDIDATE'
  | 'CORROBORATED'
  | 'CRITICAL_CONVERGENCE'
  | 'STALE'
  | 'DISMISSED';

export interface CorroborationClusterDbEntry {
  clusterId: string;
  title: string;
  sectorKey: string;
  geoAnchor: CorroborationGeoAnchor;
  status: CorroborationClusterStatus;
  corroborationScore: number;
  independentTracks: CorroborationSourceTrack[];
  packetIds: string[];
  deltaIds: string[];
  sharedEntities: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  sitrepPath?: string;
  sitrepMarkdown?: string;
  vanceSynthesisJson?: string;
  nominationId?: string;
  nominationStatus?:
    | 'UNNOMINATED'
    | 'PENDING_HUMAN_REVIEW'
    | 'NOMINATED_APPROVED'
    | 'DISMISSED_FALSE_POSITIVE';
}

export interface NominationPackageDbEntry {
  nominationId: string;
  clusterId: string;
  actionType: 'COMPOSIO_GITHUB_ISSUE' | 'WEBHOOK_DISPATCH' | 'ARCHIVE_SITREP';
  title: string;
  rationale: string;
  citedPacketIds: string[];
  outboundPayloadJson: string;
  status: 'PENDING_HUMAN_REVIEW' | 'NOMINATED_APPROVED' | 'DISMISSED';
  createdAt: string;
  decidedAt?: string;
  approvedBy?: string;
  ledgerHash?: string;
  ledgerEntryId?: number;
}

class PixelOpsLedgerDatabase extends Dexie {
  command_ledger!: Table<CommandLedgerEntry, number>;
  agent_memories!: Table<AgentMemoryDbEntry, number>;
  workspace_files!: Table<WorkspaceFileDbEntry, number>;
  encrypted_credentials!: Table<EncryptedCredentialDbEntry, string>;
  evidence_nodes!: Table<EvidenceNodeDbEntry, string>;
  evidence_edges!: Table<EvidenceEdgeDbEntry, string>;
  mcp_stations!: Table<McpStationDbEntry, string>;
  tripwire_watches!: Table<TripwireWatchDbEntry, string>;
  tripwire_alerts!: Table<TripwireAlertDbEntry, string>;
  evidence_packets!: Table<EvidencePacketDbEntry, string>;
  corroboration_snapshots!: Table<SnapshotBaselineDbEntry, string>;
  delta_events!: Table<DeltaEventDbEntry, string>;
  corroboration_clusters!: Table<CorroborationClusterDbEntry, string>;
  nomination_packages!: Table<NominationPackageDbEntry, string>;

  constructor() {
    super('PixelOpsImmutableLedgerDB');

    this.version(2).stores({
      command_ledger:
        '++id, timestamp, involved_agent, tool_used, success_boost_achieved, ledger_hash',
      agent_memories:
        '++id, agentId, timestamp, prompt',
    });

    this.version(3).stores({
      command_ledger:
        '++id, timestamp, involved_agent, tool_used, success_boost_achieved, ledger_hash',
      agent_memories:
        '++id, agentId, timestamp, prompt',
      workspace_files:
        '++id, &path, category, format, updatedAt',
    });

    this.version(4).stores({
      command_ledger:
        '++id, timestamp, involved_agent, tool_used, success_boost_achieved, ledger_hash',
      agent_memories:
        '++id, agentId, timestamp, prompt',
      workspace_files:
        '++id, &path, category, format, updatedAt',
      encrypted_credentials:
        '&key, updatedAt',
    });

    this.version(5).stores({
      command_ledger:
        '++id, timestamp, involved_agent, tool_used, success_boost_achieved, ledger_hash',
      agent_memories:
        '++id, agentId, timestamp, prompt',
      workspace_files:
        '++id, &path, category, format, updatedAt',
      encrypted_credentials:
        '&key, updatedAt',
      evidence_nodes:
        '&id, type, value, hitCount, lastSeenAt',
      evidence_edges:
        '&id, sourceId, targetId, relation, filePath, updatedAt',
      mcp_stations:
        '&id, room, enabled, updatedAt',
      tripwire_watches:
        '&id, category, target, enabled, lastCheckedAt',
      tripwire_alerts:
        '&id, watchId, status, detectedAt',
    });

    this.version(6).stores({
      command_ledger:
        '++id, timestamp, involved_agent, tool_used, success_boost_achieved, ledger_hash',
      agent_memories:
        '++id, agentId, timestamp, prompt',
      workspace_files:
        '++id, &path, category, format, updatedAt',
      encrypted_credentials:
        '&key, updatedAt',
      evidence_nodes:
        '&id, type, value, hitCount, lastSeenAt',
      evidence_edges:
        '&id, sourceId, targetId, relation, filePath, updatedAt',
      mcp_stations:
        '&id, room, enabled, updatedAt',
      tripwire_watches:
        '&id, category, target, enabled, lastCheckedAt',
      tripwire_alerts:
        '&id, watchId, status, detectedAt',
      evidence_packets:
        '&packetId, sourceTrack, ingestedBy, capturedAt, sectorKey',
      corroboration_snapshots:
        '&snapshotKey, sourceTrack, sectorKey, updatedAt',
      delta_events:
        '&deltaId, packetId, sourceTrack, sectorKey, capturedAt, expiresAt',
      corroboration_clusters:
        '&clusterId, status, corroborationScore, sectorKey, updatedAt',
      nomination_packages:
        '&nominationId, clusterId, status, createdAt',
    });

    // Enforce append-only immutability on the command_ledger table
    this.command_ledger.hook('updating', function () {
      throw new Error(
        'IMMUTABLE_LEDGER_VIOLATION: Command ledger records cannot be modified once committed.'
      );
    });

    this.command_ledger.hook('deleting', function () {
      throw new Error(
        'IMMUTABLE_LEDGER_VIOLATION: Command ledger records cannot be deleted once committed.'
      );
    });
  }
}

export const ledgerDb = new PixelOpsLedgerDatabase();
export const db = ledgerDb;
if (typeof globalThis !== 'undefined') (globalThis as any).__ledgerDb = ledgerDb;

/**
 * Standardized storage persistence request using the modern navigator.storage API.
 * Replaces legacy browser storage persistence APIs.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
    try {
      const granted = await navigator.storage.persist();
      if (granted) {
        console.log('Storage persistence granted.');
      }
      return Boolean(granted);
    } catch (err) {
      console.warn('[StorageManager] Error requesting storage persistence:', err);
      return false;
    }
  }
  return false;
}

// Request persistent storage on database initialization in browser environments
if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((granted) => {
      if (granted) {
        console.log('Storage persistence granted.');
      }
    }).catch(() => {});
  }
}

const INITIAL_SEED_COMMANDS: Array<
  Omit<CommandLedgerEntry, 'id' | 'ledger_hash'>
> = [];

const inMemoryLedger: CommandLedgerEntry[] = [];
const inMemoryAgentMemories: AgentMemoryDbEntry[] = [];
const inMemoryWorkspaceFiles: WorkspaceFileDbEntry[] = [];

/**
 * Appends a new immutable command record to the Dexie/IndexedDB ledger.
 */
export async function appendCommandLedgerEntry(
  entry: Omit<CommandLedgerEntry, 'id' | 'ledger_hash'>
): Promise<CommandLedgerEntry> {
  const fullRecord: CommandLedgerEntry = {
    ...entry,
    ledger_hash: computeImmutableHash(entry),
  };
  try {
    const id = await ledgerDb.command_ledger.add(fullRecord);
    return {
      ...fullRecord,
      id,
    };
  } catch {
    const mockId = inMemoryLedger.length + 1;
    const recordWithId = { ...fullRecord, id: mockId };
    inMemoryLedger.unshift(recordWithId);
    return recordWithId;
  }
}

/**
 * Queries Dexie/IndexedDB for the last 50 commands ordered newest-first.
 */
export async function getLast50Commands(): Promise<CommandLedgerEntry[]> {
  try {
    const count = await ledgerDb.command_ledger.count();
    if (count === 0 && INITIAL_SEED_COMMANDS.length > 0) {
      for (const seed of INITIAL_SEED_COMMANDS) {
        await appendCommandLedgerEntry(seed);
      }
    }

    const records = await ledgerDb.command_ledger
      .orderBy('timestamp')
      .reverse()
      .limit(50)
      .toArray();

    return Object.freeze(records.map((r) => Object.freeze({ ...r }))) as CommandLedgerEntry[];
  } catch {
    return Object.freeze(inMemoryLedger.slice(0, 50).map((r) => Object.freeze({ ...r }))) as CommandLedgerEntry[];
  }
}

/**
 * Appends a memory/reflection entry to an agent's isolated memory table in IndexedDB.
 */
export async function appendAgentMemoryEntry(entry: {
  agentId: string;
  prompt: string;
  summary: string;
  reflection?: string;
}): Promise<AgentMemoryDbEntry> {
  const record: AgentMemoryDbEntry = {
    agentId: entry.agentId,
    timestamp: new Date().toISOString(),
    prompt: entry.prompt,
    summary: entry.summary,
    reflection: entry.reflection || `Operational memory logged for ${entry.agentId}`,
  };
  try {
    const id = await ledgerDb.agent_memories.add(record);
    return { ...record, id };
  } catch {
    const mockId = inMemoryAgentMemories.length + 1;
    const rec = { ...record, id: mockId };
    inMemoryAgentMemories.unshift(rec);
    return rec;
  }
}

/**
 * Alias for appendAgentMemoryEntry for convenient semantic recording.
 */
export const recordAgentMemory = appendAgentMemoryEntry;

/**
 * Retrieves isolated memory logs for a specific agent from IndexedDB.
 */
export async function getAgentMemoriesForAgent(agentId: string): Promise<AgentMemoryDbEntry[]> {
  try {
    const records = await ledgerDb.agent_memories
      .where('agentId')
      .equals(agentId)
      .reverse()
      .sortBy('timestamp');
    return records;
  } catch {
    return inMemoryAgentMemories.filter((m) => m.agentId === agentId);
  }
}

/**
 * Clears isolated memory logs for a specific agent from IndexedDB.
 */
export async function clearAgentMemoriesForAgent(agentId: string): Promise<void> {
  try {
    await ledgerDb.agent_memories.where('agentId').equals(agentId).delete();
  } catch {
    const idxs = [];
    for (let i = inMemoryAgentMemories.length - 1; i >= 0; i--) {
      if (inMemoryAgentMemories[i].agentId === agentId) {
        inMemoryAgentMemories.splice(i, 1);
      }
    }
  }
}
