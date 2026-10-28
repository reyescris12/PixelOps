import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useTheme } from './ThemeContext';
import type { RoomId } from '../components/SpriteCanvas';

export type SpriteVariant =
  | 'trenchcoat'
  | 'safecracker'
  | 'undercover_infiltration'
  | 'stealth_ops'
  | 'exo_hacker'
  | 'cyber_security'
  | 'hoodie'
  | 'intel_analyst'
  | 'sleeper_agent'
  | 'scholar_robe'
  | 'armored'
  | 'crimson_grapple'
  | 'hazmat_cloak'
  | 'ghillie_sniper'
  | 'recon_grey'
  | 'recon_blue'
  | 'recon_brown';

export type SpriteVariantCategory =
  | 'Field & Infiltration'
  | 'Tech-Ops & Cyber'
  | 'Intel & Recon'
  | 'Tactical & Heavy';

export type BaseSpriteFamily =
  | 'vance'
  | 'nyx'
  | 'cipher'
  | 'archivist_crimson'
  | 'undercover_field'
  | 'safecracker'
  | 'comms_ops'
  | 'exo_hacker'
  | 'tactical_tech_ops'
  | 'cyber_security'
  | 'intel_analyst'
  | 'undercover_infiltration'
  | 'sleeper_agent'
  | 'heavy_sniper'
  | 'crimson_grapple'
  | 'hazmat_cloak'
  | 'ghillie_sniper'
  | 'recon_grey'
  | 'recon_blue'
  | 'recon_brown';

export interface SpriteVariantMetadata {
  id: SpriteVariant;
  label: string;
  shortTag: string;
  category: SpriteVariantCategory;
  description: string;
  baseSpriteFamily: BaseSpriteFamily;
  previewSpriteUrl: string;
  cssFilter: string;
  badgeColor: string;
  accentHex: string;
  gearOverlayLabel: string;
}

