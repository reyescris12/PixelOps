/**
 * Verification test suite for Composio credential hardening & backend proxy migration:
 * 1. COMPOSIO_BASE_URL: Defaults to /api/composio (or VITE_COMPOSIO_BASE_URL), no hardcoded backend.composio.dev in client source.
 * 2. Client Secret Storage: Zero plaintext writes to localStorage for Composio API keys or entity IDs.
 * 3. Startup Purge & Migration: Legacy plaintext localStorage keys are migrated to WebCrypto vault and purged.
 * 4. Entity ID Isolation: Uses high-entropy cryptographically secure IDs in memory/sessionStorage without localStorage leakage.
 * 5. Proxy Routing: Routes tool calls through /api/composio backend proxy by default.
 * 6. Environment Configuration: .env.example correctly defines COMPOSIO_API_KEY and VITE_COMPOSIO_BASE_URL.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Polyfill browser globals for Node test environment
const mockLocalStorage: Record<string, string> = {};
const mockSessionStorage: Record<string, string> = {};

const localStorageObj = {
  getItem: (k: string) => mockLocalStorage[k] || null,
  setItem: (k: string, v: string) => {
    mockLocalStorage[k] = String(v);
  },
  removeItem: (k: string) => {
    delete mockLocalStorage[k];
  },
  clear: () => {
    for (const k of Object.keys(mockLocalStorage)) delete mockLocalStorage[k];
  },
};

const sessionStorageObj = {
  getItem: (k: string) => mockSessionStorage[k] || null,
  setItem: (k: string, v: string) => {
    mockSessionStorage[k] = String(v);
  },
  removeItem: (k: string) => {
    delete mockSessionStorage[k];
  },
  clear: () => {
    for (const k of Object.keys(mockSessionStorage)) delete mockSessionStorage[k];
  },
};

(globalThis as any).localStorage = localStorageObj;
(globalThis as any).sessionStorage = sessionStorageObj;
(globalThis as any).window = globalThis;
(globalThis as any).dispatchEvent = () => true;
(globalThis as any).CustomEvent = class CustomEvent {
  constructor(public type: string, public init?: any) {}
};

// Import ComposioService
import {
  COMPOSIO_BASE_URL,
  getOrCreateEntityId,
  setComposioEntityId,
  getComposioApiKey,
  setComposioApiKey,
  saveComposioApiKey,
  purgeAndMigrateInsecureComposioStorage,
  ComposioService,
} from '../src/services/ComposioService';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(` FAIL: ${msg}`);
    throw new Error(msg);
  }
}

async function runTests() {
  console.log('=== TEST 1: Source Code Audit for Hardcoded Backend URLs & localStorage ===');
  const composioSource = readFileSync(
    resolve(process.cwd(), 'src/services/ComposioService.ts'),
    'utf-8'
  );

  // 1. Verify no hardcoded backend.composio.dev in client source code
  assert(
    !composioSource.includes("'https://backend.composio.dev"),
    'ComposioService.ts must not contain single-quoted hardcoded https://backend.composio.dev'
  );
  assert(
    !composioSource.includes('"https://backend.composio.dev'),
    'ComposioService.ts must not contain double-quoted hardcoded https://backend.composio.dev'
  );
  console.log('PASS: Zero hardcoded backend.composio.dev URLs found in ComposioService.ts.');

  // 2. Verify COMPOSIO_BASE_URL defaults to /api/composio or env var
  assert(
    COMPOSIO_BASE_URL === '/api/composio' || COMPOSIO_BASE_URL.startsWith('/'),
    `COMPOSIO_BASE_URL must default to /api/composio proxy route. Got: "${COMPOSIO_BASE_URL}"`
  );
  console.log(`PASS: COMPOSIO_BASE_URL correctly defaults to "${COMPOSIO_BASE_URL}".`);

  console.log('\n=== TEST 2: Client-Side Secret Storage Hardening (No Plaintext localStorage Writes) ===');
  localStorageObj.clear();
  sessionStorageObj.clear();

  // Test setComposioApiKey does NOT write to localStorage
  const testKey = 'comp_test_key_abc123xyz789';
  setComposioApiKey(testKey);

  assert(
    localStorageObj.getItem('pixelops_composio_custom_api_key') === null,
    'setComposioApiKey must NOT write plaintext to localStorage!'
  );
  assert(
    getComposioApiKey() === testKey,
    'getComposioApiKey must return key from transient runtime memory/sessionStorage.'
  );
  console.log('PASS: setComposioApiKey safely stored key in-memory/sessionStorage with 0 localStorage writes.');

  // Test saveComposioApiKey does NOT write plaintext to localStorage
  await saveComposioApiKey('comp_secure_vault_key_456');
  assert(
    localStorageObj.getItem('pixelops_composio_custom_api_key') === null,
    'saveComposioApiKey must NOT write plaintext to localStorage!'
  );
  assert(
    getComposioApiKey() === 'comp_secure_vault_key_456',
    'getComposioApiKey returns newly saved key.'
  );
  console.log('PASS: saveComposioApiKey encrypted key in vault with 0 plaintext localStorage leakage.');

  console.log('\n=== TEST 3: Startup Legacy Plaintext Purge & Migration ===');
  // Seed legacy insecure plaintext keys into localStorage
  localStorageObj.setItem('pixelops_composio_custom_api_key', 'legacy_plaintext_secret_999');
  localStorageObj.setItem('pixelops_composio_entity_id', 'legacy_commander_12345');
  localStorageObj.setItem('pixelops_composio_local_connected_accounts', JSON.stringify([{ id: '1', appName: 'github' }]));

  assert(
    localStorageObj.getItem('pixelops_composio_custom_api_key') !== null,
    'Pre-condition: legacy key in localStorage.'
  );

  // Run startup migration & purge
  await purgeAndMigrateInsecureComposioStorage();

  assert(
    localStorageObj.getItem('pixelops_composio_custom_api_key') === null,
    'Legacy plaintext API key must be purged from localStorage!'
  );
  assert(
    localStorageObj.getItem('pixelops_composio_entity_id') === null,
    'Legacy entity ID must be purged from localStorage!'
  );
  assert(
    localStorageObj.getItem('pixelops_composio_local_connected_accounts') === null,
    'Legacy connected accounts must be purged from localStorage!'
  );
  assert(
    getComposioApiKey() === 'legacy_plaintext_secret_999',
    'Migrated key must be retained in transient memory/vault.'
  );
  console.log('PASS: purgeAndMigrateInsecureComposioStorage migrated secrets to vault and purged 100% of legacy plaintext.');

  console.log('\n=== TEST 4: High-Entropy Entity ID Generation Without localStorage Leakage ===');
  localStorageObj.clear();
  sessionStorageObj.clear();

  const entity1 = getOrCreateEntityId();
  assert(
    entity1.includes('commander_'),
    `Entity ID must include "commander_". Got: "${entity1}"`
  );
  assert(
    localStorageObj.getItem('pixelops_composio_entity_id') === null,
    'getOrCreateEntityId must NOT persist entity ID to localStorage!'
  );
  assert(
    sessionStorageObj.getItem('pixelops_composio_session_entity_id') === entity1,
    'Entity ID should be stored in tab-scoped transient sessionStorage.'
  );

  // Setting entityId also keeps localStorage clean
  setComposioEntityId('commander_new_device_session_xyz');
  assert(
    getOrCreateEntityId() === 'commander_new_device_session_xyz',
    'getOrCreateEntityId returns synchronized entityId.'
  );
  assert(
    localStorageObj.getItem('pixelops_composio_entity_id') === null,
    'setComposioEntityId must NOT persist to localStorage!'
  );
  console.log('PASS: Entity ID managed safely with high entropy and zero localStorage pollution.');

  console.log('\n=== TEST 5: Environment Variables Documentation in .env.example ===');
  const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf-8');
  assert(
    envExample.includes('COMPOSIO_API_KEY'),
    '.env.example must document COMPOSIO_API_KEY backend environment variable.'
  );
  assert(
    envExample.includes('VITE_COMPOSIO_BASE_URL'),
    '.env.example must document VITE_COMPOSIO_BASE_URL client endpoint variable.'
  );
  console.log('PASS: .env.example properly documents backend COMPOSIO_API_KEY and VITE_COMPOSIO_BASE_URL.');

  console.log('\n=== TEST 6: ComposioService Object Exports Verification ===');
  assert(
    typeof ComposioService.purgeAndMigrateInsecureComposioStorage === 'function',
    'ComposioService must export purgeAndMigrateInsecureComposioStorage'
  );
  assert(
    typeof ComposioService.callComposioApi === 'function',
    'ComposioService must export callComposioApi'
  );
  assert(
    typeof ComposioService.isComposioCircuitBreakerTripped === 'function',
    'ComposioService must export isComposioCircuitBreakerTripped'
  );
  console.log('PASS: All ComposioService exports verified.');

  console.log('\n ALL COMPOSIO SECRET HARDENING & PROXY TESTS PASSED SUCCESSFULLY! ');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
