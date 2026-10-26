import {
  ROOM_ORDER as BASE_ROOM_ORDER,
  ROOM_METADATA,
  ROOM_STATIONS,
  ROOM_OBSTACLES,
  ROOM_CORRIDOR_WAYPOINTS,
} from './roomData.js';

export { BASE_ROOM_ORDER };

const STORAGE_KEY = 'pixelops_custom_rooms_v1';

export const ROOM_TEMPLATES = [
  {
    id: 'cyber_lab',
    spyTitle: 'Spy Safehouse · Cybernetics & AI Lab [D-02]',
    monsterTitle: 'Monster Lab · Bio-Neural Chamber [D-02]',
    vikingTitle: 'Viking Longhall · Runesmith Forge [D-02]',
    shortBadge: 'CYBER LAB',
    sectorCode: 'SEC-D2',
    wingLabel: 'LOWER DECK',
    gridCol: 3,
    gridRow: 1,
    neighbors: ['armory', 'archive_basement'],
    defaultAgentIndex: 1,
    idleTag: 'DIAGNOSTICS',
    activeTag: 'SYNTHESIZING',
    defaultBriefing:
      'Cybernetics & Neural R&D Lab active. AI inference cores synchronizing; hardware AST accelerators online.',
    cleanBackdropUrl: '/assets/rooms/server_vault_clean.png',
    backdropFilter: 'hue-rotate(145deg) saturate(1.4) brightness(0.95)',
    objectPosition: 'center center',
    doorX: 48.0,
    doorY: 64.0,
    isCustom: true,
    stations: [
      {
        id: 'cyber_neural_pod',
        label: 'Neural Sim Pod',
        xPct: 38.5,
        yPct: 78.0,
        corridorXPct: 38.5,
        corridorYPct: 78.0,
        pose: 'work',
        facing: 'left',
        taskTag: 'SYNTHESIZING',
      },
      {
        id: 'cyber_bench',
        label: 'AST Refactor Rig',
        xPct: 48.0,
        yPct: 84.0,
        corridorXPct: 48.0,
        corridorYPct: 84.0,
        pose: 'desk',
        facing: 'right',
        taskTag: 'REFACTORING',
      },
      {
        id: 'cyber_terminal',
        label: 'Sidecar Shell Terminal',
        xPct: 63.5,
        yPct: 77.0,
        corridorXPct: 63.5,
        corridorYPct: 77.0,
        pose: 'laptop',
        facing: 'right',
        taskTag: 'EXECUTING',
      },
    ],
    obstacles: [
      {
        id: 'obs_cyber_central_core',
        label: 'Central Neural Core Matrix',
        xMin: 43.0,
        xMax: 57.0,
        yMin: 68.0,
        yMax: 77.5,
        isCentralStructure: true,
      },
      {
        id: 'obs_cyber_west_pod',
        label: 'West Bio-Neural Tank',
        xMin: 24.0,
        xMax: 34.0,
        yMin: 68.0,
        yMax: 79.0,
      },
      {
        id: 'obs_cyber_east_rack',
        label: 'East Accelerator Bay',
        xMin: 65.0,
        xMax: 76.0,
        yMin: 68.0,
        yMax: 79.0,
      },
    ],
    corridorWaypoints: [
      { id: 'wp_cyber_west', label: 'Neural Tank Floor', xPct: 37.0, yPct: 76.0 },
      { id: 'wp_cyber_center', label: 'Core Chamber Walkway', xPct: 49.0, yPct: 83.0 },
      { id: 'wp_cyber_east', label: 'Accelerator Catwalk', xPct: 62.0, yPct: 76.0 },
      { id: 'wp_cyber_door', label: 'Lab Threshold', xPct: 48.0, yPct: 65.0 },
    ],
  },
  {
    id: 'quantum_vault',
    spyTitle: 'Spy Safehouse · Quantum Cryptography Vault [E-02]',
    monsterTitle: 'Monster Lab · Quantum Containment [E-02]',
    vikingTitle: 'Viking Longhall · Seiðr Sanctum [E-02]',
    shortBadge: 'QUANTUM VAULT',
    sectorCode: 'SEC-E2',
    wingLabel: 'LOWER DECK',
    gridCol: 3,
    gridRow: 1,
    neighbors: ['server_vault', 'archive_basement'],
    defaultAgentIndex: 2,
    idleTag: 'LATTICE LOCK',
    activeTag: 'DECRYPTING',
    defaultBriefing:
      'Quantum Cryptography Vault calibrated. 1024-qubit lattice entanglement holding steady.',
    cleanBackdropUrl: '/assets/rooms/war_room_clean.png',
    backdropFilter: 'hue-rotate(210deg) saturate(1.3) contrast(1.1)',
    objectPosition: 'center center',
    doorX: 48.0,
    doorY: 64.0,
    isCustom: true,
    stations: [
      {
        id: 'quantum_core',
        label: 'Entanglement Core',
        xPct: 37.5,
        yPct: 78.5,
        corridorXPct: 37.5,
        corridorYPct: 78.5,
        pose: 'work',
        facing: 'left',
        taskTag: 'QUANTUM KEY',
      },
      {
        id: 'quantum_key_bench',
        label: 'Cipher Analysis Rig',
        xPct: 48.0,
        yPct: 84.0,
        corridorXPct: 48.0,
        corridorYPct: 84.0,
        pose: 'desk',
        facing: 'right',
        taskTag: 'DECRYPTING',
      },
      {
        id: 'lattice_terminal',
        label: 'Qubit Relay',
        xPct: 63.5,
        yPct: 77.0,
        corridorXPct: 63.5,
        corridorYPct: 77.0,
        pose: 'laptop',
        facing: 'right',
        taskTag: 'ALIGNING',
      },
    ],
    obstacles: [
      {
        id: 'obs_quantum_central_lattice',
        label: 'Central Quantum Lattice Chamber',
        xMin: 43.0,
        xMax: 57.0,
        yMin: 69.0,
        yMax: 78.5,
        isCentralStructure: true,
      },
      {
        id: 'obs_quantum_west_cryo',
        label: 'West Cryo Reservoir',
        xMin: 24.0,
        xMax: 33.5,
        yMin: 68.0,
        yMax: 79.0,
      },
      {
        id: 'obs_quantum_east_sensor',
        label: 'East Qubit Sensor Array',
        xMin: 66.0,
        xMax: 76.0,
        yMin: 68.0,
        yMax: 79.0,
      },
    ],
    corridorWaypoints: [
      { id: 'wp_quantum_west', label: 'Cryo Walkway', xPct: 37.0, yPct: 77.0 },
      { id: 'wp_quantum_center', label: 'Lattice Floor', xPct: 49.0, yPct: 83.5 },
      { id: 'wp_quantum_east', label: 'Sensor Walkway', xPct: 63.0, yPct: 76.5 },
      { id: 'wp_quantum_door', label: 'Vault Airlock', xPct: 48.0, yPct: 64.5 },
    ],
  },
  {
    id: 'stealth_hangar',
    spyTitle: 'Spy Safehouse · Stealth Drone Hangar [F-02]',
    monsterTitle: 'Monster Lab · Specimen Launchpad [F-02]',
    vikingTitle: 'Viking Longhall · Longship Slipway [F-02]',
    shortBadge: 'DRONE HANGAR',
    sectorCode: 'SEC-F2',
    wingLabel: 'LOWER DECK',
    gridCol: 3,
    gridRow: 1,
    neighbors: ['armory', 'briefing_lounge'],
    defaultAgentIndex: 0,
    idleTag: 'BAY CLEAR',
    activeTag: 'LAUNCH READY',
    defaultBriefing:
      'Stealth Drone Hangar standing by. Autonomous micro-quads pre-flight checked and fueled.',
    cleanBackdropUrl: '/assets/rooms/armory_clean.png',
    backdropFilter: 'hue-rotate(60deg) saturate(0.9) brightness(0.92)',
    objectPosition: 'center center',
    doorX: 43.0,
    doorY: 67.0,
    isCustom: true,
    stations: [
      {
        id: 'hangar_drone_bay',
        label: 'Drone Launch Cradle',
        xPct: 37.5,
        yPct: 78.5,
        corridorXPct: 37.5,
        corridorYPct: 78.5,
        pose: 'stand',
        facing: 'left',
        taskTag: 'CALIBRATING',
      },
      {
        id: 'avionics_workstation',
        label: 'Avionics Bench',
        xPct: 48.0,
        yPct: 84.0,
        corridorXPct: 48.0,
        corridorYPct: 84.0,
        pose: 'work',
        facing: 'right',
        taskTag: 'FIRMWARE FLASH',
      },
      {
        id: 'flight_uplink',
        label: 'Telemetry Desk',
        xPct: 62.0,
        yPct: 78.0,
        corridorXPct: 62.0,
        corridorYPct: 78.0,
        pose: 'laptop',
        facing: 'right',
        taskTag: 'LINKING',
      },
    ],
    obstacles: [
      {
        id: 'obs_hangar_central_launchpad',
        label: 'Central Drone Launch Turntable',
        xMin: 43.0,
        xMax: 57.0,
        yMin: 69.0,
        yMax: 78.5,
        isCentralStructure: true,
      },
      {
        id: 'obs_hangar_west_hoist',
        label: 'West Battery Recharge Bay',
        xMin: 24.0,
        xMax: 34.5,
        yMin: 68.0,
        yMax: 80.0,
      },
      {
        id: 'obs_hangar_east_crane',
        label: 'East Avionics Hoist',
        xMin: 64.0,
        xMax: 76.0,
        yMin: 70.0,
        yMax: 81.0,
      },
    ],
    corridorWaypoints: [
      { id: 'wp_hangar_west', label: 'Battery Rack Floor', xPct: 37.0, yPct: 77.0 },
      { id: 'wp_hangar_center', label: 'Slipway Floor', xPct: 49.0, yPct: 83.5 },
      { id: 'wp_hangar_east', label: 'Avionics Floor', xPct: 62.5, yPct: 77.0 },
      { id: 'wp_hangar_door', label: 'Blast Gate', xPct: 43.0, yPct: 66.5 },
    ],
  },
];

