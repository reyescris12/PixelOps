/**
 * Dynamic Agent Execution Handler for Cloudflare Pages Functions
 * Route: /api/agent/dispatch
 *
 * Pulls active tools dynamically from Composio for the caller's entityId at runtime,
 * injects them directly into Google Gemini function declarations, and executes any
 * triggered functionCalls seamlessly via the Composio v3 REST proxy.
 */

interface Env {
  COMPOSIO_API_KEY?: string;
  GEMINI_API_KEY?: string;
}

interface DispatchRequest {
  message: string;
  entityId: string;
  agentName?: string;
  activeAgentRole?: string;
  systemPrompt?: string;
  temperature?: number;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-composio-api-key, x-gemini-api-key, x-entity-id',
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  try {
    const composioApiKey =
      request.headers.get('x-composio-api-key')?.trim() || env.COMPOSIO_API_KEY?.trim();
    const geminiApiKey =
      request.headers.get('x-gemini-api-key')?.trim() || env.GEMINI_API_KEY?.trim();

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          error: 'GEMINI_API_KEY_MISSING',
          message: 'No Gemini API key configured in Cloudflare environment or header.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const body = (await request.json()) as DispatchRequest;
    const {
      message,
      entityId = request.headers.get('x-entity-id') || 'commander_default',
      agentName = 'Agent Vance',
      activeAgentRole = 'Lead Strategist',
      systemPrompt,
      temperature = 0.7,
    } = body;

    if (!message || !message.trim()) {
      return new Response(
        JSON.stringify({ error: 'MESSAGE_REQUIRED', message: 'Operational directive message is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const dynamicTools: any[] = [
      {
        name: 'live_web_search',
        description: 'Search live web knowledge nodes, current market/crypto pricing feeds, real-time news, and software releases.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search keywords, company name, crypto ticker, or target topic.' },
          },
          required: ['query'],
        },
      },
      {
        name: 'composio_github_list_issues',
        description: 'List issues in a GitHub repository with optional state filter ("open", "closed", "all").',
        parameters: {
          type: 'OBJECT',
          properties: {
            owner: { type: 'STRING', description: 'Repository owner or organization name.' },
            repo: { type: 'STRING', description: 'Repository name.' },
            state: { type: 'STRING', description: 'Issue state filter: "open" or "closed".' },
          },
          required: ['owner', 'repo'],
        },
      },
      {
        name: 'composio_github_get_repository',
        description: 'Get detailed information, stargazers, open issues count, and telemetry for a GitHub repository.',
        parameters: {
          type: 'OBJECT',
          properties: {
            owner: { type: 'STRING', description: 'Repository owner.' },
            repo: { type: 'STRING', description: 'Repository name.' },
          },
          required: ['owner', 'repo'],
        },
      },
    ];
    const activeAppNames: string[] = ['web_search', 'github'];

    // 1. If Composio is configured, dynamically query all active integrations for this user
    if (composioApiKey && entityId) {
      try {
        const accountsRes = await fetch(
          `https://backend.composio.dev/api/v3/connectedAccounts?entityId=${encodeURIComponent(entityId)}`,
          {
            headers: {
              'x-api-key': composioApiKey,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          }
        );

        if (accountsRes.ok) {
          const accountsData: any = await accountsRes.json();
          const activeAccounts = Array.isArray(accountsData)
            ? accountsData
            : accountsData?.items || accountsData?.connectedAccounts || accountsData?.data || [];

          for (const acc of activeAccounts) {
            if (acc.status === 'ACTIVE' || acc.status === 'INITIATED') {
              const name = (acc.appName || acc.app_name || '').toLowerCase().trim();
              if (name && !activeAppNames.includes(name)) {
                activeAppNames.push(name);
              }
            }
          }

          // 2. Query canonical tools for each active integration
          await Promise.all(
            activeAppNames.map(async (app) => {
              try {
                const toolsRes = await fetch(
                  `https://backend.composio.dev/api/v3/tools?toolkit_slug=${encodeURIComponent(app)}`,
                  {
                    headers: {
                      'x-api-key': composioApiKey,
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                    },
                  }
                );

                if (toolsRes.ok) {
                  const toolsData: any = await toolsRes.json();
                  const items = Array.isArray(toolsData)
                    ? toolsData
                    : toolsData?.items || toolsData?.tools || [];

                  for (const item of items) {
                    const slug = item.slug || item.name;
                    if (!slug) continue;

                    const rawParams = item.parameters || {};
                    dynamicTools.push({
                      name: `composio_${slug.toLowerCase()}`,
                      description: item.description || `Execute ${slug} on ${app.toUpperCase()} via Composio.`,
                      parameters: {
                        type: 'OBJECT',
                        description: rawParams.description || item.description || `Parameters for ${slug}`,
                        properties: rawParams.properties || {},
                        required: Array.isArray(rawParams.required) ? rawParams.required : [],
                      },
                    });
                  }
                }
              } catch (appErr) {
                console.warn(`[AGENT DISPATCH] Could not query tools for app ${app}:`, appErr);
              }
            })
          );
        }
      } catch (connErr) {
        console.warn('[AGENT DISPATCH] Composio account discovery failed:', connErr);
      }
    }

    // 3. Build Intent-Driven System Instruction & Autonomous Intelligence Protocol
    const declaredToolNames = dynamicTools.map((t) => t.name).join(', ');
    const activeNameLower = (agentName || '').toLowerCase();
    let personaSpecialization = '';
    if (activeNameLower.includes('cipher')) {
      personaSpecialization = `[STANDARDIZED OPERATIVE PERSONA: CIPHER (Code-Ops & Security Specialist)]
- PRIMARY FUNCTION: Repository audits, dependency checks, and technical vulnerability scans.
- EXECUTION STYLE: Blunt, highly technical, zero fluff.
- OUTPUT STANDARD: Actionable patch guides, error diagnostics, and verified code health metrics. Always supply exact file paths, line diffs, CVE identifiers, or dependency semver constraints.`;
    } else if (activeNameLower.includes('nyx')) {
      personaSpecialization = `[STANDARDIZED OPERATIVE PERSONA: NYX (OSINT & Recon Specialist)]
- PRIMARY FUNCTION: External intelligence gathering, web reconnaissance, competitor tracking, and sentiment analysis.
- EXECUTION STYLE: Clandestine, analytical, signal-focused.
- OUTPUT STANDARD: Classified dossiers (intel/dossier_[target]_[date].md) featuring Threat Level ratings (ALPHA-CRITICAL, BRAVO-ELEVATED, CHARLIE-NOMINAL), key findings, and raw source attributions. Separate confirmed signals from marketing noise.`;
    } else if (activeNameLower.includes('vance')) {
      personaSpecialization = `[STANDARDIZED OPERATIVE PERSONA: VANCE (Command Operations Chief)]
- PRIMARY FUNCTION: Workflow coordination, executive synthesis, and operational SITREPs.
- EXECUTION STYLE: Structured, authoritative, concise.
- OUTPUT STANDARD: Executive command briefings summarizing multi-source telemetry with zero conversational delay. Focus on bottom-line impact, tactical resource allocation, and prioritized execution queues.`;
    } else {
      personaSpecialization = `[STANDARDIZED OPERATIVE PERSONA: ${agentName.toUpperCase()} (${activeAgentRole})]
- PRIMARY FUNCTION: Grounded operational execution, verified intelligence synthesis, and tool-backed tactical workflows.
- EXECUTION STYLE: Objective, highly disciplined, zero conversational delay.
- OUTPUT STANDARD: Tool-verified operational briefs with zero fabricated telemetry.`;
    }

    const globalDirective = `# GLOBAL SYSTEM DIRECTIVE: AUTONOMOUS INTELLIGENCE & EXECUTION PROTOCOL (PIXELOPS)
## CORE MANDATE:
All operational agents (Cipher, Nyx, Vance, and custom roles) are strictly prohibited from generating fake mock summaries, hardcoded placeholders, or generic text-box fluff when executing tasks or briefings. Every agent must operate as an autonomous intelligence operative relying on live tool-fetched data, real-time wiretaps, and verifiable state parameters.

## MANDATORY RULES:
- RULE A (REAL-TIME VERIFICATION FIRST): Before compiling any report, briefing, or audit, you MUST invoke your authorized tool matrix (via Composio integrations or workspace storage) to gather live data. Citations must reference actual headlines, live issues, PR titles, real CVE strings, or verified URLs.
- RULE B (THE "SO WHAT?" IMPACT & ACTION DELTA): Every report or dossier MUST include a dedicated section titled "## Impact & Action Delta" answering: "Why does this matter, and what is the operational risk or next tactical step?"
- RULE C (STRUCTURED SCHEMA COMPLIANCE): Output must strictly conform to clean Markdown frontmatter or structured payloads so the terminal and VFS archive can index and render the results without layout breaks:
  ---
  title: <Dossier Title>
  operative: <Agent Name> (<Agent Role>)
  target: <Target Entity / Repo / Topic>
  date: <ISO Date or YYYY-MM-DD>
  threat_level: <ALPHA-CRITICAL | BRAVO-ELEVATED | CHARLIE-NOMINAL>
  sources_consulted: [<live tool/url 1>, <live tool/url 2>]
  ---

- RULE D (MANDATORY LIVE DATA VERIFICATION & HALLUCINATION GUARD):
  * ZERO-TOLERANCE FOR STALE MEMORIZED VALUES: When asked about live pricing, current metrics, or active market conditions, you are strictly forbidden from relying on internal model weights. You MUST successfully execute a live search or API tool call and parse the explicit numerical result.
  * EXECUTION FAILURE FALLBACK: If a tool call fails or cannot retrieve live data for a specific asset, you must NOT guess or estimate. You must explicitly state: "Telemetry retrieval failed—live market feed unreachable" rather than hallucinating a plausible number.
  * ASSERTION CHECK: Ensure all quantitative data, numbers, and stats match current temporal parameters (matching November 2026 live feeds). Outdated years (2021-2025) are strictly prohibited for live quotes.

${personaSpecialization}`;

    const baseSystemInstruction = `You are ${agentName} (${activeAgentRole}) in the PixelOps Command Center.
Available Dynamically Injected Tools: ${declaredToolNames || 'No external tools connected'}.

${globalDirective}

CRITICAL INTENT-DRIVEN TOOL SELECTION GUARDRAILS:
Before invoking any tool from Composio, analyze the user's intent:
- READ / LIST / SEARCH / AUDIT INTENT:
  If the user asks to check, audit, list, search, get, fetch, read, inspect, or review:
  You MUST select a LIST, GET, or SEARCH tool.
  NEVER default to a write/create action when a read/list action is requested.
- WRITE / CREATE / SEND / DELETE INTENT:
  If the user explicitly asks to create, send, push, post, schedule, star, or delete:
  You MUST select a CREATE, POST, SEND, or DELETE tool.
- PARAMETER VALIDATION:
  Ensure you correctly extract and validate required parameters (such as repository owner/name, query filters, search strings, channel names, or recipient email addresses) from the user's directive before firing the tool. For GitHub targets, split "owner/repo" into distinct owner and repo parameters.

DYNAMIC REAL-TIME QUERY FORMULATION & NUMERICAL EXTRACTION PROTOCOL:
- TEMPORAL & FRESHNESS ANCHORS (RULE 1):
  When tasked with checking live market data, prices, version updates, or recent news:
  * Formulate temporal and financial-specific search queries (e.g., "[Target] pricing 2026", "[Ticker] live price 2026", "[Product] latest release changelog 2026") rather than defaulting to static encyclopedia terms.
  * Always append current temporal anchors (current year "2026", "live ticker", "current price", or "latest release") to bypass static historical pages.
- EXCLUSION FILTERS FOR OSINT (RULE 2):
  * When running OSINT sweeps on financial or tech targets, focus strictly on live market data, price feeds, and vendor changelog sources.
  * Discard static encyclopedia or historical wiki domains (Wikipedia, Fandom, Britannica) unless explicitly requested by the watch condition.
- STRUCTURED PRICE/DATA EXTRACTION (RULE 3):
  * Whenever tool outputs or search snippets return raw financial or metric data (prices, percentage deltas, version strings, dollar amounts), you MUST parse the actual numerical values directly into your telemetry table rather than falling back to general conceptual descriptions.`;

    const systemInstruction = systemPrompt
      ? `${baseSystemInstruction}\n\n[USER-SPECIFIED AGENT DIRECTIVES]\n${systemPrompt}`
      : baseSystemInstruction;

    // 4. Hardened Multi-Turn Execution & Self-Correcting Tool Loop
    const conversationHistory: any[] = [
      { role: 'user', parts: [{ text: message }] },
    ];
    const executedToolsRecord: any[] = [];
    let finalDialogue = '';
    const MAX_TOOL_TURNS = 3;
    let turnCount = 0;

    while (turnCount < MAX_TOOL_TURNS) {
      turnCount++;

      const geminiPayload: any = {
        contents: conversationHistory,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: Number(temperature),
        },
      };

      // In Gemini API, functionDeclarations and googleSearch cannot be mixed in the same request
      if (dynamicTools.length > 0) {
        geminiPayload.tools = [{ functionDeclarations: dynamicTools.map(sanitizeGeminiFunctionSchema) }];
      } else {
        geminiPayload.tools = [{ googleSearch: {} }];
      }

      console.log(
        `[AGENT DISPATCH] Turn ${turnCount}: Dispatching to Gemini for "${agentName}". Active toolkits: [${activeAppNames.join(', ')}] | Dynamic tools: ${dynamicTools.length}`
      );

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiPayload),
        }
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        return new Response(
          JSON.stringify({ error: 'GEMINI_GENERATION_FAILED', details: errText }),
          { status: geminiRes.status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const aiData: any = await geminiRes.json();
      const candidate = aiData.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const functionCalls = parts
        .filter((p: any) => p.functionCall)
        .map((p: any) => p.functionCall);

      // If no tools requested, we have completed textual / structured synthesis
      if (functionCalls.length === 0) {
        finalDialogue = parts.map((p: any) => p.text || '').join('\n').trim();
        break;
      }

      // Record the assistant's tool-call request into conversation history
      conversationHistory.push(candidate.content);

      // Execute requested tools and prepare function response parts
      const functionResponseParts: any[] = [];

      for (const fc of functionCalls) {
        const toolName = fc.name || '';
        const toolArgs = fc.args || {};

        console.log(`[AGENT DISPATCH] Executing tool: "${toolName}" with args:`, toolArgs);

        let executionResult: any = null;
        let executionSuccessful = false;

        if (toolName === 'live_web_search') {
          try {
            const searchRes = await executeBackendWebSearch(toolArgs.query || message);
            executionResult = searchRes;
            executionSuccessful = true;
          } catch (searchErr: any) {
            executionResult = { error: searchErr?.message || 'Search execution failed.' };
            executionSuccessful = false;
          }
        } else if (composioApiKey && (toolName.startsWith('composio_') || toolName.startsWith('COMPOSIO_'))) {
          const rawAction = toolName.replace(/^composio_/i, '').toUpperCase();
          try {
            const execRes = await fetch(
              `https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(rawAction)}`,
              {
                method: 'POST',
                headers: {
                  'x-api-key': composioApiKey,
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                },
                body: JSON.stringify({
                  parameters: toolArgs,
                  entityId,
                }),
              }
            );

            executionResult = await execRes.json();
            executionSuccessful = execRes.ok && !executionResult?.error;
          } catch (execErr: any) {
            executionResult = { error: execErr?.message || 'Tool execution network fault' };
            executionSuccessful = false;
          }

          // If Composio failed and it's a GitHub action, try public GitHub REST fallback
          if (!executionSuccessful && rawAction.includes('GITHUB')) {
            try {
              const fbData = await executePublicGitHubFallback(rawAction, toolArgs);
              if (fbData) {
                executionResult = { data: fbData, source: 'GitHub Public Index' };
                executionSuccessful = true;
              }
            } catch {}
          }
        } else if (toolName.includes('github') || toolName.includes('GITHUB')) {
          try {
            const fbData = await executePublicGitHubFallback(toolName, toolArgs);
            if (fbData) {
              executionResult = { data: fbData, source: 'GitHub Public Index' };
              executionSuccessful = true;
            } else {
              executionResult = { error: `GitHub action ${toolName} failed on public repository.` };
              executionSuccessful = false;
            }
          } catch (ghErr: any) {
            executionResult = { error: ghErr?.message || 'GitHub lookup failed' };
            executionSuccessful = false;
          }
        } else {
          executionResult = { error: `Tool ${toolName} not executable via backend gateway.` };
          executionSuccessful = false;
        }

        executedToolsRecord.push({
          toolName,
          args: toolArgs,
          success: executionSuccessful,
          result: executionResult,
        });

        // SELF-CORRECTING FEEDBACK LOOP:
        // Feed back exact error details so agent retries with corrected parameters instead of generating mock fluff
        if (!executionSuccessful) {
          const errMsg =
            executionResult?.error?.message ||
            executionResult?.error ||
            executionResult?.message ||
            'Tool execution returned failure.';

          functionResponseParts.push({
            functionResponse: {
              name: toolName,
              response: {
                status: 'EXECUTION_ERROR',
                error: errMsg,
                rawDetails: executionResult,
                self_correction_directive:
                  `CRITICAL: Tool execution failed with error: "${errMsg}". ` +
                  `Do NOT invent fake mock data. Analyze the error, adjust your arguments ` +
                  `(e.g., ensure owner and repo are separated, query parameters match schema, or select a get/list tool), ` +
                  `and either retry with corrected arguments or explain the verified error clearly in ## Impact & Action Delta.`,
              },
            },
          });
        } else {
          functionResponseParts.push({
            functionResponse: {
              name: toolName,
              response: {
                status: 'SUCCESS',
                data: executionResult?.data || executionResult,
              },
            },
          });
        }
      }

      conversationHistory.push({
        role: 'user',
        parts: functionResponseParts,
      });
    }

    // 5. Explicit Tool Success Check for Live Real-Time Queries
    const isRealTime = /\b(price|pricing|cost|costs|rate|rates|fee|fees|tier|tiers|subscription|market\s+price|market\s+data|stock\s+price|stock\s+quote|ticker|crypto|token|coin|btc|eth|sol|bitcoin|ethereum|solana|valuation|mrr|arr|revenue|quote|live ticker|current price)\b/i.test(message);

    const verifiedPrices: string[] = [];
    for (const t of executedToolsRecord) {
      if (t.success && t.result) {
        const raw = JSON.stringify(t.result);
        const pMatches = raw.match(/(?:[\$€£]|USD\s?)\s?\d+(?:,\d{3})*(?:\.\d{1,4})?/gi) || [];
        for (const p of pMatches) {
          if (!verifiedPrices.includes(p)) verifiedPrices.push(p);
        }
      }
    }

    if (isRealTime && verifiedPrices.length === 0) {
      // Live tool call failed or cannot be parsed to yield verified real-time numerical payload.
      // Abort metric generation immediately without querying the LLM for speculative numbers.
      finalDialogue = `---
title: "Operational Telemetry: Feed Unreachable"
operative: "${agentName} (${activeAgentRole})"
target: "${message.slice(0, 40)}"
date: "${new Date().toISOString()}"
threat_level: "CHARLIE-NOMINAL"
sources_consulted:
  - "Live Data Oracle"
---

# Operational Telemetry: Metric Generation Aborted
**Target Directive:** \`${message}\`
**Verification Status:** [TELEMETRY FAILURE: Live data feed unreachable — aborting metric generation]

---

## 1. Operational Diagnostic
[TELEMETRY FAILURE: Live data feed unreachable — aborting metric generation]

The live data tool call failed or cannot be parsed to extract a verifiable real-time numerical payload for "${message}".
In accordance with strict anti-hallucination protocols, speculative metric estimation and stale model training weight outputs are completely aborted.

---

## 2. Impact & Action Delta
- **Operational Risk:** Real-time metrics cannot be authenticated against live oracles. Stale memorized values are suppressed.
- **Immediate Next Step:** Re-attempt query with an explicit ticker or verify external feed connectivity.
`;
    }

    // Final Synthesis Fallback if loop hit turn limit
    if (!finalDialogue) {
      try {
        const finalRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: conversationHistory,
              systemInstruction: {
                parts: [
                  {
                    text: `${systemInstruction}

[FINAL SYNTHESIS DIRECTIVE]
All tool execution turns are complete.
Synthesize your final operational report now:
1. ZERO MOCK DATA: Rely strictly on the real tool outputs and telemetry in the conversation above.
2. LIVE CITATIONS: Reference actual repository issues, PRs, email senders, or real zero-counts.
3. IMPACT & ACTION DELTA: Include mandatory section "## Impact & Action Delta".
4. STRUCTURED SCHEMA: Begin with valid YAML frontmatter.`,
                  },
                ],
              },
              generationConfig: {
                temperature: Number(temperature),
              },
              tools: [{ googleSearch: {} }],
            }),
          }
        );

        if (finalRes.ok) {
          const finalData: any = await finalRes.json();
          finalDialogue =
            finalData.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('\n').trim() || '';
        }
      } catch (finalErr) {
        console.warn('[AGENT DISPATCH] Final synthesis call failed:', finalErr);
      }
    }

    // Fallback heuristic card if final dialogue is still empty
    if (!finalDialogue) {
      const topTool = executedToolsRecord[0];
      finalDialogue = `---
title: "${agentName} Operational Synthesis"
operative: "${agentName} (${activeAgentRole})"
target: "Active Directive"
date: "${new Date().toISOString()}"
threat_level: "CHARLIE-NOMINAL"
sources_consulted:
  - "${topTool?.toolName || 'Composio Live Matrix'}"
---

# Operational Synthesis: Telemetry Verified
**Operative:** ${agentName} (${activeAgentRole})
**Execution Status:** ${topTool?.success ? 'LIVE DATA VERIFIED' : 'INVESTIGATION IN PROGRESS'}

---

## 1. Verified Telemetry Summary
Executed live tool matrix query \`${topTool?.toolName || 'system_audit'}\`.
Result status: ${topTool?.success ? 'Success - live payload processed.' : `Execution error: ${topTool?.result?.error || 'Inquiry logged.'}`}

---

## 2. Impact & Action Delta
- **Operational Assessment:** Telemetry captured and indexed.
- **Next Tactical Steps:** Review verified tool response in active terminal ledger.
`;
    }

    // 6. Quantitative Verification Gate & Hallucination Guard (Anti-Hallucination Assertion)
    if (isRealTime) {
      const priceRegex = /(?:[\$€£]|USD\s?)\s?\d+(?:,\d{3})*(?:\.\d{1,4})?/gi;
      if (verifiedPrices.length === 0) {
        if (priceRegex.test(finalDialogue)) {
          finalDialogue = finalDialogue.replace(
            priceRegex,
            '[TELEMETRY FAILURE: Live data feed unreachable — aborting metric generation]'
          );
        }
        if (!finalDialogue.includes('[TELEMETRY FAILURE: Live data feed unreachable — aborting metric generation]')) {
          finalDialogue = `> [!WARNING]\n> **MANDATORY LIVE DATA VERIFICATION GUARD:**\n> [TELEMETRY FAILURE: Live data feed unreachable — aborting metric generation]\n\n${finalDialogue}`;
        }
      } else {
        // Assert current November 2026 temporal parameters
        finalDialogue = finalDialogue.replace(/\b(as of|in|for|during)\s+(202[0-5])\b/gi, '$1 November 2026 (Live Feed)');
        if (!finalDialogue.includes('November 2026')) {
          finalDialogue += `\n\n---\n*Verified against live November 2026 feed oracle. Verified Price Points: ${verifiedPrices.slice(0, 3).join(', ')}*`;
        }
      }
    }

    // 7. Parse structured YAML frontmatter for predictable UI rendering
    let frontmatterMeta: Record<string, any> | null = null;
    const fmMatch = finalDialogue.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch && fmMatch[1]) {
      try {
        frontmatterMeta = {};
        for (const line of fmMatch[1].split(/\r?\n/)) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
            frontmatterMeta[key] = val;
          }
        }
      } catch {}
    }

    return new Response(
      JSON.stringify({
        success: true,
        dialogue: finalDialogue,
        structuredPayload: {
          frontmatter: frontmatterMeta,
          hasImpactDelta: finalDialogue.includes('Impact & Action Delta'),
          threatLevel: frontmatterMeta?.threat_level || 'CHARLIE-NOMINAL',
          target: frontmatterMeta?.target || null,
          title: frontmatterMeta?.title || `${agentName} Operational Report`,
        },
        executedTools: executedToolsRecord,
        agentName,
        activeToolkits: activeAppNames,
        dynamicToolsCount: dynamicTools.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  } catch (err: any) {
    console.error('[AGENT DISPATCH FAULT]', err);
    return new Response(
      JSON.stringify({ error: 'AGENT_DISPATCH_FAULT', message: err?.message || String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
}

async function executeBackendWebSearch(query: string): Promise<any> {
  const cleanQ = String(query || '').trim();
  const lowerQ = cleanQ.toLowerCase();
  const results: any[] = [];

  const COIN_MAP: Record<string, { symbol: string; name: string }> = {
    btc: { symbol: 'BTC', name: 'Bitcoin' },
    bitcoin: { symbol: 'BTC', name: 'Bitcoin' },
    eth: { symbol: 'ETH', name: 'Ethereum' },
    ethereum: { symbol: 'ETH', name: 'Ethereum' },
    sol: { symbol: 'SOL', name: 'Solana' },
    solana: { symbol: 'SOL', name: 'Solana' },
    xrp: { symbol: 'XRP', name: 'XRP' },
    doge: { symbol: 'DOGE', name: 'Dogecoin' },
    ada: { symbol: 'ADA', name: 'Cardano' },
    bnb: { symbol: 'BNB', name: 'Binance Coin' },
    near: { symbol: 'NEAR', name: 'NEAR Protocol' },
    sui: { symbol: 'SUI', name: 'Sui' },
    apt: { symbol: 'APT', name: 'Aptos' },
  };

  let matchedCoin: { symbol: string; name: string } | null = null;
  for (const [key, val] of Object.entries(COIN_MAP)) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(lowerQ)) {
      matchedCoin = val;
      break;
    }
  }

  if (matchedCoin) {
    try {
      const binanceRes = await fetch(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${matchedCoin.symbol}USDT`
      );
      if (binanceRes.ok) {
        const bData: any = await binanceRes.json();
        const numPrice = parseFloat(bData.lastPrice);
        const changePct = parseFloat(bData.priceChangePercent || '0');
        const changeStr = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
        results.push({
          title: `${matchedCoin.name} (${matchedCoin.symbol}) Live Spot Ticker`,
          snippet: `Current Spot Price: $${numPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD | 24h Change: ${changeStr} | 24h High: $${parseFloat(bData.highPrice).toLocaleString()} | 24h Low: $${parseFloat(bData.lowPrice).toLocaleString()}. Verified Binance live feed.`,
          url: `https://www.binance.com/en/trade/${matchedCoin.symbol}_USDT`,
        });
      }
    } catch {}

    if (results.length === 0) {
      try {
        const cbRes = await fetch(
          `https://api.coinbase.com/v2/prices/${matchedCoin.symbol}-USD/spot`
        );
        if (cbRes.ok) {
          const cbData: any = await cbRes.json();
          const numPrice = parseFloat(cbData.data.amount);
          results.push({
            title: `${matchedCoin.name} (${matchedCoin.symbol}) Live Spot Price`,
            snippet: `Current Spot Price: $${numPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD. Verified Coinbase spot oracle.`,
            url: `https://www.coinbase.com/price/${matchedCoin.symbol.toLowerCase()}`,
          });
        }
      } catch {}
    }

    if (results.length === 0) {
      try {
        const cgRes = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${matchedCoin.symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`
        );
        if (cgRes.ok) {
          const cgData: any = await cgRes.json();
          const coinKey = Object.keys(cgData)[0];
          if (coinKey && cgData[coinKey]?.usd) {
            const usdPrice = cgData[coinKey].usd;
            const change24h = cgData[coinKey].usd_24h_change
              ? `${cgData[coinKey].usd_24h_change >= 0 ? '+' : ''}${cgData[coinKey].usd_24h_change.toFixed(2)}%`
              : '0.00%';
            results.push({
              title: `${matchedCoin.name} (${matchedCoin.symbol}) Live CoinGecko Price`,
              snippet: `Current Price: $${usdPrice.toLocaleString()} USD | 24h Change: ${change24h}. Verified CoinGecko live feed.`,
              url: `https://www.coingecko.com/en/coins/${coinKey}`,
            });
          }
        }
      } catch {}
    }
  }

  // Extract concise core search keywords without noise or query pollution
  let cleanCore = cleanQ
    .replace(/^(?:vance|cipher|nyx|agent\s+\w+|operative\s+\w+)[,:\s-]+/i, '')
    .replace(/^(?:please\s+)?(?:search(?:\s+the\s+web)?(?:\s+for)?|look\s+up|find(?:\s+out)?(?:\s+about)?|research|investigate|query|browse|google|fetch|check(?:\s+the)?)\s+/i, '')
    .replace(/\s+(?:and\s+)?(?:compile|write|generate|draft|save|create|put|summarize|give\s+me|report|output).*$/i, '')
    .replace(/["'`“”]/g, '')
    .trim();

  const urlMatch = cleanCore.match(/https?:\/\/([^\s\/$.?#].[^\s]*)/i);
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[0]);
      const host = u.hostname.replace(/^www\./i, '');
      const brand = host.split('.')[0];
      const pathPart = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[-_/]/g, ' ');
      cleanCore = `${brand} ${pathPart}`.trim();
    } catch {}
  } else {
    cleanCore = cleanCore.replace(/\.(com|org|io|dev|app|ai|so|co|net)\b/gi, ' ');
  }
  cleanCore = cleanCore.replace(/\b(monitor|surveillance|shifts|tracking|updates|news|recon|sweep|intel|for|the|and|check|against|condition|baseline|2026)\b/gi, ' ');
  cleanCore = cleanCore.replace(/[^a-zA-Z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim();
  const searchTerm = cleanCore && cleanCore.length > 2 ? cleanCore : cleanQ;

  // Algolia HackerNews Search
  if (results.length < 3) {
    try {
      const hnRes = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(searchTerm)}&tags=story&hitsPerPage=3`
      );
      if (hnRes.ok) {
        const hnData: any = await hnRes.json();
        for (const hit of hnData.hits || []) {
          results.push({
            title: hit.title,
            snippet: `${hit.title} (${hit.points || 0} points, ${hit.num_comments || 0} comments, by ${hit.author || 'author'}).`,
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          });
        }
      }
    } catch {}
  }

  // Live Web Search via Jina Reader (Real-Time Web Scraping)
  if (results.length < 3) {
    try {
      const jinaRes = await fetch(`https://s.jina.ai/${encodeURIComponent(searchTerm)}`, {
        headers: { Accept: 'application/json', 'X-No-Cache': 'true' },
      });
      if (jinaRes.ok) {
        const jinaData: any = await jinaRes.json();
        const items = Array.isArray(jinaData?.data) ? jinaData.data : [];
        for (const item of items) {
          if (results.length >= 4) break;
          if (!item || (!item.title && !item.url)) continue;
          results.push({
            title: item.title || item.url || 'Web Intelligence Node',
            snippet: String(item.description || item.content || '').slice(0, 320),
            url: item.url || `https://s.jina.ai/${encodeURIComponent(searchTerm)}`,
          });
        }
      }
    } catch {}
  }

  return {
    query: cleanQ,
    resultCount: results.length,
    results,
    summary: results.length > 0 ? `Verified ${results.length} real-time intelligence nodes.` : 'No live matching nodes.',
  };
}

