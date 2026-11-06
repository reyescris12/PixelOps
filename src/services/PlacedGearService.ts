import type { RoomId } from '../components/SpriteCanvas';

export interface RoomEquipmentAsset {
  stationId: string;
  name: string;
  room: RoomId;
  supportedTools: string[];
  isPowered: boolean;
  description: string;
}

const STORAGE_GEAR_KEY = 'pixelops_placed_gear_state_v1';

export const DEFAULT_ROOM_EQUIPMENT: Record<string, RoomEquipmentAsset> = {
  vault_core_rack: {
    stationId: 'vault_core_rack',
    name: 'Quantum Server Blades',
    room: 'server_vault',
    supportedTools: ['github_create_issue', 'vault_query_intel', 'osint_maritime_tracker'],
    isPowered: true,
    description: 'Encrypted blade server racks enabling repository engineering, core decryption, and live maritime AIS tracking.',
  },
  vault_laptop: {
    stationId: 'vault_laptop',
    name: 'Tactical Recon Laptop',
    room: 'server_vault',
    supportedTools: ['live_web_search', 'vault_query_intel'],
    isPowered: true,
    description: 'Secure field terminal for live web and dossier intelligence queries.',
  },
  war_center_desk: {
    stationId: 'war_center_desk',
    name: 'Tactical Command Holo-Desk',
    room: 'war_room',
    supportedTools: ['delegate_task_to_operative', 'osint_hazard_tracker'],
    isPowered: true,
    description: 'Primary strategic command desk with real-time USGS seismic feeds and global hazard telemetry overlays.',
  },
  comms_dish_console: {
    stationId: 'comms_dish_console',
    name: 'Deep-Space Satellite Dish',
    room: 'comms_tower',
    supportedTools: ['slack_post_dispatch', 'live_web_search', 'osint_spectrum_analyzer'],
    isPowered: true,
    description: 'High-gain transmission array for real-time broadcasts, spectrum surveillance, and space weather analysis.',
  },
  lib_front_desk: {
    stationId: 'lib_front_desk',
    name: 'Weather & Recon Lectern',
    room: 'library',
    supportedTools: ['weather_lookup', 'vault_query_intel', 'osint_satellite_recon'],
    isPowered: true,
    description: 'Atmospheric telemetry terminal and NASA GIBS / Copernicus satellite imagery reconnaissance desk.',
  },
  basement_omega_safe: {
    stationId: 'basement_omega_safe',
    name: 'Omega Vault Safe',
    room: 'archive_basement',
    supportedTools: ['vault_query_intel', 'github_create_issue'],
    isPowered: true,
    description: 'Subterranean security vault storing classified operational dossiers.',
  },
  lounge_holo_table: {
    stationId: 'lounge_holo_table',
    name: 'Briefing Hologram Table',
    room: 'briefing_lounge',
    supportedTools: ['calendar_schedule_event', 'slack_post_dispatch'],
    isPowered: true,
    description: 'Central tactical briefing table for scheduling field windows and briefings.',
  },
};

export function loadPlacedGearState(): Record<string, RoomEquipmentAsset> {
  try {
    const raw = localStorage.getItem(STORAGE_GEAR_KEY);
    if (!raw) return DEFAULT_ROOM_EQUIPMENT;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_ROOM_EQUIPMENT;
  } catch {
    return DEFAULT_ROOM_EQUIPMENT;
  }
}

export function savePlacedGearState(state: Record<string, RoomEquipmentAsset>) {
  try {
    localStorage.setItem(STORAGE_GEAR_KEY, JSON.stringify(state));
  } catch {
    // Ignore
  }
}

/**
 * Checks if a workstation supports a given tool and is powered on.
 */
export function workstationSupportsTool(stationId: string, toolName: string): boolean {
  const gear = loadPlacedGearState();
  const asset = gear[stationId];
  if (!asset || !asset.isPowered) return false;
  return asset.supportedTools.includes(toolName);
}
