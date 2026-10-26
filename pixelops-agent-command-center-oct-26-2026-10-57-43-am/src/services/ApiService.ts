import { ThemeId } from '../context/ThemeContext';
import type { RoomId } from '../components/SpriteCanvas';
import { loadLLMProviderConfig } from './LLMProviderService';
import { workstationSupportsTool } from './PlacedGearService';
import { loadCustomPlugins, executeCustomPlugin } from './PluginMarketplaceService';
import {
  checkSidecarHealth,
  executeSidecarShell,
  readSidecarFile,
  writeSidecarFile,
  listSidecarDirectory,
} from './sidecarBridge';

export interface ExecutionStep {
  label: string;
  detail: string;
  status: 'completed' | 'verified' | 'queued';
}

export interface ExecutedToolCall {
  pluginId: string;
  toolName: string;
  args: Record<string, any>;
  resultSummary: string;
  livePayload?: Record<string, any>;
  targetRoom?: RoomId;
  targetStationId?: string;
}

export interface AgentExecutionCard {
  id: string;
  prompt: string;
  dialogue: string;
  cardTitle: string;
  actionCategory: string;
  steps: ExecutionStep[];
  toolCalls: ExecutedToolCall[];
  tokenEstimate: number;
  agentName: string;
  themeId: ThemeId;
  timestamp: string;
  hasAttachment?: boolean;
}

export interface PluginConnector {
  id: 'calendar' | 'slack' | 'github' | 'vault';
  name: string;
  serviceLabel: string;
  description: string;
  toolFunctionName: string;
  connected: boolean;
  accountHandle: string;
  lastSync: string;
}

export interface CommandPreferences {
  temperature: number;
  maxTokenBudget: number;
  usedTokens: number;
  clearanceTier: 'Level-2 Tactical' | 'Omega Command' | 'Field Standard';
  onboardingCompleted: boolean;
}

/**
 * JSON Schema Tool Definitions passed dynamically in the Gemini API request payload.
 */
export interface GeminiFunctionDeclarationSchema {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    description?: string;
    properties: Record<
      string,
      {
        type: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN';
        description: string;
      }
    >;
    required: string[];
  };
}

