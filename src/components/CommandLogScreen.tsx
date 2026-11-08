import React, { useState } from 'react';
import { Shield, Terminal, Search, Sparkles, Lock, ArrowLeft, RefreshCw } from 'lucide-react';
import { CommandLedgerEntry } from '../services/CommandLedgerDb';
import { useTheme } from '../context/ThemeContext';

interface CommandLogScreenProps {
  entries: CommandLedgerEntry[];
  onBackToTerminal: () => void;
  onRefreshLedger: () => Promise<void>;
}

export const CommandLogScreen: React.FC<CommandLogScreenProps> = ({
  entries,
  onBackToTerminal,
  onRefreshLedger,
}) => {
  const { playBeep } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const uniqueAgents = Array.from(
    new Set(entries.map((e) => e.involved_agent).filter(Boolean))
  );

  const filteredEntries = entries.filter((entry) => {
    const matchesAgent =
      agentFilter === 'ALL' || entry.involved_agent === agentFilter;
    if (!matchesAgent) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      entry.command_input.toLowerCase().includes(q) ||
      entry.involved_agent.toLowerCase().includes(q) ||
      entry.tool_used.toLowerCase().includes(q) ||
      entry.result_summary.toLowerCase().includes(q) ||
      entry.ledger_hash.toLowerCase().includes(q)
    );
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    playBeep('tap');
    try {
      await onRefreshLedger();
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) + ' · ' + d.toLocaleDateString([], { month: 'short', day: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-3 sm:px-0">
      <div className="rounded-sm bg-[#121110] border border-[#b47b38] shadow-[0_0_24px_rgba(0,0,0,0.75)] overflow-hidden flex flex-col">
        {/* Top Retro Header Strip */}
        <div className="bg-[#231b12] border-b border-[#4a351d] px-3.5 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-4 h-4 text-[#e59838] shrink-0" />
            <span className="font-mono-tabular text-xs sm:text-sm font-bold tracking-wider text-[#e59838] uppercase truncate">
              IMMUTABLE COMMAND LOG · DEXIE LEDGER
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRefresh}
              className="px-2 py-0.5 bg-[#19140e] border border-[#4a351d] font-mono-tabular text-[11px] text-[#c89d66] hover:text-[#f3ead8] flex items-center gap-1 cursor-pointer"
              title="Query last 50 commands from IndexedDB"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Sync</span>
            </button>
            <button
              type="button"
              onClick={() => {
                playBeep('tap');
                onBackToTerminal();
              }}
              className="px-2.5 py-0.5 bg-[#2c2117] border border-[#8c5a2b] font-mono-tabular text-xs text-[#f3ead8] hover:bg-[#3d2d1e] flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Briefing]</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Sub-bar */}
        <div className="bg-[#181410] border-b border-[#332618] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-[180px] bg-[#0d0c0b] border border-[#382917] px-2.5 py-1">
            <Search className="w-3.5 h-3.5 text-[#8c7a65] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter command_input, tool_used, agent..."
              className="w-full bg-transparent font-mono-tabular text-xs text-[#f3ead8] placeholder:text-[#6e5d4b] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setAgentFilter('ALL');
                playBeep('tap');
              }}
              className={`px-2 py-0.5 font-mono-tabular text-[10px] border cursor-pointer ${
                agentFilter === 'ALL'
                  ? 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold'
                  : 'bg-[#12100d] text-[#c89d66] border-[#4a351d]'
              }`}
            >
              ALL ({entries.length})
            </button>
            {uniqueAgents.map((ag) => (
              <button
                key={ag}
                type="button"
                onClick={() => {
                  setAgentFilter(ag);
                  playBeep('tap');
                }}
                className={`px-2 py-0.5 font-mono-tabular text-[10px] border whitespace-nowrap cursor-pointer ${
                  agentFilter === ag
                    ? 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold'
                    : 'bg-[#12100d] text-[#c89d66] border-[#4a351d]'
                }`}
              >
                {ag}
              </button>
            ))}
          </div>
        </div>

        {/* Ledger Records List (Last 50 Commands) */}
        <div className="p-3 max-h-[340px] overflow-y-auto flex flex-col gap-2.5 bg-[#0e0d0b]">
          {filteredEntries.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-1.5 font-mono-tabular text-center text-[#8c7a65]">
              <Shield className="w-8 h-8 text-[#5e4326] mb-1" />
              <div className="text-xs font-bold text-[#e59838]">[IMMUTABLE LEDGER UNPOPULATED]</div>
              <p className="text-[11px] max-w-sm text-[#a38c70]">
                {entries.length === 0
                  ? 'No command dispatches executed yet. Send a directive from the terminal to record your first verified operational entry.'
                  : 'No records match the active filter.'}
              </p>
            </div>
          ) : (
            filteredEntries.map((item, idx) => (
              <div
                key={item.id ?? `${item.timestamp}-${idx}`}
                className="p-3 bg-[#141210] border border-[#382917] hover:border-[#6e5233] transition-colors flex flex-col gap-1.5"
              >
                {/* Row 1: Timestamp, Involved Agent, Success Boost, Immutable Hash */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-[#241b12] font-mono-tabular text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-[#e59838] font-bold">
                      {item.involved_agent}
                    </span>
                    <span className="text-[#6e5d4b]">|</span>
                    <span className="text-[#a38c70]">
                      {formatTimestamp(item.timestamp)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] border font-semibold ${
                        item.success_boost_achieved > 0
                          ? 'bg-[#4ade80]/15 border-[#4ade80]/60 text-[#4ade80]'
                          : 'bg-[#261f18] border-[#4a351d] text-[#b8a690]'
                      }`}
                    >
                      BOOST +{item.success_boost_achieved}%
                    </span>
                    <span
                      className="px-1.5 py-0.5 bg-[#0a0908] border border-[#2c2217] text-[10px] text-[#8c7a65] flex items-center gap-1"
                      title="Append-Only Immutable Ledger Hash"
                    >
                      <Lock className="w-2.5 h-2.5 text-[#e59838]" />
                      {item.ledger_hash.slice(0, 10)}
                    </span>
                  </div>
                </div>

                {/* Row 2: command_input */}
                <div className="font-mono-tabular text-xs text-[#f3ead8] flex items-start gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[#e59838] shrink-0 mt-0.5" />
                  <span className="font-semibold break-words">
                    &gt; {item.command_input}
                  </span>
                </div>

                {/* Row 3: tool_used & result_summary */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 pt-1 font-mono-tabular text-[11px]">
                  <div className="sm:col-span-4 flex items-center gap-1 text-[#4ade80] truncate">
                    <Sparkles className="w-3 h-3 shrink-0" />
                    <span className="truncate" title={item.tool_used}>
                      {item.tool_used}
                    </span>
                  </div>
                  <div className="sm:col-span-8 text-[#d6c7b2] leading-snug">
                    {item.result_summary}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Schema Status Bar */}
        <div className="bg-[#181410] border-t border-[#332618] px-3.5 py-1.5 flex items-center justify-between font-mono-tabular text-[10px] text-[#8c7a65]">
          <span>
            SCHEMA: [timestamp, command_input, involved_agent, tool_used, result_summary, success_boost_achieved]
          </span>
          <span className="text-[#4ade80] shrink-0 ml-2">APPEND-ONLY LOCKED</span>
        </div>
      </div>
    </div>
  );
};
