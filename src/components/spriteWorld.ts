/**
 * spriteWorld: framework-free safehouse world model shared across the app.
 *
 * Room identifiers, station/obstacle/corridor data, isometric walkability and
 * pathfinding helpers, and Town Hall seating. Extracted from SpriteCanvas.tsx so that
 * services, modals and context providers can use this data without importing the
 * (much larger) overworld canvas component.
 */
import { getAllRooms, getAllRoomStations, getAllRoomObstacles } from '../engine/roomManager';
// Room data has a single source of truth: engine/roomData.ts, which roomManager also merges
// with user-defined rooms and which the canvas renders from. (This file previously carried a
// stale duplicate copy whose station ids no longer matched what is drawn on screen.)
import {
  ROOM_ORDER,
  ROOM_CORRIDOR_WAYPOINTS,
  ROOM_STATIONS,
  ROOM_METADATA,
  ROOM_OBSTACLES,
} from '../engine/roomData';
import type {
  RoomId,
  StationPose,
  SpriteAnimationState,
  WorkstationDef,
  WaypointNode,
  RoomMetadataDef,
  ObstacleBox,
} from '../engine/roomData';
export { ROOM_ORDER, ROOM_CORRIDOR_WAYPOINTS, ROOM_STATIONS, ROOM_METADATA, ROOM_OBSTACLES };
export type { RoomId, StationPose, SpriteAnimationState, WorkstationDef, WaypointNode, RoomMetadataDef, ObstacleBox };

export const AGENT_CLEARANCE_X = 2.4; // Horizontal clearance margin (~19-20px)
export const AGENT_CLEARANCE_Y = 1.8; // Vertical clearance margin (~14-16px)
export const CENTRAL_EXTRA_CLEARANCE_X = 0.8; // Additional clearance buffer for central structures (~6px)
export const CENTRAL_EXTRA_CLEARANCE_Y = 0.6; // Additional clearance buffer for central structures (~5px)
export const SAFE_PERIMETER_OFFSET = 3.2; // Safe stopping perimeter offset (16-32px away from structure edge)

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
