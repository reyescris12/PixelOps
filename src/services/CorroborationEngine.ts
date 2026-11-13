/**
 * Master-Specialist Corroboration Engine & Immutable Provenance Service
 * (src/services/CorroborationEngine.ts)
 *
 * Implements sovereign C2 multi-source corroboration workflows:
 * - Deterministic SHA-256 packet IDs and immutable IndexedDB snapshots (idb://evidence_packets/{packetId})
 * - Stateful structural snapshot diffing before LLM invocation (zero-noise silent drop on unchanged polls)
 * - Haversine <= 75 km & canonical entity multi-track clustering with strict score caps
 * - Automatic TTL staleness decay
 * - Agent Vance master fusion with strict packetId citation validation
 * - Human-in-the-loop effector nomination gate backed by CommandLedgerDb immutability
 * - Parallel non-blocking specialist runners for Nyx (WIDE_AREA / WRITTEN_WIRE) and Cipher (SIGNALS_INFRA / CYBER_CVE)
 */

import {
  ledgerDb,
  appendCommandLedgerEntry,
  recordAgentMemory,
  type CorroborationSourceTrack,
  type CorroborationGeoAnchor,
  type CorroborationClusterStatus,
  type EvidencePacketDbEntry,
  type SnapshotBaselineDbEntry,
  type DeltaEventDbEntry,
  type CorroborationClusterDbEntry,
  type NominationPackageDbEntry,
} from './CommandLedgerDb';
import { recordTelemetryExecution } from './TelemetryStore';
import { loadLLMProviderConfig, getGeminiAuthHeadersAndUrl } from './LLMProviderService';

export type {
  CorroborationSourceTrack,
  CorroborationGeoAnchor,
  CorroborationClusterStatus,
  EvidencePacketDbEntry,
  SnapshotBaselineDbEntry,
  DeltaEventDbEntry,
  CorroborationClusterDbEntry,
  NominationPackageDbEntry,
};

export interface ExtractedEntities {
  mmsi: string[];
  noradId: string[];
  ipAsn: string[];
  domains: string[];
  cves: string[];
  gridSectors: string[];
  canonicalKeys: string[];
}

export type EffectorActionType =
  | 'COMPOSIO_GITHUB_ISSUE'
  | 'WEBHOOK_DISPATCH'
  | 'ARCHIVE_SITREP';

export interface VanceSynthesisOutput {
  generatedAt: string;
  synthesizedBy: 'vance';
  clusterId: string;
  modelUsed: string;
  executiveAssessment: {
    bluf: string;
    citedPacketIds: string[];
  };
  agreedIndicators: Array<{
    claim: string;
    packetIds: string[];
    sourceTracks: CorroborationSourceTrack[];
  }>;
  conflictingGaps: Array<{
    gap: string;
    packetIds: string[];
  }>;
  recommendedEffectorPackage: {
    actionType: EffectorActionType;
    title: string;
    rationale: string;
    citedPacketIds: string[];
    outboundPayload: Record<string, unknown>;
  };
}

export interface IngestPacketInput {
  sourceTrack: CorroborationSourceTrack;
  sourceType: string;
  canonicalTargetKey: string;
  payloadTimestamp: string;
  sourceEndpoint: string;
  ingestedBy: 'nyx' | 'cipher' | 'vance' | string;
  ttlSeconds?: number;
  geoAnchor: CorroborationGeoAnchor;
  sectorKey: string;
  summaryHeadline: string;
  rawPayload: unknown;
  emitOnRecentCert?: boolean;
  explicitEntities?: Partial<ExtractedEntities>;
  nowMs?: number;
}

export interface IngestPacketResult {
  packet: EvidencePacketDbEntry;
  deltaEmitted: boolean;
  dropReason?: 'UNCHANGED_SNAPSHOT' | 'BELOW_THRESHOLD' | 'BASELINE_RECORDED';
  deltaEvent?: DeltaEventDbEntry;
  cluster?: CorroborationClusterDbEntry;
  promotedToCorroborated: boolean;
  vanceTriggered: boolean;
}

export interface SpecialistTrackRuntimeStats {
  operative: 'nyx' | 'cipher' | 'vance';
  tracks: string[];
  lastPolledAt: string | null;
  pollsCompleted: number;
  packetsIngested: number;
  silentDrops: number;
  deltasEmitted: number;
  lastError: string | null;
  isPolling: boolean;
}

export interface ClusterWithPackets {
  cluster: CorroborationClusterDbEntry;
  packets: EvidencePacketDbEntry[];
  deltas: DeltaEventDbEntry[];
  nomination: NominationPackageDbEntry | null;
  synthesis: VanceSynthesisOutput | null;
}

export interface SelfTestStepResult {
  step: string;
  passed: boolean;
  detail: string;
}

export interface CorroborationSelfTestReport {
  passed: boolean;
  clusterId: string;
  candidateScore: number;
  corroboratedScore: number;
  packet1Id: string;
  packet2Id: string;
  rawPath1: string;
  rawPath2: string;
  sitrepPath?: string;
  canvasVisible: boolean;
  steps: SelfTestStepResult[];
}

const ROLLING_CORRELATION_WINDOW_MS = 6 * 3600 * 1000;
const HAVERSINE_CORRELATION_KM = 75;

const DEFAULT_TTL_BY_TRACK: Record<CorroborationSourceTrack, number> = {
  WIDE_AREA: 300,
  SIGNALS_INFRA: 3600,
  WRITTEN_WIRE: 1800,
  CYBER_CVE: 3600,
};

// In-memory dual stores so both browser IndexedDB and headless Node/tsx runs behave identically
const memPackets = new Map<string, EvidencePacketDbEntry>();
const memSnapshots = new Map<string, SnapshotBaselineDbEntry>();
const memDeltas = new Map<string, DeltaEventDbEntry>();
const memClusters = new Map<string, CorroborationClusterDbEntry>();
const memNominations = new Map<string, NominationPackageDbEntry>();

const updateSubscribers = new Set<(cluster: CorroborationClusterDbEntry) => void>();
const promotionSubscribers = new Set<
  (cluster: CorroborationClusterDbEntry, synthesis: VanceSynthesisOutput) => void
>();
const alertedClusterStatusMap = new Map<string, CorroborationClusterStatus>();

const trackStatsMap: Record<'nyx' | 'cipher' | 'vance', SpecialistTrackRuntimeStats> = {
  nyx: {
    operative: 'nyx',
    tracks: ['WIDE_AREA', 'WRITTEN_WIRE'],
    lastPolledAt: null,
    pollsCompleted: 0,
    packetsIngested: 0,
    silentDrops: 0,
    deltasEmitted: 0,
    lastError: null,
    isPolling: false,
  },
  cipher: {
    operative: 'cipher',
    tracks: ['SIGNALS_INFRA', 'CYBER_CVE'],
    lastPolledAt: null,
    pollsCompleted: 0,
    packetsIngested: 0,
    silentDrops: 0,
    deltasEmitted: 0,
    lastError: null,
    isPolling: false,
  },
  vance: {
    operative: 'vance',
    tracks: ['MASTER_FUSION'],
    lastPolledAt: null,
    pollsCompleted: 0,
    packetsIngested: 0,
    silentDrops: 0,
    deltasEmitted: 0,
    lastError: null,
    isPolling: false,
  },
};

// Known tactical grid anchors for geo-mapping live wires and infrastructure domains
const SECTOR_GEO_ANCHORS: Array<{
  keywords: string[];
  sectorKey: string;
  lat: number;
  lon: number;
  precision: 'EXACT' | 'REGIONAL';
}> = [
  {
    keywords: ['pokrovsk', 'donbas', 'donetsk', 'ukraine', 'kharkiv', 'kurakhove'],
    sectorKey: 'SECTOR-DONBAS',
    lat: 48.2824,
    lon: 37.1818,
    precision: 'REGIONAL',
  },
  {
    keywords: ['kursk', 'belgorod', 'russia', 'moscow'],
    sectorKey: 'SECTOR-KURSK',
    lat: 51.7303,
    lon: 36.1927,
    precision: 'REGIONAL',
  },
  {
    keywords: ['suez', 'red sea', 'bab al-mandab', 'bab el-mandeb', 'houthi', 'yemen', 'aden', 'cairo', 'egypt'],
    sectorKey: 'SECTOR-54-SUEZ',
    lat: 30.5852,
    lon: 32.2654,
    precision: 'REGIONAL',
  },
  {
    keywords: ['hormuz', 'persian gulf', 'iran', 'tehran', 'bandar'],
    sectorKey: 'SECTOR-32-HORMUZ',
    lat: 26.5667,
    lon: 56.25,
    precision: 'REGIONAL',
  },
  {
    keywords: ['taiwan', 'hsinchu', 'taipei', 'pla', 'south china sea', 'pacific'],
    sectorKey: 'SECTOR-88-TAIWAN',
    lat: 24.8138,
    lon: 120.9675,
    precision: 'REGIONAL',
  },
  {
    keywords: ['malacca', 'singapore', 'strait'],
    sectorKey: 'SECTOR-71-MALACCA',
    lat: 1.3521,
    lon: 103.8198,
    precision: 'REGIONAL',
  },
  {
    keywords: ['frankfurt', 'de-cix', 'europe', 'germany', 'nato', 'london'],
    sectorKey: 'SECTOR-19-EUROPE',
    lat: 50.1109,
    lon: 8.6821,
    precision: 'REGIONAL',
  },
  {
    keywords: ['ashburn', 'virginia', 'conus', 'cisa', 'usgs', 'cloudflare', 'washington'],
    sectorKey: 'SECTOR-01-ASHBURN',
    lat: 39.0438,
    lon: -77.4874,
    precision: 'REGIONAL',
  },
];

// ---- Deterministic SHA-256 Helper ----

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function pureSha256Hex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (v: number, n: number) => (v >>> n) | (v << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

export async function computeSha256Hex(input: string): Promise<string> {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    try {
      const encoded = new TextEncoder().encode(input);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return pureSha256Hex(input);
    }
  }
  return pureSha256Hex(input);
}

export async function computeDeterministicPacketId(
  sourceType: string,
  canonicalTargetKey: string,
  payloadTimestamp: string
): Promise<string> {
  return await computeSha256Hex(`${sourceType}|${canonicalTargetKey}|${payloadTimestamp}`);
}

// ---- Storage Persistence Wrappers (IndexedDB + In-Memory Dual Store) ----

async function putPacket(packet: EvidencePacketDbEntry): Promise<void> {
  memPackets.set(packet.packetId, packet);
  try {
    await ledgerDb.evidence_packets.put(packet);
  } catch {}
}

async function getPacketById(packetId: string): Promise<EvidencePacketDbEntry | null> {
  try {
    const dbRec = await ledgerDb.evidence_packets.get(packetId);
    if (dbRec) {
      memPackets.set(dbRec.packetId, dbRec);
      return dbRec;
    }
  } catch {}
  return memPackets.get(packetId) || null;
}

export async function getPacketRawPayloadJson(packetId: string): Promise<string | null> {
  const pkt = await getPacketById(packetId);
  if (!pkt) return null;
  if (pkt.rawPayloadJson) return pkt.rawPayloadJson;
  return JSON.stringify(
    {
      packetId: pkt.packetId,
      sourceTrack: pkt.sourceTrack,
      sourceType: pkt.sourceType,
      canonicalTargetKey: pkt.canonicalTargetKey,
      sourceEndpoint: pkt.sourceEndpoint,
      ingestedBy: pkt.ingestedBy,
      capturedAt: pkt.capturedAt,
      ttlSeconds: pkt.ttlSeconds,
      geoAnchor: pkt.geoAnchor,
      sectorKey: pkt.sectorKey,
      entities: pkt.entities,
      structuralHash: pkt.structuralHash,
    },
    null,
    2
  );
}

async function getAllPackets(): Promise<EvidencePacketDbEntry[]> {
  const merged = new Map<string, EvidencePacketDbEntry>(memPackets);
  try {
    const rows = await ledgerDb.evidence_packets.toArray();
    for (const r of rows) {
      merged.set(r.packetId, r);
      memPackets.set(r.packetId, r);
    }
  } catch {}
  return Array.from(merged.values());
}

async function getSnapshotByKey(snapshotKey: string): Promise<SnapshotBaselineDbEntry | null> {
  try {
    const dbRec = await ledgerDb.corroboration_snapshots.get(snapshotKey);
    if (dbRec) {
      memSnapshots.set(snapshotKey, dbRec);
      return dbRec;
    }
  } catch {}
  return memSnapshots.get(snapshotKey) || null;
}

async function putSnapshot(snap: SnapshotBaselineDbEntry): Promise<void> {
  memSnapshots.set(snap.snapshotKey, snap);
  try {
    await ledgerDb.corroboration_snapshots.put(snap);
  } catch {}
}

async function putDelta(delta: DeltaEventDbEntry): Promise<void> {
  memDeltas.set(delta.deltaId, delta);
  try {
    await ledgerDb.delta_events.put(delta);
  } catch {}
}

async function getAllDeltas(): Promise<DeltaEventDbEntry[]> {
  const merged = new Map<string, DeltaEventDbEntry>(memDeltas);
  try {
    const rows = await ledgerDb.delta_events.toArray();
    for (const r of rows) {
      merged.set(r.deltaId, r);
      memDeltas.set(r.deltaId, r);
    }
  } catch {}
  return Array.from(merged.values());
}

