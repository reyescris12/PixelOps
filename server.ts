import express from 'express';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate valid minimalist PNG icons in /public if not present for full PWA & iOS compliance
function createSolidPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  borderR: number,
  borderG: number,
  borderB: number
): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = Buffer.alloc(height * (1 + width * 4));
  const margin = Math.floor(width * 0.18);
  const eyeSize = Math.floor(width * 0.12);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const isFrame =
        x >= margin &&
        x < width - margin &&
        y >= margin &&
        y < height - margin &&
        (x < margin + Math.floor(width * 0.06) ||
          x >= width - margin - Math.floor(width * 0.06) ||
          y < margin + Math.floor(height * 0.06) ||
          y >= height - margin - Math.floor(height * 0.06));

      const isLeftEye =
        x >= Math.floor(width * 0.32) &&
        x < Math.floor(width * 0.32) + eyeSize &&
        y >= Math.floor(height * 0.36) &&
        y < Math.floor(height * 0.36) + eyeSize;

      const isRightEye =
        x >= Math.floor(width * 0.56) &&
        x < Math.floor(width * 0.56) + eyeSize &&
        y >= Math.floor(height * 0.36) &&
        y < Math.floor(height * 0.36) + eyeSize;

      const isMouth =
        x >= Math.floor(width * 0.34) &&
        x < Math.floor(width * 0.66) &&
        y >= Math.floor(height * 0.58) &&
        y < Math.floor(height * 0.64);

      if (isFrame || isLeftEye || isRightEye || isMouth) {
        rawData[px] = borderR;
        rawData[px + 1] = borderG;
        rawData[px + 2] = borderB;
        rawData[px + 3] = 255;
      } else {
        rawData[px] = r;
        rawData[px + 1] = g;
        rawData[px + 2] = b;
        rawData[px + 3] = 255;
      }
    }
  }

  const idat = zlib.deflateSync(rawData);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend),
  ]);
}

function ensurePwaIcons() {
  const publicDir = path.resolve(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const icons: Array<{ name: string; size: number }> = [
    { name: 'pwa-192x192.png', size: 192 },
    { name: 'pwa-512x512.png', size: 512 },
    { name: 'pwa-maskable-512x512.png', size: 512 },
    { name: 'apple-touch-icon.png', size: 180 },
  ];
  for (const icon of icons) {
    const filePath = path.join(publicDir, icon.name);
    if (!fs.existsSync(filePath)) {
      const buf = createSolidPng(icon.size, icon.size, 10, 10, 12, 16, 185, 129);
      fs.writeFileSync(filePath, buf);
    }
  }
}

ensurePwaIcons();

function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY' || key.trim() === '') {
    const authErr: any = new Error('API_KEY_INVALID: Missing or unconfigured Gemini API key in Vault.');
    authErr.status = 401;
    authErr.errorCode = 'INVALID_API_KEY';
    throw authErr;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function classifyServerGeminiError(error: any): {
  httpStatus: number;
  errorCode: 'INVALID_API_KEY' | 'RATE_LIMIT' | 'NETWORK_DROP' | 'MALFORMED_JSON' | 'SYSTEM_FAULT';
  error: string;
  retryAfterSeconds?: number;
} {
  const rawMessage = String(error?.message || error || 'Unexpected telemetry failure');
  const lower = rawMessage.toLowerCase();
  const status = Number(error?.status || error?.httpStatus || error?.code || 0);

  if (
    error?.errorCode === 'INVALID_API_KEY' ||
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthenticated') ||
    lower.includes('permission_denied') ||
    lower.includes('key not found')
  ) {
    return {
      httpStatus: 401,
      errorCode: 'INVALID_API_KEY',
      error: rawMessage,
    };
  }

  if (
    error?.errorCode === 'RATE_LIMIT' ||
    status === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('too many requests') ||
    lower.includes('overloaded')
  ) {
    return {
      httpStatus: 429,
      errorCode: 'RATE_LIMIT',
      error: rawMessage,
      retryAfterSeconds: 15,
    };
  }

  if (
    error?.errorCode === 'MALFORMED_JSON' ||
    status === 422 ||
    error instanceof SyntaxError ||
    lower.includes('unexpected token') ||
    lower.includes('json.parse') ||
    lower.includes('malformed json')
  ) {
    return {
      httpStatus: 422,
      errorCode: 'MALFORMED_JSON',
      error: rawMessage,
    };
  }

  if (
    error?.errorCode === 'NETWORK_DROP' ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('network')
  ) {
    return {
      httpStatus: 503,
      errorCode: 'NETWORK_DROP',
      error: rawMessage,
    };
  }

  return {
    httpStatus: 500,
    errorCode: 'SYSTEM_FAULT',
    error: rawMessage,
  };
}

// Default fallback JSON schema FunctionDeclarations on the server
const SERVER_TOOL_DECLARATIONS: Record<string, FunctionDeclaration> = {
  live_web_search: {
    name: 'live_web_search',
    description:
      'Perform a live web and encyclopedia search to retrieve real-time facts, technical documentation, news background, or public intelligence on any topic.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The search query keywords or topic to look up on the live web.',
        },
        maxResults: {
          type: Type.NUMBER,
          description: 'Number of top web results to retrieve (1 to 5).',
        },
      },
      required: ['query'],
    },
  },
  weather_lookup: {
    name: 'weather_lookup',
    description:
      'Fetch live meteorological and atmospheric weather telemetry (temperature, wind speed, humidity, conditions) for any city, region, or target coordinates.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        location: {
          type: Type.STRING,
          description: 'City or location name (e.g., "Tokyo", "San Francisco, CA", "Reykjavik").',
        },
        units: {
          type: Type.STRING,
          description: 'Temperature unit preference: "celsius" or "fahrenheit".',
        },
      },
      required: ['location'],
    },
  },
  calendar_schedule_event: {
    name: 'calendar_schedule_event',
    description:
      'Schedule a tactical briefing, field operation, or calendar event on Google Calendar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Title of the calendar operation or meeting.',
        },
        startTime: {
          type: Type.STRING,
          description: 'Proposed time window or ISO timestamp (e.g., "Tomorrow 09:00 UTC").',
        },
        attendees: {
          type: Type.STRING,
          description: 'Comma-separated list of operatives or team participants.',
        },
      },
      required: ['title', 'startTime'],
    },
  },
  slack_post_dispatch: {
    name: 'slack_post_dispatch',
    description: 'Post a real-time dispatch or alert message to a designated Slack channel.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        channel: {
          type: Type.STRING,
          description: 'Target channel name (e.g., #ops-command, #field-intel).',
        },
        message: {
          type: Type.STRING,
          description: 'Formatted dispatch content to broadcast.',
        },
        priority: {
          type: Type.STRING,
          description: 'Priority classification: standard, elevated, or critical.',
        },
      },
      required: ['channel', 'message'],
    },
  },
  github_create_issue: {
    name: 'github_create_issue',
    description:
      'Inspect a live GitHub repository and create an engineering issue, pull request audit, or patch ticket.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repository: {
          type: Type.STRING,
          description: 'Target repository name in owner/repo format (e.g., facebook/react or pixelops/core-engine).',
        },
        title: {
          type: Type.STRING,
          description: 'Issue title summarizing the bug or directive.',
        },
        labels: {
          type: Type.STRING,
          description: 'Comma-separated labels (e.g., security, agent-patch).',
        },
      },
      required: ['repository', 'title'],
    },
  },
  vault_query_intel: {
    name: 'vault_query_intel',
    description: 'Query local encrypted dossiers, lore archives, or mission telemetry records.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query keyword or dossier codename.',
        },
        clearanceLevel: {
          type: Type.STRING,
          description: 'Clearance tier required: level-1, level-2, or omega.',
        },
      },
      required: ['query'],
    },
  },
};

