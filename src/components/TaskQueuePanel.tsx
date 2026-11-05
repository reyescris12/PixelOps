/**
 * src/components/TaskQueuePanel.tsx
 * 
 * Interactive Real-Time Task Queue & Mission Dispatch HUD
 * Allows commanders to inspect active tasks currently in flight, manage queued directives,
 * dispatch tasks to specific operatives, and archive completed tasks directly into
 * the Command Ledger and Execution Cards.
 */

import React, { useState, useEffect } from 'react';
import {
  Clock,
  Play,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  Zap,
  Check,
  RotateCcw,
  Plus,
  Terminal,
  FileText,
  User,
} from 'lucide-react';
import {
  StrategyBoardTask,
  loadStrategyBoardTasks,
  saveStrategyBoardTasks,
  updateStrategyBoardTaskStatus,
} from '../services/StrategyBoardService';
import { useCrew } from '../context/CrewContext';
import { useTheme } from '../context/ThemeContext';
import { RoomId } from '../engine/roomData';

export interface ActivePendingDirective {
  isPending: boolean;
  prompt: string;
  assignedAgentId?: string;
  assignedRoom?: RoomId;
  taskTag?: string;
  startedAt?: string;
}

interface TaskQueuePanelProps {
  activePendingTask: ActivePendingDirective | null;
  isExecuting: boolean;
  onExecuteDirective: (
    prompt: string,
    attachment?: any,
    skipAmbiguityCheck?: boolean,
    explicitAgentId?: string,
    explicitTargetRoom?: RoomId
  ) => void;
  onCompleteTask: (task: StrategyBoardTask) => void;
  onViewCommandLog: () => void;
  onViewCards: () => void;
}

