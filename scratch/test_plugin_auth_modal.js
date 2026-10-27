/**
 * Comprehensive Test Suite for Local BYOK Plugin Authentication & Credential Modal
 * (scratch/test_plugin_auth_modal.js)
 */

import {
  savePluginCredential,
  getPluginCredential,
  clearPluginCredential,
  getAllPluginCredentials,
  isPluginAuthenticated,
  maskCredential,
  exportPluginCredentials,
  importPluginCredentials,
  subscribeToPluginAuth,
  normalizePluginId,
} from '../src/engine/pluginAuthManager.js';

import { executeCLICommand } from '../src/engine/pixelOpsCLI.js';

// Setup minimal localStorage mock for Node test environment if not present
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] || null,
    get length() {
      return store.size;
    },
  };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('=== RUNNING PLUGIN AUTH & CREDENTIAL MANAGER TEST SUITE ===\n');

  // Test 1: Normalize Plugin ID
  console.log('Test 1: Normalizing Plugin IDs');
  assert(normalizePluginId('web_search') === 'web_search', 'Standard ID normalizes cleanly');
  assert(normalizePluginId('plugin_auth_mintoauth') === 'mintoauth', 'Prefix plugin_auth_ stripped');
  assert(normalizePluginId('pixelops_plugin_auth_GITHUB') === 'github', 'Prefix pixelops_plugin_auth_ stripped and lowercased');

  // Test 2: Mask Credential helper
  console.log('\nTest 2: Masking Sensitive Credentials');
  assert(maskCredential('') === '[NO TOKEN CONFIGURED]', 'Empty string returns no token configured');
  assert(maskCredential(null) === '[NO TOKEN CONFIGURED]', 'Null returns no token configured');
  assert(maskCredential('1234') === '••••••••', 'Short secret masked completely');
  assert(maskCredential('ghp_1234567890abcdef') === 'ghp_••••••••cdef', 'Long token shows 4 char prefix and suffix');

  // Test 3: Unauthenticated state
  console.log('\nTest 3: Initial Unauthenticated Verification');
  clearPluginCredential('test_slack');
  assert(isPluginAuthenticated('test_slack') === false, 'Unconfigured plugin returns isPluginAuthenticated = false');
  assert(getPluginCredential('test_slack') === null, 'Unconfigured plugin returns getPluginCredential = null');

  // Test 4: Save credential as string
  console.log('\nTest 4: Save Credential (Simple String)');
  const saved1 = savePluginCredential('test_slack', 'xoxb-9876543210-abcdef');
  assert(saved1.apiKey === 'xoxb-9876543210-abcdef', 'Saved apiKey matches input string');
  assert(saved1.pluginId === 'test_slack', 'Saved pluginId matches input');
  assert(isPluginAuthenticated('test_slack') === true, 'isPluginAuthenticated returns true after saving');

  // Test 5: Verify persistent storage key format
  console.log('\nTest 5: Storage Key Format Verification');
  const rawStored = localStorage.getItem('plugin_auth_test_slack');
  assert(rawStored !== null, 'Stored in localStorage under "plugin_auth_test_slack" key');
  const parsedStored = JSON.parse(rawStored);
  assert(parsedStored.apiKey === 'xoxb-9876543210-abcdef', 'LocalStorage JSON payload is intact');

  // Test 6: Save credential as rich object
  console.log('\nTest 6: Save Credential (Rich BYOK Object)');
  const saved2 = savePluginCredential('mintoauth', {
    apiKey: 'ya29.a0AfH6SM-byok-oauth-token-test',
    accountHandle: 'lead-operative@safehouse.net',
    endpointUrl: 'https://oauth2.googleapis.com/token',
    metadata: { tier: 'omega' },
  });
  assert(saved2.pluginId === 'mintoauth', 'Rich object saved with pluginId mintoauth');
  assert(saved2.accountHandle === 'lead-operative@safehouse.net', 'Account handle persisted');
  assert(saved2.endpointUrl === 'https://oauth2.googleapis.com/token', 'Custom endpoint persisted');
  assert(isPluginAuthenticated('mintoauth') === true, 'mintoauth is authenticated');

  // Test 7: Get All Plugin Credentials
  console.log('\nTest 7: Retrieving All Plugin Credentials');
  const allCreds = getAllPluginCredentials();
  assert(allCreds['test_slack'] !== undefined, 'allCreds contains test_slack');
  assert(allCreds['mintoauth'] !== undefined, 'allCreds contains mintoauth');

  // Test 8: Export & Import Credentials
  console.log('\nTest 8: Export and Import Credentials');
  const exportedSanitized = exportPluginCredentials(false);
  assert(exportedSanitized.includes('••••••••'), 'Export without sensitive secrets masks tokens');
  const exportedFull = exportPluginCredentials(true);
  assert(exportedFull.includes('xoxb-9876543210-abcdef'), 'Export with sensitive secrets retains tokens');

  const importResult = importPluginCredentials(
    JSON.stringify([
      { pluginId: 'custom_api_test', apiKey: 'sk-proj-test123456789' },
    ])
  );
  assert(importResult.importedCount === 1, 'Imported 1 credential from JSON string');
  assert(isPluginAuthenticated('custom_api_test') === true, 'Imported credential is active');

  // Test 9: Reactive Event Subscription
  console.log('\nTest 9: Change Event Subscription');
  let eventFired = false;
  let receivedPluginId = '';
  const unsubscribe = subscribeToPluginAuth((pId, cred) => {
    eventFired = true;
    receivedPluginId = pId;
  });

  savePluginCredential('event_test_plugin', 'token-12345');
  assert(eventFired === true, 'Listener was notified on save');
  assert(receivedPluginId === 'event_test_plugin', 'Listener received correct plugin ID');
  unsubscribe();

  // Test 10: Clear / Revoke Credential
  console.log('\nTest 10: Clear & Revoke Credential');
  const cleared = clearPluginCredential('test_slack');
  assert(cleared === true, 'clearPluginCredential returned true');
  assert(isPluginAuthenticated('test_slack') === false, 'isPluginAuthenticated is false after revoke');
  assert(getPluginCredential('test_slack') === null, 'getPluginCredential is null after revoke');
  assert(localStorage.getItem('plugin_auth_test_slack') === null, 'Removed from localStorage');

  // Test 11: CLI Integration (`pixelops plugins`, `pixelops plugin auth`, `pixelops plugin revoke`)
  console.log('\nTest 11: CLI Headless Command Execution');
  const cliContext = { crewAgents: [] };

  const cliList = await executeCLICommand('pixelops plugins', cliContext);
  assert(cliList.status === 'ok', 'pixelops plugins returned ok status');
  assert(cliList.output.includes('PIXELOPS BYOK PLUGIN CREDENTIALS'), 'CLI list header present');

  const cliAuth = await executeCLICommand('pixelops plugin auth github ghp_mock999988887777', cliContext);
  assert(cliAuth.status === 'ok', 'pixelops plugin auth returned ok status');
  assert(cliAuth.output.includes('[BYOK SAVED]'), 'CLI confirmation output includes [BYOK SAVED]');
  assert(isPluginAuthenticated('github') === true, 'github is authenticated after CLI command');

  const cliRevoke = await executeCLICommand('pixelops plugin revoke github', cliContext);
  assert(cliRevoke.status === 'ok', 'pixelops plugin revoke returned ok status');
  assert(cliRevoke.output.includes('[TOKEN REVOKED]'), 'CLI confirmation output includes [TOKEN REVOKED]');
  assert(isPluginAuthenticated('github') === false, 'github is unauthenticated after CLI revoke');

  console.log(`\n=================================================`);
  console.log(`TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED.`);
  console.log(`=================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
