/**
 * Real-Time Dispatch Audio & Transcript Triage Service
 * (src/services/DispatchTriageService.ts)
 *
 * Bridges Broadcastify/OpenMHz scanner audio chunks and local CAD/RSS transcripts
 * into Gemini 2.5 Flash zero-shot triage, then routes verified threats through the
 * Nyx -> Cipher -> Vance CorroborationEngine and CommandLedgerDb.
 */

import { appendCommandLedgerEntry } from './CommandLedgerDb';
import { getLocalGeofenceConfig } from './OsintToolsService';
import { loadLLMProviderConfig, getGeminiAuthHeadersAndUrl } from './LLMProviderService';

export interface DispatchTriageInput {
  transcript?: string;
  audioBase64?: string;
  audioMimeType?: string;
  lat?: number;
  lon?: number;
  sourceLabel?: string;
  sourceUrl?: string;
  sectorKey?: string;
  ingestIntoSwarm?: boolean;
}

export interface DispatchTriageResult {
  threatDetected: boolean;
  type: string;
  severity: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
  summary: string;
  rawExcerpts: string[];
  modelUsed: string;
  analyzedAt: string;
  packetId?: string;
  clusterId?: string;
}

const TACTICAL_KEYWORD_PATTERNS: Array<{
  regex: RegExp;
  type: string;
  severity: 'MED' | 'HIGH' | 'CRITICAL';
}> = [
  { regex: /\b(active shooter|shots fired|mass casualty)\b/i, type: 'ACTIVE_VIOLENT_THREAT', severity: 'CRITICAL' },
  { regex: /\b(hazmat|chemical spill|toxic plume|radiation leak)\b/i, type: 'HAZMAT_INCIDENT', severity: 'CRITICAL' },
  { regex: /\b(evacuation|mandatory evacuate|shelter in place|lockdown|perimeter established)\b/i, type: 'PERIMETER_EVACUATION', severity: 'HIGH' },
  { regex: /\b(structure fire|working fire|3-alarm|multi-alarm|explosion)\b/i, type: 'STRUCTURE_FIRE_EXPLOSION', severity: 'HIGH' },
  { regex: /\b(tornado warning|flash flood emergency|civil emergency|amber alert)\b/i, type: 'CIVIL_EMERGENCY_ALERT', severity: 'HIGH' },
  { regex: /\b(barricaded|swat|police pursuit|medevac|road closure)\b/i, type: 'TACTICAL_POLICE_OPS', severity: 'MED' },
];

export function buildLocalDispatchTriagePrompt(
  lat: number,
  lon: number,
  transcript?: string
): string {
  const basePrompt =
    `Analyze this local emergency dispatch log. Are there active violent threats, perimeter lockdowns, evacuations, or major HAZMAT incidents within coordinates [${lat.toFixed(4)}, ${lon.toFixed(4)}]? ` +
    `Output JSON: { threatDetected: boolean, type: string, severity: 'LOW'|'MED'|'HIGH'|'CRITICAL', summary: string, rawExcerpts: [] }`;
  if (transcript && transcript.trim()) {
    return `${basePrompt}\n\nDISPATCH LOG:\n${transcript.trim().slice(0, 12000)}`;
  }
  return basePrompt;
}

export function deterministicDispatchKeywordTriage(transcript: string): DispatchTriageResult {
  const clean = (transcript || '').trim();
  const excerpts: string[] = [];
  let matchedType = 'ROUTINE_DISPATCH';
  let highestSeverity: DispatchTriageResult['severity'] = 'LOW';
  const severityRank: Record<DispatchTriageResult['severity'], number> = {
    LOW: 0,
    MED: 1,
    HIGH: 2,
    CRITICAL: 3,
  };

  const sentences = clean.split(/(?<=[.!?;\n])\s+/).filter(Boolean);
  for (const rule of TACTICAL_KEYWORD_PATTERNS) {
    if (rule.regex.test(clean)) {
      if (severityRank[rule.severity] > severityRank[highestSeverity]) {
        highestSeverity = rule.severity;
        matchedType = rule.type;
      }
      for (const s of sentences) {
        if (rule.regex.test(s) && excerpts.length < 4 && !excerpts.includes(s.trim())) {
          excerpts.push(s.trim().slice(0, 220));
        }
      }
    }
  }

  const threatDetected = highestSeverity === 'HIGH' || highestSeverity === 'CRITICAL' || highestSeverity === 'MED';
  return {
    threatDetected,
    type: matchedType,
    severity: highestSeverity,
    summary: threatDetected
      ? `Tactical dispatch keyword match (${matchedType} / ${highestSeverity}): ${excerpts[0] || clean.slice(0, 160)}`
      : 'Routine municipal dispatch traffic; no priority tactical threat detected.',
    rawExcerpts: excerpts,
    modelUsed: 'deterministic-keyword-triage',
    analyzedAt: new Date().toISOString(),
  };
}

