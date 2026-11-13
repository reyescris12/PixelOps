import { ThemeId } from '../context/ThemeContext';
import {
  storeSecureCredential,
  getSecureCredential,
  getCachedDecryptedCredential,
} from './SecureVaultService';

export type LLMProviderType = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'ollama';

export type AuthMode = 'subscription' | 'apikey';

export type SubscriptionPlanType =
  | 'google_ai_pro'
  | 'openai_plus_pro'
  | 'anthropic_claude_pro'
  | 'groq_lpu'
  | 'ollama_local';

export interface ConnectedSubscriptionAccount {
  providerId: LLMProviderType;
  planType: SubscriptionPlanType;
  planName: string; // e.g. "Google AI Pro Plan (Gemini Advanced)"
  planTier?: 'pro' | 'plus' | 'team' | 'advanced' | 'free';
  email: string;
  displayName?: string;
  avatarUrl?: string;
  accessToken: string; // OAuth Access Token or Bearer Token
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  status: 'connected' | 'expired' | 'disconnected';
  connectedAt: string;
}

export interface LLMProviderConfig {
  providerId: LLMProviderType;
  authMode: AuthMode; // 'subscription' | 'apikey'
  apiKey: string;
  endpoint: string;
  modelName: string; // e.g. gemini-3.8-flash, gpt-4o, claude-3-5-sonnet-20241022, llama3.3
  connectedAccounts?: Partial<Record<LLMProviderType, ConnectedSubscriptionAccount>>;
  googleClientId?: string;
}

const STORAGE_KEY = 'pixelops_llm_provider_config_v2';

export const DEFAULT_PROVIDER_CONFIGS: Record<
  LLMProviderType,
  {
    defaultModel: string;
    defaultEndpoint: string;
    label: string;
    placeholderKey: string;
    availableModels: string[];
  }
> = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-3.8-flash',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    placeholderKey: 'AIzaSy...',
    availableModels: ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'],
  },
  openai: {
    label: 'OpenAI GPT-4o',
    defaultModel: 'gpt-4o',
    defaultEndpoint: 'https://api.openai.com/v1',
    placeholderKey: 'sk-...',
    availableModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1'],
  },
  anthropic: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-3-5-sonnet-20241022',
    defaultEndpoint: 'https://api.anthropic.com',
    placeholderKey: 'sk-ant-...',
    availableModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
  },
  groq: {
    label: 'Groq Cloud (LPU)',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    placeholderKey: 'gsk_...',
    availableModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'deepseek-r1-distill-llama-70b',
    ],
  },
  ollama: {
    label: 'Local Ollama Endpoint',
    defaultModel: 'llama3.3',
    defaultEndpoint: 'http://localhost:11434',
    placeholderKey: 'Optional bearer token',
    availableModels: ['llama3.3', 'mistral', 'qwen2.5-coder'],
  },
};

export const SUBSCRIPTION_PLANS: Record<
  LLMProviderType,
  {
    planName: string;
    providerTitle: string;
    badge: string;
    description: string;
    features: string[];
    recommendedModels: string[];
  }