const listeners = new Set();

export function subscribeRoomRegistry(cb) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners() {
  for (const cb of Array.from(listeners)) {
    try {
      cb();
    } catch (e) {
      console.error('Error in room registry listener:', e);
    }
  }
}

let memoryStore = {};

export function loadCustomRooms() {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (e) {
      console.warn('Failed to load custom rooms from storage:', e);
      return {};
    }
  }
  return memoryStore;
}

export function saveCustomRooms(rooms) {
  memoryStore = { ...rooms };
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
      notifyListeners();
    } catch (e) {
      console.warn('Failed to save custom rooms to storage:', e);
    }
  } else {
    notifyListeners();
  }
}

export function spawnRoom(def) {
  const rooms = loadCustomRooms();
  const roomWithFlag = {
    ...def,
    isCustom: true,
  };
  rooms[def.id] = roomWithFlag;
  saveCustomRooms(rooms);
  return roomWithFlag;
}

export function removeRoom(roomId) {
  const rooms = loadCustomRooms();
  if (rooms[roomId]) {
    delete rooms[roomId];
    saveCustomRooms(rooms);
    return true;
  }
  return false;
}

export const removeCustomRoom = removeRoom;

export function resetCustomRooms() {
  saveCustomRooms({});
}

export function getAllRooms() {
  const custom = loadCustomRooms();
  const merged = { ...ROOM_METADATA };
  for (const [id, r] of Object.entries(custom)) {
    merged[id] = {
      id: r.id,
      spyTitle: r.spyTitle,
      monsterTitle: r.monsterTitle || r.spyTitle,
      vikingTitle: r.vikingTitle || r.spyTitle,
      shortBadge: r.shortBadge,
      sectorCode: r.sectorCode,
      wingLabel: r.wingLabel,
      gridCol: r.gridCol,
      gridRow: r.gridRow,
      neighbors: r.neighbors || [],
      defaultAgentIndex: r.defaultAgentIndex ?? 0,
      idleTag: r.idleTag,
      activeTag: r.activeTag,
      defaultBriefing: r.defaultBriefing,
      cleanBackdropUrl: r.cleanBackdropUrl,
      backdropFilter: r.backdropFilter || 'none',
      objectPosition: r.objectPosition || 'center center',
      doorX: r.doorX,
      doorY: r.doorY,
    };
  }
  return merged;
}