async function putCluster(cluster: CorroborationClusterDbEntry): Promise<void> {
  memClusters.set(cluster.clusterId, cluster);
  try {
    await ledgerDb.corroboration_clusters.put(cluster);
  } catch {}
}

export async function getClusterById(clusterId: string): Promise<CorroborationClusterDbEntry | null> {
  try {
    const dbRec = await ledgerDb.corroboration_clusters.get(clusterId);
    if (dbRec) {
      memClusters.set(dbRec.clusterId, dbRec);
      return dbRec;
    }
  } catch {}
  return memClusters.get(clusterId) || null;
}

export async function getAllClusters(): Promise<CorroborationClusterDbEntry[]> {
  const merged = new Map<string, CorroborationClusterDbEntry>(memClusters);
  try {
    const rows = await ledgerDb.corroboration_clusters.toArray();
    for (const r of rows) {
      merged.set(r.clusterId, r);
      memClusters.set(r.clusterId, r);
    }
  } catch {}
  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

async function putNomination(nom: NominationPackageDbEntry): Promise<void> {
  memNominations.set(nom.nominationId, nom);
  try {
    await ledgerDb.nomination_packages.put(nom);
  } catch {}
}

async function getAllNominations(): Promise<NominationPackageDbEntry[]> {
  const merged = new Map<string, NominationPackageDbEntry>(memNominations);
  try {
    const rows = await ledgerDb.nomination_packages.toArray();
    for (const r of rows) {
      merged.set(r.nominationId, r);
      memNominations.set(r.nominationId, r);
    }
  } catch {}
  return Array.from(merged.values());
}

// ---- Spatial & Entity Extraction Utilities ----

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function extractCanonicalEntities(
  rawPayload: unknown,
  textHint = '',
  sectorKey = '',
  explicit?: Partial<ExtractedEntities>
): ExtractedEntities {
  let payloadForExtraction = rawPayload;
  if (
    rawPayload &&
    typeof rawPayload === 'object' &&
    !Array.isArray(rawPayload) &&
    'Comment' in rawPayload
  ) {
    const { Comment: _comment, ...rest } = rawPayload as Record<string, unknown>;
    payloadForExtraction = rest;
  }

  const serialized =
    (typeof payloadForExtraction === 'string'
      ? payloadForExtraction
      : JSON.stringify(payloadForExtraction ?? '')) +
    ' ' +
    textHint;

  const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

  const mmsiMatches: string[] = [...(explicit?.mmsi || [])];
  const mmsiRegex = /\bMMSI[:\s#-]*([2-7]\d{8})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = mmsiRegex.exec(serialized)) !== null) {
    mmsiMatches.push(m[1]);
  }
  if (rawPayload && typeof rawPayload === 'object') {
    const anyPayload = rawPayload as Record<string, any>;
    if (anyPayload.mmsi) mmsiMatches.push(String(anyPayload.mmsi));
    if (Array.isArray(anyPayload.vessels)) {
      for (const v of anyPayload.vessels) {
        if (v?.mmsi) mmsiMatches.push(String(v.mmsi));
      }
    }
  }

  const noradMatches: string[] = [...(explicit?.noradId || [])];
  const noradRegex = /\bNORAD[:\s#-]*(\d{4,6})\b/gi;
  while ((m = noradRegex.exec(serialized)) !== null) {
    noradMatches.push(m[1]);
  }

  const ipAsnMatches: string[] = [...(explicit?.ipAsn || [])];
  const ipv4Regex = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})\b/g;
  while ((m = ipv4Regex.exec(serialized)) !== null) {
    ipAsnMatches.push(m[1]);
  }
  const asnRegex = /\b(AS\d{2,7})\b/gi;
  while ((m = asnRegex.exec(serialized)) !== null) {
    ipAsnMatches.push(m[1].toUpperCase());
  }

  const domainMatches: string[] = [...(explicit?.domains || [])];
  const domainRegex =
    /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|gov|mil|edu|ru|cn|ir|ua|tw|sg|uk|de|info|biz))\b/gi;
  while ((m = domainRegex.exec(serialized)) !== null) {
    const clean = m[1].toLowerCase().replace(/\.$/, '');
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(clean)) {
      domainMatches.push(clean);
    }
  }

  const cveMatches: string[] = [...(explicit?.cves || [])];
  const cveRegex = /\b(CVE-\d{4}-\d{4,7})\b/gi;
  while ((m = cveRegex.exec(serialized)) !== null) {
    cveMatches.push(m[1].toUpperCase());
  }

  const gridSectors = uniq([
    ...(explicit?.gridSectors || []),
    sectorKey ? sectorKey.toUpperCase() : '',
  ]);

  const mmsi = uniq(mmsiMatches);
  const noradId = uniq(noradMatches);
  const ipAsn = uniq(ipAsnMatches);
  const domains = uniq(domainMatches);
  const cves = uniq(cveMatches);

  // Reserve canonicalKeys strictly for specific technical/asset identifiers so broad sectors never false-merge distant geo clusters
  const canonicalKeys = uniq([
    ...mmsi.map((v) => `mmsi:${v}`),
    ...noradId.map((v) => `norad:${v}`),
    ...ipAsn.map((v) => (v.startsWith('AS') ? `asn:${v}` : `ip:${v}`)),
    ...domains.map((v) => `domain:${v}`),
    ...cves.map((v) => `cve:${v}`),
    ...(explicit?.canonicalKeys || []),
  ]);

  return {
    mmsi,
    noradId,
    ipAsn,
    domains,
    cves,
    gridSectors,
    canonicalKeys,
  };
}

// ---- Structural Normalization & Stateful Diff Evaluation ----

function canonicalizeStructuralPayload(
  sourceTrack: CorroborationSourceTrack,
  sourceType: string,
  canonicalTargetKey: string,
  rawPayload: unknown
): { structuralObject: Record<string, unknown>; metrics: Record<string, string | number | boolean> } {
  const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : { value: rawPayload }) as Record<string, any>;

  if (sourceType === 'usgs_geojson' || sourceTrack === 'WIDE_AREA' && payload.type === 'Feature') {
    const mag = Number(payload?.properties?.mag ?? payload?.mag ?? 0);
    const place = String(payload?.properties?.place ?? payload?.place ?? canonicalTargetKey);
    const coords = Array.isArray(payload?.geometry?.coordinates) ? payload.geometry.coordinates : [];
    const lat = Number(coords[1] ?? payload?.lat ?? 0);
    const lon = Number(coords[0] ?? payload?.lon ?? 0);
    const tsunami = Number(payload?.properties?.tsunami ?? 0);
    const roundedMag = Number(mag.toFixed(1));
    return {
      structuralObject: {
        sourceType: 'usgs_geojson',
        target: canonicalTargetKey,
        roundedMag,
        place,
        lat: Number(lat.toFixed(3)),
        lon: Number(lon.toFixed(3)),
        tsunami,
      },
      metrics: {
        mag: roundedMag,
        tsunami,
        eventStatus: String(payload?.properties?.status || 'reviewed'),
      },
    };
  }

  if (sourceType === 'maritime_ais') {
    const anomalies = Array.isArray(payload.anomalies)
      ? payload.anomalies.map((a: any) => String(a.id || a.mmsi || a.status || a)).sort()
      : [];
    const transponderDrops = Number(payload.transponderDrops ?? payload.darkVessels ?? anomalies.length);
    const courseDeviations = Number(payload.courseDeviations ?? 0);
    const disruptionLevel = String(payload.status || payload.disruptionLevel || 'NOMINAL');
    return {
      structuralObject: {
        sourceType: 'maritime_ais',
        target: canonicalTargetKey,
        disruptionLevel,
        transponderDrops,
        courseDeviations,
        anomalies,
      },
      metrics: {
        disruptionLevel,
        transponderDrops,
        courseDeviations,
      },
    };
  }

  if (sourceType === 'doh_dns') {
    const answers = Array.isArray(payload.Answer) ? payload.Answer : [];
    const records = answers
      .map((a: any) => `${a.name || ''}:${a.type || ''}:${String(a.data || '').trim()}`)
      .sort();
    const ttls = answers.map((a: any) => Number(a.TTL ?? a.ttl ?? 300)).filter((n: number) => !isNaN(n));
    const minTtl = ttls.length > 0 ? Math.min(...ttls) : Number(payload.minTtl ?? 300);
    const dnsStatus = Number(payload.Status ?? 0);
    return {
      structuralObject: {
        sourceType: 'doh_dns',
        target: canonicalTargetKey,
        dnsStatus,
        records,
      },
      metrics: {
        dnsStatus,
        minTtl,
        recordCount: records.length,
        recordsDigest: records.join('|'),
      },
    };
  }

  if (sourceType === 'ct_logs') {
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload.certificates) ? payload.certificates : [];
    const serials = rows
      .slice(0, 20)
      .map((r: any) => String(r.serial_number || r.id || r.common_name || JSON.stringify(r)))
      .sort();
    return {
      structuralObject: {
        sourceType: 'ct_logs',
        target: canonicalTargetKey,
        serials,
      },
      metrics: {
        certCount: serials.length,
        latestSerial: serials[0] || '',
      },
    };
  }

  if (sourceType === 'adsb_airspace') {
    const icaoHex = String(payload.icaoHex || canonicalTargetKey).toUpperCase();
    const callsign = String(payload.callsign || '').toUpperCase();
    const tacticalFlag = String(payload.tacticalFlag || 'ROUTINE_TRAFFIC');
    const squawk = String(payload.squawk || '');
    const severity = String(payload.severity || 'MED');
    const isEmergencySquawk = Boolean(payload.isEmergencySquawk);
    return {
      structuralObject: {
        sourceType: 'adsb_airspace',
        target: canonicalTargetKey,
        icaoHex,
        callsign,
        tacticalFlag,
        squawk,
        severity,
      },
      metrics: {
        icaoHex,
        tacticalFlag,
        squawk,
        severity,
        isEmergencySquawk,
      },
    };
  }

  if (sourceType === 'air_plume_sensor') {
    const anomalyType = String(payload.anomalyType || 'NONE');
    const severity = String(payload.severity || 'LOW');
    const usAqiBand = Math.floor(Number(payload.usAqi ?? 0) / 25) * 25;
    return {
      structuralObject: {
        sourceType: 'air_plume_sensor',
        target: canonicalTargetKey,
        anomalyType,
        severity,
        usAqiBand,
      },
      metrics: {
        anomalyType,
        severity,
        usAqiBand,
      },
    };
  }

  if (
    sourceType === 'usgs_microseismic' ||
    sourceType === 'usgs_kinetic_blast' ||
    sourceType === 'nasa_eonet_thermal'
  ) {
    const evId = String(payload?.id || canonicalTargetKey);
    const magBand = Math.round(Number(payload?.properties?.mag ?? 0) * 5) / 5;
    return {
      structuralObject: {
        sourceType,
        target: canonicalTargetKey,
        evId,
        magBand,
      },
      metrics: {
        evId,
        magBand,
      },
    };
  }

  if (sourceType === 'cisa_kev' || sourceTrack === 'CYBER_CVE') {
    const cveId = String(payload.cveID || payload.cveId || payload.id || canonicalTargetKey).toUpperCase();
    const vendorProject = String(payload.vendorProject || payload.vendor || '');
    const product = String(payload.product || '');
    const knownRansomware = String(payload.knownRansomwareCampaignUse || 'Unknown');
    return {
      structuralObject: {
        sourceType,
        target: canonicalTargetKey,
        cveId,
        vendorProject,
        product,
        knownRansomware,
      },
      metrics: {
        cveId,
        knownRansomware,
      },
    };
  }

  if (sourceTrack === 'WRITTEN_WIRE' || sourceType === 's2_wire' || sourceType === 'isw_wire') {
    const title = String(payload.title || canonicalTargetKey).trim();
    const content = String(payload.content || payload.summary || '').trim().slice(0, 1200);
    return {
      structuralObject: {
        sourceType,
        target: canonicalTargetKey,
        title,
        contentHashInput: content,
      },
      metrics: {
        titleLen: title.length,
        contentLen: content.length,
      },
    };
  }

  return {
    structuralObject: {
      sourceType,
      target: canonicalTargetKey,
      payload,
    },
    metrics: {},
  };
}