export const SPRITE_VARIANTS: Record<SpriteVariant, SpriteVariantMetadata> = {
  trenchcoat: {
    id: 'trenchcoat',
    label: 'Undercover Field Trench',
    shortTag: 'FIELD',
    category: 'Field & Infiltration',
    description:
      'Classic tan double-breasted trenchcoat & dark fedora with handheld green signal scanner.',
    baseSpriteFamily: 'undercover_field',
    previewSpriteUrl: '/assets/agents/undercover_field_stand.png',
    cssFilter: 'none',
    badgeColor: '#e59838',
    accentHex: '#e59838',
    gearOverlayLabel: 'Fedora + Trenchcoat + Radar Scanner',
  },
  safecracker: {
    id: 'safecracker',
    label: 'Vault Safecracker',
    shortTag: 'VAULT',
    category: 'Field & Infiltration',
    description:
      'Heist specialist with jeweler’s optical loupe, open camel jacket, slate trousers & steel pry-bar; crouches to crack vaults when executing.',
    baseSpriteFamily: 'safecracker',
    previewSpriteUrl: '/assets/agents/safecracker_stand.png',
    cssFilter: 'none',
    badgeColor: '#f5980b',
    accentHex: '#fbbf24',
    gearOverlayLabel: 'Optical Loupe + Steel Vault Pry-Bar',
  },
  undercover_infiltration: {
    id: 'undercover_infiltration',
    label: 'Infiltration Garrison',
    shortTag: 'INFIL',
    category: 'Field & Infiltration',
    description:
      'Dark garrison cap with emblem, slate infiltration coat, and leather utility belt pouches.',
    baseSpriteFamily: 'undercover_infiltration',
    previewSpriteUrl: '/assets/agents/undercover_infiltration_stand.png',
    cssFilter: 'none',
    badgeColor: '#d97706',
    accentHex: '#f59e0b',
    gearOverlayLabel: 'Garrison Cap + Utility Pouches',
  },
  crimson_grapple: {
    id: 'crimson_grapple',
    label: 'Crimson Grapple Vanguard',
    shortTag: 'GRAPPLE',
    category: 'Field & Infiltration',
    description:
      'Crimson & obsidian infiltration harness equipped with a kinetic steel grappling hook & line.',
    baseSpriteFamily: 'crimson_grapple',
    previewSpriteUrl: '/assets/agents/crimson_grapple_stand.png',
    cssFilter: 'none',
    badgeColor: '#ef4444',
    accentHex: '#f87171',
    gearOverlayLabel: 'Crimson Rig + Steel Grappling Hook',
  },
  stealth_ops: {
    id: 'stealth_ops',
    label: 'Black Ops Comms Stealth',
    shortTag: 'STEALTH',
    category: 'Tech-Ops & Cyber',
    description:
      'Matte obsidian stealth suit with encrypted field transceiver and tactical headset.',
    baseSpriteFamily: 'comms_ops',
    previewSpriteUrl: '/assets/agents/comms_ops_stand.png',
    cssFilter: 'none',
    badgeColor: '#a855f7',
    accentHex: '#c084fc',
    gearOverlayLabel: 'Obsidian Suit + Encrypted Radio',
  },
  exo_hacker: {
    id: 'exo_hacker',
    label: 'Emerald Matrix Exo-Hacker',
    shortTag: 'MATRIX',
    category: 'Tech-Ops & Cyber',
    description:
      'High-tech emerald cyber-exo armor with glowing neon optics; kneels with Matrix terminal during active tasks.',
    baseSpriteFamily: 'exo_hacker',
    previewSpriteUrl: '/assets/agents/exo_hacker_stand.png',
    cssFilter: 'none',
    badgeColor: '#10b981',
    accentHex: '#34d399',
    gearOverlayLabel: 'Emerald Exo-Suit + Matrix Deck',
  },
  cyber_security: {
    id: 'cyber_security',
    label: 'Aegis Cyber-Security Rig',
    shortTag: 'CYBERSEC',
    category: 'Tech-Ops & Cyber',
    description:
      'Heavy black cyber-security exo-plating with amber optical HUD and wrist firewall gauntlet.',
    baseSpriteFamily: 'cyber_security',
    previewSpriteUrl: '/assets/agents/cyber_security_stand.png',
    cssFilter: 'none',
    badgeColor: '#f97316',
    accentHex: '#fb923c',
    gearOverlayLabel: 'Amber Optics + Firewall Gauntlet',
  },
  hoodie: {
    id: 'hoodie',
    label: 'Tech-Ops Balaclava Hacker',
    shortTag: 'TECH-OPS',
    category: 'Tech-Ops & Cyber',
    description:
      'Tactical black balaclava & stealth armor with green NVG optics; kneels with intrusion deck when executing.',
    baseSpriteFamily: 'tactical_tech_ops',
    previewSpriteUrl: '/assets/agents/tactical_tech_ops_stand.png',
    cssFilter: 'none',
    badgeColor: '#38bdf8',
    accentHex: '#38bdf8',
    gearOverlayLabel: 'NVG Balaclava + Intrusion Laptop',
  },
  intel_analyst: {
    id: 'intel_analyst',
    label: 'Field Intelligence Analyst',
    shortTag: 'INTEL',
    category: 'Intel & Recon',
    description:
      'Olive tactical field vest, encrypted comms headset, and live biometric telemetry tablet.',
    baseSpriteFamily: 'intel_analyst',
    previewSpriteUrl: '/assets/agents/intel_analyst_stand.png',
    cssFilter: 'none',
    badgeColor: '#84cc16',
    accentHex: '#a3e635',
    gearOverlayLabel: 'Comms Headset + Telemetry Tablet',
  },
  sleeper_agent: {
    id: 'sleeper_agent',
    label: 'Covert Sleeper Courier',
    shortTag: 'SLEEPER',
    category: 'Intel & Recon',
    description:
      'Civilian slate field overcoat, covert acoustic transceiver, and locked leather intelligence briefcase.',
    baseSpriteFamily: 'sleeper_agent',
    previewSpriteUrl: '/assets/agents/sleeper_agent_stand.png',
    cssFilter: 'none',
    badgeColor: '#64748b',
    accentHex: '#94a3b8',
    gearOverlayLabel: 'Covert Transceiver + Classified Briefcase',
  },
  scholar_robe: {
    id: 'scholar_robe',
    label: 'Archivist Crimson Coat',
    shortTag: 'ARCHIVIST',
    category: 'Intel & Recon',
    description:
      'Crimson & gold dossier archivist longcoat with golden tie & classified telemetry scanner.',
    baseSpriteFamily: 'archivist_crimson',
    previewSpriteUrl: '/assets/agents/archivist_crimson_stand.png',
    cssFilter: 'none',
    badgeColor: '#f43f5e',
    accentHex: '#fb7185',
    gearOverlayLabel: 'Crimson Archivist Coat + Gold Dossier Scanner',
  },
  armored: {
    id: 'armored',
    label: 'Ballistic Marksman Armor',
    shortTag: 'MARKSMAN',
    category: 'Tactical & Heavy',
    description:
      'Heavy olive ballistic combat armor with helmet visor and long-range precision rifle.',
    baseSpriteFamily: 'heavy_sniper',
    previewSpriteUrl: '/assets/agents/heavy_sniper_stand.png',
    cssFilter: 'none',
    badgeColor: '#4ade80',
    accentHex: '#4ade80',
    gearOverlayLabel: 'Ballistic Armor + Precision Rifle',
  },
  hazmat_cloak: {
    id: 'hazmat_cloak',
    label: 'Bio-Hazmat Wraith Cloak',
    shortTag: 'HAZMAT',
    category: 'Tactical & Heavy',
    description:
      'Weathered charcoal containment cloak with glowing green respirator mask and bio-canister.',
    baseSpriteFamily: 'hazmat_cloak',
    previewSpriteUrl: '/assets/agents/hazmat_cloak_stand.png',
    cssFilter: 'none',
    badgeColor: '#22c55e',
    accentHex: '#4ade80',
    gearOverlayLabel: 'Containment Cloak + Bio-Respirator',
  },
  ghillie_sniper: {
    id: 'ghillie_sniper',
    label: 'Woodland Ghillie Recon',
    shortTag: 'GHILLIE',
    category: 'Tactical & Heavy',
    description:
      'Full woodland foliage camouflage ghillie suit with suppressed thermal recon rifle.',
    baseSpriteFamily: 'ghillie_sniper',
    previewSpriteUrl: '/assets/agents/ghillie_sniper_stand.png',
    cssFilter: 'none',
    badgeColor: '#65a30d',
    accentHex: '#84cc16',
    gearOverlayLabel: 'Foliage Ghillie + Thermal Scope',
  },
  recon_grey: {
    id: 'recon_grey',
    label: 'Phantom Grey Scout',
    shortTag: 'PHANTOM',
    category: 'Intel & Recon',
    description:
      'Urban grey hooded recon cloak with emerald optical visor and silent step boots.',
    baseSpriteFamily: 'recon_grey',
    previewSpriteUrl: '/assets/agents/recon_grey_stand.png',
    cssFilter: 'none',
    badgeColor: '#94a3b8',
    accentHex: '#cbd5e1',
    gearOverlayLabel: 'Urban Grey Cloak + Emerald Visor',
  },
  recon_blue: {
    id: 'recon_blue',
    label: 'Cobalt Vanguard Scout',
    shortTag: 'COBALT',
    category: 'Intel & Recon',
    description:
      'Deep cobalt tactical hood with chest strap harness and glowing green recon optics.',
    baseSpriteFamily: 'recon_blue',
    previewSpriteUrl: '/assets/agents/recon_blue_stand.png',
    cssFilter: 'none',
    badgeColor: '#3b82f6',
    accentHex: '#60a5fa',
    gearOverlayLabel: 'Cobalt Hood + Recon Optics',
  },
  recon_brown: {
    id: 'recon_brown',
    label: 'Outland Ranger Scout',
    shortTag: 'RANGER',
    category: 'Intel & Recon',
    description:
      'Earth-toned expedition ranger cloak with field survival rig and night-vision goggles.',
    baseSpriteFamily: 'recon_brown',
    previewSpriteUrl: '/assets/agents/recon_brown_stand.png',
    cssFilter: 'none',
    badgeColor: '#b45309',
    accentHex: '#d97706',
    gearOverlayLabel: 'Ranger Cloak + Field NVG',
  },
};

