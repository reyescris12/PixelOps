import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  RefreshCw,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Send,
  Hash,
  Bell,
} from 'lucide-react';
import { TacticalModalDialog } from './TacticalModalDialog';
import {
  listTripwireWatches,
  saveTripwireWatch,
  deleteTripwireWatch,
  listTripwireAlerts,
  updateTripwireAlertStatus,
  evaluateTripwireWatch,
  runDueTripwireChecks,
  type TripwireWatchDbEntry,
  type TripwireAlertDbEntry,
} from '../services/TripwireDiffService';
import { useTheme } from '../context/ThemeContext';

export interface TripwireWatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApproveAndDispatch?: (directive: string, assignedAgentId: string, assignedRoom: string) => void;
}

const CATEGORY_PRESETS: Array<{
  value: TripwireWatchDbEntry['category'];
  label: string;
  placeholder: string;
}> = [
  { value: 'dns', label: 'DNS Records (A / AAAA / MX / TXT)', placeholder: 'cloudflare.com' },
  { value: 'ct_certs', label: 'Certificate Transparency Logs (crt.sh)', placeholder: 'openai.com' },
  { value: 'usgs_seismic', label: 'USGS Seismic Grid (M4.5+ Telemetry)', placeholder: '4.5' },
  { value: 'maritime_ais', label: 'Maritime Chokepoint AIS Snapshot', placeholder: 'hormuz' },
  { value: 'web_hash', label: 'Web / ISW SITREP Structural Hash', placeholder: 'https://understandingwar.org' },
];

