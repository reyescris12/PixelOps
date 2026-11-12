/**
 * Deterministic Tripwire Diffing Service
 * (src/services/TripwireDiffService.ts)
 *
 * Stateful watchlists that hash canonicalized snapshots of DNS records, Certificate
 * Transparency logs, USGS seismic feeds, maritime chokepoints, and web/ISW endpoints
 * locally with SHA-256. Triggers human-in-the-loop approval gates and push alerts
 * strictly when a verified cryptographic data delta occurs—eliminating LLM hallucination noise.
 */

import {
  ledgerDb,
  type TripwireWatchDbEntry,
  type TripwireAlertDbEntry,
} from './CommandLedgerDb';

export type { TripwireWatchDbEntry, TripwireAlertDbEntry };

export interface TripwireEvaluationResult {
  watch: TripwireWatchDbEntry;
  outcome: 'baseline_established' | 'unchanged' | 'delta_detected' | 'error';
  sha256?: string;
  previousSha256?: string;
  addedItems: string[];
  removedItems: string[];
  alert?: TripwireAlertDbEntry;
  error?: string;
}

const WATCHES_LS_KEY = 'pixelops_tripwire_watches_v1';
const ALERTS_LS_KEY = 'pixelops_tripwire_alerts_v1';

const memoryWatches = new Map<string, TripwireWatchDbEntry>();
const memoryAlerts = new Map<string, TripwireAlertDbEntry>();
let tripwireHydrated = false;
let backgroundIntervalHandle: ReturnType<typeof setInterval> | null = null;

function hydrateTripwireFallback() {
  if (tripwireHydrated) return;
  tripwireHydrated = true;
  if (typeof localStorage === 'undefined') return;
  try {
    const rawW = localStorage.getItem(WATCHES_LS_KEY);
    if (rawW) {
      const list: TripwireWatchDbEntry[] = JSON.parse(rawW);
      if (Array.isArray(list)) {
        for (const w of list) memoryWatches.set(w.id, w);
      }
    }
    const rawA = localStorage.getItem(ALERTS_LS_KEY);
    if (rawA) {
      const list: TripwireAlertDbEntry[] = JSON.parse(rawA);
      if (Array.isArray(list)) {
        for (const a of list) memoryAlerts.set(a.id, a);
      }
    }
  } catch {}
}

function persistTripwireFallback() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WATCHES_LS_KEY, JSON.stringify(Array.from(memoryWatches.values())));
    localStorage.setItem(
      ALERTS_LS_KEY,
      JSON.stringify(Array.from(memoryAlerts.values()).slice(0, 120))
    );
  } catch {}
}

function emitTripwireUpdate(eventName = 'pixelops:tripwire_updated', detail?: any) {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch {}
  }
}

/**
 * Computes a deterministic lowercase hex SHA-256 digest over canonical snapshot lines.
 */