export const SPRITE_VARIANT_LIST: SpriteVariantMetadata[] = [
  SPRITE_VARIANTS.trenchcoat,
  SPRITE_VARIANTS.safecracker,
  SPRITE_VARIANTS.undercover_infiltration,
  SPRITE_VARIANTS.crimson_grapple,
  SPRITE_VARIANTS.stealth_ops,
  SPRITE_VARIANTS.exo_hacker,
  SPRITE_VARIANTS.cyber_security,
  SPRITE_VARIANTS.hoodie,
  SPRITE_VARIANTS.intel_analyst,
  SPRITE_VARIANTS.sleeper_agent,
  SPRITE_VARIANTS.recon_grey,
  SPRITE_VARIANTS.recon_blue,
  SPRITE_VARIANTS.recon_brown,
  SPRITE_VARIANTS.scholar_robe,
  SPRITE_VARIANTS.armored,
  SPRITE_VARIANTS.hazmat_cloak,
  SPRITE_VARIANTS.ghillie_sniper,
];

export type FunctionalCapabilityId =
  | 'coder'
  | 'researcher'
  | 'writer'
  | 'data_analyst'
  | 'general_assistant';

export interface FunctionalRoleProfile {
  id: FunctionalCapabilityId;
  label: string;
  categoryBadge: string;
  thematicRoleTitle: string; // e.g. "Code-Ops Specialist [Software Engineering Module]"
  displayBridge: string;
  defaultSpecialty: string;
  defaultSystemPrompt: string;
  recommendedTools: string[];
  description: string;
  iconTag: string;
  accentHex: string;
}

