import { ThemeId } from '../context/ThemeContext';

export type LLMProviderType = 'gemini' | 'openai' | 'anthropic' | 'ollama';

export interface LLMProviderConfig {
  providerId: LLMProviderType;
  apiKey: string;
  endpoint: string; // e.g., http://localhost:11434 for Ollama
  modelName: string; // e.g. gemini-3.8-flash, gpt-4o, claude-3-5-sonnet, llama3
}

const STORAGE_KEY = 'pixelops_llm_provider_config_v2';

export const DEFAULT_PROVIDER_CONFIGS: Record<LLMProviderType, { defaultModel: string; defaultEndpoint: string; label: string; placeholderKey: string }> = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-3.8-flash',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    placeholderKey: 'AIzaSy...',
  },
  openai: {
    label: 'OpenAI GPT-4o',
    defaultModel: 'gpt-4o',
    defaultEndpoint: 'https://api.openai.com/v1',
    placeholderKey: 'sk-...',
  },
  anthropic: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-3-5-sonnet-20241022',
    defaultEndpoint: 'https://api.anthropic.com',
    placeholderKey: 'sk-ant-...',
  },
  ollama: {
    label: 'Local Ollama Endpoint',
    defaultModel: 'llama3',
    defaultEndpoint: 'http://localhost:11434',
    placeholderKey: 'Optional bearer token',
  },
};

export function loadLLMProviderConfig(): LLMProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        providerId: 'gemini',
        apiKey: '',
        endpoint: DEFAULT_PROVIDER_CONFIGS.gemini.defaultEndpoint,
        modelName: DEFAULT_PROVIDER_CONFIGS.gemini.defaultModel,
      };
    }
    const parsed = JSON.parse(raw);
    const pId = (parsed.providerId || 'gemini') as LLMProviderType;
    return {
      providerId: pId,
      apiKey: parsed.apiKey || '',
      endpoint: parsed.endpoint || DEFAULT_PROVIDER_CONFIGS[pId]?.defaultEndpoint || DEFAULT_PROVIDER_CONFIGS.gemini.defaultEndpoint,
      modelName: parsed.modelName || DEFAULT_PROVIDER_CONFIGS[pId]?.defaultModel || 'gemini-3.8-flash',
    };
  } catch {
    return {
      providerId: 'gemini',
      apiKey: '',
      endpoint: DEFAULT_PROVIDER_CONFIGS.gemini.defaultEndpoint,
      modelName: DEFAULT_PROVIDER_CONFIGS.gemini.defaultModel,
    };
  }
}

export function saveLLMProviderConfig(config: LLMProviderConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors
  }
}

export async function testLLMProviderConnection(
  config: LLMProviderConfig,
  themeId: ThemeId = 'green'
): Promise<{ ok: boolean; message?: string; error?: string; model?: string }> {
  try {
    const res = await fetch('/api/llm/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: config.providerId,
        apiKey: config.apiKey,
        endpoint: config.endpoint,
        modelName: config.modelName,
        themeId,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || `Connection failed (HTTP ${res.status})`,
      };
    }
    return {
      ok: true,
      message: data.message || 'Connection verified successfully.',
      model: data.model || config.modelName,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Network error connecting to LLM endpoint.',
    };
  }
}
