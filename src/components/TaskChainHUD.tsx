import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  GitCommit,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
  Layers,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import type { TaskChain } from '../services/TaskChainService';

export interface TaskChainHUDProps {
  chain: TaskChain | null;
  currentProgressText?: string;
  onCancel?: () => void;
}

export const TaskChainHUD: React.FC<TaskChainHUDProps> = ({
  chain,
  currentProgressText,
  onCancel,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!chain) return null;

  const totalSteps = chain.steps.length;
  const currentStepNum = Math.min(chain.currentStepIndex + 1, totalSteps);
  const percent = Math.round((currentStepNum / totalSteps) * 100);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -15, scale: 0.98 }}
        className="w-full max-w-4xl mx-auto mb-2.5 z-40"
      >
        <div className="bg-[#121110]/95 backdrop-blur-md border border-[#e59838] shadow-[0_0_20px_rgba(229,152,56,0.25)] rounded-sm overflow-hidden font-mono-tabular">
          {/* Header Bar */}
          <div className="bg-[#241a12] border-b border-[#4d3821] px-3 py-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-2 w-2">
                {chain.status === 'running' ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e59838] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#e59838]"></span>
                  </>
                ) : chain.status === 'completed' ? (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4ade80]"></span>
                ) : (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#f87171]"></span>
                )}
              </span>
              <Layers className="w-3.5 h-3.5 text-[#e59838]" />
              <span className="text-[#f59e0b] font-bold text-xs uppercase tracking-wider truncate">
                {chain.title}
              </span>
              <span className="hidden sm:inline-block px-1.5 py-0.2 bg-[#332414] text-[#c89d66] border border-[#5a4023] text-[10px]">
                PHASE {currentStepNum}/{totalSteps}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-xs ${
                  chain.status === 'running'
                    ? 'bg-[#e59838]/20 text-[#fbbf24] border border-[#e59838]/40'
                    : chain.status === 'completed'
                    ? 'bg-[#4ade80]/20 text-[#4ade80] border border-[#4ade80]/40'
                    : 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40'
                }`}
              >
                {chain.status === 'running' ? 'CHOREOGRAPHING' : chain.status.toUpperCase()}
              </span>

              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 text-[#c89d66] hover:text-[#f3ead8] hover:bg-[#332414] transition-colors cursor-pointer"
                title={isExpanded ? 'Collapse chain details' : 'Expand chain details'}
              >
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {onCancel && chain.status === 'running' && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="p-1 text-[#9c8265] hover:text-[#f87171] hover:bg-[#332414] transition-colors cursor-pointer"
                  title="Dismiss Task Chain HUD"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Sequential Agent Nodes Flow */}
          <div className="px-3 py-2 bg-[#17130f]">
            <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
              {chain.steps.map((step, idx) => {
                const isCurrent = idx === chain.currentStepIndex && chain.status === 'running';
                const isDone = step.status === 'completed';
                const isFailed = step.status === 'failed';

                return (
                  <React.Fragment key={step.id}>
                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-1 border transition-all shrink-0 ${
                        isCurrent
                          ? 'bg-[#2b1f13] border-[#e59838] shadow-[0_0_10px_rgba(229,152,56,0.3)]'
                          : isDone
                          ? 'bg-[#152317] border-[#22c55e]/50'
                          : isFailed
                          ? 'bg-[#2b1414] border-[#ef4444]/50'
                          : 'bg-[#12100d] border-[#382b1d] opacity-60'
                      }`}
                    >
                      {isCurrent ? (
                        <Loader2 className="w-3 h-3 text-[#fbbf24] animate-spin" />
                      ) : isDone ? (
                        <CheckCircle2 className="w-3 h-3 text-[#4ade80]" />
                      ) : isFailed ? (
                        <ShieldAlert className="w-3 h-3 text-[#ef4444]" />
                      ) : (
                        <Clock className="w-3 h-3 text-[#9c8265]" />
                      )}

                      <div className="flex flex-col">
                        <span
                          className={`text-[11px] font-bold leading-tight ${
                            isCurrent
                              ? 'text-[#fbbf24]'
                              : isDone
                              ? 'text-[#4ade80]'
                              : isFailed
                              ? 'text-[#ef4444]'
                              : 'text-[#9c8265]'
                          }`}
                        >
                          {step.assignedAgentName}
                        </span>
                        <span className="text-[9px] text-[#b8a690] uppercase tracking-wider leading-none">
                          {step.targetSector.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>

                    {idx < chain.steps.length - 1 && (
                      <ArrowRight
                        className={`w-3.5 h-3.5 shrink-0 ${
                          idx < chain.currentStepIndex
                            ? 'text-[#4ade80]'
                            : idx === chain.currentStepIndex
                            ? 'text-[#e59838] animate-pulse'
                            : 'text-[#4d3821]'
                        }`}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Current Real-Time Progress Marquee / Banner */}
            <div className="mt-1 text-[11px] text-[#e59838] flex items-center justify-between">
              <span className="truncate">
                {currentProgressText ||
                  (chain.status === 'running'
                    ? `Phase ${currentStepNum}: ${chain.steps[chain.currentStepIndex]?.assignedAgentName} executing directive...`
                    : chain.status === 'completed'
                    ? 'All workflow phases completed and verified.'
                    : 'Workflow execution encountered an anomaly.')}
              </span>
              <span className="text-[10px] text-[#9c8265] shrink-0 ml-2">
                {percent}% Progress
              </span>
            </div>

            {/* Micro Progress Bar */}
            <div className="w-full bg-[#291e13] h-1 mt-1.5 overflow-hidden rounded-full">
              <div
                className="bg-gradient-to-r from-[#e59838] to-[#4ade80] h-full transition-all duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* Expandable Phase Details & Telemetry Log */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-[#382b1d] bg-[#0d0c0a] px-3 py-2 text-xs space-y-2 overflow-hidden"
              >
                <div className="text-[10px] text-[#b8a690] uppercase tracking-wider font-semibold">
                  Autonomous Phase Sequence:
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {chain.steps.map((step, idx) => (
                    <div
                      key={step.id}
                      className="p-1.5 bg-[#17130f] border border-[#332414] rounded-xs flex flex-col gap-0.5"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#f3ead8]">
                          Phase {idx + 1}: {step.assignedAgentName} ({step.assignedAgentRole})
                        </span>
                        <span
                          className={`text-[9px] uppercase px-1 py-0.2 ${
                            step.status === 'completed'
                              ? 'text-[#4ade80] bg-[#4ade80]/10'
                              : step.status === 'running'
                              ? 'text-[#fbbf24] bg-[#fbbf24]/10'
                              : 'text-[#9c8265]'
                          }`}
                        >
                          {step.status}
                        </span>
                      </div>
                      <div className="text-[#c89d66] text-[10px]">
                        Directive: &quot;{step.directive}&quot;
                      </div>
                      {step.outputSummary && (
                        <div className="text-[#a3e635] text-[10px] bg-[#10190f] p-1 border-l-2 border-[#a3e635] mt-0.5 whitespace-pre-wrap">
                          {step.outputSummary.slice(0, 180)}...
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {chain.artifacts.length > 0 && (
                  <div className="pt-1 border-t border-[#261c12]">
                    <div className="text-[10px] text-[#b8a690] uppercase tracking-wider mb-1 font-semibold">
                      Accumulated Artifacts Handed Off:
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {chain.artifacts.map((art, aIdx) => (
                        <span
                          key={`${art.key}-${aIdx}`}
                          className="px-1.5 py-0.5 bg-[#1f1912] border border-[#4d3821] text-[10px] text-[#e59838]"
                        >
                          [{art.label}] {art.value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