export const FUNCTIONAL_ROLE_PROFILES: Record<FunctionalCapabilityId, FunctionalRoleProfile> = {
  coder: {
    id: 'coder',
    label: 'Senior Software Engineer / Code-Ops',
    categoryBadge: 'ENGINEERING',
    thematicRoleTitle: 'Code-Ops Specialist [Software Engineering Module]',
    displayBridge: '[Software Engineering Module]',
    defaultSpecialty: 'Full-Stack Architecture, TypeScript, Code Auditing & System Debugging',
    defaultSystemPrompt:
      'You are a premier autonomous Senior Software Engineer operating under the covert identity of a Code-Ops Specialist. Write clean, production-grade, battle-tested code. Audit codebases, debug runtime anomalies, structure resilient architectures, and provide exact, executable solutions with zero fluff. Never generate fictional, mock, or simulated tasks; all tasks must map strictly to real operational utilities, live local storage, or connected Composio tools.',
    recommendedTools: ['code_sandbox_eval', 'fs_storage_manager', 'live_web_search'],
    description: 'Expert coding, software architecture, technical debugging, and repository operations.',
    iconTag: '⚡ CODE',
    accentHex: '#38bdf8',
  },
  researcher: {
    id: 'researcher',
    label: 'Deep Research Specialist / Intel Analyst',
    categoryBadge: 'RESEARCH',
    thematicRoleTitle: 'Deep Intel Recon [Synthesis & Investigative Module]',
    displayBridge: '[Deep Research Module]',
    defaultSpecialty: 'Live Web Recon, Source Corroboration, Multi-Node Information Retrieval',
    defaultSystemPrompt:
      'You are an expert autonomous Research Analyst operating as a Deep Intel Recon Operative. Synthesize technical topics, investigate market/technology landscapes, gather up-to-the-minute facts from live web search, and produce grounded, citation-backed analytical briefs with structured breakdowns. Never generate fictional, mock, or simulated tasks; all tasks must map strictly to real operational utilities, live local storage, or connected Composio tools.',
    recommendedTools: ['live_web_search', 'memory_vector_lookup', 'api_fetch_gateway'],
    description: 'Deep investigative research, literature surveys, intelligence synthesis, and fact verification.',
    iconTag: '🔍 RESEARCH',
    accentHex: '#a3e635',
  },
  writer: {
    id: 'writer',
    label: 'Technical Writer & Strategist / Communications',
    categoryBadge: 'COMMUNICATIONS',
    thematicRoleTitle: 'Signals Communications Lead [Technical Writing Module]',
    displayBridge: '[Technical Writing Module]',
    defaultSpecialty: 'Operational Documentation, Executive Summaries, Product Specs & Debriefs',
    defaultSystemPrompt:
      'You are a high-caliber Technical Writer and Communications Strategist embedded as a Signals Communications Lead. Formulate sharp, articulate prose, technical specifications, READMEs, changelogs, operational post-mortems, and persuasive executive summaries with military precision and clarity. Never generate fictional, mock, or simulated tasks; all tasks must map strictly to real operational utilities, live local storage, or connected Composio tools.',
    recommendedTools: ['fs_storage_manager', 'memory_vector_lookup', 'live_web_search'],
    description: 'Clear documentation, product specs, release notes, and structured executive communication.',
    iconTag: '📝 WRITER',
    accentHex: '#fb923c',
  },
  data_analyst: {
    id: 'data_analyst',
    label: 'Data Analyst & Quantitative Modeler / Cyber-Metrics',
    categoryBadge: 'DATA & METRICS',
    thematicRoleTitle: 'Cyber-Metrics Analyst [Quantitative Data Module]',
    displayBridge: '[Quantitative Data Module]',
    defaultSpecialty: 'Statistical Telemetry, Trend Forecasting, Metric Verification & Insights',
    defaultSystemPrompt:
      'You are a veteran Data Analyst and Quantitative Strategist masked as a Cyber-Metrics Analyst. Inspect datasets, analyze performance telemetry, detect anomalies, model time-series patterns, and translate complex numbers into actionable strategic recommendations. Never generate fictional, mock, or simulated tasks; all tasks must map strictly to real operational utilities, live local storage, or connected Composio tools.',
    recommendedTools: ['code_sandbox_eval', 'api_fetch_gateway', 'live_web_search'],
    description: 'Data analysis, metric crunching, anomaly detection, telemetry visualization, and reporting.',
    iconTag: '📊 DATA',
    accentHex: '#f59e0b',
  },
  general_assistant: {
    id: 'general_assistant',
    label: 'Autonomous Executive Assistant / Operations Dispatch',
    categoryBadge: 'OPERATIONS',
    thematicRoleTitle: 'Command Operations Chief [Executive Assistant Module]',
    displayBridge: '[Executive Assistant Module]',
    defaultSpecialty: 'Cross-Functional Task Orchestration, Schedule Dispatch & Workflow Management',
    defaultSystemPrompt:
      'You are an elite Autonomous Executive Assistant operating as a Command Operations Chief. Coordinate high-priority workflows, organize schedules and operational calendars, synthesize multi-domain requests, and execute directives swiftly with impeccable reliability. Never generate fictional, mock, or simulated tasks; all tasks must map strictly to real operational utilities, live local storage, or connected Composio tools.',
    recommendedTools: ['live_web_search', 'code_sandbox_eval', 'fs_storage_manager', 'api_fetch_gateway', 'memory_vector_lookup'],
    description: 'Versatile multi-domain task assistance, scheduling, project coordination, and workflow management.',
    iconTag: '🧭 GENERAL',
    accentHex: '#e59838',
  },
};

