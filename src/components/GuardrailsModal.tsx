import React, { useState } from 'react';
import { X, ShieldCheck, Lock, Sliders, AlertTriangle } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  GuardrailConfig,
  loadGuardrailConfig,
  saveGuardrailConfig,
} from '../services/GuardrailService';

interface GuardrailsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuardrailsModal: React.FC<GuardrailsModalProps> = ({ isOpen, onClose }) => {
  const { theme, playBeep } = useTheme();
  const [config, setConfig] = useState<GuardrailConfig>(loadGuardrailConfig);

  if (!isOpen) return null;

  const handleSave = () => {
    saveGuardrailConfig(config);
    playBeep('complete');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-[#11141c] border border-slate-800 p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Guardrails & Leashes Control Panel
              </h2>
              <p className="text-xs text-slate-400">
                Prevent runaway loops, token overuse, and unintended external actions
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

        <div className="rounded-xl bg-[#0a0a0c] border border-slate-800 p-4 flex flex-col gap-3.5">
          {/* Max Unattended Jobs */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="max-jobs" className="font-medium text-slate-200">
                Maximum Unattended Jobs Per Run
              </label>
              <span className="font-mono-tabular text-emerald-400 font-bold">
                {config.maxUnattendedJobs} jobs
              </span>
            </div>
            <input
              id="max-jobs"
              type="range"
              min="1"
              max="20"
              step="1"
              value={config.maxUnattendedJobs}
              onChange={(e) => {
                playBeep('tap');
                setConfig({ ...config, maxUnattendedJobs: parseInt(e.target.value, 10) });
              }}
              className="w-full accent-emerald-400 cursor-pointer"
            />
            <p className="text-[11px] text-slate-500">
              Limits the batch size of automated background routines before mandatory user review.
            </p>
          </div>

          {/* Token / Cost Hard Cap */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="token-cap" className="font-medium text-slate-200">
                Token / Cost Consumption Hard Cap
              </label>
              <span className="font-mono-tabular text-cyan-400 font-bold">
                {config.maxTokensPerRun} tokens
              </span>
            </div>
            <input
              id="token-cap"
              type="range"
              min="500"
              max="10000"
              step="250"
              value={config.maxTokensPerRun}
              onChange={(e) => {
                playBeep('tap');
                setConfig({ ...config, maxTokensPerRun: parseInt(e.target.value, 10) });
              }}
              className="w-full accent-cyan-400 cursor-pointer"
            />
            <p className="text-[11px] text-slate-500">
              Halts execution immediately if token usage per directive exceeds this budget.
            </p>
          </div>

          {/* Human-In-The-Loop Approval Gates */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
            <div className="flex flex-col gap-0.5 max-w-[340px]">
              <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Human-In-The-Loop Approval Gates</span>
              </span>
              <p className="text-[11px] text-slate-500 leading-snug">
                Requires manual tap-to-approve prompts before executing high-risk tool calls (GitHub issues, Slack dispatches, Calendar bookings).
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                playBeep('tap');
                setConfig({ ...config, humanInTheLoopApproval: !config.humanInTheLoopApproval });
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono-tabular border transition-colors cursor-pointer ${
                config.humanInTheLoopApproval
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-600 font-bold'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              {config.humanInTheLoopApproval ? 'ENFORCED' : 'DISABLED'}
            </button>
          </div>

          {/* Halt On Cost Anomaly */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
            <div className="flex flex-col gap-0.5 max-w-[340px]">
              <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span>Halt On Anomaly / Runaway Loop</span>
              </span>
              <p className="text-[11px] text-slate-500 leading-snug">
                Triggers a retro alarm dialogue if an agent enters an infinite recursion or anomaly pattern.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                playBeep('tap');
                setConfig({ ...config, haltOnCostAnomaly: !config.haltOnCostAnomaly });
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono-tabular border transition-colors cursor-pointer ${
                config.haltOnCostAnomaly
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-600 font-bold'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              {config.haltOnCostAnomaly ? 'ACTIVE' : 'MUTED'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          className={`w-full min-h-[42px] rounded-xl text-xs font-semibold text-slate-950 ${theme.accentBgClass} hover:opacity-95 transition-opacity cursor-pointer`}
        >
          Save Guardrail Leashes
        </button>
      </div>
    </div>
  );
};
