/**
 * Interactive Evidence Graph Service
 * (src/services/EvidenceGraphService.ts)
 *
 * Automatically extracts cyber, OSINT, and geopolitical indicators (IPs, domains,
 * ASNs, CVEs, threat actors, MITRE ATT&CK techniques, cryptographic hashes) from
 * VFS markdown dossiers into a local IndexedDB knowledge graph, exposing hidden
 * cross-investigation overlaps across separate missions.
 */

import {
  ledgerDb,
  type EvidenceEntityType,
  type EvidenceNodeDbEntry,
  type EvidenceEdgeDbEntry,
} from './CommandLedgerDb';

export type { EvidenceEntityType, EvidenceNodeDbEntry, EvidenceEdgeDbEntry };

export interface ExtractedEntityHit {
  type: Exclude<EvidenceEntityType, 'dossier'>;
  value: string;
  label: string;
  count: number;
  contextSnippet: string;
}

export interface EvidenceGraphSnapshot {
  nodes: EvidenceNodeDbEntry[];
  edges: EvidenceEdgeDbEntry[];
  crossInvestigationBridges: Array<{
    node: EvidenceNodeDbEntry;
    overlapCount: number;
    dossierPaths: string[];
    connectedEntities: string[];
  }>;
  stats: {
    totalEntities: number;
    totalDossiers: number;
    totalEdges: number;
    bridgeCount: number;
  };
}

export interface EntityNeighborhoodResult {
  centerNode: EvidenceNodeDbEntry | null;
  connectedDossiers: EvidenceNodeDbEntry[];
  coOccurringEntities: Array<{
    node: EvidenceNodeDbEntry;
    sharedDossiers: string[];
    weight: number;
  }>;
  edges: EvidenceEdgeDbEntry[];
}

const GRAPH_LS_NODES_KEY = 'pixelops_evidence_nodes_v1';
const GRAPH_LS_EDGES_KEY = 'pixelops_evidence_edges_v1';

const memoryNodes = new Map<string, EvidenceNodeDbEntry>();
const memoryEdges = new Map<string, EvidenceEdgeDbEntry>();
let fallbackHydrated = false;

function hydrateFallbackFromLocalStorage() {
  if (fallbackHydrated) return;
  fallbackHydrated = true;
  if (typeof localStorage === 'undefined') return;
  try {
    const rawN = localStorage.getItem(GRAPH_LS_NODES_KEY);
    if (rawN) {
      const parsed: EvidenceNodeDbEntry[] = JSON.parse(rawN);
      if (Array.isArray(parsed)) {
        for (const n of parsed) memoryNodes.set(n.id, n);
      }
    }
    const rawE = localStorage.getItem(GRAPH_LS_EDGES_KEY);
    if (rawE) {
      const parsed: EvidenceEdgeDbEntry[] = JSON.parse(rawE);
      if (Array.isArray(parsed)) {
        for (const e of parsed) memoryEdges.set(e.id, e);
      }
    }
  } catch {}
}

function persistFallbackToLocalStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      GRAPH_LS_NODES_KEY,
      JSON.stringify(Array.from(memoryNodes.values()).slice(0, 600))
    );
    localStorage.setItem(
      GRAPH_LS_EDGES_KEY,
      JSON.stringify(Array.from(memoryEdges.values()).slice(0, 1500))
    );
  } catch {}
}

function emitGraphUpdated() {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('pixelops:evidence_graph_updated'));
    } catch {}
  }
}

