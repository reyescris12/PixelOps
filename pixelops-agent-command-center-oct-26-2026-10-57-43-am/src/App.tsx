/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { ThemeProvider, useTheme, THEMES, ThemeId } from './context/ThemeContext';
import {
  CrewProvider,
  useCrew,
  SPRITE_VARIANT_LIST,
  SPRITE_VARIANTS,
  SpriteVariantCategory,
} from './context/CrewContext';
import {
  SpriteCanvas,
  AgentSpriteFigure,
  RoomId,
  ROOM_ORDER,
  ROOM_METADATA,
  ROOM_STATIONS,
} from './components/SpriteCanvas';
import {
  getAllRooms,
  getAllRoomIds,
  getRoomMetadata,
  getRoomStations,
} from './engine/roomManager';
import {
  getAgentRuntimeTools,
  resolveAgentOperationalState,
} from './engine/moduleRegistry';
import { TerminalWindow } from './components/TerminalWindow';
import { SettingsModal } from './components/SettingsModal';
import { ThemeSettings } from './components/ThemeSettings';
import { RetroErrorModal } from './components/RetroErrorModal';
import { PWAInstallButton, OfflineBanner } from './components/PWAInstallButton';
import {
  AgentExecutionCard,
  PluginConnector,
  CommandPreferences,
  RetroAgentError,
  RetroErrorCode,
  RetroErrorDescriptor,
  RoundtableMeetingSession,
  RoundtableParticipantPayload,
  createRetroAgentError,
  classifyRetroErrorCode,
  loadExecutionCards,
  saveExecutionCards,
  loadPlugins,
  savePlugins,
  loadPreferences,
  savePreferences,
  loadRoundtableSessions,
  saveRoundtableSessions,
  executeAgentDirective,
  executeRoundtableMeeting,
} from './services/ApiService';
import {
  VaultStartupReport,
  initializeAndValidateVaultOnStartup,
  refreshOAuthProviderToken,
  revokeOAuthProviderToken,
} from './services/SecureVaultService';
import {
  CommandLedgerEntry,
  appendCommandLedgerEntry,
  getLast50Commands,
} from './services/CommandLedgerDb';
import { CommandLogScreen } from './components/CommandLogScreen';
import { TownHallRoundtablePanel } from './components/TownHallRoundtablePanel';
import {
  PendingTaskSnapshot,
  loadAppSessionSnapshot,
  useAppStatePersistence,
} from './services/AppStatePersistence';
import {
  ambientAudioService,
  ROOM_SOUNDSCAPE_PROFILES,
} from './services/AmbientAudioService';

import { AgentEditorModal } from './components/AgentEditorModal';
import { NightShiftModal } from './components/NightShiftModal';
import { loadNightShiftNotifications } from './services/NightShiftService';
import { backgroundWorkerEngine } from './services/WorkerService';
import { InboxProvider, useInbox } from './context/InboxContext';
import { NotificationInboxModal } from './components/NotificationInboxModal';
import { CustomPluginConnector, loadCustomPlugins, saveCustomPlugins } from './services/PluginMarketplaceService';
import { CustomPluginModal } from './components/CustomPluginModal';
import { TelemetryModal } from './components/TelemetryModal';
import { AgentFactoryModal } from './components/AgentFactoryModal';
import { recordTelemetryExecution } from './services/TelemetryStore';
import { analyzePromptAmbiguity } from './engine/taskBriefEngine';
import { TaskBriefModal, TaskBrief } from './components/TaskBriefModal';
import { TerminalConsole } from './components/TerminalConsole';

type NavTab = 'hq' | 'crew' | 'plugins' | 'themes';
type HqSubView = 'terminal' | 'town_hall' | 'command_log';

