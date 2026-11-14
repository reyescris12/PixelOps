import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Eye,
  Radio,
  Moon,
  Activity,
  ChevronRight,
} from 'lucide-react';
import TacticalSatelliteMonitor from './TacticalSatelliteMonitor';
import type { TacticalIntelPin } from './TacticalMapOverlay';
import SituationEvidenceDrawer from './SituationEvidenceDrawer';
import {
  buildSituationFeed,
  computeBearingDeg,
  cardinalDirectionFromBearing,
  computeHaversineKm,
  formatDistanceKmClean,
  computeCompetingHypotheses,
  type SituationCardItem,
  type TrustBadgeKind,
} from '../services/PlainEnglishTranslator';
import {
  getActiveSensorObservations,
  getSensorAdapterHealthList,
  getPrimaryNaiZone,
  getPrimaryNaiZoneOrDefaultSync,
  sweepLocalSensorBusNow,
  resolveNaiJurisdiction,
  UK_WTA_2006_SAFE_MODE_LABEL,
  type NaiZoneConfig,
} from '../services/LocalSensorBus';
import {
  getCorroborationClustersWithPackets,
  runParallelSpecialistTracks,
} from '../services/CorroborationEngine';

export interface ReconWorkspaceViewProps {
  activeOperativeName?: string;
  externalFocusTarget?: {
    lat: number;
    lon: number;
    label: string;
    sectorCode: string;
  } | null;
  onDispatchToSafehouseAgent?: (
    directive: string,
    coords?: { lat: number; lon: number; label: string }
  ) => void;
  onOpenVaultFile?: (path: string) => void;
  onOpenRadioSheet?: () => void;
  onOpenNightWatchSheet?: () => void;
  onOpenMacroDiagnosticsSheet?: () => void;
}

function cardTrustBadgeClass(badge: TrustBadgeKind): string {
  if (badge === 'Verified Official') {
    return 'bg-emerald-950/90 text-emerald-200 border-emerald-500/60';
  }
  if (badge === 'Corroborated (2+ Feeds)') {
    return 'bg-amber-950/90 text-amber-200 border-amber-500/60';
  }
  return 'bg-slate-900 text-slate-300 border-slate-700';
}

