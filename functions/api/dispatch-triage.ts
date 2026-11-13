/**
 * Cloudflare Pages Function: Real-Time Dispatch Audio & Transcript Triage Analyzer
 * Route: /api/dispatch-triage
 *
 * Accepts live municipal scanner audio (base64 multimodal PCM/MP3/WAV/OGG/WebM) or
 * live CAD/RSS dispatch transcripts, and runs Gemini 3.1 Flash Lite zero-shot triage
 * anchored to the operator's geofence coordinates [LAT, LNG].
 */

interface Env {
  GEMINI_API_KEY?: string;
}

export interface DispatchTriageRequest {
  transcript?: string;
  audioBase64?: string;
  audioMimeType?: string;
  lat?: number;
  lon?: number;
  sourceLabel?: string;
  sourceUrl?: string;
}

export interface DispatchTriageResult {
  threatDetected: boolean;
  type: string;
  severity: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
  summary: string;
  rawExcerpts: string[];
  modelUsed?: string;
  analyzedAt?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-gemini-api-key',
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export function buildDispatchTriagePrompt(lat: number, lon: number, transcript?: string): string {
  const basePrompt =
    `Analyze this local emergency dispatch log. Are there active violent threats, perimeter lockdowns, evacuations, or major HAZMAT incidents within coordinates [${lat.toFixed(4)}, ${lon.toFixed(4)}]? ` +
    `Output JSON: { threatDetected: boolean, type: string, severity: 'LOW'|'MED'|'HIGH'|'CRITICAL', summary: string, rawExcerpts: [] }`;
  if (transcript && transcript.trim()) {
    return `${basePrompt}\n\nDISPATCH LOG:\n${transcript.trim().slice(0, 12000)}`;
  }
  return basePrompt;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  try {
    const geminiApiKey =
      request.headers.get('x-gemini-api-key')?.trim() || env.GEMINI_API_KEY?.trim();

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          error: 'GEMINI_API_KEY_MISSING',
          message: 'No Gemini API key configured in Cloudflare environment or x-gemini-api-key header.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const body = (await request.json()) as DispatchTriageRequest;
    const lat = Number.isFinite(Number(body.lat)) ? Number(body.lat) : 38.8977;
    const lon = Number.isFinite(Number(body.lon)) ? Number(body.lon) : -77.0365;
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';
    const audioMimeType =
      typeof body.audioMimeType === 'string' && body.audioMimeType.trim()
        ? body.audioMimeType.trim()
        : 'audio/mp3';

    if (!transcript && !audioBase64) {
      return new Response(
        JSON.stringify({
          error: 'INPUT_REQUIRED',
          message: 'Provide either transcript text or base64-encoded scanner audio.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const parts: Array<Record<string, unknown>> = [
      { text: buildDispatchTriagePrompt(lat, lon, transcript) },
    ];
    if (audioBase64) {
      parts.push({
        inlineData: {
          mimeType: audioMimeType,
          data: audioBase64,
        },
      });
    }

    const model = 'gemini-3.1-flash-lite';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      return new Response(
        JSON.stringify({
          error: `GEMINI_UPSTREAM_${geminiRes.status}`,
          message: errText.slice(0, 400),
        }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const geminiData: any = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed: Partial<DispatchTriageResult> = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }

    const severityRaw = String(parsed.severity || 'LOW').toUpperCase();
    const severity: DispatchTriageResult['severity'] =
      severityRaw === 'CRITICAL' || severityRaw === 'HIGH' || severityRaw === 'MED'
        ? severityRaw
        : 'LOW';

    const result: DispatchTriageResult = {
      threatDetected: Boolean(parsed.threatDetected),
      type: String(parsed.type || 'UNCLASSIFIED_DISPATCH'),
      severity,
      summary: String(parsed.summary || 'No active tactical threat detected in dispatch log.'),
      rawExcerpts: Array.isArray(parsed.rawExcerpts)
        ? parsed.rawExcerpts.map((e) => String(e)).slice(0, 8)
        : [],
      modelUsed: model,
      analyzedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'DISPATCH_TRIAGE_FAILED',
        message: String(err?.message || err),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
}
