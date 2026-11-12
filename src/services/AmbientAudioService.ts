import type { RoomId } from '../components/spriteWorld';

export interface RoomSoundscapeProfile {
  roomId: RoomId;
  title: string;
  shortTag: string;
  description: string;
  waveformLabel: string;
  baseFreqHz: number;
  accentColor: string;
}

export const ROOM_SOUNDSCAPE_PROFILES: Record<RoomId, RoomSoundscapeProfile> = {
  war_room: {
    roomId: 'war_room',
    title: 'Tactical Console Hum & Sonar Blips',
    shortTag: 'TACTICAL HUM',
    description:
      'Low-frequency 64Hz mainframe transformer drone layered with periodic CRT radar sweep pings.',
    waveformLabel: 'TRIANGLE 64Hz + SONAR 1320Hz',
    baseFreqHz: 64,
    accentColor: '#e59838',
  },
  server_vault: {
    roomId: 'server_vault',
    title: 'Ticking Server Fans & Blade Telemetry',
    shortTag: 'SERVER FANS',
    description:
      'Filtered airflow noise loop with rhythmic relay fan ticks and high-speed data-bus chirps.',
    waveformLabel: 'BANDPASS FAN NOISE + 16-BIT TICKS',
    baseFreqHz: 110,
    accentColor: '#38bdf8',
  },
  library: {
    roomId: 'library',
    title: 'Library Page Turning & Whispering Stacks',
    shortTag: 'PAGE & WHISPER',
    description:
      'Formant-swept whisper air and crisp parchment page-turn rustles with a quiet archival clock.',
    waveformLabel: 'FORMANT NOISE + PENDULUM 420Hz',
    baseFreqHz: 420,
    accentColor: '#fb7185',
  },
  comms_tower: {
    roomId: 'comms_tower',
    title: 'Orbital Carrier Wave & Shortwave Morse',
    shortTag: 'CW MORSE',
    description:
      'High-altitude dish carrier oscillation with rhythmic shortwave Morse code dits and dahs.',
    waveformLabel: 'SINE 1046Hz CW + STATIC HISS',
    baseFreqHz: 1046,
    accentColor: '#22d3ee',
  },
  armory: {
    roomId: 'armory',
    title: 'Ordnance Bench Servo & Capacitor Hum',
    shortTag: 'SERVO HUM',
    description:
      'Deep ballistic locker power hum with periodic drone-bay servo calibration sweeps.',
    waveformLabel: 'SAWTOOTH LP 82Hz + SERVO SWEEP',
    baseFreqHz: 82,
    accentColor: '#4ade80',
  },
  briefing_lounge: {
    roomId: 'briefing_lounge',
    title: 'Lo-Fi Safehouse Chords & Espresso Steam',
    shortTag: 'LOUNGE SYNTH',
    description:
      'Warm 8-bit triangle arpeggio chords paired with soft espresso steamer pressure hisses.',
    waveformLabel: '8-BIT ARP 220Hz + STEAM BURST',
    baseFreqHz: 220,
    accentColor: '#fbbf24',
  },
  archive_basement: {
    roomId: 'archive_basement',
    title: 'Sub-Level Cryo Drone & Pneumatic Tubes',
    shortTag: 'CRYO DRONE',
    description:
      'Deep subterranean vault resonance with pneumatic canister whooshes and microfiche clicks.',
    waveformLabel: 'SUB-SINE 48Hz + PNEUMATIC AIR',
    baseFreqHz: 48,
    accentColor: '#a855f7',
  },
};

const STORAGE_AMBIENT_ENABLED_KEY = 'pixelops_ambient_enabled_v1';
const STORAGE_AMBIENT_VOLUME_KEY = 'pixelops_ambient_volume_v1';

/**
 * Procedural Web Audio API Retro Ambient Soundscape Engine.
 * Synthesizes continuous drone/fan/air layers + scheduled rhythmic room events
 * (server fan ticks, library page turns/whispers, war room tactical hums & pings, etc.)
 * and crossfades dynamically whenever `currentRoom` updates.
 */
class AmbientAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private activeRoom: RoomId = 'war_room';
  private isEnabled: boolean = true;
  private masterVolume: number = 0.35; // 0.0 to 1.0
  private isPlaying: boolean = false;

  // Currently active continuous nodes & interval timers for the active room
  private activeNodes: AudioNode[] = [];
  private activeOscillators: Array<OscillatorNode | AudioBufferSourceNode> = [];
  private roomEventTimer: ReturnType<typeof setInterval> | null = null;
  private unlockBound: boolean = false;
  private listeners: Set<() => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const savedEnabled = localStorage.getItem(STORAGE_AMBIENT_ENABLED_KEY);
        if (savedEnabled !== null) {
          this.isEnabled = savedEnabled === 'true';
        }
        const savedVol = localStorage.getItem(STORAGE_AMBIENT_VOLUME_KEY);
        if (savedVol !== null) {
          const parsed = parseFloat(savedVol);
          if (!Number.isNaN(parsed)) {
            this.masterVolume = Math.max(0.05, Math.min(1, parsed));
          }
        }
      } catch {
        // Ignore storage errors
      }
      this.bindAutoplayUnlock();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((fn) => fn());
  }

  private bindAutoplayUnlock() {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;

    const unlock = () => {
      if (this.isEnabled) {
        this.ensureContextRunning();
        if (!this.isPlaying) {
          this.startRoomLoop(this.activeRoom);
        }
      }
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  private ensureContextRunning(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(
          this.isEnabled ? this.masterVolume * 0.14 : 0.0001,
          this.ctx.currentTime
        );
        this.masterGain.connect(this.ctx.destination);
        this.noiseBuffer = this.createWhiteNoiseBuffer(this.ctx, 3.0);
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private createWhiteNoiseBuffer(
    ctx: AudioContext,
    durationSec: number
  ): AudioBuffer {
    const bufferSize = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    // Pink-tinted retro noise for smoother fan/whisper/steam textures
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 0.0526913;
      output[i] = (b0 + b1 + b2 + white * 0.18) * 0.22;
    }
    return buffer;
  }

  private teardownCurrentLoop() {
    if (this.roomEventTimer) {
      clearInterval(this.roomEventTimer);
      this.roomEventTimer = null;
    }

    for (const src of this.activeOscillators) {
      try {
        src.stop();
      } catch {
        // Already stopped
      }
      try {
        src.disconnect();
      } catch {
        // Ignore
      }
    }
    this.activeOscillators = [];

    for (const node of this.activeNodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore
      }
    }
    this.activeNodes = [];
    this.isPlaying = false;
  }

  /**
   * Dynamically switches the synthesized ambient soundscape loop when `currentRoom` changes.
   */
  public setRoom(roomId: RoomId, globalSoundEnabled: boolean = true) {
    const roomChanged = this.activeRoom !== roomId;
    this.activeRoom = roomId;

    if (!globalSoundEnabled || !this.isEnabled) {
      this.teardownCurrentLoop();
      this.notifyListeners();
      return;
    }

    if (roomChanged || !this.isPlaying) {
      this.startRoomLoop(roomId);
      this.notifyListeners();
    }
  }

  public setAmbientEnabled(enabled: boolean, globalSoundEnabled: boolean = true) {
    this.isEnabled = enabled;
    try {
      localStorage.setItem(STORAGE_AMBIENT_ENABLED_KEY, String(enabled));
    } catch {
      // Ignore
    }

    if (!enabled || !globalSoundEnabled) {
      this.teardownCurrentLoop();
    } else {
      this.startRoomLoop(this.activeRoom);
    }
    this.notifyListeners();
  }

  public setVolume(volume: number) {
    this.masterVolume = Math.max(0.05, Math.min(1, volume));
    try {
      localStorage.setItem(
        STORAGE_AMBIENT_VOLUME_KEY,
        String(this.masterVolume)
      );
    } catch {
      // Ignore
    }

    if (this.ctx && this.masterGain && this.isEnabled) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(
        this.masterVolume * 0.14,
        now,
        0.08
      );
    }
    this.notifyListeners();
  }

  public getState() {
    return {
      activeRoom: this.activeRoom,
      isEnabled: this.isEnabled,
      volume: this.masterVolume,
      isPlaying: this.isPlaying,
      profile:
        ROOM_SOUNDSCAPE_PROFILES[this.activeRoom] ||
        ROOM_SOUNDSCAPE_PROFILES.war_room,
    };
  }

  /**
   * Plays an immediate 1.2s audition burst of the specified room's characteristic sound
   * when the user clicks "Test Room Synth" or switches sectors.
   */
  public triggerRoomTransitionAccent(roomId: RoomId) {
    if (!this.isEnabled) return;
    const ctx = this.ensureContextRunning();
    if (!ctx || !this.masterGain) return;

    // Ensure the continuous room loop is running
    if (this.activeRoom !== roomId || !this.isPlaying) {
      this.startRoomLoop(roomId);
    }
  }

  private startRoomLoop(roomId: RoomId) {
    this.teardownCurrentLoop();
    if (!this.isEnabled) return;

    const ctx = this.ensureContextRunning();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    // Smooth fade-in on room switch
    this.masterGain.gain.setValueAtTime(0.001, now);
    this.masterGain.gain.exponentialRampToValueAtTime(
      Math.max(0.008, this.masterVolume * 0.14),
      now + 0.35
    );

    const roomBus = ctx.createGain();
    roomBus.gain.setValueAtTime(1.0, now);
    roomBus.connect(this.masterGain);
    this.activeNodes.push(roomBus);

    // Build room-specific continuous bed + periodic retro-synthesized textures
    switch (roomId) {
      case 'war_room':
        this.setupWarRoomLoop(ctx, roomBus);
        break;
      case 'server_vault':
        this.setupServerVaultLoop(ctx, roomBus);
        break;
      case 'library':
        this.setupLibraryLoop(ctx, roomBus);
        break;
      case 'comms_tower':
        this.setupCommsTowerLoop(ctx, roomBus);
        break;
      case 'armory':
        this.setupArmoryLoop(ctx, roomBus);
        break;
      case 'briefing_lounge':
        this.setupBriefingLoungeLoop(ctx, roomBus);
        break;
      case 'archive_basement':
        this.setupArchiveBasementLoop(ctx, roomBus);
        break;
      default:
        this.setupWarRoomLoop(ctx, roomBus);
        break;
    }

    this.isPlaying = true;
  }

  /**
   * 1. WAR ROOM: Tactical Console Sub-Hum (64Hz + 96Hz fifth) + Periodic Radar/Sonar Pings
   */
  private setupWarRoomLoop(ctx: AudioContext, dest: GainNode) {
    const now = ctx.currentTime;

    // Continuous Tactical Console Hum
    const subOsc = ctx.createOscillator();
    const fifthOsc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const droneGain = ctx.createGain();

    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(64, now);
    fifthOsc.type = 'sine';
    fifthOsc.frequency.setValueAtTime(96, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(190, now);

    droneGain.gain.setValueAtTime(0.42, now);

    subOsc.connect(filter);
    fifthOsc.connect(filter);
    filter.connect(droneGain);
    droneGain.connect(dest);

    subOsc.start(now);
    fifthOsc.start(now);
    this.activeOscillators.push(subOsc, fifthOsc);
    this.activeNodes.push(filter, droneGain);

    const playSonarBlip = () => {
      if (!this.ctx || !this.isPlaying || this.activeRoom !== 'war_room') return;
      const t = this.ctx.currentTime;
      const pingOsc = this.ctx.createOscillator();
      const pingGain = this.ctx.createGain();

      pingOsc.type = 'sine';
      pingOsc.frequency.setValueAtTime(1320, t);
      pingOsc.frequency.exponentialRampToValueAtTime(880, t + 0.18);

      pingGain.gain.setValueAtTime(0.16, t);
      pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

      pingOsc.connect(pingGain);
      pingGain.connect(dest);
      pingOsc.start(t);
      pingOsc.stop(t + 0.29);
    };

    // Fire an initial subtle ping, then repeat every 2.4s
    playSonarBlip();
    this.roomEventTimer = setInterval(playSonarBlip, 2400);
  }

  /**
   * 2. SERVER VAULT: Whirring Server Cooling Fans + Rhythmic Relay Ticks & Data-Bus Chirps
   */
  private setupServerVaultLoop(ctx: AudioContext, dest: GainNode) {
    const now = ctx.currentTime;

    // Continuous Bandpass-Filtered Server Fan Whir
    if (this.noiseBuffer) {
      const fanNoise = ctx.createBufferSource();
      fanNoise.buffer = this.noiseBuffer;
      fanNoise.loop = true;

      const fanFilter = ctx.createBiquadFilter();
      fanFilter.type = 'bandpass';
      fanFilter.frequency.setValueAtTime(340, now);
      fanFilter.Q.setValueAtTime(2.2, now);

      // Slow LFO modulating the fan RPM pitch
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.28, now);
      lfoGain.gain.setValueAtTime(75, now);
      lfo.connect(lfoGain);
      lfoGain.connect(fanFilter.frequency);

      const fanGain = ctx.createGain();
      fanGain.gain.setValueAtTime(0.45, now);

      fanNoise.connect(fanFilter);
      fanFilter.connect(fanGain);
      fanGain.connect(dest);

      fanNoise.start(now);
      lfo.start(now);
      this.activeOscillators.push(fanNoise, lfo);
      this.activeNodes.push(fanFilter, lfoGain, fanGain);
    }

    // Rhythmic Ticking Server Fans & Reel-to-Reel Data Chatter
    let step = 0;
    const playServerTick = () => {
      if (!this.ctx || !this.isPlaying || this.activeRoom !== 'server_vault') return;
      const t = this.ctx.currentTime;
      step = (step + 1) % 8;

      // Mechanical fan/relay tick
      const tickOsc = this.ctx.createOscillator();
      const tickGain = this.ctx.createGain();
      tickOsc.type = 'square';
      tickOsc.frequency.setValueAtTime(step % 2 === 0 ? 1480 : 1180, t);
      tickGain.gain.setValueAtTime(0.08, t);
      tickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
      tickOsc.connect(tickGain);
      tickGain.connect(dest);
      tickOsc.start(t);
      tickOsc.stop(t + 0.025);

      // Every 3rd step, play a dual-tone mainframe data-bus packet chirp
      if (step % 3 === 0) {
        const dataOsc = this.ctx.createOscillator();
        const dataGain = this.ctx.createGain();
        dataOsc.type = 'square';
        const baseFreq = step === 0 ? 2240 : 1920;
        dataOsc.frequency.setValueAtTime(baseFreq, t + 0.05);
        dataOsc.frequency.setValueAtTime(baseFreq * 1.25, t + 0.085);
        dataGain.gain.setValueAtTime(0.07, t + 0.05);
        dataGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
        dataOsc.connect(dataGain);
        dataGain.connect(dest);
        dataOsc.start(t + 0.05);
        dataOsc.stop(t + 0.14);
      }
    };

    playServerTick();
    this.roomEventTimer = setInterval(playServerTick, 360);
  }

  /**
   * 3. INTEL LIBRARY: Parchment Page Turning, Formant Whispering Air & Archival Pendulum Tick
   */
  private setupLibraryLoop(ctx: AudioContext, dest: GainNode) {
    const now = ctx.currentTime;

    // Quiet room air tone
    const roomTone = ctx.createOscillator();
    const roomGain = ctx.createGain();
    roomTone.type = 'sine';
    roomTone.frequency.setValueAtTime(110, now);
    roomGain.gain.setValueAtTime(0.12, now);
    roomTone.connect(roomGain);
    roomGain.connect(dest);
    roomTone.start(now);
    this.activeOscillators.push(roomTone);
    this.activeNodes.push(roomGain);

    let beat = 0;
    const playLibraryTexture = () => {
      if (!this.ctx || !this.isPlaying || this.activeRoom !== 'library') return;
      const t = this.ctx.currentTime;
      beat = (beat + 1) % 4;

      // Soft wooden archival clock tick-tock
      const clockOsc = this.ctx.createOscillator();
      const clockGain = this.ctx.createGain();
      clockOsc.type = 'triangle';
      clockOsc.frequency.setValueAtTime(beat % 2 === 0 ? 420 : 315, t);
      clockGain.gain.setValueAtTime(0.11, t);
      clockGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      clockOsc.connect(clockGain);
      clockGain.connect(dest);
      clockOsc.start(t);
      clockOsc.stop(t + 0.04);

      // Page turning rustle or hushed library whisper on alternating beats
      if (this.noiseBuffer && (beat === 1 || beat === 3)) {
        const rustleSrc = this.ctx.createBufferSource();
        rustleSrc.buffer = this.noiseBuffer;

        const formantFilter = this.ctx.createBiquadFilter();
        formantFilter.type = 'bandpass';

        const rustleGain = this.ctx.createGain();

        if (beat === 1) {
          // Crisp page-turn swish (rapid high-band sweep 900Hz -> 2400Hz)
          formantFilter.Q.setValueAtTime(3.2, t + 0.15);
          formantFilter.frequency.setValueAtTime(900, t + 0.15);
          formantFilter.frequency.exponentialRampToValueAtTime(2400, t + 0.34);
          rustleGain.gain.setValueAtTime(0.001, t + 0.15);
          rustleGain.gain.linearRampToValueAtTime(0.28, t + 0.22);
          rustleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
        } else {
          // Soft archival whisper air (dual formant glide 650Hz -> 1250Hz -> 780Hz)
          formantFilter.Q.setValueAtTime(5.5, t + 0.12);
          formantFilter.frequency.setValueAtTime(650, t + 0.12);
          formantFilter.frequency.linearRampToValueAtTime(1250, t + 0.32);
          formantFilter.frequency.linearRampToValueAtTime(780, t + 0.55);
          rustleGain.gain.setValueAtTime(0.001, t + 0.12);
          rustleGain.gain.linearRampToValueAtTime(0.22, t + 0.28);
          rustleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        }

        rustleSrc.connect(formantFilter);
        formantFilter.connect(rustleGain);
        rustleGain.connect(dest);

        rustleSrc.start(t + 0.12);
        rustleSrc.stop(t + 0.65);
      }
    };

    playLibraryTexture();
    this.roomEventTimer = setInterval(playLibraryTexture, 1100);
  }

  /**
   * 4. COMMS TOWER: Orbital Dish Carrier Wave + Shortwave Morse Code Telemetry
   */
  private setupCommsTowerLoop(ctx: AudioContext, dest: GainNode) {
    const now = ctx.currentTime;

    // High-altitude carrier wave pad
    const carrier = ctx.createOscillator();
    const carrierGain = ctx.createGain();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(196, now);
    carrierGain.gain.setValueAtTime(0.18, now);
    carrier.connect(carrierGain);
    carrierGain.connect(dest);
    carrier.start(now);
    this.activeOscillators.push(carrier);
    this.activeNodes.push(carrierGain);

    // Morse code pattern (dit-dit-dah-dit)
    const morsePattern = [0.06, 0.06, 0.16, 0.06, 0.18];
    let idx = 0;

    const playMorsePulse = () => {
      if (!this.ctx || !this.isPlaying || this.activeRoom !== 'comms_tower') return;
      const t = this.ctx.currentTime;
      const dur = morsePattern[idx % morsePattern.length];
      idx++;

      const cwOsc = this.ctx.createOscillator();
      const cwGain = this.ctx.createGain();
      cwOsc.type = 'sine';
      cwOsc.frequency.setValueAtTime(idx % 4 === 0 ? 1174.66 : 1046.5, t);

      cwGain.gain.setValueAtTime(0.12, t);
      cwGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      cwOsc.connect(cwGain);
      cwGain.connect(dest);
      cwOsc.start(t);
      cwOsc.stop(t + dur + 0.01);
    };

    playMorsePulse();
    this.roomEventTimer = setInterval(playMorsePulse, 480);
  }

  /**
   * 5. ARMORY: Ballistic Bench Low-Pass Sawtooth Hum + Recon Drone Servo Sweeps
   */
  private setupArmoryLoop(ctx: AudioContext, dest: GainNode) {
    const now = ctx.currentTime;

    const benchOsc = ctx.createOscillator();
    const benchFilter = ctx.createBiquadFilter();
    const benchGain = ctx.createGain();

    benchOsc.type = 'sawtooth';
    benchOsc.frequency.setValueAtTime(82.41, now); // Low E2 ordnance power hum
    benchFilter.type = 'lowpass';
    benchFilter.frequency.setValueAtTime(210, now);
    benchGain.gain.setValueAtTime(0.28, now);

    benchOsc.connect(benchFilter);
    benchFilter.connect(benchGain);
    benchGain.connect(dest);

    benchOsc.start(now);
    this.activeOscillators.push(benchOsc);
    this.activeNodes.push(benchFilter, benchGain);

    const playServoCalibration = () => {
      if (!this.ctx || !this.isPlaying || this.activeRoom !== 'armory') return;
      const t = this.ctx.currentTime;
      const servoOsc = this.ctx.createOscillator();
      const servoGain = this.ctx.createGain();

      servoOsc.type = 'triangle';
      servoOsc.frequency.setValueAtTime(320, t);
      servoOsc.frequency.exponentialRampToValueAtTime(640, t + 0.14);
      servoOsc.frequency.exponentialRampToValueAtTime(480, t + 0.24);

      servoGain.gain.setValueAtTime(0.11, t);
      servoGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);

      servoOsc.connect(servoGain);
      servoGain.connect(dest);
      servoOsc.start(t);
      servoOsc.stop(t + 0.27);
    };

    playServoCalibration();
    this.roomEventTimer = setInterval(playServoCalibration, 1950);
  }

  /**
   * 6. BRIEFING LOUNGE: Cozy 8-Bit Triangle Arpeggio Chords + Espresso Steam Hiss
   */
  private setupBriefingLoungeLoop(ctx: AudioContext, dest: GainNode) {
    // Warm A-minor7 / D9 retro lounge arpeggio notes
    const loungeNotes = [220.0, 261.63, 329.63, 392.0, 329.63, 293.66];
    let noteIdx = 0;

    const playLoungeStep = () => {
      if (!this.ctx || !this.isPlaying || this.activeRoom !== 'briefing_lounge') return;
      const t = this.ctx.currentTime;
      const freq = loungeNotes[noteIdx % loungeNotes.length];
      noteIdx++;

      const arpOsc = this.ctx.createOscillator();
      const arpGain = this.ctx.createGain();
      arpOsc.type = 'triangle';
      arpOsc.frequency.setValueAtTime(freq, t);

      arpGain.gain.setValueAtTime(0.14, t);
      arpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

      arpOsc.connect(arpGain);
      arpGain.connect(dest);
      arpOsc.start(t);
      arpOsc.stop(t + 0.46);

      // Every 6th note, trigger a soft espresso steam hiss
      if (this.noiseBuffer && noteIdx % 6 === 0) {
        const steamSrc = this.ctx.createBufferSource();
        steamSrc.buffer = this.noiseBuffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(1800, t);
        const steamGain = this.ctx.createGain();
        steamGain.gain.setValueAtTime(0.001, t);
        steamGain.gain.linearRampToValueAtTime(0.14, t + 0.08);
        steamGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        steamSrc.connect(hp);
        hp.connect(steamGain);
        steamGain.connect(dest);
        steamSrc.start(t);
        steamSrc.stop(t + 0.36);
      }
    };

    playLoungeStep();
    this.roomEventTimer = setInterval(playLoungeStep, 620);
  }

  /**
   * 7. ARCHIVE BASEMENT: Deep Sub-Level Cryo Drone + Pneumatic Canister Whoosh
   */
  private setupArchiveBasementLoop(ctx: AudioContext, dest: GainNode) {
    const now = ctx.currentTime;

    const subDrone = ctx.createOscillator();
    const fifthDrone = ctx.createOscillator();
    const droneGain = ctx.createGain();

    subDrone.type = 'sine';
    subDrone.frequency.setValueAtTime(48, now);
    fifthDrone.type = 'triangle';
    fifthDrone.frequency.setValueAtTime(72, now);

    droneGain.gain.setValueAtTime(0.36, now);

    subDrone.connect(droneGain);
    fifthDrone.connect(droneGain);
    droneGain.connect(dest);

    subDrone.start(now);
    fifthDrone.start(now);
    this.activeOscillators.push(subDrone, fifthDrone);
    this.activeNodes.push(droneGain);

    const playPneumaticWhoosh = () => {
      if (!this.ctx || !this.isPlaying || this.activeRoom !== 'archive_basement') return;
      const t = this.ctx.currentTime;

      if (this.noiseBuffer) {
        const whoosh = this.ctx.createBufferSource();
        whoosh.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.setValueAtTime(4.0, t);
        bp.frequency.setValueAtTime(240, t);
        bp.frequency.exponentialRampToValueAtTime(980, t + 0.25);
        bp.frequency.exponentialRampToValueAtTime(310, t + 0.5);

        const wGain = this.ctx.createGain();
        wGain.gain.setValueAtTime(0.001, t);
        wGain.gain.linearRampToValueAtTime(0.24, t + 0.14);
        wGain.gain.exponentialRampToValueAtTime(0.001, t + 0.52);

        whoosh.connect(bp);
        bp.connect(wGain);
        wGain.connect(dest);
        whoosh.start(t);
        whoosh.stop(t + 0.55);
      }
    };

    playPneumaticWhoosh();
    this.roomEventTimer = setInterval(playPneumaticWhoosh, 2600);
  }
}

export const ambientAudioService = new AmbientAudioEngine();
