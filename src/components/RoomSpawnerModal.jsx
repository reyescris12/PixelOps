import React, { useState, useEffect } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Cpu,
  Terminal,
  FolderGit2,
  Search,
  Key,
  Database,
  Radar,
  Check,
  X,
  Sparkles,
  Box,
  Wrench,
  CheckCircle2,
} from 'lucide-react';
import {
  ROOM_TEMPLATES,
  loadCustomRooms,
  spawnRoom,
  removeRoom,
  getAllRooms,
  getAllRoomIds,
  getAllRoomStations,
} from '../engine/roomManager';
import {
  AVAILABLE_SKILLS,
  loadRoomSkillBindings,
  loadStationSkillBindings,
  mountSkillToRoom,
  unmountSkillFromRoom,
} from '../engine/moduleRegistry';

export const RoomSpawnerModal = ({
  isOpen,
  onClose,
  currentRoom,
  onNavigateToRoom,
}) => {
  const [activeTab, setActiveTab] = useState('expand');
  const [customRooms, setCustomRooms] = useState({});
  const [allRooms, setAllRooms] = useState(getAllRooms());
  const [allRoomIds, setAllRoomIds] = useState(getAllRoomIds());
  const [roomBindings, setRoomBindings] = useState(loadRoomSkillBindings());
  const [stationBindings, setStationBindings] = useState(loadStationSkillBindings());
  const [selectedRoomId, setSelectedRoomId] = useState(currentRoom);
  const [notification, setNotification] = useState(null);

  const [customForm, setCustomForm] = useState({
    id: '',
    shortBadge: '',
    sectorCode: 'SEC-D2',
    spyTitle: '',
    idleTag: 'DIAGNOSTICS',
    activeTag: 'ACTIVE',
    defaultBriefing: '',
    backdropTemplate: 'server_vault',
  });

  const refreshState = () => {
    setCustomRooms(loadCustomRooms());
    setAllRooms(getAllRooms());
    setAllRoomIds(getAllRoomIds());
    setRoomBindings(loadRoomSkillBindings());
    setStationBindings(loadStationSkillBindings());
  };

  useEffect(() => {
    if (isOpen) {
      refreshState();
      setSelectedRoomId(currentRoom);
    }
  }, [isOpen, currentRoom]);

  const showFeedback = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSpawnTemplate = (template) => {
    spawnRoom(template);
    refreshState();
    showFeedback(`SECTOR SPAWNED: [${template.shortBadge}] (${template.sectorCode}) ONLINE`);
    if (onNavigateToRoom) {
      onNavigateToRoom(template.id);
    }
  };

  const handleRemoveRoom = (roomId) => {
    const success = removeRoom(roomId);
    if (success) {
      refreshState();
      showFeedback(`SECTOR DECOMMISSIONED: [${roomId.toUpperCase()}]`);
      if (selectedRoomId === roomId) {
        setSelectedRoomId('war_room');
      }
    }
  };

  const handleCreateCustomRoom = (e) => {
    e.preventDefault();
    if (!customForm.id || !customForm.shortBadge) return;

    const roomId = customForm.id.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const newRoom = {
      id: roomId,
      shortBadge: customForm.shortBadge.toUpperCase(),
      sectorCode: customForm.sectorCode || 'SEC-D2',
      spyTitle: customForm.spyTitle || `Spy Safehouse · ${customForm.shortBadge} [${customForm.sectorCode}]`,
      monsterTitle: `Monster Lab · ${customForm.shortBadge} [${customForm.sectorCode}]`,
      vikingTitle: `Viking Longhall · ${customForm.shortBadge} [${customForm.sectorCode}]`,
      wingLabel: 'LOWER DECK',
      gridCol: 3,
      gridRow: 1,
      neighbors: ['armory', 'archive_basement'],
      defaultAgentIndex: 1,
      idleTag: customForm.idleTag || 'MONITORING',
      activeTag: customForm.activeTag || 'PROCESSING',
      defaultBriefing: customForm.defaultBriefing || 'Sector commissioned and linked to tactical safehouse network.',
      cleanBackdropUrl: `/assets/rooms/${customForm.backdropTemplate}_clean.png`,
      backdropFilter: 'hue-rotate(145deg) saturate(1.3) brightness(0.95)',
      doorX: 48.0,
      doorY: 64.0,
      isCustom: true,
      stations: [
        {
          id: `${roomId}_station_1`,
          label: 'Primary Console',
          xPct: 38.5,
          yPct: 78.0,
          corridorXPct: 38.5,
          corridorYPct: 78.0,
          pose: 'work',
          facing: 'left',
          taskTag: customForm.activeTag || 'PROCESSING',
        },
        {
          id: `${roomId}_station_2`,
          label: 'Auxiliary Terminal',
          xPct: 48.0,
          yPct: 84.0,
          corridorXPct: 48.0,
          corridorYPct: 84.0,
          pose: 'desk',
          facing: 'right',
          taskTag: customForm.idleTag || 'STANDBY',
        },
      ],
      obstacles: [
        {
          id: `obs_${roomId}_central`,
          label: 'Central Core Module',
          xMin: 43.0,
          xMax: 57.0,
          yMin: 68.0,
          yMax: 77.5,
          isCentralStructure: true,
        },
        {
          id: `obs_${roomId}_west`,
          label: 'West Console Bay',
          xMin: 24.0,
          xMax: 34.0,
          yMin: 68.0,
          yMax: 79.0,
        },
      ],
      corridorWaypoints: [
        { id: `wp_${roomId}_west`, label: 'West Floor', xPct: 37.0, yPct: 77.0 },
        { id: `wp_${roomId}_center`, label: 'Center Floor', xPct: 49.0, yPct: 83.5 },
        { id: `wp_${roomId}_east`, label: 'East Floor', xPct: 62.5, yPct: 77.0 },
      ],
    };

    spawnRoom(newRoom);
    refreshState();
    showFeedback(`CUSTOM SECTOR COMMISSIONED: [${newRoom.shortBadge}]`);
    setCustomForm({
      id: '',
      shortBadge: '',
      sectorCode: 'SEC-D2',
      spyTitle: '',
      idleTag: 'DIAGNOSTICS',
      activeTag: 'ACTIVE',
      defaultBriefing: '',
      backdropTemplate: 'server_vault',
    });
    if (onNavigateToRoom) onNavigateToRoom(newRoom.id);
  };

  const handleToggleSkillMount = (roomId, skillId) => {
    const currentSkills = roomBindings[roomId] || [];
    if (currentSkills.includes(skillId)) {
      unmountSkillFromRoom(roomId, skillId);
      showFeedback(`SKILL DETACHED: [${skillId.toUpperCase()}] from [${roomId.toUpperCase()}]`);
    } else {
      mountSkillToRoom(roomId, skillId);
      showFeedback(`SKILL MOUNTED: [${skillId.toUpperCase()}] -> [${roomId.toUpperCase()}]`);
    }
    refreshState();
  };

  const handleStationSkillBind = (stationId, skillId) => {
    const current = stationBindings[stationId];
    if (current === skillId) {
      unmountSkillFromRoom(selectedRoomId, skillId, stationId);
      showFeedback(`WORKSTATION UNBOUND: [${stationId}]`);
    } else {
      mountSkillToRoom(selectedRoomId, skillId, stationId);
      showFeedback(`WORKSTATION BOUND: [${stationId}] -> [${skillId.toUpperCase()}]`);
    }
    refreshState();
  };

  const getSkillIcon = (iconName) => {
    switch (iconName) {
      case 'FolderGit2':
        return <FolderGit2 className="w-4 h-4 text-[#38bdf8]" />;
      case 'Search':
        return <Search className="w-4 h-4 text-[#4ade80]" />;
      case 'Cpu':
        return <Cpu className="w-4 h-4 text-[#e59838]" />;
      case 'Terminal':
        return <Terminal className="w-4 h-4 text-[#fde047]" />;
      case 'Key':
        return <Key className="w-4 h-4 text-[#c084fc]" />;
      case 'Database':
        return <Database className="w-4 h-4 text-[#f43f5e]" />;
      default:
        return <Radar className="w-4 h-4 text-[#38bdf8]" />;
    }
  };

  if (!isOpen) return null;

  const currentRoomStations = getAllRoomStations()[selectedRoomId] || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] bg-[#0c0f16] border-2 border-[#38bdf8]/60 shadow-[0_0_30px_rgba(56,189,248,0.2)] flex flex-col overflow-hidden font-mono-tabular"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#131a29] border-b border-[#38bdf8]/40 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#38bdf8]" />
            <span className="text-xs sm:text-sm font-bold text-[#38bdf8] tracking-wider uppercase">
              FACILITY ARCHITECT // DYNAMIC ROOM & SKILL EXPANSION ENGINE
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#64748b] hover:text-[#f3ead8] hover:bg-[#1e293b] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center border-b border-[#1e293b] bg-[#090d14] px-3 gap-2">
          <button
            onClick={() => setActiveTab('expand')}
            className={`py-2 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'expand'
                ? 'border-[#38bdf8] text-[#38bdf8] bg-[#38bdf8]/10'
                : 'border-transparent text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>[1] SECTOR EXPANSION & SPAWNER</span>
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`py-2 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'skills'
                ? 'border-[#4ade80] text-[#4ade80] bg-[#4ade80]/10'
                : 'border-transparent text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>[2] MODULAR SKILL & PLUGIN BINDINGS</span>
          </button>
        </div>

        {notification && (
          <div className="bg-[#38bdf8]/15 border-b border-[#38bdf8]/40 px-3 py-1.5 text-xs text-[#38bdf8] font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#38bdf8]" />
            <span>{notification}</span>
          </div>
        )}

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)] space-y-4">
          {activeTab === 'expand' ? (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#e59838] uppercase tracking-wide flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    PRE-CALIBRATED SECTOR EXPANSION BLUEPRINTS
                  </span>
                  <span className="text-[10px] text-[#64748b]">Fills Grid Slot [SEC-D2]</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {ROOM_TEMPLATES.map((tmpl) => {
                    const isSpawned = Boolean(customRooms[tmpl.id]);
                    return (
                      <div
                        key={tmpl.id}
                        className={`p-3 border transition-colors flex flex-col justify-between ${
                          isSpawned
                            ? 'bg-[#1e293b]/40 border-[#38bdf8]/60 shadow-[inset_0_0_12px_rgba(56,189,248,0.15)]'
                            : 'bg-[#0f1420] border-[#1e293b] hover:border-[#38bdf8]/40'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-xs font-bold text-[#f3ead8]">
                              {tmpl.shortBadge}
                            </span>
                            <span className="text-[10px] text-[#38bdf8] font-mono">
                              [{tmpl.sectorCode}]
                            </span>
                          </div>
                          <p className="text-[11px] text-[#94a3b8] leading-tight mb-2">
                            {tmpl.defaultBriefing}
                          </p>
                          <div className="text-[10px] text-[#64748b] space-y-0.5">
                            <div>• Interactive Nodes: {tmpl.stations.length} workstations</div>
                            <div>• Non-walkable obstacles: {tmpl.obstacles.length} modules</div>
                          </div>
                        </div>

                        <div className="mt-3 pt-2 border-t border-[#1e293b] flex items-center justify-between">
                          {isSpawned ? (
                            <div className="flex items-center gap-1.5 w-full justify-between">
                              <span className="text-[10px] text-[#4ade80] font-bold flex items-center gap-1">
                                <Check className="w-3 h-3" /> ONLINE
                              </span>
                              <div className="flex items-center gap-1">
                                {onNavigateToRoom && (
                                  <button
                                    onClick={() => {
                                      onNavigateToRoom(tmpl.id);
                                      onClose();
                                    }}
                                    className="px-2 py-0.5 text-[10px] bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/40 hover:bg-[#38bdf8]/30 font-bold"
                                  >
                                    ENTER
                                  </button>
                                )}
                                <button
                                  onClick={() => handleRemoveRoom(tmpl.id)}
                                  className="p-1 text-[#f43f5e] hover:bg-[#f43f5e]/20 transition-colors"
                                  title="Decommission Sector"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleSpawnTemplate(tmpl)}
                              className="w-full py-1 text-xs bg-[#38bdf8]/15 border border-[#38bdf8]/60 text-[#38bdf8] hover:bg-[#38bdf8]/30 font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" /> SPAWN SECTOR
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-[#0f1420] border border-[#1e293b] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wide flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> CUSTOM SECTOR FABRICATION FORM
                  </span>
                  <span className="text-[10px] text-[#64748b]">16-Bit Isometric Diorama Box</span>
                </div>

                <form onSubmit={handleCreateCustomRoom} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-[#64748b] mb-1">
                        ROOM ID (KEY)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. bio_vault"
                        value={customForm.id}
                        onChange={(e) =>
                          setCustomForm({ ...customForm, id: e.target.value.toLowerCase() })
                        }
                        className="w-full bg-[#090d14] border border-[#1e293b] px-2 py-1 text-xs text-[#f3ead8] focus:border-[#38bdf8] outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#64748b] mb-1">
                        SHORT BADGE (HEADER)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. BIO VAULT"
                        value={customForm.shortBadge}
                        onChange={(e) =>
                          setCustomForm({ ...customForm, shortBadge: e.target.value })
                        }
                        className="w-full bg-[#090d14] border border-[#1e293b] px-2 py-1 text-xs text-[#f3ead8] focus:border-[#38bdf8] outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#64748b] mb-1">
                        SECTOR CODE
                      </label>
                      <input
                        type="text"
                        placeholder="SEC-D2"
                        value={customForm.sectorCode}
                        onChange={(e) =>
                          setCustomForm({ ...customForm, sectorCode: e.target.value })
                        }
                        className="w-full bg-[#090d14] border border-[#1e293b] px-2 py-1 text-xs text-[#f3ead8] focus:border-[#38bdf8] outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-[#64748b] mb-1">
                        FULL OPERATIONAL TITLE
                      </label>
                      <input
                        type="text"
                        placeholder="Spy Safehouse · Bio-Hazard Vault [D-02]"
                        value={customForm.spyTitle}
                        onChange={(e) =>
                          setCustomForm({ ...customForm, spyTitle: e.target.value })
                        }
                        className="w-full bg-[#090d14] border border-[#1e293b] px-2 py-1 text-xs text-[#f3ead8] focus:border-[#38bdf8] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#64748b] mb-1">
                        BASE ROOM BACKDROP ASSET
                      </label>
                      <select
                        value={customForm.backdropTemplate}
                        onChange={(e) =>
                          setCustomForm({ ...customForm, backdropTemplate: e.target.value })
                        }
                        className="w-full bg-[#090d14] border border-[#1e293b] px-2 py-1 text-xs text-[#f3ead8] focus:border-[#38bdf8] outline-none cursor-pointer"
                      >
                        <option value="server_vault">Server Vault (Neon Cryo Pods)</option>
                        <option value="war_room">War Room (Holo Command Deck)</option>
                        <option value="armory">Tactical Armory (Ballistic Racks)</option>
                        <option value="library">Intel Library (Archive Stacks)</option>
                        <option value="comms_tower">Comms Tower (Radar Terminal)</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-1.5 text-xs bg-[#4ade80]/15 border border-[#4ade80]/60 text-[#4ade80] hover:bg-[#4ade80]/30 font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> FABRICATE & REGISTER CUSTOM SECTOR
                  </button>
                </form>
              </div>

              <div>
                <span className="text-xs font-bold text-[#94a3b8] uppercase tracking-wide block mb-2">
                  ACTIVE SAFEHOUSE FOOTPRINT ({allRoomIds.length} SECTORS REGISTERED)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {allRoomIds.map((rId) => {
                    const rMeta = allRooms[rId];
                    if (!rMeta) return null;
                    const isCustom = Boolean(customRooms[rId]);
                    return (
                      <div
                        key={rId}
                        className={`p-2 border text-[11px] flex items-center justify-between ${
                          isCustom
                            ? 'bg-[#131d2e] border-[#38bdf8]/50 text-[#38bdf8]'
                            : 'bg-[#0a0e17] border-[#1e293b] text-[#94a3b8]'
                        }`}
                      >
                        <div className="truncate">
                          <span className="font-bold block truncate">
                            {rMeta.shortBadge}
                          </span>
                          <span className="text-[9px] text-[#64748b]">
                            {rMeta.sectorCode} · {rMeta.wingLabel}
                          </span>
                        </div>
                        {isCustom && (
                          <button
                            onClick={() => handleRemoveRoom(rId)}
                            className="p-1 text-[#f43f5e] hover:bg-[#f43f5e]/20"
                            title="Remove"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#e59838] uppercase tracking-wide mb-1.5">
                  TARGET SECTOR TO CONFIGURE:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {allRoomIds.map((rId) => {
                    const meta = allRooms[rId];
                    if (!meta) return null;
                    const active = rId === selectedRoomId;
                    const boundCount = (roomBindings[rId] || []).length;
                    return (
                      <button
                        key={rId}
                        onClick={() => setSelectedRoomId(rId)}
                        className={`px-2.5 py-1 text-xs border font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8]'
                            : 'bg-[#0f1420] border-[#1e293b] text-[#94a3b8] hover:text-[#f3ead8]'
                        }`}
                      >
                        <span>{meta.shortBadge}</span>
                        {boundCount > 0 && (
                          <span className="text-[10px] text-[#4ade80]">({boundCount})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wide block mb-2">
                  AVAILABLE CAPABILITY MODULES // ATTACH TO [{selectedRoomId.toUpperCase()}]
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {AVAILABLE_SKILLS.map((skill) => {
                    const roomBound = (roomBindings[selectedRoomId] || []).includes(skill.id);
                    return (
                      <div
                        key={skill.id}
                        className={`p-2.5 border transition-colors flex flex-col justify-between ${
                          roomBound
                            ? 'bg-[#1e293b]/60 border-[#4ade80]/60 shadow-[inset_0_0_12px_rgba(74,222,128,0.1)]'
                            : 'bg-[#0f1420] border-[#1e293b]'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <div className="flex items-center gap-1.5">
                              {getSkillIcon(skill.iconName)}
                              <span className="text-xs font-bold text-[#f3ead8]">
                                {skill.name}
                              </span>
                            </div>
                            <span className="text-[9px] px-1.5 py-0.2 bg-[#1e293b] text-[#38bdf8] font-mono">
                              [{skill.shortCode}]
                            </span>
                          </div>
                          <p className="text-[11px] text-[#94a3b8] leading-snug mb-2">
                            {skill.description}
                          </p>
                          <div className="text-[10px] text-[#64748b] flex flex-wrap gap-1">
                            {skill.providedTools.map((t) => (
                              <span
                                key={t}
                                className="bg-[#090d14] px-1 py-0.5 border border-[#1e293b]"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-2.5 pt-2 border-t border-[#1e293b] flex items-center justify-between">
                          <span className="text-[10px] text-[#64748b]">
                            Category: {skill.category.toUpperCase()}
                          </span>
                          <button
                            onClick={() => handleToggleSkillMount(selectedRoomId, skill.id)}
                            className={`px-2.5 py-0.5 text-xs font-bold border cursor-pointer transition-colors flex items-center gap-1 ${
                              roomBound
                                ? 'bg-[#f43f5e]/20 border-[#f43f5e]/60 text-[#f43f5e] hover:bg-[#f43f5e]/30'
                                : 'bg-[#4ade80]/20 border-[#4ade80]/60 text-[#4ade80] hover:bg-[#4ade80]/30'
                            }`}
                          >
                            {roomBound ? (
                              <>
                                <X className="w-3 h-3" /> DETACH FROM ROOM
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" /> MOUNT TO ROOM
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {currentRoomStations.length > 0 && (
                <div className="bg-[#0f1420] border border-[#1e293b] p-3 space-y-2">
                  <span className="text-xs font-bold text-[#e59838] uppercase tracking-wide block">
                    WORKSTATION NODE PINNING (OPTIONAL DIRECT INTERACTIVE ATTACHMENTS)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {currentRoomStations.map((station) => {
                      const boundSkillId = stationBindings[station.id];
                      return (
                        <div
                          key={station.id}
                          className="p-2 bg-[#090d14] border border-[#1e293b] text-xs flex flex-col justify-between"
                        >
                          <div>
                            <span className="font-bold text-[#f3ead8] block truncate">
                              ◈ {station.label}
                            </span>
                            <span className="text-[10px] text-[#64748b] block mb-1">
                              Action: {station.taskTag}
                            </span>
                          </div>

                          <div className="mt-1">
                            <label className="text-[9px] text-[#64748b] block mb-0.5">
                              BOUND SKILL:
                            </label>
                            <select
                              value={boundSkillId || ''}
                              onChange={(e) =>
                                handleStationSkillBind(station.id, e.target.value)
                              }
                              className="w-full bg-[#131a29] border border-[#1e293b] text-[10px] text-[#4ade80] p-1 outline-none cursor-pointer"
                            >
                              <option value="">[INHERIT ROOM SKILLS]</option>
                              {AVAILABLE_SKILLS.map((sk) => (
                                <option key={sk.id} value={sk.id}>
                                  {sk.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-[#090d14] border-t border-[#1e293b] px-3 py-2 flex items-center justify-between text-[11px] text-[#64748b]">
          <span>
            OPERATIONAL TRIGGER: Agents arriving at rooms or workstations dynamically bind to attached
            tools & display status badge.
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#1e293b] text-[#f3ead8] hover:bg-[#334155] font-bold cursor-pointer transition-colors"
          >
            [CLOSE CONSOLE]
          </button>
        </div>
      </div>
    </div>
  );
};
