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
import {
  OPENROUTER_FREE_MODELS,
  OPENROUTER_FLAGSHIP_MODELS,
  OPENROUTER_SUPPORTED_MODELS,
  getOpenRouterKey,
} from './OpenRouterAuth';
import {
  PUTER_SUPPORTED_MODELS,
  isPuterSignedIn,
} from './PuterAuth';

export type AgentProvider = 'gemini' | 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'puter';

export interface AgentModelConfig {
  provider: AgentProvider;
  model: string;
}

export interface AgentAvailableProviderMeta {
  id: AgentProvider;
  name: string;
  badge: string;
  connectionType: 'byok' | 'sso_openrouter' | 'sso_puter';
  isConnected: boolean;
  statusLabel: string;
  storageKey: string;
  defaultModel: string;
  availableModels: Array<{ id: string; name: string; isFree?: boolean; badge?: string; context?: string }>;
}

/**
 * Returns dynamic list of AI providers and models reflecting live BYOK keys,
 * OpenRouter connection (highlighting free models), and Puter zero-key status.
 */
export function getAvailableAgentProvidersAndModels(): AgentAvailableProviderMeta[] {
  const orKey = getOpenRouterKey();
  const isOpenRouterConnected = Boolean(orKey);
  const isPuterConnected =
    (typeof localStorage !== 'undefined' && localStorage.getItem('pixelops_ai_sso_mode') === 'puter') ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('pixelops_puter_signed_in') === 'true');

  const providers: AgentAvailableProviderMeta[] = [
    // 1. OpenRouter (Free models + Flagships)
    {
      id: 'openrouter',
      name: 'OpenRouter (300+)',
      badge: isOpenRouterConnected ? '12+ FREE MODELS' : 'FREE MODELS',
      connectionType: 'sso_openrouter',
      isConnected: isOpenRouterConnected,
      statusLabel: isOpenRouterConnected ? 'Connected (PKCE SSO)' : 'Key / Connect Required',
      storageKey: 'pixelops_openrouter_key',
      defaultModel: 'google/gemini-2.5-flash:free',
      availableModels: [
        ...OPENROUTER_FREE_MODELS.map((m) => ({
          id: m.id,
          name: m.name,
          isFree: true,
          badge: 'FREE',
          context: m.context,
        })),
        ...OPENROUTER_FLAGSHIP_MODELS.map((m) => ({
          id: m.id,
          name: m.name,
          isFree: false,
          badge: 'FLAGSHIP',
          context: m.context,
        })),
      ],
    },
    // 2. Puter.js Zero-Key AI
    {
      id: 'puter',
      name: 'Puter.js (Zero-Key)',
      badge: 'ZERO-KEY AI',
      connectionType: 'sso_puter',
      isConnected: isPuterConnected || true, // Puter runs zero-key in browser
      statusLabel: isPuterConnected ? 'Active (Zero-Key)' : 'Ready (Zero-Key)',
      storageKey: 'Puter.js SDK',
      defaultModel: 'google/gemini-2.5-flash',
      availableModels: PUTER_SUPPORTED_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        isFree: true,
        badge: 'ZERO-KEY',
        context: m.context,
      })),
    },
    // 3. Google Gemini (BYOK)
    {
      id: 'gemini',
      name: 'Google Gemini',
      badge: 'GEMINI 3.8 / 3.1',
      connectionType: 'byok',
      isConnected: hasProviderApiKey('gemini'),
      statusLabel: hasProviderApiKey('gemini') ? 'Key Linked' : 'Key Required in Vault',
      storageKey: 'pixelops_gemini_api_key',
      defaultModel: 'gemini-3.8-flash',
      availableModels: [
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Default)', badge: 'BYOK', context: 'Fast frontier multimodal' },
        { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', badge: 'BYOK', context: 'Ultra-low latency triage' },
        { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', badge: 'BYOK', context: 'Balanced speed and context' },
      ],
    },
    // 4. Anthropic Claude (BYOK)
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      badge: 'CLAUDE 3.5',
      connectionType: 'byok',
      isConnected: hasProviderApiKey('anthropic'),
      statusLabel: hasProviderApiKey('anthropic') ? 'Key Linked' : 'Key Required in Vault',
      storageKey: 'pixelops_anthropic_api_key',
      defaultModel: 'claude-3-5-sonnet-20241022',
      availableModels: [
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', badge: 'BYOK', context: 'Premier reasoning & coding' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', badge: 'BYOK', context: 'Fast lightweight model' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', badge: 'BYOK', context: 'Complex deep analysis' },
      ],
    },
    // 5. OpenAI GPT (BYOK)
    {
      id: 'openai',
      name: 'OpenAI GPT',
      badge: 'GPT-4O / O3-MINI',
      connectionType: 'byok',
      isConnected: hasProviderApiKey('openai'),
      statusLabel: hasProviderApiKey('openai') ? 'Key Linked' : 'Key Required in Vault',
      storageKey: 'pixelops_openai_api_key',
      defaultModel: 'gpt-4o',
      availableModels: [
        { id: 'gpt-4o', name: 'GPT-4o', badge: 'BYOK', context: 'Flagship multimodal' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', badge: 'BYOK', context: 'Fast lightweight intelligence' },
        { id: 'o3-mini', name: 'o3-mini', badge: 'BYOK', context: 'Stem reasoning specialist' },
        { id: 'o1', name: 'o1', badge: 'BYOK', context: 'Deep reasoning chain' },
      ],
    },
    // 6. Groq Cloud (BYOK)
    {
      id: 'groq',
      name: 'Groq Cloud (LPU)',
      badge: 'LLAMA 3.3 70B',
      connectionType: 'byok',
      isConnected: hasProviderApiKey('groq'),
      statusLabel: hasProviderApiKey('groq') ? 'Key Linked' : 'Key Required in Vault',
      storageKey: 'pixelops_groq_api_key',
      defaultModel: 'llama-3.3-70b-versatile',
      availableModels: [
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', badge: 'BYOK', context: 'High-speed open frontier' },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', badge: 'BYOK', context: 'Sub-100ms ultra rapid' },
        { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', badge: 'BYOK', context: 'MoE high efficiency' },
        { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B', badge: 'BYOK', context: 'Distilled reasoning' },
      ],
    },
  ];

  return providers;
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
    model: 'gemini-3.1-flash-lite',
  },
  agent_1: {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
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

  let validModel = model;
  if (!validModel) {
    if (provider === 'openrouter') validModel = 'google/gemini-2.5-flash:free';
    else if (provider === 'puter') validModel = 'google/gemini-2.5-flash';
    else validModel = SUPPORTED_VAULT_PROVIDERS[provider as keyof typeof SUPPORTED_VAULT_PROVIDERS]?.defaultModel || 'gemini-3.8-flash';
  }

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
  if (provider === 'puter') {
    return { valid: true };
  }
  if (provider === 'openrouter') {
    const hasOr = Boolean(getOpenRouterKey());
    if (hasOr) return { valid: true };
    return {
      valid: false,
      message: 'OpenRouter not connected. Connect via 1-Click Power SSO in Settings [⚙️] to unlock free models.',
    };
  }
  const hasKey = hasProviderApiKey(provider);
  if (hasKey) {
    return { valid: true };
  }
  const name = getProviderDisplayName(provider);
  const meta = SUPPORTED_VAULT_PROVIDERS[provider as keyof typeof SUPPORTED_VAULT_PROVIDERS];
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
