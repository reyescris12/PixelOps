/**
 * Test Suite: Vault Security, Non-Extractable WebCrypto, SSRF Guard, and Legacy Storage Purge
 */

import {
  getLocalMasterKey,
  storeSecureCredential,
  getSecureCredential,
  deleteSecureCredential,
  purgeLegacyStorage,
  getRawEncryptedCredentialForVerification,
} from '../src/services/SecureVaultService';
import { ledgerDb, db } from '../src/services/CommandLedgerDb';
import { ALLOWED_DOMAINS, isAllowedDomain, handleFetchProxy } from '../functions/api/fetch';
import {
  savePluginAuth,
  getPluginAuth,
  discoverInstalledPluginAuths,
  purgeLegacyPluginAuthStorage,
} from '../src/engine/pluginAuthManager';

// Mock localStorage for Node.js environment if needed
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) || null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] || null,
    get length() { return store.size; },
  };
}

async function runTests() {
  console.log('=== TEST 1: Non-Extractable WebCrypto Master Key ===');
  const masterKey = await getLocalMasterKey();
  console.log('Master Key Algorithm:', masterKey.algorithm.name);
  console.log('Master Key Extractable:', masterKey.extractable);

  if (masterKey.extractable !== false) {
    console.error('FAIL: Master key must be non-extractable (extractable: false)!');
    process.exit(1);
  } else {
    console.log('PASS: Master key is device-bound and non-extractable (extractable: false)!');
  }

  console.log('\n=== TEST 2: Encrypted-at-Rest IndexedDB Credential Storage ===');
  const testPlaintext = 'AIzaSy_SECRET_TELEMETRY_TOKEN_999';
  const testKeyName = 'pixelops_gemini_api_key';

  await storeSecureCredential(testKeyName, testPlaintext);

  // Directly inspect raw stored record in encrypted_credentials table
  const rawDbRecord = await getRawEncryptedCredentialForVerification(testKeyName);
  console.log('Raw DB Record:', {
    key: rawDbRecord?.key,
    ciphertextB4: rawDbRecord?.ciphertextB4?.slice(0, 24) + '...',
    ivLength: rawDbRecord?.iv?.length,
  });

  if (!rawDbRecord) {
    console.error('FAIL: Record was not saved to encrypted_credentials table!');
    process.exit(1);
  }

  if (rawDbRecord.ciphertextB4.includes('AIzaSy') || JSON.stringify(rawDbRecord).includes(testPlaintext)) {
    console.error('FAIL: Plaintext found inside raw IndexedDB record!');
    process.exit(1);
  } else {
    console.log('PASS: Stored record contains raw Base64 ciphertext with zero plaintext leakage!');
  }

  // Decrypt and verify round-trip
  const decrypted = await getSecureCredential(testKeyName);
  if (decrypted !== testPlaintext) {
    console.error('FAIL: Decrypted credential does not match original plaintext!');
    process.exit(1);
  } else {
    console.log('PASS: Decrypted credential correctly matches original plaintext!');
  }

  console.log('\n=== TEST 3: SSRF Whitelist & Proxy Lockdown ===');
  console.log('Allowed domains count:', ALLOWED_DOMAINS.length);

  const testCases = [
    { host: 'understandingwar.org', expected: true },
    { host: 'api.anthropic.com', expected: true },
    { host: 'generativelanguage.googleapis.com', expected: true },
    { host: 'feeds.buzzsprout.com', expected: true },
    { host: 'api.openai.com', expected: true },
    { host: 'sub.understandingwar.org', expected: true },
    { host: 'example.com', expected: false },
    { host: '169.254.169.254', expected: false },
    { host: 'localhost', expected: false },
    { host: 'attacker.controlled.io', expected: false },
  ];

  for (const tc of testCases) {
    const allowed = isAllowedDomain(tc.host);
    if (allowed !== tc.expected) {
      console.error(`FAIL: Domain "${tc.host}" expected allowed=${tc.expected}, got ${allowed}`);
      process.exit(1);
    }
  }
  console.log('PASS: All domain whitelist checks passed!');

  // Test handleFetchProxy 403 rejection on forbidden domain
  const forbiddenReq = new Request('https://pixelops.app/api/fetch?url=https://example.com');
  const forbiddenRes = await handleFetchProxy(forbiddenReq);
  const forbiddenBody = await forbiddenRes.json();

  console.log('Forbidden Request Status:', forbiddenRes.status);
  console.log('Forbidden Response Body:', forbiddenBody);

  if (forbiddenRes.status !== 403 || !forbiddenBody.error.includes('Forbidden')) {
    console.error('FAIL: Expected 403 Forbidden on unwhitelisted domain!');
    process.exit(1);
  } else {
    console.log('PASS: Unwhitelisted domain rejected immediately with 403 Forbidden!');
  }

  console.log('\n=== TEST 4: Legacy Storage Purge & Safe Migration ===');
  // Seed legacy plaintext keys in localStorage
  localStorage.setItem('pixelops_openai_api_key', 'sk-test-legacy-openai-key-123');
  localStorage.setItem('pixelops_anthropic_api_key', 'sk-ant-test-legacy-claude-key-456');
  localStorage.setItem(
    'pixelops_llm_provider_config_v2',
    JSON.stringify({ providerId: 'groq', apiKey: 'gsk_raw_plaintext_key_789' })
  );

  const purged = await purgeLegacyStorage();
  console.log('Purged items:', purged);

  if (localStorage.getItem('pixelops_openai_api_key') !== null) {
    console.error('FAIL: pixelops_openai_api_key was not purged from localStorage!');
    process.exit(1);
  }
  if (localStorage.getItem('pixelops_anthropic_api_key') !== null) {
    console.error('FAIL: pixelops_anthropic_api_key was not purged from localStorage!');
    process.exit(1);
  }

  const sanitizedConfig = JSON.parse(localStorage.getItem('pixelops_llm_provider_config_v2') || '{}');
  if (sanitizedConfig.apiKey !== '••••••••') {
    console.error('FAIL: Config apiKey in localStorage was not sanitized to masked placeholder!');
    process.exit(1);
  }

  // Verify that migrated keys are safely preserved in encrypted IndexedDB vault
  const migratedOpenAI = await getSecureCredential('pixelops_openai_api_key');
  const migratedAnthropic = await getSecureCredential('pixelops_anthropic_api_key');
  const migratedGroq = await getSecureCredential('byok::groq');

  if (migratedOpenAI !== 'sk-test-legacy-openai-key-123') {
    console.error('FAIL: Migrated OpenAI key in encrypted vault did not match!');
    process.exit(1);
  }
  if (migratedAnthropic !== 'sk-ant-test-legacy-claude-key-456') {
    console.error('FAIL: Migrated Anthropic key in encrypted vault did not match!');
    process.exit(1);
  }
  if (migratedGroq !== 'gsk_raw_plaintext_key_789') {
    console.error('FAIL: Migrated Groq key in encrypted vault did not match!');
    process.exit(1);
  }

  console.log('PASS: Legacy plaintext keys successfully migrated into encrypted vault and purged from localStorage!');

  console.log('\n=== TEST 5: Encrypted Plugin Credentials at Rest (savePluginAuth & getPluginAuth) ===');
  const pluginId = 'shodan';
  const testPluginCreds = {
    apiKey: 'shodan_super_secret_key_888',
    endpointUrl: 'https://api.shodan.io',
    accountHandle: 'operative_shodan',
  };

  await savePluginAuth(pluginId, testPluginCreds);

  // Verify that raw plaintext was NOT written to localStorage
  if (localStorage.getItem(`pixelops_plugin_auth_${pluginId}`) !== null) {
    console.error('FAIL: Plaintext key found in localStorage under pixelops_plugin_auth_shodan!');
    process.exit(1);
  }
  if (localStorage.getItem(`plugin_auth_${pluginId}`) !== null) {
    console.error('FAIL: Plaintext key found in localStorage under plugin_auth_shodan!');
    process.exit(1);
  }

  // Inspect raw record in encrypted_credentials table
  const rawPluginDbRecord = await getRawEncryptedCredentialForVerification(`pixelops_plugin_auth_${pluginId}`);
  console.log('Raw Plugin DB Record:', {
    key: rawPluginDbRecord?.key,
    ciphertextSnippet: rawPluginDbRecord?.ciphertextB4?.slice(0, 24) + '...',
  });

  if (!rawPluginDbRecord) {
    console.error('FAIL: Plugin credentials were not persisted to encrypted_credentials table!');
    process.exit(1);
  }
  if (rawPluginDbRecord.ciphertextB4.includes('shodan_super_secret_key_888') || JSON.stringify(rawPluginDbRecord).includes('shodan_super_secret_key_888')) {
    console.error('FAIL: Plaintext key leaked inside encrypted_credentials table!');
    process.exit(1);
  } else {
    console.log('PASS: Plugin credentials stored as AES-GCM ciphertext with zero plaintext in storage!');
  }

  // Decrypt and verify round-trip
  const decryptedPlugin = await getPluginAuth(pluginId);
  if (!decryptedPlugin || decryptedPlugin.apiKey !== 'shodan_super_secret_key_888') {
    console.error('FAIL: getPluginAuth failed to decrypt plugin credentials:', decryptedPlugin);
    process.exit(1);
  } else {
    console.log('PASS: getPluginAuth decrypted plugin credentials accurately:', {
      apiKey: decryptedPlugin.apiKey.slice(0, 6) + '••••••••',
      accountHandle: decryptedPlugin.accountHandle,
    });
  }

  console.log('\n=== TEST 6: Secure Discovery & Enumeration (discoverInstalledPluginAuths) ===');
  await savePluginAuth('slack', { apiKey: 'xoxb-secret-slack-token-111' });
  await savePluginAuth('github', { apiKey: 'ghp_secret_github_token_222' });

  const installedPlugins = await discoverInstalledPluginAuths();
  console.log('Installed Plugins Discovered from Encrypted Store:', installedPlugins);

  if (!installedPlugins.includes('shodan') || !installedPlugins.includes('slack') || !installedPlugins.includes('github')) {
    console.error('FAIL: discoverInstalledPluginAuths did not return all installed plugins!', installedPlugins);
    process.exit(1);
  } else {
    console.log('PASS: discoverInstalledPluginAuths successfully discovered all plugins from encrypted_credentials store!');
  }

  console.log('\n=== TEST 7: Purge Legacy Plugin Auth Keys on Startup (purgeLegacyPluginAuthStorage) ===');
  // Seed legacy unencrypted plugin keys in localStorage
  localStorage.setItem('plugin_auth_legacy_tool', '{"apiKey":"legacy_leaked_key_999"}');
  localStorage.setItem('pixelops_plugin_auth_legacy_tool_2', '{"token":"leaked_token_555"}');

  purgeLegacyPluginAuthStorage();

  if (localStorage.getItem('plugin_auth_legacy_tool') !== null) {
    console.error('FAIL: plugin_auth_legacy_tool was not purged from localStorage!');
    process.exit(1);
  }
  if (localStorage.getItem('pixelops_plugin_auth_legacy_tool_2') !== null) {
    console.error('FAIL: pixelops_plugin_auth_legacy_tool_2 was not purged from localStorage!');
    process.exit(1);
  }
  console.log('PASS: All unencrypted plugin_auth_* keys purged from localStorage successfully!');

  console.log('\n=== ALL SECURITY VERIFICATION TESTS PASSED! ===');
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
