import { loadLLMProviderConfig } from './LLMProviderService';

export interface AgentTelemetryMetrics {
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalRuntimeMs: number;
  estimatedCostUsd: number;
}

export interface TelemetrySummary {
  totalTasksCompleted: number;
  totalTasksFailed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalRuntimeMs: number;
  estimatedCostUsd: number;
  agentMetrics: Record<string, AgentTelemetryMetrics>;
  history: TelemetryExecutionRecord[];
}

export interface TelemetryExecutionRecord {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  prompt: string;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  provider: string;
  estimatedCostUsd: number;
}

const STORAGE_TELEMETRY_KEY = 'pixelops_telemetry_ledger_v1';

/**
 * Model-agnostic cost calculator mapping token consumption to estimated cost based on active provider.
 * Rates per 1M tokens (Approximate industry averages):
 * - Gemini Flash: Input $0.075, Output $0.30
 * - Gemini Pro: Input $1.25, Output $5.00
 * - OpenAI GPT-4o: Input $2.50, Output $10.00
 * - Anthropic Claude 3.5 Sonnet: Input $3.00, Output $15.00
 * - Ollama / Local / Custom: $0.00
 */
export function calculateTokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  providerId?: string
): number {
  let provider = providerId;
  if (!provider) {
    try {
      const cfg = loadLLMProviderConfig();
      provider = cfg.providerId;
    } catch {
      provider = 'gemini';
    }
  }

  let inputRatePer1M = 0.075;
  let outputRatePer1M = 0.30;

  if (provider === 'openai') {
    inputRatePer1M = 2.50;
    outputRatePer1M = 10.00;
  } else if (provider === 'anthropic') {
    inputRatePer1M = 3.00;
    outputRatePer1M = 15.00;
  } else if (provider === 'ollama') {
    inputRatePer1M = 0.0;
    outputRatePer1M = 0.0;
  } else if (provider === 'gemini') {
    inputRatePer1M = 0.075;
    outputRatePer1M = 0.30;
  }

  const cost = (inputTokens / 1_000_000) * inputRatePer1M + (outputTokens / 1_000_000) * outputRatePer1M;
  return Number(cost.toFixed(6));
}

export function loadTelemetrySummary(): TelemetrySummary {
  try {
    const raw = localStorage.getItem(STORAGE_TELEMETRY_KEY);
    if (!raw) {
      return getEmptyTelemetrySummary();
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : getEmptyTelemetrySummary();
  } catch {
    return getEmptyTelemetrySummary();
  }
}

export function saveTelemetrySummary(summary: TelemetrySummary): void {
  try {
    localStorage.setItem(STORAGE_TELEMETRY_KEY, JSON.stringify(summary));
  } catch {
    // Ignore storage quota errors
  }
}

function getEmptyTelemetrySummary(): TelemetrySummary {
  return {
    totalTasksCompleted: 0,
    totalTasksFailed: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalRuntimeMs: 0,
    estimatedCostUsd: 0,
    agentMetrics: {},
    history: [],
  };
}

export function recordTelemetryExecution(record: {
  agentId: string;
  agentName: string;
  prompt: string;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}): TelemetrySummary {
  const summary = loadTelemetrySummary();
  const cfg = loadLLMProviderConfig();
  const cost = calculateTokenCostUsd(record.inputTokens, record.outputTokens, cfg.providerId);
  const totalTokens = record.inputTokens + record.outputTokens;

  const execRecord: TelemetryExecutionRecord = {
    id: 'tele_' + Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toISOString(),
    agentId: record.agentId,
    agentName: record.agentName,
    prompt: record.prompt,
    success: record.success,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens,
    durationMs: record.durationMs,
    provider: cfg.providerId,
    estimatedCostUsd: cost,
  };

  summary.history.unshift(execRecord);
  if (summary.history.length > 200) {
    summary.history = summary.history.slice(0, 200);
  }

  if (record.success) {
    summary.totalTasksCompleted += 1;
  } else {
    summary.totalTasksFailed += 1;
  }

  summary.totalInputTokens += record.inputTokens;
  summary.totalOutputTokens += record.outputTokens;
  summary.totalTokens += totalTokens;
  summary.totalRuntimeMs += record.durationMs;
  summary.estimatedCostUsd = Number((summary.estimatedCostUsd + cost).toFixed(6));

  if (!summary.agentMetrics[record.agentId]) {
    summary.agentMetrics[record.agentId] = {
      agentId: record.agentId,
      agentName: record.agentName,
      tasksCompleted: 0,
      tasksFailed: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalRuntimeMs: 0,
      estimatedCostUsd: 0,
    };
  }

  const agentM = summary.agentMetrics[record.agentId];
  agentM.agentName = record.agentName;
  if (record.success) {
    agentM.tasksCompleted += 1;
  } else {
    agentM.tasksFailed += 1;
  }
  agentM.totalInputTokens += record.inputTokens;
  agentM.totalOutputTokens += record.outputTokens;
  agentM.totalTokens += totalTokens;
  agentM.totalRuntimeMs += record.durationMs;
  agentM.estimatedCostUsd = Number((agentM.estimatedCostUsd + cost).toFixed(6));

  saveTelemetrySummary(summary);
  return summary;
}

export function resetTelemetryLedger(): TelemetrySummary {
  const empty = getEmptyTelemetrySummary();
  saveTelemetrySummary(empty);
  return empty;
}
