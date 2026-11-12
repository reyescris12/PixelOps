import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useCrew } from '../context/CrewContext';
import { AgentExecutionCard, RetroErrorCode, RetroErrorDescriptor } from '../services/ApiCore';
import { loadDraftPrompt, saveDraftPrompt } from '../services/AppStatePersistence';

interface TerminalWindowProps {
  dialogueText: string;
  isExecuting: boolean;
  onExecuteDirective: (
    prompt: string,
    attachment?: { data: string; mimeType: string; name: string } | null
  ) => Promise<void>;
  executionCards: AgentExecutionCard[];
  errorMessage: string | null;
  retroError?: RetroErrorDescriptor | null;
  onOpenGearVault?: () => void;
  onReopenErrorModal?: () => void;
  onTriggerErrorDrill?: (code: RetroErrorCode) => void;
  onDismissError?: () => void;
  onOpenCommandLog?: () => void;
  ledgerCount?: number;
  onOpenFieldManual?: () => void;
}

// Track the last fully rendered briefing text in module scope so switching between tabs
// (e.g., Briefing Terminal <-> Call Meeting) does not re-type the previous response.
let lastAnimatedBriefingText: string | null = null;

export const TerminalWindow: React.FC<TerminalWindowProps> = ({
  dialogueText,
  isExecuting,
  onExecuteDirective,
  executionCards,
  errorMessage,
  retroError,
  onOpenGearVault,
  onReopenErrorModal,
  onTriggerErrorDrill,
  onDismissError,
  onOpenCommandLog,
  onOpenFieldManual,
}) => {
  const { activeAgent, playBeep } = useTheme();
  const { getCrewAgent } = useCrew();
  const activeCrewName = getCrewAgent(activeAgent.id)?.customName || activeAgent.name;
  const fullBriefingText = isExecuting
    ? `Processing directive for ${activeCrewName}...`
    : (dialogueText || 'Command Center online. Select an operative and transmit your directive.');

  const [displayedText, setDisplayedText] = useState(() =>
    lastAnimatedBriefingText === fullBriefingText ? fullBriefingText : ''
  );
  const [promptInput, setPromptInput] = useState<string>(() => loadDraftPrompt());
  const [showLogs, setShowLogs] = useState(false);
  const [attachment, setAttachment] = useState<{
    data: string;
    mimeType: string;
    name: string;
    previewUrl: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    saveDraftPrompt(promptInput);
  }, [promptInput]);

  // Retro Typewriter Effect — only animates when a new response/directive text arrives
  useEffect(() => {
    if (!fullBriefingText) {
      setDisplayedText('');
      return;
    }

    if (lastAnimatedBriefingText === fullBriefingText) {
      setDisplayedText(fullBriefingText);
      return;
    }

    setDisplayedText('');
    let index = 0;
    const timer = setInterval(() => {
      index += 2;
      setDisplayedText(fullBriefingText.slice(0, index));
      if (index % 12 === 0) {
        playBeep('tick');
      }
      if (index >= fullBriefingText.length) {
        lastAnimatedBriefingText = fullBriefingText;
        clearInterval(timer);
      }
    }, 18);

    return () => {
      lastAnimatedBriefingText = fullBriefingText;
      clearInterval(timer);
    };
  }, [fullBriefingText, playBeep]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1] || '';
      setAttachment({
        data: base64Data,
        mimeType: file.type || 'image/png',
        name: file.name,
        previewUrl: result,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!promptInput.trim() && !attachment) || isExecuting) return;
    const currentPrompt = promptInput.trim();
    const currentAttachment = attachment
      ? { data: attachment.data, mimeType: attachment.mimeType, name: attachment.name }
      : null;

    setPromptInput('');
    setAttachment(null);
    await onExecuteDirective(currentPrompt, currentAttachment);
  };

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col gap-3 px-3 sm:px-0">
      {/* Box 1: CLASSIFIED INTEL BRIEFING (Amber-bordered retro terminal box, or Red Alert box on error) */}
      <div
        className={`rounded-sm bg-[#121110] border shadow-[0_0_20px_rgba(0,0,0,0.65)] overflow-hidden transition-colors ${
          retroError || errorMessage ? 'border-[#ef4444]' : 'border-[#b47b38]'
        }`}
      >
        {/* Header Strip */}
        <div
          className={`border-b px-3.5 py-2 flex items-center justify-between gap-2 ${
            retroError || errorMessage
              ? 'bg-[#2a0c10] border-[#7f1d1d]'
              : 'bg-[#231b12] border-[#4a351d]'
          }`}
        >
          <div className="flex items-center gap-2">
            {/* Pixel speech or alarm SVG */}
            {retroError || errorMessage ? (
              <svg
                viewBox="0 0 14 14"
                className="w-4 h-4 shrink-0 pixelated animate-pulse"
                shapeRendering="crispEdges"
              >
                <rect x="4" y="2" width="6" height="7" fill="#ef4444" />
                <rect x="6" y="4" width="2" height="3" fill="#fef08a" />
                <rect x="2" y="9" width="10" height="3" fill="#94a3b8" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 16 14"
                className="w-4 h-3.5 shrink-0 pixelated"
                shapeRendering="crispEdges"
              >
                <rect x="1" y="1" width="14" height="9" fill="#f3ead8" />
                <rect x="3" y="10" width="3" height="2" fill="#f3ead8" />
                <rect x="2" y="12" width="2" height="1" fill="#f3ead8" />
                <rect x="4" y="4" width="2" height="2" fill="#231b12" />
                <rect x="7" y="4" width="2" height="2" fill="#231b12" />
                <rect x="10" y="4" width="2" height="2" fill="#231b12" />
              </svg>
            )}
            <span
              className={`font-mono-tabular text-xs sm:text-sm font-bold tracking-wider uppercase ${
                retroError || errorMessage ? 'text-[#fca5a5]' : 'text-[#e59838]'
              }`}
            >
              {retroError
                ? `🚨 ${retroError.retroBadge}`
                : 'CLASSIFIED INTEL BRIEFING'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onOpenFieldManual && (
              <button
                type="button"
                onClick={() => {
                  playBeep('tap');
                  onOpenFieldManual();
                }}
                className="px-2 py-0.5 bg-[#141824] border border-[#2d3a54] text-[11px] font-mono-tabular text-[#38bdf8] hover:text-[#f3ead8] hover:border-[#38bdf8] flex items-center gap-1 cursor-pointer"
                title="Open Classified Safehouse Field Manual & Command Guide"
              >
                <span>📖 Manual</span>
              </button>
            )}
            {onOpenCommandLog && (
              <button
                type="button"
                onClick={() => {
                  playBeep('tap');
                  onOpenCommandLog();
                }}
                className="px-2 py-0.5 bg-[#1b140d] border border-[#6e5233] text-[11px] font-mono-tabular text-[#e59838] hover:text-[#f3ead8] hover:border-[#e59838] flex items-center gap-1 cursor-pointer"
                title="Open Immutable Command Log"
              >
                <span>📜 Command Log</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setShowLogs(!showLogs);
                playBeep('tap');
              }}
              className="text-[11px] font-mono-tabular text-[#c89d66] hover:text-[#f3ead8] flex items-center gap-1 cursor-pointer"
            >
              <span>Cards</span>
              {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Dialogue Content or Retro Error Quick-Fix Panel */}
        <div className="p-3.5 sm:p-4 font-mono-tabular text-xs sm:text-sm leading-relaxed min-h-[76px] text-[#f3ead8]">
          {retroError || errorMessage ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <span className="text-[#fca5a5] font-bold">
                  {retroError?.headline || errorMessage}
                </span>
                {retroError?.themeFlavorText && (
                  <p className="text-xs text-[#fecaca]">
                    <span className="text-[#f87171] font-semibold">
                      {activeCrewName}:
                    </span>{' '}
                    &ldquo;{retroError.themeFlavorText}&rdquo;
                  </p>
                )}
              </div>

              {/* Quick-Fix Action Bar inside Terminal */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {onOpenGearVault && (
                  <button
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      onOpenGearVault();
                    }}
                    className="px-2.5 py-1 bg-[#e59838] hover:bg-[#f5a642] text-[#121110] border border-[#fde047] font-mono-tabular text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <span aria-hidden="true">⚙️</span>
                    <span>[⚙️ OPEN GEAR VAULT]</span>
                  </button>
                )}
                {onReopenErrorModal && retroError && (
                  <button
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      onReopenErrorModal();
                    }}
                    className="px-2.5 py-1 bg-[#2a0c10] hover:bg-[#3b1117] text-[#fca5a5] border border-[#ef4444] font-mono-tabular text-xs cursor-pointer"
                  >
                    [🚨 Inspect Alarm Popup]
                  </button>
                )}
                {onDismissError && (
                  <button
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      onDismissError();
                    }}
                    className="px-2 py-1 bg-[#1b140d] text-[#9c8265] hover:text-[#f3ead8] border border-[#4a351d] font-mono-tabular text-xs cursor-pointer"
                  >
                    [Clear]
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p>
                <span className="text-[#e59838] font-semibold">{activeCrewName}:</span>{' '}
                <span>&ldquo;{displayedText}&rdquo;</span>
              </p>
              {/* Show immediate manual retry button if latest card failed an external dispatch */}
              {executionCards.length > 0 && executionCards[executionCards.length - 1]?.retryAction && (
                <div className="mt-2.5 pt-2 border-t border-[#382917] flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const retryCard = executionCards[executionCards.length - 1];
                      if (retryCard?.retryAction?.prompt) {
                        playBeep('tap');
                        onExecuteDirective(retryCard.retryAction.prompt);
                      }
                    }}
                    className="px-2.5 py-1 bg-[#b45309] hover:bg-[#d97706] text-[#fef3c7] border border-[#f59e0b] font-mono-tabular text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.3)]"
                  >
                    <span aria-hidden="true">⚡</span>
                    <span>[⚡ RETRY DISPATCH]</span>
                  </button>
                  <span className="text-[11px] font-mono-tabular text-[#d97706]">
                    External gateway latency or rate limit detected. Tap to re-dispatch.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Expandable Execution Cards / Tool Call Steps inside the Briefing Console */}
        {showLogs && (
          <div className="border-t border-[#382917] bg-[#0e0d0c] px-3.5 py-3 max-h-56 overflow-y-auto flex flex-col gap-3">
            {executionCards.length === 0 ? (
              <div className="py-4 text-center font-mono-tabular text-xs text-[#8c7a65]">
                [TASK LOGS EMPTY] No directives recorded yet. Transmit a command above to view execution steps.
              </div>
            ) : (
              executionCards.map((card) => (
                <div
                  key={card.id}
                  className="border-b border-[#292015] last:border-b-0 pb-2.5 last:pb-0 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between text-xs font-mono-tabular">
                    <span className="text-[#e59838] font-semibold">
                      {card.cardTitle} · {card.agentName}
                    </span>
                    <span className="text-[#9c8265]">{card.tokenEstimate} tok</span>
                  </div>
                  {card.toolCalls && card.toolCalls.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {card.toolCalls.map((tc, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono-tabular text-[#4ade80]">
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>{tc.toolName}: {tc.resultSummary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    {card.steps.map((s, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-[11px] font-mono-tabular text-[#d6c7b2]">
                        <CheckCircle2 className="w-3 h-3 text-[#e59838] shrink-0" />
                        <span>
                          [{idx + 1}/{card.steps.length}] {s.label} — {s.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                  {card.retryAction && (
                    <div className="mt-1 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          if (card.retryAction?.prompt) {
                            playBeep('tap');
                            onExecuteDirective(card.retryAction.prompt);
                          }
                        }}
                        className="px-2 py-0.5 bg-[#b45309] hover:bg-[#d97706] text-[#fef3c7] border border-[#f59e0b] font-mono-tabular text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <span aria-hidden="true">⚡</span>
                        <span>[⚡ RETRY DISPATCH]</span>
                      </button>
                      <span className="text-[10px] font-mono-tabular text-[#9c8265]">
                        Action failed · Manual re-trigger ready
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Box 2: MISSION PARAMETERS INPUT BOX (Amber-bordered retro terminal prompt) */}
      <form
        onSubmit={handleSubmit}
        className="rounded-sm bg-[#121110] border border-[#b47b38] shadow-[0_0_20px_rgba(0,0,0,0.65)] flex flex-col"
      >
        {/* Top Prompt Input Row */}
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[#2c2217]">
          <span className="font-mono-tabular text-sm font-bold text-[#a38c70] select-none">&gt;</span>
          <input
            id="terminal-prompt-input"
            name="mission_prompt"
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            disabled={isExecuting}
            placeholder="Type mission parameters..."
            aria-label="Mission prompt input"
            autoComplete="off"
            className="w-full bg-transparent font-mono-tabular text-base sm:text-sm text-[#f3ead8] placeholder:text-[#786c5e] focus:outline-none"
          />
        </div>

        {/* Attachment Preview (if image attached) */}
        {attachment && (
          <div className="px-3.5 py-2 bg-[#1a1510] border-b border-[#2c2217] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={attachment.previewUrl}
                alt={attachment.name}
                referrerPolicy="no-referrer"
                className="w-7 h-7 rounded-xs object-cover border border-[#b47b38]"
              />
              <span className="font-mono-tabular text-xs text-[#e59838] truncate">
                {attachment.name}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-[#a38c70] hover:text-[#f3ead8] p-1 cursor-pointer"
              aria-label="Remove attachment"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom Action Buttons Row ([📎 Attach] and [🚀 LAUNCH]) */}
        <div className="px-3 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setPromptInput('Scan flight nodes and schedule extraction briefing');
                playBeep('tap');
              }}
              className="text-[11px] font-mono-tabular text-[#8c7a65] hover:text-[#e59838] whitespace-nowrap cursor-pointer"
            >
              [Preset: Recon]
            </button>
            <button
              type="button"
              onClick={() => {
                setPromptInput('Post perimeter status alert to #ops-command on Slack');
                playBeep('tap');
              }}
              className="text-[11px] font-mono-tabular text-[#8c7a65] hover:text-[#e59838] whitespace-nowrap cursor-pointer"
            >
              [Preset: Alert]
            </button>
            {onTriggerErrorDrill && (
              <button
                type="button"
                onClick={() => {
                  onTriggerErrorDrill('INVALID_API_KEY');
                }}
                className="text-[11px] font-mono-tabular text-[#f87171]/80 hover:text-[#fca5a5] whitespace-nowrap cursor-pointer"
                title="Trigger Retro Error & Rate-Limit Alarm Overlay"
              >
                [🚨 Test Alarm]
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              id="terminal-file-attachment"
              name="file_attachment"
              type="file"
              accept="image/*"
              aria-label="Attach mission image or file"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isExecuting}
              className="min-h-[34px] px-3 py-1 bg-[#261f18] hover:bg-[#33291f] border border-[#6e5233] text-[#e8dcc4] font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <span aria-hidden="true">📎</span>
              <span>Attach]</span>
            </button>

            <button
              type="submit"
              disabled={isExecuting || (!promptInput.trim() && !attachment)}
              className="min-h-[34px] px-3.5 py-1 bg-[#2c2117] hover:bg-[#3d2d1e] border border-[#8c5a2b] text-[#f3ead8] font-mono-tabular text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-45"
            >
              <span aria-hidden="true">🚀</span>
              <span>{isExecuting ? 'RUNNING]' : 'LAUNCH]'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
