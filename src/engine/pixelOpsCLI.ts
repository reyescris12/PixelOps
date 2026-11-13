/**
 * PixelOps CLI & Headless Command Router
 * Parses and executes tactical developer/power-user CLI commands:
 * - pixelops status / ls
 * - pixelops dispatch <agentId> <taskName>
 * - pixelops approve <taskId>
 * - pixelops logs
 * - pixelops help
 */

import { getAllRooms, getAllRoomIds, ROOM_TEMPLATES, spawnRoom } from './roomManager';
import { AVAILABLE_SKILLS, loadRoomSkillBindings, mountSkillToRoom } from './moduleRegistry';
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  moveMultipleWorkspaceFiles,
  auditWorkspaceFiles,
  consolidateWorkspaceFiles,
  consolidateAndPrune,
  normalizeFilePath,
} from './storageManager';
import {
  getPluginCredential,
  savePluginCredential,
  clearPluginCredential,
  getAllPluginCredentials,
  isPluginAuthenticated,
  maskCredential,
} from './pluginAuthManager';
import {
  getOrCreateEntityId,
  getConnectedAccounts,
  initiateAppConnection,
  executeComposioAction,
  getComposioApiKey,
  setComposioApiKey,
  pingComposio,
  runAgentWithTools,
  getAvailableIntegrations,
  COMPOSIO_BASE_URL,
} from '../services/ComposioService';
import {
  getActiveSession,
  loginAccount,
  registerAccount,
  logoutAccount,
  fetchRemoteDevices,
  DeviceInfo,
} from '../services/AuthService';

export interface CLICommandContext {
  crewAgents: Array<{
    id: string;
    customName: string;
    role: string;
    currentRoom: string;
    statusTag?: string;
  }>;
  commandLedger?: Array<{
    id?: string;
    timestamp?: string;
    command?: string;
    output?: string;
    category?: string;
  }>;
  onDispatchTask?: (agentId: string, taskPrompt: string) => Promise<any> | void;
  onExecuteChain?: (workflowPrompt: string) => Promise<any> | void;
  onApproveTask?: (taskId: string) => void;
  onClearLogs?: () => void;
  onOpenFieldManual?: () => void;
}

export interface CLICommandResult {
  command: string;
  output: string;
  status: 'ok' | 'error' | 'warning';
  timestamp: string;
}

