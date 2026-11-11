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
import { ledgerDb } from '../src/services/CommandLedgerDb';
import { ALLOWED_DOMAINS, isAllowedDomain, handleFetchProxy } from '../functions/api/fetch';

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

  console.log('\n=== ALL SECURITY VERIFICATION TESTS PASSED! ===');
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
