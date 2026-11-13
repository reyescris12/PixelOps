/**
 * Background Worker Engine (WorkerService.ts)
 * Manages persistent background agent event loops, task queues, and state synchronization
 * via BroadcastChannel / Web Workers independently of the main UI thread.
 */

import { auditStorageHealth, executeCodeSandboxEval } from './SafetyService';

export { executeCodeSandboxEval };

export interface BackgroundQueueTask {
  id: string;
  prompt: string;
  agentId: string;
  agentName: string;
  timestamp: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  resultSummary?: string;
}

const BROADCAST_CHANNEL_NAME = 'pixelops_background_sync_v1';
const STORAGE_QUEUE_KEY = 'pixelops_background_queue_v1';

class BackgroundWorkerEngine {
  private channel: BroadcastChannel | null = null;
  private isRunning = false;
  private specialistIntervalId: ReturnType<typeof setInterval> | null = null;
  private unsubscribeCorroboration: (() => void) | null = null;
  private listeners: Array<(tasks: BackgroundQueueTask[]) => void> = [];

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.channel.onmessage = (event) => {
        if (event.data && event.data.type === 'STATE_SYNC_UPDATE') {
          this.notifyListeners(this.getQueue());
        } else if (event.data && event.data.type === 'CORROBORATION_CLUSTER_UPDATED') {
          try {
            window.dispatchEvent(
              new CustomEvent('pixelops:corroboration-updated', { detail: event.data })
            );
          } catch {}
        }
      };
    }
  }

  public subscribe(listener: (tasks: BackgroundQueueTask[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(tasks: BackgroundQueueTask[]) {
    for (const l of this.listeners) {
      l(tasks);
    }
  }

  public getQueue(): BackgroundQueueTask[] {
    try {
      const raw = localStorage.getItem(STORAGE_QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public saveQueue(tasks: BackgroundQueueTask[]) {
    try {
      localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(tasks));
      if (this.channel) {
        this.channel.postMessage({ type: 'STATE_SYNC_UPDATE', tasks });
      }
    } catch {
      // Ignore storage errors
    }
  }

  public enqueueTask(task: Omit<BackgroundQueueTask, 'id' | 'timestamp' | 'status'>): BackgroundQueueTask {
    const queue = this.getQueue();
    const newTask: BackgroundQueueTask = {
      ...task,
      id: `bg-task-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };
    const nextQueue = [newTask, ...queue];
    this.saveQueue(nextQueue);
    this.notifyListeners(nextQueue);
    return newTask;
  }

  public async triggerParallelSpecialistSweep() {
    const { runParallelSpecialistTracks } = await import('./CorroborationEngine');
    return await runParallelSpecialistTracks();
  }

  public async getSpecialistWatcherStatus() {
    const { getSpecialistWatcherStatus } = await import('./CorroborationEngine');
    return getSpecialistWatcherStatus();
  }

  public startBackgroundLoop() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Register Service Worker for offline PWA & background sync support
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          console.log('PixelOps ServiceWorker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('PixelOps ServiceWorker registration failed:', err);
        });
    }

    // Periodic Storage Health Audit & Non-Blocking Parallel Specialist Corroboration Sweep
    if (typeof window !== 'undefined') {
      try {
        auditStorageHealth().catch(() => {});
        setInterval(() => {
          auditStorageHealth().catch(() => {});
        }, 5 * 60 * 1000);

        import('./CorroborationEngine')
          .then(({ subscribeToClusterPromotions, runParallelSpecialistTracks }) => {
            if (!this.unsubscribeCorroboration) {
              this.unsubscribeCorroboration = subscribeToClusterPromotions((cluster) => {
                if (this.channel) {
                  try {
                    this.channel.postMessage({
                      type: 'CORROBORATION_CLUSTER_UPDATED',
                      clusterId: cluster.clusterId,
                      status: cluster.status,
                      score: cluster.corroborationScore,
                    });
                  } catch {}
                }
              });
            }
            setTimeout(() => {
              runParallelSpecialistTracks().catch(() => {});
            }, 3500);

            const armSpecialistInterval = async () => {
              if (this.specialistIntervalId) {
                clearInterval(this.specialistIntervalId);
                this.specialistIntervalId = null;
              }
              let intervalMs = 3 * 60 * 1000;
              let highAlert = false;
              try {
                const { getEffectiveRapidPollIntervalMs, isHighAlertModeEnabled } = await import(
                  './NightShiftService'
                );
                intervalMs = getEffectiveRapidPollIntervalMs();
                highAlert = isHighAlertModeEnabled();
              } catch {}

              this.specialistIntervalId = setInterval(async () => {
                runParallelSpecialistTracks().catch(() => {});
                if (highAlert) {
                  try {
                    const { fetchLocalDispatchFeeds } = await import('./ClassifiedFeedService');
                    await fetchLocalDispatchFeeds({ logToLedger: true });
                  } catch {}
                }
              }, intervalMs);
            };

            armSpecialistInterval().catch(() => {});
            window.addEventListener('pixelops:high-alert-changed', () => {
              armSpecialistInterval().catch(() => {});
            });
          })
          .catch(() => {});
      } catch {}
    }
  }

  public stopBackgroundLoop() {
    this.isRunning = false;
    if (this.specialistIntervalId) {
      clearInterval(this.specialistIntervalId);
      this.specialistIntervalId = null;
    }
    if (this.unsubscribeCorroboration) {
      this.unsubscribeCorroboration();
      this.unsubscribeCorroboration = null;
    }
  }
}

/**
 * Parses raw LLM text for structured action tags:
 * [AGENT_ACTION: <tool_name>] { ...params } [/AGENT_ACTION]
 * or pseudo-XML <tool_call><function=...><parameter=...>
 */
export function parseAgentActionBlock(responseText: string): { toolName: string; toolArgs: Record<string, any> } | null {
  if (!responseText) return null;

  // 1. Standard [AGENT_ACTION: tool_name]
  const actionMatch = responseText.match(/\[AGENT_ACTION:\s*(.*?)\]([\s\S]*?)\[\/AGENT_ACTION\]/i);
  if (actionMatch) {
    const toolName = actionMatch[1].trim();
    let toolArgs: Record<string, any> = {};
    try {
      toolArgs = JSON.parse(actionMatch[2].trim());
    } catch {
      toolArgs = { input: actionMatch[2].trim() };
    }
    return { toolName, toolArgs };
  }

  // 2. Pseudo-XML <tool_call><function=...><parameter=...>
  const xmlFnMatch = responseText.match(/<function=([a-zA-Z0-9_\-]+)>([\s\S]*?)<\/function>/i);
  if (xmlFnMatch) {
    const toolName = xmlFnMatch[1].trim();
    const inner = xmlFnMatch[2];
    const toolArgs: Record<string, any> = {};

    const paramRegex = /<parameter=([a-zA-Z0-9_\-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/gi;
    let pMatch: RegExpExecArray | null;
    let found = false;
    while ((pMatch = paramRegex.exec(inner)) !== null) {
      found = true;
      const pName = pMatch[1].trim();
      const pVal = pMatch[2].trim();
      try {
        toolArgs[pName] = JSON.parse(pVal);
      } catch {
        toolArgs[pName] = pVal;
      }
    }
    if (!found && inner.trim()) {
      try {
        const parsed = JSON.parse(inner.trim());
        if (typeof parsed === 'object' && parsed !== null) {
          Object.assign(toolArgs, parsed);
        } else {
          toolArgs.query = inner.trim();
        }
      } catch {
        toolArgs.query = inner.trim();
      }
    }
    return { toolName, toolArgs };
  }

  return null;
}

/**
 * Invokes a local tool service via static action routing or registered handler dispatch
 */
export async function executeAgentTool(toolName: string, toolArgs: Record<string, any>) {
  if (toolName === 'code_sandbox_eval' || toolName === 'code_sandbox') {
    return await executeCodeSandboxEval(toolArgs);
  }
  if (typeof window !== 'undefined' && (window as any).__executeToolHandler) {
    return await (window as any).__executeToolHandler(toolName, toolArgs);
  }
  return { status: 'executed', toolName, toolArgs };
}

export const backgroundWorkerEngine = new BackgroundWorkerEngine();