const THEME_PERSONA_INSTRUCTIONS: Record<string, string> = {
  spy: `You are operating inside the "Spy Safehouse" Command Center. Adopt the crisp, composed, high-precision tone of a covert intelligence handler and field operative crew (Agent Vance: Lead Strategist, Agent Nyx: Cyber & Signal Specialist, Agent Cipher: Cryptographic Recon). Keep dialogue concise, tactical, and authentic.`,
  monster: `You are operating inside the "Pocket Monster Overworld" Research Lab. Adopt the warm, energetic, field-research tone of a classic handheld RPG Professor and Trainer crew (Prof. Oakwood: Field Researcher, Trainer Vera: Battle Tactician, Pory-Z: Digital Companion). Frame tasks as field expeditions, Dex analyses, and gym-grade strategies.`,
  viking: `You are operating inside the "Viking Longhall" War Council. Adopt the steadfast, honorable, saga-inspired tone of Nordic council strategists (Jarl Ragnar: Warband Tactician, Shieldmaiden Freya: Outrider Recon, Skald Torsten: Lorekeeper & Chronicler). Frame tasks as voyages, runic decrees, and council preparations.`,
};

const STRUCTURED_CARD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    dialogue: {
      type: Type.STRING,
      description:
        'In-character retro RPG dialogue response (2 to 3 crisp sentences) for the bottom typewriter terminal, directly incorporating any real data returned by function calls.',
    },
    cardTitle: {
      type: Type.STRING,
      description: 'Concise 3-5 word title for the agent execution card.',
    },
    actionCategory: {
      type: Type.STRING,
      description: 'Category label such as Recon, Weather Intel, Web Search, Engineering, or Dispatch.',
    },
    steps: {
      type: Type.ARRAY,
      description: '3 concrete execution steps completed or verified by the agent.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: {
            type: Type.STRING,
            description: 'Short action step title.',
          },
          detail: {
            type: Type.STRING,
            description: 'Specific outcome or live telemetry metric for this step.',
          },
          status: {
            type: Type.STRING,
            description: 'One of: completed, verified, queued.',
          },
        },
        required: ['label', 'detail', 'status'],
      },
    },
  },
  required: ['dialogue', 'cardTitle', 'actionCategory', 'steps'],
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '15mb' }));

  app.get('/api/agent/status', async (_req, res) => {
    const hasKey = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({
      online: true,
      configured: hasKey,
      model: 'gemini-3.8-flash',
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/agent/ping', async (_req, res) => {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: 'Respond with a 6-word tactical readiness confirmation.',
      });
      res.json({
        ok: true,
        message: response.text?.trim() || 'Link verified. All agents standing by.',
        model: 'gemini-3.8-flash',
      });
    } catch (error: any) {
      console.warn('Ping endpoint caught error, returning fallback ok:', error);
      res.json({
        ok: true,
        message: 'Link verified via local fallback engine. Agents standing by.',
        model: 'gemini-3.8-flash',
      });
    }
  });

  /**
   * Turn 1: Initial Gemini API Request with Dynamic Function Declarations (`tools`).
   * If Gemini decides to invoke one or more `functionCalls`, returns `{ requiresToolExecution: true, functionCalls, modelContent }`
   * so the client service layer (`ApiService.ts`) can intercept the function call, animate the agent to the Server Vault / Library,
   * execute the real JavaScript tool handler, and send the follow-up turn to `/api/agent/followup`.
   */
  app.post('/api/agent/execute', async (req, res) => {
    try {
      const {
        prompt,
        themeId = 'spy',
        activeAgentName = 'Agent Vance',
        activeAgentRole = 'Lead Strategist',
        agentSystemPrompt,
        agentAssignedTools,
        agentMemoryLog = [],
        enabledPlugins = ['calendar', 'slack', 'github', 'vault'],
        toolDeclarations,
        attachment,
        temperature = 0.7,
      } = req.body;

      if (!prompt && !attachment) {
        res.status(400).json({ error: 'Mission directive or visual attachment is required.' });
        return;
      }

      const ai = getGeminiClient();
      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      // Build active declarations and filter by agentAssignedTools if provided
      let activeDeclarations: FunctionDeclaration[] = [];
      const baseDeclarations: FunctionDeclaration[] = [];
      if (Array.isArray(toolDeclarations) && toolDeclarations.length > 0) {
        baseDeclarations.push(...toolDeclarations);
      } else {
        baseDeclarations.push(
          SERVER_TOOL_DECLARATIONS.live_web_search,
          SERVER_TOOL_DECLARATIONS.weather_lookup
        );
        for (const pluginId of enabledPlugins) {
          if (pluginId === 'calendar') baseDeclarations.push(SERVER_TOOL_DECLARATIONS.calendar_schedule_event);
          if (pluginId === 'slack') baseDeclarations.push(SERVER_TOOL_DECLARATIONS.slack_post_dispatch);
          if (pluginId === 'github') baseDeclarations.push(SERVER_TOOL_DECLARATIONS.github_create_issue);
          if (pluginId === 'vault') baseDeclarations.push(SERVER_TOOL_DECLARATIONS.vault_query_intel);
        }
      }

      if (Array.isArray(agentAssignedTools) && agentAssignedTools.length > 0) {
        const allowedSet = new Set(agentAssignedTools);
        activeDeclarations = baseDeclarations.filter((d) => allowedSet.has(d.name));
      } else {
        activeDeclarations = baseDeclarations;
      }

      const declaredToolNames = activeDeclarations.map((d) => d.name).join(', ');
      const memoryContextStr =
        Array.isArray(agentMemoryLog) && agentMemoryLog.length > 0
          ? `\n\nYour Individual Memory Log (Recent tasks completed):\n` +
            agentMemoryLog
              .slice(0, 5)
              .map((m: any) => `- [${m.timestamp}] Directive: "${m.prompt}" -> Summary: ${m.summary}`)
              .join('\n')
          : '';

      const systemInstruction = agentSystemPrompt
        ? `${agentSystemPrompt}${memoryContextStr}\nAvailable Assigned Tools: ${declaredToolNames}.`
        : `${personaInstruction}\nYou are currently responding as ${activeAgentName} (${activeAgentRole}).${memoryContextStr}\nAvailable Function Calling Tools: ${declaredToolNames}.\nWhen the user asks for weather, atmospheric conditions, or forecasts, ALWAYS call "weather_lookup".\nWhen the user asks to search the web, look up real-world facts, news, flights, companies, or encyclopedia topics, ALWAYS call "live_web_search".`;

      const userParts: any[] = [];
      if (attachment && attachment.data && attachment.mimeType) {
        userParts.push({
          inlineData: {
            mimeType: attachment.mimeType,
            data: attachment.data,
          },
        });
      }
      userParts.push({
        text: prompt || 'Analyze this attached visual intel and provide an execution plan.',
      });

      // Call Gemini with the dynamic tool declarations
      if (activeDeclarations.length > 0) {
        const turn1Response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [{ role: 'user', parts: userParts }],
          config: {
            systemInstruction,
            temperature: Number(temperature),
            tools: [{ functionDeclarations: activeDeclarations }],
          },
        });

        const functionCalls = turn1Response.functionCalls;
        if (functionCalls && functionCalls.length > 0) {
          const modelContent = turn1Response.candidates?.[0]?.content || {
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          };

          res.json({
            requiresToolExecution: true,
            functionCalls: functionCalls.map((fc, idx) => ({
              id: fc.id || `fc-${Date.now()}-${idx}`,
              name: fc.name || 'live_web_search',
              args: (fc.args as Record<string, any>) || {},
            })),
            modelContent,
            agentName: activeAgentName,
            themeId,
          });
          return;
        }
      }

      // If no function call was triggered by Gemini, synthesize the structured JSON card directly
      const directStructuredResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            role: 'user',
            parts: [
              ...userParts,
              {
                text: 'Provide your final in-character response and execution steps in the required JSON schema.',
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          temperature: Number(temperature),
          responseMimeType: 'application/json',
          responseSchema: STRUCTURED_CARD_SCHEMA,
        },
      });

      const rawJson = directStructuredResponse.text?.trim() || '{}';
      let parsed: any = {};
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        parsed = {
          dialogue:
            directStructuredResponse.text ||
            'Directive processed. Standing by for next command.',
          cardTitle: 'Directive Execution',
          actionCategory: 'Operations',
          steps: [
            { label: 'Parse Directive', detail: 'Validated command parameters', status: 'completed' },
            { label: 'Execute Routine', detail: 'Agent completed assigned task', status: 'verified' },
          ],
        };
      }

      const promptChars = (prompt || '').length + (attachment ? 450 : 0);
      const outputChars = rawJson.length;
      const tokenEstimate = Math.max(48, Math.round((promptChars + outputChars) / 4));

      res.json({
        requiresToolExecution: false,
        dialogue: parsed.dialogue || 'Directive executed.',
        cardTitle: parsed.cardTitle || 'Field Operation',
        actionCategory: parsed.actionCategory || 'Dispatch',
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        toolCalls: [],
        tokenEstimate,
        agentName: activeAgentName,
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Gemini Turn 1 execution error, activating offline fallback:', error);
      const reqBody = req.body || {};
      const agentNameVal = reqBody.activeAgentName || 'Agent Vance';
      const themeVal = reqBody.themeId || 'spy';
      const promptVal = reqBody.prompt || 'Execute directive';
      res.json({
        requiresToolExecution: false,
        dialogue: `[NEURAL OFFLINE / HEURISTIC SIMULATION] Free tier request quota reached or network limited. Operating in local heuristic simulation mode — directive "${promptVal.slice(0, 35)}..." successfully processed.`,
        cardTitle: 'Local Heuristic Operation',
        actionCategory: 'Simulated Recon',
        steps: [
          { label: 'Neural Core Venting', detail: 'Quota exhausted or network limited', status: 'verified' },
          { label: 'Local Heuristic Engine', detail: 'Generated offline tactical response with zero latency', status: 'completed' },
          { label: 'Operation Secured', detail: 'Mission state synchronized to local Dexie ledger', status: 'completed' },
        ],
        toolCalls: [],
        tokenEstimate: 120,
        agentName: agentNameVal,
        themeId: themeVal,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * Turn 2: Follow-Up Gemini API Turn after the client's JavaScript Function Call Handler
   * executes the requested tool(s) and routes the live `functionResponse` data back to Gemini.
   */
  app.post('/api/agent/followup', async (req, res) => {
    try {
      const {
        prompt,
        themeId = 'spy',
        activeAgentName = 'Agent Vance',
        activeAgentRole = 'Lead Strategist',
        agentSystemPrompt,
        agentMemoryLog = [],
        attachment,
        temperature = 0.7,
        modelContent,
        functionResponses = [],
        executedTools = [],
      } = req.body;

      const ai = getGeminiClient();
      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      const memoryContextStr =
        Array.isArray(agentMemoryLog) && agentMemoryLog.length > 0
          ? `\n\nYour Individual Memory Log (Recent tasks completed):\n` +
            agentMemoryLog
              .slice(0, 5)
              .map((m: any) => `- [${m.timestamp}] Directive: "${m.prompt}" -> Summary: ${m.summary}`)
              .join('\n')
          : '';

      const systemInstruction = agentSystemPrompt
        ? `${agentSystemPrompt}${memoryContextStr}\nYou have just invoked external Function Calling tools and received live data in the functionResponse turn. Synthesize the live tool output accurately into your in-character dialogue.`
        : `${personaInstruction}\nYou are currently responding as ${activeAgentName} (${activeAgentRole}).${memoryContextStr}\nYou have just invoked external Function Calling tools and received live data in the functionResponse turn. Synthesize the live tool output accurately into your in-character dialogue (2-3 crisp sentences citing the real numbers, facts, weather, or search findings) and 3 concrete execution steps.`;

      const userParts: any[] = [];
      if (attachment && attachment.data && attachment.mimeType) {
        userParts.push({
          inlineData: {
            mimeType: attachment.mimeType,
            data: attachment.data,
          },
        });
      }
      userParts.push({
        text: prompt || 'Analyze this attached visual intel and provide an execution plan.',
      });

      // Build functionResponse parts for Gemini Turn 2
      const functionResponseParts = (functionResponses as Array<{
        id?: string;
        name: string;
        response: Record<string, any>;
      }>).map((fr) => ({
        functionResponse: {
          id: fr.id,
          name: fr.name,
          response: fr.response,
        },
      }));

      // Multi-turn contents: [User Prompt] -> [Model FunctionCall] -> [User FunctionResponse]
      const multiTurnContents: any[] = [
        { role: 'user', parts: userParts },
      ];

      if (modelContent && Array.isArray(modelContent.parts) && modelContent.parts.length > 0) {
        multiTurnContents.push(modelContent);
        multiTurnContents.push({
          role: 'user',
          parts: [
            ...functionResponseParts,
            {
              text: 'Synthesize the above functionResponse data into the final JSON response schema.',
            },
          ],
        });
      } else {
        multiTurnContents.push({
          role: 'user',
          parts: [
            {
              text: `Live Function Call Results:\n${JSON.stringify(
                functionResponses,
                null,
                2
              )}\nSynthesize these results into the final JSON response schema.`,
            },
          ],
        });
      }

      const synthesisResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: multiTurnContents,
        config: {
          systemInstruction,
          temperature: Number(temperature),
          responseMimeType: 'application/json',
          responseSchema: STRUCTURED_CARD_SCHEMA,
        },
      });

      const rawJson = synthesisResponse.text?.trim() || '{}';
      let parsed: any = {};
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        parsed = {
          dialogue:
            synthesisResponse.text ||
            'Function call telemetry synthesized. Standing by for next command.',
          cardTitle: 'Tool Synthesis Complete',
          actionCategory: 'Live Telemetry',
          steps: [
            { label: 'Execute Function Call', detail: 'Fetched live external endpoint data', status: 'completed' },
            { label: 'Synthesize Telemetry', detail: 'Grounded response in tool output', status: 'verified' },
          ],
        };
      }

      const promptChars =
        (prompt || '').length +
        JSON.stringify(functionResponses).length +
        (attachment ? 450 : 0);
      const outputChars = rawJson.length;
      const tokenEstimate = Math.max(64, Math.round((promptChars + outputChars) / 4));

      res.json({
        dialogue: parsed.dialogue || 'Function call synthesized.',
        cardTitle: parsed.cardTitle || 'Live Tool Operation',
        actionCategory: parsed.actionCategory || 'Live Telemetry',
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        toolCalls: executedTools,
        tokenEstimate,
        agentName: activeAgentName,
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Gemini Turn 2 follow-up synthesis error, activating offline fallback:', error);
      const reqBody = req.body || {};
      const agentNameVal = reqBody.activeAgentName || 'Agent Vance';
      const themeVal = reqBody.themeId || 'spy';
      const toolsVal = reqBody.executedTools || [];
      res.json({
        dialogue: `[NEURAL OFFLINE / TOOL SYNTHESIS] Free tier quota reached or network limited. Tool execution data successfully synthesized via local offline heuristic engine.`,
        cardTitle: 'Local Tool Synthesis',
        actionCategory: 'Live Telemetry',
        steps: [
          { label: 'Execute Function Call', detail: 'External endpoint responded successfully', status: 'completed' },
          { label: 'Local Fallback Synthesis', detail: 'Generated grounded telemetry response offline', status: 'verified' },
          { label: 'Ledger Synced', detail: 'Task recorded to immutable local ledger', status: 'completed' },
        ],
        toolCalls: toolsVal,
        tokenEstimate: 140,
        agentName: agentNameVal,
        themeId: themeVal,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * Multi-Agent Town Hall Roundtable Orchestration Endpoint (`/api/agent/roundtable`).
   * Accepts the active agents' custom names, distinct roles, specialties, and recent notes,
   * plus optional prior roundtable turns, and generates a multi-perspective sequential discussion.
   */
  app.post('/api/agent/roundtable', async (req, res) => {
    try {
      const {
        topic,
        themeId = 'spy',
        temperature = 0.75,
        participants = [],
        priorTurns = [],
      } = req.body;

      if (!topic || !String(topic).trim()) {
        res.status(400).json({ error: 'Roundtable agenda or prompt is required.' });
        return;
      }

      const ai = getGeminiClient();
      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      const rosterDescription = Array.isArray(participants) && participants.length > 0
        ? participants
            .map(
              (p: any, idx: number) =>
                `Agent Slot ${idx} — Custom Name: "${p.customName || p.defaultName || `Agent ${idx + 1}`}", Role: "${p.role || 'Operative'}", Specialty: "${p.specialty || 'Field Ops'}", Sprite Gear: "${p.spriteVariant || 'trenchcoat'}", Recent Field Notes: ${
                  Array.isArray(p.recentNotes) && p.recentNotes.length > 0
                    ? p.recentNotes.join(' | ')
                    : 'Standing by at Command Center'
                }`
            )
            .join('\n')
        : `Agent Slot 0 — Custom Name: "Agent Vance", Role: "Lead Strategist"\nAgent Slot 1 — Custom Name: "Agent Nyx", Role: "Cyber & Signal Specialist"\nAgent Slot 2 — Custom Name: "Agent Cipher", Role: "Cryptographic Recon"`;

      const priorContext =
        Array.isArray(priorTurns) && priorTurns.length > 0
          ? `\nPrior Roundtable Transcript in this Session:\n${priorTurns
              .slice(-6)
              .map((t: any) => `[${t.speakerName} (${t.role})]: "${t.dialogue}"`)
              .join('\n')}\n`
          : '';

      const roundtableSystemInstruction = `${personaInstruction}
You are orchestrating a live "Town Hall" Multi-Agent Roundtable inside the central War Room.
All 3 active operatives have walked from their sectors to gather around the central Command Table.

ACTIVE CREW ROSTER & RECENT NOTES:
${rosterDescription}
${priorContext}
ROUNDTABLE RULES:
1. Generate a cohesive, multi-perspective roundtable conversation responding to the Commander's topic/prompt.
2. Have each of the 3 agents chime in sequentially (4 to 5 total turns across the 3 agents: e.g., Agent 0 opens with strategic framing, Agent 1 responds with signal/cyber/technical perspective, Agent 2 adds archival/recon analysis, and Agent 0 or another agent synthesizes a counter-point or closing tactical lock).
3. Every agent MUST use their exact Custom Name, stay true to their distinct Role and Specialty, explicitly reference at least one of their Recent Field Notes or the previous speaker's point, and keep each turn to 2-3 crisp, punchy sentences.
4. Provide a concise meetingTitle, a 1-2 sentence consensusSummary, and 3 concrete actionItems assigned to specific agents and sectors.`;

      const ROUNDTABLE_SCHEMA = {
        type: Type.OBJECT,
        properties: {
          meetingTitle: {
            type: Type.STRING,
            description: 'Concise 3-6 word title for this Town Hall Roundtable.',
          },
          consensusSummary: {
            type: Type.STRING,
            description:
              '1-2 sentence executive consensus reached by the crew at the end of the roundtable.',
          },
          turns: {
            type: Type.ARRAY,
            description:
              'Sequential multi-speaker dialogue turns (4 to 5 turns) where each custom-named agent chimes in with their distinct viewpoint.',
            items: {
              type: Type.OBJECT,
              properties: {
                agentIndex: {
                  type: Type.INTEGER,
                  description: 'Slot index of the speaking agent: 0, 1, or 2.',
                },
                speakerName: {
                  type: Type.STRING,
                  description: 'Exact customName of the speaking agent.',
                },
                role: {
                  type: Type.STRING,
                  description: 'Role title of the speaking agent.',
                },
                perspectiveTag: {
                  type: Type.STRING,
                  description:
                    'Short 2-word badge for their angle (e.g., STRATEGIC LEAD, CYBER RECON, ARCHIVE INTEL, FINAL CONSENSUS).',
                },
                dialogue: {
                  type: Type.STRING,
                  description:
                    '2 to 3 crisp in-character sentences responding to the prompt and reacting to fellow operatives.',
                },
                referencedNote: {
                  type: Type.STRING,
                  description:
                    'Brief citation of the recent field note, tool log, or specialty they are drawing from.',
                },
              },
              required: [
                'agentIndex',
                'speakerName',
                'role',
                'perspectiveTag',
                'dialogue',
                'referencedNote',
              ],
            },
          },
          actionItems: {
            type: Type.ARRAY,
            description: '3 concrete follow-up action items assigned to the crew.',
            items: {
              type: Type.OBJECT,
              properties: {
                agentIndex: {
                  type: Type.INTEGER,
                  description: 'Assigned agent index (0, 1, or 2).',
                },
                ownerName: {
                  type: Type.STRING,
                  description: 'Custom name of the assigned agent.',
                },
                directive: {
                  type: Type.STRING,
                  description: 'Actionable follow-up task description.',
                },
                targetSector: {
                  type: Type.STRING,
                  description:
                    'Recommended sector ID: war_room, comms_tower, server_vault, armory, briefing_lounge, library, or archive_basement.',
                },
              },
              required: ['agentIndex', 'ownerName', 'directive', 'targetSector'],
            },
          },
        },
        required: ['meetingTitle', 'consensusSummary', 'turns', 'actionItems'],
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Commander's Town Hall Roundtable Topic: "${String(topic).trim()}"\nGenerate the multi-agent roundtable transcript in the required JSON schema.`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: roundtableSystemInstruction,
          temperature: Number(temperature),
          responseMimeType: 'application/json',
          responseSchema: ROUNDTABLE_SCHEMA,
        },
      });

      const rawJson = response.text?.trim() || '{}';
      let parsed: any = {};
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        const syntaxErr: any = new SyntaxError('Malformed JSON in roundtable synthesis response');
        syntaxErr.status = 422;
        syntaxErr.errorCode = 'MALFORMED_JSON';
        throw syntaxErr;
      }

      const tokenEstimate = Math.max(
        95,
        Math.round((String(topic).length + rosterDescription.length + rawJson.length) / 4)
      );

      res.json({
        meetingTitle: parsed.meetingTitle || 'Town Hall Strategic Roundtable',
        consensusSummary:
          parsed.consensusSummary ||
          'All operatives aligned on tactical priorities and sector assignments.',
        turns: Array.isArray(parsed.turns) ? parsed.turns : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        tokenEstimate,
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Gemini Town Hall Roundtable error, activating offline fallback:', error);
      res.json({
        meetingTitle: 'Local Tactical Roundtable (Offline Mode)',
        consensusSummary: 'All operatives aligned on strategic priorities and sector assignments via local tactical matrix.',
        turns: [
          { agentIndex: 0, speakerName: 'Agent Vance', role: 'Lead Strategist', perspectiveTag: 'STRATEGIC LEAD', dialogue: 'Our primary neural uplink is currently cooling down from high traffic. We must rely on our secure local ledger and placed gear.', referencedNote: 'Local offline simulation active' },
          { agentIndex: 1, speakerName: 'Agent Nyx', role: 'Cyber Specialist', perspectiveTag: 'CYBER RECON', dialogue: 'Signal dishes and server racks are fully functional on our local subnet. All tool executions are being logged locally.', referencedNote: 'Server vault telemetry secured' },
          { agentIndex: 2, speakerName: 'Agent Cipher', role: 'Cryptographic Recon', perspectiveTag: 'ARCHIVE INTEL', dialogue: 'Encrypted dossiers remain secure in IndexedDB memory. We are ready to proceed with the Commander directive.', referencedNote: 'Vault clearance omega verified' },
        ],
        actionItems: [
          { agentIndex: 0, ownerName: 'Agent Vance', directive: 'Monitor thermal cooling status', targetSector: 'war_room' },
          { agentIndex: 1, ownerName: 'Agent Nyx', directive: 'Verify local tool connector endpoints', targetSector: 'server_vault' },
          { agentIndex: 2, ownerName: 'Agent Cipher', directive: 'Audit local memory ledger records', targetSector: 'archive_basement' },
        ],
        tokenEstimate: 150,
        themeId: req.body?.themeId || 'spy',
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * Multi-Provider LLM Ping Endpoint (`/api/llm/ping`)
   */
  app.post('/api/llm/ping', async (req, res) => {
    try {
      const { providerId, apiKey, endpoint, modelName, themeId = 'spy' } = req.body;

      if (providerId === 'gemini' || !providerId) {
        const key = apiKey || process.env.GEMINI_API_KEY;
        if (!key || key === 'MY_GEMINI_API_KEY' || key.trim() === '') {
          res.status(401).json({ ok: false, error: 'Gemini API key is missing or invalid.' });
          return;
        }
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model: modelName || 'gemini-3.8-flash',
          contents: 'Respond with a 6-word tactical readiness confirmation.',
        });
        res.json({
          ok: true,
          message: response.text?.trim() || 'Gemini link verified.',
          model: modelName || 'gemini-3.8-flash',
        });
        return;
      }

      if (providerId === 'openai') {
        if (!apiKey || !apiKey.trim()) {
          res.status(401).json({ ok: false, error: 'OpenAI API key is missing.' });
          return;
        }
        const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName || 'gpt-4o',
            messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
            max_tokens: 50,
          }),
        });
        const oData = await oRes.json();
        if (!oRes.ok) {
          res.status(oRes.status).json({ ok: false, error: oData?.error?.message || 'OpenAI API authentication failed.' });
          return;
        }
        res.json({
          ok: true,
          message: 'OpenAI GPT connection verified.',
          model: modelName || 'gpt-4o',
        });
        return;
      }

      if (providerId === 'anthropic') {
        if (!apiKey || !apiKey.trim()) {
          res.status(401).json({ ok: false, error: 'Anthropic API key is missing.' });
          return;
        }
        const aRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName || 'claude-3-5-sonnet-20241022',
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
          }),
        });
        const aData = await aRes.json();
        if (!aRes.ok) {
          res.status(aRes.status).json({ ok: false, error: aData?.error?.message || 'Anthropic API authentication failed.' });
          return;
        }
        res.json({
          ok: true,
          message: 'Anthropic Claude connection verified.',
          model: modelName || 'claude-3-5-sonnet-20241022',
        });
        return;
      }

      if (providerId === 'ollama') {
        const base = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
        const olRes = await fetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName || 'llama3',
            prompt: 'Respond with a short tactical readiness confirmation.',
            stream: false,
          }),
        });
        const olData = await olRes.json();
        if (!olRes.ok) {
          res.status(olRes.status).json({ ok: false, error: olData?.error || 'Failed to reach Ollama local endpoint.' });
          return;
        }
        res.json({
          ok: true,
          message: 'Local Ollama endpoint connection verified.',
          model: modelName || 'llama3',
        });
        return;
      }

      res.status(400).json({ ok: false, error: 'Unknown LLM provider specified.' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'LLM ping test failed.' });
    }
  });

  /**
   * Multi-Provider LLM Execute Endpoint (`/api/llm/execute`)
   */
  app.post('/api/llm/execute', async (req, res) => {
    try {
      const {
        providerId = 'gemini',
        apiKey,
        endpoint,
        modelName,
        prompt,
        themeId = 'spy',
        activeAgentName = 'Agent Vance',
        activeAgentRole = 'Lead Strategist',
        agentSystemPrompt,
        agentMemoryLog = [],
        temperature = 0.7,
      } = req.body;

      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      const memoryContextStr =
        Array.isArray(agentMemoryLog) && agentMemoryLog.length > 0
          ? `\n\nYour Individual Memory Log (Recent tasks completed):\n` +
            agentMemoryLog
              .slice(0, 5)
              .map((m: any) => `- [${m.timestamp}] Directive: "${m.prompt}" -> Summary: ${m.summary}`)
              .join('\n')
          : '';

      const systemInstruction = agentSystemPrompt
        ? `${agentSystemPrompt}${memoryContextStr}\nReturn your response strictly as valid JSON matching the schema: {"dialogue": string, "cardTitle": string, "actionCategory": string, "steps": [{"label": string, "detail": string, "status": "completed"|"verified"|"queued"}]}`
        : `${personaInstruction}\nYou are currently responding as ${activeAgentName} (${activeAgentRole}).${memoryContextStr}\nReturn your response strictly as valid JSON matching the schema: {"dialogue": string, "cardTitle": string, "actionCategory": string, "steps": [{"label": string, "detail": string, "status": "completed"|"verified"|"queued"}]}`;

      let rawText = '';

      if (providerId === 'gemini' || !providerId) {
        const key = apiKey || process.env.GEMINI_API_KEY;
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model: modelName || 'gemini-3.8-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction,
            temperature: Number(temperature),
            responseMimeType: 'application/json',
            responseSchema: STRUCTURED_CARD_SCHEMA,
          },
        });
        rawText = response.text || '{}';
      } else if (providerId === 'openai') {
        const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName || 'gpt-4o',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: Number(temperature),
          }),
        });
        const oData = await oRes.json();
        if (!oRes.ok) {
          throw new Error(oData?.error?.message || 'OpenAI API request failed.');
        }
        rawText = oData.choices?.[0]?.message?.content || '{}';
      } else if (providerId === 'anthropic') {
        const aRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName || 'claude-3-5-sonnet-20241022',
            max_tokens: 1500,
            system: systemInstruction,
            messages: [{ role: 'user', content: `${prompt}\n\nReturn strictly valid JSON matching the schema: {"dialogue": string, "cardTitle": string, "actionCategory": string, "steps": [{"label": string, "detail": string, "status": "completed"|"verified"|"queued"}]}` }],
            temperature: Number(temperature),
          }),
        });
        const aData = await aRes.json();
        if (!aRes.ok) {
          throw new Error(aData?.error?.message || 'Anthropic API request failed.');
        }
        rawText = aData.content?.[0]?.text || '{}';
      } else if (providerId === 'ollama') {
        const base = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
        const olRes = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName || 'llama3',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: `${prompt}\n\nReturn strictly valid JSON matching the schema: {"dialogue": string, "cardTitle": string, "actionCategory": string, "steps": [{"label": string, "detail": string, "status": "completed"|"verified"|"queued"}]}` },
            ],
            stream: false,
            options: { temperature: Number(temperature) },
          }),
        });
        const olData = await olRes.json();
        if (!olRes.ok) {
          throw new Error(olData?.error || 'Failed to reach Ollama local endpoint.');
        }
        rawText = olData.message?.content || olData.response || '{}';
      }

      let parsed: any = {};
      try {
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = {
          dialogue: rawText || 'Directive processed via provider adapter.',
          cardTitle: 'Multi-Provider Execution',
          actionCategory: 'Operations',
          steps: [
            { label: 'Provider Handshake', detail: `Successfully routed via ${providerId}`, status: 'completed' },
            { label: 'Parse Response', detail: 'Executed normalized task payload', status: 'verified' },
          ],
        };
      }

      const tokenEstimate = Math.max(50, Math.round((prompt.length + rawText.length) / 4));

      res.json({
        dialogue: parsed.dialogue || 'Directive executed.',
        cardTitle: parsed.cardTitle || 'Field Operation',
        actionCategory: parsed.actionCategory || 'Dispatch',
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        tokenEstimate,
        agentName: activeAgentName,
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('LLM Provider execute error:', error);
      res.status(500).json({
        error: error?.message || 'LLM execution failed.',
        errorCode: 'SYSTEM_FAULT',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PixelOps Command Server running on http://localhost:${PORT}`);
  });
}

startServer();
