import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  BarChart2,
  Activity,
  Zap,
  DollarSign,
  Clock,
  CheckCircle2,
  RefreshCw,
  Compass,
  Radio,
  Lock,
  Plus,
  Trash2,
  Key,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  TelemetrySummary,
  loadTelemetrySummary,
  resetTelemetryLedger,
} from '../services/TelemetryStore';
import {
  listNaiZones,
  setPrimaryNaiZone,
  addNaiWatchZone,
  removeNaiWatchZone,
  selectPrimaryNaiZone,
  sweepLocalSensorBusNow,
  getSensorAdapterHealthList,
  getActiveSensorObservations,
  getConfiguredSensorPollSeconds,
  setConfiguredSensorPollSeconds,
  resolveNaiJurisdiction,
  isRadioScannerDisabledForNai,
  UK_WTA_2006_SAFE_MODE_LABEL,
  NaiTierLimitError,
  type NaiZoneConfig,
  type NaiJurisdiction,
  type SensorAdapterHealth,
} from '../services/LocalSensorBus';
import {
  saveNasaFirmsMapKey,
  getNasaFirmsMapKeyAsync,
} from '../services/BYOKVault';
import { TIER_LIMITS, type SubscriptionTier } from '../config/tierLimits';
import { CommandersPassModal, useSubscriptionTier } from './TierGate';

interface TelemetryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TelemetryModal: React.FC<TelemetryModalProps> = ({ isOpen, onClose }) => {
  const { playBeep } = useTheme();
  const tier = useSubscriptionTier();
  const tierLimits = TIER_LIMITS[tier];

  const [summary, setSummary] = useState<TelemetrySummary>(loadTelemetrySummary);
  const [naiZones, setNaiZones] = useState<NaiZoneConfig[]>([]);
  const [adapterHealth, setAdapterHealth] = useState<SensorAdapterHealth[]>(
    getSensorAdapterHealthList
  );
  const [activeObsCount, setActiveObsCount] = useState<number>(
    () => getActiveSensorObservations().length
  );
  const [isSweepingSensors, setIsSweepingSensors] = useState<boolean>(false);
  const [sensorBanner, setSensorBanner] = useState<{
    type: 'ok' | 'warn' | 'err';
    text: string;
  } | null>(null);

  // Editable primary/new NAI inputs
  const [naiLabel, setNaiLabel] = useState<string>('LOCAL-NAI-PRIMARY');
  const [naiLat, setNaiLat] = useState<string>('38.9072');
  const [naiLon, setNaiLon] = useState<string>('-77.0369');
  const [naiRadiusKm, setNaiRadiusKm] = useState<string>('35');
  const [naiJurisdiction, setNaiJurisdiction] = useState<NaiJurisdiction>('AUTO');
  const [pollSecondsInput, setPollSecondsInput] = useState<string>(() =>
    String(getConfiguredSensorPollSeconds())
  );

  // Optional encrypted NASA FIRMS VIIRS 375m MAP_KEY
  const [firmsKeyInput, setFirmsKeyInput] = useState<string>('');
  const [hasFirmsKeyConfigured, setHasFirmsKeyConfigured] = useState<boolean>(false);

  // Commander's Pass escalation modal state
  const [upgradeModalState, setUpgradeModalState] = useState<{
    open: boolean;
    min: SubscriptionTier;
    featureName: string;
  }>({
    open: false,
    min: 'pro',
    featureName: 'Multi-Sector NAI Watch Zones',
  });

  const refreshSensorState = useCallback(async () => {
    const zones = await listNaiZones();
    setNaiZones(zones);
    const primary = zones.find((z) => z.isPrimary) || zones[0];
    if (primary) {
      setNaiLabel(primary.label);
      setNaiLat(String(primary.lat));
      setNaiLon(String(primary.lon));
      setNaiRadiusKm(String(primary.radiusKm));
      setNaiJurisdiction(primary.jurisdiction);
    }
    setAdapterHealth(getSensorAdapterHealthList());
    setActiveObsCount(getActiveSensorObservations().length);
    setPollSecondsInput(String(getConfiguredSensorPollSeconds()));

    const existingFirms = await getNasaFirmsMapKeyAsync();
    setHasFirmsKeyConfigured(Boolean(existingFirms));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setSummary(loadTelemetrySummary());
    refreshSensorState();

    const onBusUpdated = () => {
      setAdapterHealth(getSensorAdapterHealthList());
      setActiveObsCount(getActiveSensorObservations().length);
    };
    window.addEventListener('pixelops:sensor-bus-updated', onBusUpdated);
    window.addEventListener('pixelops:nai-updated', refreshSensorState);
    return () => {
      window.removeEventListener('pixelops:sensor-bus-updated', onBusUpdated);
      window.removeEventListener('pixelops:nai-updated', refreshSensorState);
    };
  }, [isOpen, refreshSensorState]);