const KNOWN_THREAT_ACTORS: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: 'APT28 (Fancy Bear)', pattern: /\b(?:apt[-\s]?28|fancy\s+bear|forest\s+blizzard|sofacy)\b/gi },
  { canonical: 'APT29 (Cozy Bear)', pattern: /\b(?:apt[-\s]?29|cozy\s+bear|midnight\s+blizzard|nobelium)\b/gi },
  { canonical: 'APT41 (Winnti)', pattern: /\b(?:apt[-\s]?41|winnti|brass\s+typhoon|wicked\s+panda)\b/gi },
  { canonical: 'Volt Typhoon', pattern: /\bvolt\s+typhoon\b/gi },
  { canonical: 'Salt Typhoon', pattern: /\bsalt\s+typhoon\b/gi },
  { canonical: 'Flax Typhoon', pattern: /\bflax\s+typhoon\b/gi },
  { canonical: 'Sandworm Team', pattern: /\b(?:sandworm|seashell\s+blizzard|voodoo\s+bear|apt[-\s]?44)\b/gi },
  { canonical: 'Lazarus Group', pattern: /\b(?:lazarus\s+group|hidden\s+cobra|diamond\s+sleet|apt[-\s]?38)\b/gi },
  { canonical: 'Kimsuky (APT43)', pattern: /\b(?:kimsuky|apt[-\s]?43|emerald\s+sleet)\b/gi },
  { canonical: 'Charming Kitten (APT35)', pattern: /\b(?:charming\s+kitten|apt[-\s]?35|mint\s+sandstorm|phosphorus)\b/gi },
  { canonical: 'MuddyWater', pattern: /\b(?:muddywater|mango\s+sandstorm)\b/gi },
  { canonical: 'Kataib Hezbollah', pattern: /\bkataib\s+hezbollah\b/gi },
  { canonical: 'IRGC Cyber / Aerospace', pattern: /\b(?:irgc|islamic\s+revolutionary\s+guard\s+corps)\b/gi },
  { canonical: 'Houthi Maritime Network', pattern: /\b(?:houthi(?:s)?|ansar\s+allah)\b/gi },
  { canonical: 'LockBit Ransomware', pattern: /\blockbit(?:\s+3\.0)?\b/gi },
  { canonical: 'ALPHV / BlackCat', pattern: /\b(?:alphv|blackcat)\b/gi },
  { canonical: 'Scattered Spider', pattern: /\b(?:scattered\s+spider|octo\s+tempest|unc3944)\b/gi },
  { canonical: 'FIN7', pattern: /\bfin7\b/gi },
];

const IGNORED_DOMAINS = new Set([
  'localhost',
  'example.com',
  'example.org',
  'w3.org',
  'schema.org',
  'tinyurl.com',
  'r.jina.ai',
]);

const FILE_EXT_BLACKLIST = new Set([
  'md',
  'json',
  'csv',
  'txt',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'html',
  'py',
  'yml',
  'yaml',
  'pdf',
  'zip',
]);

const VALID_TLDS = new Set([
  'com',
  'org',
  'net',
  'gov',
  'mil',
  'edu',
  'int',
  'io',
  'ai',
  'co',
  'dev',
  'app',
  'cloud',
  'info',
  'biz',
  'xyz',
  'me',
  'sh',
  'ru',
  'ua',
  'ir',
  'cn',
  'tw',
  'kp',
  'il',
  'uk',
  'de',
  'fr',
  'nl',
  'ch',
  'se',
  'jp',
  'kr',
  'sg',
  'au',
  'ca',
  'br',
  'in',
  'tr',
  'sa',
  'ae',
]);

function isValidPublicIpv4(candidate: string): boolean {
  const parts = candidate.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (p.length > 1 && p.startsWith('0') ? NaN : Number(p)));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  // Filter loopback, unspecified, broadcast, link-local, documentation examples
  if (nums[0] === 0 || nums[0] === 127 || nums[0] >= 224) return false;
  if (nums[0] === 169 && nums[1] === 254) return false;
  return true;
}