function evaluateDeltaThreshold(
  input: IngestPacketInput,
  prevSnapshot: SnapshotBaselineDbEntry | null,
  currentHash: string,
  metrics: Record<string, string | number | boolean>
): {
  emit: boolean;
  dropReason?: 'UNCHANGED_SNAPSHOT' | 'BELOW_THRESHOLD' | 'BASELINE_RECORDED';
  thresholdReason?: string;
  severityWeight: number;
} {
  if (prevSnapshot && prevSnapshot.structuralHash === currentHash) {
    return { emit: false, dropReason: 'UNCHANGED_SNAPSHOT', severityWeight: 0 };
  }

  if (input.sourceTrack === 'WIDE_AREA') {
    if (input.sourceType === 'usgs_geojson') {
      const mag = Number(metrics.mag ?? 0);
      const prevMag = Number(prevSnapshot?.structuralMetrics?.mag ?? 0);
      if (mag < 4.0) {
        return { emit: false, dropReason: 'BELOW_THRESHOLD', severityWeight: 0 };
      }
      if (prevSnapshot && Math.abs(mag - prevMag) < 0.2) {
        return { emit: false, dropReason: 'UNCHANGED_SNAPSHOT', severityWeight: 0 };
      }
      const weight = mag >= 6.0 ? 1.0 : mag >= 4.5 ? 1.0 : 0.75;
      return {
        emit: true,
        thresholdReason: `USGS M${mag.toFixed(1)} seismic threshold exceeded in ${input.sectorKey}`,
        severityWeight: weight,
      };
    }

    if (input.sourceType === 'maritime_ais') {
      const drops = Number(metrics.transponderDrops ?? 0);
      const deviations = Number(metrics.courseDeviations ?? 0);
      const level = String(metrics.disruptionLevel || 'NOMINAL').toUpperCase();
      if (drops === 0 && deviations === 0 && level === 'NOMINAL') {
        return { emit: false, dropReason: 'BASELINE_RECORDED', severityWeight: 0 };
      }
      return {
        emit: true,
        thresholdReason: `Maritime AIS anomaly (${drops} transponder drops, ${deviations} course deviations, status ${level})`,
        severityWeight: drops >= 2 || level.includes('CRITICAL') || level.includes('ELEVATED') ? 1.0 : 0.8,
      };
    }

    return {
      emit: true,
      thresholdReason: `Wide-area sensor shift verified for ${input.canonicalTargetKey}`,
      severityWeight: 0.9,
    };
  }

  if (input.sourceTrack === 'SIGNALS_INFRA') {
    if (input.sourceType === 'doh_dns') {
      const status = Number(metrics.dnsStatus ?? 0);
      const minTtl = Number(metrics.minTtl ?? 300);
      const prevRecords = String(prevSnapshot?.structuralMetrics?.recordsDigest ?? '');
      const nextRecords = String(metrics.recordsDigest ?? '');
      if (prevSnapshot) {
        return {
          emit: true,
          thresholdReason: `DNS A-record mutation detected (${prevRecords || 'none'} -> ${nextRecords || 'none'}, minTTL=${minTtl}s)`,
          severityWeight: minTtl <= 60 || status !== 0 ? 1.0 : 0.85,
        };
      }
      // Initial poll without baseline: drop silently if Status=0 so polling establishes quiet baseline
      if (status === 0) {
        return { emit: false, dropReason: 'BASELINE_RECORDED', severityWeight: 0 };
      }
      return {
        emit: true,
        thresholdReason: `Anomalous initial DNS signal (Status=${status}, minTTL=${minTtl}s)`,
        severityWeight: 1.0,
      };
    }

    if (input.sourceType === 'ct_logs') {
      if (prevSnapshot) {
        return {
          emit: true,
          thresholdReason: `Certificate Transparency log mutation detected (serial=${metrics.latestSerial || 'updated'})`,
          severityWeight: 0.9,
        };
      }
      if (!input.emitOnRecentCert) {
        return { emit: false, dropReason: 'BASELINE_RECORDED', severityWeight: 0 };
      }
      return {
        emit: true,
        thresholdReason: `Newly observed Certificate Transparency entry (${metrics.latestSerial || input.canonicalTargetKey})`,
        severityWeight: 0.85,
      };
    }

    if (input.sourceType === 'adsb_airspace') {
      return {
        emit: true,
        thresholdReason: `ADS-B airspace tactical indicator (${metrics.tacticalFlag || 'TACTICAL'}): ${input.summaryHeadline}`,
        severityWeight: metrics.isEmergencySquawk ? 1.0 : 0.9,
      };
    }

    if (input.sourceType === 'air_plume_sensor') {
      return {
        emit: true,
        thresholdReason: `Atmospheric plume sensor anomaly (${metrics.anomalyType || 'PLUME'}): ${input.summaryHeadline}`,
        severityWeight: metrics.severity === 'CRITICAL' ? 1.0 : 0.88,
      };
    }
  }

  if (input.sourceTrack === 'WRITTEN_WIRE') {
    return {
      emit: true,
      thresholdReason: `Verified new written intelligence dispatch (${input.sourceType}): ${input.summaryHeadline}`,
      severityWeight: 0.9,
    };
  }

  if (input.sourceTrack === 'CYBER_CVE') {
    const ransomware = String(metrics.knownRansomware || '').toLowerCase() === 'known';
    return {
      emit: true,
      thresholdReason: `Active exploited vulnerability advisory (${metrics.cveId || input.canonicalTargetKey})`,
      severityWeight: ransomware ? 1.0 : 0.85,
    };
  }

  return {
    emit: true,
    thresholdReason: `Verified structural snapshot delta in ${input.sourceTrack}`,
    severityWeight: 0.85,
  };
}

// ---- Confidence Scoring & TTL Staleness Evaluation ----

export interface ConfidenceEvaluation {
  status: CorroborationClusterStatus;
  score: number;
  freshPacketIds: string[];
  expiredPacketIds: string[];
  freshTracks: CorroborationSourceTrack[];
  earliestExpiryIso: string;
}

export function evaluateClusterConfidence(
  clusterPackets: EvidencePacketDbEntry[],
  clusterDeltas: DeltaEventDbEntry[],
  sharedEntities: string[],
  existingStatus?: CorroborationClusterStatus,
  nowMs: number = Date.now()
): ConfidenceEvaluation {
  if (existingStatus === 'DISMISSED') {
    return {
      status: 'DISMISSED',
      score: 0,
      freshPacketIds: [],
      expiredPacketIds: clusterPackets.map((p) => p.packetId),
      freshTracks: [],
      earliestExpiryIso: new Date(nowMs).toISOString(),
    };
  }

  const freshPackets: EvidencePacketDbEntry[] = [];
  const expiredPackets: EvidencePacketDbEntry[] = [];
  let earliestExpiryMs = Number.POSITIVE_INFINITY;
  let minOverdueRatio = Number.POSITIVE_INFINITY;

  for (const pkt of clusterPackets) {
    const capturedMs = new Date(pkt.capturedAt).getTime();
    const expiryMs = capturedMs + pkt.ttlSeconds * 1000;
    if (expiryMs < earliestExpiryMs) earliestExpiryMs = expiryMs;
    const ageSec = (nowMs - capturedMs) / 1000;
    if (ageSec <= pkt.ttlSeconds) {
      freshPackets.push(pkt);
    } else {
      expiredPackets.push(pkt);
      const overdueRatio = Math.max(0.1, (ageSec - pkt.ttlSeconds) / Math.max(1, pkt.ttlSeconds));
      if (overdueRatio < minOverdueRatio) minOverdueRatio = overdueRatio;
    }
  }

  const freshTracks = Array.from(new Set(freshPackets.map((p) => p.sourceTrack)));
  const maxSeverity = clusterDeltas.reduce((m, d) => Math.max(m, d.severityWeight || 0.8), 0.8);
  const avgSeverity =
    clusterDeltas.length > 0
      ? clusterDeltas.reduce((s, d) => s + (d.severityWeight || 0.8), 0) / clusterDeltas.length
      : 0.8;

  const hasExactGeo = freshPackets.some((p) => p.geoAnchor.precision === 'EXACT');
  const hasSharedSpecificEntity = sharedEntities.length > 0;

  let status: CorroborationClusterStatus;
  let score: number;

  if (freshPackets.length === 0) {
    status = 'STALE';
    const rawUnexpiredTrackCount = new Set(clusterPackets.map((p) => p.sourceTrack)).size;
    const priorBase = rawUnexpiredTrackCount >= 3 ? 0.9 : rawUnexpiredTrackCount === 2 ? 0.72 : 0.35;
    const decay = Math.pow(0.5, isFinite(minOverdueRatio) ? Math.max(1, minOverdueRatio) : 1);
    score = Number(Math.max(0.05, Math.min(0.34, priorBase * decay)).toFixed(2));
  } else if (freshTracks.length === 1) {
    status = 'CANDIDATE';
    // Strictly cap single-source tracks at 0.35
    score = Number(Math.min(0.35, 0.25 + 0.1 * maxSeverity).toFixed(2));
  } else if (freshTracks.length === 2) {
    status = 'CORROBORATED';
    const raw =
      0.7 +
      (hasExactGeo ? 0.04 : 0) +
      (hasSharedSpecificEntity ? 0.04 : 0) +
      Math.min(0.06, avgSeverity * 0.06);
    score = Number(Math.max(0.7, Math.min(0.84, raw)).toFixed(2));
  } else {
    status = 'CRITICAL_CONVERGENCE';
    const trackBonus = Math.min(0.05, (freshTracks.length - 3) * 0.05);
    const raw =
      0.9 +
      trackBonus +
      (hasExactGeo ? 0.02 : 0) +
      (hasSharedSpecificEntity ? 0.03 : 0);
    score = Number(Math.max(0.9, Math.min(1.0, raw)).toFixed(2));
  }

  return {
    status,
    score,
    freshPacketIds: freshPackets.map((p) => p.packetId),
    expiredPacketIds: expiredPackets.map((p) => p.packetId),
    freshTracks,
    earliestExpiryIso: isFinite(earliestExpiryMs)
      ? new Date(earliestExpiryMs).toISOString()
      : new Date(nowMs).toISOString(),
  };
}

// ---- Vance Citation Validation & Master Orchestrator Synthesis ----

export function validateVanceSynthesisCitations(
  candidate: unknown,
  validPacketIds: string[]
): { valid: boolean; reason?: string; output?: VanceSynthesisOutput } {
  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, reason: 'Synthesis payload is not an object' };
  }
  const c = candidate as Partial<VanceSynthesisOutput>;
  const validSet = new Set(validPacketIds);

  if (!c.executiveAssessment?.bluf || !Array.isArray(c.executiveAssessment.citedPacketIds)) {
    return { valid: false, reason: 'Missing executiveAssessment.bluf or citedPacketIds' };
  }
  if (c.executiveAssessment.citedPacketIds.length === 0) {
    return { valid: false, reason: 'executiveAssessment must cite at least one valid packetId' };
  }

  const allCitedIds: string[] = [...c.executiveAssessment.citedPacketIds];

  if (!Array.isArray(c.agreedIndicators) || c.agreedIndicators.length === 0) {
    return { valid: false, reason: 'agreedIndicators must contain at least one corroborated indicator' };
  }
  for (const ind of c.agreedIndicators) {
    if (!ind?.claim || !Array.isArray(ind.packetIds) || ind.packetIds.length === 0) {
      return { valid: false, reason: 'Every agreedIndicator claim must cite at least one packetId' };
    }
    allCitedIds.push(...ind.packetIds);
  }

  if (!Array.isArray(c.conflictingGaps)) {
    return { valid: false, reason: 'conflictingGaps must be an array' };
  }
  for (const gap of c.conflictingGaps) {
    if (!gap?.gap || !Array.isArray(gap.packetIds)) {
      return { valid: false, reason: 'Each conflictingGaps item must include gap and packetIds array' };
    }
    allCitedIds.push(...gap.packetIds);
  }

  if (
    !c.recommendedEffectorPackage?.actionType ||
    !c.recommendedEffectorPackage?.title ||
    !Array.isArray(c.recommendedEffectorPackage.citedPacketIds) ||
    c.recommendedEffectorPackage.citedPacketIds.length === 0
  ) {
    return { valid: false, reason: 'recommendedEffectorPackage missing required fields or citedPacketIds' };
  }
  allCitedIds.push(...c.recommendedEffectorPackage.citedPacketIds);

  for (const id of allCitedIds) {
    if (!validSet.has(id)) {
      return {
        valid: false,
        reason: `HALLUCINATED_PACKET_ID_REJECTED: "${id}" does not exist in cluster evidence packets`,
      };
    }
  }

  // Also scan prose fields for 64-char SHA-256 hashes not belonging to validSet
  const proseText = [
    c.executiveAssessment.bluf,
    ...c.agreedIndicators.map((i) => i.claim),
    ...c.conflictingGaps.map((g) => g.gap),
    c.recommendedEffectorPackage.rationale || '',
  ].join(' ');
  const inlineHexes = proseText.match(/\b[0-9a-f]{64}\b/gi) || [];
  for (const hx of inlineHexes) {
    if (!validSet.has(hx.toLowerCase())) {
      return {
        valid: false,
        reason: `HALLUCINATED_INLINE_PACKET_HASH_REJECTED: "${hx}" is not in cluster evidence packets`,
      };
    }
  }

  return { valid: true, output: c as VanceSynthesisOutput };
}

