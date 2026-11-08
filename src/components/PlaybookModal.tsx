/**
 * PlaybookModal.tsx
 * 
 * Interactive HUD Execution Modal & Classified Dossier Viewer for PixelOps
 * Open-Ended One-Click OSINT & Tactical Cross-App Playbooks.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  Radar,
  FileText,
  Mail,
  Copy,
  Check,
  X,
  ExternalLink,
  ChevronRight,
  Terminal,
  AlertTriangle,
  Sparkles,
  Download,
  Settings,
  Target,
  Search,
  RotateCcw,
  Moon,
  Zap,
  Calendar,
  GitBranch,
  Clock,
} from 'lucide-react';
import {
  IntelligencePlaybookDef,
  PlaybookExecutionResult,
  UserPlaybookTarget,
  DEFAULT_TARGET_PRESETS,
  loadUserPlaybookTargets,
  saveUserPlaybookTarget,
  dispatchMorningBriefingEmail,
  schedulePlaybookInNightShift,
  scheduleWiretapInNightShift,
} from '../engine/intelligencePlaybooks';
import {
  getLocalConnectedAccounts,
  getConnectedAccounts,
  initiateAppConnection,
  subscribeToConnectionChanges,
  ComposioConnectedAccount,
  normalizeAppSlug,
} from '../services/ComposioService';
import { useTheme } from '../context/ThemeContext';

interface PlaybookModalProps {
  isOpen: boolean;
  onClose: () => void;
  playbook: IntelligencePlaybookDef | null;
  isRunning: boolean;
  activeStageIndex: number;
  stageLogs: string[];
  result: PlaybookExecutionResult | null;
  onRunPlaybook: (target: UserPlaybookTarget) => void;
  onOpenInVfs?: (filePath: string) => void;
}

export const PlaybookModal: React.FC<PlaybookModalProps> = ({
  isOpen,
  onClose,
  playbook,
  isRunning,
  activeStageIndex,
  stageLogs,
  result,
  onRunPlaybook,
  onOpenInVfs,
}) => {
  const { playBeep } = useTheme();

  // Active Target state
  const [targetName, setTargetName] = useState('');
  const [targetScope, setTargetScope] = useState('');
  const [watchCondition, setWatchCondition] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [isEditingTarget, setIsEditingTarget] = useState(false);

  // Status & action state
  const [copied, setCopied] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [nightShiftStatus, setNightShiftStatus] = useState<string | null>(null);
  const [isConnectingApp, setIsConnectingApp] = useState(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [connectedAccounts, setConnectedAccounts] = useState<ComposioConnectedAccount[]>(() =>
    getLocalConnectedAccounts()
  );

  // Sync latest accounts from Composio proxy / local store
  const handleSyncAccounts = useCallback(async () => {
    setIsRefreshingStatus(true);
    try {
      const accounts = await getConnectedAccounts();
      if (Array.isArray(accounts)) {
        setConnectedAccounts(accounts);
      }
    } catch {
      setConnectedAccounts(getLocalConnectedAccounts());
    } finally {
      setIsRefreshingStatus(false);
    }
  }, []);

  // Listen for live Composio account changes
  useEffect(() => {
    const unsub = subscribeToConnectionChanges((accounts) => {
      setConnectedAccounts(accounts);
    });
    return () => unsub();
  }, []);

  // Refresh status whenever modal opens
  useEffect(() => {
    if (isOpen) {
      handleSyncAccounts();
    }
  }, [isOpen, handleSyncAccounts]);

  // Initialize target from localStorage or presets when playbook changes
  useEffect(() => {
    if (playbook) {
      const storedTargets = loadUserPlaybookTargets();
      const current = storedTargets[playbook.id] || DEFAULT_TARGET_PRESETS[playbook.id]?.[0] || {
        targetName: 'Primary Target',
        targetScope: 'Operational scope',
      };
      let initialTarget = current.targetName || '';
      if (
        playbook.id === 'triage_gmail' &&
        (!initialTarget ||
          initialTarget.toLowerCase().startsWith('commander_') ||
          initialTarget.toLowerCase().startsWith('conn_') ||
          /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(initialTarget))
      ) {
        initialTarget = 'is:unread';
      }
      setTargetName(initialTarget);
      setTargetScope(current.targetScope || '');
      setWatchCondition(current.watchCondition || '');
      setRecipientEmail(current.recipientEmail || '');
      setEmailStatus(null);
      setNightShiftStatus(null);

      // If no result yet and not currently running, default to showing the target setup
      if (!result && !isRunning) {
        setIsEditingTarget(true);
      } else {
        setIsEditingTarget(false);
      }
    }
  }, [playbook, isOpen]);

  useEffect(() => {
    if (result?.emailDispatched && recipientEmail.trim()) {
      setEmailStatus(`AUTOMATIC BROADCAST TRANSMITTED: Briefing sent to ${recipientEmail.trim()}`);
    }
  }, [result, recipientEmail]);

  if (!isOpen || !playbook) return null;

  const presets = DEFAULT_TARGET_PRESETS[playbook.id] || [];

  // Determine required Composio app for Pillar 2 playbooks
  let requiredAppSlug: string | null = null;
  let requiredAppName = '';
  if (playbook.id === 'triage_gmail') {
    requiredAppSlug = 'gmail';
    requiredAppName = 'Google Gmail';
  } else if (playbook.id === 'calendar_brief' || playbook.id === 'quick_schedule_briefing') {
    requiredAppSlug = 'googlecalendar';
    requiredAppName = 'Google Calendar';
  } else if (playbook.id === 'sync_github') {
    requiredAppSlug = 'github';
    requiredAppName = 'GitHub';
  }

  // Robust slug & name matching for connected accounts
  const activeMatchedAccount = requiredAppSlug
    ? connectedAccounts.find((acc) => {
        const norm = normalizeAppSlug(acc.appName || '');
        const targetNorm = normalizeAppSlug(requiredAppSlug!);
        const isMatch = norm === targetNorm || norm.includes(targetNorm) || targetNorm.includes(norm);
        return isMatch && acc.status !== 'FAILED' && acc.status !== 'EXPIRED';
      })
    : undefined;

  const isAppConnected = requiredAppSlug ? Boolean(activeMatchedAccount) : true;

  const handleSelectPreset = (preset: UserPlaybookTarget) => {
    setTargetName(preset.targetName);
    setTargetScope(preset.targetScope);
    if (preset.watchCondition) setWatchCondition(preset.watchCondition);
    if (preset.recipientEmail) setRecipientEmail(preset.recipientEmail);
    playBeep('tap');
  };

  const handleStartSweep = () => {
    let cleanedTargetName = targetName.trim();
    if (
      playbook.id === 'triage_gmail' &&
      (!cleanedTargetName ||
        cleanedTargetName.toLowerCase().startsWith('commander_') ||
        cleanedTargetName.toLowerCase().startsWith('conn_') ||
        /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(cleanedTargetName))
    ) {
      cleanedTargetName = 'is:unread';
    }

    const finalTarget: UserPlaybookTarget = {
      targetName: cleanedTargetName || (playbook.id === 'triage_gmail' ? 'is:unread' : 'General Target Focus'),
      targetScope: targetScope.trim() || 'General Intelligence Scope',
      watchCondition: watchCondition.trim() || undefined,
      recipientEmail: recipientEmail.trim() || undefined,
    };
    saveUserPlaybookTarget(playbook.id, finalTarget);
    setIsEditingTarget(false);
    playBeep('tap');
    onRunPlaybook(finalTarget);
  };

  const handleArmNightShift = () => {
    let cleanedTargetName = targetName.trim();
    if (
      playbook.id === 'triage_gmail' &&
      (!cleanedTargetName ||
        cleanedTargetName.toLowerCase().startsWith('commander_') ||
        cleanedTargetName.toLowerCase().startsWith('conn_') ||
        /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(cleanedTargetName))
    ) {
      cleanedTargetName = 'is:unread';
    }

    const finalTarget: UserPlaybookTarget = {
      targetName: cleanedTargetName || (playbook.id === 'triage_gmail' ? 'is:unread' : 'Monitored Target'),
      targetScope: targetScope.trim() || 'Continuous Watch Scope',
      watchCondition: watchCondition.trim() || undefined,
      recipientEmail: recipientEmail.trim() || undefined,
    };
    saveUserPlaybookTarget(playbook.id, finalTarget);
    const ok = schedulePlaybookInNightShift(playbook.id, finalTarget);
    if (ok) {
      setNightShiftStatus(`AUTO-WATCH ARMED: "${finalTarget.targetName}" queued for autonomous background sweeps in Night Shift!`);
      playBeep('complete');
    } else {
      setNightShiftStatus('NOTICE: Target parameters saved to local registry.');
    }
    setTimeout(() => setNightShiftStatus(null), 4500);
  };

  const handleConnectApp = async () => {
    if (!requiredAppSlug) return;
    setIsConnectingApp(true);
    playBeep('tap');
    try {
      const res = await initiateAppConnection(requiredAppSlug);
      const targetUrl = res?.redirectUrl || res?.connectionUrl;
      if (targetUrl) {
        window.open(targetUrl, '_blank');
      }
      if (typeof res?.waitForCompletion === 'function') {
        res.waitForCompletion().then((completed: boolean) => {
          if (completed) {
            handleSyncAccounts();
          }
        });
      }
    } catch (err) {
      console.warn('Failed to initiate app connection:', err);
    } finally {
      setIsConnectingApp(false);
    }
  };

  const handleCopy = () => {
    if (result?.dossierContent) {
      navigator.clipboard.writeText(result.dossierContent);
      setCopied(true);
      playBeep('tap');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDispatchEmail = async () => {
    if (!result?.dossierContent || !recipientEmail.trim()) return;
    setIsSendingEmail(true);
    setEmailStatus(null);
    try {
      const res = await dispatchMorningBriefingEmail(
        recipientEmail.trim(),
        result.dossierContent,
        result.title
      );
      if (res.success) {
        setEmailStatus(`TRANSMITTED: ${res.message}`);
        playBeep('complete');
      } else {
        setEmailStatus(`NOTICE: ${res.message}`);
        playBeep('error');
      }
    } catch (err: any) {
      setEmailStatus(`ERROR: ${err?.message || 'Transmission failed'}`);
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          className="relative w-full max-w-3xl max-h-[92vh] bg-[#0c1017] border border-[#e59838] shadow-[0_0_40px_rgba(229,152,56,0.3)] flex flex-col font-mono-tabular text-xs text-[#f3ead8] overflow-hidden"
        >
          {/* Top Classified Header */}
          <div className="px-4 py-3 bg-[#161d27] border-b border-[#2d3b4e] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{playbook.icon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-[#e59838] tracking-wider">
                    {playbook.title}
                  </span>
                  <span className="px-1.5 py-0.5 bg-[#1b2a3a] text-[#38bdf8] border border-[#38bdf8]/40 text-[10px] font-bold">
                    {playbook.roomBadge}
                  </span>
                </div>
                <div className="text-[11px] text-[#94a3b8] mt-0.5">
                  Assigned Operative: <strong className="text-[#4ade80]">{playbook.assignedOperativeName}</strong> ({playbook.assignedOperativeRole})
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isRunning}
              className="p-1 text-[#94a3b8] hover:text-[#f3ead8] hover:bg-[#202b3b] cursor-pointer transition-colors disabled:opacity-40"
              title="Close classified HUD"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Main Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Dedicated Integration Status HUD for Connected-App Playbooks */}
            {requiredAppSlug && (
              <div
                className={`p-3 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors ${
                  isAppConnected
                    ? 'bg-[#0b1710] border-[#22c55e]/60 shadow-[0_0_15px_rgba(34,197,94,0.12)]'
                    : 'bg-[#261d10] border-[#f59e0b] shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {isAppConnected ? (
                    <div className="w-8 h-8 rounded-xs bg-[#11241a] border border-[#22c55e]/60 flex items-center justify-center shrink-0">
                      <Check className="w-4 h-4 text-[#4ade80]" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-xs bg-[#2e1d0c] border border-[#f59e0b]/60 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-4 h-4 text-[#fbbf24]" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold tracking-wider text-[#f3ead8]">
                        {requiredAppName.toUpperCase()} INTEGRATION
                      </span>
                      {isAppConnected ? (
                        <span className="px-2 py-0.5 bg-[#143320] border border-[#22c55e] text-[#4ade80] text-[10px] font-bold tracking-wider flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                          ONLINE & READY
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-[#3a200c] border border-[#f59e0b] text-[#fbbf24] text-[10px] font-bold tracking-wider">
                          AWAITING CONNECTION
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#cbd5e1] mt-0.5">
                      {isAppConnected
                        ? `Authorized for live 1-click execution. Account: ${
                            activeMatchedAccount?.userUuid || activeMatchedAccount?.id || 'Connected Account'
                          }`
                        : `Authorize ${requiredAppName} to allow ${playbook.assignedOperativeName} to ingest live inbox & message telemetry.`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                  {isAppConnected ? (
                    <>
                      <button
                        type="button"
                        onClick={handleSyncAccounts}
                        disabled={isRefreshingStatus}
                        className="px-2.5 py-1.5 bg-[#14261c] hover:bg-[#1e3a2b] text-[#86efac] border border-[#22c55e]/40 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        title="Re-verify live account status"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
                        <span>SYNC</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleConnectApp}
                        disabled={isConnectingApp}
                        className="px-3 py-1.5 bg-[#1c2936] hover:bg-[#25394d] text-[#38bdf8] border border-[#38bdf8]/50 text-xs font-bold cursor-pointer transition-colors"
                        title="Connect a different account or re-authenticate OAuth"
                      >
                        {isConnectingApp ? 'CONNECTING...' : '[SWITCH / RE-CONNECT]'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConnectApp}
                      disabled={isConnectingApp}
                      className="px-3.5 py-1.5 bg-[#f59e0b] hover:bg-[#d97706] text-[#121110] font-bold text-xs border border-[#f59e0b] cursor-pointer transition-all flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>{isConnectingApp ? 'OPENING OAUTH...' : `[⚡ CONNECT ${requiredAppName.toUpperCase()}]`}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Target Scope & Intelligence Directive Setup Banner */}
            <div className="p-3.5 bg-[#0e1624] border border-[#25374e] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-[#38bdf8]">
                  <Target className="w-4 h-4" />
                  <span>TARGET DIRECTIVE & SCOPE</span>
                </div>
                {!isRunning && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingTarget(!isEditingTarget);
                      playBeep('tap');
                    }}
                    className="text-[10px] text-[#e59838] hover:text-[#fbbf24] flex items-center gap-1 cursor-pointer"
                  >
                    <Settings className="w-3 h-3" />
                    <span>{isEditingTarget ? '[HIDE SETUP]' : '[EDIT TARGET]'}</span>
                  </button>
                )}
              </div>

              {/* Editable Target Form */}
              {isEditingTarget && !isRunning ? (
                <div className="space-y-3 pt-1">
                  <p className="text-[11px] text-[#cbd5e1] leading-relaxed">
                    {playbook.defaultPromptQuestion}
                  </p>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#94a3b8]">
                      {playbook.id === 'triage_gmail'
                        ? 'Gmail Search Filter / Query (e.g. is:unread, label:important, from:clients):'
                        : playbook.id === 'calendar_brief' || playbook.id === 'quick_schedule_briefing'
                        ? 'Calendar Schedule Scope / Meeting Window:'
                        : playbook.id === 'sync_github' || playbook.id === 'tech_audit'
                        ? 'GitHub Repository (owner/repo):'
                        : 'Target Name, Organization, Stack, or Entity:'}
                    </label>
                    <input
                      type="text"
                      value={targetName}
                      onChange={(e) => setTargetName(e.target.value)}
                      placeholder={
                        playbook.id === 'triage_gmail'
                          ? 'is:unread (leave blank for default)'
                          : playbook.targetPlaceholder
                      }
                      className="w-full px-3 py-1.5 bg-[#070b10] border border-[#2c3d54] text-xs text-[#f3ead8] outline-none focus:border-[#e59838] transition-colors"
                    />
                    {playbook.id === 'triage_gmail' && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] text-[#94a3b8]">
                        <span className="text-[#8c7a65]">Quick Filters:</span>
                        <button
                          type="button"
                          onClick={() => setTargetName('is:unread')}
                          className="px-1.5 py-0.5 bg-[#142131] hover:bg-[#1e344d] text-[#38bdf8] border border-[#2d425f] text-[9px] cursor-pointer"
                        >
                          is:unread
                        </button>
                        <button
                          type="button"
                          onClick={() => setTargetName('is:unread label:important')}
                          className="px-1.5 py-0.5 bg-[#142131] hover:bg-[#1e344d] text-[#38bdf8] border border-[#2d425f] text-[9px] cursor-pointer"
                        >
                          label:important
                        </button>
                        <button
                          type="button"
                          onClick={() => setTargetName('from:clients OR subject:urgent')}
                          className="px-1.5 py-0.5 bg-[#142131] hover:bg-[#1e344d] text-[#38bdf8] border border-[#2d425f] text-[9px] cursor-pointer"
                        >
                          subject:urgent
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#94a3b8]">
                      Intelligence Scope, URLs, Keywords, or Focus Areas:
                    </label>
                    <textarea
                      rows={2}
                      value={targetScope}
                      onChange={(e) => setTargetScope(e.target.value)}
                      placeholder={playbook.scopePlaceholder}
                      className="w-full px-3 py-1.5 bg-[#070b10] border border-[#2c3d54] text-xs text-[#f3ead8] outline-none focus:border-[#e59838] transition-colors resize-none"
                    />
                  </div>

                  {/* Auto-Watch Trigger / Recurrence Criteria */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[#38bdf8] flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-[#38bdf8]" />
                      <span>
                        {playbook.id === 'wiretap_watch'
                          ? 'Watch Trigger / Alert Condition:'
                          : 'Auto-Watch Trigger / Recurrence Criteria (Optional):'}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={watchCondition}
                      onChange={(e) => setWatchCondition(e.target.value)}
                      placeholder={
                        playbook.id === 'wiretap_watch'
                          ? 'e.g. Price drops below $99, new version released, or landing page redesign'
                          : playbook.id === 'deep_recon'
                          ? 'e.g. Breaking news, executive changes, funding rounds, or product launches'
                          : playbook.id === 'morning_briefing'
                          ? 'e.g. Daily morning SITREP at 08:00, or breaking industry shifts'
                          : playbook.id === 'triage_gmail'
                          ? 'e.g. Urgent deliverables, client requests, invoice notifications'
                          : playbook.id === 'calendar_brief' || playbook.id === 'quick_schedule_briefing'
                          ? "e.g. Today's upcoming syncs, VIP meeting prep, agenda changes"
                          : 'e.g. Critical P0/P1 issues, new pull requests, or security CVEs'
                      }
                      className="w-full px-3 py-1.5 bg-[#070b10] border border-[#2c3d54] text-xs text-[#f3ead8] outline-none focus:border-[#38bdf8] transition-colors"
                    />
                  </div>

                  {playbook.supportsActionDispatch && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-[#94a3b8]">
                        Optional Email Broadcast Destination:
                      </label>
                      <input
                        type="email"
                        value={recipientEmail}
                        onChange={(e) => setRecipientEmail(e.target.value)}
                        placeholder="recipient@domain.com"
                        className="w-full px-3 py-1.5 bg-[#070b10] border border-[#2c3d54] text-xs text-[#f3ead8] outline-none focus:border-[#e59838] transition-colors"
                      />
                    </div>
                  )}

                  {/* Preset Pills */}
                  {presets.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="text-[10px] text-[#94a3b8]">Quick Presets / Templates:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {presets.map((p) => (
                          <button
                            key={p.presetId || p.targetName}
                            type="button"
                            onClick={() => handleSelectPreset(p)}
                            className="px-2 py-0.5 bg-[#142131] hover:bg-[#1f334d] text-[#cbd5e1] border border-[#2d425f] text-[10px] cursor-pointer transition-colors"
                          >
                            {p.category ? `[${p.category}] ` : ''}{p.targetName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleArmNightShift}
                      className="px-3 py-2 bg-[#142638] text-[#38bdf8] font-bold text-xs border border-[#38bdf8]/50 hover:bg-[#1e3852] cursor-pointer transition-colors flex items-center gap-1.5"
                      title="Arm autonomous background monitoring schedule in Night Shift"
                    >
                      <Moon className="w-3.5 h-3.5" />
                      <span>[🌙 ARM AUTO-WATCH SCHEDULE]</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStartSweep}
                      className="px-4 py-2 bg-[#e59838] text-[#121110] font-bold text-xs border border-[#e59838] hover:bg-[#d48828] cursor-pointer transition-colors flex items-center gap-1.5 shadow-[0_0_12px_rgba(229,152,56,0.35)]"
                    >
                      <span>▶ INITIATE CLASSIFIED MISSION</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Compact Active Target Display when running or viewing results */
                <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-[#090e17] border border-[#1b283a]">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#f3ead8] truncate">
                      Target: <span className="text-[#e59838]">{targetName || 'General Focus'}</span>
                    </div>
                    <div className="text-[10px] text-[#94a3b8] truncate mt-0.5">
                      Scope: {targetScope || 'General Intelligence Parameters'}
                    </div>
                  </div>

                  {!isRunning && (
                    <button
                      type="button"
                      onClick={() => setIsEditingTarget(true)}
                      className="px-2 py-1 bg-[#1a2738] hover:bg-[#25374e] text-[#38bdf8] border border-[#38bdf8]/40 text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      [CHANGE TARGET]
                    </button>
                  )}
                </div>
              )}
            </div>

            {nightShiftStatus && (
              <div className="p-2.5 bg-[#0e2133] border border-[#38bdf8] text-xs text-[#38bdf8] flex items-center gap-2">
                <Moon className="w-3.5 h-3.5 shrink-0" />
                <span>{nightShiftStatus}</span>
              </div>
            )}

            {/* Pipeline Stage Tracker */}
            <div className="p-3 bg-[#080d14] border border-[#1b2636]">
              <div className="text-[10px] uppercase font-bold text-[#94a3b8] tracking-wider mb-2 flex items-center justify-between">
                <span>Autonomous Execution Pipeline</span>
                {isRunning ? (
                  <span className="text-[#e59838] animate-pulse flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#e59838] animate-ping" />
                    EXECUTING PIPELINE...
                  </span>
                ) : result ? (
                  <span className="text-[#4ade80] font-bold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    PIPELINE VERIFIED & ARCHIVED
                  </span>
                ) : (
                  <span className="text-[#64748b]">AWAITING TARGET DISPATCH</span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                {playbook.stages.map((st, idx) => {
                  const isDone = !isRunning && result !== null;
                  const isCurrent = isRunning && activeStageIndex === idx;
                  const isPast = isRunning && activeStageIndex > idx;

                  return (
                    <div
                      key={st.id}
                      className={`p-2 border transition-all ${
                        isDone || isPast
                          ? 'bg-[#11241a] border-[#4ade80]/60 text-[#4ade80]'
                          : isCurrent
                          ? 'bg-[#291e10] border-[#e59838] text-[#e59838] shadow-[0_0_12px_rgba(229,152,56,0.3)]'
                          : 'bg-[#0f1520] border-[#1e2a3b] text-[#64748b]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-bold">
                        <span>STAGE {idx + 1}</span>
                        {isDone || isPast ? (
                          <Check className="w-3 h-3 text-[#4ade80]" />
                        ) : isCurrent ? (
                          <span className="animate-spin text-xs">◷</span>
                        ) : (
                          <span className="text-[9px]">WAIT</span>
                        )}
                      </div>
                      <div className="font-semibold text-xs mt-1 truncate">{st.label}</div>
                      <div className="text-[9px] opacity-75 line-clamp-2 mt-0.5">{st.description}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Logs or Telemetry Stream during Execution */}
            {isRunning && (
              <div className="p-3 bg-[#05080e] border border-[#1b2636] font-mono-tabular text-xs space-y-1.5">
                <div className="text-[10px] text-[#38bdf8] font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Live Telemetry & Tool Calls:</span>
                </div>
                {stageLogs.slice(-4).map((log, i) => (
                  <div key={i} className="text-[#a5b4fc] text-[11px] flex items-start gap-1">
                    <span className="text-[#e59838] shrink-0">&gt;</span>
                    <span>{log}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Completed Result Dossier View */}
            {result && !isEditingTarget && (
              <div className="space-y-3">
                {/* Dossier Metadata Strip */}
                <div className="p-2.5 bg-[#121924] border border-[#233145] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#e59838]" />
                    <span>
                      VFS Archive Target: <strong className="text-[#38bdf8]">{result.targetPath}</strong>
                    </span>
                  </div>
                  {result.threatLevel && (
                    <div className="flex items-center gap-1.5 font-bold">
                      <span className="text-[#94a3b8]">ASSESSMENT:</span>
                      <span
                        className={`px-2 py-0.5 text-[10px] border ${
                          result.threatLevel.includes('CRITICAL')
                            ? 'bg-[#3b1219] text-[#f87171] border-[#ef4444]'
                            : result.threatLevel.includes('ELEVATED')
                            ? 'bg-[#332210] text-[#fbbf24] border-[#f59e0b]'
                            : 'bg-[#12281b] text-[#4ade80] border-[#22c55e]'
                        }`}
                      >
                        {result.threatLevel}
                      </span>
                    </div>
                  )}
                </div>

                {/* Markdown Dossier Preview */}
                <div className="p-4 bg-[#070b10] border border-[#1e2a3a] text-xs font-mono-tabular leading-relaxed text-[#cbd5e1] max-h-96 overflow-y-auto whitespace-pre-wrap selection:bg-[#e59838] selection:text-black">
                  {result.dossierContent}
                </div>
              </div>
            )}

            {/* Optional Gmail Dispatch Sub-Panel for Morning Command Briefing */}
            {playbook.supportsActionDispatch && result && !isEditingTarget && (
              <div className="p-3 bg-[#131d2a] border border-[#2b3e59] flex flex-col sm:flex-row items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-[#f3ead8] flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-[#38bdf8]" />
                    <span>One-Click External Broadcast (Comms Relay)</span>
                  </div>
                  <div className="text-[10px] text-[#94a3b8] mt-0.5">
                    Transmit this executive intelligence dossier to your email inbox via connected Gmail integration.
                  </div>
                  {result.emailDispatched && (
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#4ade80] font-bold">
                      <Check className="w-3 h-3 text-[#4ade80]" />
                      <span>Automatically broadcasted to {recipientEmail || 'designated email'}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="recipient@domain.com"
                    className="px-2.5 py-1 bg-[#090d14] border border-[#2d3d52] text-xs text-[#f3ead8] w-full sm:w-48 outline-none focus:border-[#38bdf8]"
                  />
                  <button
                    type="button"
                    onClick={handleDispatchEmail}
                    disabled={isSendingEmail}
                    className="px-3 py-1 bg-[#38bdf8] text-[#070f1a] font-bold text-xs border border-[#38bdf8] hover:bg-[#7dd3fc] cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    {isSendingEmail
                      ? 'DISPATCHING...'
                      : result.emailDispatched
                      ? '[✉️ RESEND BROADCAST]'
                      : playbook.actionDispatchLabel || '[✉️ SEND BRIEFING]'}
                  </button>
                </div>
              </div>
            )}

            {emailStatus && (
              <div className="p-2 bg-[#0d1e16] border border-[#22c55e] text-xs text-[#4ade80] flex items-center gap-2">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>{emailStatus}</span>
              </div>
            )}
          </div>

          {/* Bottom Action Footer */}
          <div className="px-4 py-3 bg-[#121822] border-t border-[#233145] flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-[#64748b]">
              {result ? 'Archived to IndexedDB Virtual File System' : 'Scoped to user target parameters & connected accounts'}
            </div>

            <div className="flex items-center gap-2">
              {result && !isEditingTarget && (
                <>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="px-3 py-1.5 bg-[#1b2533] hover:bg-[#253245] text-[#f3ead8] border border-[#38485e] text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[#4ade80]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'COPIED TO CLIPBOARD' : 'COPY DOSSIER'}</span>
                  </button>

                  {onOpenInVfs && (
                    <button
                      type="button"
                      onClick={() => onOpenInVfs(result.targetPath)}
                      className="px-3 py-1.5 bg-[#1e2a38] hover:bg-[#293a4e] text-[#38bdf8] border border-[#38bdf8]/60 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>OPEN IN VFS FILES</span>
                    </button>
                  )}
                </>
              )}

              {isEditingTarget ? (
                <button
                  type="button"
                  onClick={handleStartSweep}
                  className="px-4 py-1.5 bg-[#e59838] text-[#121110] font-bold text-xs border border-[#e59838] hover:bg-[#d48828] cursor-pointer transition-colors"
                >
                  [▶ RUN MISSION]
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isRunning}
                  className="px-4 py-1.5 bg-[#e59838] text-[#121110] font-bold text-xs border border-[#e59838] hover:bg-[#d48828] cursor-pointer transition-colors disabled:opacity-50"
                >
                  {result ? '[DONE · CLOSE HUD]' : '[CLOSE]'}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