function extractContextSnippet(text: string, matchIndex: number, matchLen: number): string {
  const start = Math.max(0, matchIndex - 55);
  const end = Math.min(text.length, matchIndex + matchLen + 65);
  return text
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministically extracts normalized cyber & intelligence entities from text/markdown.
 */
export function extractEntitiesFromText(rawText: string): ExtractedEntityHit[] {
  const text = String(rawText || '');
  if (!text.trim()) return [];

  const hits = new Map<string, ExtractedEntityHit>();

  const recordHit = (
    type: ExtractedEntityHit['type'],
    normalizedValue: string,
    label: string,
    idx: number,
    len: number
  ) => {
    const key = `${type}:${normalizedValue}`;
    const existing = hits.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      hits.set(key, {
        type,
        value: normalizedValue,
        label,
        count: 1,
        contextSnippet: extractContextSnippet(text, idx, len),
      });
    }
  };

  // 1. CVEs (e.g. CVE-2024-3094)
  const cveRe = /\bCVE-\d{4}-\d{4,7}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = cveRe.exec(text)) !== null) {
    const norm = m[0].toUpperCase();
    recordHit('cve', norm, norm, m.index, m[0].length);
  }

  // 2. ASNs (e.g. AS13335, ASN 44907)
  const asnRe = /\bASN?[-\s]?(\d{2,10})\b/gi;
  while ((m = asnRe.exec(text)) !== null) {
    const num = Number(m[1]);
    if (num >= 10 && num <= 4294967295) {
      const norm = `AS${num}`;
      recordHit('asn', norm, norm, m.index, m[0].length);
    }
  }

  // 3. IPv4 Addresses (with optional CIDR)
  const ipRe = /\b(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?\b/g;
  while ((m = ipRe.exec(text)) !== null) {
    const ip = m[1];
    const cidr = m[2];
    // Avoid matching version strings preceded by 'v' (e.g., v1.2.3.4)
    if (m.index > 0 && /[vV.]/.test(text[m.index - 1])) continue;
    if (!isValidPublicIpv4(ip)) continue;
    const cidrValid = cidr !== undefined && Number(cidr) >= 8 && Number(cidr) <= 32;
    const norm = cidrValid ? `${ip}/${cidr}` : ip;
    recordHit('ip', norm, norm, m.index, m[0].length);
  }

  // 4. MITRE ATT&CK Techniques (e.g. T1059, T1566.001)
  const mitreRe = /\bT1\d{3}(?:\.\d{3})?\b/g;
  while ((m = mitreRe.exec(text)) !== null) {
    const norm = m[0].toUpperCase();
    recordHit('mitre', norm, `MITRE ${norm}`, m.index, m[0].length);
  }

  // 5. Cryptographic SHA-256 Hashes (64-hex, excluding 0x ledger hashes)
  const sha256Re = /\b(?![0-9]+$)[a-fA-F0-9]{64}\b/g;
  while ((m = sha256Re.exec(text)) !== null) {
    if (m.index >= 2 && text.slice(m.index - 2, m.index).toLowerCase() === '0x') continue;
    const norm = m[0].toLowerCase();
    recordHit('hash', norm, `SHA256:${norm.slice(0, 12)}…`, m.index, m[0].length);
  }

  // 6. Domains / FQDNs
  const domainRe = /\b(?:https?:\/\/)?((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+([a-zA-Z]{2,12}))\b/g;
  while ((m = domainRe.exec(text)) !== null) {
    const rawDomain = m[1].toLowerCase().replace(/^www\./, '');
    const tld = m[2].toLowerCase();
    if (FILE_EXT_BLACKLIST.has(tld) || !VALID_TLDS.has(tld)) continue;
    if (IGNORED_DOMAINS.has(rawDomain)) continue;
    if (rawDomain.length < 4 || rawDomain.split('.').some((part) => /^\d+$/.test(part))) continue;
    recordHit('domain', rawDomain, rawDomain, m.index, m[0].length);
  }

  // 7. Known Threat Actors & Explicit APT / Group Designations
  for (const actor of KNOWN_THREAT_ACTORS) {
    actor.pattern.lastIndex = 0;
    const match = actor.pattern.exec(text);
    if (match) {
      const slug = actor.canonical.toLowerCase();
      recordHit('threat_actor', slug, actor.canonical, match.index, match[0].length);
    }
  }

  // Generic APT / UNC / DEV cluster identifiers not covered above (e.g. APT33, UNC2452)
  const genericClusterRe = /\b((?:APT|UNC|FIN|TA)\s?-?\s?\d{2,4})\b/gi;
  while ((m = genericClusterRe.exec(text)) !== null) {
    const code = m[1].toUpperCase().replace(/[\s-]+/g, '');
    const alreadyCovered = Array.from(hits.values()).some(
      (h) => h.type === 'threat_actor' && h.label.toUpperCase().includes(code)
    );
    if (!alreadyCovered) {
      recordHit('threat_actor', code.toLowerCase(), code, m.index, m[0].length);
    }
  }

  return Array.from(hits.values());
}

async function readAllNodesRaw(): Promise<Map<string, EvidenceNodeDbEntry>> {
  hydrateFallbackFromLocalStorage();
  try {
    if (ledgerDb && ledgerDb.evidence_nodes) {
      const rows = await ledgerDb.evidence_nodes.toArray();
      if (rows.length > 0 || memoryNodes.size === 0) {
        const map = new Map<string, EvidenceNodeDbEntry>();
        for (const r of rows) map.set(r.id, r);
        return map;
      }
    }
  } catch {}
  return new Map(memoryNodes);
}

async function readAllEdgesRaw(): Promise<Map<string, EvidenceEdgeDbEntry>> {
  hydrateFallbackFromLocalStorage();
  try {
    if (ledgerDb && ledgerDb.evidence_edges) {
      const rows = await ledgerDb.evidence_edges.toArray();
      if (rows.length > 0 || memoryEdges.size === 0) {
        const map = new Map<string, EvidenceEdgeDbEntry>();
        for (const r of rows) map.set(r.id, r);
        return map;
      }
    }
  } catch {}
  return new Map(memoryEdges);
}

async function saveNodesAndEdges(
  nodes: EvidenceNodeDbEntry[],
  edges: EvidenceEdgeDbEntry[],
  deletedNodeIds: string[] = [],
  deletedEdgeIds: string[] = []
): Promise<void> {
  hydrateFallbackFromLocalStorage();

  for (const id of deletedNodeIds) memoryNodes.delete(id);
  for (const id of deletedEdgeIds) memoryEdges.delete(id);
  for (const n of nodes) memoryNodes.set(n.id, n);
  for (const e of edges) memoryEdges.set(e.id, e);
  persistFallbackToLocalStorage();

  try {
    if (ledgerDb && ledgerDb.evidence_nodes && ledgerDb.evidence_edges) {
      if (deletedNodeIds.length > 0) await ledgerDb.evidence_nodes.bulkDelete(deletedNodeIds);
      if (deletedEdgeIds.length > 0) await ledgerDb.evidence_edges.bulkDelete(deletedEdgeIds);
      if (nodes.length > 0) await ledgerDb.evidence_nodes.bulkPut(nodes);
      if (edges.length > 0) await ledgerDb.evidence_edges.bulkPut(edges);
    }
  } catch {
    // Fallback already saved in memory + localStorage
  }

  emitGraphUpdated();
}

function extractDossierTitle(content: string, normPath: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h1) return h1.slice(0, 72);
  const base = normPath.split('/').pop() || normPath;
  return base.replace(/\.md$/i, '').replace(/[_-]+/g, ' ');
}