export function getAllRoomIds() {
  const custom = loadCustomRooms();
  const customIds = Object.keys(custom).filter((id) => !BASE_ROOM_ORDER.includes(id));
  return [...BASE_ROOM_ORDER, ...customIds];
}

export function getAllRoomStations() {
  const custom = loadCustomRooms();
  const merged = { ...ROOM_STATIONS };
  for (const [id, r] of Object.entries(custom)) {
    merged[id] = r.stations || [];
  }
  return merged;
}

export function getAllRoomObstacles() {
  const custom = loadCustomRooms();
  const merged = { ...ROOM_OBSTACLES };
  for (const [id, r] of Object.entries(custom)) {
    merged[id] = r.obstacles || [];
  }
  return merged;
}

export function getAllCorridorWaypoints() {
  const custom = loadCustomRooms();
  const merged = { ...ROOM_CORRIDOR_WAYPOINTS };
  for (const [id, r] of Object.entries(custom)) {
    if (r.corridorWaypoints && r.corridorWaypoints.length > 0) {
      merged[id] = r.corridorWaypoints;
    } else {
      merged[id] = [
        { id: `wp_${id}_west`, label: 'West Walkway', xPct: 37.0, yPct: 77.0 },
        { id: `wp_${id}_center`, label: 'Center Floor', xPct: 49.0, yPct: 83.0 },
        { id: `wp_${id}_east`, label: 'East Walkway', xPct: 63.0, yPct: 77.0 },
        { id: `wp_${id}_door`, label: 'Threshold', xPct: r.doorX || 48.0, yPct: r.doorY || 65.0 },
      ];
    }
  }
  return merged;
}

export function getRoomMetadata(roomId) {
  const all = getAllRooms();
  return all[roomId] || all['war_room'] || ROOM_METADATA.war_room;
}

export function getRoomStations(roomId) {
  const all = getAllRoomStations();
  return all[roomId] || all['war_room'] || ROOM_STATIONS.war_room || [];
}

export function getRoomObstacles(roomId) {
  const all = getAllRoomObstacles();
  return all[roomId] || ROOM_OBSTACLES[roomId] || [];
}
