/**
 * Test Suite: Composio Error Circuit Breaker for 401 Unauthorized Responses
 * Verifies halting automated retries and prompting re-authentication.
 */

import {
  callComposioApi,
  isComposioCircuitBreakerTripped,
  tripComposioCircuitBreaker,
  resetComposioCircuitBreaker,
  getComposioCircuitBreakerState,
  setComposioApiKey,
  saveComposioApiKey,
  executeComposioAction,
  ComposioService,
} from '../src/services/ComposioService';

// Mock localStorage if in Node environment
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

async function runCircuitBreakerTests() {
  console.log('=== TEST 1: callComposioApi with No API Key Aborts Gracefully ===');
  // Ensure no key is set
  setComposioApiKey('');
  resetComposioCircuitBreaker();

  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (..._args: any[]) => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };

  const noKeyResult = await callComposioApi('/test/endpoint', { query: 'test' });
  if (noKeyResult !== null) {
    console.error(`FAIL: Expected null when no API key configured, got:`, noKeyResult);
    process.exit(1);
  }
  if (fetchCalled) {
    console.error('FAIL: Fetch should NOT have been called when no API key is configured!');
    process.exit(1);
  }
  console.log('PASS: callComposioApi aborted early and returned null without network execution.');

  console.log('\n=== TEST 2: 401 Unauthorized Trips Circuit Breaker and Throws Error ===');
  setComposioApiKey('invalid_expired_composio_key');
  let fetchCallCount = 0;

  globalThis.fetch = async (url: any, init: any) => {
    fetchCallCount++;
    return new Response(JSON.stringify({ error: 'Unauthorized', message: 'API key is invalid' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  let threwExpected401 = false;
  try {
    await callComposioApi('https://backend.composio.dev/api/v3/tools/execute', { tool: 'github' });
  } catch (err: any) {
    if (err.message === 'Unauthorized Composio API Key') {
      threwExpected401 = true;
    } else {
      console.error('FAIL: Unexpected error message:', err.message);
      process.exit(1);
    }
  }

  if (!threwExpected401) {
    console.error('FAIL: callComposioApi did not throw "Unauthorized Composio API Key" on 401 response!');
    process.exit(1);
  }

  if (!isComposioCircuitBreakerTripped()) {
    console.error('FAIL: Circuit breaker was not tripped after receiving 401!');
    process.exit(1);
  }

  const breakerState = getComposioCircuitBreakerState();
  console.log('Circuit Breaker State after 401:', breakerState);
  if (!breakerState.isTripped || breakerState.failureCount < 1) {
    console.error('FAIL: Circuit breaker state is invalid:', breakerState);
    process.exit(1);
  }
  console.log('PASS: 401 Unauthorized tripped the circuit breaker and threw "Unauthorized Composio API Key".');

  console.log('\n=== TEST 3: Fail-Fast Subsequent Calls When Circuit Breaker Is Tripped ===');
  fetchCallCount = 0;
  let failFastThrew = false;

  try {
    await callComposioApi('https://backend.composio.dev/api/v3/tools/execute', { tool: 'slack' });
  } catch (err: any) {
    if (err.message === 'Unauthorized Composio API Key') {
      failFastThrew = true;
    }
  }

  if (!failFastThrew) {
    console.error('FAIL: Call did not fail fast with Unauthorized Composio API Key!');
    process.exit(1);
  }

  if (fetchCallCount !== 0) {
    console.error(`FAIL: Network fetch was executed ${fetchCallCount} times while circuit breaker was tripped!`);
    process.exit(1);
  }
  console.log('PASS: Subsequent calls halted immediately without hammering the endpoint (0 network calls).');

  console.log('\n=== TEST 4: Re-Authentication and Key Reset Clears Circuit Breaker ===');
  resetComposioCircuitBreaker();
  if (isComposioCircuitBreakerTripped()) {
    console.error('FAIL: resetComposioCircuitBreaker failed to reset state!');
    process.exit(1);
  }

  // Trip it again to test setComposioApiKey auto-reset
  tripComposioCircuitBreaker('Test trip');
  if (!isComposioCircuitBreakerTripped()) {
    console.error('FAIL: tripComposioCircuitBreaker failed to trip!');
    process.exit(1);
  }

  setComposioApiKey('new_fresh_composio_key_2026');
  if (isComposioCircuitBreakerTripped()) {
    console.error('FAIL: setComposioApiKey must reset circuit breaker upon receiving updated credentials!');
    process.exit(1);
  }
  console.log('PASS: Updating API key / reset function cleanly cleared circuit breaker state.');

  console.log('\n=== TEST 5: Successful API Call Returns JSON Data ===');
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ success: true, result: 'Operation completed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const successResult = await callComposioApi('https://backend.composio.dev/api/v3/tools/execute', { action: 'ping' });
  if (!successResult?.success || successResult?.result !== 'Operation completed') {
    console.error('FAIL: Expected JSON response, got:', successResult);
    process.exit(1);
  }
  console.log('PASS: Successful response correctly parsed and returned.');

  console.log('\n=== TEST 6: executeComposioAction Halts Infinite Loops on 401 ===');
  // Set an invalid key and mock 401
  setComposioApiKey('bad_key');
  resetComposioCircuitBreaker();

  let actionCallCount = 0;
  globalThis.fetch = async () => {
    actionCallCount++;
    return new Response(JSON.stringify({ error: 'Unauthorized', message: '401' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  // Run Twitter action (which has maxRetries = 3 and 2 action aliases = up to 6+ calls if not broken)
  const actionResult = await executeComposioAction('COMPOSIO_TWITTER_CREATION_OF_A_POST', { text: 'Hello' });
  console.log('Action Result on 401:', actionResult);

  if (actionResult.successful) {
    console.error('FAIL: Action should not report successful on 401!');
    process.exit(1);
  }

  if (!isComposioCircuitBreakerTripped()) {
    console.error('FAIL: Circuit breaker should be tripped after 401 in executeComposioAction!');
    process.exit(1);
  }

  console.log(`Action Call Count before break: ${actionCallCount}`);
  if (actionCallCount > 2) {
    console.error(`FAIL: Action hammered endpoint ${actionCallCount} times rather than breaking out!`);
    process.exit(1);
  }
  console.log('PASS: executeComposioAction halted retry and alias loop immediately upon 401.');

  console.log('\n=== TEST 7: executeComposioAction Fast-Fails When Breaker Is Tripped ===');
  const preTrippedResult = await executeComposioAction('COMPOSIO_SLACK_SEND_MESSAGE', { channel: 'general' });
  if (preTrippedResult.successful || !preTrippedResult.error?.includes('Circuit breaker open')) {
    console.error('FAIL: Expected fail-fast circuit breaker response, got:', preTrippedResult);
    process.exit(1);
  }
  console.log('PASS: executeComposioAction fast-fails when circuit breaker is tripped.');

  console.log('\n=== TEST 8: Export Verification in ComposioService ===');
  if (typeof ComposioService.callComposioApi !== 'function' ||
      typeof ComposioService.isComposioCircuitBreakerTripped !== 'function' ||
      typeof ComposioService.tripComposioCircuitBreaker !== 'function' ||
      typeof ComposioService.resetComposioCircuitBreaker !== 'function' ||
      typeof ComposioService.getComposioCircuitBreakerState !== 'function' ||
      typeof ComposioService.saveComposioApiKey !== 'function') {
    console.error('FAIL: Circuit breaker methods missing from ComposioService export object!');
    process.exit(1);
  }
  console.log('PASS: All circuit breaker methods correctly exported on ComposioService.');

  // Restore fetch
  globalThis.fetch = originalFetch;

  console.log('\n ALL 8 COMPOSIO CIRCUIT BREAKER TESTS PASSED SUCESSFULLY!');
}

runCircuitBreakerTests().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