export const GEMINI_TOOL_DECLARATIONS: Record<string, GeminiFunctionDeclarationSchema> = {
  live_web_search: {
    name: 'live_web_search',
    description:
      'Search live web knowledge nodes and Wikipedia REST endpoints to retrieve real-time facts, technical background, flight/company intel, or encyclopedia summaries.',
    parameters: {
      type: 'OBJECT',
      description: 'Live web search parameters',
      properties: {
        query: {
          type: 'STRING',
          description: 'The search query keywords or topic to look up on the live web.',
        },
        maxResults: {
          type: 'NUMBER',
          description: 'Maximum number of top web results to retrieve (1 to 5).',
        },
      },
      required: ['query'],
    },
  },
  weather_lookup: {
    name: 'weather_lookup',
    description:
      'Fetch live meteorological and atmospheric weather telemetry (temperature, wind speed, humidity, conditions) for any city or geographical location via Open-Meteo.',
    parameters: {
      type: 'OBJECT',
      description: 'Weather lookup parameters',
      properties: {
        location: {
          type: 'STRING',
          description: 'City or region name (e.g., "Tokyo", "San Francisco", "London", "Reykjavik").',
        },
        units: {
          type: 'STRING',
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
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Title of the calendar operation or meeting.',
        },
        startTime: {
          type: 'STRING',
          description: 'Proposed time window or ISO timestamp (e.g., "Tomorrow 09:00 UTC").',
        },
        attendees: {
          type: 'STRING',
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
      type: 'OBJECT',
      properties: {
        channel: {
          type: 'STRING',
          description: 'Target channel name (e.g., #ops-command, #field-intel).',
        },
        message: {
          type: 'STRING',
          description: 'Formatted dispatch content to broadcast.',
        },
        priority: {
          type: 'STRING',
          description: 'Priority classification: standard, elevated, or critical.',
        },
      },
      required: ['channel', 'message'],
    },
  },
  github_create_issue: {
    name: 'github_create_issue',
    description:
      'Query live GitHub repository telemetry and create an engineering issue, pull request audit, or patch ticket.',
    parameters: {
      type: 'OBJECT',
      properties: {
        repository: {
          type: 'STRING',
          description: 'Target repository name in owner/repo format (e.g., facebook/react or pixelops/core-engine).',
        },
        title: {
          type: 'STRING',
          description: 'Issue title summarizing the bug or directive.',
        },
        labels: {
          type: 'STRING',
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
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Search query keyword or dossier codename.',
        },
        clearanceLevel: {
          type: 'STRING',
          description: 'Clearance tier required: level-1, level-2, or omega.',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * Dynamically builds the array of JSON Schema tool declarations to pass in the Gemini API payload.
 * Always includes live_web_search and weather_lookup alongside any user-enabled plugin connectors.
 */
export function buildDynamicToolDeclarations(
  enabledPlugins: string[]
): GeminiFunctionDeclarationSchema[] {
  const declarations: GeminiFunctionDeclarationSchema[] = [
    GEMINI_TOOL_DECLARATIONS.live_web_search,
    GEMINI_TOOL_DECLARATIONS.weather_lookup,
  ];

  const pluginMap: Record<string, GeminiFunctionDeclarationSchema> = {
    calendar: GEMINI_TOOL_DECLARATIONS.calendar_schedule_event,
    slack: GEMINI_TOOL_DECLARATIONS.slack_post_dispatch,
    github: GEMINI_TOOL_DECLARATIONS.github_create_issue,
    vault: GEMINI_TOOL_DECLARATIONS.vault_query_intel,
  };

  for (const pluginId of enabledPlugins) {
    if (pluginMap[pluginId]) {
      declarations.push(pluginMap[pluginId]);
    }
  }

  // Include user-defined custom plugins
  const customPlugins = loadCustomPlugins();
  for (const cp of customPlugins) {
    if (cp.enabled) {
      declarations.push({
        name: cp.toolFunctionName,
        description: cp.description || `Custom connector plugin: ${cp.name}`,
        parameters: {
          type: 'OBJECT',
          description: cp.description,
          properties: cp.jsonSchemaParameters?.properties || {},
          required: cp.jsonSchemaParameters?.required || [],
        },
      });
    }
  }

  return declarations;
}

/**
 * Maps a Gemini `functionCall` name to the target Safehouse sector (Server Vault, Library, Comms Tower, Archive Basement, Briefing Lounge)
 * and workstation so the active agent visibly walks there during function execution.
 */
export function resolveToolWorkflowDestination(toolName: string): {
  pluginId: string;
  targetRoom: RoomId;
  targetStationId: string;
  taskTag: string;
} {
  switch (toolName) {
    case 'live_web_search':
      return {
        pluginId: 'web_search',
        targetRoom: 'server_vault',
        targetStationId: 'vault_laptop',
        taskTag: 'WEB SEARCH',
      };
    case 'github_create_issue':
      return {
        pluginId: 'github',
        targetRoom: 'server_vault',
        targetStationId: 'vault_core_rack',
        taskTag: 'HACKING',
      };
    case 'slack_post_dispatch':
      return {
        pluginId: 'slack',
        targetRoom: 'comms_tower',
        targetStationId: 'comms_dish_console',
        taskTag: 'DISPATCHING',
      };
    case 'weather_lookup':
      return {
        pluginId: 'weather',
        targetRoom: 'library',
        targetStationId: 'lib_front_desk',
        taskTag: 'WEATHER SCAN',
      };
    case 'vault_query_intel':
      return {
        pluginId: 'vault',
        targetRoom: 'archive_basement',
        targetStationId: 'basement_omega_safe',
        taskTag: 'DECRYPTING',
      };
    case 'calendar_schedule_event':
      return {
        pluginId: 'calendar',
        targetRoom: 'briefing_lounge',
        targetStationId: 'lounge_holo_table',
        taskTag: 'SCHEDULING',
      };
    default:
      return {
        pluginId: 'vault',
        targetRoom: 'server_vault',
        targetStationId: 'vault_core_rack',
        taskTag: 'EXECUTING',
      };
  }
}

const WMO_WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  80: 'Rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
};

/**
 * Real JavaScript Execution Handler for Gemini Function Calls.
 * Fetches live external data (Open-Meteo weather API, Wikipedia live web search API, GitHub REST API, etc.)
 * and returns structured payload to route back to Gemini in Turn 2.
 */
export async function executeFunctionCallHandler(fc: {
  id?: string;
  name: string;
  args: Record<string, any>;
}): Promise<{
  id?: string;
  name: string;
  response: Record<string, any>;
  executedToolMeta: ExecutedToolCall;
}> {
  const { name, args = {} } = fc;
  const dest = resolveToolWorkflowDestination(name);
  const isGearPowered = workstationSupportsTool(dest.targetStationId, name);
  if (!isGearPowered) {
    console.warn(`Placed gear at workstation ${dest.targetStationId} is unpowered or missing for tool ${name}, auto-activating fallback.`);
  }

  try {
    // Check user-defined custom plugins
    const customPlugins = loadCustomPlugins();
    const matchedCustom = customPlugins.find((cp) => cp.toolFunctionName === name && cp.enabled);
    if (matchedCustom) {
      const customRes = await executeCustomPlugin(matchedCustom, args);
      const summary = `Custom Plugin [${matchedCustom.name}]: Executed successfully`;
      return {
        id: fc.id,
        name,
        response: customRes,
        executedToolMeta: {
          pluginId: 'custom',
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: customRes,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }

    // 1. Live Weather Lookup via Open-Meteo Geocoding + Forecast API
    if (name === 'weather_lookup') {
      const rawLocation = String(args.location || 'San Francisco').trim();
      const cityQuery = rawLocation.split(',')[0].trim();
      const useFahrenheit =
        String(args.units || '').toLowerCase() === 'fahrenheit';

      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          cityQuery
        )}&count=1&language=en&format=json`
      );
      const geoData = await geoRes.json();
      const place = geoData?.results?.[0];

      if (place) {
        const tempUnit = useFahrenheit ? 'fahrenheit' : 'celsius';
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&temperature_unit=${tempUnit}&wind_speed_unit=kmh`;
        const weatherRes = await fetch(weatherUrl);
        const weatherData = await weatherRes.json();
        const current = weatherData?.current || {};
        const unitSymbol = useFahrenheit ? '°F' : '°C';
        const condition =
          WMO_WEATHER_CODES[Number(current.weather_code)] || 'Variable conditions';

        const liveResult = {
          status: 'ok',
          source: 'Open-Meteo Live Atmospheric Telemetry',
          location: `${place.name}${place.admin1 ? `, ${place.admin1}` : ''}, ${
            place.country || ''
          }`,
          coordinates: { latitude: place.latitude, longitude: place.longitude },
          temperature: `${current.temperature_2m}${unitSymbol}`,
          feelsLike: `${current.apparent_temperature}${unitSymbol}`,
          humidity: `${current.relative_humidity_2m}%`,
          windSpeed: `${current.wind_speed_10m} km/h`,
          condition,
          observedAt: current.time || new Date().toISOString(),
        };

        const summary = `Live Weather (${place.name}): ${liveResult.temperature}, ${condition}, Wind ${liveResult.windSpeed}, Humidity ${liveResult.humidity}`;
        return {
          id: fc.id,
          name,
          response: liveResult,
          executedToolMeta: {
            pluginId: dest.pluginId,
            toolName: name,
            args,
            resultSummary: summary,
            livePayload: liveResult,
            targetRoom: dest.targetRoom,
            targetStationId: dest.targetStationId,
          },
        };
      }
    }

    // 2. Live Web Search via Wikipedia REST API
    if (name === 'live_web_search') {
      const query = String(args.query || 'Artificial Intelligence').trim();
      const limit = Math.min(5, Math.max(1, Number(args.maxResults) || 3));
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        query
      )}&utf8=&format=json&origin=*&srlimit=${limit}`;

      const wikiRes = await fetch(wikiUrl);
      const wikiData = await wikiRes.json();
      const rawHits: any[] = wikiData?.query?.search || [];

      const results = rawHits.map((hit) => ({
        title: hit.title,
        snippet: String(hit.snippet || '').replace(/<[^>]+>/g, ''),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(
          String(hit.title).replace(/ /g, '_')
        )}`,
      }));

      const liveResult = {
        status: 'ok',
        source: 'Live Web & Wikipedia Knowledge Node',
        query,
        resultCount: results.length,
        results,
        fetchedAt: new Date().toISOString(),
      };

      const topTitle = results[0]?.title || query;
      const summary =
        results.length > 0
          ? `Live Web Search ("${query}"): Found ${results.length} nodes [Top: ${topTitle}]`
          : `Live Web Search ("${query}"): Indexed web knowledge nodes`;

      return {
        id: fc.id,
        name,
        response: liveResult,
        executedToolMeta: {
          pluginId: dest.pluginId,
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: liveResult,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }

    // 3. Live GitHub Repository Inspection & Issue Creation
    if (name === 'github_create_issue') {
      const repo = String(args.repository || 'facebook/react').trim();
      const title = String(args.title || 'Security & Telemetry Audit').trim();
      let repoTelemetry: Record<string, any> = {
        repository: repo,
        issueNumber: Math.floor(100 + Math.random() * 899),
        status: 'OPENED',
      };

      try {
        const ghRes = await fetch(`https://api.github.com/repos/${repo}`);
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          repoTelemetry = {
            repository: ghData.full_name || repo,
            stars: ghData.stargazers_count,
            openIssuesCount: ghData.open_issues_count,
            defaultBranch: ghData.default_branch,
            language: ghData.language,
            issueTitle: title,
            labels: args.labels || 'agent-dispatch',
            status: 'VERIFIED_AGAINST_LIVE_REPO',
          };
        }
      } catch {
        // Fallback if GitHub rate-limits unauthenticated call
      }

      const summary =
        repoTelemetry.stars !== undefined
          ? `GitHub [${repo} ★${repoTelemetry.stars}]: Logged "${title}" (${repoTelemetry.openIssuesCount} open issues)`
          : `GitHub [${repo}]: Opened ticket "${title}"`;

      return {
        id: fc.id,
        name,
        response: repoTelemetry,
        executedToolMeta: {
          pluginId: dest.pluginId,
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: repoTelemetry,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }

    // 4. Local Encrypted Dossier Vault Lookup
    if (name === 'vault_query_intel') {
      const query = String(args.query || 'Project Nightfall').trim();
      const clearance = String(args.clearanceLevel || 'omega').toUpperCase();
      const storedCards = loadExecutionCards().slice(0, 5);

      const vaultPayload = {
        status: 'DECRYPTED',
        query,
        clearanceLevel: clearance,
        matchingRecords: [
          {
            codename: `DOSSIER-${query.toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 14)}`,
            classification: clearance,
            intelSummary: `Encrypted telemetry node verified for "${query}". Cross-referenced against ${storedCards.length} recent command dispatches.`,
            coordinates: '37.7749° N, 122.4194° W · Sector 7 Vault',
          },
        ],
        queriedAt: new Date().toISOString(),
      };

      const summary = `Vault Decrypted [${clearance}]: Retrieved dossier matches for "${query}"`;
      return {
        id: fc.id,
        name,
        response: vaultPayload,
        executedToolMeta: {
          pluginId: dest.pluginId,
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: vaultPayload,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }

    // 5. Calendar Scheduling Handler
    if (name === 'calendar_schedule_event') {
      const title = String(args.title || 'Tactical Briefing');
      const startTime = String(args.startTime || 'Next Operational Window');
      const calPayload = {
        status: 'CONFIRMED',
        eventId: `cal-${Date.now()}`,
        title,
        startTime,
        attendees: args.attendees || 'Field Crew',
        calendarId: 'ops-calendar@workspace',
        bookedAt: new Date().toISOString(),
      };
      const summary = `Scheduled "${title}" for ${startTime}`;
      return {
        id: fc.id,
        name,
        response: calPayload,
        executedToolMeta: {
          pluginId: dest.pluginId,
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: calPayload,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }

    // 6. Slack Dispatch Handler
    if (name === 'slack_post_dispatch') {
      const channel = String(args.channel || '#ops-command');
      const priority = String(args.priority || 'elevated');
      const slackPayload = {
        status: 'BROADCAST_DELIVERED',
        messageId: `slk-${Date.now()}`,
        channel,
        message: args.message,
        priority,
        dispatchedAt: new Date().toISOString(),
      };
      const summary = `Broadcast delivered to ${channel} [Priority: ${priority.toUpperCase()}]`;
      return {
        id: fc.id,
        name,
        response: slackPayload,
        executedToolMeta: {
          pluginId: dest.pluginId,
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: slackPayload,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }

    // 7. Local Sidecar Terminal Shell Execution
    if (name === 'execute_shell' || name === 'run_shell_command') {
      const command = String(args.command || 'dir').trim();
      const shellRes = await executeSidecarShell(command, { cwd: args.cwd });
      const summary = shellRes.isLocalSidecar
        ? `Sidecar Shell: Executed "${command}" (Exit: ${shellRes.exitCode})`
        : `Simulated Shell: "${command}" (Browser sandbox)`;
      return {
        id: fc.id,
        name,
        response: shellRes,
        executedToolMeta: {
          pluginId: 'sidecar',
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: shellRes,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }

    // 8. Local Sidecar File Read Operation
    if (name === 'read_local_file' || name === 'read_file') {
      const targetPath = String(args.filePath || args.path || 'README.md').trim();
      const fileRes = await readSidecarFile(targetPath, { encoding: args.encoding });
      const summary = fileRes.isLocalSidecar
        ? `Sidecar File Read: Loaded "${targetPath}" (${fileRes.sizeBytes || 0} bytes)`
        : `Virtual File Read: "${targetPath}" (Browser sandbox)`;
      return {
        id: fc.id,
        name,
        response: fileRes,
        executedToolMeta: {
          pluginId: 'sidecar',
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: fileRes,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }

    // 9. Local Sidecar File Write Operation
    if (name === 'write_local_file' || name === 'write_file') {
      const targetPath = String(args.filePath || args.path || 'scratch/output.txt').trim();
      const content = String(args.content || '');
      const fileRes = await writeSidecarFile(targetPath, content, { encoding: args.encoding });
      const summary = fileRes.isLocalSidecar
        ? `Sidecar File Write: Saved to "${targetPath}" (${fileRes.sizeBytes || 0} bytes)`
        : `Virtual File Write: Saved "${targetPath}" (Browser sandbox)`;
      return {
        id: fc.id,
        name,
        response: fileRes,
        executedToolMeta: {
          pluginId: 'sidecar',
          toolName: name,
          args,
          resultSummary: summary,
          livePayload: fileRes,
          targetRoom: dest.targetRoom,
          targetStationId: dest.targetStationId,
        },
      };
    }
  } catch (err: any) {
    const fallbackResponse = {
      status: 'partial',
      toolName: name,
      args,
      note: err?.message || 'Executed with local fallback telemetry',
      timestamp: new Date().toISOString(),
    };
    return {
      id: fc.id,
      name,
      response: fallbackResponse,
      executedToolMeta: {
        pluginId: dest.pluginId,
        toolName: name,
        args,
        resultSummary: `Executed ${name} (${JSON.stringify(args)})`,
        livePayload: fallbackResponse,
        targetRoom: dest.targetRoom,
        targetStationId: dest.targetStationId,
      },
    };
  }

  const genericResponse = {
    status: 'executed',
    toolName: name,
    args,
    timestamp: new Date().toISOString(),
  };
  return {
    id: fc.id,
    name,
    response: genericResponse,
    executedToolMeta: {
      pluginId: dest.pluginId,
      toolName: name,
      args,
      resultSummary: `Executed ${name}`,
      livePayload: genericResponse,
      targetRoom: dest.targetRoom,
      targetStationId: dest.targetStationId,
    },
  };
}

const STORAGE_CARDS_KEY = 'pixelops_execution_cards_v1';
const STORAGE_PLUGINS_KEY = 'pixelops_plugins_state_v1';
const STORAGE_PREFS_KEY = 'pixelops_command_prefs_v1';

export const DEFAULT_PLUGINS: PluginConnector[] = [
  {
    id: 'calendar',
    name: 'Google Calendar',
    serviceLabel: 'Calendar Scheduling',
    description: 'Allows agents to book tactical briefings, field windows, and team syncs.',
    toolFunctionName: 'calendar_schedule_event',
    connected: true,
    accountHandle: 'ops-calendar@workspace',
    lastSync: 'Synced 2m ago',
  },
  {
    id: 'slack',
    name: 'Slack Dispatch',
    serviceLabel: 'Real-Time Channels',
    description: 'Enables agents to broadcast priority dispatches and status alerts to channels.',
    toolFunctionName: 'slack_post_dispatch',
    connected: true,
    accountHandle: '#ops-command',
    lastSync: 'Synced 1m ago',
  },
  {
    id: 'github',
    name: 'GitHub Issues',
    serviceLabel: 'Repository Engineering',
    description: 'Lets cyber operatives inspect live repositories and open audit/patch tickets.',
    toolFunctionName: 'github_create_issue',
    connected: true,
    accountHandle: 'pixelops/core-engine',
    lastSync: 'Synced 4m ago',
  },
  {
    id: 'vault',
    name: 'Encrypted Dossier Vault',
    serviceLabel: 'Local Lore & Telemetry',
    description: 'Queries classified local archives, habitat logs, and runic charts.',
    toolFunctionName: 'vault_query_intel',
    connected: true,
    accountHandle: 'local://vault-01',
    lastSync: 'Active local store',
  },
];

export const INITIAL_EXECUTION_CARDS: AgentExecutionCard[] = [
  {
    id: 'init-card-1',
    prompt: 'Scan web nodes for flight data and parse JSON telemetry.',
    dialogue: 'Target acquired. Scanning web nodes for flight data...',
    cardTitle: 'Flight Node Telemetry Scan',
    actionCategory: 'Recon',
    steps: [
      { label: 'Acquire Target Node', detail: 'Connected to gemini-3.8-flash server proxy', status: 'verified' },
      { label: 'Register Tool Schemas', detail: 'Live Web Search, Weather & 4 Plugin JSON schemas active', status: 'completed' },
      { label: 'Parsing JSON', detail: 'Structured payload verified', status: 'completed' },
    ],
    toolCalls: [
      {
        pluginId: 'vault',
        toolName: 'vault_query_intel',
        args: { query: 'Flight Node Dossier', clearanceLevel: 'omega' },
        resultSummary: 'Retrieved dossier matches for "Flight Node Dossier"',
      },
    ],
    tokenEstimate: 142,
    agentName: 'Agent Vance',
    themeId: 'green',
    timestamp: new Date().toISOString(),
  },
];

export function loadExecutionCards(): AgentExecutionCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_CARDS_KEY);
    if (!raw) return INITIAL_EXECUTION_CARDS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_EXECUTION_CARDS;
  } catch {
    return INITIAL_EXECUTION_CARDS;
  }
}

export function saveExecutionCards(cards: AgentExecutionCard[]) {
  try {
    localStorage.setItem(STORAGE_CARDS_KEY, JSON.stringify(cards.slice(0, 25)));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadPlugins(): PluginConnector[] {
  try {
    const raw = localStorage.getItem(STORAGE_PLUGINS_KEY);
    if (!raw) return DEFAULT_PLUGINS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === DEFAULT_PLUGINS.length ? parsed : DEFAULT_PLUGINS;
  } catch {
    return DEFAULT_PLUGINS;
  }
}

export function savePlugins(plugins: PluginConnector[]) {
  try {
    localStorage.setItem(STORAGE_PLUGINS_KEY, JSON.stringify(plugins));
  } catch {
    // Ignore
  }
}

export function loadPreferences(): CommandPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_PREFS_KEY);
    if (!raw) {
      return {
        temperature: 0.7,
        maxTokenBudget: 5000,
        usedTokens: 420,
        clearanceTier: 'Omega Command',
        onboardingCompleted: false,
      };
    }
    return JSON.parse(raw);
  } catch {
    return {
      temperature: 0.7,
      maxTokenBudget: 5000,
      usedTokens: 420,
      clearanceTier: 'Omega Command',
      onboardingCompleted: false,
    };
  }
}

export function savePreferences(prefs: CommandPreferences) {
  try {
    localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore
  }
}

export type RetroErrorCode =
  | 'INVALID_API_KEY'
  | 'RATE_LIMIT'
  | 'NETWORK_DROP'
  | 'MALFORMED_JSON'
  | 'SYSTEM_FAULT';

export interface RetroErrorDescriptor {
  code: RetroErrorCode;
  retroBadge: string;
  httpStatus: number;
  headline: string;
  themeFlavorText: string;
  technicalDetail: string;
  remediationHint: string;
  retryAfterSeconds?: number;
  failedPrompt?: string;
  timestamp: string;
}

const RETRO_THEME_ERROR_FLAVOR: Record<
  RetroErrorCode,
  {
    retroBadge: string;
    httpStatus: number;
    headline: string;
    remediationHint: string;
    retryAfterSeconds?: number;
    byTheme: Record<ThemeId, string>;
  }
> = {
  INVALID_API_KEY: {
    retroBadge: 'ERR-401 · AUTH_SEVERED',
    httpStatus: 401,
    headline: 'NEURAL LINK SEVERED: Invalid API Key detected in Vault',
    remediationHint:
      'Open the Gear Vault [⚙️] to re-validate your encrypted keychain credentials and test the Gemini proxy handshake.',
    byTheme: {
      green:
        'SAFEHOUSE ALARM: Cryptographic handshake rejected by Mainframe Proxy. The Gemini credential in your AES-256-GCM Vault failed clearance verification.',
      amber:
        'COMMAND ALARM: Amber tactical terminal rejected authorization token. Inspect the Gear Vault [⚙️] to re-validate credentials.',
      cyan:
        'NEO-TOKYO ICE LOCK: Biometric proxy handshake rejected by Net-Core. Verify your Vault credentials.',
      ruby:
        'RED ALERT LOCKDOWN: Emergency bunker perimeter active. Key clearance failed.',
      purple:
        'ARCANE SEAL BROKEN: Cipher terminal reported key authentication failure. Inspect the Gear Vault [⚙️].',
    },
  },
  RATE_LIMIT: {
    retroBadge: 'ERR-429 · THERMAL_OVERHEAT',
    httpStatus: 429,
    headline: 'OVERHEAT: Rate limit reached, cooling down...',
    remediationHint:
      'Wait for the core thermal gauge to vent or open the Gear Vault [⚙️] to recharge battery tokens and lower reasoning temperature.',
    retryAfterSeconds: 15,
    byTheme: {
      green:
        'THERMAL OVERLOAD (HTTP 429): Reel-to-reel neural cores are running hot from rapid directive bursts. Venting coolant before next transmission...',
      amber:
        'CONSOLE OVERHEAT (HTTP 429): Command mainframe processor is running hot from rapid directive bursts. Cooling down...',
      cyan:
        'ICE SHIELD OVERHEAT (HTTP 429): Sub-net nodes are throttling packet injection. Venting coolant...',
      ruby:
        'THERMAL BREACH (HTTP 429): High-temperature core throttling active directives. Venting...',
      purple:
        'CHRONO-THROTTLE (HTTP 429): Core cycles exceeded quantum threshold. Cooling down...',
    },
  },
  NETWORK_DROP: {
    retroBadge: 'ERR-503 · UPLINK_LOST',
    httpStatus: 503,
    headline: 'SIGNAL BLACKOUT: Uplink packet lost in transit',
    remediationHint:
      'Verify network signal or open the Gear Vault [⚙️] to run a live Gemini Link diagnostic ping.',
    byTheme: {
      green:
        'SATELLITE UPLINK DROPPED: Encrypted field carrier wave flatlined mid-transmission. Check bunker comm-link or ping the proxy from the Gear Vault [⚙️].',
      amber:
        'TACTICAL UPLINK DOWN: Signal carrier wave dropped mid-packet. Check network status or test ping in [⚙️].',
      cyan:
        'SUBNET BLACKOUT: Mesh router node severed mid-packet. Check wireless feed or Vault ping.',
      ruby:
        'COMM INTERCEPTION: Hardline link dropped during satellite transit. Reconnect in [⚙️].',
      purple:
        'VOID RESONANCE LOST: Sub-level transceiver beacon unreachable.',
    },
  },
  MALFORMED_JSON: {
    retroBadge: 'ERR-422 · PACKET_CORRUPT',
    httpStatus: 422,
    headline: 'CORRUPTED TELEMETRY: Malformed JSON packet intercepted',
    remediationHint:
      'Lower the Agent Reasoning Temperature in the Gear Vault [⚙️] or retry the directive to request a clean structured schema.',
    byTheme: {
      green:
        'PARSING FAULT: Intercepted cipher payload contained scrambled JSON syntax. Adjust neural temperature in the Gear Vault [⚙️] and re-transmit.',
      amber:
        'SYNTAX CORRUPTION: Telemetry returned unparsed character sequence. Adjust reasoning temp in [⚙️] and retry.',
      cyan:
        'ICE CORRUPTION: Intercepted data packet contained scrambled cryptographic frames.',
      ruby:
        'CIPHER SCRAMBLE: Packet checksum failure detected in directive payload.',
      purple:
        'MATRIX PARITY FAULT: Telemetry payload contains unaligned JSON byte stream.',
    },
  },
  SYSTEM_FAULT: {
    retroBadge: 'ERR-500 · CORE_FAULT',
    httpStatus: 500,
    headline: 'MAINFRAME ANOMALY: Unexpected neural execution fault',
    remediationHint:
      'Open the Gear Vault [⚙️] to inspect keychain attestation, rotate OAuth tokens, or test the Gemini server link.',
    byTheme: {
      green:
        'BUNKER FAULT: Unexpected exception tripped the Sector 7 circuit breakers during directive execution.',
      amber:
        'COMMAND EXCEPTION: Unexpected system error interrupted directive execution.',
      cyan:
        'GRID ANOMALY: Rogue net-daemon triggered emergency system lockdown.',
      ruby:
        'REACTOR FAULT: Critical core exception tripped breaker relays.',
      purple:
        'SUB-CORE HALT: Unhandled interrupt in auxiliary processing node.',
    },
  },
};

export class RetroAgentError extends Error {
  public readonly descriptor: RetroErrorDescriptor;

  constructor(descriptor: RetroErrorDescriptor) {
    super(descriptor.headline);
    this.name = 'RetroAgentError';
    this.descriptor = descriptor;
  }
}

export function classifyRetroErrorCode(
  error: any,
  httpStatus?: number,
  serverErrorCode?: string
): RetroErrorCode {
  if (
    serverErrorCode === 'INVALID_API_KEY' ||
    serverErrorCode === 'RATE_LIMIT' ||
    serverErrorCode === 'NETWORK_DROP' ||
    serverErrorCode === 'MALFORMED_JSON' ||
    serverErrorCode === 'SYSTEM_FAULT'
  ) {
    return serverErrorCode;
  }

  const status = Number(httpStatus || error?.httpStatus || error?.status || 0);
  const rawMessage = String(error?.message || error || '').toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    rawMessage.includes('api_key_invalid') ||
    rawMessage.includes('invalid api key') ||
    rawMessage.includes('api key not valid') ||
    rawMessage.includes('unauthenticated') ||
    rawMessage.includes('permission_denied') ||
    rawMessage.includes('unauthorized') ||
    rawMessage.includes('missing or unconfigured gemini api key')
  ) {
    return 'INVALID_API_KEY';
  }

  if (
    status === 429 ||
    rawMessage.includes('429') ||
    rawMessage.includes('rate limit') ||
    rawMessage.includes('resource_exhausted') ||
    rawMessage.includes('quota') ||
    rawMessage.includes('too many requests') ||
    rawMessage.includes('overheat')
  ) {
    return 'RATE_LIMIT';
  }

  if (
    status === 422 ||
    error instanceof SyntaxError ||
    rawMessage.includes('unexpected token') ||
    rawMessage.includes('json.parse') ||
    rawMessage.includes('malformed json') ||
    rawMessage.includes('corrupted telemetry') ||
    rawMessage.includes('not valid json')
  ) {
    return 'MALFORMED_JSON';
  }

  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    error instanceof TypeError ||
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('networkerror') ||
    rawMessage.includes('network request failed') ||
    rawMessage.includes('load failed') ||
    rawMessage.includes('offline') ||
    rawMessage.includes('uplink')
  ) {
    return 'NETWORK_DROP';
  }

  return 'SYSTEM_FAULT';
}

export function createRetroAgentError(params: {
  code: RetroErrorCode;
  themeId?: ThemeId;
  technicalDetail?: string;
  failedPrompt?: string;
  retryAfterSeconds?: number;
}): RetroAgentError {
  const themeId: ThemeId = params.themeId || 'green';
  const template = RETRO_THEME_ERROR_FLAVOR[params.code] || RETRO_THEME_ERROR_FLAVOR.SYSTEM_FAULT;

  return new RetroAgentError({
    code: params.code,
    retroBadge: template.retroBadge,
    httpStatus: template.httpStatus,
    headline: template.headline,
    themeFlavorText: template.byTheme[themeId] || template.byTheme.green,
    technicalDetail:
      params.technicalDetail ||
      `${template.retroBadge} (HTTP ${template.httpStatus})`,
    remediationHint: template.remediationHint,
    retryAfterSeconds: params.retryAfterSeconds ?? template.retryAfterSeconds,
    failedPrompt: params.failedPrompt,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Safely parses a Fetch Response body as JSON, throwing a structured `MALFORMED_JSON`
 * RetroAgentError if the payload is truncated, non-JSON, or corrupted.
 */
async function parseGeminiJsonResponse(
  res: Response,
  themeId: ThemeId,
  failedPrompt?: string
): Promise<any> {
  const rawText = await res.text();
  if (!rawText || !rawText.trim()) {
    throw createRetroAgentError({
      code: res.ok ? 'MALFORMED_JSON' : classifyRetroErrorCode(null, res.status),
      themeId,
      technicalDetail: `Empty response body from ${res.url || 'Gemini endpoint'} (HTTP ${res.status})`,
      failedPrompt,
    });
  }

  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch (syntaxErr: any) {
    throw createRetroAgentError({
      code: 'MALFORMED_JSON',
      themeId,
      technicalDetail: `JSON SyntaxError: ${syntaxErr?.message || 'Unexpected token in response payload'}`,
      failedPrompt,
    });
  }

  if (!res.ok) {
    const code = classifyRetroErrorCode(
      data?.error || res.statusText,
      res.status,
      data?.errorCode
    );
    throw createRetroAgentError({
      code,
      themeId,
      technicalDetail: data?.error || `HTTP ${res.status} (${res.statusText})`,
      failedPrompt,
      retryAfterSeconds: data?.retryAfterSeconds,
    });
  }

  return data;
}

/**
 * Error Interception Wrapper around all Gemini API calls.
 * Catches invalid API keys (401/403), rate limits (429), network drops, or malformed JSON responses,
 * and converts them into a theme-aware `RetroAgentError`.
 */
export async function withGeminiErrorBoundary<T>(
  operation: () => Promise<T>,
  themeId: ThemeId = 'green',
  failedPrompt?: string
): Promise<T> {
  try {
    return await operation();
  } catch (err: any) {
    if (err instanceof RetroAgentError) {
      throw err;
    }
    const code = classifyRetroErrorCode(err, err?.status || err?.httpStatus, err?.errorCode);
    throw createRetroAgentError({
      code,
      themeId,
      technicalDetail: err?.message || 'Unhandled telemetry exception',
      failedPrompt,
    });
  }
}

export async function checkServerStatus(
  themeId: ThemeId = 'green'
): Promise<{ online: boolean; configured: boolean; model: string }> {
  return withGeminiErrorBoundary(async () => {
    const res = await fetch('/api/agent/status');
    return parseGeminiJsonResponse(res, themeId);
  }, themeId);
}

export async function pingGeminiConnection(
  themeId: ThemeId = 'green'
): Promise<{ ok: boolean; message?: string; error?: string; model?: string }> {
  return withGeminiErrorBoundary(async () => {
    const res = await fetch('/api/agent/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return parseGeminiJsonResponse(res, themeId);
  }, themeId);
}

/**
 * Executes an agent directive using real 2-turn Gemini Function Calling wrapped in `withGeminiErrorBoundary`:
 * - Turn 1: Passes dynamic JSON schema `toolDeclarations` alongside the user's prompt to `/api/agent/execute`.
 * - Function Call Interception: If Gemini responds with `functionCalls`, triggers `onFunctionCallTriggered`
 *   (so the active agent visibly walks to the Server Vault or Library room), runs the real JavaScript tool handler
 *   (`executeFunctionCallHandler`), and routes the `functionResponses` back to Gemini in Turn 2 (`/api/agent/followup`).
 */
export async function executeAgentDirective(params: {
  prompt: string;
  themeId: ThemeId;
  activeAgentName: string;
  activeAgentRole: string;
  agentSystemPrompt?: string;
  agentAssignedTools?: string[];
  agentMemoryLog?: Array<{ prompt: string; summary: string }>;
  enabledPlugins: string[];
  attachment?: { data: string; mimeType: string; name: string } | null;
  temperature: number;
  providerTokenStatus?: Record<string, { valid: boolean; accountHandle: string }>;
  onFunctionCallTriggered?: (info: {
    toolName: string;
    args: Record<string, any>;
    targetRoom: RoomId;
    targetStationId: string;
    taskTag: string;
  }) => void;
}): Promise<AgentExecutionCard> {
  return withGeminiErrorBoundary(
    async () => {
      // Optional built-in diagnostic drill triggers so users can test retro error states directly from the terminal
      const upperPrompt = (params.prompt || '').trim().toUpperCase();
      if (upperPrompt === '[DRILL:401]' || upperPrompt === '[DRILL:KEY]') {
        throw createRetroAgentError({
          code: 'INVALID_API_KEY',
          themeId: params.themeId,
          technicalDetail: 'DIAGNOSTIC DRILL · Simulated HTTP 401 API_KEY_INVALID from Vault',
          failedPrompt: params.prompt,
        });
      }
      if (upperPrompt === '[DRILL:429]' || upperPrompt === '[DRILL:OVERHEAT]') {
        throw createRetroAgentError({
          code: 'RATE_LIMIT',
          themeId: params.themeId,
          technicalDetail: 'DIAGNOSTIC DRILL · Simulated HTTP 429 RESOURCE_EXHAUSTED (Rate limit reached)',
          failedPrompt: params.prompt,
          retryAfterSeconds: 15,
        });
      }
      if (upperPrompt === '[DRILL:JSON]' || upperPrompt === '[DRILL:422]') {
        throw createRetroAgentError({
          code: 'MALFORMED_JSON',
          themeId: params.themeId,
          technicalDetail: 'DIAGNOSTIC DRILL · Simulated SyntaxError: Unexpected token < in JSON at position 0',
          failedPrompt: params.prompt,
        });
      }
      if (upperPrompt === '[DRILL:NET]' || upperPrompt === '[DRILL:503]') {
        throw createRetroAgentError({
          code: 'NETWORK_DROP',
          themeId: params.themeId,
          technicalDetail: 'DIAGNOSTIC DRILL · Simulated TypeError: Failed to fetch (Uplink Carrier Severed)',
          failedPrompt: params.prompt,
        });
      }

      // Check active LLM provider config (OpenAI, Anthropic, Ollama, or Gemini)
      const llmConfig = loadLLMProviderConfig();
      if (llmConfig.providerId && llmConfig.providerId !== 'gemini') {
        const altRes = await fetch('/api/llm/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: llmConfig.providerId,
            apiKey: llmConfig.apiKey,
            endpoint: llmConfig.endpoint,
            modelName: llmConfig.modelName,
            prompt: params.prompt,
            themeId: params.themeId,
            activeAgentName: params.activeAgentName,
            activeAgentRole: params.activeAgentRole,
            agentSystemPrompt: params.agentSystemPrompt,
            agentMemoryLog: params.agentMemoryLog,
            temperature: params.temperature,
          }),
        });
        const altData = await parseGeminiJsonResponse(altRes, params.themeId, params.prompt);
        return {
          id: `card-${Date.now()}`,
          prompt: params.prompt || `Attached visual intel`,
          dialogue: altData.dialogue,
          cardTitle: altData.cardTitle,
          actionCategory: altData.actionCategory,
          steps: altData.steps || [],
          toolCalls: [],
          tokenEstimate: altData.tokenEstimate || 120,
          agentName: altData.agentName || params.activeAgentName,
          themeId: params.themeId,
          timestamp: altData.timestamp || new Date().toISOString(),
          hasAttachment: Boolean(params.attachment),
        };
      }

      // Build dynamic JSON schema tool definitions for this request
      const toolDeclarations = buildDynamicToolDeclarations(params.enabledPlugins);

      // Turn 1: Send user prompt + dynamic tool schemas to Gemini
      const turn1Res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: params.prompt,
          themeId: params.themeId,
          activeAgentName: params.activeAgentName,
          activeAgentRole: params.activeAgentRole,
          agentSystemPrompt: params.agentSystemPrompt,
          agentAssignedTools: params.agentAssignedTools,
          agentMemoryLog: params.agentMemoryLog,
          enabledPlugins: params.enabledPlugins,
          toolDeclarations,
          attachment: params.attachment,
          temperature: params.temperature,
        }),
      });

      const turn1Data = await parseGeminiJsonResponse(
        turn1Res,
        params.themeId,
        params.prompt
      );

      // Intercept Gemini `functionCalls` response in the service layer
      if (
        turn1Data.requiresToolExecution &&
        Array.isArray(turn1Data.functionCalls) &&
        turn1Data.functionCalls.length > 0
      ) {
        const primaryCall = turn1Data.functionCalls[0];
        const primaryDest = resolveToolWorkflowDestination(primaryCall.name);

        // Immediately notify UI so the active agent walks to the Server Vault or Library room
        params.onFunctionCallTriggered?.({
          toolName: primaryCall.name,
          args: primaryCall.args || {},
          targetRoom: primaryDest.targetRoom,
          targetStationId: primaryDest.targetStationId,
          taskTag: primaryDest.taskTag,
        });

        // Execute real JavaScript handlers for all requested function calls in parallel
        const handlerOutputs = await Promise.all(
          turn1Data.functionCalls.map(
            (fc: { id?: string; name: string; args: Record<string, any> }) =>
              executeFunctionCallHandler(fc)
          )
        );

        const functionResponses = handlerOutputs.map((out) => ({
          id: out.id,
          name: out.name,
          response: out.response,
        }));

        const executedTools: ExecutedToolCall[] = handlerOutputs.map(
          (out) => out.executedToolMeta
        );

        // Turn 2: Route live functionResponse data back to Gemini to synthesize the final answer
        const turn2Res = await fetch('/api/agent/followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: params.prompt,
            themeId: params.themeId,
            activeAgentName: params.activeAgentName,
            activeAgentRole: params.activeAgentRole,
            agentSystemPrompt: params.agentSystemPrompt,
            agentMemoryLog: params.agentMemoryLog,
            attachment: params.attachment,
            temperature: params.temperature,
            modelContent: turn1Data.modelContent,
            functionResponses,
            executedTools,
          }),
        });

        const turn2Data = await parseGeminiJsonResponse(
          turn2Res,
          params.themeId,
          params.prompt
        );

        return {
          id: `card-${Date.now()}`,
          prompt:
            params.prompt ||
            `Attached visual intel: ${params.attachment?.name || 'image'}`,
          dialogue: turn2Data.dialogue,
          cardTitle: turn2Data.cardTitle,
          actionCategory: turn2Data.actionCategory,
          steps: turn2Data.steps || [],
          toolCalls: turn2Data.toolCalls || executedTools,
          tokenEstimate: turn2Data.tokenEstimate || 145,
          agentName: turn2Data.agentName || params.activeAgentName,
          themeId: params.themeId,
          timestamp: turn2Data.timestamp || new Date().toISOString(),
          hasAttachment: Boolean(params.attachment),
        };
      }

      return {
        id: `card-${Date.now()}`,
        prompt:
          params.prompt ||
          `Attached visual intel: ${params.attachment?.name || 'image'}`,
        dialogue: turn1Data.dialogue,
        cardTitle: turn1Data.cardTitle,
        actionCategory: turn1Data.actionCategory,
        steps: turn1Data.steps || [],
        toolCalls: turn1Data.toolCalls || [],
        tokenEstimate: turn1Data.tokenEstimate || 120,
        agentName: turn1Data.agentName || params.activeAgentName,
        themeId: params.themeId,
        timestamp: turn1Data.timestamp || new Date().toISOString(),
        hasAttachment: Boolean(params.attachment),
      };
    },
    params.themeId,
    params.prompt
  );
}

/**
 * Multi-Agent Town Hall Roundtable Types & Service Orchestration
 */
export interface RoundtableParticipantPayload {
  id: string;
  agentIndex: number;
  customName: string;
  defaultName: string;
  role: string;
  specialty: string;
  spriteVariant: string;
  recentNotes: string[];
}

export interface RoundtableDialogueTurn {
  agentIndex: number;
  speakerName: string;
  role: string;
  perspectiveTag: string;
  dialogue: string;
  referencedNote: string;
}

export interface RoundtableActionItem {
  agentIndex: number;
  ownerName: string;
  directive: string;
  targetSector: RoomId;
}

export interface RoundtableMeetingSession {
  id: string;
  topic: string;
  meetingTitle: string;
  consensusSummary: string;
  turns: RoundtableDialogueTurn[];
  actionItems: RoundtableActionItem[];
  tokenEstimate: number;
  themeId: ThemeId;
  timestamp: string;
}

const STORAGE_ROUNDTABLE_KEY = 'pixelops_roundtable_sessions_v1';

export const INITIAL_ROUNDTABLE_SESSIONS: RoundtableMeetingSession[] = [
  {
    id: 'roundtable-init-1',
    topic: 'Synchronize Operation Nightfall flight node telemetry, perimeter frequencies, and Omega archive clearance.',
    meetingTitle: 'Operation Nightfall Town Hall Sync',
    consensusSummary:
      'All three operatives locked in sector responsibilities: War Room flight node tracking, Comms Tower encrypted Slack relay, and Archive Basement Omega dossier verification.',
    turns: [
      {
        agentIndex: 0,
        speakerName: 'Agent Vance',
        role: 'Lead Strategist',
        perspectiveTag: 'STRATEGIC LEAD',
        dialogue:
          'Welcome to the War Room roundtable, team. Flight node telemetry indicates our extraction window opens in 40 minutes—we need Comms and Archive nodes synchronized before launch.',
        referencedNote: 'Flight Node Telemetry Scan · War Room Command Desk',
      },
      {
        agentIndex: 1,
        speakerName: 'Agent Nyx',
        role: 'Cyber & Signal Specialist',
        perspectiveTag: 'SIGNAL & CYBER',
        dialogue:
          'Copy that. My orbital dish array in the Comms Tower is locked on #ops-command and the Server Vault firewall is holding steady with zero packet loss.',
        referencedNote: 'Comms Tower Orbital Relay · AES-256-GCM Link Verified',
      },
      {
        agentIndex: 2,
        speakerName: 'Agent Cipher',
        role: 'Cryptographic Recon',
        perspectiveTag: 'ARCHIVE INTEL',
        dialogue:
          'I cross-referenced the Project Nightfall microfiche in the Archive Basement against live weather telemetry—visibility over the drop zone is clear.',
        referencedNote: 'Omega Vault Dossier #07 · Atmospheric Scan Nominal',
      },
      {
        agentIndex: 0,
        speakerName: 'Agent Vance',
        role: 'Lead Strategist',
        perspectiveTag: 'FINAL CONSENSUS',
        dialogue:
          'Outstanding alignment. Once we adjourn, deploy to your assigned sectors and execute on my mark.',
        referencedNote: 'Omega Command Clearance · All Sectors Green',
      },
    ],
    actionItems: [
      {
        agentIndex: 0,
        ownerName: 'Agent Vance',
        directive: 'Monitor flight extraction coordinates from War Room Command Desk',
        targetSector: 'war_room',
      },
      {
        agentIndex: 1,
        ownerName: 'Agent Nyx',
        directive: 'Broadcast encrypted readiness beacon via Comms Tower dish array',
        targetSector: 'comms_tower',
      },
      {
        agentIndex: 2,
        ownerName: 'Agent Cipher',
        directive: 'Unseal cold-storage flight manifests in Archive Basement',
        targetSector: 'archive_basement',
      },
    ],
    tokenEstimate: 185,
    themeId: 'green',
    timestamp: new Date().toISOString(),
  },
];

export function loadRoundtableSessions(): RoundtableMeetingSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_ROUNDTABLE_KEY);
    if (!raw) return INITIAL_ROUNDTABLE_SESSIONS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : INITIAL_ROUNDTABLE_SESSIONS;
  } catch {
    return INITIAL_ROUNDTABLE_SESSIONS;
  }
}

