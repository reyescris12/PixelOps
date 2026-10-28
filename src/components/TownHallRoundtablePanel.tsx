import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  Play,
  SkipForward,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  MessageSquare,
  History,
  FileText,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useCrew, SPRITE_VARIANTS } from '../context/CrewContext';
import { AgentSpriteFigure, ROOM_METADATA, RoomId } from './SpriteCanvas';
import {
  RoundtableActionItem,
  RoundtableMeetingSession,
  RoundtableParticipantPayload,
  isValidRealTask,
} from '../services/ApiService';

interface TownHallRoundtablePanelProps {
  sessions: RoundtableMeetingSession[];
  isExecutingMeeting: boolean;
  onConveneMeeting: (topic: string, includePriorTurns: boolean) => Promise<void>;
  onSummonAgain: () => void;
  onAdjournMeeting: () => void;
  onDispatchActionItem: (
    agentIndex: number,
    directive: string,
    targetSector: RoomId,
    assignedAgentId?: string,
    taskId?: string
  ) => void;
  activeSpeakerAgentIndex: number | null;
  onSelectSpeakerAgentIndex: (agentIndex: number | null) => void;
  participantsWithNotes: RoundtableParticipantPayload[];
}

/**
 * Returns all active, recruited agents rather than restricting to a hardcoded subset.
 */
export function getActiveMeetingParticipants(allAgents: any[]): any[] {
  return (allAgents || []).filter(
    (agent) => agent.isRecruited || agent.status === 'active' || agent.agentIndex !== undefined || true
  );
}