export const ReconWorkspaceView: React.FC<ReconWorkspaceViewProps> = ({
  activeOperativeName = 'Agent Vance',
  externalFocusTarget = null,
  onDispatchToSafehouseAgent,
  onOpenVaultFile,
  onOpenRadioSheet,
  onOpenNightWatchSheet,
  onOpenMacroDiagnosticsSheet,
}) => {
  const [activeNai, setActiveNai] = useState<NaiZoneConfig>(() => getPrimaryNaiZoneOrDefaultSync());
  const [mapCenterOverride, setMapCenterOverride] = useState<{
    lat: number;
    lon: number;
    label: string;
    sectorCode: string;
  } | null>(externalFocusTarget);

  useEffect(() => {
    if (externalFocusTarget) {
      setMapCenterOverride(externalFocusTarget);
    }
  }, [externalFocusTarget]);

  const [showRoutineSignals, setShowRoutineSignals] = useState<boolean>(false);
  const [selectedSituationItem, setSelectedSituationItem] = useState<SituationCardItem | null>(
    null
  );
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [lastSweptIso, setLastSweptIso] = useState<string | null>(null);
  const [clustersState, setClustersState] = useState<
    Awaited<ReturnType<typeof getCorroborationClustersWithPackets>>
  >([]);

  const syncReconData = useCallback(async () => {
    try {
      const [nai, clusters] = await Promise.all([
        getPrimaryNaiZone().catch(() => getPrimaryNaiZoneOrDefaultSync()),
        getCorroborationClustersWithPackets().catch(() => []),
      ]);
      setActiveNai(nai);
      setClustersState(clusters);
      const healthList = getSensorAdapterHealthList();
      const latestSwept =
        healthList
          .map((h) => h.lastSweptAt)
          .filter((v): v is string => Boolean(v))
          .sort()
          .pop() || null;
      if (latestSwept) {
        setLastSweptIso(latestSwept);
      }
      setRefreshTick((t) => t + 1);
    } catch {}
  }, []);

  useEffect(() => {
    syncReconData();
    const handleBusEvent = () => {
      syncReconData();
    };
    const handleNaiEvent = (ev: Event) => {
      const custom = ev as CustomEvent<NaiZoneConfig | undefined>;
      if (custom?.detail) {
        setActiveNai(custom.detail);
        setMapCenterOverride(null);
      }
      syncReconData();
    };

    window.addEventListener('pixelops:sensor-bus-updated', handleBusEvent);
    window.addEventListener('pixelops:corroboration-updated', handleBusEvent);
    window.addEventListener('pixelops:nai-updated', handleNaiEvent);
    const ageTicker = setInterval(() => setRefreshTick((t) => t + 1), 15_000);

    return () => {
      window.removeEventListener('pixelops:sensor-bus-updated', handleBusEvent);
      window.removeEventListener('pixelops:corroboration-updated', handleBusEvent);
      window.removeEventListener('pixelops:nai-updated', handleNaiEvent);
      clearInterval(ageTicker);
    };
  }, [syncReconData]);

  // Trigger an automatic initial quiet sweep if sensors are still IDLE on first mount
  useEffect(() => {
    const health = getSensorAdapterHealthList();
    if (health.every((h) => h.status === 'IDLE')) {
      setIsSweeping(true);
      sweepLocalSensorBusNow()
        .then((rep) => {
          setLastSweptIso(rep.sweptAt);
          return syncReconData();
        })
        .catch(() => {})
        .finally(() => setIsSweeping(false));
    }
  }, [syncReconData]);

  const handleSweepNow = async () => {
    if (isSweeping) return;
    setIsSweeping(true);
    try {
      const [sensorRep] = await Promise.allSettled([
        sweepLocalSensorBusNow(),
        runParallelSpecialistTracks(),
      ]);
      if (sensorRep.status === 'fulfilled') {
        setLastSweptIso(sensorRep.value.sweptAt);
      }
      await syncReconData();
    } finally {
      setIsSweeping(false);
    }
  };

  const feedSnapshot = useMemo(() => {
    void refreshTick;
    const observations = getActiveSensorObservations();
    const adapterHealth = getSensorAdapterHealthList();
    return buildSituationFeed({
      observations,
      clusters: clustersState,
      centerLat: activeNai.lat,
      centerLon: activeNai.lon,
      radiusKm: activeNai.radiusKm,
      lastSweptAt: lastSweptIso,
      adapterHealth,
      nowMs: Date.now(),
    });
  }, [activeNai, clustersState, lastSweptIso, refreshTick]);

  const handleInspectMapPin = useCallback(
    (pin: TacticalIntelPin) => {
      const matched =
        (pin.clusterId && feedSnapshot.allCardsById[pin.clusterId]) ||
        feedSnapshot.allCardsById[pin.id];

      if (matched) {
        setSelectedSituationItem(matched);
        return;
      }

      // Build deterministic SituationCardItem for manual pinpoint or VFS dossier pins
      const distKm = computeHaversineKm(activeNai.lat, activeNai.lon, pin.lat, pin.lon);
      const brg = distKm < 0.05 ? 0 : computeBearingDeg(activeNai.lat, activeNai.lon, pin.lat, pin.lon);
      const dir = cardinalDirectionFromBearing(brg);
      const adm = pin.admiraltyGrade || 'B2';
      const badge: TrustBadgeKind =
        pin.corroborationStatus === 'CORROBORATED' ||
        pin.corroborationStatus === 'CRITICAL_CONVERGENCE'
          ? 'Corroborated (2+ Feeds)'
          : adm === 'A1'
          ? 'Verified Official'
          : 'Single-Sensor Watch';

      setSelectedSituationItem({
        id: pin.id,
        kind: 'OBSERVATION',
        lat: pin.lat,
        lon: pin.lon,
        distanceKm: Number(distKm.toFixed(2)),
        bearingDeg: Math.round(brg),
        cardinalDirection: dir,
        headline: pin.title,
        subtitle: pin.summary,
        distanceAndAgeLabel: `${formatDistanceKmClean(distKm)} ${dir} • ${pin.timestamp || 'recent'}`,
        trustBadge: badge,
        severity: pin.priority === 'HIGH' ? 'HIGH' : pin.priority === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        isPriorityLayer1: badge !== 'Single-Sensor Watch',
        bluf: {
          whatHappened: pin.summary || pin.title,
          whyWeTrustOrDoubtIt: `Graded [${adm}] (${pin.category || 'Map Target'}).`,
          whatToWatchNext:
            'Cross-check nearby live street cameras or dispatch Agent Vance for deeper verification.',
          synthesizedByAgent: Boolean(pin.vanceSynthesis),
        },
        achHypotheses: computeCompetingHypotheses({
          trustBadge: badge,
          admiraltyCode: adm,
          sourceCount: pin.sourceCount || 1,
          corroborationScore: pin.corroborationScore ?? 0.35,
          isLifeSafety: pin.isLifeSafetyA1,
        }),
        proof: {
          admiraltyCode: adm,
          sourceReliabilityLabel: `${adm[0] || 'B'} — Sensor / Archive Record`,
          infoCredibilityLabel: `${adm[1] || '2'} — Recorded Observation`,
          corroborationScore: pin.corroborationScore ?? 0.35,
          corroborationStatus: pin.corroborationStatus || 'CANDIDATE',
          sourceTracks: pin.sourceTracks || ['WIDE_AREA'],
          observationTime: pin.observationTime || pin.timestamp || new Date().toISOString(),
          firstIngestedAt: pin.capturedAt || new Date().toISOString(),
          lastMaterialChangeAt: pin.lastMaterialChangeAt || new Date().toISOString(),
          packetIds: (pin.provenancePackets || []).map((p) => p.packetId),
          sourceEndpoints: (pin.provenancePackets || [])
            .map((p) => p.sourceEndpoint)
            .filter(Boolean),
          technicalMetadata: [
            { label: 'Category', value: pin.category || 'Tactical Pin' },
            { label: 'Priority', value: pin.priority },
          ],
          rawJsonString: JSON.stringify(pin, null, 2),
          sitrepPath: pin.sitrepPath,
          clusterId: pin.clusterId,
        },
      });
    },
    [activeNai.lat, activeNai.lon, feedSnapshot.allCardsById]
  );

  const mapLat = mapCenterOverride?.lat ?? activeNai.lat;
  const mapLon = mapCenterOverride?.lon ?? activeNai.lon;
  const mapLabel = mapCenterOverride?.label ?? activeNai.label;
  const mapSector =
    mapCenterOverride?.sectorCode ??
    `WATCH ZONE // ${Math.round(activeNai.radiusKm)}KM`;

  const resolvedJurisdiction = resolveNaiJurisdiction(activeNai);

  return (
    <div className="w-full h-full flex flex-col lg:grid lg:grid-cols-12 bg-[#05090d] text-slate-100 overflow-hidden">
      {/* LEFT / MAIN PANE: Clean Radar Map + Quiet 1-Line Sensor Health Bar */}
      <div className="lg:col-span-7 xl:col-span-8 flex flex-col min-h-[360px] lg:h-full border-b lg:border-b-0 lg:border-r border-slate-800/90 overflow-hidden">
        <div className="flex-1 min-h-0 relative">
          <TacticalSatelliteMonitor
            initialLat={mapLat}
            initialLon={mapLon}
            initialLabel={mapLabel}
            initialSectorCode={mapSector}
            activeOperativeName={activeOperativeName}
            overlayMode={true}
            calmWorkspaceMode={true}
            hideRoutineSignals={!showRoutineSignals}
            hiddenRoutineCount={feedSnapshot.hiddenRoutineCount}
            onToggleRoutineSignals={() => setShowRoutineSignals((s) => !s)}
            onInspectPinInDrawer={handleInspectMapPin}
            onDispatchReconDirective={onDispatchToSafehouseAgent}
          />
        </div>

        {/* Quiet 1-Line Sensor Health Bar */}
        <footer
          aria-label="Live sensor health status"
          className="px-3 py-2 bg-[#070d12] border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                feedSnapshot.sensorHealth.okCount === feedSnapshot.sensorHealth.totalCount
                  ? 'bg-emerald-400'
                  : 'bg-amber-400'
              }`}
            />
            <span className="text-slate-300 truncate font-medium">
              {feedSnapshot.sensorHealth.oneLineSummary}
            </span>
          </div>

          <div className="flex items-center gap-2.5 text-slate-400 shrink-0">
            <span>
              Last sweep{' '}
              <strong className="text-slate-200 font-normal">
                {isSweeping ? 'running...' : feedSnapshot.lastSweepAgeLabel}
              </strong>
            </span>
            <button
              type="button"
              disabled={isSweeping}
              onClick={handleSweepNow}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isSweeping ? 'animate-spin' : ''}`} />
              <span>Sweep</span>
            </button>
          </div>
        </footer>
      </div>

      {/* RIGHT PANE: 3-Layer Progressive Disclosure Situation Feed */}
      <aside
        aria-label="Local Situation Feed"
        className="lg:col-span-5 xl:col-span-4 flex flex-col h-full bg-[#060b10] overflow-hidden"
      >
        {/* Calm Pane Header */}
        <div className="px-4 py-3 border-b border-slate-800/90 bg-[#080f15] flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-100 truncate">
              Live Situation • {activeNai.label}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {Math.round(activeNai.radiusKm)} km watch radius
              {resolvedJurisdiction === 'UK_EU' ? ` • ${UK_WTA_2006_SAFE_MODE_LABEL}` : ''}
            </p>
          </div>
          {mapCenterOverride && (
            <button
              type="button"
              onClick={() => setMapCenterOverride(null)}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] text-cyan-300 shrink-0 cursor-pointer"
            >
              Reset View
            </button>
          )}
        </div>

        {/* Scrollable Situation Cards List */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {/* LAYER 0: Calm Baseline Readiness Card ("Nothing Wrong = Quiet Screen") */}
          {feedSnapshot.isAllClear && (
            <div
              role="status"
              className="rounded-xl border border-emerald-500/40 bg-emerald-950/25 p-4 space-y-1.5"
            >
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{feedSnapshot.allClearHeadline}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed pl-6">
                {feedSnapshot.allClearSubtext}
              </p>
            </div>
          )}

          {/* LAYER 1: Actionable Priority Situation Cards (What + Where + Confidence) */}
          {feedSnapshot.priorityCards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => setSelectedSituationItem(card)}
              className="w-full text-left rounded-xl border border-slate-800 hover:border-emerald-500/60 bg-slate-950/90 hover:bg-slate-900/90 p-3.5 transition-colors cursor-pointer group space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${cardTrustBadgeClass(
                    card.trustBadge
                  )}`}
                >
                  {card.trustBadge === 'Verified Official' ? (
                    <ShieldCheck className="w-3 h-3" />
                  ) : (
                    <AlertTriangle className="w-3 h-3" />
                  )}
                  <span>{card.trustBadge}</span>
                </span>
                <span className="text-xs text-cyan-300 font-mono shrink-0">
                  {card.distanceAndAgeLabel}
                </span>
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <h3 className="text-sm font-bold text-white group-hover:text-emerald-200 leading-snug">
                    {card.headline}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                    {card.subtitle}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-300 shrink-0 mt-0.5" />
              </div>
            </button>
          ))}

          {/* Subtle Disclosure Pill for Routine Single-Sensor Clutter */}
          {feedSnapshot.hiddenRoutineCount > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowRoutineSignals((prev) => !prev)}
                className="w-full py-2 px-3 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-950/60 hover:bg-slate-900/70 text-xs font-medium text-slate-300 flex items-center justify-between cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    {showRoutineSignals
                      ? `Showing ${feedSnapshot.hiddenRoutineCount} routine single-sensor ${
                          feedSnapshot.hiddenRoutineCount === 1 ? 'signal' : 'signals'
                        }`
                      : `+ ${feedSnapshot.hiddenRoutineCount} routine ${
                          feedSnapshot.hiddenRoutineCount === 1 ? 'signal' : 'signals'
                        } hidden`}
                  </span>
                </span>
                <span className="text-[11px] text-emerald-400">
                  {showRoutineSignals ? 'Hide' : 'Inspect'}
                </span>
              </button>
            </div>
          )}

          {/* Expanded Routine Single-Sensor Watch Cards (when user opts in) */}
          {showRoutineSignals &&
            feedSnapshot.routineCards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setSelectedSituationItem(card)}
                className="w-full text-left rounded-xl border border-slate-800/80 hover:border-slate-600 bg-slate-950/60 hover:bg-slate-900/70 p-3 transition-colors cursor-pointer group space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium border ${cardTrustBadgeClass(
                      card.trustBadge
                    )}`}
                  >
                    <Eye className="w-3 h-3" />
                    <span>{card.trustBadge}</span>
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono shrink-0">
                    {card.distanceAndAgeLabel}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <h3 className="text-xs font-semibold text-slate-100 group-hover:text-white leading-snug">
                      {card.headline}
                    </h3>
                    <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
                      {card.subtitle}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 shrink-0 mt-0.5" />
                </div>
              </button>
            ))}
        </div>

        {/* Consolidated Secondary Recon Utilities (Replaces 4 separate top-level popups) */}
        <div className="px-3.5 py-2.5 border-t border-slate-800/90 bg-[#070d12] flex flex-wrap items-center justify-between gap-1.5 shrink-0">
          {onOpenRadioSheet && (
            <button
              type="button"
              onClick={onOpenRadioSheet}
              className="px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
              title="Live Tactical Radio & Audio Scanner"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Live Radio</span>
            </button>
          )}
          {onOpenNightWatchSheet && (
            <button
              type="button"
              onClick={onOpenNightWatchSheet}
              className="px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
              title="Automated Background Watch Schedule"
            >
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              <span>Night Watch</span>
            </button>
          )}
          {onOpenMacroDiagnosticsSheet && (
            <button
              type="button"
              onClick={onOpenMacroDiagnosticsSheet}
              className="px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
              title="4-Pillar Global Macro Matrix & Sensor Diagnostics"
            >
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>Macro &amp; Diagnostics</span>
            </button>
          )}
        </div>
      </aside>

      {/* LAYER 2: Slide-Over Evidence & Tradecraft Drawer */}
      <SituationEvidenceDrawer
        item={selectedSituationItem}
        onClose={() => setSelectedSituationItem(null)}
        onCenterOnMap={(coords) => {
          setMapCenterOverride({
            lat: coords.lat,
            lon: coords.lon,
            label: coords.label,
            sectorCode: `SITUATION LOCK // ${coords.lat.toFixed(3)}°, ${coords.lon.toFixed(3)}°`,
          });
        }}
        onDispatchToVance={(directive, item) => {
          setSelectedSituationItem(null);
          onDispatchToSafehouseAgent?.(directive, {
            lat: item.lat,
            lon: item.lon,
            label: item.headline,
          });
        }}
        onOpenVaultFile={(path) => {
          setSelectedSituationItem(null);
          onOpenVaultFile?.(path);
        }}
      />
    </div>
  );
};

export default ReconWorkspaceView;
