/**
 * spriteWorld: framework-free safehouse world model shared across the app.
 *
 * Room identifiers, station/obstacle/corridor data, isometric walkability and
 * pathfinding helpers, and Town Hall seating. Extracted from SpriteCanvas.tsx so that
 * services, modals and context providers can use this data without importing the
 * (much larger) overworld canvas component.
 */
import { getAllRooms, getAllRoomStations, getAllRoomObstacles } from '../engine/roomManager';
export type RoomId =
  | 'comms_tower'
  | 'war_room'
  | 'server_vault'
  | 'armory'
  | 'briefing_lounge'
  | 'library'
  | 'archive_basement'
  | (string & {});

export const ROOM_ORDER: RoomId[] = [
  'comms_tower',
  'war_room',
  'server_vault',
  'armory',
  'briefing_lounge',
  'library',
  'archive_basement',
];

export type StationPose = 'desk' | 'laptop' | 'stand' | 'work' | 'walk' | 'walking';
export type SpriteAnimationState = 'idle' | 'walking' | 'executing' | 'working';

export interface WorkstationDef {
  id: string;
  label: string;
  xPct: number; // Center X in room (0..100)
  yPct: number; // Top Y in room (0..100)
  corridorXPct: number; // Floor corridor waypoint X directly in front of station
  corridorYPct: number; // Floor corridor walkway Y (0..100)
  pose: StationPose;
  facing: 'left' | 'right';
  taskTag: string;
}

export interface WaypointNode {
  xPct: number;
  yPct: number;
  room: RoomId;
  label?: string;
}

// Coordinate-based Floor Corridor & Ambient Wander Waypoints per Sector (All on Walkable Isometric Floor Tiles)
export const ROOM_CORRIDOR_WAYPOINTS: Record<
  RoomId,
  Array<{ id: string; label: string; xPct: number; yPct: number }>
> = {
  comms_tower: [
    { id: 'wp_comms_west', label: 'Dish Array Console Floor', xPct: 37.0, yPct: 75.0 },
    { id: 'wp_comms_mid', label: 'Transceiver South Walkway', xPct: 45.0, yPct: 83.0 },
    { id: 'wp_comms_center', label: 'Radar Deck Floor', xPct: 54.0, yPct: 84.0 },
    { id: 'wp_comms_east', label: 'East Airlock Threshold', xPct: 68.0, yPct: 73.0 },
  ],
  war_room: [
    { id: 'wp_war_west', label: 'Recon Walkway', xPct: 36.0, yPct: 77.0 },
    { id: 'wp_war_center', label: 'Command Floor', xPct: 48.0, yPct: 84.0 },
    { id: 'wp_war_east', label: 'Mainframe Floor', xPct: 64.0, yPct: 77.0 },
    { id: 'wp_war_door', label: 'Blast Door Threshold', xPct: 48.0, yPct: 64.0 },
  ],
  server_vault: [
    { id: 'wp_vault_door', label: 'Vault Airlock Floor', xPct: 52.0, yPct: 63.0 },
    { id: 'wp_vault_west', label: 'Breaker Aisle', xPct: 38.0, yPct: 77.0 },
    { id: 'wp_vault_center', label: 'Core Catwalk Floor', xPct: 50.0, yPct: 83.0 },
    { id: 'wp_vault_east', label: 'Blade Aisle', xPct: 62.0, yPct: 77.0 },
  ],
  armory: [
    { id: 'wp_arm_west', label: 'Ballistic Locker Floor', xPct: 37.0, yPct: 76.0 },
    { id: 'wp_arm_locker', label: 'Gear Staging Grating', xPct: 43.0, yPct: 68.0 },
    { id: 'wp_arm_bench', label: 'Armory Center Grating', xPct: 50.0, yPct: 82.0 },
    { id: 'wp_arm_drone', label: 'Surveillance Floor', xPct: 62.0, yPct: 77.0 },
  ],
  briefing_lounge: [
    { id: 'wp_lng_west', label: 'Radio Desk Floor', xPct: 36.0, yPct: 76.0 },
    { id: 'wp_lng_center', label: 'Briefing Floorboard', xPct: 48.0, yPct: 85.0 },
    { id: 'wp_lng_east', label: 'Espresso Bar Floor', xPct: 64.0, yPct: 77.0 },
    { id: 'wp_lng_door', label: 'Vault Door Threshold', xPct: 42.0, yPct: 66.0 },
  ],
  library: [
    { id: 'wp_lib_door', label: 'Archive Entry', xPct: 48.0, yPct: 84.0 },
    { id: 'wp_lib_west', label: 'West Lectern Walkway', xPct: 37.0, yPct: 76.0 },
    { id: 'wp_lib_center', label: 'Reading Floor', xPct: 50.0, yPct: 80.0 },
    { id: 'wp_lib_east', label: 'East Stacks Walkway', xPct: 63.0, yPct: 76.0 },
  ],
  archive_basement: [
    { id: 'wp_base_entry', label: 'Sub-Level Hatch', xPct: 35.0, yPct: 74.0 },
    { id: 'wp_base_west', label: 'Workbench Floor', xPct: 38.0, yPct: 78.0 },
    { id: 'wp_base_center', label: 'Vault Floor Stones', xPct: 48.0, yPct: 81.0 },
    { id: 'wp_base_east', label: 'Cold Storage Floor', xPct: 61.0, yPct: 78.0 },
  ],
};

