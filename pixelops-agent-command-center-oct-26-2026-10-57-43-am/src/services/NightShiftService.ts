import { ThemeId } from '../context/ThemeContext';
import { executeAgentDirective, AgentExecutionCard } from './ApiService';

export type ScheduleFrequency = 'every_5m' | 'every_1h' | 'every_6h' | 'daily';

export interface NightShiftTaskSchedule {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  prompt: string;
  frequency: ScheduleFrequency;
  enabled: boolean;
  maxTokensPerRun: number;
  maxActionsPerRun: number;
  safetyHaltOnAnomaly: boolean;
  lastRunTime?: string;
  runCount: number;
  createdAt: string;
}

export interface NightShiftNotification {
  id: string;
  taskId: string;
  taskTitle: string;
  agentName: string;
  timestamp: string;
  summary: string;
  tokenUsage: number;
  actionCount: number;
  status: 'completed' | 'guardrail_halt' | 'question_pending';
  read: boolean;
  cardResult?: AgentExecutionCard;
}

const STORAGE_SCHEDULES_KEY = 'pixelops_night_shift_schedules_v1';
const STORAGE_NOTIFICATIONS_KEY = 'pixelops_night_shift_notifications_v1';

export const DEFAULT_NIGHT_SHIFT_SCHEDULES: NightShiftTaskSchedule[] = [];

export const DEFAULT_NIGHT_SHIFT_NOTIFICATIONS: NightShiftNotification[] = [];

export function loadNightShiftSchedules(): NightShiftTaskSchedule[] {
  try {
    const raw = localStorage.getItem(STORAGE_SCHEDULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveNightShiftSchedules(schedules: NightShiftTaskSchedule[]) {
  try {
    localStorage.setItem(STORAGE_SCHEDULES_KEY, JSON.stringify(schedules));
  } catch {
    // Ignore
  }
}

export function loadNightShiftNotifications(): NightShiftNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_NOTIFICATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveNightShiftNotifications(notifs: NightShiftNotification[]) {
  try {
    localStorage.setItem(STORAGE_NOTIFICATIONS_KEY, JSON.stringify(notifs.slice(0, 50)));
  } catch {
    // Ignore
  }
}

/**
 * Executes a Night Shift task with autonomous leash & guardrail verification.
 */
export async function executeNightShiftTask(
  task: NightShiftTaskSchedule,
  themeId: ThemeId,
  enabledPlugins: string[]
): Promise<NightShiftNotification> {
  const startTime = Date.now();
  let status: 'completed' | 'guardrail_halt' | 'question_pending' = 'completed';
  let summary = '';
  let tokenUsage = 0;
  let actionCount = 0;
  let cardResult: AgentExecutionCard | undefined;

  try {
    // Run agent directive with guardrail checks
    const card = await executeAgentDirective({
      prompt: `[NIGHT SHIFT ROUTINE] ${task.prompt}`,
      themeId,
      activeAgentName: task.agentName,
      activeAgentRole: 'Autonomous Night Shift Operative',
      enabledPlugins,
      temperature: 0.65,
    });

    tokenUsage = card.tokenEstimate || 350;
    actionCount = card.toolCalls?.length || 1;
    cardResult = card;

    // Autonomous Leash & Guardrails Check
    if (tokenUsage > task.maxTokensPerRun || actionCount > task.maxActionsPerRun) {
      if (task.safetyHaltOnAnomaly) {
        status = 'guardrail_halt';
        summary = `GUARDRAIL HALT: Exceeded per-run limits (Tokens: ${tokenUsage}/${task.maxTokensPerRun}, Actions: ${actionCount}/${task.maxActionsPerRun}). Execution paused for user review.`;
      } else {
        summary = card.dialogue;
      }
    } else {
      summary = card.dialogue;
    }
  } catch (err: any) {
    status = 'guardrail_halt';
    summary = `NIGHT SHIFT ANOMALY: Routine failed with error — ${err?.message || 'Uplink timeout'}`;
  }

  const notif: NightShiftNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    taskId: task.id,
    taskTitle: task.title,
    agentName: task.agentName,
    timestamp: new Date().toISOString(),
    summary,
    tokenUsage,
    actionCount,
    status,
    read: false,
    cardResult,
  };

  return notif;
}