export const FUNCTIONAL_ROLE_LIST: FunctionalRoleProfile[] = [
  FUNCTIONAL_ROLE_PROFILES.coder,
  FUNCTIONAL_ROLE_PROFILES.researcher,
  FUNCTIONAL_ROLE_PROFILES.writer,
  FUNCTIONAL_ROLE_PROFILES.data_analyst,
  FUNCTIONAL_ROLE_PROFILES.general_assistant,
];

export interface AgentMemoryEntry {
  id: string;
  timestamp: string;
  prompt: string;
  summary: string;
}

export interface CrewAgentState {
  id: string;
  agentIndex: number;
  defaultName: string;
  customName: string;
  role: string;
  functionalRole: FunctionalCapabilityId;
  specialty: string;
  systemPrompt: string;
  assignedTools: string[];
  memoryLog: AgentMemoryEntry[];
  spriteVariant: SpriteVariant;
  currentRoom: RoomId;
  preferredStationId: string;
  isRecruited?: boolean;
}

export interface RecruitedAgentPayload {
  id: string;
  customName: string;
  role: string;
  functionalRole?: FunctionalCapabilityId;
  specialty: string;
  systemPrompt: string;
  assignedTools: string[];
  memoryLog: AgentMemoryEntry[];
  spriteVariant: SpriteVariant;
  currentRoom: RoomId;
  preferredStationId: string;
}

interface CrewContextValue {
  crewAgents: CrewAgentState[];
  getCrewAgent: (id: string) => CrewAgentState | undefined;
  getCrewAgentByIndex: (index: number) => CrewAgentState;
  updateAgentName: (id: string, customName: string) => void;
  updateAgentSpriteVariant: (id: string, variant: SpriteVariant) => void;
  updateAgentRoom: (id: string, currentRoom: RoomId, preferredStationId?: string) => void;
  updateAgentConfig: (
    id: string,
    updates: {
      customName?: string;
      role?: string;
      functionalRole?: FunctionalCapabilityId;
      specialty?: string;
      systemPrompt?: string;
      assignedTools?: string[];
      spriteVariant?: SpriteVariant;
    }
  ) => void;
  addAgentMemory: (id: string, entry: { prompt: string; summary: string }) => void;
  clearAgentMemory: (id: string) => void;
  resetCrewToDefaults: () => void;
  recruitAgent: (payload: {
    customName: string;
    role: string;
    functionalRole?: FunctionalCapabilityId;
    specialty: string;
    systemPrompt: string;
    spriteVariant: SpriteVariant;
    currentRoom: RoomId;
    assignedTools?: string[];
  }) => string;
  dismissAgent: (id: string) => void;
}