export function triggerVanceDesktopNotification(title: string, body: string): boolean {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body.slice(0, 220),
        icon: '/pwa-192x192.png',
        tag: 'pixelops-vance-alert',
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function analyzeDispatchSignal(
  input: DispatchTriageInput
): Promise<DispatchTriageResult> {
  const geofence = getLocalGeofenceConfig();
  const lat = input.lat ?? geofence.lat;
  const lon = input.lon ?? geofence.lon;
  const transcript = (input.transcript || '').trim();
  const audioBase64 = (input.audioBase64 || '').trim();

  if (!transcript && !audioBase64) {
    throw new Error('Dispatch triage requires either transcript text or base64 audio.');
  }

  let triage: DispatchTriageResult | null = null;
  const cfg = loadLLMProviderConfig();
  const hasGeminiKey = Boolean(cfg.providerId === 'gemini' && cfg.apiKey && !cfg.apiKey.startsWith('••••'));

  // 1. Try Cloudflare Pages Function (/api/dispatch-triage) when running under HTTP origin
  if (typeof window !== 'undefined' && window.location?.protocol?.startsWith('http')) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (hasGeminiKey) headers['x-gemini-api-key'] = cfg.apiKey;

      const res = await fetch('/api/dispatch-triage', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transcript,
          audioBase64: audioBase64 || undefined,
          audioMimeType: input.audioMimeType || 'audio/mp3',
          lat,
          lon,
          sourceLabel: input.sourceLabel,
          sourceUrl: input.sourceUrl,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data: any = await res.json();
        triage = {
          threatDetected: Boolean(data.threatDetected),
          type: String(data.type || 'UNCLASSIFIED_DISPATCH'),
          severity:
            data.severity === 'CRITICAL' || data.severity === 'HIGH' || data.severity === 'MED'
              ? data.severity
              : 'LOW',
          summary: String(data.summary || ''),
          rawExcerpts: Array.isArray(data.rawExcerpts) ? data.rawExcerpts.map(String) : [],
          modelUsed: String(data.modelUsed || 'gemini-2.5-flash'),
          analyzedAt: String(data.analyzedAt || new Date().toISOString()),
        };
      }
    } catch {}
  }

  // 2. Direct client-side Gemini 2.5 Flash fallback when BYOK Gemini key is available
  if (!triage && hasGeminiKey) {
    try {
      const { url, headers } = getGeminiAuthHeadersAndUrl(cfg, 'gemini-2.5-flash');
      const parts: Array<Record<string, unknown>> = [
        { text: buildLocalDispatchTriagePrompt(lat, lon, transcript) },
      ];
      if (audioBase64) {
        parts.push({
          inlineData: {
            mimeType: input.audioMimeType || 'audio/mp3',
            data: audioBase64,
          },
        });
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data: any = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const parsed = JSON.parse(rawText);
        const sev = String(parsed.severity || 'LOW').toUpperCase();
        triage = {
          threatDetected: Boolean(parsed.threatDetected),
          type: String(parsed.type || 'UNCLASSIFIED_DISPATCH'),
          severity: sev === 'CRITICAL' || sev === 'HIGH' || sev === 'MED' ? sev : 'LOW',
          summary: String(parsed.summary || ''),
          rawExcerpts: Array.isArray(parsed.rawExcerpts) ? parsed.rawExcerpts.map(String) : [],
          modelUsed: 'gemini-2.5-flash',
          analyzedAt: new Date().toISOString(),
        };
      }
    } catch {}
  }

  // 3. Deterministic tactical keyword triage fallback (zero-key / offline resilience)
  if (!triage) {
    triage = deterministicDispatchKeywordTriage(transcript || '[AUDIO STREAM SUBMITTED]');
  }

  // 4. Route verified threats to CommandLedgerDb + CorroborationEngine (Nyx -> Cipher -> Vance)
  if (input.ingestIntoSwarm !== false && triage.threatDetected) {
    try {
      await appendCommandLedgerEntry({
        timestamp: triage.analyzedAt,
        command_input: `DISPATCH_TRIAGE [${input.sourceLabel || 'LOCAL_SCANNER'}] (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
        involved_agent: 'rec_nyx',
        tool_used: 'dispatch_triage_analyzer',
        result_summary: `[${triage.severity}] ${triage.type}: ${triage.summary.slice(0, 180)}`,
        success_boost_achieved: triage.severity === 'CRITICAL' ? 98 : triage.severity === 'HIGH' ? 88 : 70,
      });
    } catch {}

    try {
      const { ingestPacket } = await import('./CorroborationEngine');
      const ingestRes = await ingestPacket({
        sourceTrack: 'WRITTEN_WIRE',
        sourceType: 'local_dispatch',
        canonicalTargetKey: `${input.sourceLabel || 'local-scanner'}:${triage.type.toLowerCase()}`,
        payloadTimestamp: triage.analyzedAt,
        sourceEndpoint: input.sourceUrl || 'local://dispatch-triage',
        ingestedBy: 'nyx',
        ttlSeconds: 900,
        geoAnchor: {
          lat,
          lon,
          radiusKm: geofence.radiusKm,
          precision: 'EXACT',
        },
        sectorKey: input.sectorKey || geofence.label || 'LOCAL-SECTOR',
        summaryHeadline: `[${triage.severity}] ${triage.type}: ${triage.summary.slice(0, 140)}`,
        rawPayload: {
          sourceLabel: input.sourceLabel || 'Local Dispatch Triage',
          triage,
          transcriptExcerpt: transcript.slice(0, 1200),
        },
      });
      triage.packetId = ingestRes.packet.packetId;
      triage.clusterId = ingestRes.cluster?.clusterId;

      if (
        (triage.severity === 'HIGH' || triage.severity === 'CRITICAL' || ingestRes.promotedToCorroborated) &&
        typeof window !== 'undefined'
      ) {
        triggerVanceDesktopNotification(
          `[PIXELOPS ${triage.severity}] ${triage.type}`,
          triage.summary
        );
      }
    } catch {}
  }

  return triage;
}
