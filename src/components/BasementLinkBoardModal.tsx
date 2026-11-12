import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Network,
  RefreshCw,
  Search,
  FileText,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ExternalLink,
  Send,
  Sparkles,
} from 'lucide-react';
import { TacticalModalDialog } from './TacticalModalDialog';
import {
  getEvidenceGraphSnapshot,
  queryEntityNeighborhood,
  syncEvidenceGraphFromVFS,
  type EvidenceGraphSnapshot,
  type EvidenceEntityType,
  type EntityNeighborhoodResult,
  type EvidenceNodeDbEntry,
} from '../services/EvidenceGraphService';
import { writeWorkspaceFile } from '../engine/storageManager';
import { useTheme } from '../context/ThemeContext';

export interface BasementLinkBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenVfsFile?: (filePath: string) => void;
  onDispatchCorrelation?: (prompt: string) => void;
}

const ENTITY_COLORS: Record<EvidenceEntityType, { fill: string; stroke: string; label: string }> = {
  dossier: { fill: '#172554', stroke: '#60a5fa', label: 'DOSSIER' },
  asn: { fill: '#3b0764', stroke: '#c084fc', label: 'ASN' },
  domain: { fill: '#064e3b', stroke: '#34d399', label: 'DOMAIN' },
  ip: { fill: '#083344', stroke: '#22d3ee', label: 'IPV4' },
  cve: { fill: '#450a0a', stroke: '#f87171', label: 'CVE' },
  threat_actor: { fill: '#431407', stroke: '#fb923c', label: 'ACTOR' },
  mitre: { fill: '#422006', stroke: '#facc15', label: 'MITRE' },
  hash: { fill: '#1f2937', stroke: '#9ca3af', label: 'HASH' },
};

