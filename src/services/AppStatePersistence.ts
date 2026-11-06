import { useEffect, useRef } from 'react';
import { ThemeId } from '../context/ThemeContext';
import { RoomId, LiveAgentState } from '../components/SpriteCanvas';

export type AppLifecycleStatus = 'active' | 'background' | 'minimized' | 'unmounted';

export interface PendingTaskSnapshot {
  isPending: boolean;
  prompt: string;
  attachment?: { data: string; mimeType: string; name: string } | null;
  assignedAgentId: string;
  assignedRoom: RoomId;
  assignedStationId: string;
  taskTag: string;
  decryptionBoost: number;
  isGameActive: boolean;
  startedAt: string;
}

export interface PersistedAppSessionState {
  version: 1;
  themeId: ThemeId;
  activeAgentId: string;
  currentRoom: RoomId;
  agentRooms: Record<string, RoomId>;
  liveAgentsSnapshot?: Record<number, LiveAgentState>;
  autoRoam?: boolean;
  activeTab: 'hq' | 'crew' | 'plugins' | 'themes';
  hqSubView: 'terminal' | 'command_log' | 'town_hall' | 'task_queue' | 'recon_monitor';
  dialogueText: string;
  lastActionSummary: string | null;
  decryptionBoost: number;
  draftPromptInput?: string;
  pendingTask: PendingTaskSnapshot | null;
  lastLifecycleState: AppLifecycleStatus;
  savedAt: string;
}

const APP_SESSION_STORAGE_KEY = 'pixelops_app_session_state_v1';
const LIVE_AGENTS_STORAGE_KEY = 'pixelops_live_agents_snapshot_v1';
const DRAFT_PROMPT_STORAGE_KEY = 'pixelops_draft_prompt_v1';

/**
 * Loads the persisted app session state from localStorage on app relaunch.
 */
export function loadAppSessionSnapshot(): PersistedAppSessionState | null {
  try {
    const raw = localStorage.getItem(APP_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAppSessionState;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persists the current Redux/Context & UI session state to localStorage.
 */
export function saveAppSessionSnapshot(
  state: Omit<PersistedAppSessionState, 'version' | 'savedAt' | 'lastLifecycleState'>,
  lifecycleState: AppLifecycleStatus = 'active'
): PersistedAppSessionState | null {
  try {
    const payload: PersistedAppSessionState = {
      ...state,
      version: 1,
      lastLifecycleState: lifecycleState,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(APP_SESSION_STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

/**
 * Saves the individual 2D room/station coordinates of all 3 agents from SpriteCanvas.
 */
export function saveLiveAgentsSnapshot(
  liveAgents: Record<number, LiveAgentState>,
  autoRoam: boolean
): void {
  try {
    localStorage.setItem(
      LIVE_AGENTS_STORAGE_KEY,
      JSON.stringify({ liveAgents, autoRoam, savedAt: new Date().toISOString() })
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Loads the individual 2D room/station coordinates of all 3 agents on app relaunch.
 */
export function loadLiveAgentsSnapshot(): {
  liveAgents: Record<number, LiveAgentState>;
  autoRoam: boolean;
} | null {
  try {
    const raw = localStorage.getItem(LIVE_AGENTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.liveAgents) return null;
    return {
      liveAgents: parsed.liveAgents,
      autoRoam: typeof parsed.autoRoam === 'boolean' ? parsed.autoRoam : true,
    };
  } catch {
    return null;
  }
}

/**
 * Saves/loads the in-progress terminal command draft across minimizes & relaunches.
 */
export function saveDraftPrompt(draft: string): void {
  try {
    localStorage.setItem(DRAFT_PROMPT_STORAGE_KEY, draft);
  } catch {
    // Ignore
  }
}

export function loadDraftPrompt(): string {
  try {
    return localStorage.getItem(DRAFT_PROMPT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * React lifecycle & AppState persistence listener hook.
 * Bridges React Native's `AppState` concept with PWA browser lifecycle events
 * (`visibilitychange`, `pagehide`, `beforeunload`, `blur`, and `useEffect` unmount).
 */
export function useAppStatePersistence(
  currentState: Omit<PersistedAppSessionState, 'version' | 'savedAt' | 'lastLifecycleState'>,
  onAppForegroundResume?: (restored: PersistedAppSessionState | null) => void
) {
  const latestStateRef = useRef(currentState);
  latestStateRef.current = currentState;

  // Keep local storage synchronized whenever key session state changes
  useEffect(() => {
    saveAppSessionSnapshot(latestStateRef.current, 'active');
  }, [
    currentState.themeId,
    currentState.activeAgentId,
    currentState.currentRoom,
    currentState.agentRooms,
    currentState.activeTab,
    currentState.hqSubView,
    currentState.dialogueText,
    currentState.lastActionSummary,
    currentState.decryptionBoost,
    currentState.pendingTask,
  ]);

  // Lifecycle listeners: App minimize (visibilitychange -> hidden), pagehide, blur, beforeunload, and unmount
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveAppSessionSnapshot(latestStateRef.current, 'minimized');
      } else if (document.visibilityState === 'visible') {
        const snapshot = loadAppSessionSnapshot();
        onAppForegroundResume?.(snapshot);
      }
    };

    const handlePageHide = () => {
      saveAppSessionSnapshot(latestStateRef.current, 'minimized');
    };

    const handleWindowBlur = () => {
      saveAppSessionSnapshot(latestStateRef.current, 'background');
    };

    const handleBeforeUnload = () => {
      saveAppSessionSnapshot(latestStateRef.current, 'unmounted');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      // Save on React component unmount
      saveAppSessionSnapshot(latestStateRef.current, 'unmounted');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [onAppForegroundResume]);
}
