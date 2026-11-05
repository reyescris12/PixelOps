export interface SkillModuleDef {
  id: string;
  name: string;
  shortCode: string;
  category: 'code' | 'research' | 'security' | 'system' | 'data';
  description: string;
  systemPromptModifier: string;
  providedTools: string[];
  recommendedRoom?: string;
  iconName: string;
}

export const AVAILABLE_SKILLS: SkillModuleDef[] = [
  {
    id: 'web_search_plugin',
    name: 'Web Search & Extraction',
    shortCode: 'WEB_SEARCH',
    category: 'research',
    description:
      'Enables live web queries, real-time web search via Jina Reader, and documentation extraction.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [WEB_SEARCH]. Retrieve live factual knowledge and documentation nodes.',
    providedTools: ['live_web_search'],
    recommendedRoom: 'library',
    iconName: 'Search',
  },
  {
    id: 'code_sandbox_plugin',
    name: 'Code Sandbox & JS Evaluator',
    shortCode: 'CODE_SANDBOX',
    category: 'code',
    description:
      'Allows local code drafting, testing, mathematical computation, and data processing in an isolated sandbox.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [CODE_SANDBOX]. Evaluate code expressions, format payloads, and test logic safely.',
    providedTools: ['code_sandbox_eval'],
    recommendedRoom: 'server_vault',
    iconName: 'Cpu',
  },
  {
    id: 'fs_storage_plugin',
    name: 'File System & Storage Manager',
    shortCode: 'FS_STORAGE',
    category: 'data',
    description:
      'Handles reading, writing, and exporting markdown logs, JSON configs, and workspace files directly to IndexedDB or user downloads.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [FS_STORAGE]. Manage local file assets, save reports, and export markdown deliverables.',
    providedTools: ['fs_storage_manager'],
    recommendedRoom: 'archive_basement',
    iconName: 'Database',
  },
  {
    id: 'api_gateway_plugin',
    name: 'API & Fetch Gateway',
    shortCode: 'API_GATEWAY',
    category: 'system',
    description:
      'A generalized client supporting BYOK execution for custom REST endpoints and webhooks.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [API_GATEWAY]. Dispatch direct client-side HTTP requests and webhooks with custom headers.',
    providedTools: ['api_fetch_gateway'],
    recommendedRoom: 'comms_tower',
    iconName: 'Radar',
  },
  {
    id: 'memory_lookup_plugin',
    name: 'Memory & Vector Lookup',
    shortCode: 'MEMORY_LOOKUP',
    category: 'security',
    description:
      'Queries local historical logs, Dexie/IndexedDB immutable records, and saved agent notes.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [MEMORY_LOOKUP]. Cross-reference past operations and recall historical agent reflections.',
    providedTools: ['memory_vector_lookup'],
    recommendedRoom: 'server_vault',
    iconName: 'Key',
  },
  {
    id: 'github_scraper',
    name: 'GitHub Repo Scraper',
    shortCode: 'GITHUB_SCRAPER',
    category: 'code',
    description:
      'Fetches repository trees, git logs, branch diffs, and pull requests via the local safehouse bridge.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [GITHUB_SCRAPER]. Prioritize repository inspection, code reviews, and tree navigation.',
    providedTools: ['fetch_github_repo', 'read_git_diff', 'inspect_repo_tree'],
    recommendedRoom: 'cyber_lab',
    iconName: 'FolderGit2',
  },
  {
    id: 'deep_research',
    name: 'Deep Research Engine',
    shortCode: 'DEEP_RESEARCH',
    category: 'research',
    description:
      'Autonomous multi-hop web retrieval, search query generation, and intelligence synthesis across archives.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [DEEP_RESEARCH]. Execute deep multi-source intelligence gathering and factual cross-referencing.',
    providedTools: ['web_search', 'extract_page_content', 'synthesize_intel'],
    recommendedRoom: 'library',
    iconName: 'Search',
  },
  {
    id: 'code_refactor',
    name: 'AST Code Refactor Engine',
    shortCode: 'CODE_REFACTOR',
    category: 'code',
    description:
      'High-speed syntax tree analysis, AST pattern replacement, and type-safe refactoring pipelines.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [CODE_REFACTOR]. Focus on structural refactoring, dead code elimination, and strict type safety.',
    providedTools: ['ast_parse', 'apply_code_patch', 'run_linter'],
    recommendedRoom: 'war_room',
    iconName: 'Cpu',
  },
  {
    id: 'terminal_shell',
    name: 'Headless Shell Sandbox',
    shortCode: 'TERMINAL_SHELL',
    category: 'system',
    description:
      'Direct execution of local whitelisted shell scripts and node commands through the safehouse sidecar.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [TERMINAL_SHELL]. Formulate safe terminal commands and verify system state before execution.',
    providedTools: ['execute_shell_cmd', 'read_local_file', 'write_local_file'],
    recommendedRoom: 'server_vault',
    iconName: 'Terminal',
  },
  {
    id: 'crypto_vault',
    name: 'Quantum Key Decryptor',
    shortCode: 'CRYPTO_VAULT',
    category: 'security',
    description:
      'Analyzes encrypted environment secrets, parses cipher payloads, and validates JWT/HMAC hashes.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [CRYPTO_VAULT]. Adhere to strict cryptographic security guidelines and zero-knowledge storage.',
    providedTools: ['decrypt_vault_secret', 'verify_hash_checksum', 'generate_secure_nonce'],
    recommendedRoom: 'quantum_vault',
    iconName: 'Key',
  },
  {
    id: 'db_forensics',
    name: 'Database Forensics Analyzer',
    shortCode: 'DB_FORENSICS',
    category: 'data',
    description:
      'Query performance analyzer, migration planner, and schema relational graph extractor.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [DB_FORENSICS]. Validate query indexing, data normalization, and integrity constraints.',
    providedTools: ['analyze_query_plan', 'inspect_db_schema', 'generate_migration'],
    recommendedRoom: 'archive_basement',
    iconName: 'Database',
  },
  {
    id: 'browser_crawler',
    name: 'Stealth Browser Crawler',
    shortCode: 'BROWSER_CRAWLER',
    category: 'research',
    description:
      'Headless DOM interaction and DOM tree scraper for dynamic single-page web applications.',
    systemPromptModifier:
      'OPERATIONAL CAPABILITY ACTIVE: [BROWSER_CRAWLER]. Navigate client-side DOM trees and extract interactive elements.',
    providedTools: ['crawl_url', 'extract_dom_elements', 'capture_screenshot'],
    recommendedRoom: 'comms_tower',
    iconName: 'Radar',
  },
];

