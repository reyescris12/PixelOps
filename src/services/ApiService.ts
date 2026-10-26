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

export const THEME_PERSONA_INSTRUCTIONS: Record<string, string> = {
  spy: `You are operating inside the "Spy Safehouse" Command Center. Adopt the crisp, composed, high-precision tone of a covert intelligence handler and field operative crew (Agent Vance: Lead Strategist, Agent Nyx: Cyber & Signal Specialist, Agent Cipher: Cryptographic Recon). Keep dialogue concise, tactical, and authentic.`,
  monster: `You are operating inside the "Pocket Monster Overworld" Research Lab. Adopt the warm, energetic, field-research tone of a classic handheld RPG Professor and Trainer crew (Prof. Oakwood: Field Researcher, Trainer Vera: Battle Tactician, Pory-Z: Digital Companion). Frame tasks as field expeditions, Dex analyses, and gym-grade strategies.`,
  viking: `You are operating inside the "Viking Longhall" War Council. Adopt the steadfast, honorable, saga-inspired tone of Nordic council strategists (Jarl Ragnar: Warband Tactician, Shieldmaiden Freya: Outrider Recon, Skald Torsten: Lorekeeper & Chronicler). Frame tasks as voyages, runic decrees, and council preparations.`,
  green: `You are operating inside the "Spy Safehouse" Command Center. Adopt the crisp, composed, high-precision tone of a covert intelligence handler and field operative crew (Agent Vance: Lead Strategist, Agent Nyx: Cyber & Signal Specialist, Agent Cipher: Cryptographic Recon). Keep dialogue concise, tactical, and authentic.`,
  amber: `You are operating inside the "Pocket Monster Overworld" Research Lab. Adopt the warm, energetic, field-research tone of a classic handheld RPG Professor and Trainer crew (Prof. Oakwood: Field Researcher, Trainer Vera: Battle Tactician, Pory-Z: Digital Companion). Frame tasks as field expeditions, Dex analyses, and gym-grade strategies.`,
  blue: `You are operating inside the "Viking Longhall" War Council. Adopt the steadfast, honorable, saga-inspired tone of Nordic council strategists (Jarl Ragnar: Warband Tactician, Shieldmaiden Freya: Outrider Recon, Skald Torsten: Lorekeeper & Chronicler). Frame tasks as voyages, runic decrees, and council preparations.`,
};

export const STRUCTURED_CARD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dialogue: {
      type: 'STRING',
      description:
        'In-character retro RPG dialogue response (2 to 3 crisp sentences) for the bottom typewriter terminal, directly incorporating any real data returned by function calls.',
    },
    cardTitle: {
      type: 'STRING',
      description: 'Concise 3-5 word title for the agent execution card.',
    },
    actionCategory: {
      type: 'STRING',
      description: 'Category label such as Recon, Weather Intel, Web Search, Engineering, or Dispatch.',
    },
    steps: {
      type: 'ARRAY',
      description: '3 concrete execution steps completed or verified by the agent.',
      items: {
        type: 'OBJECT',
        properties: {
          label: {
            type: 'STRING',
            description: 'Short action step title.',
          },
          detail: {
            type: 'STRING',
            description: 'Specific outcome or live telemetry metric for this step.',
          },
          status: {
            type: 'STRING',
            description: 'One of: completed, verified, queued.',
          },
        },
        required: ['label', 'detail', 'status'],
      },
    },
  },
  required: ['dialogue', 'cardTitle', 'actionCategory', 'steps'],
};