export async function computeCanonicalSha256(lines: string[]): Promise<string> {
  const canonicalPayload = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .sort()
    .join('\n');

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoded = new TextEncoder().encode(canonicalPayload);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Deterministic fallback hash only if WebCrypto subtle is absent
  let h1 = 0x811c9dc5;
  for (let i = 0; i < canonicalPayload.length; i++) {
    h1 ^= canonicalPayload.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(64, '0');
}

/**
 * Computes deterministic set-level line diffs (`addedItems` and `removedItems`) between two canonical snapshots.
 */
export function computeDeterministicSnapshotDiff(
  previousLines: string[],
  nextLines: string[]
): { addedItems: string[]; removedItems: string[] } {
  const prevSet = new Set(previousLines.map((s) => s.trim()).filter(Boolean));
  const nextSet = new Set(nextLines.map((s) => s.trim()).filter(Boolean));

  const addedItems: string[] = [];
  const removedItems: string[] = [];

  for (const item of Array.from(nextSet).sort()) {
    if (!prevSet.has(item)) addedItems.push(item);
  }
  for (const item of Array.from(prevSet).sort()) {
    if (!nextSet.has(item)) removedItems.push(item);
  }

  return { addedItems, removedItems };
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 8500): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches live telemetry for a watchlist item and normalizes it into sorted, TTL-free canonical strings.
 */
export async function collectCanonicalTelemetryLines(
  category: TripwireWatchDbEntry['category'],
  rawTarget: string
): Promise<string[]> {
  const target = String(rawTarget || '').trim();
  if (!target) throw new Error('Tripwire target is empty.');

  if (category === 'dns') {
    const domain = target
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .toLowerCase();
    const rrTypes: Array<{ name: string; code: number }> = [
      { name: 'A', code: 1 },
      { name: 'AAAA', code: 28 },
      { name: 'MX', code: 15 },
      { name: 'TXT', code: 16 },
      { name: 'NS', code: 2 },
    ];

    const settled = await Promise.allSettled(
      rrTypes.map((rr) =>
        fetchJsonWithTimeout(
          `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${rr.name}`,
          7000
        )
      )
    );

    const lines = new Set<string>();
    settled.forEach((res, idx) => {
      if (res.status === 'fulfilled' && Array.isArray(res.value?.Answer)) {
        for (const ans of res.value.Answer) {
          const data = String(ans?.data || '').trim().replace(/\.$/, '');
          if (data) {
            lines.add(`${rrTypes[idx].name} ${data}`);
          }
        }
      }
    });

    if (lines.size === 0) {
      lines.add(`NXDOMAIN_OR_EMPTY ${domain}`);
    }
    return Array.from(lines).sort();
  }

  if (category === 'ct_certs') {
    const domain = target
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .toLowerCase();
    const rows = await fetchJsonWithTimeout(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
      10000
    );
    const certs = new Set<string>();
    if (Array.isArray(rows)) {
      for (const row of rows.slice(0, 120)) {
        const cn = String(row?.common_name || '').toLowerCase().trim();
        const names = String(row?.name_value || '')
          .split('\n')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .sort()
          .join(',');
        const issuer = String(row?.issuer_ca_id ?? '');
        if (cn || names) {
          certs.add(`CERT cn=${cn} san=${names} ca=${issuer}`);
        }
        if (certs.size >= 60) break;
      }
    }
    if (certs.size === 0) certs.add(`NO_CERTS ${domain}`);
    return Array.from(certs).sort();
  }

  if (category === 'usgs_seismic') {
    const minMagMatch = target.match(/m\s*(\d+(?:\.\d+)?)/i);
    const minMag = minMagMatch ? parseFloat(minMagMatch[1]) : 4.5;
    const regionKeyword = target
      .replace(/m\s*\d+(?:\.\d+)?\+?/gi, '')
      .replace(/\b(global|all|worldwide)\b/gi, '')
      .trim()
      .toLowerCase();

    const data = await fetchJsonWithTimeout(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
      8500
    );
    const features = Array.isArray(data?.features) ? data.features : [];
    const events: string[] = [];

    for (const f of features) {
      const id = String(f?.id || '');
      const mag = Number(f?.properties?.mag ?? 0);
      const place = String(f?.properties?.place || '').trim();
      if (mag < minMag) continue;
      if (regionKeyword && !place.toLowerCase().includes(regionKeyword)) continue;
      events.push(`SEISMIC ${id} M${mag.toFixed(1)} ${place}`);
    }

    if (events.length === 0) {
      events.push(`NOMINAL_SEISMIC_BASELINE minMag=${minMag.toFixed(1)} region=${regionKeyword || 'global'}`);
    }
    return Array.from(new Set(events)).sort();
  }

  if (category === 'maritime_ais') {
    let payload: any = null;
    if (typeof window !== 'undefined' && /^https?:$/i.test(window.location?.protocol || '')) {
      payload = await fetchJsonWithTimeout('/api/osint/maritime', 6500).catch(() => null);
    }
    const lines: string[] = [];
    if (payload && Array.isArray(payload.chokepoints)) {
      for (const cp of payload.chokepoints) {
        if (
          target.toLowerCase() !== 'global' &&
          !String(cp.name || '').toLowerCase().includes(target.toLowerCase())
        ) {
          continue;
        }
        lines.push(
          `CHOKEPOINT ${cp.name} status=${cp.status || 'NOMINAL'} risk=${cp.riskLevel || 'LOW'}`
        );
      }
    }
    if (lines.length === 0) {
      lines.push(`MARITIME_WATCH target=${target.toLowerCase()} status=BASELINE_LOCKED`);
    }
    return Array.from(new Set(lines)).sort();
  }

  // `web_hash`: Structural headings + outbound links via Jina Reader
  const fullUrl = /^https?:\/\//i.test(target) ? target : `https://${target}`;
  const jinaJson = await fetchJsonWithTimeout(`https://r.jina.ai/${fullUrl}`, 10000);
  const content = String(jinaJson?.data?.content || jinaJson?.content || '');
  const structuralLines = new Set<string>();

  const headingRe = /^#{1,3}\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(content)) !== null) {
    const h = m[1].replace(/\s+/g, ' ').trim();
    if (h.length > 3 && h.length < 180) {
      structuralLines.add(`H: ${h}`);
    }
    if (structuralLines.size >= 50) break;
  }

  const linkRe = /\]\((https?:\/\/[^)\s"]+)/g;
  while ((m = linkRe.exec(content)) !== null) {
    structuralLines.add(`URL: ${m[1].replace(/\/+$/, '')}`);
    if (structuralLines.size >= 90) break;
  }

  if (structuralLines.size === 0) {
    structuralLines.add(`TITLE: ${String(jinaJson?.data?.title || fullUrl).trim()}`);
  }
  return Array.from(structuralLines).sort();
}

export async function listTripwireWatches(): Promise<TripwireWatchDbEntry[]> {
  hydrateTripwireFallback();
  try {
    if (ledgerDb && ledgerDb.tripwire_watches) {
      const rows = await ledgerDb.tripwire_watches.toArray();
      if (rows.length > 0 || memoryWatches.size === 0) {
        return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
    }
  } catch {}
  return Array.from(memoryWatches.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

export async function saveTripwireWatch(
  watch: Omit<
    TripwireWatchDbEntry,
    'createdAt' | 'updatedAt' | 'unchangedChecksCount' | 'deltaCount'
  > &
    Partial<
      Pick<
        TripwireWatchDbEntry,
        'createdAt' | 'updatedAt' | 'unchangedChecksCount' | 'deltaCount'
      >
    >
): Promise<TripwireWatchDbEntry> {
  hydrateTripwireFallback();
  const now = new Date().toISOString();
  const existing = memoryWatches.get(watch.id);
  const full: TripwireWatchDbEntry = {
    ...watch,
    unchangedChecksCount: watch.unchangedChecksCount ?? existing?.unchangedChecksCount ?? 0,
    deltaCount: watch.deltaCount ?? existing?.deltaCount ?? 0,
    createdAt: watch.createdAt || existing?.createdAt || now,
    updatedAt: now,
  };

  memoryWatches.set(full.id, full);
  persistTripwireFallback();

  try {
    if (ledgerDb && ledgerDb.tripwire_watches) {
      await ledgerDb.tripwire_watches.put(full);
    }
  } catch {}

  emitTripwireUpdate();
  return full;
}

export async function deleteTripwireWatch(watchId: string): Promise<void> {
  hydrateTripwireFallback();
  memoryWatches.delete(watchId);
  persistTripwireFallback();
  try {
    if (ledgerDb && ledgerDb.tripwire_watches) {
      await ledgerDb.tripwire_watches.delete(watchId);
    }
  } catch {}
  emitTripwireUpdate();
}

export async function listTripwireAlerts(): Promise<TripwireAlertDbEntry[]> {
  hydrateTripwireFallback();
  try {
    if (ledgerDb && ledgerDb.tripwire_alerts) {
      const rows = await ledgerDb.tripwire_alerts.toArray();
      if (rows.length > 0 || memoryAlerts.size === 0) {
        return rows.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
      }
    }
  } catch {}
  return Array.from(memoryAlerts.values()).sort((a, b) =>
    b.detectedAt.localeCompare(a.detectedAt)
  );
}

export async function updateTripwireAlertStatus(
  alertId: string,
  status: TripwireAlertDbEntry['status']
): Promise<TripwireAlertDbEntry | null> {
  hydrateTripwireFallback();
  const all = await listTripwireAlerts();
  const target = all.find((a) => a.id === alertId);
  if (!target) return null;

  const updated: TripwireAlertDbEntry = {
    ...target,
    status,
    resolvedAt: new Date().toISOString(),
  };

  memoryAlerts.set(updated.id, updated);
  persistTripwireFallback();

  try {
    if (ledgerDb && ledgerDb.tripwire_alerts) {
      await ledgerDb.tripwire_alerts.put(updated);
    }
  } catch {}

  emitTripwireUpdate();
  return updated;
}

/**
 * Evaluates a single stateful tripwire watch deterministically:
 * - First run locks SHA-256 baseline silently.
 * - Identical SHA-256 produces ZERO alert noise and ZERO LLM calls.
 * - Verified SHA-256 delta records exact `+ added` / `- removed` items and triggers a Human-in-the-Loop approval gate.
 */
export async function evaluateTripwireWatch(
  watch: TripwireWatchDbEntry,
  options?: { overrideLines?: string[] }
): Promise<TripwireEvaluationResult> {
  try {
    const canonicalLines = options?.overrideLines
      ? options.overrideLines.map((l) => l.trim()).filter(Boolean).sort()
      : await collectCanonicalTelemetryLines(watch.category, watch.target);

    const nextHash = await computeCanonicalSha256(canonicalLines);
    const serializedSnapshot = JSON.stringify(canonicalLines);
    const nowIso = new Date().toISOString();

    // Case 1: Initial Baseline Lock (Zero Alert Noise)
    if (!watch.lastSha256) {
      const baselined = await saveTripwireWatch({
        ...watch,
        lastSha256: nextHash,
        lastNormalizedSnapshot: serializedSnapshot,
        lastCheckedAt: nowIso,
      });
      return {
        watch: baselined,
        outcome: 'baseline_established',
        sha256: nextHash,
        addedItems: [],
        removedItems: [],
      };
    }

    // Case 2: Identical SHA-256 Hash -> Zero Noise, Zero Hallucinations
    if (watch.lastSha256 === nextHash) {
      const unchanged = await saveTripwireWatch({
        ...watch,
        lastCheckedAt: nowIso,
        unchangedChecksCount: (watch.unchangedChecksCount || 0) + 1,
      });
      return {
        watch: unchanged,
        outcome: 'unchanged',
        sha256: nextHash,
        previousSha256: watch.lastSha256,
        addedItems: [],
        removedItems: [],
      };
    }

    // Case 3: Verified Cryptographic Delta!
    let prevLines: string[] = [];
    if (watch.lastNormalizedSnapshot) {
      try {
        prevLines = JSON.parse(watch.lastNormalizedSnapshot);
      } catch {}
    }

    const { addedItems, removedItems } = computeDeterministicSnapshotDiff(
      prevLines,
      canonicalLines
    );

    const updatedWatch = await saveTripwireWatch({
      ...watch,
      lastSha256: nextHash,
      lastNormalizedSnapshot: serializedSnapshot,
      lastCheckedAt: nowIso,
      deltaCount: (watch.deltaCount || 0) + 1,
    });

    const diffSummary = `SHA-256 delta on ${watch.label} (${watch.target}): +${addedItems.length} added, -${removedItems.length} removed [${watch.lastSha256.slice(0, 8)} -> ${nextHash.slice(0, 8)}]`;
    const sampleDelta = [
      ...addedItems.slice(0, 4).map((x) => `+ ${x}`),
      ...removedItems.slice(0, 4).map((x) => `- ${x}`),
    ].join('; ');

    const recommendedDirective = `Investigate verified ${watch.category.toUpperCase()} tripwire delta on "${watch.target}" (${diffSummary}). Observed state changes: ${sampleDelta || 'structural hash shift'}. Correlate risk impact and file a SITREP dossier to Workspace Files.`;

    const alert: TripwireAlertDbEntry = {
      id: `tw_alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      watchId: watch.id,
      watchLabel: watch.label,
      category: watch.category,
      target: watch.target,
      previousHash: watch.lastSha256,
      newHash: nextHash,
      addedItems: addedItems.slice(0, 25),
      removedItems: removedItems.slice(0, 25),
      diffSummary,
      recommendedDirective,
      assignedAgentId: watch.assignedAgentId || 'nyx',
      assignedRoom: watch.assignedRoom || 'comms_tower',
      status: watch.requireHumanApproval ? 'pending_approval' : 'acknowledged',
      detectedAt: nowIso,
    };

    hydrateTripwireFallback();
    memoryAlerts.set(alert.id, alert);
    persistTripwireFallback();
    try {
      if (ledgerDb && ledgerDb.tripwire_alerts) {
        await ledgerDb.tripwire_alerts.put(alert);
      }
    } catch {}

    emitTripwireUpdate('pixelops:tripwire_delta_detected', alert);
    emitTripwireUpdate();

    // Optional browser notification strictly on verified cryptographic delta
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification(`PIXELOPS TRIPWIRE DELTA · ${watch.label}`, {
          body: diffSummary,
        });
      } catch {}
    }

    return {
      watch: updatedWatch,
      outcome: 'delta_detected',
      sha256: nextHash,
      previousSha256: watch.lastSha256,
      addedItems,
      removedItems,
      alert,
    };
  } catch (err: any) {
    return {
      watch,
      outcome: 'error',
      addedItems: [],
      removedItems: [],
      error: err?.message || 'Tripwire telemetry fetch failed',
    };
  }
}

/**
 * Evaluates all enabled tripwire watches that are due based on `intervalMinutes` (or all if `forceAll` is true).
 */
export async function runDueTripwireChecks(options?: {
  forceAll?: boolean;
}): Promise<TripwireEvaluationResult[]> {
  const watches = (await listTripwireWatches()).filter((w) => w.enabled);
  const nowMs = Date.now();
  const due = watches.filter((w) => {
    if (options?.forceAll || !w.lastCheckedAt) return true;
    const elapsedMs = nowMs - new Date(w.lastCheckedAt).getTime();
    return elapsedMs >= Math.max(1, w.intervalMinutes) * 60 * 1000;
  });

  const results: TripwireEvaluationResult[] = [];
  for (const w of due) {
    const res = await evaluateTripwireWatch(w);
    results.push(res);
  }
  return results;
}

/**
 * Starts the lightweight background deterministic tripwire daemon in browser sessions.
 */
export function initTripwireBackgroundScheduler(): void {
  if (typeof window === 'undefined' || backgroundIntervalHandle !== null) return;
  backgroundIntervalHandle = setInterval(() => {
    runDueTripwireChecks().catch(() => {});
  }, 3 * 60 * 1000);
}
