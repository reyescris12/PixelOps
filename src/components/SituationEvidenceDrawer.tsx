import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Crosshair,
  FileDown,
  Send,
  ShieldCheck,
  AlertTriangle,
  Eye,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import type { SituationCardItem, TrustBadgeKind } from '../services/PlainEnglishTranslator';
import { writeWorkspaceFile } from '../engine/storageManager';

export type EvidenceDrawerTabId = 'summary' | 'ach' | 'tradecraft';

export interface SituationEvidenceDrawerProps {
  item: SituationCardItem | null;
  onClose: () => void;
  onCenterOnMap?: (coords: { lat: number; lon: number; label: string }) => void;
  onDispatchToVance?: (directive: string, item: SituationCardItem) => void;
  onOpenVaultFile?: (path: string) => void;
}

const TAB_ORDER: readonly EvidenceDrawerTabId[] = ['summary', 'ach', 'tradecraft'];

function trustBadgeStyle(badge: TrustBadgeKind): string {
  if (badge === 'Verified Official') {
    return 'bg-emerald-950/90 text-emerald-200 border-emerald-400/70';
  }
  if (badge === 'Corroborated (2+ Feeds)') {
    return 'bg-amber-950/90 text-amber-200 border-amber-400/70';
  }
  return 'bg-slate-900 text-slate-300 border-slate-600/80';
}