export const TaskQueuePanel: React.FC<TaskQueuePanelProps> = ({
  activePendingTask,
  isExecuting,
  onExecuteDirective,
  onCompleteTask,
  onViewCommandLog,
  onViewCards,
}) => {
  const { crewAgents } = useCrew();
  const { playBeep } = useTheme();

  const [tasks, setTasks] = useState<StrategyBoardTask[]>(() => loadStrategyBoardTasks());
  const [filterPriority, setFilterPriority] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [newDirective, setNewDirective] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState(crewAgents[0]?.id || 'vance');
  const [selectedPriority, setSelectedPriority] = useState<'high' | 'medium' | 'low'>('high');

  // Reactively sync tasks when updated anywhere in the system
  useEffect(() => {
    const handleSync = () => {
      setTasks(loadStrategyBoardTasks());
    };
    window.addEventListener('strategy:tasks-updated', handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener('strategy:tasks-updated', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  const filteredPending = pendingTasks.filter((t) => {
    if (filterPriority === 'all') return true;
    return t.priority === filterPriority;
  });

  const handleQueueNewTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDirective.trim()) return;

    const matchedCrew = crewAgents.find((a) => a.id === selectedAgentId) || crewAgents[0];
    const newTask: StrategyBoardTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: newDirective.trim(),
      source: 'user',
      sourceDetail: 'Commander Direct Queue',
      priority: selectedPriority,
      status: 'pending',
      assignedAgent: matchedCrew.customName || matchedCrew.id,
      createdAt: new Date().toISOString(),
    };

    const next = [newTask, ...tasks];
    setTasks(next);
    saveStrategyBoardTasks(next);
    setNewDirective('');
    playBeep('tap');
  };

  const handleRunTask = (task: StrategyBoardTask) => {
    playBeep('tap');
    updateStrategyBoardTaskStatus(task.id, 'in_progress');

    const cleanAgent = (task.assignedAgent || '').toLowerCase();
    const matched = crewAgents.find(
      (a) =>
        a.id.toLowerCase().includes(cleanAgent) ||
        (a.customName || '').toLowerCase().includes(cleanAgent) ||
        (a.defaultName || '').toLowerCase().includes(cleanAgent)
    ) || crewAgents[0];

    onExecuteDirective(
      task.title,
      null,
      true,
      matched.id,
      (matched.currentRoom as RoomId) || 'war_room'
    );
  };

  const handleMarkComplete = (task: StrategyBoardTask) => {
    playBeep('complete');
    onCompleteTask(task);
  };

  const handleDeleteTask = (taskId: string) => {
    playBeep('tap');
    const next = tasks.filter((t) => t.id !== taskId);
    setTasks(next);
    saveStrategyBoardTasks(next);
  };

  const handleClearCompleted = () => {
    playBeep('tap');
    const next = tasks.filter((t) => t.status !== 'completed');
    setTasks(next);
    saveStrategyBoardTasks(next);
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-0 font-mono-tabular flex flex-col gap-3">
      {/* 1. ACTIVE TASK IN-FLIGHT SECTION */}
      <div className="bg-[#0b0f16] border border-[#38bdf8]/60 p-3 shadow-[0_0_20px_rgba(56,189,248,0.15)] flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-[#1b2b3d] pb-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8] animate-ping" />
            <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">
              ACTIVE TASK IN-FLIGHT
            </span>
          </div>
          <span className="text-[10px] text-[#94a3b8]">
            {isExecuting ? '[PROCESSING LIVE]' : '[IDLE · STANDBY]'}
          </span>
        </div>

        {isExecuting && activePendingTask ? (
          <div className="p-2.5 bg-[#0f1724] border border-[#38bdf8]/40 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#38bdf8] font-bold flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 animate-pulse text-[#e59838]" />
                <span>
                  Operative: {activePendingTask.assignedAgentId?.toUpperCase() || 'AGENT'}
                </span>
                <span className="text-[9px] px-1 bg-[#1e293b] text-[#cbd5e1] border border-[#334155]">
                  @{activePendingTask.assignedRoom || 'SAFEHOUSE'}
                </span>
              </span>
              <span className="text-[10px] text-[#94a3b8] flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>
                  Started: {new Date(activePendingTask.startedAt || Date.now()).toLocaleTimeString()}
                </span>
              </span>
            </div>
            <div className="text-xs text-[#f3ead8] font-semibold pl-2 border-l-2 border-[#e59838]">
              &ldquo;{activePendingTask.prompt}&rdquo;
            </div>
          </div>
        ) : (
          <div className="py-2.5 px-3 text-center text-xs text-[#64748b] bg-[#070b10] border border-[#162130]">
            No autonomous task currently in flight. Operatives are ready for tactical assignment.
          </div>
        )}
      </div>

      {/* 2. TASK QUEUE & PENDING DIRECTIVES */}
      <div className="bg-[#0e1117] border border-[#5e4326] p-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2d2215] pb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">📋</span>
            <span className="text-xs font-bold text-[#e59838] uppercase tracking-wider">
              PENDING TASK QUEUE ({pendingTasks.length})
            </span>
          </div>

          {/* Priority Filter Strip */}
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-[#8c7a65]">Filter:</span>
            {(['all', 'high', 'medium', 'low'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFilterPriority(p)}
                className={`px-1.5 py-0.5 border cursor-pointer uppercase ${
                  filterPriority === p
                    ? 'bg-[#e59838] text-[#121110] font-bold border-[#e59838]'
                    : 'bg-[#16130e] text-[#9c8265] border-[#382b1b] hover:text-[#f3ead8]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Queue Items List */}
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
          {filteredPending.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#8c7a65]">
              Queue clear. No pending tasks matching criteria.
            </div>
          ) : (
            filteredPending.map((task) => {
              const isHigh = task.priority === 'high';
              const isMed = task.priority === 'medium';
              return (
                <div
                  key={task.id}
                  className={`p-2 border flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-colors ${
                    isHigh
                      ? 'bg-[#1b120f] border-[#ef4444]/50'
                      : isMed
                      ? 'bg-[#18140e] border-[#e59838]/40'
                      : 'bg-[#0f141c] border-[#253245]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[8px] font-bold px-1 py-0.2 border uppercase ${
                          isHigh
                            ? 'bg-[#3b1219] text-[#f87171] border-[#ef4444]'
                            : isMed
                            ? 'bg-[#2b1f11] text-[#fbbf24] border-[#f59e0b]'
                            : 'bg-[#121c26] text-[#38bdf8] border-[#0284c7]'
                        }`}
                      >
                        {task.priority}
                      </span>
                      <span className="text-[9px] px-1 bg-[#12161f] text-[#94a3b8] border border-[#232d3d] uppercase">
                        {task.source}
                      </span>
                      <span className="text-[10px] text-[#38bdf8] font-bold">
                        {task.assignedAgent}
                      </span>
                    </div>
                    <div className="text-xs text-[#f3ead8] font-medium mt-1 truncate">
                      {task.title}
                    </div>
                    {task.sourceDetail && (
                      <div className="text-[10px] text-[#8c7a65] truncate">
                        {task.sourceDetail}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleRunTask(task)}
                      disabled={isExecuting}
                      className="px-2 py-1 bg-[#e59838] hover:bg-[#f5a642] text-[#121110] font-bold text-[10px] border border-[#e59838] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Dispatch this task immediately to the assigned operative"
                    >
                      <Play className="w-2.5 h-2.5" />
                      <span>[▶ RUN]</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMarkComplete(task)}
                      className="px-2 py-1 bg-[#122417] hover:bg-[#1a3823] text-[#4ade80] font-bold text-[10px] border border-[#22c55e]/60 flex items-center gap-1 cursor-pointer"
                      title="Mark task completed and log to Command Log & Cards"
                    >
                      <Check className="w-2.5 h-2.5" />
                      <span>[✓ DONE]</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1 text-[#64748b] hover:text-[#f87171] hover:bg-[#201518] cursor-pointer transition-colors"
                      title="Dismiss task from queue"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Quick Add Directive to Queue */}
        <form onSubmit={handleQueueNewTask} className="pt-2 border-t border-[#2d2215] flex flex-col gap-2">
          <div className="text-[10px] text-[#9c8265] uppercase font-bold flex items-center gap-1">
            <Plus className="w-3 h-3" />
            <span>Enqueue Tactical Directive:</span>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
            <input
              type="text"
              value={newDirective}
              onChange={(e) => setNewDirective(e.target.value)}
              placeholder="e.g. Audit Stripe interchange pricing updates, or sweep GitHub open CVEs"
              className="flex-1 px-2.5 py-1.5 bg-[#07090d] border border-[#382b1b] text-xs text-[#f3ead8] outline-none focus:border-[#e59838]"
            />
            <div className="flex items-center gap-1.5">
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="px-2 py-1.5 bg-[#0e131d] border border-[#253245] text-[10px] text-[#38bdf8] outline-none"
              >
                {crewAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.customName || a.id}
                  </option>
                ))}
              </select>
              <select
                value={selectedPriority}
                onChange={(e) => setSelectedPriority(e.target.value as any)}
                className="px-2 py-1.5 bg-[#0e131d] border border-[#253245] text-[10px] text-[#fbbf24] outline-none"
              >
                <option value="high">HIGH PRIORITY</option>
                <option value="medium">MEDIUM</option>
                <option value="low">LOW</option>
              </select>
              <button
                type="submit"
                disabled={!newDirective.trim()}
                className="px-3 py-1.5 bg-[#1b2738] hover:bg-[#26374f] text-[#38bdf8] font-bold text-[10px] border border-[#38bdf8]/50 cursor-pointer disabled:opacity-40 whitespace-nowrap"
              >
                [+ ENQUEUE]
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* 3. COMPLETED ARCHIVE & LOGGED DIRECTIVES */}
      {completedTasks.length > 0 && (
        <div className="p-3 bg-[#0a0d13] border border-[#1b283a] flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#4ade80] font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#4ade80]" />
              <span>COMPLETED TASKS ({completedTasks.length}) · LOGGED TO CARDS & COMMAND LOG</span>
            </span>
            <button
              type="button"
              onClick={handleClearCompleted}
              className="text-[10px] text-[#64748b] hover:text-[#94a3b8] cursor-pointer"
            >
              [Clear Archive]
            </button>
          </div>

          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
            {completedTasks.slice(0, 5).map((t) => (
              <div
                key={t.id}
                className="p-1.5 bg-[#0c1219] border border-[#1e2a3b] flex items-center justify-between text-[11px]"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-[#4ade80] text-[10px]">✓</span>
                  <span className="text-[#cbd5e1] truncate">{t.title}</span>
                  <span className="text-[9px] text-[#64748b]">({t.assignedAgent})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[9px] text-[#64748b]">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#16202e]">
            <button
              type="button"
              onClick={onViewCards}
              className="px-2 py-0.5 bg-[#141b27] hover:bg-[#1e293b] text-[#38bdf8] text-[10px] font-bold border border-[#38bdf8]/40 cursor-pointer"
            >
              [📟 View Briefing Cards]
            </button>
            <button
              type="button"
              onClick={onViewCommandLog}
              className="px-2 py-0.5 bg-[#1f160e] hover:bg-[#2d2014] text-[#e59838] text-[10px] font-bold border border-[#e59838]/40 cursor-pointer"
            >
              [📜 View Command Log]
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