const ROOM_BINDINGS_STORAGE_KEY = 'pixelops_room_skill_bindings_v1';
const STATION_BINDINGS_STORAGE_KEY = 'pixelops_station_skill_bindings_v1';

// Default initial bindings bridging rooms to capabilities
const DEFAULT_ROOM_BINDINGS: Record<string, string[]> = {
  comms_tower: ['api_gateway_plugin', 'web_search_plugin'],
  war_room: ['code_sandbox_plugin', 'api_gateway_plugin'],
  server_vault: ['code_sandbox_plugin', 'memory_lookup_plugin'],
  armory: ['code_sandbox_plugin'],
  briefing_lounge: ['memory_lookup_plugin'],
  library: ['web_search_plugin'],
  archive_basement: ['fs_storage_plugin', 'memory_lookup_plugin'],
  cyber_lab: ['code_sandbox_plugin', 'github_scraper'],
  quantum_vault: ['memory_lookup_plugin', 'crypto_vault'],
  stealth_hangar: ['api_gateway_plugin'],
};

const DEFAULT_STATION_BINDINGS: Record<string, string> = {
  comms_cipher_rig: 'api_gateway_plugin',
  war_left_desk: 'code_sandbox_plugin',
  vault_laptop: 'memory_lookup_plugin',
  vault_core_rack: 'code_sandbox_plugin',
  lib_front_desk: 'web_search_plugin',
  lib_card_catalog: 'web_search_plugin',
  basement_omega_safe: 'fs_storage_plugin',
  cyber_bench: 'code_sandbox_plugin',
  cyber_neural_pod: 'github_scraper',
};

