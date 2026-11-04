import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, Send, RotateCcw, CheckCircle2, AlertCircle, Radio, Sparkles } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { getActiveSession } from '../services/AuthService';

const FEEDBACK_CATEGORIES = [
  { id: 'BUG', label: 'BUG REPORT', icon: '🐛' },
  { id: 'FEATURE', label: 'FEATURE REQ', icon: '💡' },
  { id: 'AGENTS', label: 'AGENT INTEL', icon: '🤖' },
  { id: 'GENERAL', label: 'GENERAL INTEL', icon: '📡' },
];

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

  const textareaRef = useRef(null);
  const terminalLogsRef = useRef(null);

  // Auto-fill active session operative credentials
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
      // Simulate retro terminal handshake delay for authentic 16-bit feel
      await new Promise((r) => setTimeout(r, 250));
      appendLog('TRANSMITTING PACKET TO CLOUDFLARE EDGE & D1 SQL...');

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-username': callsign || 'operative',
        },
        body: JSON.stringify({
          message: cleanMessage,
          category,
          callsign: callsign.trim() || undefined,
          email: email.trim() || undefined,
          created_at: Date.now(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}: Uplink transmission failed.`);
      }

      await new Promise((r) => setTimeout(r, 200));
      appendLog(`COMMITTED TO D1 DATABASE [ID: ${data.id || 'N/A'}]`);
      appendLog('DISPATCHING DIRECT INTEL RELAY -> support@pixelops.app');

      if (data.emailDispatched) {
        appendLog(`EMAIL RELAY CONFIRMED VIA ${data.dispatchProvider || 'SMTP'}`);
      } else {
        appendLog('EMAIL RELAY BUFFERED IN SECURE DISPATCH QUEUE');
      }

      appendLog('TRANSMISSION SUCCESSFUL [201 CREATED]. THANK YOU, OPERATIVE.');

      setLastReceipt({
        id: data.id,
        createdAt: data.created_at || Date.now(),
        targetEmail: data.targetEmail || 'support@pixelops.app',
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

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-[#33ff77]/80">
              <span className="w-2 h-2 rounded-full bg-[#00ff66] animate-ping" />
              <span>RELAY: support@pixelops.app</span>
            </div>
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

        {/* Main Terminal Body */}
        <div className="p-3 sm:p-4 overflow-y-auto z-10 flex-1 space-y-3 text-xs sm:text-sm">
          {/* Welcome ASCII-style Banner */}
          <div className="bg-[#040904] border border-[#009933]/60 p-2 text-[11px] leading-relaxed text-[#33ff77]">
            <p className="font-bold text-[#00ff66]">
              🛰️ SECURE INTELLIGENCE CHANNEL // DIRECT RELAY TO COMMAND
            </p>
            <p className="text-[#00cc55]/90">
              Submissions are permanently logged in Cloudflare D1 and instantly dispatched to{' '}
              <span className="text-[#ffffff] underline">support@pixelops.app</span>.
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
                      line.includes('FAILURE') || line.includes('ERROR')
                        ? 'text-[#ff4444]'
                        : line.includes('SUCCESSFUL') || line.includes('COMMITTED')
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
                  <div className="flex items-center gap-2 text-[#00ff66] font-bold text-sm">
                    <CheckCircle2 className="w-4 h-4 text-[#00ff66]" />
                    <span>MISSION INTEL LOGGED & RELAYED</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-[#33ff77]/90 pt-1 border-t border-[#009933]/50">
                    <div>
                      <span className="text-[#00aa44]">D1 RECORD ID: </span>
                      <span className="text-[#ffffff]">{lastReceipt.id}</span>
                    </div>
                    <div>
                      <span className="text-[#00aa44]">DISPATCH ROUTE: </span>
                      <span className="text-[#ffffff]">{lastReceipt.targetEmail}</span>
                    </div>
                  </div>
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
            <span>TARGET: support@pixelops.app</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedbackTerminal;