// Interactive Workstation Floor Positions (Positioned on walkable floor tiles immediately adjacent to furniture props)
export const ROOM_STATIONS: Record<RoomId, WorkstationDef[]> = {
  comms_tower: [
    {
      id: 'comms_dish_console',
      label: 'Dish Array Console',
      xPct: 38.5,
      yPct: 79.0,
      corridorXPct: 38.5,
      corridorYPct: 79.0,
      pose: 'desk',
      facing: 'left',
      taskTag: 'UPLINKING',
    },
    {
      id: 'comms_cipher_rig',
      label: 'Signal Transceiver',
      xPct: 48.0,
      yPct: 83.5,
      corridorXPct: 48.0,
      corridorYPct: 83.5,
      pose: 'laptop',
      facing: 'right',
      taskTag: 'DISPATCHING',
    },
    {
      id: 'comms_radar_scope',
      label: 'Blast Door Relay',
      xPct: 66.0,
      yPct: 74.5,
      corridorXPct: 66.0,
      corridorYPct: 74.5,
      pose: 'work',
      facing: 'right',
      taskTag: 'SWEEPING',
    },
  ],
  war_room: [
    {
      id: 'war_left_desk',
      label: 'Recon Monitors',
      xPct: 37.0,
      yPct: 78.5,
      corridorXPct: 37.0,
      corridorYPct: 78.5,
      pose: 'desk',
      facing: 'left',
      taskTag: 'SCANNING',
    },
    {
      id: 'war_center_desk',
      label: 'Holo Globe Table',
      xPct: 48.0,
      yPct: 83.5,
      corridorXPct: 48.0,
      corridorYPct: 83.5,
      pose: 'desk',
      facing: 'right',
      taskTag: 'EXECUTING',
    },
    {
      id: 'war_server_rack',
      label: 'Mainframe Consoles',
      xPct: 63.5,
      yPct: 78.5,
      corridorXPct: 63.5,
      corridorYPct: 78.5,
      pose: 'work',
      facing: 'right',
      taskTag: 'HACKING',
    },
    {
      id: 'war_aux_rack',
      label: 'Server Bank #4',
      xPct: 55.0,
      yPct: 67.5,
      corridorXPct: 55.0,
      corridorYPct: 67.5,
      pose: 'work',
      facing: 'right',
      taskTag: 'DIAGNOSTICS',
    },
  ],
  server_vault: [
    {
      id: 'vault_laptop',
      label: 'Rack Terminal',
      xPct: 39.5,
      yPct: 67.5,
      corridorXPct: 39.5,
      corridorYPct: 67.5,
      pose: 'laptop',
      facing: 'left',
      taskTag: 'COMPILING',
    },
    {
      id: 'vault_core_rack',
      label: 'Cryo Core Column',
      xPct: 50.0,
      yPct: 81.5,
      corridorXPct: 50.0,
      corridorYPct: 81.5,
      pose: 'work',
      facing: 'right',
      taskTag: 'HACKING',
    },
    {
      id: 'vault_breakers',
      label: 'Power Relays',
      xPct: 38.5,
      yPct: 78.5,
      corridorXPct: 38.5,
      corridorYPct: 78.5,
      pose: 'stand',
      facing: 'left',
      taskTag: 'MONITORING',
    },
  ],
  armory: [
    {
      id: 'armory_gear_rack',
      label: 'Ballistic Rack',
      xPct: 37.5,
      yPct: 78.5,
      corridorXPct: 37.5,
      corridorYPct: 78.5,
      pose: 'stand',
      facing: 'left',
      taskTag: 'GEAR CHECK',
    },
    {
      id: 'armory_workbench',
      label: 'Vault Blast Door',
      xPct: 44.0,
      yPct: 66.0,
      corridorXPct: 44.0,
      corridorYPct: 66.0,
      pose: 'work',
      facing: 'left',
      taskTag: 'CALIBRATING',
    },
    {
      id: 'armory_drone_bay',
      label: 'Calibration Rig',
      xPct: 61.0,
      yPct: 80.0,
      corridorXPct: 61.0,
      corridorYPct: 80.0,
      pose: 'laptop',
      facing: 'right',
      taskTag: 'SURVEILLANCE',
    },
  ],
  briefing_lounge: [
    {
      id: 'lounge_coffee_bar',
      label: 'Espresso Station',
      xPct: 63.5,
      yPct: 78.0,
      corridorXPct: 63.5,
      corridorYPct: 78.0,
      pose: 'stand',
      facing: 'right',
      taskTag: 'COFFEE BREAK',
    },
    {
      id: 'lounge_holo_table',
      label: 'Comms & Map Desk',
      xPct: 36.5,
      yPct: 77.0,
      corridorXPct: 36.5,
      corridorYPct: 77.0,
      pose: 'desk',
      facing: 'left',
      taskTag: 'SCHEDULING',
    },
    {
      id: 'lounge_sofa',
      label: 'Chesterfield Sofa',
      xPct: 48.0,
      yPct: 85.0,
      corridorXPct: 48.0,
      corridorYPct: 85.0,
      pose: 'stand',
      facing: 'left',
      taskTag: 'STANDBY',
    },
  ],
  library: [
    {
      id: 'lib_front_desk',
      label: 'Archivist Desk',
      xPct: 50.0,
      yPct: 81.5,
      corridorXPct: 50.0,
      corridorYPct: 81.5,
      pose: 'desk',
      facing: 'left',
      taskTag: 'INDEXING',
    },
    {
      id: 'lib_east_stacks',
      label: 'East Book Stacks',
      xPct: 62.5,
      yPct: 77.0,
      corridorXPct: 62.5,
      corridorYPct: 77.0,
      pose: 'work',
      facing: 'right',
      taskTag: 'DECRYPTING',
    },
    {
      id: 'lib_west_stacks',
      label: 'Cipher Lectern',
      xPct: 38.0,
      yPct: 77.0,
      corridorXPct: 38.0,
      corridorYPct: 77.0,
      pose: 'stand',
      facing: 'left',
      taskTag: 'SEARCHING',
    },
  ],
  archive_basement: [
    {
      id: 'basement_microfiche',
      label: 'Microfiche Workbench',
      xPct: 38.0,
      yPct: 78.0,
      corridorXPct: 38.0,
      corridorYPct: 78.0,
      pose: 'desk',
      facing: 'left',
      taskTag: 'COLD ARCHIVE',
    },
    {
      id: 'basement_omega_safe',
      label: 'Omega Vault Door',
      xPct: 46.0,
      yPct: 65.0,
      corridorXPct: 46.0,
      corridorYPct: 65.0,
      pose: 'work',
      facing: 'left',
      taskTag: 'UNSEALING',
    },
    {
      id: 'basement_pneumatic',
      label: 'Cold Storage Crates',
      xPct: 59.0,
      yPct: 80.0,
      corridorXPct: 59.0,
      corridorYPct: 80.0,
      pose: 'stand',
      facing: 'right',
      taskTag: 'ROUTING',
    },
  ],
};