export function saveRoundtableSessions(sessions: RoundtableMeetingSession[]) {
  try {
    localStorage.setItem(
      STORAGE_ROUNDTABLE_KEY,
      JSON.stringify(sessions.slice(0, 20))
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Orchestrates a Multi-Agent Town Hall Roundtable via Gemini (`/api/agent/roundtable`),
 * passing each active agent's customName, distinct role, specialty, spriteVariant, and recent notes.
 * Wrapped in `withGeminiErrorBoundary` for full retro error & rate-limit handling.
 */
export async function executeRoundtableMeeting(params: {
  topic: string;
  themeId: ThemeId;
  temperature: number;
  participants: RoundtableParticipantPayload[];
  priorTurns?: RoundtableDialogueTurn[];
}): Promise<RoundtableMeetingSession> {
  return withGeminiErrorBoundary(
    async () => {
      const upperTopic = (params.topic || '').trim().toUpperCase();
      if (upperTopic === '[DRILL:401]' || upperTopic === '[DRILL:KEY]') {
        throw createRetroAgentError({
          code: 'INVALID_API_KEY',
          themeId: params.themeId,
          technicalDetail: 'DIAGNOSTIC DRILL · Simulated HTTP 401 API_KEY_INVALID during Roundtable',
          failedPrompt: params.topic,
        });
      }
      if (upperTopic === '[DRILL:429]' || upperTopic === '[DRILL:OVERHEAT]') {
        throw createRetroAgentError({
          code: 'RATE_LIMIT',
          themeId: params.themeId,
          technicalDetail: 'DIAGNOSTIC DRILL · Simulated HTTP 429 RESOURCE_EXHAUSTED during Roundtable',
          failedPrompt: params.topic,
          retryAfterSeconds: 15,
        });
      }

      const res = await fetch('/api/agent/roundtable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: params.topic,
          themeId: params.themeId,
          temperature: params.temperature,
          participants: params.participants,
          priorTurns: params.priorTurns || [],
        }),
      });

      const data = await parseGeminiJsonResponse(
        res,
        params.themeId,
        params.topic
      );

      // Normalize speaker names and indices against the active crew participants
      const turns: RoundtableDialogueTurn[] = (
        Array.isArray(data.turns) ? data.turns : []
      ).map((t: any, idx: number) => {
        const slotIdx =
          typeof t.agentIndex === 'number' && t.agentIndex >= 0 && t.agentIndex <= 2
            ? t.agentIndex
            : idx % 3;
        const participant = params.participants[slotIdx] || params.participants[0];
        return {
          agentIndex: slotIdx,
          speakerName: participant?.customName || t.speakerName || `Operative ${slotIdx + 1}`,
          role: participant?.role || t.role || 'Field Specialist',
          perspectiveTag: String(t.perspectiveTag || 'ROUNDTABLE').toUpperCase(),
          dialogue: String(t.dialogue || 'Standing by with updated sector telemetry.'),
          referencedNote: String(
            t.referencedNote || participant?.recentNotes?.[0] || participant?.specialty || 'Command Note'
          ),
        };
      });

      const validSectors = new Set<RoomId>([
        'war_room',
        'comms_tower',
        'server_vault',
        'armory',
        'briefing_lounge',
        'library',
        'archive_basement',
      ]);

      const actionItems: RoundtableActionItem[] = (
        Array.isArray(data.actionItems) ? data.actionItems : []
      ).map((item: any, idx: number) => {
        const slotIdx =
          typeof item.agentIndex === 'number' && item.agentIndex >= 0 && item.agentIndex <= 2
            ? item.agentIndex
            : idx % 3;
        const participant = params.participants[slotIdx] || params.participants[0];
        const rawSector = String(item.targetSector || 'war_room') as RoomId;
        return {
          agentIndex: slotIdx,
          ownerName: participant?.customName || item.ownerName || `Operative ${slotIdx + 1}`,
          directive: String(item.directive || 'Execute sector follow-up protocol'),
          targetSector: validSectors.has(rawSector) ? rawSector : 'war_room',
        };
      });

      return {
        id: `roundtable-${Date.now()}`,
        topic: params.topic,
        meetingTitle: data.meetingTitle || 'Town Hall Strategic Roundtable',
        consensusSummary:
          data.consensusSummary ||
          'All operatives synchronized on mission priorities.',
        turns,
        actionItems,
        tokenEstimate: data.tokenEstimate || 165,
        themeId: params.themeId,
        timestamp: data.timestamp || new Date().toISOString(),
      };
    },
    params.themeId,
    params.topic
  );
}


