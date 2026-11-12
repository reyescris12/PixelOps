/**
 * PixelOps 3-Pillar Room-Scoped Action Deck: Playbook Definitions & Execution Pipelines
 * (intelligencePlaybooks.ts)
 * 
 * Unifies:
 * - Pillar 1: Pocket Recon & Watchtower (COMMS TOWER & BASEMENT)
 *   1. [📡 WIRE-TAP: WEBSITE / PRICE WATCH] (Agent Nyx)
 *   2. [🔍 DEEP RECON: ENTITY / TOPIC DOSSIER] (Agent Nyx)
 *   3. [🌅 MORNING INTEL BRIEFING] (Agent Vance)
 * 
 * - Pillar 2: 1-Click Cross-App Operator (WAR ROOM & SERVER VAULT)
 *   1. [⚡ TRIAGE UNREAD GMAIL TO TASKS] (Agent Vance)
 *   2. [📅 PREP TODAY'S CALENDAR BRIEF] (Agent Vance)
 *   3. [🐛 SYNC GITHUB ISSUES / REPO PULSE] (Agent Cipher)
 * 
 * 100% User-Agnostic: Targets are supplied dynamically by the user and scoped strictly
 * to their connected accounts via Composio and stored in local VFS (IndexedDB).
 */

import { RoomId } from './roomData';
import { executeComposioAction } from '../services/ComposioService';
import {
  NightShiftTaskSchedule,
  ScheduleFrequency,
  loadNightShiftSchedules,
  saveNightShiftSchedules,
} from '../services/NightShiftService';

/**
 * Extracts a concise, clean entity or domain keyword string for search queries,
 * eliminating URL syntax, boilerplate words, and query pollution.
 */
