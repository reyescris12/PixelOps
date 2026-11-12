/**
 * Lazy facade over the agent execution engine (ApiService.ts).
 *
 * ApiService is ~300 kB of tool-routing, heuristics and model orchestration that is only
 * needed once the Commander actually dispatches a directive. Importing these wrappers
 * instead of ApiService keeps that code out of the startup bundle. Call
 * `preloadAgentEngine()` once the UI is idle so the first directive has no extra latency.
 */
import type * as ApiServiceModule from './ApiService';

type ApiService = typeof ApiServiceModule;

let enginePromise: Promise<ApiService> | null = null;

/** Loads (once) and returns the full ApiService module. */
export function loadAgentEngine(): Promise<ApiService> {
  if (!enginePromise) {
    enginePromise = import('./ApiService').catch((err) => {
      // Allow a retry on the next call if the chunk failed to download (e.g. offline blip).
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/** Warms the engine chunk in the background without blocking the caller. */
export function preloadAgentEngine(): void {
  loadAgentEngine().catch(() => {
    /* retried on first real use */
  });
}

export async function executeAgentDirective(
  ...args: Parameters<ApiService['executeAgentDirective']>
): Promise<Awaited<ReturnType<ApiService['executeAgentDirective']>>> {
  return (await loadAgentEngine()).executeAgentDirective(...args);
}

export async function executeRoundtableMeeting(
  ...args: Parameters<ApiService['executeRoundtableMeeting']>
): Promise<Awaited<ReturnType<ApiService['executeRoundtableMeeting']>>> {
  return (await loadAgentEngine()).executeRoundtableMeeting(...args);
}

export async function executeFunctionCallHandler(
  ...args: Parameters<ApiService['executeFunctionCallHandler']>
): Promise<Awaited<ReturnType<ApiService['executeFunctionCallHandler']>>> {
  return (await loadAgentEngine()).executeFunctionCallHandler(...args);
}