export async function executeCLICommand(
  rawInput: string,
  context: CLICommandContext
): Promise<CLICommandResult> {
  const trimmed = (rawInput || '').trim();
  const timestamp = new Date().toISOString();

  if (!trimmed) {
    return {
      command: '',
      output: '',
      status: 'ok',
      timestamp,
    };
  }

  // Normalize commands: allow with or without leading 'pixelops '
  let normalized = trimmed;
  if (normalized.toLowerCase().startsWith('pixelops ')) {
    normalized = normalized.slice(9).trim();
  }

  const tokens = normalized.split(/\s+/);
  const action = (tokens[0] || '').toLowerCase();
  const args = tokens.slice(1);

  // 1. STATUS / LS / AGENTS
  if (action === 'status' || action === 'ls' || action === 'agents') {
    const agents = context.crewAgents || [];
    if (agents.length === 0) {
      return {
        command: trimmed,
        output: 'NO ACTIVE OPERATIVES STATIONED IN SAFEHOUSE.',
        status: 'warning',
        timestamp,
      };
    }

    const lines = [
      'ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù',
      'Γòæ PIXELOPS TACTICAL AGENT REGISTRY & TELEMETRY                                   Γòæ',
      'ΓòáΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòú',
      '  ID             NAME             ROOM             ROLE',
      '  -----------------------------------------------------------------------------',
      ...agents.map(
        (a) =>
          `  ${a.id.padEnd(14)} ${a.customName.padEnd(16)} ${(a.currentRoom || 'war_room').padEnd(16)} ${a.role}`
      ),
      'ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥',
      `TOTAL ACTIVE AGENTS: ${agents.length}`,
    ];

    return {
      command: trimmed,
      output: lines.join('\n'),
      status: 'ok',
      timestamp,
    };
  }

  // 2. CHAIN / WORKFLOW <multi-step directive...>
  if (action === 'chain' || action === 'workflow' || action === 'pipeline') {
    const workflowPrompt = args.join(' ').replace(/^["']|["']$/g, '');
    if (!workflowPrompt || workflowPrompt.trim().length === 0) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops chain <multi-step prompt>\nExample: pixelops chain "Research latest CVEs, have Cipher write an advisory to cve.md, and have Nyx post an alert to Slack #security"',
        status: 'warning',
        timestamp,
      };
    }

    if (context.onExecuteChain) {
      context.onExecuteChain(workflowPrompt);
    } else if (context.onDispatchTask) {
      context.onDispatchTask('rec_vance', workflowPrompt);
    }

    return {
      command: trimmed,
      output: [
        '+------------------------------------------------------------------------------+',
        '| AUTONOMOUS MULTI-AGENT TASK CHAIN DEPLOYED                                    |',
        '+------------------------------------------------------------------------------+',
        `  WORKFLOW: "${workflowPrompt}"`,
        '  STATUS  : Choreographing sequential phases across Vance, Cipher, and Nyx',
        '  HANDOFF : Intelligence and artifacts will be passed autonomously between steps',
        '+------------------------------------------------------------------------------+',
        'Inspect live operative handoffs in the Task Chain HUD & Safehouse Canvas.',
      ].join('\n'),
      status: 'ok',
      timestamp,
    };
  }

  // 3. DISPATCH <agentId> <task...>
  if (action === 'dispatch') {
    if (args.length < 2) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops dispatch <agentId> <taskName / prompt>\nExample: pixelops dispatch rec_vance "Audit security endpoints"',
        status: 'error',
        timestamp,
      };
    }

    const agentId = args[0];
    const taskName = args.slice(1).join(' ').replace(/^["']|["']$/g, '');

    const targetAgent = (context.crewAgents || []).find(
      (a) => a.id.toLowerCase() === agentId.toLowerCase() || a.customName.toLowerCase() === agentId.toLowerCase()
    );

    if (!targetAgent) {
      return {
        command: trimmed,
        output: `ERROR: Operative "${agentId}" not found in safehouse roster. Run "pixelops status" to inspect valid IDs.`,
        status: 'error',
        timestamp,
      };
    }

    if (context.onDispatchTask) {
      context.onDispatchTask(targetAgent.id, taskName);
    }

    return {
      command: trimmed,
      output: `[DISPATCH QUEUED] Directive "${taskName}" transmitted to Operative ${targetAgent.customName} (${targetAgent.id}) at sector ${targetAgent.currentRoom}.`,
      status: 'ok',
      timestamp,
    };
  }

  // 3. APPROVE <taskId>
  if (action === 'approve') {
    const taskId = args[0];
    if (!taskId) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops approve <taskId>\nExample: pixelops approve task-brief-1',
        status: 'error',
        timestamp,
      };
    }

    if (context.onApproveTask) {
      context.onApproveTask(taskId);
    }

    return {
      command: trimmed,
      output: `[APPROVAL GRANTED] Human-in-the-loop task brief "${taskId}" approved. Agent execution resumed.`,
      status: 'ok',
      timestamp,
    };
  }

  // 4. LOGS
  if (action === 'logs' || action === 'log') {
    const entries = (context.commandLedger || []).slice(0, 10);
    if (entries.length === 0) {
      return {
        command: trimmed,
        output: 'NO TELEMETRY LOGS RECORDED IN THIS SESSION BUFFER.',
        status: 'warning',
        timestamp,
      };
    }

    const lines = [
      'ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù',
      'Γòæ PIXELOPS IMMUTABLE COMMAND TELEMETRY LEDGER (RECENT 10)                        Γòæ',
      'ΓòáΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòú',
      ...entries.map(
        (e, i) =>
          `[#${i + 1}] [${new Date(e.timestamp || Date.now()).toLocaleTimeString()}] ${e.command || 'UNKNOWN'}\n    └─ ${e.output || 'Complete'}`
      ),
      'ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥',
    ];

    return {
      command: trimmed,
      output: lines.join('\n'),
      status: 'ok',
      timestamp,
    };
  }

  // 5. CLEAR
  if (action === 'clear' || action === 'cls') {
    if (context.onClearLogs) {
      context.onClearLogs();
    }
    return {
      command: trimmed,
      output: '__CLEAR_CONSOLE__',
      status: 'ok',
      timestamp,
    };
  }

  // 6. ROOMS (List Safehouse Sectors)
  if (action === 'rooms' || action === 'sectors') {
    try {
      const allRooms = getAllRooms();
      const allIds = getAllRoomIds();
      const rows = allIds.map((id: string, i: number) => {
        const r = allRooms[id];
        return `[#${i + 1}] [${r.sectorCode}] ${r.shortBadge.padEnd(16)} · Wing: ${r.wingLabel} · Status: ONLINE`;
      });
      return {
        command: trimmed,
        output: [
          'ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù',
          'Γòæ PIXELOPS SAFEHOUSE SECTOR REGISTRY                                             Γòæ',
          'ΓòáΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòú',
          ...rows,
          'ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥',
        ].join('\n'),
        status: 'ok',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Failed to query room registry: ${e.message}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 7. SPAWN (Spawn Room from Template)
  if (action === 'spawn') {
    const templateId = (args[0] || '').toLowerCase();
    if (!templateId) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops spawn <cyber_lab | quantum_vault | stealth_hangar>',
        status: 'warning',
        timestamp,
      };
    }

    try {
      const tmpl = ROOM_TEMPLATES.find((t: any) => t.id === templateId);
      if (!tmpl) {
        return {
          command: trimmed,
          output: `Template "${templateId}" not found. Available: cyber_lab, quantum_vault, stealth_hangar`,
          status: 'error',
          timestamp,
        };
      }
      spawnRoom(tmpl);
      return {
        command: trimmed,
        output: `[SECTOR COMMISSIONED] [${tmpl.shortBadge}] (${tmpl.sectorCode}) spawned into safehouse footprint.`,
        status: 'ok',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Failed to spawn sector: ${e.message}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 8. SKILLS / CAPABILITIES
  if (action === 'skills' || action === 'modules') {
    try {
      const bindings = loadRoomSkillBindings();
      const rows = AVAILABLE_SKILLS.map((sk: any) => {
        const boundRooms = Object.entries(bindings)
          .filter(([_, skills]: any) => skills.includes(sk.id))
          .map(([r]) => r.toUpperCase());
        const boundStr = boundRooms.length > 0 ? boundRooms.join(', ') : 'NONE';
        return `● [${sk.shortCode}] ${sk.name}\n  └─ Category: ${sk.category} · Bound to: [${boundStr}]\n  └─ Tools: ${sk.providedTools.join(', ')}`;
      });
      return {
        command: trimmed,
        output: [
          'ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù',
          'Γòæ PIXELOPS MODULAR SKILLS & CAPABILITY PLUGINS                                   Γòæ',
          'ΓòáΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòú',
          ...rows,
          'ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥',
        ].join('\n'),
        status: 'ok',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Failed to inspect skills: ${e.message}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 9. BIND (Mount Skill to Room)
  if (action === 'bind') {
    const roomId = (args[0] || '').toLowerCase();
    const skillId = (args[1] || '').toLowerCase();
    if (!roomId || !skillId) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops bind <roomId> <skillId> (e.g. pixelops bind cyber_lab github_scraper)',
        status: 'warning',
        timestamp,
      };
    }

    try {
      mountSkillToRoom(roomId, skillId);
      return {
        command: trimmed,
        output: `[CAPABILITY MOUNTED] Skill "${skillId.toUpperCase()}" bound to room "${roomId.toUpperCase()}".`,
        status: 'ok',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Failed to bind skill: ${e.message}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 10. FILES (List Workspace Files in IndexedDB)
  if (action === 'files' || action === 'dir') {
    try {
      const cat = args[0];
      const files = await listWorkspaceFiles(cat);
      if (files.length === 0) {
        return {
          command: trimmed,
          output: 'NO WORKSPACE FILES FOUND IN INDEXEDDB STORAGE. Use the Files drawer to seed or create reports.',
          status: 'warning',
          timestamp,
        };
      }
      const lines = [
        `INDEXEDDB WORKSPACE FILES (${files.length} total):`,
        '--------------------------------------------------------------------------------',
        ...files.map((f) => `📄 [${f.category.toUpperCase()}] ${f.path} (${f.sizeBytes} B · ${f.format})`),
      ];
      return {
        command: trimmed,
        output: lines.join('\n'),
        status: 'ok',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Failed to list files: ${e?.message || e}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 11. CAT (Read Workspace File Content)
  if (action === 'cat' || action === 'read') {
    const filePath = args[0];
    if (!filePath) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops cat <filePath> (e.g. pixelops cat reports/master_execution_schedule.md)',
        status: 'warning',
        timestamp,
      };
    }
    try {
      const file = await readWorkspaceFile(filePath);
      if (!file) {
        return {
          command: trimmed,
          output: `File "${filePath}" not found in IndexedDB or VFS.`,
          status: 'error',
          timestamp,
        };
      }
      return {
        command: trimmed,
        output: `=== [${file.path}] (${file.sizeBytes} bytes) ===\n\n${file.content}`,
        status: 'ok',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Failed to read file: ${e?.message || e}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 11b. RM / DELETE (Remove Workspace File)
  if (action === 'rm' || action === 'delete') {
    const filePath = args[0];
    if (!filePath) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops rm <filePath> (e.g. pixelops rm reports/temp_report.md)',
        status: 'warning',
        timestamp,
      };
    }
    try {
      const ok = await deleteWorkspaceFile(filePath);
      return {
        command: trimmed,
        output: ok ? `Successfully deleted "${filePath}" from workspace.` : `File "${filePath}" was not found or already deleted.`,
        status: ok ? 'ok' : 'warning',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Failed to delete file: ${e?.message || e}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 11c. AUDIT (Audit Workspace Files & Integrity)
  if (action === 'audit' || action === 'fileaudit') {
    try {
      const audit = await auditWorkspaceFiles();
      const outputLines = [
        '=== [WORKSPACE VFS AUDIT REPORT] ===',
        `Timestamp: ${audit.timestamp}`,
        `Total Files: ${audit.totalFiles} | Total Footprint: ${Math.round(audit.totalBytes / 1024)} KB`,
        `Integrity Status: ${audit.integrityStatus}`,
        '',
        'Categories:',
        ...Object.entries(audit.categories).map(([cat, count]) => `  • ${cat}: ${count} file(s)`),
        '',
        `Folders: ${audit.folders.join(', ')}`,
        '',
        `Empty Files: ${audit.emptyFiles.length === 0 ? 'None (nominal)' : audit.emptyFiles.join(', ')}`,
        `Duplicate Content Groups: ${audit.duplicateContentGroups.length === 0 ? 'None (nominal)' : audit.duplicateContentGroups.map((g) => g.paths.join(' <-> ')).join('\n')}`,
        `Stale Files (>7 days): ${audit.staleFiles.length} file(s)`,
      ];
      return {
        command: trimmed,
        output: outputLines.join('\n'),
        status: audit.integrityStatus === 'NOMINAL' ? 'ok' : 'warning',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Workspace audit failed: ${e?.message || e}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 11d. CONSOLIDATE (Consolidate Multiple Files into One)
  if (action === 'consolidate') {
    if (args.length < 2) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops consolidate <file1> <file2> [file3...] [targetPath=<target>]',
        status: 'warning',
        timestamp,
      };
    }
    try {
      const sourcePaths: string[] = [];
      let targetPath: string | undefined = undefined;
      for (const a of args) {
        if (a.startsWith('target=')) {
          targetPath = a.replace(/^target=/, '');
        } else {
          sourcePaths.push(a);
        }
      }
      const deleteFlag = args.includes('--delete') || args.includes('-d');
      const archiveFlag = args.includes('--archive') || args.includes('-a');
      const cleanSources = sourcePaths.filter((s) => !s.startsWith('-'));

      const res = deleteFlag || !archiveFlag
        ? await consolidateAndPrune(cleanSources, targetPath, {
            leadOperative: 'Agent Vance (CLI Consolidation)',
          })
        : await consolidateWorkspaceFiles({
            sourcePaths: cleanSources,
            targetPath,
            archiveSources: true,
            deleteSources: false,
            leadOperative: 'Agent Vance (CLI Consolidation)',
          });

      return {
        command: trimmed,
        output: `[CONSOLIDATION SUCCESSFUL]\n${res.summary}\nUnified Document: ${res.targetPath} (${res.totalBytesCombined} bytes)\nPruning Verification: ${res.verifiedPruned ? 'VERIFIED REMOVED FROM INDEX' : 'COMPLETE'}`,
        status: 'ok',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Consolidation failed: ${e?.message || e}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 11e. ORGANIZE / MV (Move Files to Target Folder)
  if (action === 'mv' || action === 'move' || action === 'organize') {
    if (args.length < 2) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops mv <filePath> <targetFolder> (e.g. pixelops mv reports/brief.md archive)',
        status: 'warning',
        timestamp,
      };
    }
    try {
      const targetFolder = args[args.length - 1];
      const sourcePaths = args.slice(0, args.length - 1);
      const moved = await moveMultipleWorkspaceFiles(sourcePaths, targetFolder);
      return {
        command: trimmed,
        output: `Organized ${moved.length} file(s) into "${targetFolder}/":\n${moved.map((m) => `  • ${m.path}`).join('\n')}`,
        status: 'ok',
        timestamp,
      };
    } catch (e: any) {
      return {
        command: trimmed,
        output: `Organization move failed: ${e?.message || e}`,
        status: 'error',
        timestamp,
      };
    }
  }

  // 12. PLUGINS (List BYOK Plugins & Manage Credentials)
  if (action === 'plugins' || action === 'plugin') {
    const subAction = (args[0] || '').toLowerCase();
    if (subAction === 'auth' || subAction === 'set') {
      const pluginId = args[1];
      const key = args.slice(2).join(' ');
      if (!pluginId || !key) {
        return {
          command: trimmed,
          output: 'USAGE: pixelops plugin auth <pluginId> <apiKey/token>',
          status: 'warning',
          timestamp,
        };
      }
      savePluginCredential(pluginId, key);
      return {
        command: trimmed,
        output: `[BYOK SAVED] Credentials saved for plugin "${pluginId}". Auth status: ACTIVE [AES-GCM].`,
        status: 'ok',
        timestamp,
      };
    }
    if (subAction === 'revoke' || subAction === 'clear') {
      const pluginId = args[1];
      if (!pluginId) {
        return {
          command: trimmed,
          output: 'USAGE: pixelops plugin revoke <pluginId>',
          status: 'warning',
          timestamp,
        };
      }
      clearPluginCredential(pluginId);
      return {
        command: trimmed,
        output: `[TOKEN REVOKED] Credentials cleared for plugin "${pluginId}".`,
        status: 'ok',
        timestamp,
      };
    }

    const creds = getAllPluginCredentials();
    const rows = [
      'PIXELOPS BYOK PLUGIN CREDENTIALS & CONNECTORS:',
      '--------------------------------------------------------------------------------',
      ...['web_search', 'code_sandbox', 'fs_storage', 'api_gateway', 'memory_lookup', 'github', 'slack', 'calendar'].map((pid) => {
        const isAuth = isPluginAuthenticated(pid);
        const cred = creds[pid] || getPluginCredential(pid);
        const masked = cred ? maskCredential(cred.apiKey) : '[UNAUTHENTICATED]';
        return `🔌 ${pid.padEnd(16)} | ${isAuth ? '🟢 ACTIVE [AES-GCM]' : '⚠️ NO KEY         '} | ${masked}`;
      }),
      '--------------------------------------------------------------------------------',
      'Use: pixelops plugin auth <pluginId> <key>  to configure credentials via CLI.',
    ];
    return {
      command: trimmed,
      output: rows.join('\n'),
      status: 'ok',
      timestamp,
    };
  }

  // 13. COMPOSIO (Multi-User OAuth Integrations & Action Dispatcher)
  if (action === 'composio') {
    const subAction = (args[0] || '').toLowerCase();

    // composio status
    if (!subAction || subAction === 'status' || subAction === 'whoami') {
      const entityId = getOrCreateEntityId();
      const customKey = getComposioApiKey();
      let accounts: any[] = [];
      try {
        accounts = await getConnectedAccounts();
      } catch {
        // Handled below
      }

      const ping = await pingComposio();
      const pingStatus = ping.ok
        ? `🟢 ONLINE (${ping.latencyMs}ms · HTTP ${ping.status})`
        : `🔴 OFFLINE (${ping.error || 'Unreachable'} in ${ping.latencyMs}ms)`;

      const rows = [
        '+------------------------------------------------------------------------------+',
        '| COMPOSIO MULTI-USER PLUGIN ENGINE STATUS                                     |',
        '+------------------------------------------------------------------------------+',
        `  ISOLATED ENTITY ID : ${entityId}`,
        `  API KEY SOURCE     : ${customKey ? 'Custom BYOK Key (WebCrypto Vault)' : 'Cloudflare Server Proxy (/api/composio)'}`,
        `  LIVE CONNECTION    : ${pingStatus}`,
        `  PROXY ENDPOINT     : ${customKey && COMPOSIO_BASE_URL.startsWith('http') ? `${COMPOSIO_BASE_URL} (Direct)` : '/api/composio (Backend Proxy)'}`,
        '--------------------------------------------------------------------------------',
        `  CONNECTED ACCOUNTS (${accounts.length}):`,
        accounts.length === 0
          ? '  (No third-party accounts connected yet. Run "pixelops composio connect <app>")'
          : accounts
              .map(
                (acc) =>
                  `  [ONLINE] [${acc.appName.toUpperCase().padEnd(10)}] ID: ${acc.id} · Status: ${acc.status}`
              )
              .join('\n'),
        '+------------------------------------------------------------------------------+',
        'Supported apps: github, slack, gmail, notion, linear',
        'Commands: composio connect <app> | composio key <api_key> | composio run <action> <json>',
      ];

      return {
        command: trimmed,
        output: rows.join('\n'),
        status: ping.ok ? 'ok' : 'warning',
        timestamp,
      };
    }

    // composio connect <appName>
    if (subAction === 'connect' || subAction === 'auth' || subAction === 'link') {
      const appName = args[1];
      if (!appName) {
        return {
          command: trimmed,
          output:
            'USAGE: pixelops composio connect <appName>\nSupported: github, slack, gmail, notion, linear\nExample: pixelops composio connect github',
          status: 'warning',
          timestamp,
        };
      }

      try {
        const conn = await initiateAppConnection(appName);
        const entityId = getOrCreateEntityId();
        return {
          command: trimmed,
          output: [
            `[COMPOSIO OAUTH INITIATED] Connecting ${appName.toUpperCase()} for Commander (${entityId}):`,
            conn.connectionUrl
              ? `Authorization popup opened. If blocked, open:\n${conn.connectionUrl}`
              : `Connection initiated with ID: ${conn.connectionId || 'active'}`,
            'Once authorized in your browser, the tool will automatically become available to all agents.',
          ].join('\n'),
          status: 'ok',
          timestamp,
        };
      } catch (err: any) {
        return {
          command: trimmed,
          output: `Failed to initiate connection for "${appName}": ${err?.message || err}`,
          status: 'error',
          timestamp,
        };
      }
    }

    // composio key <apiKey>
    if (subAction === 'key' || subAction === 'setkey') {
      const key = args.slice(1).join(' ').trim();
      setComposioApiKey(key);
      if (!key) {
        return {
          command: trimmed,
          output: '[KEY CLEARED] Switched back to Cloudflare Pages Functions server-side key proxy.',
          status: 'ok',
          timestamp,
        };
      }

      // Run immediate live connection test
      const ping = await pingComposio();
      if (ping.ok) {
        return {
          command: trimmed,
          output: `[KEY STORED & VERIFIED] Live connection to Composio service verified (HTTP ${ping.status} in ${ping.latencyMs}ms).\nSecure credential vault active.`,
          status: 'ok',
          timestamp,
        };
      } else {
        return {
          command: trimmed,
          output: `[KEY STORED, WARNING] Connection ping returned error (${ping.error || 'Failed'} in ${ping.latencyMs}ms).\nVerify your API key from dashboard.composio.dev (Platform -> Settings -> API Keys).`,
          status: 'warning',
          timestamp,
        };
      }
    }

    // composio run <actionName> <jsonInput>
    if (subAction === 'run' || subAction === 'exec') {
      const actionName = args[1];
      const rawPayload = args.slice(2).join(' ').trim();
      if (!actionName) {
        return {
          command: trimmed,
          output:
            'USAGE: pixelops composio run <actionName> <jsonInput>\nExample: pixelops composio run github_create_issue {"owner":"octocat","repo":"demo","title":"Bug"}',
          status: 'warning',
          timestamp,
        };
      }

      let parsedPayload: Record<string, any> = {};
      if (rawPayload) {
        try {
          parsedPayload = JSON.parse(rawPayload);
        } catch (e: any) {
          return {
            command: trimmed,
            output: `INVALID JSON PAYLOAD: ${e?.message}\nInput received: ${rawPayload}`,
            status: 'error',
            timestamp,
          };
        }
      }

      try {
        const res = await executeComposioAction(actionName, parsedPayload);
        const outputLines = [
          `COMPOSIO ACTION: ${actionName}`,
          `STATUS: ${res.successful ? 'SUCCESS' : 'FAILED'}`,
          `EXECUTED AT: ${res.executedAt}`,
          '--------------------------------------------------------------------------------',
          res.successful
            ? JSON.stringify(res.data, null, 2)
            : `Error: ${res.error || 'Execution failed'}`,
        ];

        return {
          command: trimmed,
          output: outputLines.join('\n'),
          status: res.successful ? 'ok' : 'error',
          timestamp,
        };
      } catch (err: any) {
        return {
          command: trimmed,
          output: `Composio action dispatch error: ${err?.message || err}`,
          status: 'error',
          timestamp,
        };
      }
    }

    // composio agent <prompt> | composio prompt <prompt>
    if (subAction === 'agent' || subAction === 'prompt') {
      const userPrompt = args.slice(1).join(' ').trim();
      if (!userPrompt) {
        return {
          command: trimmed,
          output:
            'USAGE: pixelops composio agent <prompt>\nExample: pixelops composio agent "List open pull requests on repo owner/repo"',
          status: 'warning',
          timestamp,
        };
      }

      try {
        const result = await runAgentWithTools(userPrompt);
        const outputLines = [
          `[COMPOSIO AGENT WITH GEMINI EXECUTION]`,
          `PROMPT: ${userPrompt}`,
          '--------------------------------------------------------------------------------',
          typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
        ];

        return {
          command: trimmed,
          output: outputLines.join('\n'),
          status: 'ok',
          timestamp,
        };
      } catch (err: any) {
        return {
          command: trimmed,
          output: `Composio agent execution error: ${err?.message || err}`,
          status: 'error',
          timestamp,
        };
      }
    }

    // composio list | composio integrations | composio toolkits
    if (subAction === 'list' || subAction === 'integrations' || subAction === 'toolkits') {
      try {
        const items = await getAvailableIntegrations();
        const lines = [
          '+------------------------------------------------------------------------------+',
          '| COMPOSIO ARMORY TOOLKIT MATRIX                                               |',
          '+------------------------------------------------------------------------------+',
          ...items.map(
            (it) =>
              `  ${it.connected ? '[*]' : '[ ]'} [${it.appName.padEnd(14)}] ${it.name.padEnd(18)} · ${it.category.padEnd(18)} · ${it.connected ? '[CONNECTED]' : '[OFFLINE]'}`
          ),
          '--------------------------------------------------------------------------------',
          `Total Toolkits: ${items.length} · Connected: ${items.filter((i) => i.connected).length}`,
          'Commands: composio connect <app> | composio agent <prompt>',
          '+------------------------------------------------------------------------------+',
        ];
        return {
          command: trimmed,
          output: lines.join('\n'),
          status: 'ok',
          timestamp,
        };
      } catch (err: any) {
        return {
          command: trimmed,
          output: `Failed to fetch toolkits: ${err?.message || err}`,
          status: 'error',
          timestamp,
        };
      }
    }

    return {
      command: trimmed,
      output:
        'USAGE: pixelops composio <status|list|connect|run|agent|key>\n  composio status               Inspect isolated entityId and connected apps\n  composio list                 List available Composio Armory toolkits\n  composio connect <app>        Initiate OAuth connect for github, slack, gmail, notion\n  composio run <action> <json>  Dispatch an action with JSON payload\n  composio agent <prompt>       Run Gemini agent with active Composio tools\n  composio key <customKey>      Set or clear a custom Composio BYOK API key',
      status: 'warning',
      timestamp,
    };
  }

  // 14. SYNC [status|push|pull]
  if (action === 'sync') {
    const sub = (args[0] || '').toLowerCase();
    const { syncBidirectional, pushToCloud, pullFromCloud, getSyncStats } = await import(
      '../services/SyncService'
    );
    const stats = getSyncStats();

    if (sub === 'status') {
      const lines = [
        '+------------------------------------------------------------------------------+',
        '| SATCOM MULTI-DEVICE CLOUD SYNCHRONIZATION STATUS                             |',
        '+------------------------------------------------------------------------------+',
        `  Status:             ${stats.status.toUpperCase()}`,
        `  Last Synchronized:  ${stats.lastSyncedAt ? new Date(stats.lastSyncedAt).toLocaleString() : 'Never'}`,
        `  Workspace Files:    ${stats.filesCount}`,
        `  NightShift Tasks:   ${stats.routinesCount}`,
        `  Reflex Memories:    ${stats.memoriesCount}`,
        `  Auto-Sync Loop:     ${stats.autoSyncEnabled ? 'ENABLED (45s)' : 'DISABLED'}`,
        '+------------------------------------------------------------------------------+',
      ];
      return {
        command: trimmed,
        output: lines.join('\n'),
        status: 'ok',
        timestamp,
      };
    }

    if (sub === 'push') {
      const res = await pushToCloud();
      return {
        command: trimmed,
        output: res.success
          ? '[SATCOM PUSH COMPLETE] Local files, routines, and memories dispatched to cloud vault.'
          : `[SATCOM PUSH FAILED] ${res.error}`,
        status: res.success ? 'ok' : 'error',
        timestamp,
      };
    }

    if (sub === 'pull') {
      const res = await pullFromCloud();
      return {
        command: trimmed,
        output: res.success
          ? res.updated
            ? '[SATCOM PULL COMPLETE] Remote updates merged into local terminal store.'
            : '[SATCOM PULL COMPLETE] Local vault is already up to date.'
          : `[SATCOM PULL FAILED] ${res.error}`,
        status: res.success ? 'ok' : 'error',
        timestamp,
      };
    }

    // Default: full bidirectional sync
    const res = await syncBidirectional();
    return {
      command: trimmed,
      output: res.success
        ? [
            '+------------------------------------------------------------------------------+',
            '| SATCOM QUANTUM SYNC COMPLETED SUCCESSFULLY                                   |',
            '+------------------------------------------------------------------------------+',
            res.updated
              ? '✓ Bidirectional alignment complete. Remote dossiers & schedules merged.'
              : '✓ Local and cloud vaults are 100% aligned. No conflicts detected.',
            `  Files: ${stats.filesCount} | Routines: ${stats.routinesCount} | Memories: ${stats.memoriesCount}`,
            '+------------------------------------------------------------------------------+',
          ].join('\n')
        : `[SATCOM SYNC NOTICE] ${res.error || 'Local terminal operating in air-gapped mode.'}`,
      status: res.success ? 'ok' : 'warning',
      timestamp,
    };
  }

  // 15. ACCOUNT [whoami|logout|devices]
  if (action === 'account') {
    const sub = (args[0] || '').toLowerCase();
    const session = getActiveSession();

    if (sub === 'logout') {
      logoutAccount();
      return {
        command: trimmed,
        output: '[AUTHENTICATION REVOKED] Disconnected from SatCom Cloud. Air-gapped mode active.',
        status: 'ok',
        timestamp,
      };
    }

    if (sub === 'devices') {
      if (!session) {
        return {
          command: trimmed,
          output: 'ERROR: No active operative session. Log in or create an account first.',
          status: 'error',
          timestamp,
        };
      }
      try {
        const devs = await fetchRemoteDevices();
        const lines = [
          '+------------------------------------------------------------------------------+',
          '| LINKED SAFEHOUSE FLEET TERMINALS                                             |',
          '+------------------------------------------------------------------------------+',
          ...devs.map(
            (d: DeviceInfo) =>
              `  [${d.deviceType.toUpperCase()}] ${d.deviceName.padEnd(24)} | ID: ${d.deviceId.slice(0, 16)}... | Active: ${new Date(d.lastActive).toLocaleTimeString()}`
          ),
          '+------------------------------------------------------------------------------+',
        ];
        return {
          command: trimmed,
          output: lines.join('\n'),
          status: 'ok',
          timestamp,
        };
      } catch (err: any) {
        return {
          command: trimmed,
          output: `Failed to fetch fleet devices: ${err?.message || err}`,
          status: 'error',
          timestamp,
        };
      }
    }

    // Default: whoami
    if (!session) {
      return {
        command: trimmed,
        output: [
          'AIR-GAPPED OPERATIVE MODE (NO CLOUD LINK ACTIVE)',
          'To link this terminal with your phone or other computers, use the [SYNC] button or login.',
          'Usage: pixelops account [whoami | devices | logout]',
        ].join('\n'),
        status: 'warning',
        timestamp,
      };
    }

    return {
      command: trimmed,
      output: [
        '+------------------------------------------------------------------------------+',
        '| ACTIVE OPERATIVE CREDENTIALS                                                 |',
        '+------------------------------------------------------------------------------+',
        `  Callsign:           ${session.user.callsign}`,
        `  Handle:             @${session.user.username}`,
        `  Satellite Email:    ${session.user.email}`,
        `  Clearance:          ${session.user.securityClearance}`,
        `  Recovery Key:       [SECURE OFFLINE - ENCRYPTED]`,
        `  Terminal Node:      ${session.device.deviceName} (${session.device.deviceType})`,
        `  Node ID:            ${session.device.deviceId}`,
        `  Session Valid Till: ${new Date(session.expiresAt).toLocaleDateString()}`,
        '+------------------------------------------------------------------------------+',
      ].join('\n'),
      status: 'ok',
      timestamp,
    };
  }

  // 15.5 INTEL [status|inspect|nominate|selftest]
  if (action === 'intel') {
    const sub = (args[0] || 'status').toLowerCase();
    const {
      getCorroborationStatusSummary,
      getClusterWithPackets,
      nominateClusterPackage,
      runCorroborationSelfTest,
    } = await import('../services/CorroborationEngine');

    if (sub === 'status') {
      const summary = await getCorroborationStatusSummary();
      const tracks = Object.values(summary.watcherTracks);
      const lines = [
        '+------------------------------------------------------------------------------+',
        '| PIXELOPS CORROBORATION ENGINE // SOVEREIGN C2 STATUS                         |',
        '+------------------------------------------------------------------------------+',
        `  IndexedDB Packets : ${summary.totalPackets} (WIDE=${summary.trackPacketCounts.WIDE_AREA} SIG=${summary.trackPacketCounts.SIGNALS_INFRA} WIRE=${summary.trackPacketCounts.WRITTEN_WIRE} CVE=${summary.trackPacketCounts.CYBER_CVE})`,
        `  Delta Events      : ${summary.totalDeltas}`,
        `  Clusters Total    : ${summary.totalClusters} [CRIT=${summary.statusCounts.CRITICAL_CONVERGENCE} CORROB=${summary.statusCounts.CORROBORATED} CAND=${summary.statusCounts.CANDIDATE} STALE=${summary.statusCounts.STALE}]`,
        `  Pending Gate Cards: ${summary.pendingNominations} / ${summary.totalNominations} total`,
        '--------------------------------------------------------------------------------',
        '  SPECIALIST WATCHER TRACKS:',
        ...tracks.map(
          (t) =>
            `  [${t.operative.toUpperCase().padEnd(6)}] Tracks: ${t.tracks.join(', ').padEnd(25)} | Polls=${t.pollsCompleted} | Drops=${t.silentDrops} | Deltas=${t.deltasEmitted}`
        ),
        ...(summary.clusters.length > 0
          ? [
              '--------------------------------------------------------------------------------',
              '  RECENT CLUSTERS:',
              ...summary.clusters
                .slice(0, 8)
                .map(
                  (c) =>
                    `  - ${c.clusterId} | ${c.status.padEnd(20)} | score=${c.corroborationScore.toFixed(2)} | src=[${c.independentTracks.join('+')}] | ${c.sectorKey}`
                ),
            ]
          : []),
        '+------------------------------------------------------------------------------+',
      ];
      return {
        command: trimmed,
        output: lines.join('\n'),
        status: 'ok',
        timestamp,
      };
    }

    if (sub === 'inspect') {
      const targetId = args[1];
      if (!targetId) {
        return {
          command: trimmed,
          output: 'USAGE: pixelops intel inspect <clusterId>',
          status: 'warning',
          timestamp,
        };
      }
      const bundle = await getClusterWithPackets(targetId);
      if (!bundle) {
        return {
          command: trimmed,
          output: `Cluster "${targetId}" not found. Run "pixelops intel status" to list cluster IDs.`,
          status: 'error',
          timestamp,
        };
      }
      const { cluster, packets, synthesis } = bundle;
      const nowMs = Date.now();
      const lines = [
        '+------------------------------------------------------------------------------+',
        `| EVIDENCE PROVENANCE CHAIN // ${cluster.clusterId}                              |`,
        '+------------------------------------------------------------------------------+',
        `  STATUS      : ${cluster.status} (SCORE: ${cluster.corroborationScore.toFixed(2)})`,
        `  SECTOR      : ${cluster.sectorKey} @ (${cluster.geoAnchor.lat.toFixed(4)}, ${cluster.geoAnchor.lon.toFixed(4)}) ±${cluster.geoAnchor.radiusKm}km`,
        `  TRACKS      : ${cluster.independentTracks.join(' + ')}`,
        `  GATE STATUS : ${cluster.nominationStatus || 'UNNOMINATED'}`,
        ...(cluster.sitrepPath ? [`  LEDGER REF  : ${cluster.sitrepPath}`] : []),
        '--------------------------------------------------------------------------------',
        '  CONTRIBUTING PACKETS:',
        ...packets.map((p, idx) => {
          const ageSec = Math.max(0, Math.round((nowMs - new Date(p.capturedAt).getTime()) / 1000));
          const weight = (1 / Math.max(1, packets.length)).toFixed(2);
          const staleFlag = ageSec > p.ttlSeconds ? 'EXPIRED/STALE' : `FRESH (${p.ttlSeconds - ageSec}s left)`;
          return [
            `  [${idx + 1}] packetId : ${p.packetId}`,
            `      source   : ${p.sourceTrack}/${p.sourceType} (${p.ingestedBy}) -> ${p.sourceEndpoint}`,
            `      age/ttl  : ${ageSec}s / ${p.ttlSeconds}s [${staleFlag}] | weight=${weight}`,
            `      rawRef   : ${p.rawPayloadRef}`,
          ].join('\n');
        }),
        ...(synthesis
          ? [
              '--------------------------------------------------------------------------------',
              `  VANCE BLUF  : ${synthesis.executiveAssessment.bluf}`,
              `  CITED IDS   : ${synthesis.executiveAssessment.citedPacketIds.join(', ')}`,
            ]
          : []),
        '+------------------------------------------------------------------------------+',
      ];
      return {
        command: trimmed,
        output: lines.join('\n'),
        status: 'ok',
        timestamp,
      };
    }

    if (sub === 'nominate') {
      const targetId = args[1];
      if (!targetId) {
        const summary = await getCorroborationStatusSummary();
        const candidates = summary.clusters.filter(
          (c) => c.status === 'CORROBORATED' || c.status === 'CRITICAL_CONVERGENCE'
        );
        return {
          command: trimmed,
          output:
            candidates.length > 0
              ? `USAGE: pixelops intel nominate <clusterId>\nPending clusters:\n${candidates
                  .map((c) => `  - ${c.clusterId} (${c.status}, score=${c.corroborationScore.toFixed(2)}, gate=${c.nominationStatus})`)
                  .join('\n')}`
              : 'USAGE: pixelops intel nominate <clusterId>\nNo corroborated clusters currently awaiting nomination.',
          status: 'warning',
          timestamp,
        };
      }
      const res = await nominateClusterPackage(targetId, { approvedBy: 'CLI_COMMANDER' });
      if (!res.approved) {
        return {
          command: trimmed,
          output: `[NOMINATION BLOCKED] ${res.reason}`,
          status: 'error',
          timestamp,
        };
      }
      return {
        command: trimmed,
        output: [
          '+------------------------------------------------------------------------------+',
          `| HUMAN NOMINATION GATE APPROVED // ${res.cluster?.clusterId}                    |`,
          '+------------------------------------------------------------------------------+',
          `  EFFECTOR     : ${res.nomination?.actionType}`,
          `  LEDGER HASH  : ${res.ledgerHash}`,
          `  STAGED REF   : ${res.effectorFilePath}`,
          `  CITED PACKETS: ${res.nomination?.citedPacketIds.length ?? 0} verified SHA-256 packets`,
          '+------------------------------------------------------------------------------+',
        ].join('\n'),
        status: 'ok',
        timestamp,
      };
    }

    if (sub === 'selftest') {
      const report = await runCorroborationSelfTest();
      const lines = [
        '+------------------------------------------------------------------------------+',
        '| PIXELOPS CORROBORATION ENGINE // DETERMINISTIC SELF-TEST                     |',
        '+------------------------------------------------------------------------------+',
        `  OVERALL      : ${report.passed ? 'PASS' : 'FAIL'}`,
        `  CLUSTER ID   : ${report.clusterId}`,
        `  PROMOTION    : CANDIDATE (${report.candidateScore.toFixed(2)}) -> CORROBORATED (${report.corroboratedScore.toFixed(2)})`,
        `  PACKET 1 RAW : ${report.rawPath1}`,
        `  PACKET 2 RAW : ${report.rawPath2}`,
        `  LEDGER REF   : ${report.sitrepPath || 'none'}`,
        `  CANVAS LINK  : ${report.canvasVisible ? 'VISIBLE_WITH_2X_PROVENANCE' : 'FAILED'}`,
        '--------------------------------------------------------------------------------',
        ...report.steps.map(
          (s) => `  [${s.passed ? 'PASS' : 'FAIL'}] ${s.step}: ${s.detail}`
        ),
        '+------------------------------------------------------------------------------+',
      ];
      return {
        command: trimmed,
        output: lines.join('\n'),
        status: report.passed ? 'ok' : 'error',
        timestamp,
      };
    }

    return {
      command: trimmed,
      output: 'USAGE: pixelops intel <status | inspect <clusterId> | nominate <clusterId> | selftest>',
      status: 'warning',
      timestamp,
    };
  }

  // 15b. RECON (Geofenced Local Recon, High Alert Mode & Dispatch Triage)
  if (action === 'recon') {
    const sub = (args[0] || 'local').toLowerCase();
    const {
      getLocalGeofenceConfig,
      saveLocalGeofenceConfig,
      queryGeofencedLocalRecon,
    } = await import('../services/OsintToolsService');

    if (sub === 'geofence') {
      const lat = Number(args[1]);
      const lon = Number(args[2]);
      const radiusArg = args[3] ? Number(String(args[3]).replace(/km$/i, '')) : undefined;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        const cur = getLocalGeofenceConfig();
        return {
          command: trimmed,
          output: `CURRENT GEOFENCE: (${cur.lat.toFixed(4)}, ${cur.lon.toFixed(4)}) radius=${cur.radiusKm}km [${cur.label}]\nUSAGE: pixelops recon geofence <lat> <lon> [radiusKm]`,
          status: 'ok',
          timestamp,
        };
      }
      const updated = saveLocalGeofenceConfig({
        lat,
        lon,
        ...(radiusArg && Number.isFinite(radiusArg) ? { radiusKm: radiusArg } : {}),
      });
      return {
        command: trimmed,
        output: `GEOFENCE UPDATED: (${updated.lat.toFixed(4)}, ${updated.lon.toFixed(4)}) radius=${updated.radiusKm}km`,
        status: 'ok',
        timestamp,
      };
    }

    if (sub === 'alert') {
      const modeArg = (args[1] || 'status').toLowerCase();
      const { isHighAlertModeEnabled, setHighAlertMode } = await import(
        '../services/NightShiftService'
      );
      if (modeArg === 'on' || modeArg === 'enable') {
        setHighAlertMode(true);
        saveLocalGeofenceConfig({ highAlertMode: true });
        const { fetchLocalDispatchFeeds } = await import('../services/ClassifiedFeedService');
        const pollRes = await fetchLocalDispatchFeeds({ logToLedger: true });
        return {
          command: trimmed,
          output: `HIGH ALERT MODE: ARMED (60s rapid poll active)\nInitial local dispatch sweep: ${pollRes.feedsPolled} feed(s), ${pollRes.incidents.length} bounded incident(s), ${pollRes.deltasEmitted} delta(s).`,
          status: 'ok',
          timestamp,
        };
      }
      if (modeArg === 'off' || modeArg === 'disable') {
        setHighAlertMode(false);
        saveLocalGeofenceConfig({ highAlertMode: false });
        return {
          command: trimmed,
          output: 'HIGH ALERT MODE: STANDBY (standard 180s specialist sweep)',
          status: 'ok',
          timestamp,
        };
      }
      return {
        command: trimmed,
        output: `HIGH ALERT MODE: ${isHighAlertModeEnabled() ? 'ARMED (60s rapid poll)' : 'STANDBY (180s)'}`,
        status: 'ok',
        timestamp,
      };
    }

    if (sub === 'triage') {
      const transcript = args.slice(1).join(' ').trim();
      if (!transcript) {
        return {
          command: trimmed,
          output: 'USAGE: pixelops recon triage <dispatch transcript text>',
          status: 'warning',
          timestamp,
        };
      }
      const { analyzeDispatchSignal } = await import('../services/DispatchTriageService');
      const triage = await analyzeDispatchSignal({
        transcript,
        sourceLabel: 'CLI_SCANNER_INPUT',
        ingestIntoSwarm: true,
      });
      return {
        command: trimmed,
        output: [
          '+------------------------------------------------------------------------------+',
          '| DISPATCH TRIAGE ANALYZER                                                     |',
          '+------------------------------------------------------------------------------+',
          `  THREAT DETECTED : ${triage.threatDetected ? 'YES' : 'NO'}`,
          `  TYPE / SEVERITY : ${triage.type} [${triage.severity}]`,
          `  MODEL           : ${triage.modelUsed}`,
          `  SUMMARY         : ${triage.summary}`,
          ...(triage.packetId ? [`  PACKET ID       : ${triage.packetId}`] : []),
          ...(triage.clusterId ? [`  CLUSTER ID      : ${triage.clusterId}`] : []),
          '+------------------------------------------------------------------------------+',
        ].join('\n'),
        status: triage.threatDetected ? 'warning' : 'ok',
        timestamp,
      };
    }

    if (sub === 'premedia' || sub === 'sweep') {
      let radiusOverride: number | undefined;
      for (let i = 1; i < args.length; i++) {
        const tok = args[i];
        if ((tok === '--radius' || tok === '-r') && args[i + 1]) {
          const val = Number(String(args[i + 1]).replace(/km$/i, ''));
          if (Number.isFinite(val)) radiusOverride = val;
        } else if (tok.startsWith('--radius=')) {
          const val = Number(tok.slice('--radius='.length).replace(/km$/i, ''));
          if (Number.isFinite(val)) radiusOverride = val;
        }
      }
      const { runPreMediaLocalizedThreatSweep } = await import('../services/PreMediaSignalService');
      const sweep = await runPreMediaLocalizedThreatSweep({
        radiusKm: radiusOverride,
        ingestIntoCorroboration: true,
      });
      const out = [
        '+------------------------------------------------------------------------------+',
        `| PRE-MEDIA LOCALIZED THREAT SWEEP // ${sweep.geofence.label.padEnd(40).slice(0, 40)}|`,
        '+------------------------------------------------------------------------------+',
        `  GEOFENCE     : ${sweep.geofence.lat.toFixed(4)}, ${sweep.geofence.lon.toFixed(4)} (<= ${sweep.geofence.radiusKm} km)`,
        `  911/NWS CAD  : ${sweep.municipalDispatches.length} bounded dispatch(es)`,
        `  ADS-B RADAR  : ${sweep.adsbTacticalContacts.length} tactical / ${sweep.adsbTotalAircraft} overhead aircraft`,
        `  PLUME SENSOR : ${sweep.plumeReading ? sweep.plumeReading.summary : 'Sensor unavailable'}`,
        `  GEO HAZARDS  : ${sweep.geoHazardSignals.length} micro-seismic / blast / thermal signal(s)`,
        `  CORROBORATED : ${sweep.corroboration.activeCorroboratedCount} active cluster(s) | ${sweep.corroboration.packetsIngested} packets ingested`,
        '--------------------------------------------------------------------------------',
        ...sweep.municipalDispatches.slice(0, 4).map(
          (d) => `  [CAD/${d.sourceType.toUpperCase()}] (${d.distanceKm} km) [${d.severity}] ${d.title}`
        ),
        ...sweep.adsbTacticalContacts.slice(0, 4).map(
          (a) => `  [ADS-B/${a.tacticalFlag}] (${a.distanceKm} km) [${a.severity}] ${a.summary}`
        ),
        '+------------------------------------------------------------------------------+',
      ];
      return {
        command: trimmed,
        output: out.join('\n'),
        status: sweep.corroboration.activeCorroboratedCount > 0 ? 'warning' : 'ok',
        timestamp,
      };
    }

    if (sub === 'adsb') {
      let radiusOverride: number | undefined;
      for (let i = 1; i < args.length; i++) {
        const tok = args[i];
        if ((tok === '--radius' || tok === '-r') && args[i + 1]) {
          const val = Number(String(args[i + 1]).replace(/km$/i, ''));
          if (Number.isFinite(val)) radiusOverride = val;
        }
      }
      const { queryGeofencedAdsbAirspace } = await import('../services/PreMediaSignalService');
      const adsb = await queryGeofencedAdsbAirspace({ radiusKm: radiusOverride });
      const out = [
        '+------------------------------------------------------------------------------+',
        '| GEOFENCED ADS-B TRANSPONDER OVERWATCH                                        |',
        '+------------------------------------------------------------------------------+',
        `  ENDPOINT          : ${adsb.endpointUsed}`,
        `  OVERHEAD AIRCRAFT : ${adsb.totalAircraft}`,
        `  TACTICAL CONTACTS : ${adsb.tacticalContacts.length}`,
        '--------------------------------------------------------------------------------',
        ...(adsb.tacticalContacts.length > 0
          ? adsb.tacticalContacts.slice(0, 8).map((c) => `  [${c.severity}] ${c.summary}`)
          : ['  No emergency squawks or low-altitude tactical/medevac orbits detected.']),
        '+------------------------------------------------------------------------------+',
      ];
      return {
        command: trimmed,
        output: out.join('\n'),
        status: adsb.tacticalContacts.length > 0 ? 'warning' : 'ok',
        timestamp,
      };
    }

    // Default: recon local [--radius 25km] [--lat X --lon Y]
    let radiusOverride: number | undefined;
    let latOverride: number | undefined;
    let lonOverride: number | undefined;
    for (let i = 0; i < args.length; i++) {
      const tok = args[i];
      if ((tok === '--radius' || tok === '-r') && args[i + 1]) {
        const val = Number(String(args[i + 1]).replace(/km$/i, ''));
        if (Number.isFinite(val)) radiusOverride = val;
      } else if (tok.startsWith('--radius=')) {
        const val = Number(tok.slice('--radius='.length).replace(/km$/i, ''));
        if (Number.isFinite(val)) radiusOverride = val;
      } else if (tok === '--lat' && args[i + 1]) {
        const val = Number(args[i + 1]);
        if (Number.isFinite(val)) latOverride = val;
      } else if (tok === '--lon' && args[i + 1]) {
        const val = Number(args[i + 1]);
        if (Number.isFinite(val)) lonOverride = val;
      }
    }

    const reconRes = await queryGeofencedLocalRecon({
      lat: latOverride,
      lon: lonOverride,
      radiusKm: radiusOverride,
    });

    const lines = [
      '+------------------------------------------------------------------------------+',
      `| GEOFENCED LOCAL RECON // ${reconRes.geofence.label.padEnd(52).slice(0, 52)}|`,
      '+------------------------------------------------------------------------------+',
      `  CENTER       : ${reconRes.geofence.lat.toFixed(4)}, ${reconRes.geofence.lon.toFixed(4)}`,
      `  RADIUS BOUND : <= ${reconRes.geofence.radiusKm} km`,
      `  BOUNDED HITS : ${reconRes.items.length}`,
      '--------------------------------------------------------------------------------',
      ...(reconRes.items.length > 0
        ? reconRes.items.map(
            (it) =>
              `  [${it.source}] (${it.distanceKm} km <= ${reconRes.geofence.radiusKm} km) [${it.severity}] ${it.title}`
          )
        : ['  No active NWS polygon alerts or seismic events inside this bounding radius.']),
      '+------------------------------------------------------------------------------+',
    ];

    return {
      command: trimmed,
      output: lines.join('\n'),
      status: 'ok',
      timestamp,
    };
  }

  // 16. HELP
  if (action === 'help') {
    const helpText = [
      'PIXELOPS TACTICAL HEADLESS CLI UTILITY v1.0',
      '--------------------------------------------------------------------------------',
      'Commands:',
      '  pixelops status | ls               List active operatives, rooms & assignments',
      '  pixelops chain <workflow>          Execute an autonomous multi-agent task chain across operatives',
      '  pixelops dispatch <agent> <task>   Queue a tactical directive to an operative',
      '  pixelops approve <taskId>          Approve pending human-in-the-loop task briefs',
      '  pixelops sync [status|push|pull]   Execute multi-device quantum cloud sync',
      '  pixelops account [devices|logout]  Inspect operative callsign, clearance & linked devices',
      '  pixelops files [category]          List IndexedDB workspace files (reports, logs, config)',
      '  pixelops cat <filePath>            Read content of an IndexedDB workspace file',
      '  pixelops rm <filePath>             Delete a workspace file from IndexedDB/VFS',
      '  pixelops mv <file> <folder>        Organize and move a file into a target folder',
      '  pixelops audit                     Audit workspace files, byte sizes, and detect duplicates',
      '  pixelops consolidate <f1> <f2>...  Consolidate multiple files into a unified master dossier',
      '  pixelops plugins                   List BYOK capability plugins and auth tokens',
      '  pixelops plugin auth <id> <key>    Save BYOK API key/token for plugin locally',
      '  pixelops plugin revoke <id>        Revoke/clear local credentials for plugin',
      '  pixelops composio [status]         Inspect multi-user Composio entityId and apps',
      '  pixelops composio list             List available Composio Armory toolkits',
      '  pixelops composio connect <app>    Initiate OAuth connect (github, slack, gmail, notion)',
      '  pixelops composio run <act> <json> Execute a Composio action via proxy',
      '  pixelops composio agent <prompt>   Run Gemini agent with Composio function tools',
      '  pixelops rooms                     List registered safehouse sectors',
      '  pixelops spawn <templateId>        Spawn sector (cyber_lab, quantum_vault, etc)',
      '  pixelops skills                    List available capability plugins & bindings',
      '  pixelops bind <room> <skill>       Mount a capability to a sector',
      '  pixelops intel status              Show watcher tracks, IndexedDB packet & cluster counts',
      '  pixelops intel inspect <id>        Print full SHA-256 provenance chain for a cluster',
      '  pixelops intel nominate <id>       Approve & commit human effector nomination gate to ledger',
      '  pixelops intel selftest            Run deterministic 2-track corroboration self-test',
      '  pixelops recon local [--radius km] Query bounded NWS/USGS alerts inside local geofence',
      '  pixelops recon premedia            Run full pre-media CAD + ADS-B + Plume + Hazard sweep',
      '  pixelops recon adsb [--radius km]  Sweep overhead ADS-B emergency/medevac transponders',
      '  pixelops recon geofence lat lon km Update local geofence coordinates & radius',
      '  pixelops recon alert <on|off>      Toggle 60s High Alert Mode rapid dispatch polling',
      '  pixelops recon triage <text>       Run Gemini Flash emergency dispatch triage',
      '  pixelops logs                      Stream recent command telemetry records',
      '  pixelops clear                     Clear the terminal screen buffer',
      '  pixelops manual                    Open Classified Safehouse Field Manual & Command Guide',
      '  pixelops help                      Show this tactical command reference',
      '--------------------------------------------------------------------------------',
      'Tip: Leading "pixelops " prefix is optional (e.g. "status" or "ls" works directly).',
    ].join('\n');

    return {
      command: trimmed,
      output: helpText,
      status: 'ok',
      timestamp,
    };
  }

  return {
    command: trimmed,
    output: `Unknown command: "${action}". Type "pixelops help" for available commands.`,
    status: 'error',
    timestamp,
  };
}