const STORAGE_CREW_KEY = 'pixelops_crew_customization_v3';
const STORAGE_RECRUITED_AGENTS_KEY = 'pixelops_recruited_agents_v1';

const DEFAULT_VARIANTS_BY_INDEX: SpriteVariant[] = [
  'trenchcoat',
  'stealth_ops',
  'hoodie',
];

const DEFAULT_FUNCTIONAL_ROLES_BY_INDEX: FunctionalCapabilityId[] = [
  'general_assistant',
  'researcher',
  'coder',
];

const DEFAULT_ROOMS_BY_INDEX: RoomId[] = [
  'war_room',
  'comms_tower',
  'library',
];

const DEFAULT_STATIONS_BY_INDEX: string[] = [
  'war_center_desk',
  'comms_dish_console',
  'lib_front_desk',
];

const VALID_ROOM_IDS = new Set<RoomId>([
  'war_room',
  'server_vault',
  'library',
  'comms_tower',
  'armory',
  'briefing_lounge',
  'archive_basement',
]);

const DEFAULT_TOOLS = [
  'live_web_search',
  'code_sandbox_eval',
  'fs_storage_manager',
  'api_fetch_gateway',
  'memory_vector_lookup',
];

interface StoredAgentCustomization {
  customName?: string;
  role?: string;
  functionalRole?: FunctionalCapabilityId;
  specialty?: string;
  systemPrompt?: string;
  assignedTools?: string[];
  memoryLog?: AgentMemoryEntry[];
  spriteVariant?: SpriteVariant;
  currentRoom?: RoomId;
  preferredStationId?: string;
}

