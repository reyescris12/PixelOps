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

const eventListeners = new Map<string, Set<(ev: any) => void>>();
const g = globalThis as any;
g.localStorage ??= createStore();
g.sessionStorage ??= createStore();
g.window ??= g;
g.CustomEvent ??= class {
  constructor(public type: string, public detail?: any) {
    if (detail && typeof detail === 'object' && 'detail' in detail) {
      this.detail = detail.detail;
    }
  }
};
g.addEventListener = (type: string, cb: (ev: any) => void) => {
  if (!eventListeners.has(type)) eventListeners.set(type, new Set());
  eventListeners.get(type)!.add(cb);
};
g.removeEventListener = (type: string, cb: (ev: any) => void) => {
  eventListeners.get(type)?.delete(cb);
};
g.dispatchEvent = (ev: any) => {
  const listeners = eventListeners.get(ev?.type);
  if (listeners) {
    for (const cb of listeners) cb(ev);
  }
  return true;
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
    'src/services/PreMediaSignalService.ts',
    'src/services/CorroborationEngine.ts',
    'src/services/ApiService.ts',
    'src/services/TacticalVoiceService.ts',
    'src/services/MissionCartridgeService.ts',
    'src/context/CrewContext.tsx',
    'src/engine/pixelOpsCLI.ts',
    'src/components/ThreatMonitorModal.tsx',
    'functions/api/osint/premedia-sweep.ts',
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

  console.log('\n=== 5. Pre-Media ADS-B Transponder, Plume Sensor & Socrata/OpenMHz CAD Verification ===');
  const {
    classifyAdsbAircraftSignal,
    evaluateAtmosphericPlumeAnomaly,
    PRE_MEDIA_COLLECTION_DOCTRINE,
    getOperativePreMediaSystemPrompt,
  } = await import('../src/services/PreMediaSignalService');
  const { ingestPacket } = await import('../src/services/CorroborationEngine');
  const { FUNCTIONAL_ROLE_PROFILES } = await import('../src/context/CrewContext');
  const { GEMINI_TOOL_DECLARATIONS, buildDynamicToolDeclarations } = await import('../src/services/ApiService');
  const { BUILTIN_ARMORY_CARTRIDGES } = await import('../src/services/MissionCartridgeService');

  const nowIso = new Date().toISOString();
  const sq7700 = classifyAdsbAircraftSignal(
    { hex: 'A1B2C3', flight: 'N911PD  ', t: 'EC35', lat: 38.901, lon: -77.039, alt_baro: 1200, gs: 55, squawk: '7700' },
    38.8977,
    -77.0365,
    nowIso
  );
  check(
    sq7700?.tacticalFlag === 'EMERGENCY_SQUAWK' && sq7700.severity === 'CRITICAL',
    'classifyAdsbAircraftSignal flags squawk 7700 as EMERGENCY_SQUAWK [CRITICAL]'
  );

  const medevac = classifyAdsbAircraftSignal(
    { hex: 'A99MED', flight: 'LIFE1   ', t: 'EC45', lat: 38.902, lon: -77.038, alt_baro: 1450, gs: 62, squawk: '1200' },
    38.8977,
    -77.0365,
    nowIso
  );
  check(
    medevac?.tacticalFlag === 'MEDEVAC_POLICE_ROTORCRAFT' && medevac.severity === 'HIGH',
    'classifyAdsbAircraftSignal flags low-altitude orbiting medevac helicopter as MEDEVAC_POLICE_ROTORCRAFT [HIGH]'
  );

  const airliner = classifyAdsbAircraftSignal(
    { hex: 'AC8890', flight: 'UAL412  ', t: 'B738', lat: 38.91, lon: -77.05, alt_baro: 34000, gs: 455, squawk: '3421' },
    38.8977,
    -77.0365,
    nowIso
  );
  check(
    airliner?.tacticalFlag === 'ROUTINE_TRAFFIC' && airliner.severity === 'LOW',
    'classifyAdsbAircraftSignal ignores cruising commercial airliner (ROUTINE_TRAFFIC)'
  );

  const smokePlume = evaluateAtmosphericPlumeAnomaly({
    lat: 38.8977,
    lon: -77.0365,
    sourceEndpoint: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    current: { us_aqi: 162, pm2_5: 68.4, pm10: 145, carbon_monoxide: 980, sulphur_dioxide: 12 },
  });
  check(
    smokePlume.anomalyDetected === true &&
      smokePlume.anomalyType === 'SMOKE_PARTICULATE_SURGE' &&
      smokePlume.severity === 'HIGH',
    'evaluateAtmosphericPlumeAnomaly detects hazardous structure/wildfire smoke plume surge'
  );

  const cleanAir = evaluateAtmosphericPlumeAnomaly({
    lat: 38.8977,
    lon: -77.0365,
    sourceEndpoint: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    current: { us_aqi: 28, pm2_5: 6.1, pm10: 14, carbon_monoxide: 210, sulphur_dioxide: 2 },
  });
  check(cleanAir.anomalyDetected === false && cleanAir.anomalyType === 'NONE', 'Nominal air reading stays quiet');

  const socrata911Sample = JSON.stringify([
    {
      incident_number: 'F260099123',
      type: 'Hazmat Reduced / Chemical Odor Perimeter',
      address: '800 5th Ave',
      latitude: '47.6050',
      longitude: '-122.3308',
      datetime: '2026-11-13T20:15:00.000Z',
    },
  ]);
  const socrataParsed = parseLocalDispatchRssOrJson(
    socrata911Sample,
    'https://data.seattle.gov/resource/kzjm-xkqj.json',
    47.6062,
    -122.3321
  );
  check(
    socrataParsed.length === 1 && socrataParsed[0].severity === 'HIGH' && socrataParsed[0].lat === 47.605,
    'parseLocalDispatchRssOrJson parses municipal Socrata 911 CAD stream with exact coordinates & HIGH priority'
  );

  console.log('\n=== 6. Multi-Track Pre-Media Corroboration & Real-Time Tactical Threat Alert ===');
  let capturedAlertDetail: any = null;
  g.addEventListener('pixelops:tactical-threat-alert', (ev: any) => {
    capturedAlertDetail = ev.detail;
  });

  // Track 1 (Nyx - WRITTEN_WIRE): Municipal 911 CAD incident at isolated test sector (Seattle Pier)
  const cadIngest = await ingestPacket({
    sourceTrack: 'WRITTEN_WIRE',
    sourceType: 'local_dispatch',
    canonicalTargetKey: 'cad-seattle-hazmat-99123',
    payloadTimestamp: nowIso,
    sourceEndpoint: 'https://data.seattle.gov/resource/kzjm-xkqj.json',
    ingestedBy: 'nyx',
    ttlSeconds: 900,
    geoAnchor: { lat: 47.605, lon: -122.3308, radiusKm: 15, precision: 'EXACT' },
    sectorKey: 'SEATTLE-METRO',
    summaryHeadline: '[CAD] Hazmat Chemical Release Perimeter at 800 5th Ave',
    rawPayload: socrataParsed[0],
  });
  check(
    cadIngest.cluster?.status === 'CANDIDATE' && (cadIngest.cluster?.corroborationScore ?? 1) <= 0.35,
    `Single pre-media track (Nyx CAD) capped at CANDIDATE <= 0.35 (score=${cadIngest.cluster?.corroborationScore})`
  );

  // Track 2 (Cipher - SIGNALS_INFRA): Orbiting Medevac / Police Rotorcraft on ADS-B 0.8 km away
  const adsbContact = classifyAdsbAircraftSignal(
    { hex: 'A44PD1', flight: 'GUARDIAN1', t: 'B407', lat: 47.609, lon: -122.334, alt_baro: 1100, gs: 48, squawk: '1200' },
    47.605,
    -122.3308,
    nowIso
  )!;
  const adsbIngest = await ingestPacket({
    sourceTrack: 'SIGNALS_INFRA',
    sourceType: 'adsb_airspace',
    canonicalTargetKey: `adsb:${adsbContact.icaoHex}:${adsbContact.tacticalFlag}`,
    payloadTimestamp: nowIso,
    sourceEndpoint: 'https://api.adsb.lol/v2/point/47.6050/-122.3308/15',
    ingestedBy: 'cipher',
    ttlSeconds: 300,
    geoAnchor: { lat: adsbContact.lat, lon: adsbContact.lon, radiusKm: 15, precision: 'EXACT' },
    sectorKey: 'SEATTLE-METRO',
    summaryHeadline: `[ADS-B ${adsbContact.tacticalFlag}] ${adsbContact.summary}`,
    rawPayload: adsbContact,
  });
  check(
    adsbIngest.promotedToCorroborated === true &&
      adsbIngest.cluster?.status === 'CORROBORATED' &&
      (adsbIngest.cluster?.corroborationScore ?? 0) >= 0.7,
    `Converging CAD + ADS-B tracks promoted cluster to CORROBORATED (score=${adsbIngest.cluster?.corroborationScore})`
  );
  check(
    Boolean(capturedAlertDetail && capturedAlertDetail.clusterId === adsbIngest.cluster?.clusterId),
    'Vance synthesis automatically fired real-time "pixelops:tactical-threat-alert" UI event on corroboration'
  );

  console.log('\n=== 7. Agent Swarm Pre-Media Configuration & Anti-Delayed-News Doctrine ===');
  check(
    PRE_MEDIA_COLLECTION_DOCTRINE.includes('Do NOT rely on delayed mainstream news') &&
      getOperativePreMediaSystemPrompt('nyx').includes('osint_local_premedia_sweep') &&
      getOperativePreMediaSystemPrompt('cipher').includes('osint_adsb_airspace_radar') &&
      getOperativePreMediaSystemPrompt('vance').includes('CORROBORATED'),
    'Pre-media collection & anti-delayed-news doctrine configured for Nyx, Cipher, and Vance'
  );
  check(
    FUNCTIONAL_ROLE_PROFILES.researcher.recommendedTools.includes('osint_local_premedia_sweep') &&
      FUNCTIONAL_ROLE_PROFILES.coder.recommendedTools.includes('osint_adsb_airspace_radar') &&
      FUNCTIONAL_ROLE_PROFILES.general_assistant.recommendedTools.includes('query_corroboration_clusters'),
    'CrewContext functional role profiles expose pre-media SIGINT & corroboration tools'
  );
  const dynamicDecls = buildDynamicToolDeclarations([]).map((d) => d.name);
  check(
    Boolean(GEMINI_TOOL_DECLARATIONS.osint_local_premedia_sweep) &&
      dynamicDecls.includes('osint_local_premedia_sweep') &&
      dynamicDecls.includes('osint_scanner_dispatch_triage') &&
      dynamicDecls.includes('osint_adsb_airspace_radar') &&
      dynamicDecls.includes('query_corroboration_clusters'),
    'ApiService registers all 4 pre-media signal & corroboration function declarations'
  );
  check(
    BUILTIN_ARMORY_CARTRIDGES.some((c) => c.id === 'cartridge_premedia_local_sigint'),
    'MissionCartridgeService includes built-in Pre-Media Local SIGINT & Dispatch Overwatch cartridge'
  );

  console.log(failures === 0 ? '\nALL LOCAL SIGNAL INGRESS CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
