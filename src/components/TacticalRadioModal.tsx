import React, { useEffect, useRef, useState } from 'react';
import {
  Radio,
  Mic,
  MicOff,
  Square,
  Send,
  Settings,
  Volume2,
  Brain,
  Wifi,
} from 'lucide-react';
import { TacticalModalDialog } from './TacticalModalDialog';
import {
  TacticalRadioTransceiver,
  OPERATIVE_RADIO_CHANNELS,
  probeGeminiLiveProxy,
  type RadioOperativeId,
  type RadioLiveModelId,
  type RadioConnectionStatus,
  type RadioTranscriptEntry,
} from '../services/TacticalVoiceService';
import { useTheme } from '../context/ThemeContext';

export interface TacticalRadioModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultOperativeId?: RadioOperativeId;
  onDispatchDirective?: (directive: string, operativeId: RadioOperativeId) => void;
  onOpenSettings?: () => void;
}

export const TacticalRadioModal: React.FC<TacticalRadioModalProps> = ({
  isOpen,
  onClose,
  defaultOperativeId = 'vance',
  onDispatchDirective,
  onOpenSettings,
}) => {
  const { playBeep } = useTheme();
  const [selectedOp, setSelectedOp] = useState<RadioOperativeId>(defaultOperativeId);
  const [liveModel, setLiveModel] = useState<RadioLiveModelId>('gemini-3.8-live');
  const [status, setStatus] = useState<RadioConnectionStatus>('disconnected');
  const [statusDetail, setStatusDetail] = useState<string>('Transceiver idle');
  const [transportRoute, setTransportRoute] = useState<'cloudflare-proxy' | 'direct-byok' | null>(
    null
  );
  const [transcripts, setTranscripts] = useState<RadioTranscriptEntry[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [quickText, setQuickText] = useState('');
  const [proxyStatus, setProxyStatus] = useState<{
    proxyReachable: boolean;
    hasServerKey: boolean;
    hasClientByokKey: boolean;
  } | null>(null);

  const transceiverRef = useRef<TacticalRadioTransceiver | null>(null);

  useEffect(() => {
    if (!isOpen) {
      void transceiverRef.current?.disconnect();
      return;
    }
    probeGeminiLiveProxy().then((res) => {
      setProxyStatus({
        proxyReachable: res.proxyReachable,
        hasServerKey: res.hasServerKey,
        hasClientByokKey: res.hasClientByokKey,
      });
    });
  }, [isOpen]);

  useEffect(() => {
    const tx = new TacticalRadioTransceiver({
      onStatusChange: (s, detail) => {
        setStatus(s);
        if (detail) setStatusDetail(detail);
      },
      onTranscriptUpdate: (items) => setTranscripts(items),
      onAudioLevel: (lvl) => setAudioLevel(lvl),
      onTransportRoute: (route) => setTransportRoute(route),
      onDirectiveDispatched: (directive, opId) => {
        onDispatchDirective?.(directive, opId);
      },
    });
    transceiverRef.current = tx;
    return () => {
      void tx.disconnect();
    };
  }, []);

  const isConnected =
    status === 'standby' ||
    status === 'transmitting_ptt' ||
    status === 'receiving_voice' ||
    status === 'extended_thinking';

  const handleToggleCarrier = async () => {
    playBeep('switch');
    if (isConnected || status === 'connecting') {
      await transceiverRef.current?.disconnect();
      setTransportRoute(null);
      setStatusDetail('Carrier disconnected');
      return;
    }
    try {
      await transceiverRef.current?.connect(selectedOp, liveModel);
    } catch (err: any) {
      setStatusDetail(err?.message || 'Unable to establish Gemini Live link');
    }
  };

  const handleSwitchChannel = async (op: RadioOperativeId) => {
    playBeep('tap');
    setSelectedOp(op);
    if (isConnected) {
      try {
        await transceiverRef.current?.connect(op, liveModel);
      } catch {}
    }
  };

  const handlePttStart = async () => {
    if (!isConnected) return;
    playBeep('tap');
    try {
      await transceiverRef.current?.startPushToTalk();
    } catch (err: any) {
      setStatus('error');
      setStatusDetail(err?.message || 'Microphone permission denied');
    }
  };

  const handlePttEnd = () => {
    if (status === 'transmitting_ptt') {
      playBeep('tap');
    }
    transceiverRef.current?.stopPushToTalk();
  };

  const handleSendTextOverRadio = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickText.trim() || !isConnected) return;
    playBeep('tap');
    transceiverRef.current?.sendTextDispatchOverRadio(quickText.trim());
    setQuickText('');
  };

  const persona = OPERATIVE_RADIO_CHANNELS[selectedOp];

  return (
    <TacticalModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Tactical Push-To-Talk Live Radio"
      subtitle="Gemini Multimodal Live WebSocket Transceiver · Real-Time Barge-In Voice Comms"
      badge={
        transportRoute === 'cloudflare-proxy'
          ? 'CLOUDFLARE PROXY WS'
          : transportRoute === 'direct-byok'
          ? 'BYOK DIRECT WS'
          : persona.frequencyMhz
      }
      icon={<Radio className="w-4 h-4" />}
      maxWidthClass="max-w-4xl"
    >
      <div className="p-4 grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Left 5 Columns: Channel Selector, Model Mode, & Tactile Push-To-Talk Deck */}
        <div className="md:col-span-5 flex flex-col gap-3">
          {/* Operative Frequency Channels */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]">
              Select Operative Frequency
            </span>
            {(['vance', 'nyx', 'cipher'] as RadioOperativeId[]).map((opId) => {
              const ch = OPERATIVE_RADIO_CHANNELS[opId];
              const active = selectedOp === opId;
              return (
                <button
                  key={opId}
                  type="button"
                  onClick={() => void handleSwitchChannel(opId)}
                  className={`tactical-ctrl p-2.5 border text-left flex items-center justify-between gap-2 cursor-pointer ${
                    active
                      ? 'bg-[#12221c] border-[#4ade80] text-white'
                      : 'bg-[#0e1422] border-[#26344f] text-[#cbd5e1] hover:border-[#475569]'
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold" style={{ color: ch.accentHex }}>
                      {ch.callsign}
                    </div>
                    <div className="text-[10px] text-[#94a3b8]">{ch.role}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-[#e2e8f0]">{ch.frequencyMhz}</div>
                    <div className="text-[9px] text-[#64748b]">Voice: {ch.voiceName}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Live Model Selector (`gemini-3.8-live` vs `gemini-3.8-live-extended-thinking`) */}
          <div className="p-2.5 bg-[#0f1524] border border-[#26344f] flex flex-col gap-1.5">
            <div className="text-[10px] font-bold uppercase text-[#94a3b8] flex items-center gap-1">
              <Brain className="w-3.5 h-3.5 text-[#38bdf8]" />
              <span>Gemini 3.8 Live Engine</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setLiveModel('gemini-3.8-live')}
                className={`py-1.5 px-2 text-[10px] font-bold border cursor-pointer ${
                  liveModel === 'gemini-3.8-live'
                    ? 'bg-[#10291e] border-[#4ade80] text-[#4ade80]'
                    : 'bg-[#090d16] border-[#24324b] text-[#94a3b8]'
                }`}
              >
                ⚡ Low-Latency Live
              </button>
              <button
                type="button"
                onClick={() => setLiveModel('gemini-3.8-live-extended-thinking')}
                className={`py-1.5 px-2 text-[10px] font-bold border cursor-pointer ${
                  liveModel === 'gemini-3.8-live-extended-thinking'
                    ? 'bg-[#172554] border-[#60a5fa] text-[#93c5fd]'
                    : 'bg-[#090d16] border-[#24324b] text-[#94a3b8]'
                }`}
              >
                🧠 Extended Thinking
              </button>
            </div>
          </div>

          {/* Carrier Link Toggle */}
          <button
            type="button"
            onClick={() => void handleToggleCarrier()}
            className={`tactical-ctrl py-2.5 px-3 border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer ${
              isConnected
                ? 'bg-[#2a1215] hover:bg-[#3b181c] border-[#f87171] text-[#fca5a5]'
                : 'bg-[#10291e] hover:bg-[#163829] border-[#4ade80] text-[#4ade80]'
            }`}
          >
            <Wifi className="w-4 h-4" />
            <span>
              {status === 'connecting'
                ? 'HANDSHAKING WEBSOCKET...'
                : isConnected
                ? 'SEVER LIVE RADIO CARRIER'
                : `OPEN ${persona.callsign} CARRIER`}
            </span>
          </button>

          {/* Tactile Hold-to-Talk PTT Transceiver Pad */}
          <div className="p-3.5 bg-[#090d16] border border-[#283548] flex flex-col items-center gap-2.5">
            <button
              type="button"
              disabled={!isConnected}
              onPointerDown={() => void handlePttStart()}
              onPointerUp={handlePttEnd}
              onPointerCancel={handlePttEnd}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                  e.preventDefault();
                  void handlePttStart();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handlePttEnd();
                }
              }}
              className={`w-full py-5 border-2 text-xs font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-2 select-none touch-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all ${
                status === 'transmitting_ptt'
                  ? 'bg-[#450a0a] border-[#ef4444] text-white shadow-[0_0_24px_rgba(239,68,68,0.5)]'
                  : status === 'receiving_voice'
                  ? 'bg-[#0c2d48] border-[#38bdf8] text-[#bae6fd]'
                  : 'bg-[#111c2d] hover:bg-[#17263d] border-[#4ade80] text-[#4ade80]'
              }`}
            >
              {status === 'transmitting_ptt' ? (
                <Mic className="w-7 h-7 text-[#f87171] animate-pulse" />
              ) : status === 'receiving_voice' ? (
                <Volume2 className="w-7 h-7 text-[#38bdf8] animate-pulse" />
              ) : (
                <MicOff className="w-7 h-7 opacity-80" />
              )}
              <span>
                {status === 'transmitting_ptt'
                  ? 'TRANSMITTING 16kHz PCM — RELEASE TO SEND'
                  : status === 'receiving_voice'
                  ? `${persona.displayName.toUpperCase()} SPEAKING (HOLD TO BARGE IN)`
                  : 'HOLD PUSH-TO-TALK (OR SPACEBAR)'}
              </span>
            </button>

            {/* Live Audio VU Meter + Barge-In Cut Button */}
            <div className="w-full flex items-center gap-2">
              <div className="flex-1 h-2 bg-[#111827] border border-[#1f2937] overflow-hidden">
                <div
                  className="h-full transition-all duration-75"
                  style={{
                    width: `${Math.round(audioLevel * 100)}%`,
                    backgroundColor: status === 'transmitting_ptt' ? '#ef4444' : persona.accentHex,
                  }}
                />
              </div>
              {status === 'receiving_voice' && (
                <button
                  type="button"
                  onClick={() => transceiverRef.current?.bargeInInterrupt()}
                  className="px-2 py-0.5 bg-[#3b1216] border border-[#f87171] text-[10px] font-bold text-[#fca5a5] flex items-center gap-1 cursor-pointer"
                >
                  <Square className="w-2.5 h-2.5" />
                  <span>BARGE-IN CUT</span>
                </button>
              )}
            </div>

            <div className="w-full flex items-center justify-between text-[10px] text-[#94a3b8]">
              <span>STATUS: {status.toUpperCase()}</span>
              <span className="truncate max-w-[180px]">{statusDetail}</span>
            </div>

            {proxyStatus && !proxyStatus.hasServerKey && !proxyStatus.hasClientByokKey && onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="w-full py-1.5 px-2.5 bg-[#3b1d06] border border-[#f59e0b] text-[11px] font-bold text-[#fde68a] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Configure Gemini Key in Vault Settings</span>
              </button>
            )}
          </div>
        </div>

        {/* Right 7 Columns: Live Bidirectional Voice Transcript & Text-Over-Radio Input */}
        <div className="md:col-span-7 flex flex-col bg-[#080c14] border border-[#1e293b] min-h-[380px]">
          <div className="px-3 py-2 bg-[#0e1422] border-b border-[#1e293b] flex items-center justify-between text-[11px]">
            <span className="font-bold text-[#cbd5e1]">
              LIVE AUDIO TRANSCRIPTION &amp; NON-BLOCKING TOOL TELEMETRY
            </span>
            {status === 'extended_thinking' && (
              <span className="text-[#93c5fd] font-bold animate-pulse">
                [REASONING IN PROGRESS...]
              </span>
            )}
          </div>

          <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2 max-h-[340px]">
            {transcripts.length === 0 ? (
              <div className="m-auto text-center p-4 text-xs text-[#64748b] max-w-sm">
                Open the carrier and hold <strong>Push-To-Talk</strong> to speak directly with{' '}
                <strong className="text-[#cbd5e1]">{persona.displayName}</strong>. Ask them to check
                the Basement Evidence Graph, inspect Tripwire Deltas, or dispatch a mission!
              </div>
            ) : (
              transcripts.map((t) => (
                <div
                  key={t.id}
                  className={`p-2.5 border text-xs ${
                    t.speaker === 'COMMANDER'
                      ? 'bg-[#101c2e] border-[#2563eb]/50 text-[#dbeafe] ml-6'
                      : t.speaker === 'SYS_TOOL'
                      ? 'bg-[#1f1608] border-[#d97706]/50 text-[#fde68a] text-[11px]'
                      : 'bg-[#0d2118] border-[#10b981]/50 text-[#d1fae5] mr-6'
                  }`}
                >
                  <div className="text-[10px] font-bold opacity-75 mb-0.5">
                    {t.speaker === 'OPERATIVE'
                      ? OPERATIVE_RADIO_CHANNELS[t.operativeId].callsign
                      : t.speaker}
                  </div>
                  <div>{t.text}</div>
                </div>
              ))
            )}
          </div>

          {/* Optional Silent Text-to-Voice Dispatch Bar */}
          <form
            onSubmit={handleSendTextOverRadio}
            className="p-2.5 bg-[#0e1422] border-t border-[#1e293b] flex items-center gap-2"
          >
            <input
              type="text"
              disabled={!isConnected}
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              placeholder={
                isConnected
                  ? `Type silent radio cue to ${persona.displayName} (replies in voice)...`
                  : 'Open carrier first to transmit...'
              }
              className="flex-1 px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!isConnected || !quickText.trim()}
              className="tactical-ctrl px-3 py-1.5 bg-[#10291e] disabled:opacity-40 border border-[#4ade80] text-xs font-bold text-[#4ade80] flex items-center gap-1 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>TX</span>
            </button>
          </form>
        </div>
      </div>
    </TacticalModalDialog>
  );
};

export default TacticalRadioModal;
