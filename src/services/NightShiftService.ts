import { ThemeId } from '../context/ThemeContext';
import { executeAgentDirective } from './agentEngineLazy';
import { AgentExecutionCard } from './ApiCore';
import { getAgentModelConfig } from './agentStore';
import {
  dispatchOutboxNotification,
  loadWebhookConfig,
  formatWebhookPayload,
} from './NotificationOutboxService';
import { ComposioService, getLocalConnectedAccounts } from './ComposioService';

export type ScheduleFrequency =
  | 'every_5m'
  | 'every_15m'
  | 'every_1h'
  | 'every_6h'
  | 'daily'
  | 'weekly';

export interface TaskChainStep {
  id: string;
  stepNumber: number;
  agentId: string;
  agentName: string;
  agentRole?: string;
  prompt: string;
  status?: 'idle' | 'running' | 'completed' | 'failed';
  outputSummary?: string;
}

export interface RoutineNotificationConfig {
  notifyBrowser: boolean;
  notifyPhone: boolean;
  notifyGmail: boolean;
  gmailRecipient?: string;
  notifySlack: boolean;
  slackChannel?: string;
  notifyDiscord: boolean;
  discordWebhook?: string;
  notifyWebhook: boolean;
  webhookUrl?: string;
}

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
  updatedAt?: string;
  // Multi-Agent Task Chaining
  chainSteps?: TaskChainStep[];
  // Multi-Channel Notifications
  notificationConfig?: RoutineNotificationConfig;
  // Live Status & History
  lastStatus?: 'idle' | 'running' | 'completed' | 'guardrail_halt' | 'error';
  lastRunSummary?: string;
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
  status: 'completed' | 'guardrail_halt' | 'question_pending' | 'error';
  read: boolean;
  cardResult?: AgentExecutionCard;
  chainStepResults?: Array<{
    stepNumber: number;
    agentName: string;
    prompt: string;
    summary: string;
    status: string;
    tokenEstimate?: number;
  }>;
  dispatchedChannels?: string[];
}

const STORAGE_SCHEDULES_KEY = 'pixelops_night_shift_schedules_v1';
const STORAGE_NOTIFICATIONS_KEY = 'pixelops_night_shift_notifications_v1';

export const DEFAULT_NOTIFICATION_CONFIG: RoutineNotificationConfig = {
  notifyBrowser: true,
  notifyPhone: true,
  notifyGmail: false,
  gmailRecipient: '',
  notifySlack: false,
  slackChannel: '',
  notifyDiscord: false,
  discordWebhook: '',
  notifyWebhook: false,
  webhookUrl: '',
};

export const FREQUENCY_MS: Record<ScheduleFrequency, number> = {
  every_5m: 5 * 60 * 1000,
  every_15m: 15 * 60 * 1000,
  every_1h: 60 * 60 * 1000,
  every_6h: 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function getFrequencyLabel(frequency: ScheduleFrequency): string {
  switch (frequency) {
    case 'every_5m':
      return 'Every 5 Minutes (Cron */5)';
    case 'every_15m':
      return 'Every 15 Minutes (Cron */15)';
    case 'every_1h':
      return 'Every 1 Hour (Cron 0 *)';
    case 'every_6h':
      return 'Every 6 Hours (Cron 0 */6)';
    case 'daily':
      return 'Daily Midnight (Cron 0 0)';
    case 'weekly':
      return 'Weekly Briefing (Cron 0 9 * * 1)';
    default:
      return 'Periodic Schedule';
  }
}

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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nightshift:schedules-changed', { detail: schedules }));
    }
  } catch {
    // Ignore storage quota
  }
}

const STORAGE_DELETED_SCHEDULES_KEY = 'pixelops_night_shift_deleted_ids_v1';

/**
 * In-memory set of actively cancelled or deleted tasks for instantaneous abort.
 */
export const activeCancelledTaskIds = new Set<string>();

export function loadDeletedRoutineIds(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_DELETED_SCHEDULES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveDeletedRoutineIds(deletedMap: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_DELETED_SCHEDULES_KEY, JSON.stringify(deletedMap));
  } catch {}
}

export function recordDeletedRoutine(id: string) {
  activeCancelledTaskIds.add(id);
  const current = loadDeletedRoutineIds();
  current[id] = new Date().toISOString();
  saveDeletedRoutineIds(current);
}

export function unrecordDeletedRoutine(id: string) {
  activeCancelledTaskIds.delete(id);
  const current = loadDeletedRoutineIds();
  if (current[id]) {
    delete current[id];
    saveDeletedRoutineIds(current);
  }
}

