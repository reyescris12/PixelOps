/**
 * Workspace File Viewer & IndexedDB Storage Bridge Test Suite
 */

import assert from 'assert';

// Mock localStorage for node environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] || null,
    get length() {
      return store.size;
    },
  };
}

// Import storage manager
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  seedInitialWorkspaceFiles,
  resolveCategoryFromPath,
  resolveFormatFromPath,
  SAMPLE_MASTER_EXECUTION_SCHEDULE,
} from '../src/engine/storageManager.js';

import { executeCLICommand } from '../src/engine/pixelOpsCLI.js';

async function runTests() {
  console.log('=== STARTING WORKSPACE FILE VIEWER & INDEXEDDB STORAGE TEST SUITE ===\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
      failed++;
    }
  }

  // 1. Path & Category Resolution
  console.log('--- 1. Testing Path & Category Resolution ---');
  test('Resolves "reports" category from reports/ prefix', () => {
    assert.strictEqual(resolveCategoryFromPath('reports/master_execution_schedule.md'), 'reports');
  });

  test('Resolves "logs" category from logs/ prefix', () => {
    assert.strictEqual(resolveCategoryFromPath('logs/agent_vance.log'), 'logs');
  });

  test('Resolves "config" category from config/ prefix', () => {
    assert.strictEqual(resolveCategoryFromPath('config/protocols.json'), 'config');
  });

  test('Resolves markdown format from .md extension', () => {
    assert.strictEqual(resolveFormatFromPath('reports/brief.md'), 'markdown');
  });

  test('Resolves json format from .json extension', () => {
    assert.strictEqual(resolveFormatFromPath('config/settings.json'), 'json');
  });

  // 2. Storage Operations (CRUD)
  console.log('\n--- 2. Testing Storage CRUD & Empty States ---');
  await testAsync('Empty state: listWorkspaceFiles returns empty array safely', async () => {
    localStorage.clear();
    const files = await listWorkspaceFiles();
    assert(Array.isArray(files), 'Must return an array');
  });

  await testAsync('Write file: saves markdown report with correct metadata', async () => {
    const written = await writeWorkspaceFile(
      'reports/master_execution_schedule.md',
      SAMPLE_MASTER_EXECUTION_SCHEDULE
    );
    assert.strictEqual(written.path, 'reports/master_execution_schedule.md');
    assert.strictEqual(written.category, 'reports');
    assert.strictEqual(written.format, 'markdown');
    assert(written.sizeBytes > 100, 'Size must be calculated');
  });

  await testAsync('Read file: retrieves saved file content and metadata', async () => {
    const file = await readWorkspaceFile('reports/master_execution_schedule.md');
    assert(file !== null, 'File must exist');
    assert(file.content.includes('Master Execution Schedule'), 'Content must match');
    assert(file.content.includes('OMEGA-RESTRICTED'), 'Must contain classification header');
  });

  await testAsync('List files: lists all stored files including newly added ones', async () => {
    await writeWorkspaceFile('logs/cipher_recon.log', 'Perimeter sweep clear at 0100');
    await writeWorkspaceFile('config/radar.json', '{"frequency": "142.8MHz"}');

    const all = await listWorkspaceFiles();
    assert(all.length >= 3, `Expected at least 3 files, got ${all.length}`);

    const reportOnly = await listWorkspaceFiles('reports');
    assert(reportOnly.every((f) => f.category === 'reports'), 'Must filter by category');
  });

  await testAsync('Delete file: deletes file and removes from listings', async () => {
    const deleted = await deleteWorkspaceFile('logs/cipher_recon.log');
    assert.strictEqual(deleted, true, 'Delete must report success');

    const check = await readWorkspaceFile('logs/cipher_recon.log');
    assert.strictEqual(check, null, 'Deleted file must not exist');
  });

  await testAsync('Seed files: seeds master_execution_schedule.md and config', async () => {
    const seeded = await seedInitialWorkspaceFiles(true);
    assert(seeded.length >= 2, 'Must seed at least 2 files');
    const schedule = seeded.find((f) => f.path.includes('master_execution_schedule.md'));
    assert(schedule, 'master_execution_schedule.md must be seeded');
  });

  // 3. CLI Integration
  console.log('\n--- 3. Testing CLI files & cat Commands ---');
  await testAsync('CLI "files" lists stored reports', async () => {
    const res = await executeCLICommand('files', { crewAgents: [] });
    assert.strictEqual(res.status, 'ok');
    assert(res.output.includes('master_execution_schedule.md'), 'CLI files output must list schedule');
  });

  await testAsync('CLI "cat" reads report content directly', async () => {
    const res = await executeCLICommand('cat reports/master_execution_schedule.md', { crewAgents: [] });
    assert.strictEqual(res.status, 'ok');
    assert(res.output.includes('Master Execution Schedule'), 'CLI cat must print content');
  });

  console.log(`\n=============================================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log(`=============================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Test runner encountered unexpected error:', e);
  process.exit(1);
});
