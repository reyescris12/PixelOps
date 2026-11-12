/**
 * Tactical Voice Comms Service — Live Radio Dispatch
 * (src/services/TacticalVoiceService.ts)
 *
 * Push-to-Talk (PTT) full-duplex transceiver wired to the Gemini Multimodal Live
 * WebSocket API (`gemini-3.8-live` and `gemini-3.8-live-extended-thinking`),
 * routed via the Cloudflare Worker / Express WebSocket proxy (`/api/gemini-live`)
 * with automatic encrypted BYOK Vault decryption, non-hanging WebSocket handshake
 * negotiation, and zero-key Tactical Voice Relay fallback.
 *
 * Supports real-time voice command & barge-in replies with Operatives:
 *   - Vance  (Lead Strategist — Voice: Charon)
 *   - Nyx    (OSINT & Recon Specialist — Voice: Kore)
 *   - Cipher (Systems & Vault Cryptographer — Voice: Puck)
 */

import {
  GoogleGenAI,
  Modality,
  Behavior,
  Type,
  ActivityHandling,
  type Session,
  type LiveServerMessage,
} from '@google/genai';
import { getBYOKVaultSnapshot, getProviderApiKeyAsync } from './BYOKVault';
import { loadLLMProviderConfig } from './LLMProviderService';
import { getSecureCredential } from './SecureVaultService';
import { queryEntityNeighborhood, getEvidenceGraphSnapshot } from './EvidenceGraphService';
import { listTripwireAlerts, listTripwireWatches } from './TripwireDiffService';
import { executeAgentDirective } from './agentEngineLazy';

export type RadioOperativeId = 'vance' | 'nyx' | 'cipher';
export type RadioLiveModelId = 'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking';
export type RadioTransportRoute = 'cloudflare-proxy' | 'direct-byok' | 'tactical-relay';

export type RadioConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'standby'
  | 'transmitting_ptt'
  | 'receiving_voice'
  | 'extended_thinking'
  | 'error';

export interface OperativeRadioPersona {
  id: RadioOperativeId;
  callsign: string;
  displayName: string;
  role: string;
  frequencyMhz: string;
  voiceName: string;
  accentHex: string;
  systemPersona: string;
}

export interface RadioTranscriptEntry {
  id: string;
  speaker: 'COMMANDER' | 'OPERATIVE' | 'SYS_TOOL';
  operativeId: RadioOperativeId;
  text: string;
  timestamp: string;
  isPartial?: boolean;
}

export const OPERATIVE_RADIO_CHANNELS: Record<RadioOperativeId, OperativeRadioPersona> = {
  vance: {
    id: 'vance',
    callsign: 'ALPHA-1 // VANCE',
    displayName: 'Agent Vance',
    role: 'Lead Strategist & War Room Commander',
    frequencyMhz: '148.550 MHz',
    voiceName: 'Charon',
    accentHex: '#4ade80',
    systemPersona:
      'You are Agent Vance, Lead Strategist of the PixelOps Safehouse Command Center. Speak over tactical encrypted radio: concise, composed, authoritative, 1 to 3 crisp sentences unless asked for deep detail. Address the user as Commander. You can query the Evidence Graph, check Tripwire Watch alerts, or dispatch full Safehouse directives using your non-blocking tools.',
  },
  nyx: {
    id: 'nyx',
    callsign: 'RECON-2 // NYX',
    displayName: 'Operative Nyx',
    role: 'OSINT Recon & Threat Intelligence',
    frequencyMhz: '152.875 MHz',
    voiceName: 'Kore',
    accentHex: '#38bdf8',
    systemPersona:
      'You are Operative Nyx, OSINT Recon & Threat Hunter stationed at the Comms Tower. Speak over tactical radio with sharp, analytical situational awareness—1 to 3 sentences by default. Cite concrete domains, ASNs, CVEs, and tripwire deltas when available via your tools.',
  },
  cipher: {
    id: 'cipher',
    callsign: 'VAULT-3 // CIPHER',
    displayName: 'Operative Cipher',
    role: 'Server Vault Cryptographer & Forensics',
    frequencyMhz: '164.225 MHz',
    voiceName: 'Puck',
    accentHex: '#f59e0b',
    systemPersona:
      'You are Operative Cipher, Chief Cryptographer and Server Vault Systems Engineer in the PixelOps Safehouse. Speak with precise, technical tactical clarity (1 to 3 concise sentences). Reference SHA-256 tripwire hashes, VFS dossiers, and cross-investigation graph bridges accurately.',
  },
};

const COMPATIBILITY_LIVE_MODELS = [
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-2.0-flash-live-001',
] as const;

function isValidRealGeminiKey(candidate: string | null | undefined): candidate is string {
  if (!candidate) return false;
  const trimmed = candidate.trim();
  return (
    trimmed.length > 8 &&
    trimmed !== 'MY_GEMINI_API_KEY' &&
    trimmed !== 'PROXY_MANAGED' &&
    trimmed !== '••••••••' &&
    !trimmed.startsWith('••••')
  );
}

/**
 * Resolves the Commander's Gemini API key across encrypted IndexedDB (`SecureVaultService`),
 * `BYOKVault`, `LLMProviderService`, and Vite env variables.
 */
export async function resolveClientGeminiKeyAsync(): Promise<string> {
  try {
    const asyncVaultKey = await getProviderApiKeyAsync('gemini');
    if (isValidRealGeminiKey(asyncVaultKey)) {
      return asyncVaultKey.trim();
    }
  } catch {}

  try {
    const idbDirect =
      (await getSecureCredential('byok::gemini')) ||
      (await getSecureCredential('pixelops_gemini_api_key'));
    if (isValidRealGeminiKey(idbDirect)) {
      return idbDirect.trim();
    }
  } catch {}

  try {
    const snap = getBYOKVaultSnapshot();
    if (isValidRealGeminiKey(snap.gemini?.apiKey)) {
      return snap.gemini.apiKey.trim();
    }
  } catch {}

  try {
    const cfg = loadLLMProviderConfig();
    if (cfg.providerId === 'gemini' && isValidRealGeminiKey(cfg.apiKey)) {
      return cfg.apiKey.trim();
    }
  } catch {}

  try {
    const envKey =
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.GEMINI_API_KEY) ||
      '';
    if (isValidRealGeminiKey(envKey)) {
      return String(envKey).trim();
    }
  } catch {}

  return '';
}

/**
 * Computes RMS and applies clean adaptive microphone gain for quiet laptop/headset mics
 * so Push-To-Talk speech reaches Gemini Live at healthy amplitude without clipping.
 */
