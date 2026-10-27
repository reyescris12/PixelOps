/**
 * Safety & Architecture Hardening Service (SafetyService.ts)
 * Implements the Agent Cipher reliability and security hardening protocols:
 * 1. Circuit Breakers (executeSafeOperation) with AbortControllers, exponential backoff, and graceful fallbacks.
 * 2. Sandbox Sanitization (validateAndWrapCode) with static analysis and strict-mode IIFE scope isolation.
 * 3. Storage Monitoring & Health Audits (auditStorageHealth, pruneStorageData) preventing quota exhaustion.
 */

import { ledgerDb } from './CommandLedgerDb';

// ============================================================================
// 1. CIRCUIT BREAKER & RESILIENT OPERATION WRAPPER
// ============================================================================

export interface SafeOperationOptions<T> {
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  fallbackValue?: T | (() => T | Promise<T>);
  operationName?: string;
  retryCondition?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any, delayMs: number) => void;
}

export class SafeOperationError extends Error {
  public operationName: string;
  public attempts: number;
  public originalError: any;

  constructor(message: string, operationName: string, attempts: number, originalError: any) {
    super(message);
    this.name = 'SafeOperationError';
    this.operationName = operationName;
    this.attempts = attempts;
    this.originalError = originalError;
  }
}

/**
 * Wraps any asynchronous operation (LLM fetch, tool handler, storage call) in a resilient
 * circuit breaker featuring timeout abortion, exponential backoff retries, and graceful fallbacks.
 */