type ModuleRegistryListener = () => void;
const listeners = new Set<ModuleRegistryListener>();

export function subscribeModuleRegistry(cb: ModuleRegistryListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners(): void {
  for (const cb of Array.from(listeners)) {
    try {
      cb();
    } catch (e) {
      console.error('Error in module registry listener:', e);
    }
  }
}

let memoryRoomBindings: Record<string, string[]> = { ...DEFAULT_ROOM_BINDINGS };
let memoryStationBindings: Record<string, string> = { ...DEFAULT_STATION_BINDINGS };

/**
 * Loads room skill bindings map (roomId -> array of skillIds).
 */
export function loadRoomSkillBindings(): Record<string, string[]> {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(ROOM_BINDINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_ROOM_BINDINGS };
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : { ...DEFAULT_ROOM_BINDINGS };
    } catch (e) {
      console.warn('Failed to load room skill bindings:', e);
      return { ...DEFAULT_ROOM_BINDINGS };
    }
  }
  return memoryRoomBindings;
}

/**
 * Saves room skill bindings map to storage.
 */
export function saveRoomSkillBindings(bindings: Record<string, string[]>): void {
  memoryRoomBindings = { ...bindings };
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(ROOM_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
      notifyListeners();
    } catch (e) {
      console.warn('Failed to save room skill bindings:', e);
    }
  } else {
    notifyListeners();
  }
}

/**
 * Loads workstation-specific skill bindings map (stationId -> skillId).
 */
export function loadStationSkillBindings(): Record<string, string> {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STATION_BINDINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATION_BINDINGS };
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : { ...DEFAULT_STATION_BINDINGS };
    } catch (e) {
      console.warn('Failed to load station skill bindings:', e);
      return { ...DEFAULT_STATION_BINDINGS };
    }
  }
  return memoryStationBindings;
}

/**
 * Saves workstation-specific skill bindings map to storage.
 */
export function saveStationSkillBindings(bindings: Record<string, string>): void {
  memoryStationBindings = { ...bindings };
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STATION_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
      notifyListeners();
    } catch (e) {
      console.warn('Failed to save station skill bindings:', e);
    }
  } else {
    notifyListeners();
  }
}

/**
 * Mounts a skill module to a room or specifically to a workstation.
 */
export function mountSkillToRoom(roomId: string, skillId: string, stationId?: string): void {
  const roomBindings = loadRoomSkillBindings();
  const currentSkills = roomBindings[roomId] || [];
  if (!currentSkills.includes(skillId)) {
    roomBindings[roomId] = [...currentSkills, skillId];
    saveRoomSkillBindings(roomBindings);
  }

  if (stationId) {
    const stationBindings = loadStationSkillBindings();
    stationBindings[stationId] = skillId;
    saveStationSkillBindings(stationBindings);
  } else {
    notifyListeners();
  }
}

/**
 * Unmounts a skill module from a room or workstation.
 */
export function unmountSkillFromRoom(roomId: string, skillId: string, stationId?: string): void {
  const roomBindings = loadRoomSkillBindings();
  if (roomBindings[roomId]) {
    roomBindings[roomId] = roomBindings[roomId].filter((id) => id !== skillId);
    saveRoomSkillBindings(roomBindings);
  }

  if (stationId) {
    const stationBindings = loadStationSkillBindings();
    if (stationBindings[stationId] === skillId) {
      delete stationBindings[stationId];
      saveStationSkillBindings(stationBindings);
    }
  } else {
    // If unmounted from room, also remove any station bindings in that room pointing to this skill
    const stationBindings = loadStationSkillBindings();
    let changed = false;
    for (const [stId, sId] of Object.entries(stationBindings)) {
      if (sId === skillId) {
        delete stationBindings[stId];
        changed = true;
      }
    }
    if (changed) saveStationSkillBindings(stationBindings);
  }
}

