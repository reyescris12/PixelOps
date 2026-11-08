/**
 * Autonomous Multi-Agent Task Chaining & Workflow Orchestration Engine for PixelOps
 * Enables agents (Vance, Cipher, Nyx, and recruited operatives) to pass intelligence,
 * files, and action items seamlessly between each other without requiring manual user re-prompting.
 */

import type { RoomId } from '../components/SpriteCanvas';
import type { ThemeId } from '../context/ThemeContext';
import {
  executeAgentDirective,
  AgentExecutionCard,
  ExecutedToolCall,
} from './ApiService';
import {
  isReportDirective,
  shouldAutoGenerateReport,
  extractReportFilePath,
  formatOrganizedReportMarkdown,
  synthesizeComprehensiveReport,
  uploadReportToWorkspaceFiles,
} from './ReportService';
import { getAgentModelConfig } from './agentStore';
import { ModelGateway, ModelGatewayProvider } from './ModelGateway';
import { writeWorkspaceFile } from '../engine/storageManager';
import {
  appendCommandLedgerEntry,
  appendAgentMemoryEntry,
} from './CommandLedgerDb';

export interface TaskChainStep {
  id: string;
  stepIndex: number;
  assignedAgentId: string;
  assignedAgentName: string;
  assignedAgentRole: string;
  targetSector: RoomId;
  targetStationId?: string;
  directive: string;
  handoffReason?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  inputContext?: string;
  outputSummary?: string;
  outputPayload?: any;
  toolUsed?: string;
  cardId?: string;
}

export interface TaskChainArtifact {
  key: string;
  label: string;
  value: string;
  producerAgent: string;
  stepIndex: number;
  timestamp: string;
}

export interface TaskChain {
  id: string;
  title: string;
  originalPrompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  currentStepIndex: number;
  steps: TaskChainStep[];
  accumulatedContext: Record<string, any>;
  artifacts: TaskChainArtifact[];
  createdAt: string;
  completedAt?: string;
}

export interface TaskChainExecutionCallbacks {
  onStepStart?: (step: TaskChainStep, chain: TaskChain) => void;
  onStepProgress?: (step: TaskChainStep, progressText: string, chain: TaskChain) => void;
  onStepComplete?: (step: TaskChainStep, card: AgentExecutionCard, chain: TaskChain) => void;
  onStepHandoff?: (fromStep: TaskChainStep, toStep: TaskChainStep, handoffData: string, chain: TaskChain) => void;
  onChainComplete?: (chain: TaskChain, summaryCard: AgentExecutionCard) => void;
  onChainError?: (chain: TaskChain, error: Error, failingStep: TaskChainStep) => void;
  onFunctionCallTriggered?: (info: {
    toolName: string;
    args: Record<string, any>;
    targetRoom: RoomId;
    targetStationId: string;
    taskTag: string;
  }) => void;
}

const STORAGE_TASK_CHAINS_KEY = 'pixelops_task_chains_v1';

export function getStoredTaskChains(): TaskChain[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_TASK_CHAINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTaskChain(chain: TaskChain): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const existing = getStoredTaskChains();
    const filtered = existing.filter((c) => c.id !== chain.id);
    filtered.unshift(chain);
    // Retain up to 25 recent chains
    localStorage.setItem(STORAGE_TASK_CHAINS_KEY, JSON.stringify(filtered.slice(0, 25)));
  } catch {}
}

/**
 * Fast detection of whether a user directive represents a multi-step task chain
 * requiring inter-agent handoff.
 */
export function isDirectiveTaskChain(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim().toLowerCase();

  // Explicit chain keywords
  if (p.startsWith('chain:') || p.startsWith('workflow:') || p.startsWith('pipeline:')) {
    return true;
  }

  // Numbered step lists (e.g., 1. ... 2. ... or Step 1: ... Step 2:)
  const hasNumberedSteps =
    /(?:^|\s)(?:1\.|\[1\]|step\s*1:?)\s+.+?(?:2\.|\[2\]|step\s*2:?)\s+/is.test(p);
  if (hasNumberedSteps) return true;

  // Sequence connectives indicating handoff
  const hasSequenceConnectives =
    /\b(then\s+have|after\s+that\s+have|and\s+then\s+have|next\s+have|subsequently\s+have)\b/i.test(p) ||
    /\b(then|after\s+that|next|subsequently|followed\s+by)\b.*\b(have|pass|send|handoff|write|email|slack|post|save)\b/i.test(p);
  if (hasSequenceConnectives) return true;

  // Multiple known agent mentions linked with conjunctions
  const agentMatches = ['vance', 'cipher', 'nyx'].filter((name) => p.includes(name));
  if (agentMatches.length >= 2 && /\b(and|then|,|to|with)\b/i.test(p)) {
    return true;
  }

  // Multi-verb cross-domain pipelines (e.g. "research ... and save ... and email ...")
  const actionKeywords = ['research', 'search', 'scan', 'write', 'code', 'save', 'file', 'email', 'gmail', 'slack', 'ticket', 'issue'];
  let actionCount = 0;
  for (const kw of actionKeywords) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(p)) {
      actionCount++;
    }
  }

  return actionCount >= 3 && /\b(and|then|,)\b/i.test(p);
}

