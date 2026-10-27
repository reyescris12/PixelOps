/**
 * Background Worker Engine (WorkerService.ts)
 * Manages persistent background agent event loops, task queues, and state synchronization
 * via BroadcastChannel / Web Workers independently of the main UI thread.
 */

import { auditStorageHealth } from './SafetyService';

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
  private listeners: Array<(tasks: BackgroundQueueTask[]) => void> = [];

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.channel.onmessage = (event) => {
        if (event.data && event.data.type === 'STATE_SYNC_UPDATE') {
          this.notifyListeners(this.getQueue());
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

    // Periodic Storage Health Audit & Auto-Pruning
    if (typeof window !== 'undefined') {
      try {
        auditStorageHealth().catch(() => {});
        setInterval(() => {
          auditStorageHealth().catch(() => {});
        }, 5 * 60 * 1000);
      } catch {}
    }
  }

  public stopBackgroundLoop() {
    this.isRunning = false;
  }
}

export const backgroundWorkerEngine = new BackgroundWorkerEngine();