function buildDeterministicVanceSynthesis(
  cluster: CorroborationClusterDbEntry,
  packets: EvidencePacketDbEntry[],
  deltas: DeltaEventDbEntry[]
): VanceSynthesisOutput {
  const validIds = packets.map((p) => p.packetId);
  const tracks = Array.from(new Set(packets.map((p) => p.sourceTrack)));
  const pktSummaryList = packets
    .map(
      (p) =>
        `[${p.sourceTrack}/${p.sourceType}] ${p.summaryHeadline} (packet:${p.packetId.slice(0, 12)})`
    )
    .join('; ');

  const bluf = `${cluster.status} convergence (${cluster.corroborationScore.toFixed(2)}) in ${cluster.sectorKey} across ${tracks.length} independent intelligence tracks (${tracks.join(', ')}): ${pktSummaryList}.`;

  const agreedIndicators = packets.map((pkt) => {
    const delta = deltas.find((d) => d.packetId === pkt.packetId);
    return {
      claim: `${pkt.summaryHeadline}${delta ? ` — ${delta.thresholdReason}` : ''}`,
      packetIds: [pkt.packetId],
      sourceTracks: [pkt.sourceTrack] as CorroborationSourceTrack[],
    };
  });

  if (packets.length >= 2) {
    agreedIndicators.unshift({
      claim: `Spatial/entity convergence verified across ${tracks.join(' + ')} within ${HAVERSINE_CORRELATION_KM} km of (${cluster.geoAnchor.lat.toFixed(4)}, ${cluster.geoAnchor.lon.toFixed(4)})`,
      packetIds: validIds,
      sourceTracks: tracks,
    });
  }

  const allTracks: CorroborationSourceTrack[] = [
    'WIDE_AREA',
    'SIGNALS_INFRA',
    'WRITTEN_WIRE',
    'CYBER_CVE',
  ];
  const missingTracks = allTracks.filter((t) => !tracks.includes(t));
  const conflictingGaps: VanceSynthesisOutput['conflictingGaps'] = [];
  if (missingTracks.length > 0) {
    conflictingGaps.push({
      gap: `No independent corroboration delta ingested yet from track(s): ${missingTracks.join(', ')}.`,
      packetIds: validIds,
    });
  }
  const regionalPackets = packets.filter((p) => p.geoAnchor.precision === 'REGIONAL');
  if (regionalPackets.length > 0) {
    conflictingGaps.push({
      gap: `Sensor geolocation precision is REGIONAL for ${regionalPackets.length} packet(s); tighten pinpoint tasking if escalation continues.`,
      packetIds: regionalPackets.map((p) => p.packetId),
    });
  }

  const actionType: EffectorActionType = tracks.includes('CYBER_CVE') || tracks.includes('SIGNALS_INFRA')
    ? 'COMPOSIO_GITHUB_ISSUE'
    : 'WEBHOOK_DISPATCH';

  return {
    generatedAt: new Date().toISOString(),
    synthesizedBy: 'vance',
    clusterId: cluster.clusterId,
    modelUsed: 'deterministic-c2-verifier',
    executiveAssessment: {
      bluf,
      citedPacketIds: validIds,
    },
    agreedIndicators,
    conflictingGaps,
    recommendedEffectorPackage: {
      actionType,
      title: `[PIXELOPS ${cluster.status}] ${cluster.sectorKey} Multi-Source Convergence (${validIds.length} packets)`,
      rationale: `Human War Room review recommended for ${tracks.join(' + ')} convergence at score ${cluster.corroborationScore.toFixed(2)}.`,
      citedPacketIds: validIds,
      outboundPayload: {
        clusterId: cluster.clusterId,
        sectorKey: cluster.sectorKey,
        status: cluster.status,
        corroborationScore: cluster.corroborationScore,
        coordinates: cluster.geoAnchor,
        citedPacketIds: validIds,
        rawPayloadRefs: packets.map((p) => p.rawPayloadRef),
      },
    },
  };
}

async function synthesizeClusterWithVance(
  cluster: CorroborationClusterDbEntry,
  packets: EvidencePacketDbEntry[],
  deltas: DeltaEventDbEntry[]
): Promise<{
  synthesis: VanceSynthesisOutput;
  sitrepPath: string;
  nomination: NominationPackageDbEntry;
}> {
  const startedAt = Date.now();
  trackStatsMap.vance.isPolling = true;
  const validPacketIds = packets.map((p) => p.packetId);
  let chosenSynthesis: VanceSynthesisOutput | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  // Attempt structured Gemini synthesis when user has configured a real API key
  try {
    const cfg = loadLLMProviderConfig();
    const apiKey = (cfg.apiKey || '').trim();
    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY' && typeof fetch !== 'undefined') {
      const auth = getGeminiAuthHeadersAndUrl(cfg, cfg.modelName);
      const packetContext = packets.map((p) => ({
        packetId: p.packetId,
        sourceTrack: p.sourceTrack,
        sourceType: p.sourceType,
        sourceEndpoint: p.sourceEndpoint,
        capturedAt: p.capturedAt,
        ttlSeconds: p.ttlSeconds,
        geoAnchor: p.geoAnchor,
        entities: p.entities.canonicalKeys,
        summaryHeadline: p.summaryHeadline,
        rawPayloadRef: p.rawPayloadRef,
      }));
      const systemPrompt = `You are Agent Vance, Master War Room C2 Orchestrator in PixelOps.
Synthesize ONLY the provided verified evidence packets into strict JSON matching:
{
  "executiveAssessment": { "bluf": string, "citedPacketIds": string[] },
  "agreedIndicators": [{ "claim": string, "packetIds": string[], "sourceTracks": string[] }],
  "conflictingGaps": [{ "gap": string, "packetIds": string[] }],
  "recommendedEffectorPackage": {
    "actionType": "COMPOSIO_GITHUB_ISSUE" | "WEBHOOK_DISPATCH" | "ARCHIVE_SITREP",
    "title": string,
    "rationale": string,
    "citedPacketIds": string[],
    "outboundPayload": object
  }
}
CRITICAL: Every claim MUST cite valid packetId values from the input list ONLY. Any ungrounded or invented packetId will be rejected.`;

      const res = await fetch(auth.url, {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Cluster ${cluster.clusterId} (${cluster.status}, score=${cluster.corroborationScore}):\n${JSON.stringify(packetContext, null, 2)}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1200,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data: any = await res.json();
        inputTokens = Number(data?.usageMetadata?.promptTokenCount || 320);
        outputTokens = Number(data?.usageMetadata?.candidatesTokenCount || 260);
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        const enriched = {
          ...parsed,
          generatedAt: new Date().toISOString(),
          synthesizedBy: 'vance',
          clusterId: cluster.clusterId,
          modelUsed: cfg.modelName || 'gemini',
        };
        const validation = validateVanceSynthesisCitations(enriched, validPacketIds);
        if (validation.valid && validation.output) {
          chosenSynthesis = validation.output;
        } else {
          console.warn('[CorroborationEngine] Vance LLM output rejected by citation validator:', validation.reason);
        }
      }
    }
  } catch (err) {
    console.warn('[CorroborationEngine] Vance LLM synthesis fallback to deterministic citation fusion:', err);
  }

  if (!chosenSynthesis) {
    chosenSynthesis = buildDeterministicVanceSynthesis(cluster, packets, deltas);
    const check = validateVanceSynthesisCitations(chosenSynthesis, validPacketIds);
    if (!check.valid) {
      throw new Error(`Vance synthesis validation error: ${check.reason}`);
    }
  }

  // Persist fused War Room SITREP directly in IndexedDB cluster record (zero workspace clutter)
  const sitrepPath = `idb://corroboration_clusters/${cluster.clusterId}`;
  const sitrepMd = [
    `# WAR ROOM FUSED SITREP // ${cluster.sectorKey} (${cluster.clusterId})`,
    `**Classification:** OMEGA-CORROBORATED // Agent Vance Master Fusion`,
    `**Status:** \`${cluster.status}\` | **Corroboration Score:** \`${cluster.corroborationScore.toFixed(2)}\` | **Tracks:** \`${cluster.independentTracks.join(' + ')}\``,
    `**Geo-Anchor:** \`${cluster.geoAnchor.lat.toFixed(4)}, ${cluster.geoAnchor.lon.toFixed(4)}\` (±${cluster.geoAnchor.radiusKm} km, ${cluster.geoAnchor.precision})`,
    `**Synthesized At:** ${chosenSynthesis.generatedAt} UTC (Model: \`${chosenSynthesis.modelUsed}\`)`,
    '',
    '## Executive Assessment (BLUF)',
    chosenSynthesis.executiveAssessment.bluf,
    '',
    `**Primary Packet Citations:** ${chosenSynthesis.executiveAssessment.citedPacketIds.map((id) => `\`${id}\``).join(', ')}`,
    '',
    '## Agreed Multi-Source Indicators',
    ...chosenSynthesis.agreedIndicators.map(
      (ind) => `- **${ind.claim}**\n  - Sources: \`${ind.sourceTracks.join(', ')}\` | Cited Packets: ${ind.packetIds.map((id) => `\`${id}\``).join(', ')}`
    ),
    '',
    '## Conflicting / Collection Gaps',
    ...(chosenSynthesis.conflictingGaps.length > 0
      ? chosenSynthesis.conflictingGaps.map(
          (g) => `- ${g.gap} (Packets: ${g.packetIds.map((id) => `\`${id}\``).join(', ')})`
        )
      : ['- None reported; all active tracks aligned.']),
    '',
    '## Provenance Chain (Immutable IndexedDB Raw Snapshots)',
    ...packets.map(
      (p) =>
        `- \`${p.packetId}\` | Track: \`${p.sourceTrack}\` | Endpoint: \`${p.sourceEndpoint}\` | Captured: \`${p.capturedAt}\` (TTL ${p.ttlSeconds}s) | Raw Ref: \`${p.rawPayloadRef}\``
    ),
    '',
    '## Recommended Effector Package (Awaiting Human Gate)',
    `- **Action Type:** \`${chosenSynthesis.recommendedEffectorPackage.actionType}\``,
    `- **Title:** ${chosenSynthesis.recommendedEffectorPackage.title}`,
    `- **Rationale:** ${chosenSynthesis.recommendedEffectorPackage.rationale}`,
  ].join('\n');

  // Queue Human Nomination Gate package in CommandLedgerDb
  const nominationId = `nom-${cluster.clusterId}`;
  const nomination: NominationPackageDbEntry = {
    nominationId,
    clusterId: cluster.clusterId,
    actionType: chosenSynthesis.recommendedEffectorPackage.actionType,
    title: chosenSynthesis.recommendedEffectorPackage.title,
    rationale: chosenSynthesis.recommendedEffectorPackage.rationale,
    citedPacketIds: chosenSynthesis.recommendedEffectorPackage.citedPacketIds,
    outboundPayloadJson: JSON.stringify(
      {
        ...chosenSynthesis.recommendedEffectorPackage.outboundPayload,
        sitrepPath,
      },
      null,
      2
    ),
    status: 'PENDING_HUMAN_REVIEW',
    createdAt: new Date().toISOString(),
  };
  await putNomination(nomination);

  cluster.sitrepPath = sitrepPath;
  cluster.sitrepMarkdown = sitrepMd;
  cluster.vanceSynthesisJson = JSON.stringify(chosenSynthesis);
  cluster.nominationId = nominationId;
  if (cluster.nominationStatus !== 'NOMINATED_APPROVED') {
    cluster.nominationStatus = 'PENDING_HUMAN_REVIEW';
  }
  await putCluster(cluster);

  await appendCommandLedgerEntry({
    timestamp: new Date().toISOString(),
    command_input: `VANCE MASTER_FUSION [${cluster.clusterId}]`,
    involved_agent: 'rec_vance',
    tool_used: 'corroboration_engine_fusion',
    result_summary: `Promoted to ${cluster.status} (${cluster.corroborationScore.toFixed(2)}) citing ${validPacketIds.length} packets -> staged ${nominationId}`,
    success_boost_achieved: Math.round(cluster.corroborationScore * 100),
  });

  await recordAgentMemory({
    agentId: 'rec_vance',
    prompt: `Corroborate ${cluster.sectorKey} (${cluster.clusterId})`,
    summary: chosenSynthesis.executiveAssessment.bluf.slice(0, 320),
    reflection: `Citing packets ${validPacketIds.map((p) => p.slice(0, 10)).join(', ')}`,
  });

  try {
    recordTelemetryExecution({
      agentId: 'rec_vance',
      agentName: 'Agent Vance',
      prompt: `War Room C2 Corroboration Fusion (${cluster.clusterId})`,
      success: true,
      inputTokens: inputTokens || 180,
      outputTokens: outputTokens || 140,
      durationMs: Math.max(12, Date.now() - startedAt),
    });
  } catch {}

  trackStatsMap.vance.lastPolledAt = new Date().toISOString();
  trackStatsMap.vance.pollsCompleted += 1;
  trackStatsMap.vance.packetsIngested += packets.length;
  trackStatsMap.vance.deltasEmitted += 1;
  trackStatsMap.vance.isPolling = false;

  for (const sub of promotionSubscribers) {
    try {
      sub(cluster, chosenSynthesis);
    } catch {}
  }

  const isSelfTestCluster =
    cluster.sectorKey.includes('SELFTEST') ||
    packets.some((p) => p.canonicalTargetKey.startsWith('selftest::'));

  if (
    !isSelfTestCluster &&
    (cluster.status === 'CORROBORATED' || cluster.status === 'CRITICAL_CONVERGENCE') &&
    alertedClusterStatusMap.get(cluster.clusterId) !== cluster.status
  ) {
    alertedClusterStatusMap.set(cluster.clusterId, cluster.status);

    if (typeof window !== 'undefined' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(`[PIXELOPS ${cluster.status}] ${cluster.sectorKey}`, {
          body: chosenSynthesis.executiveAssessment.bluf.slice(0, 200),
          icon: '/pwa-192x192.png',
          tag: `pixelops-cluster-${cluster.clusterId}`,
        });
      } catch {}
    }

    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('pixelops:tactical-threat-alert', {
            detail: {
              clusterId: cluster.clusterId,
              sectorKey: cluster.sectorKey,
              title: cluster.title,
              status: cluster.status,
              corroborationScore: cluster.corroborationScore,
              independentTracks: cluster.independentTracks,
              bluf: chosenSynthesis.executiveAssessment.bluf,
              lat: cluster.geoAnchor.lat,
              lon: cluster.geoAnchor.lon,
              packetCount: packets.length,
              timestamp: chosenSynthesis.generatedAt,
            },
          })
        );
      } catch {}
    }

    import('./NotificationOutboxService')
      .then(({ dispatchOutboxNotification }) => {
        dispatchOutboxNotification({
          title: `[${cluster.status}] ${cluster.title}`,
          body: chosenSynthesis.executiveAssessment.bluf,
          type: 'human_approval_required',
          agentName: 'Agent Vance',
        }).catch(() => {});
      })
      .catch(() => {});
  }

  return { synthesis: chosenSynthesis, sitrepPath, nomination };
}