export const SituationEvidenceDrawer: React.FC<SituationEvidenceDrawerProps> = ({
  item,
  onClose,
  onCenterOnMap,
  onDispatchToVance,
  onOpenVaultFile,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const tabRefs = useRef<Record<EvidenceDrawerTabId, HTMLButtonElement | null>>({
    summary: null,
    ach: null,
    tradecraft: null,
  });

  const [activeTab, setActiveTab] = useState<EvidenceDrawerTabId>('summary');
  const [exportedSitrepPath, setExportedSitrepPath] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Reset tab & export state when inspecting a different situation card
  useEffect(() => {
    if (item) {
      setActiveTab('summary');
      setExportedSitrepPath(item.proof.sitrepPath || null);
    }
  }, [item?.id]);

  // Synchronize native <dialog> modal lifecycle cleanly
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (item) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute('open', '');
        }
      }
    } else if (dialog.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
    }
  }, [item]);

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = TAB_ORDER.indexOf(activeTab);
    let nextIdx = idx;
    if (e.key === 'ArrowRight') {
      nextIdx = (idx + 1) % TAB_ORDER.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = TAB_ORDER.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const nextTab = TAB_ORDER[nextIdx];
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  const handleExportSitrep = async () => {
    if (!item || isExporting) return;
    setIsExporting(true);
    try {
      const slug = item.headline
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 38);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const targetPath = `intel/sitrep_${slug || 'local_incident'}_${stamp}.md`;

      const achLines = item.achHypotheses
        .map((h) => `- **${h.label} (${h.percentage}%)**: ${h.rationale}`)
        .join('\n');

      const metaLines = item.proof.technicalMetadata
        .map((m) => `- **${m.label}**: \`${m.value}\``)
        .join('\n');

      const packetLines =
        item.proof.packetIds.length > 0
          ? item.proof.packetIds.map((pid) => `- \`${pid}\``).join('\n')
          : '- Live sensor observation (ephemeral / pre-cluster)';

      const markdown = [
        `# SITREP: ${item.headline}`,
        ``,
        `- **Trust Assessment**: ${item.trustBadge} (NATO Admiralty \`[${item.proof.admiraltyCode}]\`)`,
        `- **Location & Vector**: ${item.lat.toFixed(4)}, ${item.lon.toFixed(4)} (${item.distanceAndAgeLabel})`,
        `- **Generated At**: ${new Date().toISOString()}`,
        ``,
        `## 1. Executive Summary (BLUF)`,
        `- **What Happened**: ${item.bluf.whatHappened}`,
        `- **Why We Trust / Doubt It**: ${item.bluf.whyWeTrustOrDoubtIt}`,
        `- **What to Watch Next**: ${item.bluf.whatToWatchNext}`,
        ``,
        `## 2. Competing Explanations (ACH)`,
        achLines,
        ``,
        `## 3. Tradecraft & Sensor Provenance`,
        `- **Source Reliability**: ${item.proof.sourceReliabilityLabel}`,
        `- **Information Credibility**: ${item.proof.infoCredibilityLabel}`,
        `- **Observation Time**: \`${item.proof.observationTime}\``,
        `- **First Ingested**: \`${item.proof.firstIngestedAt}\``,
        `- **Last Material Change**: \`${item.proof.lastMaterialChangeAt}\``,
        metaLines,
        ``,
        `### Evidence Packet Hashes`,
        packetLines,
      ]
        .filter(Boolean)
        .join('\n');

      await writeWorkspaceFile(targetPath, markdown, 'markdown', 'intel');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('pixelops:workspace_files_changed', {
            detail: { action: 'write', targetPath },
          })
        );
      }
      setExportedSitrepPath(targetPath);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="evidence-drawer-title"
      className="evidence-slide-drawer"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {item && (
        <div className="evidence-slide-drawer-sheet flex flex-col h-full bg-[#060b0f] text-slate-100 border-l border-emerald-500/40 shadow-2xl">
          {/* Drawer Header */}
          <div className="px-4 py-3.5 border-b border-slate-800 bg-[#081016] flex items-start justify-between gap-3 shrink-0">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${trustBadgeStyle(
                    item.trustBadge
                  )}`}
                >
                  {item.trustBadge === 'Verified Official' ? (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  ) : item.trustBadge === 'Corroborated (2+ Feeds)' ? (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  <span>{item.trustBadge}</span>
                </span>
                <span className="text-xs text-cyan-300 font-mono">
                  {item.distanceAndAgeLabel}
                </span>
              </div>
              <h2
                id="evidence-drawer-title"
                className="text-base font-bold text-white leading-snug"
              >
                {item.headline}
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">{item.subtitle}</p>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close situation evidence drawer"
              className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* WAI-ARIA 3-Tab Strip */}
          <div
            role="tablist"
            aria-label="Situation Evidence & Tradecraft"
            onKeyDown={handleTabKeyDown}
            className="calm-c2-tablist border-b border-slate-800 bg-[#070d12] px-3 shrink-0"
          >
            <button
              ref={(el) => {
                tabRefs.current.summary = el;
              }}
              id="evidence-tab-summary"
              role="tab"
              type="button"
              aria-selected={activeTab === 'summary'}
              aria-controls="evidence-panel-summary"
              tabIndex={activeTab === 'summary' ? 0 : -1}
              onClick={() => setActiveTab('summary')}
              className="calm-c2-tab text-xs cursor-pointer"
            >
              Summary (Vance BLUF)
            </button>
            <button
              ref={(el) => {
                tabRefs.current.ach = el;
              }}
              id="evidence-tab-ach"
              role="tab"
              type="button"
              aria-selected={activeTab === 'ach'}
              aria-controls="evidence-panel-ach"
              tabIndex={activeTab === 'ach' ? 0 : -1}
              onClick={() => setActiveTab('ach')}
              className="calm-c2-tab text-xs cursor-pointer"
            >
              Competing Explanations (ACH)
            </button>
            <button
              ref={(el) => {
                tabRefs.current.tradecraft = el;
              }}
              id="evidence-tab-tradecraft"
              role="tab"
              type="button"
              aria-selected={activeTab === 'tradecraft'}
              aria-controls="evidence-panel-tradecraft"
              tabIndex={activeTab === 'tradecraft' ? 0 : -1}
              onClick={() => setActiveTab('tradecraft')}
              className="calm-c2-tab text-xs cursor-pointer"
            >
              Raw Telemetry &amp; Tradecraft
            </button>
          </div>

          {/* Scrollable Tab Panels Container */}
          <div className="flex-1 overflow-y-auto">
            {/* TAB 1: Summary (Vance BLUF) */}
            <div
              id="evidence-panel-summary"
              role="tabpanel"
              aria-labelledby="evidence-tab-summary"
              hidden={activeTab !== 'summary'}
            >
              <div className="p-4 space-y-4">
                <section className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                    What Happened
                  </h3>
                  <p className="text-sm text-slate-100 leading-relaxed">
                    {item.bluf.whatHappened}
                  </p>
                </section>

                <section className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
                    Why We Trust / Doubt It
                  </h3>
                  <p className="text-sm text-slate-200 leading-relaxed">
                    {item.bluf.whyWeTrustOrDoubtIt}
                  </p>
                </section>

                <section className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-1.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    What to Watch Next
                  </h3>
                  <p className="text-sm text-slate-200 leading-relaxed">
                    {item.bluf.whatToWatchNext}
                  </p>
                </section>

                {/* Quick Operational Actions */}
                <div className="pt-2 flex flex-wrap gap-2">
                  {onCenterOnMap && (
                    <button
                      type="button"
                      onClick={() => {
                        onCenterOnMap({
                          lat: item.lat,
                          lon: item.lon,
                          label: item.headline,
                        });
                        onClose();
                      }}
                      className="px-3 py-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-cyan-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      <span>Pinpoint on Radar</span>
                    </button>
                  )}

                  {onDispatchToVance && (
                    <button
                      type="button"
                      onClick={() => {
                        const directive = `Assess local situation "${item.headline}" at (${item.lat.toFixed(
                          4
                        )}, ${item.lon.toFixed(4)}) [${item.trustBadge}, NATO ${
                          item.proof.admiraltyCode
                        }]. Cross-check corroborating feeds and recommend next watch actions.`;
                        onDispatchToVance(directive, item);
                      }}
                      className="px-3 py-2 rounded bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-500/60 text-xs font-semibold text-emerald-200 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Brief with Agent Vance</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleExportSitrep}
                    className="px-3 py-2 rounded bg-indigo-950/80 hover:bg-indigo-900/80 border border-indigo-400/60 text-xs font-semibold text-indigo-100 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span>{isExporting ? 'Saving...' : 'Export SITREP to Vault'}</span>
                  </button>
                </div>

                {exportedSitrepPath && (
                  <div className="rounded border border-emerald-500/50 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">Archived: {exportedSitrepPath}</span>
                    </span>
                    {onOpenVaultFile && (
                      <button
                        type="button"
                        onClick={() => onOpenVaultFile(exportedSitrepPath)}
                        className="underline text-emerald-300 hover:text-white shrink-0 font-semibold cursor-pointer"
                      >
                        Open in Vault
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* TAB 2: Competing Explanations (ACH) */}
            <div
              id="evidence-panel-ach"
              role="tabpanel"
              aria-labelledby="evidence-tab-ach"
              hidden={activeTab !== 'ach'}
            >
              <div className="p-4 space-y-4">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Structured Red-Cell Analysis of Competing Hypotheses (ACH) weighs official reliability,
                  multi-feed corroboration, and physical kinematics before jumping to conclusions.
                </p>

                <div className="space-y-3">
                  {item.achHypotheses.map((hyp) => {
                    const barColor =
                      hyp.id === 'ACTIVE_EMERGENCY'
                        ? 'bg-amber-400'
                        : hyp.id === 'ROUTINE_ACTIVITY'
                        ? 'bg-cyan-400'
                        : 'bg-slate-400';

                    return (
                      <div
                        key={hyp.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                          <span className="text-slate-100">{hyp.label}</span>
                          <span className="font-mono text-emerald-300">{hyp.percentage}%</span>
                        </div>
                        <div
                          className="w-full h-2.5 rounded-full bg-slate-900 overflow-hidden border border-slate-800"
                          role="progressbar"
                          aria-label={hyp.label}
                          aria-valuenow={hyp.percentage}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className={`h-full ${barColor} transition-all duration-300`}
                            style={{ width: `${hyp.percentage}%` }}
                          />
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{hyp.rationale}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* TAB 3: Raw Telemetry & Tradecraft */}
            <div
              id="evidence-panel-tradecraft"
              role="tabpanel"
              aria-labelledby="evidence-tab-tradecraft"
              hidden={activeTab !== 'tradecraft'}
            >
              <div className="p-4 space-y-4">
                {/* NATO Admiralty Matrix Card */}
                <section className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                      NATO Admiralty Evaluation
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-400/60 font-mono text-xs font-bold text-emerald-200">
                      [{item.proof.admiraltyCode}]
                    </span>
                  </div>
                  <div className="text-xs text-slate-200 space-y-1">
                    <div>
                      <span className="text-slate-400">Source Reliability: </span>
                      {item.proof.sourceReliabilityLabel}
                    </div>
                    <div>
                      <span className="text-slate-400">Info Credibility: </span>
                      {item.proof.infoCredibilityLabel}
                    </div>
                    <div>
                      <span className="text-slate-400">Corroboration Fusion: </span>
                      <span className="font-mono text-cyan-200">
                        {item.proof.corroborationStatus} ({(item.proof.corroborationScore * 100).toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                </section>

                {/* Lifecycle Timestamps */}
                <section className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-1.5 text-xs">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-cyan-300 mb-1">
                    Telemetry Lifecycle Timestamps
                  </h3>
                  <div className="flex justify-between gap-2 font-mono">
                    <span className="text-slate-400">Observed Upstream:</span>
                    <span className="text-slate-100">{item.proof.observationTime}</span>
                  </div>
                  <div className="flex justify-between gap-2 font-mono">
                    <span className="text-slate-400">First Ingested:</span>
                    <span className="text-slate-100">{item.proof.firstIngestedAt}</span>
                  </div>
                  <div className="flex justify-between gap-2 font-mono">
                    <span className="text-slate-400">Last Material Delta:</span>
                    <span className="text-slate-100">{item.proof.lastMaterialChangeAt}</span>
                  </div>
                  <div className="flex justify-between gap-2 font-mono">
                    <span className="text-slate-400">Coordinates:</span>
                    <span className="text-emerald-300">
                      {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                    </span>
                  </div>
                </section>

                {/* Technical Sensor Metadata */}
                {item.proof.technicalMetadata.length > 0 && (
                  <section className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-1.5 text-xs">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                      Sensor Parameters
                    </h3>
                    {item.proof.technicalMetadata.map((meta) => (
                      <div key={meta.label} className="flex justify-between gap-2">
                        <span className="text-slate-400">{meta.label}:</span>
                        <span className="font-mono text-slate-100 text-right">{meta.value}</span>
                      </div>
                    ))}
                  </section>
                )}

                {/* Provenance Packet Hashes & Source Endpoints */}
                <section className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-2 text-xs">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    Immutable Provenance &amp; Source Links
                  </h3>
                  {item.proof.packetIds.length > 0 ? (
                    <div className="space-y-1">
                      <span className="text-slate-400 block">SHA-256 Packet IDs (IndexedDB):</span>
                      {item.proof.packetIds.map((pid) => (
                        <code
                          key={pid}
                          className="block px-2 py-1 rounded bg-black border border-slate-800 text-[10.5px] text-emerald-300 break-all"
                        >
                          {pid}
                        </code>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400">
                      Live observation cached in memory; SHA-256 packet seals upon material delta emission.
                    </p>
                  )}

                  {item.proof.sourceEndpoints.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <span className="text-slate-400 block">Upstream Sensor Endpoints:</span>
                      {item.proof.sourceEndpoints.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-cyan-300 hover:text-cyan-200 underline break-all text-[11px]"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span>{url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </section>

                {/* Progressive Disclosure Raw JSON Payload (<details>) */}
                <details className="rounded-lg border border-slate-800 bg-black/80 text-xs">
                  <summary className="px-3.5 py-2.5 font-semibold text-slate-200 cursor-pointer select-none hover:text-emerald-300">
                    Inspect Raw Sensor JSON Payload
                  </summary>
                  <pre className="p-3.5 border-t border-slate-800 text-[10.5px] font-mono text-emerald-200/90 overflow-x-auto max-h-80">
                    {item.proof.rawJsonString}
                  </pre>
                </details>
              </div>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
};

export default SituationEvidenceDrawer;
