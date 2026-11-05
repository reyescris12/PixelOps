/**
 * src/services/StrategyBoardService.ts
 * Unified Strategy Board Task Queue & Multi-Agent Handoff Service
 * 
 * Manages tactical task state across the Safehouse War Room,
 * enabling autonomous agent handoffs, priority queues, and execution tracking.
 */

export interface StrategyBoardTask {
  id: string;
  title: string;
  source: 'gmail' | 'github' | 'calendar' | 'user' | 'recon';
  sourceDetail?: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
  assignedAgent: string;
  createdAt: string;
}

export const STORAGE_STRATEGY_TASKS_KEY = 'pixelops_strategy_tasks_v1';

export function loadStrategyBoardTasks(): StrategyBoardTask[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_STRATEGY_TASKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStrategyBoardTasks(tasks: StrategyBoardTask[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_STRATEGY_TASKS_KEY, JSON.stringify(tasks));
  } catch {}
}

export function addStrategyBoardTasks(newTasks: StrategyBoardTask[]): void {
  const current = loadStrategyBoardTasks();
  const merged = [...newTasks, ...current].slice(0, 50);
  saveStrategyBoardTasks(merged);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('strategy:tasks-updated', { detail: { tasks: merged } })
    );
  }
}

export function updateStrategyBoardTaskStatus(
  taskId: string,
  status: 'pending' | 'in_progress' | 'completed'
): void {
  const current = loadStrategyBoardTasks();
  const updated = current.map((t) => (t.id === taskId ? { ...t, status } : t));
  saveStrategyBoardTasks(updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('strategy:tasks-updated', { detail: { tasks: updated } })
    );
  }
}