/**
 * Detects whether a prompt represents a high-level command suitable for Vance
 * (or the autonomous supervisor loop) to decompose into sequential sub-tasks.
 */
export function isHighLevelSupervisorObjective(
  prompt: string,
  activeAgentId?: string
): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim().toLowerCase();

  // If already recognized as explicit chain format
  if (isDirectiveTaskChain(prompt)) return true;

  // If addressed to Vance or Vance is the active operative
  const isVanceContext =
    p.startsWith('vance') ||
    p.includes('vance,') ||
    p.includes('vance:') ||
    p.includes('agent vance') ||
    Boolean(activeAgentId && activeAgentId.toLowerCase().includes('vance'));

  const hasOrchestrationIntent =
    /\b(coordinate|orchestrate|decompose|plan|route|delegate|multi-agent|workflow|pipeline|squad|team|all\s+agents)\b/i.test(p) ||
    /\b(investigate\s+and|audit\s+and|research\s+and|analyze\s+and|build\s+and|generate\s+and)\b/i.test(p);

  if (isVanceContext && hasOrchestrationIntent) return true;

  // Multi-domain tasks (reconnaissance + technical execution + communications/briefing)
  const hasRecon = /\b(search|research|investigate|scan|wiretap|fetch|crypto|price|weather|market|intel)\b/i.test(p);
  const hasTech = /\b(code|patch|script|fix|audit|file|save|report|generate|build|sandbox|encrypt)\b/i.test(p);
  const hasComms = /\b(notify|broadcast|email|slack|message|channel|linear|ticket|dossier|briefing|sitrep)\b/i.test(p);

  const matchedDomains = [hasRecon, hasTech, hasComms].filter(Boolean).length;
  if (matchedDomains >= 2 && /\b(and|then|,|after|to)\b/i.test(p)) {
    return true;
  }

  return false;
}

/**
 * Synchronizes the active task chain dossier and transcript to the Safehouse VFS
 * (`missions/active_mission.md`, `missions/chain_[id].md`, and `missions/latest_handoff.json`).
 */
export async function saveMissionDossierToVfs(chain: TaskChain): Promise<void> {
  try {
    let transcript = `# Safehouse Mission Dossier: ${chain.title}\n`;
    transcript += `**Mission ID:** \`${chain.id}\`  \n`;
    transcript += `**Status:** \`${chain.status.toUpperCase()}\`  \n`;
    transcript += `**Original Command:** "${chain.originalPrompt}"  \n`;
    transcript += `**Created At:** ${chain.createdAt}  \n`;
    transcript += `**Current Phase:** ${chain.currentStepIndex + 1} of ${chain.steps.length}  \n\n`;
    transcript += `---\n\n## Sequential Operative Phases\n\n`;

    chain.steps.forEach((s, idx) => {
      transcript += `### Phase ${idx + 1}: ${s.assignedAgentName} (${s.assignedAgentRole})\n`;
      transcript += `- **Target Sector:** \`${s.targetSector.toUpperCase()}\`\n`;
      transcript += `- **Status:** \`${s.status.toUpperCase()}\`\n`;
      transcript += `- **Directive:** "${s.directive}"\n`;
      if (s.toolUsed) transcript += `- **Tool Dispatched:** \`${s.toolUsed}\`\n`;
      if (s.outputSummary) transcript += `- **Output Summary:** ${s.outputSummary}\n`;
      if (s.outputPayload) {
        transcript += `- **Captured Payload:**\n\`\`\`json\n${JSON.stringify(s.outputPayload, null, 2).slice(0, 800)}\n\`\`\`\n`;
      }
      if (s.handoffReason) transcript += `- **Handoff Intent:** ${s.handoffReason}\n`;
      transcript += `\n`;
    });

    if (chain.artifacts.length > 0) {
      transcript += `## Shared Mission Artifacts\n\n`;
      chain.artifacts.forEach((art) => {
        transcript += `- **[${art.label}]** (\`${art.producerAgent}\` @ Phase ${art.stepIndex + 1}): \`${art.value}\`\n`;
      });
      transcript += `\n`;
    }

    transcript += `\n*Automated Multi-Agent VFS State Synchronization · PixelOps Autonomous Supervisor Loop*`;

    // Write to VFS
    await writeWorkspaceFile(`missions/chain_${chain.id}.md`, transcript, 'markdown', 'reports');
    await writeWorkspaceFile(`missions/active_mission.md`, transcript, 'markdown', 'reports');

    // Also write structured machine-readable handoff context
    const jsonContext = {
      chainId: chain.id,
      title: chain.title,
      status: chain.status,
      currentStepIndex: chain.currentStepIndex,
      accumulatedContext: chain.accumulatedContext,
      artifacts: chain.artifacts,
      lastUpdated: new Date().toISOString(),
    };
    await writeWorkspaceFile(
      `missions/latest_handoff.json`,
      JSON.stringify(jsonContext, null, 2),
      'json',
      'logs'
    );
  } catch (err) {
    console.warn('[TaskChainService] Failed to sync mission dossier to VFS:', err);
  }
}

