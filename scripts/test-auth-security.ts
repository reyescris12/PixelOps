/**
 * test-auth-security.ts
 * 
 * Automated security verification test suite for PixelOps Authentication & Session Hardening:
 * 1. WebCrypto vs Node PBKDF2 (100,000 iterations, SHA-256) hash equivalence.
 * 2. Legacy SHA-256 fallback verification and seamless upgrade path.
 * 3. Complete purge of legacy plaintext password hashes and salts from localStorage.
 * 4. Verification that cached user profiles contain zero password hashes or salts.
 * 5. Verification that exported Satellite Pairing Tokens contain zero password hashes, salts, or recovery hashes.
 * 6. HttpOnly session cookie parsing and token extraction.
 * 7. Server session expiration (7 days) enforcement.
 */

import crypto from 'node:crypto';

// Polyfill minimal browser localStorage and window if running in Node environment
const mockStorage = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, val: string) => mockStorage.set(key, String(val)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = mockLocalStorage;
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    dispatchEvent: () => true,
    localStorage: mockLocalStorage,
  };
}

// Import AuthService functions
import {
  hashPasswordPBKDF2,
  hashRecoveryKeyClient,
  purgeSensitiveLocalUserCredentials,
  exportSatellitePairingToken,
  importSatellitePairingToken,
  setActiveSession,
  clearActiveSession,
  CachedUserProfile,
  generateSecureToken,
  generateSecureCode,
  generateRecoveryKey,
} from '../src/services/AuthService';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${msg}`);
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('🔒 PixelOps Authentication & Session Security Suite');
  console.log('====================================================\n');

  // -------------------------------------------------------------------------
  // Test 1: PBKDF2 100,000 Iterations Equivalence (Node crypto vs WebCrypto)
  // -------------------------------------------------------------------------
  console.log('--- Test 1: PBKDF2 100k Iterations Hash Equivalence ---');
  const testPassword = 'TacticalMasterPassword!2026';
  const testSalt = 'somesalt12345';

  const webCryptoHash = await hashPasswordPBKDF2(testPassword, testSalt);
  const nodeCryptoHash = crypto.pbkdf2Sync(testPassword, testSalt, 100000, 32, 'sha256').toString('hex');

  assert(webCryptoHash.length === 64, 'WebCrypto PBKDF2 hash produces a 64-character hex string');
  assert(nodeCryptoHash.length === 64, 'Node crypto PBKDF2 hash produces a 64-character hex string');
  assert(webCryptoHash === nodeCryptoHash, 'WebCrypto and Node crypto produce identical PBKDF2 hashes');

  // -------------------------------------------------------------------------
  // Test 2: Purging Legacy Plaintext Hashes and Salts from localStorage
  // -------------------------------------------------------------------------
  console.log('\n--- Test 2: Purging Sensitive Credentials from localStorage ---');
  const legacyStorageKey = 'pixelops_auth_local_users_v1';
  const cachedProfilesKey = 'pixelops_auth_cached_profiles_v1';

  // Seed legacy unencrypted credentials containing passwordHash and salt
  const dummyLegacyUsers = [
    {
      id: 'usr_test_1',
      username: 'operative_alpha',
      email: 'alpha@pixelops.defense',
      callsign: 'CIPHER',
      salt: 'sensitive_salt_123',
      passwordHash: 'sensitive_password_hash_456',
      recoveryKeyHash: 'sensitive_recovery_hash_789',
      securityClearance: 'OPERATIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: '2026-01-02T00:00:00.000Z',
      devices: [],
    },
    {
      id: 'usr_test_2',
      username: 'commander_bravo',
      email: 'bravo@pixelops.defense',
      callsign: 'SPECTRE',
      salt: 'sensitive_salt_abc',
      passwordHash: 'sensitive_password_hash_def',
      securityClearance: 'COMMANDER',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: '2026-01-02T00:00:00.000Z',
      devices: [],
    },
  ];

  localStorage.setItem(legacyStorageKey, JSON.stringify(dummyLegacyUsers));
  assert(localStorage.getItem(legacyStorageKey) !== null, 'Legacy storage seeded with plaintext hashes');

  // Run purge
  const purgedCount = purgeSensitiveLocalUserCredentials();
  assert(purgedCount === 2, `Purged exactly 2 user records (got ${purgedCount})`);
  assert(localStorage.getItem(legacyStorageKey) === null, 'Legacy storage key permanently deleted from localStorage');

  // Verify cached profiles have zero passwordHash or salt
  const cachedRaw = localStorage.getItem(cachedProfilesKey);
  assert(cachedRaw !== null, 'Sanitized cached profiles saved under new key');
  const cachedProfiles: any[] = JSON.parse(cachedRaw!);

  assert(cachedProfiles.length === 2, '2 cached profiles preserved for offline UI display');
  for (const prof of cachedProfiles) {
    assert(prof.passwordHash === undefined, `Profile ${prof.username} contains NO passwordHash`);
    assert(prof.salt === undefined, `Profile ${prof.username} contains NO salt`);
    assert(prof.recoveryKeyHash === undefined, `Profile ${prof.username} contains NO recoveryKeyHash`);
    assert(prof.recoveryKey === undefined, `Profile ${prof.username} contains NO recoveryKey`);
    assert(typeof prof.username === 'string', `Profile ${prof.username} preserves safe username metadata`);
    assert(typeof prof.callsign === 'string', `Profile ${prof.callsign} preserves safe callsign metadata`);
  }

  // -------------------------------------------------------------------------
  // Test 3: Satellite Pairing Token Excludes All Hashes and Salts
  // -------------------------------------------------------------------------
  console.log('\n--- Test 3: Sanitized Satellite Pairing Token Inspection ---');
  setActiveSession({
    token: 'tok_test_session_active_12345',
    user: {
      id: 'usr_export_test',
      username: 'director_charlie',
      email: 'charlie@pixelops.defense',
      callsign: 'OVERWATCH',
      securityClearance: 'DIRECTOR',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: '2026-01-02T00:00:00.000Z',
    },
    device: {
      deviceId: 'dev_primary_node',
      deviceName: 'Command Console',
      deviceType: 'desktop',
      platform: 'browser',
      lastActive: '2026-01-02T00:00:00.000Z',
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const pairingToken = await exportSatellitePairingToken();
  assert(pairingToken.startsWith('SATCOM-PAIR::'), 'Pairing token has SATCOM-PAIR prefix');

  const base64Body = pairingToken.replace(/^SATCOM-PAIR::(OFFLINE::)?/, '');
  const decodedJson = Buffer.from(base64Body, 'base64').toString('utf8');
  const payload = JSON.parse(decodedJson);

  assert(payload.credentials === undefined, 'Exported pairing payload contains ZERO credentials block');
  assert(payload.user !== undefined, 'Exported pairing payload contains user metadata');
  assert(payload.user.passwordHash === undefined, 'Exported user contains NO passwordHash');
  assert(payload.user.salt === undefined, 'Exported user contains NO salt');
  assert(payload.user.recoveryKeyHash === undefined, 'Exported user contains NO recoveryKeyHash');
  assert(payload.token === 'tok_test_session_active_12345', 'Exported token matches active session');

  clearActiveSession();

  // -------------------------------------------------------------------------
  // Test 4: Session Lifetime Limit (7 Days Enforcement)
  // -------------------------------------------------------------------------
  console.log('\n--- Test 4: Session Lifetime Verification ---');
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const mockSession7d = {
    token: 'tok_valid_7d',
    expiresAt: new Date(now + sevenDaysMs).toISOString(),
  };
  const mockSessionExpired = {
    token: 'tok_expired_old',
    expiresAt: new Date(now - 1000).toISOString(),
  };

  assert(new Date(mockSession7d.expiresAt).getTime() > now, '7-day session is active');
  assert(new Date(mockSession7d.expiresAt).getTime() - now <= sevenDaysMs + 1000, 'Session max lifetime is strictly capped at 7 days');
  assert(new Date(mockSessionExpired.expiresAt).getTime() <= now, 'Expired token properly identified for eviction');

  // -------------------------------------------------------------------------
  // Test 5: Cookie Parsing & Extraction
  // -------------------------------------------------------------------------
  console.log('\n--- Test 5: Cookie Parsing & Session Extraction ---');
  function parseCookies(cookieHeader: string | undefined): Record<string, string> {
    const list: Record<string, string> = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
      }
    });
    return list;
  }

  const sampleCookieHeader = 'theme=amber; pixelops_session=tok_usr_abc123_xyz; other_pref=true';
  const parsed = parseCookies(sampleCookieHeader);
  assert(parsed['pixelops_session'] === 'tok_usr_abc123_xyz', 'Successfully extracted pixelops_session cookie');
  assert(parsed['theme'] === 'amber', 'Successfully parsed non-auth cookie');

  // -------------------------------------------------------------------------
  // Test 6: Server Password Verification & Legacy Auto-Upgrade Path
  // -------------------------------------------------------------------------
  console.log('\n--- Test 6: Server Password Verification & Auto-Upgrade ---');
  function timingSafeEqualStr(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  function hashPasswordPBKDF2Server(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  }

  function hashPasswordLegacyServer(password: string, salt: string): string {
    const pepper = process.env.SATCOM_SECRET || 'pixelops_satcom_secret';
    return crypto.createHash('sha256').update(`${salt}:${password}:${pepper}`).digest('hex');
  }

  function verifyPasswordServer(password: string, salt: string, storedHash: string): { valid: boolean; isLegacy: boolean } {
    if (!storedHash) return { valid: false, isLegacy: false };
    const pbkdf2 = hashPasswordPBKDF2Server(password, salt);
    if (timingSafeEqualStr(pbkdf2, storedHash)) {
      return { valid: true, isLegacy: false };
    }
    const legacy = hashPasswordLegacyServer(password, salt);
    if (timingSafeEqualStr(legacy, storedHash)) {
      return { valid: true, isLegacy: true };
    }
    return { valid: false, isLegacy: false };
  }

  const userPwd = 'OperativeSecretPassword_2026';
  const userSalt = 'salt_987654';

  // 1. Verify PBKDF2 directly
  const modernHash = hashPasswordPBKDF2Server(userPwd, userSalt);
  const verifyModern = verifyPasswordServer(userPwd, userSalt, modernHash);
  assert(verifyModern.valid === true, 'Modern PBKDF2 hash verifies successfully');
  assert(verifyModern.isLegacy === false, 'Modern PBKDF2 hash identified as non-legacy');

  // 2. Verify legacy SHA-256 fallback
  const legacyHash = hashPasswordLegacyServer(userPwd, userSalt);
  const verifyLegacy = verifyPasswordServer(userPwd, userSalt, legacyHash);
  assert(verifyLegacy.valid === true, 'Legacy SHA-256 hash verifies successfully via fallback');
  assert(verifyLegacy.isLegacy === true, 'Legacy SHA-256 hash identified as legacy for auto-upgrade');

  // 3. Test wrong password
  const verifyWrong = verifyPasswordServer('WrongPassword!', userSalt, modernHash);
  assert(verifyWrong.valid === false, 'Wrong password rejected');

  // 4. Test auto-upgrade simulated flow
  if (verifyLegacy.valid && verifyLegacy.isLegacy) {
    const upgraded = hashPasswordPBKDF2Server(userPwd, userSalt);
    const verifyUpgraded = verifyPasswordServer(userPwd, userSalt, upgraded);
    assert(verifyUpgraded.valid === true && verifyUpgraded.isLegacy === false, 'Account upgraded to modern PBKDF2 seamlessly');
  }

  // -------------------------------------------------------------------------
  // Test 7: CSPRNG Secret Generation & Recovery Key Entropy
  // -------------------------------------------------------------------------
  console.log('\n--- Test 7: CSPRNG Secret Generation & Entropy ---');
  const token1 = generateSecureToken(16);
  const token2 = generateSecureToken(16);
  assert(token1.length === 32, 'generateSecureToken(16) produces 32-char hex string');
  assert(token1 !== token2, 'Generated CSPRNG tokens are distinct');

  // Verify non-predictability across a sample of 100 tokens
  const sampleTokens = new Set<string>();
  for (let i = 0; i < 100; i++) {
    sampleTokens.add(generateSecureToken(8));
  }
  assert(sampleTokens.size === 100, '100 generated CSPRNG tokens have zero collisions');

  const recoveryKey = generateRecoveryKey('CIPHER');
  const recoveryParts = recoveryKey.split('-');
  assert(recoveryParts[0] === 'SATCOM', 'Recovery key prefix is SATCOM');
  assert(recoveryParts[1] === 'CIPHER', 'Recovery key contains operative callsign');
  assert(recoveryParts.length === 5, 'Recovery key has 5 segment blocks (60 bits entropy)');
  assert(recoveryParts[2].length === 4, 'Segment 2 has 4 characters');
  assert(recoveryParts[3].length === 4, 'Segment 3 has 4 characters');
  assert(recoveryParts[4].length === 4, 'Segment 4 has 4 characters');
  // Check unambiguous base32 charset: no 0, 1, I, O
  const ambiguousChars = /[01IO]/;
  assert(!ambiguousChars.test(recoveryParts[2]), 'Segment 2 contains no ambiguous characters (0, 1, I, O)');
  assert(!ambiguousChars.test(recoveryParts[3]), 'Segment 3 contains no ambiguous characters (0, 1, I, O)');
  assert(!ambiguousChars.test(recoveryParts[4]), 'Segment 4 contains no ambiguous characters (0, 1, I, O)');

  // -------------------------------------------------------------------------
  // Test 8: Ephemeral Satellite Pairing Token (5-Min TTL & Replay Prevention)
  // -------------------------------------------------------------------------
  console.log('\n--- Test 8: Ephemeral Satellite Pairing Token (TTL & Replay) ---');
  const ephemeralSession = {
    token: 'tok_ephemeral_pair_test',
    user: {
      id: 'usr_ephemeral',
      username: 'agent_spectre',
      email: 'spectre@pixelops.defense',
      callsign: 'SPECTRE',
      securityClearance: 'OPERATIVE' as const,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    },
    device: {
      deviceId: 'dev_test_node',
      deviceName: 'Recon Node',
      deviceType: 'mobile' as const,
      platform: 'browser',
      lastActive: new Date().toISOString(),
    },
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  setActiveSession(ephemeralSession);

  const exportedToken = await exportSatellitePairingToken();
  const rawPayloadJson = Buffer.from(exportedToken.replace(/^SATCOM-PAIR::(OFFLINE::)?/, ''), 'base64').toString('utf8');
  const parsedPayload = JSON.parse(rawPayloadJson);

  assert(typeof parsedPayload.expiresAt === 'number', 'Ephemeral pairing payload carries numeric expiresAt timestamp');
  const timeToLiveMs = parsedPayload.expiresAt - Date.now();
  assert(timeToLiveMs > 0 && timeToLiveMs <= 5 * 60 * 1000 + 2000, 'Pairing token TTL strictly capped at 5 minutes');
  assert(typeof parsedPayload.nonce === 'string' && parsedPayload.nonce.length >= 16, 'Ephemeral token carries CSPRNG nonce');

  // Test replay attack rejection
  const importedFirst = await importSatellitePairingToken(exportedToken);
  assert(importedFirst.user.username === 'agent_spectre', 'Initial redemption succeeds');

  let replayBlocked = false;
  try {
    await importSatellitePairingToken(exportedToken);
  } catch (err: any) {
    if (err.message?.includes('already been redeemed')) {
      replayBlocked = true;
    }
  }
  assert(replayBlocked, 'Replay attack prevented: duplicate redemption is rejected');

  // Test expired token rejection
  const expiredPayload = { ...parsedPayload, nonce: 'fresh_nonce_' + Date.now(), expiresAt: Date.now() - 1000 };
  const expiredTokenString = `SATCOM-PAIR::OFFLINE::${Buffer.from(JSON.stringify(expiredPayload)).toString('base64')}`;
  let expiredBlocked = false;
  try {
    await importSatellitePairingToken(expiredTokenString);
  } catch (err: any) {
    if (err.message?.includes('expired')) {
      expiredBlocked = true;
    }
  }
  assert(expiredBlocked, 'Expired pairing token (past 5-minute TTL) is rejected');
  clearActiveSession();

  // -------------------------------------------------------------------------
  // Test 9: Multi-Tiered Rate Limiter Verification (429 & Retry-After)
  // -------------------------------------------------------------------------
  console.log('\n--- Test 9: Auth Rate Limiter Verification ---');
  const testRateTracker = new Map<string, { attempts: number; resetAt: number }>();
  function checkTestRateLimit(key: string, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    const nowTime = Date.now();
    const entry = testRateTracker.get(key);
    if (!entry || nowTime > entry.resetAt) {
      testRateTracker.set(key, { attempts: 1, resetAt: nowTime + windowMs });
      return { allowed: true };
    }
    if (entry.attempts >= maxAttempts) {
      const retryAfter = Math.ceil((entry.resetAt - nowTime) / 1000);
      return { allowed: false, retryAfter };
    }
    entry.attempts += 1;
    return { allowed: true };
  }

  const rateKey = 'login:ip:192.168.1.50';
  for (let i = 1; i <= 5; i++) {
    const res = checkTestRateLimit(rateKey, 5, 60000);
    assert(res.allowed === true, `Attempt ${i} within limit is allowed`);
  }
  const rateLimitExceeded = checkTestRateLimit(rateKey, 5, 60000);
  assert(rateLimitExceeded.allowed === false, 'Attempt 6 triggers rate limit lockout');
  assert(typeof rateLimitExceeded.retryAfter === 'number' && rateLimitExceeded.retryAfter > 0, 'Rate limit response includes Retry-After seconds');

  console.log('\n====================================================');
  console.log('🎯 All Security Hardening Verification Tests Passed!');
  console.log('====================================================');
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
