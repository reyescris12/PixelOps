import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, Send, RotateCcw, CheckCircle2, AlertCircle, Radio, Sparkles, Key, ExternalLink } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { getActiveSession } from '../services/AuthService';

const FEEDBACK_CATEGORIES = [
  { id: 'BUG', label: 'BUG REPORT', icon: '🐛' },
  { id: 'FEATURE', label: 'FEATURE REQ', icon: '💡' },
  { id: 'AGENTS', label: 'AGENT INTEL', icon: '🤖' },
  { id: 'GENERAL', label: 'GENERAL INTEL', icon: '📡' },
];

const STORAGE_RESEND_KEY = 'pixelops_resend_api_key';
const RESEND_TARGET_EMAIL = 'support@pixelops.app';

/**
 * Retro 16-bit green-on-black terminal UI for operative feedback
 * Submits to /api/feedback, logged in Cloudflare D1 and relayed to support@pixelops.app.
 */
export const FeedbackTerminal = ({ isOpen, onClose }) => {
  const { playBeep } = useTheme();

  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [callsign, setCallsign] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'sending' | 'success' | 'error'
  const [logLines, setLogLines] = useState([]);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Resend API Key management
  const [resendApiKey, setResendApiKey] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_RESEND_KEY) || '';
    } catch {
      return '';
    }
  });
  const [isKeyConfigOpen, setIsKeyConfigOpen] = useState(false);
  const [serverResendConfigured, setServerResendConfigured] = useState(null);

  const textareaRef = useRef(null);
  const terminalLogsRef = useRef(null);

  // Auto-fill active session operative credentials & probe backend status
  useEffect(() => {
    if (isOpen) {
      const session = getActiveSession();
      if (session?.user) {
        setCallsign(session.user.callsign || session.user.username || '');
        if (session.user.email && !session.user.email.endsWith('@pixelops.local')) {
          setEmail(session.user.email);
        }
      }
      setTimeout(() => textareaRef.current?.focus(), 100);

      // Check backend status for RESEND_API_KEY
      fetch('/api/feedback')
        .then((res) => res.json())
        .then((data) => {
          setServerResendConfigured(Boolean(data.resendConfigured));
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Scroll logs to bottom during transmission
  useEffect(() => {
    if (terminalLogsRef.current) {
      terminalLogsRef.current.scrollTop = terminalLogsRef.current.scrollHeight;
    }
  }, [logLines]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const appendLog = (line) => {
    setLogLines((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);
  };

  const saveResendKey = (key) => {
    const clean = (key || '').trim();
    setResendApiKey(clean);
    try {
      if (clean) {
        localStorage.setItem(STORAGE_RESEND_KEY, clean);
      } else {
        localStorage.removeItem(STORAGE_RESEND_KEY);
      }
    } catch {}
    playBeep?.('tap');
    setIsKeyConfigOpen(false);
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const cleanMessage = message.trim();
    if (!cleanMessage) return;

    setStatus('sending');
    setLogLines([]);
    setErrorMessage('');
    playBeep?.('tap');

    appendLog('INITIATING SATCOM UPLINK TO /api/feedback...');
    appendLog('ENCRYPTING PAYLOAD [PROTOCOL: AES-256-GCM]...');

    try {
      await new Promise((r) => setTimeout(r, 200));
      appendLog('TRANSMITTING TO CLOUDFLARE EDGE & D1 SQL...');

      const headers = {
        'Content-Type': 'application/json',
        'x-username': callsign || 'operative',
      };
      if (resendApiKey) {
        headers['x-resend-api-key'] = resendApiKey.trim();
      }

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: cleanMessage,
          category,
          callsign: callsign.trim() || undefined,
          email: email.trim() || undefined,
          resendApiKey: resendApiKey.trim() || undefined,
          created_at: Date.now(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}: Uplink transmission failed.`);
      }

      await new Promise((r) => setTimeout(r, 200));
      appendLog(`COMMITTED TO D1 DATABASE [ID: ${data.id || 'N/A'}]`);

      // Check Email Dispatch Telemetry
      if (data.emailDispatched) {
        appendLog(`[✓] RESEND EMAIL DELIVERED TO: ${RESEND_TARGET_EMAIL}`);
        if (data.resendId) {
          appendLog(`[✓] RESEND DISPATCH ID: ${data.resendId}`);
        }
      } else {
        appendLog(`[!] RESEND EMAIL NOT DELIVERED: ${data.emailError || 'RESEND_API_KEY missing'}`);
        if (!resendApiKey && !serverResendConfigured) {
          appendLog('[!] ACTION REQUIRED: Add RESEND_API_KEY via [KEY] button above or in Cloudflare Pages dashboard.');
        }
      }

      appendLog('TRANSMISSION CYCLE COMPLETE [201 CREATED].');

      setLastReceipt({
        id: data.id,
        createdAt: data.created_at || Date.now(),
        targetEmail: data.targetEmail || RESEND_TARGET_EMAIL,
        emailDispatched: data.emailDispatched,
        emailError: data.emailError,
        resendId: data.resendId,
      });

      setStatus('success');
      playBeep?.('complete');
    } catch (err) {
      console.error('[FEEDBACK UPLINK ERROR]', err);
      appendLog(`[TRANSMISSION FAILURE] ${err?.message || 'Connection fault'}`);
      setErrorMessage(err?.message || 'Failed to transmit feedback. Ensure you have network connectivity.');
      setStatus('error');
      playBeep?.('error');
    }
  };

  const handleReset = () => {
    setMessage('');
    setStatus('idle');
    setLogLines([]);
    setErrorMessage('');
    setLastReceipt(null);
    playBeep?.('tap');
    setTimeout(() => textareaRef.current?.focus(), 80);
  };

  const isResendReady = Boolean(serverResendConfigured || resendApiKey);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-xs font-mono select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-terminal-title"
    >
      {/* 16-bit CRT Green-on-Black Terminal Window */}
      <div
        className="relative w-full max-w-2xl bg-[#030703] border-2 border-[#00ff66] shadow-[0_0_35px_rgba(0,255,102,0.3)] rounded-xs overflow-hidden flex flex-col max-h-[92vh] text-[#00ff66]"
        style={{
          boxShadow: '0 0 40px rgba(0, 255, 102, 0.25), inset 0 0 15px rgba(0, 255, 102, 0.1)',
        }}
      >
        {/* CRT Scanline Filter Overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-20 opacity-30"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0px, rgba(0, 0, 0, 0.35) 1px, transparent 1px, transparent 2px)',
          }}
        />

        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#061206] border-b-2 border-[#00cc55] text-xs font-bold tracking-wider z-10">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#00ff66] animate-pulse" />
            <span id="feedback-terminal-title" className="text-[#00ff66]">
              PIXELOPS SATCOM // FEEDBACK TERMINAL V1.6
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Resend Status Badge & Key Config Button */}
            <button
              type="button"
              onClick={() => {
                setIsKeyConfigOpen((prev) => !prev);
                playBeep?.('tap');
              }}
              className={`px-2 py-0.5 text-[10px] border flex items-center gap-1 cursor-pointer transition-colors ${
                isResendReady
                  ? 'border-[#00aa44] text-[#4ade80] bg-[#09200f] hover:bg-[#0f2e16]'
                  : 'border-[#eab308] text-[#facc15] bg-[#2a2006] hover:bg-[#3d2e09]'
              }`}
              title="Configure Resend API Key for instant email forwarding"
            >
              <Key className="w-3 h-3" />
              <span>{isResendReady ? 'RESEND KEY: ACTIVE' : 'RESEND: SET KEY'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                playBeep?.('tap');
                onClose?.();
              }}
              className="text-[#33ff77] hover:text-[#ffffff] hover:bg-[#00ff66]/20 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
              title="Close Terminal (ESC)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Resend API Key Quick-Config Panel */}
        {isKeyConfigOpen && (
          <div className="bg-[#081808] border-b-2 border-[#00aa44] p-3 text-xs z-10 space-y-2 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#00ff66] flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5" />
                <span>RESEND API KEY CONFIGURATION</span>
              </span>
              <a
                href="https://resend.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#38bdf8] hover:underline flex items-center gap-1"
              >
                <span>Get key from resend.com</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <p className="text-[11px] text-[#33ff77]/80">
              Paste your Resend API Key (<code className="text-[#ffffff]">re_...</code>) below. It will be securely stored locally in your browser to dispatch emails to <code className="text-[#ffffff]">{RESEND_TARGET_EMAIL}</code>.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                defaultValue={resendApiKey}
                id="resend-api-key-input"
                placeholder="re_123456789..."
                className="flex-1 bg-[#020502] border border-[#00aa44] text-[#00ff66] px-2 py-1 text-xs focus:outline-none focus:border-[#00ff66]"
              />
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('resend-api-key-input');
                  saveResendKey(el?.value || '');
                }}
                className="px-3 py-1 bg-[#00ff66] text-[#020502] font-bold text-xs hover:bg-[#33ff77] cursor-pointer"
              >
                SAVE KEY
              </button>
              {resendApiKey && (
                <button
                  type="button"
                  onClick={() => saveResendKey('')}
                  className="px-2 py-1 bg-[#200505] text-[#ff7777] border border-[#ff3333] hover:bg-[#330a0a] text-xs cursor-pointer"
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>
        )}

        {/* Main Terminal Body */}
        <div className="p-3 sm:p-4 overflow-y-auto z-10 flex-1 space-y-3 text-xs sm:text-sm">
          {/* Welcome ASCII-style Banner */}
          <div className="bg-[#040904] border border-[#009933]/60 p-2 text-[11px] leading-relaxed text-[#33ff77]">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#00ff66]">
                🛰️ SECURE INTELLIGENCE CHANNEL // DIRECT RELAY TO RESEND
              </span>
              <span className="text-[10px] text-[#00aa44]">TARGET: {RESEND_TARGET_EMAIL}</span>
            </div>
            <p className="text-[#00cc55]/90 mt-0.5">
              Submissions are permanently logged in Cloudflare D1 and delivered directly to your Resend inbox.
            </p>
          </div>

          {status === 'idle' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Category Selector */}
              <div>
                <label className="block text-[11px] text-[#00cc55] uppercase tracking-wider mb-1">
                  &gt; SELECT REPORT CATEGORY:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {FEEDBACK_CATEGORIES.map((cat) => {
                    const isSelected = category === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setCategory(cat.id);
                          playBeep?.('tap');
                        }}
                        className={`px-2 py-1.5 text-[11px] font-mono border flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-[#00ff66] text-[#030703] font-bold border-[#00ff66] shadow-[0_0_10px_rgba(0,255,102,0.5)]'
                            : 'bg-[#061206] text-[#33ff77] border-[#009933]/60 hover:bg-[#0a200a]'
                        }`}
                      >
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Operative Identity / Contact Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#00cc55] uppercase tracking-wider mb-0.5">
                    OPERATIVE CALLSIGN (OPTIONAL):
                  </label>
                  <input
                    type="text"
                    value={callsign}
                    onChange={(e) => setCallsign(e.target.value)}
                    placeholder="e.g. CIPHER / COMMANDER"
                    className="w-full bg-[#050c05] border border-[#00aa44] text-[#00ff66] placeholder-[#006622] px-2 py-1 text-xs focus:outline-none focus:border-[#00ff66] focus:ring-1 focus:ring-[#00ff66]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#00cc55] uppercase tracking-wider mb-0.5">
                    RETURN FREQUENCY / EMAIL (OPTIONAL):
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operative@domain.com"
                    className="w-full bg-[#050c05] border border-[#00aa44] text-[#00ff66] placeholder-[#006622] px-2 py-1 text-xs focus:outline-none focus:border-[#00ff66] focus:ring-1 focus:ring-[#00ff66]"
                  />
                </div>
              </div>

              {/* Message Prompt & Textarea */}
              <div>
                <div className="flex items-center justify-between text-[11px] text-[#00cc55] mb-1">
                  <span>&gt; INTEL TRANSMISSION BUFFER (REQUIRED):</span>
                  <span className="text-[10px] text-[#00aa44]">{message.length} chars</span>
                </div>
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    rows={6}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                    placeholder="Enter observations, bugs, suggestions, or mission directives here... (Press CTRL+ENTER to transmit)"
                    className="w-full bg-[#020502] border-2 border-[#00cc55] text-[#00ff66] placeholder-[#005522] p-2.5 text-xs sm:text-sm font-mono leading-relaxed focus:outline-none focus:border-[#00ff66] focus:shadow-[0_0_12px_rgba(0,255,102,0.4)] resize-y min-h-[120px]"
                  />
                </div>
              </div>

              {/* Actions Toolbar */}
              <div className="flex items-center justify-between pt-1 border-t border-[#00882b]/50">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!message}
                  className="px-2.5 py-1 text-xs text-[#00aa44] hover:text-[#33ff77] disabled:opacity-30 cursor-pointer flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>CLEAR</span>
                </button>

                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline text-[10px] text-[#009933]">
                    [CTRL+ENTER TO TRANSMIT]
                  </span>
                  <button
                    type="submit"
                    disabled={!message.trim()}
                    className="px-4 py-1.5 bg-[#00ff66] text-[#020502] font-bold text-xs uppercase tracking-wider cursor-pointer hover:bg-[#33ff77] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-[0_0_15px_rgba(0,255,102,0.4)] transition-all active:scale-95"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>TRANSMIT TO HQ</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Transmitting & Success / Error Logs */}
          {status !== 'idle' && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div
                ref={terminalLogsRef}
                className="bg-[#020502] border-2 border-[#00cc55] p-3 max-h-56 overflow-y-auto space-y-1 text-[11px] sm:text-xs leading-relaxed"
              >
                {logLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`${
                      line.includes('FAILURE') || line.includes('ERROR') || line.includes('NOT DELIVERED')
                        ? 'text-[#ff4444]'
                        : line.includes('SUCCESSFUL') || line.includes('COMMITTED') || line.includes('DELIVERED')
                        ? 'text-[#00ff66] font-bold'
                        : 'text-[#33ff77]'
                    }`}
                  >
                    {line}
                  </div>
                ))}
                {status === 'sending' && (
                  <div className="flex items-center gap-2 text-[#00ff66] animate-pulse">
                    <Radio className="w-3.5 h-3.5" />
                    <span>UPLINK IN PROGRESS..._</span>
                  </div>
                )}
              </div>

              {/* Success Result View */}
              {status === 'success' && lastReceipt && (
                <div className="bg-[#061806] border-2 border-[#00ff66] p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#00ff66] font-bold text-sm">
                      <CheckCircle2 className="w-4 h-4 text-[#00ff66]" />
                      <span>MISSION INTEL LOGGED IN CLOUDFLARE D1</span>
                    </div>
                    {lastReceipt.emailDispatched ? (
                      <span className="text-[10px] bg-[#00ff66]/20 text-[#00ff66] border border-[#00ff66] px-1.5 py-0.5 rounded-xs">
                        EMAIL DELIVERED
                      </span>
                    ) : (
                      <span className="text-[10px] bg-[#ffaa00]/20 text-[#ffaa00] border border-[#ffaa00] px-1.5 py-0.5 rounded-xs">
                        EMAIL PENDING CONFIG
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-[#33ff77]/90 pt-1 border-t border-[#009933]/50">
                    <div>
                      <span className="text-[#00aa44]">D1 RECORD ID: </span>
                      <span className="text-[#ffffff]">{lastReceipt.id}</span>
                    </div>
                    <div>
                      <span className="text-[#00aa44]">TARGET INBOX: </span>
                      <span className="text-[#ffffff]">{lastReceipt.targetEmail}</span>
                    </div>
                  </div>

                  {!lastReceipt.emailDispatched && (
                    <div className="p-2 bg-[#251e08] border border-[#eab308] text-[11px] text-[#fde047] space-y-1">
                      <p className="font-bold flex items-center gap-1">
                        <span>⚠️ Email Not Received?</span>
                      </p>
                      <p className="text-[#fef08a]/90">
                        {lastReceipt.emailError || 'RESEND_API_KEY is not set.'}
                      </p>
                      <div className="pt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsKeyConfigOpen(true);
                            setStatus('idle');
                          }}
                          className="px-2 py-0.5 bg-[#eab308] text-black font-bold text-[10px] cursor-pointer"
                        >
                          ENTER RESEND API KEY
                        </button>
                        <span className="text-[10px] text-[#eab308]">
                          (Or set RESEND_API_KEY in Cloudflare Pages dashboard)
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="px-3 py-1 bg-[#061206] text-[#33ff77] border border-[#00aa44] hover:bg-[#0a200a] text-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>SUBMIT ANOTHER REPORT</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playBeep?.('tap');
                        onClose?.();
                      }}
                      className="px-3 py-1 bg-[#00ff66] text-[#020502] font-bold text-xs hover:bg-[#33ff77] cursor-pointer"
                    >
                      CLOSE TERMINAL [ESC]
                    </button>
                  </div>
                </div>
              )}

              {/* Error Result View */}
              {status === 'error' && (
                <div className="bg-[#200505] border-2 border-[#ff3333] p-3 space-y-2 text-xs text-[#ff6666]">
                  <div className="flex items-center gap-2 font-bold text-[#ff3333]">
                    <AlertCircle className="w-4 h-4" />
                    <span>TRANSMISSION ABORTED</span>
                  </div>
                  <p className="text-[11px] text-[#ff8888]">{errorMessage}</p>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setStatus('idle')}
                      className="px-3 py-1 bg-[#330a0a] text-[#ffaaaa] border border-[#ff3333] hover:bg-[#441010] text-xs cursor-pointer"
                    >
                      EDIT MESSAGE
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSubmit()}
                      className="px-3 py-1 bg-[#ff3333] text-black font-bold text-xs hover:bg-[#ff5555] cursor-pointer"
                    >
                      RETRY UPLINK
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Status Bar */}
        <div className="px-3 py-1.5 bg-[#040a04] border-t border-[#00aa44]/60 flex items-center justify-between text-[10px] text-[#00cc55] z-10">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00ff66]" />
            <span>CLOUDFLARE D1 ENCRYPTED VAULT ACTIVE</span>
          </div>
          <div>
            <span>TARGET: {RESEND_TARGET_EMAIL}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedbackTerminal;
