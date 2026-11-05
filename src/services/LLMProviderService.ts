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
    defaultModel: 'gemini-2.5-flash',
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

/**
 * Normalizes Gemini model names to valid upstream Google API models (e.g. gemini-2.5-flash)
 */
export function normalizeGeminiModel(modelName?: string): string {
  const m = String(modelName || '').trim();
  if (!m || m.includes('3.1') || m.toLowerCase() === 'gemini-3.1-flash-lite') {
    return 'gemini-2.5-flash';
  }
  return m;
}

export function loadLLMProviderConfig(): LLMProviderConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let parsed: any = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }

    const pId = (parsed?.providerId || 'gemini') as LLMProviderType;
    let apiKey = (parsed?.apiKey || '').trim();

    // Check alternate storage locations & environment variables if key is unset
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      const altKey =
        localStorage.getItem('pixelops_gemini_api_key') ||
        localStorage.getItem('gemini_api_key') ||
        localStorage.getItem('apiKey') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.GEMINI_API_KEY) ||
        (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.GEMINI_API_KEY) ||
        (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.VITE_GEMINI_API_KEY) ||
        '';
      if (altKey && typeof altKey === 'string' && altKey.trim() !== 'MY_GEMINI_API_KEY') {
        apiKey = altKey.trim();
      }
    }

    const rawModel =
      parsed?.modelName ||
      DEFAULT_PROVIDER_CONFIGS[pId]?.defaultModel ||
      'gemini-2.5-flash';
    const modelName = pId === 'gemini' ? normalizeGeminiModel(rawModel) : rawModel;

    return {
      providerId: pId,
      apiKey,
      endpoint:
        parsed?.endpoint ||
        DEFAULT_PROVIDER_CONFIGS[pId]?.defaultEndpoint ||
        DEFAULT_PROVIDER_CONFIGS.gemini.defaultEndpoint,
      modelName,
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
    const pId = config.providerId || 'gemini';
    const key = (config.apiKey || '').trim();

    if (pId === 'gemini') {
      if (!key) {
        return {
          ok: false,
          error: 'Gemini API key is missing. Enter your Google Gemini API key above.',
        };
      }
      const model = normalizeGeminiModel(config.modelName);
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with a 6-word tactical readiness confirmation.' }] }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: data?.error?.message || `HTTP ${res.status}: Gemini authentication failed`,
        };
      }
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Gemini link verified. All agents standing by.';
      return {
        ok: true,
        message: text,
        model,
      };
    }

    if (pId === 'openai') {
      if (!key) {
        return { ok: false, error: 'OpenAI API key is missing.' };
      }
      const model = config.modelName || 'gpt-4o';
      const endpoint = config.endpoint || 'https://api.openai.com/v1';
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
          max_tokens: 30,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data?.error?.message || `HTTP ${res.status}: OpenAI authentication failed` };
      }
      return {
        ok: true,
        message: data?.choices?.[0]?.message?.content?.trim() || 'OpenAI connection verified.',
        model,
      };
    }

    if (pId === 'anthropic') {
      if (!key) {
        return { ok: false, error: 'Anthropic API key is missing.' };
      }
      const model = config.modelName || 'claude-3-5-sonnet-20241022';
      const endpoint = config.endpoint || 'https://api.anthropic.com';
      const res = await fetch(`${endpoint}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'dangerously-allow-browser': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 30,
          messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data?.error?.message || `HTTP ${res.status}: Anthropic authentication failed` };
      }
      return {
        ok: true,
        message: data?.content?.[0]?.text?.trim() || 'Anthropic connection verified.',
        model,
      };
    }

    if (pId === 'ollama') {
      const endpoint = config.endpoint || 'http://localhost:11434';
      const res = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        return { ok: false, error: `Ollama endpoint unreachable (HTTP ${res.status})` };
      }
      return {
        ok: true,
        message: 'Local Ollama endpoint online and responding.',
        model: config.modelName || 'llama3',
      };
    }

    return {
      ok: true,
      message: 'Provider configuration saved.',
      model: config.modelName,
    };
  } catch (err: any) {
    return {
      ok: false,
      error:
        err.name === 'TimeoutError'
          ? 'Connection timed out (8s limit reached).'
          : err?.message || 'Network error connecting to LLM endpoint.',
    };
  }
}