export function isRoutineDeleted(id: string): boolean {
  if (activeCancelledTaskIds.has(id)) return true;
  const deleted = loadDeletedRoutineIds();
  return Boolean(deleted[id]);
}

export function cancelRunningRoutine(id: string) {
  activeCancelledTaskIds.add(id);
}

/**
 * Fully deletes a scheduled routine:
 * 1. Halts any in-flight execution immediately via active cancellation token.
 * 2. Writes a tombstone to localStorage so cloud sync pull cannot resurrect it.
 * 3. Removes the routine from local schedules.
 * 4. Dispatches deletion events to notify UI components.
 * 5. Triggers an immediate cloud sync push so the cloud vault drops the routine without waiting.
 */
export function deleteNightShiftSchedule(id: string): NightShiftTaskSchedule[] {
  // 1. Instantly register in-memory and persistent cancellation token
  cancelRunningRoutine(id);
  recordDeletedRoutine(id);

  // 2. Remove from active schedules
  const current = loadNightShiftSchedules();
  const updated = current.filter((s) => s.id !== id);
  saveNightShiftSchedules(updated);

  // 3. Dispatch event
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nightshift:routine-deleted', { detail: { id } }));
  }

  // 4. Asynchronously push updated state to cloud vault to drop routine on server
  if (typeof window !== 'undefined') {
    import('./SyncService')
      .then(({ isAutoSyncEnabled, pushToCloud }) => {
        try {
          if (isAutoSyncEnabled()) {
            pushToCloud().catch((err) =>
              console.warn('[NightShift] Cloud push on delete error:', err)
            );
          }
        } catch {}
      })
      .catch(() => {});
  }

  return updated;
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
    localStorage.setItem(STORAGE_NOTIFICATIONS_KEY, JSON.stringify(notifs.slice(0, 100)));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nightshift:notifications-changed', { detail: notifs }));
    }
  } catch {
    // Ignore storage quota
  }
}

/**
 * Determines whether a scheduled routine is due for background execution.
 */
export function isTaskDue(task: NightShiftTaskSchedule, now: number = Date.now()): boolean {
  if (!task.enabled) return false;
  if (!task.lastRunTime) return true; // Never ran, immediately due

  const lastRun = new Date(task.lastRunTime).getTime();
  if (isNaN(lastRun)) return true;

  const intervalMs = FREQUENCY_MS[task.frequency] || (60 * 60 * 1000);
  return now - lastRun >= intervalMs;
}

/**
 * Dispatches multi-channel alerts (Browser, Phone Vibration/PWA, Gmail, Slack, Discord, Webhooks)
 */