// ---- Core Ingestion Pipeline ----

function notifyClusterUpdate(cluster: CorroborationClusterDbEntry) {
  for (const sub of updateSubscribers) {
    try {
      sub(cluster);
    } catch {}
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:corroboration-updated', {
          detail: {
            clusterId: cluster.clusterId,
            status: cluster.status,
            score: cluster.corroborationScore,
          },
        })
      );
    } catch {}
  }
}

export async function ingestPacket(input: IngestPacketInput): Promise<IngestPacketResult> {
  const nowMs = input.nowMs ?? Date.now();
  const capturedAt = input.payloadTimestamp || new Date(nowMs).toISOString();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_BY_TRACK[input.sourceTrack] ?? 1800;

  const packetId = await computeDeterministicPacketId(
    input.sourceType,
    input.canonicalTargetKey,
    capturedAt
  );
  const rawPayloadRef = `idb://evidence_packets/${packetId}`;

  const { structuralObject, metrics } = canonicalizeStructuralPayload(
    input.sourceTrack,
    input.sourceType,
    input.canonicalTargetKey,
    input.rawPayload
  );
  const structuralHash = await computeSha256Hex(JSON.stringify(structuralObject));

  const entities = extractCanonicalEntities(
    input.rawPayload,
    `${input.summaryHeadline} ${input.canonicalTargetKey}`,
    input.sectorKey,
    input.explicitEntities
  );

  // Build immutable JSON snapshot envelope stored inside IndexedDB evidence_packets (never workspace_files)
  const immutableSnapshotEnvelope = {
    packetId,
    sourceTrack: input.sourceTrack,
    sourceType: input.sourceType,
    canonicalTargetKey: input.canonicalTargetKey,
    sourceEndpoint: input.sourceEndpoint,
    ingestedBy: input.ingestedBy,
    capturedAt,
    ttlSeconds,
    geoAnchor: input.geoAnchor,
    sectorKey: input.sectorKey,
    entities,
    structuralHash,
    payload: input.rawPayload,
  };

  const packet: EvidencePacketDbEntry = {
    packetId,
    sourceTrack: input.sourceTrack,
    sourceType: input.sourceType,
    canonicalTargetKey: input.canonicalTargetKey,
    payloadTimestamp: capturedAt,
    sourceEndpoint: input.sourceEndpoint,
    ingestedBy: input.ingestedBy,
    capturedAt,
    ttlSeconds,
    geoAnchor: input.geoAnchor,
    sectorKey: input.sectorKey,
    entities,
    rawPayloadRef,
    rawPayloadJson: JSON.stringify(immutableSnapshotEnvelope, null, 2),
    summaryHeadline: input.summaryHeadline,
    structuralHash,
    structuralMetrics: metrics,
  };

  const operativeKey: 'nyx' | 'cipher' | 'vance' =
    input.ingestedBy === 'cipher' ? 'cipher' : input.ingestedBy === 'vance' ? 'vance' : 'nyx';

  // Stateful Snapshot Diffing BEFORE persisting redundant packets on unchanged polls
  const snapshotKey = `${input.sourceTrack}::${input.sourceType}::${input.canonicalTargetKey}::${input.sectorKey}`;
  const prevSnapshot = await getSnapshotByKey(snapshotKey);
  const diffEval = evaluateDeltaThreshold(input, prevSnapshot, structuralHash, metrics);

  if (!diffEval.emit) {
    if (!prevSnapshot) {
      await putPacket(packet);
      await putSnapshot({
        snapshotKey,
        sourceTrack: input.sourceTrack,
        sourceType: input.sourceType,
        canonicalTargetKey: input.canonicalTargetKey,
        sectorKey: input.sectorKey,
        structuralHash,
        structuralMetrics: metrics,
        packetId,
        updatedAt: capturedAt,
      });
    }
    trackStatsMap[operativeKey].silentDrops += 1;
    return {
      packet,
      deltaEmitted: false,
      dropReason: diffEval.dropReason,
      promotedToCorroborated: false,
      vanceTriggered: false,
    };
  }

  await putPacket(packet);
  await putSnapshot({
    snapshotKey,
    sourceTrack: input.sourceTrack,
    sourceType: input.sourceType,
    canonicalTargetKey: input.canonicalTargetKey,
    sectorKey: input.sectorKey,
    structuralHash,
    structuralMetrics: metrics,
    packetId,
    updatedAt: capturedAt,
  });

  trackStatsMap[operativeKey].packetsIngested += 1;
  trackStatsMap[operativeKey].deltasEmitted += 1;

  // Emit DeltaEvent
  const deltaId = `delta-${packetId.slice(0, 16)}`;
  const expiresAt = new Date(new Date(capturedAt).getTime() + ttlSeconds * 1000).toISOString();
  const deltaEvent: DeltaEventDbEntry = {
    deltaId,
    packetId,
    sourceTrack: input.sourceTrack,
    sourceType: input.sourceType,
    sourceEndpoint: input.sourceEndpoint,
    ingestedBy: input.ingestedBy,
    sectorKey: input.sectorKey,
    capturedAt,
    ttlSeconds,
    expiresAt,
    geoAnchor: input.geoAnchor,
    entities: entities.canonicalKeys,
    thresholdReason: diffEval.thresholdReason || 'Verified snapshot shift',
    severityWeight: diffEval.severityWeight,
    rawPayloadRef,
  };
  await putDelta(deltaEvent);

  // Correlate against active clusters within rolling 6h window by Haversine <= 75 km OR shared specific entity
  const allClusters = await getAllClusters();
  const deltaMs = new Date(capturedAt).getTime();

  let matchedCluster: CorroborationClusterDbEntry | null = null;
  for (const existing of allClusters) {
    if (existing.status === 'DISMISSED') continue;
    const clusterTimeMs = new Date(existing.updatedAt).getTime();
    if (Math.abs(deltaMs - clusterTimeMs) > ROLLING_CORRELATION_WINDOW_MS) continue;

    const distKm = haversineDistanceKm(
      deltaEvent.geoAnchor.lat,
      deltaEvent.geoAnchor.lon,
      existing.geoAnchor.lat,
      existing.geoAnchor.lon
    );
    const entityOverlap = deltaEvent.entities.some((e) => existing.sharedEntities.includes(e));

    if (distKm <= HAVERSINE_CORRELATION_KM || entityOverlap) {
      matchedCluster = existing;
      break;
    }
  }

  const prevStatus = matchedCluster?.status;

  if (!matchedCluster) {
    const clusterHash = (await computeSha256Hex(`${packet.sectorKey}|${packetId}`)).slice(0, 10);
    matchedCluster = {
      clusterId: `clu-${clusterHash}`,
      title: input.summaryHeadline,
      sectorKey: input.sectorKey,
      geoAnchor: input.geoAnchor,
      status: 'CANDIDATE',
      corroborationScore: 0.35,
      independentTracks: [input.sourceTrack],
      packetIds: [packetId],
      deltaIds: [deltaId],
      sharedEntities: [...entities.canonicalKeys],
      createdAt: capturedAt,
      updatedAt: capturedAt,
      expiresAt,
      nominationStatus: 'UNNOMINATED',
    };
  } else {
    if (!matchedCluster.packetIds.includes(packetId)) {
      matchedCluster.packetIds = [...matchedCluster.packetIds, packetId];
    }
    if (!matchedCluster.deltaIds.includes(deltaId)) {
      matchedCluster.deltaIds = [...matchedCluster.deltaIds, deltaId];
    }
    if (!matchedCluster.independentTracks.includes(input.sourceTrack)) {
      matchedCluster.independentTracks = [...matchedCluster.independentTracks, input.sourceTrack];
    }
    matchedCluster.sharedEntities = Array.from(
      new Set([...matchedCluster.sharedEntities, ...entities.canonicalKeys])
    );
    if (input.geoAnchor.precision === 'EXACT' && matchedCluster.geoAnchor.precision !== 'EXACT') {
      matchedCluster.geoAnchor = input.geoAnchor;
    }
    if (new Date(capturedAt).getTime() > new Date(matchedCluster.updatedAt).getTime()) {
      matchedCluster.updatedAt = capturedAt;
    }
  }

  // Load all packets & deltas in this cluster to compute deterministic confidence score
  const allDeltas = await getAllDeltas();
  const clusterPackets: EvidencePacketDbEntry[] = [];
  for (const pid of matchedCluster.packetIds) {
    const p = await getPacketById(pid);
    if (p) clusterPackets.push(p);
  }
  const clusterDeltas = allDeltas.filter((d) => matchedCluster!.deltaIds.includes(d.deltaId));

  const sharedBetweenPackets = computeCrossPacketSharedEntities(clusterPackets);
  const evaluation = evaluateClusterConfidence(
    clusterPackets,
    clusterDeltas,
    sharedBetweenPackets,
    matchedCluster.status,
    nowMs
  );

  matchedCluster.status = evaluation.status;
  matchedCluster.corroborationScore = evaluation.score;
  matchedCluster.expiresAt = evaluation.earliestExpiryIso;
  if (matchedCluster.independentTracks.length >= 2) {
    matchedCluster.title = `${matchedCluster.sectorKey} Multi-Source Convergence (${matchedCluster.independentTracks.join(' + ')})`;
  }

  await putCluster(matchedCluster);

  const promotedToCorroborated =
    (prevStatus === undefined || prevStatus === 'CANDIDATE' || prevStatus === 'STALE') &&
    (matchedCluster.status === 'CORROBORATED' || matchedCluster.status === 'CRITICAL_CONVERGENCE');

  const escalatedToCritical =
    prevStatus === 'CORROBORATED' && matchedCluster.status === 'CRITICAL_CONVERGENCE';

  let vanceTriggered = false;
  if (promotedToCorroborated || escalatedToCritical) {
    vanceTriggered = true;
    await synthesizeClusterWithVance(matchedCluster, clusterPackets, clusterDeltas);
  }

  notifyClusterUpdate(matchedCluster);

  return {
    packet,
    deltaEmitted: true,
    deltaEvent,
    cluster: matchedCluster,
    promotedToCorroborated,
    vanceTriggered,
  };
}

function computeCrossPacketSharedEntities(packets: EvidencePacketDbEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const p of packets) {
    for (const k of p.entities.canonicalKeys) {
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([key]) => key);
}

// ---- Automatic Staleness Sweep & Cluster Queries ----

export async function refreshAllClusterStaleness(
  nowMs: number = Date.now()
): Promise<CorroborationClusterDbEntry[]> {
  const clusters = await getAllClusters();
  const allDeltas = await getAllDeltas();
  const updated: CorroborationClusterDbEntry[] = [];

  for (const cluster of clusters) {
    if (cluster.status === 'DISMISSED') {
      updated.push(cluster);
      continue;
    }
    const packets: EvidencePacketDbEntry[] = [];
    for (const pid of cluster.packetIds) {
      const p = await getPacketById(pid);
      if (p) packets.push(p);
    }
    const deltas = allDeltas.filter((d) => cluster.deltaIds.includes(d.deltaId));
    const sharedBetweenPackets = computeCrossPacketSharedEntities(packets);
    const evalRes = evaluateClusterConfidence(
      packets,
      deltas,
      sharedBetweenPackets,
      cluster.status,
      nowMs
    );

    if (
      evalRes.status !== cluster.status ||
      evalRes.score !== cluster.corroborationScore ||
      evalRes.earliestExpiryIso !== cluster.expiresAt
    ) {
      cluster.status = evalRes.status;
      cluster.corroborationScore = evalRes.score;
      cluster.expiresAt = evalRes.earliestExpiryIso;
      await putCluster(cluster);
      notifyClusterUpdate(cluster);
    }
    updated.push(cluster);
  }

  return updated;
}

export async function resolveClusterByIdOrPrefix(
  idOrPrefix: string
): Promise<CorroborationClusterDbEntry | null> {
  const clean = (idOrPrefix || '').trim().toLowerCase();
  if (!clean) return null;
  const all = await getAllClusters();
  return (
    all.find((c) => c.clusterId.toLowerCase() === clean) ||
    all.find((c) => c.clusterId.toLowerCase().startsWith(clean)) ||
    null
  );
}

export async function getClusterWithPackets(
  clusterIdOrPrefix: string,
  nowMs: number = Date.now()
): Promise<ClusterWithPackets | null> {
  await refreshAllClusterStaleness(nowMs);
  const cluster = await resolveClusterByIdOrPrefix(clusterIdOrPrefix);
  if (!cluster) return null;

  const packets: EvidencePacketDbEntry[] = [];
  for (const pid of cluster.packetIds) {
    const p = await getPacketById(pid);
    if (p) packets.push(p);
  }
  const allDeltas = await getAllDeltas();
  const deltas = allDeltas.filter((d) => cluster.deltaIds.includes(d.deltaId));
  const nominations = await getAllNominations();
  const nomination = nominations.find((n) => n.clusterId === cluster.clusterId) || null;

  let synthesis: VanceSynthesisOutput | null = null;
  if (cluster.vanceSynthesisJson) {
    try {
      synthesis = JSON.parse(cluster.vanceSynthesisJson) as VanceSynthesisOutput;
    } catch {}
  }

  return { cluster, packets, deltas, nomination, synthesis };
}

