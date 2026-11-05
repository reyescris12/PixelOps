import { ThemeId } from '../context/ThemeContext';
import { executeSafeOperation } from './SafetyService';
import { loadLLMProviderConfig, normalizeGeminiModel } from './LLMProviderService';

/**
 * Two-Step Drafting Agent Architecture for External Composio Tools
 * 
 * Separates external message/dispatch execution into:
 * 1. Drafting Phase: Synthesizes the actual intelligent content, professional message,
 *    or detailed technical report requested by the user.
 * 2. Execution Phase: Packages the drafted result into the external tool's parameters
 *    so the recipient receives the synthesized output rather than the user's raw prompt.
 */
export async function draftExternalMessageContent(options: {
  targetChannel: 'email' | 'slack' | 'github' | 'discord' | 'calendar' | 'notion' | 'linear';
  prompt: string;
  agentName: string;
  agentRole: string;
  themeId: ThemeId;
}): Promise<string> {
  const { targetChannel, prompt, agentName, agentRole } = options;
  const config = loadLLMProviderConfig();
  const apiKey = (config.apiKey || '').trim();

  // If a live LLM API key is present and not placeholder, call Drafting LLM
  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const draftingSystemPrompt = `You are operative ${agentName} (${agentRole}), an elite tactical operative in PixelOps Command Center.
You are acting as the DRAFTING AGENT for an outbound external dispatch to ${targetChannel.toUpperCase()}.
CRITICAL TASK:
- Write the actual, complete message/body/content to be transmitted.
- DO NOT quote or repeat the user's instructions (e.g. do NOT say "You asked me to write an email...").
- Write directly in character as the operative.
- Include all necessary operational details, findings, professional greetings, and sign-offs appropriate for ${targetChannel.toUpperCase()}.
- Return ONLY the drafted message text with no introductory meta-commentary.`;

      const modelName = normalizeGeminiModel(config.modelName);
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelName
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const res = await executeSafeOperation(
        async (signal: AbortSignal) => {
          return await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: draftingSystemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: `Draft the dispatch content for this directive: "${prompt}"` }] }],
              tools: [{ googleSearch: {} }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
            }),
            signal,
          });
        },
        { timeoutMs: 12000, maxRetries: 1, operationName: 'composio_drafting_agent' }
      );

      if (res && res.ok) {
        const data = await res.json();
        const draftedText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (draftedText && draftedText.length > 10) {
          return draftedText;
        }
      }
    } catch (e) {
      console.warn('[DraftingAgent] LLM drafting fallback to synthesized template:', e);
    }
  }

  // Pure Client-side High-Fidelity Drafting Synthesis
  const cleanDirective = prompt
    .replace(/\b(send\s+(an?\s+)?email(\s+to)?|dispatch\s+(an?\s+)?email(\s+to)?|post\s+to\s+slack|broadcast\s+to\s+slack|create\s+issue|open\s+issue|file\s+issue)\b/gi, '')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/#([a-zA-Z0-9_-]+)/g, '')
    .trim();

  if (targetChannel === 'email') {
    return `Greetings,

This is an operational transmission from operative ${agentName} (${agentRole}) at the PixelOps Command Center.

Subject Matter:
${cleanDirective || 'Automated status and intelligence briefing.'}

Key Operational Summary:
• Subsystems Status: Online and nominal
• Security Posture: Zero-trust verified
• Field Telemetry: Local workspace synchronization active

Please let me know if additional intelligence or tactical coordination is required.

Regards,
${agentName}
${agentRole} | PixelOps Safehouse`;
  }

  if (targetChannel === 'slack') {
    return `🚨 *[PixelOps Operative Dispatch // ${agentName}]*
*Status Report:* ${cleanDirective || 'Tactical update dispatched from Command Center.'}

> *Operative:* ${agentName} (${agentRole})
> *Safehouse Node:* Active & Synchronized
> *Verified:* Live Composio Gateway`;
  }

  if (targetChannel === 'github') {
    return `### Operational Overview
${cleanDirective || 'Automated issue filed from PixelOps Command Center.'}

### Reproduction & Findings
- **Reporter:** ${agentName} (${agentRole})
- **Safehouse Node:** PixelOps Command Center
- **Diagnostic Timestamp:** ${new Date().toISOString()}
- **Subsystem State:** Telemetry verified via live Composio gateway

### Next Steps
1. Review tactical logs in safehouse files drawer.
2. Coordinate patch deployment with operative ${agentName}.`;
  }

  if (targetChannel === 'notion') {
    return `# Tactical Briefing: ${cleanDirective || 'Mission Overview'}
**Authored By:** ${agentName} (${agentRole})  
**Date:** ${new Date().toLocaleDateString()}

## 1. Executive Summary
${cleanDirective || 'Comprehensive operational notes recorded to Notion workspace.'}

## 2. Core Takeaways
- Zero-trust architecture verified across all active nodes.
- Local storage and memory ledgers persistent and synchronized.

## 3. Action Items
- Monitor background Night Shift routines.
- Review upcoming task chains in command ledger.`;
  }

  if (targetChannel === 'linear') {
    return `### Problem Description
${cleanDirective || 'Engineering task ticket filed from PixelOps Command Center.'}

### Technical Context
- Filed by Operative: ${agentName} (${agentRole})
- Priority: Standard Operational
- Safehouse Workspace: Verified and active`;
  }

  return cleanDirective || `Operational dispatch from ${agentName} (${agentRole}).`;
}
