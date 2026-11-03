import React, { useState, useEffect } from 'react';
import {
  X,
  Radio,
  Cloud,
  Laptop,
  Smartphone,
  Tablet,
  RefreshCw,
  ShieldCheck,
  KeyRound,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Download,
  Upload,
  Trash2,
  Lock,
  ArrowRight,
  Database,
  Layers,
  Clock,
  Sparkles,
} from 'lucide-react';
import {
  AuthSession,
  DeviceInfo,
  getActiveSession,
  loginAccount,
  registerAccount,
  logoutAccount,
  fetchRemoteDevices,
  unlinkRemoteDevice,
  getCurrentDeviceInfo,
  isLoggedIn,
} from '../services/AuthService';
import {
  syncBidirectional,
  pushToCloud,
  pullFromCloud,
  getSyncStats,
  subscribeSyncStatus,
  isAutoSyncEnabled,
  setAutoSyncEnabled,
  exportLocalSyncBackup,
  importSyncBackup,
  SyncStats,
} from '../services/SyncService';
import { useTheme } from '../context/ThemeContext';

interface SyncAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'account' | 'sync' | 'devices';

export const SyncAccountModal: React.FC<SyncAccountModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { playBeep } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>('sync');
  const [session, setSession] = useState<AuthSession | null>(getActiveSession());
  const [syncStats, setSyncStats] = useState<SyncStats>(getSyncStats());
  const [autoSync, setAutoSync] = useState<boolean>(isAutoSyncEnabled());
  const [devices, setDevices] = useState<DeviceInfo[]>([]);

  // Auth form state
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [callsign, setCallsign] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  // Sync action state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Devices loading state
  const [loadingDevices, setLoadingDevices] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Refresh active session and stats on open
    const currentSession = getActiveSession();
    setSession(currentSession);
    setSyncStats(getSyncStats());
    setAutoSync(isAutoSyncEnabled());

    // If not logged in, default to account tab so user can sign in
    if (!currentSession) {
      setActiveTab('account');
    }

    const unsub = subscribeSyncStatus((stats) => {
      setSyncStats(stats);
    });

    if (currentSession) {
      loadDevices();
    }

    return () => {
      unsub();
    };
  }, [isOpen]);

  const loadDevices = async () => {
    setLoadingDevices(true);
    try {
      const list = await fetchRemoteDevices();
      setDevices(list);
    } catch {
      // Fallback to current device
      setDevices([getCurrentDeviceInfo()]);
    } finally {
      setLoadingDevices(false);
    }
  };

  if (!isOpen) return null;

  const currentDevice = getCurrentDeviceInfo();

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    setAuthLoading(true);

    try {
      if (authMode === 'register') {
        if (!username || username.trim().length < 3) {
          throw new Error('Callsign/Username must be at least 3 characters.');
        }
        if (!password || password.length < 6) {
          throw new Error('Encryption key password must be at least 6 characters.');
        }
        if (password !== confirmPassword) {
          throw new Error('Password keys do not match.');
        }

        const newSession = await registerAccount({
          username: username.trim(),
          email: email.trim(),
          password,
          callsign: callsign.trim() || username.trim(),
        });

        playBeep('complete');
        setSession(newSession);
        setAuthSuccess(`Operative clearance established: ${newSession.user.callsign}`);
        setActiveTab('sync');
        // Trigger initial push to seed the vault
        handleManualSync();
      } else {
        if (!username || !password) {
          throw new Error('Please enter your operative callsign and password.');
        }

        const loggedInSession = await loginAccount({
          usernameOrEmail: username.trim(),
          password,
        });

        playBeep('complete');
        setSession(loggedInSession);
        setAuthSuccess(`SatCom handshake verified. Welcome back, Commander ${loggedInSession.user.callsign}.`);
        setActiveTab('sync');
        // Trigger pull to synchronize data from cloud
        handleManualSync();
      }
    } catch (err: any) {
      playBeep('error');
      setAuthError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    playBeep('tap');
    logoutAccount();
    setSession(null);
    setActiveTab('account');
    setAuthSuccess('Operative link terminated. Operating in isolated local mode.');
  };

  const handleManualSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncFeedback('Initiating SatCom quantum synchronization link...');
    playBeep('tap');

    try {
      const res = await syncBidirectional();
      if (res.success) {
        playBeep('complete');
        setSyncFeedback(
          res.updated
            ? '✓ Synchronization complete. Remote and local vaults aligned.'
            : '✓ All dossiers, routines, and memories are in sync with SatCom Cloud.'
        );
      } else {
        playBeep('error');
        setSyncFeedback(`Sync notice: ${res.error || 'Saved to local terminal vault.'}`);
      }
    } catch (err: any) {
      setSyncFeedback(`Sync notice: ${err?.message || 'Handshake failed, fallback local active.'}`);
    } finally {
      setIsSyncing(false);
      setSyncStats(getSyncStats());
      loadDevices();
    }
  };

  const handleToggleAutoSync = () => {
    const nextState = !autoSync;
    setAutoSync(nextState);
    setAutoSyncEnabled(nextState);
    playBeep('tap');
  };

  const handleUnlink = async (targetDeviceId: string) => {
    if (confirm('Unlink this device from your SatCom cloud vault?')) {
      playBeep('tap');
      await unlinkRemoteDevice(targetDeviceId);
      loadDevices();
    }
  };

  const handleExportBackup = async () => {
    playBeep('tap');
    await exportLocalSyncBackup();
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      playBeep('complete');
      const res = await importSyncBackup(parsed);
      alert(
        `Imported tactical backup successfully!\n\nFiles: ${res.filesCount}\nRoutines: ${res.routinesCount}\nMemories: ${res.memoriesCount}`
      );
      setSyncStats(getSyncStats());
    } catch (err: any) {
      alert(`Failed to import backup: ${err.message}`);
    }
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'mobile':
        return <Smartphone className="w-5 h-5 text-emerald-400" />;
      case 'tablet':
        return <Tablet className="w-5 h-5 text-cyan-400" />;
      default:
        return <Laptop className="w-5 h-5 text-amber-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-zinc-950 border border-emerald-500/30 rounded-xl shadow-2xl shadow-emerald-950/40 flex flex-col max-h-[90vh] overflow-hidden text-zinc-100 font-mono">
        {/* Top Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-500/20 bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider text-emerald-400 flex items-center gap-1.5 uppercase">
                SatCom Multi-Device Cloud Sync
              </h2>
              <p className="text-[10px] text-zinc-400">
                {session
                  ? `CALLSIGN: ${session.user.callsign} | CLEARANCE: ${session.user.securityClearance}`
                  : 'AIR-GAPPED LOCAL MODE (OFFLINE ENCRYPTION ACTIVE)'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              playBeep('tap');
              onClose();
            }}
            className="p-1.5 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-emerald-500/20 bg-zinc-900/40 px-3 pt-2 gap-1 text-xs">
          <button
            onClick={() => {
              playBeep('tap');
              setActiveTab('sync');
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg font-semibold transition-all ${
              activeTab === 'sync'
                ? 'bg-zinc-950 border-t-2 border-emerald-400 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>CLOUD SYNC</span>
          </button>
          <button
            onClick={() => {
              playBeep('tap');
              setActiveTab('account');
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg font-semibold transition-all ${
              activeTab === 'account'
                ? 'bg-zinc-950 border-t-2 border-emerald-400 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>OPERATIVE ACCOUNT</span>
            {session && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
          <button
            onClick={() => {
              playBeep('tap');
              setActiveTab('devices');
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg font-semibold transition-all ${
              activeTab === 'devices'
                ? 'bg-zinc-950 border-t-2 border-emerald-400 text-emerald-300'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
            }`}
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>FLEET DEVICES</span>
            {devices.length > 0 && (
              <span className="px-1.5 py-0.2 text-[9px] rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {devices.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* TAB 1: CLOUD SYNC */}
          {activeTab === 'sync' && (
            <div className="space-y-4">
              {/* Account Quick Status Banner */}
              {!session ? (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3 text-amber-300">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-400 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-xs text-amber-200">
                      Terminal in Air-Gapped Mode
                    </p>
                    <p className="text-[11px] text-amber-300/80 leading-relaxed">
                      You are operating locally. Register or sign into your Operative Account to synchronize workspace files, nightshift routines, and agent memories seamlessly across your desktop and mobile phone.
                    </p>
                    <button
                      onClick={() => setActiveTab('account')}
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded border border-amber-500/40 text-[11px] font-bold"
                    >
                      <span>Connect Operative Account</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-950/30 border border-emerald-500/20 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <div>
                      <p className="text-xs font-semibold text-emerald-300">
                        Active Uplink: {session.user.callsign}
                      </p>
                      <p className="text-[10px] text-zinc-400">
                        Device: {session.device.deviceName} ({session.device.deviceType})
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-zinc-400 block">LAST SYNC</span>
                    <span className="text-[11px] text-emerald-400 font-mono">
                      {syncStats.lastSyncedAt
                        ? new Date(syncStats.lastSyncedAt).toLocaleTimeString()
                        : 'Pending Handshake'}
                    </span>
                  </div>
                </div>
              )}

              {/* Big Action: Sync Now */}
              <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-lg space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-sm text-zinc-100 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      Bidirectional Quantum Sync
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Merges Dexie IndexedDB dossiers, Night Shift cron schedules, and agent reflexes.
                    </p>
                  </div>
                  <button
                    onClick={handleManualSync}
                    disabled={isSyncing}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-xs shadow-lg transition-all ${
                      isSyncing
                        ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 hover:shadow-emerald-500/25 active:scale-95'
                    }`}
                  >
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'SYNCING...' : '⚡ SYNC NOW'}</span>
                  </button>
                </div>

                {syncFeedback && (
                  <div className="p-2.5 rounded bg-zinc-950/80 border border-emerald-500/20 text-emerald-400 text-[11px] flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{syncFeedback}</span>
                  </div>
                )}
              </div>

              {/* Telemetry Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                  <div className="flex items-center justify-between text-zinc-400 mb-1">
                    <span className="text-[10px] uppercase">Files</span>
                    <Database className="w-3.5 h-3.5 text-cyan-400" />
                  </div>
                  <div className="text-lg font-bold text-zinc-100">
                    {syncStats.filesCount}
                  </div>
                  <div className="text-[9px] text-zinc-500">Workspace Dossiers</div>
                </div>

                <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                  <div className="flex items-center justify-between text-zinc-400 mb-1">
                    <span className="text-[10px] uppercase">Routines</span>
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="text-lg font-bold text-zinc-100">
                    {syncStats.routinesCount}
                  </div>
                  <div className="text-[9px] text-zinc-500">Night Shift Tasks</div>
                </div>

                <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                  <div className="flex items-center justify-between text-zinc-400 mb-1">
                    <span className="text-[10px] uppercase">Memories</span>
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="text-lg font-bold text-zinc-100">
                    {syncStats.memoriesCount}
                  </div>
                  <div className="text-[9px] text-zinc-500">Neural Reflections</div>
                </div>

                <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                  <div className="flex items-center justify-between text-zinc-400 mb-1">
                    <span className="text-[10px] uppercase">Status</span>
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                  </div>
                  <div className="text-xs font-bold text-emerald-400 capitalize mt-1.5">
                    {syncStats.status}
                  </div>
                  <div className="text-[9px] text-zinc-500">LWW Resolver</div>
                </div>
              </div>

              {/* Automation & Controls */}
              <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-xs text-zinc-200">
                    Continuous Background Telemetry
                  </h4>
                  <p className="text-[10px] text-zinc-400">
                    Automatically poll SatCom and sync every 45s and when switching tabs.
                  </p>
                </div>
                <button
                  onClick={handleToggleAutoSync}
                  className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors ${
                    autoSync ? 'bg-emerald-500 justify-end' : 'bg-zinc-700 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-zinc-950 shadow-md" />
                </button>
              </div>

              {/* Manual Air-Gapped Backup & Restore */}
              <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg space-y-2">
                <h4 className="font-semibold text-xs text-zinc-200 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-zinc-400" />
                  Air-Gapped Encrypted Backup & Restore
                </h4>
                <p className="text-[10px] text-zinc-400">
                  Export your safehouse state as a portable JSON file to transport between offline terminals.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={handleExportBackup}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded border border-zinc-700 text-[11px] font-semibold transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Export Tactical Backup</span>
                  </button>
                  <label className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded border border-zinc-700 text-[11px] font-semibold cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Import Backup File</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportBackup}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OPERATIVE ACCOUNT */}
          {activeTab === 'account' && (
            <div className="space-y-4">
              {session ? (
                /* Authenticated Operative Profile Card */
                <div className="space-y-4">
                  <div className="p-4 bg-zinc-900/60 border border-emerald-500/30 rounded-xl space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/10 border-2 border-emerald-400 flex items-center justify-center font-bold text-emerald-400 text-lg">
                          {session.user.callsign.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-zinc-100">
                              {session.user.callsign}
                            </h3>
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              {session.user.securityClearance}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5">
                            @{session.user.username} • {session.user.email}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded border border-rose-500/30 text-xs font-semibold transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>DISCONNECT</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2.5 bg-zinc-950/60 rounded border border-zinc-800/80">
                        <span className="text-[9px] text-zinc-500 block uppercase">Operative ID</span>
                        <span className="font-mono text-zinc-300 truncate block">{session.user.id}</span>
                      </div>
                      <div className="p-2.5 bg-zinc-950/60 rounded border border-zinc-800/80">
                        <span className="text-[9px] text-zinc-500 block uppercase">Registration Date</span>
                        <span className="text-zinc-300">{new Date(session.user.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="p-2.5 bg-zinc-950/60 rounded border border-zinc-800/80">
                        <span className="text-[9px] text-zinc-500 block uppercase">Terminal ID</span>
                        <span className="font-mono text-zinc-300 truncate block">{currentDevice.deviceId}</span>
                      </div>
                      <div className="p-2.5 bg-zinc-950/60 rounded border border-zinc-800/80">
                        <span className="text-[9px] text-zinc-500 block uppercase">Client Session Expiry</span>
                        <span className="text-zinc-300">{new Date(session.expiresAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg text-zinc-400 text-[11px] space-y-1">
                    <p className="font-semibold text-zinc-200">
                      Multi-Device Instructions
                    </p>
                    <p>
                      Open PixelOps on your mobile browser or second computer, select <strong>OPERATIVE ACCOUNT</strong>, and enter your credentials (<strong>@{session.user.username}</strong>) to sync your active workspace dossiers and schedules instantly.
                    </p>
                  </div>
                </div>
              ) : (
                /* Login / Register Forms */
                <div className="space-y-4">
                  {/* Mode Selector */}
                  <div className="flex p-1 bg-zinc-900 rounded-lg border border-zinc-800 text-xs">
                    <button
                      onClick={() => {
                        setAuthMode('login');
                        setAuthError(null);
                        setAuthSuccess(null);
                        playBeep('tap');
                      }}
                      className={`flex-1 py-1.5 rounded font-bold transition-all ${
                        authMode === 'login'
                          ? 'bg-emerald-500 text-zinc-950 shadow'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      SIGN IN
                    </button>
                    <button
                      onClick={() => {
                        setAuthMode('register');
                        setAuthError(null);
                        setAuthSuccess(null);
                        playBeep('tap');
                      }}
                      className={`flex-1 py-1.5 rounded font-bold transition-all ${
                        authMode === 'register'
                          ? 'bg-emerald-500 text-zinc-950 shadow'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      CREATE ACCOUNT
                    </button>
                  </div>

                  {authError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                      <span>{authError}</span>
                    </div>
                  )}

                  {authSuccess && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                      <span>{authSuccess}</span>
                    </div>
                  )}

                  <form onSubmit={handleAuthSubmit} className="space-y-3">
                    {authMode === 'register' && (
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Operative Callsign (Display Name)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. SPECTRE, CIPHER, VANCE"
                          value={callsign}
                          onChange={(e) => setCallsign(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                        {authMode === 'register' ? 'Username / Agent Handle' : 'Username or Email'}
                      </label>
                      <input
                        type="text"
                        required
                        placeholder={authMode === 'register' ? 'e.g. commander99' : 'Username or email'}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    {authMode === 'register' && (
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Satellite Comms Email (Optional)
                        </label>
                        <input
                          type="email"
                          placeholder="operative@agency.mil"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                        Cryptographic Key / Password
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    {authMode === 'register' && (
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Confirm Encryption Key
                        </label>
                        <input
                          type="password"
                          required
                          placeholder="••••••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50"
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>
                        {authLoading
                          ? 'AUTHENTICATING...'
                          : authMode === 'register'
                          ? 'ESTABLISH OPERATIVE CLEARANCE'
                          : 'SIGN IN & LINK DEVICE'}
                      </span>
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: FLEET DEVICES */}
          {activeTab === 'devices' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-xs text-zinc-100">
                    Linked Safehouse Terminals
                  </h3>
                  <p className="text-[10px] text-zinc-400">
                    Hardware nodes connected to your cloud sync vault.
                  </p>
                </div>
                <button
                  onClick={loadDevices}
                  disabled={loadingDevices}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[11px] font-semibold transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDevices ? 'animate-spin' : ''}`} />
                  <span>REFRESH</span>
                </button>
              </div>

              {devices.length === 0 ? (
                <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-lg text-center text-zinc-400 text-xs">
                  {session
                    ? 'No secondary fleet terminals detected yet. Log in on your phone or other device to link it.'
                    : 'Sign into your operative account to view all fleet devices.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {devices.map((dev) => {
                    const isThisDevice = dev.deviceId === currentDevice.deviceId;
                    return (
                      <div
                        key={dev.deviceId}
                        className={`p-3 rounded-lg border flex items-center justify-between ${
                          isThisDevice
                            ? 'bg-emerald-950/20 border-emerald-500/40'
                            : 'bg-zinc-900/60 border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-zinc-950/80 border border-zinc-800">
                            {getDeviceIcon(dev.deviceType)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-xs text-zinc-100">
                                {dev.deviceName}
                              </h4>
                              {isThisDevice ? (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  THIS DEVICE
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                  REMOTE
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                              ID: {dev.deviceId.slice(0, 18)}... • Type: {dev.deviceType}
                            </p>
                            <p className="text-[9px] text-zinc-500">
                              Last active: {new Date(dev.lastActive).toLocaleString()}
                            </p>
                          </div>
                        </div>

                        {!isThisDevice && (
                          <button
                            onClick={() => handleUnlink(dev.deviceId)}
                            className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                            title="Unlink device"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-4 py-2.5 bg-zinc-900/60 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>End-to-end encrypted safehouse state sync (LWW conflict resolution)</span>
          </div>
          <button
            onClick={() => {
              playBeep('tap');
              onClose();
            }}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded font-bold transition-colors"
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
};
