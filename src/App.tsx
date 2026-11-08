/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Check, RotateCcw, Smartphone } from 'lucide-react';
import { ThemeProvider, useTheme, THEMES, ThemeId } from './context/ThemeContext';
import {
  CrewProvider,
  useCrew,
  SPRITE_VARIANT_LIST,
  SPRITE_VARIANTS,
  SpriteVariantCategory,
  CLEARANCE_RANKS,
  ServiceRibbonId,
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
  getRoomBoundSkills,
  subscribeModuleRegistry,
} from './engine/moduleRegistry';
import { TerminalWindow } from './components/TerminalWindow';
import { SettingsModal } from './components/SettingsModal';
import { loadLLMProviderConfig, getLLMAuthInfo } from './services/LLMProviderService';
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
  auditStorageHealth,
  RoundtableActionItem,
  isValidRealTask,
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
import { hasProviderApiKey, SUPPORTED_VAULT_PROVIDERS } from './services/BYOKVault';
import { saveAgentModelConfig } from './services/agentStore';
import { NightShiftModal } from './components/NightShiftModal';
import { loadNightShiftNotifications, runPendingNightShiftTasks } from './services/NightShiftService';
import { initClassifiedFeedIngestion } from './services/ClassifiedFeedService';
import { backgroundWorkerEngine } from './services/WorkerService';
import { InboxProvider } from './context/InboxContext';
import { CustomPluginConnector, loadCustomPlugins, saveCustomPlugins } from './services/PluginMarketplaceService';
import { CustomPluginModal } from './components/CustomPluginModal';
import { TelemetryModal } from './components/TelemetryModal';
import { ThreatMonitorModal } from './components/ThreatMonitorModal';
import { TacticalSatelliteMonitor, parseReconTargetToCoords } from './components/TacticalSatelliteMonitor';
import { AgentFactoryModal } from './components/AgentFactoryModal';
import { recordTelemetryExecution } from './services/TelemetryStore';
import { analyzePromptAmbiguity } from './engine/taskBriefEngine';
import { TaskBriefModal, TaskBrief } from './components/TaskBriefModal';
import { TerminalConsole } from './components/TerminalConsole';
import { WorkspaceFileViewer } from './components/WorkspaceFileViewer';
import { PlaybookModal } from './components/PlaybookModal';
import { TaskQueuePanel } from './components/TaskQueuePanel';
import {
  StrategyBoardTask,
  loadStrategyBoardTasks,
  addStrategyBoardTasks,
  updateStrategyBoardTaskStatus,
} from './services/StrategyBoardService';
import {
  IntelligencePlaybookDef,
  PlaybookExecutionResult,
  UserPlaybookTarget,
  loadUserPlaybookTargets,
  DEFAULT_TARGET_PRESETS,
  executeIntelligencePlaybook,
} from './engine/intelligencePlaybooks';
import { SyncAccountModal } from './components/SyncAccountModal';
import { FeedbackTerminal } from './components/FeedbackTerminal';
import {
  startAutoSync,
  getSyncStats,
  subscribeSyncStatus,
  SyncStats,
} from './services/SyncService';
import { PluginMarketplace } from './components/PluginMarketplace';
import { ComposioService } from './services/ComposioService';
import {
  TaskChain,
  isDirectiveTaskChain,
  isHighLevelSupervisorObjective,
  decomposeObjectiveWithSupervisor,
  deconstructDirectiveIntoChain,
  executeTaskChain,
  saveMissionDossierToVfs,
} from './services/TaskChainService';
import { writeWorkspaceFile } from './engine/storageManager';
import { TaskChainHUD } from './components/TaskChainHUD';
import { PluginAuthModal, PluginAuthTarget } from './components/PluginAuthModal';
import { FieldManualModal } from './components/FieldManualModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  isPluginAuthenticated,
  clearPluginCredential,
  PluginAuthCredential,
} from './engine/pluginAuthManager';
import { handleOpenRouterCallback } from './services/OpenRouterAuth';

