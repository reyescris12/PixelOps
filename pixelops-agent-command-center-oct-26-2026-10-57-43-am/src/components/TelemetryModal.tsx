import React, { useState, useEffect } from 'react';
import { X, BarChart2, Activity, Zap, DollarSign, Clock, CheckCircle2, AlertOctagon, RefreshCw } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  TelemetrySummary,
  loadTelemetrySummary,
  resetTelemetryLedger,
} from '../services/TelemetryStore';

interface TelemetryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TelemetryModal: React.FC<TelemetryModalProps> = ({ isOpen, onClose }) => {
  const { theme, playBeep } = useTheme();
  const [summary, setSummary] = useState<TelemetrySummary>(loadTelemetrySummary);

  useEffect(() => {
    if (isOpen) {
      setSummary(loadTelemetrySummary());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleReset = () => {
    if (window.confirm('Are you sure you want to purge all telemetry and cost logs?')) {
      playBeep('error');
      setSummary(resetTelemetryLedger());
    }
  };

  const totalRuns = summary.totalTasksCompleted + summary.totalTasksFailed;
  const successRate = totalRuns > 0 ? Math.round((summary.totalTasksCompleted / totalRuns) * 100) : 100;
  const avgDurationSec = totalRuns > 0 ? Math.round(summary.totalRuntimeMs / totalRuns / 1000) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0d1117] border border-emerald-500/40 p-5 sm:p-6 shadow-[0_0_30px_rgba(16,185,129,0.15)] flex flex-col gap-5 max-h-[90vh] overflow-y-auto font-mono">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-emerald-500/30 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-emerald-300 tracking-wider">
                TELEMETRY & COST LEDGER [HUD]
              </h2>
              <p className="text-xs text-emerald-500/80">
                Real-time agent execution metrics, token breakdown & model cost estimation
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-emerald-400 hover:text-emerald-200 hover:bg-emerald-950/50 cursor-pointer transition-colors"
            aria-label="Close telemetry modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 p-3 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-500 uppercase flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Success Rate
            </span>
            <span className="text-lg font-bold text-emerald-300 font-mono-tabular">
              {successRate}%
            </span>
            <span className="text-[10px] text-slate-500">
              {summary.totalTasksCompleted} OK / {summary.totalTasksFailed} Fail
            </span>
          </div>

          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 p-3 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-500 uppercase flex items-center gap-1">
              <Zap className="w-3 h-3 text-cyan-400" /> Total Tokens
            </span>
            <span className="text-lg font-bold text-cyan-300 font-mono-tabular">
              {summary.totalTokens.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-500">
              In: {summary.totalInputTokens.toLocaleString()} | Out: {summary.totalOutputTokens.toLocaleString()}
            </span>
          </div>

          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 p-3 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-500 uppercase flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-amber-400" /> Estimated Cost
            </span>
            <span className="text-lg font-bold text-amber-300 font-mono-tabular">
              ${summary.estimatedCostUsd.toFixed(4)}
            </span>
            <span className="text-[10px] text-slate-500">
              Model-agnostic rate map
            </span>
          </div>

          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 p-3 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-500 uppercase flex items-center gap-1">
              <Clock className="w-3 h-3 text-purple-400" /> Avg Duration
            </span>
            <span className="text-lg font-bold text-purple-300 font-mono-tabular">
              {avgDurationSec}s
            </span>
            <span className="text-[10px] text-slate-500">
              Total runtime: {Math.round(summary.totalRuntimeMs / 1000)}s
            </span>
          </div>
        </div>

        {/* Per-Agent Resource Utilization Breakdown */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Agent Resource Allocation & Metrics</span>
          </h3>
          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 overflow-hidden">
            <div className="max-h-52 overflow-y-auto divide-y divide-emerald-500/20">
              {Object.keys(summary.agentMetrics).length === 0 ? (
                <div className="p-6 text-center text-xs text-emerald-600">
                  No agent telemetry recorded yet. Run a directive from the command center.
                </div>
              ) : (
                Object.values(summary.agentMetrics).map((agent) => {
                  const agentTotalRuns = agent.tasksCompleted + agent.tasksFailed;
                  const agentSuccessRate = agentTotalRuns > 0 ? Math.round((agent.tasksCompleted / agentTotalRuns) * 100) : 100;
                  return (
                    <div key={agent.agentId} className="p-3 flex items-center justify-between text-xs hover:bg-emerald-950/20 transition-colors">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-emerald-200">{agent.agentName}</span>
                        <span className="text-[10px] text-emerald-500/80">
                          Completed: {agent.tasksCompleted} | Failed: {agent.tasksFailed} ({agentSuccessRate}% success)
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="font-mono-tabular text-cyan-300">{agent.totalTokens.toLocaleString()} tokens</div>
                          <div className="text-[10px] text-amber-400/90 font-mono-tabular">${agent.estimatedCostUsd.toFixed(4)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Recent Execution Ledger History */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-1.5">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            <span>Recent Execution Stream</span>
          </h3>
          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 overflow-hidden">
            <div className="max-h-48 overflow-y-auto divide-y divide-emerald-500/20 font-mono text-[11px]">
              {summary.history.length === 0 ? (
                <div className="p-4 text-center text-emerald-600">No execution history recorded.</div>
              ) : (
                summary.history.slice(0, 15).map((rec) => (
                  <div key={rec.id} className="p-2.5 flex items-center justify-between gap-2 hover:bg-emerald-950/20">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${rec.success ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-red-400'}`} />
                      <div className="truncate flex flex-col">
                        <span className="font-bold text-emerald-200 truncate">{rec.agentName}: {rec.prompt}</span>
                        <span className="text-[9px] text-emerald-500/70">{new Date(rec.timestamp).toLocaleTimeString()} [{rec.provider}]</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-3 text-right">
                      <span className="text-cyan-300">{rec.totalTokens} tk</span>
                      <span className="text-amber-400">${rec.estimatedCostUsd.toFixed(4)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-2 border-t border-emerald-500/30">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-2 rounded-xl bg-red-950/60 border border-red-600/50 text-red-300 hover:bg-red-900/80 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Purge Telemetry</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              onClose();
            }}
            className="px-5 py-2 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 text-xs font-bold transition-colors cursor-pointer"
          >
            CLOSE HUD
          </button>
        </div>
      </div>
    </div>
  );
};