export async function dispatchNightShiftAlerts(
  task: NightShiftTaskSchedule,
  notif: NightShiftNotification
): Promise<string[]> {
  const dispatched: string[] = [];
  const config = task.notificationConfig || DEFAULT_NOTIFICATION_CONFIG;
  const alertTitle = `[PixelOps Night Shift] ${task.title}`;
  const alertBody = notif.summary;

  // 1. Browser Native Push Notification
  if (config.notifyBrowser && typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(alertTitle, {
          body: alertBody,
          icon: '/pwa-192x192.png',
        });
        dispatched.push('browser');
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            new Notification(alertTitle, {
              body: alertBody,
              icon: '/pwa-192x192.png',
            });
          }
        });
        dispatched.push('browser_requested');
      }
    } catch (e) {
      console.warn('[NightShift] Browser notification failed:', e);
    }
  }

  // 2. Mobile Phone Vibration & PWA Notification
  if (config.notifyPhone && typeof window !== 'undefined') {
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 400]);
        dispatched.push('phone_vibrate');
      }
      if ('serviceWorker' in navigator && 'Notification' in window && Notification.permission === 'granted') {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(alertTitle, {
            body: alertBody,
            icon: '/pwa-192x192.png',
            badge: '/favicon.png',
            tag: `ns-${task.id}`,
            vibrate: [200, 100, 200],
          } as any);
        }).catch(() => {});
        dispatched.push('pwa_push');
      }
    } catch (e) {
      console.warn('[NightShift] Mobile notification failed:', e);
    }
  }

  // 3. Gmail Notification via Composio Integration
  if (config.notifyGmail) {
    try {
      const recipient = config.gmailRecipient?.trim();
      const localAccounts = getLocalConnectedAccounts();
      const gmailAccount = localAccounts.find((a) => a.appName.toLowerCase().includes('gmail'));
      const targetEmail = recipient || gmailAccount?.userUuid || gmailAccount?.id;

      if (targetEmail) {
        const emailContent = `Safehouse Operational Briefing — Routine Complete

Routine: ${task.title}
Assigned Operative: ${task.agentName}
Status: ${notif.status.toUpperCase()}
Execution Timestamp: ${notif.timestamp}
Tokens Used: ~${notif.tokenUsage}
Actions Dispatched: ${notif.actionCount}

Summary of Findings & Actions:
----------------------------------------
${notif.summary}
----------------------------------------

Automated transmission generated by PixelOps Agent Command Center.`;

        await ComposioService.executeComposioAction('GMAIL_SEND_EMAIL', {
          to: targetEmail,
          recipient_email: targetEmail,
          subject: alertTitle,
          body: emailContent,
        });
        dispatched.push(`gmail (${targetEmail})`);
      }
    } catch (gmailErr) {
      console.warn('[NightShift] Gmail dispatch failed:', gmailErr);
    }
  }

  // 4. Slack Notification via Composio Integration
  if (config.notifySlack) {
    try {
      const channel = config.slackChannel?.trim() || '#general';
      const slackMessage = `*[PixelOps Night Shift Routine Complete]*
*Routine:* ${task.title}
*Operative:* ${task.agentName}
*Status:* \`[${notif.status.toUpperCase()}]\` | *Tokens:* ~${notif.tokenUsage}

*Summary:*
>>> ${notif.summary}`;

      await ComposioService.executeComposioAction('SLACK_SEND_MESSAGE', {
        channel,
        text: slackMessage,
        message: slackMessage,
      });
      dispatched.push(`slack (${channel})`);
    } catch (slackErr) {
      console.warn('[NightShift] Slack dispatch failed:', slackErr);
    }
  }

  // 5. Discord Webhook / Channel Dispatch
  if (config.notifyDiscord && config.discordWebhook?.trim()) {
    try {
      await fetch(config.discordWebhook.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `🚨 **[PixelOps Night Shift] ${task.title}**\n**Operative:** ${task.agentName} | **Status:** ${notif.status.toUpperCase()}\n\n>>> ${notif.summary}`,
        }),
      });
      dispatched.push('discord');
    } catch (discordErr) {
      console.warn('[NightShift] Discord dispatch failed:', discordErr);
    }
  }

  // 6. Configured Outbound Webhook Dispatch (Slack / Telegram / Discord / Custom formatters)
  const globalWebhook = loadWebhookConfig();
  const effectiveWebhookUrl = config.notifyWebhook && config.webhookUrl?.trim()
    ? config.webhookUrl.trim()
    : globalWebhook.enabled && globalWebhook.webhookUrl.trim()
    ? globalWebhook.webhookUrl.trim()
    : null;

  if (effectiveWebhookUrl) {
    try {
      const serviceType = globalWebhook.serviceType || 'custom';
      const payload = formatWebhookPayload(serviceType, {
        title: alertTitle,
        body: notif.summary,
        agentName: task.agentName,
        timestamp: notif.timestamp,
      });

      await fetch(effectiveWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'no-cors',
      });
      dispatched.push(`webhook (${serviceType})`);
    } catch (webhookErr) {
      console.warn('[NightShift] Webhook dispatch failed:', webhookErr);
    }
  }

  // 7. Save to central Notification Outbox so it appears in Central [INBOX]
  try {
    await dispatchOutboxNotification({
      title: task.title,
      body: notif.summary,
      type: 'routine_complete',
      agentName: task.agentName,
    });
    dispatched.push('inbox');
  } catch {}

  return dispatched;
}

/**
 * Executes a Night Shift task or task chain with autonomous leash & guardrail verification.
 */