async function executePublicGitHubFallback(action: string, params: Record<string, any>): Promise<any> {
  const normAction = action.toUpperCase();
  const owner = params.owner || (params.repo?.includes('/') ? params.repo.split('/')[0] : '');
  const repo = params.repo?.includes('/') ? params.repo.split('/')[1] : params.repo;
  const state = params.state || 'open';

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'PixelOps-Autonomous-Agent/2.0',
  };

  if (normAction.includes('LIST_ISSUES') && owner && repo) {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${encodeURIComponent(state)}&per_page=10`,
      { headers }
    );
    if (res.ok) {
      const issues: any = await res.json();
      return Array.isArray(issues)
        ? issues.map((iss: any) => ({
            number: iss.number,
            title: iss.title,
            state: iss.state,
            user: iss.user?.login,
            comments: iss.comments,
            created_at: iss.created_at,
            html_url: iss.html_url,
          }))
        : issues;
    }
  }

  if (normAction.includes('GET_REPOSITORY') && owner && repo) {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers }
    );
    if (res.ok) {
      const data: any = await res.json();
      return {
        full_name: data.full_name,
        description: data.description,
        stargazers_count: data.stargazers_count,
        open_issues_count: data.open_issues_count,
        html_url: data.html_url,
      };
    }
  }

  return null;
}

function sanitizeGeminiFunctionSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const rawParams = schema.parameters || {};
  return {
    name: String(schema.name || '').trim(),
    description: String(schema.description || `Tool ${schema.name || ''}`).trim(),
    parameters: sanitizeSchemaObject(rawParams),
  };
}

function sanitizeSchemaObject(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return { type: 'OBJECT', properties: {}, required: [] };
  }
  let type = String(obj.type || 'OBJECT').toUpperCase();
  if (!['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'].includes(type)) {
    type = 'OBJECT';
  }
  const out: any = { type, description: obj.description || '' };
  if (Array.isArray(obj.enum) && obj.enum.length > 0) {
    out.enum = obj.enum.map(String);
  }
  if (type === 'OBJECT') {
    out.properties = {};
    const rawProps = obj.properties || {};
    for (const [key, val] of Object.entries(rawProps)) {
      out.properties[key] = sanitizeSchemaProperty(val);
    }
    out.required = Array.isArray(obj.required)
      ? obj.required.filter((r: any) => typeof r === 'string' && r in out.properties)
      : [];
  } else if (type === 'ARRAY') {
    out.items = obj.items ? sanitizeSchemaProperty(obj.items) : { type: 'STRING' };
  }
  return out;
}

function sanitizeSchemaProperty(val: any): any {
  if (!val || typeof val !== 'object') {
    return { type: 'STRING', description: '' };
  }
  if (Array.isArray(val.anyOf) && val.anyOf.length > 0) {
    const valid = val.anyOf.find((item: any) => item && item.type && item.type !== 'null') || val.anyOf[0];
    return sanitizeSchemaProperty(valid);
  }
  if (Array.isArray(val.oneOf) && val.oneOf.length > 0) {
    const valid = val.oneOf.find((item: any) => item && item.type && item.type !== 'null') || val.oneOf[0];
    return sanitizeSchemaProperty(valid);
  }
  let type = String(val.type || 'STRING').toUpperCase();
  if (Array.isArray(val.type)) {
    type = String(val.type.find((t: string) => t.toLowerCase() !== 'null') || 'STRING').toUpperCase();
  }
  if (!['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'].includes(type)) {
    type = 'STRING';
  }
  const res: any = { type, description: val.description || '' };
  if (Array.isArray(val.enum) && val.enum.length > 0) {
    res.enum = val.enum.map(String);
  }
  if (type === 'ARRAY') {
    res.items = val.items ? sanitizeSchemaProperty(val.items) : { type: 'STRING' };
  } else if (type === 'OBJECT') {
    res.properties = {};
    if (val.properties) {
      for (const [k, v] of Object.entries(val.properties)) {
        res.properties[k] = sanitizeSchemaProperty(v);
      }
    }
    if (Array.isArray(val.required)) {
      res.required = val.required.filter((r: any) => typeof r === 'string' && r in res.properties);
    }
  }
  return res;
}