export function extractCleanSearchQueryForTarget(
  targetName: string,
  targetScope?: string
): { primary: string; scopeSnippet: string } {
  let name = String(targetName || '').trim();
  const scope = String(targetScope || '').trim();

  // 1. If targetName is a URL: extract domain and relevant path segment
  const urlMatch = name.match(/https?:\/\/([^\s\/$.?#].[^\s]*)/i);
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[0]);
      const host = u.hostname.replace(/^www\./i, '');
      const brand = host.split('.')[0];
      const pathPart = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[-_/]/g, ' ');
      name = `${brand} ${pathPart}`.trim();
    } catch {}
  } else {
    name = name.replace(/\.(com|org|io|dev|app|ai|so|co|net)\b/gi, ' ');
  }

  // 2. Clean out punctuation and symbols
  name = name.replace(/[^a-zA-Z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim();

  // 3. Detect intent from target name and scope
  const combined = `${name} ${scope}`.toLowerCase();
  const isPricingOrMarket = /\b(price|pricing|cost|costs|rate|rates|fee|fees|tier|tiers|subscription|market|ticker|crypto|token|coin|btc|eth|sol)\b/i.test(combined);
  const isChangelogOrRelease = /\b(release|releases|changelog|version|patch|update|updates|cve|vulnerability)\b/i.test(combined);

  let query = name;
  if (isPricingOrMarket) {
    if (!/\b(price|pricing|cost)\b/i.test(query)) {
      query = `${query} pricing`;
    }
  } else if (isChangelogOrRelease) {
    if (!/\b(release|changelog|update)\b/i.test(query)) {
      query = `${query} updates`;
    }
  }

  return {
    primary: query.trim() || 'Technology Analysis',
    scopeSnippet: scope.slice(0, 50),
  };
}

export type PlaybookId =
  | 'wiretap_watch'
  | 'deep_recon'
  | 'morning_briefing'
  | 'triage_gmail'
  | 'calendar_brief'
  | 'quick_schedule_briefing'
  | 'sync_github'
  // Backward compatibility aliases
  | 'competitor_radar'
  | 'tech_audit';

export interface PlaybookStage {
  id: string;
  label: string;
  description: string;
}

export interface UserPlaybookTarget {
  targetName: string;
  targetScope: string;
  category?: string;
  presetId?: string;
  recipientEmail?: string;
  watchCondition?: string;
}

export interface IntelligencePlaybookDef {
  id: PlaybookId;
  pillar: 1 | 2;
  title: string;
  shortTitle: string;
  icon: string;
  assignedRoom: RoomId;
  assignedStationId: string;
  roomBadge: string;
  roomName: string;
  assignedOperativeId: string;
  assignedOperativeName: string;
  assignedOperativeRole: string;
  description: string;
  targetFilePattern: string;
  defaultPromptQuestion: string;
  targetPlaceholder: string;
  scopePlaceholder: string;
  stages: PlaybookStage[];
  requiredApp?: 'gmail' | 'googlecalendar' | 'github';
  supportsNightShift?: boolean;
  supportsActionDispatch?: boolean;
  actionDispatchLabel?: string;
}

export interface PlaybookExecutionResult {
  playbookId: PlaybookId;
  title: string;
  targetName: string;
  targetScope: string;
  assignedOperativeName: string;
  assignedRoom: RoomId;
  targetPath: string;
  dossierContent: string;
  threatLevel?: 'ALPHA-CRITICAL' | 'BRAVO-ELEVATED' | 'CHARLIE-NOMINAL';
  stagesCompleted: Array<{ stage: string; detail: string; status: 'completed' | 'verified' }>;
  executedAt: string;
  emailDispatched?: boolean;
  appConnectionInitiated?: boolean;
  scheduledNightShift?: boolean;
}

import {
  StrategyBoardTask,
  STORAGE_STRATEGY_TASKS_KEY,
  loadStrategyBoardTasks,
  saveStrategyBoardTasks,
  addStrategyBoardTasks,
  updateStrategyBoardTaskStatus,
} from '../services/StrategyBoardService';

export type { StrategyBoardTask };
export {
  STORAGE_STRATEGY_TASKS_KEY,
  loadStrategyBoardTasks,
  saveStrategyBoardTasks,
  addStrategyBoardTasks,
  updateStrategyBoardTaskStatus,
};

export function schedulePlaybookInNightShift(
  playbookId: PlaybookId,
  target: UserPlaybookTarget
): boolean {
  try {
    const schedules = loadNightShiftSchedules();
    const playbook = INTELLIGENCE_PLAYBOOKS[playbookId] || INTELLIGENCE_PLAYBOOKS.wiretap_watch;

    let agentId = playbook.assignedOperativeId || 'vance';
    let agentName = playbook.assignedOperativeName || 'Agent Vance';
    let frequency: ScheduleFrequency = 'every_1h';
    let prefix = 'WATCH';
    let promptText = '';

    const cleanTargetName = (target.targetName || 'Primary Focus').trim();
    const condition = (target.watchCondition || target.targetScope || 'Continuous monitoring parameters').trim();

    switch (playbookId) {
      case 'wiretap_watch':
        agentId = 'nyx';
        agentName = 'Agent Nyx';
        frequency = 'every_1h';
        prefix = 'WIRETAP';
        promptText = `Execute automated surveillance wiretap on target "${cleanTargetName}". Monitor for pricing modifications, restocks, or changelog shifts under scope: ${condition}. Write brief to VFS if verified delta detected.`;
        break;

      case 'deep_recon':
      case 'competitor_radar':
        agentId = 'nyx';
        agentName = 'Agent Nyx';
        frequency = 'every_6h';
        prefix = 'DEEP RECON';
        promptText = `Execute autonomous deep OSINT recon sweep on "${cleanTargetName}". Investigate: ${condition}. Ground strictly in live search telemetry, filter PR noise, and update intelligence dossier.`;
        break;

      case 'morning_briefing':
        agentId = 'vance';
        agentName = 'Agent Vance';
        frequency = 'daily';
        prefix = 'MORNING BRIEF';
        promptText = `Compile 60-second daily executive situation briefing for focus "${cleanTargetName}". Scope: ${condition}. Ingest live external news signals and summarize core priorities.${
          target.recipientEmail ? ` Broadcast executive dossier to ${target.recipientEmail.trim()}` : ''
        }`;
        break;

      case 'triage_gmail':
        agentId = 'vance';
        agentName = 'Agent Vance';
        frequency = 'every_1h';
        prefix = 'GMAIL TRIAGE';
        promptText = `Execute autonomous Gmail triage sweep for filter "${cleanTargetName}". Extract actionable deliverables matching: ${condition}. Populate Strategy Board queue and archive triage SITREP.`;
        break;

      case 'calendar_brief':
      case 'quick_schedule_briefing':
        agentId = 'vance';
        agentName = 'Agent Vance';
        frequency = 'daily';
        prefix = 'CALENDAR BRIEF';
        promptText = `Prepare daily executive calendar briefing for "${cleanTargetName}". Focus: ${condition}. Ingest upcoming syncs, attendees, and key objectives.`;
        break;

      case 'sync_github':
      case 'tech_audit':
        agentId = 'cipher';
        agentName = 'Agent Cipher';
        frequency = 'every_1h';
        prefix = 'GITHUB SYNC';
        promptText = `Execute automated repository sync and issue pulse for "${cleanTargetName}". Monitor for: ${condition}. Flag blockers, pull request review requests, and security alerts.`;
        break;

      default:
        agentId = playbook.assignedOperativeId || 'vance';
        agentName = playbook.assignedOperativeName || 'Agent Vance';
        frequency = 'every_1h';
        prefix = (playbook.shortTitle || 'PLAYBOOK').toUpperCase();
        promptText = `Execute scheduled intelligence workflow "${playbook.title}" on target "${cleanTargetName}". Parameters: ${condition}.`;
        break;
    }

    const newRoutine: NightShiftTaskSchedule = {
      id: `routine_${playbookId}_${Date.now()}`,
      title: `[${prefix}] ${cleanTargetName.slice(0, 36)}`,
      agentId,
      agentName,
      prompt: promptText,
      frequency,
      enabled: true,
      maxTokensPerRun: 12000,
      maxActionsPerRun: 8,
      safetyHaltOnAnomaly: false,
      runCount: 0,
      createdAt: new Date().toISOString(),
      notificationConfig: {
        notifyBrowser: true,
        notifyPhone: true,
        notifyGmail: Boolean(target.recipientEmail && target.recipientEmail.trim()),
        gmailRecipient: (target.recipientEmail || '').trim(),
        notifySlack: false,
        slackChannel: '',
        notifyDiscord: false,
        discordWebhook: '',
        notifyWebhook: false,
        webhookUrl: '',
      },
    };

    // Replace any existing identical routine or prepend
    const existingIndex = schedules.findIndex(
      (s) => s.title === newRoutine.title || s.id.startsWith(`routine_${playbookId}_`)
    );
    if (existingIndex >= 0) {
      schedules[existingIndex] = { ...schedules[existingIndex], ...newRoutine, id: schedules[existingIndex].id };
    } else {
      schedules.unshift(newRoutine);
    }

    saveNightShiftSchedules(schedules);

    // Backward-compatible fallback key for legacy listeners
    try {
      localStorage.setItem('pixelops_nightshift_schedules_v1', JSON.stringify(schedules));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nightshift:schedules-changed'));
      }
    } catch {}

    return true;
  } catch (err) {
    console.warn('[IntelligencePlaybooks] Failed to schedule routine in Night Shift:', err);
    return false;
  }
}

export function scheduleWiretapInNightShift(target: UserPlaybookTarget): boolean {
  return schedulePlaybookInNightShift('wiretap_watch', target);
}