export async function executeNightShiftTask(
  task: NightShiftTaskSchedule,
  themeId: ThemeId,
  enabledPlugins: string[],
  onStepProgress?: (stepNum: number, totalSteps: number, agentName: string) => void
): Promise<NightShiftNotification> {
  // If task was already deleted or cancelled, abort immediately without execution
  if (isRoutineDeleted(task.id) || activeCancelledTaskIds.has(task.id)) {
    return {
      id: `notif-cancelled-${Date.now()}`,
      taskId: task.id,
      taskTitle: task.title,
      agentName: task.agentName,
      timestamp: new Date().toISOString(),
      summary: `[ROUTINE ABORTED] Routine "${task.title}" was deleted or cancelled. Execution halted.`,
      tokenUsage: 0,
      actionCount: 0,
      status: 'guardrail_halt',
      read: true,
    };
  }

  let status: 'completed' | 'guardrail_halt' | 'question_pending' | 'error' = 'completed';
  let summary = '';
  let tokenUsage = 0;
  let actionCount = 0;
  let cardResult: AgentExecutionCard | undefined;
  const chainStepResults: NonNullable<NightShiftNotification['chainStepResults']> = [];

  try {
    const hasChain = Array.isArray(task.chainSteps) && task.chainSteps.length > 0;

    if (hasChain) {
      // Execute multi-agent task chain sequentially
      const totalSteps = task.chainSteps!.length;
      let cumulativeContext = '';

      for (let i = 0; i < totalSteps; i++) {
        // Inter-step abort check: stop immediately if routine was deleted or cancelled mid-pipeline
        if (isRoutineDeleted(task.id) || activeCancelledTaskIds.has(task.id)) {
          status = 'guardrail_halt';
          summary = `[ROUTINE ABORTED] Routine was deleted or cancelled at step ${i + 1}/${totalSteps}. Pipeline terminated.`;
          break;
        }

        const step = task.chainSteps![i];
        onStepProgress?.(i + 1, totalSteps, step.agentName);

        // Build chained directive prompt with context passed from previous operatives
        let resolvedPrompt = step.prompt.trim();
        if (cumulativeContext) {
          if (resolvedPrompt.includes('{previous_output}')) {
            resolvedPrompt = resolvedPrompt.replace(/\{previous_output\}/g, cumulativeContext);
          } else {
            resolvedPrompt = `[NIGHT SHIFT CHAIN STEP ${i + 1}/${totalSteps}]\n${resolvedPrompt}\n\n[PREVIOUS OPERATIVE INTEL & FINDINGS]\n${cumulativeContext}`;
          }
        } else {
          resolvedPrompt = `[NIGHT SHIFT CHAIN STEP 1/${totalSteps}] ${resolvedPrompt}`;
        }

        const stepModelCfg = getAgentModelConfig(step.agentId || step.agentName);
        const stepCard = await executeAgentDirective({
          prompt: resolvedPrompt,
          themeId,
          activeAgentName: step.agentName,
          activeAgentRole: step.agentRole || 'Autonomous Chain Operative',
          enabledPlugins,
          temperature: 0.65,
          agentProvider: stepModelCfg.provider,
          agentModel: stepModelCfg.model,
        });

        tokenUsage += stepCard.tokenEstimate || 300;
        actionCount += stepCard.toolCalls?.length || 1;
        cumulativeContext = stepCard.dialogue;
        cardResult = stepCard;

        chainStepResults.push({
          stepNumber: i + 1,
          agentName: step.agentName,
          prompt: step.prompt,
          summary: stepCard.dialogue,
          status: 'completed',
          tokenEstimate: stepCard.tokenEstimate,
        });

        // Early guardrail halt if individual step breaches total limit
        if (tokenUsage > task.maxTokensPerRun && task.safetyHaltOnAnomaly) {
          status = 'guardrail_halt';
          summary = `GUARDRAIL HALT at Step ${i + 1}/${totalSteps} (${step.agentName}): Exceeded token leash (${tokenUsage}/${task.maxTokensPerRun}). Workflow paused.`;
          break;
        }
      }

      if (status !== 'guardrail_halt') {
        summary = `[CHAIN COMPLETE · ${totalSteps} STEPS]\n` +
          chainStepResults
            .map((s) => `Step ${s.stepNumber} [${s.agentName}]: ${s.summary.slice(0, 200)}...`)
            .join('\n\n');
      }
    } else {
      if (isRoutineDeleted(task.id) || activeCancelledTaskIds.has(task.id)) {
        status = 'guardrail_halt';
        summary = `[ROUTINE ABORTED] Routine was deleted or cancelled. Execution skipped.`;
      } else {
        // Single operative execution
        onStepProgress?.(1, 1, task.agentName);

        const singleModelCfg = getAgentModelConfig(task.agentId || task.agentName);
        const card = await executeAgentDirective({
          prompt: `[NIGHT SHIFT ROUTINE] ${task.prompt}`,
          themeId,
          activeAgentName: task.agentName,
          activeAgentRole: 'Autonomous Night Shift Operative',
          enabledPlugins,
          temperature: 0.65,
          agentProvider: singleModelCfg.provider,
          agentModel: singleModelCfg.model,
        });

        tokenUsage = card.tokenEstimate || 350;
        actionCount = card.toolCalls?.length || 1;
        cardResult = card;

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
      }
    }
  } catch (err: any) {
    status = 'error';
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
    chainStepResults: chainStepResults.length > 0 ? chainStepResults : undefined,
  };

  // Dispatch multi-channel notifications only if routine wasn't deleted/cancelled
  if (!isRoutineDeleted(task.id) && !activeCancelledTaskIds.has(task.id)) {
    try {
      const channels = await dispatchNightShiftAlerts(task, notif);
      notif.dispatchedChannels = channels;
    } catch (e) {
      console.warn('[NightShift] Notification dispatch error:', e);
    }
  } else {
    console.log(`[NightShift] Routine ${task.id} was deleted; suppressing alert dispatch.`);
  }

  return notif;
}