export interface RoomMetadataDef {
  id: RoomId;
  spyTitle: string;
  monsterTitle: string;
  vikingTitle: string;
  shortBadge: string;
  sectorCode: string;
  wingLabel: 'UPPER DECK' | 'LOWER DECK';
  gridCol: number; // 0..3
  gridRow: number; // 0..1
  neighbors: RoomId[];
  defaultAgentIndex: number;
  idleTag: string;
  activeTag: string;
  defaultBriefing: string;
  cleanBackdropUrl: string;
  backdropFilter: string;
  objectPosition?: string;
  doorX: number;
  doorY: number;
}

export const ROOM_METADATA: Record<RoomId, RoomMetadataDef> = {
  comms_tower: {
    id: 'comms_tower',
    spyTitle: 'Spy Safehouse · Comms Tower [W-01]',
    monsterTitle: 'Monster Lab · Radio Tower [W-01]',
    vikingTitle: 'Viking Longhall · Signal Beacon [W-01]',
    shortBadge: 'COMMS TOWER',
    sectorCode: 'SEC-A1',
    wingLabel: 'UPPER DECK',
    gridCol: 0,
    gridRow: 0,
    neighbors: ['war_room', 'briefing_lounge'],
    defaultAgentIndex: 1,
    idleTag: 'SIGNAL WATCH',
    activeTag: 'DISPATCHING',
    defaultBriefing:
      'Comms Tower dish array locked onto orbital relay. Shortwave and Slack frequencies clear.',
    cleanBackdropUrl: '/assets/rooms/comms_tower_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 68.0,
    doorY: 73.0,
  },
  war_room: {
    id: 'war_room',
    spyTitle: 'Spy Safehouse · War Room [C-01]',
    monsterTitle: 'Monster Lab · Command Deck [C-01]',
    vikingTitle: 'Viking Longhall · War Table [C-01]',
    shortBadge: 'WAR ROOM',
    sectorCode: 'SEC-B1',
    wingLabel: 'UPPER DECK',
    gridCol: 1,
    gridRow: 0,
    neighbors: ['comms_tower', 'server_vault', 'library'],
    defaultAgentIndex: 0,
    idleTag: 'IDLE',
    activeTag: 'EXECUTING',
    defaultBriefing:
      'Target acquired. Scanning web nodes for flight data... [2/3] Parsing JSON.',
    cleanBackdropUrl: '/assets/rooms/war_room_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 48.0,
    doorY: 64.0,
  },
  server_vault: {
    id: 'server_vault',
    spyTitle: 'Spy Safehouse · Server Vault [E-01]',
    monsterTitle: 'Monster Lab · Mainframe Vault [E-01]',
    vikingTitle: 'Viking Longhall · Rune Vault [E-01]',
    shortBadge: 'SERVER VAULT',
    sectorCode: 'SEC-C1',
    wingLabel: 'UPPER DECK',
    gridCol: 2,
    gridRow: 0,
    neighbors: ['war_room', 'armory', 'archive_basement'],
    defaultAgentIndex: 1,
    idleTag: 'IDLE',
    activeTag: 'HACKING',
    defaultBriefing:
      'Mainframe link established. Routing encrypted packets through Server Vault nodes.',
    cleanBackdropUrl: '/assets/rooms/server_vault_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 52.0,
    doorY: 63.0,
  },
  armory: {
    id: 'armory',
    spyTitle: 'Spy Safehouse · Tactical Armory [E-02]',
    monsterTitle: 'Monster Lab · Battle Gear Bay [E-02]',
    vikingTitle: 'Viking Longhall · Weapon Forge [E-02]',
    shortBadge: 'ARMORY',
    sectorCode: 'SEC-D1',
    wingLabel: 'UPPER DECK',
    gridCol: 3,
    gridRow: 0,
    neighbors: ['server_vault', 'archive_basement'],
    defaultAgentIndex: 0,
    idleTag: 'GEAR CHECK',
    activeTag: 'CALIBRATING',
    defaultBriefing:
      'Tactical Armory online. Ballistic vests, field drones, and bypass rigs calibrated.',
    cleanBackdropUrl: '/assets/rooms/armory_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 43.0,
    doorY: 67.0,
  },
  briefing_lounge: {
    id: 'briefing_lounge',
    spyTitle: 'Spy Safehouse · Briefing Lounge [W-02]',
    monsterTitle: 'Monster Lab · Trainer Lounge [W-02]',
    vikingTitle: 'Viking Longhall · Mead Hearth [W-02]',
    shortBadge: 'LOUNGE',
    sectorCode: 'SEC-A2',
    wingLabel: 'LOWER DECK',
    gridCol: 0,
    gridRow: 1,
    neighbors: ['comms_tower', 'library'],
    defaultAgentIndex: 0,
    idleTag: 'COFFEE BREAK',
    activeTag: 'SCHEDULING',
    defaultBriefing:
      'Briefing Lounge quiet. Espresso machine steaming; operatives reviewing calendar schedules.',
    cleanBackdropUrl: '/assets/rooms/briefing_lounge_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 42.0,
    doorY: 66.0,
  },
  library: {
    id: 'library',
    spyTitle: 'Spy Safehouse · Intel Library [C-02]',
    monsterTitle: 'Monster Lab · Archive Library [C-02]',
    vikingTitle: 'Viking Longhall · Saga Library [C-02]',
    shortBadge: 'LIBRARY',
    sectorCode: 'SEC-B2',
    wingLabel: 'LOWER DECK',
    gridCol: 1,
    gridRow: 1,
    neighbors: ['briefing_lounge', 'war_room', 'archive_basement'],
    defaultAgentIndex: 2,
    idleTag: 'IDLE',
    activeTag: 'DECRYPTING',
    defaultBriefing:
      'Front desk duty. All systems nominal. Monitoring library archives.',
    cleanBackdropUrl: '/assets/rooms/library_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 48.0,
    doorY: 84.0,
  },
  archive_basement: {
    id: 'archive_basement',
    spyTitle: 'Spy Safehouse · Archive Basement [E-03]',
    monsterTitle: 'Monster Lab · Deep Laboratory [E-03]',
    vikingTitle: 'Viking Longhall · Runic Crypt [E-03]',
    shortBadge: 'BASEMENT',
    sectorCode: 'SEC-C2',
    wingLabel: 'LOWER DECK',
    gridCol: 2,
    gridRow: 1,
    neighbors: ['library', 'server_vault', 'armory'],
    defaultAgentIndex: 2,
    idleTag: 'COLD STORAGE',
    activeTag: 'UNSEALING',
    defaultBriefing:
      'Sub-level Archive Basement sealed at Omega clearance. Microfiche & cold dossiers verified.',
    cleanBackdropUrl: '/assets/rooms/archive_basement_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 46.0,
    doorY: 64.0,
  },
};

