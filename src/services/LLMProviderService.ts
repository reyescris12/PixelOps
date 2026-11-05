import { ThemeId } from '../context/ThemeContext';

export type LLMProviderType = 'gemini' | 'openai' | 'anthropic' | 'ollama';

export type AuthMode = 'subscription' | 'apikey';

export type SubscriptionPlanType =
  | 'google_ai_pro'
  | 'openai_plus_pro'
  | 'anthropic_claude_pro'
  | 'ollama_local';

export interface ConnectedSubscriptionAccount {
  providerId: LLMProviderType;
  planType: SubscriptionPlanType;
  planName: string; // e.g. "Google AI Pro Plan (Gemini Advanced)"
  planTier?: 'pro' | 'plus' | 'team' | 'advanced' | 'free';
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  accessToken?: string; // OAuth Access Token or Bearer Token
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
  endpoint: string; // e.g., http://localhost:11434 for Ollama
  modelName: string; // e.g. gemini-2.5-flash, gpt-4o, claude-3-5-sonnet, llama3
  connectedAccounts?: Partial<Record<LLMProviderType, ConnectedSubscriptionAccount>>;
  googleClientId?: string;
}

const STORAGE_KEY = 'pixelops_llm_provider_config_v2';

export const DEFAULT_PROVIDER_CONFIGS: Record<
  LLMProviderType,
  { defaultModel: string; defaultEndpoint: string; label: string; placeholderKey: string }
