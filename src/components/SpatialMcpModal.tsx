import React, { useEffect, useState } from 'react';
import {
  Server,
  ShieldCheck,
  ShieldAlert,
  Plus,
  Trash2,
  RefreshCw,
  Lock,
  Unlock,
  Plug,
  MapPin,
} from 'lucide-react';
import { TacticalModalDialog } from './TacticalModalDialog';
import {
  listMcpStations,
  saveMcpStation,
  deleteMcpStation,
  probeMcpStationTools,
  getCachedMcpTools,
  loadSpatialLeashPolicy,
  saveSpatialLeashPolicy,
  loadSpatialLeashAuditLog,
  type McpStationDbEntry,
  type SpatialLeashPolicyConfig,
  type SpatialLeashAuditEntry,
} from '../services/SpatialMcpService';
import type { RoomId } from '../engine/roomData';
import { useTheme } from '../context/ThemeContext';

export interface SpatialMcpModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoom: RoomId;
}

const ROOM_OPTIONS: Array<{ id: RoomId; label: string; badge: string }> = [
  { id: 'comms_tower', label: 'Comms Tower (External Network & OSINT Sweeps)', badge: 'COMMS' },
  { id: 'server_vault', label: 'Server Vault (VFS Decryption & Code Sandboxes)', badge: 'VAULT' },
  { id: 'archive_basement', label: 'Archive Basement (Evidence Link Graph)', badge: 'BASEMENT' },
  { id: 'war_room', label: 'War Room (Command Synthesis)', badge: 'WAR ROOM' },
  { id: 'armory', label: 'Armory (Loadouts & Cartridges)', badge: 'ARMORY' },
  { id: 'library', label: 'Library (Deep Research Stacks)', badge: 'LIBRARY' },
];

