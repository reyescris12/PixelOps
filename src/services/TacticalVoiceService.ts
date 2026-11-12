/**
 * Tactical Voice Comms Service — Live Radio Dispatch
 * (src/services/TacticalVoiceService.ts)
 *
 * Push-to-Talk (PTT) full-duplex transceiver wired to the Gemini Multimodal Live
 * WebSocket API (`gemini-3.8-live` and `gemini-3.8-live-extended-thinking`),
 * routed via the Cloudflare Worker / Express WebSocket proxy (`/api/gemini-live`)
 * with automatic BYOK fallback.
 *
 * Supports real-time voice command & barge-in replies with Operatives:
 *   - Vance  (Lead Strategist — Voice: Charon)
 *   - Nyx    (OSINT & Recon Specialist — Voice: Kore)
 *   - Cipher (Systems & Vault Cryptographer — Voice: Puck)
 */

import { GoogleGenAI, Modality, Behavior, Type, type Session, type LiveServerMessage } from '@google/genai';
import { getBYOKVaultSnapshot } from './BYOKVault';
import { queryEntityNeighborhood, getEvidenceGraphSnapshot } from './EvidenceGraphService';
import { listTripwireAlerts, listTripwireWatches } from './TripwireDiffService';

export type RadioOperativeId = 'vance' | 'nyx' | 'cipher';
export type RadioLiveModelId = 'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking';

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