export interface ObstacleBox {
  id: string;
  label: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  isCentralStructure?: boolean;
}

export const AGENT_CLEARANCE_X = 2.4; // Horizontal clearance margin (~19-20px)
export const AGENT_CLEARANCE_Y = 1.8; // Vertical clearance margin (~14-16px)
export const CENTRAL_EXTRA_CLEARANCE_X = 0.8; // Additional clearance buffer for central structures (~6px)
export const CENTRAL_EXTRA_CLEARANCE_Y = 0.6; // Additional clearance buffer for central structures (~5px)
export const SAFE_PERIMETER_OFFSET = 3.2; // Safe stopping perimeter offset (16-32px away from structure edge)

/**
 * Static Furniture & Structural Prop Collision Bounding Boxes per Sector.
 * Defines explicit blocking bounding boxes for central room structures (War Room Holo-Table,
 * Server Vault Cryo Core, Armory Weapon Consoles, Lounge Sofas, etc.) and wall assets.
 */
export const ROOM_OBSTACLES: Record<RoomId, ObstacleBox[]> = {
  comms_tower: [
    { id: 'obs_comms_west_desk', label: 'Dish Array Console', xMin: 24.0, xMax: 35.5, yMin: 66.0, yMax: 78.0 },
    { id: 'obs_comms_transceiver', label: 'Central Signal Transceiver & Terminal', xMin: 43.0, xMax: 57.0, yMin: 67.0, yMax: 79.0, isCentralStructure: true },
  ],
  war_room: [
    { id: 'obs_war_holo_table', label: 'Central Holo-Globe Command Table', xMin: 43.0, xMax: 57.0, yMin: 70.0, yMax: 79.5, isCentralStructure: true },
    { id: 'obs_war_west_desk', label: 'West Recon Desk', xMin: 24.0, xMax: 33.5, yMin: 68.0, yMax: 79.0 },
    { id: 'obs_war_east_rack', label: 'East Mainframe Rack', xMin: 66.5, xMax: 76.0, yMin: 68.0, yMax: 79.0 },
  ],
  server_vault: [
    { id: 'obs_vault_cryo_core', label: 'Central Cryo Core Column & Server Racks', xMin: 44.0, xMax: 56.0, yMin: 67.0, yMax: 77.0, isCentralStructure: true },
    { id: 'obs_vault_west_breakers', label: 'West Power Relays', xMin: 24.0, xMax: 35.5, yMin: 66.0, yMax: 78.0 },
    { id: 'obs_vault_east_blades', label: 'East Server Blades', xMin: 64.0, xMax: 76.0, yMin: 66.0, yMax: 78.0 },
  ],
  armory: [
    { id: 'obs_arm_central_rack', label: 'Central Weapon Console & Inspection Bench', xMin: 43.0, xMax: 57.0, yMin: 69.0, yMax: 78.5, isCentralStructure: true },
    { id: 'obs_arm_west_lockers', label: 'West Ballistic Lockers', xMin: 24.0, xMax: 34.5, yMin: 68.0, yMax: 80.0 },
    { id: 'obs_arm_east_rig', label: 'East Calibration Rig & Crates', xMin: 64.0, xMax: 76.0, yMin: 70.0, yMax: 81.0 },
  ],
  briefing_lounge: [
    { id: 'obs_lng_sofa', label: 'Central Chesterfield Sofa & Coffee Table', xMin: 42.0, xMax: 58.0, yMin: 71.0, yMax: 81.5, isCentralStructure: true },
    { id: 'obs_lng_west_desk', label: 'West Comms & Map Desk', xMin: 24.0, xMax: 33.5, yMin: 68.0, yMax: 79.0 },
    { id: 'obs_lng_east_bar', label: 'East Espresso Bar', xMin: 66.0, xMax: 76.0, yMin: 68.0, yMax: 79.0 },
  ],
  library: [
    { id: 'obs_lib_archivist_desk', label: 'Central Archivist Desk & Reading Table', xMin: 43.0, xMax: 57.0, yMin: 68.0, yMax: 77.5, isCentralStructure: true },
    { id: 'obs_lib_west_stacks', label: 'West Book Stacks', xMin: 24.0, xMax: 35.0, yMin: 65.0, yMax: 77.0 },
    { id: 'obs_lib_east_stacks', label: 'East Book Stacks', xMin: 65.5, xMax: 76.0, yMin: 65.0, yMax: 77.0 },
  ],
  archive_basement: [
    { id: 'obs_base_central_generator', label: 'Central Power Generator & Sub-Level Core', xMin: 43.0, xMax: 57.0, yMin: 68.0, yMax: 77.5, isCentralStructure: true },
    { id: 'obs_base_west_bench', label: 'Microfiche Workbench', xMin: 24.0, xMax: 35.0, yMin: 68.0, yMax: 79.0 },
    { id: 'obs_base_east_crates', label: 'Cold Storage Crates', xMin: 62.0, xMax: 76.0, yMin: 70.0, yMax: 82.0 },
  ],
};

export function getRoomMeta(roomId: RoomId): RoomMetadataDef {
  const all = getAllRooms();
  return all[roomId] || ROOM_METADATA[roomId] || ROOM_METADATA.war_room;
}

export function getRoomObs(roomId: RoomId): ObstacleBox[] {
  const all = getAllRoomObstacles();
  return all[roomId] || ROOM_OBSTACLES[roomId] || [];
}

