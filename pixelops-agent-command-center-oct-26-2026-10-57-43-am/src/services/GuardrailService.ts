export interface GuardrailConfig {
  maxUnattendedJobs: number;
  maxTokensPerRun: number;
  humanInTheLoopApproval: boolean;
  haltOnCostAnomaly: boolean;
}

const STORAGE_GUARDRAILS_KEY = 'pixelops_guardrail_config_v1';

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  maxUnattendedJobs: 5,
  maxTokensPerRun: 2000,
  humanInTheLoopApproval: true,
  haltOnCostAnomaly: true,
};

export function loadGuardrailConfig(): GuardrailConfig {
  try {
    const raw = localStorage.getItem(STORAGE_GUARDRAILS_KEY);
    if (!raw) return DEFAULT_GUARDRAIL_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      maxUnattendedJobs: Number(parsed.maxUnattendedJobs) || DEFAULT_GUARDRAIL_CONFIG.maxUnattendedJobs,
      maxTokensPerRun: Number(parsed.maxTokensPerRun) || DEFAULT_GUARDRAIL_CONFIG.maxTokensPerRun,
      humanInTheLoopApproval: Boolean(parsed.humanInTheLoopApproval ?? DEFAULT_GUARDRAIL_CONFIG.humanInTheLoopApproval),
      haltOnCostAnomaly: Boolean(parsed.haltOnCostAnomaly ?? DEFAULT_GUARDRAIL_CONFIG.haltOnCostAnomaly),
    };
  } catch {
    return DEFAULT_GUARDRAIL_CONFIG;
  }
}

export function saveGuardrailConfig(config: GuardrailConfig) {
  try {
    localStorage.setItem(STORAGE_GUARDRAILS_KEY, JSON.stringify(config));
  } catch {
    // Ignore
  }
}

export function isHighRiskTool(toolName: string): boolean {
  return ['github_create_issue', 'slack_post_dispatch', 'calendar_schedule_event'].includes(toolName);
}
