/**
 * RoomActionPlaybookPanel.tsx
 * 
 * PixelOps Intelligence Suite: Classified Safehouse Room Action Panel
 * Mounts directly into the active room HUD or bottom tray to provide zero-prompt,
 * one-click multi-step mission execution.
 */

import React from 'react';
import { RoomId } from '../engine/roomData';
import {
  getPlaybookForRoom,
  IntelligencePlaybookDef,
} from '../engine/intelligencePlaybooks';
import { Play, Sparkles, Shield, Radar, BarChart2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface RoomActionPlaybookPanelProps {
  currentRoom: RoomId;
  onExecutePlaybook: (playbook: IntelligencePlaybookDef) => void;
  isExecuting?: boolean;
  className?: string;
  variant?: 'floating' | 'banner' | 'pill';
}

export const RoomActionPlaybookPanel: React.FC<RoomActionPlaybookPanelProps> = ({
  currentRoom,
  onExecutePlaybook,
  isExecuting = false,
  className = '',
  variant = 'floating',
}) => {
  const { playBeep } = useTheme();
  const playbook = getPlaybookForRoom(currentRoom);

  if (!playbook) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    playBeep('tap');
    onExecutePlaybook(playbook);
  };

  // Variant: Top-Right Floating Tactical HUD over the Room Viewport
  if (variant === 'floating') {
    return (
      <div
        className={`absolute top-2 right-2 sm:right-3 z-30 pointer-events-auto font-mono-tabular ${className}`}
      >
        <div className="bg-[#0b1017]/92 border border-[#e59838] shadow-[0_0_20px_rgba(229,152,56,0.35)] p-2 sm:p-2.5 backdrop-blur-md flex flex-col gap-1.5 max-w-[280px] sm:max-w-[320px]">
          <div className="flex items-center justify-between gap-2 border-b border-[#2d3a4c] pb-1">
            <span className="text-[10px] text-[#94a3b8] uppercase font-bold tracking-wider flex items-center gap-1">
              <span>CLASSIFIED PLAYBOOK</span>
              <span className="text-[#38bdf8]">[{playbook.roomBadge}]</span>
            </span>
            <span className="text-[9px] px-1 bg-[#1a2938] text-[#4ade80] border border-[#4ade80]/40 font-bold">
              1-CLICK
            </span>
          </div>

          <div>
            <div className="text-xs font-bold text-[#f3ead8] flex items-center gap-1.5">
              <span>{playbook.icon}</span>
              <span className="truncate">{playbook.shortTitle}</span>
            </div>
            <div className="text-[10px] text-[#94a3b8] mt-0.5">
              Operative: <strong className="text-[#4ade80]">{playbook.assignedOperativeName}</strong> ({playbook.assignedOperativeRole})
            </div>
          </div>

          {/* Pipeline stages pill chain */}
          <div className="flex items-center gap-1 text-[8px] sm:text-[9px] text-[#cbd5e1] overflow-x-auto py-0.5">
            <span className="px-1 py-0.2 bg-[#172333] border border-[#23354d]">Recon</span>
            <span className="text-[#64748b]">&rarr;</span>
            <span className="px-1 py-0.2 bg-[#172333] border border-[#23354d]">Filter</span>
            <span className="text-[#64748b]">&rarr;</span>
            <span className="px-1 py-0.2 bg-[#172333] border border-[#23354d]">Format</span>
            <span className="text-[#64748b]">&rarr;</span>
            <span className="px-1 py-0.2 bg-[#1b2f23] text-[#4ade80] border border-[#4ade80]/40">VFS</span>
          </div>

          <button
            type="button"
            onClick={handleClick}
            disabled={isExecuting}
            className="w-full py-1.5 px-2 bg-[#e59838] text-[#121110] font-bold text-[11px] border border-[#e59838] hover:bg-[#d48828] active:translate-y-0.5 cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(229,152,56,0.3)] disabled:opacity-50"
            title={`Trigger ${playbook.shortTitle} with ${playbook.assignedOperativeName}`}
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{playbook.title}</span>
          </button>
        </div>
      </div>
    );
  }

  // Variant: Sleek Inline Pill Button for Room Status Bar / Header
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isExecuting}
      className={`px-2.5 py-0.5 font-bold text-[10px] sm:text-[11px] border transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 whitespace-nowrap shadow-[0_0_10px_rgba(229,152,56,0.25)] ${
        currentRoom === 'war_room'
          ? 'bg-[#291e10] hover:bg-[#3d2b15] text-[#fbbf24] border-[#f59e0b]'
          : currentRoom === 'server_vault'
          ? 'bg-[#152336] hover:bg-[#1e3452] text-[#38bdf8] border-[#0284c7]'
          : 'bg-[#11241a] hover:bg-[#193d2a] text-[#4ade80] border-[#16a34a]'
      } ${className}`}
      title={`Run ${playbook.shortTitle} with ${playbook.assignedOperativeName} (${playbook.assignedOperativeRole})`}
    >
      <span>{playbook.icon}</span>
      <span>{playbook.title}</span>
    </button>
  );
};
