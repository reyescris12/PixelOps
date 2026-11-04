/**
 * PlaybookModal.tsx
 * 
 * Interactive HUD Execution Modal & Classified Dossier Viewer for PixelOps
 * One-Click Mission Playbooks.
 */

import React, { useState } from 'react';
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
} from 'lucide-react';
import {
  IntelligencePlaybookDef,
  PlaybookExecutionResult,
  dispatchMorningBriefingEmail,
} from '../engine/intelligencePlaybooks';
import { useTheme } from '../context/ThemeContext';

interface PlaybookModalProps {
  isOpen: boolean;
  onClose: () => void;
  playbook: IntelligencePlaybookDef | null;
  isRunning: boolean;
  activeStageIndex: number;
  stageLogs: string[];
  result: PlaybookExecutionResult | null;
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
  onOpenInVfs,
}) => {
  const { playBeep } = useTheme();
  const [copied, setCopied] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('commander@pixelops.app');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  if (!isOpen || !playbook) return null;

  const handleCopy = () => {
    if (result?.dossierContent) {
      navigator.clipboard.writeText(result.dossierContent);
      setCopied(true);
      playBeep('tap');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDispatchEmail = async () => {
    if (!result?.dossierContent || !emailInput.trim()) return;
    setIsSendingEmail(true);
    setEmailStatus(null);
    try {
      const res = await dispatchMorningBriefingEmail(emailInput.trim(), result.dossierContent);
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
          className="relative w-full max-w-3xl max-h-[90vh] bg-[#0c1017] border border-[#e59838] shadow-[0_0_40px_rgba(229,152,56,0.3)] flex flex-col font-mono-tabular text-xs text-[#f3ead8] overflow-hidden"
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
                  <span className="text-[#64748b]">STANDBY</span>
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
                  <span>Telemetry Log Stream:</span>
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
            {result && (
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
                      <span className="text-[#94a3b8]">THREAT LEVEL:</span>
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
            {playbook.supportsActionDispatch && result && (
              <div className="p-3 bg-[#131d2a] border border-[#2b3e59] flex flex-col sm:flex-row items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-[#f3ead8] flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-[#38bdf8]" />
                    <span>One-Click External Broadcast (Comms Relay)</span>
                  </div>
                  <div className="text-[10px] text-[#94a3b8] mt-0.5">
                    Transmit this executive command dossier to your email inbox via connected Gmail integration.
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="recipient@domain.com"
                    className="px-2.5 py-1 bg-[#090d14] border border-[#2d3d52] text-xs text-[#f3ead8] w-full sm:w-48 outline-none focus:border-[#38bdf8]"
                  />
                  <button
                    type="button"
                    onClick={handleDispatchEmail}
                    disabled={isSendingEmail}
                    className="px-3 py-1 bg-[#38bdf8] text-[#070f1a] font-bold text-xs border border-[#38bdf8] hover:bg-[#7dd3fc] cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    {isSendingEmail ? 'DISPATCHING...' : playbook.actionDispatchLabel || '[✉️ SEND BRIEFING]'}
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
              {result ? 'Archived to IndexedDB Virtual File System' : 'Awaiting mission execution...'}
            </div>

            <div className="flex items-center gap-2">
              {result && (
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

              <button
                type="button"
                onClick={onClose}
                disabled={isRunning}
                className="px-4 py-1.5 bg-[#e59838] text-[#121110] font-bold text-xs border border-[#e59838] hover:bg-[#d48828] cursor-pointer transition-colors disabled:opacity-50"
              >
                {result ? '[DONE · CLOSE HUD]' : '[CLOSE]'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