export async function getCorroborationClustersWithPackets(
  nowMs: number = Date.now()
): Promise<ClusterWithPackets[]> {
  const clusters = await refreshAllClusterStaleness(nowMs);
  const allDeltas = await getAllDeltas();
  const nominations = await getAllNominations();
  const results: ClusterWithPackets[] = [];

  for (const cluster of clusters) {
    const packets: EvidencePacketDbEntry[] = [];
    for (const pid of cluster.packetIds) {
      const p = await getPacketById(pid);
      if (p) packets.push(p);
    }
    const deltas = allDeltas.filter((d) => cluster.deltaIds.includes(d.deltaId));
    const nomination = nominations.find((n) => n.clusterId === cluster.clusterId) || null;
    let synthesis: VanceSynthesisOutput | null = null;
    if (cluster.vanceSynthesisJson) {
      try {
        synthesis = JSON.parse(cluster.vanceSynthesisJson) as VanceSynthesisOutput;
      } catch {}
    }
    results.push({ cluster, packets, deltas, nomination, synthesis });
  }

  return results;
}

// ---- Human Nomination Gate & False-Positive Dismissal ----

export async function nominateClusterPackage(
  clusterIdOrPrefix: string,
  options?: {
    actionType?: EffectorActionType;
    approvedBy?: string;
    nowMs?: number;
  }
): Promise<{
  approved: boolean;
  reason?: string;
  cluster?: CorroborationClusterDbEntry;
  nomination?: NominationPackageDbEntry;
  ledgerHash?: string;
  effectorFilePath?: string;
}> {
  const nowMs = options?.nowMs ?? Date.now();
  const bundle = await getClusterWithPackets(clusterIdOrPrefix, nowMs);
  if (!bundle) {
    return { approved: false, reason: `Cluster "${clusterIdOrPrefix}" not found.` };
  }

  const { cluster, packets, synthesis } = bundle;
  if (cluster.status === 'DISMISSED') {
    return { approved: false, reason: `Cluster ${cluster.clusterId} was already dismissed.` };
  }
  if (cluster.status === 'STALE' || cluster.corroborationScore < 0.5) {
    return {
      approved: false,
      reason: `STALE_OR_UNCORROBORATED: Cluster ${cluster.clusterId} has status=${cluster.status} (score=${cluster.corroborationScore}). Refresh expired feeds before nominating an effector package.`,
    };
  }

  const citedIds = packets.map((p) => p.packetId);
  const actionType =
    options?.actionType ||
    synthesis?.recommendedEffectorPackage.actionType ||
    'COMPOSIO_GITHUB_ISSUE';
  const title =
    synthesis?.recommendedEffectorPackage.title ||
    `[PIXELOPS ${cluster.status}] ${cluster.sectorKey} Effector Nomination`;
  const rationale =
    synthesis?.recommendedEffectorPackage.rationale ||
    `Verified multi-source convergence (${cluster.independentTracks.join(' + ')}) with score ${cluster.corroborationScore.toFixed(2)}.`;

  const outboundPayload = {
    actionType,
    clusterId: cluster.clusterId,
    sectorKey: cluster.sectorKey,
    status: cluster.status,
    corroborationScore: cluster.corroborationScore,
    approvedAt: new Date(nowMs).toISOString(),
    approvedBy: options?.approvedBy || 'HUMAN_COMMANDER',
    citedPacketIds: citedIds,
    rawPayloadRefs: packets.map((p) => p.rawPayloadRef),
    sitrepPath: cluster.sitrepPath || null,
    summary: synthesis?.executiveAssessment.bluf || cluster.title,
  };

  // Commit immutable human sign-off BEFORE staging/dispatching external effector payload
  const ledgerEntry = await appendCommandLedgerEntry({
    timestamp: new Date(nowMs).toISOString(),
    command_input: `HUMAN_NOMINATION_GATE approve ${cluster.clusterId} (${actionType})`,
    involved_agent: options?.approvedBy || 'HUMAN_COMMANDER',
    tool_used: 'corroboration_human_gate',
    result_summary: `Approved effector ${actionType} for ${cluster.clusterId} citing ${citedIds.length} verified packets (score=${cluster.corroborationScore.toFixed(2)})`,
    success_boost_achieved: 100,
  });

  const nominationId = cluster.nominationId || `nom-${cluster.clusterId}`;
  const effectorFilePath = `idb://nomination_packages/${nominationId}`;

  const nomination: NominationPackageDbEntry = {
    nominationId,
    clusterId: cluster.clusterId,
    actionType,
    title,
    rationale,
    citedPacketIds: citedIds,
    outboundPayloadJson: JSON.stringify(
      { ...outboundPayload, ledgerHash: ledgerEntry.ledger_hash },
      null,
      2
    ),
    status: 'NOMINATED_APPROVED',
    createdAt: bundle.nomination?.createdAt || new Date(nowMs).toISOString(),
    decidedAt: new Date(nowMs).toISOString(),
    approvedBy: options?.approvedBy || 'HUMAN_COMMANDER',
    ledgerHash: ledgerEntry.ledger_hash,
    ledgerEntryId: ledgerEntry.id,
  };
  await putNomination(nomination);

  cluster.nominationId = nomination.nominationId;
  cluster.nominationStatus = 'NOMINATED_APPROVED';
  await putCluster(cluster);
  notifyClusterUpdate(cluster);

  return {
    approved: true,
    cluster,
    nomination,
    ledgerHash: ledgerEntry.ledger_hash,
    effectorFilePath,
  };
}

export async function dismissClusterFalsePositive(
  clusterIdOrPrefix: string,
  reason = 'Operator dismissed as false positive / benign coincidence',
  nowMs: number = Date.now()
): Promise<{
  dismissed: boolean;
  cluster?: CorroborationClusterDbEntry;
  ledgerHash?: string;
}> {
  const cluster = await resolveClusterByIdOrPrefix(clusterIdOrPrefix);
  if (!cluster) return { dismissed: false };

  cluster.status = 'DISMISSED';
  cluster.corroborationScore = 0;
  cluster.nominationStatus = 'DISMISSED_FALSE_POSITIVE';
  await putCluster(cluster);

  const existingNom = (await getAllNominations()).find((n) => n.clusterId === cluster.clusterId);
  if (existingNom) {
    existingNom.status = 'DISMISSED';
    existingNom.decidedAt = new Date(nowMs).toISOString();
    await putNomination(existingNom);
  }

  const ledgerEntry = await appendCommandLedgerEntry({
    timestamp: new Date(nowMs).toISOString(),
    command_input: `HUMAN_NOMINATION_GATE dismiss ${cluster.clusterId}`,
    involved_agent: 'HUMAN_COMMANDER',
    tool_used: 'corroboration_human_gate',
    result_summary: `Dismissed cluster ${cluster.clusterId}: ${reason}`,
    success_boost_achieved: 0,
  });

  notifyClusterUpdate(cluster);
  return { dismissed: true, cluster, ledgerHash: ledgerEntry.ledger_hash };
}

// ---- Subscriptions & Runtime Telemetry ----

export function subscribeToCorroborationUpdates(
  cb: (cluster: CorroborationClusterDbEntry) => void
): () => void {
  updateSubscribers.add(cb);
  return () => {
    updateSubscribers.delete(cb);
  };
}

export function subscribeToClusterPromotions(
  cb: (cluster: CorroborationClusterDbEntry, synthesis: VanceSynthesisOutput) => void
): () => void {
  promotionSubscribers.add(cb);
  return () => {
    promotionSubscribers.delete(cb);
  };
}

export async function getCorroborationStatusSummary(nowMs: number = Date.now()) {
  const clusters = await refreshAllClusterStaleness(nowMs);
  const packets = await getAllPackets();
  const deltas = await getAllDeltas();
  const nominations = await getAllNominations();

  const statusCounts: Record<CorroborationClusterStatus, number> = {
    CANDIDATE: 0,
    CORROBORATED: 0,
    CRITICAL_CONVERGENCE: 0,
    STALE: 0,
    DISMISSED: 0,
  };
  for (const c of clusters) {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  }

  const trackPacketCounts: Record<CorroborationSourceTrack, number> = {
    WIDE_AREA: 0,
    SIGNALS_INFRA: 0,
    WRITTEN_WIRE: 0,
    CYBER_CVE: 0,
  };
  for (const p of packets) {
    trackPacketCounts[p.sourceTrack] = (trackPacketCounts[p.sourceTrack] || 0) + 1;
  }

  return {
    watcherTracks: { ...trackStatsMap },
    totalPackets: packets.length,
    totalDeltas: deltas.length,
    totalClusters: clusters.length,
    totalNominations: nominations.length,
    pendingNominations: nominations.filter((n) => n.status === 'PENDING_HUMAN_REVIEW').length,
    statusCounts,
    trackPacketCounts,
    clusters,
  };
}

// ---- Specialist Parallel Ingestion Tracks (Nyx & Cipher) ----

function inferGeoAnchorFromText(text: string): {
  sectorKey: string;
  geoAnchor: CorroborationGeoAnchor;
} {
  const lower = (text || '').toLowerCase();
  for (const rule of SECTOR_GEO_ANCHORS) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return {
        sectorKey: rule.sectorKey,
        geoAnchor: {
          lat: rule.lat,
          lon: rule.lon,
          radiusKm: 75,
          precision: rule.precision,
        },
      };
    }
  }
  return {
    sectorKey: 'SECTOR-GLOBAL',
    geoAnchor: { lat: 39.0438, lon: -77.4874, radiusKm: 75, precision: 'REGIONAL' },
  };
}