/**
 * Indexes a single VFS dossier into the local knowledge graph, updating entity nodes,
 * `MENTIONED_IN` edges, and `CO_OCCURS_WITH` entity-to-entity links.
 */
export async function indexDossierIntoEvidenceGraph(
  rawPath: string,
  content: string
): Promise<{ extractedCount: number; bridgeEntities: string[] }> {
  const normPath = String(rawPath || '').trim().replace(/^\/+/, '');
  if (!normPath || !content) return { extractedCount: 0, bridgeEntities: [] };

  const entities = extractEntitiesFromText(content);
  const nowIso = new Date().toISOString();
  const dossierId = `dossier:${normPath}`;

  const [nodesMap, edgesMap] = await Promise.all([readAllNodesRaw(), readAllEdgesRaw()]);

  // Remove old edges originating from this specific file before re-indexing
  const staleEdgeIds: string[] = [];
  for (const [edgeId, edge] of edgesMap.entries()) {
    if (edge.filePath === normPath) {
      staleEdgeIds.push(edgeId);
      edgesMap.delete(edgeId);
    }
  }

  if (entities.length === 0) {
    if (staleEdgeIds.length > 0) {
      await saveNodesAndEdges([], [], [dossierId], staleEdgeIds);
    }
    return { extractedCount: 0, bridgeEntities: [] };
  }

  const upsertedNodes: EvidenceNodeDbEntry[] = [];
  const upsertedEdges: EvidenceEdgeDbEntry[] = [];
  const bridgeEntities: string[] = [];

  const dossierTitle = extractDossierTitle(content, normPath);
  const existingDossier = nodesMap.get(dossierId);
  const dossierNode: EvidenceNodeDbEntry = {
    id: dossierId,
    type: 'dossier',
    label: dossierTitle,
    value: normPath,
    dossierPaths: [normPath],
    hitCount: entities.reduce((acc, e) => acc + e.count, 0),
    firstSeenAt: existingDossier?.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    metadata: { entityCount: entities.length },
  };
  upsertedNodes.push(dossierNode);

  const entityNodeIds: string[] = [];

  for (const hit of entities) {
    const nodeId = `${hit.type}:${hit.value}`;
    entityNodeIds.push(nodeId);
    const prev = nodesMap.get(nodeId);
    const mergedPaths = Array.from(new Set([...(prev?.dossierPaths || []), normPath]));
    if (mergedPaths.length >= 2) {
      bridgeEntities.push(hit.label);
    }

    const entityNode: EvidenceNodeDbEntry = {
      id: nodeId,
      type: hit.type,
      label: hit.label,
      value: hit.value,
      dossierPaths: mergedPaths,
      hitCount: (prev?.hitCount || 0) + hit.count,
      firstSeenAt: prev?.firstSeenAt || nowIso,
      lastSeenAt: nowIso,
      metadata: {
        overlapCount: mergedPaths.length,
      },
    };
    nodesMap.set(nodeId, entityNode);
    upsertedNodes.push(entityNode);

    const mentionEdgeId = `${nodeId}->${dossierId}:MENTIONED_IN`;
    upsertedEdges.push({
      id: mentionEdgeId,
      sourceId: nodeId,
      targetId: dossierId,
      relation: 'MENTIONED_IN',
      filePath: normPath,
      weight: hit.count,
      contextSnippet: hit.contextSnippet,
      updatedAt: nowIso,
    });
  }

  // Build bounded co-occurrence edges among the top high-signal entities in the same dossier
  const topEntitiesForCoOccurrence = entities
    .slice()
    .sort((a, b) => {
      const priority = (t: string) =>
        t === 'cve' || t === 'threat_actor' || t === 'ip' || t === 'asn' ? 2 : 1;
      return priority(b.type) * 10 + b.count - (priority(a.type) * 10 + a.count);
    })
    .slice(0, 12);

  for (let i = 0; i < topEntitiesForCoOccurrence.length; i++) {
    for (let j = i + 1; j < topEntitiesForCoOccurrence.length; j++) {
      const a = `${topEntitiesForCoOccurrence[i].type}:${topEntitiesForCoOccurrence[i].value}`;
      const b = `${topEntitiesForCoOccurrence[j].type}:${topEntitiesForCoOccurrence[j].value}`;
      const [src, dst] = a < b ? [a, b] : [b, a];
      const coEdgeId = `${src}<->${dst}@${normPath}`;
      upsertedEdges.push({
        id: coEdgeId,
        sourceId: src,
        targetId: dst,
        relation: 'CO_OCCURS_WITH',
        filePath: normPath,
        weight: 1,
        updatedAt: nowIso,
      });
    }
  }

  await saveNodesAndEdges(upsertedNodes, upsertedEdges, [], staleEdgeIds);
  return { extractedCount: entities.length, bridgeEntities };
}

