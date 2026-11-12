import React, { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowRightLeft, UserPlus, Footprints, Radar, Maximize2, Minimize2, Compass, Layers } from 'lucide-react';
import { useTheme, AgentProfile } from '../context/ThemeContext';
import { useCrew, SPRITE_VARIANTS } from '../context/CrewContext';
import { GameOverlay } from './GameOverlay';
import { loadLiveAgentsSnapshot, saveLiveAgentsSnapshot } from '../services/AppStatePersistence';
import { getAllRooms, getAllRoomIds, subscribeRoomRegistry } from '../engine/roomManager';
import { resolveAgentOperationalState, getStationBoundSkill, subscribeModuleRegistry } from '../engine/moduleRegistry';
// Room spawner modal is only needed when the Commander opens it; load it on demand.
const RoomSpawnerModal = lazy(() => import('./RoomSpawnerModal').then((m) => ({ default: m.RoomSpawnerModal })));
import { RoomActionPlaybookPanel } from './RoomActionPlaybookPanel';
import type { IntelligencePlaybookDef } from '../engine/intelligencePlaybooks';
import { getOperativeReadiness } from '../services/OperativeReadinessService';

import { RoomId, StationPose, SpriteAnimationState, WorkstationDef, RoomMetadataDef, getRoomMeta, getRoomStns, isWalkablePoint, snapToWalkableFloor, buildAgentWaypointPath, LiveAgentState, getTownHallSeat } from './spriteWorld';
import { AgentSpriteFigure } from './AgentSpriteFigure';

// Backwards-compatible re-exports: prefer importing from ./spriteWorld or ./AgentSpriteFigure.
export * from './spriteWorld';
export { AgentSpriteFigure } from './AgentSpriteFigure';

interface SpriteCanvasProps {
  currentRoom: RoomId;
  onChangeRoom: (room: RoomId) => void;
  agentRooms: Record<string, RoomId>;
  onMoveAgentToRoom: (
    agentId: string,
    targetRoom: RoomId,
    preferredStationId?: string,
    taskTag?: string
  ) => void;
  walkingTransition: {
    agentId: string;
    fromRoom: RoomId;
    toRoom: RoomId;
    preferredStationId?: string;
    taskTag?: string;
  } | null;
  isRoutingCamera?: boolean;
  isExecuting: boolean;
  executingAgentIds?: string[];
  completionAlertAgentId: string | null;
  errorAlertAgentId?: string | null;
  lastActionSummary: string | null;
  isGameActive?: boolean;
  isGameClosing?: boolean;
  onGameBoostChange?: (boostPct: number) => void;
  onGameSequenceComplete?: (finalBoostPct: number) => void;
  onStartManualBypass?: () => void;
  onAbortGame?: () => void;
  isMinimapOpen?: boolean;
  onToggleMinimap?: () => void;
  townHallSummonNonce?: number;
  isMeetingActive?: boolean;
  activeSpeakerAgentIndex?: number | null;
  onCallMeeting?: () => void;
  onExecutePlaybook?: (playbook: IntelligencePlaybookDef) => void;
  onOpenVfs?: (targetPath?: string) => void;
  isReconOverlayOpen?: boolean;
  onOpenReconOverlay?: () => void;
  onCloseReconOverlay?: () => void;
  reconTarget?: {
    lat: number;
    lon: number;
    label: string;
    sectorCode: string;
  };
  onDispatchReconDirective?: (directive: string, coords: { lat: number; lon: number; label: string }) => void;
  onOpenThreatMatrixModal?: () => void;
}

const UPPER_DECK_ROOMS: RoomId[] = ['comms_tower', 'war_room', 'server_vault', 'armory'];
const LOWER_DECK_ROOMS: RoomId[] = ['briefing_lounge', 'library', 'archive_basement'];

const AMBIENT_IDLE_TAGS = [
  'PATROL',
  'COMM BREAK',
  'GEAR CHECK',
  'SIGNAL WATCH',
  'ACTIVE',
  'STANDBY',
];

const PIXEL_TEXT_SHADOW_GREEN =
  '[text-shadow:0_2px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000,0_0_8px_var(--theme-glow-color)]';
const PIXEL_TEXT_SHADOW_AMBER =
  '[text-shadow:0_2px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000,0_0_8px_rgba(229,152,56,0.65)]';
const PIXEL_TEXT_SHADOW_CYAN =
  '[text-shadow:0_2px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000,0_0_8px_rgba(56,189,248,0.65)]';

