import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, X, CornerDownLeft, Trash2, Maximize2, Minimize2 } from 'lucide-react';
import { executeCLICommand, CLICommandContext } from '../engine/pixelOpsCLI';
import { useTheme } from '../context/ThemeContext';

export interface TerminalConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  context: CLICommandContext;
}

interface HistoryLine {
  id: string;
  type: 'input' | 'output' | 'system';
  text: string;
  status?: 'ok' | 'error' | 'warning';
}

export const TerminalConsole: React.FC<TerminalConsoleProps> = ({
  isOpen,
  onClose,
  context,
}) => {
  const { playBeep } = useTheme();
  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<HistoryLine[]>([
    {
      id: 'init-1',
      type: 'system',
      text: 'PIXELOPS HEADLESS TACTICAL CLI CONSOLE v1.0 [SEC-CLEARANCE: OMEGA]',
    },
    {
      id: 'init-2',
      type: 'system',
      text: 'Type "help" or "status" to inspect agents, or "dispatch <agent> <task>" to queue directives.',
    },
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [isMaximized, setIsMaximized] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Global hotkey: tilde key toggles console
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' || e.key === '~') {
        const activeTag = (document.activeElement?.tagName || '').toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          e.preventDefault();
          if (isOpen) onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = inputVal.trim();
    if (!cmd) return;

    playBeep('tap');
    setInputVal('');
    setCommandHistory((prev) => [cmd, ...prev]);
    setHistoryIdx(-1);

    const inputId = `in-${Date.now()}`;
    setHistory((prev) => [
      ...prev,
      { id: inputId, type: 'input', text: `pixelops> ${cmd}` },
    ]);

    const result = await executeCLICommand(cmd, context);

    if (result.output === '__CLEAR_CONSOLE__') {
      setHistory([]);
      return;
    }

    setHistory((prev) => [
      ...prev,
      {
        id: `out-${Date.now()}`,
        type: 'output',
        text: result.output,
        status: result.status,
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const nextIdx = Math.min(commandHistory.length - 1, historyIdx + 1);
        setHistoryIdx(nextIdx);
        setInputVal(commandHistory[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInputVal(commandHistory[nextIdx]);
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setInputVal('');
      }
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="terminal-console-overlay"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 15 }}
        className={`fixed z-50 transition-all font-mono-tabular select-text ${
          isMaximized
            ? 'inset-3 sm:inset-6'
            : 'bottom-3 right-3 sm:bottom-6 sm:right-6 w-[94vw] sm:w-[580px] h-[360px] sm:h-[420px]'
        }`}
      >
        <div className="w-full h-full bg-[#070b10]/95 backdrop-blur-md border-2 border-[#4ade80] shadow-[0_0_30px_rgba(74,222,128,0.25)] flex flex-col overflow-hidden">
          {/* CRT Header Bar */}
          <div className="bg-[#0b141d] border-b border-[#1b382b] px-3 py-2 flex items-center justify-between text-xs select-none">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#4ade80]" />
              <span className="font-bold text-[#4ade80] tracking-wider uppercase">
                [PIXELOPS TERMINAL CLI · /dev/pts/0]
              </span>
              <span className="text-[10px] text-[#64748b]">Press `~` or ESC to dismiss</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setHistory([])}
                className="p-1 text-[#94a3b8] hover:text-[#f87171] cursor-pointer"
                title="Clear screen buffer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsMaximized((prev) => !prev)}
                className="p-1 text-[#94a3b8] hover:text-[#4ade80] cursor-pointer"
                title={isMaximized ? 'Restore console window' : 'Maximize console window'}
              >
                {isMaximized ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-[#94a3b8] hover:text-white cursor-pointer"
                title="Close console"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* CRT Terminal Screen Buffer */}
          <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-1.5 text-xs text-[#86efac] font-mono leading-relaxed bg-[#05080c] select-text">
            {history.map((item) => (
              <div
                key={item.id}
                className={`whitespace-pre-wrap ${
                  item.type === 'input'
                    ? 'text-[#e59838] font-bold mt-1'
                    : item.type === 'system'
                    ? 'text-[#38bdf8] text-[11px]'
                    : item.status === 'error'
                    ? 'text-[#f87171]'
                    : item.status === 'warning'
                    ? 'text-[#fbbf24]'
                    : 'text-[#4ade80]'
                }`}
              >
                {item.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* CLI Input Prompt */}
          <form
            onSubmit={handleCommandSubmit}
            className="bg-[#080d14] border-t border-[#1b382b] px-3 py-2 flex items-center gap-2 select-none"
          >
            <span className="text-[#e59838] font-bold text-xs select-none">pixelops&gt;</span>
            <input
              ref={inputRef}
              id="pixelops-cli-command-input"
              name="cli_command"
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Try "status", "dispatch <agent> <task>", "logs", or "help"'
              aria-label="PixelOps CLI command input"
              autoComplete="off"
              className="flex-1 bg-transparent border-none outline-none text-[#f3ead8] font-mono text-xs focus:ring-0 placeholder:text-[#334155]"
            />
            <button
              type="submit"
              disabled={!inputVal.trim()}
              className="px-2 py-0.5 bg-[#4ade80] text-[#05080c] font-bold text-[10px] rounded-xs cursor-pointer disabled:opacity-40 flex items-center gap-1"
            >
              <span>RUN</span>
              <CornerDownLeft className="w-2.5 h-2.5" />
            </button>
          </form>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