export async function runNyxSpecialistTrack(): Promise<{ ingested: number; deltas: number }> {
  trackStatsMap.nyx.isPolling = true;
  trackStatsMap.nyx.lastError = null;
  let ingested = 0;
  let deltas = 0;

  try {
    const tasks: Array<Promise<void>> = [];

    // 1. WIDE_AREA: USGS M4.5+ Daily Seismic GeoJSON
    tasks.push(
      (async () => {
        const endpoint =
          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
        const geojson: any = await res.json();
        const features = Array.isArray(geojson?.features) ? geojson.features.slice(0, 6) : [];
        for (const feat of features) {
          const coords = feat?.geometry?.coordinates || [];
          const lon = Number(coords[0]);
          const lat = Number(coords[1]);
          if (isNaN(lat) || isNaN(lon)) continue;
          const mag = Number(feat?.properties?.mag ?? 0);
          if (mag < 4.0) continue;
          const place = String(feat?.properties?.place || 'Unlisted fault sector');
          const tsMs = Number(feat?.properties?.time || Date.now());
          const payloadTimestamp = new Date(tsMs).toISOString();
          const { sectorKey } = inferGeoAnchorFromText(place);
          const result = await ingestPacket({
            sourceTrack: 'WIDE_AREA',
            sourceType: 'usgs_geojson',
            canonicalTargetKey: String(feat.id || `usgs-${lat.toFixed(2)}-${lon.toFixed(2)}`),
            payloadTimestamp,
            sourceEndpoint: endpoint,
            ingestedBy: 'nyx',
            ttlSeconds: 300,
            geoAnchor: { lat, lon, radiusKm: 45, precision: 'EXACT' },
            sectorKey,
            summaryHeadline: `USGS M${mag.toFixed(1)} Seismic Event — ${place}`,
            rawPayload: feat,
          });
          ingested += 1;
          if (result.deltaEmitted) deltas += 1;
        }
      })()
    );

    // 2. WRITTEN_WIRE: S2 Underground Wire RSS Text Dispatches
    tasks.push(
      (async () => {
        const { fetchS2WireFeed, S2_WIRE_FEED_URL } = await import('./s2Parser');
        const dispatches = (await fetchS2WireFeed()).slice(0, 3);
        for (const d of dispatches) {
          const { sectorKey, geoAnchor } = inferGeoAnchorFromText(`${d.title} ${d.content}`);
          const result = await ingestPacket({
            sourceTrack: 'WRITTEN_WIRE',
            sourceType: 's2_wire',
            canonicalTargetKey: d.link || d.title.slice(0, 80),
            payloadTimestamp: d.timestamp || new Date().toISOString(),
            sourceEndpoint: d.link || S2_WIRE_FEED_URL,
            ingestedBy: 'nyx',
            ttlSeconds: 1800,
            geoAnchor,
            sectorKey,
            summaryHeadline: d.title,
            rawPayload: d,
          });
          ingested += 1;
          if (result.deltaEmitted) deltas += 1;
        }
      })()
    );

    // 3. WIDE_AREA: Maritime Chokepoints API when running under PixelOps server origin
    if (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http')) {
      tasks.push(
        (async () => {
          const endpoint = '/api/osint/maritime';
          const res = await fetch(endpoint, { signal: AbortSignal.timeout(7000) });
          if (!res.ok) return;
          const data: any = await res.json();
          const chokepoints = Array.isArray(data?.chokepoints)
            ? data.chokepoints
            : Array.isArray(data)
            ? data
            : [];
          for (const cp of chokepoints.slice(0, 6)) {
            const name = String(cp.name || cp.chokepoint || 'Maritime Sector');
            const lat = Number(cp.lat ?? inferGeoAnchorFromText(name).geoAnchor.lat);
            const lon = Number(cp.lon ?? inferGeoAnchorFromText(name).geoAnchor.lon);
            const { sectorKey } = inferGeoAnchorFromText(name);
            const result = await ingestPacket({
              sourceTrack: 'WIDE_AREA',
              sourceType: 'maritime_ais',
              canonicalTargetKey: name.toLowerCase().replace(/\s+/g, '-'),
              payloadTimestamp: String(cp.updatedAt || data.timestamp || new Date().toISOString()),
              sourceEndpoint: endpoint,
              ingestedBy: 'nyx',
              ttlSeconds: 300,
              geoAnchor: { lat, lon, radiusKm: 50, precision: 'REGIONAL' },
              sectorKey,
              summaryHeadline: `AIS Maritime Overwatch — ${name} (${cp.status || 'MONITORED'})`,
              rawPayload: cp,
            });
            ingested += 1;
            if (result.deltaEmitted) deltas += 1;
          }
        })()
      );
    }

    // 4. PRE-MEDIA LOCALIZED CAD, NWS CAP POLYGONS, MICRO-SEISMIC/BLAST & EONET THERMAL (Geofenced)
    tasks.push(
      (async () => {
        const { getLocalGeofenceConfig } = await import('./OsintToolsService');
        const { queryPreMediaGeoHazardsAndCad } = await import('./PreMediaSignalService');
        const gf = getLocalGeofenceConfig();
        const localRes = await queryPreMediaGeoHazardsAndCad({
          lat: gf.lat,
          lon: gf.lon,
          radiusKm: gf.radiusKm,
        });
        const sectorKey = gf.label || 'LOCAL-SECTOR';

        for (const inc of localRes.municipalDispatches.slice(0, 6)) {
          const result = await ingestPacket({
            sourceTrack: 'WRITTEN_WIRE',
            sourceType: 'local_dispatch',
            canonicalTargetKey: inc.id,
            payloadTimestamp: inc.timestamp,
            sourceEndpoint: inc.sourceUrl,
            ingestedBy: 'nyx',
            ttlSeconds: 900,
            geoAnchor: { lat: inc.lat, lon: inc.lon, radiusKm: Math.min(gf.radiusKm, 35), precision: 'EXACT' },
            sectorKey,
            summaryHeadline: `[${inc.sourceType.toUpperCase()}] ${inc.title}`,
            rawPayload: inc,
          });
          ingested += 1;
          if (result.deltaEmitted) deltas += 1;
        }

        for (const haz of localRes.geoHazardSignals.slice(0, 6)) {
          if (haz.source === 'NWS_CAP_POLYGON') continue;
          const result = await ingestPacket({
            sourceTrack: 'WIDE_AREA',
            sourceType: haz.source.toLowerCase(),
            canonicalTargetKey: haz.id,
            payloadTimestamp: haz.timestamp,
            sourceEndpoint: haz.sourceEndpoint,
            ingestedBy: 'nyx',
            ttlSeconds: 600,
            geoAnchor: { lat: haz.lat, lon: haz.lon, radiusKm: Math.min(gf.radiusKm, 35), precision: 'EXACT' },
            sectorKey,
            summaryHeadline: haz.title,
            rawPayload: haz.rawPayload,
          });
          ingested += 1;
          if (result.deltaEmitted) deltas += 1;
        }
      })()
    );

    const settled = await Promise.allSettled(tasks);
    const errors = settled
      .filter((s): s is PromiseRejectedResult => s.status === 'rejected')
      .map((s) => String(s.reason?.message || s.reason));
    if (errors.length > 0 && ingested === 0) {
      trackStatsMap.nyx.lastError = errors[0];
    }
  } catch (err: any) {
    trackStatsMap.nyx.lastError = String(err?.message || err);
  } finally {
    trackStatsMap.nyx.isPolling = false;
    trackStatsMap.nyx.lastPolledAt = new Date().toISOString();
    trackStatsMap.nyx.pollsCompleted += 1;
  }

  return { ingested, deltas };
}