export function getRoomStns(roomId: RoomId): WorkstationDef[] {
  const all = getAllRoomStations();
  return all[roomId] || ROOM_STATIONS[roomId] || ROOM_STATIONS.war_room;
}

/**
 * Checks whether a coordinate `(x, y)` lies strictly inside the 2:1 isometric
 * floor diamond of the cutaway box-room, respecting back perimeter walls and front cutaway edges.
 */
export function isInsideIsometricFloor(_room: RoomId, x: number, y: number): boolean {
  if (x < 28 || x > 72) return false;
  const distFromCenter = Math.abs(x - 50);
  // Angled back-left and back-right walls slope downward at ~0.46 Y per X unit from (50, 61.5)
  const yMinWall = 61.5 + distFromCenter * 0.46;
  // Front-left and front-right cutaway floor edges slope upward at ~0.46 Y per X unit from (50, 88.5)
  const yMaxFloor = 88.5 - distFromCenter * 0.46;
  return y >= yMinWall && y <= yMaxFloor;
}

/**
 * Checks whether `(x, y)` collides with any static furniture/prop bounding box in `room`,
 * taking into account horizontal and vertical agent clearance exclusion zones.
 */
export function isCollidingWithObstacle(
  room: RoomId,
  x: number,
  y: number,
  clearanceX: number = AGENT_CLEARANCE_X,
  clearanceY: number = AGENT_CLEARANCE_Y
): boolean {
  const obstacles = getRoomObs(room);
  for (const box of obstacles) {
    const isCentral = box.isCentralStructure;
    const padX = clearanceX + (isCentral ? CENTRAL_EXTRA_CLEARANCE_X : 0);
    const padY = clearanceY + (isCentral ? CENTRAL_EXTRA_CLEARANCE_Y : 0);
    if (
      x >= box.xMin - padX &&
      x <= box.xMax + padX &&
      y >= box.yMin - padY &&
      y <= box.yMax + padY
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if `(x, y)` is both strictly inside the isometric room floor diamond
 * AND free of static furniture / central structure collisions within exclusion clearances.
 */
export function isWalkablePoint(
  room: RoomId,
  x: number,
  y: number,
  clearanceX: number = AGENT_CLEARANCE_X,
  clearanceY: number = AGENT_CLEARANCE_Y
): boolean {
  return (
    isInsideIsometricFloor(room, x, y) &&
    !isCollidingWithObstacle(room, x, y, clearanceX, clearanceY)
  );
}

/**
 * Calculates Euclidean distance from point (x, y) to the nearest central structure's bounding box.
 * Used for soft node-weighting so pathfinding naturally curves around central tables.
 */
export function distanceToCentralStructure(room: RoomId, x: number, y: number): number {
  const obstacles = getRoomObs(room);
  let minDist = Infinity;
  for (const box of obstacles) {
    if (!box.isCentralStructure) continue;
    const dx = Math.max(box.xMin - x, 0, x - box.xMax);
    const dy = Math.max(box.yMin - y, 0, y - box.yMax);
    const d = Math.hypot(dx, dy);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Ensures agents stop at a safe interaction perimeter (16-32 pixels away from the edge of the structure)
 * rather than snapping directly onto or inside the asset.
 */
export function snapToSafeInteractionPerimeter(
  room: RoomId,
  x: number,
  y: number
): { xPct: number; yPct: number } {
  const obstacles = getRoomObs(room);
  for (const box of obstacles) {
    const padX = AGENT_CLEARANCE_X + (box.isCentralStructure ? CENTRAL_EXTRA_CLEARANCE_X : 0);
    const padY = AGENT_CLEARANCE_Y + (box.isCentralStructure ? CENTRAL_EXTRA_CLEARANCE_Y : 0);
    if (
      x >= box.xMin - padX &&
      x <= box.xMax + padX &&
      y >= box.yMin - padY &&
      y <= box.yMax + padY
    ) {
      const candidates = [
        { x: x, y: box.yMax + SAFE_PERIMETER_OFFSET }, // South perimeter (facing North)
        { x: x, y: box.yMin - SAFE_PERIMETER_OFFSET }, // North perimeter (facing South)
        { x: box.xMin - SAFE_PERIMETER_OFFSET, y: y }, // West perimeter (facing East)
        { x: box.xMax + SAFE_PERIMETER_OFFSET, y: y }, // East perimeter (facing West)
      ];
      let best = candidates[0];
      let bestDist = Infinity;
      for (const cand of candidates) {
        if (
          isInsideIsometricFloor(room, cand.x, cand.y) &&
          !isCollidingWithObstacle(room, cand.x, cand.y)
        ) {
          const d = Math.hypot(cand.x - x, cand.y - y);
          if (d < bestDist) {
            bestDist = d;
            best = cand;
          }
        }
      }
      return { xPct: Number(best.x.toFixed(2)), yPct: Number(best.y.toFixed(2)) };
    }
  }
  return { xPct: Number(x.toFixed(2)), yPct: Number(y.toFixed(2)) };
}

/**
 * Snaps any arbitrary `(x, y)` coordinate to the nearest valid walkable isometric floor position
 * so agents never stand inside walls, outside cutaway edges, or on top of furniture props.
 */
export function snapToWalkableFloor(
  room: RoomId,
  x: number,
  y: number
): { xPct: number; yPct: number } {
  const safePerimeter = snapToSafeInteractionPerimeter(room, x, y);
  if (isWalkablePoint(room, safePerimeter.xPct, safePerimeter.yPct)) {
    return safePerimeter;
  }

  let bestX = 48.0;
  let bestY = 83.0;
  let bestDist = Infinity;

  for (let gx = 30; gx <= 70; gx += 1.0) {
    for (let gy = 62; gy <= 87; gy += 1.0) {
      if (isWalkablePoint(room, gx, gy)) {
        const d = Math.hypot(gx - x, gy - y);
        if (d < bestDist) {
          bestDist = d;
          bestX = gx;
          bestY = gy;
        }
      }
    }
  }

  return { xPct: Number(bestX.toFixed(2)), yPct: Number(bestY.toFixed(2)) };
}

/**
 * Checks if the straight segment from `(x1, y1)` to `(x2, y2)` stays completely inside
 * the walkable isometric floor and never clips through any furniture or central structure exclusion zone.
 */
function isLineOfSightWalkable(
  room: RoomId,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  clearanceX: number = AGENT_CLEARANCE_X,
  clearanceY: number = AGENT_CLEARANCE_Y
): boolean {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(4, Math.ceil(dist / 1.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ix = x1 + (x2 - x1) * t;
    const iy = y1 + (y2 - y1) * t;
    if (!isWalkablePoint(room, ix, iy, clearanceX, clearanceY)) {
      return false;
    }
  }
  return true;
}

/**
 * Geometric line-segment vs 2D axis-aligned bounding box collision test.
 * Used by vector waypoint flushing to detect whether a straight trajectory cuts across a central structure.
 */
function lineSegmentIntersectsBox(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  box: ObstacleBox,
  padX: number = AGENT_CLEARANCE_X,
  padY: number = AGENT_CLEARANCE_Y
): boolean {
  const minX = box.xMin - padX;
  const maxX = box.xMax + padX;
  const minY = box.yMin - padY;
  const maxY = box.yMax + padY;

  // Segment bounding box reject test
  if (
    Math.max(p1.x, p2.x) < minX ||
    Math.min(p1.x, p2.x) > maxX ||
    Math.max(p1.y, p2.y) < minY ||
    Math.min(p1.y, p2.y) > maxY
  ) {
    return false;
  }

  // Point inside box test
  if (
    (p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY) ||
    (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY)
  ) {
    return true;
  }

  const edges = [
    { a: { x: minX, y: minY }, b: { x: maxX, y: minY } },
    { a: { x: maxX, y: minY }, b: { x: maxX, y: maxY } },
    { a: { x: maxX, y: maxY }, b: { x: minX, y: maxY } },
    { a: { x: minX, y: maxY }, b: { x: minX, y: minY } },
  ];

  function ccw(A: { x: number; y: number }, B: { x: number; y: number }, C: { x: number; y: number }) {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  }
  function intersect(
    A: { x: number; y: number },
    B: { x: number; y: number },
    C: { x: number; y: number },
    D: { x: number; y: number }
  ) {
    return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D);
  }

  for (const edge of edges) {
    if (intersect(p1, p2, edge.a, edge.b)) return true;
  }
  return false;
}

/**
 * Vector Waypoint Flushing (Avoidance Routing):
 * Scans path segments and dynamically injects intermediate curved offset nodes if any trajectory
 * cuts through a central structure's bounding box.
 */
function injectCentralStructureAvoidanceWaypoints(
  room: RoomId,
  rawPoints: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  const obstacles = getRoomObs(room);
  const centralBox = obstacles.find((b) => b.isCentralStructure);
  if (!centralBox || rawPoints.length < 2) return rawPoints;

  const result: Array<{ x: number; y: number }> = [rawPoints[0]];
  for (let i = 0; i < rawPoints.length - 1; i++) {
    const p1 = rawPoints[i];
    const p2 = rawPoints[i + 1];

    if (lineSegmentIntersectsBox(p1, p2, centralBox)) {
      const padX = AGENT_CLEARANCE_X + CENTRAL_EXTRA_CLEARANCE_X + 1.0;
      const padY = AGENT_CLEARANCE_Y + CENTRAL_EXTRA_CLEARANCE_Y + 0.8;

      const nw = { x: centralBox.xMin - padX, y: centralBox.yMin - padY };
      const ne = { x: centralBox.xMax + padX, y: centralBox.yMin - padY };
      const sw = { x: centralBox.xMin - padX, y: centralBox.yMax + padY };
      const se = { x: centralBox.xMax + padX, y: centralBox.yMax + padY };

      const westArc = [nw, sw].filter(
        (p) => isInsideIsometricFloor(room, p.x, p.y) && !isCollidingWithObstacle(room, p.x, p.y)
      );
      const eastArc = [ne, se].filter(
        (p) => isInsideIsometricFloor(room, p.x, p.y) && !isCollidingWithObstacle(room, p.x, p.y)
      );
      const northArc = [nw, ne].filter(
        (p) => isInsideIsometricFloor(room, p.x, p.y) && !isCollidingWithObstacle(room, p.x, p.y)
      );
      const southArc = [sw, se].filter(
        (p) => isInsideIsometricFloor(room, p.x, p.y) && !isCollidingWithObstacle(room, p.x, p.y)
      );

      const candidates = [westArc, eastArc, northArc, southArc].filter((arc) => arc.length > 0);
      let bestArc = westArc;
      let bestArcDist = Infinity;

      for (const arc of candidates) {
        let total = Math.hypot(arc[0].x - p1.x, arc[0].y - p1.y);
        for (let j = 0; j < arc.length - 1; j++) {
          total += Math.hypot(arc[j + 1].x - arc[j].x, arc[j + 1].y - arc[j].y);
        }
        total += Math.hypot(p2.x - arc[arc.length - 1].x, p2.y - arc[arc.length - 1].y);
        if (total < bestArcDist) {
          bestArcDist = total;
          bestArc = arc;
        }
      }

      if (bestArc && bestArc.length > 0) {
        result.push(...bestArc);
      }
    }
    result.push(p2);
  }
  return result;
}

/**
 * Computes an A* obstacle-avoiding & wall-respecting waypoint path within a single isometric room
 * from `(startX, startY)` to `(endX, endY)`, utilizing high-resolution grid pathfinding,
 * proximity node-weighting, vector waypoint flushing, and clearance-preserving string pulling.
 */
function buildSingleRoomWaypoints(
  room: RoomId,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  endLabel?: string
): WaypointNode[] {
  const safeStart = snapToWalkableFloor(room, startX, startY);
  const safeEnd = snapToWalkableFloor(room, endX, endY);

  if (Math.hypot(safeEnd.xPct - safeStart.xPct, safeEnd.yPct - safeStart.yPct) < 1.0) {
    return [
      {
        xPct: safeEnd.xPct,
        yPct: safeEnd.yPct,
        room,
        label: endLabel || 'Target Station',
      },
    ];
  }

  // Fast path if line of sight is completely clear of walls, furniture, and central structures
  if (
    isLineOfSightWalkable(
      room,
      safeStart.xPct,
      safeStart.yPct,
      safeEnd.xPct,
      safeEnd.yPct
    )
  ) {
    return [
      {
        xPct: safeEnd.xPct,
        yPct: safeEnd.yPct,
        room,
        label: endLabel || 'Target Station',
      },
    ];
  }

  // High-resolution 1.25% 8-directional A* navigation grid over the isometric floor
  const STEP = 1.25;
  const toKey = (gx: number, gy: number) => `${gx.toFixed(1)},${gy.toFixed(1)}`;
  const snapGrid = (val: number) => Math.round(val / STEP) * STEP;

  const startGX = snapGrid(safeStart.xPct);
  const startGY = snapGrid(safeStart.yPct);
  const endGX = snapGrid(safeEnd.xPct);
  const endGY = snapGrid(safeEnd.yPct);

  interface AStarNode {
    gx: number;
    gy: number;
    g: number;
    f: number;
    parent: AStarNode | null;
  }

  const open: AStarNode[] = [
    {
      gx: startGX,
      gy: startGY,
      g: 0,
      f: Math.hypot(endGX - startGX, endGY - startGY),
      parent: null,
    },
  ];
  const bestG = new Map<string, number>();
  bestG.set(toKey(startGX, startGY), 0);

  const dirs = [
    [STEP, 0],
    [-STEP, 0],
    [0, STEP],
    [0, -STEP],
    [STEP, STEP],
    [STEP, -STEP],
    [-STEP, STEP],
    [-STEP, -STEP],
  ];

  let foundGoal: AStarNode | null = null;
  let closestNode: AStarNode = open[0];
  let closestDist = Math.hypot(endGX - startGX, endGY - startGY);
  let iterations = 0;

  while (open.length > 0 && iterations < 350) {
    iterations++;
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];

    const distToGoal = Math.hypot(endGX - current.gx, endGY - current.gy);
    if (distToGoal < closestDist) {
      closestDist = distToGoal;
      closestNode = current;
    }

    if (distToGoal <= STEP * 1.2) {
      foundGoal = current;
      break;
    }

    for (const [dx, dy] of dirs) {
      const nx = current.gx + dx;
      const ny = current.gy + dy;

      const isGoalTile = Math.hypot(endGX - nx, endGY - ny) <= STEP;
      if (!isGoalTile && !isWalkablePoint(room, nx, ny)) continue;

      // Prevent diagonal corner cutting across furniture or walls
      if (dx !== 0 && dy !== 0) {
        if (
          !isWalkablePoint(room, current.gx + dx, current.gy) ||
          !isWalkablePoint(room, current.gx, current.gy + dy)
        ) {
          continue;
        }
      }

      // Proximity node weighting: soft cost penalty for walking directly against central structures
      const distToCentral = distanceToCentralStructure(room, nx, ny);
      const proximityPenalty = distToCentral < 5.0 ? (5.0 - distToCentral) * 2.8 : 0;

      const stepCost = Math.hypot(dx, dy) + proximityPenalty;
      const tentativeG = current.g + stepCost;
      const key = toKey(nx, ny);
      if (tentativeG < (bestG.get(key) ?? Infinity)) {
        bestG.set(key, tentativeG);
        open.push({
          gx: nx,
          gy: ny,
          g: tentativeG,
          f: tentativeG + Math.hypot(endGX - nx, endGY - ny),
          parent: current,
        });
      }
    }
  }

  const rawPoints: Array<{ x: number; y: number }> = [];
  let trace: AStarNode | null = foundGoal || closestNode;
  while (trace) {
    rawPoints.unshift({ x: trace.gx, y: trace.gy });
    trace = trace.parent;
  }
  rawPoints.push({ x: safeEnd.xPct, y: safeEnd.yPct });

  // Vector waypoint flushing: inject intermediate clearance nodes if any segment clips the central structure
  const flushed = injectCentralStructureAvoidanceWaypoints(room, rawPoints);

  // String-pulling path smoothing: collapse collinear/visible waypoints while strictly preserving obstacle clearance
  const smoothed: Array<{ x: number; y: number }> = [flushed[0]];
  let anchorIdx = 0;
  while (anchorIdx < flushed.length - 1) {
    let nextIdx = anchorIdx + 1;
    for (let probe = flushed.length - 1; probe > anchorIdx + 1; probe--) {
      if (
        isLineOfSightWalkable(
          room,
          flushed[anchorIdx].x,
          flushed[anchorIdx].y,
          flushed[probe].x,
          flushed[probe].y
        )
      ) {
        nextIdx = probe;
        break;
      }
    }
    smoothed.push(flushed[nextIdx]);
    anchorIdx = nextIdx;
  }

  const waypoints: WaypointNode[] = smoothed.slice(1).map((pt, idx, arr) => ({
    xPct: Number(pt.x.toFixed(2)),
    yPct: Number(pt.y.toFixed(2)),
    room,
    label: idx === arr.length - 1 ? endLabel || 'Target Station' : 'Floor Route',
  }));

  if (waypoints.length === 0) {
    waypoints.push({
      xPct: safeEnd.xPct,
      yPct: safeEnd.yPct,
      room,
      label: endLabel || 'Target Station',
    });
  }

  return waypoints;
}

/**
 * Finds a shortest sector-to-sector path across the 7-sector overworld graph
 * so agents visibly traverse intermediate corridors/lifts when moving across the facility.
 */
function findSectorRoute(fromRoom: RoomId, toRoom: RoomId): RoomId[] {
  if (fromRoom === toRoom) return [fromRoom];
  const queue: RoomId[][] = [[fromRoom]];
  const visited = new Set<RoomId>([fromRoom]);
  let iters = 0;

  while (queue.length > 0 && iters++ < 50) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    const neighbors = getRoomMeta(current)?.neighbors || [];
    for (const next of neighbors) {
      if (next === toRoom) {
        return [...path, next];
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return [fromRoom, toRoom];
}

/**
 * Computes a complete autonomous waypoint path from an agent's current position/sector
 * to the target workstation in `destRoom` across the multi-wing overworld.
 */
export function buildAgentWaypointPath(
  fromRoom: RoomId,
  startX: number,
  startY: number,
  destRoom: RoomId,
  destStation: WorkstationDef
): WaypointNode[] {
  const targetX = destStation.corridorXPct ?? destStation.xPct;
  const targetY = destStation.corridorYPct ?? destStation.yPct;

  if (fromRoom === destRoom) {
    return buildSingleRoomWaypoints(
      fromRoom,
      startX,
      startY,
      targetX,
      targetY,
      destStation.label
    );
  }

  const sectorRoute = findSectorRoute(fromRoom, destRoom);
  const fullNodes: WaypointNode[] = [];

  // 1. Walk to exit door/lift of starting room
  const exitMeta = getRoomMeta(fromRoom);
  fullNodes.push(
    ...buildSingleRoomWaypoints(
      fromRoom,
      startX,
      startY,
      exitMeta.doorX,
      exitMeta.doorY,
      `${exitMeta.shortBadge} Transit`
    )
  );

  // 2. If traversing an intermediate corridor sector, route cleanly across its walkable floor diamond
  for (let i = 1; i < sectorRoute.length - 1; i++) {
    const midRoom = sectorRoute[i];
    const midMeta = getRoomMeta(midRoom);
    const transitPath = buildSingleRoomWaypoints(
      midRoom,
      36.0,
      76.0,
      64.0,
      76.0,
      `${midMeta.shortBadge} Transit`
    );
    fullNodes.push({
      xPct: 36.0,
      yPct: 76.0,
      room: midRoom,
      label: `${midMeta.shortBadge} West Walkway`,
    });
    fullNodes.push(...transitPath);
  }

  // 3. Spawn at destination sector threshold and walk along its corridor to target workstation
  const entryMeta = getRoomMeta(destRoom);
  const safeEntry = snapToWalkableFloor(destRoom, entryMeta.doorX, entryMeta.doorY);
  fullNodes.push({
    xPct: safeEntry.xPct,
    yPct: safeEntry.yPct,
    room: destRoom,
    label: `${entryMeta.shortBadge} Entry`,
  });

  fullNodes.push(
    ...buildSingleRoomWaypoints(
      destRoom,
      safeEntry.xPct,
      safeEntry.yPct,
      targetX,
      targetY,
      destStation.label
    )
  );

  return fullNodes;
}

export interface LiveAgentState {
  agentIndex: number; // 0 = Vance, 1 = Nyx, 2 = Cipher, 3+ = Recruited Operatives
  room: RoomId;
  stationId: string;
  xPct: number;
  yPct: number;
  targetXPct: number;
  targetYPct: number;
  targetRoom: RoomId;
  targetStationId: string;
  pose: StationPose;
  facing: 'left' | 'right';
  statusTag: string;
  isMoving: boolean;
  phase: 'at_station' | 'walking_to_door' | 'walking_to_station';
  waypoints?: WaypointNode[];
}

// Central War Room "Town Hall" Roundtable Formation Coordinates (Positioned on Walkable Floor around the Holo-Table)
export const TOWN_HALL_PRESET_SEATS: WorkstationDef[] = [
  { id: 'war_seat_0', label: 'Town Hall West Seat', xPct: 36.0, yPct: 75.0, corridorXPct: 36.0, corridorYPct: 79.0, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_1', label: 'Town Hall Center Podium', xPct: 50.0, yPct: 83.5, corridorXPct: 50.0, corridorYPct: 84.5, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_2', label: 'Town Hall East Seat', xPct: 64.0, yPct: 75.0, corridorXPct: 64.0, corridorYPct: 79.0, pose: 'work', facing: 'left', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_3', label: 'Town Hall North-West Flank', xPct: 38.0, yPct: 68.0, corridorXPct: 40.0, corridorYPct: 70.0, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_4', label: 'Town Hall North-East Flank', xPct: 62.0, yPct: 68.0, corridorXPct: 60.0, corridorYPct: 70.0, pose: 'work', facing: 'left', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_5', label: 'Town Hall South-West Guard', xPct: 42.0, yPct: 82.0, corridorXPct: 44.0, corridorYPct: 83.0, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_6', label: 'Town Hall South-East Guard', xPct: 58.0, yPct: 82.0, corridorXPct: 56.0, corridorYPct: 83.0, pose: 'work', facing: 'left', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_7', label: 'Town Hall High Council Bench', xPct: 50.0, yPct: 65.0, corridorXPct: 50.0, corridorYPct: 67.0, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
];

export function getTownHallSeat(idx: number, total: number = 3): WorkstationDef {
  if (idx < TOWN_HALL_PRESET_SEATS.length) {
    return TOWN_HALL_PRESET_SEATS[idx];
  }
  // Dynamic elliptical distribution around the central War Room holo-table for large recruited crews
  const count = Math.max(8, total);
  const angle = (idx * (2 * Math.PI)) / count;
  const x = Math.max(28, Math.min(72, Math.round(50 + 18 * Math.cos(angle))));
  const y = Math.max(65, Math.min(84, Math.round(75 + 9 * Math.sin(angle))));
  return {
    id: `war_seat_${idx}`,
    label: `Town Hall Seat #${idx + 1}`,
    xPct: x,
    yPct: y,
    corridorXPct: x,
    corridorYPct: Math.min(85, y + 2),
    pose: idx % 2 === 0 ? 'desk' : 'work',
    facing: x >= 50 ? 'left' : 'right',
    taskTag: 'ROUNDTABLE',
  };
}

export const TOWN_HALL_SEATS: Record<number, WorkstationDef> = new Proxy(
  {
    0: TOWN_HALL_PRESET_SEATS[0],
    1: TOWN_HALL_PRESET_SEATS[1],
    2: TOWN_HALL_PRESET_SEATS[2],
  },
  {
    get(target, prop) {
      const idx = Number(prop);
      if (!isNaN(idx)) {
        if (idx in target) return (target as Record<number, WorkstationDef>)[idx];
        return getTownHallSeat(idx, Math.max(idx + 1, 3));
      }
      return (target as any)[prop];
    },
  }
);
