// services/ModelGateway.ts

import { getProviderApiKey, hasProviderApiKey, SUPPORTED_VAULT_PROVIDERS } from './BYOKVault';
import { callPuterModel as puterChat } from './PuterAuth';
import { getOpenRouterKey } from './OpenRouterAuth';

export type ModelGatewayProvider = 'gemini' | 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'puter';
export type InferenceTier = 'fast' | 'reasoning';

export interface ModelGatewayMessage {
  role: 'user' | 'assistant' | 'system' | 'model';
  content: string;
}

export class ModelGateway {
  static resolveApiKey(provider: ModelGatewayProvider): string {
    if (provider === 'openrouter') {
      return getOpenRouterKey();
    }
    if (provider === 'puter') {
      return 'puter_zero_key';
    }
    return getProviderApiKey(provider as any);
  }

  static hasValidKey(provider: ModelGatewayProvider): boolean {
    if (provider === 'puter') {
      return true;
    }
    if (provider === 'openrouter') {
      return Boolean(getOpenRouterKey());
    }
    return hasProviderApiKey(provider as any);
  }

  static getDefaultModel(provider: ModelGatewayProvider): string {
    if (provider === 'openrouter') {
      return 'google/gemini-2.5-flash:free';
    }
    if (provider === 'puter') {
      return 'google/gemini-2.5-flash';
    }
    return SUPPORTED_VAULT_PROVIDERS[provider as keyof typeof SUPPORTED_VAULT_PROVIDERS]?.defaultModel || 'gemini-3.8-flash';
  }

  /**
   * Dual-Speed Inference Routing:
   * Returns a sub-200ms lightweight model for 'fast' path (sprite dialogues, short pings, triage),
   * or a deep frontier model for 'reasoning' path (classified dossiers, security audits, planning).
   */
  static getModelForTier(provider: ModelGatewayProvider, tier: InferenceTier = 'reasoning'): string {
    if (provider === 'openrouter') {
      return tier === 'fast' ? 'google/gemini-2.5-flash:free' : 'deepseek/deepseek-r1:free';
    }
    if (provider === 'puter') {
      return tier === 'fast' ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-flash';
    }
    if (provider === 'gemini') {
      return tier === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-3.8-flash';
    }
    if (provider === 'openai') {
      return tier === 'fast' ? 'gpt-4o-mini' : 'gpt-4o';
    }
    if (provider === 'anthropic') {
      return tier === 'fast' ? 'claude-3-5-haiku-20241022' : 'claude-3-5-sonnet-20241022';
    }
    if (provider === 'groq') {
      return 'llama-3.3-70b-versatile';
    }
    return this.getDefaultModel(provider);
  }

  /**
   * Puter.js 1-Click Zero-Key Model Inference Helper
   */
  static async callPuterModel(
    model?: string,
    systemPrompt: string = '',
    messages: (ModelGatewayMessage | any)[] = []
  ): Promise<string> {
    return await puterChat(model, systemPrompt, messages);
  }

  /**
   * OpenRouter 1-Click Power SSO Inference Helper (300+ models)
   */
  static async callOpenRouter(
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: (ModelGatewayMessage | any)[],
    tools?: any[]
  ): Promise<string> {
    const targetModel = model || 'google/gemini-2.5-flash:free';
    const formattedMessages: any[] = [];

    if (systemPrompt && systemPrompt.trim()) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const m of messages) {
      const role = m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user';
      const content = typeof m === 'string' ? m : m.content || '';
      formattedMessages.push({ role, content });
    }

