/**
 * src/services/agentStore.ts
 * Per-Operative AI Model & Provider Registry
 * Manages customized model allocations (Gemini, Claude, GPT-4o, Groq) per agent
 * with persistent storage across sessions.
 */

import {
  SUPPORTED_VAULT_PROVIDERS,
  getProviderApiKey,
  hasProviderApiKey,
  getProviderDisplayName,
} from './BYOKVault';

export type AgentProvider = 'gemini' | 'anthropic' | 'openai' | 'groq';

export interface AgentModelConfig {
  provider: AgentProvider;
  model: string;
}

export const STORAGE_AGENT_MODELS_KEY = 'pixelops_agent_models_v1';

export const DEFAULT_AGENT_MODELS: Record<string, AgentModelConfig> = {
  vance: {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
  },
  agent_0: {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
  },
  nyx: {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
  },
  agent_1: {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
  },
  cipher: {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
  },
  agent_2: {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
  },
};

/**
 * Loads all customized agent model configs from storage
 */
export function getAllAgentModelConfigs(): Record<string, AgentModelConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_AGENT_MODELS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Retrieves the configured provider and model for a specific agent ID.
 * Falls back to default model allocation if unconfigured.
 */
export function getAgentModelConfig(agentId: string): AgentModelConfig {
  if (!agentId) {
    return { provider: 'gemini', model: 'gemini-3.8-flash' };
  }

  const all = getAllAgentModelConfigs();
  const idLower = agentId.toLowerCase();

  // 1. Direct match in agent models store
  if (all[agentId]) return all[agentId];
  if (all[idLower]) return all[idLower];

  // 2. Also check crew customizations store
  try {
    const rawCrew = localStorage.getItem('pixelops_crew_customization_v3');
    if (rawCrew) {
      const crewMap = JSON.parse(rawCrew);
      const found = crewMap[agentId] || crewMap[idLower];
      if (found?.provider && found?.model) {
        return {
          provider: found.provider as AgentProvider,
          model: found.model,
        };
      }
    }
  } catch {}

  // 3. Fallback to predefined agent defaults
  if (DEFAULT_AGENT_MODELS[idLower]) {
    return DEFAULT_AGENT_MODELS[idLower];
  }
  for (const [key, cfg] of Object.entries(DEFAULT_AGENT_MODELS)) {
    if (idLower.includes(key)) {
      return cfg;
    }
  }

  // 4. Global default
  return { provider: 'gemini', model: 'gemini-3.8-flash' };
}

/**
 * Saves a customized provider and model allocation for an agent
 */
export function saveAgentModelConfig(
  agentId: string,
  provider: AgentProvider,
  model: string
): void {
  if (!agentId) return;

  const validModel =
    model || SUPPORTED_VAULT_PROVIDERS[provider]?.defaultModel || 'gemini-3.8-flash';

  // 1. Save to dedicated agent models store
  const current = getAllAgentModelConfigs();
  current[agentId] = { provider, model: validModel };
  current[agentId.toLowerCase()] = { provider, model: validModel };
  try {
    localStorage.setItem(STORAGE_AGENT_MODELS_KEY, JSON.stringify(current));
  } catch {}

  // 2. Also sync to crew customizations store if agent exists there
  try {
    const rawCrew = localStorage.getItem('pixelops_crew_customization_v3');
    if (rawCrew) {
      const crewMap = JSON.parse(rawCrew);
      if (crewMap[agentId] || crewMap[agentId.toLowerCase()]) {
        const key = crewMap[agentId] ? agentId : agentId.toLowerCase();
        crewMap[key] = {
          ...crewMap[key],
          provider,
          model: validModel,
        };
        localStorage.setItem('pixelops_crew_customization_v3', JSON.stringify(crewMap));
      }
    }
  } catch {}
}

/**
 * Validates if the required API key for an agent's provider exists in the vault
 */
export function validateAgentProviderKey(provider: AgentProvider): {
  valid: boolean;
  message?: string;
} {
  const hasKey = hasProviderApiKey(provider);
  if (hasKey) {
    return { valid: true };
  }
  const name = getProviderDisplayName(provider);
  const meta = SUPPORTED_VAULT_PROVIDERS[provider];
  return {
    valid: false,
    message: `API Key required for ${name} (${meta?.storageKey || 'safehouse vault'}). Please configure it in Settings [⚙️].`,
  };
}

export {
  SUPPORTED_VAULT_PROVIDERS,
  getProviderApiKey,
  hasProviderApiKey,
  getProviderDisplayName,
};