export const TripwireWatchModal: React.FC<TripwireWatchModalProps> = ({
  isOpen,
  onClose,
  onApproveAndDispatch,
}) => {
  const { playBeep } = useTheme();
  const [watches, setWatches] = useState<TripwireWatchDbEntry[]>([]);
  const [alerts, setAlerts] = useState<TripwireAlertDbEntry[]>([]);
  const [isSweeping, setIsSweeping] = useState(false);
  const [checkingWatchId, setCheckingWatchId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Add watchlist form
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<TripwireWatchDbEntry['category']>('dns');
  const [target, setTarget] = useState('cloudflare.com');
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [requireHumanApproval, setRequireHumanApproval] = useState(true);

  const refreshData = async () => {
    const [w, a] = await Promise.all([listTripwireWatches(), listTripwireAlerts()]);
    setWatches(w);
    setAlerts(a);
  };

  useEffect(() => {
    if (!isOpen) return;
    void refreshData();
    const onUpdate = () => void refreshData();
    window.addEventListener('pixelops:tripwire_updated', onUpdate);
    return () => window.removeEventListener('pixelops:tripwire_updated', onUpdate);
  }, [isOpen]);

  const handleCreateWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim()) return;
    playBeep('switch');

    const created = await saveTripwireWatch({
      id: `tw_${category}_${Date.now().toString(36)}`,
      label: label.trim() || `${category.toUpperCase()} Watch: ${target.trim()}`,
      category,
      target: target.trim(),
      assignedRoom: category === 'usgs_seismic' ? 'war_room' : 'comms_tower',
      assignedAgentId: 'nyx',
      intervalMinutes: Math.max(5, Number(intervalMinutes) || 30),
      enabled: true,
      requireHumanApproval,
    });

    setLabel('');
    setCheckingWatchId(created.id);
    const initial = await evaluateTripwireWatch(created);
    setCheckingWatchId(null);
    await refreshData();
    setStatusMsg(
      initial.outcome === 'baseline_established'
        ? `Locked initial SHA-256 baseline (${initial.sha256?.slice(0, 12)}…) for "${created.label}" — zero alert noise until verified delta.`
        : `Created watch "${created.label}" (${initial.outcome}).`
    );
  };

  const handleSweepAll = async () => {
    playBeep('switch');
    setIsSweeping(true);
    try {
      const results = await runDueTripwireChecks({ forceAll: true });
      const deltas = results.filter((r) => r.outcome === 'delta_detected').length;
      const unchanged = results.filter((r) => r.outcome === 'unchanged').length;
      const baselined = results.filter((r) => r.outcome === 'baseline_established').length;
      await refreshData();
      setStatusMsg(
        `Sweep complete: ${deltas} verified delta(s), ${unchanged} unchanged (zero-noise), ${baselined} newly baselined.`
      );
    } finally {
      setIsSweeping(false);
    }
  };

  const pendingAlerts = alerts.filter((a) => a.status === 'pending_approval');

  return (
    <TacticalModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Deterministic SHA-256 Tripwire Diffing"
      subtitle="Stateful DNS, CT Log, USGS & Maritime Snapshot Hashing · Zero-Noise Approval Gates"
      badge={`${pendingAlerts.length} PENDING GATES · ${watches.length} WATCHES`}
      icon={<Hash className="w-4 h-4" />}
      headerActions={
        <button
          type="button"
          onClick={() => void handleSweepAll()}
          disabled={isSweeping || watches.length === 0}
          className="tactical-ctrl min-h-[34px] px-2.5 py-1 bg-[#14233a] hover:bg-[#1c3252] disabled:opacity-40 border border-[#38bdf8] text-[11px] font-bold text-[#7dd3fc] flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSweeping ? 'animate-spin' : ''}`} />
          <span>SWEEP ALL NOW</span>
        </button>
      }
    >
      {statusMsg && (
        <div className="mx-4 mt-3 px-3 py-2 bg-[#10261d] border border-[#4ade80] text-xs text-[#bbf7d0] flex items-center justify-between gap-2">
          <span>{statusMsg}</span>
          {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
            <button
              type="button"
              onClick={() => Notification.requestPermission()}
              className="px-2 py-0.5 bg-[#0b1f16] border border-[#4ade80] text-[10px] font-bold text-[#4ade80] flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Bell className="w-3 h-3" />
              <span>Enable Push</span>
            </button>
          )}
        </div>
      )}

      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Human-in-the-Loop Delta Approval Queue + Active Watchlists */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Human-in-the-Loop Approval Gates */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-bold uppercase text-[#fbbf24] flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" />
              <span>Zero-Noise Verified Delta Approval Gates ({pendingAlerts.length})</span>
            </div>

            {alerts.length === 0 ? (
              <div className="p-4 bg-[#0e1422] border border-[#24324b] text-xs text-[#94a3b8]">
                Zero cryptographic deltas triggered. Unchanged scheduled checks increment silently
                without invoking any LLM tokens or generating hallucination alerts.
              </div>
            ) : (
              alerts.slice(0, 10).map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 border flex flex-col gap-2 ${
                    alert.status === 'pending_approval'
                      ? 'bg-[#261409] border-[#f59e0b]'
                      : 'bg-[#0e1422] border-[#26344f] opacity-80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold text-white">{alert.watchLabel}</span>
                      <div className="text-[11px] text-[#fde68a] mt-0.5">{alert.diffSummary}</div>
                    </div>
                    <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase bg-[#090d16] border border-[#475569] text-[#cbd5e1]">
                      {alert.status.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Exact Deterministic Diff Lines */}
                  {(alert.addedItems.length > 0 || alert.removedItems.length > 0) && (
                    <div className="p-2 bg-[#070a10] border border-[#1e293b] text-[11px] font-mono max-h-[120px] overflow-y-auto flex flex-col gap-0.5">
                      {alert.addedItems.slice(0, 6).map((line) => (
                        <div key={`+${line}`} className="text-[#4ade80] break-all">
                          + {line}
                        </div>
                      ))}
                      {alert.removedItems.slice(0, 6).map((line) => (
                        <div key={`-${line}`} className="text-[#f87171] break-all">
                          - {line}
                        </div>
                      ))}
                    </div>
                  )}

                  {alert.status === 'pending_approval' && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {onApproveAndDispatch && (
                        <button
                          type="button"
                          onClick={async () => {
                            playBeep('switch');
                            await updateTripwireAlertStatus(alert.id, 'approved_dispatched');
                            onApproveAndDispatch(
                              alert.recommendedDirective,
                              alert.assignedAgentId,
                              alert.assignedRoom
                            );
                            onClose();
                          }}
                          className="tactical-ctrl px-3 py-1.5 bg-[#10291e] hover:bg-[#173d2b] border border-[#4ade80] text-xs font-bold text-[#4ade80] flex items-center gap-1.5 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Approve &amp; Dispatch Operative</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          playBeep('tap');
                          await updateTripwireAlertStatus(alert.id, 'acknowledged');
                          await refreshData();
                        }}
                        className="px-2.5 py-1.5 bg-[#141d30] border border-[#334155] text-xs text-[#cbd5e1] flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Acknowledge</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          playBeep('tap');
                          await updateTripwireAlertStatus(alert.id, 'dismissed');
                          await refreshData();
                        }}
                        className="px-2.5 py-1.5 bg-[#241317] border border-[#7f1d1d] text-xs text-[#fca5a5] flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Dismiss</span>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Stateful Watchlist Ledger */}
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-bold uppercase text-[#94a3b8]">
              Armed Stateful Watchlists ({watches.length})
            </div>
            {watches.map((w) => (
              <div
                key={w.id}
                className="p-3 bg-[#0f1524] border border-[#26344f] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-white">{w.label}</span>
                    <span className="px-1.5 py-0.5 bg-[#172554] border border-[#3b82f6] text-[10px] font-bold text-[#93c5fd]">
                      {w.category.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#94a3b8] mt-0.5 truncate">
                    Target: <code className="text-[#cbd5e1]">{w.target}</code> · Every{' '}
                    {w.intervalMinutes}m
                  </div>
                  <div className="text-[10px] text-[#64748b] mt-1">
                    SHA-256:{' '}
                    <code className="text-[#4ade80]">
                      {w.lastSha256 ? `${w.lastSha256.slice(0, 16)}…` : 'Pending baseline'}
                    </code>{' '}
                    · Silent Unchanged Runs: <strong>{w.unchangedChecksCount}</strong> · Deltas:{' '}
                    <strong className="text-[#fbbf24]">{w.deltaCount}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={checkingWatchId === w.id}
                    onClick={async () => {
                      playBeep('tap');
                      setCheckingWatchId(w.id);
                      const res = await evaluateTripwireWatch(w);
                      setCheckingWatchId(null);
                      await refreshData();
                      setStatusMsg(`Checked "${w.label}": ${res.outcome.toUpperCase()}`);
                    }}
                    className="px-2 py-1 bg-[#14233a] border border-[#38bdf8] text-[10px] font-bold text-[#7dd3fc] flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${checkingWatchId === w.id ? 'animate-spin' : ''}`}
                    />
                    <span>DIFF</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete watch ${w.label}`}
                    onClick={async () => {
                      playBeep('tap');
                      await deleteTripwireWatch(w.id);
                      await refreshData();
                    }}
                    className="p-1.5 bg-[#2a1215] border border-[#ef4444]/60 text-[#fca5a5] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Arm New Stateful Watchlist */}
        <form
          onSubmit={handleCreateWatch}
          className="lg:col-span-5 p-3.5 bg-[#0f1523] border border-[#26334d] flex flex-col gap-3 h-fit"
        >
          <div className="text-xs font-bold uppercase text-[#4ade80] flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            <span>Arm New Deterministic Watchlist</span>
          </div>
          <p className="text-[11px] text-[#94a3b8]">
            Canonicalizes and hashes live records locally in IndexedDB during background Night Shift
            sweeps. Alerts fire strictly on verified cryptographic state changes.
          </p>

          <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
            <span>Telemetry Feed Type</span>
            <select
              value={category}
              onChange={(e) => {
                const nextCat = e.target.value as TripwireWatchDbEntry['category'];
                setCategory(nextCat);
                const preset = CATEGORY_PRESETS.find((p) => p.value === nextCat);
                if (preset) setTarget(preset.placeholder);
              }}
              className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
            >
              {CATEGORY_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
            <span>Target Domain / Threshold / URL</span>
            <input
              type="text"
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
            <span>Watchlist Callsign (Optional)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Primary Production DNS Tripwire"
              className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
            <span>Background Diff Cadence (Minutes)</span>
            <input
              type="number"
              min={5}
              max={1440}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-[#e2e8f0] cursor-pointer">
            <input
              type="checkbox"
              checked={requireHumanApproval}
              onChange={(e) => setRequireHumanApproval(e.target.checked)}
            />
            <span>Require Human-in-the-Loop Approval before Operative Dispatch</span>
          </label>

          <button
            type="submit"
            className="tactical-ctrl py-2 px-3 bg-[#10291e] hover:bg-[#173d2b] border border-[#4ade80] text-xs font-bold text-[#4ade80] flex items-center justify-center gap-2 cursor-pointer"
          >
            <Hash className="w-3.5 h-3.5" />
            <span>Lock Baseline SHA-256 &amp; Arm Tripwire</span>
          </button>
        </form>
      </div>
    </TacticalModalDialog>
  );
};

export default TripwireWatchModal;