> = {
  gemini: {
    planName: 'Google AI Pro Plan (Gemini Advanced)',
    providerTitle: 'Google Account',
    badge: 'GOOGLE AI PRO',
    description:
      'Connect with your own Google Account to unlock Gemini 3.8 Flash with 1M token context, multimodal reasoning, and Google Search Grounding.',
    features: [
      '1M token context window & fast low-latency execution',
      'Native real-time Google search grounding on every directive',
      'Multimodal image, diagram, and code comprehension',
      'No rate-limit throttling under Google AI Pro',
    ],
    recommendedModels: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'],
  },
  openai: {
    planName: 'ChatGPT Plus & Pro Subscription',
    providerTitle: 'OpenAI Account',
    badge: 'CHATGPT PLUS / PRO',
    description:
      'Connect your ChatGPT Plus or Pro subscription to deploy GPT-4o and o3-mini models with high concurrency limits.',
    features: [
      'GPT-4o multimodal vision & code generation',
      'Advanced reasoning model access (o3-mini, o1)',
      'High throughput concurrency & tool execution',
    ],
    recommendedModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1'],
  },
  anthropic: {
    planName: 'Claude Pro & Team Subscription',
    providerTitle: 'Anthropic Account',
    badge: 'CLAUDE PRO',
    description:
      'Connect your Claude Pro or Team subscription for deep technical briefings, artifact authoring, and a 200k token context window.',
    features: [
      'Claude 3.5 Sonnet leading code intelligence',
      '200,000 token context window for large repos',
      'High priority response queues',
    ],
    recommendedModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
  },
  groq: {
    planName: 'Groq Cloud High-Speed Inference',
    providerTitle: 'Groq Account',
    badge: 'GROQ LPU',
    description:
      'Sub-second real-time reasoning with Llama 3.3 and DeepSeek R1 models powered by Groq LPUs.',
    features: [
      'Ultra high-speed generation (500+ tok/s)',
      'Llama 3.3 70B & DeepSeek R1 reasoning',
      'OpenAI-compatible chat completions interface',
    ],
    recommendedModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'deepseek-r1-distill-llama-70b',
    ],
  },
  ollama: {
    planName: 'Local Ollama Air-Gapped Engine',
    providerTitle: 'Local Workstation',
    badge: 'LOCAL OFFLINE',
    description:
      'Air-gapped, zero-cost private execution running directly on your local workstation without external cloud dependencies.',
    features: [
      '100% private, local & air-gapped',
      'Zero telemetry transmission to external cloud services',
      'Custom fine-tuned weights support (llama3.3, mistral)',
    ],
    recommendedModels: ['llama3.3', 'mistral', 'qwen2.5-coder'],
  },
};

/**
 * Normalizes Gemini model names to valid, active upstream Google API models (e.g. gemini-3.8-flash).
 * Strips any retired or deprecated legacy model identifiers.
 */
export function normalizeGeminiModel(modelName?: string): string {
  const m = String(modelName || '').trim();
  if (
    !m ||
    m.includes('2.0') ||
    m.includes('1.5')
  ) {
    return 'gemini-3.8-flash';
  }
  if (m.includes('2.5')) {
    return 'gemini-3.1-flash-lite';
  }
  if (
    m === 'gemini-3.8-flash' ||
    m === 'gemini-3.1-flash-lite' ||
    m === 'gemini-3.6-flash' ||
    m === 'gemini-3.5-flash-lite'
  ) {
    return m;
  }
  return 'gemini-3.8-flash';
}

/**
 * Helper to resolve an API key across standard and alias localStorage keys and env vars
 */
function resolveLocalApiKeyForProvider(pId: string): string {
  try {
    // 0. Check in-memory decrypted credentials cache first
    const inMem =
      getCachedDecryptedCredential(`byok::${pId}`) ||
      getCachedDecryptedCredential(`pixelops_${pId}_api_key`);
    if (inMem) return inMem;

    if (pId === 'gemini') {
      return (
        localStorage.getItem('pixelops_gemini_api_key') ||
        localStorage.getItem('gemini_api_key') ||
        localStorage.getItem('apiKey') ||
        localStorage.getItem('pixelops_api_key') ||
        localStorage.getItem('GOOGLE_API_KEY') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.GEMINI_API_KEY) ||
        ''
      ).trim();
    }
    if (pId === 'openai') {
      return (
        localStorage.getItem('pixelops_openai_api_key') ||
        localStorage.getItem('openai_api_key') ||
        localStorage.getItem('OPENAI_API_KEY') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_OPENAI_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.OPENAI_API_KEY) ||
        ''
      ).trim();
    }
    if (pId === 'anthropic') {
      return (
        localStorage.getItem('pixelops_anthropic_api_key') ||
        localStorage.getItem('anthropic_api_key') ||
        localStorage.getItem('claude_api_key') ||
        localStorage.getItem('ANTHROPIC_API_KEY') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ANTHROPIC_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.ANTHROPIC_API_KEY) ||
        ''
      ).trim();
    }
    if (pId === 'groq') {
      return (
        localStorage.getItem('pixelops_groq_api_key') ||
        localStorage.getItem('groq_api_key') ||
        localStorage.getItem('GROQ_API_KEY') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GROQ_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.GROQ_API_KEY) ||
        ''
      ).trim();
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Constructs the accurate endpoint URL and headers for Google Gemini via BYOK API Key.
 */
