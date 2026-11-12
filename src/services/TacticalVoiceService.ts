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
 * Converts Float32 Web Audio samples [-1, 1] downsampled to 16kHz into base64 16-bit little-endian PCM.
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
      const srcIdx = Math.min(inputSamples.length - 1, Math.floor(i * ratio));
      downsampled[i] = inputSamples[srcIdx];
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

function buildCompatibilityLiveConfig(operativeId: RadioOperativeId): Record<string, any> {
  const persona = OPERATIVE_RADIO_CHANNELS[operativeId] || OPERATIVE_RADIO_CHANNELS.vance;
  return {
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

  // Web Audio microphone capture (16kHz input)
  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private isTransmittingPtt = false;

  constructor(callbacks: TacticalRadioCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public getStatus(): RadioConnectionStatus {
    return this.status;
  }

  public getTransportRoute(): RadioTransportRoute | null {
    return this.transportRoute;
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
      // Handle real-time barge-in interruption acknowledged by Gemini Live server
      if (sc.interrupted) {
        this.bargeInInterrupt();
      }

      if (sc.inputTranscription?.text) {
        this.appendOrMergeTranscript('COMMANDER', sc.inputTranscription.text, true);
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
  ): Promise<{ session: Session; negotiatedModel: string }> {
    const primary = buildLiveSessionConfig(operativeId, preferredModel);
    try {
      const session = await this.connectLiveSessionOnce(ai, primary.model, primary.config);
      return { session, negotiatedModel: primary.model };
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

      const compatConfig = buildCompatibilityLiveConfig(operativeId);
      for (const fallbackModel of COMPATIBILITY_LIVE_MODELS) {
        try {
          const session = await this.connectLiveSessionOnce(ai, fallbackModel, compatConfig, 6500);
          return { session, negotiatedModel: fallbackModel };
        } catch {}
      }

      throw attemptErr;
    }
  }

  private activateTacticalRelayFallback(detailMessage: string) {
    this.session = null;
    this.relayActive = true;
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
        const { session } = await this.negotiateLiveSessionOnClient(ai, operativeId, modelId);
        this.session = session;
        this.relayActive = false;
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

  /**
   * Starts Push-To-Talk microphone transmission (immediately triggers barge-in cut of ongoing agent speech).
   */
  public async startPushToTalk(): Promise<void> {
    if (!this.isCarrierActive()) {
      throw new Error('Connect radio channel first before holding Push-To-Talk.');
    }
    if (this.isTransmittingPtt) return;

    // Barge-in immediately so Commander cuts off ongoing operative speech
    this.bargeInInterrupt();
    this.ensurePlaybackContext();

    // Branch A: Tactical Voice Relay Mode (Web Speech STT + Mic VU meter)
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
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioCtx) {
            this.micCtx = new AudioCtx();
            this.micSource = this.micCtx.createMediaStreamSource(this.micStream);
            this.micProcessor = this.micCtx.createScriptProcessor(2048, 1, 1);
            this.micProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
              if (!this.isTransmittingPtt) return;
              const inputData = event.inputBuffer.getChannelData(0);
              let sumSq = 0;
              for (let i = 0; i < inputData.length; i += 8) {
                sumSq += inputData[i] * inputData[i];
              }
              const rms = Math.min(1, Math.sqrt(sumSq / Math.max(1, inputData.length / 8)) * 4.0);
              this.callbacks.onAudioLevel?.(rms);
            };
            this.micSource.connect(this.micProcessor);
            this.micProcessor.connect(this.micCtx.destination);
            startedMicMeter = true;
          }
        } catch {}
      }

      if (!startedSpeechRec && !startedMicMeter) {
        this.setStatus('standby', 'Browser mic unavailable — transmit via TX bar below');
        return;
      }

      this.isTransmittingPtt = true;
      this.setStatus(
        'transmitting_ptt',
        startedSpeechRec ? 'PTT VOICE CAPTURE — RELEASE TO DISPATCH' : 'PTT MIC LIVE (USE TX BAR IF NO STT)'
      );
      return;
    }

    // Branch B: Full-Duplex 16kHz PCM Streaming over Gemini Multimodal Live WebSocket
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is unavailable in this browser context.');
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.micCtx = new AudioCtx({ sampleRate: 16000 });
    this.micSource = this.micCtx.createMediaStreamSource(this.micStream);
    this.micProcessor = this.micCtx.createScriptProcessor(2048, 1, 1);

    this.isTransmittingPtt = true;
    this.setStatus('transmitting_ptt', 'PTT TX LIVE (16kHz PCM)');

    this.micProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.isTransmittingPtt || !this.session) return;
      const inputData = event.inputBuffer.getChannelData(0);

      let sumSq = 0;
      for (let i = 0; i < inputData.length; i += 8) {
        sumSq += inputData[i] * inputData[i];
      }
      const rms = Math.min(1, Math.sqrt(sumSq / Math.max(1, inputData.length / 8)) * 4.0);
      this.callbacks.onAudioLevel?.(rms);

      const base64Pcm = encodeFloat32ToBase64Pcm16(
        inputData,
        this.micCtx?.sampleRate || 16000,
        16000
      );

      try {
        this.session.sendRealtimeInput({
          audio: {
            data: base64Pcm,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } catch {}
    };

    this.micSource.connect(this.micProcessor);
    this.micProcessor.connect(this.micCtx.destination);
  }

  /**
   * Releases Push-To-Talk and sends `{ audioStreamEnd: true }` (or dispatches spoken STT in Relay mode).
   */
  public stopPushToTalk(): void {
    const wasTransmitting = this.isTransmittingPtt;
    this.isTransmittingPtt = false;
    this.callbacks.onAudioLevel?.(0);

    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {}
      this.speechRecognition = null;
    }

    try {
      this.micProcessor?.disconnect();
      this.micSource?.disconnect();
    } catch {}
    this.micProcessor = null;
    this.micSource = null;

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

    if (!wasTransmitting) return;

    if (this.session) {
      try {
        this.session.sendRealtimeInput({ audioStreamEnd: true });
      } catch {}
      if (this.status === 'transmitting_ptt') {
        this.setStatus('standby', 'Awaiting operative reply...');
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
        this.setStatus('standby', 'Hold PTT & speak clearly, or type in TX bar');
      }
    }
  }

  /**
   * Sends an instant text transmission over the live voice radio session (operative replies in voice!).
   */
  public sendTextDispatchOverRadio(text: string): void {
    const clean = text.trim();
    if (!clean || !this.isCarrierActive()) return;
    this.bargeInInterrupt();
    this.appendOrMergeTranscript('COMMANDER', clean, false);

    if (this.session) {
      this.session.sendRealtimeInput({ text: clean });
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
    this.stopPushToTalk();
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