/**
 * Resolves the best-fit agent and sector for a sub-directive
 */
function resolveAgentForStep(
  text: string,
  stepIndex: number,
  availableAgents: Array<{ id: string; name: string; role: string; functionalRole?: string }>
): { agentId: string; agentName: string; agentRole: string; sector: RoomId; stationId?: string } {
  const lower = text.toLowerCase();

  // 1. Explicit name mentions
  const foundAgent = availableAgents.find(
    (a) =>
      lower.includes(a.name.toLowerCase()) ||
      lower.includes(a.id.toLowerCase())
  );

  if (foundAgent) {
    const idLower = foundAgent.id.toLowerCase();
    const nameLower = foundAgent.name.toLowerCase();
    let sector: RoomId = 'war_room';
    let stationId: string | undefined;

    if (idLower.includes('cipher') || nameLower.includes('cipher')) {
      sector = lower.includes('file') || lower.includes('storage') ? 'library' : 'server_vault';
      stationId = sector === 'server_vault' ? 'vault_core_rack' : 'library_archive_terminal';
    } else if (idLower.includes('nyx') || nameLower.includes('nyx')) {
      sector = 'comms_tower';
      stationId = 'comms_broadcast_desk';
    } else if (idLower.includes('vance') || nameLower.includes('vance')) {
      sector = 'war_room';
      stationId = 'war_center_desk';
    }

    return {
      agentId: foundAgent.id,
      agentName: foundAgent.name,
      agentRole: foundAgent.role,
      sector,
      stationId,
    };
  }

  // 2. Functional capability heuristics
  if (
    lower.includes('code') ||
    lower.includes('patch') ||
    lower.includes('script') ||
    lower.includes('file') ||
    lower.includes('storage') ||
    lower.includes('report') ||
    lower.includes('brief') ||
    lower.includes('summary') ||
    lower.includes('audit') ||
    lower.includes('doc') ||
    lower.includes('github') ||
    lower.includes('issue') ||
    lower.includes('bug') ||
    lower.includes('debug') ||
    lower.includes('eval')
  ) {
    const coder =
      availableAgents.find((a) => a.id.toLowerCase().includes('cipher')) ||
      availableAgents.find((a) => a.functionalRole === 'coder') ||
      availableAgents[2] ||
      availableAgents[0];
    const sector: RoomId = lower.includes('file') ? 'library' : 'server_vault';
    return {
      agentId: coder.id,
      agentName: coder.name,
      agentRole: coder.role,
      sector,
      stationId: sector === 'server_vault' ? 'vault_core_rack' : 'library_archive_terminal',
    };
  }

  if (
    lower.includes('email') ||
    lower.includes('gmail') ||
    lower.includes('slack') ||
    lower.includes('broadcast') ||
    lower.includes('notify') ||
    lower.includes('message') ||
    lower.includes('discord') ||
    lower.includes('linear') ||
    lower.includes('comms')
  ) {
    const comms =
      availableAgents.find((a) => a.id.toLowerCase().includes('nyx')) ||
      availableAgents.find((a) => a.functionalRole === 'researcher') ||
      availableAgents[1] ||
      availableAgents[0];
    return {
      agentId: comms.id,
      agentName: comms.name,
      agentRole: comms.role,
      sector: 'comms_tower',
      stationId: 'comms_broadcast_desk',
    };
  }

  // 3. Fallback: cycle naturally across core triumvirate
  const fallbackAgent = availableAgents[stepIndex % availableAgents.length] || availableAgents[0];
  const sector: RoomId =
    stepIndex % 3 === 0 ? 'war_room' : stepIndex % 3 === 1 ? 'server_vault' : 'comms_tower';

  return {
    agentId: fallbackAgent.id,
    agentName: fallbackAgent.name,
    agentRole: fallbackAgent.role,
    sector,
  };
}

/**
 * Deconstructs a complex prompt into distinct, sequential task chain steps
 */