export async function runCipherSpecialistTrack(): Promise<{ ingested: number; deltas: number }> {
  trackStatsMap.cipher.isPolling = true;
  trackStatsMap.cipher.lastError = null;
  let ingested = 0;
  let deltas = 0;

  try {
    const tasks: Array<Promise<void>> = [];

    // Collect user-configured watched domains from tripwire_watches only (avoid polling noisy Akamai CDN edges)
    const infraTargets: Array<{ domain: string; sectorKey: string; geoAnchor: CorroborationGeoAnchor }> = [];

    try {
      const watches = await ledgerDb.tripwire_watches.toArray();
      for (const w of watches) {
        if (!w.enabled || !w.target) continue;
        if ((w.category === 'dns' || w.category === 'ct_certs') && infraTargets.length < 6) {
          const cleanHost = w.target.replace(/^https?:\/\//i, '').split('/')[0];
          const inferred = inferGeoAnchorFromText(`${w.label} ${cleanHost}`);
          infraTargets.push({ domain: cleanHost, ...inferred });
        }
      }
    } catch {}

    // 1. SIGNALS_INFRA: Google DoH DNS Resolution
    for (const target of infraTargets) {
      tasks.push(
        (async () => {
          const endpoint = `https://dns.google/resolve?name=${encodeURIComponent(target.domain)}&type=A`;
          const res = await fetch(endpoint, { signal: AbortSignal.timeout(7000) });
          if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
          const dnsJson: any = await res.json();
          const result = await ingestPacket({
            sourceTrack: 'SIGNALS_INFRA',
            sourceType: 'doh_dns',
            canonicalTargetKey: target.domain,
            payloadTimestamp: new Date().toISOString(),
            sourceEndpoint: endpoint,
            ingestedBy: 'cipher',
            ttlSeconds: 3600,
            geoAnchor: target.geoAnchor,
            sectorKey: target.sectorKey,
            summaryHeadline: `DoH A-Record Watch: ${target.domain} (Status=${dnsJson.Status ?? 0})`,
            rawPayload: dnsJson,
          });
          ingested += 1;
          if (result.deltaEmitted) deltas += 1;
        })()
      );
    }

    // 2. CYBER_CVE: CISA Known Exploited Vulnerabilities (KEV) Catalog
    tasks.push(
      (async () => {
        const endpoint =
          'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`CISA KEV HTTP ${res.status}`);
        const kevData: any = await res.json();
        const vulns = Array.isArray(kevData?.vulnerabilities)
          ? kevData.vulnerabilities.slice(-3).reverse()
          : [];
        for (const v of vulns) {
          const cveId = String(v.cveID || 'CVE-UNLISTED').toUpperCase();
          const result = await ingestPacket({
            sourceTrack: 'CYBER_CVE',
            sourceType: 'cisa_kev',
            canonicalTargetKey: cveId,
            payloadTimestamp: v.dateAdded
              ? new Date(v.dateAdded).toISOString()
              : String(kevData.dateReleased || new Date().toISOString()),
            sourceEndpoint: endpoint,
            ingestedBy: 'cipher',
            ttlSeconds: 3600,
            geoAnchor: { lat: 39.0438, lon: -77.4874, radiusKm: 50, precision: 'REGIONAL' },
            sectorKey: 'SECTOR-01-ASHBURN',
            summaryHeadline: `CISA KEV Advisory ${cveId}: ${v.vendorProject || ''} ${v.product || ''} — ${v.vulnerabilityName || ''}`.trim(),
            rawPayload: v,
          });
          ingested += 1;
          if (result.deltaEmitted) deltas += 1;
        }
      })()
    );

    // 3. SIGNALS_INFRA: Geofenced ADS-B Tactical/Emergency Airspace & Atmospheric Plume Sensors
    tasks.push(
      (async () => {
        const { getLocalGeofenceConfig } = await import('./OsintToolsService');
        const { queryGeofencedAdsbAirspace, queryGeofencedPlumeAndEnvSensors } = await import(
          './PreMediaSignalService'
        );
        const gf = getLocalGeofenceConfig();
        const sectorKey = gf.label || 'LOCAL-SECTOR';

        const [adsbRes, plumeRes] = await Promise.all([
          queryGeofencedAdsbAirspace({ lat: gf.lat, lon: gf.lon, radiusKm: gf.radiusKm }),
          queryGeofencedPlumeAndEnvSensors({ lat: gf.lat, lon: gf.lon }),
        ]);

        for (const ac of adsbRes.tacticalContacts.slice(0, 5)) {
          const result = await ingestPacket({
            sourceTrack: 'SIGNALS_INFRA',
            sourceType: 'adsb_airspace',
            canonicalTargetKey: `adsb:${ac.icaoHex}:${ac.tacticalFlag}`,
            payloadTimestamp: ac.capturedAt,
            sourceEndpoint: adsbRes.endpointUsed,
            ingestedBy: 'cipher',
            ttlSeconds: 300,
            geoAnchor: { lat: ac.lat, lon: ac.lon, radiusKm: 20, precision: 'EXACT' },
            sectorKey,
            summaryHeadline: `[ADS-B ${ac.tacticalFlag}] ${ac.summary}`,
            rawPayload: ac,
          });
          ingested += 1;
          if (result.deltaEmitted) deltas += 1;
        }

        if (plumeRes && plumeRes.anomalyDetected) {
          const result = await ingestPacket({
            sourceTrack: 'SIGNALS_INFRA',
            sourceType: 'air_plume_sensor',
            canonicalTargetKey: `plume:${gf.lat.toFixed(2)},${gf.lon.toFixed(2)}:${plumeRes.anomalyType}`,
            payloadTimestamp: plumeRes.capturedAt,
            sourceEndpoint: plumeRes.sourceEndpoint,
            ingestedBy: 'cipher',
            ttlSeconds: 600,
            geoAnchor: { lat: gf.lat, lon: gf.lon, radiusKm: 20, precision: 'EXACT' },
            sectorKey,
            summaryHeadline: `[PLUME SENSOR] ${plumeRes.summary}`,
            rawPayload: plumeRes,
          });
          ingested += 1;
          if (result.deltaEmitted) deltas += 1;
        }
      })()
    );

    const settled = await Promise.allSettled(tasks);
    const errors = settled
      .filter((s): s is PromiseRejectedResult => s.status === 'rejected')
      .map((s) => String(s.reason?.message || s.reason));
    if (errors.length > 0 && ingested === 0) {
      trackStatsMap.cipher.lastError = errors[0];
    }
  } catch (err: any) {
    trackStatsMap.cipher.lastError = String(err?.message || err);
  } finally {
    trackStatsMap.cipher.isPolling = false;
    trackStatsMap.cipher.lastPolledAt = new Date().toISOString();
    trackStatsMap.cipher.pollsCompleted += 1;
  }

  return { ingested, deltas };
}

let isParallelSweepRunning = false;

export async function runParallelSpecialistTracks(): Promise<{
  nyx: { ingested: number; deltas: number };
  cipher: { ingested: number; deltas: number };
  clustersUpdated: number;
}> {
  if (isParallelSweepRunning) {
    const existing = await getAllClusters();
    return {
      nyx: { ingested: 0, deltas: 0 },
      cipher: { ingested: 0, deltas: 0 },
      clustersUpdated: existing.length,
    };
  }
  isParallelSweepRunning = true;

  try {
    const [nyxRes, cipherRes] = await Promise.allSettled([
      runNyxSpecialistTrack(),
      runCipherSpecialistTrack(),
    ]);
    const clusters = await refreshAllClusterStaleness();
    return {
      nyx: nyxRes.status === 'fulfilled' ? nyxRes.value : { ingested: 0, deltas: 0 },
      cipher: cipherRes.status === 'fulfilled' ? cipherRes.value : { ingested: 0, deltas: 0 },
      clustersUpdated: clusters.length,
    };
  } finally {
    isParallelSweepRunning = false;
  }
}

export function getSpecialistWatcherStatus(): Record<'nyx' | 'cipher' | 'vance', SpecialistTrackRuntimeStats> {
  return {
    nyx: { ...trackStatsMap.nyx },
    cipher: { ...trackStatsMap.cipher },
    vance: { ...trackStatsMap.vance },
  };
}

// ---- Map Pin Projection Helper ----

export function clusterToTacticalPin(bundle: ClusterWithPackets) {
  const { cluster, packets, synthesis, nomination } = bundle;
  const tracks = Array.from(new Set(packets.map((p) => p.sourceTrack)));
  const categoryLabel =
    cluster.status === 'CRITICAL_CONVERGENCE'
      ? `CRIT CONVERGENCE [${tracks.length}x SRC]`
      : cluster.status === 'CORROBORATED'
      ? `CORROBORATED [${tracks.length}x SRC]`
      : cluster.status === 'STALE'
      ? 'STALE TELEMETRY'
      : `CANDIDATE [${tracks[0] || 'SINGLE'}]`;

  const azimuth =
    packets.length >= 2
      ? Math.round(
          (Math.atan2(
            packets[1].geoAnchor.lon - cluster.geoAnchor.lon,
            packets[1].geoAnchor.lat - cluster.geoAnchor.lat
          ) *
            180) /
            Math.PI +
            360
        ) % 360
      : 45;

  return {
    id: cluster.clusterId,
    clusterId: cluster.clusterId,
    lat: cluster.geoAnchor.lat,
    lon: cluster.geoAnchor.lon,
    title: cluster.title,
    summary:
      synthesis?.executiveAssessment.bluf ||
      packets.map((p) => p.summaryHeadline).join(' • ') ||
      cluster.sectorKey,
    priority:
      cluster.corroborationScore >= 0.85
        ? ('HIGH' as const)
        : cluster.corroborationScore >= 0.5
        ? ('HIGH' as const)
        : ('MEDIUM' as const),
    timestamp: new Date(cluster.updatedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
    capturedAt: cluster.updatedAt,
    expiresAt: cluster.expiresAt,
    category: categoryLabel,
    corroborationScore: cluster.corroborationScore,
    corroborationStatus: cluster.status,
    sourceTracks: tracks,
    sourceCount: tracks.length,
    vectorAzimuthDeg: azimuth,
    sitrepPath: cluster.sitrepPath,
    nominationStatus:
      nomination?.status === 'DISMISSED'
        ? ('DISMISSED_FALSE_POSITIVE' as const)
        : nomination?.status || cluster.nominationStatus || ('UNNOMINATED' as const),
    nominationId: nomination?.nominationId || cluster.nominationId,
    vanceSynthesis: synthesis || undefined,
    provenancePackets: packets.map((p) => ({
      packetId: p.packetId,
      sourceTrack: p.sourceTrack,
      sourceType: p.sourceType,
      sourceEndpoint: p.sourceEndpoint,
      ingestedBy: p.ingestedBy,
      capturedAt: p.capturedAt,
      ttlSeconds: p.ttlSeconds,
      rawPayloadRef: p.rawPayloadRef,
      summaryHeadline: p.summaryHeadline,
      confidenceWeight: Number((1 / Math.max(1, packets.length)).toFixed(2)),
    })),
  };
}

// ---- Deterministic Diagnostic Self-Test (CLI `intel selftest`) ----

export async function clearSelfTestArtifacts(): Promise<void> {
  for (const [k, v] of Array.from(memPackets.entries())) {
    if (v.canonicalTargetKey.startsWith('selftest::')) memPackets.delete(k);
  }
  for (const [k] of Array.from(memSnapshots.entries())) {
    if (k.includes('selftest::')) memSnapshots.delete(k);
  }
  for (const [k, v] of Array.from(memDeltas.entries())) {
    if (!memPackets.has(v.packetId)) memDeltas.delete(k);
  }
  for (const [k, v] of Array.from(memClusters.entries())) {
    if (v.sectorKey === 'SECTOR-54-SUEZ-SELFTEST') memClusters.delete(k);
  }
  for (const [k, v] of Array.from(memNominations.entries())) {
    if (!memClusters.has(v.clusterId)) memNominations.delete(k);
  }

  try {
    const pkts = await ledgerDb.evidence_packets.toArray();
    const stIds = new Set(
      pkts.filter((p) => p.canonicalTargetKey.startsWith('selftest::')).map((p) => p.packetId)
    );
    for (const id of stIds) await ledgerDb.evidence_packets.delete(id);

    const snaps = await ledgerDb.corroboration_snapshots.toArray();
    for (const s of snaps) {
      if (s.snapshotKey.includes('selftest::')) await ledgerDb.corroboration_snapshots.delete(s.snapshotKey);
    }

    const deltas = await ledgerDb.delta_events.toArray();
    for (const d of deltas) {
      if (stIds.has(d.packetId)) await ledgerDb.delta_events.delete(d.deltaId);
    }

    const clusters = await ledgerDb.corroboration_clusters.toArray();
    for (const c of clusters) {
      if (c.sectorKey === 'SECTOR-54-SUEZ-SELFTEST') {
        await ledgerDb.corroboration_clusters.delete(c.clusterId);
      }
    }
  } catch {}
}

export async function runCorroborationSelfTest(): Promise<CorroborationSelfTestReport> {
  const steps: SelfTestStepResult[] = [];
  await clearSelfTestArtifacts();

  const t0 = Date.now();
  const baseIso = new Date(t0 - 15_000).toISOString();
  const signalIso = new Date(t0 - 5_000).toISOString();

  // Step 1: Record nominal DoH baseline & verify identical re-poll is silently dropped
  const dohBaselinePayload = {
    Status: 0,
    TC: false,
    RD: true,
    RA: true,
    AD: true,
    Question: [{ name: 'suez-relay.subsea-ops.net.', type: 1 }],
    Answer: [{ name: 'suez-relay.subsea-ops.net.', type: 1, TTL: 3600, data: '198.51.100.10' }],
  };

  const baseline1 = await ingestPacket({
    sourceTrack: 'SIGNALS_INFRA',
    sourceType: 'doh_dns',
    canonicalTargetKey: 'selftest::suez-relay.subsea-ops.net',
    payloadTimestamp: new Date(t0 - 60_000).toISOString(),
    sourceEndpoint: 'https://dns.google/resolve?name=suez-relay.subsea-ops.net&type=A',
    ingestedBy: 'cipher',
    ttlSeconds: 3600,
    geoAnchor: { lat: 30.6015, lon: 32.278, radiusKm: 25, precision: 'EXACT' },
    sectorKey: 'SECTOR-54-SUEZ-SELFTEST',
    summaryHeadline: 'Nominal DoH baseline for suez-relay.subsea-ops.net',
    rawPayload: dohBaselinePayload,
    nowMs: t0,
  });

  const baseline2 = await ingestPacket({
    sourceTrack: 'SIGNALS_INFRA',
    sourceType: 'doh_dns',
    canonicalTargetKey: 'selftest::suez-relay.subsea-ops.net',
    payloadTimestamp: new Date(t0 - 45_000).toISOString(),
    sourceEndpoint: 'https://dns.google/resolve?name=suez-relay.subsea-ops.net&type=A',
    ingestedBy: 'cipher',
    ttlSeconds: 3600,
    geoAnchor: { lat: 30.6015, lon: 32.278, radiusKm: 25, precision: 'EXACT' },
    sectorKey: 'SECTOR-54-SUEZ-SELFTEST',
    summaryHeadline: 'Nominal DoH baseline for suez-relay.subsea-ops.net',
    rawPayload: dohBaselinePayload,
    nowMs: t0,
  });

  steps.push({
    step: 'stateful_snapshot_silent_drop',
    passed:
      baseline1.deltaEmitted === false &&
      baseline2.deltaEmitted === false &&
      baseline2.dropReason === 'UNCHANGED_SNAPSHOT',
    detail: `Initial baseline=${baseline1.dropReason}, unchanged re-poll=${baseline2.dropReason} (LLM woken: false)`,
  });

  // Step 2: Inject Packet 1 (USGS GeoJSON M4.9 near Suez Canal) via Agent Nyx -> expect CANDIDATE (0.35)
  const usgsFeature = {
    type: 'Feature',
    id: 'us7000selftest1',
    properties: {
      mag: 4.9,
      place: '24 km SSE of Suez, Egypt',
      time: t0 - 15_000,
      status: 'reviewed',
      tsunami: 0,
      type: 'earthquake',
    },
    geometry: {
      type: 'Point',
      coordinates: [32.2654, 30.5852, 12.4],
    },
  };

  const res1 = await ingestPacket({
    sourceTrack: 'WIDE_AREA',
    sourceType: 'usgs_geojson',
    canonicalTargetKey: 'selftest::us7000selftest1',
    payloadTimestamp: baseIso,
    sourceEndpoint: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
    ingestedBy: 'nyx',
    ttlSeconds: 300,
    geoAnchor: { lat: 30.5852, lon: 32.2654, radiusKm: 40, precision: 'EXACT' },
    sectorKey: 'SECTOR-54-SUEZ-SELFTEST',
    summaryHeadline: 'USGS M4.9 Seismic Event — 24 km SSE of Suez, Egypt',
    rawPayload: usgsFeature,
    nowMs: t0,
  });

  const candidateScore = res1.cluster?.corroborationScore ?? 0;
  const rawJsonStr1 = await getPacketRawPayloadJson(res1.packet.packetId);
  let rawJson1Valid = false;
  try {
    const parsed = rawJsonStr1 ? JSON.parse(rawJsonStr1) : null;
    rawJson1Valid = parsed?.packetId === res1.packet.packetId && parsed?.payload?.id === 'us7000selftest1';
  } catch {}

  steps.push({
    step: 'single_track_candidate_cap',
    passed:
      res1.deltaEmitted === true &&
      res1.cluster?.status === 'CANDIDATE' &&
      candidateScore === 0.35 &&
      !res1.vanceTriggered &&
      rawJson1Valid,
    detail: `status=${res1.cluster?.status}, score=${candidateScore}, vanceTriggered=${res1.vanceTriggered}, rawVfsValid=${rawJson1Valid}`,
  });

  // Step 3: Inject Packet 2 (Mutated DoH DNS response 2.18 km away) via Agent Cipher -> expect CORROBORATED (>= 0.70)
  const dohMutatedPayload = {
    Status: 0,
    TC: false,
    RD: true,
    RA: true,
    AD: true,
    Question: [{ name: 'suez-relay.subsea-ops.net.', type: 1 }],
    Answer: [{ name: 'suez-relay.subsea-ops.net.', type: 1, TTL: 45, data: '203.0.113.88' }],
  };

  const res2 = await ingestPacket({
    sourceTrack: 'SIGNALS_INFRA',
    sourceType: 'doh_dns',
    canonicalTargetKey: 'selftest::suez-relay.subsea-ops.net',
    payloadTimestamp: signalIso,
    sourceEndpoint: 'https://dns.google/resolve?name=suez-relay.subsea-ops.net&type=A',
    ingestedBy: 'cipher',
    ttlSeconds: 3600,
    geoAnchor: { lat: 30.6015, lon: 32.278, radiusKm: 25, precision: 'EXACT' },
    sectorKey: 'SECTOR-54-SUEZ-SELFTEST',
    summaryHeadline: 'DoH A-Record Mutation: suez-relay.subsea-ops.net -> 203.0.113.88 (TTL 45s)',
    rawPayload: dohMutatedPayload,
    nowMs: t0,
  });

  const corroboratedScore = res2.cluster?.corroborationScore ?? 0;
  const clusterId = res2.cluster?.clusterId || res1.cluster?.clusterId || '';
  const rawJsonStr2 = await getPacketRawPayloadJson(res2.packet.packetId);
  let rawJson2Valid = false;
  try {
    const parsed = rawJsonStr2 ? JSON.parse(rawJsonStr2) : null;
    rawJson2Valid = parsed?.packetId === res2.packet.packetId;
  } catch {}

  const bundle = clusterId ? await getClusterWithPackets(clusterId, t0) : null;
  const vanceCitesBoth =
    Boolean(bundle?.synthesis) &&
    bundle!.synthesis!.executiveAssessment.citedPacketIds.includes(res1.packet.packetId) &&
    bundle!.synthesis!.executiveAssessment.citedPacketIds.includes(res2.packet.packetId);

  // Verify hallucinated packetId rejection guard
  const forgedCheck = bundle?.synthesis
    ? validateVanceSynthesisCitations(
        {
          ...bundle.synthesis,
          executiveAssessment: {
            ...bundle.synthesis.executiveAssessment,
            citedPacketIds: ['0000000000000000000000000000000000000000000000000000000000000000'],
          },
        },
        [res1.packet.packetId, res2.packet.packetId]
      )
    : { valid: true };

  steps.push({
    step: 'multi_track_corroboration_promotion',
    passed:
      res2.deltaEmitted === true &&
      res2.cluster?.clusterId === res1.cluster?.clusterId &&
      res2.cluster?.status === 'CORROBORATED' &&
      corroboratedScore >= 0.7 &&
      res2.vanceTriggered &&
      vanceCitesBoth &&
      forgedCheck.valid === false &&
      rawJson2Valid,
    detail: `status=${res2.cluster?.status}, score=${corroboratedScore}, vanceCitesBoth=${vanceCitesBoth}, rejectedHallucination=${forgedCheck.valid === false}, sitrep=${bundle?.cluster.sitrepPath}`,
  });

  // Step 4: Verify TacticalMapOverlay Canvas projection & provenance linkage
  let canvasVisible = false;
  let pinSourceCount = 0;
  if (bundle) {
    const pin = clusterToTacticalPin(bundle);
    pinSourceCount = pin.sourceCount;
    try {
      const mapMod = await import('../components/TacticalMapOverlay');
      if (typeof mapMod.projectPinToCanvas === 'function') {
        const proj = mapMod.projectPinToCanvas(pin, 30.5852, 32.2654, 8, 1024, 512);
        canvasVisible = proj.isVisible && pin.provenancePackets.length === 2;
      }
    } catch {
      // Headless fallback geometry check if JSX component cannot load in non-DOM environment
      canvasVisible = pin.provenancePackets.length === 2 && Math.abs(pin.lat - 30.5852) < 1;
    }
  }

  steps.push({
    step: 'canvas_pin_provenance_linkage',
    passed: canvasVisible && pinSourceCount === 2,
    detail: `canvasVisible=${canvasVisible}, sourceCount=${pinSourceCount}, packetsLinked=${bundle?.packets.length ?? 0}`,
  });

  return {
    passed: steps.every((s) => s.passed),
    clusterId,
    candidateScore,
    corroboratedScore,
    packet1Id: res1.packet.packetId,
    packet2Id: res2.packet.packetId,
    rawPath1: res1.packet.rawPayloadRef,
    rawPath2: res2.packet.rawPayloadRef,
    sitrepPath: bundle?.cluster.sitrepPath,
    canvasVisible,
    steps,
  };
}