export async function executeSafeOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: SafeOperationOptions<T> = {}
): Promise<T> {
  const {
    timeoutMs = 12000,
    maxRetries = 2,
    backoffBaseMs = 350,
    maxBackoffMs = 3000,
    fallbackValue,
    operationName = 'anonymous_operation',
    retryCondition,
    onRetry,
  } = options;

  let attempt = 0;
  let lastError: any = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    let isTimedOut = false;
    let abortListener: (() => void) | null = null;

    const abortPromise = new Promise<never>((_, reject) => {
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
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      if (abortListener) controller.signal.removeEventListener('abort', abortListener);
      lastError = err;

      // Don't retry if request was aborted manually or reached max attempts
      const isAbort = isTimedOut || err?.name === 'AbortError' || err?.message?.includes('aborted');
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
      // Exponential backoff with jitter
      const delayMs = Math.min(
        maxBackoffMs,
        Math.round(backoffBaseMs * Math.pow(2, attempt - 1) + Math.random() * 50)
      );

      if (onRetry) {
        onRetry(attempt, err, delayMs);
      } else {
        console.warn(`[CircuitBreaker] Retrying [${operationName}] (Attempt ${attempt}/${maxRetries}) in ${delayMs}ms due to:`, err?.message || err);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // If fallback is provided, return it gracefully to protect the main UI thread from crashing
  if (fallbackValue !== undefined) {
    console.warn(`[CircuitBreaker] [${operationName}] exhausted retries (${attempt + 1}). Activating graceful fallback.`);
    if (typeof fallbackValue === 'function') {
      return (fallbackValue as () => T | Promise<T>)();
    }
    return fallbackValue;
  }

  throw new SafeOperationError(
    `[${operationName}] failed after ${attempt + 1} attempt(s): ${lastError?.message || String(lastError)}`,
    operationName,
    attempt + 1,
    lastError
  );
}

// ============================================================================
// 2. SANDBOX SANITIZATION & STATIC ANALYSIS GUARDS
// ============================================================================

export interface CodeSanitizationResult {
  valid: boolean;
  isValid: boolean;
  wrappedCode: string;
  error?: string;
  rejectionReason?: string;
  detectedThreat?: string;
}

const DANGEROUS_SECURITY_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
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

/**
 * Validates and sanitizes JavaScript code before execution in code_sandbox_eval.
 * 1. Enforces static analysis security guards to catch escape tokens.
 * 2. Wraps valid code inside an isolated strict-mode IIFE that shadows dangerous globals.
 */
export function validateAndWrapCode(rawCode: string): CodeSanitizationResult {
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

  // 1. Static Analysis Guard
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

  // 2. Strict-Mode IIFE with Scoped Shadowing
  // Shadows global identifiers (window, document, globalThis, top, parent, localStorage, etc.) to undefined
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

// ============================================================================
// 3. STORAGE MONITORING, HEALTH AUDITS & AUTOMATED PRUNING
// ============================================================================

export interface StorageHealthReport {
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
  isHealthy: boolean;
  warningTriggered: boolean;
  storageDetails: {
    indexedDbBytes: number;
    localStorageBytes: number;
    commandLedgerCount: number;
    agentMemoriesCount: number;
    vfsFileCount: number;
  };
  recommendation: 'healthy' | 'warning' | 'critical_prune_required';
  timestamp: string;
}

export interface PruneOptions {
  maxMemoryAgeDays?: number;
  keepRecentMemoriesPerAgent?: number;
  cleanStaleVfs?: boolean;
  emergencyPrune?: boolean;
}

export interface PruneResult {
  memoriesPruned: number;
  vfsFilesPruned: number;
  estimatedBytesFreed: number;
  executedAt: string;
}

let latestHealthReportCache: StorageHealthReport | null = null;

/**
 * Measures LocalStorage usage in bytes (UTF-16 encoding: key.length + val.length * 2).
 */
export function estimateLocalStorageBytes(): number {
  if (typeof localStorage === 'undefined') return 0;
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) {
        const v = localStorage.getItem(k) || '';
        bytes += (k.length + v.length) * 2;
      }
    }
  } catch {
    // Ignore access error
  }
  return bytes;
}

/**
 * Audits browser storage footprint (IndexedDB + LocalStorage) and warns if capacity exceeds 85%.
 */
export async function auditStorageHealth(): Promise<StorageHealthReport> {
  let usageBytes = 0;
  let quotaBytes = 50 * 1024 * 1024; // Default standard fallback quota 50MB
  let hasEstimateApi = false;

  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number') {
        usageBytes = est.usage;
        hasEstimateApi = true;
      }
      if (typeof est.quota === 'number' && est.quota > 0) {
        quotaBytes = est.quota;
      }
    } catch {
      // Fall through to manual estimate
    }
  }

  const localStorageBytes = estimateLocalStorageBytes();

  let commandLedgerCount = 0;
  let agentMemoriesCount = 0;
  try {
    commandLedgerCount = await ledgerDb.command_ledger.count();
    agentMemoriesCount = await ledgerDb.agent_memories.count();
  } catch {
    // Graceful fallback for in-memory mode
  }

  let vfsFileCount = 0;
  try {
    const rawVfs = localStorage.getItem('pixelops_vfs_files_v1');
    if (rawVfs) {
      const vfs = JSON.parse(rawVfs);
      vfsFileCount = Object.keys(vfs).length;
    }
  } catch {
    // Ignore
  }

  // If navigator.storage.estimate was unavailable, approximate total usage
  if (!hasEstimateApi) {
    const estimatedDbBytes = (commandLedgerCount * 450) + (agentMemoriesCount * 350);
    usageBytes = localStorageBytes + estimatedDbBytes;
  }

  const percentUsed = Math.min(100, Math.round((usageBytes / (quotaBytes || 1)) * 100));
  const warningTriggered = percentUsed >= 85 || localStorageBytes > 4 * 1024 * 1024; // 85% or LocalStorage > 4MB
  const isHealthy = !warningTriggered;

  let recommendation: 'healthy' | 'warning' | 'critical_prune_required' = 'healthy';
  if (percentUsed >= 85) {
    recommendation = 'critical_prune_required';
  } else if (percentUsed >= 70 || localStorageBytes > 3 * 1024 * 1024) {
    recommendation = 'warning';
  }

  const report: StorageHealthReport = {
    usageBytes,
    quotaBytes,
    percentUsed,
    isHealthy,
    warningTriggered,
    storageDetails: {
      indexedDbBytes: Math.max(0, usageBytes - localStorageBytes),
      localStorageBytes,
      commandLedgerCount,
      agentMemoriesCount,
      vfsFileCount,
    },
    recommendation,
    timestamp: new Date().toISOString(),
  };

  latestHealthReportCache = report;

  // Auto-prune if critical capacity reached
  if (warningTriggered) {
    console.warn(`[StorageHealth] Warning: storage capacity is at ${percentUsed}%. Initiating automated safety pruning...`);
    try {
      await pruneStorageData({ emergencyPrune: percentUsed >= 90 });
    } catch (e) {
      console.error('[StorageHealth] Automated safety pruning encounter:', e);
    }
  }

  return report;
}

