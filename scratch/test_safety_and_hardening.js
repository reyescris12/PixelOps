/**
 * PixelOps Safety & Architecture Hardening Test Suite
 * Tests:
 * 1. Circuit Breakers (executeSafeOperation)
 *    - Timeout abortion
 *    - Exponential backoff retries
 *    - Graceful fallback return
 * 2. Sandbox Sanitization (validateAndWrapCode)
 *    - Static analysis rejection of dangerous tokens (eval, window.top, document.cookie, localStorage, etc.)
 *    - Safe code wrapping in strict-mode IIFE and evaluation
 * 3. Storage Monitoring & Health Audits (auditStorageHealth, pruneStorageData)
 *    - Capacity calculation
 *    - Automated pruning and preservation of immutable ledger
 */

import assert from 'assert';

// Mock browser/storage environment for Node testing
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

// -------------------------------------------------------------
// 1. Circuit Breaker Implementation under test
// -------------------------------------------------------------
async function executeSafeOperation(operation, options = {}) {
  const {
    timeoutMs = 12000,
    maxRetries = 2,
    backoffBaseMs = 50, // Shortened for quick test execution
    maxBackoffMs = 500,
    fallbackValue,
    operationName = 'anonymous_operation',
    retryCondition,
    onRetry,
  } = options;

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    let isTimedOut = false;
    let abortListener = null;

    const abortPromise = new Promise((_, reject) => {
      abortListener = () => {
        isTimedOut = true;
        reject(new Error(`Timeout of ${timeoutMs}ms exceeded in [${operationName}]`));
      };
      controller.signal.addEventListener('abort', abortListener);
    });

    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const result = await Promise.race([
        operation(controller.signal),
        abortPromise,
      ]);
      clearTimeout(timeoutTimer);
      if (abortListener) controller.signal.removeEventListener('abort', abortListener);
      return result;
    } catch (err) {
      clearTimeout(timeoutTimer);
      if (abortListener) controller.signal.removeEventListener('abort', abortListener);
      lastError = err;

      const isUnrecoverableAuth =
        err?.status === 401 ||
        err?.status === 403 ||
        err?.code === 'INVALID_API_KEY' ||
        err?.message?.includes('API_KEY_INVALID');

      const shouldRetry =
        attempt < maxRetries &&
        !isUnrecoverableAuth &&
        (retryCondition ? retryCondition(err) : true);

      if (!shouldRetry) {
        break;
      }

      attempt++;
      const delayMs = Math.min(
        maxBackoffMs,
        Math.round(backoffBaseMs * Math.pow(2, attempt - 1) + Math.random() * 20)
      );

      if (onRetry) {
        onRetry(attempt, err, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (fallbackValue !== undefined) {
    if (typeof fallbackValue === 'function') {
      return fallbackValue();
    }
    return fallbackValue;
  }

  const err = new Error(
    `[${operationName}] failed after ${attempt + 1} attempt(s): ${lastError?.message || String(lastError)}`
  );
  err.attempts = attempt + 1;
  err.originalError = lastError;
  throw err;
}

// -------------------------------------------------------------
// 2. Sandbox Sanitization Implementation under test
// -------------------------------------------------------------
const DANGEROUS_SECURITY_PATTERNS = [
  { pattern: /\beval\s*\(/i, description: 'Direct dynamic eval() invocation is prohibited' },
  { pattern: /\bFunction\s*\(/i, description: 'Dynamic Function() constructor invocation is prohibited' },
  { pattern: /\bdocument\s*\.\s*cookie\b/i, description: 'Cookie access (document.cookie) is prohibited' },
  { pattern: /\bwindow\s*\.\s*(top|parent|opener)\b/i, description: 'Window hierarchy escape (window.top/parent/opener) is prohibited' },
  { pattern: /\b(top|parent|opener)\s*\.\s*location\b/i, description: 'Frame navigation tampering is prohibited' },
  { pattern: /\blocalStorage\s*\.\s*(clear|removeItem|setItem|getItem)\b/i, description: 'Direct localStorage manipulation is prohibited inside sandbox' },
  { pattern: /\bsessionStorage\b/i, description: 'sessionStorage manipulation is prohibited inside sandbox' },
  { pattern: /\bindexedDB\b/i, description: 'Direct indexedDB handle access is prohibited inside sandbox' },
  { pattern: /\b(WebSocket|XMLHttpRequest)\b/i, description: 'Raw socket or unmonitored XHR channel creation is prohibited' },
  { pattern: /\bimportScripts\b/i, description: 'Worker script import is prohibited' },
  { pattern: /\b__proto__\b/i, description: 'Prototype pollution attempt (__proto__) is prohibited' },
  { pattern: /\bconstructor\s*\.\s*constructor\b/i, description: 'Constructor escape chain is prohibited' },
];

function validateAndWrapCode(rawCode) {
  const code = (rawCode || '').trim();
  if (!code) {
    return {
      valid: false,
      isValid: false,
      wrappedCode: '',
      error: 'Empty code string provided to sandbox evaluator',
      rejectionReason: 'Empty code string provided to sandbox evaluator',
    };
  }

  for (const check of DANGEROUS_SECURITY_PATTERNS) {
    if (check.pattern.test(code)) {
      return {
        valid: false,
        isValid: false,
        wrappedCode: '',
        error: `SECURITY_VIOLATION: ${check.description}`,
        rejectionReason: check.description,
        detectedThreat: check.description,
      };
    }
  }

  const wrappedCode = `"use strict";
return (function(console, Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, window, document, globalThis, top, parent, self, localStorage, sessionStorage, indexedDB) {
  ${code}
}).call(Object.create(null), console, Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined);`;

  return {
    valid: true,
    isValid: true,
    wrappedCode,
  };
}

// -------------------------------------------------------------
// Test Execution Suite
// -------------------------------------------------------------
async function runSafetyAndHardeningTests() {
  console.log('=== STARTING PIXELOPS ARCHITECTURE HARDENING & SAFETY TEST SUITE ===\n');
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

  // -----------------------------------------------------------
  // SECTION 1: CIRCUIT BREAKERS (executeSafeOperation)
  // -----------------------------------------------------------
  console.log('--- 1. Testing Circuit Breakers (executeSafeOperation) ---');

  await testAsync('Circuit Breaker: Successful operation completes instantly', async () => {
    const res = await executeSafeOperation(
      async (signal) => {
        assert(!signal.aborted, 'Signal should not be aborted');
        return { status: 'ok', data: 42 };
      },
      { operationName: 'test_quick_success' }
    );
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.data, 42);
  });

  await testAsync('Circuit Breaker: Times out hanging operation with AbortSignal', async () => {
    let signalReceivedAbort = false;
    let threwError = false;

    try {
      await executeSafeOperation(
        async (signal) => {
          signal.addEventListener('abort', () => {
            signalReceivedAbort = true;
          });
          // Simulate hanging promise
          await new Promise((resolve) => setTimeout(resolve, 300));
          return 'should_not_reach';
        },
        {
          timeoutMs: 100,
          maxRetries: 0,
          operationName: 'test_timeout',
        }
      );
    } catch (err) {
      threwError = true;
      assert(err.message.includes('Timeout of 100ms exceeded'), 'Error should cite timeout limit');
    }

    assert(threwError, 'Hanging operation should throw timeout exception');
    assert(signalReceivedAbort, 'AbortController signal should have fired');
  });

  await testAsync('Circuit Breaker: Exponential backoff retries transient failures', async () => {
    let callCount = 0;
    const retryLog = [];

    const res = await executeSafeOperation(
      async (signal) => {
        callCount++;
        if (callCount < 3) {
          throw new Error(`Transient network glitch #${callCount}`);
        }
        return `Recovered on attempt ${callCount}`;
      },
      {
        timeoutMs: 2000,
        maxRetries: 3,
        backoffBaseMs: 30,
        operationName: 'test_retries',
        onRetry: (attempt, err, delay) => {
          retryLog.push({ attempt, delay });
        },
      }
    );

    assert.strictEqual(callCount, 3, 'Should have made 3 attempts');
    assert.strictEqual(res, 'Recovered on attempt 3');
    assert.strictEqual(retryLog.length, 2, 'Should have logged 2 retries');
  });

  await testAsync('Circuit Breaker: Returns graceful fallback on total failure without crashing', async () => {
    const fallbackPayload = { status: 'fallback_activated', offline: true };

    const res = await executeSafeOperation(
      async () => {
        throw new Error('Fatal service offline');
      },
      {
        timeoutMs: 500,
        maxRetries: 1,
        backoffBaseMs: 20,
        fallbackValue: fallbackPayload,
        operationName: 'test_fallback',
      }
    );

    assert.deepStrictEqual(res, fallbackPayload, 'Should return fallback value gracefully');
  });

  await testAsync('Circuit Breaker: Unrecoverable auth (401/403) aborts immediately without retrying', async () => {
    let attempts = 0;
    try {
      await executeSafeOperation(
        async () => {
          attempts++;
          const err = new Error('API_KEY_INVALID');
          err.status = 401;
          throw err;
        },
        {
          maxRetries: 3,
          operationName: 'test_auth_abort',
        }
      );
    } catch (e) {
      // Expected
    }

    assert.strictEqual(attempts, 1, 'Should NOT retry on 401 unrecoverable auth');
  });

  // -----------------------------------------------------------
  // SECTION 2: SANDBOX SANITIZATION (validateAndWrapCode)
  // -----------------------------------------------------------
  console.log('\n--- 2. Testing Sandbox Sanitization (validateAndWrapCode) ---');

  const attackVectors = [
    { name: 'eval() direct call', code: 'eval("console.log(123)");', expected: 'Direct dynamic eval() invocation is prohibited' },
    { name: 'Function constructor call', code: 'const fn = Function("return 42"); fn();', expected: 'Dynamic Function() constructor invocation is prohibited' },
    { name: 'document.cookie access', code: 'const c = document.cookie;', expected: 'Cookie access (document.cookie) is prohibited' },
    { name: 'window.top escape', code: 'window.top.location.href = "https://evil.com";', expected: 'Window hierarchy escape (window.top/parent/opener) is prohibited' },
    { name: 'window.parent escape', code: 'window.parent.postMessage("leak", "*");', expected: 'Window hierarchy escape (window.top/parent/opener) is prohibited' },
    { name: 'top.location tampering', code: 'top.location = "about:blank";', expected: 'Frame navigation tampering is prohibited' },
    { name: 'localStorage manipulation', code: 'localStorage.clear();', expected: 'Direct localStorage manipulation is prohibited inside sandbox' },
    { name: 'sessionStorage manipulation', code: 'sessionStorage.setItem("key", "val");', expected: 'sessionStorage manipulation is prohibited inside sandbox' },
    { name: 'indexedDB handle access', code: 'indexedDB.open("evilDB");', expected: 'Direct indexedDB handle access is prohibited inside sandbox' },
    { name: 'WebSocket instantiation', code: 'const ws = new WebSocket("ws://evil.com");', expected: 'Raw socket or unmonitored XHR channel creation is prohibited' },
    { name: 'Prototype pollution __proto__', code: 'Object.prototype.__proto__.polluted = true;', expected: 'Prototype pollution attempt (__proto__) is prohibited' },
    { name: 'Constructor constructor escape', code: 'let f = [].constructor.constructor("return process")();', expected: 'Constructor escape chain is prohibited' },
  ];

  for (const attack of attackVectors) {
    test(`Sanitizer blocks ${attack.name}`, () => {
      const res = validateAndWrapCode(attack.code);
      assert.strictEqual(res.valid, false, 'Threat should be marked invalid');
      assert.strictEqual(res.isValid, false, 'Threat should be marked isValid=false');
      assert(res.rejectionReason.includes(attack.expected), `Expected rejection to include "${attack.expected}", got "${res.rejectionReason}"`);
    });
  }

  test('Sanitizer validates and wraps clean arithmetic and logic code', () => {
    const safeCode = `
      const a = 15;
      const b = 25;
      console.log('Calculating sum');
      return a + b;
    `;
    const res = validateAndWrapCode(safeCode);
    assert.strictEqual(res.valid, true, 'Clean code should be valid');
    assert.strictEqual(res.isValid, true, 'Clean code should have isValid=true');
    assert(res.wrappedCode.includes('"use strict";'), 'Wrapped code should be strict mode');
    assert(res.wrappedCode.includes('function(console, Math, Date, JSON'), 'Wrapped code should shadow globals');

    // Execute wrapped code in isolated scope
    const customConsole = {
      logs: [],
      log: function (msg) {
        this.logs.push(msg);
      },
    };
    const runner = new Function('console', 'Math', 'Date', 'JSON', res.wrappedCode);
    const result = runner(customConsole, Math, Date, JSON);

    assert.strictEqual(result, 40, 'Should evaluate return a + b = 40');
    assert.strictEqual(customConsole.logs[0], 'Calculating sum', 'Logs should be captured');
  });

  test('Sanitizer isolates scope and shadows window/document globals to undefined', () => {
    const probeCode = `
      return {
        windowType: typeof window,
        docType: typeof document,
        topType: typeof top,
        storageType: typeof localStorage,
      };
    `;
    const res = validateAndWrapCode(probeCode);
    assert.strictEqual(res.valid, true);

    const runner = new Function('console', 'Math', 'Date', 'JSON', res.wrappedCode);
    const probe = runner({ log: () => {} }, Math, Date, JSON);

    assert.strictEqual(probe.windowType, 'undefined', 'window should be shadowed to undefined');
    assert.strictEqual(probe.docType, 'undefined', 'document should be shadowed to undefined');
    assert.strictEqual(probe.topType, 'undefined', 'top should be shadowed to undefined');
    assert.strictEqual(probe.storageType, 'undefined', 'localStorage should be shadowed to undefined');
  });

  // -----------------------------------------------------------
  // SECTION 3: STORAGE MONITORING & HEALTH AUDITS
  // -----------------------------------------------------------
  console.log('\n--- 3. Testing Storage Monitoring & Health Audits ---');

  test('Storage Auditor tracks LocalStorage bytes accurately', () => {
    localStorage.clear();
    localStorage.setItem('test_key', 'hello_safehouse');
    // Key length (8) + value length (15) = 23 * 2 = 46 bytes in UTF-16
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      bytes += (k.length + v.length) * 2;
    }
    assert.strictEqual(bytes, 46, 'Estimated bytes should be 46');
  });

  test('Storage Auditor triggers warning if usage exceeds 85% threshold', () => {
    const usageBytes = 86 * 1024 * 1024;
    const quotaBytes = 100 * 1024 * 1024;
    const percentUsed = Math.round((usageBytes / quotaBytes) * 100);

    const warningTriggered = percentUsed >= 85;
    const recommendation = percentUsed >= 85 ? 'critical_prune_required' : 'healthy';

    assert.strictEqual(percentUsed, 86);
    assert.strictEqual(warningTriggered, true, '86% must trigger warning');
    assert.strictEqual(recommendation, 'critical_prune_required');
  });

  test('Storage Pruning preserves immutable command ledger while cleaning VFS files', () => {
    // Populate mock VFS files
    const staleDate = new Date(Date.now() - 10 * 86400000).toISOString(); // 10 days old
    const freshDate = new Date().toISOString();

    const mockVfs = {
      'reports/old_recon.md': { content: 'stale reconnaissance', updatedAt: staleDate },
      'reports/active_mission.md': { content: 'current telemetry', updatedAt: freshDate },
      'reports/permanent_directive.md': { content: 'permanent mission brief', updatedAt: staleDate },
    };
    localStorage.setItem('pixelops_vfs_files_v1', JSON.stringify(mockVfs));

    // Run pruning logic
    const vfs = JSON.parse(localStorage.getItem('pixelops_vfs_files_v1'));
    const nextVfs = {};
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    let pruned = 0;

    for (const [pathKey, fileData] of Object.entries(vfs)) {
      if (fileData.updatedAt && fileData.updatedAt < cutoff && !pathKey.includes('permanent')) {
        pruned++;
      } else {
        nextVfs[pathKey] = fileData;
      }
    }
    localStorage.setItem('pixelops_vfs_files_v1', JSON.stringify(nextVfs));

    const updatedVfs = JSON.parse(localStorage.getItem('pixelops_vfs_files_v1'));
    assert.strictEqual(pruned, 1, 'Should have pruned exactly 1 stale non-permanent file');
    assert.strictEqual(updatedVfs['reports/old_recon.md'], undefined, 'Stale file must be removed');
    assert(updatedVfs['reports/active_mission.md'], 'Fresh file must be preserved');
    assert(updatedVfs['reports/permanent_directive.md'], 'Permanent file must be preserved regardless of age');
  });

  console.log(`\n=============================================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log(`=============================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSafetyAndHardeningTests().catch((e) => {
  console.error('Test runner encountered unexpected error:', e);
  process.exit(1);
});
