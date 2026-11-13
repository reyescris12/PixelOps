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
    getPacketRawPayloadJson,
    extractCanonicalEntities,
    nominateClusterPackage,
    dismissClusterFalsePositive,
    runCorroborationSelfTest,
  } = await import('../src/services/CorroborationEngine');
  const { executeCLICommand } = await import('../src/engine/pixelOpsCLI');
  const {
    listWorkspaceFiles,
    writeWorkspaceFile,
    repairAllStoredReports,
    isTelemetryClutterWorkspaceFile,
  } = await import('../src/engine/storageManager');
  const { ledgerDb, getLast50Commands } = await import('../src/services/CommandLedgerDb');

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

  const rawSnapStr = await getPacketRawPayloadJson(directReport.packet1Id);
  let parsedRawSnap: any = null;
  try {
    parsedRawSnap = rawSnapStr ? JSON.parse(rawSnapStr) : null;
  } catch {}
  check(
    parsedRawSnap && parsedRawSnap.packetId === directReport.packet1Id,
    `Raw JSON snapshot in IndexedDB (${directReport.rawPath1}) retrieved cleanly via getPacketRawPayloadJson`
  );

  const filesAfterSelfTest = await listWorkspaceFiles();
  check(
    filesAfterSelfTest.length === 0,
    `intel selftest produced zero clutter files in Workspace Files (count=${filesAfterSelfTest.length})`
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

  const filesAfterNominate = await listWorkspaceFiles();
  check(
    filesAfterNominate.length === 0,
    `intel nominate produced zero clutter files in Workspace Files (count=${filesAfterNominate.length})`
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

  console.log('\n=== 7. Workspace Clutter Prevention & Auto-Purge Verification ===');
  const reportedCisaPacketJson = JSON.stringify(
    {
      packetId: '5dea6e7367f147cda4338b8a72b7bf148066d18747d1e27a9e6aece77da3a855',
      sourceTrack: 'SIGNALS_INFRA',
      sourceType: 'doh_dns',
      canonicalTargetKey: 'cisa.gov',
      sourceEndpoint: 'https://dns.google/resolve?name=cisa.gov&type=A',
      ingestedBy: 'cipher',
      capturedAt: '2026-11-13T12:47:47.681Z',
      ttlSeconds: 3600,
      geoAnchor: { lat: 39.0438, lon: -77.4874, radiusKm: 35, precision: 'REGIONAL' },
      sectorKey: 'SECTOR-01-ASHBURN',
      entities: {
        mmsi: [],
        noradId: [],
        ipAsn: ['23.40.6.12', '172.64.40.31'],
        domains: ['cisa.gov'],
        cves: [],
        gridSectors: ['SECTOR-01-ASHBURN'],
        canonicalKeys: ['ip:23.40.6.12', 'ip:172.64.40.31', 'domain:cisa.gov'],
      },
      structuralHash: 'c636271d34d0901b07c4b995b899b6fbaf871069828472a760b8e56d157cdca4',
      payload: {
        Status: 0,
        TC: false,
        RD: true,
        RA: true,
        AD: true,
        CD: false,
        Question: [{ name: 'cisa.gov.', type: 1 }],
        Answer: [{ name: 'cisa.gov.', type: 1, TTL: 5, data: '23.40.6.12' }],
        Comment: 'Response from 172.64.40.31.',
      },
    },
    null,
    2
  );

  // Verify Google DoH Comment resolver IP (172.64.40.31) is excluded from extracted entities
  const dohEntities = extractCanonicalEntities(
    JSON.parse(reportedCisaPacketJson).payload,
    'DoH A-Record Watch: cisa.gov',
    'SECTOR-01-ASHBURN'
  );
  check(
    !dohEntities.ipAsn.includes('172.64.40.31') && dohEntities.ipAsn.includes('23.40.6.12'),
    'extractCanonicalEntities excludes Google DoH Comment resolver IP while keeping Answer IP'
  );

  // Seed legacy clutter files directly into VFS + ledgerDb alongside a real user report
  const existingVfs = (() => {
    try {
      return JSON.parse(g.localStorage.getItem('pixelops_vfs_files_v1') || '{}');
    } catch {
      return {};
    }
  })();
  const nowIso = new Date().toISOString();
  existingVfs['intel/raw/2026-11-13/5dea6e7367f147cda4338b8a72b7bf148066d18747d1e27a9e6aece77da3a855.json'] = {
    content: reportedCisaPacketJson,
    format: 'json',
    updatedAt: nowIso,
  };
  existingVfs['reports/moved_packet_copy.json'] = {
    content: reportedCisaPacketJson,
    format: 'json',
    updatedAt: nowIso,
  };
  existingVfs['intel/missions/sitrep-clu-test.md'] = {
    content: '# WAR ROOM FUSED SITREP // test',
    format: 'markdown',
    updatedAt: nowIso,
  };
  existingVfs['intel/missions/effector-clu-test.json'] = {
    content: '{"actionType":"ARCHIVE_SITREP"}',
    format: 'json',
    updatedAt: nowIso,
  };
  g.localStorage.setItem('pixelops_vfs_files_v1', JSON.stringify(existingVfs));

  try {
    await ledgerDb.workspace_files.put({
      path: 'intel/raw/2026-11-13/5dea6e7367f147cda4338b8a72b7bf148066d18747d1e27a9e6aece77da3a855.json',
      category: 'intel',
      format: 'json',
      content: reportedCisaPacketJson,
      sizeBytes: reportedCisaPacketJson.length,
      updatedAt: nowIso,
    });
  } catch {}

  await writeWorkspaceFile(
    'reports/operator_brief.md',
    '# Operator Brief\n\nLegitimate user-facing mission brief.',
    'markdown',
    'reports'
  );

  check(
    isTelemetryClutterWorkspaceFile('reports/moved_packet_copy.json', reportedCisaPacketJson) &&
      !isTelemetryClutterWorkspaceFile('reports/operator_brief.md', '# Operator Brief'),
    'isTelemetryClutterWorkspaceFile accurately classifies telemetry packets vs user briefs'
  );

  const visibleBeforeRepair = await listWorkspaceFiles();
  check(
    visibleBeforeRepair.length === 1 && visibleBeforeRepair[0].path === 'reports/operator_brief.md',
    `listWorkspaceFiles() filtered out all 4 clutter files and preserved operator_brief.md (count=${visibleBeforeRepair.length})`
  );

  // Re-seed VFS clutter directly to test repairAllStoredReports() explicit purge count
  const vfsForRepair = JSON.parse(g.localStorage.getItem('pixelops_vfs_files_v1') || '{}');
  vfsForRepair['intel/raw/2026-11-13/5dea6e7367f147cda4338b8a72b7bf148066d18747d1e27a9e6aece77da3a855.json'] = {
    content: reportedCisaPacketJson,
    format: 'json',
    updatedAt: nowIso,
  };
  vfsForRepair['reports/moved_packet_copy.json'] = {
    content: reportedCisaPacketJson,
    format: 'json',
    updatedAt: nowIso,
  };
  vfsForRepair['intel/missions/sitrep-clu-test.md'] = {
    content: '# WAR ROOM FUSED SITREP // test',
    format: 'markdown',
    updatedAt: nowIso,
  };
  vfsForRepair['intel/missions/effector-clu-test.json'] = {
    content: '{"actionType":"ARCHIVE_SITREP"}',
    format: 'json',
    updatedAt: nowIso,
  };
  g.localStorage.setItem('pixelops_vfs_files_v1', JSON.stringify(vfsForRepair));

  const repairedCount = await repairAllStoredReports();
  const visibleAfterRepair = await listWorkspaceFiles();
  const vfsKeysRemaining = Object.keys(
    JSON.parse(g.localStorage.getItem('pixelops_vfs_files_v1') || '{}')
  );
  check(
    repairedCount >= 4 &&
      visibleAfterRepair.length === 1 &&
      visibleAfterRepair[0].path === 'reports/operator_brief.md' &&
      vfsKeysRemaining.length === 1 &&
      vfsKeysRemaining[0] === 'reports/operator_brief.md',
    `repairAllStoredReports() purged all 4 legacy telemetry files from VFS (purged=${repairedCount}, remaining=${vfsKeysRemaining.join(', ')})`
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