export function deconstructDirectiveIntoChain(
  prompt: string,
  availableAgents: Array<{ id: string; name: string; role: string; functionalRole?: string }>
): TaskChain | null {
  if (!isDirectiveTaskChain(prompt)) return null;

  const rawClean = prompt
    .replace(/^(?:chain|workflow|pipeline):\s*/i, '')
    .trim();

  let rawSegments: string[] = [];

  // Check 1: Numbered lines or lists (e.g. 1. ... 2. ... or Step 1: ... Step 2: ...)
  if (/(?:^|\n|\s)(?:1\.|\[1\]|step\s*1:?)/i.test(rawClean)) {
    rawSegments = rawClean
      .split(/(?:^|\n|\s)(?:\d+\.|\[\d+\]|step\s*\d+:?)\s+/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Check 2: Sequence markers ("then", "after that", "and then", "next")
  if (rawSegments.length < 2) {
    rawSegments = rawClean
      .split(/\b(?:and\s+then\s+have|after\s+that\s+have|then\s+have|next\s+have|subsequently\s+have|and\s+then|after\s+that|then|next|afterward|afterwards)\b/i)
      .map((s) => s.trim().replace(/^[,;\s]+|[,;\s]+$/g, ''))
      .filter((s) => s.length > 4);
  }

  // Check 3: Multi-agent coordination format ("Vance ... Cipher ... Nyx ...")
  if (rawSegments.length < 2) {
    rawSegments = rawClean
      .split(/\b(?=have\s+(?:vance|cipher|nyx)|\b(?:vance|cipher|nyx)\s*[,:]|\b(?:and\s+have|also\s+have)\b)/i)
      .map((s) => s.trim().replace(/^[,;\s]+|[,;\s]+$/g, ''))
      .filter((s) => s.length > 4);
  }

  // If still fewer than 2 segments, fallback to compound conjunctions
  if (rawSegments.length < 2) {
    rawSegments = rawClean
      .split(/\s*;\s*|\s*,\s*(?:and\s+)?(?=have|write|send|email|post|save|check|research)\b/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);
  }

  if (rawSegments.length < 2) {
    return null;
  }

  // Cap chain to 5 steps maximum for safety and token conservation
  const cappedSegments = rawSegments.slice(0, 5);
  const chainId = `chain_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const titleWords = rawClean.split(/\s+/).slice(0, 6).join(' ');
  const title = `Operation: ${titleWords.replace(/[^a-zA-Z0-9\s]/g, '')}...`;

  const steps: TaskChainStep[] = cappedSegments.map((segment, idx) => {
    const assigned = resolveAgentForStep(segment, idx, availableAgents);
    const cleanDirective = segment
      .replace(/^(?:(?:and\s+then|then|after\s+that|next|finally|subsequently|first|second|third)\s+)?(?:have\s+\w+\s+|let\s+\w+\s+|\w+[,:]\s*)/i, '')
      .replace(/^(?:(?:and\s+then|then|after\s+that|next|finally|subsequently)\s+)/i, '')
      .trim();

    return {
      id: `${chainId}_step_${idx + 1}`,
      stepIndex: idx,
      assignedAgentId: assigned.agentId,
      assignedAgentName: assigned.agentName,
      assignedAgentRole: assigned.agentRole,
      targetSector: assigned.sector,
      targetStationId: assigned.stationId,
      directive: cleanDirective.length > 0 ? cleanDirective : segment,
      handoffReason:
        idx < cappedSegments.length - 1
          ? `Transfers intermediate intelligence to Step ${idx + 2}`
          : 'Finalizes mission execution and ledger logging',
      status: 'pending',
    };
  });

  return {
    id: chainId,
    title,
    originalPrompt: prompt,
    status: 'pending',
    currentStepIndex: 0,
    steps,
    accumulatedContext: {},
    artifacts: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Autonomous Supervisor (Agent Vance) Objective Decomposition Engine
 * Uses Vance's configured LLM provider and model to parse high-level commands
 * into sequential, specialized operative sub-tasks with automatic heuristic fallback.
 */
export async function decomposeObjectiveWithSupervisor(
  prompt: string,
  availableAgents: Array<{ id: string; name: string; role: string; functionalRole?: string }>,
  supervisorAgentId: string = 'vance'
): Promise<TaskChain> {
  const supervisorCfg = getAgentModelConfig(supervisorAgentId);
  const provider = supervisorCfg.provider as ModelGatewayProvider;
  const model = supervisorCfg.model;
  const apiKey = ModelGateway.resolveApiKey(provider);

  // 1. Try LLM Supervisor Decomposition if API key is present
  if (apiKey) {
    try {
      const systemPrompt = `You are Agent Vance, Chief of Operations and Lead Task Router at the PixelOps safehouse.
Your responsibility is to act as an autonomous task router.
Decompose the following user high-level command into 2 to 4 sequential, specialized sub-tasks for our safehouse operative team.

Operative Roster:
- nyx: Cyber & Signal Specialist (Sector: comms_tower or library). Handles: live web searches, financial/crypto APIs, signals intel, wiretaps, notifications.
- cipher: Cryptographic Recon & Systems Engineer (Sector: server_vault or library). Handles: code sandbox execution, script patching, security auditing, safehouse files, report synthesis.
- vance: Lead Strategist & Chief of Operations (Sector: war_room). Handles: strategy formulation, executive synthesis, command dossiers, final review.

Output format rule:
Return ONLY a valid JSON array of objects. Do not include markdown code block backticks, explanatory text, or conversational preambles.
[
  {
    "assignedAgentId": "nyx" | "cipher" | "vance",
    "targetSector": "comms_tower" | "server_vault" | "war_room" | "library",
    "directive": "Clear, standalone actionable directive for this operative",
    "handoffReason": "Why this output is required by the next operative"
  }
]`;

      const responseText = await ModelGateway.executePrompt(
        provider,
        model,
        apiKey,
        systemPrompt,
        [{ role: 'user', content: prompt }]
      );

      // Clean response to extract JSON array
      const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        const rawSteps = JSON.parse(jsonMatch[0]);
        if (Array.isArray(rawSteps) && rawSteps.length >= 2) {
          const chainId = `chain_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const titleWords = prompt.split(/\s+/).slice(0, 6).join(' ');
          const title = `Operation: ${titleWords.replace(/[^a-zA-Z0-9\s]/g, '')}...`;

          const steps: TaskChainStep[] = rawSteps.slice(0, 5).map((stepObj, idx) => {
            const rawId = String(stepObj.assignedAgentId || '').toLowerCase();
            const matchedAgent =
              availableAgents.find(
                (a) =>
                  a.id.toLowerCase().includes(rawId) ||
                  a.name.toLowerCase().includes(rawId)
              ) || availableAgents[idx % availableAgents.length];

            let sector: RoomId = 'war_room';
            if (
              stepObj.targetSector &&
              ['war_room', 'server_vault', 'comms_tower', 'library', 'armory', 'lounge'].includes(
                stepObj.targetSector
              )
            ) {
              sector = stepObj.targetSector as RoomId;
            } else {
              sector = matchedAgent.id.includes('nyx')
                ? 'comms_tower'
                : matchedAgent.id.includes('cipher')
                ? 'server_vault'
                : 'war_room';
            }

            return {
              id: `${chainId}_step_${idx + 1}`,
              stepIndex: idx,
              assignedAgentId: matchedAgent.id,
              assignedAgentName: matchedAgent.name,
              assignedAgentRole: matchedAgent.role,
              targetSector: sector,
              directive: String(stepObj.directive || prompt).trim(),
              handoffReason:
                stepObj.handoffReason ||
                (idx < rawSteps.length - 1
                  ? `Transfers intermediate intelligence to Phase ${idx + 2}`
                  : 'Finalizes mission execution and ledger logging'),
              status: 'pending',
            };
          });

          const chain: TaskChain = {
            id: chainId,
            title,
            originalPrompt: prompt,
            status: 'pending',
            currentStepIndex: 0,
            steps,
            accumulatedContext: {},
            artifacts: [],
            createdAt: new Date().toISOString(),
          };

          saveTaskChain(chain);
          await saveMissionDossierToVfs(chain);
          return chain;
        }
      }
    } catch (llmErr) {
      console.warn('[TaskChainService] Supervisor LLM decomposition fallback to heuristic:', llmErr);
    }
  }

  // 2. Heuristic Supervisor Decomposition Fallback
  const heuristicChain = deconstructDirectiveIntoChain(prompt, availableAgents);
  if (heuristicChain && heuristicChain.steps.length >= 2) {
    saveTaskChain(heuristicChain);
    await saveMissionDossierToVfs(heuristicChain);
    return heuristicChain;
  }

  // If prompt was a single high-level objective, decompose into standard 3-phase operative workflow
  const chainId = `chain_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const titleWords = prompt.split(/\s+/).slice(0, 6).join(' ');
  const title = `Operation: ${titleWords.replace(/[^a-zA-Z0-9\s]/g, '')}...`;

  const nyxAgent = availableAgents.find((a) => a.id.includes('nyx')) || availableAgents[1] || availableAgents[0];
  const cipherAgent = availableAgents.find((a) => a.id.includes('cipher')) || availableAgents[2] || availableAgents[0];
  const vanceAgent = availableAgents.find((a) => a.id.includes('vance')) || availableAgents[0];

  const cleanPrompt = prompt.replace(/^(?:vance[,:]?\s*)/i, '').trim();

  const steps: TaskChainStep[] = [
    {
      id: `${chainId}_step_1`,
      stepIndex: 0,
      assignedAgentId: nyxAgent.id,
      assignedAgentName: nyxAgent.name,
      assignedAgentRole: nyxAgent.role,
      targetSector: 'comms_tower',
      directive: `Conduct live intelligence reconnaissance and gather telemetry for: "${cleanPrompt}". Retrieve all verified market data, wiretaps, and real-time signals.`,
      handoffReason: 'Transfers gathered intelligence to Cipher for engineering and code analysis',
      status: 'pending',
    },
    {
      id: `${chainId}_step_2`,
      stepIndex: 1,
      assignedAgentId: cipherAgent.id,
      assignedAgentName: cipherAgent.name,
      assignedAgentRole: cipherAgent.role,
      targetSector: 'server_vault',
      directive: `Execute technical processing, cryptographic validation, and file generation for: "${cleanPrompt}". Persist verified data to safehouse workspace files.`,
      handoffReason: 'Transfers technical validation and file artifacts to Vance for executive briefing',
      status: 'pending',
    },
    {
      id: `${chainId}_step_3`,
      stepIndex: 2,
      assignedAgentId: vanceAgent.id,
      assignedAgentName: vanceAgent.name,
      assignedAgentRole: vanceAgent.role,
      targetSector: 'war_room',
      directive: `Synthesize the overarching Executive Command Briefing for: "${cleanPrompt}". Audit preceding findings and finalize the safehouse mission dossier.`,
      handoffReason: 'Finalizes multi-agent mission workflow and synchronizes command ledger',
      status: 'pending',
    },
  ];

  const chain: TaskChain = {
    id: chainId,
    title,
    originalPrompt: prompt,
    status: 'pending',
    currentStepIndex: 0,
    steps,
    accumulatedContext: {},
    artifacts: [],
    createdAt: new Date().toISOString(),
  };

  saveTaskChain(chain);
  await saveMissionDossierToVfs(chain);
  return chain;
}

/**
 * Builds the enriched instruction for a task chain step, seamlessly injecting
 * findings, artifacts, and context produced by preceding operatives.
 */
export function buildStepEnrichedPrompt(
  currentStep: TaskChainStep,
  chain: TaskChain
): string {
  if (currentStep.stepIndex === 0) {
    return currentStep.directive;
  }

  const prevSteps = chain.steps.slice(0, currentStep.stepIndex);
  const previousFindings = prevSteps
    .map(
      (s) =>
        `• [PHASE ${s.stepIndex + 1} COMPLETE - ${s.assignedAgentName.toUpperCase()} (${s.assignedAgentRole}) @ ${s.targetSector.toUpperCase()}]:
  Directive: "${s.directive}"
  Output Summary: ${s.outputSummary || 'Completed successfully'}
  ${s.toolUsed ? `Tool Dispatched: ${s.toolUsed}` : ''}
  ${s.outputPayload ? `Captured Live Payload: ${JSON.stringify(s.outputPayload).slice(0, 1000)}` : ''}`
    )
    .join('\n\n');

  const artifactsSummary =
    chain.artifacts.length > 0
      ? `\n\nShared Safehouse VFS Artifacts:\n` +
        chain.artifacts
          .map((a) => `• [${a.label}] (${a.producerAgent}): ${a.value}`)
          .join('\n')
      : '';

  const isReportStep = isReportDirective(currentStep.directive);
  const reportMandate = isReportStep
    ? `\n\nOPERATIONAL REPORT MANDATE:\nYou must compile and commit this comprehensive report to safehouse workspace files (reports/). Integrate all preceding intelligence findings, architecture principles, and verification matrices.`
    : '';

  return `${currentStep.directive}