const loadStoredCustomizations = (): Record<string, StoredAgentCustomization> => {
  try {
    const raw = localStorage.getItem(STORAGE_CREW_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const saveStoredCustomizations = (map: Record<string, StoredAgentCustomization>) => {
  try {
    localStorage.setItem(STORAGE_CREW_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
};

const loadRecruitedAgents = (): RecruitedAgentPayload[] => {
  try {
    const raw = localStorage.getItem(STORAGE_RECRUITED_AGENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveRecruitedAgents = (agents: RecruitedAgentPayload[]) => {
  try {
    localStorage.setItem(STORAGE_RECRUITED_AGENTS_KEY, JSON.stringify(agents));
  } catch {
    // Ignore storage quota
  }
};

const CrewContext = createContext<CrewContextValue | undefined>(undefined);

export const CrewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const [customMap, setCustomMap] = useState<Record<string, StoredAgentCustomization>>(() =>
    loadStoredCustomizations()
  );
  const [recruitedAgents, setRecruitedAgents] = useState<RecruitedAgentPayload[]>(loadRecruitedAgents);

  useEffect(() => {
    saveStoredCustomizations(customMap);
  }, [customMap]);

  useEffect(() => {
    saveRecruitedAgents(recruitedAgents);
  }, [recruitedAgents]);

  const themeBaseAgents: CrewAgentState[] = useMemo(() => {
    return theme.agents.map((profile, idx) => {
      const saved = customMap[profile.id] || {};
      const defaultVariant = DEFAULT_VARIANTS_BY_INDEX[idx] || 'trenchcoat';
      const validVariant: SpriteVariant =
        saved.spriteVariant && SPRITE_VARIANTS[saved.spriteVariant]
          ? saved.spriteVariant
          : defaultVariant;

      const functionalRole: FunctionalCapabilityId =
        saved.functionalRole && FUNCTIONAL_ROLE_PROFILES[saved.functionalRole]
          ? saved.functionalRole
          : DEFAULT_FUNCTIONAL_ROLES_BY_INDEX[idx] || 'general_assistant';

      const funcProfile = FUNCTIONAL_ROLE_PROFILES[functionalRole];

      const customName =
        typeof saved.customName === 'string' && saved.customName.trim().length > 0
          ? saved.customName.trim()
          : profile.name;

      const role =
        typeof saved.role === 'string' && saved.role.trim().length > 0
          ? saved.role.trim()
          : funcProfile ? funcProfile.thematicRoleTitle : profile.role;

      const specialty =
        typeof saved.specialty === 'string' && saved.specialty.trim().length > 0
          ? saved.specialty.trim()
          : funcProfile ? funcProfile.defaultSpecialty : profile.specialty;

      const defaultSysPrompt = funcProfile
        ? funcProfile.defaultSystemPrompt
        : `You are an autonomous tactical AI operative named ${customName}, serving in the role of ${role}. Specialty: ${specialty}. Bio: ${profile.bio}. Execute all directives with high precision, citing real tool data, technical telemetry, and in-character confidence.`;

      const systemPrompt =
        typeof saved.systemPrompt === 'string' && saved.systemPrompt.trim().length > 0
          ? saved.systemPrompt.trim()
          : defaultSysPrompt;

      const assignedTools = Array.isArray(saved.assignedTools)
        ? saved.assignedTools
        : funcProfile
        ? funcProfile.recommendedTools
        : DEFAULT_TOOLS;

      const memoryLog = Array.isArray(saved.memoryLog) ? saved.memoryLog : [];

      const currentRoom: RoomId =
        saved.currentRoom && VALID_ROOM_IDS.has(saved.currentRoom)
          ? saved.currentRoom
          : DEFAULT_ROOMS_BY_INDEX[idx] || 'war_room';

      const preferredStationId =
        saved.preferredStationId || DEFAULT_STATIONS_BY_INDEX[idx] || 'war_center_desk';

      return {
        id: profile.id,
        agentIndex: idx,
        defaultName: profile.name,
        customName,
        role,
        functionalRole,
        specialty,
        systemPrompt,
        assignedTools,
        memoryLog,
        spriteVariant: validVariant,
        currentRoom,
        preferredStationId,
        isRecruited: false,
      };
    });
  }, [theme.agents, customMap]);

  const recruitedConverted: CrewAgentState[] = useMemo(() => {
    return recruitedAgents.map((rec, idx) => {
      const fRole: FunctionalCapabilityId =
        rec.functionalRole && FUNCTIONAL_ROLE_PROFILES[rec.functionalRole]
          ? rec.functionalRole
          : 'general_assistant';
      const fProfile = FUNCTIONAL_ROLE_PROFILES[fRole];

      return {
        id: rec.id,
        agentIndex: theme.agents.length + idx,
        defaultName: rec.customName,
        customName: rec.customName,
        role: rec.role || (fProfile ? fProfile.thematicRoleTitle : 'Tactical AI Operative'),
        functionalRole: fRole,
        specialty: rec.specialty || (fProfile ? fProfile.defaultSpecialty : 'Cross-Functional Task Orchestration'),
        systemPrompt: rec.systemPrompt || (fProfile ? fProfile.defaultSystemPrompt : ''),
        assignedTools: rec.assignedTools || (fProfile ? fProfile.recommendedTools : DEFAULT_TOOLS),
        memoryLog: rec.memoryLog || [],
        spriteVariant: rec.spriteVariant || 'trenchcoat',
        currentRoom: rec.currentRoom || 'war_room',
        preferredStationId: rec.preferredStationId || 'war_center_desk',
        isRecruited: true,
      };
    });
  }, [recruitedAgents, theme.agents.length]);

  const crewAgents: CrewAgentState[] = useMemo(
    () => [...themeBaseAgents, ...recruitedConverted],
    [themeBaseAgents, recruitedConverted]
  );

  const getCrewAgent = useCallback(
    (id: string) => crewAgents.find((a) => a.id === id),
    [crewAgents]
  );

  const getCrewAgentByIndex = useCallback(
    (index: number) => crewAgents[index] || crewAgents[0],
    [crewAgents]
  );

  const updateAgentName = useCallback((id: string, customName: string) => {
    if (id.startsWith('rec_')) {
      setRecruitedAgents((prev) =>
        prev.map((r) => (r.id === id ? { ...r, customName } : r))
      );
    } else {
      setCustomMap((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          customName,
        },
      }));
    }
  }, []);

  const updateAgentSpriteVariant = useCallback((id: string, spriteVariant: SpriteVariant) => {
    if (id.startsWith('rec_')) {
      setRecruitedAgents((prev) =>
        prev.map((r) => (r.id === id ? { ...r, spriteVariant } : r))
      );
    } else {
      setCustomMap((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          spriteVariant,
        },
      }));
    }
  }, []);

  const updateAgentRoom = useCallback(
    (id: string, currentRoom: RoomId, preferredStationId?: string) => {
      if (id.startsWith('rec_')) {
        setRecruitedAgents((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  currentRoom,
                  ...(preferredStationId ? { preferredStationId } : {}),
                }
              : r
          )
        );
      } else {
        setCustomMap((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            currentRoom,
            ...(preferredStationId ? { preferredStationId } : {}),
          },
        }));
      }
    },
    []
  );

  const updateAgentConfig = useCallback(
    (
      id: string,
      updates: {
        customName?: string;
        role?: string;
        functionalRole?: FunctionalCapabilityId;
        specialty?: string;
        systemPrompt?: string;
        assignedTools?: string[];
        spriteVariant?: SpriteVariant;
      }
    ) => {
      if (id.startsWith('rec_')) {
        setRecruitedAgents((prev) =>
          prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
        );
      } else {
        setCustomMap((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            ...updates,
          },
        }));
      }
    },
    []
  );

  const addAgentMemory = useCallback(
    (id: string, entry: { prompt: string; summary: string }) => {
      const newEntry: AgentMemoryEntry = {
        id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        timestamp: new Date().toISOString(),
        prompt: entry.prompt,
        summary: entry.summary,
      };

      if (id.startsWith('rec_')) {
        setRecruitedAgents((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, memoryLog: [newEntry, ...(r.memoryLog || [])].slice(0, 30) }
              : r
          )
        );
      } else {
        setCustomMap((prev) => {
          const current = prev[id] || {};
          const oldLog = Array.isArray(current.memoryLog) ? current.memoryLog : [];
          return {
            ...prev,
            [id]: {
              ...current,
              memoryLog: [newEntry, ...oldLog].slice(0, 30),
            },
          };
        });
      }
    },
    []
  );

  const clearAgentMemory = useCallback((id: string) => {
    if (id.startsWith('rec_')) {
      setRecruitedAgents((prev) =>
        prev.map((r) => (r.id === id ? { ...r, memoryLog: [] } : r))
      );
    } else {
      setCustomMap((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          memoryLog: [],
        },
      }));
    }
  }, []);

  const resetCrewToDefaults = useCallback(() => {
    setCustomMap((prev) => {
      const next = { ...prev };
      theme.agents.forEach((ag) => {
        delete next[ag.id];
      });
      return next;
    });
  }, [theme.agents]);

  const recruitAgent = useCallback(
    (payload: {
      customName: string;
      role: string;
      functionalRole?: FunctionalCapabilityId;
      specialty: string;
      systemPrompt: string;
      spriteVariant: SpriteVariant;
      currentRoom: RoomId;
      assignedTools?: string[];
    }): string => {
      const newId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const defaultStationByRoom: Record<RoomId, string> = {
        comms_tower: 'comms_dish_console',
        war_room: 'war_center_desk',
        server_vault: 'vault_laptop',
        armory: 'armory_gear_rack',
        briefing_lounge: 'lounge_holo_table',
        library: 'lib_front_desk',
        archive_basement: 'basement_microfiche',
      };

      const functionalRole = payload.functionalRole || 'general_assistant';
      const funcProfile = FUNCTIONAL_ROLE_PROFILES[functionalRole];

      const newRecruited: RecruitedAgentPayload = {
        id: newId,
        customName: payload.customName,
        role: payload.role || (funcProfile ? funcProfile.thematicRoleTitle : 'Tactical AI Operative'),
        functionalRole,
        specialty: payload.specialty || (funcProfile ? funcProfile.defaultSpecialty : 'Cross-Functional Task Orchestration'),
        systemPrompt: payload.systemPrompt || (funcProfile ? funcProfile.defaultSystemPrompt : ''),
        assignedTools: payload.assignedTools || (funcProfile ? funcProfile.recommendedTools : DEFAULT_TOOLS),
        memoryLog: [],
        spriteVariant: payload.spriteVariant,
        currentRoom: payload.currentRoom,
        preferredStationId: defaultStationByRoom[payload.currentRoom] || 'war_center_desk',
      };
      setRecruitedAgents((prev) => [...prev, newRecruited]);
      return newId;
    },
    []
  );

  const dismissAgent = useCallback((id: string) => {
    if (id.startsWith('rec_')) {
      setRecruitedAgents((prev) => prev.filter((r) => r.id !== id));
    }
  }, []);

  return (
    <CrewContext.Provider
      value={{
        crewAgents,
        getCrewAgent,
        getCrewAgentByIndex,
        updateAgentName,
        updateAgentSpriteVariant,
        updateAgentRoom,
        updateAgentConfig,
        addAgentMemory,
        clearAgentMemory,
        resetCrewToDefaults,
        recruitAgent,
        dismissAgent,
      }}
    >
      {children}
    </CrewContext.Provider>
  );
};

export const useCrew = (): CrewContextValue => {
  const ctx = useContext(CrewContext);
  if (!ctx) {
    throw new Error('useCrew must be used within a CrewProvider');
  }
  return ctx;
};