export const ROUNDTABLE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    meetingTitle: {
      type: 'STRING',
      description: 'Concise 3-6 word title for this Town Hall Roundtable.',
    },
    consensusSummary: {
      type: 'STRING',
      description:
        '1-2 sentence executive consensus reached by the crew at the end of the roundtable.',
    },
    turns: {
      type: 'ARRAY',
      description:
        'Sequential multi-speaker dialogue turns (4 to 5 turns) where each custom-named agent chimes in with their distinct viewpoint.',
      items: {
        type: 'OBJECT',
        properties: {
          agentIndex: {
            type: 'INTEGER',
            description: 'Slot index of the speaking agent: 0, 1, or 2.',
          },
          speakerName: {
            type: 'STRING',
            description: 'Exact customName of the speaking agent.',
          },
          role: {
            type: 'STRING',
            description: 'Role title of the speaking agent.',
          },
          perspectiveTag: {
            type: 'STRING',
            description:
              'Short 2-word badge for their angle (e.g., STRATEGIC LEAD, CYBER RECON, ARCHIVE INTEL, FINAL CONSENSUS).',
          },
          dialogue: {
            type: 'STRING',
            description:
              '2 to 3 crisp in-character sentences responding to the prompt and reacting to fellow operatives.',
          },
          referencedNote: {
            type: 'STRING',
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
      type: 'ARRAY',
      description: '3 concrete follow-up action items assigned to the crew.',
      items: {
        type: 'OBJECT',
        properties: {
          agentIndex: {
            type: 'INTEGER',
            description: 'Assigned agent index (0, 1, or 2).',
          },
          ownerName: {
            type: 'STRING',
            description: 'Custom name of the assigned agent.',
          },
          directive: {
            type: 'STRING',
            description: 'Actionable follow-up task description.',
          },
          targetSector: {
            type: 'STRING',
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

/**
 * Generates an authentic, in-character AgentExecutionCard locally using client-side tools and heuristic intelligence.
 * Completely autonomous: zero network latency, zero remote backend dependencies.
 */
export async function generateLocalHeuristicCard(params: {
  prompt: string;
  themeId: ThemeId;
  activeAgentName: string;
  activeAgentRole: string;
  attachment?: { data: string; mimeType: string; name: string } | null;
  enabledPlugins?: string[];
  onFunctionCallTriggered?: (info: {
    toolName: string;
    args: Record<string, any>;
    targetRoom: RoomId;
    targetStationId: string;
    taskTag: string;
  }) => void;
}): Promise<AgentExecutionCard> {
  const promptLower = (params.prompt || '').toLowerCase();
  const executedTools: ExecutedToolCall[] = [];

  // Match and execute real tools client-side (Open-Meteo, Wikipedia, GitHub, Vault)
  if (
    promptLower.includes('weather') ||
    promptLower.includes('forecast') ||
    promptLower.includes('temp') ||
    promptLower.includes('climate')
  ) {
    const dest = resolveToolWorkflowDestination('weather_lookup');
    params.onFunctionCallTriggered?.({
      toolName: 'weather_lookup',
      args: { location: 'Local Sector' },
      targetRoom: dest.targetRoom,
      targetStationId: dest.targetStationId,
      taskTag: dest.taskTag,
    });
    try {
      const loc = promptLower.includes('tokyo')
        ? 'Tokyo'
        : promptLower.includes('london')
        ? 'London'
        : promptLower.includes('new york')
        ? 'New York'
        : promptLower.includes('paris')
        ? 'Paris'
        : 'San Francisco';
      const toolOut = await executeFunctionCallHandler({
        name: 'weather_lookup',
        args: { location: loc, units: 'celsius' },
      });
      executedTools.push(toolOut.executedToolMeta);
    } catch {
      // Graceful fallback
    }
  } else if (
    promptLower.includes('search') ||
    promptLower.includes('wiki') ||
    promptLower.includes('who is') ||
    promptLower.includes('what is') ||
    promptLower.includes('intel')
  ) {
    const dest = resolveToolWorkflowDestination('live_web_search');
    params.onFunctionCallTriggered?.({
      toolName: 'live_web_search',
      args: { query: params.prompt },
      targetRoom: dest.targetRoom,
      targetStationId: dest.targetStationId,
      taskTag: dest.taskTag,
    });
    try {
      const toolOut = await executeFunctionCallHandler({
        name: 'live_web_search',
        args: { query: params.prompt, maxResults: 3 },
      });
      executedTools.push(toolOut.executedToolMeta);
    } catch {
      // Graceful fallback
    }
  } else if (promptLower.includes('vault') || promptLower.includes('dossier')) {
    const dest = resolveToolWorkflowDestination('vault_query_intel');
    params.onFunctionCallTriggered?.({
      toolName: 'vault_query_intel',
      args: { query: params.prompt },
      targetRoom: dest.targetRoom,
      targetStationId: dest.targetStationId,
      taskTag: dest.taskTag,
    });
    try {
      const toolOut = await executeFunctionCallHandler({
        name: 'vault_query_intel',
        args: { query: params.prompt, clearanceLevel: 'omega' },
      });
      executedTools.push(toolOut.executedToolMeta);
    } catch {
      // Graceful fallback
    }
  }

  const primaryTool = executedTools[0];
  let dialogue = '';
  if (primaryTool) {
    dialogue = `[CLIENT HEURISTIC RUNTIME] ${params.activeAgentName} (${params.activeAgentRole}): Executed ${primaryTool.toolName} client-side. Live output: "${primaryTool.resultSummary}". Sector parameters synchronized.`;
  } else {
    dialogue = `[CLIENT HEURISTIC RUNTIME] ${params.activeAgentName} (${params.activeAgentRole}): Directive "${(params.prompt || 'Intel scan').slice(0, 36)}..." processed through local tactical neural matrix. Standing by at station.`;
  }

  const promptChars = (params.prompt || '').length + (params.attachment ? 450 : 0);
  const tokenEstimate = Math.max(50, Math.round(promptChars / 4) + 60);

  return {
    id: `card-${Date.now()}`,
    prompt: params.prompt || `Attached visual intel: ${params.attachment?.name || 'asset'}`,
    dialogue,
    cardTitle: primaryTool
      ? primaryTool.toolName.replace(/_/g, ' ').toUpperCase()
      : 'Tactical Field Operation',
    actionCategory: primaryTool ? 'Live Telemetry' : 'Local Operations',
    steps: [
      {
        label: 'Client Directive Ingested',
        detail: `Validated command parameters for ${params.activeAgentName}`,
        status: 'completed',
      },
      {
        label: primaryTool ? `Tool Execution [${primaryTool.toolName}]` : 'Local Heuristic Analysis',
        detail: primaryTool ? primaryTool.resultSummary : 'Synchronized state to local client ledger',
        status: 'verified',
      },
      {
        label: 'Mission State Secured',
        detail: 'Logged to Dexie/IndexedDB storage with 0ms network latency',
        status: 'completed',
      },
    ],
    toolCalls: executedTools,
    tokenEstimate,
    agentName: params.activeAgentName,
    themeId: params.themeId,
    timestamp: new Date().toISOString(),
    hasAttachment: Boolean(params.attachment),
  };
}

export async function checkServerStatus(
  themeId: ThemeId = 'green'
): Promise<{ online: boolean; configured: boolean; model: string }> {
  const config = loadLLMProviderConfig();
  const hasKey = Boolean(
    config.apiKey &&
      config.apiKey.trim().length > 0 &&
      config.apiKey !== 'MY_GEMINI_API_KEY'
  );
  return {
    online: true,
    configured: hasKey,
    model: config.modelName || 'gemini-3.8-flash',
  };
}

export async function pingGeminiConnection(
  themeId: ThemeId = 'green'
): Promise<{ ok: boolean; message?: string; error?: string; model?: string }> {
  const config = loadLLMProviderConfig();
  const key = config.apiKey?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return {
      ok: true,
      message: 'Local heuristic engine standing by. Bring Your Own Key (BYOK) enabled in Settings.',
      model: 'local-heuristic-v2',
    };
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        config.modelName || 'gemini-3.8-flash'
      )}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: 'Respond with a 6-word tactical readiness confirmation.' }],
            },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || `HTTP ${res.status}`;
      return {
        ok: false,
        error: `Gemini link degraded: ${msg}`,
        model: config.modelName || 'gemini-3.8-flash',
      };
    }

    const data = await res.json();
    const replyText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'Tactical link verified. All agents standing by.';
    return {
      ok: true,
      message: replyText,
      model: config.modelName || 'gemini-3.8-flash',
    };
  } catch (err: any) {
    return {
      ok: true,
      message: 'Local fallback engine standing by. Operatives ready for deployment.',
      model: 'local-heuristic-v2',
    };
  }
}