export const SpatialMcpModal: React.FC<SpatialMcpModalProps> = ({
  isOpen,
  onClose,
  currentRoom,
}) => {
  const { playBeep } = useTheme();
  const [activeTab, setActiveTab] = useState<'stations' | 'leashes'>('stations');
  const [stations, setStations] = useState<McpStationDbEntry[]>([]);
  const [policy, setPolicy] = useState<SpatialLeashPolicyConfig>(() => loadSpatialLeashPolicy());
  const [auditLog, setAuditLog] = useState<SpatialLeashAuditEntry[]>(() =>
    loadSpatialLeashAuditLog()
  );

  // New MCP station form state
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [boundRoom, setBoundRoom] = useState<RoomId>('comms_tower');
  const [authHeaderName, setAuthHeaderName] = useState('Authorization');
  const [authToken, setAuthToken] = useState('');
  const [strictRoomLeash, setStrictRoomLeash] = useState(true);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const refreshState = async () => {
    const list = await listMcpStations();
    setStations(list);
    setPolicy(loadSpatialLeashPolicy());
    setAuditLog(loadSpatialLeashAuditLog());
  };

  useEffect(() => {
    if (!isOpen) return;
    void refreshState();
    const onMcpUpdate = () => void refreshState();
    window.addEventListener('pixelops:mcp_stations_updated', onMcpUpdate);
    window.addEventListener('pixelops:spatial_leash_updated', onMcpUpdate);
    window.addEventListener('pixelops:spatial_leash_audit', onMcpUpdate);
    return () => {
      window.removeEventListener('pixelops:mcp_stations_updated', onMcpUpdate);
      window.removeEventListener('pixelops:spatial_leash_updated', onMcpUpdate);
      window.removeEventListener('pixelops:spatial_leash_audit', onMcpUpdate);
    };
  }, [isOpen]);

  const handleAttachStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !serverUrl.trim()) return;
    playBeep('switch');

    const stationId = `mcp_${name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 24)}_${Date.now().toString(36).slice(-4)}`;

    const rawAuthValue = authToken.trim()
      ? authHeaderName.toLowerCase() === 'authorization' && !/^bearer\s+/i.test(authToken.trim())
        ? `Bearer ${authToken.trim()}`
        : authToken.trim()
      : undefined;

    const saved = await saveMcpStation({
      id: stationId,
      name: name.trim(),
      serverUrl: serverUrl.trim(),
      room: boundRoom,
      enabled: true,
      strictRoomLeash,
      hasStoredToken: Boolean(rawAuthValue),
      authHeaderName: authToken.trim() ? authHeaderName.trim() || 'Authorization' : undefined,
      authTokenPlaintext: rawAuthValue,
    });
    setName('');
    setServerUrl('');
    setAuthToken('');
    setStatusBanner(`Attached "${saved.name}" to ${boundRoom.toUpperCase()}. Probing MCP tools...`);

    setProbingId(stationId);
    const probe = await probeMcpStationTools(saved);
    setProbingId(null);
    await refreshState();
    setStatusBanner(
      probe.ok
        ? `Connected "${saved.name}" — discovered ${probe.tools.length} remote MCP tool(s).`
        : `Station saved, but live probe returned: ${probe.error}`
    );
  };

  const handleProbe = async (st: McpStationDbEntry) => {
    playBeep('tap');
    setProbingId(st.id);
    const res = await probeMcpStationTools(st);
    setProbingId(null);
    await refreshState();
    setStatusBanner(
      res.ok
        ? `Probed "${st.name}": ${res.tools.length} tool(s) active.`
        : `Probe error on "${st.name}": ${res.error}`
    );
  };

  const handleToggleStrictGlobal = () => {
    playBeep('switch');
    const updated: SpatialLeashPolicyConfig = {
      ...policy,
      strictEnforcement: !policy.strictEnforcement,
    };
    setPolicy(updated);
    saveSpatialLeashPolicy(updated);
  };

  return (
    <TacticalModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Spatial MCP Stations & Room Tool Leashes"
      subtitle={`Stateless JSON-RPC 2.0 MCP Client · Active Sector: ${currentRoom.toUpperCase()}`}
      badge={policy.strictEnforcement ? 'STRICT LEASH ACTIVE' : 'AUTO-ROUTE LEASH'}
      icon={<Plug className="w-4 h-4" />}
    >
      {/* Mode Switch Tabs */}
      <div className="px-4 pt-3 bg-[#0e1422] border-b border-[#1e293b] flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            setActiveTab('stations');
          }}
          className={`px-3.5 py-2 text-xs font-bold uppercase border-t border-x cursor-pointer ${
            activeTab === 'stations'
              ? 'bg-[#0b0e15] border-[#4ade80] text-[#4ade80]'
              : 'bg-[#12192b] border-transparent text-[#94a3b8] hover:text-white'
          }`}
        >
          🔌 Modular MCP Servers ({stations.length})
        </button>
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            setActiveTab('leashes');
          }}
          className={`px-3.5 py-2 text-xs font-bold uppercase border-t border-x cursor-pointer ${
            activeTab === 'leashes'
              ? 'bg-[#0b0e15] border-[#f59e0b] text-[#fbbf24]'
              : 'bg-[#12192b] border-transparent text-[#94a3b8] hover:text-white'
          }`}
        >
          🔒 Spatial Tool Leashes &amp; Audit ({auditLog.length})
        </button>
      </div>

      {statusBanner && (
        <div className="mx-4 mt-3 px-3 py-2 bg-[#102438] border border-[#38bdf8] text-xs text-[#bae6fd]">
          {statusBanner}
        </div>
      )}

      {activeTab === 'stations' ? (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Attach MCP Server Form */}
          <form
            onSubmit={handleAttachStation}
            className="lg:col-span-5 p-3.5 bg-[#0f1523] border border-[#26334d] flex flex-col gap-3 h-fit"
          >
            <div className="text-xs font-bold uppercase text-[#4ade80] flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              <span>Attach External MCP Server by URL</span>
            </div>
            <p className="text-[11px] text-[#94a3b8]">
              Connect any stateless HTTP / Streamable-HTTP OSINT, code-audit, or threat-intel Model
              Context Protocol server and bind it to a physical Safehouse sector.
            </p>

            <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
              <span>Station Callsign / Label</span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Shodan Recon MCP, Semgrep Audit Server"
                className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
              <span>MCP HTTP / Streamable-HTTP Endpoint URL</span>
              <input
                type="url"
                required
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
              <span>Physical Safehouse Room Assignment</span>
              <select
                value={boundRoom}
                onChange={(e) => setBoundRoom(e.target.value as RoomId)}
                className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
              >
                {ROOM_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
                <span>Auth Header (Optional)</span>
                <input
                  type="text"
                  value={authHeaderName}
                  onChange={(e) => setAuthHeaderName(e.target.value)}
                  placeholder="Authorization"
                  className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-[#cbd5e1]">
                <span>Bearer / API Token (AES-GCM Vault)</span>
                <input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="Optional token..."
                  className="px-2.5 py-1.5 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-[#e2e8f0] cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={strictRoomLeash}
                onChange={(e) => setStrictRoomLeash(e.target.checked)}
              />
              <span>Enforce Physical Room Leash (operative must stand in {boundRoom})</span>
            </label>

            <button
              type="submit"
              className="tactical-ctrl py-2 px-3 bg-[#102a1e] hover:bg-[#173d2b] border border-[#4ade80] text-xs font-bold text-[#4ade80] flex items-center justify-center gap-2 cursor-pointer"
            >
              <Server className="w-3.5 h-3.5" />
              <span>Attach &amp; Discover MCP Tools</span>
            </button>
          </form>

          {/* Attached MCP Stations List */}
          <div className="lg:col-span-7 flex flex-col gap-2.5">
            {stations.length === 0 ? (
              <div className="p-6 bg-[#0d121f] border border-dashed border-[#2a3854] text-center flex flex-col items-center gap-2">
                <Server className="w-8 h-8 text-[#475569]" />
                <div className="text-xs font-bold text-[#cbd5e1]">No External MCP Stations Attached</div>
                <p className="text-[11px] text-[#94a3b8] max-w-md">
                  Attach any remote MCP server on the left (or load an Armory Mission Cartridge) to
                  expose its `tools/list` directly to Vance, Nyx, and Cipher without writing custom
                  API wrappers.
                </p>
              </div>
            ) : (
              stations.map((st) => {
                const tools = getCachedMcpTools(st);
                const isProbing = probingId === st.id;
                return (
                  <div
                    key={st.id}
                    className="p-3 bg-[#0f1524] border border-[#26344f] flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-white">{st.name}</span>
                          <span className="px-1.5 py-0.5 bg-[#172554] border border-[#3b82f6] text-[10px] font-bold text-[#93c5fd] flex items-center gap-1">
                            <MapPin className="w-2.5 h-2.5" />
                            {st.room.toUpperCase()}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold border ${
                              st.lastStatus === 'online'
                                ? 'bg-[#0e291d] border-[#4ade80] text-[#4ade80]'
                                : st.lastStatus === 'error'
                                ? 'bg-[#3b0d0d] border-[#f87171] text-[#fca5a5]'
                                : 'bg-[#1e293b] border-[#475569] text-[#cbd5e1]'
                            }`}
                          >
                            {(st.lastStatus || 'UNPROBED').toUpperCase()}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#94a3b8] truncate mt-0.5">
                          {st.serverUrl}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleProbe(st)}
                          disabled={isProbing}
                          className="px-2 py-1 bg-[#142238] hover:bg-[#1c3150] border border-[#38bdf8] text-[10px] font-bold text-[#7dd3fc] flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className={`w-3 h-3 ${isProbing ? 'animate-spin' : ''}`} />
                          <span>PROBE</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${st.name}`}
                          onClick={async () => {
                            playBeep('tap');
                            await deleteMcpStation(st.id);
                            await refreshState();
                          }}
                          className="p-1.5 bg-[#2a1215] hover:bg-[#3f181d] border border-[#ef4444]/60 text-[#fca5a5] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {st.lastError && (
                      <div className="text-[11px] text-[#fca5a5] bg-[#2b1114] px-2 py-1 border border-[#7f1d1d]">
                        {st.lastError}
                      </div>
                    )}

                    {tools.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-[#1e293b]">
                        {tools.map((t) => (
                          <span
                            key={t.name}
                            title={t.description}
                            className="px-2 py-0.5 bg-[#090d16] border border-[#2d3e5e] text-[10px] text-[#a7f3d0]"
                          >
                            ⚡ {t.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 flex flex-col gap-4">
          {/* Global Strict Spatial Leash Banner */}
          <div className="p-3.5 bg-[#111827] border border-[#334155] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                {policy.strictEnforcement ? (
                  <Lock className="w-4 h-4 text-[#fbbf24]" />
                ) : (
                  <Unlock className="w-4 h-4 text-[#4ade80]" />
                )}
                <span>Physical Room Permission Leash</span>
              </div>
              <p className="text-[11px] text-[#94a3b8] mt-1">
                When <strong>Strict Enforcement</strong> is active, external network sweeps are
                hard-blocked unless the operative is physically stationed inside{' '}
                <strong className="text-[#38bdf8]">COMMS TOWER</strong>, and VFS decryption / code
                sandboxes unlock strictly inside{' '}
                <strong className="text-[#fbbf24]">SERVER VAULT</strong>.
              </p>
            </div>

            <button
              type="button"
              onClick={handleToggleStrictGlobal}
              aria-pressed={policy.strictEnforcement}
              className={`tactical-ctrl px-3.5 py-2 border text-xs font-bold shrink-0 cursor-pointer ${
                policy.strictEnforcement
                  ? 'bg-[#451a03] border-[#f59e0b] text-[#fde68a]'
                  : 'bg-[#0e291d] border-[#4ade80] text-[#4ade80]'
              }`}
            >
              {policy.strictEnforcement
                ? '🔒 STRICT ROOM BLOCKING: ON'
                : '🚶 AUTO-WALK TO ROOM: ON'}
            </button>
          </div>

          {/* Room Capability Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-[#0e1626] border border-[#1e3a5f]">
              <div className="text-xs font-bold text-[#38bdf8]">📡 External Network &amp; OSINT Sweeps</div>
              <div className="text-[11px] text-[#94a3b8] mt-1">
                Required Sector:{' '}
                <strong className="text-white">
                  {policy.roomLeashes.externalNetworkSweeps.join(', ').toUpperCase()}
                </strong>
              </div>
              <div className="text-[10px] text-[#64748b] mt-1.5">
                Scopes Shodan, crt.sh CT logs, BGP routes, AbuseIPDB, VirusTotal, URL crawls, &amp;
                external HTTP gateways.
              </div>
            </div>

            <div className="p-3 bg-[#17130d] border border-[#78350f]">
              <div className="text-xs font-bold text-[#fbbf24]">🔐 VFS Decryption &amp; Sandboxes</div>
              <div className="text-[11px] text-[#94a3b8] mt-1">
                Required Sector:{' '}
                <strong className="text-white">
                  {policy.roomLeashes.vfsVaultDecryption.join(', ').toUpperCase()}
                </strong>
              </div>
              <div className="text-[10px] text-[#64748b] mt-1.5">
                Scopes vault secret decryption, hash checksum verification, JS sandbox eval, &amp;
                vector memory queries.
              </div>
            </div>

            <div className="p-3 bg-[#141024] border border-[#4c1d95]">
              <div className="text-xs font-bold text-[#c084fc]">🕸️ Cross-Dossier Evidence Graph</div>
              <div className="text-[11px] text-[#94a3b8] mt-1">
                Required Sector:{' '}
                <strong className="text-white">
                  {policy.roomLeashes.evidenceForensics.join(', ').toUpperCase()}
                </strong>
              </div>
              <div className="text-[10px] text-[#64748b] mt-1.5">
                Scopes IndexedDB knowledge graph pivots, schema inspections, and cold archive
                correlation.
              </div>
            </div>
          </div>

          {/* Live Spatial Leash Security Audit Log */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]">
              Live Spatial Leash Security Audit Ledger
            </div>
            {auditLog.length === 0 ? (
              <div className="p-4 bg-[#0d121d] border border-[#1f2a40] text-xs text-[#64748b]">
                No spatial tool checks logged yet in this session.
              </div>
            ) : (
              <div className="max-h-[220px] overflow-y-auto flex flex-col gap-1">
                {auditLog.slice(0, 20).map((entry) => (
                  <div
                    key={entry.id}
                    className="px-3 py-2 bg-[#0d1320] border border-[#1e293b] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {entry.decision === 'BLOCKED_BY_SPATIAL_LEASH' ? (
                        <ShieldAlert className="w-3.5 h-3.5 text-[#f87171] shrink-0" />
                      ) : (
                        <ShieldCheck className="w-3.5 h-3.5 text-[#4ade80] shrink-0" />
                      )}
                      <span className="text-[#e2e8f0] truncate">
                        <strong>{entry.toolName}</strong> · {entry.agentName} @{' '}
                        <span className="text-[#38bdf8]">{entry.agentRoom}</span>
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold shrink-0 ${
                        entry.decision === 'BLOCKED_BY_SPATIAL_LEASH'
                          ? 'text-[#f87171]'
                          : 'text-[#4ade80]'
                      }`}
                    >
                      {entry.decision}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </TacticalModalDialog>
  );
};

export default SpatialMcpModal;