const CommandCenterContent: React.FC = () => {
  const {
    theme,
    themeId,
    setThemeId,
    activeAgent,
    setActiveAgentId,
    soundEnabled,
    setSoundEnabled,
    playBeep,
  } = useTheme();
  const {
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
  } = useCrew();
  const [previewWalkFrame, setPreviewWalkFrame] = useState<1 | 2>(1);
  const [spriteArmoryCategory, setSpriteArmoryCategory] = useState<'All' | SpriteVariantCategory>('All');
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const editingCrewAgent = editingAgentId ? getCrewAgent(editingAgentId) || null : null;

  // Restore persisted session state on app relaunch
  const [restoredSession] = useState(() => loadAppSessionSnapshot());

  const [activeTab, setActiveTab] = useState<NavTab>(
    () => restoredSession?.activeTab || 'hq'
  );
  const [hqSubView, setHqSubView] = useState<HqSubView>(
    () => restoredSession?.hqSubView || 'terminal'
  );

  useEffect(() => {
    if (activeTab !== 'crew') return;
    const t = setInterval(() => {
      setPreviewWalkFrame((f) => (f === 1 ? 2 : 1));
    }, 220);
    return () => clearInterval(t);
  }, [activeTab]);
  const [commandLedger, setCommandLedger] = useState<CommandLedgerEntry[]>([]);
  const [currentRoom, setCurrentRoom] = useState<RoomId>(
    () => restoredSession?.currentRoom || 'war_room'
  );

  // Dynamically switch retro-synthesized ambient room soundscape when currentRoom or soundEnabled updates
  useEffect(() => {
    ambientAudioService.setRoom(currentRoom, soundEnabled);
  }, [currentRoom, soundEnabled]);
  const [agentRooms, setAgentRooms] = useState<Record<string, RoomId>>(
    () =>
      restoredSession?.agentRooms || {
        vance: 'war_room',
        nyx: 'comms_tower',
        cipher: 'library',
        oakwood: 'war_room',
        vera: 'comms_tower',
        pory: 'library',
        ragnar: 'war_room',
        freya: 'comms_tower',
        skald: 'library',
      }
  );
  const [isMinimapOpen, setIsMinimapOpen] = useState(false);
  const [walkingTransition, setWalkingTransition] = useState<{
    agentId: string;
    fromRoom: RoomId;
    toRoom: RoomId;
    preferredStationId?: string;
    taskTag?: string;
  } | null>(null);
  const [isRoutingCamera, setIsRoutingCamera] = useState(false);
  const [executionCards, setExecutionCards] = useState<AgentExecutionCard[]>(() => loadExecutionCards());
  const [plugins, setPlugins] = useState<PluginConnector[]>(() => loadPlugins());
  const [preferences, setPreferences] = useState<CommandPreferences>(() => loadPreferences());
  const [isExecuting, setIsExecuting] = useState(false);
  const [isGameActive, setIsGameActive] = useState(false);
  const [isGameClosing, setIsGameClosing] = useState(false);
  const [decryptionBoost, setDecryptionBoost] = useState<number>(
    () => restoredSession?.decryptionBoost || 0
  );
  const [pendingTask, setPendingTask] = useState<PendingTaskSnapshot | null>(
    () => (restoredSession?.pendingTask?.isPending ? restoredSession.pendingTask : null)
  );
  const [completionAlertAgentId, setCompletionAlertAgentId] = useState<string | null>(null);
  const [lastActionSummary, setLastActionSummary] = useState<string | null>(
    () => restoredSession?.lastActionSummary || null
  );
  const [dialogueText, setDialogueText] = useState<string>(
    () =>
      restoredSession?.dialogueText ||
      loadExecutionCards()[0]?.dialogue ||
      'Target acquired. Scanning web nodes for flight data...'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retroError, setRetroError] = useState<RetroErrorDescriptor | null>(null);
  const [isRetroErrorModalOpen, setIsRetroErrorModalOpen] = useState(false);
  const [serverReady, setServerReady] = useState<boolean>(true);
  const [vaultReport, setVaultReport] = useState<VaultStartupReport | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNightShiftOpen, setIsNightShiftOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [isAgentFactoryOpen, setIsAgentFactoryOpen] = useState(false);
  const [isTerminalConsoleOpen, setIsTerminalConsoleOpen] = useState(false);
  const [taskBriefState, setTaskBriefState] = useState<{
    isOpen: boolean;
    brief: TaskBrief | null;
    rawPrompt: string;
    attachment?: { data: string; mimeType: string; name: string } | null;
  }>({
    isOpen: false,
    brief: null,
    rawPrompt: '',
    attachment: null,
  });
  const { unreadCount } = useInbox();
  const [customPlugins, setCustomPlugins] = useState<CustomPluginConnector[]>(loadCustomPlugins);
  const [isCustomPluginModalOpen, setIsCustomPluginModalOpen] = useState(false);
  const [editingCustomPlugin, setEditingCustomPlugin] = useState<CustomPluginConnector | null>(null);

  // Town Hall Meeting & Multi-Agent Roundtable States
  const [roundtableSessions, setRoundtableSessions] = useState<RoundtableMeetingSession[]>(
    () => loadRoundtableSessions()
  );
  const [isExecutingMeeting, setIsExecutingMeeting] = useState(false);
  const [townHallSummonNonce, setTownHallSummonNonce] = useState(0);
  const [activeSpeakerAgentIndex, setActiveSpeakerAgentIndex] = useState<number | null>(
    null
  );
  const isMeetingActive = activeTab === 'hq' && hqSubView === 'town_hall';

  // React lifecycle & AppState listener: saves Context/session state on minimize, background, or unmount
  useAppStatePersistence({
    themeId,
    activeAgentId: activeAgent.id,
    currentRoom,
    agentRooms,
    activeTab,
    hqSubView,
    dialogueText,
    lastActionSummary,
    decryptionBoost,
    pendingTask,
  });

  const refreshCommandLedger = async () => {
    try {
      const latest50 = await getLast50Commands();
      setCommandLedger(latest50);
    } catch {
      // Ignore IndexedDB error in restricted mode
    }
  };

  const runStartupVaultValidation = async () => {
    try {
      const report = await initializeAndValidateVaultOnStartup();
      setVaultReport(report);
      setServerReady(report.geminiVaultValid);

      // Sync plugin connection states with validated OAuth tokens from idb-keyval
      setPlugins((prev) => {
        const synced = prev.map((p) => {
          const val = report.providerValidations[p.id];
          if (!val) return p;
          return {
            ...p,
            connected: val.valid,
            accountHandle: val.accountHandle || p.accountHandle,
            lastSync: val.valid
              ? `AES-GCM Verified · ${val.maskedAccessToken}`
              : 'Token Revoked / Unlinked',
          };
        });
        savePlugins(synced);
        return synced;
      });
    } catch {
      setServerReady(false);
    }
  };

  useEffect(() => {
    runStartupVaultValidation();
    refreshCommandLedger();
    backgroundWorkerEngine.startBackgroundLoop();
  }, []);

  const handleUpdatePreferences = (next: CommandPreferences) => {
    setPreferences(next);
    savePreferences(next);
  };

  const handleTogglePlugin = async (pluginId: PluginConnector['id']) => {
    playBeep('tap');
    const target = plugins.find((p) => p.id === pluginId);
    if (!target) return;

    if (target.connected) {
      await revokeOAuthProviderToken(pluginId);
    } else {
      await refreshOAuthProviderToken(pluginId);
    }
    await runStartupVaultValidation();
  };

  const handleRotatePluginOAuth = async (pluginId: PluginConnector['id']) => {
    playBeep('complete');
    await refreshOAuthProviderToken(pluginId);
    await runStartupVaultValidation();
  };

  const smoothCloseGameOverlay = () => {
    setIsGameClosing(true);
    setTimeout(() => {
      setIsGameActive(false);
      setIsGameClosing(false);
    }, 320);
  };

  // Resolution Handler A: User finishes the Neural Bypass sequence first
  const handleGameSequenceComplete = (finalBoostPct: number) => {
    setDecryptionBoost(finalBoostPct);
    playBeep('complete');

    // Award +150 token/battery bonus
    const bonusPrefs: CommandPreferences = {
      ...preferences,
      usedTokens: Math.max(0, preferences.usedTokens - 150),
      onboardingCompleted: true,
    };
    handleUpdatePreferences(bonusPrefs);

    // Force-complete the loading state and show bonus feedback
    setIsExecuting(false);
    setPendingTask(null);
    setCompletionAlertAgentId(activeAgent.id);
    setDialogueText(
      `[BYPASS OVERRIDE +${finalBoostPct}%] Neural sequence cleared! +150 battery token bonus awarded. Finalizing telemetry...`
    );
    smoothCloseGameOverlay();
  };

  const resolveTaskAssignment = (
    promptText: string,
    hasAttachment: boolean
  ): {
    room: RoomId;
    agentIndex: number;
    stationId: string;
    taskTag: string;
  } => {
    const lower = promptText.toLowerCase();

    // Explicit agent name (default or user-customized name) mentioned in prompt
    const c0 = getCrewAgentByIndex(0)?.customName?.toLowerCase() || '';
    const c1 = getCrewAgentByIndex(1)?.customName?.toLowerCase() || '';
    const c2 = getCrewAgentByIndex(2)?.customName?.toLowerCase() || '';

    const mentionsVance =
      /vance|oakwood|ragnar/.test(lower) || (c0.length > 2 && lower.includes(c0));
    const mentionsNyx =
      /nyx|vera|freya/.test(lower) || (c1.length > 2 && lower.includes(c1));
    const mentionsCipher =
      /cipher|pory|skald/.test(lower) || (c2.length > 2 && lower.includes(c2));

    // 1. Archive Basement (Deep Dossier Vault, Omega Clearance, Microfiche)
    if (
      /vault|dossier|omega|basement|cold storage|microfiche|pneumatic|classified|nightfall/.test(
        lower
      )
    ) {
      const stationId = /microfiche|tape/.test(lower)
        ? 'basement_microfiche'
        : /pneumatic|tube/.test(lower)
        ? 'basement_pneumatic'
        : 'basement_omega_safe';
      return {
        room: 'archive_basement',
        agentIndex: mentionsVance ? 0 : mentionsNyx ? 1 : 2,
        stationId,
        taskTag: 'UNSEALING',
      };
    }

    // 2. Tactical Armory (Drones, Gear, Weapons, Gadgets, Calibration)
    if (
      /armory|drone|gear|armor|ballistic|weapon|gadget|calibrate|loadout|ordnance|shield/.test(
        lower
      )
    ) {
      const stationId = /drone/.test(lower)
        ? 'armory_drone_bay'
        : /bench|gadget|calibrate/.test(lower)
        ? 'armory_workbench'
        : 'armory_gear_rack';
      return {
        room: 'armory',
        agentIndex: mentionsNyx ? 1 : mentionsCipher ? 2 : 0,
        stationId,
        taskTag: stationId === 'armory_drone_bay' ? 'DRONE PREP' : 'GEAR CHECK',
      };
    }

    // 3. Comms Tower (Slack, Broadcasts, Radio, Dish, Signal, Radar)
    if (
      /slack|channel|dispatch|broadcast|radio|tower|comms|antenna|dish|signal|alert|perimeter/.test(
        lower
      )
    ) {
      const stationId = /radar|sweep/.test(lower)
        ? 'comms_radar_scope'
        : /transceiver|cipher|frequency/.test(lower)
        ? 'comms_cipher_rig'
        : 'comms_dish_console';
      return {
        room: 'comms_tower',
        agentIndex: mentionsVance ? 0 : mentionsCipher ? 2 : 1,
        stationId,
        taskTag: 'DISPATCHING',
      };
    }

    // 4. Briefing Lounge (Calendar, Scheduling, Meetings, Briefings, Coffee/Rest)
    if (
      /calendar|schedule|meeting|briefing|lounge|coffee|espresso|rest|appointment|sync/.test(
        lower
      ) &&
      !/flight/.test(lower)
    ) {
      const stationId = /coffee|espresso|ration/.test(lower)
        ? 'lounge_coffee_bar'
        : /rest|sofa|couch/.test(lower)
        ? 'lounge_sofa'
        : 'lounge_holo_table';
      return {
        room: 'briefing_lounge',
        agentIndex: mentionsNyx ? 1 : mentionsCipher ? 2 : 0,
        stationId,
        taskTag: 'SCHEDULING',
      };
    }

    // 5. Intel Library (Weather, Forecasts, Books, Decryption, Visual Attachments)
    if (
      hasAttachment ||
      /weather|forecast|temperature|humidity|celsius|fahrenheit|wind|rain|climate|library|archive|lore|intel|file|chart|photo|image|decrypt|cipher|book|ledger/.test(
        lower
      )
    ) {
      const isWeather =
        /weather|forecast|temperature|humidity|celsius|fahrenheit|wind|rain|climate/.test(
          lower
        );
      const stationId = isWeather
        ? 'lib_front_desk'
        : /decrypt|cipher|code|key|lock/.test(lower)
        ? 'lib_east_stacks'
        : /search|stack|shelf|book/.test(lower)
        ? 'lib_west_stacks'
        : 'lib_front_desk';
      return {
        room: 'library',
        agentIndex: mentionsVance ? 0 : mentionsNyx ? 1 : 2,
        stationId,
        taskTag: isWeather
          ? 'WEATHER SCAN'
          : stationId === 'lib_east_stacks'
          ? 'DECRYPTING'
          : 'INDEXING',
      };
    }

    // 6. Server Vault (Web Search, GitHub, Mainframe, Code, JSON)
    if (
      /web|search|wikipedia|lookup|who is|what is|github|code|bug|patch|hack|server|mainframe|node|json|script|cyber|ticket|issue|override|compile|deploy|firewall/.test(
        lower
      )
    ) {
      if (
        /war room|recon|flight/.test(lower) &&
        !/search|web|wikipedia/.test(lower)
      ) {
        return {
          room: 'war_room',
          agentIndex: mentionsVance ? 0 : mentionsCipher ? 2 : 1,
          stationId: 'war_server_rack',
          taskTag: 'HACKING',
        };
      }
      const isWebSearch = /web|search|wikipedia|lookup|who is|what is/.test(
        lower
      );
      const stationId =
        isWebSearch || /compile|laptop|terminal|script|patch|json/.test(lower)
          ? 'vault_laptop'
          : /power|breaker|relay|voltage/.test(lower)
          ? 'vault_breakers'
          : 'vault_core_rack';
      return {
        room: 'server_vault',
        agentIndex: mentionsVance ? 0 : mentionsCipher ? 2 : 1,
        stationId,
        taskTag: isWebSearch
          ? 'WEB SEARCH'
          : stationId === 'vault_laptop'
          ? 'COMPILING'
          : 'HACKING',
      };
    }

    // 7. War Room (Flight Nodes, Tactical Recon, Command)
    if (/scan|monitor|recon|satellite|track|flight|watch|war|extract/.test(lower)) {
      return {
        room: 'war_room',
        agentIndex: mentionsNyx ? 1 : mentionsCipher ? 2 : 0,
        stationId: /flight|scan/.test(lower)
          ? 'war_left_desk'
          : 'war_center_desk',
        taskTag: 'SCANNING',
      };
    }

    // Default: use currently selected activeAgent and assign a workstation in their target sector
    const activeIdx = Math.max(
      0,
      crewAgents.findIndex((a) => a.id === activeAgent.id)
    );
    const defaultStation =
      (getRoomStations(currentRoom) && getRoomStations(currentRoom)[0]?.id) ||
      'war_center_desk';

    return {
      room: currentRoom,
      agentIndex: activeIdx,
      stationId: defaultStation,
      taskTag: 'EXECUTING',
    };
  };

  const handleMoveAgentToRoom = (
    agentId: string,
    targetRoom: RoomId,
    preferredStationId?: string,
    taskTag?: string
  ) => {
    const crewMember = getCrewAgent(agentId);
    const currentAgentRoom =
      agentRooms[agentId] || crewMember?.currentRoom || 'war_room';
    const targetAgent = theme.agents.find((a) => a.id === agentId) || activeAgent;
    const displayName = crewMember?.customName || targetAgent.name;

    setWalkingTransition({
      agentId,
      fromRoom: currentAgentRoom,
      toRoom: targetRoom,
      preferredStationId,
      taskTag,
    });
    setAgentRooms((prev) => ({
      ...prev,
      [agentId]: targetRoom,
    }));
    updateAgentRoom(agentId, targetRoom, preferredStationId);
    setActiveAgentId(agentId);
    setCurrentRoom(targetRoom);
    playBeep('switch');

    const roomMeta = getRoomMetadata(targetRoom);
    const roomBadge = roomMeta?.shortBadge || String(targetRoom).toUpperCase();
    setDialogueText(
      `${displayName} pathfinding to ${roomBadge}${preferredStationId ? ` [${taskTag || 'WORKSTATION'}]` : ''}. ${roomMeta?.defaultBriefing || ''}`
    );

    setTimeout(() => {
      setWalkingTransition(null);
    }, 1800);
  };

  const handleRoomChange = (nextRoom: RoomId) => {
    setCurrentRoom(nextRoom);
    if (!isExecuting) {
      setDialogueText(getRoomMetadata(nextRoom).defaultBriefing);
    }
  };

  const handleExecuteDirective = async (
    prompt: string,
    attachment?: { data: string; mimeType: string; name: string } | null,
    skipAmbiguityCheck: boolean = false
  ) => {
    // 0. Automated Ambiguity Detection & Task Brief Interception (StarNet pattern)
    if (!skipAmbiguityCheck && !attachment) {
      const ambiguityAnalysis = analyzePromptAmbiguity(prompt, { activeAgentRole: activeAgent.role });
      if (ambiguityAnalysis.requiresClarification && ambiguityAnalysis.brief) {
        playBeep('error');
        setTaskBriefState({
          isOpen: true,
          brief: ambiguityAnalysis.brief,
          rawPrompt: prompt,
          attachment: attachment || null,
        });
        return;
      }
    }

    // Automatically route viewport camera & specialist agent to the relevant room and workstation based on task given
    const assignment = resolveTaskAssignment(prompt, Boolean(attachment));
    const targetRoom = assignment.room;
    const routedCrewMember = getCrewAgentByIndex(assignment.agentIndex);
    const routedAgent = theme.agents[assignment.agentIndex] || {
      ...activeAgent,
      id: routedCrewMember?.id || activeAgent.id,
      name: routedCrewMember?.customName || activeAgent.name,
      role: routedCrewMember?.role || activeAgent.role,
    };
    const routedDisplayName = routedCrewMember?.customName || routedAgent.name;

    handleMoveAgentToRoom(
      routedAgent.id,
      targetRoom,
      assignment.stationId,
      assignment.taskTag
    );
    setIsRoutingCamera(true);
    setTimeout(() => setIsRoutingCamera(false), 2400);

    setIsExecuting(true);
    setIsGameActive(true);
    setIsGameClosing(false);
    setDecryptionBoost(0);
    setErrorMessage(null);
    setRetroError(null);
    setIsRetroErrorModalOpen(false);
    setPendingTask({
      isPending: true,
      prompt,
      attachment: attachment || null,
      assignedAgentId: routedAgent.id,
      assignedRoom: targetRoom,
      assignedStationId: assignment.stationId,
      taskTag: assignment.taskTag,
      decryptionBoost: 0,
      isGameActive: true,
      startedAt: new Date().toISOString(),
    });
    playBeep('tap');

    try {
      const enabledPlugins = plugins.filter((p) => p.connected).map((p) => p.id);
      const operativeRoom = (routedCrewMember?.currentRoom || currentRoom) as RoomId;
      const operativeStation = routedCrewMember?.preferredStationId;
      const roomBoundTools = getAgentRuntimeTools(operativeRoom, operativeStation);
      const combinedTools = Array.from(
        new Set([...(routedCrewMember?.assignedTools || []), ...roomBoundTools])
      );
      const opState = resolveAgentOperationalState({
        room: operativeRoom,
        stationId: operativeStation,
      });
      const combinedSystemPrompt = [
        routedCrewMember?.systemPrompt,
        opState.systemPromptModifier,
      ]
        .filter(Boolean)
        .join('\n\n');

      const newCard = await executeAgentDirective({
        prompt,
        themeId,
        activeAgentName: routedDisplayName,
        activeAgentRole: routedCrewMember?.role || routedAgent.role,
        agentSystemPrompt: combinedSystemPrompt || undefined,
        agentAssignedTools: combinedTools.length > 0 ? combinedTools : undefined,
        agentMemoryLog: routedCrewMember?.memoryLog,
        enabledPlugins,
        attachment,
        temperature: preferences.temperature,
        // When Gemini returns a functionCall, immediately walk the active agent to the target room
        onFunctionCallTriggered: (info) => {
          handleMoveAgentToRoom(
            routedAgent.id,
            info.targetRoom,
            info.targetStationId,
            info.taskTag
          );
          setIsRoutingCamera(true);
          setTimeout(() => setIsRoutingCamera(false), 2400);
          setDialogueText(
            `[FUNCTION CALL: ${info.toolName}] ${routedDisplayName} walking to ${
              getRoomMetadata(info.targetRoom)?.shortBadge || String(info.targetRoom).toUpperCase()
            } (${info.taskTag}) to execute live handler...`
          );
        },
      });

      // Record task summary in this specific agent's independent memory ledger
      if (routedCrewMember) {
        addAgentMemory(routedCrewMember.id, {
          prompt,
          summary: newCard.dialogue,
        });
      }

      const updatedCards = [newCard, ...executionCards];
      setExecutionCards(updatedCards);
      saveExecutionCards(updatedCards);

      // Ensure the active agent stays stationed at the Server Vault or Library room matching the executed function call
      if (newCard.toolCalls && newCard.toolCalls.length > 0) {
        const primaryCall = newCard.toolCalls[0];
        if (primaryCall.targetRoom) {
          handleMoveAgentToRoom(
            routedAgent.id,
            primaryCall.targetRoom,
            primaryCall.targetStationId,
            primaryCall.toolName.toUpperCase()
          );
        }
      }

      // Record immutable command ledger entry in Dexie/IndexedDB
      const primaryToolUsed =
        newCard.toolCalls && newCard.toolCalls.length > 0
          ? newCard.toolCalls.map((tc) => tc.toolName).join(', ')
          : 'direct_neural_inference';
      const primaryResultSummary =
        newCard.toolCalls && newCard.toolCalls.length > 0
          ? `${newCard.cardTitle} — ${newCard.toolCalls[0].resultSummary}`
          : `${newCard.cardTitle} — ${newCard.dialogue}`;

      await appendCommandLedgerEntry({
        timestamp: newCard.timestamp,
        command_input: newCard.prompt,
        involved_agent: newCard.agentName,
        tool_used: primaryToolUsed,
        result_summary: primaryResultSummary,
        success_boost_achieved: decryptionBoost,
      });
      await refreshCommandLedger();

      // Resolution Handler B: Gemini API returns data -> smoothly fade out GameOverlay and show response
      setDialogueText(newCard.dialogue);
      setLastActionSummary(`${newCard.agentName}: ${newCard.cardTitle}`);
      setCompletionAlertAgentId(routedAgent.id);
      setPendingTask(null);
      playBeep('complete');
      smoothCloseGameOverlay();

      const nextPrefs: CommandPreferences = {
        ...preferences,
        usedTokens: Math.min(
          preferences.maxTokenBudget,
          preferences.usedTokens + newCard.tokenEstimate
        ),
        onboardingCompleted: true,
      };
      handleUpdatePreferences(nextPrefs);

      recordTelemetryExecution({
        agentId: routedCrewMember?.id || routedAgent.id,
        agentName: routedDisplayName,
        prompt,
        success: true,
        inputTokens: Math.round(newCard.tokenEstimate * 0.4),
        outputTokens: Math.round(newCard.tokenEstimate * 0.6),
        durationMs: 1400,
      });

      setTimeout(() => {
        setCompletionAlertAgentId(null);
      }, 4000);
    } catch (err: any) {
      playBeep('error');
      const descriptor: RetroErrorDescriptor =
        err instanceof RetroAgentError
          ? err.descriptor
          : createRetroAgentError({
              code: classifyRetroErrorCode(err),
              themeId,
              technicalDetail:
                err?.message || 'Agent execution encountered an unexpected fault.',
              failedPrompt: prompt,
            }).descriptor;

      setRetroError(descriptor);
      setIsRetroErrorModalOpen(true);
      setErrorMessage(descriptor.headline);
      setPendingTask(null);
      smoothCloseGameOverlay();

      recordTelemetryExecution({
        agentId: routedCrewMember?.id || routedAgent.id,
        agentName: routedDisplayName,
        prompt,
        success: false,
        inputTokens: 120,
        outputTokens: 30,
        durationMs: 800,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleTriggerErrorDrill = (code: RetroErrorCode) => {
    playBeep('error');
    const simulated = createRetroAgentError({
      code,
      themeId,
      technicalDetail: `DIAGNOSTIC DRILL · Simulated ${code} intercepted by Retro Error Boundary`,
      failedPrompt: 'Scan flight nodes and schedule extraction briefing',
    });
    setRetroError(simulated.descriptor);
    setErrorMessage(simulated.descriptor.headline);
    setIsRetroErrorModalOpen(true);
  };

  // Build active participants payload with their custom names, distinct roles, spriteVariants, and recent field notes
  const participantsWithNotes: RoundtableParticipantPayload[] = crewAgents.map(
    (crewMember, idx) => {
      const cardNotes = executionCards
        .filter(
          (c) =>
            c.agentName === crewMember.customName ||
            c.agentName === crewMember.defaultName
        )
        .slice(0, 2)
        .map((c) => `${c.cardTitle}: ${c.dialogue}`);

      const ledgerNotes = commandLedger
        .filter(
          (l) =>
            l.involved_agent === crewMember.customName ||
            l.involved_agent === crewMember.defaultName
        )
        .slice(0, 2)
        .map((l) => `${l.tool_used}: ${l.result_summary}`);

      const combinedNotes = [...cardNotes, ...ledgerNotes].slice(0, 3);
      if (combinedNotes.length === 0) {
        combinedNotes.push(
          `${crewMember.specialty} · Stationed at ${
            getRoomMetadata(agentRooms[crewMember.id] || crewMember.currentRoom || 'war_room')
              ?.shortBadge || 'WAR ROOM'
          }`
        );
      }

      return {
        id: crewMember.id,
        agentIndex: idx,
        customName: crewMember.customName,
        defaultName: crewMember.defaultName,
        role: crewMember.role,
        specialty: crewMember.specialty,
        spriteVariant: crewMember.spriteVariant,
        recentNotes: combinedNotes,
      };
    }
  );

  // Trigger Town Hall Meeting: Summons all active agents from their sectors into the central War Room roundtable
  const handleCallTownHallMeeting = () => {
    playBeep('complete');
    setActiveTab('hq');
    setHqSubView('town_hall');
    setCurrentRoom('war_room');
    setIsRoutingCamera(true);
    setTimeout(() => setIsRoutingCamera(false), 2200);
    setTownHallSummonNonce((n) => n + 1);

    setAgentRooms((prev) => {
      const next = { ...prev };
      crewAgents.forEach((ag) => {
        next[ag.id] = 'war_room';
      });
      return next;
    });

    const namesList = crewAgents.map((a) => a.customName).join(', ');
    setDialogueText(
      `[TOWN HALL SUMMON] Calling ${namesList} from all sectors to the central War Room Roundtable...`
    );
  };

  // Convene Multi-Agent Gemini Roundtable Session
  const handleConveneRoundtable = async (
    topic: string,
    includePriorTurns: boolean
  ) => {
    setActiveTab('hq');
    setHqSubView('town_hall');
    setCurrentRoom('war_room');
    setTownHallSummonNonce((n) => n + 1);
    setIsExecutingMeeting(true);
    setErrorMessage(null);
    setRetroError(null);
    setIsRetroErrorModalOpen(false);
    playBeep('tap');

    try {
      const priorTurns =
        includePriorTurns && roundtableSessions[0]?.turns
          ? roundtableSessions[0].turns
          : [];

      const newSession = await executeRoundtableMeeting({
        topic,
        themeId,
        temperature: preferences.temperature,
        participants: participantsWithNotes,
        priorTurns,
      });

      const updatedSessions = [newSession, ...roundtableSessions];
      setRoundtableSessions(updatedSessions);
      saveRoundtableSessions(updatedSessions);

      setDialogueText(
        `[ROUNDTABLE COMPLETE] ${newSession.meetingTitle}: ${newSession.consensusSummary}`
      );
      setLastActionSummary(`Town Hall: ${newSession.meetingTitle}`);
      playBeep('complete');

      // Record immutable roundtable entry in Dexie/IndexedDB Command Ledger
      await appendCommandLedgerEntry({
        timestamp: newSession.timestamp,
        command_input: `[TOWN HALL] ${newSession.topic}`,
        involved_agent: crewAgents.map((a) => a.customName).join(', '),
        tool_used: 'town_hall_roundtable',
        result_summary: `${newSession.meetingTitle} — ${newSession.consensusSummary}`,
        success_boost_achieved: decryptionBoost,
      });
      await refreshCommandLedger();

      const nextPrefs: CommandPreferences = {
        ...preferences,
        usedTokens: Math.min(
          preferences.maxTokenBudget,
          preferences.usedTokens + newSession.tokenEstimate
        ),
        onboardingCompleted: true,
      };
      handleUpdatePreferences(nextPrefs);
    } catch (err: any) {
      playBeep('error');
      const descriptor: RetroErrorDescriptor =
        err instanceof RetroAgentError
          ? err.descriptor
          : createRetroAgentError({
              code: classifyRetroErrorCode(err),
              themeId,
              technicalDetail:
                err?.message || 'Town Hall Roundtable encountered an unexpected fault.',
              failedPrompt: topic,
            }).descriptor;

      setRetroError(descriptor);
      setIsRetroErrorModalOpen(true);
      setErrorMessage(descriptor.headline);
    } finally {
      setIsExecutingMeeting(false);
    }
  };

  const remainingBatteryPct = Math.max(
    5,
    Math.min(
      100,
      Math.round(
        ((preferences.maxTokenBudget - preferences.usedTokens + 420) / preferences.maxTokenBudget) *
          100
      )
    )
  );

  const renderCrewConsolePanel = () => {
    const armoryCategories: Array<'All' | SpriteVariantCategory> = [
      'All',
      'Field & Infiltration',
      'Tech-Ops & Cyber',
      'Intel & Recon',
      'Tactical & Heavy',
    ];
    const filteredArmorySprites =
      spriteArmoryCategory === 'All'
        ? SPRITE_VARIANT_LIST
        : SPRITE_VARIANT_LIST.filter((v) => v.category === spriteArmoryCategory);

    return (
      <div className="w-full max-w-4xl mx-auto px-3 sm:px-0 flex flex-col gap-4">
        <div className="rounded-sm bg-[#121110] border border-[#b47b38] shadow-[0_0_20px_rgba(0,0,0,0.65)] overflow-hidden">
          <div className="bg-[#231b12] border-b border-[#4a351d] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono-tabular text-xs sm:text-sm font-bold tracking-wider text-[#e59838] uppercase">
                🕵️ CREW CUSTOMIZATION & WAYPOINT DISPATCH · {theme.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsAgentFactoryOpen(true);
                  playBeep('tap');
                }}
                className="px-2.5 py-1 bg-[#261f14] border border-[#e59838] hover:bg-[#3d301e] font-mono-tabular text-xs text-[#fde047] font-bold flex items-center gap-1 cursor-pointer"
                title="Recruit a new custom AI agent"
              >
                <span>+ Recruit Agent</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  resetCrewToDefaults();
                  playBeep('tap');
                }}
                className="px-2 py-0.5 bg-[#1b140d] border border-[#5e4326] hover:border-[#e59838] font-mono-tabular text-[11px] text-[#c89d66] hover:text-[#f3ead8] flex items-center gap-1 cursor-pointer"
                title="Reset custom names and sprite variants to theme defaults"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('hq')}
                className="font-mono-tabular text-xs text-[#c89d66] hover:text-[#f3ead8] cursor-pointer"
              >
                [Back to HQ]
              </button>
            </div>
          </div>

          <div className="p-3.5 flex flex-col gap-3">
            {crewAgents.map((crewMember) => {
              const isSelected = activeAgent.id === crewMember.id;
              const stationedRoom = agentRooms[crewMember.id] || crewMember.currentRoom || 'war_room';
              const variantMeta = SPRITE_VARIANTS[crewMember.spriteVariant] || SPRITE_VARIANTS.trenchcoat;
              const stationsForRoom = getRoomStations(stationedRoom);

              return (
                <div
                  key={crewMember.id}
                  className={`p-3 border flex flex-col gap-3 ${
                    isSelected
                      ? 'bg-[#1c1610] border-[#e59838]'
                      : 'bg-[#0d0c0b] border-[#332618]'
                  }`}
                >
                  {/* Top Row: Live Pixel Sprite Preview + Editable Custom Name + Select Active */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Live Animated Pixel Sprite Variant Preview Box */}
                      <div
                        className="w-14 h-16 shrink-0 bg-[#141822] border border-[#3a455e] flex items-center justify-center p-1.5 relative overflow-hidden"
                        title={`${variantMeta.label}: ${variantMeta.description}`}
                      >
                        <div className="w-9">
                          <AgentSpriteFigure
                            spriteVariant={crewMember.spriteVariant}
                            pose="walk"
                            walkFrame={previewWalkFrame}
                            facing="right"
                            isMoving={true}
                            themeId={themeId}
                            alt={crewMember.customName}
                          />
                        </div>
                        <span
                          className="absolute bottom-0 inset-x-0 text-center font-mono-tabular text-[8px] bg-[#0a0c10]/90 uppercase font-bold"
                          style={{ color: variantMeta.accentHex }}
                        >
                          {variantMeta.shortTag}
                        </span>
                      </div>

                      {/* Editable Agent Name & Role Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono-tabular text-xs">
                          <label
                            htmlFor={`agent-name-${crewMember.id}`}
                            className="text-[10px] text-[#9c8265] uppercase"
                          >
                            Codename:
                          </label>
                          <input
                            id={`agent-name-${crewMember.id}`}
                            type="text"
                            value={crewMember.customName}
                            maxLength={24}
                            onChange={(e) => updateAgentName(crewMember.id, e.target.value)}
                            placeholder={crewMember.defaultName}
                            className="px-2 py-0.5 bg-[#090807] border border-[#5e4326] focus:border-[#e59838] text-[#f3ead8] font-mono-tabular text-xs sm:text-sm font-bold w-40 sm:w-48 outline-none"
                          />
                          <span className="text-[#8c7a65]">·</span>
                          <span className="text-[#f3ead8] font-semibold">{crewMember.role}</span>
                          <span className="text-[#38bdf8] text-[10px] font-bold px-1.5 py-0.2 bg-[#0d141e] border border-[#1e2f42] rounded-xs">
                            {crewMember.functionalRole ? crewMember.functionalRole.toUpperCase().replace('_', ' ') : 'AGENT'}
                          </span>
                          <span className="text-[#4ade80] text-xs">
                            [{getRoomMetadata(stationedRoom)?.shortBadge || String(stationedRoom).toUpperCase()}]
                          </span>
                        </div>
                        <p className="font-mono-tabular text-[11px] text-[#b8a690] mt-1">
                          {crewMember.specialty} —{' '}
                          <span style={{ color: variantMeta.accentHex }}>
                            {variantMeta.label} ({variantMeta.gearOverlayLabel})
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAgentId(crewMember.id);
                          playBeep('tap');
                        }}
                        className="min-h-[32px] px-2.5 py-1 font-mono-tabular text-xs bg-[#1a1410] text-[#e59838] border border-[#785732] hover:bg-[#281e14] cursor-pointer"
                        title="Configure custom system prompt, role, assigned tools, and memory log"
                      >
                        [⚙️ Configure]
                      </button>
                      {crewMember.isRecruited && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Dismiss operative ${crewMember.customName}?`)) {
                              dismissAgent(crewMember.id);
                              playBeep('error');
                            }
                          }}
                          className="min-h-[32px] px-2 py-1 font-mono-tabular text-xs bg-red-950/80 text-red-300 border border-red-700 hover:bg-red-900 cursor-pointer"
                          title="Dismiss recruited operative"
                        >
                          Dismiss
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setActiveAgentId(crewMember.id);
                          setCurrentRoom(stationedRoom);
                          playBeep('tap');
                        }}
                        className={`min-h-[32px] px-3 py-1 font-mono-tabular text-xs border shrink-0 cursor-pointer ${
                          isSelected
                            ? 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold'
                            : 'bg-[#261f18] text-[#e8dcc4] border-[#6e5233] hover:bg-[#33291f]'
                        }`}
                      >
                        {isSelected ? '[ACTIVE OPERATIVE]' : '[SELECT]'}
                      </button>
                    </div>
                  </div>

                  {/* Middle Row: Visual Sprite Variant Asset Selector with Pixel-Art Thumbnails */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-[#261d12] font-mono-tabular text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#9c8265]">
                        Visual Sprite Design ({SPRITE_VARIANT_LIST.length} Operative Sprites):
                      </span>
                      <span className="text-[10px]" style={{ color: variantMeta.accentHex }}>
                        Equipped: {variantMeta.label} [{variantMeta.shortTag}]
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      {SPRITE_VARIANT_LIST.map((v) => {
                        const isCurrentVariant = crewMember.spriteVariant === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              updateAgentSpriteVariant(crewMember.id, v.id);
                              playBeep('tap');
                            }}
                            className={`px-2 py-1 border shrink-0 cursor-pointer transition-colors flex items-center gap-1.5 ${
                              isCurrentVariant
                                ? 'bg-[#2b2116] text-white font-bold shadow-[0_0_8px_rgba(229,152,56,0.25)]'
                                : 'bg-[#14110e] border-[#3d2c19] text-[#b8a690] hover:text-white'
                            }`}
                            style={{
                              borderColor: isCurrentVariant ? v.accentHex : undefined,
                            }}
                            title={`${v.label} (${v.category}): ${v.description}`}
                          >
                            <img
                              src={v.previewSpriteUrl}
                              alt={v.label}
                              className="w-4 h-5 object-contain pixelated shrink-0"
                            />
                            <span className="whitespace-nowrap">{v.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bottom Row: Autonomous Waypoint Pathfinding Room & Workstation Dispatch */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#261d12] font-mono-tabular text-[11px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[#9c8265]">Pathfind to Room:</span>
                      {getAllRoomIds().map((rId) => {
                        const isHere = stationedRoom === rId;
                        return (
                          <button
                            key={rId}
                            type="button"
                            onClick={() => handleMoveAgentToRoom(crewMember.id, rId as RoomId)}
                            className={`px-2 py-0.5 border cursor-pointer transition-colors ${
                              isHere
                                ? 'bg-[#4ade80]/20 border-[#4ade80] text-[#4ade80] font-semibold'
                                : 'bg-[#17130f] border-[#4a351d] text-[#c89d66] hover:text-white'
                            }`}
                          >
                            {getRoomMetadata(rId)?.shortBadge || String(rId).toUpperCase()}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[#9c8265]">Workstation:</span>
                      {stationsForRoom.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() =>
                            handleMoveAgentToRoom(
                              crewMember.id,
                              stationedRoom,
                              st.id,
                              st.taskTag
                            )
                          }
                          className="px-1.5 py-0.5 bg-[#161a24] hover:bg-[#e59838] text-[#94a3b8] hover:text-[#121110] border border-[#323c52] text-[10px] cursor-pointer transition-colors"
                          title={`Walk ${crewMember.customName} along floor waypoints to ${st.label}`}
                        >
                          &rarr; {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Visual Sprite Design Armory Catalog */}
        <div className="rounded-sm bg-[#121110] border border-[#b47b38] shadow-[0_0_20px_rgba(0,0,0,0.65)] overflow-hidden">
          <div className="bg-[#231b12] border-b border-[#4a351d] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-mono-tabular text-xs sm:text-sm font-bold tracking-wider text-[#e59838] uppercase">
                🛡️ VISUAL SPRITE DESIGN ARMORY ({SPRITE_VARIANT_LIST.length} PIXEL-ART OPERATIVES)
              </span>
              <p className="font-mono-tabular text-[11px] text-[#b8a690]">
                Browse all tactical operative sprites and equip any design onto your active crew
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {armoryCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setSpriteArmoryCategory(cat);
                    playBeep('tap');
                  }}
                  className={`px-2 py-0.5 border font-mono-tabular text-[10px] cursor-pointer transition-colors ${
                    spriteArmoryCategory === cat
                      ? 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold'
                      : 'bg-[#14110e] text-[#c89d66] border-[#4a351d] hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {filteredArmorySprites.map((spriteMeta) => {
              const equippedAgents = crewAgents.filter((a) => a.spriteVariant === spriteMeta.id);
              return (
                <div
                  key={spriteMeta.id}
                  className="p-2.5 bg-[#0d0c0b] border border-[#332618] hover:border-[#6e5233] flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start gap-2.5">
                    {/* Animated Standing/Walking Sprite Preview Box */}
                    <div className="w-14 h-16 shrink-0 bg-[#141822] border border-[#3a455e] flex items-center justify-center p-1 relative overflow-hidden">
                      <div className="w-9">
                        <AgentSpriteFigure
                          spriteVariant={spriteMeta.id}
                          pose="walk"
                          walkFrame={previewWalkFrame}
                          facing="right"
                          isMoving={true}
                          themeId={themeId}
                          alt={spriteMeta.label}
                        />
                      </div>
                      <span
                        className="absolute bottom-0 inset-x-0 text-center font-mono-tabular text-[8px] bg-[#0a0c10]/90 uppercase font-bold"
                        style={{ color: spriteMeta.accentHex }}
                      >
                        {spriteMeta.shortTag}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1 font-mono-tabular">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-[#f3ead8] truncate">
                          {spriteMeta.label}
                        </span>
                      </div>
                      <span
                        className="text-[9px] uppercase font-semibold block"
                        style={{ color: spriteMeta.accentHex }}
                      >
                        {spriteMeta.category} · {spriteMeta.gearOverlayLabel}
                      </span>
                      <p className="text-[10px] text-[#9c8265] mt-1 line-clamp-2 leading-snug">
                        {spriteMeta.description}
                      </p>
                    </div>
                  </div>

                  {/* Quick-Equip Buttons for Each Crew Member */}
                  <div className="flex flex-wrap items-center justify-between gap-1 pt-1.5 border-t border-[#221910] font-mono-tabular text-[10px]">
                    <span className="text-[#8c7a65]">Equip on:</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {crewAgents.map((ag) => {
                        const isEquipped = ag.spriteVariant === spriteMeta.id;
                        return (
                          <button
                            key={ag.id}
                            type="button"
                            onClick={() => {
                              updateAgentSpriteVariant(ag.id, spriteMeta.id);
                              playBeep('tap');
                            }}
                            className={`px-1.5 py-0.5 border cursor-pointer transition-colors ${
                              isEquipped
                                ? 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold'
                                : 'bg-[#17130f] text-[#c89d66] border-[#4a351d] hover:border-[#e59838] hover:text-white'
                            }`}
                            title={`Equip ${spriteMeta.label} on ${ag.customName}`}
                          >
                            {isEquipped ? `✓ ${ag.customName}` : ag.customName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderPluginsConsolePanel = () => (
    <div className="w-full max-w-xl mx-auto px-3 sm:px-0">
      <div className="rounded-sm bg-[#121110] border border-[#b47b38] shadow-[0_0_20px_rgba(0,0,0,0.65)] overflow-hidden">
        <div className="bg-[#231b12] border-b border-[#4a351d] px-3.5 py-2 flex items-center justify-between">
          <span className="font-mono-tabular text-xs sm:text-sm font-bold tracking-wider text-[#e59838] uppercase">
            🔌 PLUGIN & CONNECTOR MARKETPLACE
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingCustomPlugin(null);
                setIsCustomPluginModalOpen(true);
                playBeep('tap');
              }}
              className="px-2.5 py-1 bg-[#e59838] text-[#121110] font-bold font-mono-tabular text-xs cursor-pointer"
            >
              + Add Custom Connector
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('hq')}
              className="font-mono-tabular text-xs text-[#c89d66] hover:text-[#f3ead8] cursor-pointer"
            >
              [Back to HQ]
            </button>
          </div>
        </div>

        <div className="p-3.5 flex flex-col gap-3">
          {/* Custom User Connectors */}
          <div className="text-[11px] font-mono-tabular font-bold text-[#e59838] uppercase tracking-wider">
            Custom Extensible Connectors ({customPlugins.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {customPlugins.map((cp) => (
              <div
                key={cp.id}
                className="p-3 bg-[#0d0c0b] border border-[#382917] flex flex-col justify-between gap-2.5"
              >
                <div>
                  <div className="flex items-center justify-between font-mono-tabular text-xs">
                    <span className="font-bold text-[#f3ead8]">{cp.name}</span>
                    <span className={cp.enabled ? 'text-[#4ade80]' : 'text-[#8c7a65]'}>
                      {cp.enabled ? '[ACTIVE]' : '[INACTIVE]'}
                    </span>
                  </div>
                  <p className="font-mono-tabular text-[11px] text-[#b8a690] mt-1 leading-snug">
                    {cp.description || cp.endpointUrl}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-[#261d12]">
                  <span className="font-mono-tabular text-[10px] text-[#8c7a65] truncate">
                    {cp.toolFunctionName}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCustomPlugin(cp);
                        setIsCustomPluginModalOpen(true);
                        playBeep('tap');
                      }}
                      className="px-2 py-0.5 font-mono-tabular text-[10px] bg-[#1a1410] text-[#e59838] border border-[#785732] cursor-pointer"
                    >
                      Configure
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        const next = customPlugins.map((x) =>
                          x.id === cp.id ? { ...x, enabled: !x.enabled } : x
                        );
                        setCustomPlugins(next);
                        saveCustomPlugins(next);
                      }}
                      className={`px-2 py-0.5 font-mono-tabular text-[10px] border cursor-pointer ${
                        cp.enabled
                          ? 'bg-[#2b2116] text-[#e8dcc4] border-[#6e5233]'
                          : 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold'
                      }`}
                    >
                      {cp.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Built-in OAuth Vault Connectors */}
          <div className="text-[11px] font-mono-tabular font-bold text-[#e59838] uppercase tracking-wider pt-2 border-t border-[#3a2917]">
            Built-in OAuth Connectors
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {plugins.map((plugin) => {
              const tokenMeta = vaultReport?.providerValidations[plugin.id];
              return (
                <div
                  key={plugin.id}
                  className="p-3 bg-[#0d0c0b] border border-[#382917] flex flex-col justify-between gap-2.5"
                >
                  <div>
                    <div className="flex items-center justify-between font-mono-tabular text-xs">
                      <span className="font-bold text-[#f3ead8]">{plugin.name}</span>
                      <span className={plugin.connected ? 'text-[#4ade80]' : 'text-[#8c7a65]'}>
                        {plugin.connected ? '[AES-GCM VALID]' : '[REVOKED]'}
                      </span>
                    </div>
                    <p className="font-mono-tabular text-[11px] text-[#b8a690] mt-1 leading-snug">
                      {plugin.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-[#261d12]">
                    <span className="font-mono-tabular text-[10px] text-[#8c7a65] truncate">
                      {plugin.toolFunctionName}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTogglePlugin(plugin.id)}
                      className={`min-h-[28px] px-2.5 py-0.5 font-mono-tabular text-xs border cursor-pointer ${
                        plugin.connected
                          ? 'bg-[#261f18] text-[#e8dcc4] border-[#6e5233]'
                          : 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold'
                      }`}
                    >
                      {plugin.connected ? 'Revoke]' : 'Mint OAuth]'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const renderThemesConsolePanel = () => (
    <div className="w-full max-w-xl mx-auto px-3 sm:px-0 flex flex-col gap-3">
      <div
        className="rounded-sm bg-[#121110] border shadow-[0_0_20px_rgba(0,0,0,0.65)] overflow-hidden"
        style={{
          borderColor: 'var(--theme-border-color)',
          boxShadow: '0 0 22px var(--theme-glow-soft)',
        }}
      >
        <div
          className="bg-[#231b12] border-b px-3.5 py-2 flex items-center justify-between"
          style={{ borderColor: 'var(--theme-border-color)' }}
        >
          <span
            className="font-mono-tabular text-xs sm:text-sm font-bold tracking-wider uppercase"
            style={{
              color: 'rgb(var(--theme-primary-rgb))',
              textShadow: '0 0 8px var(--theme-glow-color)',
            }}
          >
            🎨 OVERWORLD THEME & RGB FILTER ENGINE
          </span>
          <button
            type="button"
            onClick={() => setActiveTab('hq')}
            className="font-mono-tabular text-xs text-[#c89d66] hover:text-[#f3ead8] cursor-pointer"
          >
            [Back to HQ]
          </button>
        </div>

        <div className="p-3.5 flex flex-col gap-3">
          {/* Interactive RGB / HSL Color Picker & Hardware-Accelerated Room Filter Sliders */}
          <ThemeSettings />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {(Object.keys(THEMES) as ThemeId[]).map((id) => {
              const item = THEMES[id];
              const isCurrent = themeId === id;
              return (
                <div
                  key={id}
                  className={`p-3 border flex flex-col justify-between gap-3 ${
                    isCurrent
                      ? 'bg-[#1c1610] border-[#e59838]'
                      : 'bg-[#0d0c0b] border-[#382917]'
                  }`}
                >
                  <div>
                    <div className="font-mono-tabular text-xs font-bold text-[#e59838]">
                      {item.name}
                    </div>
                    <p className="font-mono-tabular text-[11px] text-[#d6c7b2] mt-1 leading-snug">
                      {item.tagline}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setThemeId(id)}
                    className={`min-h-[34px] w-full font-mono-tabular text-xs border flex items-center justify-center gap-1 cursor-pointer ${
                      isCurrent
                        ? 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold'
                        : 'bg-[#261f18] text-[#e8dcc4] border-[#6e5233] hover:bg-[#33291f]'
                    }`}
                  >
                    {isCurrent && <Check className="w-3.5 h-3.5" />}
                    <span>{isCurrent ? 'ACTIVE]' : 'SELECT]'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0c0e14] text-[#f3ead8] p-2 sm:p-4 flex items-center justify-center">
      {/* Outer Retro Console Frame */}
      <div
        className="w-full max-w-6xl rounded-2xl bg-[#11131c] border-[3px] overflow-hidden flex flex-col justify-between min-h-[92vh]"
        style={{
          borderColor: 'var(--theme-border-color)',
          boxShadow: '0 0 50px rgba(0,0,0,0.9), 0 0 24px var(--theme-glow-soft)',
        }}
      >
        {/* Top Console Telemetry Bar: [⚙] SAFEHOUSE v1.0 | v1.0 | [🔋 100%] ▮🛜 */}
        <header className="bg-[#232634] border-b-2 border-[#161822] px-3 sm:px-5 py-2 flex items-center justify-between gap-4 select-none">
          {/* Left Zone: [⚙] SAFEHOUSE v1.0 + [🗺️ RADAR] Minimap Toggle */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsSettingsOpen(true);
                playBeep('tap');
              }}
              className="font-mono-tabular text-sm sm:text-base font-bold text-[#e2e4ed] hover:text-[#4ade80] transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Open Command Telemetry & Vault Settings"
            >
              <span>[⚙]</span>
              <span className="uppercase">{theme.shortLabel} v1.0</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsMinimapOpen((prev) => !prev);
                playBeep('tap');
              }}
              className={`px-2 py-0.5 font-mono-tabular text-xs border transition-colors cursor-pointer flex items-center gap-1 ${
                isMinimapOpen
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold'
                  : 'bg-[#171a26] text-[#4ade80] border-[#363d54] hover:border-[#4ade80]'
              }`}
              title="Toggle Overworld Minimap Radar"
            >
              <span>[🗺️ RADAR]</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsTerminalConsoleOpen((prev) => !prev);
                playBeep('tap');
              }}
              className={`px-2 py-0.5 font-mono-tabular text-xs border transition-colors cursor-pointer flex items-center gap-1 ${
                isTerminalConsoleOpen
                  ? 'bg-[#22c55e] text-[#0c1017] border-[#86efac] font-bold shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                  : 'bg-[#171a26] text-[#22c55e] border-[#363d54] hover:border-[#22c55e]'
              }`}
              title="Toggle Tactical CLI Terminal (~)"
            >
              <span>[&gt;_ CLI]</span>
            </button>

            <button
              type="button"
              onClick={handleCallTownHallMeeting}
              className={`px-2.5 py-0.5 font-mono-tabular text-xs border transition-colors cursor-pointer flex items-center gap-1 ${
                isMeetingActive
                  ? 'bg-[#38bdf8] text-[#0c1017] border-[#bae6fd] font-bold shadow-[0_0_12px_rgba(56,189,248,0.45)]'
                  : 'bg-[#1f1a14] text-[#e59838] border-[#b47b38] hover:bg-[#e59838] hover:text-[#121110] font-semibold'
              }`}
              title="Call Town Hall Meeting: Summon all active agents to the War Room for a roundtable discussion"
            >
              <span>[📣 CALL MEETING]</span>
            </button>
          </div>

          {/* Center Zone: Active Sector Code + Room Ambient Synth Status + Active Decryption Boost Indicator */}
          {(() => {
            const activeMeta = getRoomMetadata(currentRoom);
            const activeSound =
              ROOM_SOUNDSCAPE_PROFILES[currentRoom] || ROOM_SOUNDSCAPE_PROFILES.war_room;
            return (
              <div className="hidden sm:flex items-center gap-3 font-mono-tabular text-xs sm:text-sm text-[#c5c9d6]">
                <span>
                  SECTOR: <strong className="text-[#e59838]">{activeMeta?.shortBadge || 'SECTOR'}</strong> ({activeMeta?.sectorCode || 'SEC-00'})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !soundEnabled;
                    setSoundEnabled(next);
                    if (next) {
                      ambientAudioService.setRoom(currentRoom, true);
                      playBeep('tap');
                    }
                  }}
                  className={`px-2 py-0.5 text-[10px] border transition-colors cursor-pointer flex items-center gap-1 ${
                    soundEnabled
                      ? 'bg-[#13221a] text-[#4ade80] border-[#4ade80]'
                      : 'bg-[#1c1a17] text-[#94a3b8] border-[#383633] hover:border-[#e59838]'
                  }`}
                  title={`Ambient Synth Loop: ${activeSound.title} — ${activeSound.description} (Click to toggle)`}
                >
                  <span>
                    {soundEnabled
                      ? `[🔊 SYNTH: ${activeSound.shortTag}]`
                      : '[🔇 SYNTH: OFF]'}
                  </span>
                </button>
                {decryptionBoost > 0 && (
                  <span className="text-xs text-[#4ade80]">
                    [BOOST +{decryptionBoost}%]
                  </span>
                )}
              </div>
            );
          })()}

          {/* Right Zone: [🔋 100%] ▮🛜 + Tactical HUD Controls + Optional PWA Install */}
          <div className="flex items-center gap-2 shrink-0 font-mono-tabular text-xs">
            <button
              type="button"
              onClick={() => {
                setIsNightShiftOpen(true);
                playBeep('tap');
              }}
              className="px-2 py-0.5 bg-[#151822] hover:bg-[#1e2330] border border-[#363d54] hover:border-[#e59838] text-[#e59838] flex items-center gap-1 cursor-pointer transition-colors"
              title="Open Night Shift scheduler and notification inbox"
            >
              <span>[NIGHT SHIFT</span>
              {loadNightShiftNotifications().filter((n) => !n.read).length > 0 && (
                <span className="text-[#4ade80] font-bold">
                  :{loadNightShiftNotifications().filter((n) => !n.read).length}
                </span>
              )}
              <span>]</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsInboxOpen(true);
                playBeep('tap');
              }}
              className="px-2 py-0.5 bg-[#151822] hover:bg-[#1e2330] border border-[#363d54] hover:border-[#e59838] text-[#cbd5e1] hover:text-[#f3ead8] flex items-center gap-1 cursor-pointer transition-colors"
              title="Open centralized notification inbox"
            >
              <span>[INBOX</span>
              {unreadCount > 0 && (
                <span className="text-[#e59838] font-bold">:{unreadCount}</span>
              )}
              <span>]</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsTelemetryOpen(true);
                playBeep('tap');
              }}
              className="px-2 py-0.5 bg-[#131d19] hover:bg-[#1a2923] border border-[#2b4c3b] hover:border-[#4ade80] text-[#4ade80] flex items-center gap-1 cursor-pointer transition-colors"
              title="Open Telemetry, Token Ledger & Cost Tracking HUD"
            >
              <span>[TELEMETRY]</span>
            </button>
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => {
                setIsSettingsOpen(true);
                playBeep('tap');
              }}
              className="font-mono-tabular text-sm sm:text-base flex items-center gap-1.5 cursor-pointer"
              title="Battery / Token Telemetry Status"
            >
              <span className="text-[#c5c9d6]">[</span>
              {/* Pixel Battery Icon */}
              <svg
                viewBox="0 0 12 16"
                className="w-3.5 h-4 pixelated inline-block"
                shapeRendering="crispEdges"
              >
                <rect x="4" y="0" width="4" height="2" fill="#94a3b8" />
                <rect x="1" y="2" width="10" height="14" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
                <rect x="3" y="4" width="6" height="10" fill="#4ade80" />
              </svg>
              <span className="text-[#4ade80] font-semibold">{remainingBatteryPct}%</span>
              <span className="text-[#c5c9d6]">]</span>

              {/* Signal Bar & Wi-Fi Icon */}
              <svg
                viewBox="0 0 22 14"
                className="w-5 h-3.5 pixelated inline-block ml-1"
                shapeRendering="crispEdges"
              >
                {/* Vertical Signal Pillar */}
                <rect x="1" y="2" width="3" height="10" fill="#4ade80" />
                <rect x="1" y="0" width="3" height="2" fill="#eab308" />
                {/* Pixel Wi-Fi Arcs */}
                <rect x="8" y="2" width="12" height="2" fill="#4ade80" />
                <rect x="6" y="4" width="2" height="2" fill="#4ade80" />
                <rect x="20" y="4" width="2" height="2" fill="#4ade80" />
                <rect x="10" y="6" width="8" height="2" fill="#4ade80" />
                <rect x="13" y="10" width="2" height="2" fill="#4ade80" />
              </svg>
            </button>
          </div>
        </header>

        {/* Center Dark CRT Console Canvas */}
        <main className="flex-1 bg-[#0e1017] flex flex-col justify-between pb-5">
          {/* Scrollable 7-Sector Overworld Diorama + Minimap Radar + Modular GameOverlay */}
          <SpriteCanvas
            currentRoom={currentRoom}
            onChangeRoom={handleRoomChange}
            agentRooms={agentRooms}
            onMoveAgentToRoom={handleMoveAgentToRoom}
            walkingTransition={walkingTransition}
            isRoutingCamera={isRoutingCamera}
            isExecuting={isExecuting}
            completionAlertAgentId={completionAlertAgentId}
            lastActionSummary={lastActionSummary}
            isGameActive={isGameActive}
            isGameClosing={isGameClosing}
            onGameBoostChange={setDecryptionBoost}
            onGameSequenceComplete={handleGameSequenceComplete}
            onStartManualBypass={() => {
              setIsGameActive(true);
              setIsGameClosing(false);
              setDecryptionBoost(0);
              playBeep('tap');
            }}
            onAbortGame={smoothCloseGameOverlay}
            isMinimapOpen={isMinimapOpen}
            onToggleMinimap={() => setIsMinimapOpen((prev) => !prev)}
            townHallSummonNonce={townHallSummonNonce}
            isMeetingActive={isMeetingActive}
            activeSpeakerAgentIndex={activeSpeakerAgentIndex}
            onCallMeeting={handleCallTownHallMeeting}
          />

          {/* Centered Amber Console Boxes below the Overworld Diorama */}
          <div className="mt-4">
            {activeTab === 'hq' && (
              <div className="flex flex-col gap-2.5">
                {/* Restored Pending Task Banner (if app minimized/closed while a task was executing) */}
                {!isExecuting && pendingTask?.isPending && (
                  <div className="w-full max-w-xl mx-auto px-3 sm:px-0">
                    <div className="p-2.5 bg-[#1b150e] border border-[#e59838] flex flex-wrap items-center justify-between gap-2 font-mono-tabular text-xs">
                      <div className="min-w-0">
                        <span className="text-[#4ade80] font-bold">
                          [SESSION RESTORED · PENDING DIRECTIVE]
                        </span>{' '}
                        <span className="text-[#f3ead8] truncate">
                          &ldquo;{pendingTask.prompt}&rdquo;
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleExecuteDirective(
                              pendingTask.prompt,
                              pendingTask.attachment || null
                            )
                          }
                          className="px-2.5 py-1 bg-[#e59838] text-[#121110] font-bold border border-[#e59838] cursor-pointer"
                        >
                          [▶ RESUME TASK]
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingTask(null)}
                          className="px-2 py-1 bg-[#261f18] text-[#c89d66] border border-[#6e5233] cursor-pointer"
                        >
                          [Dismiss]
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* HQ Sub-Screen Switcher: [📟 BRIEFING TERMINAL] vs [🏛️ TOWN HALL] vs [📜 COMMAND LOG (50)] */}
                <div className="w-full max-w-2xl mx-auto px-3 sm:px-0 flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex flex-wrap bg-[#16130f] border border-[#5e4326] p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setHqSubView('terminal');
                        setActiveSpeakerAgentIndex(null);
                        playBeep('tap');
                      }}
                      className={`px-3 py-1 font-mono-tabular text-xs cursor-pointer transition-colors ${
                        hqSubView === 'terminal'
                          ? 'bg-[#e59838] text-[#121110] font-bold'
                          : 'text-[#c89d66] hover:text-[#f3ead8]'
                      }`}
                    >
                      📟 Briefing Terminal
                    </button>
                    <button
                      type="button"
                      onClick={handleCallTownHallMeeting}
                      className={`px-3 py-1 font-mono-tabular text-xs cursor-pointer transition-colors flex items-center gap-1 ${
                        hqSubView === 'town_hall'
                          ? 'bg-[#38bdf8] text-[#0c1017] font-bold'
                          : 'text-[#38bdf8] hover:text-[#f3ead8]'
                      }`}
                      title="Summon all 3 active agents to the War Room for a Town Hall Roundtable"
                    >
                      <span>📣 Call Meeting ({roundtableSessions.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHqSubView('command_log');
                        setActiveSpeakerAgentIndex(null);
                        refreshCommandLedger();
                        playBeep('tap');
                      }}
                      className={`px-3 py-1 font-mono-tabular text-xs cursor-pointer transition-colors ${
                        hqSubView === 'command_log'
                          ? 'bg-[#e59838] text-[#121110] font-bold'
                          : 'text-[#c89d66] hover:text-[#f3ead8]'
                      }`}
                    >
                      📜 Command Log ({commandLedger.length})
                    </button>
                  </div>
                  <span className="hidden sm:inline font-mono-tabular text-[11px] text-[#9c8265]">
                    {hqSubView === 'town_hall'
                      ? 'MULTI-AGENT ROUNDTABLE · WAR ROOM'
                      : 'DEXIE INDEXEDDB · APPEND-ONLY LEDGER'}
                  </span>
                </div>

                {hqSubView === 'terminal' ? (
                  <TerminalWindow
                    dialogueText={dialogueText}
                    isExecuting={isExecuting}
                    onExecuteDirective={handleExecuteDirective}
                    executionCards={executionCards}
                    errorMessage={errorMessage}
                    retroError={retroError}
                    onOpenGearVault={() => setIsSettingsOpen(true)}
                    onReopenErrorModal={() => setIsRetroErrorModalOpen(true)}
                    onTriggerErrorDrill={handleTriggerErrorDrill}
                    onDismissError={() => {
                      setRetroError(null);
                      setErrorMessage(null);
                      setIsRetroErrorModalOpen(false);
                    }}
                    onOpenCommandLog={() => {
                      setHqSubView('command_log');
                      refreshCommandLedger();
                    }}
                    ledgerCount={commandLedger.length}
                  />
                ) : hqSubView === 'town_hall' ? (
                  <TownHallRoundtablePanel
                    sessions={roundtableSessions}
                    isExecutingMeeting={isExecutingMeeting}
                    onConveneMeeting={handleConveneRoundtable}
                    onSummonAgain={handleCallTownHallMeeting}
                    onAdjournMeeting={() => {
                      setHqSubView('terminal');
                      setActiveSpeakerAgentIndex(null);
                    }}
                    onDispatchActionItem={(agentIdx, directive, targetSector) => {
                      const targetAgent = theme.agents[agentIdx] || activeAgent;
                      setHqSubView('terminal');
                      setActiveSpeakerAgentIndex(null);
                      handleMoveAgentToRoom(
                        targetAgent.id,
                        targetSector,
                        undefined,
                        'EXECUTING'
                      );
                      handleExecuteDirective(directive, null);
                    }}
                    activeSpeakerAgentIndex={activeSpeakerAgentIndex}
                    onSelectSpeakerAgentIndex={setActiveSpeakerAgentIndex}
                    participantsWithNotes={participantsWithNotes}
                  />
                ) : (
                  <CommandLogScreen
                    entries={commandLedger}
                    onBackToTerminal={() => setHqSubView('terminal')}
                    onRefreshLedger={refreshCommandLedger}
                  />
                )}
              </div>
            )}
            {activeTab === 'crew' && renderCrewConsolePanel()}
            {activeTab === 'plugins' && renderPluginsConsolePanel()}
            {activeTab === 'themes' && renderThemesConsolePanel()}
          </div>
        </main>

        {/* Bottom Console Navigation Footer: [🏠 HQ] [🕵️ Crew] [🔌 Plugins] [🎨 Themes] */}
        <footer className="bg-[#1b1e29] border-t-2 border-[#282c3d] px-2 py-2 flex items-center justify-center">
          <nav
            aria-label="Console Navigation"
            className="inline-flex flex-wrap items-center justify-center bg-[#232736] border border-[#363b4e] divide-x divide-[#363b4e]"
          >
            <button
              type="button"
              onClick={() => {
                setActiveTab('hq');
                playBeep('tap');
              }}
              className={`min-h-[42px] px-4 sm:px-6 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2.5 transition-colors cursor-pointer ${
                activeTab === 'hq'
                  ? 'bg-[#2e3346] text-[#ffffff] font-semibold'
                  : 'text-[#d0d4e0] hover:bg-[#292d3e]'
              }`}
            >
              <span className="text-base" aria-hidden="true">🏠</span>
              <span>HQ</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('crew');
                playBeep('tap');
              }}
              className={`min-h-[42px] px-4 sm:px-6 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2.5 transition-colors cursor-pointer ${
                activeTab === 'crew'
                  ? 'bg-[#2e3346] text-[#ffffff] font-semibold'
                  : 'text-[#d0d4e0] hover:bg-[#292d3e]'
              }`}
            >
              <span className="text-base" aria-hidden="true">🕵️</span>
              <span>Crew</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('plugins');
                playBeep('tap');
              }}
              className={`min-h-[42px] px-4 sm:px-6 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2.5 transition-colors cursor-pointer ${
                activeTab === 'plugins'
                  ? 'bg-[#2e3346] text-[#ffffff] font-semibold'
                  : 'text-[#d0d4e0] hover:bg-[#292d3e]'
              }`}
            >
              <span className="text-base" aria-hidden="true">🔌</span>
              <span>Plugins</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('themes');
                playBeep('tap');
              }}
              className={`min-h-[42px] px-4 sm:px-6 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2.5 transition-colors cursor-pointer ${
                activeTab === 'themes'
                  ? 'bg-[#2e3346] text-[#ffffff] font-semibold'
                  : 'text-[#d0d4e0] hover:bg-[#292d3e]'
              }`}
            >
              <span className="text-base" aria-hidden="true">🎨</span>
              <span>Themes</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsTerminalConsoleOpen((prev) => !prev);
                playBeep('tap');
              }}
              className={`min-h-[42px] px-3 sm:px-5 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 transition-colors cursor-pointer border-l border-[#363b4e] ${
                isTerminalConsoleOpen
                  ? 'bg-[#153422] text-[#4ade80] font-semibold'
                  : 'text-[#4ade80] hover:bg-[#1a2e23]'
              }`}
              title="Toggle Tactical CLI Terminal Console (~)"
            >
              <span className="text-base" aria-hidden="true">💻</span>
              <span className="hidden sm:inline">CLI (~)</span>
              <span className="sm:hidden">CLI</span>
            </button>
          </nav>
        </footer>
      </div>

      <OfflineBanner />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        preferences={preferences}
        onUpdatePreferences={handleUpdatePreferences}
        serverReady={serverReady}
        vaultReport={vaultReport}
        onRevalidateVault={runStartupVaultValidation}
        currentRoom={currentRoom}
        onSelectRoom={(room) => {
          setCurrentRoom(room);
          playBeep('tap');
        }}
      />

      <RetroErrorModal
        error={isRetroErrorModalOpen ? retroError : null}
        onClose={() => setIsRetroErrorModalOpen(false)}
        onOpenGearVault={() => {
          setIsRetroErrorModalOpen(false);
          setIsSettingsOpen(true);
        }}
        onRetryDirective={(failedPrompt) => {
          setIsRetroErrorModalOpen(false);
          handleExecuteDirective(failedPrompt, null);
        }}
        onSwitchSimulatedError={(nextDesc) => {
          setRetroError(nextDesc);
          setErrorMessage(nextDesc.headline);
        }}
      />

      <AgentEditorModal
        isOpen={Boolean(editingAgentId)}
        agent={editingCrewAgent}
        onClose={() => setEditingAgentId(null)}
        onSave={(updates) => {
          if (editingAgentId) {
            updateAgentConfig(editingAgentId, updates);
          }
        }}
        onClearMemory={() => {
          if (editingAgentId) {
            clearAgentMemory(editingAgentId);
          }
        }}
      />

      <NightShiftModal
        isOpen={isNightShiftOpen}
        onClose={() => setIsNightShiftOpen(false)}
        enabledPlugins={plugins.filter((p) => p.connected).map((p) => p.id)}
      />

      <NotificationInboxModal
        isOpen={isInboxOpen}
        onClose={() => setIsInboxOpen(false)}
      />

      <CustomPluginModal
        isOpen={isCustomPluginModalOpen}
        onClose={() => setIsCustomPluginModalOpen(false)}
        editingPlugin={editingCustomPlugin}
        onSave={(plugin) => {
          const exists = customPlugins.some((p) => p.id === plugin.id);
          const next = exists
            ? customPlugins.map((p) => (p.id === plugin.id ? plugin : p))
            : [plugin, ...customPlugins];
          setCustomPlugins(next);
          saveCustomPlugins(next);
        }}
      />

      <TelemetryModal
        isOpen={isTelemetryOpen}
        onClose={() => setIsTelemetryOpen(false)}
      />

      <AgentFactoryModal
        isOpen={isAgentFactoryOpen}
        onClose={() => setIsAgentFactoryOpen(false)}
        onRecruit={(payload) => {
          const newId = recruitAgent(payload);
          setAgentRooms((prev) => ({
            ...prev,
            [newId]: payload.currentRoom,
          }));
          setActiveAgentId(newId);
          setCurrentRoom(payload.currentRoom);
          setDialogueText(
            `[NEW OPERATIVE RECRUITED] ${payload.customName} (${payload.role}) deployed to ${
              getRoomMetadata(payload.currentRoom)?.shortBadge || payload.currentRoom
            }.`
          );
        }}
      />

      <TaskBriefModal
        isOpen={taskBriefState.isOpen}
        brief={taskBriefState.brief}
        rawPrompt={taskBriefState.rawPrompt}
        activeAgentName={activeAgent.name}
        activeAgentRole={activeAgent.role}
        onSelectOption={(clarifiedPrompt) => {
          const att = taskBriefState.attachment;
          setTaskBriefState({ isOpen: false, brief: null, rawPrompt: '', attachment: null });
          handleExecuteDirective(clarifiedPrompt, att, true);
        }}
        onCancel={() => {
          setTaskBriefState({ isOpen: false, brief: null, rawPrompt: '', attachment: null });
        }}
      />

      <TerminalConsole
        isOpen={isTerminalConsoleOpen}
        onClose={() => setIsTerminalConsoleOpen(false)}
        context={{
          crewAgents: crewAgents.map((a) => ({
            id: a.id,
            customName: a.customName,
            role: a.role,
            currentRoom: a.currentRoom,
            statusTag: isExecuting && activeAgent.id === a.id ? 'EXECUTING' : 'IDLE',
          })),
          commandLedger,
          onDispatchTask: (_agentId, taskPrompt) => {
            handleExecuteDirective(taskPrompt);
          },
          onApproveTask: (_taskId) => {
            if (taskBriefState.isOpen && taskBriefState.brief) {
              const defaultClarified =
                taskBriefState.brief.options[0]?.clarifiedPrompt || taskBriefState.rawPrompt;
              const att = taskBriefState.attachment;
              setTaskBriefState({ isOpen: false, brief: null, rawPrompt: '', attachment: null });
              handleExecuteDirective(defaultClarified, att, true);
            }
          },
        }}
      />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <CrewProvider>
        <InboxProvider>
          <CommandCenterContent />
        </InboxProvider>
      </CrewProvider>
    </ThemeProvider>
  );
}
