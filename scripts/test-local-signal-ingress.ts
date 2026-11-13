/**
 * Verification Suite: Real-Time Signal Ingress, Geofenced Local Recon & Dispatch Triage
 * Usage: npx tsx scripts/test-local-signal-ingress.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const createStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  };
};

const g = globalThis as any;
g.localStorage ??= createStore();
g.sessionStorage ??= createStore();
g.window ??= g;
g.dispatchEvent ??= () => true;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.CustomEvent ??= class {
  constructor(public type: string, public detail?: any) {}
};

let failures = 0;
function check(cond: unknown, msg: string) {
  if (cond) {
    console.log(`PASS: ${msg}`);
  } else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

async function main() {
  const {
    saveLocalGeofenceConfig,
    getLocalGeofenceConfig,
    filterItemsWithinGeofence,
  } = await import('../src/services/OsintToolsService');
  const { parseLocalDispatchRssOrJson } = await import('../src/services/ClassifiedFeedService');
  const {
    FREQUENCY_MS,
    isHighAlertModeEnabled,
    setHighAlertMode,
    getEffectiveRapidPollIntervalMs,
  } = await import('../src/services/NightShiftService');
  const {
    buildLocalDispatchTriagePrompt,
    analyzeDispatchSignal,
  } = await import('../src/services/DispatchTriageService');
  const { executeCLICommand } = await import('../src/engine/pixelOpsCLI');
  const { getCorroborationStatusSummary } = await import('../src/services/CorroborationEngine');

  console.log('=== 1. Extensionless Import Guardrail ===');
  const files = [
    'src/services/OsintToolsService.ts',
    'src/services/ClassifiedFeedService.ts',
    'src/services/NightShiftService.ts',
    'src/services/WorkerService.ts',
    'src/services/DispatchTriageService.ts',
    'src/engine/pixelOpsCLI.ts',
    'src/components/ThreatMonitorModal.tsx',
  ];
  const extImportRe = /(?:from\s+|import\s*\()\s*['"](\.[^'"]+\.(?:ts|tsx|js|jsx))['"]/g;
  for (const rel of files) {
    const content = readFileSync(resolve(process.cwd(), rel), 'utf-8');
    const matches = [...content.matchAll(extImportRe)].map((m) => m[1]);
    check(matches.length === 0, `${rel} uses strictly extensionless relative imports`);
  }

  console.log('\n=== 2. Local Geofencing & 25km Bounding Verification ===');
  const saved = saveLocalGeofenceConfig({
    lat: 38.8977,
    lon: -77.0365,
    radiusKm: 25,
    label: 'NCR-LOCAL',
  });
  const loaded = getLocalGeofenceConfig();
  check(
    saved.lat === 38.8977 && loaded.lon === -77.0365 && loaded.radiusKm === 25,
    'Geofence coordinates & 25km radius persisted in localStorage'
  );

  const sampleEvents = [
    { id: 'inside-dc', lat: 38.9072, lon: -77.0369, title: 'DC Metro Event (1km)' },
    { id: 'inside-arlington', lat: 38.8816, lon: -77.091, title: 'Arlington Event (5km)' },
    { id: 'outside-baltimore', lat: 39.2904, lon: -76.6122, title: 'Baltimore Event (57km)' },
    { id: 'outside-richmond', lat: 37.5407, lon: -77.436, title: 'Richmond Event (155km)' },
  ];
  const bounded = filterItemsWithinGeofence(sampleEvents, (e) => ({ lat: e.lat, lon: e.lon }), loaded);
  check(
    bounded.length === 2 &&
      bounded.every((b) => b.distanceKm <= 25) &&
      !bounded.some((b) => b.id.startsWith('outside-')),
    `filterItemsWithinGeofence kept 2 inside <=25km and dropped outside events`
  );

  const cliCtx = { crewAgents: [] };
  const reconCli = await executeCLICommand('recon local --radius 25km', cliCtx);
  check(
    reconCli.status === 'ok' && reconCli.output.includes('RADIUS BOUND : <= 25 km'),
    'CLI "recon local --radius 25km" executed and enforced 25 km bound'
  );

  console.log('\n=== 3. Rapid Local Dispatch Parsing & High Alert Mode (60s) ===');
  const sampleRss = `<?xml version="1.0"?><rss><channel>
    <item><title>HAZMAT Chemical Spill Perimeter Established</title><description>Shelter in place ordered near sector 4.</description><pubDate>Fri, 13 Nov 2026 17:40:00 GMT</pubDate></item>
  </channel></rss>`;
  const rssIncidents = parseLocalDispatchRssOrJson(sampleRss, 'https://county.cad/rss', 38.8977, -77.0365);
  check(
    rssIncidents.length === 1 && rssIncidents[0].severity === 'HIGH',
    'parseLocalDispatchRssOrJson parsed RSS dispatch alert with HIGH severity'
  );

  const sampleCadJson = JSON.stringify([
    { id: 'cad-101', callType: 'Structure Fire', lat: 38.901, lng: -77.04, severity: 'HIGH', address: '1400 Main St' },
  ]);
  const cadIncidents = parseLocalDispatchRssOrJson(sampleCadJson, 'https://api.pulsepoint.org/cad', 38.8977, -77.0365);
  check(
    cadIncidents.length === 1 && cadIncidents[0].sourceType === 'pulsepoint',
    'parseLocalDispatchRssOrJson parsed PulsePoint/CAD JSON incident'
  );

  setHighAlertMode(true);
  check(
    FREQUENCY_MS.every_1m === 60_000 && isHighAlertModeEnabled() && getEffectiveRapidPollIntervalMs() === 60_000,
    'High Alert Mode sets rapid polling interval to 60,000 ms (60s)'
  );
  setHighAlertMode(false);
  check(
    !isHighAlertModeEnabled() && getEffectiveRapidPollIntervalMs() === 180_000,
    'Disabling High Alert Mode restores 180,000 ms (3m) interval'
  );

  console.log('\n=== 4. Dispatch Triage Prompt & Swarm Corroboration Ingestion ===');
  const prompt = buildLocalDispatchTriagePrompt(38.8977, -77.0365, 'Units on scene, HAZMAT perimeter established.');
  check(
    prompt.includes('[38.8977, -77.0365]') && prompt.includes('threatDetected: boolean'),
    'buildLocalDispatchTriagePrompt includes coordinates [LAT, LNG] and structured JSON schema'
  );

  const triageRes = await analyzeDispatchSignal({
    transcript: 'Engine 4 on scene of major HAZMAT chemical spill; mandatory evacuation and perimeter established.',
    lat: 38.8977,
    lon: -77.0365,
    sourceLabel: 'LOCAL_COUNTY_SCANNER',
    ingestIntoSwarm: true,
  });
  check(
    triageRes.threatDetected === true &&
      (triageRes.severity === 'CRITICAL' || triageRes.severity === 'HIGH') &&
      Boolean(triageRes.packetId),
    `analyzeDispatchSignal detected ${triageRes.type} (${triageRes.severity}) and ingested packet ${triageRes.packetId?.slice(0, 12)}`
  );

  const summary = await getCorroborationStatusSummary();
  check(summary.totalPackets > 0 && summary.totalClusters > 0, 'CorroborationEngine registered triaged dispatch cluster');

  console.log(failures === 0 ? '\nALL LOCAL SIGNAL INGRESS CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