export function getGeminiAuthHeadersAndUrl(
  config: LLMProviderConfig,
  modelName?: string
): {
  url: string;
  headers: Record<string, string>;
  isSubscription: boolean;
  planName?: string;
  accountEmail?: string;
} {
  const normModel = normalizeGeminiModel(modelName || config.modelName);

  // BYOK mode: Explicitly pull active key from config OR all possible storage locations
  let key = config.apiKey?.trim() || '';
  if (!key || key === 'MY_GEMINI_API_KEY') {
    key = resolveLocalApiKeyForProvider('gemini');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key && key !== 'MY_GEMINI_API_KEY') {
    headers['x-goog-api-key'] = key;
  }

  return {
    url:
      key && key !== 'MY_GEMINI_API_KEY'
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            normModel
          )}:generateContent?key=${encodeURIComponent(key)}`
        : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            normModel
          )}:generateContent`,
    headers,
    isSubscription: false,
    planName: 'Developer API Key (BYOK)',
  };
}

/**
 * Returns summary diagnostic authentication metadata for active provider HUDs
 */
export function getLLMAuthInfo(config: LLMProviderConfig): {
  mode: AuthMode;
  isConnected: boolean;
  title: string;
  subtitle: string;
  badge: string;
  accountEmail?: string;
  model: string;
} {
  const pId = config.providerId || 'gemini';
  const byokKey =
    resolveLocalApiKeyForProvider(pId) ||
    (config.apiKey && config.apiKey !== 'MY_GEMINI_API_KEY' ? config.apiKey.trim() : '');
  const hasByokKey = Boolean(byokKey && byokKey !== 'MY_GEMINI_API_KEY');

  return {
    mode: 'apikey',
    isConnected: hasByokKey,
    title: `${DEFAULT_PROVIDER_CONFIGS[pId].label} (BYOK)`,
    subtitle: hasByokKey ? 'Developer API Key Active' : 'API Key Unconfigured — Enter Key in Settings',
    badge: hasByokKey ? 'BYOK ACTIVE' : 'NO API KEY',
    model: pId === 'gemini' ? normalizeGeminiModel(config.modelName) : config.modelName,
  };
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

    // If key is masked or empty in localStorage, check in-memory decrypted credentials
    if (!apiKey || apiKey === '••••••••' || apiKey.startsWith('••••') || apiKey === 'MY_GEMINI_API_KEY') {
      const inMem =
        getCachedDecryptedCredential(`byok::${pId}`) ||
        getCachedDecryptedCredential(`pixelops_${pId}_api_key`);
      if (inMem) {
        apiKey = inMem;
      }
    }

    // Check alternate storage locations & environment variables if key is unset
    if (!apiKey || apiKey === '••••••••' || apiKey.startsWith('••••') || apiKey === 'MY_GEMINI_API_KEY') {
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
      'gemini-3.8-flash';
    const modelName = pId === 'gemini' ? normalizeGeminiModel(rawModel) : rawModel;

    // Load connected accounts and PURGE any fake mock accounts or mock tokens
    const connectedAccounts: Partial<Record<LLMProviderType, ConnectedSubscriptionAccount>> =
      parsed?.connectedAccounts || {};

    // Purge fake mock accounts
    if (
      connectedAccounts.gemini &&
      (connectedAccounts.gemini.email === 'commander@gmail.com' ||
        connectedAccounts.gemini.accessToken?.includes('google_ai_pro_'))
    ) {
      delete connectedAccounts.gemini;
      localStorage.removeItem('pixelops_connected_google_account');
    }

    // Default authMode: If valid real subscription account is connected, use subscription; otherwise default to apikey!
    const hasValidSubscription = Boolean(
      connectedAccounts[pId]?.status === 'connected' &&
        connectedAccounts[pId]?.accessToken &&
        !connectedAccounts[pId]?.accessToken?.includes('google_ai_pro_') &&
        (connectedAccounts[pId]?.accessToken?.startsWith('ya29.') ||
          connectedAccounts[pId]?.accessToken?.startsWith('AIzaSy'))
    );

    let authMode: AuthMode = parsed?.authMode || (hasValidSubscription ? 'subscription' : 'apikey');
    if (!hasValidSubscription) {
      authMode = 'apikey';
    }

    const googleClientId =
      parsed?.googleClientId ||
      localStorage.getItem('pixelops_google_client_id') ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID) ||
      '';

    return {
      providerId: pId,
      authMode,
      apiKey,
      endpoint:
        parsed?.endpoint ||
        DEFAULT_PROVIDER_CONFIGS[pId]?.defaultEndpoint ||
        DEFAULT_PROVIDER_CONFIGS.gemini.defaultEndpoint,
      modelName,
      connectedAccounts,
      googleClientId,
    };
  } catch {
    return {
      providerId: 'gemini',
      authMode: 'apikey',
      apiKey: '',
      endpoint: DEFAULT_PROVIDER_CONFIGS.gemini.defaultEndpoint,
      modelName: DEFAULT_PROVIDER_CONFIGS.gemini.defaultModel,
      connectedAccounts: {},
    };
  }
}