================================================================================
[AUTONOMOUS MULTI-AGENT CHAIN HANDOFF - PHASE ${currentStep.stepIndex + 1} OF ${chain.steps.length}]
Mission Dossier VFS Record: missions/chain_${chain.id}.md
Preceding operatives have autonomously executed their designated phases and committed the following intelligence into the shared mission context:

${previousFindings}${artifactsSummary}

OPERATIONAL HANDOFF DIRECTIVE:
Execute your phase immediately using the verified intelligence and tool payloads above. Do not ask the user for confirmation or repeat prior steps—build directly upon their findings.${reportMandate}
================================================================================`;
}

/**
 * Extracts intermediate artifacts (e.g. file paths, URLs, emails, issue keys) from step results
 */
function extractArtifactsFromCard(
  card: AgentExecutionCard,
  step: TaskChainStep
): TaskChainArtifact[] {
  const artifacts: TaskChainArtifact[] = [];
  const text = `${card.dialogue} ${JSON.stringify(card.toolCalls || [])}`;

  // 1. Files created or modified
  const fileMatch = text.match(/([\w\-_\/.]+\.(?:md|json|txt|ts|js|html|csv))/i);
  if (fileMatch) {
    artifacts.push({
      key: `file_${step.stepIndex}`,
      label: 'Generated File',
      value: fileMatch[1],
      producerAgent: step.assignedAgentName,
      stepIndex: step.stepIndex,
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Extracted URLs or research citations
  const urlMatch = text.match(/(https?:\/\/[^\s"'<>]+)/i);
  if (urlMatch) {
    artifacts.push({
      key: `source_url_${step.stepIndex}`,
      label: 'Intel Source URL',
      value: urlMatch[1],
      producerAgent: step.assignedAgentName,
      stepIndex: step.stepIndex,
      timestamp: new Date().toISOString(),
    });
  }

  // 3. GitHub Issue or Ticket References
  const issueMatch = text.match(/#\d+|[A-Z]+-\d+/);
  if (issueMatch) {
    artifacts.push({
      key: `ticket_${step.stepIndex}`,
      label: 'Ticket Reference',
      value: issueMatch[0],
      producerAgent: step.assignedAgentName,
      stepIndex: step.stepIndex,
      timestamp: new Date().toISOString(),
    });
  }

  return artifacts;
}

/**
 * Autonomous Task Chain Execution Engine
 * Sequentially executes each step, moves operatives across sectors,
 * passes context seamlessly forward, and handles dynamic delegations.
 */
export async function executeTaskChain(
  chain: TaskChain,
  callbacks: TaskChainExecutionCallbacks,
  themeId: ThemeId = 'green',
  enabledPlugins: string[] = []
): Promise<TaskChain> {
  chain.status = 'running';
  saveTaskChain(chain);

  const stepExecutionCards: AgentExecutionCard[] = [];

  for (let i = 0; i < chain.steps.length; i++) {
    const currentStep = chain.steps[i];
    chain.currentStepIndex = i;
    currentStep.status = 'running';
    currentStep.startedAt = new Date().toISOString();

    callbacks.onStepStart?.(currentStep, chain);
    callbacks.onStepProgress?.(
      currentStep,
      `[STEP ${i + 1}/${chain.steps.length}] ${currentStep.assignedAgentName} deployed to ${currentStep.targetSector}...`,
      chain
    );

    // Build enriched prompt incorporating preceding agents' findings
    const enrichedPrompt = buildStepEnrichedPrompt(currentStep, chain);
    currentStep.inputContext = enrichedPrompt;

    try {
      // Execute the operative's directive with their customized model & provider
      const agentModelCfg = getAgentModelConfig(currentStep.assignedAgentId);
      const card = await executeAgentDirective({
        prompt: enrichedPrompt,
        themeId,
        activeAgentName: currentStep.assignedAgentName,
        activeAgentRole: currentStep.assignedAgentRole,
        enabledPlugins,
        temperature: 0.5,
        agentProvider: agentModelCfg.provider,
        agentModel: agentModelCfg.model,
        onFunctionCallTriggered: (info) => {
          callbacks.onFunctionCallTriggered?.(info);
          callbacks.onStepProgress?.(
            currentStep,
            `[TOOL DISPATCH: ${info.toolName.toUpperCase()}] ${currentStep.assignedAgentName} executing live tool at ${info.targetRoom}...`,
            chain
          );
        },
      });

      // Update step with output data
      currentStep.status = 'completed';
      currentStep.completedAt = new Date().toISOString();
      currentStep.outputSummary = card.dialogue;
      currentStep.cardId = card.id;

      if (card.toolCalls && card.toolCalls.length > 0) {
        currentStep.toolUsed = card.toolCalls.map((tc) => tc.toolName).join(', ');
        currentStep.outputPayload = card.toolCalls[0].livePayload;
      }

      // If this step is a report or intel directive, guarantee that an organized workspace file is persisted
      if (
        shouldAutoGenerateReport({
          prompt: currentStep.directive,
          dialogue: card.dialogue,
          toolCalls: card.toolCalls,
        })
      ) {
        const accumulatedNotes = Object.values(chain.accumulatedContext)
          .map((c: any) => c.summary)
          .join('\n\n');
        const targetPath = extractReportFilePath(
          currentStep.directive,
          'tactical_intel',
          `${card.dialogue}\n${accumulatedNotes}`,
          card.toolCalls
        );
        // Check if card dialogue already has file or if we need to synthesize one
        const existingFileArtifact = chain.artifacts.find(
          (a) => a.key === `file_${currentStep.stepIndex}` || a.value === targetPath
        );
        if (!existingFileArtifact && !card.dialogue.includes('[WORKSPACE REPORT UPLOADED]')) {
          try {
            const organized = formatOrganizedReportMarkdown({
              prompt: currentStep.directive,
              agentName: currentStep.assignedAgentName,
              agentRole: currentStep.assignedAgentRole,
              existingDialogue: card.dialogue,
              precedingIntelligence: accumulatedNotes,
              explicitFilePath: targetPath,
              targetSector: currentStep.targetSector,
              toolCalls: card.toolCalls,
            });
            const savedRec = await uploadReportToWorkspaceFiles({
              path: organized.filePath,
              content: organized.markdown,
              agentName: currentStep.assignedAgentName,
              agentRole: currentStep.assignedAgentRole,
            });
            chain.artifacts.push({
              key: `workspace_file_${currentStep.stepIndex}`,
              label: 'Workspace Report File',
              value: savedRec.path,
              producerAgent: currentStep.assignedAgentName,
              stepIndex: currentStep.stepIndex,
              timestamp: new Date().toISOString(),
            });
          } catch (fileErr) {
            console.warn('[TaskChainService] Auto-persist report error:', fileErr);
          }
        }
      }

      // Extract and accumulate shared artifacts
      const newArtifacts = extractArtifactsFromCard(card, currentStep);
      if (newArtifacts.length > 0) {
        chain.artifacts.push(...newArtifacts);
      }

      chain.accumulatedContext[`step_${i + 1}_${currentStep.assignedAgentName.toLowerCase()}`] = {
        prompt: currentStep.directive,
        summary: card.dialogue,
        toolUsed: currentStep.toolUsed,
      };

      stepExecutionCards.push(card);
      callbacks.onStepComplete?.(currentStep, card, chain);
      saveTaskChain(chain);
      await saveMissionDossierToVfs(chain);

      // Commit intermediate handoff execution to Command Ledger and Agent Memory
      await appendCommandLedgerEntry({
        timestamp: new Date().toISOString(),
        command_input: `[CHAIN PHASE ${i + 1}/${chain.steps.length}] ${currentStep.directive}`,
        involved_agent: currentStep.assignedAgentName,
        tool_used: currentStep.toolUsed || 'autonomous_operative_execution',
        result_summary: `Phase ${i + 1} (${currentStep.targetSector.toUpperCase()}): ${currentStep.outputSummary?.slice(0, 100)}`,
        success_boost_achieved: 100,
      });

      await appendAgentMemoryEntry({
        agentId: currentStep.assignedAgentId,
        prompt: currentStep.directive,
        summary: currentStep.outputSummary || 'Completed phase',
        reflection: `Autonomously executed Phase ${i + 1} of ${chain.title} at ${currentStep.targetSector}`,
      });

      // Perform seamless handoff pause if there is a subsequent step
      if (i < chain.steps.length - 1) {
        const nextStep = chain.steps[i + 1];
        const handoffNotice = `${currentStep.assignedAgentName} (${currentStep.targetSector}) completed phase. Passing intelligence to ${nextStep.assignedAgentName} (${nextStep.targetSector})...`;
        callbacks.onStepHandoff?.(currentStep, nextStep, handoffNotice, chain);

        // Record inter-agent handoff memory for receiving operative
        await appendAgentMemoryEntry({
          agentId: nextStep.assignedAgentId,
          prompt: `[HANDOFF FROM ${currentStep.assignedAgentName.toUpperCase()}] Received intelligence: ${currentStep.outputSummary?.slice(0, 120)}`,
          summary: nextStep.directive,
          reflection: `Autonomous task handoff received from ${currentStep.assignedAgentName} (${currentStep.targetSector})`,
        });

        // Natural pause for camera transition and operative movement
        await new Promise((resolve) => setTimeout(resolve, 1400));
      }
    } catch (err: any) {
      currentStep.status = 'failed';
      currentStep.outputSummary = `Execution fault: ${err?.message || err}`;
      chain.status = 'failed';
      saveTaskChain(chain);
      await saveMissionDossierToVfs(chain);
      callbacks.onChainError?.(chain, err, currentStep);
      throw err;
    }
  }

  // All steps completed successfully
  chain.status = 'completed';
  chain.completedAt = new Date().toISOString();
  saveTaskChain(chain);
  await saveMissionDossierToVfs(chain);

  // Synthesize overarching Multi-Agent Mission Dossier Card
  const summarySteps = chain.steps.map((s, idx) => ({
    label: `Phase ${idx + 1}: ${s.assignedAgentName}`,
    detail: `${s.directive} -> ${s.toolUsed ? `[${s.toolUsed}] ` : ''}Verified`,
    status: 'completed' as const,
  }));

  const generatedFiles = chain.artifacts.filter((a) => a.label.includes('File') || a.label.includes('Report') || a.key.includes('file'));
  const filesSection = generatedFiles.length > 0
    ? `\n\n📁 **Generated Workspace Reports & Files (Committed to IndexedDB):**\n` +
      generatedFiles.map((f) => `• \`${f.value}\` (Authored by ${f.producerAgent} · Ready in Files drawer or via \`pixelops cat ${f.value}\`)`).join('\n')
    : '';

  const compositeDialogue = `[MISSION WORKFLOW COMPLETE] All ${chain.steps.length} autonomous phases executed successfully across safehouse sectors:${filesSection}\n\n${chain.steps
    .map(
      (s, idx) =>
        `**Phase ${idx + 1} (${s.assignedAgentName} · ${s.targetSector.toUpperCase()}):**\n${s.outputSummary}`
    )
    .join('\n\n')}\n\nMulti-agent workflow telemetry synchronized to local mission ledger.`;

  const summaryCard: AgentExecutionCard = {
    id: `card-chain-${Date.now()}`,
    prompt: chain.originalPrompt,
    dialogue: compositeDialogue,
    cardTitle: `AUTONOMOUS TASK CHAIN COMPLETE [${chain.steps.length} PHASES]`,
    actionCategory: 'Multi-Agent Workflow',
    steps: summarySteps,
    toolCalls: stepExecutionCards.flatMap((c) => c.toolCalls || []),
    tokenEstimate: stepExecutionCards.reduce((acc, c) => acc + (c.tokenEstimate || 80), 0),
    agentName: `${chain.steps.map((s) => s.assignedAgentName).join(' ➔ ')}`,
    themeId,
    timestamp: new Date().toISOString(),
  };

  callbacks.onChainComplete?.(chain, summaryCard);
  return chain;
}
