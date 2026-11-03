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
  Edit3,
  Copy,
  Check,
  QrCode,
  Key,
  ShieldAlert,
  ChevronLeft,
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
  resetPassword,
  updateProfile,
  exportSatellitePairingToken,
  importSatellitePairingToken,
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
type AuthMode = 'login' | 'register' | 'forgot' | 'pair';

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
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [callsign, setCallsign] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [pairingTokenInput, setPairingTokenInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  // Edit profile state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editCallsign, setEditCallsign] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCurrentPassword, setEditCurrentPassword] = useState('');
  const [editNewPassword, setEditNewPassword] = useState('');
  const [editConfirmPassword, setEditConfirmPassword] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Mobile pairing panel state
  const [showPairingModal, setShowPairingModal] = useState(false);
  const [generatedPairingCode, setGeneratedPairingCode] = useState('');
  const [copiedPairing, setCopiedPairing] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

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

    if (!currentSession) {
      setActiveTab('account');
    } else {
      setEditCallsign(currentSession.user.callsign || '');
      setEditUsername(currentSession.user.username || '');
      setEditEmail(currentSession.user.email || '');
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
        setEditCallsign(newSession.user.callsign);
        setEditUsername(newSession.user.username);
        setEditEmail(newSession.user.email);
        setSyncStats(getSyncStats());
        setAuthSuccess(`Operative clearance established: ${newSession.user.callsign}`);
        setActiveTab('sync');
        loadDevices();
        handleManualSync();
      } else if (authMode === 'login') {
        if (!username || !password) {
          throw new Error('Please enter your operative callsign and password.');
        }

        const loggedInSession = await loginAccount({
          usernameOrEmail: username.trim(),
          password,
        });

        playBeep('complete');
        setSession(loggedInSession);
        setEditCallsign(loggedInSession.user.callsign);
        setEditUsername(loggedInSession.user.username);
        setEditEmail(loggedInSession.user.email);
        setSyncStats(getSyncStats());
        setAuthSuccess(`SatCom handshake verified. Welcome back, Commander ${loggedInSession.user.callsign}.`);
        setActiveTab('sync');
        loadDevices();
        handleManualSync();
      } else if (authMode === 'forgot') {
        if (!username || !recoveryKeyInput || !password) {
          throw new Error('Enter your username/email, satellite recovery key, and new password.');
        }
        if (password !== confirmPassword) {
          throw new Error('New password keys do not match.');
        }

        const res = await resetPassword({
          usernameOrEmail: username.trim(),
          recoveryKey: recoveryKeyInput.trim(),
          newPassword: password,
        });

        playBeep('complete');
        setAuthSuccess(res.message);
        setAuthMode('login');
        setPassword('');
        setConfirmPassword('');
      } else if (authMode === 'pair') {
        if (!pairingTokenInput) {
          throw new Error('Please paste your Satellite Pairing Token from your other terminal.');
        }

        const pairedSession = await importSatellitePairingToken(pairingTokenInput.trim());
        playBeep('complete');
        setSession(pairedSession);
        setSyncStats(getSyncStats());
        setAuthSuccess(`Device paired & synchronized: All dossiers, routines, and credentials linked to Operative ${pairedSession.user.callsign}.`);
        setActiveTab('sync');
        handleManualSync();
      }
    } catch (err: any) {
      playBeep('error');
      setAuthError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleUpdateProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setProfileLoading(true);

    try {
      if (editNewPassword) {
        if (!editCurrentPassword) {
          throw new Error('Enter your current password to authorize password change.');
        }
        if (editNewPassword.length < 6) {
          throw new Error('New password must be at least 6 characters.');
        }
        if (editNewPassword !== editConfirmPassword) {
          throw new Error('New password keys do not match.');
        }
      }

      const updated = await updateProfile({
        callsign: editCallsign.trim() || undefined,
        username: editUsername.trim() || undefined,
        email: editEmail.trim() || undefined,
        currentPassword: editCurrentPassword || undefined,
        newPassword: editNewPassword || undefined,
      });

      playBeep('complete');
      setSession({ ...updated });
      setProfileSuccess('Operative profile & credentials updated successfully.');
      setEditCurrentPassword('');
      setEditNewPassword('');
      setEditConfirmPassword('');
      setIsEditingProfile(false);
    } catch (err: any) {
      playBeep('error');
      setProfileError(err.message || 'Failed to update operative profile.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleOpenMobilePairing = async () => {
    try {
      setSyncFeedback('Encrypting and bundling dossiers & credentials into pairing token...');
      const code = await exportSatellitePairingToken();
      setGeneratedPairingCode(code);
      setShowPairingModal(true);
      playBeep('tap');
    } catch (err: any) {
      alert(`Cannot export pairing code: ${err.message}`);
    }
  };

  const handleCopyPairingCode = () => {
    if (!generatedPairingCode) return;
    navigator.clipboard.writeText(generatedPairingCode);
    setCopiedPairing(true);
    playBeep('tap');
    setTimeout(() => setCopiedPairing(false), 2500);
  };

  const handleCopyRecoveryKey = () => {
    if (!session?.user?.recoveryKey) return;
    navigator.clipboard.writeText(session.user.recoveryKey);
    setCopiedRecovery(true);
    playBeep('tap');
    setTimeout(() => setCopiedRecovery(false), 2500);
  };

  const handleLogout = () => {
    playBeep('tap');
    logoutAccount();
    setSession(null);
    setActiveTab('account');
    setAuthMode('login');
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
            ? '✓ Synchronization complete. Remote dossiers & routines merged.'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-zinc-950 border border-emerald-500/30 rounded-xl shadow-2xl shadow-emerald-950/40 flex flex-col max-h-[92vh] overflow-hidden text-zinc-100 font-mono">
        {/* Top Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-emerald-500/20 bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold tracking-wider text-emerald-400 flex items-center gap-1.5 uppercase">
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
            className="p-1.5 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer"
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
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg font-semibold transition-all cursor-pointer ${
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
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg font-semibold transition-all cursor-pointer ${
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
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg font-semibold transition-all cursor-pointer ${
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
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 text-xs">
          {/* TAB 1: CLOUD SYNC */}
          {activeTab === 'sync' && (
            <div className="space-y-4">
              {!session ? (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3 text-amber-300">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-400 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-xs text-amber-200">
                      Terminal in Air-Gapped Mode
                    </p>
                    <p className="text-[11px] text-amber-300/80 leading-relaxed">
                      Register or sign into your Operative Account to synchronize workspace files, nightshift routines, and agent memories seamlessly across your desktop and mobile phone.
                    </p>
                    <button
                      onClick={() => {
                        playBeep('tap');
                        setActiveTab('account');
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded border border-amber-500/40 text-[11px] font-bold cursor-pointer"
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
                        : session?.user?.lastLoginAt
                        ? new Date(session.user.lastLoginAt).toLocaleTimeString()
                        : 'Handshake Verified'}
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
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-xs shadow-lg transition-all cursor-pointer ${
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
                  className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                    autoSync ? 'bg-emerald-500 justify-end' : 'bg-zinc-700 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-zinc-950 shadow-md" />
                </button>
              </div>

              {/* Direct Multi-Device Sync Relay (QR / Token) */}
              <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg space-y-2">
                <h4 className="font-semibold text-xs text-zinc-200 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                  Instant Desktop & Mobile Direct Sync Link
                </h4>
                <p className="text-[10px] text-zinc-400">
                  Transfer all current dossiers, routines, and memories directly between desktop and mobile with 1 tap.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={handleOpenMobilePairing}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 rounded border border-emerald-600/40 text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Send Dossiers to Mobile (Copy Token)</span>
                  </button>
                  <button
                    onClick={() => {
                      playBeep('tap');
                      setActiveTab('account');
                      setAuthMode('pair');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-300 rounded border border-cyan-600/40 text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Receive / Import Sync Token</span>
                  </button>
                </div>
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
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded border border-zinc-700 text-[11px] font-semibold transition-colors cursor-pointer"
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
                  {profileSuccess && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                      <span>{profileSuccess}</span>
                    </div>
                  )}

                  {!isEditingProfile ? (
                    <div className="p-4 bg-zinc-900/60 border border-emerald-500/30 rounded-xl space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
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

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              playBeep('tap');
                              setIsEditingProfile(true);
                              setProfileError(null);
                              setProfileSuccess(null);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>EDIT PROFILE</span>
                          </button>

                          <button
                            onClick={handleLogout}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 rounded border border-rose-500/30 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>DISCONNECT</span>
                          </button>
                        </div>
                      </div>

                      {/* Satellite Recovery Key Card */}
                      {session.user.recoveryKey && (
                        <div className="p-3 bg-zinc-950/80 border border-amber-500/30 rounded-lg space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-amber-400 flex items-center gap-1.5">
                              <Key className="w-3.5 h-3.5" />
                              Satellite Recovery Key (Keep Secret)
                            </span>
                            <button
                              onClick={handleCopyRecoveryKey}
                              className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 rounded border border-amber-500/30 text-[10px] cursor-pointer"
                            >
                              {copiedRecovery ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedRecovery ? 'COPIED' : 'COPY KEY'}</span>
                            </button>
                          </div>
                          <div className="font-mono text-xs text-amber-200 tracking-wider bg-zinc-900 px-2.5 py-1.5 rounded border border-zinc-800 select-all">
                            {session.user.recoveryKey}
                          </div>
                          <p className="text-[9px] text-zinc-400">
                            Required to recover or reset your password if forgotten.
                          </p>
                        </div>
                      )}

                      {/* Metadata Grid */}
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
                          <span className="text-[9px] text-zinc-500 block uppercase">Terminal Node</span>
                          <span className="font-mono text-zinc-300 truncate block">{currentDevice.deviceName}</span>
                        </div>
                        <div className="p-2.5 bg-zinc-950/60 rounded border border-zinc-800/80">
                          <span className="text-[9px] text-zinc-500 block uppercase">Session Valid Till</span>
                          <span className="text-zinc-300">{new Date(session.expiresAt).toLocaleDateString()}</span>
                        </div>
                      </div>

                      {/* Quick Mobile Pairing Action */}
                      <div className="pt-2">
                        <button
                          onClick={handleOpenMobilePairing}
                          className="w-full py-2.5 bg-gradient-to-r from-emerald-600/30 to-cyan-600/30 hover:from-emerald-600/40 hover:to-cyan-600/40 border border-emerald-500/40 rounded-lg text-emerald-200 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                        >
                          <Smartphone className="w-4 h-4 text-emerald-400" />
                          <span>📱 PAIR MOBILE TERMINAL (INSTANT 1-CLICK LINK)</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Edit Profile Form */
                    <div className="p-4 bg-zinc-900/60 border border-cyan-500/30 rounded-xl space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                        <h3 className="font-bold text-sm text-cyan-300 flex items-center gap-2">
                          <Edit3 className="w-4 h-4" />
                          Edit Operative Profile & Credentials
                        </h3>
                        <button
                          onClick={() => {
                            playBeep('tap');
                            setIsEditingProfile(false);
                          }}
                          className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Back</span>
                        </button>
                      </div>

                      {profileError && (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                          <span>{profileError}</span>
                        </div>
                      )}

                      <form onSubmit={handleUpdateProfileSubmit} className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                              Operative Callsign
                            </label>
                            <input
                              type="text"
                              required
                              value={editCallsign}
                              onChange={(e) => setEditCallsign(e.target.value)}
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-cyan-400"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                              Agent Handle / Username
                            </label>
                            <input
                              type="text"
                              required
                              value={editUsername}
                              onChange={(e) => setEditUsername(e.target.value)}
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-cyan-400"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                            Satellite Comms Email
                          </label>
                          <input
                            type="email"
                            required
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-cyan-400"
                          />
                        </div>

                        <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg space-y-3">
                          <span className="text-[10px] uppercase font-bold text-zinc-300 block">
                            Change Password (Leave blank to keep current)
                          </span>

                          <div>
                            <label className="block text-[9px] uppercase font-bold text-zinc-400 mb-1">
                              Current Password (Required for changes)
                            </label>
                            <input
                              type="password"
                              placeholder="••••••••••••"
                              value={editCurrentPassword}
                              onChange={(e) => setEditCurrentPassword(e.target.value)}
                              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-cyan-400"
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[9px] uppercase font-bold text-zinc-400 mb-1">
                                New Password
                              </label>
                              <input
                                type="password"
                                placeholder="••••••••••••"
                                value={editNewPassword}
                                onChange={(e) => setEditNewPassword(e.target.value)}
                                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-cyan-400"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] uppercase font-bold text-zinc-400 mb-1">
                                Confirm New Password
                              </label>
                              <input
                                type="password"
                                placeholder="••••••••••••"
                                value={editConfirmPassword}
                                onChange={(e) => setEditConfirmPassword(e.target.value)}
                                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-cyan-400"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="submit"
                            disabled={profileLoading}
                            className="flex-1 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>{profileLoading ? 'UPDATING PROFILE...' : 'SAVE PROFILE & CREDENTIALS'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              playBeep('tap');
                              setIsEditingProfile(false);
                            }}
                            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-lg text-xs transition-colors cursor-pointer"
                          >
                            CANCEL
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Mobile Pairing Popup / Code Display */}
                  {showPairingModal && (
                    <div className="p-4 bg-zinc-900/90 border border-emerald-500/40 rounded-xl space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                        <div className="flex items-center gap-2">
                          <QrCode className="w-4 h-4 text-emerald-400" />
                          <h4 className="font-bold text-xs text-emerald-300">
                            Satellite Direct Pairing Token
                          </h4>
                        </div>
                        <button
                          onClick={() => setShowPairingModal(false)}
                          className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <p className="text-[11px] text-zinc-300 leading-relaxed">
                        To sign in on your mobile phone without typing passwords, open PixelOps on your phone, click <strong>[ 📱 PAIR VIA SATELLITE CODE ]</strong> on the Sign In screen, and paste this token:
                      </p>

                      <div className="p-2.5 bg-zinc-950 rounded border border-zinc-800 font-mono text-[10px] text-emerald-300 break-all select-all">
                        {generatedPairingCode}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopyPairingCode}
                          className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                        >
                          {copiedPairing ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          <span>{copiedPairing ? 'COPIED TO CLIPBOARD' : 'COPY PAIRING TOKEN'}</span>
                        </button>
                        <button
                          onClick={() => setShowPairingModal(false)}
                          className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded text-xs cursor-pointer"
                        >
                          DONE
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Unauthenticated Auth Views: login, register, forgot, pair */
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
                      className={`flex-1 py-1.5 rounded font-bold transition-all cursor-pointer ${
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
                      className={`flex-1 py-1.5 rounded font-bold transition-all cursor-pointer ${
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

                  {/* VIEW 1: SIGN IN */}
                  {authMode === 'login' && (
                    <form onSubmit={handleAuthSubmit} className="space-y-3">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Operative Callsign, Username or Email
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. commander99 or SPECTRE"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[10px] uppercase font-bold text-zinc-400">
                            Cryptographic Password
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              playBeep('tap');
                              setAuthMode('forgot');
                              setAuthError(null);
                              setAuthSuccess(null);
                            }}
                            className="text-[10px] text-amber-400 hover:text-amber-300 underline cursor-pointer"
                          >
                            Forgot Password?
                          </button>
                        </div>
                        <input
                          type="password"
                          required
                          placeholder="••••••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50 cursor-pointer"
                      >
                        <KeyRound className="w-4 h-4" />
                        <span>{authLoading ? 'AUTHENTICATING...' : 'SIGN IN & LINK DEVICE'}</span>
                      </button>

                      {/* Direct Mobile Pairing Option */}
                      <div className="pt-2 border-t border-zinc-800 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            playBeep('tap');
                            setAuthMode('pair');
                            setAuthError(null);
                            setAuthSuccess(null);
                          }}
                          className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center justify-center gap-1.5 w-full py-1 cursor-pointer"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          <span>Switching from desktop? Pair via Satellite Code</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {/* VIEW 2: REGISTER */}
                  {authMode === 'register' && (
                    <form onSubmit={handleAuthSubmit} className="space-y-3">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Operative Callsign (Display Name)
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. SPECTRE, CIPHER, VANCE"
                          value={callsign}
                          onChange={(e) => setCallsign(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Username / Agent Handle
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. commander99"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 text-xs focus:outline-none focus:border-emerald-400"
                        />
                      </div>

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

                      <button
                        type="submit"
                        disabled={authLoading}
                        className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/25 disabled:opacity-50 cursor-pointer"
                      >
                        <KeyRound className="w-4 h-4" />
                        <span>{authLoading ? 'ESTABLISHING CLEARANCE...' : 'ESTABLISH OPERATIVE CLEARANCE'}</span>
                      </button>
                    </form>
                  )}

                  {/* VIEW 3: FORGOT PASSWORD */}
                  {authMode === 'forgot' && (
                    <form onSubmit={handleAuthSubmit} className="space-y-3">
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs flex items-start gap-2.5">
                        <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-200">Satellite Key Recovery</p>
                          <p className="text-[10px] text-amber-300/80 leading-relaxed">
                            Enter your Operative Username/Email and the Satellite Recovery Key issued when your account was created.
                          </p>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Operative Username or Email
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. commander99"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Satellite Recovery Key
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. SATCOM-CIPHER-XXXX-XXXX"
                          value={recoveryKeyInput}
                          onChange={(e) => setRecoveryKeyInput(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 font-mono text-xs focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                            New Password
                          </label>
                          <input
                            type="password"
                            required
                            placeholder="••••••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-amber-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                            Confirm New Password
                          </label>
                          <input
                            type="password"
                            required
                            placeholder="••••••••••••"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 text-xs focus:outline-none focus:border-amber-400"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={authLoading}
                          className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          <Key className="w-4 h-4" />
                          <span>{authLoading ? 'RESETTING...' : 'RESET PASSWORD KEY'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            playBeep('tap');
                            setAuthMode('login');
                          }}
                          className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-lg text-xs cursor-pointer"
                        >
                          BACK TO SIGN IN
                        </button>
                      </div>
                    </form>
                  )}

                  {/* VIEW 4: PAIR VIA SATELLITE CODE */}
                  {authMode === 'pair' && (
                    <form onSubmit={handleAuthSubmit} className="space-y-3">
                      <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-300 text-xs flex items-start gap-2.5">
                        <Smartphone className="w-4 h-4 flex-shrink-0 text-cyan-400 mt-0.5" />
                        <div>
                          <p className="font-semibold text-cyan-200">Pair Mobile Device</p>
                          <p className="text-[10px] text-cyan-300/80 leading-relaxed">
                            On your desktop terminal, open <strong>Operative Account</strong> and click <strong>[ PAIR MOBILE TERMINAL ]</strong> to copy the token. Paste it below to link immediately.
                          </p>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 mb-1">
                          Satellite Pairing Token
                        </label>
                        <textarea
                          required
                          rows={3}
                          placeholder="Paste SATCOM-PAIR::... token here"
                          value={pairingTokenInput}
                          onChange={(e) => setPairingTokenInput(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-zinc-100 font-mono text-[11px] focus:outline-none focus:border-cyan-400"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={authLoading}
                          className="flex-1 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{authLoading ? 'LINKING...' : 'LINK & SYNC NOW'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            playBeep('tap');
                            setAuthMode('login');
                          }}
                          className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-lg text-xs cursor-pointer"
                        >
                          BACK TO SIGN IN
                        </button>
                      </div>
                    </form>
                  )}
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
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[11px] font-semibold transition-colors cursor-pointer"
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
                            className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
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
        <div className="px-3 sm:px-4 py-2.5 bg-zinc-900/60 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>End-to-end encrypted safehouse state sync (LWW conflict resolution)</span>
          </div>
          <button
            onClick={() => {
              playBeep('tap');
              onClose();
            }}
            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded font-bold transition-colors cursor-pointer"
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
};