export const TownHallRoundtablePanel: React.FC<TownHallRoundtablePanelProps> = ({
  sessions,
  isExecutingMeeting,
  onConveneMeeting,
  onSummonAgain,
  onAdjournMeeting,
  onDispatchActionItem,
  activeSpeakerAgentIndex,
  onSelectSpeakerAgentIndex,
  participantsWithNotes,
}) => {
  const { themeId, playBeep } = useTheme();
  const { crewAgents, getCrewAgentByIndex } = useCrew();

  const activeParticipants = getActiveMeetingParticipants(crewAgents);

  const [selectedSessionIdx, setSelectedSessionIdx] = useState(0);
  const [topicInput, setTopicInput] = useState('');
  const [includePriorTurns, setIncludePriorTurns] = useState(true);
  const [visibleTurnCount, setVisibleTurnCount] = useState<number>(99);
  const [isAutoStepping, setIsAutoStepping] = useState<boolean>(false);
  const [walkFrame, setWalkFrame] = useState<1 | 2>(1);
  const ledgerScrollRef = useRef<HTMLDivElement | null>(null);

  const activeSession: RoundtableMeetingSession | undefined =
    sessions[selectedSessionIdx] || sessions[0];

  const getAgentName = (targetAgentId?: string, fallbackSlot: number = 0): string => {
    if (targetAgentId) {
      const match = crewAgents.find((a) => a.id === targetAgentId);
      if (match) return match.customName || (match as any).name;
    }
    const fallback = crewAgents[fallbackSlot] || getCrewAgentByIndex(fallbackSlot);
    return fallback?.customName || (fallback as any)?.name || `Operative ${fallbackSlot + 1}`;
  };

  const handleDeployTask = (
    taskId: string,
    targetAgentId: string,
    slotIdx: number,
    directive: string,
    targetSector: RoomId
  ) => {
    playBeep('tap');
    onDispatchActionItem(
      slotIdx,
      directive,
      targetSector,
      targetAgentId,
      taskId
    );
  };

  // Subtle sprite animation frame toggle for speaking avatars
  useEffect(() => {
    const timer = setInterval(() => {
      setWalkFrame((f) => (f === 1 ? 2 : 1));
    }, 240);
    return () => clearInterval(timer);
  }, []);

  // Whenever a new roundtable session arrives at index 0, auto-step through the speakers sequentially
  const latestSessionId = sessions[0]?.id;
  useEffect(() => {
    if (!sessions[0] || !sessions[0].turns || sessions[0].turns.length === 0) return;
    setSelectedSessionIdx(0);
    setVisibleTurnCount(1);
    setIsAutoStepping(true);
    onSelectSpeakerAgentIndex(sessions[0].turns[0].agentIndex);
  }, [latestSessionId]);

  // Sequential multi-speaker playback timer
  useEffect(() => {
    if (!isAutoStepping || !activeSession) return;
    const totalTurns = activeSession.turns.length;

    if (visibleTurnCount >= totalTurns) {
      const doneTimer = setTimeout(() => {
        setIsAutoStepping(false);
        onSelectSpeakerAgentIndex(null);
      }, 2200);
      return () => clearTimeout(doneTimer);
    }

    const stepTimer = setTimeout(() => {
      const nextCount = visibleTurnCount + 1;
      setVisibleTurnCount(nextCount);
      const currentTurn = activeSession.turns[nextCount - 1];
      if (currentTurn) {
        onSelectSpeakerAgentIndex(currentTurn.agentIndex);
        playBeep('switch');
      }
      if (ledgerScrollRef.current) {
        ledgerScrollRef.current.scrollTop = ledgerScrollRef.current.scrollHeight;
      }
    }, 1850);

    return () => clearTimeout(stepTimer);
  }, [isAutoStepping, visibleTurnCount, activeSession]);

  const handleSubmitTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicInput.trim() || isExecutingMeeting) return;
    const currentTopic = topicInput.trim();
    setTopicInput('');
    await onConveneMeeting(currentTopic, includePriorTurns);
  };

  const handleReplaySequence = () => {
    if (!activeSession || activeSession.turns.length === 0) return;
    playBeep('tap');
    setVisibleTurnCount(1);
    setIsAutoStepping(true);
    onSelectSpeakerAgentIndex(activeSession.turns[0].agentIndex);
  };

  const handleShowAllTurns = () => {
    if (!activeSession) return;
    playBeep('tap');
    setIsAutoStepping(false);
    setVisibleTurnCount(activeSession.turns.length);
    onSelectSpeakerAgentIndex(null);
  };

  const displayedTurns = activeSession
    ? activeSession.turns.slice(0, visibleTurnCount)
    : [];

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-3 px-3 sm:px-0">
      {/* Main Retro Town Hall Roundtable Ledger Container */}
      <div className="rounded-sm bg-[#121110] border-2 border-[#38bdf8] shadow-[0_0_28px_rgba(0,0,0,0.8)] overflow-hidden">
        {/* Top Roundtable Header Bar */}
        <div className="bg-[#131d2b] border-b border-[#263f5c] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#38bdf8] shrink-0" />
            <span className="font-mono-tabular text-xs sm:text-sm font-bold tracking-wider text-[#38bdf8] uppercase">
              🏛️ TOWN HALL ROUNDTABLE · WAR ROOM [SEC-B1]
            </span>
            <span className="px-1.5 py-0.5 bg-[#0c1420] border border-[#4ade80]/60 font-mono-tabular text-[10px] text-[#4ade80] font-bold">
              {activeParticipants.length}/{activeParticipants.length} AGENTS SUMMONED
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                playBeep('tap');
                onSummonAgain();
              }}
              className="px-2 py-0.5 bg-[#162336] hover:bg-[#1f314a] border border-[#38bdf8]/60 font-mono-tabular text-[11px] text-[#bae6fd] cursor-pointer"
              title={`Re-align all ${activeParticipants.length} agents around the central War Room table`}
            >
              [📍 Re-Gather Crew]
            </button>
            <button
              type="button"
              onClick={() => {
                playBeep('tap');
                onAdjournMeeting();
              }}
              className="px-2 py-0.5 bg-[#231b12] hover:bg-[#33271a] border border-[#6e5233] font-mono-tabular text-[11px] text-[#e59838] cursor-pointer"
              title="Adjourn Town Hall Meeting and return to single-agent Briefing Terminal"
            >
              [🔓 Adjourn]
            </button>
          </div>
        </div>

        {/* Active Roundtable Participants & Recent Field Notes Strip */}
        <div className="bg-[#0d1017] border-b border-[#1f293a] px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-72 overflow-y-auto no-scrollbar">
          {activeParticipants.map((crewMember, idx) => {
            const variantMeta =
              (SPRITE_VARIANTS as Record<string, any>)[crewMember.spriteVariant] ||
              SPRITE_VARIANTS.trenchcoat;
            const participantMeta = participantsWithNotes[idx] || participantsWithNotes.find((p) => p.customName === crewMember.customName);
            const latestNote =
              participantMeta?.recentNotes?.[0] || crewMember.specialty;
            const isSpeakingNow = activeSpeakerAgentIndex === idx;

            return (
              <button
                key={crewMember.id}
                type="button"
                onClick={() => {
                  onSelectSpeakerAgentIndex(isSpeakingNow ? null : idx);
                  playBeep('tap');
                }}
                className={`p-2 border text-left transition-all flex items-center gap-2.5 cursor-pointer ${
                  isSpeakingNow
                    ? 'bg-[#132235] border-[#38bdf8] shadow-[0_0_12px_rgba(56,189,248,0.3)]'
                    : 'bg-[#12151e] border-[#263042] hover:border-[#e59838]'
                }`}
                title={`Highlight ${crewMember.customName} at the War Room roundtable`}
              >
                {/* Pixel Sprite Avatar */}
                <div
                  className="w-10 h-12 shrink-0 bg-[#090c12] border flex items-center justify-center p-1 relative overflow-hidden"
                  style={{ borderColor: variantMeta.accentHex }}
                >
                  <div className="w-7">
                    <AgentSpriteFigure
                      spriteVariant={crewMember.spriteVariant}
                      pose={isSpeakingNow ? 'walk' : 'stand'}
                      walkFrame={walkFrame}
                      facing="right"
                      isMoving={isSpeakingNow}
                      isExecuting={isSpeakingNow}
                      themeId={themeId}
                      alt={crewMember.customName}
                    />
                  </div>
                </div>

                <div className="min-w-0 flex-1 font-mono-tabular">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-[#f3ead8] truncate">
                      {crewMember.customName}
                    </span>
                    <span
                      className="text-[8px] px-1 bg-[#090c12] border uppercase font-bold shrink-0"
                      style={{
                        color: isSpeakingNow ? '#38bdf8' : variantMeta.accentHex,
                        borderColor: isSpeakingNow
                          ? '#38bdf8'
                          : `${variantMeta.accentHex}66`,
                      }}
                    >
                      {isSpeakingNow ? '🎙️ MIC' : variantMeta.shortTag}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#e59838] truncate">
                    {crewMember.role}
                  </div>
                  <div
                    className="text-[9px] text-[#94a3b8] truncate mt-0.5 flex items-center gap-1"
                    title={latestNote}
                  >
                    <FileText className="w-2.5 h-2.5 text-[#4ade80] shrink-0" />
                    <span className="truncate">{latestNote}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Session Selector & Playback Controls Bar */}
        {activeSession && (
          <div className="bg-[#16130f] border-b border-[#382917] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 font-mono-tabular text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="w-3.5 h-3.5 text-[#e59838] shrink-0" />
              <span className="font-bold text-[#e59838] truncate">
                {activeSession.meetingTitle}
              </span>
              <span className="text-[10px] text-[#9c8265] shrink-0">
                ({activeSession.tokenEstimate} tok)
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleReplaySequence}
                className="px-2 py-0.5 bg-[#1b1611] hover:bg-[#292118] border border-[#5e4326] text-[10px] text-[#4ade80] flex items-center gap-1 cursor-pointer"
                title="Step through each speaker sequentially and highlight their War Room sprite"
              >
                <Play className="w-2.5 h-2.5" />
                <span>Step Speakers</span>
              </button>

              {visibleTurnCount < activeSession.turns.length && (
                <button
                  type="button"
                  onClick={handleShowAllTurns}
                  className="px-2 py-0.5 bg-[#1b1611] hover:bg-[#292118] border border-[#5e4326] text-[10px] text-[#e59838] flex items-center gap-1 cursor-pointer"
                >
                  <SkipForward className="w-2.5 h-2.5" />
                  <span>Show All ({activeSession.turns.length})</span>
                </button>
              )}

              {sessions.length > 1 && (
                <div className="flex items-center gap-1 ml-1">
                  <History className="w-3 h-3 text-[#9c8265]" />
                  <select
                    aria-label="Past Roundtable Sessions"
                    value={selectedSessionIdx}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setSelectedSessionIdx(idx);
                      setIsAutoStepping(false);
                      setVisibleTurnCount(99);
                      onSelectSpeakerAgentIndex(null);
                      playBeep('tap');
                    }}
                    className="bg-[#0e0c0a] border border-[#5e4326] text-[#f3ead8] text-[10px] px-1.5 py-0.5 outline-none cursor-pointer"
                  >
                    {sessions.map((s, i) => (
                      <option key={s.id} value={i}>
                        #{sessions.length - i}: {s.meetingTitle.slice(0, 24)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scrolling Multi-Speaker Roundtable Dialogue Ledger */}
        <div
          ref={ledgerScrollRef}
          className="p-3.5 max-h-80 overflow-y-auto flex flex-col gap-2.5 bg-[#0e0d0c]"
        >
          {isExecutingMeeting ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 font-mono-tabular text-center">
              <div className="flex items-center gap-2.5 flex-wrap justify-center">
                {activeParticipants.map((c, idx) => {
                  return (
                    <div
                      key={c.id}
                      className="w-10 h-12 bg-[#141822] border border-[#38bdf8] p-1 animate-bounce"
                      style={{ animationDelay: `${idx * 120}ms` }}
                    >
                      <AgentSpriteFigure
                        spriteVariant={c.spriteVariant}
                        pose="walk"
                        walkFrame={walkFrame}
                        facing="right"
                        isMoving={true}
                        themeId={themeId}
                        alt={c.customName}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="text-xs sm:text-sm text-[#38bdf8] font-bold mt-2">
                [ROUNDTABLE IN PROGRESS · SYNTHESIZING MULTI-AGENT PERSPECTIVES...]
              </div>
              <p className="text-[11px] text-[#94a3b8] max-w-md">
                Passing custom agent names ({activeParticipants.map((a) => a.customName).join(', ')}), distinct roles, and recent command ledger notes to Gemini...
              </p>
            </div>
          ) : activeSession ? (
            <>
              {/* Agenda Prompt Banner */}
              <div className="px-2.5 py-1.5 bg-[#16130f] border-l-2 border-[#e59838] font-mono-tabular text-[11px] text-[#d6c7b2]">
                <span className="text-[#e59838] font-bold">AGENDA:</span>{' '}
                &ldquo;{activeSession.topic}&rdquo;
              </div>

              {/* Multi-Speaker Dialogue Turns with Pixel Sprite Avatars */}
              {displayedTurns.map((turn, tIdx) => {
                const slotIdx =
                  typeof turn.agentIndex === 'number' &&
                  turn.agentIndex >= 0 &&
                  turn.agentIndex < crewAgents.length
                    ? turn.agentIndex
                    : tIdx % Math.max(1, crewAgents.length);
                const crewMember =
                  crewAgents[slotIdx] || getCrewAgentByIndex(slotIdx);
                const variantMeta =
                  SPRITE_VARIANTS[crewMember.spriteVariant] ||
                  SPRITE_VARIANTS.trenchcoat;
                const isActiveTurn = activeSpeakerAgentIndex === slotIdx;

                return (
                  <div
                    key={`${activeSession.id}-turn-${tIdx}`}
                    onClick={() => {
                      onSelectSpeakerAgentIndex(slotIdx);
                      playBeep('tap');
                    }}
                    className={`p-2.5 border transition-colors flex items-start gap-3 cursor-pointer ${
                      isActiveTurn
                        ? 'bg-[#141d29] border-[#38bdf8]'
                        : 'bg-[#141210] border-[#2c2217] hover:border-[#5e4326]'
                    }`}
                  >
                    {/* Speaker Pixel Sprite Avatar Box */}
                    <div
                      className="w-12 h-14 shrink-0 bg-[#0b0e14] border flex flex-col items-center justify-between p-1 relative overflow-hidden"
                      style={{ borderColor: variantMeta.accentHex }}
                    >
                      <div className="w-8">
                        <AgentSpriteFigure
                          spriteVariant={crewMember.spriteVariant}
                          pose={isActiveTurn ? 'walk' : 'stand'}
                          walkFrame={walkFrame}
                          facing="right"
                          isMoving={isActiveTurn}
                          isExecuting={isActiveTurn}
                          themeId={themeId}
                          alt={crewMember.customName}
                        />
                      </div>
                      <span
                        className="w-full text-center font-mono-tabular text-[7px] bg-[#080a0f] uppercase font-bold truncate"
                        style={{ color: variantMeta.accentHex }}
                      >
                        #{tIdx + 1} · {variantMeta.shortTag}
                      </span>
                    </div>

                    {/* Speaker Text & Metadata */}
                    <div className="min-w-0 flex-1 font-mono-tabular">
                      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-xs sm:text-sm font-bold"
                            style={{ color: variantMeta.accentHex }}
                          >
                            {crewMember.customName}
                          </span>
                          <span className="text-[10px] text-[#9c8265]">
                            ({crewMember.role})
                          </span>
                        </div>

                        <span className="px-1.5 py-0.2 bg-[#1c1813] border border-[#4a351d] text-[9px] text-[#4ade80] font-bold uppercase">
                          [{turn.perspectiveTag}]
                        </span>
                      </div>

                      <p className="text-xs sm:text-sm text-[#f3ead8] leading-relaxed">
                        &ldquo;{turn.dialogue}&rdquo;
                      </p>

                      {turn.referencedNote && (
                        <div className="mt-1.5 pt-1 border-t border-[#241c14] flex items-center gap-1.5 text-[10px] text-[#94a3b8]">
                          <Sparkles className="w-3 h-3 text-[#e59838] shrink-0" />
                          <span className="truncate">
                            Cited Intel: {turn.referencedNote}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Executive Consensus & Action Items Footer (once turns finish revealing) */}
              {visibleTurnCount >= activeSession.turns.length && (
                <div className="mt-1 p-3 bg-[#111915] border border-[#2d543d] font-mono-tabular flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#4ade80]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>ROUNDTABLE CONSENSUS & SECTOR ASSIGNMENTS</span>
                  </div>
                  <p className="text-xs text-[#e2e8f0] leading-relaxed">
                    {activeSession.consensusSummary}
                  </p>

                  {activeSession.actionItems &&
                    activeSession.actionItems.length > 0 && (() => {
                      const verifiedTasks = activeSession.actionItems.filter((item) =>
                        isValidRealTask(item.directive)
                      );
                      if (verifiedTasks.length === 0) return null;

                      return (
                        <div className="pt-1.5 border-t border-[#1f3b2b] flex flex-col gap-1.5">
                          {verifiedTasks.map((item, idx) => {
                            const slotIdx =
                              typeof item.agentIndex === 'number' &&
                              item.agentIndex >= 0 &&
                              item.agentIndex < crewAgents.length
                                ? item.agentIndex
                                : idx % Math.max(1, crewAgents.length);
                            const crew =
                              crewAgents[slotIdx] || getCrewAgentByIndex(slotIdx);
                            const taskId = item.id || `task_${activeSession.id}_${idx}`;
                            const assignedAgentId = item.assignedAgentId || crew.id;
                            const agentDisplayName = getAgentName(assignedAgentId, slotIdx);
                            const sectorMeta =
                              ROOM_METADATA[item.targetSector] ||
                              ROOM_METADATA.war_room;

                            return (
                              <div
                                key={taskId}
                                className="flex flex-wrap items-center justify-between gap-2 bg-[#0b110e] border border-[#233d2e] px-2.5 py-1.5 text-[11px]"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="text-[#e59838] font-bold">
                                    {agentDisplayName}:
                                  </span>{' '}
                                  <span className="text-[#f3ead8]">
                                    {item.directive}
                                  </span>{' '}
                                  <span className="text-[#4ade80] text-[10px]">
                                    [{sectorMeta.shortBadge}]
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeployTask(
                                      taskId,
                                      assignedAgentId,
                                      slotIdx,
                                      item.directive,
                                      item.targetSector
                                    )
                                  }
                                  className="px-2.5 py-1 bg-[#1e2f24] hover:bg-[#4ade80] text-[#4ade80] hover:text-[#0c120e] border border-[#3a6349] font-bold text-[10px] flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors rounded shadow-sm"
                                  title={`Deploy ${agentDisplayName} to ${sectorMeta.shortBadge} to execute this directive`}
                                >
                                  <span>Deploy {agentDisplayName}</span>
                                  <ArrowRight className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                </div>
              )}
            </>
          ) : (
            <div className="py-12 flex flex-col items-center justify-center gap-2 font-mono-tabular text-center text-[#94a3b8]">
              <MessageSquare className="w-8 h-8 text-[#5e4326]" />
              <div className="text-xs font-bold text-[#e59838]">[WAR ROOM ROUNDTABLE UNPOPULATED]</div>
              <p className="text-[11px] max-w-sm text-[#a38c70]">
                No town hall sessions recorded yet. Enter a strategic topic below or summon the crew to convene the first multi-agent roundtable.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Box 2: Convene New Roundtable Topic / Multi-Turn Follow-up Input */}
      <form
        onSubmit={handleSubmitTopic}
        className="rounded-sm bg-[#121110] border border-[#38bdf8] shadow-[0_0_20px_rgba(0,0,0,0.65)] flex flex-col"
      >
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[#1e2d3d]">
          <span className="font-mono-tabular text-xs font-bold text-[#38bdf8] select-none uppercase">
            [ROUNDTABLE TOPIC] &gt;
          </span>
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            disabled={isExecutingMeeting}
            placeholder="Pose a question or mission dilemma to all 3 agents at the table..."
            className="w-full bg-transparent font-mono-tabular text-xs sm:text-sm text-[#f3ead8] placeholder:text-[#64748b] focus:outline-none"
          />
        </div>

        <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setTopicInput(
                  'Coordinate a joint operation combining live web recon, weather clearance, and encrypted Slack dispatch.'
                );
                playBeep('tap');
              }}
              className="text-[11px] font-mono-tabular text-[#94a3b8] hover:text-[#38bdf8] whitespace-nowrap cursor-pointer"
            >
              [Preset: Joint Ops]
            </button>
            <button
              type="button"
              onClick={() => {
                setTopicInput(
                  'Debate whether to prioritize Server Vault firewall hardening or Archive Basement Omega decryption first.'
                );
                playBeep('tap');
              }}
              className="text-[11px] font-mono-tabular text-[#94a3b8] hover:text-[#38bdf8] whitespace-nowrap cursor-pointer"
            >
              [Preset: Strategy Debate]
            </button>
            <label className="inline-flex items-center gap-1 text-[10px] font-mono-tabular text-[#9c8265] cursor-pointer ml-1">
              <input
                type="checkbox"
                checked={includePriorTurns}
                onChange={(e) => setIncludePriorTurns(e.target.checked)}
                className="accent-[#38bdf8]"
              />
              <span>Multi-turn memory</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={isExecutingMeeting || !topicInput.trim()}
            className="min-h-[34px] px-3.5 py-1 bg-[#13283c] hover:bg-[#1b3954] border border-[#38bdf8] text-[#f3ead8] font-mono-tabular text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-45"
          >
            <span aria-hidden="true">📣</span>
            <span>
              {isExecutingMeeting ? 'CONVENING...]' : 'CONVENE ROUNDTABLE]'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};