export const DEFAULT_TARGET_PRESETS: Record<PlaybookId, UserPlaybookTarget[]> = {
  // Pillar 1
  wiretap_watch: [
    {
      presetId: 'pricing_watch',
      targetName: 'https://stripe.com/pricing',
      targetScope: 'Monitor for interchange fee shifts, new packaging tiers, and developer API pricing changes',
      category: 'Competitor Pricing Watch',
    },
    {
      presetId: 'changelog_watch',
      targetName: 'https://cursor.com/changelog',
      targetScope: 'Track AI model additions, editor feature drops, subscription tier revisions',
      category: 'Changelog Surveillance',
    },
    {
      presetId: 'ecommerce_stock',
      targetName: 'https://store.example.com/product',
      targetScope: 'Restock verification, price drop detection, coupon availability',
      category: 'Product / Restock Watch',
    },
  ],

  deep_recon: [
    {
      presetId: 'custom_biz',
      targetName: 'Target Competitor or Market Entity',
      targetScope: 'Product roadmap, changelogs, executive hires, customer feedback gaps, pricing shifts',
      category: 'General Market & Competitor',
    },
    {
      presetId: 'fintech_rails',
      targetName: 'Stripe vs Adyen vs Square',
      targetScope: 'Interchange fee updates, developer API deprecations, new payment rails, crypto features',
      category: 'Fintech & Payments',
    },
    {
      presetId: 'ai_landscape',
      targetName: 'AI Agents & Automation Market',
      targetScope: 'LangChain, CrewAI, AutoGen, Cursor, Devin changelogs, API token pricing, SDK updates',
      category: 'AI & Developer Tools',
    },
  ],

  morning_briefing: [
    {
      presetId: 'executive_sitrep',
      targetName: 'Daily Executive Operations Briefing',
      targetScope: 'Active tasks, project deliverables, unread communications, recent intelligence dossiers',
      category: 'Executive Operations',
      recipientEmail: '',
    },
    {
      presetId: 'tech_market_pulse',
      targetName: 'Tech Market & AI Industry Pulse',
      targetScope: 'AI model releases, developer tooling updates, breaking venture funding, market sentiment',
      category: 'Market Intelligence',
      recipientEmail: '',
    },
    {
      presetId: 'eng_standup',
      targetName: 'Engineering Velocity & Security Standup',
      targetScope: 'Open pull requests, critical blocker issues, pending dependency patches',
      category: 'Engineering & Product',
      recipientEmail: '',
    },
  ],

  // Pillar 2
  triage_gmail: [
    {
      presetId: 'unread_urgent',
      targetName: 'is:unread label:important',
      targetScope: 'Filter for action items, deliverables, and high-priority messages requiring immediate response',
      category: 'Urgent Inbox Triage',
    },
    {
      presetId: 'client_requests',
      targetName: 'from:clients OR subject:urgent',
      targetScope: 'Extract incoming client tickets, project feedback, and schedule requests',
      category: 'Client Requests',
    },
    {
      presetId: 'invoices_billing',
      targetName: 'subject:invoice OR subject:receipt',
      targetScope: 'Extract payment due dates, vendor billing amounts, and pending approvals',
      category: 'Invoices & Billing',
    },
  ],

  calendar_brief: [
    {
      presetId: 'daily_agenda',
      targetName: "Today's Agenda & Syncs",
      targetScope: 'Upcoming meetings, attendee profiles, objectives, and talking points',
      category: "Daily Schedule Brief",
    },
    {
      presetId: 'strategic_review',
      targetName: 'Strategic Reviews & Presentations',
      targetScope: 'Key performance metrics, presentation notes, decisions requiring executive consensus',
      category: 'Executive Meetings',
    },
  ],

  quick_schedule_briefing: [
    {
      presetId: 'fast_briefing_slot',
      targetName: 'Executive Tactical Sync',
      targetScope: 'One-click quick schedule briefing: 45m executive tactical alignment with clean wall-clock ISO timestamps',
      category: 'One-Click Briefing',
    },
    {
      presetId: 'incident_standup',
      targetName: 'Emergency Incident Standup',
      targetScope: 'Immediate priority briefing: 30m incident triage and remediation review',
      category: 'One-Click Briefing',
    },
  ],

  sync_github: [
    {
      presetId: 'active_repo',
      targetName: 'owner/repository',
      targetScope: 'Critical open issues, pull requests awaiting review, dependency CVE advisories',
      category: 'Production Repo Sync',
    },
    {
      presetId: 'bug_triage',
      targetName: 'owner/repository (label:bug)',
      targetScope: 'High-severity bugs, user regressions, crash telemetry',
      category: 'Bug & Defect Triage',
    },
  ],

  // Aliases for backward compatibility
  competitor_radar: [
    {
      presetId: 'custom_biz',
      targetName: 'Target Competitor or Market Entity',
      targetScope: 'Changelogs, pricing modifications, feature drops, hiring trends, product announcements',
      category: 'General Market & Competitor',
    },
  ],
  tech_audit: [
    {
      presetId: 'custom_repo',
      targetName: 'owner/repository',
      targetScope: 'Active dependencies, CVE security advisories, lockfile integrity',
      category: 'GitHub Repository',
    },
  ],
};