/**
 * Background Scheduler Worker: checks for due routines, executes them,
 * updates schedules, logs notifications, and dispatches multi-channel alerts.
 * Uses atomic live checks to prevent resurrecting deleted or cancelled routines.
 */
let isCheckingPendingTasks = false;

export async function runPendingNightShiftTasks(
  themeId: ThemeId,
  enabledPlugins: string[]
): Promise<NightShiftNotification[]> {
  if (isCheckingPendingTasks) return [];
  isCheckingPendingTasks = true;

  const finishedNotifications: NightShiftNotification[] = [];

  try {
    // Evaluate any due deterministic SHA-256 Tripwire Watchlists silently (zero-noise unless verified delta occurs)
    try {
      const { runDueTripwireChecks } = await import('./TripwireDiffService');
      await runDueTripwireChecks();
    } catch (tripErr) {
      console.warn('[NightShift] Deterministic tripwire check warning:', tripErr);
    }

    // Run non-blocking parallel specialist corroboration tracks (Nyx: WIDE_AREA/WRITTEN_WIRE, Cipher: SIGNALS_INFRA/CYBER_CVE -> Vance)
    try {
      const { runParallelSpecialistTracks, refreshAllClusterStaleness } = await import(
        './CorroborationEngine'
      );
      await runParallelSpecialistTracks();
      await refreshAllClusterStaleness();
    } catch (corrobErr) {
      console.warn('[NightShift] Parallel specialist corroboration track warning:', corrobErr);
    }

    const schedules = loadNightShiftSchedules();
    const dueTasks = schedules.filter(
      (s) => s.enabled && !isRoutineDeleted(s.id) && !activeCancelledTaskIds.has(s.id) && isTaskDue(s)
    );

    if (dueTasks.length === 0) {
      return [];
    }

    for (const task of dueTasks) {
      // 1. Verify task has not been deleted or disabled since dueTasks was filtered
      if (isRoutineDeleted(task.id) || activeCancelledTaskIds.has(task.id)) {
        continue;
      }
      const liveCheck = loadNightShiftSchedules().find((s) => s.id === task.id);
      if (!liveCheck || !liveCheck.enabled) {
        continue;
      }

      // 2. Atomically mark live task as running in storage
      const runningList = loadNightShiftSchedules();
      const runIdx = runningList.findIndex((s) => s.id === task.id);
      if (runIdx !== -1) {
        runningList[runIdx] = {
          ...runningList[runIdx],
          lastStatus: 'running',
        };
        saveNightShiftSchedules(runningList);
      }

      // 3. Execute routine or task chain
      const notif = await executeNightShiftTask(task, themeId, enabledPlugins);

      // 4. Re-check: Was this task deleted while it was executing?
      if (isRoutineDeleted(task.id) || activeCancelledTaskIds.has(task.id)) {
        console.log(`[NightShift] Task ${task.id} was deleted during execution; omitting schedule persistence.`);
        continue;
      }

      finishedNotifications.push(notif);

      // 5. Update schedule record with completion state using fresh list
      const freshList = loadNightShiftSchedules();
      const freshIdx = freshList.findIndex((s) => s.id === task.id);
      if (freshIdx !== -1) {
        freshList[freshIdx] = {
          ...freshList[freshIdx],
          lastRunTime: new Date().toISOString(),
          runCount: (freshList[freshIdx].runCount || 0) + 1,
          lastStatus: notif.status === 'completed' ? 'completed' : 'guardrail_halt',
          lastRunSummary: notif.summary.slice(0, 160),
          updatedAt: new Date().toISOString(),
        };
        saveNightShiftSchedules(freshList);
      }

      const currentNotifs = loadNightShiftNotifications();
      saveNightShiftNotifications([notif, ...currentNotifs]);
    }

    if (finishedNotifications.length > 0 && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('nightshift:routine-completed', {
          detail: { count: finishedNotifications.length, notifications: finishedNotifications },
        })
      );
    }
  } catch (err) {
    console.error('[NightShift] Scheduled background runner error:', err);
  } finally {
    isCheckingPendingTasks = false;
  }

  return finishedNotifications;
}