export function saveLLMProviderConfig(config: LLMProviderConfig) {
  try {
    const cleanKey = (config.apiKey || '').trim();

    // Sanitize config stored in localStorage: never persist raw plaintext API keys
    const sanitizedConfig = {
      ...config,
      apiKey: cleanKey ? '••••••••' : '',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizedConfig));

    if (cleanKey && cleanKey !== '••••••••' && !cleanKey.startsWith('••••')) {
      // Store encrypted in IndexedDB vault
      storeSecureCredential(`byok::${config.providerId}`, cleanKey).catch(() => {});
      storeSecureCredential(`pixelops_${config.providerId}_api_key`, cleanKey).catch(() => {});

      // Purge any legacy plaintext keys from localStorage
      localStorage.removeItem(`pixelops_${config.providerId}_api_key`);
      localStorage.removeItem(`${config.providerId}_api_key`);
      if (config.providerId === 'gemini') {
        localStorage.removeItem('apiKey');
        localStorage.removeItem('pixelops_api_key');
        localStorage.removeItem('GOOGLE_API_KEY');
      }
    }
    if (config.googleClientId && config.googleClientId.trim()) {
      localStorage.setItem('pixelops_google_client_id', config.googleClientId.trim());
    }
    if (config.connectedAccounts?.gemini) {
      localStorage.setItem(
        'pixelops_connected_google_account',
        JSON.stringify(config.connectedAccounts.gemini)
      );
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Connects a subscription account (Google, OpenAI, Anthropic) and activates subscription auth mode
 */
export function connectSubscriptionAccount(
  account: ConnectedSubscriptionAccount
): LLMProviderConfig {
  const current = loadLLMProviderConfig();
  const nextAccounts = {
    ...(current.connectedAccounts || {}),
    [account.providerId]: account,
  };
  const updated: LLMProviderConfig = {
    ...current,
    authMode: 'subscription',
    connectedAccounts: nextAccounts,
  };
  saveLLMProviderConfig(updated);
  return updated;
}

/**
 * Disconnects a subscription account
 */
export function disconnectSubscriptionAccount(providerId: LLMProviderType): LLMProviderConfig {
  const current = loadLLMProviderConfig();
  const nextAccounts = { ...(current.connectedAccounts || {}) };
  delete nextAccounts[providerId];
  const updated: LLMProviderConfig = {
    ...current,
    connectedAccounts: nextAccounts,
    authMode: 'apikey',
  };
  saveLLMProviderConfig(updated);
  if (providerId === 'gemini') {
    localStorage.removeItem('pixelops_connected_google_account');
  }
  return updated;
}

/**
 * Switches the active authentication mode (Subscription vs BYOK API Key)
 */
export function setLLMAuthMode(authMode: AuthMode): LLMProviderConfig {
  const current = loadLLMProviderConfig();
  const updated: LLMProviderConfig = {
    ...current,
    authMode,
  };
  saveLLMProviderConfig(updated);
  return updated;
}

/**
 * Connects an authenticated Google AI Pro or major AI subscription account using the user's
 * actual email and verified access credential (Google AI Studio Key, gcloud token, or OAuth Bearer).
 */
export async function connectUserSubscriptionAccount(params: {
  providerId: LLMProviderType;
  email: string;
  credentialKey: string;
}): Promise<ConnectedSubscriptionAccount> {
  const cleanEmail = params.email.trim();
  const cleanKey = params.credentialKey.trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please enter a valid email address for your account.');
  }
  if (!cleanKey) {
    throw new Error('Please enter your Google AI Studio API key or OAuth access token.');
  }

  // Pre-validate credentials with Google Gemini upstream
  if (params.providerId === 'gemini') {
    const isBearer = cleanKey.startsWith('ya29.');
    const testUrl = isBearer
      ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
      : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(
          cleanKey
        )}`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isBearer) {
      headers['Authorization'] = `Bearer ${cleanKey}`;
    }

    const testRes = await fetch(testUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Verify link.' }] }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!testRes.ok) {
      const errData = await testRes.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${testRes.status}: Invalid Google AI credentials`;
      throw new Error(`Google Authentication Failed: ${msg}`);
    }
  }

  const plan = SUBSCRIPTION_PLANS[params.providerId] || SUBSCRIPTION_PLANS.gemini;
  const account: ConnectedSubscriptionAccount = {
    providerId: params.providerId,
    planType:
      params.providerId === 'gemini'
        ? 'google_ai_pro'
        : params.providerId === 'openai'
        ? 'openai_plus_pro'
        : params.providerId === 'anthropic'
        ? 'anthropic_claude_pro'
        : 'ollama_local',
    planName: plan.planName,
    planTier: 'pro',
    email: cleanEmail,
    displayName: cleanEmail.split('@')[0],
    accessToken: cleanKey,
    expiresAt: Date.now() + 30 * 24 * 3600 * 1000,
    status: 'connected',
    connectedAt: new Date().toISOString(),
  };

  connectSubscriptionAccount(account);
  return account;
}