export const INTELLIGENCE_PLAYBOOKS: Record<PlaybookId, IntelligencePlaybookDef> = {
  // Pillar 1: Pocket Recon & Watchtower
  wiretap_watch: {
    id: 'wiretap_watch',
    pillar: 1,
    title: '[📡 WIRE-TAP: WEBSITE / PRICE WATCH]',
    shortTitle: 'Watchtower Wire-Tap',
    icon: '📡',
    assignedRoom: 'comms_tower',
    assignedStationId: 'comms_dish_console',
    roomBadge: 'WATCHTOWER',
    roomName: 'Comms Tower / Basement',
    assignedOperativeId: 'nyx',
    assignedOperativeName: 'Agent Nyx',
    assignedOperativeRole: 'Deep Intel Recon',
    description:
      'Live website and pricing surveillance wiretap. Monitors target URLs, competitor pricing pages, product restocks, or changelogs, isolates change deltas, writes classified briefs to VFS, and supports 1-tap Night Shift scheduling.',
    targetFilePattern: 'intel/watchtower_[target]_[date].md',
    defaultPromptQuestion: 'What target URL and watch condition should Agent Nyx monitor?',
    targetPlaceholder: 'e.g. https://stripe.com/pricing or https://cursor.com/changelog',
    scopePlaceholder: 'e.g. Price adjustments, packaging tiers, feature drops, out-of-stock items',
    supportsNightShift: true,
    stages: [
      { id: 'param_check', label: 'Target Ingestion', description: 'Ingests target URL and establishes baseline parameters.' },
      { id: 'web_fetch', label: 'Surveillance Fetch', description: 'Executes live search and endpoint grounding to retrieve content.' },
      { id: 'delta_filter', label: 'Delta Isolation', description: 'Isolates pricing, inventory, or feature modifications from noise.' },
      { id: 'brief_archive', label: 'Watchtower Archive', description: 'Compiles classified brief to Basement VFS archive.' },
    ],
  },

  deep_recon: {
    id: 'deep_recon',
    pillar: 1,
    title: '[🔍 DEEP RECON: ENTITY / TOPIC DOSSIER]',
    shortTitle: 'Deep Entity Recon',
    icon: '🔍',
    assignedRoom: 'comms_tower',
    assignedStationId: 'comms_transceiver',
    roomBadge: 'WATCHTOWER',
    roomName: 'Comms Tower / Basement',
    assignedOperativeId: 'nyx',
    assignedOperativeName: 'Agent Nyx',
    assignedOperativeRole: 'Deep Intel Recon',
    description:
      'Autonomous open-ended OSINT and entity recon sweep. Ingests user-specified company, domain, person, or niche topic, performs multi-query search grounding, filters PR noise, and compiles an executive Markdown dossier.',
    targetFilePattern: 'intel/dossier_[target]_[date].md',
    defaultPromptQuestion: 'What company, competitor, domain, or niche topic should Agent Nyx investigate?',
    targetPlaceholder: 'e.g. Stripe, Acme Corp, Competitor Product, Autonomous AI Agents',
    scopePlaceholder: 'e.g. Product roadmap, executive changes, pricing shifts, customer feedback gaps',
    supportsNightShift: true,
    stages: [
      { id: 'target_ingest', label: 'Entity Ingestion', description: 'Calibrates surveillance perimeter on target entity nodes.' },
      { id: 'osint_sweep', label: 'Multi-Query OSINT', description: 'Executes live web searches across overview, news, and sentiment.' },
      { id: 'threat_eval', label: 'Delta Analysis', description: 'Evaluates strategic threats and opportunities.' },
      { id: 'dossier_write', label: 'Dossier Generation', description: 'Archives clean portable Markdown dossier to VFS.' },
    ],
  },

  morning_briefing: {
    id: 'morning_briefing',
    pillar: 1,
    title: '[🌅 MORNING INTEL BRIEFING]',
    shortTitle: 'Morning Intel Briefing',
    icon: '🌅',
    assignedRoom: 'comms_tower',
    assignedStationId: 'comms_broadcast_desk',
    roomBadge: 'WATCHTOWER',
    roomName: 'Comms Tower / Basement',
    assignedOperativeId: 'vance',
    assignedOperativeName: 'Agent Vance',
    assignedOperativeRole: 'Command Operations Chief',
    description:
      'Multi-source executive command briefing. Aggregates user-selected project issues, market news, and recent VFS intelligence dossiers into a 60-second executive SITREP with optional 1-click email dispatch via Gmail.',
    targetFilePattern: 'intel/dossier_[target]_[date].md',
    defaultPromptQuestion: 'What 1–3 daily interest topics should Agent Vance compile into your 60-second briefing?',
    targetPlaceholder: 'e.g. AI Models & Agents, Tech Market Trends, Cloud Security',
    scopePlaceholder: 'e.g. Breaking releases, regulatory updates, funding announcements, daily summary priorities',
    supportsActionDispatch: true,
    supportsNightShift: true,
    actionDispatchLabel: '[✉️ DISPATCH VIA GMAIL]',
    stages: [
      { id: 'multi_source', label: 'Topic Aggregation', description: 'Gathers live search signals, deliverables, and VFS dossiers.' },
      { id: 'synthesis', label: 'Executive Synthesis', description: 'Distills intelligence into 60-second actionable SITREP.' },
      { id: 'archive_dispatch', label: 'VFS & Dispatch', description: 'Logs briefing to Basement VFS with optional Gmail broadcast.' },
    ],
  },

  // Pillar 2: 1-Click Cross-App Operator
  triage_gmail: {
    id: 'triage_gmail',
    pillar: 2,
    title: '[⚡ TRIAGE UNREAD GMAIL TO TASKS]',
    shortTitle: 'Triage Gmail to Tasks',
    icon: '⚡',
    assignedRoom: 'war_room',
    assignedStationId: 'war_center_table',
    roomBadge: 'OPERATOR',
    roomName: 'War Room / Server Vault',
    assignedOperativeId: 'vance',
    assignedOperativeName: 'Agent Vance',
    assignedOperativeRole: 'Command Operations Chief',
    description:
      'Checks connected user Gmail via Composio, fetches unread/important messages, extracts actionable deliverables, populates the Strategy Board task queue, and writes an executive triage summary to VFS.',
    targetFilePattern: 'intel/triage_gmail_[date].md',
    defaultPromptQuestion: 'Specify inbox filter criteria or press Run to triage all unread messages:',
    targetPlaceholder: 'e.g. is:unread label:important, or from:clients',
    scopePlaceholder: 'e.g. Urgent deliverables, client requests, invoice notifications, blocker alerts',
    requiredApp: 'gmail',
    supportsNightShift: true,
    stages: [
      { id: 'auth_check', label: 'Composio Auth Check', description: 'Verifies user connected Gmail account session.' },
      { id: 'fetch_inbox', label: 'Fetch Unread Inbox', description: 'Retrieves latest messages matching criteria via Composio.' },
      { id: 'extract_tasks', label: 'Extract Action Items', description: 'Synthesizes tasks and populates Strategy Board queue.' },
      { id: 'archive_triage', label: 'VFS Action Log', description: 'Archives triage summary to local VFS.' },
    ],
  },

  calendar_brief: {
    id: 'calendar_brief',
    pillar: 2,
    title: "[📅 PREP TODAY'S CALENDAR BRIEF]",
    shortTitle: 'Calendar Schedule Brief',
    icon: '📅',
    assignedRoom: 'war_room',
    assignedStationId: 'war_east_screens',
    roomBadge: 'OPERATOR',
    roomName: 'War Room / Server Vault',
    assignedOperativeId: 'vance',
    assignedOperativeName: 'Agent Vance',
    assignedOperativeRole: 'Command Operations Chief',
    description:
      "Checks connected user Google Calendar via Composio (or manual schedule input), summarizes today's upcoming meetings, and drafts executive talking points and attendee briefs into VFS.",
    targetFilePattern: 'intel/calendar_brief_[date].md',
    defaultPromptQuestion: 'What calendar focus or schedule scope should Agent Vance prepare?',
    targetPlaceholder: "e.g. Today's Agenda, Strategic Reviews, or Client Syncs",
    scopePlaceholder: 'e.g. Meeting objectives, key attendees, preparation notes, talking points',
    requiredApp: 'googlecalendar',
    supportsNightShift: true,
    stages: [
      { id: 'auth_check', label: 'Calendar Auth Check', description: 'Verifies user Google Calendar connection via Composio.' },
      { id: 'fetch_events', label: 'Event Retrieval', description: "Pulls today's schedule and attendee metadata." },
      { id: 'prep_points', label: 'Talking Points Prep', description: 'Drafts strategic objectives and discussion topics.' },
      { id: 'archive_brief', label: 'VFS Briefing Log', description: 'Archives calendar briefing to local VFS.' },
    ],
  },

  quick_schedule_briefing: {
    id: 'quick_schedule_briefing',
    pillar: 2,
    title: '[⚡ QUICK SCHEDULE BRIEFING]',
    shortTitle: 'Quick Schedule Briefing',
    icon: '⚡',
    assignedRoom: 'war_room',
    assignedStationId: 'war_east_screens',
    roomBadge: 'OPERATOR',
    roomName: 'War Room / Lounge',
    assignedOperativeId: 'vance',
    assignedOperativeName: 'Agent Vance',
    assignedOperativeRole: 'Command Operations Chief',
    description:
      'Instantly schedules a structured tactical briefing on Google Calendar with clean ISO 8601 wall-clock timestamps and archives briefing talking points directly to VFS.',
    targetFilePattern: 'intel/quick_briefing_[date].md',
    defaultPromptQuestion: 'What is the headline mission or agenda for this quick schedule briefing?',
    targetPlaceholder: 'e.g. Executive Tactical Sync, Incident Response Review',
    scopePlaceholder: 'e.g. Key attendees, operational objectives, 45m schedule window',
    requiredApp: 'googlecalendar',
    supportsNightShift: true,
    stages: [
      { id: 'auth_check', label: 'Calendar Auth Check', description: 'Verifies user Google Calendar authorization session.' },
      { id: 'format_params', label: 'Schema Sanitization', description: 'Enforces ISO 8601 wall-clock timestamps and cleans briefing payload.' },
      { id: 'commit_event', label: 'Calendar Dispatch', description: 'Dispatches GOOGLECALENDAR_CREATE_EVENT to user Google Calendar.' },
      { id: 'archive_brief', label: 'Dossier Log', description: 'Archives briefing confirmation to local VFS.' },
    ],
  },

  sync_github: {
    id: 'sync_github',
    pillar: 2,
    title: '[🐛 SYNC GITHUB ISSUES / REPO PULSE]',
    shortTitle: 'GitHub Repo Pulse',
    icon: '🐛',
    assignedRoom: 'server_vault',
    assignedStationId: 'vault_core_rack',
    roomBadge: 'OPERATOR',
    roomName: 'Server Vault / War Room',
    assignedOperativeId: 'cipher',
    assignedOperativeName: 'Agent Cipher',
    assignedOperativeRole: 'Code-Ops Specialist',
    description:
      'Prompts user to select their connected GitHub repository via Composio, pulls open issues and pull requests, and writes a prioritized action log and repository pulse report to VFS.',
    targetFilePattern: 'intel/repo_pulse_[repo]_[date].md',
    defaultPromptQuestion: 'Which of your connected GitHub repositories should Agent Cipher sync?',
    targetPlaceholder: 'e.g. owner/repo (e.g. my-org/web-app)',
    scopePlaceholder: 'e.g. Critical bugs, unassigned issues, PR reviews needed, security advisories',
    requiredApp: 'github',
    supportsNightShift: true,
    stages: [
      { id: 'repo_check', label: 'Repository Verify', description: 'Verifies GitHub connection and validates target repo.' },
      { id: 'pull_issues', label: 'Issue & PR Ingestion', description: 'Pulls open issues and pending pull requests via Composio.' },
      { id: 'cve_check', label: 'Blocker & CVE Check', description: 'Scans for critical blockers and dependency advisories.' },
      { id: 'archive_pulse', label: 'Action Log Archive', description: 'Archives prioritized repository pulse report to VFS.' },
    ],
  },

  // Aliases
  competitor_radar: {
    id: 'competitor_radar',
    pillar: 1,
    title: '[📡 RUN COMPETITOR INTEL SWEEP]',
    shortTitle: 'Competitor & Market Radar',
    icon: '📡',
    assignedRoom: 'comms_tower',
    assignedStationId: 'comms_dish_console',
    roomBadge: 'WATCHTOWER',
    roomName: 'Comms Tower / Basement',
    assignedOperativeId: 'nyx',
    assignedOperativeName: 'Agent Nyx',
    assignedOperativeRole: 'Deep Intel Recon',
    description: 'Alias to Deep Entity Recon.',
    targetFilePattern: 'intel/dossier_[target]_[date].md',
    defaultPromptQuestion: 'What company, competitor, or product should Agent Nyx monitor?',
    targetPlaceholder: 'e.g. Stripe, Acme Corp, Competitor Product',
    scopePlaceholder: 'e.g. Changelogs, pricing changes, product drops, hiring velocity',
    supportsNightShift: true,
    stages: [
      { id: 'target_ingest', label: 'Target Ingestion', description: 'Calibrates surveillance perimeter.' },
      { id: 'osint_sweep', label: 'OSINT Sweep', description: 'Executes live search.' },
      { id: 'dossier_write', label: 'Dossier Generation', description: 'Archives to VFS.' },
    ],
  },

  tech_audit: {
    id: 'tech_audit',
    pillar: 2,
    title: '[🛡️ RUN TECH STACK VULNERABILITY AUDIT]',
    shortTitle: 'Tech Stack & Security Watch',
    icon: '🛡️',
    assignedRoom: 'server_vault',
    assignedStationId: 'vault_core_rack',
    roomBadge: 'OPERATOR',
    roomName: 'Server Vault / War Room',
    assignedOperativeId: 'cipher',
    assignedOperativeName: 'Agent Cipher',
    assignedOperativeRole: 'Code-Ops Specialist',
    description: 'Alias to GitHub Repo Pulse.',
    targetFilePattern: 'intel/dossier_[target]_[date].md',
    defaultPromptQuestion: 'Which repository or tech stack should Agent Cipher audit?',
    targetPlaceholder: 'e.g. owner/repo or Next.js + FastAPI',
    scopePlaceholder: 'e.g. CVE vulnerabilities, breaking changes, dependency alerts',
    supportsNightShift: true,
    stages: [
      { id: 'repo_check', label: 'Stack Check', description: 'Pulls package manifests and versions.' },
      { id: 'advisory', label: 'Advisory Cross-Reference', description: 'Scans CVE databases.' },
      { id: 'patch', label: 'Patch Recommendation', description: 'Archives report to VFS.' },
    ],
  },
};

