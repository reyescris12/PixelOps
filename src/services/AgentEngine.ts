/**
 * src/services/AgentEngine.ts
 * Unified agent execution engine and fetch wrapper for PixelOps operatives.
 * Ensures strict BYOK header injection, Google Search grounding, multi-turn tool loops,
 * and authentic Google Identity Services (GIS) / OAuth 2.0 integration.
 */

import {
  executeAgentDirective,
  executeRoundtableMeeting,
  pingGeminiConnection,
} from './ApiService';

import {
  loadLLMProviderConfig,
  saveLLMProviderConfig,
  getGeminiAuthHeadersAndUrl,
  normalizeGeminiModel,
  testLLMProviderConnection,
  connectUserSubscriptionAccount,
  disconnectSubscriptionAccount,
} from './LLMProviderService';

import { ModelGateway } from './ModelGateway';

// Alias executeAgentDirective as executeAgentCommand for backward/forward compatibility
export const executeAgentCommand = executeAgentDirective;
export const executeAgentRoundtableMeeting = executeRoundtableMeeting;

export {
  executeAgentDirective,
  executeRoundtableMeeting,
  pingGeminiConnection,
  loadLLMProviderConfig,
  saveLLMProviderConfig,
  getGeminiAuthHeadersAndUrl,
  normalizeGeminiModel,
  testLLMProviderConnection,
  connectUserSubscriptionAccount,
  disconnectSubscriptionAccount,
  ModelGateway,
};

export default {
  executeAgentDirective,
  executeAgentCommand,
  executeRoundtableMeeting,
  executeAgentRoundtableMeeting,
  pingGeminiConnection,
  loadLLMProviderConfig,
  saveLLMProviderConfig,
  getGeminiAuthHeadersAndUrl,
  normalizeGeminiModel,
  testLLMProviderConnection,
  connectUserSubscriptionAccount,
  disconnectSubscriptionAccount,
  ModelGateway,
};
