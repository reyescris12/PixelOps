import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HelpCircle, Terminal, Play, AlertCircle, X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export interface TaskBrief {
  headline: string;
  understanding: string;
  missingParameter: string;
  question: string;
  options: string[];
}

interface TaskBriefModalProps {
  isOpen: boolean;
  brief: TaskBrief | null;
  rawPrompt: string;
  activeAgentName?: string;
  activeAgentRole?: string;
  onSelectOption: (clarifiedPrompt: string) => void;
  onCancel: () => void;
}

export const TaskBriefModal: React.FC<TaskBriefModalProps> = ({
  isOpen,
  brief,
  rawPrompt,
  activeAgentName = 'Operative',
  activeAgentRole = 'Field Specialist',
  onSelectOption,
  onCancel,
}) => {
  const { playBeep } = useTheme();
  const [customInput, setCustomInput] = useState('');

  if (!isOpen || !brief) return null;

  const handleChooseOption = (optionText: string) => {
    playBeep('tap');
    const combined = `${rawPrompt.trim()} [Scope / Parameter Clarification: ${optionText.trim()}]`;
    onSelectOption(combined);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    playBeep('complete');
    const combined = `${rawPrompt.trim()} [Direct User Clarification: ${customInput.trim()}]`;
    onSelectOption(combined);
  };

  return (
    <AnimatePresence>
      <motion.div
        key="task-brief-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-3 sm:p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 14 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.94, opacity: 0, y: 14 }}
          className="w-full max-w-xl bg-[#0c0e14] border-2 border-[#38bdf8] shadow-[0_0_35px_rgba(56,189,248,0.25)] overflow-hidden flex flex-col font-mono-tabular"
        >
          {/* Header */}
          <div className="bg-[#101726] border-b border-[#1e2f4a] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xs bg-[#0b1424] border border-[#38bdf8] flex items-center justify-center text-[#38bdf8]">
                <HelpCircle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-[#38bdf8] tracking-wider uppercase flex items-center gap-2">
                  <span>[TASK BRIEF · OPERATIVE CLARIFICATION REQUIRED]</span>
                </h3>
                <p className="text-[10px] text-[#94a3b8]">
                  {activeAgentName} ({activeAgentRole}) paused execution for missing directive parameters
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                playBeep('tap');
                onCancel();
              }}
              className="p-1 text-[#64748b] hover:text-white cursor-pointer"
              aria-label="Cancel clarification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 sm:p-5 flex flex-col gap-4 max-h-[75vh] overflow-y-auto text-xs">
            {/* Raw Prompt Recall */}
            <div className="p-2.5 bg-[#07090f] border border-[#1e293b] rounded-xs flex flex-col gap-1">
              <span className="text-[10px] font-bold text-[#64748b] uppercase">RAW INCOMING DIRECTIVE</span>
              <div className="text-[#f3ead8] font-bold text-xs sm:text-sm">&ldquo;{rawPrompt}&rdquo;</div>
            </div>

            {/* Structured Understanding */}
            <div className="p-3 bg-[#0d1624] border border-[#233854] rounded-xs flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[#38bdf8] text-[11px] font-bold">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{brief.headline}</span>
              </div>
              <p className="text-[11px] text-[#cbd5e1] leading-relaxed">{brief.understanding}</p>
            </div>

            {/* Clarifying Question & Multiple Choice Unblockers */}
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold text-[#e59838] uppercase flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#e59838]" />
                <span>{brief.question}</span>
              </label>

              <div className="flex flex-col gap-1.5">
                {brief.options.map((opt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleChooseOption(opt)}
                    className="p-3 bg-[#0a0f18] border border-[#1e2f48] hover:border-[#38bdf8] hover:bg-[#111c2e] text-left text-slate-200 cursor-pointer transition-all flex items-start gap-2.5 group"
                  >
                    <span className="text-[#38bdf8] font-bold mt-0.5 group-hover:scale-110 transition-transform">
                      [{idx + 1}]
                    </span>
                    <span className="text-xs leading-relaxed group-hover:text-white">{opt}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Write-In Option */}
            <form onSubmit={handleCustomSubmit} className="pt-2 border-t border-[#1e293b] flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[#94a3b8] uppercase">
                Or specify custom execution parameter:
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="e.g. Focus specifically on error recovery in ApiService.ts"
                  className="flex-1 px-3 py-1.5 bg-[#06080e] border border-[#1e293b] focus:border-[#38bdf8] text-[#f3ead8] text-xs outline-none"
                />
                <button
                  type="submit"
                  disabled={!customInput.trim()}
                  className="px-3 py-1.5 bg-[#38bdf8] disabled:opacity-40 text-[#0c0e14] font-bold text-xs cursor-pointer flex items-center gap-1"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>UNBLOCK</span>
                </button>
              </div>
            </form>
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-[#080b12] border-t border-[#182335] flex items-center justify-between text-[11px] text-[#64748b]">
            <span>Active Agent state will resume immediately upon selection</span>
            <button
              type="button"
              onClick={() => {
                playBeep('tap');
                onCancel();
              }}
              className="text-[#94a3b8] hover:text-white cursor-pointer"
            >
              [ABORT TASK]
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