export function getFormattedDateStr(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function sanitizeTargetSlug(raw: string): string {
  return (raw || 'general')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'target';
}

export function loadUserPlaybookTargets(): Record<PlaybookId, UserPlaybookTarget> {
  try {
    const raw = localStorage.getItem('pixelops_osint_playbook_targets_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        wiretap_watch: parsed.wiretap_watch || DEFAULT_TARGET_PRESETS.wiretap_watch[0],
        deep_recon: parsed.deep_recon || DEFAULT_TARGET_PRESETS.deep_recon[0],
        morning_briefing: parsed.morning_briefing || DEFAULT_TARGET_PRESETS.morning_briefing[0],
        triage_gmail: parsed.triage_gmail || DEFAULT_TARGET_PRESETS.triage_gmail[0],
        calendar_brief: parsed.calendar_brief || DEFAULT_TARGET_PRESETS.calendar_brief[0],
        quick_schedule_briefing: parsed.quick_schedule_briefing || DEFAULT_TARGET_PRESETS.quick_schedule_briefing[0],
        sync_github: parsed.sync_github || DEFAULT_TARGET_PRESETS.sync_github[0],
        competitor_radar: parsed.competitor_radar || DEFAULT_TARGET_PRESETS.deep_recon[0],
        tech_audit: parsed.tech_audit || DEFAULT_TARGET_PRESETS.sync_github[0],
      };
    }
  } catch {}

  return {
    wiretap_watch: DEFAULT_TARGET_PRESETS.wiretap_watch[0],
    deep_recon: DEFAULT_TARGET_PRESETS.deep_recon[0],
    morning_briefing: DEFAULT_TARGET_PRESETS.morning_briefing[0],
    triage_gmail: DEFAULT_TARGET_PRESETS.triage_gmail[0],
    calendar_brief: DEFAULT_TARGET_PRESETS.calendar_brief[0],
    quick_schedule_briefing: DEFAULT_TARGET_PRESETS.quick_schedule_briefing[0],
    sync_github: DEFAULT_TARGET_PRESETS.sync_github[0],
    competitor_radar: DEFAULT_TARGET_PRESETS.deep_recon[0],
    tech_audit: DEFAULT_TARGET_PRESETS.sync_github[0],
  };
}