/**
 * Returns the cached storage report synchronously if available.
 */
export function getLatestStorageHealthReport(): StorageHealthReport | null {
  return latestHealthReportCache;
}

/**
 * Prunes stale historical agent memories and temporary local VFS files
 * while preserving the immutable command ledger.
 */
export async function pruneStorageData(options: PruneOptions = {}): Promise<PruneResult> {
  const {
    maxMemoryAgeDays = 14,
    keepRecentMemoriesPerAgent = 30,
    cleanStaleVfs = true,
    emergencyPrune = false,
  } = options;

  let memoriesPruned = 0;
  let vfsFilesPruned = 0;
  let estimatedBytesFreed = 0;

  // 1. Prune Agent Memories (preserving recent memories per agent)
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (emergencyPrune ? 3 : maxMemoryAgeDays));
    const cutoffIso = cutoffDate.toISOString();

    const allMemories = await ledgerDb.agent_memories.toArray();
    const agentGroups: Record<string, typeof allMemories> = {};
    for (const mem of allMemories) {
      if (!agentGroups[mem.agentId]) agentGroups[mem.agentId] = [];
      agentGroups[mem.agentId].push(mem);
    }

    const idsToDelete: number[] = [];
    for (const agentId of Object.keys(agentGroups)) {
      const sorted = agentGroups[agentId].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      // Keep at least keepRecentMemoriesPerAgent
      const candidates = sorted.slice(emergencyPrune ? 10 : keepRecentMemoriesPerAgent);
      for (const cand of candidates) {
        if (cand.timestamp < cutoffIso && cand.id !== undefined) {
          idsToDelete.push(cand.id);
        }
      }
    }

    if (idsToDelete.length > 0) {
      await ledgerDb.agent_memories.bulkDelete(idsToDelete);
      memoriesPruned = idsToDelete.length;
      estimatedBytesFreed += memoriesPruned * 350;
    }
  } catch (err) {
    console.warn('[StorageHealth] Non-fatal memory pruning error:', err);
  }

  // 2. Prune Local VFS Temporary Files
  if (cleanStaleVfs && typeof localStorage !== 'undefined') {
    try {
      const rawVfs = localStorage.getItem('pixelops_vfs_files_v1');
      if (rawVfs) {
        const vfs = JSON.parse(rawVfs);
        const nextVfs: Record<string, any> = {};
        const vfsCutoff = new Date();
        vfsCutoff.setDate(vfsCutoff.getDate() - (emergencyPrune ? 1 : 7));
        const vfsCutoffIso = vfsCutoff.toISOString();

        for (const [pathKey, fileData] of Object.entries<any>(vfs)) {
          if (fileData.updatedAt && fileData.updatedAt < vfsCutoffIso && !pathKey.includes('permanent')) {
            vfsFilesPruned++;
            estimatedBytesFreed += (pathKey.length + (fileData.content?.length || 0)) * 2;
          } else {
            nextVfs[pathKey] = fileData;
          }
        }
        localStorage.setItem('pixelops_vfs_files_v1', JSON.stringify(nextVfs));
      }
    } catch {
      // Ignore
    }
  }

  // 3. Prune execution cards cache in LocalStorage if emergency
  if (emergencyPrune && typeof localStorage !== 'undefined') {
    try {
      const rawCards = localStorage.getItem('pixelops_execution_cards_v2');
      if (rawCards) {
        const cards = JSON.parse(rawCards);
        if (Array.isArray(cards) && cards.length > 20) {
          const trimmed = cards.slice(0, 20);
          localStorage.setItem('pixelops_execution_cards_v2', JSON.stringify(trimmed));
          estimatedBytesFreed += (rawCards.length - JSON.stringify(trimmed).length) * 2;
        }
      }
    } catch {
      // Ignore
    }
  }

  console.log(`[StorageHealth] Prune complete: freed ~${Math.round(estimatedBytesFreed / 1024)}KB (${memoriesPruned} memories, ${vfsFilesPruned} VFS files).`);

  return {
    memoriesPruned,
    vfsFilesPruned,
    estimatedBytesFreed,
    executedAt: new Date().toISOString(),
  };
}
