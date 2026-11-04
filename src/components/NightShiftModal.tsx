import React, { useState, useEffect } from 'react';
import {
  X,
  Moon,
  Clock,
  ShieldAlert,
  Bell,
  CheckCircle2,
  Play,
  Plus,
  Trash2,
  Sliders,
  Edit3,
  Layers,
  Send,
  Smartphone,
  Mail,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  UserCheck,
  KeyRound,
  Code2,
  Check,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useCrew } from '../context/CrewContext';
import {
  NightShiftTaskSchedule,
  NightShiftNotification,
  TaskChainStep,
  RoutineNotificationConfig,
  ScheduleFrequency,
  loadNightShiftSchedules,
  saveNightShiftSchedules,
  loadNightShiftNotifications,
  saveNightShiftNotifications,
  executeNightShiftTask,
  getFrequencyLabel,
  DEFAULT_NOTIFICATION_CONFIG,
} from '../services/NightShiftService';
import {
  WebhookConfig,
  WebhookServiceType,
  loadWebhookConfig,
  saveWebhookConfig,
  formatWebhookPayload,
  testWebhookEndpoint,
} from '../services/NotificationOutboxService';
import { getLocalConnectedAccounts } from '../services/ComposioService';

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

  // Load available operatives from CrewContext (with fallback to theme agents)
  let crewAgents: Array<{ id: string; customName: string; defaultName: string; role: string; primaryColor?: string }> = [];
  try {
    const crew = useCrew();
    crewAgents = crew.crewAgents;
  } catch {
    crewAgents = theme.agents.map((a) => ({
      id: a.id,
      customName: a.name,
      defaultName: a.name,
      role: a.role,
      primaryColor: a.primaryColor,
    }));
  }

  const [activeTab, setActiveTab] = useState<'schedules' | 'briefings' | 'channels'>('schedules');
  const [schedules, setSchedules] = useState<NightShiftTaskSchedule[]>(loadNightShiftSchedules);
  const [notifications, setNotifications] = useState<NightShiftNotification[]>(
    loadNightShiftNotifications
  );
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [liveExecutionStep, setLiveExecutionStep] = useState<string | null>(null);

  // Form Mode: null = closed, 'create' = new routine, 'edit' = editing existing
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // Editor Form State
  const [formTitle, setFormTitle] = useState('');
  const [formFrequency, setFormFrequency] = useState<ScheduleFrequency>('every_1h');
  const [formMode, setFormMode] = useState<'single' | 'chained'>('single');
  const [formAgentId, setFormAgentId] = useState(crewAgents[0]?.id || 'vance');
  const [formPrompt, setFormPrompt] = useState('');
  const [formMaxTokens, setFormMaxTokens] = useState(2500);
  const [formMaxActions, setFormMaxActions] = useState(5);
  const [formSafetyHalt, setFormSafetyHalt] = useState(true);

  // Task Chain Steps State
  const [formChainSteps, setFormChainSteps] = useState<TaskChainStep[]>([]);

  // Notification Configuration State
  const [notifConfig, setNotifConfig] = useState<RoutineNotificationConfig>(DEFAULT_NOTIFICATION_CONFIG);

  // Expanded notification cards for detailed audit review
  const [expandedNotifId, setExpandedNotifId] = useState<string | null>(null);

  // Global Webhook Connector & Formatters State
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>(loadWebhookConfig);
  const [webhookTestFeedback, setWebhookTestFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [webhookSavedFeedback, setWebhookSavedFeedback] = useState(false);

  // Push Permission Status
  const [pushPermissionStatus, setPushPermissionStatus] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  });

  // Listen for background updates and webhook changes
  useEffect(() => {
    const handleSchedulesChanged = () => {
      setSchedules(loadNightShiftSchedules());
    };
    const handleNotifsChanged = () => {
      setNotifications(loadNightShiftNotifications());
    };
    const handleWebhookChanged = () => {
      setWebhookConfig(loadWebhookConfig());
    };
    window.addEventListener('nightshift:schedules-changed', handleSchedulesChanged);
    window.addEventListener('nightshift:notifications-changed', handleNotifsChanged);
    window.addEventListener('nightshift:routine-completed', handleNotifsChanged);
    window.addEventListener('webhook:config-changed', handleWebhookChanged);

    return () => {
      window.removeEventListener('nightshift:schedules-changed', handleSchedulesChanged);
      window.removeEventListener('nightshift:notifications-changed', handleNotifsChanged);
      window.removeEventListener('nightshift:routine-completed', handleNotifsChanged);
      window.removeEventListener('webhook:config-changed', handleWebhookChanged);
    };
  }, []);

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  const getOperativeName = (agentId: string) => {
    const found = crewAgents.find((a) => a.id === agentId);
    return found ? (found.customName || found.defaultName) : agentId;
  };

  const getOperativeRole = (agentId: string) => {
    const found = crewAgents.find((a) => a.id === agentId);
    return found ? found.role : 'Field Operative';
  };

  // Open Form for Creating New Routine
  const handleOpenCreateForm = () => {
    playBeep('tap');
    setEditingScheduleId(null);
    setFormTitle('');
    setFormFrequency('every_1h');
    setFormMode('single');
    const firstAgent = crewAgents[0]?.id || 'vance';
    setFormAgentId(firstAgent);
    setFormPrompt('');
    setFormMaxTokens(2500);
    setFormMaxActions(5);
    setFormSafetyHalt(true);
    setFormChainSteps([
      {
        id: `step-${Date.now()}-1`,
        stepNumber: 1,
        agentId: crewAgents[0]?.id || 'vance',
        agentName: getOperativeName(crewAgents[0]?.id || 'vance'),
        agentRole: getOperativeRole(crewAgents[0]?.id || 'vance'),
        prompt: 'Search the web for the latest zero-trust security bulletins and summarize threat vectors.',
      },
      {
        id: `step-${Date.now()}-2`,
        stepNumber: 2,
        agentId: crewAgents[1]?.id || crewAgents[0]?.id || 'nyx',
        agentName: getOperativeName(crewAgents[1]?.id || crewAgents[0]?.id || 'nyx'),
        agentRole: getOperativeRole(crewAgents[1]?.id || crewAgents[0]?.id || 'nyx'),
        prompt: 'Analyze the threat vectors from the previous step and generate a full technical audit report.',
      },
    ]);
    setNotifConfig({
      ...DEFAULT_NOTIFICATION_CONFIG,
      notifyBrowser: true,
      notifyPhone: true,
    });
    setIsEditorOpen(true);
  };

  // Open Form for Editing Existing Routine
  const handleOpenEditForm = (task: NightShiftTaskSchedule) => {
    playBeep('tap');
    setEditingScheduleId(task.id);
    setFormTitle(task.title);
    setFormFrequency(task.frequency);
    const hasChain = Array.isArray(task.chainSteps) && task.chainSteps.length > 1;
    setFormMode(hasChain ? 'chained' : 'single');
    setFormAgentId(task.agentId);
    setFormPrompt(task.prompt);
    setFormMaxTokens(task.maxTokensPerRun || 2500);
    setFormMaxActions(task.maxActionsPerRun || 5);
    setFormSafetyHalt(task.safetyHaltOnAnomaly ?? true);

    if (hasChain && task.chainSteps) {
      setFormChainSteps(task.chainSteps);
    } else {
      setFormChainSteps([
        {
          id: `step-${Date.now()}-1`,
          stepNumber: 1,
          agentId: task.agentId,
          agentName: task.agentName,
          agentRole: getOperativeRole(task.agentId),
          prompt: task.prompt,
        },
      ]);
    }

    setNotifConfig(task.notificationConfig || DEFAULT_NOTIFICATION_CONFIG);
    setIsEditorOpen(true);
  };

  // Save Routine (New or Updated)
  const handleSaveRoutine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    playBeep('complete');
    const isChained = formMode === 'chained' && formChainSteps.length > 1;
    const primaryAgentId = isChained ? formChainSteps[0].agentId : formAgentId;
    const primaryAgentName = getOperativeName(primaryAgentId);
    const primaryPrompt = isChained ? formChainSteps[0].prompt : formPrompt.trim();

    if (editingScheduleId) {
      // Update existing
      const updated = schedules.map((s) => {
        if (s.id === editingScheduleId) {
          return {
            ...s,
            title: formTitle.trim(),
            agentId: primaryAgentId,
            agentName: primaryAgentName,
            prompt: primaryPrompt,
            frequency: formFrequency,
            maxTokensPerRun: formMaxTokens,
            maxActionsPerRun: formMaxActions,
            safetyHaltOnAnomaly: formSafetyHalt,
            chainSteps: isChained ? formChainSteps : undefined,
            notificationConfig: notifConfig,
          };
        }
        return s;
      });
      setSchedules(updated);
      saveNightShiftSchedules(updated);
    } else {
      // Create new
      const newTask: NightShiftTaskSchedule = {
        id: `ns-${Date.now()}`,
        title: formTitle.trim(),
        agentId: primaryAgentId,
        agentName: primaryAgentName,
        prompt: primaryPrompt,
        frequency: formFrequency,
        enabled: true,
        maxTokensPerRun: formMaxTokens,
        maxActionsPerRun: formMaxActions,
        safetyHaltOnAnomaly: formSafetyHalt,
        runCount: 0,
        createdAt: new Date().toISOString(),
        lastStatus: 'idle',
        chainSteps: isChained ? formChainSteps : undefined,
        notificationConfig: notifConfig,
      };
      const updated = [newTask, ...schedules];
      setSchedules(updated);
      saveNightShiftSchedules(updated);
    }

    setIsEditorOpen(false);
    setEditingScheduleId(null);
  };

  // Toggle Schedule Active/Paused
  const handleToggleSchedule = (id: string) => {
    playBeep('tap');
    const updated = schedules.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    setSchedules(updated);
    saveNightShiftSchedules(updated);
  };

  // Delete Schedule
  const handleDeleteSchedule = (id: string) => {
    playBeep('error');
    const updated = schedules.filter((s) => s.id !== id);
    setSchedules(updated);
    saveNightShiftSchedules(updated);
  };

  // Run Now with Real-Time Step Progress
  const handleRunNow = async (task: NightShiftTaskSchedule) => {
    setRunningTaskId(task.id);
    setLiveExecutionStep('Initializing autonomous routine...');
    playBeep('tap');

    try {
      const notif = await executeNightShiftTask(
        task,
        theme.id,
        enabledPlugins,
        (stepNum, totalSteps, agentName) => {
          setLiveExecutionStep(`Step ${stepNum}/${totalSteps}: ${agentName} executing...`);
        }
      );

      const nextNotifs = [notif, ...notifications];
      setNotifications(nextNotifs);
      saveNightShiftNotifications(nextNotifs);

      const nextSchedules = schedules.map((s) =>
        s.id === task.id
          ? {
              ...s,
              lastRunTime: new Date().toISOString(),
              runCount: (s.runCount || 0) + 1,
              lastStatus: notif.status === 'completed' ? ('completed' as const) : ('guardrail_halt' as const),
              lastRunSummary: notif.summary.slice(0, 160),
            }
          : s
      );
      setSchedules(nextSchedules);
      saveNightShiftSchedules(nextSchedules);
      playBeep('complete');
    } finally {
      setRunningTaskId(null);
      setLiveExecutionStep(null);
    }
  };

  // Add Step to Chain
  const handleAddChainStep = () => {
    playBeep('tap');
    const nextStepNum = formChainSteps.length + 1;
    const defaultAgent = crewAgents[(nextStepNum - 1) % crewAgents.length]?.id || 'vance';
    const newStep: TaskChainStep = {
      id: `step-${Date.now()}-${nextStepNum}`,
      stepNumber: nextStepNum,
      agentId: defaultAgent,
      agentName: getOperativeName(defaultAgent),
      agentRole: getOperativeRole(defaultAgent),
      prompt: '',
    };
    setFormChainSteps([...formChainSteps, newStep]);
  };

  // Remove Step from Chain
  const handleRemoveChainStep = (stepId: string) => {
    playBeep('error');
    const filtered = formChainSteps.filter((s) => s.id !== stepId);
    const reindexed = filtered.map((s, idx) => ({ ...s, stepNumber: idx + 1 }));
    setFormChainSteps(reindexed);
  };

  // Update Individual Chain Step
  const handleUpdateChainStep = (stepId: string, updates: Partial<TaskChainStep>) => {
    setFormChainSteps(
      formChainSteps.map((s) => {
        if (s.id === stepId) {
          const updatedAgentId = updates.agentId || s.agentId;
          return {
            ...s,
            ...updates,
            agentName: updates.agentId ? getOperativeName(updatedAgentId) : s.agentName,
            agentRole: updates.agentId ? getOperativeRole(updatedAgentId) : s.agentRole,
          };
        }
        return s;
      })
    );
  };

  // Apply Preset Chain Template
  const handleApplyPresetChain = (type: 'audit' | 'intel' | 'devops') => {
    playBeep('tap');
    setFormMode('chained');
    if (type === 'audit') {
      setFormTitle('Autonomous Zero-Trust Vulnerability Audit');
      setFormChainSteps([
        {
          id: `step-${Date.now()}-1`,
          stepNumber: 1,
          agentId: crewAgents[0]?.id || 'vance',
          agentName: getOperativeName(crewAgents[0]?.id || 'vance'),
          agentRole: getOperativeRole(crewAgents[0]?.id || 'vance'),
          prompt: 'Search the web for critical CVE vulnerability bulletins released this week.',
        },
        {
          id: `step-${Date.now()}-2`,
          stepNumber: 2,
          agentId: crewAgents[1]?.id || crewAgents[0]?.id || 'nyx',
          agentName: getOperativeName(crewAgents[1]?.id || crewAgents[0]?.id || 'nyx'),
          agentRole: getOperativeRole(crewAgents[1]?.id || crewAgents[0]?.id || 'nyx'),
          prompt: 'Analyze vulnerability vectors from previous step, evaluate exploit severity, and generate a comprehensive security audit report.',
        },
      ]);
    } else if (type === 'intel') {
      setFormTitle('Market Intel & Competitive Recon Dossier');
      setFormChainSteps([
        {
          id: `step-${Date.now()}-1`,
          stepNumber: 1,
          agentId: crewAgents[0]?.id || 'vance',
          agentName: getOperativeName(crewAgents[0]?.id || 'vance'),
          agentRole: getOperativeRole(crewAgents[0]?.id || 'vance'),
          prompt: 'Research current industry AI trends and multi-agent architecture breakthroughs.',
        },
        {
          id: `step-${Date.now()}-2`,
          stepNumber: 2,
          agentId: crewAgents[2]?.id || crewAgents[0]?.id || 'cipher',
          agentName: getOperativeName(crewAgents[2]?.id || crewAgents[0]?.id || 'cipher'),
          agentRole: getOperativeRole(crewAgents[2]?.id || crewAgents[0]?.id || 'cipher'),
          prompt: 'Author a detailed strategic executive briefing based on the findings and record to workspace files.',
        },
      ]);
    } else {
      setFormTitle('Safehouse Infrastructure Health Check');
      setFormChainSteps([
        {
          id: `step-${Date.now()}-1`,
          stepNumber: 1,
          agentId: crewAgents[1]?.id || crewAgents[0]?.id || 'nyx',
          agentName: getOperativeName(crewAgents[1]?.id || crewAgents[0]?.id || 'nyx'),
          agentRole: getOperativeRole(crewAgents[1]?.id || crewAgents[0]?.id || 'nyx'),
          prompt: 'Inspect local storage integrity, check background worker telemetry, and evaluate memory quotas.',
        },
      ]);
    }
  };

  // Request Browser Push Permission
  const handleRequestPushPermission = async () => {
    playBeep('tap');
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      setPushPermissionStatus(perm);
      if (perm === 'granted') {
        new Notification('[PixelOps Night Shift]', {
          body: 'Browser push notifications successfully connected! You will receive routine completion briefings.',
          icon: '/pwa-192x192.png',
        });
        playBeep('complete');
      }
    }
  };

  // Test Phone Vibration
  const handleTestVibrate = () => {
    playBeep('tap');
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([200, 100, 200, 100, 300]);
    }
  };

  // Webhook Save & Test Handlers
  const handleSaveWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    playBeep('complete');
    saveWebhookConfig(webhookConfig);
    setWebhookSavedFeedback(true);
    setTimeout(() => setWebhookSavedFeedback(false), 2500);
  };

  const handleTestWebhook = async () => {
    playBeep('tap');
    setIsTestingWebhook(true);
    setWebhookTestFeedback(null);
    try {
      const result = await testWebhookEndpoint(webhookConfig);
      setWebhookTestFeedback({ text: result.message, ok: result.ok });
      if (result.ok) {
        playBeep('complete');
      } else {
        playBeep('error');
      }
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const localConnectedAccounts = getLocalConnectedAccounts();
  const hasGmailConnected = localConnectedAccounts.some((a) => a.appName.toLowerCase().includes('gmail'));
  const hasSlackConnected = localConnectedAccounts.some((a) => a.appName.toLowerCase().includes('slack'));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl bg-[#0d1017] border border-slate-800 p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-950/80 border border-indigo-700/50 flex items-center justify-center text-indigo-400">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100 tracking-wide">
                  Night Shift & Autonomous Routines
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 font-mono text-[10px] uppercase border border-indigo-700/40">
                  Task Chaining & Webhooks
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Scheduled background routines, multi-agent task chains, and outbound webhook formatters
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
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
            <span>Routines & Chaining ({schedules.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              setActiveTab('briefings');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'briefings'
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Routine Briefings</span>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-600 text-[10px] font-mono-tabular text-white font-bold">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              setActiveTab('channels');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'channels'
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Channels & Webhooks</span>
          </button>
        </div>

        {/* Tab 1: Schedules & Task Chaining */}
        {activeTab === 'schedules' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Automated background routines execute according to cron schedules even while idling.
              </span>
              <button
                type="button"
                onClick={handleOpenCreateForm}
                className={`min-h-[34px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  theme.accentBgClass
                } text-slate-950 hover:brightness-110 shadow-md`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Create Routine / Task Chain</span>
              </button>
            </div>

            {/* Routine Editor / Creator Modal Drawer */}
            {isEditorOpen && (
              <form
                onSubmit={handleSaveRoutine}
                className="p-4 rounded-xl bg-[#090b10] border border-indigo-500/40 flex flex-col gap-4 shadow-xl animate-in fade-in duration-150"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      {editingScheduleId ? 'Edit Routine & Task Chain' : 'Configure New Routine'}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">Presets:</span>
                    <button
                      type="button"
                      onClick={() => handleApplyPresetChain('audit')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-indigo-300 cursor-pointer"
                    >
                      🛡️ Vuln Audit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPresetChain('intel')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-indigo-300 cursor-pointer"
                    >
                      📈 Market Intel
                    </button>
                  </div>
                </div>

                {/* Title & Frequency */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                      Routine Title
                    </label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g. Daily Vulnerability Scan & Intel Brief"
                      className="w-full bg-[#121622] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                      Cron Schedule Frequency
                    </label>
                    <select
                      value={formFrequency}
                      onChange={(e: any) => setFormFrequency(e.target.value)}
                      className="w-full bg-[#121622] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="every_5m">Every 5 Minutes (Cron */5 * * * *)</option>
                      <option value="every_15m">Every 15 Minutes (Cron */15 * * * *)</option>
                      <option value="every_1h">Every 1 Hour (Cron 0 * * * *)</option>
                      <option value="every_6h">Every 6 Hours (Cron 0 */6 * * *)</option>
                      <option value="daily">Daily Midnight (Cron 0 0 * * *)</option>
                      <option value="weekly">Weekly Briefing (Cron 0 9 * * 1)</option>
                    </select>
                  </div>
                </div>

                {/* Mode Selector: Single Agent vs Multi-Agent Task Chain */}
                <div className="flex items-center gap-2 p-1.5 bg-[#121622] rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      setFormMode('single');
                    }}
                    className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      formMode === 'single'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Single Operative Routine</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      setFormMode('chained');
                    }}
                    className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      formMode === 'chained'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Multi-Agent Task Chain ({formChainSteps.length} Steps)</span>
                  </button>
                </div>

                {/* Single Operative Mode */}
                {formMode === 'single' && (
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                        Assigned Field Operative
                      </label>
                      <select
                        value={formAgentId}
                        onChange={(e) => setFormAgentId(e.target.value)}
                        className="w-full bg-[#121622] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                      >
                        {crewAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.customName || agent.defaultName} — {agent.role}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                        Directive Prompt
                      </label>
                      <textarea
                        value={formPrompt}
                        onChange={(e) => setFormPrompt(e.target.value)}
                        placeholder="Specify the operational directive for the background operative (e.g., search web for latest security CVEs and write an audit report to workspace files)..."
                        rows={3}
                        className="w-full bg-[#121622] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 resize-none font-mono"
                        required
                      />
                    </div>
                  </div>
                )}

                {/* Multi-Agent Task Chain Mode */}
                {formMode === 'chained' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-300 font-semibold">
                        Workflow Sequence: Operatives hand off findings & outputs step-by-step
                      </span>
                      <button
                        type="button"
                        onClick={handleAddChainStep}
                        className="px-2.5 py-1 rounded bg-indigo-900/60 hover:bg-indigo-900 border border-indigo-700/60 text-[11px] text-indigo-200 flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Chain Step</span>
                      </button>
                    </div>

                    <div className="flex flex-col gap-2.5 max-h-[30vh] overflow-y-auto pr-1">
                      {formChainSteps.map((step, idx) => (
                        <div
                          key={step.id}
                          className="p-3 rounded-lg bg-[#121622] border border-slate-800 flex flex-col gap-2 relative"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-indigo-900/80 text-indigo-300 font-bold text-[10px] flex items-center justify-center border border-indigo-600/40">
                                {idx + 1}
                              </span>
                              <span className="font-semibold text-slate-200">
                                Step {idx + 1} Assignment:
                              </span>
                              <select
                                value={step.agentId}
                                onChange={(e) =>
                                  handleUpdateChainStep(step.id, { agentId: e.target.value })
                                }
                                className="bg-[#0b0e14] border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
                              >
                                {crewAgents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>
                                    {agent.customName || agent.defaultName} ({agent.role})
                                  </option>
                                ))}
                              </select>
                            </div>

                            {formChainSteps.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveChainStep(step.id)}
                                className="p-1 rounded text-slate-500 hover:text-red-400 cursor-pointer"
                                title="Remove Step"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <textarea
                            value={step.prompt}
                            onChange={(e) =>
                              handleUpdateChainStep(step.id, { prompt: e.target.value })
                            }
                            placeholder={`Directive for ${step.agentName} (tip: automatically receives findings from Step ${Math.max(1, idx)})...`}
                            rows={2}
                            className="w-full bg-[#0b0e14] border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono resize-none"
                            required
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Multi-Channel Notification Configuration */}
                <div className="p-3 rounded-lg bg-[#121622] border border-slate-800 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Multi-Channel Notification Dispatch</span>
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Dispatched immediately when routine finishes
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {/* Browser Push */}
                    <label className="flex items-center gap-2 p-2 rounded bg-[#0b0e14] border border-slate-800 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={notifConfig.notifyBrowser}
                        onChange={(e) =>
                          setNotifConfig({ ...notifConfig, notifyBrowser: e.target.checked })
                        }
                        className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                      />
                      <Bell className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <div>
                        <span className="font-semibold text-slate-200">Browser / Desktop Push</span>
                        <p className="text-[10px] text-slate-400">Native system popup notification</p>
                      </div>
                    </label>

                    {/* Phone / Mobile Haptic */}
                    <label className="flex items-center gap-2 p-2 rounded bg-[#0b0e14] border border-slate-800 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={notifConfig.notifyPhone}
                        onChange={(e) =>
                          setNotifConfig({ ...notifConfig, notifyPhone: e.target.checked })
                        }
                        className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                      />
                      <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <div>
                        <span className="font-semibold text-slate-200">Mobile Phone / Vibration</span>
                        <p className="text-[10px] text-slate-400">Haptic pulse & PWA push on mobile</p>
                      </div>
                    </label>

                    {/* Gmail Briefing */}
                    <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifConfig.notifyGmail}
                          onChange={(e) =>
                            setNotifConfig({ ...notifConfig, notifyGmail: e.target.checked })
                          }
                          className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                        />
                        <Mail className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span className="font-semibold text-slate-200">Gmail Email Briefing</span>
                      </label>
                      {notifConfig.notifyGmail && (
                        <input
                          type="email"
                          value={notifConfig.gmailRecipient || ''}
                          onChange={(e) =>
                            setNotifConfig({ ...notifConfig, gmailRecipient: e.target.value })
                          }
                          placeholder={hasGmailConnected ? 'Using connected Composio account' : 'recipient@example.com'}
                          className="w-full bg-[#151926] border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100 font-mono"
                        />
                      )}
                    </div>

                    {/* Slack Dispatch */}
                    <div className="p-2 rounded bg-[#0b0e14] border border-slate-800 flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifConfig.notifySlack}
                          onChange={(e) =>
                            setNotifConfig({ ...notifConfig, notifySlack: e.target.checked })
                          }
                          className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                        />
                        <MessageSquare className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        <span className="font-semibold text-slate-200">Slack Channel Dispatch</span>
                      </label>
                      {notifConfig.notifySlack && (
                        <input
                          type="text"
                          value={notifConfig.slackChannel || ''}
                          onChange={(e) =>
                            setNotifConfig({ ...notifConfig, slackChannel: e.target.value })
                          }
                          placeholder="#intel-briefings or channel ID"
                          className="w-full bg-[#151926] border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100 font-mono"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Leashes & Guardrails */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Max Token Leash ({formMaxTokens})
                    </label>
                    <input
                      type="number"
                      value={formMaxTokens}
                      onChange={(e) => setFormMaxTokens(Number(e.target.value))}
                      className="w-full bg-[#121622] border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-100"
                      min={300}
                      max={12000}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">
                      Max Actions Leash ({formMaxActions})
                    </label>
                    <input
                      type="number"
                      value={formMaxActions}
                      onChange={(e) => setFormMaxActions(Number(e.target.value))}
                      className="w-full bg-[#121622] border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-100"
                      min={1}
                      max={15}
                    />
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditorOpen(false);
                      setEditingScheduleId(null);
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white cursor-pointer shadow-md"
                  >
                    {editingScheduleId ? 'Save Routine Changes' : 'Arm & Schedule Routine'}
                  </button>
                </div>
              </form>
            )}

            {/* Live Progress Banner */}
            {runningTaskId && (
              <div className="p-3 rounded-xl bg-indigo-950/80 border border-indigo-500/50 flex items-center justify-between text-xs animate-pulse">
                <div className="flex items-center gap-2 text-indigo-200">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
                  <span className="font-semibold">{liveExecutionStep || 'Autonomous Routine Running...'}</span>
                </div>
                <span className="font-mono text-[10px] text-indigo-300 uppercase">Live Inference</span>
              </div>
            )}

            {/* Routine Schedule Cards */}
            <div className="flex flex-col gap-3 max-h-[52vh] overflow-y-auto pr-1">
              {schedules.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 bg-[#080a0e] rounded-xl border border-slate-800/80 flex flex-col items-center gap-2">
                  <Clock className="w-8 h-8 text-slate-600" />
                  <p>No active Night Shift routines configured yet.</p>
                  <p className="text-[11px] text-slate-400">
                    Click <strong>&quot;+ Create Routine / Task Chain&quot;</strong> to schedule background scans, automated research, and multi-agent workflows.
                  </p>
                </div>
              ) : (
                schedules.map((task) => {
                  const hasChain = Array.isArray(task.chainSteps) && task.chainSteps.length > 1;
                  return (
                    <div
                      key={task.id}
                      className={`p-4 rounded-xl border flex flex-col gap-2.5 transition-all ${
                        task.enabled
                          ? 'bg-[#0b0e14] border-slate-800 hover:border-slate-700'
                          : 'bg-[#08090d] border-slate-900 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-100 text-sm">{task.title}</span>
                          <span className="px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-800/60 font-mono text-[10px] text-indigo-300">
                            {getFrequencyLabel(task.frequency)}
                          </span>
                          {hasChain ? (
                            <span className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-800/60 font-mono text-[10px] text-purple-300 flex items-center gap-1">
                              <Layers className="w-2.5 h-2.5" />
                              <span>{task.chainSteps!.length} Steps Chained</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-800 font-mono text-[10px] text-slate-300 flex items-center gap-1">
                              <UserCheck className="w-2.5 h-2.5 text-emerald-400" />
                              <span>{task.agentName}</span>
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRunNow(task)}
                            disabled={runningTaskId === task.id}
                            className="px-2.5 py-1 rounded bg-indigo-950 hover:bg-indigo-900 border border-indigo-700/60 text-[11px] text-indigo-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            title="Execute immediately without waiting for schedule"
                          >
                            <Play className={`w-3 h-3 ${runningTaskId === task.id ? 'animate-spin' : ''}`} />
                            <span>{runningTaskId === task.id ? 'Running...' : 'Run Now'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditForm(task)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] flex items-center gap-1 cursor-pointer"
                            title="Edit routine configuration, assigned agents, or steps"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleSchedule(task.id)}
                            className={`px-2 py-1 rounded text-[11px] font-mono border cursor-pointer ${
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
                            title="Delete routine"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Prompt / Chain Preview */}
                      {hasChain ? (
                        <div className="flex items-center gap-2 overflow-x-auto py-1 text-[11px] font-mono text-slate-400">
                          {task.chainSteps!.map((step, sIdx) => (
                            <React.Fragment key={step.id}>
                              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 shrink-0">
                                {sIdx + 1}. {step.agentName}
                              </span>
                              {sIdx < task.chainSteps!.length - 1 && (
                                <span className="text-slate-600">→</span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                          {task.prompt}
                        </p>
                      )}

                      {/* Telemetry & Stats Footer */}
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/60">
                        <div className="flex items-center gap-3">
                          <span>Runs: {task.runCount || 0}</span>
                          <span>Last Run: {task.lastRunTime ? new Date(task.lastRunTime).toLocaleTimeString() : 'Never'}</span>
                          {task.lastStatus && (
                            <span className={task.lastStatus === 'completed' ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                              [{task.lastStatus.toUpperCase()}]
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {task.notificationConfig?.notifyBrowser && (
                            <span title="Browser Push Active">🔔</span>
                          )}
                          {task.notificationConfig?.notifyPhone && (
                            <span title="Mobile Phone Vibration Active">📱</span>
                          )}
                          {task.notificationConfig?.notifyGmail && (
                            <span title="Gmail Dispatch Active">📧</span>
                          )}
                          {task.notificationConfig?.notifySlack && (
                            <span title="Slack Dispatch Active">💬</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Routine Briefings & Logs */}
        {activeTab === 'briefings' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Completed autonomous routine briefs, findings, and multi-agent chain telemetry.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    const updated = notifications.map((n) => ({ ...n, read: true }));
                    setNotifications(updated);
                    saveNightShiftNotifications(updated);
                  }}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-300 border border-slate-800 cursor-pointer"
                >
                  Mark All Read
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playBeep('error');
                    setNotifications([]);
                    saveNightShiftNotifications([]);
                  }}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-red-400 border border-slate-800 cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 max-h-[55vh] overflow-y-auto pr-1">
              {notifications.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 bg-[#080a0e] rounded-xl border border-slate-800/80">
                  No routine briefings logged yet. Completed Night Shift routines will record briefs here.
                </div>
              ) : (
                notifications.map((n) => {
                  const isExpanded = expandedNotifId === n.id;
                  return (
                    <div
                      key={n.id}
                      className={`p-3.5 rounded-xl border flex flex-col gap-2.5 transition-all ${
                        n.read
                          ? 'bg-[#090b10] border-slate-800/80 text-slate-400'
                          : 'bg-[#121622] border-indigo-500/40 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          {n.status === 'completed' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                          )}
                          <span className="font-bold text-slate-100">{n.taskTitle}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-slate-500">
                            {new Date(n.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              playBeep('tap');
                              setExpandedNotifId(isExpanded ? null : n.id);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-slate-200 cursor-pointer"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Briefing summary */}
                      <p className="text-xs text-slate-300 leading-relaxed pl-6 whitespace-pre-wrap">
                        {n.summary}
                      </p>

                      {/* Chained Step Contributions (if multi-agent chain) */}
                      {isExpanded && Array.isArray(n.chainStepResults) && n.chainStepResults.length > 0 && (
                        <div className="pl-6 pt-2 border-t border-slate-800 flex flex-col gap-2">
                          <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">
                            Detailed Task Chain Breakdown ({n.chainStepResults.length} Steps):
                          </span>
                          {n.chainStepResults.map((s) => (
                            <div
                              key={s.stepNumber}
                              className="p-2.5 rounded bg-[#0b0e14] border border-slate-800 flex flex-col gap-1 text-[11px]"
                            >
                              <div className="flex items-center justify-between font-mono text-slate-400">
                                <span className="font-bold text-slate-200">
                                  Step {s.stepNumber}: {s.agentName}
                                </span>
                                <span>~{s.tokenEstimate || 0} tokens</span>
                              </div>
                              <p className="text-slate-400 italic">Prompt: &quot;{s.prompt}&quot;</p>
                              <p className="text-slate-300 whitespace-pre-wrap font-sans mt-1">
                                {s.summary}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Meta Footer */}
                      <div className="flex items-center justify-between text-[10px] font-mono pl-6 pt-1 text-slate-500 border-t border-slate-800/40">
                        <span>Lead Operative: {n.agentName}</span>
                        <div className="flex items-center gap-3">
                          <span>Tokens: ~{n.tokenUsage}</span>
                          <span>Actions: {n.actionCount}</span>
                          <span
                            className={n.status === 'completed' ? 'text-emerald-400' : 'text-amber-400'}
                          >
                            [{n.status.toUpperCase()}]
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Notification Channels & Outbound Webhook Formatters */}
        {activeTab === 'channels' && (
          <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto pr-1">
            <span className="text-xs text-slate-400">
              Configure outbound communication channels, mobile notifications, and platform-specific webhook formatters.
            </span>

            {/* Section 1: Outbound Webhook Formatters Suite */}
            <form
              onSubmit={handleSaveWebhook}
              className="p-4 rounded-xl bg-[#090b10] border border-indigo-500/40 flex flex-col gap-3.5 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-cyan-400" />
                  <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                    Outbound Webhook Connectors & Formatters
                  </h4>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={webhookConfig.enabled}
                    onChange={(e) =>
                      setWebhookConfig({ ...webhookConfig, enabled: e.target.checked })
                    }
                    className="accent-cyan-500 cursor-pointer"
                  />
                  <span className="text-[11px] font-mono text-slate-300 font-bold">
                    {webhookConfig.enabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </label>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Automatically formats routine execution briefs, anomalies, and multi-agent summaries into platform-compliant payloads and POSTs them to your destination webhook.
              </p>

              {/* Formatter Selector */}
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Payload Formatter Type
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['slack', 'telegram', 'discord', 'custom'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        setWebhookConfig({ ...webhookConfig, serviceType: s });
                      }}
                      className={`p-2 rounded-lg border text-xs font-mono uppercase transition-all cursor-pointer text-center ${
                        webhookConfig.serviceType === s
                          ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-bold shadow'
                          : 'bg-[#121622] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {s === 'slack' && '💬 Slack'}
                      {s === 'telegram' && '✈️ Telegram'}
                      {s === 'discord' && '🎮 Discord'}
                      {s === 'custom' && '⚙️ Custom JSON'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Webhook URL Endpoint */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  {webhookConfig.serviceType.toUpperCase()} Webhook Endpoint URL
                </label>
                <input
                  type="url"
                  value={webhookConfig.webhookUrl}
                  onChange={(e) =>
                    setWebhookConfig({ ...webhookConfig, webhookUrl: e.target.value })
                  }
                  placeholder={
                    webhookConfig.serviceType === 'slack'
                      ? 'https://hooks.slack.com/services/T00/B00/XXXX'
                      : webhookConfig.serviceType === 'telegram'
                      ? 'https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>'
                      : webhookConfig.serviceType === 'discord'
                      ? 'https://discord.com/api/webhooks/XXXX/YYYY'
                      : 'https://api.mycompany.com/v1/pixelops-webhook'
                  }
                  className="w-full bg-[#121622] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Live Formatted JSON Preview */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Live Formatted Payload Preview ({webhookConfig.serviceType.toUpperCase()})</span>
                  <span className="font-mono text-[9px] text-cyan-400">POST application/json</span>
                </span>
                <pre className="p-2.5 rounded-lg bg-[#05070a] border border-slate-800/90 text-[10px] font-mono text-cyan-300 overflow-x-auto max-h-28">
                  {JSON.stringify(
                    formatWebhookPayload(webhookConfig.serviceType, {
                      title: 'Zero-Trust Audit Routine Complete',
                      body: '14 endpoints evaluated. 0 critical CVE exploits detected.',
                      agentName: 'Agent Nyx',
                    }),
                    null,
                    2
                  )}
                </pre>
              </div>

              {/* Feedback Alert */}
              {webhookTestFeedback && (
                <div
                  className={`p-2 rounded-lg text-xs font-mono flex items-center gap-2 ${
                    webhookTestFeedback.ok
                      ? 'bg-emerald-950/80 border border-emerald-700 text-emerald-300'
                      : 'bg-red-950/80 border border-red-700 text-red-300'
                  }`}
                >
                  <span>{webhookTestFeedback.ok ? '✓' : '⚠️'}</span>
                  <span>{webhookTestFeedback.text}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleTestWebhook}
                  disabled={isTestingWebhook || !webhookConfig.webhookUrl.trim()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-cyan-300 font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                >
                  {isTestingWebhook ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>{isTestingWebhook ? 'Pinging Endpoint...' : 'Test Webhook Ping'}</span>
                </button>

                <div className="flex items-center gap-2">
                  {webhookSavedFeedback && (
                    <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      <span>Settings Saved!</span>
                    </span>
                  )}
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-slate-950 cursor-pointer shadow-md"
                  >
                    Save Webhook Settings
                  </button>
                </div>
              </div>
            </form>

            {/* Section 2: Device & Connected Channels Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Browser Push Channel */}
              <div className="p-4 rounded-xl bg-[#0b0e14] border border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-indigo-400" />
                  <h4 className="text-xs font-bold text-slate-100">Browser Desktop Push</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Sends native operating system notifications when a routine completes or triggers an anomaly.
                </p>
                <div className="flex items-center justify-between pt-2">
                  <span className="font-mono text-[10px] text-slate-400 uppercase">
                    Status: <strong className={pushPermissionStatus === 'granted' ? 'text-emerald-400' : 'text-amber-400'}>{pushPermissionStatus}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={handleRequestPushPermission}
                    className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-semibold cursor-pointer"
                  >
                    {pushPermissionStatus === 'granted' ? 'Test Push Alert' : 'Enable Push'}
                  </button>
                </div>
              </div>

              {/* Mobile Phone Vibration */}
              <div className="p-4 rounded-xl bg-[#0b0e14] border border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-bold text-slate-100">Mobile Phone / Haptics</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Pulses mobile phone vibration patterns upon routine completion when running in mobile or PWA mode.
                </p>
                <div className="flex items-center justify-between pt-2">
                  <span className="font-mono text-[10px] text-slate-400 uppercase">
                    Vibration API: <strong className="text-emerald-400">Supported</strong>
                  </span>
                  <button
                    type="button"
                    onClick={handleTestVibrate}
                    className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs text-white font-semibold cursor-pointer"
                  >
                    Test Vibration
                  </button>
                </div>
              </div>

              {/* Composio Gmail */}
              <div className="p-4 rounded-xl bg-[#0b0e14] border border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-red-400" />
                  <h4 className="text-xs font-bold text-slate-100">Gmail Integration</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Sends operational email briefs to specified recipients via authenticated Google Workspace connection.
                </p>
                <div className="flex items-center justify-between pt-2">
                  <span className="font-mono text-[10px] text-slate-400 uppercase">
                    Composio: <strong className={hasGmailConnected ? 'text-emerald-400' : 'text-slate-500'}>{hasGmailConnected ? 'CONNECTED' : 'STANDBY'}</strong>
                  </span>
                </div>
              </div>

              {/* Composio Slack */}
              <div className="p-4 rounded-xl bg-[#0b0e14] border border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-purple-400" />
                  <h4 className="text-xs font-bold text-slate-100">Slack Dispatch</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Posts automated briefing cards and findings directly into designated team Slack channels.
                </p>
                <div className="flex items-center justify-between pt-2">
                  <span className="font-mono text-[10px] text-slate-400 uppercase">
                    Composio: <strong className={hasSlackConnected ? 'text-emerald-400' : 'text-slate-500'}>{hasSlackConnected ? 'CONNECTED' : 'STANDBY'}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <button
          type="button"
          onClick={onClose}
          className={`w-full min-h-[40px] rounded-xl text-xs font-bold text-slate-950 ${theme.accentBgClass} hover:brightness-110 transition-all cursor-pointer shadow-lg`}
        >
          Close Night Shift
        </button>
      </div>
    </div>
  );
};
