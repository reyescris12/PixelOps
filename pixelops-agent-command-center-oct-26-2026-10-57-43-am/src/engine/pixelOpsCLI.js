/**
 * PixelOps CLI & Headless Command Router
 * Parses and executes tactical developer/power-user CLI commands:
 * - pixelops status / ls
 * - pixelops dispatch <agentId> <taskName>
 * - pixelops approve <taskId>
 * - pixelops rooms / sectors
 * - pixelops spawn <templateId>
 * - pixelops skills / modules
 * - pixelops bind <roomId> <skillId>
 * - pixelops logs
 * - pixelops help
 */

import { getAllRooms, getAllRoomIds, ROOM_TEMPLATES, spawnRoom } from './roomManager.js';
import { AVAILABLE_SKILLS, loadRoomSkillBindings, mountSkillToRoom } from './moduleRegistry.js';
import { listWorkspaceFiles, readWorkspaceFile } from './storageManager.js';
import {
  getPluginCredential,
  savePluginCredential,
  clearPluginCredential,
  getAllPluginCredentials,
  isPluginAuthenticated,
  maskCredential,
} from './pluginAuthManager.js';

export async function executeCLICommand(rawInput, context) {
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
      '╔════════════════════════════════════════════════════════════════════════════════╗',
      '║ PIXELOPS TACTICAL AGENT TELEMETRY MANIFEST                                     ║',
      '╠════════════════════════════════════════════════════════════════════════════════╣',
      ...agents.map((a, i) => {
        const num = `#${i + 1}`.padEnd(4);
        const name = (a.customName || 'UNKNOWN').padEnd(16);
        const role = (a.role || 'Operative').padEnd(18);
        const room = (a.currentRoom || 'war_room').toUpperCase().padEnd(18);
        const status = a.statusTag || 'IDLE';
        return `[${num}] ${name} | ${role} | ROOM: ${room} | [${status}]`;
      }),
      '╚════════════════════════════════════════════════════════════════════════════════╝',
    ];

    return {
      command: trimmed,
      output: lines.join('\n'),
      status: 'ok',
      timestamp,
    };
  }

  // 2. DISPATCH <agentId> <taskName>
  if (action === 'dispatch' || action === 'run' || action === 'exec') {
    const targetAgentIdOrName = args[0];
    const taskPrompt = args.slice(1).join(' ');

    if (!targetAgentIdOrName || !taskPrompt) {
      return {
        command: trimmed,
        output: 'USAGE: pixelops dispatch <agentId|agentName> <directive prompt...>',
        status: 'warning',
        timestamp,
      };
    }

    const agents = context.crewAgents || [];
    const matchedAgent = agents.find(
      (a) =>
        a.id.toLowerCase() === targetAgentIdOrName.toLowerCase() ||
        a.customName.toLowerCase() === targetAgentIdOrName.toLowerCase()
    );

    if (!matchedAgent) {
      const availableNames = agents.map((a) => a.customName).join(', ');
      return {
        command: trimmed,
        output: `Agent "${targetAgentIdOrName}" not found. Available operatives: ${availableNames}`,
        status: 'error',
        timestamp,
      };
    }

    if (context.onDispatchTask) {
      await context.onDispatchTask(matchedAgent.id, taskPrompt);
    }

    return {
      command: trimmed,
      output: `[DIRECTIVE QUEUED] Dispatched task "${taskPrompt}" to operative ${matchedAgent.customName} [${matchedAgent.id}]. Tracking real-time telemetry...`,
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
        output: 'USAGE: pixelops approve <taskId>',
        status: 'warning',
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
      '╔════════════════════════════════════════════════════════════════════════════════╗',
      '║ PIXELOPS IMMUTABLE COMMAND TELEMETRY LEDGER (RECENT 10)                        ║',
      '╠════════════════════════════════════════════════════════════════════════════════╣',
      ...entries.map(
        (e, i) =>
          `[#${i + 1}] [${new Date(e.timestamp || Date.now()).toLocaleTimeString()}] ${e.command || 'UNKNOWN'}\n    ↳ ${e.output || 'Complete'}`
      ),
      '╚════════════════════════════════════════════════════════════════════════════════╝',
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
      const rows = allIds.map((id, i) => {
        const r = allRooms[id];
        return `[#${i + 1}] [${r.sectorCode}] ${r.shortBadge.padEnd(16)} · Wing: ${r.wingLabel} · Status: ONLINE`;
      });
      return {
        command: trimmed,
        output: [
          '╔════════════════════════════════════════════════════════════════════════════════╗',
          '║ PIXELOPS SAFEHOUSE SECTOR REGISTRY                                             ║',
          '╠════════════════════════════════════════════════════════════════════════════════╣',
          ...rows,
          '╚════════════════════════════════════════════════════════════════════════════════╝',
        ].join('\n'),
        status: 'ok',
        timestamp,
      };
    } catch (e) {
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
      const tmpl = ROOM_TEMPLATES.find((t) => t.id === templateId);
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
    } catch (e) {
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
      const rows = AVAILABLE_SKILLS.map((sk) => {
        const boundRooms = Object.entries(bindings)
          .filter(([_, skills]) => skills.includes(sk.id))
          .map(([r]) => r.toUpperCase());
        const boundStr = boundRooms.length > 0 ? boundRooms.join(', ') : 'NONE';
        return `◈ [${sk.shortCode}] ${sk.name}\n  ↳ Category: ${sk.category} · Bound to: [${boundStr}]\n  ↳ Tools: ${sk.providedTools.join(', ')}`;
      });
      return {
        command: trimmed,
        output: [
          '╔════════════════════════════════════════════════════════════════════════════════╗',
          '║ PIXELOPS MODULAR SKILLS & CAPABILITY PLUGINS                                   ║',
          '╠════════════════════════════════════════════════════════════════════════════════╣',
          ...rows,
          '╚════════════════════════════════════════════════════════════════════════════════╝',
        ].join('\n'),
        status: 'ok',
        timestamp,
      };
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
      return {
        command: trimmed,
        output: `Failed to read file: ${e?.message || e}`,
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
        return `🔌 ${pid.padEnd(16)} | ${isAuth ? '🟢 ACTIVE [AES-GCM]' : '⚪ NO KEY         '} | ${masked}`;
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

  // 13. HELP
  if (action === 'help') {
    const helpText = [
      'PIXELOPS TACTICAL HEADLESS CLI UTILITY v1.0',
      '--------------------------------------------------------------------------------',
      'Commands:',
      '  pixelops status | ls               List active operatives, rooms & assignments',
      '  pixelops dispatch <agent> <task>   Queue a tactical directive to an operative',
      '  pixelops approve <taskId>          Approve pending human-in-the-loop task briefs',
      '  pixelops files [category]          List IndexedDB workspace files (reports, logs, config)',
      '  pixelops cat <filePath>            Read content of an IndexedDB workspace file',
      '  pixelops plugins                   List BYOK capability plugins and auth tokens',
      '  pixelops plugin auth <id> <key>    Save BYOK API key/token for plugin locally',
      '  pixelops plugin revoke <id>        Revoke/clear local credentials for plugin',
      '  pixelops rooms                     List registered safehouse sectors',
      '  pixelops spawn <templateId>        Spawn sector (cyber_lab, quantum_vault, etc)',
      '  pixelops skills                    List available capability plugins & bindings',
      '  pixelops bind <room> <skill>       Mount a capability to a sector',
      '  pixelops logs                      Stream recent command telemetry records',
      '  pixelops clear                     Clear the terminal screen buffer',
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