type NavTab = 'hq' | 'crew' | 'plugins' | 'themes';
type HqSubView = 'terminal' | 'town_hall' | 'command_log' | 'task_queue' | 'recon_monitor';

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
    awardAgentXp,
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
  const [hqSubView, setHqSubView] = useState<HqSubView>(() => {
    const saved = restoredSession?.hqSubView as string | undefined;
    if (saved && saved !== 'toolkits' && saved !== 'recon_monitor') {
      return restoredSession!.hqSubView;
    }
    return 'terminal';
  });

  useEffect(() => {
    if (activeTab !== 'crew') return;
    const t = setInterval(() => {
      setPreviewWalkFrame((f) => (f === 1 ? 2 : 1));
    }, 220);
    return () => clearInterval(t);
  }, [activeTab]);
  const [commandLedger, setCommandLedger] = useState<CommandLedgerEntry[]>([]);
  const [queuedTasksCount, setQueuedTasksCount] = useState<number>(() => {
    try {
      return loadStrategyBoardTasks().filter((t) => t.status !== 'completed').length;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    const handleUpdate = () => {
      try {
        setQueuedTasksCount(loadStrategyBoardTasks().filter((t) => t.status !== 'completed').length);
      } catch {}
    };
    window.addEventListener('strategy:tasks-updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('strategy:tasks-updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  // OpenRouter 1-Click OAuth PKCE Callback Listener & Headless Classified Intel Ingestion
  useEffect(() => {
    handleOpenRouterCallback().then((res) => {
      if (res?.ok) {
        console.log('[OpenRouter] Authenticated successfully via 1-Click PKCE SSO');
      }
    });
    // Silently initialize background classified feed ingestion pipeline
    initClassifiedFeedIngestion();
  }, []);
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
  const [executingAgentIds, setExecutingAgentIds] = useState<string[]>([]);
  const [isGameActive, setIsGameActive] = useState(false);
  const [isGameClosing, setIsGameClosing] = useState(false);
  const [decryptionBoost, setDecryptionBoost] = useState<number>(
    () => restoredSession?.decryptionBoost || 0
  );
  const [pendingTask, setPendingTask] = useState<PendingTaskSnapshot | null>(
    () => (restoredSession?.pendingTask?.isPending ? restoredSession.pendingTask : null)
  );
  const [completionAlertAgentId, setCompletionAlertAgentId] = useState<string | null>(null);
  const [errorAlertAgentId, setErrorAlertAgentId] = useState<string | null>(null);
  const [lastActionSummary, setLastActionSummary] = useState<string | null>(
    () => restoredSession?.lastActionSummary || null
  );
  const [dialogueText, setDialogueText] = useState<string>(
    () =>
      restoredSession?.dialogueText ||
      loadExecutionCards()[0]?.dialogue ||
      'Command Center online. Select an operative and transmit your directive.'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retroError, setRetroError] = useState<RetroErrorDescriptor | null>(null);
  const [isRetroErrorModalOpen, setIsRetroErrorModalOpen] = useState(false);
  const [serverReady, setServerReady] = useState<boolean>(true);
  const [vaultReport, setVaultReport] = useState<VaultStartupReport | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFieldManualOpen, setIsFieldManualOpen] = useState(false);
  const [isNightShiftOpen, setIsNightShiftOpen] = useState(false);
  const [nightShiftUnreadCount, setNightShiftUnreadCount] = useState<number>(() => loadNightShiftNotifications().filter((n) => !n.read).length);
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [isThreatMonitorOpen, setIsThreatMonitorOpen] = useState(false);
  const [isReconOverlayOpen, setIsReconOverlayOpen] = useState(false);
  const [reconMonitorTarget, setReconMonitorTarget] = useState<{
    lat: number;
    lon: number;
    label: string;
    sectorCode: string;
  }>({
    lat: 30.5852,
    lon: 32.2654,
    label: 'Suez Canal & Red Sea Subsea Cable Corridor',
    sectorCode: 'SECTOR-54 // SUEZ-CHOKELINE',
  });
  const [isAgentFactoryOpen, setIsAgentFactoryOpen] = useState(false);
  const [isTerminalConsoleOpen, setIsTerminalConsoleOpen] = useState(false);
  const [isWorkspaceFilesOpen, setIsWorkspaceFilesOpen] = useState(false);
  const [activePlaybook, setActivePlaybook] = useState<IntelligencePlaybookDef | null>(null);
  const [isPlaybookModalOpen, setIsPlaybookModalOpen] = useState(false);
  const [isPlaybookRunning, setIsPlaybookRunning] = useState(false);
  const [playbookStageIndex, setPlaybookStageIndex] = useState(0);
  const [playbookLogs, setPlaybookLogs] = useState<string[]>([]);
  const [playbookResult, setPlaybookResult] = useState<PlaybookExecutionResult | null>(null);

  const handleOpenPlaybookSetup = (playbook: IntelligencePlaybookDef) => {
    setActivePlaybook(playbook);
    setPlaybookResult(null);
    setIsPlaybookModalOpen(true);
    setDialogueText(`[OSINT DIRECTIVE] Configure target for ${playbook.shortTitle} with ${playbook.assignedOperativeName}.`);
  };

  const handleRunPlaybook = async (playbook: IntelligencePlaybookDef, target?: UserPlaybookTarget) => {
    const storedTargets = loadUserPlaybookTargets();
    const resolvedTarget = target || storedTargets[playbook.id] || DEFAULT_TARGET_PRESETS[playbook.id][0];

    setActivePlaybook(playbook);
    setIsPlaybookModalOpen(true);
    setIsPlaybookRunning(true);
    setPlaybookStageIndex(0);
    setPlaybookLogs([
      `Mission Ingested: Deploying ${playbook.assignedOperativeName} to ${playbook.roomName}...`,
      `Target Entity: [${resolvedTarget.targetName}]`,
      `Recon Scope: ${resolvedTarget.targetScope}`,
    ]);
    setPlaybookResult(null);

    handleMoveAgentToRoom(
      playbook.assignedOperativeId,
      playbook.assignedRoom,
      playbook.assignedStationId,
      `${playbook.shortTitle.toUpperCase()} - ${resolvedTarget.targetName.slice(0, 16)}`
    );

    setDialogueText(`[CLASSIFIED PLAYBOOK] Deploying ${playbook.assignedOperativeName} to ${playbook.roomBadge} targeting "${resolvedTarget.targetName}"...`);

    try {
      const res = await executeIntelligencePlaybook(playbook.id, resolvedTarget, (stageIdx: number, log: string) => {
        setPlaybookStageIndex(stageIdx);
        setPlaybookLogs((prev) => [...prev, log]);
      });
      setPlaybookResult(res);

      let ribbonToUnlock: ServiceRibbonId | undefined = undefined;
      if (playbook.id === 'wiretap_watch') {
        ribbonToUnlock = 'First Wiretap';
      } else if (playbook.pillar === 2) {
        ribbonToUnlock = 'Toolmaster';
      }

      const xpResult = awardAgentXp(playbook.assignedOperativeId, 25, true, ribbonToUnlock);
      if (xpResult.leveledUp) {
        const rankTitle = CLEARANCE_RANKS[xpResult.newLevel].title;
        setDialogueText(
          `[RANK PROMOTION] ${playbook.assignedOperativeName} reached ${rankTitle}! (+25 XP · Archived to ${res.targetPath})`
        );
      } else {
        setDialogueText(
          `[DOSSIER ARCHIVED] ${playbook.assignedOperativeName} archived intelligence on "${res.targetName}" to ${res.targetPath}. (+25 XP)`
        );
      }
      playBeep('complete');
      refreshCommandLedger();
    } catch (err: any) {
      setPlaybookLogs((prev) => [...prev, `EXECUTION FAULT: ${err?.message || err}`]);
      playBeep('error');
    } finally {
      setIsPlaybookRunning(false);
    }
  };
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [syncStats, setSyncStats] = useState<SyncStats>(() => getSyncStats());
  const [dismissPortraitGuard, setDismissPortraitGuard] = useState(false);
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
  const [customPlugins, setCustomPlugins] = useState<CustomPluginConnector[]>(loadCustomPlugins);
  const [isCustomPluginModalOpen, setIsCustomPluginModalOpen] = useState(false);
  const [editingCustomPlugin, setEditingCustomPlugin] = useState<CustomPluginConnector | null>(null);
  const [isPluginAuthModalOpen, setIsPluginAuthModalOpen] = useState(false);
  const [activeAuthPlugin, setActiveAuthPlugin] = useState<PluginAuthTarget | null>(null);
  const [pluginsSubTab, setPluginsSubTab] = useState<'composio' | 'custom'>('composio');
  const [composioConnectedCount, setComposioConnectedCount] = useState<number>(0);
  const [activeTaskChain, setActiveTaskChain] = useState<TaskChain | null>(null);
  const [taskChainProgressText, setTaskChainProgressText] = useState<string>('');

  const syncComposioAccounts = useCallback(async () => {
    try {
      const accounts = await ComposioService.getConnectedAccounts();
      const active = accounts.filter(
        (a) => a.status === 'ACTIVE' || a.status === 'INITIATED'
      );
      setComposioConnectedCount(active.length);
    } catch {}
  }, []);

  useEffect(() => {
    syncComposioAccounts();

    const handleSync = () => {
      syncComposioAccounts();
    };

    window.addEventListener('focus', handleSync);
    window.addEventListener('composio:connection-updated', handleSync);
    window.addEventListener('composio:session-synced', handleSync);

    const unsubscribe = ComposioService.subscribeToConnectionChanges?.((accounts) => {
      const active = accounts.filter(
        (a) => a.status === 'ACTIVE' || a.status === 'INITIATED'
      );
      setComposioConnectedCount(active.length);
    });

    return () => {
      window.removeEventListener('focus', handleSync);
      window.removeEventListener('composio:connection-updated', handleSync);
      window.removeEventListener('composio:session-synced', handleSync);
      unsubscribe?.();
    };
  }, [syncComposioAccounts]);

  // SatCom Multi-Device Cloud Sync Background Service
  useEffect(() => {
    const stopAutoSync = startAutoSync();
    const unsub = subscribeSyncStatus((stats) => {
      setSyncStats(stats);
    });
    return () => {
      stopAutoSync();
      unsub();
    };
  }, []);

  // Subscribe to module registry changes & live agent satellite recon tool locks
  const [, setModuleRegistryTick] = useState(0);
  useEffect(() => {
    const unsubRegistry = subscribeModuleRegistry(() => setModuleRegistryTick((t) => t + 1));

    const handleSatelliteReconToolLock = (ev: Event) => {
      const customEv = ev as CustomEvent<{
        lat: number;
        lon: number;
        label: string;
        layer?: string;
        date?: string;
      }>;
      const detail = customEv.detail;
      if (!detail || typeof detail.lat !== 'number' || typeof detail.lon !== 'number') return;

      setReconMonitorTarget({
        lat: detail.lat,
        lon: detail.lon,
        label: detail.label || `Target (${detail.lat.toFixed(3)}°, ${detail.lon.toFixed(3)}°)`,
        sectorCode: `SAT_RECON // ${detail.lat.toFixed(2)}°, ${detail.lon.toFixed(2)}°`,
      });
      // Automatically pull up the Recon Monitor overlay over the rooms so the Briefing Terminal below stays open for prompts
      setIsReconOverlayOpen(true);
    };

    window.addEventListener('pixelops:satellite-recon-lock', handleSatelliteReconToolLock);
    return () => {
      unsubRegistry();
      window.removeEventListener('pixelops:satellite-recon-lock', handleSatelliteReconToolLock);
    };
  }, []);

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
    auditStorageHealth().catch((e) => console.warn('Storage health audit warning:', e));
    backgroundWorkerEngine.startBackgroundLoop();
  }, []);

  // Autonomous Night Shift Background Routine Ticker & Event Listener
  useEffect(() => {
    const handleSyncNotifs = () => {
      setNightShiftUnreadCount(loadNightShiftNotifications().filter((n) => !n.read).length);
    };

    window.addEventListener('nightshift:notifications-changed', handleSyncNotifs);
    window.addEventListener('nightshift:routine-completed', handleSyncNotifs);

    const checkRoutines = () => {
      const enabledPluginIds = plugins.filter((p) => p.connected).map((p) => p.id);
      runPendingNightShiftTasks(theme.id, enabledPluginIds).catch((err) =>
        console.warn('[NightShift] Background worker ticker warning:', err)
      );
    };

    const initialTimer = setTimeout(checkRoutines, 4000);
    const intervalTimer = setInterval(checkRoutines, 30000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
      window.removeEventListener('nightshift:notifications-changed', handleSyncNotifs);
      window.removeEventListener('nightshift:routine-completed', handleSyncNotifs);
    };
  }, [theme.id, plugins]);

  const handleUpdatePreferences = (next: CommandPreferences) => {
    setPreferences(next);
    savePreferences(next);
  };

  const handleOpenPluginAuth = (plugin: any) => {
    playBeep('tap');
    setActiveAuthPlugin({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      toolFunctionName: plugin.toolFunctionName,
      serviceLabel: plugin.serviceLabel,
      accountHandle: plugin.accountHandle,
      connected: plugin.connected ?? isPluginAuthenticated(plugin.id),
      category: plugin.category,
    });
    setIsPluginAuthModalOpen(true);
  };

  const handlePluginAuthorized = (pluginId: string, credential: PluginAuthCredential) => {
    playBeep('complete');
    setPlugins((prev) => {
      const next = prev.map((p) => {
        if (p.id === pluginId) {
          return {
            ...p,
            connected: true,
            accountHandle: credential.accountHandle || 'BYOK Local Token',
            lastSync: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
        }
        return p;
      });
      savePlugins(next);
      return next;
    });
    setDialogueText(`[PLUGIN AUTHORIZED] BYOK key linked for ${pluginId}. AES-GCM local storage verified.`);
    runStartupVaultValidation();
  };

  const handlePluginRevoked = (pluginId: string) => {
    playBeep('tap');
    clearPluginCredential(pluginId);
    setPlugins((prev) => {
      const next = prev.map((p) => {
        if (p.id === pluginId) {
          return {
            ...p,
            connected: false,
            lastSync: 'Token Revoked',
          };
        }
        return p;
      });
      savePlugins(next);
      return next;
    });
    setDialogueText(`[PLUGIN REVOKED] Credentials cleared for ${pluginId}.`);
    runStartupVaultValidation();
  };

  const handleTogglePlugin = async (pluginId: PluginConnector['id']) => {
    playBeep('tap');
    const target = plugins.find((p) => p.id === pluginId);
    if (!target) return;

    if (target.connected) {
      handlePluginRevoked(pluginId);
    } else {
      handleOpenPluginAuth(target);
    }
  };

  const handleRotatePluginOAuth = async (pluginId: PluginConnector['id']) => {
    playBeep('tap');
    const target = plugins.find((p) => p.id === pluginId);
    if (target) {
      handleOpenPluginAuth(target);
    } else {
      await refreshOAuthProviderToken(pluginId);
      await runStartupVaultValidation();
    }
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

    // Award +50 XP and Neural Bypass Ace ribbon
    const xpResult = awardAgentXp(activeAgent.id, 50, false, 'Neural Bypass Ace');

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
    const promotionText = xpResult.leveledUp
      ? ` PROMOTION: ${CLEARANCE_RANKS[xpResult.newLevel].title}!`
      : '';
    setDialogueText(
      `[BYPASS OVERRIDE +${finalBoostPct}%] Neural sequence cleared! +150 battery tokens & +50 XP awarded.${promotionText}`
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
    const lower = promptText.toLowerCase().trim();

    // Default to the currently selected active agent in the Command Center
    const currentActiveIdx = Math.max(
      0,
      crewAgents.findIndex((a) => a.id === activeAgent.id)
    );

    // Check if another agent is explicitly called out by name or @tag
    const c0 = getCrewAgentByIndex(0)?.customName?.toLowerCase() || 'vance';
    const c1 = getCrewAgentByIndex(1)?.customName?.toLowerCase() || 'nyx';
    const c2 = getCrewAgentByIndex(2)?.customName?.toLowerCase() || 'cipher';

    const mentionsVance =
      new RegExp(`(^|\\b)(@?${c0}|agent\\s+${c0}|vance|oakwood|ragnar)(:|,|\\s|$)`, 'i').test(lower);
    const mentionsNyx =
      new RegExp(`(^|\\b)(@?${c1}|agent\\s+${c1}|nyx|vera|freya)(:|,|\\s|$)`, 'i').test(lower);
    const mentionsCipher =
      new RegExp(`(^|\\b)(@?${c2}|agent\\s+${c2}|cipher|pory|skald)(:|,|\\s|$)`, 'i').test(lower);

    let assignedAgentIdx = currentActiveIdx;
    if (mentionsNyx && currentActiveIdx !== 1) assignedAgentIdx = 1;
    else if (mentionsCipher && currentActiveIdx !== 2) assignedAgentIdx = 2;
    else if (mentionsVance && currentActiveIdx !== 0) assignedAgentIdx = 0;

    // Retain the assigned operative's current room unless an explicit room relocation was requested
    const currentCrewMember = getCrewAgentByIndex(assignedAgentIdx);
    const currentAgentRoom = (currentCrewMember?.currentRoom || currentRoom) as RoomId;

    let targetRoom: RoomId = currentAgentRoom;
    let targetStation: string =
      currentCrewMember?.preferredStationId ||
      (getRoomStations(targetRoom)?.[0]?.id) ||
      'war_center_desk';

    let taskTag = 'EXECUTING';

    // 1. Explicit request for Archive Basement
    if (/\b(go\s+to|move\s+to|head\s+to|in\s+the|access\s+the)?\s*(archive|basement|omega\s+safe|cold\s+storage|microfiche|pneumatic)\b/i.test(lower)) {
      targetRoom = 'archive_basement';
      targetStation = /microfiche|tape/.test(lower)
        ? 'basement_microfiche'
        : /pneumatic|tube/.test(lower)
        ? 'basement_pneumatic'
        : 'basement_omega_safe';
      taskTag = 'ARCHIVE SEARCH';
    }
    // 2. Explicit request for Armory
    else if (/\b(go\s+to|move\s+to|head\s+to|in\s+the)?\s*(armory|drone\s+bay|gear\s+rack|weapon\s+bench)\b/i.test(lower)) {
      targetRoom = 'armory';
      targetStation = /drone/.test(lower)
        ? 'armory_drone_bay'
        : /bench|calibrate/.test(lower)
        ? 'armory_workbench'
        : 'armory_gear_rack';
      taskTag = 'ARMORY';
    }
    // 3. Explicit request for Comms Tower
    else if (/\b(go\s+to|move\s+to|head\s+to|in\s+the)?\s*(comms\s+tower|radio\s+dish|radar\s+scope|cipher\s+rig)\b/i.test(lower)) {
      targetRoom = 'comms_tower';
      targetStation = /radar/.test(lower)
        ? 'comms_radar_scope'
        : /cipher|frequency/.test(lower)
        ? 'comms_cipher_rig'
        : 'comms_dish_console';
      taskTag = 'COMMS';
    }
    // 4. Explicit request for Briefing Lounge
    else if (/\b(go\s+to|move\s+to|head\s+to|in\s+the)?\s*(briefing\s+lounge|coffee\s+bar|sofa|holo\s+table)\b/i.test(lower)) {
      targetRoom = 'briefing_lounge';
      targetStation = /coffee|bar/.test(lower)
        ? 'lounge_coffee_bar'
        : /sofa|couch/.test(lower)
        ? 'lounge_sofa'
        : 'lounge_holo_table';
      taskTag = 'BRIEFING';
    }
    // 5. Explicit request for Server Vault
    else if (/\b(go\s+to|move\s+to|head\s+to|in\s+the)?\s*(server\s+vault|vault\s+laptop|breakers|core\s+rack)\b/i.test(lower)) {
      targetRoom = 'server_vault';
      targetStation = /breaker|power/.test(lower)
        ? 'vault_breakers'
        : /core|rack/.test(lower)
        ? 'vault_core_rack'
        : 'vault_laptop';
      taskTag = 'VAULT OPS';
    }
    // 6. Explicit request for War Room
    else if (/\b(go\s+to|move\s+to|head\s+to|in\s+the)?\s*(war\s+room|flight\s+node|center\s+desk)\b/i.test(lower)) {
      targetRoom = 'war_room';
      targetStation = /server|rack/.test(lower)
        ? 'war_server_rack'
        : /left|flight/.test(lower)
        ? 'war_left_desk'
        : 'war_center_desk';
      taskTag = 'WAR ROOM';
    }
    // 7. Dynamic Task Tag Assignment based on actual intent
    else if (hasAttachment || /\b(weather|forecast|temperature|humidity)\b/i.test(lower)) {
      taskTag = 'WEATHER SCAN';
    } else if (/\b(web\s+search|google|search\s+web|wikipedia|lookup|who\s+is|what\s+is)\b/i.test(lower)) {
      taskTag = 'WEB SEARCH';
    } else if (/\b(code|python|javascript|typescript|function|script|algorithm|bug|debug|implement)\b/i.test(lower)) {
      taskTag = 'CODING';
    } else if (/\b(calculate|compute|solve|math)\b/i.test(lower) || /^[\d\.\s\+\-\*\/\(\)\^\%]{3,}$/.test(lower)) {
      taskTag = 'CALCULATING';
    } else if (/\b(save|export|file|storage|write\s+to)\b/i.test(lower)) {
      taskTag = 'STORAGE';
    }

    // Ensure target station exists in target room
    const validStations = getRoomStations(targetRoom);
    if (validStations && validStations.length > 0) {
      if (!validStations.some((s) => s.id === targetStation)) {
        targetStation = validStations[0].id;
      }
    }

    return {
      room: targetRoom,
      agentIndex: assignedAgentIdx,
      stationId: targetStation,
      taskTag,
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
    if (!isExecuting && executionCards.length === 0 && roundtableSessions.length === 0) {
      setDialogueText(getRoomMetadata(nextRoom).defaultBriefing);
    }
  };

  /**
   * Autonomous Task Chain & Vance Supervisor Orchestrator:
   * Sequentially deploys operatives across sectors, transferring intelligence
   * and intermediate findings without requiring manual user re-prompting.
   */
  const handleExecuteTaskChain = async (
    prompt: string,
    customChain?: TaskChain,
    supervisorId: string = 'vance'
  ) => {
    const availableAgents = crewAgents.map((a) => ({
      id: a.id,
      name: a.customName || a.defaultName,
      role: a.role,
      functionalRole: a.functionalRole,
    }));

    setIsExecuting(true);
    setDialogueText(`[ORCHESTRATOR ROUTING] Vance evaluating mission objective & choreographing multi-agent plan...`);
    playBeep('tap');

    const chain =
      customChain || (await decomposeObjectiveWithSupervisor(prompt, availableAgents, supervisorId));
    if (!chain || chain.steps.length === 0) {
      handleExecuteDirective(prompt, null, true);
      return;
    }

    setActiveTaskChain(chain);
    setDialogueText(`[AUTONOMOUS TASK CHAIN INITIALIZED] "${chain.title}". Vance assigned ${chain.steps.length} sequential operative phases...`);
    playBeep('tap');

    const enabledPlugins = plugins.filter((p) => p.connected).map((p) => p.id);

    try {
      await executeTaskChain(
        chain,
        {
          onStepStart: (step) => {
            const crewMember = crewAgents.find((a) => a.id === step.assignedAgentId);
            setActiveAgentId(step.assignedAgentId);
            handleMoveAgentToRoom(
              step.assignedAgentId,
              step.targetSector,
              step.targetStationId || crewMember?.preferredStationId,
              `CHAIN P${step.stepIndex + 1}`
            );
            setIsRoutingCamera(true);
            setTimeout(() => setIsRoutingCamera(false), 2400);
            setDialogueText(
              `[CHAIN PHASE ${step.stepIndex + 1}/${chain.steps.length}] Deploying ${step.assignedAgentName} to ${getRoomMetadata(step.targetSector)?.shortBadge || step.targetSector.toUpperCase()}...`
            );
          },
          onStepProgress: (_step, progressText) => {
            setTaskChainProgressText(progressText);
            setDialogueText(progressText);
          },
          onStepComplete: (step, card) => {
            if (step.assignedAgentId) {
              addAgentMemory(step.assignedAgentId, {
                prompt: step.directive,
                summary: card.dialogue,
              });
            }
            setExecutionCards((prev) => [card, ...prev]);
            saveExecutionCards([card, ...executionCards]);
            playBeep('complete');
          },
          onStepHandoff: (fromStep, toStep, handoffData) => {
            setTaskChainProgressText(handoffData);
            setDialogueText(`[SEAMLESS HANDOFF] ${fromStep.assignedAgentName} ➔ ${toStep.assignedAgentName}: Intelligence transferred. Advancing to Phase ${toStep.stepIndex + 1}...`);
            playBeep('tap');
          },
          onChainComplete: (_chain, summaryCard) => {
            setExecutionCards((prev) => [summaryCard, ...prev]);
            saveExecutionCards([summaryCard, ...executionCards]);
            setDialogueText(`[MISSION CHAIN COMPLETE] All ${chain.steps.length} autonomous phases executed successfully. Telemetry verified in Command Log.`);
            setLastActionSummary(summaryCard.cardTitle);
            playBeep('complete');
            setIsExecuting(false);

            appendCommandLedgerEntry({
              timestamp: summaryCard.timestamp,
              command_input: summaryCard.prompt,
              involved_agent: summaryCard.agentName,
              tool_used: 'autonomous_task_chain_orchestrator',
              result_summary: summaryCard.cardTitle,
              success_boost_achieved: 100,
            });
            refreshCommandLedger();

            setTimeout(() => {
              setActiveTaskChain((prev) => (prev?.id === chain.id && prev.status === 'completed' ? null : prev));
            }, 8000);
          },
          onChainError: (_chain, err, failingStep) => {
            setIsExecuting(false);
            playBeep('error');
            setDialogueText(`[CHAIN ABORTED] Phase ${failingStep.stepIndex + 1} (${failingStep.assignedAgentName}) encountered an execution error: ${err?.message || err}`);
          },
          onFunctionCallTriggered: () => {
            setIsRoutingCamera(true);
            setTimeout(() => setIsRoutingCamera(false), 2400);
          },
        },
        themeId,
        enabledPlugins
      );
    } catch (err: any) {
      console.warn('[TASK CHAIN ERROR]', err);
      setIsExecuting(false);
    }
  };

  const handleExecuteDirective = async (
    prompt: string,
    attachment?: { data: string; mimeType: string; name: string } | null,
    skipAmbiguityCheck: boolean = false,
    explicitAgentId?: string,
    explicitTargetRoom?: RoomId
  ) => {
    // 0. Autonomous Multi-Step Task Chain & Vance Supervisor Routing
    if (
      !skipAmbiguityCheck &&
      !attachment &&
      (isDirectiveTaskChain(prompt) || isHighLevelSupervisorObjective(prompt, explicitAgentId || activeAgent.id))
    ) {
      handleExecuteTaskChain(prompt, undefined, explicitAgentId || activeAgent.id);
      return;
    }

    // 1. Automated Ambiguity Detection & Task Brief Interception (StarNet pattern)
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
    // If explicitAgentId is provided, strictly deploy the designated agent and sector rather than guessing from prompt text
    let targetRoom: RoomId;
    let routedCrewMember: any;
    let routedAgent: any;
    let assignmentStationId: string | undefined;
    let assignmentTaskTag: string;

    if (explicitAgentId) {
      routedCrewMember = crewAgents.find((a) => a.id === explicitAgentId);
      const presetMatch = theme.agents.find((a) => a.id === explicitAgentId);
      routedAgent = presetMatch || (routedCrewMember ? {
        ...activeAgent,
        id: routedCrewMember.id,
        name: routedCrewMember.customName || (routedCrewMember as any).name,
        role: routedCrewMember.role,
      } : activeAgent);
      targetRoom = explicitTargetRoom || (routedCrewMember?.currentRoom as RoomId) || 'war_room';
      assignmentStationId = routedCrewMember?.preferredStationId;
      assignmentTaskTag = (routedCrewMember?.role || 'EXECUTING').toUpperCase().slice(0, 12);
    } else {
      const assignment = resolveTaskAssignment(prompt, Boolean(attachment));
      targetRoom = assignment.room;
      routedCrewMember = getCrewAgentByIndex(assignment.agentIndex);
      routedAgent = theme.agents[assignment.agentIndex] || {
        ...activeAgent,
        id: routedCrewMember?.id || activeAgent.id,
        name: routedCrewMember?.customName || activeAgent.name,
        role: routedCrewMember?.role || activeAgent.role,
      };
      assignmentStationId = assignment.stationId;
      assignmentTaskTag = assignment.taskTag;
    }
    const routedDisplayName = routedCrewMember?.customName || routedAgent.name;

    handleMoveAgentToRoom(
      routedAgent.id,
      targetRoom,
      assignmentStationId,
      assignmentTaskTag
    );
    if (hqSubView !== 'town_hall') {
      setIsRoutingCamera(true);
      setTimeout(() => setIsRoutingCamera(false), 2400);
    }

    setDialogueText(`[DIRECTIVE INGESTED] Dispatching ${routedDisplayName} to ${getRoomMetadata(targetRoom)?.shortBadge || String(targetRoom).toUpperCase()} (${assignmentTaskTag})...`);
    setIsExecuting(true);
    setExecutingAgentIds((prev) => Array.from(new Set([...prev, routedAgent.id])));

    // Automatically bind agent recon coordinates to the Satellite Recon Monitor viewport if directive mentions a sector/location
    const detectedReconCoords = parseReconTargetToCoords(prompt);
    if (detectedReconCoords) {
      setReconMonitorTarget({
        lat: detectedReconCoords.lat,
        lon: detectedReconCoords.lon,
        label: detectedReconCoords.label,
        sectorCode: detectedReconCoords.sectorCode,
      });
    }
    setIsGameActive(false);
    setIsGameClosing(false);
    setDecryptionBoost(0);
    setErrorMessage(null);
    setRetroError(null);
    setIsRetroErrorModalOpen(false);

    try {
      setPendingTask({
        isPending: true,
        prompt,
        attachment: attachment || null,
        assignedAgentId: routedAgent.id,
        assignedRoom: targetRoom,
        assignedStationId: assignmentStationId || 'war_center_desk',
        taskTag: assignmentTaskTag || 'EXECUTING',
        decryptionBoost: 0,
        isGameActive: false,
        startedAt: new Date().toISOString(),
      });
      playBeep('tap');

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
      const combinedSystemPrompt = (routedCrewMember?.systemPrompt || '').trim() || undefined;

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
        agentProvider: routedCrewMember?.provider,
        agentModel: routedCrewMember?.model,
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

        // If any toolCall was osint_satellite_recon, automatically lock and open the Recon Monitor to what the agent inspected
        const satCall = newCard.toolCalls.find((tc) => tc.toolName === 'osint_satellite_recon');
        if (satCall) {
          const payload = satCall.livePayload || {};
          const satLat =
            payload.target?.coordinates?.latitude ??
            payload.target?.coordinates?.lat ??
            satCall.args?.lat;
          const satLon =
            payload.target?.coordinates?.longitude ??
            payload.target?.coordinates?.lon ??
            satCall.args?.lon;
          const satLabel =
            payload.target?.location ||
            payload.target?.name ||
            satCall.args?.location ||
            'Satellite Recon Target';

          if (typeof satLat === 'number' && typeof satLon === 'number') {
            setReconMonitorTarget({
              lat: satLat,
              lon: satLon,
              label: String(satLabel),
              sectorCode: `SAT_RECON // ${satLat.toFixed(2)}°, ${satLon.toFixed(2)}°`,
            });
          } else {
            const parsedFromArgs = parseReconTargetToCoords(String(satLabel));
            if (parsedFromArgs) {
              setReconMonitorTarget(parsedFromArgs);
            }
          }
          setIsReconOverlayOpen(true);
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

      // Resolve matching in-progress or pending Strategy Board task
      try {
        const boardTasks = loadStrategyBoardTasks();
        const activeMatch = boardTasks.find(
          (t) =>
            t.status === 'in_progress' ||
            t.title.toLowerCase() === prompt.toLowerCase() ||
            prompt.toLowerCase().includes(t.title.toLowerCase())
        );
        if (activeMatch) {
          updateStrategyBoardTaskStatus(activeMatch.id, 'completed');
        }
      } catch {}

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

      // 7. Autonomous Inter-Agent Delegation Check (delegate_task_to_operative)
      const delegationCall = newCard.toolCalls?.find(
        (tc) => tc.toolName === 'delegate_task_to_operative'
      );
      if (delegationCall && delegationCall.livePayload?.target_agent) {
        const targetRaw = String(delegationCall.livePayload.target_agent || '').toLowerCase();
        const delegatedDirective = String(delegationCall.livePayload.directive || '');
        const findings = String(delegationCall.livePayload.findings_to_pass || newCard.dialogue || '');

        const targetCrew =
          crewAgents.find(
            (a) =>
              a.id.toLowerCase().includes(targetRaw) ||
              a.customName.toLowerCase().includes(targetRaw) ||
              a.defaultName.toLowerCase().includes(targetRaw)
          ) || crewAgents[1];

        // Commit handoff note to VFS
        const handoffLog = `# Autonomous Inter-Agent Handoff Log\n**From:** ${routedDisplayName}\n**To:** ${targetCrew.customName}\n**Timestamp:** ${new Date().toISOString()}\n\n## Directive\n${delegatedDirective}\n\n## Transferred Intelligence\n${findings}`;
        writeWorkspaceFile(`logs/handoff_${Date.now()}.md`, handoffLog, 'markdown', 'logs');

        setDialogueText(
          `[AUTONOMOUS DELEGATION] ${routedDisplayName} ➔ ${targetCrew.customName}: Transferred findings. Dispatching operative immediately...`
        );
        playBeep('switch');

        setTimeout(() => {
          handleExecuteDirective(
            `${delegatedDirective}\n\n================================================================================\n[AUTONOMOUS HANDOFF FROM ${routedDisplayName.toUpperCase()}]:\n${findings}\n================================================================================`,
            null,
            true,
            targetCrew.id,
            targetCrew.currentRoom
          );
        }, 1600);
      }

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
      setErrorAlertAgentId(routedAgent.id);
      setTimeout(() => {
        setErrorAlertAgentId(null);
      }, 4000);
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
      setExecutingAgentIds((prev) => {
        const next = prev.filter((id) => id !== routedAgent.id);
        if (next.length === 0) {
          setIsExecuting(false);
          setPendingTask(null);
        }
        return next;
      });
    }
  };

  /**
   * Manually marks a queued task completed and immediately archives it to Cards and Command Ledger
   */
  const handleCompleteQueueTask = async (task: StrategyBoardTask) => {
    updateStrategyBoardTaskStatus(task.id, 'completed');
    const cleanAgent = (task.assignedAgent || '').toLowerCase();
    const matchedCrew =
      crewAgents.find(
        (a) =>
          a.id.toLowerCase().includes(cleanAgent) ||
          (a.customName || '').toLowerCase().includes(cleanAgent) ||
          (a.defaultName || '').toLowerCase().includes(cleanAgent)
      ) || crewAgents[0];

    const completedCard: AgentExecutionCard = {
      id: `card_${Date.now()}`,
      agentName: matchedCrew.customName || matchedCrew.id,
      cardTitle: `[DIRECTIVE COMPLETED] ${task.title}`,
      dialogue: `Task "${task.title}" has been verified and marked completed by Commander. Archived to Strategy Board and Command Log.`,
      timestamp: new Date().toISOString(),
      prompt: task.title,
      actionCategory: 'STRATEGY QUEUE',
      themeId: theme.id,
      tokenEstimate: 450,
      steps: [
        { label: 'Queue Extraction', detail: `Processed task from ${task.source}`, status: 'completed' },
        { label: 'Directive Verification', detail: 'Task marked complete by Commander', status: 'verified' },
      ],
      toolCalls: [
        {
          pluginId: 'strategy_queue',
          toolName: `queue_${task.source || 'task'}`,
          args: { priority: task.priority, source: task.source },
          resultSummary: `Completed task: ${task.title}`,
        },
      ],
    };

    const nextCards = [completedCard, ...executionCards];
    setExecutionCards(nextCards);
    saveExecutionCards(nextCards);

    await appendCommandLedgerEntry({
      timestamp: completedCard.timestamp,
      command_input: task.title,
      involved_agent: completedCard.agentName,
      tool_used: `queue_${task.source || 'task'}`,
      result_summary: completedCard.cardTitle,
      success_boost_achieved: 10,
    });
    await refreshCommandLedger();

    setDialogueText(`[TASK COMPLETED] Operative ${completedCard.agentName}: "${task.title}" verified and logged to Command Ledger.`);
  };

  /**
   * Dispatches a directive strictly to the designated agent, bypassing global selection state
   */
  const dispatchDirectiveToAgent = (
    agentId: string,
    directive: string,
    targetSector?: RoomId,
    skipAmbiguityCheck: boolean = false,
    stayInMeeting: boolean = false
  ) => {
    const cleanId = (agentId || '').trim().toLowerCase();
    const targetCrew = crewAgents.find(
      (a) =>
        a.id.toLowerCase() === cleanId ||
        (a.customName || '').toLowerCase() === cleanId ||
        (a.defaultName || '').toLowerCase() === cleanId
    );
    const targetPreset = theme.agents.find(
      (a) =>
        a.id.toLowerCase() === cleanId ||
        (a.name || '').toLowerCase() === cleanId
    );
    const resolvedAgent = targetCrew || targetPreset || activeAgent;

    if (!resolvedAgent) return;

    // Synchronize UI dropdown state so there is zero mismatch
    setActiveAgentId(resolvedAgent.id);
    if (!stayInMeeting) {
      setHqSubView('terminal');
    }
    setActiveSpeakerAgentIndex(null);

    const room =
      targetSector ||
      ((targetCrew?.currentRoom || (resolvedAgent as any).currentRoom) as RoomId) ||
      'war_room';

    handleMoveAgentToRoom(
      resolvedAgent.id,
      room,
      undefined,
      'EXECUTING'
    );

    handleExecuteDirective(directive, null, skipAmbiguityCheck, resolvedAgent.id, room);
  };

  /**
   * Deploys a task reading assignedAgentId and metadata strictly from the task item
   */
  const handleDeployTask = (
    taskId: string,
    targetAgentId: string,
    fallbackDirective?: string,
    fallbackSector?: RoomId,
    slotIdx: number = 0,
    stayInMeeting: boolean = true
  ) => {
    let matchedTask: RoundtableActionItem | undefined;
    for (const session of roundtableSessions) {
      if (session.actionItems) {
        const found = session.actionItems.find(
          (t, i) =>
            (t.id && t.id === taskId) ||
            `task_${session.id}_${i}` === taskId ||
            `task_${session.id}_${i + 1}` === taskId
        );
        if (found) {
          matchedTask = found;
          break;
        }
      }
    }

    const directive = (matchedTask?.directive || fallbackDirective || '').trim();
    const targetSector = (matchedTask?.targetSector || fallbackSector || 'war_room') as RoomId;
    const rawAgentIdentifier = matchedTask?.assignedAgentId || targetAgentId;

    if (!directive) {
      console.warn('[PixelOps] Deploy blocked: empty directive');
      return;
    }

    // Comprehensive case-insensitive & index-aware agent resolution:
    let resolvedAgent: any = undefined;
    const cleanId = (rawAgentIdentifier || '').trim().toLowerCase();

    // Strategy A: Exact ID match (case-insensitive)
    resolvedAgent = crewAgents.find(
      (a) => a.id.toLowerCase() === cleanId
    );

    // Strategy B: Exact Name / customName / defaultName match (case-insensitive)
    if (!resolvedAgent) {
      resolvedAgent = crewAgents.find((a) => {
        const custom = (a.customName || '').toLowerCase();
        const def = (a.defaultName || '').toLowerCase();
        return custom === cleanId || def === cleanId;
      });
    }

    // Strategy C: Substring name match (e.g. "Vance" inside "Agent Vance", or "Agent Vance" inside "vance")
    if (!resolvedAgent && cleanId) {
      resolvedAgent = crewAgents.find((a) => {
        const custom = (a.customName || '').toLowerCase();
        const def = (a.defaultName || '').toLowerCase();
        const id = a.id.toLowerCase();
        return (
          custom.includes(cleanId) ||
          cleanId.includes(custom) ||
          def.includes(cleanId) ||
          cleanId.includes(def) ||
          id.includes(cleanId) ||
          cleanId.includes(id)
        );
      });
    }

    // Strategy D: Theme agents match
    if (!resolvedAgent) {
      resolvedAgent = theme.agents.find((a) => {
        const id = (a.id || '').toLowerCase();
        const name = (a.name || '').toLowerCase();
        return (
          id === cleanId ||
          name === cleanId ||
          cleanId.includes(id) ||
          cleanId.includes(name)
        );
      });
    }

    // Strategy E: Extract slot number if identifier is like "agent_0", "operative_1", etc.
    if (!resolvedAgent && cleanId) {
      const matchNum = cleanId.match(/\d+/);
      if (matchNum) {
        const parsed = parseInt(matchNum[0], 10);
        const zeroIndex = cleanId.includes('operative') ? parsed - 1 : parsed;
        if (zeroIndex >= 0 && zeroIndex < crewAgents.length) {
          resolvedAgent = crewAgents[zeroIndex];
        }
      }
    }

    // Strategy F: Fall back to slotIdx
    if (!resolvedAgent && typeof slotIdx === 'number' && slotIdx >= 0 && slotIdx < crewAgents.length) {
      resolvedAgent = crewAgents[slotIdx];
    }

    // Strategy G: Absolute fallback to activeAgent or first agent
    if (!resolvedAgent) {
      resolvedAgent = crewAgents[0] || activeAgent;
    }

    const agentDisplayName = resolvedAgent.customName || resolvedAgent.name || 'Operative';
    const sectorBadge = getRoomMetadata(targetSector)?.shortBadge || String(targetSector).toUpperCase();

    // Immediately unblock audio & display HUD notification
    playBeep('complete');
    setDialogueText(
      `[OPERATIVE DISPATCHED] ${agentDisplayName} deploying to ${sectorBadge} for directive: "${directive.slice(0, 48)}..."`
    );

    // Track in Strategy Board as in_progress so it is immediately visible in the active task queue
    addStrategyBoardTasks([
      {
        id: taskId,
        title: directive,
        source: 'recon',
        priority: 'medium',
        status: 'in_progress',
        assignedAgent: agentDisplayName,
        createdAt: new Date().toISOString(),
      },
    ]);

    // Dispatch directly with stayInMeeting so commander is NOT kicked to the terminal!
    dispatchDirectiveToAgent(resolvedAgent.id, directive, targetSector, true, stayInMeeting);
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
  // Preserves existing dialogueText if a previous response or roundtable session already exists.
  const handleCallTownHallMeeting = (forceSummonBanner: boolean = false) => {
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

    if (forceSummonBanner || (roundtableSessions.length === 0 && executionCards.length === 0)) {
      const namesList = crewAgents.map((a) => a.customName).join(', ');
      setDialogueText(
        `[TOWN HALL SUMMON] Calling ${namesList} from all sectors to the central War Room Roundtable...`
      );
    }
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

                        {/* Assigned Model & Provider Pill / Quick Selector */}
                        <div className="flex flex-wrap items-center gap-2 mt-1.5 pt-1 border-t border-[#2b221a]">
                          <span className="text-[10px] text-[#9c8265] uppercase font-semibold">
                            AI Model:
                          </span>
                          <span
                            className={`text-[10px] font-mono-tabular font-bold px-1.5 py-0.5 rounded-xs border flex items-center gap-1.5 ${
                              hasProviderApiKey((crewMember.provider as any) || 'gemini')
                                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
                                : 'bg-amber-950/40 text-amber-300 border-amber-800/50'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                hasProviderApiKey((crewMember.provider as any) || 'gemini')
                                  ? 'bg-emerald-400'
                                  : 'bg-amber-400'
                              }`}
                            />
                            <span className="uppercase text-[9px] text-[#b8a690]">
                              {crewMember.provider || 'gemini'}:
                            </span>
                            <span>{crewMember.model || 'gemini-3.8-flash'}</span>
                          </span>

                          {/* Quick Provider Switcher Buttons */}
                          <div className="flex items-center gap-1">
                            {(['gemini', 'anthropic', 'openai', 'groq'] as const).map((prov) => {
                              const isCurrent = (crewMember.provider || 'gemini') === prov;
                              const pHasKey = hasProviderApiKey(prov);
                              return (
                                <button
                                  key={prov}
                                  type="button"
                                  onClick={() => {
                                    playBeep('tap');
                                    const defaultM =
                                      SUPPORTED_VAULT_PROVIDERS[prov]?.defaultModel || 'gemini-3.8-flash';
                                    updateAgentConfig(crewMember.id, {
                                      provider: prov,
                                      model: defaultM,
                                    });
                                    saveAgentModelConfig(crewMember.id, prov, defaultM);
                                  }}
                                  className={`px-1.5 py-0.2 text-[9px] font-mono-tabular rounded-xs border cursor-pointer transition-colors ${
                                    isCurrent
                                      ? 'bg-[#e59838] text-[#121110] font-bold border-[#e59838]'
                                      : 'bg-[#121110] text-[#9c8265] border-[#3d2b18] hover:text-[#f3ead8]'
                                  }`}
                                  title={`Switch ${crewMember.customName} to ${prov.toUpperCase()} (${
                                    pHasKey ? 'Key Available in Vault' : 'Key Missing in Settings'
                                  })`}
                                >
                                  {prov === 'gemini'
                                    ? 'Gemini'
                                    : prov === 'anthropic'
                                    ? 'Claude'
                                    : prov === 'openai'
                                    ? 'GPT-4o'
                                    : 'Groq'}
                                </button>
                              );
                            })}
                          </div>
                        </div>
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
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-0 flex flex-col gap-3">
      {/* Sub-Navigation Switcher: [⚔️ Composio Armory Matrix] | [🔌 Custom & Core Connectors] */}
      <div className="flex flex-wrap items-center justify-between bg-[#121110] border border-[#4a351d] p-1.5 rounded-sm gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setPluginsSubTab('composio');
              playBeep('tap');
            }}
            className={`px-3 py-1 font-mono-tabular text-xs cursor-pointer rounded-xs transition-colors ${
              pluginsSubTab === 'composio'
                ? 'bg-[#e59838] text-[#121110] font-bold shadow-[0_0_8px_rgba(229,152,56,0.4)]'
                : 'text-[#b8a690] hover:text-[#f3ead8] hover:bg-[#1f1914]'
            }`}
          >
            ⚔️ Composio Armory Matrix ({composioConnectedCount})
          </button>
          <button
            type="button"
            onClick={() => {
              setPluginsSubTab('custom');
              playBeep('tap');
            }}
            className={`px-3 py-1 font-mono-tabular text-xs cursor-pointer rounded-xs transition-colors ${
              pluginsSubTab === 'custom'
                ? 'bg-[#e59838] text-[#121110] font-bold shadow-[0_0_8px_rgba(229,152,56,0.4)]'
                : 'text-[#b8a690] hover:text-[#f3ead8] hover:bg-[#1f1914]'
            }`}
          >
            🔌 Custom & Core Connectors ({customPlugins.length + plugins.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('hq')}
          className="px-2.5 py-1 text-xs font-mono-tabular text-[#c89d66] hover:text-[#f3ead8] cursor-pointer"
        >
          [Back to HQ]
        </button>
      </div>

      {pluginsSubTab === 'composio' ? (
        <PluginMarketplace
          onPluginStatusChange={() => {
            setPlugins((prev) => [...prev]);
            syncComposioAccounts();
          }}
          onClose={() => setActiveTab('hq')}
        />
      ) : (
        <div className="rounded-sm bg-[#121110] border border-[#b47b38] shadow-[0_0_20px_rgba(0,0,0,0.65)] overflow-hidden">
          <div className="bg-[#231b12] border-b border-[#4a351d] px-3.5 py-2 flex items-center justify-between">
            <span className="font-mono-tabular text-xs sm:text-sm font-bold tracking-wider text-[#e59838] uppercase">
              🔌 CUSTOM & CORE CONNECTOR MATRIX
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

            {/* Built-in Core Agent Capability Plugins */}
            <div className="text-[11px] font-mono-tabular font-bold text-[#e59838] uppercase tracking-wider pt-2 border-t border-[#3a2917]">
              Core Agent Capability Plugins ({plugins.length})
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
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenPluginAuth(plugin)}
                          className="min-h-[28px] px-2 py-0.5 font-mono-tabular text-[11px] bg-[#1a1410] text-[#e59838] border border-[#785732] hover:bg-[#281e14] cursor-pointer"
                          title="Configure BYOK Key / OAuth Secret locally"
                        >
                          [BYOK 🔑]
                        </button>
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
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
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
    <div
      className="w-full h-full h-[100dvh] max-h-[100dvh] bg-[#0c0e14] text-[#f3ead8] p-0 sm:p-2 md:p-4 flex flex-col items-center sm:justify-center overflow-hidden box-border"
    >
      {/* Outer Retro Console Frame */}
      <div
        className="w-full h-full sm:h-auto max-w-6xl rounded-none sm:rounded-2xl bg-[#11131c] border-0 sm:border-[3px] overflow-hidden flex flex-col min-h-0 sm:min-h-[92vh] max-h-full sm:max-h-[96dvh] shadow-2xl command-center-layout"
        style={{
          borderColor: 'var(--theme-border-color)',
          boxShadow: '0 0 50px rgba(0,0,0,0.9), 0 0 24px var(--theme-glow-soft)',
        }}
      >
        {/* Top Console Telemetry Bar: [⚙️] SAFEHOUSE v1.0 | v1.0 | [🔋 100%] ▶⚡ */}
        <header
          className="bg-[#232634] border-b-2 border-[#161822] px-2.5 sm:px-5 py-1.5 sm:py-2 flex items-center justify-between gap-2 sm:gap-4 select-none shrink-0 overflow-x-auto no-scrollbar w-full z-20"
          style={{
            paddingTop: 'max(6px, env(safe-area-inset-top, 6px))',
            paddingLeft: 'max(10px, env(safe-area-inset-left, 10px))',
            paddingRight: 'max(10px, env(safe-area-inset-right, 10px))',
          }}
        >
          {/* Left Zone: [⚙️] SAFEHOUSE v1.0 + [🗺️ RADAR] Minimap Toggle */}
          {/* Left Zone: [⚙️] SAFEHOUSE + Sector Info + Soundscape */}
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
              <span>[⚙️]</span>
              <span className="uppercase">{theme.shortLabel} v1.0</span>
            </button>

            {(() => {
              const activeMeta = getRoomMetadata(currentRoom);
              const activeSound =
                ROOM_SOUNDSCAPE_PROFILES[currentRoom] || ROOM_SOUNDSCAPE_PROFILES.war_room;
              return (
                <div className="hidden sm:flex items-center gap-2.5 font-mono-tabular text-xs text-[#c5c9d6] pl-2 border-l border-[#363d54]">
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
                </div>
              );
            })()}
          </div>

          {/* Center Zone: Active Meeting / Boost / Sector Playbook */}
          <div className="hidden md:flex items-center gap-2 font-mono-tabular text-xs text-[#c5c9d6]">
            {isMeetingActive && (
              <span className="px-2 py-0.5 bg-[#38bdf8]/20 border border-[#38bdf8] text-[#38bdf8] font-bold animate-pulse">
                [📣 ROUNDTABLE: WAR ROOM]
              </span>
            )}
            {decryptionBoost > 0 && (
              <span className="px-2 py-0.5 bg-[#4ade80]/20 border border-[#4ade80] text-[#4ade80] font-bold">
                [⚡ BOOST +{decryptionBoost}%]
              </span>
            )}
          </div>

          {/* Right Zone: AI Subscription Plan + Night Shift + Telemetry */}
          <div className="flex items-center gap-2 shrink-0 font-mono-tabular text-xs">
            {/* AI Subscription / Connected Plan HUD Pill */}
            {(() => {
              const authInfo = getLLMAuthInfo(loadLLMProviderConfig());
              const isGoogle = authInfo.badge.includes('GOOGLE');
              return (
                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(true);
                    playBeep('tap');
                  }}
                  className={`px-2 py-0.5 border font-mono-tabular text-xs flex items-center gap-1.5 cursor-pointer transition-colors ${
                    authInfo.isConnected
                      ? isGoogle
                        ? 'bg-[#0b1f33] hover:bg-[#12304d] border-[#38bdf8] text-[#7dd3fc]'
                        : 'bg-[#0f291e] hover:bg-[#163c2b] border-[#4ade80] text-[#86efac]'
                      : 'bg-[#181926] hover:bg-[#222538] border-[#64748b] text-[#cbd5e1]'
                  }`}
                  title={`${authInfo.title}: ${authInfo.subtitle}. Click to configure subscription plans & sign in.`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      authInfo.isConnected ? 'bg-[#4ade80] animate-pulse' : 'bg-[#94a3b8]'
                    }`}
                  />
                  <span>[{authInfo.isConnected ? `💎 ${authInfo.badge}` : '💎 CONNECT AI PLAN'}]</span>
                </button>
              );
            })()}

            <button
              type="button"
              onClick={() => {
                setIsReconOverlayOpen((prev) => !prev);
                playBeep('tap');
              }}
              className={`px-2 py-0.5 border flex items-center gap-1 cursor-pointer transition-colors ${
                isReconOverlayOpen
                  ? 'bg-[#0c2e21] border-[#10b981] text-[#34d399] font-bold shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                  : 'bg-[#091e16] hover:bg-[#0e2d21] border-[#10b981]/60 hover:border-[#10b981] text-[#6ee7b7]'
              }`}
              title="Toggle Tactical Satellite Recon Monitor Overlay over the Safehouse Rooms (Keep Briefing Terminal open below to prompt agents live)"
            >
              <span>[🛰️ RECON MONITOR]</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsNightShiftOpen(true);
                playBeep('tap');
              }}
              className="px-2 py-0.5 bg-[#151822] hover:bg-[#1e2330] border border-[#363d54] hover:border-[#e59838] text-[#e59838] flex items-center gap-1 cursor-pointer transition-colors"
              title="Open Night Shift scheduler, routine briefings, and webhook connectors"
            >
              <span>[🌙 NIGHT SHIFT</span>
              {nightShiftUnreadCount > 0 && (
                <span className="text-[#4ade80] font-bold">
                  :{nightShiftUnreadCount}
                </span>
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
              <span>[📊 TELEMETRY]</span>
            </button>
            <PWAInstallButton />
          </div>
        </header>

        {/* Center Dark CRT Console Canvas */}
        <main className="flex-1 bg-[#0e1017] flex flex-col pb-3 sm:pb-5 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
          {/* Scrollable 7-Sector Overworld Diorama + Minimap Radar + Modular GameOverlay */}
          <SpriteCanvas
            currentRoom={currentRoom}
            onChangeRoom={handleRoomChange}
            agentRooms={agentRooms}
            onMoveAgentToRoom={handleMoveAgentToRoom}
            walkingTransition={walkingTransition}
            isRoutingCamera={isRoutingCamera}
            isExecuting={isExecuting}
            executingAgentIds={executingAgentIds}
            completionAlertAgentId={completionAlertAgentId}
            errorAlertAgentId={errorAlertAgentId}
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
            onExecutePlaybook={handleOpenPlaybookSetup}
            onOpenVfs={() => {
              setIsWorkspaceFilesOpen(true);
              playBeep('tap');
            }}
            isReconOverlayOpen={isReconOverlayOpen}
            onOpenReconOverlay={() => setIsReconOverlayOpen(true)}
            onCloseReconOverlay={() => setIsReconOverlayOpen(false)}
            reconTarget={reconMonitorTarget}
            onOpenThreatMatrixModal={() => setIsThreatMonitorOpen(true)}
            onDispatchReconDirective={(directive, coords) => {
              setReconMonitorTarget({
                lat: coords.lat,
                lon: coords.lon,
                label: coords.label,
                sectorCode: `SECTOR-LOCK // ${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`,
              });
              handleExecuteDirective(
                `${directive} [Orbital Target Lock: ${coords.label} at ${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}]`
              );
            }}
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
                      onClick={() => {
                        setHqSubView('task_queue');
                        setActiveSpeakerAgentIndex(null);
                        playBeep('tap');
                      }}
                      className={`px-3 py-1 font-mono-tabular text-xs cursor-pointer transition-colors flex items-center gap-1 ${
                        hqSubView === 'task_queue'
                          ? 'bg-[#38bdf8] text-[#0c1017] font-bold'
                          : 'text-[#38bdf8] hover:text-[#f3ead8]'
                      }`}
                      title="Inspect and manage the active mission task queue"
                    >
                      <span>📋 Task Queue ({queuedTasksCount})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCallTownHallMeeting(false)}
                      className={`px-3 py-1 font-mono-tabular text-xs cursor-pointer transition-colors flex items-center gap-1 ${
                        hqSubView === 'town_hall'
                          ? 'bg-[#38bdf8] text-[#0c1017] font-bold'
                          : 'text-[#38bdf8] hover:text-[#f3ead8]'
                      }`}
                      title={`Summon all ${crewAgents.length} active agents to the War Room for a Town Hall Roundtable`}
                    >
                      <span>📣 Call Meeting</span>
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
                      📜 Command Log
                    </button>
                  </div>
                  <span className="hidden sm:inline font-mono-tabular text-[11px] text-[#9c8265]">
                    {hqSubView === 'town_hall'
                      ? 'MULTI-AGENT ROUNDTABLE · WAR ROOM'
                      : 'DEXIE INDEXEDDB · APPEND-ONLY LEDGER'}
                  </span>
                </div>

                {activeTaskChain && (
                  <TaskChainHUD
                    chain={activeTaskChain}
                    currentProgressText={taskChainProgressText}
                    onCancel={() => {
                      setActiveTaskChain(null);
                      setTaskChainProgressText('');
                      setDialogueText('[TASK CHAIN] Chained mission aborted by Commander.');
                    }}
                  />
                )}

                {hqSubView === 'terminal' ? (
                  <>
                    {isExecuting && pendingTask && (
                      <div className="w-full max-w-2xl mx-auto px-3 sm:px-0">
                        <div className="p-2 bg-[#0c131d] border border-[#38bdf8]/60 flex items-center justify-between gap-2 text-xs font-mono-tabular shadow-[0_0_12px_rgba(56,189,248,0.2)]">
                          <div className="flex items-center gap-2 truncate">
                            <span className="w-2 h-2 rounded-full bg-[#38bdf8] animate-ping shrink-0" />
                            <span className="text-[#38bdf8] font-bold shrink-0">[ACTIVE IN-FLIGHT]</span>
                            <span className="text-[#f3ead8] truncate">&ldquo;{pendingTask.prompt}&rdquo;</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setHqSubView('task_queue');
                              playBeep('tap');
                            }}
                            className="px-2 py-0.5 bg-[#172538] hover:bg-[#223752] text-[#38bdf8] text-[10px] font-bold border border-[#38bdf8]/40 cursor-pointer whitespace-nowrap"
                          >
                            [VIEW QUEUE]
                          </button>
                        </div>
                      </div>
                    )}
                    <TerminalWindow
                      onOpenFieldManual={() => setIsFieldManualOpen(true)}
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
                  </>
                ) : hqSubView === 'task_queue' ? (
                  <TaskQueuePanel
                    activePendingTask={pendingTask}
                    isExecuting={isExecuting}
                    onExecuteDirective={handleExecuteDirective}
                    onCompleteTask={handleCompleteQueueTask}
                    onViewCommandLog={() => {
                      setHqSubView('command_log');
                      refreshCommandLedger();
                    }}
                    onViewCards={() => {
                      setHqSubView('terminal');
                    }}
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
                    onDispatchActionItem={(
                      agentIdx,
                      directive,
                      targetSector,
                      assignedAgentId,
                      taskId
                    ) => {
                      const fallbackId =
                        assignedAgentId ||
                        crewAgents[agentIdx]?.id ||
                        theme.agents[agentIdx]?.id ||
                        activeAgent.id;
                      handleDeployTask(
                        taskId || `task_${agentIdx}`,
                        fallbackId,
                        directive,
                        targetSector,
                        agentIdx
                      );
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
        <footer
          className="bg-[#1b1e29] border-t-2 border-[#282c3d] px-2 py-1.5 sm:py-2 flex items-center justify-start lg:justify-center shrink-0 overflow-x-auto no-scrollbar w-full z-20 touch-pan-x overscroll-x-contain scroll-smooth"
          style={{
            paddingBottom: 'max(6px, env(safe-area-inset-bottom, 6px))',
            paddingLeft: 'max(8px, env(safe-area-inset-left, 8px))',
            paddingRight: 'max(8px, env(safe-area-inset-right, 8px))',
            WebkitOverflowScrolling: 'touch',
          }}
          onWheel={(e) => {
            if (e.deltaY !== 0 && !e.deltaX) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          <nav
            aria-label="Console Navigation"
            className="inline-flex flex-nowrap items-center shrink-0 bg-[#232736] border border-[#363b4e] divide-x divide-[#363b4e] min-w-max select-none"
          >
            <button
              type="button"
              onClick={() => {
                setActiveTab('hq');
                playBeep('tap');
              }}
              className={`min-h-[42px] px-3.5 sm:px-6 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 sm:gap-2.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
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
              className={`min-h-[42px] px-3.5 sm:px-6 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 sm:gap-2.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
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
                setPluginsSubTab('composio');
                playBeep('tap');
              }}
              className={`min-h-[42px] px-3.5 sm:px-6 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 sm:gap-2.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                activeTab === 'plugins'
                  ? 'bg-[#e59838] text-[#121110] font-bold shadow-[0_0_10px_rgba(229,152,56,0.5)]'
                  : 'text-[#d0d4e0] hover:bg-[#292d3e]'
              }`}
            >
              <span className="text-base" aria-hidden="true">⚔️</span>
              <span>Plugins & Toolkits</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('themes');
                playBeep('tap');
              }}
              className={`min-h-[42px] px-3.5 sm:px-6 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 sm:gap-2.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
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
              className={`min-h-[42px] px-3 sm:px-5 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 transition-colors cursor-pointer border-l border-[#363b4e] shrink-0 whitespace-nowrap ${
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

            <button
              type="button"
              onClick={() => {
                setIsWorkspaceFilesOpen((prev) => !prev);
                playBeep('tap');
              }}
              className={`min-h-[42px] px-3 sm:px-5 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 transition-colors cursor-pointer border-l border-[#363b4e] shrink-0 whitespace-nowrap ${
                isWorkspaceFilesOpen
                  ? 'bg-[#152e34] text-[#38bdf8] font-semibold'
                  : 'text-[#38bdf8] hover:bg-[#15232e]'
              }`}
              title="Open Workspace File Explorer (IndexedDB Markdown Reports & Logs)"
            >
              <span className="text-base" aria-hidden="true">📁</span>
              <span className="hidden sm:inline">Files</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsSyncModalOpen((prev) => !prev);
                playBeep('tap');
              }}
              className={`min-h-[42px] px-3 sm:px-5 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 transition-colors cursor-pointer border-l border-[#363b4e] shrink-0 whitespace-nowrap ${
                isSyncModalOpen
                  ? 'bg-[#15342a] text-[#4ade80] font-semibold'
                  : 'text-[#4ade80] hover:bg-[#122820]'
              }`}
              title="Open SatCom Multi-Device Cloud Sync"
            >
              <span className="text-base" aria-hidden="true">☁️</span>
              <span className="hidden sm:inline">Sync</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsFeedbackOpen((prev) => !prev);
                playBeep('tap');
              }}
              className={`min-h-[42px] px-3 sm:px-5 py-1.5 font-mono-tabular text-sm sm:text-base flex items-center gap-2 transition-colors cursor-pointer border-l border-[#363b4e] shrink-0 whitespace-nowrap ${
                isFeedbackOpen
                  ? 'bg-[#0f2416] text-[#00ff66] font-semibold'
                  : 'text-[#00ff66] hover:bg-[#0a1a0f]'
              }`}
              title="Open Feedback Terminal (Relay to support@pixelops.app)"
            >
              <span className="text-base" aria-hidden="true">📡</span>
              <span className="hidden sm:inline">Feedback</span>
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
        onOpenWorkspaceFiles={() => setIsWorkspaceFilesOpen(true)}
        onOpenSyncModal={() => setIsSyncModalOpen(true)}
        onOpenFieldManual={() => setIsFieldManualOpen(true)}
        onOpenPluginAuth={handleOpenPluginAuth}
        onOpenFeedback={() => setIsFeedbackOpen(true)}
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
            if (updates.provider && updates.model) {
              saveAgentModelConfig(editingAgentId, updates.provider, updates.model);
            }
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

      <ThreatMonitorModal
        isOpen={isThreatMonitorOpen}
        onClose={() => setIsThreatMonitorOpen(false)}
        onOpenVaultFile={() => {
          setIsThreatMonitorOpen(false);
          setIsWorkspaceFilesOpen(true);
        }}
        onOpenLlmSettings={() => {
          setIsThreatMonitorOpen(false);
          setIsSettingsOpen(true);
        }}
        onInjectTerminalReport={async ({ agentName, title, markdown, savedFilePath }) => {
          const newCard: AgentExecutionCard = {
            id: `threat_recon_${Date.now()}`,
            agentName,
            cardTitle: title,
            dialogue: markdown,
            timestamp: new Date().toISOString(),
            prompt: `Autonomous Recon Sweep: ${title}`,
            actionCategory: 'THREAT CORRELATION & RECON MONITOR',
            themeId: theme.id,
            tokenEstimate: 620,
            steps: [
              { label: 'Macro-to-Micro Threat Correlation', detail: 'Cross-referenced subsea fiber, grid, CISA KEV & logistics feeds', status: 'completed' },
              { label: 'VFS Vault Archival', detail: savedFilePath ? `Saved dossier to /${savedFilePath}` : 'Archived to local IndexedDB Vault', status: 'verified' },
            ],
            toolCalls: [
              {
                pluginId: 'osint_threat_matrix',
                toolName: 'threat_correlation_recon_sweep',
                args: { savedFilePath: savedFilePath || '/intel/dossiers/' },
                resultSummary: title,
              },
            ],
          };
          const nextCards = [newCard, ...executionCards];
          setExecutionCards(nextCards);
          saveExecutionCards(nextCards);
          setDialogueText(`[RECON DOSSIER FILED] ${agentName}: "${title}" archived to VFS Vault (${savedFilePath || '/intel/dossiers/'}) and posted to Terminal Feed.`);
          playBeep('complete');
          await appendCommandLedgerEntry({
            timestamp: newCard.timestamp,
            command_input: newCard.prompt,
            involved_agent: agentName,
            tool_used: 'threat_correlation_recon_sweep',
            result_summary: title,
            success_boost_achieved: 15,
          });
          await refreshCommandLedger();
        }}
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
          setDialogueText(`[COMMAND APPROVED] Directive confirmed: "${clarifiedPrompt.slice(0, 36)}...". Operative deploying.`);
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
          commandLedger: commandLedger.map((c) => ({
            ...c,
            id: c.id != null ? String(c.id) : undefined,
          })),
          onDispatchTask: (agentId, taskPrompt) => {
            dispatchDirectiveToAgent(agentId, taskPrompt);
          },
          onExecuteChain: (workflowPrompt) => {
            handleExecuteTaskChain(workflowPrompt);
          },
          onOpenFieldManual: () => setIsFieldManualOpen(true),
          onApproveTask: (_taskId) => {
            if (taskBriefState.isOpen && taskBriefState.brief) {
              const rawOpt = taskBriefState.brief.options[0];
              const defaultClarified =
                (typeof rawOpt === 'string' ? rawOpt : (rawOpt as any)?.clarifiedPrompt) ||
                taskBriefState.rawPrompt;
              const att = taskBriefState.attachment;
              setTaskBriefState({ isOpen: false, brief: null, rawPrompt: '', attachment: null });
              setDialogueText(`[COMMAND APPROVED] Directive unblocked: "${defaultClarified.slice(0, 36)}...". Operative deploying.`);
              handleExecuteDirective(defaultClarified, att, true);
            }
          },
        }}
      />

      <WorkspaceFileViewer
        isOpen={isWorkspaceFilesOpen}
        onClose={() => setIsWorkspaceFilesOpen(false)}
      />

      <PlaybookModal
        isOpen={isPlaybookModalOpen}
        onClose={() => setIsPlaybookModalOpen(false)}
        playbook={activePlaybook}
        isRunning={isPlaybookRunning}
        activeStageIndex={playbookStageIndex}
        stageLogs={playbookLogs}
        result={playbookResult}
        onRunPlaybook={(target) => {
          if (activePlaybook) {
            handleRunPlaybook(activePlaybook, target);
          }
        }}
        onOpenInVfs={(filePath) => {
          setIsPlaybookModalOpen(false);
          setIsWorkspaceFilesOpen(true);
        }}
      />

      <SyncAccountModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
      />

      <FeedbackTerminal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
      />

      <PluginAuthModal
        isOpen={isPluginAuthModalOpen}
        onClose={() => setIsPluginAuthModalOpen(false)}
        plugin={activeAuthPlugin}
        onAuthorized={handlePluginAuthorized}
        onRevoked={handlePluginRevoked}
      />

      <ErrorBoundary fallbackTitle="FIELD MANUAL VIEWER RECOVERY">
        <FieldManualModal
          isOpen={isFieldManualOpen}
          onClose={() => setIsFieldManualOpen(false)}
          onSelectPrompt={(samplePrompt) => handleExecuteDirective(samplePrompt)}
        />
      </ErrorBoundary>

      {/* Mobile Portrait Orientation Lock Prompt */}
      {!dismissPortraitGuard && (
        <div className="portrait-orientation-guard fixed inset-0 z-[9999] bg-[#0c0e14]/98 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-[#f3ead8]">
          <div className="w-16 h-16 rounded-full bg-[#1e293b] border-2 border-[#4ade80] flex items-center justify-center mb-4 animate-pulse">
            <Smartphone className="w-8 h-8 text-[#4ade80] rotate-90" />
          </div>
          <div className="text-[11px] font-mono font-bold text-[#4ade80] tracking-widest uppercase mb-1">
            [SPY SAFEHOUSE · ORIENTATION DIRECTIVE]
          </div>
          <h2 className="text-base font-bold font-pixel text-[#f3ead8] mb-2">
            Rotate Device to Landscape
          </h2>
          <p className="text-xs text-[#94a3b8] max-w-xs mb-6 leading-relaxed">
            PixelOps Agent Command Center is engineered for widescreen tactical operations. Rotate your device sideways to initialize the live multi-room safehouse link.
          </p>
          <button
            type="button"
            onClick={() => setDismissPortraitGuard(true)}
            className="px-3 py-1.5 bg-[#1e2330] hover:bg-[#2d3748] border border-[#3b4252] text-[11px] font-mono text-[#a0aec0] rounded cursor-pointer transition-colors"
          >
            [Override · Continue in Portrait]
          </button>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="PIXELOPS COMMAND CENTER RECOVERY">
      <ThemeProvider>
        <CrewProvider>
          <InboxProvider>
            <CommandCenterContent />
          </InboxProvider>
        </CrewProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