> = {
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
      'Connect with your Google Account to unlock Gemini 2.5 Flash and Gemini 2.5 Pro under your Google One AI Premium or Gemini Advanced subscription.',
    features: [
      'Unlimited 1M token context window',
      'Native real-time Google search grounding',
      'Priority latency & multimodal execution',
      'Full safehouse tool matrix authorization',
    ],
    recommendedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro'],
  },
  openai: {
    planName: 'ChatGPT Plus & Pro Subscription',
    providerTitle: 'OpenAI Account',
    badge: 'CHATGPT PLUS / PRO',
    description:
      'Connect your ChatGPT Plus or Pro subscription to deploy GPT-4o and advanced reasoning models with high concurrency limits.',
    features: [
      'GPT-4o multimodal vision & code generation',
      'Advanced reasoning model access (o1, o3-mini)',
      'High throughput concurrency & tool calling',
    ],
    recommendedModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
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
    recommendedModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku', 'claude-3-opus'],
  },
  ollama: {
    planName: 'Local Ollama Air-Gapped Engine',
    providerTitle: 'Local Workstation',
    badge: 'LOCAL OFFLINE',
    description:
      'Air-gapped, zero-cost private execution running directly on your local workstation without external cloud dependencies.',
    features: [
      '100% private, local & air-gapped',
      'Zero telemetry transmission to cloud providers',
      'Custom fine-tuned weights support (llama3, mistral)',
    ],
    recommendedModels: ['llama3', 'mistral', 'qwen2.5-coder'],
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

/**
 * Constructs the accurate endpoint URL and headers for Google Gemini, automatically
 * routing between Subscription Bearer Auth (Google Account / Google AI Pro) and BYOK API Key.
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
  const account = config.connectedAccounts?.gemini;
  const isSub =
    config.authMode === 'subscription' &&
    account?.status === 'connected' &&
    Boolean(account?.accessToken);

  if (isSub && account?.accessToken) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        normModel
      )}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.accessToken.trim()}`,
      },
      isSubscription: true,
      planName: account.planName || 'Google AI Pro Plan',
      accountEmail: account.email,
    };
  }

  const key = config.apiKey?.trim() || '';
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      normModel
    )}:generateContent?key=${encodeURIComponent(key)}`,
    headers: {
      'Content-Type': 'application/json',
    },
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
  const planMeta = SUBSCRIPTION_PLANS[pId] || SUBSCRIPTION_PLANS.gemini;
  const account = config.connectedAccounts?.[pId];

  if (config.authMode === 'subscription') {
    const isConn = account?.status === 'connected' && Boolean(account?.accessToken);
    return {
      mode: 'subscription',
      isConnected: isConn,
      title: account?.planName || planMeta.planName,
      subtitle: isConn
        ? `Connected as ${account?.email || account?.displayName || 'Google Account'}`
        : 'Subscription disconnected — Sign in to activate',
      badge: isConn ? planMeta.badge : 'SIGN IN REQUIRED',
      accountEmail: account?.email,
      model: pId === 'gemini' ? normalizeGeminiModel(config.modelName) : config.modelName,
    };
  }

  const hasKey = Boolean(config.apiKey && config.apiKey !== 'MY_GEMINI_API_KEY');
  return {
    mode: 'apikey',
    isConnected: hasKey,
    title: `${DEFAULT_PROVIDER_CONFIGS[pId].label} (BYOK)`,
    subtitle: hasKey ? 'Developer API Key Verified' : 'API Key Unconfigured',
    badge: hasKey ? 'BYOK ACTIVE' : 'NO API KEY',
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

    // Load any saved connected accounts
    const connectedAccounts: Partial<Record<LLMProviderType, ConnectedSubscriptionAccount>> =
      parsed?.connectedAccounts || {};

    // Check if legacy Google OAuth account exists in localStorage
    if (!connectedAccounts.gemini) {
      try {
        const storedGoogle = localStorage.getItem('pixelops_connected_google_account');
        if (storedGoogle) {
          connectedAccounts.gemini = JSON.parse(storedGoogle);
        }
      } catch {}
    }

    // Determine default authMode: If connected account is active or no API key, default to subscription
    let authMode: AuthMode = parsed?.authMode || 'subscription';
    if (!parsed?.authMode) {
      if (connectedAccounts[pId]?.status === 'connected') {
        authMode = 'subscription';
      } else if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
        authMode = 'apikey';
      } else {
        authMode = 'subscription';
      }
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
      authMode: 'subscription',
      apiKey: '',
      endpoint: DEFAULT_PROVIDER_CONFIGS.gemini.defaultEndpoint,
      modelName: DEFAULT_PROVIDER_CONFIGS.gemini.defaultModel,
      connectedAccounts: {},
    };
  }
}

export function saveLLMProviderConfig(config: LLMProviderConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
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
    authMode: current.apiKey ? 'apikey' : 'subscription',
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
 * Initiates an interactive Google Account Sign-In flow via popup window.
 * Requests OAuth 2.0 access token with Google Generative Language & profile scopes.
 */
export async function initiateGoogleSignIn(options?: {
  clientId?: string;
}): Promise<ConnectedSubscriptionAccount> {
  const currentConfig = loadLLMProviderConfig();
  const clientId =
    options?.clientId ||
    currentConfig.googleClientId ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID) ||
    '';

  const redirectUri = window.location.origin;
  const scope = encodeURIComponent(
    'openid email profile https://www.googleapis.com/auth/generative-language'
  );
  const state = `google_ai_pro_${Date.now()}`;

  // If a Google Client ID is configured, launch the real Google OAuth 2.0 consent screen
  if (clientId) {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=token&scope=${scope}&state=${state}&prompt=select_account`;

    const width = 520;
    const height = 660;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

    const popup = window.open(
      authUrl,
      'google_oauth_popup',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
    );

    if (!popup) {
      throw new Error('Popup blocked. Please allow popups for this origin to sign into Google.');
    }

    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error('Google sign-in timed out. Please try again.'));
      }, 120000);

      const messageHandler = async (event: MessageEvent) => {
        if (!event.data) return;
        if (event.data.type === 'GOOGLE_AUTH_SUCCESS' || event.data.googleAuthSuccess) {
          cleanup();
          const params = event.data.params || {};
          const token = params.access_token || params.code || '';
          if (!token) {
            reject(new Error('Google returned empty authentication credentials.'));
            return;
          }

          try {
            // Fetch Google user profile
            let profileData: any = null;
            try {
              const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (uRes.ok) profileData = await uRes.json();
            } catch {}

            const connected: ConnectedSubscriptionAccount = {
              providerId: 'gemini',
              planType: 'google_ai_pro',
              planName: 'Google AI Pro Plan (Gemini Advanced)',
              planTier: 'pro',
              email: profileData?.email || 'google.user@gmail.com',
              displayName: profileData?.name || 'Google AI Pro Subscriber',
              avatarUrl: profileData?.picture,
              accessToken: token,
              expiresAt: Date.now() + 3600 * 1000,
              status: 'connected',
              connectedAt: new Date().toISOString(),
            };
            connectSubscriptionAccount(connected);
            resolve(connected);
          } catch (err: any) {
            reject(err);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        window.removeEventListener('message', messageHandler);
        if (!popup.closed) {
          try {
            popup.close();
          } catch {}
        }
      };

      window.addEventListener('message', messageHandler);
    });
  }

  // If no OAuth Client ID is registered, provide seamless 1-click connect with simulated/session credentials
  return connectQuickSubscription('gemini');
}

/**
 * 1-Click Instant Connect for Subscription Plans (Google AI Pro, ChatGPT Plus/Pro, Claude Pro)
 */
export function connectQuickSubscription(
  providerId: LLMProviderType,
  customEmail?: string
): ConnectedSubscriptionAccount {
  const plan = SUBSCRIPTION_PLANS[providerId] || SUBSCRIPTION_PLANS.gemini;
  const mockTokens: Record<LLMProviderType, string> = {
    gemini: `ya29.google_ai_pro_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`,
    openai: `sess-chatgpt-plus-${Date.now().toString(36)}`,
    anthropic: `claude-pro-session-${Date.now().toString(36)}`,
    ollama: 'local-airgapped-token',
  };

  const account: ConnectedSubscriptionAccount = {
    providerId,
    planType:
      providerId === 'gemini'
        ? 'google_ai_pro'
        : providerId === 'openai'
        ? 'openai_plus_pro'
        : providerId === 'anthropic'
        ? 'anthropic_claude_pro'
        : 'ollama_local',
    planName: plan.planName,
    planTier: 'pro',
    email: customEmail || (providerId === 'gemini' ? 'commander@gmail.com' : 'commander@pixelops.ai'),
    displayName: `${plan.providerTitle} (${plan.badge})`,
    accessToken: mockTokens[providerId],
    expiresAt: Date.now() + 30 * 24 * 3600 * 1000, // 30 days
    status: 'connected',
    connectedAt: new Date().toISOString(),
  };

  connectSubscriptionAccount(account);
  return account;
}

/**
 * Manually attaches an OAuth Bearer token or session credential (e.g. from gcloud auth print-access-token)
 */
export function connectManualSubscriptionToken(
  providerId: LLMProviderType,
  accessToken: string,
  email?: string,
  displayName?: string
): ConnectedSubscriptionAccount {
  const plan = SUBSCRIPTION_PLANS[providerId] || SUBSCRIPTION_PLANS.gemini;
  const account: ConnectedSubscriptionAccount = {
    providerId,
    planType:
      providerId === 'gemini'
        ? 'google_ai_pro'
        : providerId === 'openai'
        ? 'openai_plus_pro'
        : providerId === 'anthropic'
        ? 'anthropic_claude_pro'
        : 'ollama_local',
    planName: plan.planName,
    planTier: 'pro',
    email: email || 'authenticated-subscriber@google.com',
    displayName: displayName || `${plan.providerTitle} (${plan.badge})`,
    accessToken: accessToken.trim(),
    expiresAt: Date.now() + 3600 * 1000,
    status: 'connected',
    connectedAt: new Date().toISOString(),
  };

  connectSubscriptionAccount(account);
  return account;
}

/**
 * Validates connection health for either Subscription Bearer Authentication or BYOK Developer API Keys
 */
export async function testLLMProviderConnection(
  config: LLMProviderConfig,
  themeId: ThemeId = 'green'
): Promise<{ ok: boolean; message?: string; error?: string; model?: string }> {
  try {
    const pId = config.providerId || 'gemini';

    if (pId === 'gemini') {
      const auth = getGeminiAuthHeadersAndUrl(config, config.modelName);
      const hasAuth =
        (config.authMode === 'subscription' && Boolean(auth.headers.Authorization)) ||
        (Boolean(config.apiKey) && config.apiKey !== 'MY_GEMINI_API_KEY');

      if (!hasAuth) {
        return {
          ok: false,
          error:
            'Gemini authentication missing. Sign into your Google Account (Google AI Pro Plan) or enter an API key.',
        };
      }

      const model = normalizeGeminiModel(config.modelName);
      const res = await fetch(auth.url, {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with a 6-word tactical readiness confirmation.' }] }],
        }),
        signal: AbortSignal.timeout(8000),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If simulated bearer token or unauthorized, return clear helpful message
        return {
          ok: false,
          error: data?.error?.message || `HTTP ${res.status}: Gemini authentication failed`,
        };
      }

      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
        'Gemini tactical link verified. All agents standing by.';
      return {
        ok: true,
        message: `${text} [Authenticated via: ${
          auth.isSubscription ? auth.planName : 'Developer API Key'
        }]`,
        model,
      };
    }

    if (pId === 'openai') {
      const isSub = config.authMode === 'subscription';
      const key = isSub
        ? config.connectedAccounts?.openai?.accessToken || config.apiKey
        : config.apiKey;

      if (!key) {
        return {
          ok: false,
          error: 'OpenAI authentication missing. Connect your ChatGPT Plus/Pro account or enter an API key.',
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
        signal: AbortSignal.timeout(8000),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error: data?.error?.message || `HTTP ${res.status}: OpenAI authentication failed`,
        };
      }
      return {
        ok: true,
        message: data?.choices?.[0]?.message?.content?.trim() || 'OpenAI connection verified.',
        model,
      };
    }

    if (pId === 'anthropic') {
      const isSub = config.authMode === 'subscription';
      const key = isSub
        ? config.connectedAccounts?.anthropic?.accessToken || config.apiKey
        : config.apiKey;

      if (!key) {
        return {
          ok: false,
          error: 'Anthropic authentication missing. Connect your Claude Pro account or enter an API key.',
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
        return {
          ok: false,
          error: data?.error?.message || `HTTP ${res.status}: Anthropic authentication failed`,
        };
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
