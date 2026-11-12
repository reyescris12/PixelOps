/**
 * End-to-End Verification Suite for the 5 Safehouse Capabilities:
 *   1. Interactive Evidence Graph & Basement Link Board
 *   2. Spatial MCP Stations & Physical Room Tool Leashes
 *   3. Shareable Mission Cartridges & Credential Scrubbing
 *   4. Deterministic SHA-256 Tripwire Diffing & Zero-Noise Gates
 *   5. Tactical Voice Comms (Gemini 3.8 Live Config, Non-Blocking Tools & PCM16 Codec)
 *
 * Usage: npx tsx scripts/test-five-pillars.ts
 */

import http from 'http';

const makeStore = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
};

const g = globalThis as any;
g.localStorage ??= makeStore();
g.sessionStorage ??= makeStore();
g.window ??= g;
g.dispatchEvent ??= () => true;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.CustomEvent ??= class {
  constructor(public type: string, public detail?: any) {}
};

let failures = 0;
function assertCheck(cond: unknown, label: string) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

async function main() {
  console.log('=== 1. Interactive Evidence Graph & Cross-Investigation Bridges ===');
  const graph = await import('../src/services/EvidenceGraphService');
  await graph.clearEvidenceGraph();

  await graph.indexDossierIntoEvidenceGraph(
    'intel/case_alpha_gateway.md',
    'Observed C2 beacon to telemetry-sync-cdn.net (104.21.44.18) inside AS13335 exploiting CVE-2024-3094 with TTP T1190 linked to Volt Typhoon.'
  );
  await graph.indexDossierIntoEvidenceGraph(
    'reports/case_bravo_maritime.md',
    'Port relay audit found shadow host relay.telemetry-sync-cdn.net and telemetry-sync-cdn.net hosted on AS13335 (104.21.44.18) unpatched against CVE-2024-3094 by Volt Typhoon.'
  );

  const snap = await graph.getEvidenceGraphSnapshot();
  assertCheck(snap.stats.totalDossiers === 2, 'Indexed 2 separate VFS dossiers');
  assertCheck(snap.stats.bridgeCount >= 4, `Detected ${snap.stats.bridgeCount} cross-dossier overlap bridges`);

  const asnHood = await graph.queryEntityNeighborhood('AS13335');
  assertCheck(
    asnHood.centerNode?.type === 'asn' && asnHood.connectedDossiers.length === 2,
    'Querying AS13335 exposes both Case Alpha and Case Bravo dossiers'
  );
  assertCheck(
    asnHood.coOccurringEntities.some((e) => e.node.label === 'CVE-2024-3094'),
    'Co-occurring CVE-2024-3094 linked to AS13335 across investigations'
  );
  assertCheck(
    asnHood.coOccurringEntities.some((e) => e.node.label === 'Volt Typhoon'),
    'Threat actor Volt Typhoon extracted and correlated'
  );

  await graph.removeDossierFromEvidenceGraph('reports/case_bravo_maritime.md');
  const afterPrune = await graph.getEvidenceGraphSnapshot();
  assertCheck(
    afterPrune.stats.totalDossiers === 1 && afterPrune.stats.bridgeCount === 0,
    'Pruning second dossier cleanly removes stale cross-investigation bridge counts'
  );

  console.log('\n=== 2. Spatial MCP Stations & Physical Room Tool Leashes ===');
  const mcp = await import('../src/services/SpatialMcpService');

  // Spin up ephemeral local stateless JSON-RPC 2.0 MCP server
  const mcpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const rpc = JSON.parse(body || '{}');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Mcp-Session-Id', 'sess_test_1');

      if (rpc.method === 'initialize') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: '2025-03-26',
              serverInfo: { name: 'MockOsintMcp', version: '1.0.0' },
              capabilities: { tools: {} },
            },
          })
        );
        return;
      }
      if (rpc.method === 'tools/list') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              tools: [
                {
                  name: 'whois_asn_sweep',
                  description: 'Stateless WHOIS & ASN lookup via MCP',
                  inputSchema: {
                    type: 'object',
                    properties: { domain: { type: 'string', description: 'Target domain' } },
                    required: ['domain'],
                  },
                },
              ],
            },
          })
        );
        return;
      }
      if (rpc.method === 'tools/call') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Verified MCP sweep for ${rpc.params?.arguments?.domain}`,
                },
              ],
            },
          })
        );
        return;
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } }));
    });
  });

  await new Promise<void>((resolve) => mcpServer.listen(0, '127.0.0.1', resolve));
  const port = (mcpServer.address() as any).port;
  const stationUrl = `http://127.0.0.1:${port}/mcp`;

  const station = await mcp.saveMcpStation({
    id: 'test_comms_mcp',
    name: 'Comms Recon MCP',
    serverUrl: stationUrl,
    room: 'comms_tower',
    enabled: true,
    strictRoomLeash: true,
    hasStoredToken: true,
    authHeaderName: 'Authorization',
    authTokenPlaintext: 'Bearer TOP_SECRET_MCP_TOKEN_999',
  });

  const probe = await mcp.probeMcpStationTools(station);
  assertCheck(probe.ok && probe.tools.length === 1, 'Stateless MCP client discovered remote tools/list');

  // Enable strict spatial tool leash enforcement
  mcp.saveSpatialLeashPolicy({
    ...mcp.DEFAULT_SPATIAL_LEASH_POLICY,
    strictEnforcement: true,
  });

  const blockedSweep = await mcp.evaluateSpatialToolLeash({
    toolName: 'osint_shodan_host_lookup',
    agentName: 'Operative Nyx',
    currentAgentRoom: 'war_room',
  });
  assertCheck(
    !blockedSweep.allowed && blockedSweep.decision === 'BLOCKED_BY_SPATIAL_LEASH',
    'External network sweep blocked outside Comms Tower under strict leash'
  );

  const allowedSweep = await mcp.evaluateSpatialToolLeash({
    toolName: 'osint_shodan_host_lookup',
    agentName: 'Operative Nyx',
    currentAgentRoom: 'comms_tower',
  });
  assertCheck(allowedSweep.allowed, 'External network sweep unlocked inside Comms Tower');

  const blockedVault = await mcp.evaluateSpatialToolLeash({
    toolName: 'decrypt_vault_secret',
    agentName: 'Operative Cipher',
    currentAgentRoom: 'comms_tower',
  });
  assertCheck(!blockedVault.allowed, 'Vault decryption blocked outside Server Vault');

  const allowedVault = await mcp.evaluateSpatialToolLeash({
    toolName: 'decrypt_vault_secret',
    agentName: 'Operative Cipher',
    currentAgentRoom: 'server_vault',
  });
  assertCheck(allowedVault.allowed, 'Vault decryption unlocked inside Server Vault');

  const declarationsInComms = await mcp.buildSpatialMcpFunctionDeclarations('comms_tower');
  const compositeName = declarationsInComms[0]?.name || '';
  assertCheck(
    compositeName.startsWith('mcp__'),
    `Generated Gemini MCP function declaration (${compositeName})`
  );

  const blockedMcpCall = await mcp.executeSpatialMcpToolCall({
    compositeToolName: compositeName,
    args: { domain: 'example.com' },
    agentName: 'Operative Nyx',
    currentAgentRoom: 'briefing_lounge',
  });
  assertCheck(
    !blockedMcpCall.ok && Boolean(blockedMcpCall.leashBlocked),
    'Remote MCP tools/call blocked when operative is outside bound room'
  );

  const allowedMcpCall = await mcp.executeSpatialMcpToolCall({
    compositeToolName: compositeName,
    args: { domain: 'cloudflare.com' },
    agentName: 'Operative Nyx',
    currentAgentRoom: 'comms_tower',
  });
  assertCheck(
    allowedMcpCall.ok &&
      JSON.stringify(allowedMcpCall.result).includes('Verified MCP sweep for cloudflare.com'),
    'Remote MCP tools/call executed cleanly inside Comms Tower'
  );

  mcpServer.close();

  // Reset strictEnforcement back to default non-blocking auto-walk after test
  mcp.saveSpatialLeashPolicy(mcp.DEFAULT_SPATIAL_LEASH_POLICY);

  console.log('\n=== 3. Shareable Mission Cartridges & Credential Scrubbing ===');
  const cartSvc = await import('../src/services/MissionCartridgeService');
  const exported = await cartSvc.exportCurrentSafehouseCartridge({
    name: 'Red Team Recon Export',
    crewSnapshots: [
      { id: 'vance', currentRoom: 'war_room', systemPrompt: 'Lead Strategist' },
      { id: 'nyx', currentRoom: 'comms_tower', systemPrompt: 'OSINT Recon' },
    ],
  });
  const exportedJson = JSON.stringify(exported);
  assertCheck(
    !exportedJson.includes('TOP_SECRET_MCP_TOKEN_999'),
    'Exported cartridge strictly scrubs vaulted MCP bearer secrets'
  );
  assertCheck(Boolean(exported.checksum), `Cartridge includes SHA-256 checksum (${exported.checksum})`);

  const validated = cartSvc.parseAndValidateCartridge(exportedJson);
  assertCheck(validated.ok && validated.cartridge?.name === 'Red Team Recon Export', 'Cartridge JSON validates cleanly');

  const applied = await cartSvc.applyMissionCartridge(cartSvc.BUILTIN_ARMORY_CARTRIDGES[0]);
  assertCheck(
    applied.appliedAgents >= 3 && applied.appliedTripwires >= 2,
    '1-click Armory Cartridge applies crew loadouts and tripwires'
  );

  console.log('\n=== 4. Deterministic SHA-256 Tripwire Diffing & Zero-Noise Gates ===');
  const trip = await import('../src/services/TripwireDiffService');
  const testWatch = await trip.saveTripwireWatch({
    id: 'tw_unit_dns_test',
    label: 'Unit DNS Watch',
    category: 'dns',
    target: 'pixelops.example',
    assignedRoom: 'comms_tower',
    assignedAgentId: 'nyx',
    intervalMinutes: 15,
    enabled: true,
    requireHumanApproval: true,
  });

  const alertsBefore = (await trip.listTripwireAlerts()).filter((a) => a.watchId === testWatch.id);

  // Run 1: Lock initial SHA-256 baseline -> 0 alerts
  const run1 = await trip.evaluateTripwireWatch(testWatch, {
    overrideLines: ['A 104.21.44.18', 'MX 10 mail.pixelops.example'],
  });
  assertCheck(run1.outcome === 'baseline_established', 'First run locks SHA-256 baseline silently');

  // Run 2: Identical records in reversed order -> canonical SHA-256 matches, 0 alerts!
  const run2 = await trip.evaluateTripwireWatch(run1.watch, {
    overrideLines: ['MX 10 mail.pixelops.example', 'A 104.21.44.18'],
  });
  const alertsAfterUnchanged = (await trip.listTripwireAlerts()).filter(
    (a) => a.watchId === testWatch.id
  );
  assertCheck(
    run2.outcome === 'unchanged' &&
      run2.watch.unchangedChecksCount === 1 &&
      alertsAfterUnchanged.length === alertsBefore.length,
    'Identical canonical snapshot produces ZERO alerts and increments unchanged counter'
  );

  // Run 3: Mutated DNS record -> verified SHA-256 delta + Human-in-the-Loop gate
  const run3 = await trip.evaluateTripwireWatch(run2.watch, {
    overrideLines: ['A 198.51.100.77', 'MX 10 mail.pixelops.example', 'TXT "v=spf1 -all"'],
  });
  assertCheck(
    run3.outcome === 'delta_detected' &&
      run3.addedItems.includes('A 198.51.100.77') &&
      run3.removedItems.includes('A 104.21.44.18') &&
      run3.alert?.status === 'pending_approval',
    'Mutated snapshot triggers exact +/- deterministic diff and pending_approval gate'
  );

  if (run3.alert) {
    const approved = await trip.updateTripwireAlertStatus(run3.alert.id, 'approved_dispatched');
    assertCheck(
      approved?.status === 'approved_dispatched',
      'Human-in-the-loop approval transitions alert state cleanly'
    );
  }

  console.log('\n=== 5. Tactical Voice Comms (Gemini 3.8 Live Config & PCM16 Codec) ===');
  const voice = await import('../src/services/TacticalVoiceService');
  const lowLat = voice.buildLiveSessionConfig('vance', 'gemini-3.8-live');
  assertCheck(
    lowLat.model === 'gemini-3.8-live' &&
      !('thinkingConfig' in lowLat.config) &&
      lowLat.config.responseModalities?.length === 1 &&
      lowLat.config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName === 'Charon',
    'gemini-3.8-live omits thinkingConfig and enforces single AUDIO modality + Charon voice'
  );

  const extThink = voice.buildLiveSessionConfig('cipher', 'gemini-3.8-live-extended-thinking');
  assertCheck(
    extThink.model === 'gemini-3.8-live-extended-thinking' &&
      extThink.config.thinkingConfig?.thinkingLevel === 'low' &&
      extThink.config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName === 'Puck',
    'gemini-3.8-live-extended-thinking enables low thinkingLevel + Puck voice'
  );

  // Test 48kHz -> 16kHz PCM16 base64 encode & decode round-trip
  const sine48k = new Float32Array(480);
  for (let i = 0; i < sine48k.length; i++) {
    sine48k[i] = Math.sin((i / 480) * Math.PI * 2) * 0.5;
  }
  const b64 = voice.encodeFloat32ToBase64Pcm16(sine48k, 48000, 16000);
  const decoded = voice.decodeBase64Pcm16ToFloat32(b64);
  assertCheck(
    decoded.length === 160 && Math.abs(decoded[40] - 0.5) < 0.05,
    'PCM16 48kHz->16kHz downsample & base64 round-trip preserves waveform amplitude'
  );

  // Verify Cloudflare Pages API middleware preserves 101 WebSocket upgrades without RangeError
  const apiMiddleware = await import('../functions/api/_middleware');
  const fakeUpgradeSentinel = { status: 101, webSocket: { accepted: true } } as unknown as Response;
  const passthroughRes = await apiMiddleware.onRequest({
    request: new Request('https://pixelops.app/api/gemini-live', {
      headers: { Upgrade: 'websocket' },
    }),
    next: async () => fakeUpgradeSentinel,
  });
  assertCheck(
    passthroughRes === fakeUpgradeSentinel && (passthroughRes as any).webSocket?.accepted === true,
    'Cloudflare /api/_middleware passes 101 WebSocket upgrade responses untouched'
  );

  // Verify zero-key Tactical Voice Relay connects cleanly to standby instead of error
  g.localStorage.clear();
  let observedRoute = '';
  const relayTx = new voice.TacticalRadioTransceiver({
    onTransportRoute: (r) => {
      observedRoute = r;
    },
  });
  await relayTx.connect('nyx', 'gemini-3.8-live');
  assertCheck(
    relayTx.getStatus() === 'standby' && observedRoute === 'tactical-relay',
    'Zero-key TacticalRadioTransceiver connects to standby via tactical-relay instead of error'
  );
  await relayTx.disconnect();

  // Verify encrypted BYOK Vault Gemini key is discovered asynchronously even when localStorage is scrubbed
  const secureVault = await import('../src/services/SecureVaultService');
  await secureVault.storeSecureCredential('pixelops_gemini_api_key', 'AIzaSyTestEncryptedLiveKey123456789');
  g.localStorage.removeItem('pixelops_gemini_api_key');
  g.localStorage.removeItem('gemini_api_key');
  const resolvedKey = await voice.resolveClientGeminiKeyAsync();
  assertCheck(
    resolvedKey === 'AIzaSyTestEncryptedLiveKey123456789',
    'resolveClientGeminiKeyAsync recovers encrypted BYOK Gemini key when plaintext localStorage is scrubbed'
  );
  await secureVault.deleteSecureCredential('pixelops_gemini_api_key');

  // Verify Hybrid VAD configuration, peak-safe smoothed gain, and continuous-window resampling
  assertCheck(
    lowLat.config.realtimeInputConfig?.automaticActivityDetection?.disabled === false &&
      lowLat.config.realtimeInputConfig?.automaticActivityDetection?.startOfSpeechSensitivity ===
        'START_SENSITIVITY_HIGH' &&
      lowLat.config.realtimeInputConfig?.automaticActivityDetection?.endOfSpeechSensitivity ===
        'END_SENSITIVITY_LOW' &&
      lowLat.config.realtimeInputConfig?.activityHandling === 'START_OF_ACTIVITY_INTERRUPTS',
    'buildLiveSessionConfig enables Hybrid VAD with high start sensitivity, low end sensitivity, and barge-in handling'
  );

  // 44.1kHz -> 16kHz and 8kHz -> 16kHz resampling accuracy checks
  const sine44k = new Float32Array(441);
  for (let i = 0; i < sine44k.length; i++) {
    sine44k[i] = Math.sin((i / 441) * Math.PI * 2) * 0.5;
  }
  const decoded44k = voice.decodeBase64Pcm16ToFloat32(
    voice.encodeFloat32ToBase64Pcm16(sine44k, 44100, 16000)
  );
  const sine8k = new Float32Array(80);
  for (let i = 0; i < sine8k.length; i++) {
    sine8k[i] = Math.sin((i / 80) * Math.PI * 2) * 0.4;
  }
  const decoded8k = voice.decodeBase64Pcm16ToFloat32(
    voice.encodeFloat32ToBase64Pcm16(sine8k, 8000, 16000)
  );
  assertCheck(
    decoded44k.length === 160 &&
      Math.abs(decoded44k[40] - 0.5) < 0.05 &&
      decoded8k.length === 160 &&
      Math.abs(decoded8k[40] - 0.4) < 0.05,
    'Continuous-window anti-aliasing resampler handles 44.1kHz -> 16kHz and 8kHz -> 16kHz cleanly'
  );

  const quietWave = new Float32Array(256);
  for (let i = 0; i < quietWave.length; i++) {
    quietWave[i] = Math.sin((i / 256) * Math.PI * 2) * 0.02;
  }
  const boosted = voice.normalizeMicChunkForSpeech(quietWave);
  const zeroWave = new Float32Array(128);
  const unboostedZero = voice.normalizeMicChunkForSpeech(zeroWave);
  const hissWave = new Float32Array(128);
  for (let i = 0; i < hissWave.length; i++) {
    hissWave[i] = Math.sin((i / 128) * Math.PI * 2) * 0.003;
  }
  const unboostedHiss = voice.normalizeMicChunkForSpeech(hissWave);
  const transientWave = new Float32Array(256);
  transientWave[32] = 0.65;
  transientWave[33] = 0.35;
  const peakLimited = voice.normalizeMicChunkForSpeech(transientWave);
  let maxOut = 0;
  for (let i = 0; i < peakLimited.samples.length; i++) {
    const abs = Math.abs(peakLimited.samples[i]);
    if (abs > maxOut) maxOut = abs;
  }
  assertCheck(
    boosted.samples[64] > quietWave[64] * 2.0 &&
      unboostedZero.rms === 0 &&
      unboostedZero.appliedGain === 1 &&
      unboostedHiss.appliedGain === 1 &&
      maxOut <= 0.885,
    'normalizeMicChunkForSpeech boosts quiet speech, leaves silence/room hiss unboosted, and peak-limits plosives without clipping'
  );

  // Verify end-to-end warm-mic PTT lifecycle, Hybrid VAD audioStreamEnd, text sendClientContent, and transcript merging
  const sentRealtimePayloads: any[] = [];
  const sentClientContentPayloads: any[] = [];
  let resumeCalled = false;
  let capturedProcessor: any = null;
  let getUserMediaCount = 0;
  let stoppedTracksCount = 0;
  const prevAudioCtx = g.AudioContext;
  const origMediaDevicesDesc = Object.getOwnPropertyDescriptor(globalThis.navigator, 'mediaDevices');

  try {
    g.AudioContext = class MockAudioContext {
      public sampleRate = 48000;
      public state: string = 'suspended';
      public destination = {};
      public audioWorklet = undefined;
      public async resume() {
        resumeCalled = true;
        this.state = 'running';
      }
      public createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      public createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }
      public createScriptProcessor() {
        capturedProcessor = { onaudioprocess: null, connect() {}, disconnect() {} };
        return capturedProcessor;
      }
      public async close() {
        this.state = 'closed';
      }
    };

    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          getUserMediaCount++;
          return {
            getTracks: () => [
              {
                readyState: 'live',
                stop() {
                  stoppedTracksCount++;
                },
              },
            ],
          };
        },
      },
    });

    let latestTranscripts: any[] = [];
    const pttTx = new voice.TacticalRadioTransceiver({
      onTranscriptUpdate: (entries) => {
        latestTranscripts = entries;
      },
    });
    (pttTx as any).session = {
      sendRealtimeInput: (payload: any) => {
        sentRealtimePayloads.push(payload);
      },
      sendClientContent: (payload: any) => {
        sentClientContentPayloads.push(payload);
      },
      close() {},
    };
    (pttTx as any).status = 'standby';

    await pttTx.startPushToTalk();
    assertCheck(
      resumeCalled && Boolean(capturedProcessor?.onaudioprocess) && getUserMediaCount === 1,
      'startPushToTalk unlocks suspended AudioContext synchronously and wires mic processor'
    );

    const fakeSpeechBuf = new Float32Array(2048);
    for (let i = 0; i < fakeSpeechBuf.length; i++) {
      fakeSpeechBuf[i] = Math.sin((i / 64) * Math.PI * 2) * 0.25;
    }
    capturedProcessor.onaudioprocess({
      inputBuffer: { getChannelData: () => fakeSpeechBuf },
    });

    pttTx.stopPushToTalk();

    const hasPcmAudio = sentRealtimePayloads.some(
      (p) => p?.audio?.mimeType === 'audio/pcm;rate=16000' && typeof p?.audio?.data === 'string' && p.audio.data.length > 0
    );
    const hasAudioStreamEnd = sentRealtimePayloads.some((p) => p?.audioStreamEnd === true);
    assertCheck(
      hasPcmAudio && hasAudioStreamEnd && stoppedTracksCount === 0,
      'Hybrid VAD PTT streams 16kHz PCM audio, emits audioStreamEnd on stop, and keeps mic warm in standby'
    );

    // Second PTT press reuses warm mic stream without re-opening getUserMedia
    sentRealtimePayloads.length = 0;
    await pttTx.startPushToTalk();
    pttTx.stopPushToTalk();
    assertCheck(
      getUserMediaCount === 1 && sentRealtimePayloads.some((p) => p?.audioStreamEnd === true),
      'Subsequent PTT press reuses warm mic stream cleanly without calling getUserMedia again'
    );

    // Typed radio text uses ordered sendClientContent with role: user and turnComplete: true
    sentClientContentPayloads.length = 0;
    pttTx.sendTextDispatchOverRadio('Sitrep');
    const cc = sentClientContentPayloads[0];
    assertCheck(
      sentClientContentPayloads.length === 1 &&
        cc?.turns?.[0]?.role === 'user' &&
        cc?.turns?.[0]?.parts?.[0]?.text === 'Sitrep' &&
        cc?.turnComplete === true,
      'sendTextDispatchOverRadio dispatches structured user turn via sendClientContent(turnComplete: true)'
    );

    // Interleaved server inputTranscription / outputTranscription events merge cleanly per speaker
    pttTx.clearTranscripts();
    await (pttTx as any).handleIncomingMessage({
      serverContent: { inputTranscription: { text: 'Hello ' } },
    });
    await (pttTx as any).handleIncomingMessage({
      serverContent: { outputTranscription: { text: 'Copy, ' } },
    });
    await (pttTx as any).handleIncomingMessage({
      serverContent: { inputTranscription: { text: 'Vance.' } },
    });
    await (pttTx as any).handleIncomingMessage({
      serverContent: { outputTranscription: { text: 'Commander.' }, turnComplete: true },
    });
    assertCheck(
      latestTranscripts.length === 2 &&
        latestTranscripts[0].speaker === 'COMMANDER' &&
        latestTranscripts[0].text === 'Hello Vance.' &&
        latestTranscripts[1].speaker === 'OPERATIVE' &&
        latestTranscripts[1].text === 'Copy, Commander.',
      'Interleaved inputTranscription and outputTranscription events merge into coherent per-speaker bubbles'
    );

    await pttTx.disconnect();
    assertCheck(
      stoppedTracksCount >= 1,
      'disconnect releases warm MediaStream tracks cleanly'
    );
  } finally {
    g.AudioContext = prevAudioCtx;
    if (origMediaDevicesDesc) {
      Object.defineProperty(globalThis.navigator, 'mediaDevices', origMediaDevicesDesc);
    } else {
      delete (globalThis.navigator as any).mediaDevices;
    }
  }

  console.log(
    failures === 0 ? '\nALL 5 PILLAR TESTS PASSED!' : `\n${failures} TEST(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