export function saveUserPlaybookTarget(playbookId: PlaybookId, target: UserPlaybookTarget): void {
  try {
    const current = loadUserPlaybookTargets();
    current[playbookId] = target;
    localStorage.setItem('pixelops_osint_playbook_targets_v2', JSON.stringify(current));
  } catch {}
}

export type RoomWorkflowItemId =
  | 'live_satellite_recon'
  | 'wiretap_watch'
  | 'deep_recon'
  | 'morning_briefing'
  | 'triage_gmail'
  | 'calendar_brief'
  | 'quick_schedule_briefing'
  | 'sync_github'
  | 'open_vfs_files'
  | 'operative_dossier';

export interface RoomWorkflowCatalogItem {
  id: RoomWorkflowItemId;
  shortTitle: string;
  icon: string;
  description: string;
  operativeName: string;
  category: 'recon' | 'operator' | 'system';
  playbookId?: PlaybookId;
}

export const ALL_WORKFLOW_DECK_ITEMS: RoomWorkflowCatalogItem[] = [
  {
    id: 'live_satellite_recon',
    shortTitle: 'Live Satellite Recon Monitor',
    icon: '🛰️',
    description: 'NASA GIBS & Esri Orbital Overlay',
    operativeName: 'Agent Nyx',
    category: 'recon',
  },
  {
    id: 'wiretap_watch',
    shortTitle: 'Watchtower Wire-Tap',
    icon: '📡',
    description: 'Live website, pricing & changelog surveillance',
    operativeName: 'Agent Nyx',
    category: 'recon',
    playbookId: 'wiretap_watch',
  },
  {
    id: 'deep_recon',
    shortTitle: 'Deep Entity Recon',
    icon: '🔍',
    description: 'Autonomous multi-query OSINT & entity dossier',
    operativeName: 'Agent Nyx',
    category: 'recon',
    playbookId: 'deep_recon',
  },
  {
    id: 'morning_briefing',
    shortTitle: 'Morning Intel Briefing',
    icon: '🌅',
    description: '60-second daily executive situation briefing',
    operativeName: 'Agent Vance',
    category: 'recon',
    playbookId: 'morning_briefing',
  },
  {
    id: 'triage_gmail',
    shortTitle: 'Triage Gmail to Tasks',
    icon: '⚡',
    description: 'Extract unread deliverables to Strategy Board',
    operativeName: 'Agent Vance',
    category: 'operator',
    playbookId: 'triage_gmail',
  },
  {
    id: 'calendar_brief',
    shortTitle: 'Calendar Schedule Brief',
    icon: '📅',
    description: "Prep today's schedule & attendee talking points",
    operativeName: 'Agent Vance',
    category: 'operator',
    playbookId: 'calendar_brief',
  },
  {
    id: 'quick_schedule_briefing',
    shortTitle: 'Quick Schedule Briefing',
    icon: '⚡',
    description: 'Instant 1-click briefing schedule on Google Calendar',
    operativeName: 'Agent Vance',
    category: 'operator',
    playbookId: 'quick_schedule_briefing',
  },
  {
    id: 'sync_github',
    shortTitle: 'GitHub Repo Pulse',
    icon: '🐛',
    description: 'Sync open issues, PR reviews & CVE alerts',
    operativeName: 'Agent Cipher',
    category: 'operator',
    playbookId: 'sync_github',
  },
  {
    id: 'open_vfs_files',
    shortTitle: 'Open VFS Vault Files',
    icon: '📂',
    description: 'Browse saved dossiers & classified briefings',
    operativeName: 'System VFS',
    category: 'system',
  },
  {
    id: 'operative_dossier',
    shortTitle: 'Operative Clearance & Dossier',
    icon: '🪪',
    description: 'View Clearance XP, Service Ribbons & export card',
    operativeName: 'Crew Loadout',
    category: 'system',
  },
];