/**
 * Validates connection health for either Subscription Bearer Authentication or BYOK Developer API Keys.
 * Generous 25s timeout prevents spurious timeout errors on cold connections.
 */
export async function testLLMProviderConnection(
  config: LLMProviderConfig,
  themeId: ThemeId = 'green',
  modeOverride?: AuthMode
): Promise<{ ok: boolean; message?: string; error?: string; model?: string }> {
  try {
    const pId = config.providerId || 'gemini';
    const effectiveMode = modeOverride || config.authMode || 'apikey';

    if (pId === 'gemini') {
      const isSub =
        effectiveMode === 'subscription' &&
        Boolean(config.connectedAccounts?.gemini?.accessToken) &&
        !config.connectedAccounts?.gemini?.accessToken?.includes('google_ai_pro_');

      let key = (config.apiKey || '').trim();
      if (!key) {
        try {
          key =
            localStorage.getItem('pixelops_gemini_api_key')?.trim() ||
            localStorage.getItem('gemini_api_key')?.trim() ||
            '';
        } catch {}
      }

      if (!isSub && (!key || key === 'MY_GEMINI_API_KEY')) {
        return {
          ok: false,
          error:
            'Gemini API key is missing. Please enter your Google Gemini API key (AIzaSy...) in the field above or save it in pixelops_gemini_api_key.',
        };
      }

      const model = normalizeGeminiModel(config.modelName);
      const token = isSub ? config.connectedAccounts!.gemini!.accessToken.trim() : key;
      const isBearer = isSub && !token.startsWith('AIzaSy');

      const url = isBearer
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
          )}:generateContent`
        : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
          )}:generateContent?key=${encodeURIComponent(token)}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (isBearer) {
        headers['Authorization'] = `Bearer ${token}`;
      } else if (token) {
        headers['x-goog-api-key'] = token;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with a 6-word tactical readiness confirmation.' }] }],
        }),
        signal: AbortSignal.timeout(25000), // 25s timeout
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || `HTTP ${res.status}: Gemini authentication failed`;
        return {
          ok: false,
          error: msg,
          model,
        };
      }

      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
        'Gemini tactical link verified. All agents standing by.';
      return {
        ok: true,
        message: `${text} [Mode: ${isSub ? 'Google AI Pro Subscription' : 'BYOK Key'}]`,
        model,
      };
    }

    if (pId === 'openai') {
      const isSub =
        effectiveMode === 'subscription' && Boolean(config.connectedAccounts?.openai?.accessToken);
      const key = isSub
        ? config.connectedAccounts?.openai?.accessToken
        : config.apiKey?.trim();

      if (!key) {
        return {
          ok: false,
          error: 'OpenAI API key is missing. Please enter your OpenAI API key (sk-...) above.',
        };
      }

      const model = config.modelName || 'gpt-4o';
      const endpoint = config.endpoint || 'https://api.openai.com/v1';
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
          max_tokens: 30,
        }),
        signal: AbortSignal.timeout(25000),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: data?.error?.message || `HTTP ${res.status}: OpenAI authentication failed`,
          model,
        };
      }
      return {
        ok: true,
        message: data?.choices?.[0]?.message?.content?.trim() || 'OpenAI connection verified.',
        model,
      };
    }

    if (pId === 'anthropic') {
      const isSub =
        effectiveMode === 'subscription' &&
        Boolean(config.connectedAccounts?.anthropic?.accessToken);
      const key = isSub
        ? config.connectedAccounts?.anthropic?.accessToken
        : config.apiKey?.trim();

      if (!key) {
        return {
          ok: false,
          error: 'Anthropic API key is missing. Please enter your Anthropic key (sk-ant-...) above.',
        };
      }

      const model = config.modelName || 'claude-3-5-sonnet-20241022';
      const endpoint = config.endpoint || 'https://api.anthropic.com';
      const res = await fetch(`${endpoint}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': key.trim(),
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
          'dangerously-allow-browser': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 30,
          messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
        }),
        signal: AbortSignal.timeout(25000),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: data?.error?.message || `HTTP ${res.status}: Anthropic authentication failed`,
          model,
        };
      }
      return {
        ok: true,
        message: data?.content?.[0]?.text?.trim() || 'Anthropic connection verified.',
        model,
      };
    }

    if (pId === 'groq') {
      const key = config.apiKey?.trim();
      if (!key) {
        return {
          ok: false,
          error: 'Groq API key is missing. Please enter your Groq API key (gsk_...) above.',
        };
      }

      const model = config.modelName || 'llama-3.3-70b-versatile';
      const endpoint = config.endpoint || 'https://api.groq.com/openai/v1';
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
          max_tokens: 30,
        }),
        signal: AbortSignal.timeout(25000),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: data?.error?.message || `HTTP ${res.status}: Groq authentication failed`,
          model,
        };
      }
      return {
        ok: true,
        message: data?.choices?.[0]?.message?.content?.trim() || 'Groq LPU connection verified.',
        model,
      };
    }

    if (pId === 'ollama') {
      const endpoint = config.endpoint || 'http://localhost:11434';
      const res = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { ok: false, error: `Ollama endpoint unreachable at ${endpoint} (HTTP ${res.status})` };
      }
      return {
        ok: true,
        message: 'Local Ollama endpoint online and responding.',
        model: config.modelName || 'llama3.3',
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
        err.name === 'TimeoutError' || err.message?.includes('aborted')
          ? 'Connection timed out (25s limit reached). Check your network or API endpoint.'
          : err?.message || 'Network error connecting to LLM endpoint.',
    };
  }
}