export function normalizeMicChunkForSpeech(inputSamples: Float32Array): {
  samples: Float32Array;
  rms: number;
} {
  if (inputSamples.length === 0) {
    return { samples: inputSamples, rms: 0 };
  }

  let sumSq = 0;
  for (let i = 0; i < inputSamples.length; i++) {
    const s = inputSamples[i];
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / inputSamples.length);

  if (rms > 0.0025 && rms < 0.14) {
    const gain = Math.min(4.0, Math.max(1.0, 0.16 / rms));
    const boosted = new Float32Array(inputSamples.length);
    for (let i = 0; i < inputSamples.length; i++) {
      const scaled = inputSamples[i] * gain;
      boosted[i] = scaled < -1 ? -1 : scaled > 1 ? 1 : scaled;
    }
    return { samples: boosted, rms };
  }

  return { samples: inputSamples, rms };
}

/**
 * Converts Float32 Web Audio samples [-1, 1] downsampled to 16kHz (box-filtered to prevent
 * speech aliasing) into base64 16-bit little-endian PCM.
 */
export function encodeFloat32ToBase64Pcm16(
  inputSamples: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000
): string {
  let samples = inputSamples;
  if (inputSampleRate !== targetSampleRate && inputSampleRate > 0) {
    const ratio = inputSampleRate / targetSampleRate;
    const outLength = Math.max(1, Math.round(inputSamples.length / ratio));
    const downsampled = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const startIdx = Math.min(inputSamples.length - 1, Math.floor(i * ratio));
      const endIdx = Math.min(
        inputSamples.length,
        Math.max(startIdx + 1, Math.floor((i + 1) * ratio))
      );
      let acc = 0;
      for (let j = startIdx; j < endIdx; j++) {
        acc += inputSamples[j];
      }
      downsampled[i] = acc / (endIdx - startIdx);
    }
    samples = downsampled;
  }

  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
}

/**
 * Decodes base64 16-bit little-endian mono PCM (24kHz Gemini Live output) into Float32 samples [-1, 1].
 */
export function decodeBase64Pcm16ToFloat32(base64Pcm: string): Float32Array {
  const binary =
    typeof atob === 'function'
      ? atob(base64Pcm)
      : Buffer.from(base64Pcm, 'base64').toString('binary');

  const byteLen = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768;
  }
  return float32;
}

export function buildTacticalRadioTools(options?: { omitNonBlockingBehavior?: boolean }) {
  const includeBehavior = !options?.omitNonBlockingBehavior;
  return [
    {
      functionDeclarations: [
        {
          name: 'dispatch_safehouse_directive',
          description:
            'Dispatches an actionable intelligence, OSINT, or workspace mission directive into the PixelOps Command Center terminal for full autonomous execution.',
          ...(includeBehavior ? { behavior: Behavior.NON_BLOCKING } : {}),
          parameters: {
            type: Type.OBJECT,
            properties: {
              directive: {
                type: Type.STRING,
                description: 'Exact tactical directive or investigation prompt to execute.',
              },
              targetOperative: {
                type: Type.STRING,
                description: 'Optional operative name (Vance, Nyx, or Cipher).',
              },
            },
            required: ['directive'],
          },
        },
        {
          name: 'query_evidence_graph',
          description:
            'Searches the local IndexedDB Evidence Graph for cross-investigation entity overlaps (domains, IPs, ASNs, CVEs, threat actors) across VFS dossiers.',
          ...(includeBehavior ? { behavior: Behavior.NON_BLOCKING } : {}),
          parameters: {
            type: Type.OBJECT,
            properties: {
              entityQuery: {
                type: Type.STRING,
                description:
                  'Domain, IPv4, ASN (e.g. AS13335), CVE, or threat actor name. Leave empty for top cross-dossier bridges.',
              },
            },
          },
        },
        {
          name: 'check_tripwire_alerts',
          description:
            'Checks stateful SHA-256 deterministic tripwire watchlists and any pending zero-noise delta alerts.',
          ...(includeBehavior ? { behavior: Behavior.NON_BLOCKING } : {}),
          parameters: {
            type: Type.OBJECT,
            properties: {
              onlyPending: {
                type: Type.BOOLEAN,
                description: 'When true, returns only unacknowledged pending_approval delta alerts.',
              },
            },
          },
        },
      ],
    },
  ];
}

export function buildLiveSessionConfig(
  operativeId: RadioOperativeId,
  modelId: RadioLiveModelId
): { model: RadioLiveModelId; config: Record<string, any> } {
  const persona = OPERATIVE_RADIO_CHANNELS[operativeId] || OPERATIVE_RADIO_CHANNELS.vance;

  const config: Record<string, any> = {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: persona.voiceName,
        },
      },
    },
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: true,
      },
      activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: persona.systemPersona,
    tools: buildTacticalRadioTools(),
  };

  // CRITICAL: Do NOT pass thinkingConfig on `gemini-3.8-live` (not supported).
  // Only attach thinkingConfig when `gemini-3.8-live-extended-thinking` is selected.
  if (modelId === 'gemini-3.8-live-extended-thinking') {
    config.thinkingConfig = {
      thinkingLevel: 'low',
    };
  }

  return { model: modelId, config };
}

function buildCompatibilityLiveConfig(
  operativeId: RadioOperativeId,
  options?: { disableAutoVad?: boolean }
): Record<string, any> {
  const persona = OPERATIVE_RADIO_CHANNELS[operativeId] || OPERATIVE_RADIO_CHANNELS.vance;
  const cfg: Record<string, any> = {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: persona.voiceName,
        },
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: persona.systemPersona,
    tools: buildTacticalRadioTools({ omitNonBlockingBehavior: true }),
  };

  if (options?.disableAutoVad !== false) {
    cfg.realtimeInputConfig = {
      automaticActivityDetection: {
        disabled: true,
      },
      activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
    };
  }

  return cfg;
}