  if (!isOpen) return null;

  const primaryZone = naiZones.find((z) => z.isPrimary) || naiZones[0] || null;
  const previewLat = Number(naiLat);
  const previewLon = Number(naiLon);
  const resolvedJurisdiction = resolveNaiJurisdiction({
    lat: Number.isFinite(previewLat) ? previewLat : primaryZone?.lat ?? 38.9072,
    lon: Number.isFinite(previewLon) ? previewLon : primaryZone?.lon ?? -77.0369,
    jurisdiction: naiJurisdiction,
  });
  const ukScannerLocked = isRadioScannerDisabledForNai({
    lat: Number.isFinite(previewLat) ? previewLat : primaryZone?.lat ?? 38.9072,
    lon: Number.isFinite(previewLon) ? previewLon : primaryZone?.lon ?? -77.0369,
    jurisdiction: naiJurisdiction,
  });

  const handleSavePrimaryNai = async () => {
    const latNum = Number(naiLat);
    const lonNum = Number(naiLon);
    const radNum = Number(naiRadiusKm);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setSensorBanner({ type: 'err', text: 'Latitude must be between -90 and 90.' });
      return;
    }
    if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
      setSensorBanner({ type: 'err', text: 'Longitude must be between -180 and 180.' });
      return;
    }
    try {
      const updated = await setPrimaryNaiZone({
        label: naiLabel,
        lat: latNum,
        lon: lonNum,
        radiusKm: radNum,
        jurisdiction: naiJurisdiction,
      });
      const nextPoll = setConfiguredSensorPollSeconds(Number(pollSecondsInput) || 60);
      setPollSecondsInput(String(nextPoll));
      await refreshSensorState();
      setSensorBanner({
        type: 'ok',
        text: `Active NAI locked: ${updated.label} [${updated.lat}, ${updated.lon} • ${updated.radiusKm}km • ${resolveNaiJurisdiction(updated)}]`,
      });
      handleSweepSectorNow();
    } catch (err: any) {
      setSensorBanner({ type: 'err', text: err?.message || 'Failed to update NAI.' });
    }
  };

  const handleAddWatchZone = async () => {
    const latNum = Number(naiLat);
    const lonNum = Number(naiLon);
    const radNum = Number(naiRadiusKm);
    try {
      const added = await addNaiWatchZone({
        label: naiLabel || `SECTOR-${naiZones.length + 1}`,
        lat: latNum,
        lon: lonNum,
        radiusKm: radNum,
        jurisdiction: naiJurisdiction,
      });
      await refreshSensorState();
      setSensorBanner({
        type: 'ok',
        text: `Added watch zone "${added.label}" (${naiZones.length + 1}/${tierLimits.maxNais}).`,
      });
    } catch (err: any) {
      if (err instanceof NaiTierLimitError || err?.code === 'NAI_TIER_LIMIT_REACHED') {
        playBeep('error');
        setUpgradeModalState({
          open: true,
          min: err.requiredTier || 'pro',
          featureName: `Multi-Sector Watch Zones (${naiZones.length}/${tierLimits.maxNais} active on ${tier.toUpperCase()})`,
        });
        return;
      }
      setSensorBanner({ type: 'err', text: err?.message || 'Could not add watch zone.' });
    }
  };

  const handleSweepSectorNow = async () => {
    if (isSweepingSensors) return;
    setIsSweepingSensors(true);
    try {
      const report = await sweepLocalSensorBusNow();
      setAdapterHealth(report.adapterHealth);
      setActiveObsCount(report.observations.length);
      setSensorBanner({
        type: 'ok',
        text: `SECTOR SWEEP COMPLETE — ${report.observations.length} live observations (${report.materialChangesEmitted} deltas, ${report.unchangedPollsDropped} unchanged polls dropped @ $0 tokens).`,
      });
    } catch (err: any) {
      setSensorBanner({
        type: 'err',
        text: err?.message || 'Sensor sweep encountered an error.',
      });
    } finally {
      setIsSweepingSensors(false);
    }
  };

  const handleSaveFirmsKey = async () => {
    await saveNasaFirmsMapKey(firmsKeyInput);
    const stored = await getNasaFirmsMapKeyAsync();
    setHasFirmsKeyConfigured(Boolean(stored));
    setFirmsKeyInput('');
    setSensorBanner({
      type: 'ok',
      text: stored
        ? 'NASA_FIRMS_MAP_KEY encrypted in BYOKVault. VIIRS 375m orbital thermal collector armed.'
        : 'Cleared NASA_FIRMS_MAP_KEY (FIRMS: KEY OPTIONAL mode active).',
    });
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to purge all telemetry and cost logs?')) {
      playBeep('error');
      setSummary(resetTelemetryLedger());
    }
  };

  const totalRuns = summary.totalTasksCompleted + summary.totalTasksFailed;
  const successRate =
    totalRuns > 0 ? Math.round((summary.totalTasksCompleted / totalRuns) * 100) : 100;
  const avgDurationSec = totalRuns > 0 ? Math.round(summary.totalRuntimeMs / totalRuns / 1000) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl bg-[#0d1117] border border-emerald-500/40 p-5 sm:p-6 shadow-[0_0_30px_rgba(16,185,129,0.15)] flex flex-col gap-5 max-h-[92vh] overflow-y-auto font-mono">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-emerald-500/30 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-emerald-300 tracking-wider">
                TELEMETRY, NAI WATCH ZONES &amp; SENSOR BUS [HUD]
              </h2>
              <p className="text-xs text-emerald-500/80">
                Geofenced pre-media sensor collectors, jurisdiction OPSEC &amp; token cost ledger
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-emerald-400 hover:text-emerald-200 hover:bg-emerald-950/50 cursor-pointer transition-colors"
            aria-label="Close telemetry modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ================================================================ */}
        {/* LIVE PRE-MEDIA LOCAL SENSOR BUS & NAI WATCH ZONE CONFIGURATOR    */}
        {/* ================================================================ */}
        <div className="rounded-xl bg-[#080d12] border border-cyan-500/40 p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/25 pb-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Compass className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider">
                NAI Watch Zone &amp; Pre-Media Sensor Bus
              </span>
              <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 uppercase">
                CLEARANCE: {tier} ({naiZones.length}/{tierLimits.maxNais} NAIs)
              </span>
              <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-200">
                JURISDICTION: {resolvedJurisdiction}
              </span>
            </div>

            <button
              type="button"
              disabled={isSweepingSensors}
              onClick={handleSweepSectorNow}
              className="px-3 py-1.5 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/70 text-emerald-100 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSweepingSensors ? 'animate-spin' : ''}`} />
              <span>[⚡ SWEEP SECTOR NOW]</span>
            </button>
          </div>

          {/* Strict Legal Guardrail Banner when UK_EU Jurisdiction Active */}
          {ukScannerLocked && (
            <div className="px-3 py-2 rounded bg-emerald-950/55 border border-emerald-500/60 text-emerald-200 text-[11px] flex items-center gap-2">
              <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold text-emerald-300">{UK_WTA_2006_SAFE_MODE_LABEL}</span>
                <span className="text-emerald-400/80 block text-[10px]">
                  Private VHF/UHF radio voice scanner modules are hard-disabled in UK/EU airspace; UK Environment Agency Floods, TfL &amp; WebTRIS feeds active.
                </span>
              </div>
            </div>
          )}

          {/* NAI Coordinate & Jurisdiction Editor */}
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 text-[11px]">
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label htmlFor="telemetry-nai-label" className="text-[10px] text-slate-400">
                SECTOR / NAI LABEL
              </label>
              <input
                id="telemetry-nai-label"
                name="telemetry_nai_label"
                type="text"
                value={naiLabel}
                onChange={(e) => setNaiLabel(e.target.value)}
                className="px-2 py-1.5 bg-black border border-slate-700 rounded text-emerald-200 focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="telemetry-nai-lat" className="text-[10px] text-slate-400">
                LATITUDE
              </label>
              <input
                id="telemetry-nai-lat"
                name="telemetry_nai_lat"
                type="number"
                step="0.0001"
                value={naiLat}
                onChange={(e) => setNaiLat(e.target.value)}
                className="px-2 py-1.5 bg-black border border-slate-700 rounded text-emerald-200 focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="telemetry-nai-lon" className="text-[10px] text-slate-400">
                LONGITUDE
              </label>
              <input
                id="telemetry-nai-lon"
                name="telemetry_nai_lon"
                type="number"
                step="0.0001"
                value={naiLon}
                onChange={(e) => setNaiLon(e.target.value)}
                className="px-2 py-1.5 bg-black border border-slate-700 rounded text-emerald-200 focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="telemetry-nai-radius" className="text-[10px] text-slate-400">
                RADIUS (10-150km)
              </label>
              <input
                id="telemetry-nai-radius"
                name="telemetry_nai_radius"
                type="number"
                min={10}
                max={150}
                value={naiRadiusKm}
                onChange={(e) => setNaiRadiusKm(e.target.value)}
                className="px-2 py-1.5 bg-black border border-slate-700 rounded text-emerald-200 focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="telemetry-nai-jurisdiction" className="text-[10px] text-slate-400">
                JURISDICTION
              </label>
              <select
                id="telemetry-nai-jurisdiction"
                name="telemetry_nai_jurisdiction"
                value={naiJurisdiction}
                onChange={(e) => setNaiJurisdiction(e.target.value as NaiJurisdiction)}
                className="px-2 py-1.5 bg-black border border-slate-700 rounded text-emerald-200 focus:outline-none focus:border-cyan-400"
              >
                <option value="AUTO">AUTO (Local BBox)</option>
                <option value="UK_EU">UK_EU (WTA Safe)</option>
                <option value="US_NA">US_NA (NOAA CAP)</option>
                <option value="GLOBAL">GLOBAL</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="telemetry-sensor-poll-sec" className="text-[10px] text-slate-400">
                POLL CADENCE (MIN {tierLimits.minPollSeconds}s):
              </label>
              <input
                id="telemetry-sensor-poll-sec"
                name="telemetry_sensor_poll_sec"
                type="number"
                min={tierLimits.minPollSeconds}
                max={600}
                value={pollSecondsInput}
                onChange={(e) => setPollSecondsInput(e.target.value)}
                className="w-20 px-2 py-1 bg-black border border-slate-700 rounded text-cyan-200 text-[11px]"
              />
              <span className="text-[10px] text-slate-500">
                Active Pins: <strong className="text-emerald-300">{activeObsCount}</strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSavePrimaryNai}
                className="px-3 py-1.5 rounded bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 text-[11px] font-bold cursor-pointer"
              >
                SAVE &amp; LOCK PRIMARY NAI
              </button>
              <button
                type="button"
                onClick={handleAddWatchZone}
                className="px-2.5 py-1.5 rounded bg-amber-950/70 hover:bg-amber-900/70 border border-amber-500/60 text-amber-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>ADD WATCH ZONE</span>
              </button>
            </div>
          </div>

          {/* Saved Multi-NAI Watch Zones List */}
          {naiZones.length > 1 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-800">
              {naiZones.map((z) => (
                <div
                  key={z.id}
                  className={`px-2 py-1 rounded border text-[10px] flex items-center gap-1.5 ${
                    z.isPrimary
                      ? 'bg-emerald-950/60 border-emerald-400/70 text-emerald-200'
                      : 'bg-slate-900 border-slate-700 text-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={async () => {
                      await selectPrimaryNaiZone(z.id);
                      await refreshSensorState();
                    }}
                    className="font-bold cursor-pointer hover:text-white"
                  >
                    {z.isPrimary ? '★ ' : ''}
                    {z.label} ({z.radiusKm}km)
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await removeNaiWatchZone(z.id);
                      await refreshSensorState();
                    }}
                    aria-label={`Remove watch zone ${z.label}`}
                    className="text-red-400 hover:text-red-200 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 5-Adapter Live Health Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1">
            {adapterHealth.map((ad) => {
              const badge =
                ad.badgeText ||
                (ad.status === 'OPTIONAL_KEY_MISSING' ? 'FIRMS: KEY OPTIONAL' : ad.status);
              return (
                <div
                  key={ad.adapterId}
                  className="p-2 rounded bg-black/75 border border-slate-800 flex flex-col justify-between gap-1 text-[10px]"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-cyan-300 truncate">{ad.adapterId}</span>
                    <Radio className="w-3 h-3 text-emerald-400 shrink-0" />
                  </div>
                  <div
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border w-fit ${
                      ad.status === 'OK'
                        ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                        : ad.status === 'OPTIONAL_KEY_MISSING'
                        ? 'bg-amber-950/70 border-amber-500/50 text-amber-300'
                        : ad.status === 'ERROR'
                        ? 'bg-red-950/80 border-red-500/60 text-red-300'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    {badge}
                  </div>
                  <div className="text-[9px] text-slate-400 flex items-center justify-between">
                    <span>{ad.latencyMs > 0 ? `${ad.latencyMs}ms` : '—'}</span>
                    <span>OBS: {ad.observationCount}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Optional Encrypted NASA FIRMS VIIRS 375m Key Input */}
          <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-slate-800/80 text-[10px]">
            <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-slate-300 font-bold">
              NASA FIRMS VIIRS 375m:
            </span>
            <span
              className={`px-1.5 py-0.5 rounded border font-bold text-[9px] ${
                hasFirmsKeyConfigured
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
              }`}
            >
              {hasFirmsKeyConfigured ? 'FIRMS: VAULT KEY ARMED' : 'FIRMS: KEY OPTIONAL'}
            </span>
            <input
              id="telemetry-firms-map-key"
              name="telemetry_firms_map_key"
              type="password"
              value={firmsKeyInput}
              onChange={(e) => setFirmsKeyInput(e.target.value)}
              placeholder="Optional NASA_FIRMS_MAP_KEY (encrypted in BYOKVault)..."
              className="flex-1 min-w-[190px] px-2 py-1 bg-black border border-slate-700 rounded text-slate-200 text-[10px]"
            />
            <button
              type="button"
              onClick={handleSaveFirmsKey}
              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-emerald-500/50 text-emerald-200 font-bold cursor-pointer"
            >
              {firmsKeyInput.trim() ? 'ENCRYPT KEY' : hasFirmsKeyConfigured ? 'CLEAR KEY' : 'OPTIONAL'}
            </button>
          </div>

          {sensorBanner && (
            <div
              className={`px-2.5 py-1.5 rounded border text-[10px] ${
                sensorBanner.type === 'ok'
                  ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-200'
                  : sensorBanner.type === 'warn'
                  ? 'bg-amber-950/70 border-amber-500/60 text-amber-200'
                  : 'bg-red-950/70 border-red-500/60 text-red-200'
              }`}
            >
              {sensorBanner.text}
            </div>
          )}
        </div>

        {/* Global Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 p-3 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-500 uppercase flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Success Rate
            </span>
            <span className="text-lg font-bold text-emerald-300 font-mono-tabular">
              {successRate}%
            </span>
            <span className="text-[10px] text-slate-500">
              {summary.totalTasksCompleted} OK / {summary.totalTasksFailed} Fail
            </span>
          </div>

          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 p-3 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-500 uppercase flex items-center gap-1">
              <Zap className="w-3 h-3 text-cyan-400" /> Total Tokens
            </span>
            <span className="text-lg font-bold text-cyan-300 font-mono-tabular">
              {summary.totalTokens.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-500">
              In: {summary.totalInputTokens.toLocaleString()} | Out:{' '}
              {summary.totalOutputTokens.toLocaleString()}
            </span>
          </div>

          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 p-3 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-500 uppercase flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-amber-400" /> Estimated Cost
            </span>
            <span className="text-lg font-bold text-amber-300 font-mono-tabular">
              ${summary.estimatedCostUsd.toFixed(4)}
            </span>
            <span className="text-[10px] text-slate-500">Model-agnostic rate map</span>
          </div>

          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 p-3 flex flex-col gap-1">
            <span className="text-[10px] text-emerald-500 uppercase flex items-center gap-1">
              <Clock className="w-3 h-3 text-purple-400" /> Avg Duration
            </span>
            <span className="text-lg font-bold text-purple-300 font-mono-tabular">
              {avgDurationSec}s
            </span>
            <span className="text-[10px] text-slate-500">
              Total runtime: {Math.round(summary.totalRuntimeMs / 1000)}s
            </span>
          </div>
        </div>

        {/* Per-Agent Resource Utilization Breakdown */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Agent Resource Allocation &amp; Metrics</span>
          </h3>
          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 overflow-hidden">
            <div className="max-h-52 overflow-y-auto divide-y divide-emerald-500/20">
              {Object.keys(summary.agentMetrics).length === 0 ? (
                <div className="p-6 text-center text-xs text-emerald-600">
                  No agent telemetry recorded yet. Run a directive from the command center.
                </div>
              ) : (
                Object.values(summary.agentMetrics).map((agent) => {
                  const agentTotalRuns = agent.tasksCompleted + agent.tasksFailed;
                  const agentSuccessRate =
                    agentTotalRuns > 0
                      ? Math.round((agent.tasksCompleted / agentTotalRuns) * 100)
                      : 100;
                  return (
                    <div
                      key={agent.agentId}
                      className="p-3 flex items-center justify-between text-xs hover:bg-emerald-950/20 transition-colors"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-emerald-200">{agent.agentName}</span>
                        <span className="text-[10px] text-emerald-500/80">
                          Completed: {agent.tasksCompleted} | Failed: {agent.tasksFailed} (
                          {agentSuccessRate}% success)
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="font-mono-tabular text-cyan-300">
                            {agent.totalTokens.toLocaleString()} tokens
                          </div>
                          <div className="text-[10px] text-amber-400/90 font-mono-tabular">
                            ${agent.estimatedCostUsd.toFixed(4)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Recent Execution Ledger History */}
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-1.5">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            <span>Recent Execution Stream</span>
          </h3>
          <div className="rounded-xl bg-[#090d12] border border-emerald-500/30 overflow-hidden">
            <div className="max-h-48 overflow-y-auto divide-y divide-emerald-500/20 font-mono text-[11px]">
              {summary.history.length === 0 ? (
                <div className="p-4 text-center text-emerald-600">
                  No execution history recorded.
                </div>
              ) : (
                summary.history.slice(0, 15).map((rec) => (
                  <div
                    key={rec.id}
                    className="p-2.5 flex items-center justify-between gap-2 hover:bg-emerald-950/20"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          rec.success
                            ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]'
                            : 'bg-red-400'
                        }`}
                      />
                      <div className="truncate flex flex-col">
                        <span className="font-bold text-emerald-200 truncate">
                          {rec.agentName}: {rec.prompt}
                        </span>
                        <span className="text-[9px] text-emerald-500/70">
                          {new Date(rec.timestamp).toLocaleTimeString()} [{rec.provider}]
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-3 text-right">
                      <span className="text-cyan-300">{rec.totalTokens} tk</span>
                      <span className="text-amber-400">${rec.estimatedCostUsd.toFixed(4)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-2 border-t border-emerald-500/30">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-2 rounded-xl bg-red-950/60 border border-red-600/50 text-red-300 hover:bg-red-900/80 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Purge Telemetry</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              onClose();
            }}
            className="px-5 py-2 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 text-xs font-bold transition-colors cursor-pointer"
          >
            CLOSE HUD
          </button>
        </div>
      </div>

      {/* Commander's Pass Clearances Modal on Multi-NAI Tier Gate */}
      <CommandersPassModal
        isOpen={upgradeModalState.open}
        onClose={() => setUpgradeModalState((prev) => ({ ...prev, open: false }))}
        min={upgradeModalState.min}
        currentTier={tier}
        featureName={upgradeModalState.featureName}
      />
    </div>
  );
};
