/**
 * Verification Suite: Master-Specialist Corroboration Engine & Evidence-Linked Map Pins
 * Usage: npx tsx scripts/test-corroboration-engine.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Minimal browser storage shim for headless Node/tsx verification
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
    computeDeterministicPacketId,
    ingestPacket,
    evaluateClusterConfidence,
    validateVanceSynthesisCitations,
    getClusterWithPackets,
    nominateClusterPackage,
    dismissClusterFalsePositive,
    runCorroborationSelfTest,
  } = await import('../src/services/CorroborationEngine');
  const { executeCLICommand } = await import('../src/engine/pixelOpsCLI');
  const { readWorkspaceFile } = await import('../src/engine/storageManager');
  const { getLast50Commands } = await import('../src/services/CommandLedgerDb');

  console.log('=== 1. Extensionless Import Guardrail Verification ===');
  const checkedFiles = [
    'src/services/CorroborationEngine.ts',
    'src/services/CommandLedgerDb.ts',
    'src/services/WorkerService.ts',
    'src/services/NightShiftService.ts',
    'src/components/TacticalMapOverlay.tsx',
    'src/components/TacticalSatelliteMonitor.tsx',
    'src/engine/pixelOpsCLI.ts',
    'src/engine/storageManager.ts',
  ];
  const extImportRe =
    /(?:from\s+|import\s*\()\s*['"](\.[^'"]+\.(?:ts|tsx|js|jsx))['"]/g;
  for (const relPath of checkedFiles) {
    const content = readFileSync(resolve(process.cwd(), relPath), 'utf-8');
    const matches = [...content.matchAll(extImportRe)].map((m) => m[1]);
    check(
      matches.length === 0,
      `${relPath} uses strictly extensionless relative imports${matches.length ? ' (found: ' + matches.join(', ') + ')' : ''}`
    );
  }

  console.log('\n=== 2. Deterministic SHA-256 packetId & VFS Raw JSON Integrity ===');
  const idA = await computeDeterministicPacketId(
    'usgs_geojson',
    'us7000abc',
    '2026-11-13T10:00:00.000Z'
  );
  const idB = await computeDeterministicPacketId(
    'usgs_geojson',
    'us7000abc',
    '2026-11-13T10:00:00.000Z'
  );
  const idC = await computeDeterministicPacketId(
    'usgs_geojson',
    'us7000abc',
    '2026-11-13T10:01:00.000Z'
  );
  check(
    idA.length === 64 && /^[0-9a-f]{64}$/.test(idA) && idA === idB && idA !== idC,
    'computeDeterministicPacketId produces deterministic 64-char SHA-256 hex digest'
  );

  console.log('\n=== 3. CLI Hook Verification: intel selftest / status / inspect / nominate ===');
  const cliCtx = {
    crewAgents: [
      { id: 'rec_vance', customName: 'Vance', role: 'Lead Strategist', currentRoom: 'war_room' },
      { id: 'rec_nyx', customName: 'Nyx', role: 'Cyber & Signal', currentRoom: 'comms_tower' },
      { id: 'rec_cipher', customName: 'Cipher', role: 'Cryptographic Recon', currentRoom: 'server_vault' },
    ],
  };

  const selfTestCli = await executeCLICommand('intel selftest', cliCtx);
  check(selfTestCli.status === 'ok', 'CLI "intel selftest" exited with status ok');
  check(selfTestCli.output.includes('OVERALL      : PASS'), 'CLI "intel selftest" printed PASS summary');

  const directReport = await runCorroborationSelfTest();
  check(directReport.passed, 'runCorroborationSelfTest() passed all 4 internal assertions');
  check(
    directReport.candidateScore === 0.35 && directReport.corroboratedScore >= 0.7,
    `Score promoted from CANDIDATE (${directReport.candidateScore}) to CORROBORATED (${directReport.corroboratedScore})`
  );

  const rawSnap = await readWorkspaceFile(directReport.rawPath1);
  let parsedRawSnap: any = null;
  try {
    parsedRawSnap = rawSnap ? JSON.parse(rawSnap.content) : null;
  } catch {}
  check(
    parsedRawSnap && parsedRawSnap.packetId === directReport.packet1Id,
    `Raw JSON VFS snapshot at ${directReport.rawPath1} preserved cleanly by storageManager`
  );

  const statusCli = await executeCLICommand('intel status', cliCtx);
  check(
    statusCli.status === 'ok' && statusCli.output.includes(directReport.clusterId),
    'CLI "intel status" lists active watcher tracks and corroborated cluster'
  );

  const inspectCli = await executeCLICommand(`intel inspect ${directReport.clusterId}`, cliCtx);
  check(
    inspectCli.status === 'ok' &&
      inspectCli.output.includes(directReport.packet1Id) &&
      inspectCli.output.includes(directReport.packet2Id),
    'CLI "intel inspect <clusterId>" outputs full SHA-256 provenance chain'
  );

  const nominateCli = await executeCLICommand(`intel nominate ${directReport.clusterId}`, cliCtx);
  check(
    nominateCli.status === 'ok' && nominateCli.output.includes('LEDGER HASH'),
    'CLI "intel nominate <clusterId>" approves gate and returns immutable ledger hash'
  );

  const ledgerEntries = await getLast50Commands();
  check(
    ledgerEntries.some((e) => e.tool_used === 'corroboration_human_gate'),
    'CommandLedgerDb recorded immutable human gate approval entry'
  );

  console.log('\n=== 4. 3-Track CRITICAL_CONVERGENCE & Automatic TTL Staleness Decay ===');
  const tNow = Date.now();
  const thirdTrackRes = await ingestPacket({
    sourceTrack: 'WRITTEN_WIRE',
    sourceType: 's2_wire',
    canonicalTargetKey: 'selftest::s2-suez-cable-dispatch',
    payloadTimestamp: new Date(tNow).toISOString(),
    sourceEndpoint: 'https://feeds.buzzsprout.com/868255.rss',
    ingestedBy: 'nyx',
    ttlSeconds: 1800,
    geoAnchor: { lat: 30.59, lon: 32.27, radiusKm: 50, precision: 'REGIONAL' },
    sectorKey: 'SECTOR-54-SUEZ-SELFTEST',
    summaryHeadline: 'S2 Wire: Red Sea Suez telemetry disruption reported near suez-relay.subsea-ops.net',
    rawPayload: {
      title: 'S2 Wire // Suez Trunk Disruption',
      content: 'BLUF: Maritime & DNS telemetry anomaly near suez-relay.subsea-ops.net in Suez Corridor.',
      timestamp: new Date(tNow).toISOString(),
    },
    nowMs: tNow,
  });

  check(
    thirdTrackRes.cluster?.status === 'CRITICAL_CONVERGENCE' &&
      (thirdTrackRes.cluster?.corroborationScore ?? 0) >= 0.9,
    `3-track convergence escalated cluster to CRITICAL_CONVERGENCE (score=${thirdTrackRes.cluster?.corroborationScore})`
  );

  // Verify Haversine separation (>75 km from Suez -> separate Ashburn cluster)
  const distantRes = await ingestPacket({
    sourceTrack: 'CYBER_CVE',
    sourceType: 'cisa_kev',
    canonicalTargetKey: 'selftest::CVE-2026-99102',
    payloadTimestamp: new Date(tNow).toISOString(),
    sourceEndpoint: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    ingestedBy: 'cipher',
    ttlSeconds: 3600,
    geoAnchor: { lat: 39.0438, lon: -77.4874, radiusKm: 40, precision: 'REGIONAL' },
    sectorKey: 'SECTOR-01-ASHBURN-SELFTEST',
    summaryHeadline: 'CISA KEV Advisory CVE-2026-99102 active exploitation in CONUS East',
    rawPayload: {
      cveID: 'CVE-2026-99102',
      vendorProject: 'EdgeRouter',
      product: 'GatewayOS',
      knownRansomwareCampaignUse: 'Known',
    },
    nowMs: tNow,
  });

  check(
    distantRes.cluster?.clusterId !== directReport.clusterId &&
      distantRes.cluster?.status === 'CANDIDATE' &&
      distantRes.cluster?.corroborationScore === 0.35,
    'Distant sector (>75 km, no shared entity) isolated into separate CANDIDATE cluster at score 0.35'
  );

  // Advance clock +7200s beyond all TTLs -> cluster decays to STALE and nomination gate blocks stale cluster
  const futureMs = tNow + 7200 * 1000;
  const staleBundle = await getClusterWithPackets(directReport.clusterId, futureMs);
  check(
    staleBundle?.cluster.status === 'STALE' && (staleBundle.cluster.corroborationScore ?? 1) < 0.35,
    `Expired packets automatically decay cluster to STALE (score=${staleBundle?.cluster.corroborationScore})`
  );

  const staleNominationAttempt = await nominateClusterPackage(directReport.clusterId, {
    nowMs: futureMs,
  });
  check(
    staleNominationAttempt.approved === false &&
      Boolean(staleNominationAttempt.reason?.includes('STALE_OR_UNCORROBORATED')),
    'Human Nomination Gate rejects expired STALE cluster until telemetry is refreshed'
  );

  // Verify false-positive dismissal flow
  const dismissRes = await dismissClusterFalsePositive(distantRes.cluster!.clusterId);
  check(
    dismissRes.dismissed && dismissRes.cluster?.status === 'DISMISSED',
    'dismissClusterFalsePositive cleanly marks cluster DISMISSED and logs ledger entry'
  );

  // Verify validateVanceSynthesisCitations rejects hallucinated inline & explicit packetIds
  const badCitationCheck = validateVanceSynthesisCitations(
    {
      executiveAssessment: {
        bluf: 'Suspicious event detected.',
        citedPacketIds: ['ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
      },
      agreedIndicators: [
        {
          claim: 'Claim 1',
          packetIds: [directReport.packet1Id],
          sourceTracks: ['WIDE_AREA'],
        },
      ],
      conflictingGaps: [],
      recommendedEffectorPackage: {
        actionType: 'ARCHIVE_SITREP',
        title: 'Test',
        rationale: 'Test',
        citedPacketIds: [directReport.packet1Id],
        outboundPayload: {},
      },
    },
    [directReport.packet1Id, directReport.packet2Id]
  );
  check(
    badCitationCheck.valid === false,
    `validateVanceSynthesisCitations rejects hallucinated packetIds (${badCitationCheck.reason})`
  );

  console.log(
    failures === 0
      ? '\nALL CORROBORATION ENGINE VERIFICATION CHECKS PASSED'
      : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Corroboration test crashed:', err);
  process.exit(1);
});