/**
 * Prunes a deleted VFS file and any orphaned entity references from the knowledge graph.
 */
export async function removeDossierFromEvidenceGraph(rawPath: string): Promise<void> {
  const normPath = String(rawPath || '').trim().replace(/^\/+/, '');
  if (!normPath) return;

  const [nodesMap, edgesMap] = await Promise.all([readAllNodesRaw(), readAllEdgesRaw()]);
  const dossierId = `dossier:${normPath}`;
  const deletedNodeIds: string[] = nodesMap.has(dossierId) ? [dossierId] : [];
  const deletedEdgeIds: string[] = [];
  const updatedNodes: EvidenceNodeDbEntry[] = [];

  for (const [edgeId, edge] of edgesMap.entries()) {
    if (edge.filePath === normPath || edge.targetId === dossierId || edge.sourceId === dossierId) {
      deletedEdgeIds.push(edgeId);
    }
  }

  for (const [nodeId, node] of nodesMap.entries()) {
    if (node.type === 'dossier') continue;
    if (node.dossierPaths.includes(normPath)) {
      const remaining = node.dossierPaths.filter((p) => p !== normPath);
      if (remaining.length === 0) {
        deletedNodeIds.push(nodeId);
      } else {
        updatedNodes.push({
          ...node,
          dossierPaths: remaining,
          metadata: { ...(node.metadata || {}), overlapCount: remaining.length },
        });
      }
    }
  }

  if (deletedNodeIds.length > 0 || deletedEdgeIds.length > 0 || updatedNodes.length > 0) {
    await saveNodesAndEdges(updatedNodes, [], deletedNodeIds, deletedEdgeIds);
  }
}