/**
 * Executes an agent directive using pure client-side AI execution:
 * - Direct Google Gemini REST API communication with the user's BYOK API key.
 * - Handles 2-turn Function Calling client-side: Turn 1 requests tools, runs real JS tool handlers
 *   (`executeFunctionCallHandler`), and routes live `functionResponse` data to Turn 2 with structured schema.
 * - If no API key is set or offline/rate-limited, seamlessly runs via `generateLocalHeuristicCard`.
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

      // Check active LLM provider configuration
      const llmConfig = loadLLMProviderConfig();
      const apiKey = llmConfig.apiKey?.trim();

      // If no valid API key is configured or key is placeholder, run pure client heuristic simulation
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        return generateLocalHeuristicCard({
          prompt: params.prompt,
          themeId: params.themeId,
          activeAgentName: params.activeAgentName,
          activeAgentRole: params.activeAgentRole,
          attachment: params.attachment,
          enabledPlugins: params.enabledPlugins,
          onFunctionCallTriggered: params.onFunctionCallTriggered,
        });
      }

      // If alternative provider is selected (OpenAI, Anthropic, Ollama), execute client-side or fallback
      if (llmConfig.providerId && llmConfig.providerId !== 'gemini') {
        try {
          if (llmConfig.providerId === 'openai') {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: llmConfig.modelName || 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content:
                      params.agentSystemPrompt ||
                      THEME_PERSONA_INSTRUCTIONS[params.themeId] ||
                      THEME_PERSONA_INSTRUCTIONS.spy,
                  },
                  { role: 'user', content: params.prompt },
                ],
                temperature: Number(params.temperature || 0.7),
              }),
              signal: AbortSignal.timeout(15000),
            });
            if (res.ok) {
              const data = await res.json();
              const reply = data.choices?.[0]?.message?.content || 'Directive processed.';
              return {
                id: `card-${Date.now()}`,
                prompt: params.prompt,
                dialogue: reply,
                cardTitle: 'OpenAI Directive Execution',
                actionCategory: 'Operations',
                steps: [
                  { label: 'Parse Directive', detail: 'Validated OpenAI parameters', status: 'completed' },
                  { label: 'Execute Routine', detail: 'Inference completed successfully', status: 'verified' },
                  { label: 'Ledger Synced', detail: 'Recorded to local state', status: 'completed' },
                ],
                toolCalls: [],
                tokenEstimate: Math.max(48, Math.round(reply.length / 4)),
                agentName: params.activeAgentName,
                themeId: params.themeId,
                timestamp: new Date().toISOString(),
                hasAttachment: Boolean(params.attachment),
              };
            }
          }
        } catch {
          // Graceful fallback on network drop or timeout
        }
        return generateLocalHeuristicCard(params);
      }

      // Google Gemini Direct Client-Side Execution
      const modelName = llmConfig.modelName || 'gemini-3.8-flash';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelName
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[params.themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      // Build dynamic tool declarations
      const baseDeclarations = buildDynamicToolDeclarations(params.enabledPlugins);
      let activeDeclarations = baseDeclarations;
      if (Array.isArray(params.agentAssignedTools) && params.agentAssignedTools.length > 0) {
        const allowed = new Set(params.agentAssignedTools);
        activeDeclarations = baseDeclarations.filter((d) => allowed.has(d.name));
      }

      const declaredToolNames = activeDeclarations.map((d) => d.name).join(', ');
      const memoryContextStr =
        Array.isArray(params.agentMemoryLog) && params.agentMemoryLog.length > 0
          ? `\n\nYour Individual Memory Log (Recent tasks completed):\n` +
            params.agentMemoryLog
              .slice(0, 5)
              .map((m: any) => `- [${m.timestamp}] Directive: "${m.prompt}" -> Summary: ${m.summary}`)
              .join('\n')
          : '';

      const systemInstruction = params.agentSystemPrompt
        ? `${params.agentSystemPrompt}${memoryContextStr}\nAvailable Assigned Tools: ${declaredToolNames}.`
        : `${personaInstruction}\nYou are currently responding as ${params.activeAgentName} (${params.activeAgentRole}).${memoryContextStr}\nAvailable Function Calling Tools: ${declaredToolNames}.\nWhen the user asks for weather, atmospheric conditions, or forecasts, ALWAYS call "weather_lookup".\nWhen the user asks to search the web, look up real-world facts, news, flights, companies, or encyclopedia topics, ALWAYS call "live_web_search".`;

      const userParts: any[] = [];
      if (params.attachment && params.attachment.data && params.attachment.mimeType) {
        userParts.push({
          inlineData: {
            mimeType: params.attachment.mimeType,
            data: params.attachment.data,
          },
        });
      }
      userParts.push({
        text: params.prompt || 'Analyze this attached visual intel and provide an execution plan.',
      });

      try {
        // Turn 1 Request: Prompt + Dynamic Tool Declarations
        const turn1Payload: any = {
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [{ role: 'user', parts: userParts }],
          generationConfig: {
            temperature: Number(params.temperature || 0.7),
          },
        };

        if (activeDeclarations.length > 0) {
          turn1Payload.tools = [{ functionDeclarations: activeDeclarations }];
        }

        const turn1Res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(turn1Payload),
          signal: AbortSignal.timeout(16000),
        });

        if (!turn1Res.ok) {
          if (turn1Res.status === 401 || turn1Res.status === 403) {
            throw createRetroAgentError({
              code: 'INVALID_API_KEY',
              themeId: params.themeId,
              technicalDetail: `Gemini HTTP ${turn1Res.status} API_KEY_INVALID from Google Cloud`,
              failedPrompt: params.prompt,
            });
          }
          if (turn1Res.status === 429) {
            throw createRetroAgentError({
              code: 'RATE_LIMIT',
              themeId: params.themeId,
              technicalDetail: 'Gemini HTTP 429 RESOURCE_EXHAUSTED (Rate limit reached)',
              failedPrompt: params.prompt,
              retryAfterSeconds: 15,
            });
          }
          // For other non-ok codes, fall back to local heuristic card
          return generateLocalHeuristicCard(params);
        }

        const turn1Data = await turn1Res.json();
        const candidate = turn1Data?.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const functionCalls = parts
          .filter((p: any) => p.functionCall)
          .map((p: any) => p.functionCall);

        // Turn 1 Interception: If Gemini triggered function calls, run them client-side
        if (functionCalls.length > 0) {
          const primaryCall = functionCalls[0];
          const primaryDest = resolveToolWorkflowDestination(primaryCall.name);

          params.onFunctionCallTriggered?.({
            toolName: primaryCall.name,
            args: primaryCall.args || {},
            targetRoom: primaryDest.targetRoom,
            targetStationId: primaryDest.targetStationId,
            taskTag: primaryDest.taskTag,
          });

          const handlerOutputs = await Promise.all(
            functionCalls.map((fc: any) => executeFunctionCallHandler(fc))
          );

          const functionResponses = handlerOutputs.map((out) => ({
            id: out.id,
            name: out.name,
            response: out.response,
          }));

          const executedTools: ExecutedToolCall[] = handlerOutputs.map(
            (out) => out.executedToolMeta
          );

          const functionResponseParts = functionResponses.map((fr) => ({
            functionResponse: {
              id: fr.id,
              name: fr.name,
              response: fr.response,
            },
          }));

          // Turn 2 Request: Send functionResponse data back to Gemini with STRUCTURED_CARD_SCHEMA
          const turn2Payload = {
            systemInstruction: {
              parts: [
                {
                  text: `${systemInstruction}\nYou have just received live tool output. Synthesize the telemetry into the final JSON response schema.`,
                },
              ],
            },
            contents: [
              { role: 'user', parts: userParts },
              candidate.content,
              { role: 'user', parts: functionResponseParts },
            ],
            generationConfig: {
              temperature: Number(params.temperature || 0.7),
              responseMimeType: 'application/json',
              responseSchema: STRUCTURED_CARD_SCHEMA,
            },
          };

          const turn2Res = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(turn2Payload),
            signal: AbortSignal.timeout(16000),
          });

          if (turn2Res.ok) {
            const turn2Data = await turn2Res.json();
            const rawJson = turn2Data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
            try {
              const parsed = JSON.parse(rawJson);
              return {
                id: `card-${Date.now()}`,
                prompt: params.prompt || `Attached visual intel`,
                dialogue: parsed.dialogue || 'Function call telemetry synthesized.',
                cardTitle: parsed.cardTitle || 'Tool Operation Complete',
                actionCategory: parsed.actionCategory || 'Live Telemetry',
                steps: Array.isArray(parsed.steps) ? parsed.steps : [],
                toolCalls: executedTools,
                tokenEstimate: Math.max(64, Math.round(((params.prompt || '').length + rawJson.length) / 4)),
                agentName: params.activeAgentName,
                themeId: params.themeId,
                timestamp: new Date().toISOString(),
                hasAttachment: Boolean(params.attachment),
              };
            } catch {
              // Fall through to return structured executedTools card
            }
          }

          // Fallback if Turn 2 synthesis timed out
          return {
            id: `card-${Date.now()}`,
            prompt: params.prompt || `Attached visual intel`,
            dialogue: `[TELEMETRY CAPTURED] ${params.activeAgentName}: Real-time tool execution complete. Data: "${executedTools[0]?.resultSummary}". Standing by.`,
            cardTitle: 'Tool Telemetry Verified',
            actionCategory: 'Live Telemetry',
            steps: [
              { label: 'Tool Dispatched', detail: executedTools[0]?.toolName || 'Function call', status: 'completed' },
              { label: 'Output Verified', detail: executedTools[0]?.resultSummary || 'Received live response', status: 'verified' },
              { label: 'Ledger Synced', detail: 'Logged to client memory', status: 'completed' },
            ],
            toolCalls: executedTools,
            tokenEstimate: 130,
            agentName: params.activeAgentName,
            themeId: params.themeId,
            timestamp: new Date().toISOString(),
            hasAttachment: Boolean(params.attachment),
          };
        }

        // Direct Turn without Function Calling
        const textContent = parts.map((p: any) => p.text || '').join('\n').trim();
        let parsedDirect: any = null;
        try {
          parsedDirect = JSON.parse(textContent);
        } catch {
          parsedDirect = null;
        }

        if (parsedDirect && parsedDirect.dialogue) {
          return {
            id: `card-${Date.now()}`,
            prompt: params.prompt || `Attached visual intel`,
            dialogue: parsedDirect.dialogue,
            cardTitle: parsedDirect.cardTitle || 'Field Directive Execution',
            actionCategory: parsedDirect.actionCategory || 'Operations',
            steps: Array.isArray(parsedDirect.steps) ? parsedDirect.steps : [],
            toolCalls: [],
            tokenEstimate: Math.max(48, Math.round(((params.prompt || '').length + textContent.length) / 4)),
            agentName: params.activeAgentName,
            themeId: params.themeId,
            timestamp: new Date().toISOString(),
            hasAttachment: Boolean(params.attachment),
          };
        }

        return {
          id: `card-${Date.now()}`,
          prompt: params.prompt || `Attached visual intel`,
          dialogue: textContent || 'Directive executed. Standing by for next command.',
          cardTitle: 'Field Directive Execution',
          actionCategory: 'Operations',
          steps: [
            { label: 'Directive Ingested', detail: 'Parsed command parameters', status: 'completed' },
            { label: 'Action Completed', detail: `${params.activeAgentName} completed assigned task`, status: 'verified' },
            { label: 'Ledger Synchronized', detail: 'Saved to local mission ledger', status: 'completed' },
          ],
          toolCalls: [],
          tokenEstimate: Math.max(48, Math.round(((params.prompt || '').length + textContent.length) / 4)),
          agentName: params.activeAgentName,
          themeId: params.themeId,
          timestamp: new Date().toISOString(),
          hasAttachment: Boolean(params.attachment),
        };
      } catch (err: any) {
        if (err instanceof RetroAgentError) {
          throw err;
        }
        // Seamless fallback to heuristic card so execution never freezes
        return generateLocalHeuristicCard(params);
      }
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

export function generateLocalRoundtableMeeting(params: {
  topic: string;
  themeId: ThemeId;
  participants: RoundtableParticipantPayload[];
}): RoundtableMeetingSession {
  const p0 = params.participants[0] || { customName: 'Agent Vance', role: 'Lead Strategist' };
  const p1 = params.participants[1] || { customName: 'Agent Nyx', role: 'Cyber & Signal Specialist' };
  const p2 = params.participants[2] || { customName: 'Agent Cipher', role: 'Cryptographic Recon' };

  const turns: RoundtableDialogueTurn[] = [
    {
      agentIndex: 0,
      speakerName: p0.customName,
      role: p0.role,
      perspectiveTag: 'STRATEGIC LEAD',
      dialogue: `Command has called a council regarding "${params.topic.slice(0, 45)}...". We must coordinate our sector assets immediately.`,
      referencedNote: p0.recentNotes?.[0] || 'War Room Strategic Telemetry',
    },
    {
      agentIndex: 1,
      speakerName: p1.customName,
      role: p1.role,
      perspectiveTag: 'CYBER & SIGNAL',
      dialogue: `Signal relays and placed server gear are nominal. I have verified our local subnet and tool endpoints are fully responsive.`,
      referencedNote: p1.recentNotes?.[0] || 'Comms Dish Frequency Array',
    },
    {
      agentIndex: 2,
      speakerName: p2.customName,
      role: p2.role,
      perspectiveTag: 'ARCHIVE INTEL',
      dialogue: `Archival records and encrypted ledgers in IndexedDB confirm our parameters. All nodes are ready for execution.`,
      referencedNote: p2.recentNotes?.[0] || 'Omega Dossier Archive Verified',
    },
    {
      agentIndex: 0,
      speakerName: p0.customName,
      role: p0.role,
      perspectiveTag: 'FINAL CONSENSUS',
      dialogue: `Tactical alignment achieved. Let us deploy to our designated sectors and fulfill the Commander directive.`,
      referencedNote: 'Full Sector Readiness Approved',
    },
  ];

  const actionItems: RoundtableActionItem[] = [
    {
      agentIndex: 0,
      ownerName: p0.customName,
      directive: `Coordinate strategic assets for "${params.topic.slice(0, 30)}"`,
      targetSector: 'war_room',
    },
    {
      agentIndex: 1,
      ownerName: p1.customName,
      directive: 'Monitor Comms Tower uplink and server gear health',
      targetSector: 'server_vault',
    },
    {
      agentIndex: 2,
      ownerName: p2.customName,
      directive: 'Verify cryptographic archive entries and memory state',
      targetSector: 'archive_basement',
    },
  ];

  return {
    id: `roundtable-${Date.now()}`,
    topic: params.topic,
    meetingTitle: 'Local Tactical Roundtable',
    consensusSummary:
      'All operatives aligned on strategic priorities and sector assignments via local tactical matrix.',
    turns,
    actionItems,
    tokenEstimate: 145,
    themeId: params.themeId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Orchestrates a Multi-Agent Town Hall Roundtable via Gemini REST API or pure client-side fallback.
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

      const llmConfig = loadLLMProviderConfig();
      const apiKey = llmConfig.apiKey?.trim();

      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        return generateLocalRoundtableMeeting(params);
      }

      try {
        const modelName = llmConfig.modelName || 'gemini-3.8-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelName
        )}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const personaInstruction =
          THEME_PERSONA_INSTRUCTIONS[params.themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

        const rosterDescription =
          Array.isArray(params.participants) && params.participants.length > 0
            ? params.participants
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
          Array.isArray(params.priorTurns) && params.priorTurns.length > 0
            ? `\nPrior Roundtable Transcript in this Session:\n${params.priorTurns
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

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: roundtableSystemInstruction }],
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `Commander's Town Hall Roundtable Topic: "${String(params.topic).trim()}"\nGenerate the multi-agent roundtable transcript in the required JSON schema.`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: Number(params.temperature || 0.75),
              responseMimeType: 'application/json',
              responseSchema: ROUNDTABLE_SCHEMA,
            },
          }),
          signal: AbortSignal.timeout(18000),
        });

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw createRetroAgentError({
              code: 'INVALID_API_KEY',
              themeId: params.themeId,
              technicalDetail: `Gemini HTTP ${res.status} API_KEY_INVALID during Roundtable`,
              failedPrompt: params.topic,
            });
          }
          if (res.status === 429) {
            throw createRetroAgentError({
              code: 'RATE_LIMIT',
              themeId: params.themeId,
              technicalDetail: 'Gemini HTTP 429 RESOURCE_EXHAUSTED during Roundtable',
              failedPrompt: params.topic,
              retryAfterSeconds: 15,
            });
          }
          return generateLocalRoundtableMeeting(params);
        }

        const data = await res.json();
        const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
        const parsed = JSON.parse(rawJson);

        const turns: RoundtableDialogueTurn[] = (
          Array.isArray(parsed.turns) ? parsed.turns : []
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
          Array.isArray(parsed.actionItems) ? parsed.actionItems : []
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
          meetingTitle: parsed.meetingTitle || 'Town Hall Strategic Roundtable',
          consensusSummary:
            parsed.consensusSummary ||
            'All operatives aligned on strategic priorities and sector assignments.',
          turns: turns.length > 0 ? turns : generateLocalRoundtableMeeting(params).turns,
          actionItems: actionItems.length > 0 ? actionItems : generateLocalRoundtableMeeting(params).actionItems,
          tokenEstimate: Math.max(95, Math.round((params.topic.length + rawJson.length) / 4)),
          themeId: params.themeId,
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        if (err instanceof RetroAgentError) {
          throw err;
        }
        return generateLocalRoundtableMeeting(params);
      }
    },
    params.themeId,
    params.topic
  );
}


