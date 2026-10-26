import React, { useState } from 'react';
import {
  X,
  Moon,
  Clock,
  ShieldAlert,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Play,
  Plus,
  Trash2,
  Sliders,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  NightShiftTaskSchedule,
  NightShiftNotification,
  loadNightShiftSchedules,
  saveNightShiftSchedules,
  loadNightShiftNotifications,
  saveNightShiftNotifications,
  executeNightShiftTask,
} from '../services/NightShiftService';

interface NightShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  enabledPlugins: string[];
}

export const NightShiftModal: React.FC<NightShiftModalProps> = ({
  isOpen,
  onClose,
  enabledPlugins,
}) => {
  const { theme, playBeep } = useTheme();
  const [activeTab, setActiveTab] = useState<'schedules' | 'inbox'>('inbox');
  const [schedules, setSchedules] = useState<NightShiftTaskSchedule[]>(loadNightShiftSchedules);
  const [notifications, setNotifications] = useState<NightShiftNotification[]>(
    loadNightShiftNotifications
  );
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [isAddingTask, setIsAddingTask] = useState(false);

  // New task form state
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newAgentId, setNewAgentId] = useState('nyx');
  const [newAgentName, setNewAgentName] = useState('Agent Nyx');
  const [newFrequency, setNewFrequency] = useState<'every_5m' | 'every_1h' | 'every_6h' | 'daily'>('every_1h');
  const [newMaxTokens, setNewMaxTokens] = useState(1500);
  const [newMaxActions, setNewMaxActions] = useState(3);

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleToggleSchedule = (id: string) => {
    playBeep('tap');
    const updated = schedules.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    setSchedules(updated);
    saveNightShiftSchedules(updated);
  };

  const handleDeleteSchedule = (id: string) => {
    playBeep('error');
    const updated = schedules.filter((s) => s.id !== id);
    setSchedules(updated);
    saveNightShiftSchedules(updated);
  };

  const handleRunNow = async (task: NightShiftTaskSchedule) => {
    setRunningTaskId(task.id);
    playBeep('tap');
    try {
      const notif = await executeNightShiftTask(task, theme.id, enabledPlugins);
      const nextNotifs = [notif, ...notifications];
      setNotifications(nextNotifs);
      saveNightShiftNotifications(nextNotifs);

      const nextSchedules = schedules.map((s) =>
        s.id === task.id
          ? {
              ...s,
              lastRunTime: new Date().toISOString(),
              runCount: s.runCount + 1,
            }
          : s
      );
      setSchedules(nextSchedules);
      saveNightShiftSchedules(nextSchedules);
      playBeep('complete');
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newPrompt.trim()) return;
    playBeep('complete');

    const newTask: NightShiftTaskSchedule = {
      id: `ns-${Date.now()}`,
      title: newTitle.trim(),
      agentId: newAgentId,
      agentName: newAgentName,
      prompt: newPrompt.trim(),
      frequency: newFrequency,
      enabled: true,
      maxTokensPerRun: newMaxTokens,
      maxActionsPerRun: newMaxActions,
      safetyHaltOnAnomaly: true,
      runCount: 0,
      createdAt: new Date().toISOString(),
    };

    const updated = [newTask, ...schedules];
    setSchedules(updated);
    saveNightShiftSchedules(updated);
    setIsAddingTask(false);
    setNewTitle('');
    setNewPrompt('');
  };

  const handleMarkAllRead = () => {
    playBeep('tap');
    const updated = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(updated);
    saveNightShiftNotifications(updated);
  };

  const handleClearNotifications = () => {
    playBeep('error');
    setNotifications([]);
    saveNightShiftNotifications([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-[#11141c] border border-slate-800 p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Moon className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Night Shift & Background Scheduler
              </h2>
              <p className="text-xs text-slate-400">
                Autonomous agent routines, guardrail leashes, and notification tray
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              setActiveTab('inbox');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'inbox'
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Notification Tray</span>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-600 text-[10px] font-mono-tabular text-white">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              setActiveTab('schedules');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'schedules'
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Schedule Manager ({schedules.length})</span>
          </button>
        </div>

        {/* Tab 1: Notification Inbox Tray */}
        {activeTab === 'inbox' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Completed background routines and guardrail alerts
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-300 border border-slate-800 cursor-pointer"
                >
                  Mark All Read
                </button>
                <button
                  type="button"
                  onClick={handleClearNotifications}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-red-400 border border-slate-800 cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 bg-[#0a0a0c] rounded-xl border border-slate-800/80">
                  Notification tray is currently empty. Night Shift routines will report here upon completion.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-xl border flex flex-col gap-2 ${
                      n.read
                        ? 'bg-[#0a0a0c]/70 border-slate-800/80 text-slate-400'
                        : 'bg-[#12151f] border-indigo-500/40 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {n.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-100">{n.taskTitle}</span>
                      </div>
                      <span className="font-mono-tabular text-[10px] text-slate-500">
                        {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed pl-6">
                      {n.summary}
                    </p>

                    <div className="flex items-center justify-between text-[10px] font-mono-tabular pl-6 pt-1 text-slate-400">
                      <span>Operative: {n.agentName}</span>
                      <div className="flex items-center gap-3">
                        <span>Tokens: ~{n.tokenUsage}</span>
                        <span>Actions: {n.actionCount}</span>
                        <span className={n.status === 'completed' ? 'text-emerald-400' : 'text-amber-400'}>
                          [{n.status.toUpperCase()}]
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Schedule Manager & Guardrails */}
        {activeTab === 'schedules' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Configure automated cron routines and per-run token leashes
              </span>
              <button
                type="button"
                onClick={() => {
                  playBeep('tap');
                  setIsAddingTask(!isAddingTask);
                }}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  theme.accentBgClass
                } text-slate-950`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Routine</span>
              </button>
            </div>

            {/* Add Task Form */}
            {isAddingTask && (
              <form
                onSubmit={handleCreateTask}
                className="p-3.5 rounded-xl bg-[#0a0a0c] border border-slate-800 flex flex-col gap-3"
              >
                <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Create Night Shift Cron Routine</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Routine Title (e.g. Daily Health Check)"
                    className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    required
                  />

                  <select
                    value={newFrequency}
                    onChange={(e: any) => setNewFrequency(e.target.value)}
                    className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="every_5m">Every 5 Minutes (Cron */5)</option>
                    <option value="every_1h">Every 1 Hour (Cron 0 *)</option>
                    <option value="every_6h">Every 6 Hours (Cron 0 */6)</option>
                    <option value="daily">Daily Midnight (Cron 0 0)</option>
                  </select>
                </div>

                <textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="Directive prompt for the autonomous background agent..."
                  rows={2}
                  className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 resize-none"
                  required
                />

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[10px]">Max Token Leash ({newMaxTokens})</label>
                    <input
                      type="number"
                      value={newMaxTokens}
                      onChange={(e) => setNewMaxTokens(Number(e.target.value))}
                      className="bg-[#12151f] border border-slate-800 rounded px-2 py-1 font-mono-tabular text-slate-100"
                      min={200}
                      max={5000}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-slate-400 text-[10px]">Max Actions Leash ({newMaxActions})</label>
                    <input
                      type="number"
                      value={newMaxActions}
                      onChange={(e) => setNewMaxActions(Number(e.target.value))}
                      className="bg-[#12151f] border border-slate-800 rounded px-2 py-1 font-mono-tabular text-slate-100"
                      min={1}
                      max={10}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddingTask(false)}
                    className="px-3 py-1.5 rounded bg-slate-800 text-xs text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded bg-indigo-600 text-xs font-semibold text-white cursor-pointer hover:bg-indigo-500"
                  >
                    Save Routine
                  </button>
                </div>
              </form>
            )}

            {/* Schedule List */}
            <div className="flex flex-col gap-2.5 max-h-[50vh] overflow-y-auto">
              {schedules.map((task) => (
                <div
                  key={task.id}
                  className="p-3.5 rounded-xl bg-[#0a0a0c] border border-slate-800 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-100">{task.title}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 font-mono-tabular text-[10px] text-indigo-300">
                        {task.frequency.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRunNow(task)}
                        disabled={runningTaskId === task.id}
                        className="px-2.5 py-1 rounded bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/60 text-[11px] text-indigo-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Play className={`w-3 h-3 ${runningTaskId === task.id ? 'animate-spin' : ''}`} />
                        <span>{runningTaskId === task.id ? 'Running...' : 'Run Now'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleSchedule(task.id)}
                        className={`px-2 py-1 rounded text-[11px] font-mono-tabular border cursor-pointer ${
                          task.enabled
                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700'
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                        }`}
                      >
                        {task.enabled ? 'ACTIVE' : 'PAUSED'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteSchedule(task.id)}
                        className="p-1 rounded text-slate-500 hover:text-red-400 cursor-pointer"
                        title="Delete schedule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-1">{task.prompt}</p>

                  <div className="flex items-center justify-between text-[10px] font-mono-tabular text-slate-500 pt-1">
                    <span>Assigned Operative: {task.agentName}</span>
                    <div className="flex items-center gap-3">
                      <span>Runs: {task.runCount}</span>
                      <span>Token Leash: {task.maxTokensPerRun}</span>
                      <span>Action Leash: {task.maxActionsPerRun}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className={`w-full min-h-[40px] rounded-xl text-xs font-semibold text-slate-950 ${theme.accentBgClass} hover:opacity-95 transition-opacity cursor-pointer`}
        >
          Close Night Shift
        </button>
      </div>
    </div>
  );
};