const ROOM_WORKFLOW_DECK_STORAGE_KEY = 'pixelops_room_workflow_decks_v1';

export const DEFAULT_ROOM_WORKFLOW_DECKS: Record<string, RoomWorkflowItemId[]> = {
  comms_tower: ['live_satellite_recon', 'wiretap_watch', 'deep_recon', 'morning_briefing'],
  war_room: ['quick_schedule_briefing', 'calendar_brief', 'triage_gmail', 'sync_github'],
  server_vault: ['sync_github', 'triage_gmail', 'calendar_brief', 'quick_schedule_briefing'],
  armory: ['operative_dossier', 'sync_github'],
  briefing_lounge: ['quick_schedule_briefing', 'operative_dossier', 'morning_briefing'],
  library: ['deep_recon', 'wiretap_watch', 'morning_briefing'],
  archive_basement: ['open_vfs_files', 'wiretap_watch', 'deep_recon'],
};

type WorkflowDeckListener = () => void;
const workflowDeckListeners = new Set<WorkflowDeckListener>();

export function subscribeRoomWorkflowDecks(cb: WorkflowDeckListener): () => void {
  workflowDeckListeners.add(cb);
  return () => {
    workflowDeckListeners.delete(cb);
  };
}

function notifyWorkflowDeckListeners(): void {
  for (const cb of Array.from(workflowDeckListeners)) {
    try {
      cb();
    } catch {}
  }
}

export function loadRoomWorkflowDecks(): Record<string, RoomWorkflowItemId[]> {
  try {
    const raw = localStorage.getItem(ROOM_WORKFLOW_DECK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_ROOM_WORKFLOW_DECKS, ...parsed };
      }
    }
  } catch {}
  return { ...DEFAULT_ROOM_WORKFLOW_DECKS };
}

export function saveRoomWorkflowDecks(decks: Record<string, RoomWorkflowItemId[]>): void {
  try {
    localStorage.setItem(ROOM_WORKFLOW_DECK_STORAGE_KEY, JSON.stringify(decks));
  } catch {}
  notifyWorkflowDeckListeners();
}

export function getRoomWorkflowDeckItems(roomId: string): RoomWorkflowItemId[] {
  const all = loadRoomWorkflowDecks();
  if (Array.isArray(all[roomId])) {
    return all[roomId];
  }
  return ['live_satellite_recon', 'deep_recon', 'morning_briefing'];
}

export function toggleWorkflowInRoomDeck(roomId: string, itemId: RoomWorkflowItemId): void {
  const all = loadRoomWorkflowDecks();
  const current = Array.isArray(all[roomId]) ? [...all[roomId]] : [...getRoomWorkflowDeckItems(roomId)];
  const idx = current.indexOf(itemId);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.push(itemId);
  }
  all[roomId] = current;
  saveRoomWorkflowDecks(all);
}

export function moveWorkflowToRoomDeck(
  fromRoomId: string,
  toRoomId: string,
  itemId: RoomWorkflowItemId
): void {
  const all = loadRoomWorkflowDecks();
  const fromList = Array.isArray(all[fromRoomId])
    ? [...all[fromRoomId]]
    : [...getRoomWorkflowDeckItems(fromRoomId)];
  const toList = Array.isArray(all[toRoomId])
    ? [...all[toRoomId]]
    : [...getRoomWorkflowDeckItems(toRoomId)];

  all[fromRoomId] = fromList.filter((id) => id !== itemId);
  if (!toList.includes(itemId)) {
    toList.push(itemId);
  }
  all[toRoomId] = toList;
  saveRoomWorkflowDecks(all);
}