export async function probeGeminiLiveProxy(): Promise<{
  proxyReachable: boolean;
  hasServerKey: boolean;
  hasClientByokKey: boolean;
  clientByokKey: string;
}> {
  const clientByokKey = await resolveClientGeminiKeyAsync();
  const hasClientByokKey = Boolean(clientByokKey);

  try {
    if (typeof fetch === 'function') {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;
      try {
        const res = await fetch('/api/gemini-live', {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (res.ok) {
          const contentType = (res.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('application/json')) {
            const json = await res.json();
            const isAuthenticProxy = Boolean(
              json?.proxyReady === true &&
                (json?.service === 'pixelops-gemini-live-proxy' || json?.runtime)
            );
            if (isAuthenticProxy) {
              return {
                proxyReachable: true,
                hasServerKey: Boolean(json?.hasServerKey),
                hasClientByokKey,
                clientByokKey,
              };
            }
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } catch {}

  return {
    proxyReachable: false,
    hasServerKey: false,
    hasClientByokKey,
    clientByokKey,
  };
}

export interface TacticalRadioCallbacks {
  onStatusChange?: (status: RadioConnectionStatus, detail?: string) => void;
  onTranscriptUpdate?: (entries: RadioTranscriptEntry[]) => void;
  onAudioLevel?: (rmsLevel: number) => void;
  onTransportRoute?: (route: RadioTransportRoute) => void;
  onDirectiveDispatched?: (directive: string, operativeId: RadioOperativeId) => void;
}

interface HandshakeAttemptError extends Error {
  socketOpened?: boolean;
  closeCode?: number;
}

export class TacticalRadioTransceiver {
  private session: Session | null = null;
  private relayActive = false;
  private transportRoute: RadioTransportRoute | null = null;
  private operativeId: RadioOperativeId = 'vance';
  private modelId: RadioLiveModelId = 'gemini-3.8-live';
  private status: RadioConnectionStatus = 'disconnected';
  private callbacks: TacticalRadioCallbacks;
  private transcripts: RadioTranscriptEntry[] = [];

  // Web Audio playback (24kHz output)
  private playbackCtx: AudioContext | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;

  // Web Speech Synthesis fallback (Tactical Voice Relay mode)
  private speechMeterTimer: ReturnType<typeof setInterval> | null = null;
  private speechRecognition: any = null;
  private relaySpokenFinal = '';
  private relaySpokenInterim = '';

  // Web Audio microphone capture (resampled to 16kHz PCM16 for Gemini Live)
  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private micWorkletNode: AudioWorkletNode | null = null;
  private micSilentGain: GainNode | null = null;
  private isTransmittingPtt = false;
  private manualActivitySignaling = true;
  private pttOpening = false;
  private pttAbortRequested = false;
  private pttActivityStartedOnServer = false;
  private pttChunksSent = 0;
  private pttPeakRms = 0;
  private preferredAudioDeviceId = '';
  private replyWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: TacticalRadioCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public getStatus(): RadioConnectionStatus {
    return this.status;
  }

  public getTransportRoute(): RadioTransportRoute | null {
    return this.transportRoute;
  }

  public setPreferredMicrophone(deviceId: string): void {
    this.preferredAudioDeviceId = deviceId.trim();
  }

  public isPttActiveOrOpening(): boolean {
    return this.isTransmittingPtt || this.pttOpening;
  }

  private clearReplyWatchdog(): void {
    if (this.replyWatchdogTimer) {
      clearTimeout(this.replyWatchdogTimer);
      this.replyWatchdogTimer = null;
    }
  }

  private startReplyWatchdog(chunksSent: number): void {
    this.clearReplyWatchdog();
    this.replyWatchdogTimer = setTimeout(() => {
      this.replyWatchdogTimer = null;
      if (this.status === 'standby' && this.session) {
        this.setStatus(
          'standby',
          `No reply received after ${chunksSent} pkts — speak louder or check selected mic`
        );
      }
    }, 9000);
  }

  private isCarrierActive(): boolean {
    return Boolean(this.session || this.relayActive);
  }

  private setStatus(next: RadioConnectionStatus, detail?: string) {
    this.status = next;
    this.callbacks.onStatusChange?.(next, detail);
  }

  private appendOrMergeTranscript(
    speaker: 'COMMANDER' | 'OPERATIVE' | 'SYS_TOOL',
    text: string,
    isPartial: boolean,
    replacePartial = false
  ) {
    const clean = text;
    if (!clean) return;

    const last = this.transcripts[this.transcripts.length - 1];
    if (last && last.speaker === speaker && last.isPartial && speaker !== 'SYS_TOOL') {
      last.text = replacePartial ? clean : last.text + clean;
      last.isPartial = isPartial;
    } else {
      this.transcripts.push({
        id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        speaker,
        operativeId: this.operativeId,
        text: clean,
        timestamp: new Date().toISOString(),
        isPartial,
      });
      if (this.transcripts.length > 60) {
        this.transcripts = this.transcripts.slice(-60);
      }
    }
    this.callbacks.onTranscriptUpdate?.([...this.transcripts]);
  }

  private finalizePartialTranscripts() {
    let changed = false;
    for (const item of this.transcripts) {
      if (item.isPartial) {
        item.isPartial = false;
        changed = true;
      }
    }
    if (changed) {
      this.callbacks.onTranscriptUpdate?.([...this.transcripts]);
    }
  }

  private ensurePlaybackContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
      try {
        this.playbackCtx = new AudioCtx({ sampleRate: 24000 });
        this.nextPlayTime = 0;
      } catch {
        return null;
      }
    }
    if (this.playbackCtx.state === 'suspended') {
      this.playbackCtx.resume().catch(() => {});
    }
    return this.playbackCtx;
  }

  private clearSpeechMeter() {
    if (this.speechMeterTimer) {
      clearInterval(this.speechMeterTimer);
      this.speechMeterTimer = null;
    }
  }

  /**
   * Immediately halts queued operative voice playback (used on server `interrupted` OR user PTT barge-in).
   */
  public bargeInInterrupt(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    }
    this.activeSources.clear();
    if (this.playbackCtx) {
      this.nextPlayTime = this.playbackCtx.currentTime;
    }

    this.clearSpeechMeter();
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {}

    this.callbacks.onAudioLevel?.(0);
    this.finalizePartialTranscripts();
    if (this.status === 'receiving_voice') {
      this.setStatus(this.isTransmittingPtt ? 'transmitting_ptt' : 'standby');
    }
  }

  private enqueuePcm24kAudio(base64Pcm: string) {
    const ctx = this.ensurePlaybackContext();
    if (!ctx) return;

    const samples = decodeBase64Pcm16ToFloat32(base64Pcm);
    if (samples.length === 0) return;

    // Compute simple RMS for the VU visualizer while operative speaks
    let sumSq = 0;
    const stride = Math.max(1, Math.floor(samples.length / 64));
    let count = 0;
    for (let i = 0; i < samples.length; i += stride) {
      sumSq += samples[i] * samples[i];
      count++;
    }
    const rms = count > 0 ? Math.min(1, Math.sqrt(sumSq / count) * 3.2) : 0;
    this.callbacks.onAudioLevel?.(rms);

    const audioBuffer = ctx.createBuffer(1, samples.length, 24000);
    audioBuffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.015, this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + audioBuffer.duration;
    this.activeSources.add(source);

    if (!this.isTransmittingPtt) {
      this.setStatus('receiving_voice');
    }

    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0 && !this.isTransmittingPtt && this.isCarrierActive()) {
        this.callbacks.onAudioLevel?.(0);
        this.setStatus('standby');
      }
    };
  }

  private speakViaBrowserSynthesis(rawText: string) {
    const cleanSpeech = rawText
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*#_`~>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      !cleanSpeech ||
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      if (this.isCarrierActive() && !this.isTransmittingPtt) {
        this.setStatus('standby', 'Reply logged on tactical transcript');
      }
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(cleanSpeech);
      if (this.operativeId === 'vance') {
        utter.pitch = 0.86;
        utter.rate = 1.02;
      } else if (this.operativeId === 'nyx') {
        utter.pitch = 1.08;
        utter.rate = 1.05;
      } else {
        utter.pitch = 0.94;
        utter.rate = 1.04;
      }

      const voices = window.speechSynthesis.getVoices?.() || [];
      const englishVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
      if (englishVoices.length > 0) {
        if (this.operativeId === 'nyx') {
          utter.voice =
            englishVoices.find((v) => /female|zira|samantha|victoria|google uk english female/i.test(v.name)) ||
            englishVoices[0];
        } else {
          utter.voice =
            englishVoices.find((v) => /male|david|mark|daniel|google us english/i.test(v.name)) ||
            englishVoices[0];
        }
      }

      utter.onstart = () => {
        if (!this.isCarrierActive() || this.isTransmittingPtt) return;
        this.setStatus('receiving_voice', `${OPERATIVE_RADIO_CHANNELS[this.operativeId].displayName} transmitting...`);
        this.clearSpeechMeter();
        let tick = 0;
        this.speechMeterTimer = setInterval(() => {
          tick++;
          const wave = 0.3 + Math.abs(Math.sin(tick * 0.65)) * 0.48;
          this.callbacks.onAudioLevel?.(wave);
        }, 90);
      };

      const finishSpeech = () => {
        this.clearSpeechMeter();
        this.callbacks.onAudioLevel?.(0);
        if (this.isCarrierActive() && !this.isTransmittingPtt) {
          this.setStatus('standby', 'Tactical Voice Relay standby');
        }
      };

      utter.onend = finishSpeech;
      utter.onerror = finishSpeech;

      window.speechSynthesis.speak(utter);
    } catch {
      if (this.isCarrierActive() && !this.isTransmittingPtt) {
        this.setStatus('standby');
      }
    }
  }

  private async executeRelayTurn(userCommand: string): Promise<void> {
    const trimmed = userCommand.trim();
    if (!trimmed || !this.relayActive) return;

    const persona = OPERATIVE_RADIO_CHANNELS[this.operativeId] || OPERATIVE_RADIO_CHANNELS.vance;
    this.setStatus('extended_thinking', `${persona.displayName} analyzing transmission...`);

    const lower = trimmed.toLowerCase();
    const contextSnippets: string[] = [];

    // 1. Check if Commander explicitly asked to dispatch a full terminal directive
    if (/\b(dispatch|launch mission|execute directive|run scan on|investigate)\b/i.test(trimmed) && trimmed.length > 14) {
      this.appendOrMergeTranscript(
        'SYS_TOOL',
        `[RADIO DISPATCH → TERMINAL] "${trimmed}"`,
        false
      );
      this.callbacks.onDirectiveDispatched?.(trimmed, this.operativeId);
      contextSnippets.push(`Action taken: Dispatched "${trimmed}" to the Safehouse Command Terminal.`);
    }

    // 2. Gather local Safehouse Evidence Graph & Tripwire telemetry when relevant
    try {
      if (/\b(graph|link board|bridge|overlap|dossier|asn|cve|domain|ip)\b/i.test(lower)) {
        const snap = await getEvidenceGraphSnapshot();
        const topBridges = snap.crossInvestigationBridges
          .slice(0, 4)
          .map((b) => `${b.node.label} (${b.overlapCount} dossiers)`)
          .join(', ');
        contextSnippets.push(
          `Evidence Graph Telemetry: ${snap.stats.totalEntities} entities across ${snap.stats.totalDossiers} dossiers, ${snap.stats.bridgeCount} cross-investigation bridges${
            topBridges ? ` [${topBridges}]` : ''
          }.`
        );
        this.appendOrMergeTranscript(
          'SYS_TOOL',
          `[LINK BOARD SUMMARY] ${snap.stats.bridgeCount} cross-dossier bridge(s)`,
          false
        );
      }
    } catch {}

    try {
      if (/\b(tripwire|alert|delta|watch|hash|sha)\b/i.test(lower)) {
        const alerts = await listTripwireAlerts();
        const watches = await listTripwireWatches();
        const pending = alerts.filter((a) => a.status === 'pending_approval');
        contextSnippets.push(
          `Tripwire Telemetry: ${watches.filter((w) => w.enabled).length} active watches, ${pending.length} pending SHA-256 delta alerts.`
        );
        this.appendOrMergeTranscript(
          'SYS_TOOL',
          `[TRIPWIRE CHECK] ${pending.length} pending SHA-256 delta alert(s)`,
          false
        );
      }
    } catch {}

    const radioPrompt = `[TACTICAL VOICE RADIO TRANSMISSION FROM COMMANDER]
Commander said: "${trimmed}"
${contextSnippets.length > 0 ? `\nLive Safehouse Telemetry:\n${contextSnippets.join('\n')}\n` : ''}
Respond in character as ${persona.displayName} (${persona.role}) over tactical voice radio in 1 to 3 crisp, natural spoken sentences (plain text suitable for voice synthesis, no markdown tables or code blocks).`;

    let spokenReply = '';
    try {
      const card = await executeAgentDirective({
        prompt: radioPrompt,
        themeId: 'green',
        activeAgentName: persona.displayName,
        activeAgentRole: persona.role,
        agentSystemPrompt: persona.systemPersona,
        enabledPlugins: [],
        temperature: 0.5,
      });
      spokenReply = String(card?.dialogue || '').trim();
    } catch {}

    if (!spokenReply) {
      const fallbackSummary =
        contextSnippets.length > 0
          ? contextSnippets.join(' ')
          : 'Safehouse channels are green and standing by for your target coordinates.';
      spokenReply = `Copy that, Commander. ${persona.displayName} on ${persona.frequencyMhz}—${fallbackSummary}`;
    }

    // Keep voice transcript concise & clean
    const cleaned = spokenReply
      .replace(/^---[\s\S]*?---\s*/m, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 520);

    if (!this.relayActive) return;
    this.appendOrMergeTranscript('OPERATIVE', cleaned, false);
    this.speakViaBrowserSynthesis(cleaned);
  }

  private async handleIncomingMessage(message: LiveServerMessage) {
    const anyMsg = message as any;

    // Track extended thinking background reasoning status on gemini-3.8-live-extended-thinking
    if (anyMsg.interactionStatus === 'IN_PROGRESS') {
      if (!this.isTransmittingPtt && this.activeSources.size === 0) {
        this.setStatus('extended_thinking', 'Operative reasoning...');
      }
    } else if (anyMsg.interactionStatus === 'IDLE') {
      if (this.status === 'extended_thinking') {
        this.setStatus('standby');
      }
    }

    const sc = message.serverContent;
    if (sc) {
      this.clearReplyWatchdog();

      // Handle real-time barge-in interruption acknowledged by Gemini Live server
      if (sc.interrupted) {
        this.bargeInInterrupt();
      }

      if (sc.inputTranscription?.text) {
        this.appendOrMergeTranscript('COMMANDER', sc.inputTranscription.text, true);
        if (this.status === 'standby') {
          this.setStatus('standby', 'Voice copied — operative responding...');
        }
      }

      if (sc.outputTranscription?.text) {
        this.appendOrMergeTranscript('OPERATIVE', sc.outputTranscription.text, true);
      }

      // CRITICAL: Iterate ALL parts in modelTurn.parts — never assume parts[0] is audio!
      const parts = sc.modelTurn?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.inlineData?.data && (part.inlineData.mimeType || '').startsWith('audio/')) {
            this.enqueuePcm24kAudio(part.inlineData.data);
          }
        }
      }

      if (sc.turnComplete) {
        this.finalizePartialTranscripts();
      }
    }

    // Handle asynchronous non-blocking tool calls
    if (message.toolCall?.functionCalls?.length) {
      this.clearReplyWatchdog();
      for (const fc of message.toolCall.functionCalls) {
        const fnName = fc.name || '';
        const args = (fc.args || {}) as Record<string, any>;
        let resultPayload: Record<string, any> = { ok: true };

        try {
          if (fnName === 'dispatch_safehouse_directive') {
            const directive = String(args.directive || '').trim();
            if (directive) {
              this.appendOrMergeTranscript(
                'SYS_TOOL',
                `[RADIO DISPATCH → TERMINAL] "${directive}"`,
                false
              );
              this.callbacks.onDirectiveDispatched?.(directive, this.operativeId);
              resultPayload = {
                dispatched: true,
                directive,
                operative: OPERATIVE_RADIO_CHANNELS[this.operativeId].displayName,
              };
            }
          } else if (fnName === 'query_evidence_graph') {
            const q = String(args.entityQuery || '').trim();
            if (q) {
              const hood = await queryEntityNeighborhood(q);
              resultPayload = {
                found: Boolean(hood.centerNode),
                entity: hood.centerNode?.label || q,
                type: hood.centerNode?.type || 'unknown',
                dossierCount: hood.connectedDossiers.length,
                dossiers: hood.connectedDossiers.slice(0, 5).map((d) => d.value),
                coOccurringEntities: hood.coOccurringEntities
                  .slice(0, 6)
                  .map((c) => `${c.node.type.toUpperCase()}: ${c.node.label}`),
              };
              this.appendOrMergeTranscript(
                'SYS_TOOL',
                `[LINK BOARD LOOKUP] "${q}" → ${hood.connectedDossiers.length} dossier(s)`,
                false
              );
            } else {
              const snap = await getEvidenceGraphSnapshot();
              resultPayload = {
                stats: snap.stats,
                topBridges: snap.crossInvestigationBridges.slice(0, 5).map((b) => ({
                  entity: b.node.label,
                  type: b.node.type,
                  overlapDossiers: b.overlapCount,
                  paths: b.dossierPaths,
                })),
              };
              this.appendOrMergeTranscript(
                'SYS_TOOL',
                `[LINK BOARD SUMMARY] ${snap.stats.bridgeCount} cross-dossier bridge(s)`,
                false
              );
            }
          } else if (fnName === 'check_tripwire_alerts') {
            const alerts = await listTripwireAlerts();
            const watches = await listTripwireWatches();
            const filtered = args.onlyPending
              ? alerts.filter((a) => a.status === 'pending_approval')
              : alerts.slice(0, 6);
            resultPayload = {
              activeWatchCount: watches.filter((w) => w.enabled).length,
              pendingAlertCount: alerts.filter((a) => a.status === 'pending_approval').length,
              alerts: filtered.map((a) => ({
                watchLabel: a.watchLabel,
                target: a.target,
                summary: a.diffSummary,
                status: a.status,
                detectedAt: a.detectedAt,
              })),
            };
            this.appendOrMergeTranscript(
              'SYS_TOOL',
              `[TRIPWIRE CHECK] ${resultPayload.pendingAlertCount} pending SHA-256 delta alert(s)`,
              false
            );
          }
        } catch (err: any) {
          resultPayload = { ok: false, error: err?.message || 'Tool execution error' };
        }

        try {
          this.session?.sendToolResponse({
            functionResponses: [
              {
                id: fc.id,
                name: fnName,
                response: resultPayload,
              },
            ],
          });
        } catch {}
      }
    }
  }

  /**
   * Non-hanging wrapper around `ai.live.connect(...)`.
   * `@google/genai`'s internal `onopenPromise` and `setupCompletePromise` do not reject on
   * WebSocket `onerror` / `onclose`, which previously hung fallback routes and trapped status in `'error'`.
   */
  private connectLiveSessionOnce(
    ai: GoogleGenAI,
    targetModel: string,
    sessionConfig: Record<string, any>,
    timeoutMs = 7500
  ): Promise<Session> {
    return new Promise<Session>((resolve, reject) => {
      let settled = false;
      let socketOpened = false;
      let activeSession: Session | null = null;

      const failHandshake = (reason: string, closeCode?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err: HandshakeAttemptError = new Error(reason);
        err.socketOpened = socketOpened;
        err.closeCode = closeCode;
        reject(err);
      };

      const timer = setTimeout(() => {
        failHandshake(`Live WebSocket handshake timed out (${targetModel})`);
      }, timeoutMs);

      ai.live
        .connect({
          model: targetModel,
          config: sessionConfig,
          callbacks: {
            onopen: () => {
              socketOpened = true;
            },
            onmessage: (msg: LiveServerMessage) => {
              void this.handleIncomingMessage(msg);
            },
            onerror: (err: any) => {
              const errMsg =
                (typeof err?.message === 'string' && err.message.trim()) ||
                (typeof err?.error?.message === 'string' && err.error.message.trim()) ||
                'WebSocket carrier fault';
              if (!settled) {
                failHandshake(errMsg);
                return;
              }
              if (activeSession && this.session === activeSession) {
                this.setStatus('error', errMsg);
              }
            },
            onclose: (ev: any) => {
              const code = typeof ev?.code === 'number' ? ev.code : undefined;
              const reason = typeof ev?.reason === 'string' ? ev.reason.trim() : '';
              if (!settled) {
                const msg = reason
                  ? `Handshake closed (${code || 'ws'}): ${reason}`
                  : `Handshake closed (${code || 'ws'})`;
                failHandshake(msg, code);
                return;
              }
              if (activeSession && this.session === activeSession) {
                this.stopPushToTalk();
                this.session = null;
                if (this.status !== 'error') {
                  this.setStatus('disconnected', reason || 'Carrier closed');
                }
              }
            },
          },
        })
        .then((session) => {
          if (settled) {
            try {
              session.close();
            } catch {}
            return;
          }
          settled = true;
          activeSession = session;
          clearTimeout(timer);
          resolve(session);
        })
        .catch((err: any) => {
          failHandshake(err?.message || 'Live connect failed');
        });
    });
  }

  /**
   * Attempts primary Gemini 3.8 Live model first, and if the socket opened (`101`)
   * but `setup` rejected the model identifier (`1008` / not found), automatically negotiates
   * compatible native-audio Live models on the same client.
   */
  private async negotiateLiveSessionOnClient(
    ai: GoogleGenAI,
    operativeId: RadioOperativeId,
    preferredModel: RadioLiveModelId
  ): Promise<{ session: Session; negotiatedModel: string; manualActivitySignaling: boolean }> {
    const primary = buildLiveSessionConfig(operativeId, preferredModel);
    try {
      const session = await this.connectLiveSessionOnce(ai, primary.model, primary.config);
      return { session, negotiatedModel: primary.model, manualActivitySignaling: true };
    } catch (err: any) {
      const attemptErr = err as HandshakeAttemptError;
      const errText = String(attemptErr?.message || '').toLowerCase();
      const isAuthFailure =
        errText.includes('api key not valid') ||
        errText.includes('api_key_invalid') ||
        errText.includes('permission_denied') ||
        errText.includes('unauthenticated') ||
        errText.includes('quota');

      // If the WebSocket never even upgraded (`!socketOpened`) or key is invalid, skip model retries on this transport
      if (!attemptErr.socketOpened || isAuthFailure) {
        throw attemptErr;
      }

      // First try compatibility models with explicit manual PTT activity control (`automaticActivityDetection.disabled = true`)
      const manualCompatConfig = buildCompatibilityLiveConfig(operativeId, { disableAutoVad: true });
      for (const fallbackModel of COMPATIBILITY_LIVE_MODELS) {
        try {
          const session = await this.connectLiveSessionOnce(
            ai,
            fallbackModel,
            manualCompatConfig,
            6500
          );
          return { session, negotiatedModel: fallbackModel, manualActivitySignaling: true };
        } catch {}
      }

      // Secondary fallback with default server VAD if a legacy model rejects `realtimeInputConfig`
      const autoCompatConfig = buildCompatibilityLiveConfig(operativeId, { disableAutoVad: false });
      for (const fallbackModel of COMPATIBILITY_LIVE_MODELS) {
        try {
          const session = await this.connectLiveSessionOnce(
            ai,
            fallbackModel,
            autoCompatConfig,
            6500
          );
          return { session, negotiatedModel: fallbackModel, manualActivitySignaling: false };
        } catch {}
      }

      throw attemptErr;
    }
  }

  private activateTacticalRelayFallback(detailMessage: string) {
    this.session = null;
    this.relayActive = true;
    this.manualActivitySignaling = false;
    this.transportRoute = 'tactical-relay';
    this.callbacks.onTransportRoute?.('tactical-relay');
    this.setStatus('standby', detailMessage);
  }

  public async connect(
    operativeId: RadioOperativeId,
    modelId: RadioLiveModelId = 'gemini-3.8-live',
    options?: { disableRelayFallback?: boolean }
  ): Promise<void> {
    await this.disconnect();
    this.operativeId = operativeId;
    this.modelId = modelId;
    this.setStatus('connecting', 'Handshaking encrypted transceiver...');
    this.ensurePlaybackContext();

    const probe = await probeGeminiLiveProxy();

    // Build ordered WebSocket transport candidates:
    //  - When Worker proxy has a server-managed GEMINI_API_KEY, prefer `/api/gemini-live`.
    //  - When Commander has a decrypted BYOK Gemini key (and server key is absent), prefer Direct BYOK WS
    //    for single-hop low latency, with `/api/gemini-live` as backup if proxy is reachable.
    const candidates: Array<{
      route: 'cloudflare-proxy' | 'direct-byok';
      createClient: () => GoogleGenAI;
      label: string;
    }> = [];

    if (probe.proxyReachable && probe.hasServerKey && typeof window !== 'undefined' && window.location?.origin) {
      candidates.push({
        route: 'cloudflare-proxy',
        label: '/api/gemini-live proxy',
        createClient: () =>
          new GoogleGenAI({
            apiKey: probe.clientByokKey || 'PROXY_MANAGED',
            httpOptions: {
              baseUrl: `${window.location.origin}/api/gemini-live`,
            },
          }),
      });
    }

    if (probe.hasClientByokKey) {
      candidates.push({
        route: 'direct-byok',
        label: 'direct BYOK Gemini Live',
        createClient: () => new GoogleGenAI({ apiKey: probe.clientByokKey }),
      });
    }

    if (
      probe.proxyReachable &&
      !probe.hasServerKey &&
      probe.hasClientByokKey &&
      typeof window !== 'undefined' &&
      window.location?.origin
    ) {
      candidates.push({
        route: 'cloudflare-proxy',
        label: '/api/gemini-live BYOK relay',
        createClient: () =>
          new GoogleGenAI({
            apiKey: probe.clientByokKey,
            httpOptions: {
              baseUrl: `${window.location.origin}/api/gemini-live`,
            },
          }),
      });
    }

    let lastWsError: Error | null = null;
    for (const candidate of candidates) {
      try {
        const ai = candidate.createClient();
        const { session, manualActivitySignaling } = await this.negotiateLiveSessionOnClient(
          ai,
          operativeId,
          modelId
        );
        this.session = session;
        this.relayActive = false;
        this.manualActivitySignaling = manualActivitySignaling;
        this.transportRoute = candidate.route;
        this.callbacks.onTransportRoute?.(candidate.route);
        this.setStatus('standby', `Carrier locked · ${candidate.label}`);
        return;
      } catch (err: any) {
        lastWsError = err instanceof Error ? err : new Error(String(err?.message || err));
      }
    }

    // Seamless Tactical Voice Relay fallback when no Gemini Live WS key is configured or WS is blocked
    if (!options?.disableRelayFallback) {
      const relayNote =
        !probe.hasServerKey && !probe.hasClientByokKey
          ? 'Standby · Tactical Voice Relay (Add Gemini key in Settings for 24kHz Live WS)'
          : 'Standby · Tactical Voice Relay fallback active';
      this.activateTacticalRelayFallback(relayNote);
      return;
    }

    const errDetail =
      lastWsError?.message ||
      'No Gemini API key found on Worker proxy or BYOK Vault. Add a Gemini API key in Settings [⚙️] to open live radio.';
    this.setStatus('error', errDetail);
    throw lastWsError || new Error(errDetail);
  }

  private async requestMicrophoneStream(): Promise<MediaStream> {
    const baseConstraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (this.preferredAudioDeviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: {
            ...baseConstraints,
            deviceId: { exact: this.preferredAudioDeviceId },
          },
        });
      } catch {}
    }

    return await navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
  }

  private cleanupMicCaptureNodes(): void {
    try {
      this.micWorkletNode?.port.close();
      this.micWorkletNode?.disconnect();
    } catch {}
    this.micWorkletNode = null;

    try {
      this.micProcessor?.disconnect();
      this.micSource?.disconnect();
      this.micSilentGain?.disconnect();
    } catch {}
    this.micProcessor = null;
    this.micSource = null;
    this.micSilentGain = null;

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      this.micStream = null;
    }

    if (this.micCtx && this.micCtx.state !== 'closed') {
      this.micCtx.close().catch(() => {});
    }
    this.micCtx = null;
  }

  /**
   * Starts Push-To-Talk microphone transmission (immediately triggers barge-in cut of ongoing agent speech).
   */
  public async startPushToTalk(): Promise<void> {
    if (!this.isCarrierActive()) {
      throw new Error('Connect radio channel first before holding Push-To-Talk.');
    }
    if (this.isTransmittingPtt || this.pttOpening) return;

    // Barge-in immediately so Commander cuts off ongoing operative speech
    this.clearReplyWatchdog();
    this.bargeInInterrupt();
    this.ensurePlaybackContext();

    // Branch A: Tactical Voice Relay Mode (Web Speech STT; only open AudioContext meter if STT unavailable)
    if (this.relayActive && !this.session) {
      this.relaySpokenFinal = '';
      this.relaySpokenInterim = '';

      const SpeechRecCtor =
        typeof window !== 'undefined'
          ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
          : null;

      let startedSpeechRec = false;
      if (SpeechRecCtor) {
        try {
          const rec = new SpeechRecCtor();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.onresult = (event: any) => {
            let finalChunk = '';
            let interimChunk = '';
            for (let i = 0; i < event.results.length; i++) {
              const res = event.results[i];
              const transcript = String(res[0]?.transcript || '');
              if (res.isFinal) {
                finalChunk += transcript + ' ';
              } else {
                interimChunk += transcript;
              }
            }
            this.relaySpokenFinal = finalChunk.trim();
            this.relaySpokenInterim = interimChunk.trim();
            const combined = `${this.relaySpokenFinal} ${this.relaySpokenInterim}`.trim();
            if (combined) {
              this.appendOrMergeTranscript('COMMANDER', combined, true, true);
            }
          };
          rec.onerror = () => {};
          rec.start();
          this.speechRecognition = rec;
          startedSpeechRec = true;
        } catch {}
      }

      let startedMicMeter = false;
      if (
        !startedSpeechRec &&
        typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getUserMedia === 'function'
      ) {
        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const micCtx = AudioCtx ? new AudioCtx() : null;
          if (micCtx && micCtx.state === 'suspended') {
            void micCtx.resume().catch(() => {});
          }
          this.micCtx = micCtx;
          this.micStream = await this.requestMicrophoneStream();
          if (micCtx) {
            if (micCtx.state === 'suspended') {
              await micCtx.resume().catch(() => {});
            }
            this.micSource = micCtx.createMediaStreamSource(this.micStream);
            this.micSilentGain = micCtx.createGain();
            this.micSilentGain.gain.value = 0;
            this.micSilentGain.connect(micCtx.destination);
            this.micProcessor = micCtx.createScriptProcessor(4096, 1, 1);
            this.micProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
              if (!this.isTransmittingPtt) return;
              const { rms } = normalizeMicChunkForSpeech(event.inputBuffer.getChannelData(0));
              this.callbacks.onAudioLevel?.(Math.min(1, rms * 5.5));
            };
            this.micSource.connect(this.micProcessor);
            this.micProcessor.connect(this.micSilentGain);
            startedMicMeter = true;
          }
        } catch {
          this.cleanupMicCaptureNodes();
        }
      }

      if (!startedSpeechRec && !startedMicMeter) {
        this.setStatus('standby', 'Browser mic unavailable — transmit via TX bar below');
        return;
      }

      this.isTransmittingPtt = true;
      this.setStatus(
        'transmitting_ptt',
        startedSpeechRec ? '🎙️ VOICE CAPTURE — TAP OR RELEASE TO SEND' : 'PTT MIC LIVE (USE TX BAR IF NO STT)'
      );
      return;
    }

    // Branch B: Full-Duplex PCM Streaming over Gemini Multimodal Live WebSocket
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is unavailable in this browser context.');
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API is unavailable in this browser context.');
    }

    this.pttOpening = true;
    this.pttAbortRequested = false;
    this.pttChunksSent = 0;
    this.pttPeakRms = 0;
    this.pttActivityStartedOnServer = false;

    // Unlock native-rate AudioContext synchronously during user gesture BEFORE awaiting getUserMedia
    const micCtx = new AudioCtx();
    if (micCtx.state === 'suspended') {
      void micCtx.resume().catch(() => {});
    }
    this.micCtx = micCtx;
    this.setStatus('transmitting_ptt', 'Opening microphone...');

    try {
      this.micStream = await this.requestMicrophoneStream();
    } catch (err) {
      this.pttOpening = false;
      this.cleanupMicCaptureNodes();
      this.setStatus('standby', 'Microphone permission denied — use TX bar below');
      throw err;
    }

    // Abort cleanly if user released or disconnected while permission dialog / mic open was pending
    if (this.pttAbortRequested || !this.session) {
      this.pttOpening = false;
      this.cleanupMicCaptureNodes();
      if (this.session) {
        this.setStatus('standby', 'PTT cancelled before audio capture started');
      }
      return;
    }

    if (micCtx.state === 'suspended') {
      await micCtx.resume().catch(() => {});
    }

    if (this.manualActivitySignaling) {
      try {
        this.session.sendRealtimeInput({ activityStart: {} });
        this.pttActivityStartedOnServer = true;
      } catch {}
    }

    this.isTransmittingPtt = true;
    this.pttOpening = false;
    this.setStatus('transmitting_ptt', '🎙️ MIC LIVE — Speak now, then tap/release to send');

    const processChunk = (rawInput: Float32Array) => {
      if (!this.isTransmittingPtt || !this.session) return;

      const { samples, rms } = normalizeMicChunkForSpeech(rawInput);
      if (rms > this.pttPeakRms) {
        this.pttPeakRms = rms;
      }
      this.callbacks.onAudioLevel?.(Math.min(1, rms * 5.5));

      const base64Pcm = encodeFloat32ToBase64Pcm16(
        samples,
        micCtx.sampleRate || 48000,
        16000
      );

      try {
        this.session.sendRealtimeInput({
          audio: {
            data: base64Pcm,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
        this.pttChunksSent++;
        if (this.pttChunksSent === 1 || this.pttChunksSent % 6 === 0) {
          const pct = Math.min(100, Math.round(this.pttPeakRms * 550));
          if (this.pttPeakRms < 0.0012 && this.pttChunksSent >= 8) {
            this.setStatus(
              'transmitting_ptt',
              `⚠️ Mic signal 0% (check mute/input!) · ${this.pttChunksSent} pkts`
            );
          } else {
            this.setStatus(
              'transmitting_ptt',
              `🎙️ TX LIVE · ${this.pttChunksSent} pkts · Mic ${pct}%`
            );
          }
        }
      } catch {}
    };

    this.micSource = micCtx.createMediaStreamSource(this.micStream);
    this.micSilentGain = micCtx.createGain();
    this.micSilentGain.gain.value = 0;
    this.micSilentGain.connect(micCtx.destination);

    // Prefer glitch-free AudioWorklet off main thread; fall back cleanly to ScriptProcessorNode
    let connectedWorklet = false;
    if (
      typeof AudioWorkletNode !== 'undefined' &&
      micCtx.audioWorklet &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof Blob !== 'undefined'
    ) {
      const workletCode = `
        class PixelOpsPttProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this._buf = new Float32Array(2048);
            this._pos = 0;
          }
          process(inputs) {
            const ch = inputs[0] && inputs[0][0];
            if (!ch) return true;
            for (let i = 0; i < ch.length; i++) {
              this._buf[this._pos++] = ch[i];
              if (this._pos >= this._buf.length) {
                this.port.postMessage(this._buf.slice(0));
                this._pos = 0;
              }
            }
            return true;
          }
        }
        registerProcessor('pixelops-ptt-capture', PixelOpsPttProcessor);
      `;
      let blobUrl = '';
      try {
        blobUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
        await micCtx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);
        blobUrl = '';
        if (this.isTransmittingPtt && this.micCtx === micCtx && this.micSource && this.micSilentGain) {
          const workletNode = new AudioWorkletNode(micCtx, 'pixelops-ptt-capture');
          workletNode.port.onmessage = (ev: MessageEvent) => {
            if (ev.data instanceof Float32Array) {
              processChunk(ev.data);
            }
          };
          this.micSource.connect(workletNode);
          workletNode.connect(this.micSilentGain);
          this.micWorkletNode = workletNode;
          connectedWorklet = true;
        }
      } catch {
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {}
        }
      }
    }

    if (!connectedWorklet && this.isTransmittingPtt && this.micCtx === micCtx && this.micSource && this.micSilentGain) {
      this.micProcessor = micCtx.createScriptProcessor(4096, 1, 1);
      this.micProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
        processChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      this.micSource.connect(this.micProcessor);
      this.micProcessor.connect(this.micSilentGain);
    }
  }

  /**
   * Releases Push-To-Talk, sends a short trailing silence pad + explicit `activityEnd` (or `audioStreamEnd`),
   * or dispatches captured speech in Relay mode.
   */
  public stopPushToTalk(): void {
    if (this.pttOpening) {
      this.pttAbortRequested = true;
      this.isTransmittingPtt = false;
      return;
    }

    const wasTransmitting = this.isTransmittingPtt;
    const chunksSent = this.pttChunksSent;
    const peakRms = this.pttPeakRms;
    const hadServerActivityStart = this.pttActivityStartedOnServer;

    this.isTransmittingPtt = false;
    this.pttActivityStartedOnServer = false;
    this.callbacks.onAudioLevel?.(0);

    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {}
      this.speechRecognition = null;
    }

    this.cleanupMicCaptureNodes();

    if (!wasTransmitting) return;

    if (this.session) {
      if (chunksSent > 0) {
        try {
          // Trailing 16kHz silence frame prevents the final spoken word from clipping right on release
          const silenceFrames = this.manualActivitySignaling ? 1600 : 4800;
          const silenceB64 = encodeFloat32ToBase64Pcm16(
            new Float32Array(silenceFrames),
            16000,
            16000
          );
          this.session.sendRealtimeInput({
            audio: {
              data: silenceB64,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } catch {}
      }

      if (this.manualActivitySignaling) {
        if (hadServerActivityStart) {
          try {
            this.session.sendRealtimeInput({ activityEnd: {} });
          } catch {}
        }
      } else {
        try {
          this.session.sendRealtimeInput({ audioStreamEnd: true });
        } catch {}
      }

      if (this.status === 'transmitting_ptt') {
        if (chunksSent === 0) {
          this.setStatus(
            'standby',
            '0 audio frames captured — tap PTT once, speak, then tap to send'
          );
        } else if (peakRms < 0.0012) {
          this.setStatus(
            'standby',
            `⚠️ Sent ${chunksSent} silent pkts (0% mic) — check mic mute or input device`
          );
        } else {
          this.setStatus('standby', `Sent ${chunksSent} voice pkts — awaiting operative reply...`);
          this.startReplyWatchdog(chunksSent);
        }
      }
      return;
    }

    if (this.relayActive) {
      this.finalizePartialTranscripts();
      const captured = `${this.relaySpokenFinal} ${this.relaySpokenInterim}`.trim();
      this.relaySpokenFinal = '';
      this.relaySpokenInterim = '';
      if (captured) {
        void this.executeRelayTurn(captured);
      } else if (this.status === 'transmitting_ptt') {
        this.setStatus('standby', 'Tap or hold PTT & speak clearly, or type in TX bar');
      }
    }
  }

  /**
   * Sends an instant text transmission over the live voice radio session (operative replies in voice!).
   */
  public sendTextDispatchOverRadio(text: string): void {
    const clean = text.trim();
    if (!clean || !this.isCarrierActive()) return;
    this.clearReplyWatchdog();
    this.bargeInInterrupt();
    this.appendOrMergeTranscript('COMMANDER', clean, false);

    if (this.session) {
      if (this.manualActivitySignaling) {
        this.session.sendRealtimeInput({ activityStart: {} });
        this.session.sendRealtimeInput({ text: clean });
        this.session.sendRealtimeInput({ activityEnd: {} });
      } else {
        this.session.sendRealtimeInput({ text: clean });
      }
      return;
    }

    if (this.relayActive) {
      void this.executeRelayTurn(clean);
    }
  }

  public clearTranscripts(): void {
    this.transcripts = [];
    this.callbacks.onTranscriptUpdate?.([]);
  }

  public async disconnect(): Promise<void> {
    this.clearReplyWatchdog();
    this.pttAbortRequested = true;
    this.stopPushToTalk();
    this.pttOpening = false;
    this.cleanupMicCaptureNodes();
    this.bargeInInterrupt();
    this.relayActive = false;
    this.transportRoute = null;
    if (this.session) {
      const closing = this.session;
      this.session = null;
      try {
        closing.close();
      } catch {}
    }
    if (this.playbackCtx && this.playbackCtx.state !== 'closed') {
      try {
        await this.playbackCtx.close();
      } catch {}
    }
    this.playbackCtx = null;
    this.setStatus('disconnected', 'Transceiver idle');
  }
}