/**
 * Retrieves all skill definitions bound to a room.
 */
export function getRoomBoundSkills(roomId: string): SkillModuleDef[] {
  const roomBindings = loadRoomSkillBindings();
  const skillIds = roomBindings[roomId] || [];
  return skillIds
    .map((id) => AVAILABLE_SKILLS.find((s) => s.id === id))
    .filter((s): s is SkillModuleDef => Boolean(s));
}

/**
 * Retrieves skill definition bound to a specific workstation (if any).
 */
export function getStationBoundSkill(stationId: string): SkillModuleDef | null {
  const stationBindings = loadStationSkillBindings();
  const skillId = stationBindings[stationId];
  if (!skillId) return null;
  return AVAILABLE_SKILLS.find((s) => s.id === skillId) || null;
}

/**
 * Agent-room operational trigger resolver:
 * Calculates the real-time operational status badge and bound tool list for an agent
 * based on their current room and interactive workstation.
 */
export function resolveAgentOperationalState(
  agentState: {
    room?: string;
    stationId?: string;
    isMoving?: boolean;
    statusTag?: string;
  },
  defaultRoomTag: string = 'IDLE'
): {
  operationalBadge: string;
  activeSkill: SkillModuleDef | null;
  boundTools: string[];
  systemPromptModifier: string;
} {
  if (!agentState || !agentState.room) {
    return {
      operationalBadge: defaultRoomTag,
      activeSkill: null,
      boundTools: [],
      systemPromptModifier: '',
    };
  }

  // If moving, keep the movement tag (e.g. TO WAR ROOM)
  if (agentState.isMoving) {
    return {
      operationalBadge: agentState.statusTag || 'MOVING',
      activeSkill: null,
      boundTools: [],
      systemPromptModifier: '',
    };
  }

  // 1. Check if the specific workstation has a bound skill
  if (agentState.stationId) {
    const stationSkill = getStationBoundSkill(agentState.stationId);
    if (stationSkill) {
      return {
        operationalBadge: `BOUND: ${stationSkill.shortCode}`,
        activeSkill: stationSkill,
        boundTools: stationSkill.providedTools,
        systemPromptModifier: stationSkill.systemPromptModifier,
      };
    }
  }

  // 2. Check if the room has bound skills
  const roomSkills = getRoomBoundSkills(agentState.room);
  if (roomSkills.length > 0) {
    const primarySkill = roomSkills[0];
    const allTools = Array.from(new Set(roomSkills.flatMap((s) => s.providedTools)));
    const combinedPrompt = roomSkills.map((s) => s.systemPromptModifier).join('\n');
    return {
      operationalBadge: `BOUND: ${primarySkill.shortCode}`,
      activeSkill: primarySkill,
      boundTools: allTools,
      systemPromptModifier: combinedPrompt,
    };
  }

  // 3. Fallback to workstation or room task tag
  return {
    operationalBadge: agentState.statusTag || defaultRoomTag,
    activeSkill: null,
    boundTools: [],
    systemPromptModifier: '',
  };
}

/**
 * Returns all active runtime tools for an agent in their current room and station.
 */
export function getAgentRuntimeTools(roomId: string, stationId?: string): string[] {
  const tools = new Set<string>();
  if (stationId) {
    const stSkill = getStationBoundSkill(stationId);
    if (stSkill) stSkill.providedTools.forEach((t) => tools.add(t));
  }
  const roomSkills = getRoomBoundSkills(roomId);
  for (const s of roomSkills) {
    s.providedTools.forEach((t) => tools.add(t));
  }
  return Array.from(tools);
}