/**
 * Scans all workspace VFS markdown files and synchronizes the full knowledge graph.
 */
export async function syncEvidenceGraphFromVFS(): Promise<EvidenceGraphSnapshot> {
  const { listWorkspaceFiles } = await import('../engine/storageManager');
  const files = await listWorkspaceFiles();
  for (const file of files) {
    if (!file.content) continue;
    if (
      file.path.endsWith('.md') ||
      file.path.startsWith('intel/') ||
      file.path.startsWith('reports/') ||
      file.format === 'markdown'
    ) {
      await indexDossierIntoEvidenceGraph(file.path, file.content);
    }
  }
  return getEvidenceGraphSnapshot();
}

/**
 * Returns the complete Evidence Graph snapshot, ranked cross-investigation bridge nodes, and summary stats.
 */
export async function getEvidenceGraphSnapshot(): Promise<EvidenceGraphSnapshot> {
  const [nodesMap, edgesMap] = await Promise.all([readAllNodesRaw(), readAllEdgesRaw()]);
  const nodes = Array.from(nodesMap.values());
  const edges = Array.from(edgesMap.values());

  const entityNodes = nodes.filter((n) => n.type !== 'dossier');
  const dossierNodes = nodes.filter((n) => n.type === 'dossier');

  // Compute connected entity labels per node for instant cross-investigation inspection
  const neighborEntityMap = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.relation === 'CO_OCCURS_WITH') {
      const aNode = nodesMap.get(edge.sourceId);
      const bNode = nodesMap.get(edge.targetId);
      if (aNode && bNode) {
        if (!neighborEntityMap.has(aNode.id)) neighborEntityMap.set(aNode.id, new Set());
        if (!neighborEntityMap.has(bNode.id)) neighborEntityMap.set(bNode.id, new Set());
        neighborEntityMap.get(aNode.id)!.add(bNode.label);
        neighborEntityMap.get(bNode.id)!.add(aNode.label);
      }
    }
  }

  const crossInvestigationBridges = entityNodes
    .filter((n) => n.dossierPaths.length >= 2)
    .map((node) => ({
      node,
      overlapCount: node.dossierPaths.length,
      dossierPaths: node.dossierPaths,
      connectedEntities: Array.from(neighborEntityMap.get(node.id) || []).slice(0, 8),
    }))
    .sort((a, b) => b.overlapCount - a.overlapCount || b.node.hitCount - a.node.hitCount);

  return {
    nodes,
    edges,
    crossInvestigationBridges,
    stats: {
      totalEntities: entityNodes.length,
      totalDossiers: dossierNodes.length,
      totalEdges: edges.length,
      bridgeCount: crossInvestigationBridges.length,
    },
  };
}

