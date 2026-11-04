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

    const dynamicTools: any[] = [];
    const activeAppNames: string[] = [];

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

    // 3. Build Intent-Driven System Instruction
    const declaredToolNames = dynamicTools.map((t) => t.name).join(', ');
    const systemInstruction = systemPrompt || `You are ${agentName} (${activeAgentRole}) in the PixelOps Command Center.
Available Dynamically Injected Tools: ${declaredToolNames || 'No external tools connected'}.

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
  Ensure you correctly extract and validate required parameters (such as repository owner/name, query filters, search strings, channel names, or recipient email addresses) from the user's directive before firing the tool.`;

    const geminiPayload: any = {
      contents: [{ role: 'user', parts: [{ text: message }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        temperature: Number(temperature),
      },
    };

    if (dynamicTools.length > 0) {
      geminiPayload.tools = [{ functionDeclarations: dynamicTools }];
    }

    console.log(
      `[AGENT DISPATCH] Dispatching to Gemini for "${agentName}". Active toolkits: [${activeAppNames.join(', ')}] | Dynamic tools: ${dynamicTools.length}`
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
    const functionCallPart = candidate?.content?.parts?.find((p: any) => p.functionCall);

    // 4. If Gemini invoked a tool, automatically execute it via Composio v3
    if (functionCallPart && functionCallPart.functionCall) {
      const fc = functionCallPart.functionCall;
      const toolName = fc.name || '';
      const toolArgs = fc.args || {};

      console.log(`[AGENT DISPATCH] Gemini requested tool execution: "${toolName}" with args:`, toolArgs);

      let executionResult: any = null;
      let executionSuccessful = false;

      if (composioApiKey && (toolName.startsWith('composio_') || toolName.startsWith('COMPOSIO_'))) {
        const rawAction = toolName.replace(/^composio_/i, '').toUpperCase();
        try {
          const execRes = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(rawAction)}`, {
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
          });

          executionResult = await execRes.json();
          executionSuccessful = execRes.ok;
        } catch (execErr: any) {
          executionResult = { error: execErr?.message || 'Tool execution network fault' };
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          requiresToolExecution: false,
          toolInvoked: toolName,
          args: toolArgs,
          executionResult,
          executionSuccessful,
          agentName,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const responseText = candidate?.content?.parts?.[0]?.text || '';
    return new Response(
      JSON.stringify({
        success: true,
        dialogue: responseText,
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