export function buildTacticalRadioTools() {
  return [
    {
      functionDeclarations: [
        {
          name: 'dispatch_safehouse_directive',
          description:
            'Dispatches an actionable intelligence, OSINT, or workspace mission directive into the PixelOps Command Center terminal for full autonomous execution.',
          behavior: Behavior.NON_BLOCKING,
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
          behavior: Behavior.NON_BLOCKING,
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
          behavior: Behavior.NON_BLOCKING,
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

export async function probeGeminiLiveProxy(): Promise<{
  proxyReachable: boolean;
  hasServerKey: boolean;
  hasClientByokKey: boolean;
  clientByokKey: string;
}> {
  let hasClientByokKey = false;
  let clientByokKey = '';
  try {
    const snap = getBYOKVaultSnapshot();
    const k = (snap.gemini?.apiKey || '').trim();
    if (k && k !== 'MY_GEMINI_API_KEY' && !k.startsWith('••••')) {
      hasClientByokKey = true;
      clientByokKey = k;
    }
  } catch {}

  try {
    const res = await fetch('/api/gemini-live', { method: 'GET' });
    if (res.ok) {
      const json = await res.json();
      return {
        proxyReachable: Boolean(json?.proxyReady),
        hasServerKey: Boolean(json?.hasServerKey),
        hasClientByokKey,
        clientByokKey,
      };
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
  onTransportRoute?: (route: 'cloudflare-proxy' | 'direct-byok') => void;
  onDirectiveDispatched?: (directive: string, operativeId: RadioOperativeId) => void;
}

export class TacticalRadioTransceiver {
  private session: Session | null = null;
  private operativeId: RadioOperativeId = 'vance';
  private modelId: RadioLiveModelId = 'gemini-3.8-live';
  private status: RadioConnectionStatus = 'disconnected';
  private callbacks: TacticalRadioCallbacks;
  private transcripts: RadioTranscriptEntry[] = [];

  // Web Audio playback (24kHz output)
  private playbackCtx: AudioContext | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;

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

  private setStatus(next: RadioConnectionStatus, detail?: string) {
    this.status = next;
    this.callbacks.onStatusChange?.(next, detail);
  }

  private appendOrMergeTranscript(
    speaker: 'COMMANDER' | 'OPERATIVE' | 'SYS_TOOL',
    text: string,
    isPartial: boolean
  ) {
    const clean = text;
    if (!clean) return;

    const last = this.transcripts[this.transcripts.length - 1];
    if (last && last.speaker === speaker && last.isPartial && speaker !== 'SYS_TOOL') {
      last.text += clean;
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
      this.playbackCtx = new AudioCtx({ sampleRate: 24000 });
      this.nextPlayTime = 0;
    }
    if (this.playbackCtx.state === 'suspended') {
      this.playbackCtx.resume().catch(() => {});
    }
    return this.playbackCtx;
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
      if (this.activeSources.size === 0 && !this.isTransmittingPtt && this.session) {
        this.callbacks.onAudioLevel?.(0);
        this.setStatus('standby');
      }
    };
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

  public async connect(
    operativeId: RadioOperativeId,
    modelId: RadioLiveModelId = 'gemini-3.8-live'
  ): Promise<void> {
    await this.disconnect();
    this.operativeId = operativeId;
    this.modelId = modelId;
    this.setStatus('connecting', 'Handshaking encrypted transceiver...');
    this.ensurePlaybackContext();

    const probe = await probeGeminiLiveProxy();
    if (!probe.hasServerKey && !probe.hasClientByokKey) {
      this.setStatus(
        'error',
        'No Gemini API key found on Worker proxy or BYOK Vault. Add a Gemini API key in Settings [⚙️] to open live radio.'
      );
      throw new Error('Missing Gemini API key for Live Radio Dispatch.');
    }

    const { model, config } = buildLiveSessionConfig(operativeId, modelId);

    const openWithClient = async (ai: GoogleGenAI): Promise<Session> => {
      return await ai.live.connect({
        model,
        config,
        callbacks: {
          onopen: () => {
            this.setStatus('standby', 'Carrier locked');
          },
          onmessage: (msg: LiveServerMessage) => {
            void this.handleIncomingMessage(msg);
          },
          onerror: (err: any) => {
            const errText = err?.message || 'WebSocket carrier fault';
            this.setStatus('error', errText);
          },
          onclose: () => {
            this.stopPushToTalk();
            if (this.status !== 'error') {
              this.setStatus('disconnected');
            }
          },
        },
      });
    };

    // Route 1: Cloudflare Worker / Express `/api/gemini-live` WebSocket proxy
    if (probe.proxyReachable && typeof window !== 'undefined') {
      try {
        const proxyAi = new GoogleGenAI({
          apiKey: probe.clientByokKey || 'PROXY_MANAGED',
          httpOptions: {
            baseUrl: `${window.location.origin}/api/gemini-live`,
          },
        });
        this.session = await openWithClient(proxyAi);
        this.callbacks.onTransportRoute?.('cloudflare-proxy');
        this.setStatus('standby', 'Connected via /api/gemini-live proxy');
        return;
      } catch (proxyErr) {
        if (!probe.hasClientByokKey) {
          const msg = (proxyErr as any)?.message || 'Live proxy connection failed';
          this.setStatus('error', msg);
          throw proxyErr;
        }
      }
    }

    // Route 2: Direct BYOK WebSocket fallback when static edge has no Worker secret
    if (probe.hasClientByokKey) {
      const directAi = new GoogleGenAI({ apiKey: probe.clientByokKey });
      this.session = await openWithClient(directAi);
      this.callbacks.onTransportRoute?.('direct-byok');
      this.setStatus('standby', 'Connected via direct BYOK Gemini Live');
      return;
    }

    this.setStatus('error', 'Unable to establish Gemini Live WebSocket.');
  }

  /**
   * Starts Push-To-Talk microphone transmission (immediately triggers barge-in cut of ongoing agent speech).
   */
  public async startPushToTalk(): Promise<void> {
    if (!this.session) {
      throw new Error('Connect radio channel first before holding Push-To-Talk.');
    }
    if (this.isTransmittingPtt) return;

    // Barge-in immediately so Commander cuts off ongoing operative speech
    this.bargeInInterrupt();
    this.ensurePlaybackContext();

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
    this.setStatus('transmitting_ptt', 'PTT TX LIVE');

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
   * Releases Push-To-Talk and sends `{ audioStreamEnd: true }` to flush server VAD immediately.
   */
  public stopPushToTalk(): void {
    const wasTransmitting = this.isTransmittingPtt;
    this.isTransmittingPtt = false;
    this.callbacks.onAudioLevel?.(0);

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

    if (wasTransmitting && this.session) {
      try {
        this.session.sendRealtimeInput({ audioStreamEnd: true });
      } catch {}
      if (this.status === 'transmitting_ptt') {
        this.setStatus('standby', 'Awaiting operative reply...');
      }
    }
  }

  /**
   * Sends an instant text transmission over the live voice radio session (operative replies in voice!).
   */
  public sendTextDispatchOverRadio(text: string): void {
    const clean = text.trim();
    if (!clean || !this.session) return;
    this.bargeInInterrupt();
    this.appendOrMergeTranscript('COMMANDER', clean, false);
    this.session.sendRealtimeInput({ text: clean });
  }

  public clearTranscripts(): void {
    this.transcripts = [];
    this.callbacks.onTranscriptUpdate?.([]);
  }

  public async disconnect(): Promise<void> {
    this.stopPushToTalk();
    this.bargeInInterrupt();
    if (this.session) {
      try {
        this.session.close();
      } catch {}
      this.session = null;
    }
    if (this.playbackCtx && this.playbackCtx.state !== 'closed') {
      try {
        await this.playbackCtx.close();
      } catch {}
    }
    this.playbackCtx = null;
    this.setStatus('disconnected');
  }
}