/**
 * Queries 1-hop and 2-hop investigation overlaps for a specific entity ID or search term (e.g. ASN, domain, IP, CVE).
 */
export async function queryEntityNeighborhood(queryOrId: string): Promise<EntityNeighborhoodResult> {
  const q = String(queryOrId || '').trim().toLowerCase();
  const [nodesMap, edgesMap] = await Promise.all([readAllNodesRaw(), readAllEdgesRaw()]);

  let centerNode: EvidenceNodeDbEntry | null = nodesMap.get(queryOrId) || null;
  if (!centerNode) {
    for (const n of nodesMap.values()) {
      if (
        n.id.toLowerCase() === q ||
        n.value.toLowerCase() === q ||
        n.label.toLowerCase() === q
      ) {
        centerNode = n;
        break;
      }
    }
  }
  if (!centerNode) {
    for (const n of nodesMap.values()) {
      if (n.value.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)) {
        centerNode = n;
        break;
      }
    }
  }

  if (!centerNode) {
    return { centerNode: null, connectedDossiers: [], coOccurringEntities: [], edges: [] };
  }

  const relatedEdges: EvidenceEdgeDbEntry[] = [];
  const connectedDossierSet = new Set<string>(centerNode.dossierPaths.map((p) => `dossier:${p}`));
  const coMap = new Map<string, { node: EvidenceNodeDbEntry; shared: Set<string>; weight: number }>();

  for (const edge of edgesMap.values()) {
    if (edge.sourceId === centerNode.id || edge.targetId === centerNode.id) {
      relatedEdges.push(edge);
      const otherId = edge.sourceId === centerNode.id ? edge.targetId : edge.sourceId;
      const otherNode = nodesMap.get(otherId);
      if (!otherNode) continue;
      if (otherNode.type === 'dossier') {
        connectedDossierSet.add(otherNode.id);
      } else {
        const entry = coMap.get(otherNode.id) || {
          node: otherNode,
          shared: new Set<string>(),
          weight: 0,
        };
        entry.shared.add(edge.filePath);
        entry.weight += edge.weight;
        coMap.set(otherNode.id, entry);
      }
    }
  }

  // Also discover 2-hop entities sharing any of the same dossiers even if not in top-12 co-occurrence clique
  for (const n of nodesMap.values()) {
    if (n.id === centerNode.id || n.type === 'dossier') continue;
    const sharedFiles = n.dossierPaths.filter((p) => centerNode!.dossierPaths.includes(p));
    if (sharedFiles.length > 0 && !coMap.has(n.id)) {
      coMap.set(n.id, {
        node: n,
        shared: new Set(sharedFiles),
        weight: sharedFiles.length,
      });
    }
  }

  const connectedDossiers = Array.from(connectedDossierSet)
    .map((id) => nodesMap.get(id))
    .filter((n): n is EvidenceNodeDbEntry => Boolean(n));

  const coOccurringEntities = Array.from(coMap.values())
    .map((x) => ({
      node: x.node,
      sharedDossiers: Array.from(x.shared),
      weight: x.weight,
    }))
    .sort((a, b) => b.sharedDossiers.length - a.sharedDossiers.length || b.weight - a.weight);

  return {
    centerNode,
    connectedDossiers,
    coOccurringEntities,
    edges: relatedEdges,
  };
}

export async function clearEvidenceGraph(): Promise<void> {
  memoryNodes.clear();
  memoryEdges.clear();
  persistFallbackToLocalStorage();
  try {
    if (ledgerDb && ledgerDb.evidence_nodes && ledgerDb.evidence_edges) {
      await ledgerDb.evidence_nodes.clear();
      await ledgerDb.evidence_edges.clear();
    }
  } catch {}
  emitGraphUpdated();
}