export function reorderWorkflowInRoomDeck(
  roomId: string,
  itemId: RoomWorkflowItemId,
  direction: 'up' | 'down'
): void {
  const all = loadRoomWorkflowDecks();
  const current = Array.isArray(all[roomId]) ? [...all[roomId]] : [...getRoomWorkflowDeckItems(roomId)];
  const idx = current.indexOf(itemId);
  if (idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= current.length) return;
  const temp = current[idx];
  current[idx] = current[swapIdx];
  current[swapIdx] = temp;
  all[roomId] = current;
  saveRoomWorkflowDecks(all);
}

export function resetRoomWorkflowDecksToDefault(): void {
  saveRoomWorkflowDecks({ ...DEFAULT_ROOM_WORKFLOW_DECKS });
}

/**
 * Returns all Playbooks available for a given room.
 */
export function getPlaybooksForRoom(roomId: RoomId): IntelligencePlaybookDef[] {
  const deckItems = getRoomWorkflowDeckItems(roomId);
  const playbooksFromDeck = deckItems
    .map((id) => ALL_WORKFLOW_DECK_ITEMS.find((item) => item.id === id)?.playbookId)
    .filter((pbId): pbId is PlaybookId => Boolean(pbId && INTELLIGENCE_PLAYBOOKS[pbId]))
    .map((pbId) => INTELLIGENCE_PLAYBOOKS[pbId]);

  if (playbooksFromDeck.length > 0) {
    return playbooksFromDeck;
  }

  // Fallback if no playbooks are assigned in custom deck
  if (roomId === 'comms_tower' || roomId === 'archive_basement' || roomId === 'library') {
    return [
      INTELLIGENCE_PLAYBOOKS.wiretap_watch,
      INTELLIGENCE_PLAYBOOKS.deep_recon,
      INTELLIGENCE_PLAYBOOKS.morning_briefing,
    ];
  }
  return [
    INTELLIGENCE_PLAYBOOKS.triage_gmail,
    INTELLIGENCE_PLAYBOOKS.calendar_brief,
    INTELLIGENCE_PLAYBOOKS.sync_github,
  ];
}

/**
 * Resolves primary Playbook definition for a given room.
 */
export function getPlaybookForRoom(roomId: RoomId): IntelligencePlaybookDef | null {
  const list = getPlaybooksForRoom(roomId);
  return list[0] || null;
}

/**
 * Public GitHub Repository Telemetry Data Model
 */
export interface PublicGitHubRepoData {
  name: string;
  fullName: string;
  description: string;
  stars: number;
  forks: number;
  openIssuesCount: number;
  pushedAt: string;
  license?: string;
  topics?: string[];
  issues: Array<{
    number: number;
    title: string;
    state: string;
    user: string;
    labels: string[];
    createdAt: string;
    htmlUrl: string;
    bodySnippet?: string;
  }>;
}

/**
 * Fetches real, unauthenticated telemetry and open issues from GitHub's public REST API.
 * Guarantees 100% genuine repository pulse even if third-party Composio OAuth is unlinked.
 */
export async function fetchPublicGitHubTelemetry(
  owner: string,
  repo: string
): Promise<PublicGitHubRepoData | null> {
  const cleanOwner = encodeURIComponent((owner || '').trim());
  const cleanRepo = encodeURIComponent((repo || '').trim());
  if (!cleanOwner || !cleanRepo) return null;

  try {
    const repoRes = await fetch(`https://api.github.com/repos/${cleanOwner}/${cleanRepo}`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!repoRes.ok) return null;
    const repoData = await repoRes.json();

    let issues: any[] = [];
    try {
      const issuesRes = await fetch(
        `https://api.github.com/repos/${cleanOwner}/${cleanRepo}/issues?state=open&per_page=10&sort=updated`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );
      if (issuesRes.ok) {
        const issuesJson = await issuesRes.json();
        if (Array.isArray(issuesJson)) {
          issues = issuesJson.map((item: any) => ({
            number: item.number,
            title: item.title,
            state: item.state,
            user: item.user?.login || 'contributor',
            labels: (item.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name || '')),
            createdAt: item.created_at,
            htmlUrl: item.html_url,
            bodySnippet: (item.body || '').slice(0, 150).replace(/\r?\n/g, ' '),
          }));
        }
      }
    } catch {}

    return {
      name: repoData.name,
      fullName: repoData.full_name,
      description: repoData.description || 'Public GitHub Repository',
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      openIssuesCount: repoData.open_issues_count || 0,
      pushedAt: repoData.pushed_at || new Date().toISOString(),
      license: repoData.license?.spdx_id || repoData.license?.name,
      topics: repoData.topics || [],
      issues,
    };
  } catch (err) {
    console.warn('[GITHUB TELEMETRY FALLBACK] Public fetch encounter:', err);
    return null;
  }
}


// =========================================================================
// UNIVERSAL ENTRYPOINT
// =========================================================================
export async function executeIntelligencePlaybook(
  playbookId: PlaybookId,
  targetConfig: UserPlaybookTarget,
  onStageUpdate?: (stageIndex: number, log: string) => void
): Promise<PlaybookExecutionResult> {
  // Pipelines (~85 kB) and the agent engine they call are loaded on demand, keeping them
  // off the startup path. Repeat calls reuse the already-loaded module.
  const { runPlaybookPipeline } = await import('./playbookPipelines');
  return runPlaybookPipeline(playbookId, targetConfig, onStageUpdate);
}

/**
 * Dispatches the Morning Command Briefing via Gmail
 */
export async function dispatchMorningBriefingEmail(
  recipientEmail: string,
  dossierContent: string,
  briefingTitle?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const dateStr = getFormattedDateStr();
    const result = await executeComposioAction('GMAIL_SEND_EMAIL', {
      to: recipientEmail,
      recipient_email: recipientEmail,
      subject: `⚡ ${briefingTitle || 'Executive Command Briefing'} [${dateStr}]`,
      body: dossierContent,
    });

    if (result.successful) {
      return { success: true, message: `Briefing dispatched successfully to ${recipientEmail} via Gmail.` };
    }
    return { success: false, message: result.error || 'Failed to dispatch via connected Gmail account.' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Gmail transmission error.' };
  }
}