export const SpriteCanvas: React.FC<SpriteCanvasProps> = ({
  currentRoom,
  onChangeRoom,
  onMoveAgentToRoom,
  walkingTransition,
  isRoutingCamera = false,
  isExecuting,
  executingAgentIds = [],
  completionAlertAgentId,
  errorAlertAgentId = null,
  isGameActive = false,
  isGameClosing = false,
  onGameBoostChange,
  onGameSequenceComplete,
  onStartManualBypass,
  onAbortGame,
  isMinimapOpen = false,
  onToggleMinimap,
  townHallSummonNonce = 0,
  isMeetingActive = false,
  activeSpeakerAgentIndex = null,
  onCallMeeting,
  onExecutePlaybook,
  onOpenVfs,
  isReconOverlayOpen = false,
  onOpenReconOverlay,
  onCloseReconOverlay,
  reconTarget,
  onDispatchReconDirective,
  onOpenThreatMatrixModal,
}) => {
  const { theme, themeId, activeAgent, setActiveAgentId, playBeep } = useTheme();
  const { crewAgents, getCrewAgentByIndex, updateAgentRoom } = useCrew();
  const [tick, setTick] = useState(0);
  const [walkFrame, setWalkFrame] = useState<0 | 1 | 2 | 3>(0);
  const [isOverviewZoom, setIsOverviewZoom] = useState(false);
  const [localMinimapOpen, setLocalMinimapOpen] = useState(false);
  const [hoveredStation, setHoveredStation] = useState<WorkstationDef | null>(null);
  const [registryRevision, setRegistryRevision] = useState(0);
  const [isRoomSpawnerOpen, setIsRoomSpawnerOpen] = useState(false);

  useEffect(() => {
    const unsub1 = subscribeRoomRegistry(() => setRegistryRevision((v) => v + 1));
    const unsub2 = subscribeModuleRegistry(() => setRegistryRevision((v) => v + 1));
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const showMinimap = isMinimapOpen || localMinimapOpen;
  const handleToggleRadar = () => {
    playBeep('tap');
    if (onToggleMinimap) {
      onToggleMinimap();
    } else {
      setLocalMinimapOpen((prev) => !prev);
    }
  };

  const autoRoam = false;

  // Drag / Pan state for scrollable 2D overworld canvas
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragOffsetPx, setDragOffsetPx] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Initialize individual autonomous state for the operatives across distinct sectors
  const [liveAgents, setLiveAgents] = useState<Record<number, LiveAgentState>>(() => {
    const saved = loadLiveAgentsSnapshot();
    if (saved && saved.liveAgents && Object.keys(saved.liveAgents).length > 0) {
      const agentEntries = Object.values(saved.liveAgents);
      const allValid = agentEntries.every(
        (a) => a && getRoomMeta(a.room) && isWalkablePoint(a.room, a.xPct, a.yPct)
      );
      if (allValid && agentEntries.length >= 3) {
        return saved.liveAgents;
      }
    }

    return {
      0: {
        agentIndex: 0,
        room: 'war_room',
        stationId: 'war_center_desk',
        xPct: 48.0,
        yPct: 83.5,
        targetXPct: 48.0,
        targetYPct: 83.5,
        targetRoom: 'war_room',
        targetStationId: 'war_center_desk',
        pose: 'desk',
        facing: 'right',
        statusTag: 'ACTIVE',
        isMoving: false,
        phase: 'at_station',
        waypoints: [],
      },
      1: {
        agentIndex: 1,
        room: 'comms_tower',
        stationId: 'comms_dish_console',
        xPct: 38.5,
        yPct: 79.0,
        targetXPct: 38.5,
        targetYPct: 79.0,
        targetRoom: 'comms_tower',
        targetStationId: 'comms_dish_console',
        pose: 'desk',
        facing: 'left',
        statusTag: 'SIGNAL WATCH',
        isMoving: false,
        phase: 'at_station',
        waypoints: [],
      },
      2: {
        agentIndex: 2,
        room: 'library',
        stationId: 'lib_front_desk',
        xPct: 50.0,
        yPct: 81.5,
        targetXPct: 50.0,
        targetYPct: 81.5,
        targetRoom: 'library',
        targetStationId: 'lib_front_desk',
        pose: 'desk',
        facing: 'left',
        statusTag: 'INDEXING',
        isMoving: false,
        phase: 'at_station',
        waypoints: [],
      },
    };
  });

  // Synchronize liveAgents whenever crewAgents changes (e.g., when new operatives are recruited or dismissed)
  useEffect(() => {
    setLiveAgents((prev) => {
      let changed = false;
      const next: Record<number, LiveAgentState> = { ...prev };

      // Prune any indices beyond current crewAgents length (e.g. after dismissing a recruited operative)
      Object.keys(next).forEach((key) => {
        const numKey = Number(key);
        if (numKey >= crewAgents.length) {
          delete next[numKey];
          changed = true;
        }
      });

      // Spawn any newly recruited or missing crewAgents onto the map in their assigned room
      crewAgents.forEach((crewMember, idx) => {
        if (!next[idx]) {
          changed = true;
          const assignedRoom: RoomId =
            crewMember.currentRoom && getRoomMeta(crewMember.currentRoom)
              ? crewMember.currentRoom
              : 'war_room';
          const roomStations = getRoomStns(assignedRoom);
          const occupiedStationIds = Object.values(next)
            .filter((a) => a.room === assignedRoom)
            .map((a) => a.stationId);

          const chosenStation =
            roomStations.find(
              (s) =>
                s.id === crewMember.preferredStationId &&
                !occupiedStationIds.includes(s.id)
            ) ||
            roomStations.find((s) => !occupiedStationIds.includes(s.id)) ||
            roomStations[idx % roomStations.length] ||
            roomStations[0];

          // Slight offset if another agent is already standing on the exact same station coordinates
          const overlappingCount = Object.values(next).filter(
            (a) =>
              a.room === assignedRoom &&
              Math.hypot(a.xPct - chosenStation.xPct, a.yPct - chosenStation.yPct) < 3
          ).length;
          const offsetX = overlappingCount > 0 ? ((idx % 2 === 0 ? 1 : -1) * 4.5) : 0;
          const offsetY = overlappingCount > 0 ? 2.0 : 0;
          const safeSpawn = snapToWalkableFloor(
            assignedRoom,
            chosenStation.xPct + offsetX,
            chosenStation.yPct + offsetY
          );

          next[idx] = {
            agentIndex: idx,
            room: assignedRoom,
            stationId: chosenStation.id,
            xPct: safeSpawn.xPct,
            yPct: safeSpawn.yPct,
            targetXPct: safeSpawn.xPct,
            targetYPct: safeSpawn.yPct,
            targetRoom: assignedRoom,
            targetStationId: chosenStation.id,
            pose: chosenStation.pose,
            facing: chosenStation.facing,
            statusTag: chosenStation.taskTag || 'ACTIVE',
            isMoving: false,
            phase: 'at_station',
            waypoints: [],
          };
        }
      });

      return changed ? next : prev;
    });
  }, [crewAgents]);

  const latestAgentsRef = useRef({ liveAgents, autoRoam });
  latestAgentsRef.current = { liveAgents, autoRoam };

  useEffect(() => {
    saveLiveAgentsSnapshot(liveAgents, autoRoam);
  }, [liveAgents, autoRoam]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        saveLiveAgentsSnapshot(
          latestAgentsRef.current.liveAgents,
          latestAgentsRef.current.autoRoam
        );
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      saveLiveAgentsSnapshot(
        latestAgentsRef.current.liveAgents,
        latestAgentsRef.current.autoRoam
      );
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Global animation clock for progress bars & 4-phase walking leg stride cycle (visibility-aware)
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setTick((t) => (t + 1) % 12);
      setWalkFrame((f) => ((f + 1) % 4) as 0 | 1 | 2 | 3);
    }, 135);
    return () => clearInterval(interval);
  }, []);

  // Command an individual agent (by index 0..crewAgents.length-1) to pathfind along sector waypoints
  const commandAgentWalkTo = (
    agentIdx: number,
    destRoom: RoomId,
    destStationId?: string,
    overrideTag?: string
  ) => {
    const crewMember = crewAgents[agentIdx];
    if (
      crewMember &&
      (crewMember.currentRoom !== destRoom ||
        (destStationId && crewMember.preferredStationId !== destStationId))
    ) {
      updateAgentRoom(crewMember.id, destRoom, destStationId);
    }

    setLiveAgents((prev) => {
      const curr = prev[agentIdx];
      if (!curr) return prev;

      const roomStations = getRoomStns(destRoom);
      const occupiedIds = Object.values(prev)
        .filter((a) => a.agentIndex !== agentIdx && a.targetRoom === destRoom)
        .map((a) => a.targetStationId);

      const chosenStation =
        roomStations.find((s) => s.id === destStationId) ||
        roomStations.find((s) => !occupiedIds.includes(s.id)) ||
        roomStations[agentIdx % roomStations.length] ||
        roomStations[0];

      const chosenX = chosenStation.corridorXPct || chosenStation.xPct;
      const chosenY = chosenStation.corridorYPct || chosenStation.yPct;
      const path = buildAgentWaypointPath(
        curr.room,
        curr.xPct,
        curr.yPct,
        destRoom,
        chosenStation
      );
      const firstWp = path[0] || {
        xPct: chosenX,
        yPct: chosenY,
        room: destRoom,
      };

      const nextState: Record<number, LiveAgentState> = {
        ...prev,
        [agentIdx]: {
          ...curr,
          targetRoom: destRoom,
          targetStationId: chosenStation.id,
          targetXPct: firstWp.xPct,
          targetYPct: firstWp.yPct,
          pose: 'walking',
          facing: firstWp.xPct >= curr.xPct ? 'right' : 'left',
          statusTag:
            overrideTag ||
            (curr.room !== destRoom
              ? `TO ${getRoomMeta(destRoom).shortBadge}`
              : 'MOVING'),
          isMoving: true,
          phase: curr.room === destRoom ? 'walking_to_station' : 'walking_to_door',
          waypoints: path,
        },
      };

      const otherIdleInDest = Object.values(nextState).filter(
        (a) =>
          a.agentIndex !== agentIdx &&
          !a.isMoving &&
          (a.room === destRoom || a.targetRoom === destRoom)
      );

      if (otherIdleInDest.length >= 2) {
        const crowdedAgent = otherIdleInDest[0];
        const occupiedRooms = new Set(
          Object.values(nextState).map((a) => a.targetRoom)
        );
        const neighborCandidates = (getRoomMeta(destRoom).neighbors || []).filter(
          (r) => !occupiedRooms.has(r)
        );
        const fallbackUncrowded = getAllRoomIds().filter((r) => !occupiedRooms.has(r));
        const disperseRoom =
          (neighborCandidates[0] as RoomId) || (fallbackUncrowded[0] as RoomId) || 'briefing_lounge';

        if (disperseRoom && disperseRoom !== destRoom) {
          const disperseStation = getRoomStns(disperseRoom)[0];
          const dispersePath = buildAgentWaypointPath(
            crowdedAgent.room,
            crowdedAgent.xPct,
            crowdedAgent.yPct,
            disperseRoom,
            disperseStation
          );
          const disperseX = disperseStation.corridorXPct || disperseStation.xPct;
          const disperseY = disperseStation.corridorYPct || disperseStation.yPct;
          const dFirst = dispersePath[0] || {
            xPct: disperseX,
            yPct: disperseY,
            room: disperseRoom,
          };
          nextState[crowdedAgent.agentIndex] = {
            ...crowdedAgent,
            targetRoom: disperseRoom,
            targetStationId: disperseStation.id,
            targetXPct: dFirst.xPct,
            targetYPct: dFirst.yPct,
            pose: 'walking',
            facing: dFirst.xPct >= crowdedAgent.xPct ? 'right' : 'left',
            statusTag: `TO ${getRoomMeta(disperseRoom).shortBadge}`,
            isMoving: true,
            phase: 'walking_to_door',
            waypoints: dispersePath,
          };
        }
      }

      return nextState;
    });
  };

  const lastHandledTransitionRef = useRef<any>(null);
  const crewAgentsRef = useRef(crewAgents);
  useEffect(() => {
    crewAgentsRef.current = crewAgents;
  }, [crewAgents]);

  // Sync task-driven walkingTransition from App.tsx (processed strictly ONCE per transition instance)
  useEffect(() => {
    if (!walkingTransition) return;
    if (lastHandledTransitionRef.current === walkingTransition) return;
    lastHandledTransitionRef.current = walkingTransition;

    const currentCrew = crewAgentsRef.current;
    const idx = currentCrew.findIndex((a) => a.id === walkingTransition.agentId);
    if (idx !== -1) {
      commandAgentWalkTo(
        idx,
        walkingTransition.toRoom,
        walkingTransition.preferredStationId,
        walkingTransition.taskTag
      );
    }
  }, [walkingTransition]);

  // Town Hall Meeting Trigger Effect (strictly triggered once per summon nonce)
  const lastHandledTownHallNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!townHallSummonNonce || townHallSummonNonce <= 0) return;
    if (lastHandledTownHallNonceRef.current === townHallSummonNonce) return;
    lastHandledTownHallNonceRef.current = townHallSummonNonce;

    const currentCrew = crewAgentsRef.current;
    currentCrew.forEach((crewMember, idx) => {
      const seat = getTownHallSeat(idx, currentCrew.length);
      if (crewMember && seat) {
        updateAgentRoom(crewMember.id, 'war_room', seat.id);
      }
    });

    setLiveAgents((prev) => {
      const next: Record<number, LiveAgentState> = { ...prev };
      currentCrew.forEach((_, idx) => {
        const curr = next[idx];
        const seat = getTownHallSeat(idx, currentCrew.length);
        if (!curr) return;

        const path = buildAgentWaypointPath(
          curr.room,
          curr.xPct,
          curr.yPct,
          'war_room',
          seat
        );
        const firstWp = path[0] || {
          xPct: seat.xPct,
          yPct: seat.yPct,
          room: 'war_room' as RoomId,
        };

        next[idx] = {
          ...curr,
          targetRoom: 'war_room',
          targetStationId: seat.id,
          targetXPct: firstWp.xPct,
          targetYPct: firstWp.yPct,
          pose: 'walking',
          facing: firstWp.xPct >= curr.xPct ? 'right' : 'left',
          statusTag: curr.room === 'war_room' ? 'ROUNDTABLE' : 'TO WAR ROOM',
          isMoving: true,
          phase: curr.room === 'war_room' ? 'walking_to_station' : 'walking_to_door',
          waypoints: path,
        };
      });
      return next;
    });
  }, [townHallSummonNonce]);

  // 60ms autonomous coordinate waypoint interpolation loop with visibility throttling protection
  useEffect(() => {
    let lastTick = Date.now();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        lastTick = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const moveTimer = setInterval(() => {
      // Pause pathfinding ticks while tab is backgrounded to prevent warp teleport bursts
      if (typeof document !== 'undefined' && document.hidden) {
        lastTick = Date.now();
        return;
      }
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;
      if (delta > 600) {
        // If tab was paused or throttled across a freeze, skip delta accumulator burst
        return;
      }

      setLiveAgents((prev) => {
        let changed = false;
        const next: Record<number, LiveAgentState> = { ...prev };

        Object.keys(next)
          .map(Number)
          .forEach((idx) => {
          const ag = next[idx];
          if (!ag || !ag.isMoving) return;
          changed = true;

          const queue =
            ag.waypoints && ag.waypoints.length > 0
              ? ag.waypoints
              : [
                  {
                    xPct: ag.targetXPct,
                    yPct: ag.targetYPct,
                    room: ag.targetRoom,
                  },
                ];

          const currentWp = queue[0];
          if (!currentWp) {
            next[idx] = { ...ag, isMoving: false, pose: 'stand', waypoints: [] };
            return;
          }

          if (currentWp.room !== ag.room) {
            const remaining = queue.slice(1);
            const nextWp = remaining[0] || currentWp;
            next[idx] = {
              ...ag,
              room: currentWp.room,
              xPct: currentWp.xPct,
              yPct: currentWp.yPct,
              targetXPct: nextWp.xPct,
              targetYPct: nextWp.yPct,
              pose: 'walk',
              facing: nextWp.xPct >= currentWp.xPct ? 'right' : 'left',
              phase: 'walking_to_station',
              waypoints: remaining,
            };
            return;
          }

          const dx = currentWp.xPct - ag.xPct;
          const dy = currentWp.yPct - ag.yPct;
          const dist = Math.hypot(dx, dy);
          const speed = 2.05;

          if (dist <= speed || dist <= 1.2) {
            const remaining = queue.slice(1);
            if (remaining.length > 0) {
              const nextWp = remaining[0];
              next[idx] = {
                ...ag,
                xPct: currentWp.xPct,
                yPct: currentWp.yPct,
                targetXPct: nextWp.xPct,
                targetYPct: nextWp.yPct,
                pose: 'walk',
                facing: nextWp.xPct >= currentWp.xPct ? 'right' : 'left',
                waypoints: remaining,
              };
            } else {
              if (isMeetingActive && ag.room === 'war_room') {
                const seat = getTownHallSeat(idx, Object.keys(next).length);
                next[idx] = {
                  ...ag,
                  stationId: seat.id,
                  xPct: currentWp.xPct,
                  yPct: currentWp.yPct,
                  targetXPct: currentWp.xPct,
                  targetYPct: currentWp.yPct,
                  pose: seat.pose,
                  facing: seat.facing,
                  statusTag: 'ROUNDTABLE',
                  isMoving: false,
                  phase: 'at_station',
                  waypoints: [],
                };
                return;
              }

              const roomStations = getRoomStns(ag.room);
              const destStation =
                roomStations.find((s) => s.id === ag.targetStationId) || roomStations[0];

              const isAmbientSpot =
                Math.hypot(
                  currentWp.xPct - destStation.xPct,
                  currentWp.yPct - destStation.yPct
                ) > 3.5;

              next[idx] = {
                ...ag,
                stationId: destStation.id,
                xPct: currentWp.xPct,
                yPct: currentWp.yPct,
                targetXPct: currentWp.xPct,
                targetYPct: currentWp.yPct,
                pose: isAmbientSpot ? 'stand' : destStation.pose,
                facing: destStation.facing,
                statusTag: isAmbientSpot
                  ? AMBIENT_IDLE_TAGS[idx % AMBIENT_IDLE_TAGS.length]
                  : destStation.taskTag === 'COFFEE BREAK'
                  ? 'COMM BREAK'
                  : destStation.taskTag,
                isMoving: false,
                phase: 'at_station',
                waypoints: [],
              };
            }
          } else {
            const nextX = ag.xPct + (dx / dist) * speed;
            const nextY = ag.yPct + (dy / dist) * speed;

            next[idx] = {
              ...ag,
              xPct: Number(nextX.toFixed(2)),
              yPct: Number(nextY.toFixed(2)),
              facing: Math.abs(dx) > 0.1 ? (dx >= 0 ? 'right' : 'left') : ag.facing,
              pose: 'walk',
            };
          }
        });

        return changed ? next : prev;
      });
    }, 60);

    return () => {
      clearInterval(moveTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isExecuting, isMeetingActive]);



  const filledSegments = isExecuting ? (tick % 8) + 2 : 6;
  const activeRoomMeta = getRoomMeta(currentRoom);

  const formatSectorTitle = (meta: RoomMetadataDef) => meta.spyTitle;

  const handleStepRoom = (dir: -1 | 1) => {
    const allIds = getAllRoomIds();
    const idx = allIds.indexOf(currentRoom);
    const nextIdx = (idx + dir + allIds.length) % allIds.length;
    onChangeRoom(allIds[nextIdx] as RoomId);
    playBeep('switch');
  };

  const handlePanGridDirection = (dCol: number, dRow: number) => {
    const targetCol = Math.max(0, Math.min(3, activeRoomMeta.gridCol + dCol));
    const targetRow = Math.max(0, Math.min(1, activeRoomMeta.gridRow + dRow));
    const allIds = getAllRoomIds();
    const match = allIds.find((rId) => {
      const m = getRoomMeta(rId as RoomId);
      return m.gridCol === targetCol && m.gridRow === targetRow;
    });
    if (match && match !== currentRoom) {
      onChangeRoom(match as RoomId);
      playBeep('switch');
    } else if (targetRow === 1 && targetCol === 3) {
      onChangeRoom('archive_basement');
      playBeep('switch');
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || isOverviewZoom) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setDragOffsetPx({
      x: Math.max(-140, Math.min(140, dx)),
      y: Math.max(-90, Math.min(90, dy)),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = null;
    setDragOffsetPx({ x: 0, y: 0 });

    if (Math.abs(dx) > 55 || Math.abs(dy) > 45) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        handlePanGridDirection(dx < 0 ? 1 : -1, 0);
      } else {
        handlePanGridDirection(0, dy < 0 ? 1 : -1);
      }
    }
  };

  const getCombinedBackdropFilter = (roomMeta: RoomMetadataDef) => {
    const parts: string[] = [];
    if (roomMeta.backdropFilter && roomMeta.backdropFilter !== 'none') {
      parts.push(roomMeta.backdropFilter);
    }
    parts.push('var(--theme-room-filter)');
    return parts.join(' ');
  };

  const activeAgentIdx = Math.max(
    0,
    crewAgents.findIndex((a) => a.id === activeAgent.id)
  );
  const activeCrewMember = getCrewAgentByIndex(activeAgentIdx);
  const activeLiveAgent = liveAgents[activeAgentIdx] || liveAgents[0];

  // Determine the active room object readout for the bottom tactical HUD bar
  const currentRoomStations = getRoomStns(currentRoom);
  const agentsInCurrentRoom = crewAgents
    .map((crew, idx) => ({
      idx,
      state: liveAgents[idx],
      crew,
    }))
    .filter((item) => item.state && item.state.room === currentRoom);

  const interactingStationInRoom = (() => {
    if (hoveredStation) {
      return {
        station: hoveredStation,
        agentName: null,
        status: hoveredStation.taskTag,
      };
    }
    const stationaryAgent =
      agentsInCurrentRoom.find(
        (a) => a.idx === activeAgentIdx && !a.state.isMoving
      ) || agentsInCurrentRoom.find((a) => !a.state.isMoving);
    if (stationaryAgent) {
      const stObj = currentRoomStations.find(
        (s) => s.id === stationaryAgent.state.stationId
      );
      if (stObj) {
        return {
          station: stObj,
          agentName: stationaryAgent.crew.customName,
          status: stationaryAgent.state.statusTag,
        };
      }
    }
    return null;
  })();

  const agentsInOtherRooms = crewAgents
    .map((crew, idx) => ({
      idx,
      profile: theme.agents[idx] || {
        ...theme.agents[0],
        id: crew.id,
        name: crew.customName,
        role: crew.role,
        specialty: crew.specialty,
      },
      crew,
      state: liveAgents[idx],
    }))
    .filter((item) => item.crew && item.state && item.state.room !== currentRoom);

  const cameraTranslateXPct = isOverviewZoom
    ? 0
    : -activeRoomMeta.gridCol * 25 + dragOffsetPx.x * 0.03;
  const cameraTranslateYPct = isOverviewZoom
    ? 0
    : -activeRoomMeta.gridRow * 50 + dragOffsetPx.y * 0.06;

  // Render an individual Sector Cell inside the 4x2 Scrollable Overworld Grid
  const renderSectorCell = (roomId: RoomId) => {
    const meta = getRoomMeta(roomId);
    const isFocusedSector = currentRoom === roomId;
    const sectorAgents = crewAgents
      .map((_, idx) => liveAgents[idx])
      .filter((st): st is LiveAgentState => Boolean(st && st.room === roomId));

    return (
      <div
        key={roomId}
        onClick={() => {
          if (isOverviewZoom || currentRoom !== roomId) {
            onChangeRoom(roomId);
            if (isOverviewZoom) setIsOverviewZoom(false);
            playBeep('switch');
          }
        }}
        className={`relative w-full h-full overflow-hidden select-none ${
          isOverviewZoom
            ? isFocusedSector
              ? 'ring-1 ring-[#e59838] cursor-pointer'
              : 'hover:ring-1 hover:ring-[#4ade80] cursor-pointer opacity-90 hover:opacity-100'
            : ''
        }`}
      >
        {/* Clean High-Res Pixel-Art Room Backdrop (Zero blocky container overlays) */}
        <img
          src={meta.cleanBackdropUrl}
          alt={formatSectorTitle(meta)}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover pixelated pointer-events-none select-none"
          style={{
            filter: getCombinedBackdropFilter(meta),
            objectPosition: meta.objectPosition || 'center center',
          }}
        />

        {/* Subtle Interactive Room Object Hotspots (Invisible until hovered or interacted with by an agent) */}
        {!isOverviewZoom &&
          isFocusedSector &&
          (getRoomStns(roomId) || []).map((station) => {
            const interactingAgent = sectorAgents.find(
              (st) => !st.isMoving && st.stationId === station.id
            );
            const isHovered = hoveredStation?.id === station.id;
            const boundSkill = getStationBoundSkill(station.id);

            return (
              <button
                key={station.id}
                type="button"
                onMouseEnter={() =>
                  setHoveredStation((prev) => (prev?.id === station.id ? prev : station))
                }
                onMouseLeave={() =>
                  setHoveredStation((prev) => (prev?.id === station.id ? null : prev))
                }
                onFocus={() =>
                  setHoveredStation((prev) => (prev?.id === station.id ? prev : station))
                }
                onBlur={() =>
                  setHoveredStation((prev) => (prev?.id === station.id ? null : prev))
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (!interactingAgent) {
                    commandAgentWalkTo(activeAgentIdx, roomId, station.id);
                    playBeep('tap');
                  }
                }}
                style={{
                  left: `${station.xPct}%`,
                  top: `${station.yPct}%`,
                  transform: 'translate(-50%, -100%)',
                }}
                className="absolute z-15 w-16 h-14 flex flex-col items-center justify-end pb-1 cursor-pointer group focus:outline-none overflow-visible"
                aria-label={`${station.label} (${station.taskTag})`}
              >
                {/* Always mounted label with opacity transition so hovering never shifts layout or triggers mouseEnter/mouseLeave jitter */}
                <span
                  className={`absolute bottom-1 left-1/2 -translate-x-1/2 font-mono-tabular text-[9px] sm:text-[10px] tracking-wider uppercase whitespace-nowrap pointer-events-none select-none transition-opacity duration-100 ${
                    interactingAgent || isHovered ? 'opacity-100' : 'opacity-0'
                  } ${
                    isHovered
                      ? `text-[#e59838] ${PIXEL_TEXT_SHADOW_AMBER}`
                      : `text-[#4ade80]/90 ${PIXEL_TEXT_SHADOW_GREEN}`
                  }`}
                >
                  ◈ {station.label} {boundSkill ? `[${boundSkill.shortCode}]` : ''}
                </span>
              </button>
            );
          })}

        {/* Unboxed Sector Identification Callout in 7-Room Overview Mode */}
        {isOverviewZoom && (
          <div
            className={`absolute top-1.5 left-2 z-25 font-mono-tabular text-[9px] sm:text-[10px] font-bold flex items-center gap-1.5 pointer-events-none ${PIXEL_TEXT_SHADOW_AMBER}`}
          >
            <span className="text-[#e59838]">{meta.sectorCode}</span>
            <span className="text-[#f3ead8]">{meta.shortBadge}</span>
            <span className="text-[#4ade80]">[{sectorAgents.length}]</span>
          </div>
        )}

        {/* Unboxed Town Hall Roundtable Callout in War Room when Meeting is Active */}
        {isMeetingActive && roomId === 'war_room' && (
          <div
            className={`absolute left-[50%] top-[48%] -translate-x-1/2 z-15 pointer-events-none font-mono-tabular text-[10px] sm:text-[11px] font-bold tracking-wider text-[#38bdf8] whitespace-nowrap animate-pulse ${PIXEL_TEXT_SHADOW_CYAN}`}
          >
            [TOWN HALL ROUNDTABLE ACTIVE]
          </div>
        )}

        {/* Framer Motion Animated Pixel-Art Agents inside this Sector */}
        <AnimatePresence>
          {sectorAgents.map((st) => {
            const crewMember =
              crewAgents[st.agentIndex] || getCrewAgentByIndex(st.agentIndex);
            const profile: AgentProfile = theme.agents[st.agentIndex] || {
              ...theme.agents[0],
              id: crewMember.id,
              name: crewMember.customName,
              role: crewMember.role,
              specialty: crewMember.specialty,
            };
            const variantMeta =
              SPRITE_VARIANTS[crewMember.spriteVariant] ||
              SPRITE_VARIANTS.trenchcoat;
            const isSelected = activeAgent.id === crewMember.id;
            const isRoundtableSpeaker =
              isMeetingActive && activeSpeakerAgentIndex === st.agentIndex;
            const isThisAgentRunning =
              executingAgentIds.includes(crewMember.id) || (isExecuting && isSelected);
            const isAgentExecuting =
              isThisAgentRunning || isRoundtableSpeaker;

            const isWalkingTransitionActive =
              Boolean(
                walkingTransition && walkingTransition.agentId === profile.id
              ) ||
              st.isMoving ||
              st.pose === 'walk' ||
              st.pose === 'walking';

            const activePose: StationPose = isWalkingTransitionActive
              ? 'walking'
              : isAgentExecuting
              ? st.pose
              : st.pose === 'desk'
              ? 'desk'
              : 'stand';
            const spriteState: SpriteAnimationState = isWalkingTransitionActive
              ? 'walking'
              : isAgentExecuting
              ? 'executing'
              : 'idle';

            const showProgressBar = isAgentExecuting;

            // Uniform perspective-aware character height (27.5% base standing height with subtle floor depth scale + 0.82x crouching multiplier)
            const depthScale = 0.88 + Math.max(0, Math.min(30, st.yPct - 60)) * 0.008;
            const isCrouchingWork =
              !isWalkingTransitionActive &&
              isAgentExecuting &&
              (activePose === 'work' || activePose === 'laptop') &&
              (variantMeta.baseSpriteFamily === 'safecracker' ||
                variantMeta.baseSpriteFamily === 'exo_hacker' ||
                variantMeta.baseSpriteFamily === 'tactical_tech_ops');
            const spriteHeightPct = Number(
              (27.5 * depthScale * (isCrouchingWork ? 0.82 : 1.0)).toFixed(2)
            );

            const opState = resolveAgentOperationalState(st, meta.idleTag);
            const readiness = getOperativeReadiness(crewMember.customName || crewMember.id);
            const resolvedStatusText = isWalkingTransitionActive
              ? st.statusTag.startsWith('TO ')
                ? st.statusTag
                : 'MOVING'
              : isRoundtableSpeaker
              ? 'SPEAKING'
              : isAgentExecuting
              ? (opState.activeSkill ? `BOUND: ${opState.activeSkill.shortCode}` : 'EXECUTING')
              : opState.operationalBadge;

            return (
              <motion.div
                key={`${profile.id}-${st.room}`}
                initial={{
                  opacity: 0,
                  scale: 0.9,
                  left: `${st.xPct}%`,
                  top: `${st.yPct}%`,
                  x: '-50%',
                  y: '-100%',
                }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  left: `${st.xPct}%`,
                  top: `${st.yPct}%`,
                  x: '-50%',
                  y: '-100%',
                }}
                exit={{
                  opacity: 0,
                  scale: 0.88,
                  transition: { duration: 0.2 },
                }}
                transition={{
                  left: { type: 'tween', duration: 0.065, ease: 'linear' },
                  top: { type: 'tween', duration: 0.065, ease: 'linear' },
                  opacity: { duration: 0.22 },
                  scale: { type: 'spring', stiffness: 320, damping: 24 },
                }}
                style={{
                  left: `${st.xPct}%`,
                  top: `${st.yPct}%`,
                  transform: 'translate(-50%, -100%)',
                  height: `${spriteHeightPct}%`,
                  aspectRatio: isCrouchingWork ? '230 / 260' : '200 / 300',
                  zIndex: Math.round(st.yPct),
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveAgentId(profile.id);
                  if (currentRoom !== roomId) {
                    onChangeRoom(roomId);
                  }
                  if (isOverviewZoom) {
                    setIsOverviewZoom(false);
                  }
                  playBeep('tap');
                }}
                className="absolute z-20 cursor-pointer group select-none flex flex-col items-center justify-end"
                title={`${crewMember.customName} (${profile.role} · ${variantMeta.label}) — Sector: ${meta.shortBadge} — [${resolvedStatusText}]`}
              >
                {/* Clean 16-Bit Isometric Sprite Callout (Zero Bulky Background Boxes) */}
                <div
                  className={`absolute bottom-[102%] left-1/2 -translate-x-1/2 pb-0.5 flex flex-col items-center pointer-events-none ${
                    isOverviewZoom ? 'scale-75 origin-bottom' : ''
                  }`}
                >
                  {/* Unboxed Codename Callout */}
                  <div
                    className={`font-mono-tabular text-[10px] sm:text-[11px] font-bold tracking-wider whitespace-nowrap flex items-center gap-1 ${
                      isRoundtableSpeaker
                        ? `text-[#38bdf8] ${PIXEL_TEXT_SHADOW_CYAN}`
                        : isSelected
                        ? `text-[#e59838] ${PIXEL_TEXT_SHADOW_AMBER}`
                        : `text-[#f3ead8] ${PIXEL_TEXT_SHADOW_GREEN}`
                    }`}
                  >
                    <span>{isSelected ? '▼' : '·'}</span>
                    <span>{crewMember.customName}</span>
                  </div>

                  {/* Unboxed Phosphor-Green / Amber / Dynamic RGB Terminal Status Tag */}
                  <motion.span
                    animate={
                      isWalkingTransitionActive || isRoundtableSpeaker
                        ? { opacity: [0.75, 1, 0.75] }
                        : { opacity: 1 }
                    }
                    transition={
                      isWalkingTransitionActive || isRoundtableSpeaker
                        ? { duration: 0.6, repeat: Infinity }
                        : { duration: 0.15 }
                    }
                    className={`text-[9px] sm:text-[10px] font-mono-tabular font-bold tracking-wider whitespace-nowrap leading-none mt-0.5 ${
                      isRoundtableSpeaker
                        ? `text-[#38bdf8] ${PIXEL_TEXT_SHADOW_CYAN}`
                        : isWalkingTransitionActive || isAgentExecuting
                        ? `text-[#e59838] ${PIXEL_TEXT_SHADOW_AMBER}`
                        : `theme-text-primary ${PIXEL_TEXT_SHADOW_GREEN}`
                    }`}
                  >
                    [{resolvedStatusText}]
                  </motion.span>

                  {/* Sleek Unboxed 16-Bit Segmented Pixel Progress Ticks when Executing */}
                  {showProgressBar && !isOverviewZoom && (
                    <div className="mt-1 flex items-center gap-[2px] w-14 sm:w-16 h-1.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.95)]">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          className={`h-full flex-1 ${
                            i < filledSegments ? '' : 'bg-[#0b1310]/80'
                          }`}
                          style={
                            i < filledSegments
                              ? {
                                  backgroundColor: 'rgb(var(--theme-primary-rgb))',
                                  boxShadow: '0 0 4px var(--theme-glow-color)',
                                }
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )}

                  {completionAlertAgentId === profile.id && (
                    <span
                      className={`mt-0.5 text-[#fde047] font-mono-tabular font-bold text-[10px] ${PIXEL_TEXT_SHADOW_AMBER}`}
                    >
                      [✓ COMPLETE]
                    </span>
                  )}

                  {errorAlertAgentId === profile.id && (
                    <span
                      className="mt-0.5 text-red-400 font-mono-tabular font-bold text-[10px] [text-shadow:0_2px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000,0_0_8px_rgba(248,113,113,0.75)]"
                    >
                      [! ERROR]
                    </span>
                  )}
                </div>

                {/* Variant-Differentiated Pixel-Art Character Sprite */}
                <AgentSpriteFigure
                  spriteVariant={crewMember.spriteVariant}
                  pose={activePose}
                  walkFrame={walkFrame}
                  facing={st.facing}
                  isMoving={st.isMoving}
                  isWalkingTransition={isWalkingTransitionActive}
                  spriteState={spriteState}
                  isExecuting={isAgentExecuting}
                  themeId={themeId}
                  alt={crewMember.customName}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div
      className="relative z-0 isolate w-full max-w-5xl mx-auto select-none border-b bg-[#080a0f]"
      style={{ borderColor: 'var(--theme-border-color)' }}
    >
      {/* Top 16-Bit Tactical Sector Bezel Strip (Integrated above the canvas, never floating over room art) */}
      <div
        className="bg-[#0c0f16] border-b px-2.5 py-1.5 flex flex-nowrap items-center justify-between gap-2 font-mono-tabular shrink-0 overflow-x-auto no-scrollbar w-full"
        style={{ borderColor: 'var(--theme-border-color)' }}
      >
        {/* Left: Radar, 7-Room Zoom, and Active Sector Title */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <button
            type="button"
            onClick={handleToggleRadar}
            className={`text-[10px] sm:text-[11px] flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              showMinimap
                ? 'text-[#e59838] font-bold'
                : 'theme-text-primary theme-glow-text hover:opacity-85'
            }`}
            title="Toggle Retro Overworld Minimap Radar"
          >
            <Radar className="w-3 h-3 shrink-0" />
            <span>[RADAR]</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOverviewZoom((prev) => !prev);
              playBeep('switch');
            }}
            className={`text-[10px] sm:text-[11px] flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              isOverviewZoom
                ? 'text-[#38bdf8] font-bold'
                : 'text-[#94a3b8] hover:text-[#f3ead8]'
            }`}
            title="Toggle 7-Sector Full Overworld Map Zoom"
          >
            {isOverviewZoom ? (
              <Minimize2 className="w-3 h-3 shrink-0" />
            ) : (
              <Maximize2 className="w-3 h-3 shrink-0" />
            )}
            <span>{isOverviewZoom ? '[1x VIEW]' : '[7-SECTOR]'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsRoomSpawnerOpen(true);
              playBeep('tap');
            }}
            className="text-[10px] sm:text-[11px] flex items-center gap-1 cursor-pointer transition-colors text-[#38bdf8] hover:text-[#fde047] font-bold whitespace-nowrap shrink-0"
            title="Open Dynamic Room Spawner & Modular Skill Attachment Engine"
          >
            <Layers className="w-3 h-3 shrink-0" />
            <span>[+ EXPAND / SKILLS]</span>
          </button>

          <span className="text-[#334155]">·</span>

          <span className="text-[10px] theme-text-primary theme-glow-text font-bold shrink-0">
            [{activeRoomMeta.sectorCode}]
          </span>
          <span className="text-[11px] sm:text-xs font-semibold text-[#e59838] tracking-wide truncate">
            {formatSectorTitle(activeRoomMeta)}
          </span>
        </div>

        {/* Right: Sector Quick-Switch Tabs + Manual Bypass */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full no-scrollbar">
          {getAllRoomIds().map((rId) => {
            const active = rId === currentRoom;
            const meta = getRoomMeta(rId as RoomId);
            const countInRoom = Object.values(liveAgents).filter(
              (a) => a.room === rId
            ).length;
            return (
              <button
                key={rId}
                type="button"
                onClick={() => {
                  onChangeRoom(rId as RoomId);
                  if (isOverviewZoom) setIsOverviewZoom(false);
                  playBeep('switch');
                }}
                className={`px-1.5 py-0.5 text-[9px] sm:text-[10px] transition-colors flex items-center gap-0.5 cursor-pointer whitespace-nowrap ${
                  active
                    ? 'theme-text-primary theme-glow-text font-bold underline underline-offset-4'
                    : 'text-[#64748b] hover:text-[#cbd5e1]'
                }`}
              >
                <span>{meta.shortBadge}</span>
                {countInRoom > 0 && (
                  <span className="theme-text-primary">:{countInRoom}</span>
                )}
              </button>
            );
          })}

          {!isGameActive && onStartManualBypass && (
            <>
              <span className="text-[#334155]">·</span>
              <button
                type="button"
                onClick={onStartManualBypass}
                className="text-[10px] theme-text-primary theme-glow-text hover:text-[#fde047] font-bold cursor-pointer whitespace-nowrap"
                title="Launch interactive Neural Bypass mini-game"
              >
                [BYPASS]
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Scrollable / Pannable 2D Overworld Viewport (Standardized 16:9 Aspect Ratio / 960x540 Logical Virtual Grid) */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative isolate w-full aspect-[16/9] max-h-[50dvh] sm:max-h-none bg-[#080a0f] overflow-hidden mx-auto cursor-grab active:cursor-grabbing touch-pan-y"
        style={{
          boxShadow: 'inset 0 0 28px var(--theme-glow-soft)',
        }}
      >
        {/* 2D Multi-Wing Scrollable World Canvas (4 Columns x 2 Decks) with Smooth Camera Panning */}
        <motion.div
          animate={{
            x: `${cameraTranslateXPct}%`,
            y: `${cameraTranslateYPct}%`,
          }}
          transition={{
            type: 'spring',
            stiffness: 155,
            damping: 24,
            mass: 0.9,
          }}
          style={{
            width: isOverviewZoom ? '100%' : '400%',
            height: isOverviewZoom ? '100%' : '200%',
            transform: `translate(${cameraTranslateXPct}%, ${cameraTranslateYPct}%)`,
          }}
          className="grid grid-cols-4 grid-rows-2 relative"
        >
          {/* Row 0: Upper Deck Wing */}
          {UPPER_DECK_ROOMS.map((roomId) => renderSectorCell(roomId))}

          {/* Row 1: Lower Deck Wing */}
          {LOWER_DECK_ROOMS.map((roomId) => renderSectorCell(roomId))}

          {/* 4th Lower Grid Cell (Col 3, Row 1): Custom Spawned Room or Expansion Slot */}
          {(() => {
            const all = getAllRooms();
            const d2Room = Object.values(all).find(
              (r) =>
                r.gridCol === 3 &&
                r.gridRow === 1 &&
                !UPPER_DECK_ROOMS.includes(r.id) &&
                !LOWER_DECK_ROOMS.includes(r.id)
            );
            if (d2Room) {
              return renderSectorCell(d2Room.id as RoomId);
            }
            return (
              <div
                onClick={() => {
                  setIsRoomSpawnerOpen(true);
                  if (isOverviewZoom) setIsOverviewZoom(false);
                  playBeep('tap');
                }}
                className="relative w-full h-full overflow-hidden bg-[#0a0e17] cursor-pointer group"
                title="Click to spawn or configure custom sector at SEC-D2"
              >
                <img
                  src="/assets/rooms/archive_basement_clean.png"
                  alt="Sub-Level Transit Conduit"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover pixelated opacity-65 group-hover:opacity-85 transition-opacity pointer-events-none"
                  style={{
                    filter: 'var(--theme-room-filter) brightness(0.75)',
                  }}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center p-2 text-center pointer-events-none">
                  <span
                    className={`font-mono-tabular text-[10px] text-[#38bdf8] font-bold ${PIXEL_TEXT_SHADOW_CYAN}`}
                  >
                    [EXPANSION SLOT · SEC-D2]
                  </span>
                  <span
                    className={`font-mono-tabular text-[9px] text-[#4ade80] mt-0.5 ${PIXEL_TEXT_SHADOW_GREEN}`}
                  >
                    [+ CLICK TO SPAWN SECTOR]
                  </span>
                </div>
              </div>
            );
          })()}
        </motion.div>

        {/* Classified Safehouse Room Action Playbook Panel */}
        {!isOverviewZoom && onExecutePlaybook && (
          <RoomActionPlaybookPanel
            currentRoom={currentRoom}
            onExecutePlaybook={onExecutePlaybook}
            variant="floating"
            onOpenVfs={onOpenVfs}
            onOpenReconMonitor={onOpenReconOverlay}
          />
        )}

        {/* Minimal Unboxed Edge Step Chevrons */}
        <button
          type="button"
          onClick={() => handleStepRoom(-1)}
          className={`absolute left-1.5 top-1/2 -translate-y-1/2 z-30 p-1 text-[#e59838]/75 hover:text-[#fde047] transition-colors cursor-pointer ${PIXEL_TEXT_SHADOW_AMBER}`}
          aria-label="Pan camera West"
          title="Previous sector"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => handleStepRoom(1)}
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 z-30 p-1 text-[#e59838]/75 hover:text-[#fde047] transition-colors cursor-pointer ${PIXEL_TEXT_SHADOW_AMBER}`}
          aria-label="Pan camera East"
          title="Next sector"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {/* Retro Minimap / Overview Radar Popup HUD Overlay (Only shown when explicitly toggled) */}
        <AnimatePresence>
          {showMinimap && (
            <motion.div
              key="overworld-minimap-radar"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.16 }}
              className="absolute top-2 left-2.5 z-40 w-72 sm:w-84 bg-[#070b10]/95 border border-[#4ade80]/80 shadow-[0_0_24px_rgba(0,0,0,0.9)] p-2.5 font-mono-tabular"
            >
              <div className="flex items-center justify-between border-b border-[#1e3a2f] pb-1.5 mb-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#4ade80]">
                  <Compass className="w-3.5 h-3.5" />
                  <span>SAFEHOUSE OVERWORLD RADAR</span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleRadar}
                  className="text-[10px] text-[#94a3b8] hover:text-white px-1 cursor-pointer"
                >
                  [X]
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <div>
                  <div className="text-[9px] text-[#94a3b8] uppercase mb-1 flex items-center justify-between">
                    <span>Upper Tactical Wing</span>
                    <span className="text-[#4ade80]">Select Sector</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {UPPER_DECK_ROOMS.map((rId) => {
                      const m = getRoomMeta(rId);
                      const isCam = currentRoom === rId;
                      const agentsHere = crewAgents
                        .map((crew, i) => ({
                          idx: i,
                          state: liveAgents[i],
                          crew,
                        }))
                        .filter((a) => a.state && a.state.room === rId);

                      return (
                        <button
                          key={rId}
                          type="button"
                          onClick={() => {
                            onChangeRoom(rId);
                            playBeep('switch');
                          }}
                          className={`p-1.5 border text-left transition-colors relative cursor-pointer ${
                            isCam
                              ? 'bg-[#132019] border-[#e59838] text-[#f3ead8]'
                              : 'bg-[#0b111a] border-[#1e2d3d] text-[#94a3b8] hover:border-[#4ade80]'
                          }`}
                        >
                          <div className="text-[8px] text-[#e59838] font-bold">
                            {m.sectorCode}
                          </div>
                          <div className="text-[9px] font-semibold truncate">
                            {m.shortBadge}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-1 min-h-[12px]">
                            {agentsHere.map(({ idx, crew }) => {
                              const vMeta = SPRITE_VARIANTS[crew.spriteVariant];
                              return (
                                <span
                                  key={idx}
                                  className="text-[8px] font-bold"
                                  style={{ color: vMeta.accentHex }}
                                >
                                  [{crew.customName.slice(0, 2).toUpperCase()}]
                                </span>
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-[#94a3b8] uppercase mb-1">
                    Lower Archive & Crew Wing
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {LOWER_DECK_ROOMS.map((rId) => {
                      const m = getRoomMeta(rId);
                      const isCam = currentRoom === rId;
                      const agentsHere = crewAgents
                        .map((crew, i) => ({
                          idx: i,
                          state: liveAgents[i],
                          crew,
                        }))
                        .filter((a) => a.state && a.state.room === rId);

                      return (
                        <button
                          key={rId}
                          type="button"
                          onClick={() => {
                            onChangeRoom(rId);
                            playBeep('switch');
                          }}
                          className={`p-1.5 border text-left transition-colors relative cursor-pointer ${
                            isCam
                              ? 'bg-[#132019] border-[#e59838] text-[#f3ead8]'
                              : 'bg-[#0b111a] border-[#1e2d3d] text-[#94a3b8] hover:border-[#4ade80]'
                          }`}
                        >
                          <div className="text-[8px] text-[#e59838] font-bold">
                            {m.sectorCode}
                          </div>
                          <div className="text-[9px] font-semibold truncate">
                            {m.shortBadge}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-1 min-h-[12px]">
                            {agentsHere.map(({ idx, crew }) => {
                              const vMeta = SPRITE_VARIANTS[crew.spriteVariant];
                              return (
                                <span
                                  key={idx}
                                  className="text-[8px] font-bold"
                                  style={{ color: vMeta.accentHex }}
                                >
                                  [{crew.customName.slice(0, 2).toUpperCase()}]
                                </span>
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        onChangeRoom('archive_basement');
                        playBeep('switch');
                      }}
                      className="p-1.5 border border-[#1e293b] bg-[#090d14] text-left text-[#64748b] hover:border-[#38bdf8] cursor-pointer"
                    >
                      <div className="text-[8px] text-[#38bdf8]">SEC-D2</div>
                      <div className="text-[9px] truncate">CONDUIT</div>
                      <div className="text-[8px] mt-1 text-[#475569]">[LIFT]</div>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modular Neural Bypass / Theme-Aware Mini-Game Overlay */}
        <GameOverlay
          isActive={isGameActive}
          isClosing={isGameClosing}
          themeId={themeId}
          onBoostChange={onGameBoostChange}
          onSequenceComplete={(boost) => onGameSequenceComplete?.(boost)}
          onAbort={onAbortGame}
        />
      </div>

      {/* Integrated 16-Bit Tactical Bottom Screen Tray:
          - Sleek phosphor-green (#4ade80) & amber (#e59838) operative status tags ([ACTIVE], [COMM BREAK], etc.)
          - Live Room Object interaction readout (only shown when an agent interacts with or user hovers a station)
          - Clean terminal text triggers for sector dispatch & deck switching with zero floating room boxes */}
      <div
        className="bg-[#0a0d13] border-t px-3 py-1.5 flex flex-col gap-1 font-mono-tabular text-[10px] sm:text-[11px]"
        style={{ borderColor: 'var(--theme-border-color)' }}
      >
        {/* Row 1: All Operatives' Terminal Status Tags + Active Room Object Readout */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 min-h-[20px] overflow-hidden">
          {/* Sleek Terminal-Style Dynamic RGB / Amber Agent Status Tags */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0 overflow-x-auto no-scrollbar touch-pan-x overscroll-x-contain scroll-smooth max-w-full py-0.5">
            {crewAgents.map((crew, idx) => {
              const st = liveAgents[idx];
              if (!crew || !st) return null;
              const isSelected = activeAgent.id === crew.id;
              const isSpeaker =
                isMeetingActive && activeSpeakerAgentIndex === idx;
              const isExec =
                executingAgentIds.includes(crew.id) || (isExecuting && isSelected) || isSpeaker;
              const readiness = getOperativeReadiness(crew.customName || crew.id);
              const statusLabel = st.isMoving
                ? st.statusTag
                : isSpeaker
                ? 'SPEAKING'
                : isExec
                ? 'EXECUTING'
                : st.statusTag === 'COFFEE BREAK'
                ? 'COMM BREAK'
                : st.statusTag || 'STANDBY';

              return (
                <button
                  key={crew.id}
                  type="button"
                  onClick={() => {
                    setActiveAgentId(crew.id);
                    onChangeRoom(st.room);
                    playBeep('tap');
                  }}
                  className="flex items-center gap-1 cursor-pointer group text-left shrink-0 whitespace-nowrap"
                  title={`Focus ${crew.customName} in ${getRoomMeta(st.room).shortBadge}`}
                >
                  <span
                    className={
                      isSelected
                        ? 'text-[#e59838] font-bold'
                        : 'text-[#cbd5e1] group-hover:text-white'
                    }
                  >
                    {isSelected ? '▸' : '·'} {crew.customName.toUpperCase()}
                  </span>
                  <span
                    className={
                      isSpeaker
                        ? 'text-[#38bdf8] font-bold'
                        : st.isMoving || isExec
                        ? 'text-[#e59838] font-bold'
                        : 'theme-text-primary theme-glow-text font-semibold'
                    }
                  >
                    [{statusLabel}]
                  </span>
                  <span className="text-[#64748b] text-[9px]">
                    @{getRoomMeta(st.room).sectorCode}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Room Object Interaction Readout (Holo-Tables, Terminal Racks, etc.) */}
          <div className="flex items-center justify-start sm:justify-end gap-2 text-[9.5px] sm:text-[10px] truncate min-w-0 flex-1 text-left sm:text-right border-t sm:border-t-0 border-[#141a26]/60 pt-0.5 sm:pt-0">
            {walkingTransition ? (
              <span className="text-[#e59838] flex items-center gap-1 truncate">
                <Footprints className="w-3 h-3 inline shrink-0" />
                <span className="truncate">
                  TRANSIT: {getRoomMeta(walkingTransition.fromRoom).shortBadge}{' '}
                  &rarr; {getRoomMeta(walkingTransition.toRoom).shortBadge}
                </span>
              </span>
            ) : isRoutingCamera ? (
              <span className="theme-text-primary theme-glow-text truncate">
                CAMERA LOCK: {activeRoomMeta.shortBadge} [{activeRoomMeta.sectorCode}]
              </span>
            ) : interactingStationInRoom ? (
              <span className="theme-text-primary theme-glow-text truncate">
                OBJECT:{' '}
                <strong className="text-[#e59838]">
                  {interactingStationInRoom.station.label.toUpperCase()}
                </strong>{' '}
                · [{interactingStationInRoom.status}]
                {interactingStationInRoom.agentName
                  ? ` (${interactingStationInRoom.agentName})`
                  : ' (CLICK TO ASSIGN)'}
              </span>
            ) : (
              <span className="text-[#64748b] truncate">
                SECTOR CLEAR · HOVER OR CLICK STATION TO ASSIGN
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Unboxed Terminal Sector-Dispatch & Deck-Lift Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2 pt-1 border-t border-[#141a26] text-[10px] min-h-[24px]">
          {/* Dispatch Navigation & Station Targets with Touch-Slide */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x overscroll-x-contain scroll-smooth min-w-0 max-w-full py-0.5">
            <span className="text-[#64748b] flex items-center gap-1 shrink-0 select-none">
              <ArrowRightLeft className="w-3 h-3 text-[#e59838]" />
              <span className="font-semibold text-[#cbd5e1]">DISPATCH {activeCrewMember.customName.toUpperCase()}:</span>
            </span>
            {activeRoomMeta.neighbors.map((targetRoom) => (
              <button
                key={targetRoom}
                type="button"
                onClick={() => onMoveAgentToRoom(activeCrewMember.id, targetRoom)}
                className="text-[#e59838] hover:text-[#fde047] active:text-[#fde047] cursor-pointer whitespace-nowrap shrink-0 px-1 py-0.5 rounded hover:bg-[#e59838]/10 transition-colors"
              >
                [&rarr; {getRoomMeta(targetRoom).shortBadge}]
              </button>
            ))}

            {currentRoomStations.map((st) => {
              const isCurrentStation =
                activeLiveAgent?.room === currentRoom &&
                activeLiveAgent?.stationId === st.id &&
                !activeLiveAgent?.isMoving;
              return (
                <button
                  key={st.id}
                  type="button"
                  onMouseEnter={() =>
                    setHoveredStation((prev) => (prev?.id === st.id ? prev : st))
                  }
                  onMouseLeave={() =>
                    setHoveredStation((prev) => (prev?.id === st.id ? null : prev))
                  }
                  onClick={() => {
                    commandAgentWalkTo(activeAgentIdx, currentRoom, st.id);
                    playBeep('tap');
                  }}
                  className={`cursor-pointer whitespace-nowrap shrink-0 px-1 py-0.5 rounded transition-colors ${
                    isCurrentStation
                      ? 'text-[#4ade80] font-bold bg-[#4ade80]/10'
                      : 'text-[#94a3b8] hover:text-[#4ade80] active:text-[#4ade80]'
                  }`}
                >
                  [{st.label}]
                </button>
              );
            })}
          </div>

          {/* Deck Switcher, Roundtable & Status Indicators */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x overscroll-x-contain scroll-smooth shrink-0 max-w-full py-0.5 border-t sm:border-t-0 border-[#141a26]/60 pt-0.5 sm:pt-0">
            {agentsInOtherRooms.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <UserPlus className="w-3 h-3 text-[#4ade80]" />
                {agentsInOtherRooms.map(({ idx, crew, state }) => (
                  <button
                    key={crew.id}
                    type="button"
                    onClick={() => {
                      commandAgentWalkTo(idx, currentRoom);
                      onMoveAgentToRoom(crew.id, currentRoom);
                    }}
                    className="text-[#4ade80] hover:text-[#86efac] active:text-[#86efac] cursor-pointer whitespace-nowrap shrink-0"
                    title={`Summon ${crew.customName} from ${getRoomMeta(state.room).shortBadge}`}
                  >
                    [+SUMMON {crew.customName.toUpperCase()}]
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                handlePanGridDirection(0, activeRoomMeta.gridRow === 0 ? 1 : -1)
              }
              className="text-[#38bdf8] hover:text-[#7dd3fc] active:text-[#7dd3fc] flex items-center gap-0.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              {activeRoomMeta.gridRow === 0 ? (
                <>
                  <ChevronDown className="w-3 h-3" />
                  <span>[LOWER DECK]</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-3 h-3" />
                  <span>[UPPER DECK]</span>
                </>
              )}
            </button>

            {onCallMeeting && (
              <button
                type="button"
                onClick={onCallMeeting}
                className={`cursor-pointer whitespace-nowrap shrink-0 ${
                  isMeetingActive
                    ? 'text-[#38bdf8] font-bold'
                    : 'text-[#e59838] hover:text-[#fde047] active:text-[#fde047]'
                }`}
              >
                [ROUNDTABLE]
              </button>
            )}

            <div className="flex items-center gap-1.5 text-[#94a3b8] whitespace-nowrap text-[9px] sm:text-[10px] font-mono-tabular select-none px-1.5 py-0.5 rounded bg-black/30 border border-[#38bdf8]/20 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8] animate-pulse" />
              <span>[STATE-BOUND · IDLE LOCKED]</span>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Room Expansion & Skill Binding Modal */}
      {isRoomSpawnerOpen && (
        <Suspense fallback={null}>
          <RoomSpawnerModal
            isOpen={isRoomSpawnerOpen}
            onClose={() => setIsRoomSpawnerOpen(false)}
            currentRoom={currentRoom}
            onNavigateToRoom={(rId) => {
              onChangeRoom(rId);
              if (isOverviewZoom) setIsOverviewZoom(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

