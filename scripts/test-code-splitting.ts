/**
 * Smoke test for the code-splitting refactor:
 *  - ApiCore / ApiService:     ApiService re-exports ApiCore (same identities), lazy facade loads the engine.
 *  - spriteWorld / SpriteCanvas: SpriteCanvas re-exports the extracted world model unchanged.
 *  - intelligencePlaybooks:   definitions stay in the light module; pipelines resolve via dynamic import.
 *  - Startup graph:           App.tsx and eager services no longer statically import the heavy modules.
 * Usage: npx tsx scripts/test-code-splitting.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Minimal browser globals so modules that touch storage at import time can load under Node.
const store = () => {
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
g.localStorage ??= store();
g.sessionStorage ??= store();
g.window ??= g;
g.dispatchEvent ??= () => true;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.CustomEvent ??= class {
  constructor(public type: string, public detail?: any) {}
};

let failures = 0;
function check(cond: unknown, msg: string) {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const staticImports = (code: string, mod: string) =>
  new RegExp(`^import\\s+(?!type\\b)[^;]*from\\s+'[./]+(?:[\\w]+/)*${mod}';`, 'm').test(code);

async function main() {
  console.log('=== 1. ApiCore is re-exported by ApiService with identical bindings ===');
  const core = await import('../src/services/ApiCore');
  const lazy = await import('../src/services/agentEngineLazy');
  const api = await lazy.loadAgentEngine();
  for (const name of [
    'loadPreferences',
    'savePreferences',
    'loadExecutionCards',
    'loadPlugins',
    'createRetroAgentError',
    'classifyRetroErrorCode',
    'RetroAgentError',
    'checkServerStatus',
    'isValidRealTask',
    'loadRoundtableSessions',
    'DEFAULT_PLUGINS',
  ] as const) {
    check((api as any)[name] === (core as any)[name], `ApiService.${name} === ApiCore.${name}`);
  }
  const err = core.createRetroAgentError({ code: 'RATE_LIMIT' });
  check(err instanceof api.RetroAgentError, 'RetroAgentError instanceof works across both import paths');
  check(core.classifyRetroErrorCode({ status: 429 }) === 'RATE_LIMIT', 'classifyRetroErrorCode still classifies 429');
  check(core.loadPreferences().temperature === 0.7, 'loadPreferences returns defaults on empty storage');

  console.log('\n=== 2. Lazy agent engine facade ===');
  check(typeof api.executeAgentDirective === 'function', 'engine exposes executeAgentDirective');
  check(typeof api.executeRoundtableMeeting === 'function', 'engine exposes executeRoundtableMeeting');
  check((await lazy.loadAgentEngine()) === api, 'loadAgentEngine() memoizes the module');
  check(typeof lazy.executeAgentDirective === 'function', 'facade exports executeAgentDirective wrapper');

  console.log('\n=== 3. spriteWorld extraction preserves SpriteCanvas exports ===');
  const world = await import('../src/components/spriteWorld');
  const canvasSrc = src('src/components/SpriteCanvas.tsx');
  check(canvasSrc.includes("export * from './spriteWorld';"), 'SpriteCanvas re-exports spriteWorld');
  check(canvasSrc.includes("export { AgentSpriteFigure } from './AgentSpriteFigure';"), 'SpriteCanvas re-exports AgentSpriteFigure');
  check(Array.isArray(world.ROOM_ORDER) && world.ROOM_ORDER.length >= 7, 'ROOM_ORDER has all sectors');
  check(Object.keys(world.ROOM_METADATA).length >= 7, 'ROOM_METADATA populated');
  check(world.getTownHallSeat(0).id === 'war_seat_0', 'getTownHallSeat(0) preset seat');
  check(world.TOWN_HALL_SEATS[12].id === 'war_seat_12', 'TOWN_HALL_SEATS proxy computes dynamic seats');
  const path = world.buildAgentWaypointPath('war_room', 40, 80, 'war_room', world.getTownHallSeat(2));
  check(Array.isArray(path) && path.length > 0, 'buildAgentWaypointPath returns a route');

  console.log('\n=== 3b. Single source of truth for room data ===');
  const roomData = await import('../src/engine/roomData');
  for (const k of ['ROOM_ORDER', 'ROOM_STATIONS', 'ROOM_METADATA', 'ROOM_OBSTACLES', 'ROOM_CORRIDOR_WAYPOINTS'] as const) {
    check((world as any)[k] === (roomData as any)[k], `spriteWorld.${k} is the same object as roomData.${k}`);
  }
  const knownStationIds = new Set(Object.values(roomData.ROOM_STATIONS).flat().map((s) => s.id));
  const appStationLiterals = [...src('src/App.tsx').matchAll(/targetStation\s*=[^;]*/g)]
    .flatMap((m) => [...m[0].matchAll(/'([a-z]+_[a-z_]+)'/g)].map((x) => x[1]));
  const unknown = appStationLiterals.filter((id) => !knownStationIds.has(id));
  check(appStationLiterals.length > 0 && unknown.length === 0, `all ${appStationLiterals.length} station ids routed by App exist on the canvas${unknown.length ? ' (unknown: ' + unknown.join(', ') + ')' : ''}`);

  console.log('\n=== 4. Playbook pipelines load on demand ===');
  const playbooks = await import('../src/engine/intelligencePlaybooks');
  check(Object.keys(playbooks.INTELLIGENCE_PLAYBOOKS).length > 0, 'playbook definitions available eagerly');
  check(typeof playbooks.executeIntelligencePlaybook === 'function', 'executeIntelligencePlaybook still exported');
  const pipelines = await import('../src/engine/playbookPipelines');
  check(typeof pipelines.runPlaybookPipeline === 'function', 'playbookPipelines.runPlaybookPipeline resolves');
  let unknownErr = '';
  try {
    await playbooks.executeIntelligencePlaybook('does_not_exist' as any, { targetName: 't', targetScope: 't' });
  } catch (e: any) {
    unknownErr = String(e?.message || e);
  }
  check(unknownErr.includes('Unknown playbook ID'), 'dispatch reaches pipelines module (unknown ID rejected)');

  console.log('\n=== 5. Startup graph no longer statically imports heavy modules ===');
  const app = src('src/App.tsx');
  check(!staticImports(app, 'ApiService'), 'App.tsx has no static ApiService import');
  check(!staticImports(app, 'SyncService'), 'App.tsx has no static SyncService import');
  check(!staticImports(app, 'iswFeedService'), 'App.tsx has no static iswFeedService import');
  check(!staticImports(app, 'ClassifiedFeedService'), 'App.tsx has no static ClassifiedFeedService import');
  for (const f of ['src/services/NightShiftService.ts', 'src/services/TaskChainService.ts', 'src/services/SecureVaultService.ts', 'src/engine/intelligencePlaybooks.ts']) {
    check(!staticImports(src(f), 'ApiService'), `${f} has no static ApiService import`);
  }
  for (const f of ['src/services/OpenRouterAuth.ts', 'src/engine/pixelOpsCLI.ts']) {
    check(!staticImports(src(f), 'SyncService'), `${f} has no static SyncService import`);
  }

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CODE-SPLITTING CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
