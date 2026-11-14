/**
 * Verification Suite: Calm-by-Default C2 & 3-Layer Progressive Disclosure Architecture
 * Usage: npx tsx scripts/test-calm-c2-architecture.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  computeHaversineKm,
  computeBearingDeg,
  cardinalDirectionFromBearing,
  formatDistanceKmClean,
  formatRelativeAge,
  translateRawShorthandLine,
  translateObservationToSituationCard,
  summarizeSensorHealthBar,
  buildSituationFeed,
} from '../src/services/PlainEnglishTranslator';
import type { SensorObservation, SensorAdapterHealth } from '../src/services/LocalSensorBus';
import type {
  CorroborationClusterDbEntry,
  EvidencePacketDbEntry,
} from '../src/services/CommandLedgerDb';

let failures = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`PASS: ${msg}`);
  } else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

async function runTests() {
  const nowIso = '2026-11-14T14:00:00.000Z';
  const nowMs = Date.parse(nowIso);
  const watchCenter = { lat: 51.5074, lon: -0.1278 }; // Central London Watch Zone

  console.log('=== 1. Deterministic Plain-English Translator: Canonical Shorthand Cases ===');

  // Case 1: Airspace Helicopter Loiter
  const airHit = translateRawShorthandLine(
    '[GEOINT_AIR][B2] HEX:43C1A2 CAT:A7 ALT:1850FT ΔHDG:340° LOITER_DETECTED',
    { distanceKm: 4.2, cardinalDirection: 'NW' }
  );
  assert(
    airHit.headline === 'Low-flying helicopter circling 4.2 km NW',
    `Airspace shorthand headline translated cleanly: "${airHit.headline}"`
  );
  assert(
    airHit.subtitle === 'Orbiting at 1,850 ft for 4 mins • Unconfirmed (1 sensor)',
    `Airspace shorthand subtitle translated cleanly: "${airHit.subtitle}"`
  );
  assert(
    airHit.trustBadge === 'Single-Sensor Watch' && airHit.admiraltyCode === 'B2',
    'Airspace single-sensor loiter graded Single-Sensor Watch while preserving NATO [B2]'
  );

  // Case 2: Official UK EA Flood Warning
  const floodHit = translateRawShorthandLine(
    '[CIVIC_HAZARD][A1] EA_FLOOD SEV:2 DIST:6.1KM',
    { cardinalDirection: 'S', areaName: 'River Thames' }
  );
  assert(
    floodHit.headline === 'Official Flood Warning — River Thames (6.1 km S)',
    `Civic flood shorthand headline translated cleanly: "${floodHit.headline}"`
  );
  assert(
    floodHit.subtitle === 'Immediate action advised • Verified Official Alert',
    `Civic flood shorthand subtitle translated cleanly: "${floodHit.subtitle}"`
  );
  assert(
    floodHit.trustBadge === 'Verified Official' && floodHit.admiraltyCode === 'A1',
    'Civic [A1] flood warning graded Verified Official'
  );

  // Case 3: Corroborated Multi-Sensor Cluster
  const clusterHit = translateRawShorthandLine(
    'CLUSTER #8F2A [CORROBORATED 0.78] [2x SRC]',
    {
      distanceKm: 3.1,
      cardinalDirection: 'E',
      corroboratingDescriptions: ['helicopter circling', 'local road closure'],
      vanceReady: true,
    }
  );
  assert(
    clusterHit.headline === 'Likely Active Incident (3.1 km E)',
    `Cluster shorthand headline translated cleanly: "${clusterHit.headline}"`
  );
  assert(
    clusterHit.subtitle ===
      'Helicopter circling + local road closure matching in same area. Agent Vance assessment ready.',
    `Cluster shorthand subtitle translated cleanly: "${clusterHit.subtitle}"`
  );
  assert(
    clusterHit.trustBadge === 'Corroborated (2+ Feeds)',
    'Corroborated cluster graded Corroborated (2+ Feeds)'
  );

  console.log('\n=== 2. Live SensorObservation & Multi-Track Cluster Translation ===');

  const airDistKm = computeHaversineKm(watchCenter.lat, watchCenter.lon, 51.534, -0.171);
  const obsAirLoiter: SensorObservation = {
    id: 'obs-air-43c1a2',
    naiId: 'nai-primary',
    adapterId: 'GEOINT_AIR',
    sourceTrack: 'WIDE_AREA',
    admiraltyGrade: 'B2',
    observationTime: '2026-11-14T13:57:00.000Z',
    firstIngestedAt: '2026-11-14T13:57:05.000Z',
    lastMaterialChangeAt: '2026-11-14T13:57:05.000Z',
    lat: 51.534,
    lon: -0.171,
    distanceKm: airDistKm,
    severity: 'MEDIUM',
    status: 'LOITER_DETECTED',
    headline: '[GEOINT_AIR][B2] HEX:43C1A2 CAT:A7 ALT:1850FT ΔHDG:340° LOITER_DETECTED',
    spotlightedSummary: '<<<UNTRUSTED_SENSOR_DATA>>>Rotorcraft circling below 3,500 ft<<<END_UNTRUSTED_SENSOR_DATA>>>',
    corroborationStatus: 'CANDIDATE',
    corroborationScore: 0.35,
    sourceTracks: ['WIDE_AREA'],
    isLifeSafetyA1: false,
    loiterTurnDeg: 340,
    altitudeFt: 1850,
    callsignOrHex: '43C1A2',
    packetId: 'sha256-pkt-air-001',
    sourceEndpoint: 'https://api.adsb.lol/v2/point/51.5074/-0.1278/25',
    rawPayload: {
      hex: '43c1a2',
      category: 'A7',
      alt_baro: 1850,
      gs: 62,
    },
  };

  const airCard = translateObservationToSituationCard(obsAirLoiter, watchCenter, nowMs);
  assert(
    airCard.headline.startsWith('Low-flying helicopter circling ') &&
      airCard.cardinalDirection === 'NW',
    `Live GEOINT_AIR observation translated to plain English with NW bearing: "${airCard.headline}"`
  );
  assert(
    airCard.distanceAndAgeLabel.includes('NW • 3m ago'),
    `Distance & relative age formatted cleanly: "${airCard.distanceAndAgeLabel}"`
  );
  assert(
    airCard.isPriorityLayer1 === false && airCard.trustBadge === 'Single-Sensor Watch',
    'Uncorroborated single-sensor helicopter loiter stays out of Layer-1 priority alerts until corroborated'
  );
  assert(
    airCard.proof.admiraltyCode === 'B2' &&
      airCard.proof.packetIds.includes('sha256-pkt-air-001') &&
      airCard.proof.observationTime === '2026-11-14T13:57:00.000Z',
    'Layer-3 proof preserves exact NATO [B2], SHA-256 packetId, and timestamps'
  );

  const floodDistKm = computeHaversineKm(watchCenter.lat, watchCenter.lon, 51.4525, -0.128);
  const obsEaFlood: SensorObservation = {
    id: 'obs-ea-flood-99',
    naiId: 'nai-primary',
    adapterId: 'CIVIC_HAZARD',
    sourceTrack: 'SIGNALS_INFRA',
    admiraltyGrade: 'A1',
    observationTime: '2026-11-14T13:55:00.000Z',
    firstIngestedAt: '2026-11-14T13:55:12.000Z',
    lastMaterialChangeAt: '2026-11-14T13:55:12.000Z',
    lat: 51.4525,
    lon: -0.128,
    distanceKm: floodDistKm,
    severity: 'HIGH',
    status: 'UK_EA_FLOOD_SEV_2',
    headline: 'Flood Warning: River Thames at Putney Embankment',
    spotlightedSummary: 'Rising tide levels expected to impact low-lying riverside roads.',
    corroborationStatus: 'CANDIDATE',
    corroborationScore: 0.65,
    sourceTracks: ['SIGNALS_INFRA'],
    isLifeSafetyA1: true,
    packetId: 'sha256-pkt-flood-002',
    sourceEndpoint: 'https://environment.data.gov.uk/flood-monitoring/id/floods',
    rawPayload: {
      description: 'River Thames at Putney',
      floodAreaID: '063FWF23Putney',
      severityLevel: 2,
    },
  };

  const floodCard = translateObservationToSituationCard(obsEaFlood, watchCenter, nowMs);
  assert(
    floodCard.headline.includes('Official Flood Warning — River Thames at Putney') &&
      floodCard.trustBadge === 'Verified Official' &&
      floodCard.isPriorityLayer1 === true,
    `Official A1 flood observation promoted to Layer-1 Verified Official: "${floodCard.headline}"`
  );

  console.log('\n=== 3. Layer-0 Calm Baseline, Layer-1 Priority Separation & Sensor Health Bar ===');

  const healthyAdapters: SensorAdapterHealth[] = [
    {
      adapterId: 'GEOINT_AIR',
      label: 'ADS-B Airspace',
      status: 'OK',
      httpStatus: 200,
      latencyMs: 120,
      observationCount: 1,
      lastSweptAt: '2026-11-14T13:59:48.000Z',
    },
    {
      adapterId: 'CIVIC_HAZARD',
      label: 'Civic Hazards',
      status: 'OK',
      httpStatus: 200,
      latencyMs: 140,
      observationCount: 0,
      lastSweptAt: '2026-11-14T13:59:48.000Z',
    },
    {
      adapterId: 'MASINT_SEISMIC',
      label: 'Seismic',
      status: 'OK',
      httpStatus: 200,
      latencyMs: 95,
      observationCount: 0,
      lastSweptAt: '2026-11-14T13:59:48.000Z',
    },
    {
      adapterId: 'IMINT_THERMAL',
      label: 'Thermal',
      status: 'OPTIONAL_KEY_MISSING',
      httpStatus: 0,
      latencyMs: 0,
      observationCount: 0,
      lastSweptAt: '2026-11-14T13:59:48.000Z',
    },
    {
      adapterId: 'SIGINT_INFRA',
      label: 'Infra & Grid',
      status: 'OK',
      httpStatus: 200,
      latencyMs: 180,
      observationCount: 0,
      lastSweptAt: '2026-11-14T13:59:48.000Z',
    },
  ];

  const healthBar = summarizeSensorHealthBar(healthyAdapters);
  assert(
    healthBar.oneLineSummary === 'Air • Flood/Weather • Roads • Seismic • Grid: 5/5 OK',
    `1-Line Sensor Health Bar matches specification: "${healthBar.oneLineSummary}"`
  );

  // Layer 0 Test: Only routine single-sensor signals present -> All Clear!
  const calmSnapshot = buildSituationFeed({
    observations: [obsAirLoiter],
    clusters: [],
    centerLat: watchCenter.lat,
    centerLon: watchCenter.lon,
    radiusKm: 35,
    lastSweptAt: '2026-11-14T13:59:48.000Z',
    adapterHealth: healthyAdapters,
    nowMs,
  });

  assert(
    calmSnapshot.isAllClear === true &&
      calmSnapshot.priorityCards.length === 0 &&
      calmSnapshot.hiddenRoutineCount === 1,
    'Layer 0 Calm Baseline hides single-sensor clutter behind "+ 1 routine signal hidden" and declares All Clear'
  );
  assert(
    calmSnapshot.allClearHeadline === 'No Active Local Threats Detected' &&
      calmSnapshot.allClearSubtext ===
        'Monitoring 5 live feeds within 35 km • Last sweep 12s ago.',
    `Layer 0 Calm Baseline copy matches specification: "${calmSnapshot.allClearHeadline} — ${calmSnapshot.allClearSubtext}"`
  );

  // Layer 1 Test: Corroborated Cluster + Official A1 Warning -> Promoted to Priority Feed!
  const mockCluster: CorroborationClusterDbEntry = {
    clusterId: 'cluster-8f2a',
    title: 'Multi-Track Local Convergence',
    sectorKey: '51.5_-0.1',
    geoAnchor: { lat: 51.509, lon: -0.083, radiusKm: 5, precision: 'EXACT' },
    status: 'CORROBORATED',
    corroborationScore: 0.78,
    independentTracks: ['WIDE_AREA', 'SIGNALS_INFRA'],
    packetIds: ['sha256-pkt-air-99', 'sha256-pkt-tfl-99'],
    deltaIds: ['d1', 'd2'],
    sharedEntities: ['51.5_-0.1'],
    createdAt: '2026-11-14T13:56:00.000Z',
    updatedAt: '2026-11-14T13:58:00.000Z',
    expiresAt: '2026-11-14T15:58:00.000Z',
  };

  const mockPackets: EvidencePacketDbEntry[] = [
    {
      packetId: 'sha256-pkt-air-99',
      sourceTrack: 'WIDE_AREA',
      sourceType: 'GEOINT_AIR_LOITER',
      canonicalTargetKey: 'hex:43c999',
      payloadTimestamp: '2026-11-14T13:57:00.000Z',
      sourceEndpoint: 'https://api.adsb.lol/v2/point/51.5/-0.1/25',
      ingestedBy: 'LocalSensorBus',
      capturedAt: '2026-11-14T13:57:02.000Z',
      ttlSeconds: 1800,
      geoAnchor: { lat: 51.509, lon: -0.083, radiusKm: 2, precision: 'EXACT' },
      sectorKey: '51.5_-0.1',
      entities: {
        mmsi: [],
        noradId: [],
        ipAsn: [],
        domains: [],
        cves: [],
        gridSectors: ['51.5_-0.1'],
        canonicalKeys: ['hex:43c999'],
      },
      rawPayloadRef: 'idb://sha256-pkt-air-99',
      summaryHeadline: 'Helicopter loitering at 1,600 ft',
      structuralHash: 'h1',
    },
    {
      packetId: 'sha256-pkt-tfl-99',
      sourceTrack: 'SIGNALS_INFRA',
      sourceType: 'TFL_DISRUPTION',
      canonicalTargetKey: 'tfl:a13',
      payloadTimestamp: '2026-11-14T13:57:30.000Z',
      sourceEndpoint: 'https://api.tfl.gov.uk/Road/all/Disruption',
      ingestedBy: 'LocalSensorBus',
      capturedAt: '2026-11-14T13:57:35.000Z',
      ttlSeconds: 1800,
      geoAnchor: { lat: 51.509, lon: -0.083, radiusKm: 2, precision: 'EXACT' },
      sectorKey: '51.5_-0.1',
      entities: {
        mmsi: [],
        noradId: [],
        ipAsn: [],
        domains: [],
        cves: [],
        gridSectors: ['51.5_-0.1'],
        canonicalKeys: ['tfl:a13'],
      },
      rawPayloadRef: 'idb://sha256-pkt-tfl-99',
      summaryHeadline: 'A13 emergency lane closure',
      structuralHash: 'h2',
    },
  ];

  const activeAlertSnapshot = buildSituationFeed({
    observations: [obsAirLoiter, obsEaFlood],
    clusters: [{ cluster: mockCluster, packets: mockPackets, deltas: [], nomination: null, synthesis: null }],
    centerLat: watchCenter.lat,
    centerLon: watchCenter.lon,
    radiusKm: 35,
    lastSweptAt: '2026-11-14T13:59:48.000Z',
    adapterHealth: healthyAdapters,
    nowMs,
  });

  assert(
    activeAlertSnapshot.isAllClear === false &&
      activeAlertSnapshot.priorityCards.length === 2 &&
      activeAlertSnapshot.hiddenRoutineCount === 1,
    'Active Alert feed surfaces 2 priority cards (Corroborated Cluster + Official A1 Warning) while keeping 1 routine signal tucked away'
  );

  console.log('\n=== 4. Competing Explanations (ACH) Percentage Normalization ===');
  for (const card of [
    ...activeAlertSnapshot.priorityCards,
    ...activeAlertSnapshot.routineCards,
  ]) {
    const sum = card.achHypotheses.reduce((acc, h) => acc + h.percentage, 0);
    assert(
      card.achHypotheses.length === 3 && sum === 100,
      `ACH hypotheses for "${card.trustBadge}" sum to 100% (${card.achHypotheses
        .map((h) => `${h.id}:${h.percentage}%`)
        .join(', ')})`
    );
  }

  console.log('\n=== 5. UI Consolidation & Codebase Guardrails Audit ===');
  const rootDir = process.cwd();
  const readSrc = (rel: string) => fs.readFileSync(path.join(rootDir, rel), 'utf-8');

  const appCode = readSrc('src/App.tsx');
  const topBarCode = readSrc('src/components/CalmTopBar.tsx');
  const reconCode = readSrc('src/components/ReconWorkspaceView.tsx');
  const drawerCode = readSrc('src/components/SituationEvidenceDrawer.tsx');
  const vaultCode = readSrc('src/components/VaultWorkspaceView.tsx');
  const spriteCode = readSrc('src/components/SpriteCanvas.tsx');

  assert(
    appCode.includes('<CalmTopBar') &&
      !appCode.includes('<CommandSideDrawer') &&
      !appCode.includes('<CommandDock') &&
      !appCode.includes('activeTacticalThreatAlert'),
    'App.tsx consolidates global navigation into <CalmTopBar /> and removes stacked CommandSideDrawer, CommandDock, and floating red toast clutter'
  );
  assert(
    topBarCode.includes('ALL CLEAR') &&
      topBarCode.includes('Watch Zone') &&
      topBarCode.includes('RECON') &&
      topBarCode.includes('SAFEHOUSE') &&
      topBarCode.includes('VAULT') &&
      topBarCode.includes('aria-label="System Menu"'),
    'CalmTopBar implements [ALL CLEAR • Watch Zone ▾] + [RECON] [SAFEHOUSE] [VAULT] [⚙]'
  );
  assert(
    reconCode.includes('SituationEvidenceDrawer') &&
      drawerCode.includes('Summary (Vance BLUF)') &&
      drawerCode.includes('Competing Explanations (ACH)') &&
      drawerCode.includes('Raw Telemetry &amp; Tradecraft'),
    'ReconWorkspaceView + SituationEvidenceDrawer implement all 3 progressive disclosure tabs'
  );
  assert(
    vaultCode.includes('Saved Dossiers') &&
      vaultCode.includes('Entity Link Graph') &&
      vaultCode.includes('Connected Toolkits'),
    'VaultWorkspaceView consolidates Dossiers, Entity Link Graph, and Connected Toolkits'
  );
  assert(
    spriteCode.includes('reconAlertCount') &&
      spriteCode.includes("profile.id === 'vance'") &&
      spriteCode.includes("profile.id === 'nyx'"),
    'SpriteCanvas displays active Recon alert badges above Vance and Nyx desks'
  );

  // Guardrails: extensionless imports in new/modified files + zero gemini-2.5-flash / Supabase / Auth0
  const filesToAudit = [
    'src/services/PlainEnglishTranslator.ts',
    'src/components/SituationEvidenceDrawer.tsx',
    'src/components/ReconWorkspaceView.tsx',
    'src/components/VaultWorkspaceView.tsx',
    'src/components/CalmTopBar.tsx',
    'src/App.tsx',
  ];

  for (const rel of filesToAudit) {
    const content = readSrc(rel);
    const hasExtImport = /from\s+['"]\.\.?\/[^'"]+\.(ts|tsx|js|jsx)['"]/.test(content);
    assert(!hasExtImport, `${rel} uses clean extensionless relative imports`);
    assert(
      !content.includes('gemini-2.5-flash') &&
        !content.toLowerCase().includes('supabase') &&
        !content.toLowerCase().includes('auth0'),
      `${rel} contains zero references to decommissioned gemini-2.5-flash, Supabase, or Auth0`
    );
  }

  // Distance & Bearing sanity check
  const sampleDist = computeHaversineKm(51.5074, -0.1278, 51.534, -0.171);
  const sampleBrg = computeBearingDeg(51.5074, -0.1278, 51.534, -0.171);
  assert(
    sampleDist > 3.5 &&
      sampleDist < 5.0 &&
      cardinalDirectionFromBearing(sampleBrg) === 'NW' &&
      formatDistanceKmClean(sampleDist).endsWith('km') &&
      formatRelativeAge('2026-11-14T13:59:48.000Z', nowMs) === '12s ago',
    'Geodesic Haversine distance, compass cardinal bearing, and relative age helpers verified'
  );

  if (failures > 0) {
    console.error(`\n${failures} CALM C2 ARCHITECTURE CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('\n=== ALL CALM-BY-DEFAULT C2 & 3-LAYER PROGRESSIVE DISCLOSURE TESTS PASSED ===');
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