export const BasementLinkBoardModal: React.FC<BasementLinkBoardModalProps> = ({
  isOpen,
  onClose,
  onOpenVfsFile,
  onDispatchCorrelation,
}) => {
  const { playBeep } = useTheme();
  const [snapshot, setSnapshot] = useState<EvidenceGraphSnapshot>({
    nodes: [],
    edges: [],
    crossInvestigationBridges: [],
    stats: { totalEntities: 0, totalDossiers: 0, totalEdges: 0, bridgeCount: 0 },
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<EvidenceEntityType | 'all'>('all');
  const [bridgesOnly, setBridgesOnly] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState<EntityNeighborhoodResult | null>(null);

  // SVG Pan & Zoom state (standard cross-browser pointer drag)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const refreshGraph = async (runVfsSync = false) => {
    setIsSyncing(true);
    try {
      if (runVfsSync) {
        await syncEvidenceGraphFromVFS();
      }
      const snap = await getEvidenceGraphSnapshot();
      setSnapshot(snap);
      if (!selectedNodeId && snap.crossInvestigationBridges.length > 0) {
        setSelectedNodeId(snap.crossInvestigationBridges[0].node.id);
      } else if (!selectedNodeId && snap.nodes.length > 0) {
        setSelectedNodeId(snap.nodes[0].id);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void refreshGraph(true);

    const onUpdated = () => {
      void refreshGraph(false);
    };
    window.addEventListener('pixelops:evidence_graph_updated', onUpdated);
    return () => window.removeEventListener('pixelops:evidence_graph_updated', onUpdated);
  }, [isOpen]);

  useEffect(() => {
    if (!selectedNodeId) {
      setNeighborhood(null);
      return;
    }
    const targetNode = snapshot.nodes.find((n) => n.id === selectedNodeId);
    if (!targetNode) {
      setNeighborhood(null);
      return;
    }
    let cancelled = false;
    queryEntityNeighborhood(targetNode.id).then((res) => {
      if (!cancelled) setNeighborhood(res);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, snapshot]);

  const seedSampleCrossInvestigationDossiers = async () => {
    playBeep('switch');
    setIsSyncing(true);
    try {
      await writeWorkspaceFile(
        'intel/edge_gateway_intrusion_audit.md',
        [
          '# Edge Gateway Intrusion Forensic Brief',
          '**Sector:** Server Vault // Forensic Sweep',
          '',
          'Observed anomalous TLS egress from edge appliance exploited via CVE-2024-3094 and CVE-2024-21887.',
          'Command-and-control callback beaconed to `telemetry-sync-cdn.net` resolving to `104.21.44.18` inside autonomous system `AS13335`.',
          'TTPs align with living-off-the-land tradecraft attributed to Volt Typhoon using MITRE technique `T1071.001` and `T1190`.',
        ].join('\n'),
        'Operative Cipher'
      );

      await writeWorkspaceFile(
        'reports/maritime_port_telemetry_recon.md',
        [
          '# Maritime Port SCADA & Subsea Relay Recon',
          '**Sector:** Comms Tower // SIGINT Sweep',
          '',
          'Passive certificate transparency audit around port logistics relays uncovered shadow staging host `port-ais-relay.telemetry-sync-cdn.net` and `telemetry-sync-cdn.net`.',
          'BGP transit traces pivot through `AS13335` (`104.21.44.18` and `172.67.188.92`) with unpatched management plane vulnerable to `CVE-2024-3094`.',
          'Cluster overlaps historical infrastructure tracked under Volt Typhoon (`T1190`).',
        ].join('\n'),
        'Operative Nyx'
      );

      await refreshGraph(true);
    } finally {
      setIsSyncing(false);
    }
  };

  const bridgeIdSet = useMemo(
    () => new Set(snapshot.crossInvestigationBridges.map((b) => b.node.id)),
    [snapshot.crossInvestigationBridges]
  );

  const visibleGraph = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let filteredNodes = snapshot.nodes.filter((n) => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      if (bridgesOnly && n.type !== 'dossier' && !bridgeIdSet.has(n.id)) return false;
      if (q && !n.label.toLowerCase().includes(q) && !n.value.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    // Cap rendered nodes to keep SVG crisp at 60fps
    filteredNodes = filteredNodes.slice(0, 75);
    const nodeSet = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = snapshot.edges.filter(
      (e) => nodeSet.has(e.sourceId) && nodeSet.has(e.targetId)
    );

    // Deterministic concentric + force-relaxed layout on 900x560 board
    const W = 900;
    const H = 560;
    const cx = W / 2;
    const cy = H / 2;

    const positions = new Map<string, { x: number; y: number }>();
    const bridges = filteredNodes.filter((n) => bridgeIdSet.has(n.id));
    const dossiers = filteredNodes.filter((n) => n.type === 'dossier');
    const others = filteredNodes.filter((n) => !bridgeIdSet.has(n.id) && n.type !== 'dossier');

    bridges.forEach((n, idx) => {
      const angle = (idx / Math.max(1, bridges.length)) * Math.PI * 2 - Math.PI / 2;
      const r = bridges.length === 1 ? 0 : Math.min(115, 45 + bridges.length * 14);
      positions.set(n.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    });

    dossiers.forEach((n, idx) => {
      const angle = (idx / Math.max(1, dossiers.length)) * Math.PI * 2;
      const r = 185;
      positions.set(n.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r * 0.82 });
    });

    others.forEach((n, idx) => {
      const angle = (idx / Math.max(1, others.length)) * Math.PI * 2 + 0.35;
      const r = 250 + (idx % 2) * 32;
      positions.set(n.id, {
        x: Math.max(55, Math.min(W - 55, cx + Math.cos(angle) * r)),
        y: Math.max(45, Math.min(H - 45, cy + Math.sin(angle) * r * 0.84)),
      });
    });

    // Light iterative spring relaxation for organic clustering
    for (let iter = 0; iter < 28; iter++) {
      for (let i = 0; i < filteredNodes.length; i++) {
        for (let j = i + 1; j < filteredNodes.length; j++) {
          const a = positions.get(filteredNodes[i].id)!;
          const b = positions.get(filteredNodes[j].id)!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = Math.max(120, dx * dx + dy * dy);
          if (distSq < 6400) {
            const rep = 180 / distSq;
            a.x -= dx * rep;
            a.y -= dy * rep;
            b.x += dx * rep;
            b.y += dy * rep;
          }
        }
      }
      for (const e of filteredEdges) {
        const a = positions.get(e.sourceId);
        const b = positions.get(e.targetId);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist > 145) {
          const pull = (dist - 145) * 0.035;
          a.x += (dx / dist) * pull;
          a.y += (dy / dist) * pull;
          b.x -= (dx / dist) * pull;
          b.y -= (dy / dist) * pull;
        }
      }
      for (const [, p] of positions) {
        p.x = Math.max(58, Math.min(W - 58, p.x));
        p.y = Math.max(44, Math.min(H - 44, p.y));
      }
    }

    return { nodes: filteredNodes, edges: filteredEdges, positions };
  }, [snapshot, searchQuery, typeFilter, bridgesOnly, bridgeIdSet]);

  const connectedToSelected = useMemo(() => {
    const s = new Set<string>();
    if (!selectedNodeId) return s;
    s.add(selectedNodeId);
    for (const e of snapshot.edges) {
      if (e.sourceId === selectedNodeId) s.add(e.targetId);
      if (e.targetId === selectedNodeId) s.add(e.sourceId);
    }
    return s;
  }, [selectedNodeId, snapshot.edges]);

  const selectedNode: EvidenceNodeDbEntry | undefined = useMemo(
    () => snapshot.nodes.find((n) => n.id === selectedNodeId),
    [snapshot.nodes, selectedNodeId]
  );

  return (
    <TacticalModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Basement Evidence Link Board"
      subtitle="Auto-extracted IndexedDB Knowledge Graph · Cross-Investigation Overlap Detector"
      badge={`${snapshot.stats.bridgeCount} BRIDGES · ${snapshot.stats.totalEntities} INDICATORS`}
      icon={<Network className="w-4 h-4" />}
      headerActions={
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            void refreshGraph(true);
          }}
          disabled={isSyncing}
          className="tactical-ctrl min-h-[34px] px-2.5 py-1 bg-[#112236] hover:bg-[#19324e] border border-[#38bdf8]/60 text-[11px] font-bold text-[#7dd3fc] flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">SYNC VFS</span>
        </button>
      }
    >
      {/* Top Filter & Bridge Alert Ribbon */}
      <div className="px-4 py-2.5 bg-[#0f1422] border-b border-[#1e293b] flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-[210px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-[#64748b] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter ASN, domain, IP, CVE, actor..."
              aria-label="Filter evidence graph nodes"
              className="w-full pl-8 pr-2.5 py-1.5 bg-[#090d16] border border-[#283548] text-xs text-[#e2e8f0] focus:outline-none focus:border-[#4ade80]"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              setBridgesOnly((v) => !v);
            }}
            aria-pressed={bridgesOnly}
            className={`tactical-ctrl px-2.5 py-1.5 border text-[11px] font-bold cursor-pointer ${
              bridgesOnly
                ? 'bg-[#451a03] border-[#f59e0b] text-[#fbbf24]'
                : 'bg-[#111827] border-[#334155] text-[#94a3b8]'
            }`}
          >
            ⚡ Overlaps Only ({snapshot.stats.bridgeCount})
          </button>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {(
            ['all', 'asn', 'domain', 'ip', 'cve', 'threat_actor', 'mitre', 'dossier'] as const
          ).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                playBeep('tap');
                setTypeFilter(t);
              }}
              className={`px-2 py-1 text-[10px] font-bold uppercase border cursor-pointer ${
                typeFilter === t
                  ? 'bg-[#14291e] border-[#4ade80] text-[#4ade80]'
                  : 'bg-[#0b101b] border-[#243044] text-[#94a3b8] hover:text-white'
              }`}
            >
              {t === 'all' ? 'ALL' : ENTITY_COLORS[t].label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split Board: Left Interactive SVG Graph + Right Forensic Overlap Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-[480px]">
        {/* Left 8 Columns: Interactive Force-Directed Link Board */}
        <div className="lg:col-span-8 relative bg-[#070a10] border-b lg:border-b-0 lg:border-r border-[#1e293b] flex flex-col min-h-[360px]">
          {/* Floating Canvas Controls */}
          <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1 bg-[#0d1320]/90 border border-[#283548] p-1">
            <button
              type="button"
              aria-label="Zoom in link board"
              onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.2).toFixed(2))))}
              className="p-1.5 text-[#cbd5e1] hover:text-white hover:bg-[#1e293b] cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Zoom out link board"
              onClick={() => setZoom((z) => Math.max(0.55, Number((z - 0.2).toFixed(2))))}
              className="p-1.5 text-[#cbd5e1] hover:text-white hover:bg-[#1e293b] cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Reset link board view"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="p-1.5 text-[#cbd5e1] hover:text-white hover:bg-[#1e293b] cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {visibleGraph.nodes.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
              <Network className="w-10 h-10 text-[#475569]" />
              <div className="text-sm font-bold text-[#e2e8f0]">
                No Indexed Entities Match Current View
              </div>
              <p className="text-xs text-[#94a3b8] max-w-md">
                Every markdown dossier written to the Safehouse VFS automatically extracts IPs,
                domains, ASNs, CVEs, MITRE techniques, and threat actors into IndexedDB.
              </p>
              <button
                type="button"
                onClick={() => void seedSampleCrossInvestigationDossiers()}
                className="tactical-ctrl px-3.5 py-2 bg-[#11281d] hover:bg-[#193b2b] border border-[#4ade80] text-xs font-bold text-[#4ade80] flex items-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Seed 2 Overlapping Forensic Dossiers to Test Link Board</span>
              </button>
            </div>
          ) : (
            <svg
              viewBox="0 0 900 560"
              className="w-full h-full flex-1 select-none touch-none cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('[data-node-id]')) return;
                dragStateRef.current = {
                  dragging: true,
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: pan.x,
                  origY: pan.y,
                };
              }}
              onPointerMove={(e) => {
                if (!dragStateRef.current.dragging) return;
                const dx = e.clientX - dragStateRef.current.startX;
                const dy = e.clientY - dragStateRef.current.startY;
                setPan({
                  x: dragStateRef.current.origX + dx,
                  y: dragStateRef.current.origY + dy,
                });
              }}
              onPointerUp={() => {
                dragStateRef.current.dragging = false;
              }}
              onPointerLeave={() => {
                dragStateRef.current.dragging = false;
              }}
            >
              <defs>
                <pattern id="basement-grid" width="36" height="36" patternUnits="userSpaceOnUse">
                  <path
                    d="M 36 0 L 0 0 0 36"
                    fill="none"
                    stroke="rgba(56, 189, 248, 0.07)"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect width="900" height="560" fill="url(#basement-grid)" />

              <g
                transform={`translate(${450 + pan.x}, ${280 + pan.y}) scale(${zoom}) translate(-450, -280)`}
              >
                {/* Forensic Red/Cyan Thread Edges */}
                {visibleGraph.edges.map((edge) => {
                  const p1 = visibleGraph.positions.get(edge.sourceId);
                  const p2 = visibleGraph.positions.get(edge.targetId);
                  if (!p1 || !p2) return null;
                  const isHighlighted =
                    selectedNodeId === edge.sourceId || selectedNodeId === edge.targetId;
                  const isBridgeEdge =
                    bridgeIdSet.has(edge.sourceId) || bridgeIdSet.has(edge.targetId);

                  return (
                    <line
                      key={edge.id}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={
                        isHighlighted
                          ? '#f59e0b'
                          : isBridgeEdge
                          ? 'rgba(248, 113, 113, 0.55)'
                          : 'rgba(100, 116, 139, 0.34)'
                      }
                      strokeWidth={isHighlighted ? 2.4 : isBridgeEdge ? 1.6 : 1.1}
                      strokeDasharray={edge.relation === 'CO_OCCURS_WITH' ? '4 3' : undefined}
                    />
                  );
                })}

                {/* Entity & Dossier Pins */}
                {visibleGraph.nodes.map((node) => {
                  const pos = visibleGraph.positions.get(node.id);
                  if (!pos) return null;
                  const style = ENTITY_COLORS[node.type] || ENTITY_COLORS.domain;
                  const isSelected = node.id === selectedNodeId;
                  const isBridge = bridgeIdSet.has(node.id);
                  const isDimmed =
                    Boolean(selectedNodeId) && !connectedToSelected.has(node.id);
                  const radius = isBridge ? 17 : node.type === 'dossier' ? 15 : 12;

                  return (
                    <g
                      key={node.id}
                      data-node-id={node.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      style={{ opacity: isDimmed ? 0.35 : 1, cursor: 'pointer' }}
                      onClick={() => {
                        playBeep('tap');
                        setSelectedNodeId(node.id);
                      }}
                    >
                      {isBridge && (
                        <circle
                          r={radius + 6}
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth={1.5}
                          strokeDasharray="3 2"
                        />
                      )}
                      <circle
                        r={radius}
                        fill={style.fill}
                        stroke={isSelected ? '#ffffff' : style.stroke}
                        strokeWidth={isSelected ? 2.8 : 1.8}
                      />
                      <text
                        y={3}
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize="8"
                        fontWeight="bold"
                      >
                        {style.label.slice(0, 4)}
                      </text>
                      <text
                        y={radius + 12}
                        textAnchor="middle"
                        fill={isSelected ? '#fde68a' : '#cbd5e1'}
                        fontSize="10"
                        fontWeight={isSelected || isBridge ? 'bold' : 'normal'}
                      >
                        {node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Cross-Investigation Overlap Strip */}
          {snapshot.crossInvestigationBridges.length > 0 && (
            <div className="px-3 py-2 bg-[#121016] border-t border-[#2d2438] flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-[10px] font-bold uppercase text-[#fbbf24] flex items-center gap-1 shrink-0">
                <AlertTriangle className="w-3.5 h-3.5" />
                Cross-Dossier Overlaps:
              </span>
              {snapshot.crossInvestigationBridges.slice(0, 8).map((b) => (
                <button
                  key={b.node.id}
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    setSelectedNodeId(b.node.id);
                  }}
                  className={`px-2 py-0.5 text-[10px] font-bold border shrink-0 cursor-pointer ${
                    selectedNodeId === b.node.id
                      ? 'bg-[#451a03] border-[#f59e0b] text-[#fde68a]'
                      : 'bg-[#1a1625] border-[#4c1d95] text-[#e9d5ff] hover:border-[#f59e0b]'
                  }`}
                >
                  {b.node.label} ({b.overlapCount} files)
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right 4 Columns: Forensic Overlap Inspector */}
        <div className="lg:col-span-4 p-4 bg-[#0b0f1a] flex flex-col gap-3.5 overflow-y-auto">
          {selectedNode ? (
            <>
              <div className="p-3 bg-[#111827] border border-[#283548]">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="px-1.5 py-0.5 text-[10px] font-bold uppercase border"
                    style={{
                      backgroundColor: ENTITY_COLORS[selectedNode.type].fill,
                      borderColor: ENTITY_COLORS[selectedNode.type].stroke,
                      color: ENTITY_COLORS[selectedNode.type].stroke,
                    }}
                  >
                    {ENTITY_COLORS[selectedNode.type].label}
                  </span>
                  <span className="text-[10px] text-[#94a3b8]">
                    {selectedNode.dossierPaths.length} Linked Investigation(s)
                  </span>
                </div>
                <div className="text-sm font-bold text-white break-all mt-2">
                  {selectedNode.label}
                </div>
                {selectedNode.value !== selectedNode.label && (
                  <div className="text-[11px] text-[#94a3b8] break-all mt-0.5">
                    {selectedNode.value}
                  </div>
                )}

                {selectedNode.dossierPaths.length >= 2 && (
                  <div className="mt-2 px-2 py-1 bg-[#451a03]/70 border border-[#f59e0b]/70 text-[11px] text-[#fde68a] font-bold">
                    ⚡ Hidden Bridge: Appears across {selectedNode.dossierPaths.length} separate VFS
                    investigations!
                  </div>
                )}

                {onDispatchCorrelation && selectedNode.type !== 'dossier' && (
                  <button
                    type="button"
                    onClick={() => {
                      playBeep('switch');
                      onDispatchCorrelation(
                        `Correlate all safehouse intelligence and OSINT pivoting on ${selectedNode.type.toUpperCase()} "${selectedNode.label}" across our VFS dossiers (${selectedNode.dossierPaths.join(', ')}).`
                      );
                      onClose();
                    }}
                    className="tactical-ctrl mt-3 w-full py-1.5 px-2.5 bg-[#10291e] hover:bg-[#163829] border border-[#4ade80] text-[#4ade80] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Pivot Operative Investigation</span>
                  </button>
                )}
              </div>

              {/* Linked VFS Dossiers */}
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]">
                  Source VFS Investigations ({neighborhood?.connectedDossiers.length || selectedNode.dossierPaths.length})
                </div>
                {(selectedNode.type === 'dossier'
                  ? [selectedNode.value]
                  : selectedNode.dossierPaths
                ).map((path) => (
                  <div
                    key={path}
                    className="p-2 bg-[#101624] border border-[#233047] flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" />
                      <span className="text-xs text-[#e2e8f0] truncate" title={path}>
                        {path}
                      </span>
                    </div>
                    {onOpenVfsFile && (
                      <button
                        type="button"
                        onClick={() => {
                          playBeep('tap');
                          onOpenVfsFile(path);
                        }}
                        className="px-2 py-1 bg-[#172554] hover:bg-[#1e3a8a] border border-[#3b82f6] text-[10px] font-bold text-[#93c5fd] flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>OPEN</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Co-Occurring Indicators */}
              {neighborhood && neighborhood.coOccurringEntities.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]">
                    Co-Occurring Indicators ({neighborhood.coOccurringEntities.length})
                  </div>
                  <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto pr-1">
                    {neighborhood.coOccurringEntities.slice(0, 14).map((co) => (
                      <button
                        key={co.node.id}
                        type="button"
                        onClick={() => {
                          playBeep('tap');
                          setSelectedNodeId(co.node.id);
                        }}
                        className="p-2 bg-[#0f1523] hover:bg-[#162036] border border-[#222f46] text-left flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span className="text-xs text-[#e2e8f0] truncate">
                          <strong
                            className="mr-1.5 text-[10px]"
                            style={{ color: ENTITY_COLORS[co.node.type].stroke }}
                          >
                            [{ENTITY_COLORS[co.node.type].label}]
                          </strong>
                          {co.node.label}
                        </span>
                        <span className="text-[10px] text-[#fbbf24] shrink-0">
                          {co.sharedDossiers.length} shared
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-[#94a3b8] p-4 border border-dashed border-[#283548]">
              Select any node on the Basement Link Board to inspect cross-dossier overlaps and pivot
              directly into VFS source files.
            </div>
          )}
        </div>
      </div>
    </TacticalModalDialog>
  );
};

export default BasementLinkBoardModal;