    const payload: any = {
      model: targetModel,
      messages: formattedMessages,
    };
    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://pixelops.app',
        'X-Title': 'PixelOps Command Center',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || errJson?.message || `HTTP ${res.status}`;
      throw new Error(`OpenRouter API error: ${msg}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0]?.message;

    // Convert native tool_calls to uniform [AGENT_ACTION: tool_name] { ... } [/AGENT_ACTION] tags
    if (Array.isArray(choice?.tool_calls) && choice.tool_calls.length > 0) {
      const toolTags = choice.tool_calls
        .map((tc: any) => {
          const fnName = tc.function?.name || 'unknown_tool';
          const fnArgs = tc.function?.arguments || '{}';
          return `[AGENT_ACTION: ${fnName}] ${fnArgs} [/AGENT_ACTION]`;
        })
        .join('\n');
      return choice?.content ? `${choice.content}\n\n${toolTags}` : toolTags;
    }

    return choice?.content || '';
  }

  /**
   * Unified Routing Priority:
   * 1. If provider === 'puter' (or Puter SSO active and no manual override key), call Puter.js.
   * 2. If provider === 'openrouter' (or OpenRouter SSO active / key exists), call OpenRouter API.
   * 3. Otherwise fall back to manual BYOK provider keys (Gemini, Anthropic, OpenAI, Groq).
   */
  static async executePrompt(
    provider: ModelGatewayProvider,
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: (ModelGatewayMessage | any)[],
    tier?: InferenceTier,
    tools?: any[]
  ): Promise<string> {
    const ssoMode = typeof localStorage !== 'undefined' ? localStorage.getItem('pixelops_ai_sso_mode') : null;
    const openRouterKey =
      (apiKey && provider === 'openrouter' ? apiKey : '') ||
      (typeof localStorage !== 'undefined' ? (localStorage.getItem('pixelops_openrouter_key') || '').trim() : '');

    // 1. Puter.js 1-Click Zero-Key SSO Routing
    if (provider === 'puter' || (ssoMode === 'puter' && !apiKey)) {
      const targetModel = model || (tier === 'fast' ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-flash');
      return await this.callPuterModel(targetModel, systemPrompt, messages);
    }

    // 2. OpenRouter 1-Click Power SSO Routing
    if (
      provider === 'openrouter' ||
      (ssoMode === 'openrouter' && openRouterKey) ||
      (openRouterKey && !apiKey && !hasProviderApiKey(provider as any))
    ) {
      const effectiveKey = (apiKey && provider === 'openrouter' ? apiKey : '') || openRouterKey;
      if (!effectiveKey) {
        throw new Error('[UPLINK ERROR]: OpenRouter credentials missing. Connect via 1-Click Power SSO in Settings.');
      }
      let targetModel = model;
      if (
        !targetModel ||
        targetModel.includes('gemini-3.') ||
        (targetModel.includes('gpt-4o') && !targetModel.includes('/'))
      ) {
        targetModel = tier === 'fast' ? 'google/gemini-2.5-flash:free' : 'deepseek/deepseek-r1:free';
      }
      return await this.callOpenRouter(targetModel, effectiveKey, systemPrompt, messages, tools);
    }

    // 3. Manual BYOK Provider Routing (Gemini, Anthropic, OpenAI, Groq)
    let effectiveKey = (apiKey || '').trim() || this.resolveApiKey(provider);

    if (!effectiveKey) {
      // If manual key is missing but OpenRouter key is available, transparently fallback to OpenRouter
      if (openRouterKey) {
        const targetModel = tier === 'fast' ? 'google/gemini-2.5-flash:free' : 'deepseek/deepseek-r1:free';
        return await this.callOpenRouter(targetModel, openRouterKey, systemPrompt, messages);
      }
      throw new Error(`[UPLINK ERROR]: Missing API Key for provider: ${provider}`);
    }

    // Dynamically route model if tier is specified
    let targetModel = model;
    if (tier && (!targetModel || targetModel === this.getDefaultModel(provider))) {
      targetModel = this.getModelForTier(provider, tier);
    }
    if (!targetModel) {
      targetModel = tier ? this.getModelForTier(provider, tier) : this.getDefaultModel(provider);
    }

    switch (provider) {
      case 'gemini':
        return await this.callGemini(targetModel, effectiveKey, systemPrompt, messages);
      case 'anthropic':
        return await this.callAnthropic(targetModel, effectiveKey, systemPrompt, messages);
      case 'openai':
      case 'groq':
        return await this.callOpenAICompatible(provider, targetModel, effectiveKey, systemPrompt, messages);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private static async callGemini(
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: (ModelGatewayMessage | any)[]
  ): Promise<string> {
    const targetModel = model || 'gemini-3.8-flash';
    const isBearer = apiKey.startsWith('ya29.');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isBearer) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      headers['x-goog-api-key'] = apiKey;
    }

    const url = isBearer
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent`
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
          parts: [{ text: typeof m === 'string' ? m : m.content || '' }],
        })),
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Gemini API error: ${msg}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  private static async callAnthropic(
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: (ModelGatewayMessage | any)[]
  ): Promise<string> {
    const targetModel = model || 'claude-3-5-sonnet-20241022';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true', // Required for client-side PWAs
      },
      body: JSON.stringify({
        model: targetModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
          content: typeof m === 'string' ? m : m.content || '',
        })),
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Anthropic API error: ${msg}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  private static async callOpenAICompatible(
    provider: 'openai' | 'groq',
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: (ModelGatewayMessage | any)[]
  ): Promise<string> {
    const endpoint =
      provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

    const defaultModel = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o';
    const targetModel = model || defaultModel;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((m) => ({
            role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
            content: typeof m === 'string' ? m : m.content || '',
          })),
        ],
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || `HTTP ${res.status}`;
      throw new Error(`${provider.toUpperCase()} API error: ${msg}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

export default ModelGateway;
