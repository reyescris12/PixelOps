// services/ModelGateway.ts

import { getProviderApiKey, hasProviderApiKey, SUPPORTED_VAULT_PROVIDERS } from './BYOKVault';

export type ModelGatewayProvider = 'gemini' | 'anthropic' | 'openai' | 'groq';
export type InferenceTier = 'fast' | 'reasoning';

export interface ModelGatewayMessage {
  role: 'user' | 'assistant' | 'system' | 'model';
  content: string;
}

export class ModelGateway {
  static resolveApiKey(provider: ModelGatewayProvider): string {
    return getProviderApiKey(provider);
  }

  static hasValidKey(provider: ModelGatewayProvider): boolean {
    return hasProviderApiKey(provider);
  }

  static getDefaultModel(provider: ModelGatewayProvider): string {
    return SUPPORTED_VAULT_PROVIDERS[provider]?.defaultModel || 'gemini-3.8-flash';
  }

  /**
   * Dual-Speed Inference Routing:
   * Returns a sub-200ms lightweight model for 'fast' path (sprite dialogues, short pings, triage),
   * or a deep frontier model for 'reasoning' path (classified dossiers, security audits, planning).
   */
  static getModelForTier(provider: ModelGatewayProvider, tier: InferenceTier = 'reasoning'): string {
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

  static async executePrompt(
    provider: ModelGatewayProvider,
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: (ModelGatewayMessage | any)[],
    tier?: InferenceTier
  ): Promise<string> {
    // Resolve API key if not provided directly
    let effectiveKey = (apiKey || '').trim() || this.resolveApiKey(provider);

    if (!effectiveKey) {
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
