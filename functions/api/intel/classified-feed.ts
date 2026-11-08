/**
 * Cloudflare Pages Function: Headless Classified Intel Ingestion
 * Route: /api/intel/classified-feed
 * 
 * Silently ingests the hardcoded S2 Underground RSS XML feed:
 * https://www.youtube.com/feeds/videos.xml?channel_id=UCTq1zHztiV69Ur8t6jco4CQ
 * Extracts actual spoken video transcripts via YouTube caption tracks / Innertube player API,
 * strips raw citation link dumps from descriptions, derives clean intelligence titles & filenames,
 * and returns structured telemetry objects for storage into local VFS at /intel/sources/classified_feed/.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const S2_CHANNEL_ID = 'UCTq1zHztiV69Ur8t6jco4CQ';
const S2_RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${S2_CHANNEL_ID}`;

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export interface FeedEntry {
  videoId: string;
  title: string;
  cleanTitle: string;
  fileName: string;
  link: string;
  published: string;
  description: string;
  referenceLinks: string[];
  threatTags: string[];
  summary: string;
  transcript: string;
  transcriptSource: 'spoken_captions' | 'structured_briefing_synthesis';
}

/**
 * Decodes HTML/XML entities in captions and RSS fields
 */
function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats raw caption segments into organized, readable intelligence transcript paragraphs
 * with periodic timestamp markers.
 */
function formatCaptionSegments(segments: Array<{ startSec: number; text: string }>): string {
  if (!segments || segments.length === 0) return '';

  const paragraphs: string[] = [];
  let currentSentences: string[] = [];
  let currentParagraphStartSec = segments[0]?.startSec || 0;
  let charCount = 0;

  const formatTimestamp = (sec: number): string => {
    const mins = Math.floor(sec / 60);
    const remSec = Math.floor(sec % 60);
    return `[${String(mins).padStart(2, '0')}:${String(remSec).padStart(2, '0')}]`;
  };

  for (const seg of segments) {
    const clean = seg.text
      .replace(/\[Music\]/gi, '')
      .replace(/\[Applause\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) continue;

    if (currentSentences.length === 0) {
      currentParagraphStartSec = seg.startSec;
    }

    currentSentences.push(clean);
    charCount += clean.length;

    // Group into readable paragraphs (~380-500 chars or on sentence boundary)
    if (charCount >= 420 || (charCount >= 260 && /[.!?]$/.test(clean))) {
      const joined = currentSentences.join(' ').replace(/\s+([.,!?;:])/g, '$1');
      paragraphs.push(`**${formatTimestamp(currentParagraphStartSec)}** ${joined}`);
      currentSentences = [];
      charCount = 0;
    }
  }

  if (currentSentences.length > 0) {
    const joined = currentSentences.join(' ').replace(/\s+([.,!?;:])/g, '$1');
    paragraphs.push(`**${formatTimestamp(currentParagraphStartSec)}** ${joined}`);
  }

  return paragraphs.join('\n\n');
}

/**
 * Parses YouTube timedtext XML or JSON3 response into timestamped text segments
 */
function parseCaptionPayload(payload: string): Array<{ startSec: number; text: string }> {
  const segments: Array<{ startSec: number; text: string }> = [];
  if (!payload) return segments;

  // 1. Check if JSON3 format
  if (payload.trim().startsWith('{')) {
    try {
      const json = JSON.parse(payload);
      if (Array.isArray(json.events)) {
        for (const ev of json.events) {
          if (!Array.isArray(ev.segs)) continue;
          const text = decodeHtmlEntities(ev.segs.map((s: any) => s.utf8 || '').join(''));
          if (text) {
            segments.push({
              startSec: Math.floor((Number(ev.tStartMs) || 0) / 1000),
              text,
            });
          }
        }
        if (segments.length > 0) return segments;
      }
    } catch {
      // Fall through to XML parser
    }
  }

  // 2. Parse XML <text start="12.34" dur="3.21">...</text> or <p t="12340" d="3210">...</p>
  const textRegex = /<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(payload)) !== null) {
    const startSec = parseFloat(match[1]) || 0;
    const rawText = match[2].replace(/<[^>]+>/g, ' ');
    const decoded = decodeHtmlEntities(rawText);
    if (decoded) {
      segments.push({ startSec, text: decoded });
    }
  }

  if (segments.length > 0) return segments;

  const pRegex = /<p[^>]*t="(\d+)"[^>]*>([\s\S]*?)<\/p>/gi;
  while ((match = pRegex.exec(payload)) !== null) {
    const startSec = Math.floor((parseInt(match[1], 10) || 0) / 1000);
    const rawText = match[2].replace(/<[^>]+>/g, ' ');
    const decoded = decodeHtmlEntities(rawText);
    if (decoded) {
      segments.push({ startSec, text: decoded });
    }
  }

  return segments;
}

/**
 * Fetches actual spoken video captions/transcript from YouTube for a given videoId.
 * Tries:
 *   1. YouTube Innertube Player API (ANDROID / WEB client) captionTracks
 *   2. YouTube Watch Page HTML `captionTracks` extraction
 *   3. Direct timedtext API fallback
 */
async function fetchYouTubeSpokenTranscript(videoId: string): Promise<string | null> {
  if (!videoId) return null;

  const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 4500) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // Strategy 1: Innertube Player API
    const playerRes = await fetchWithTimeout(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 14) gzip',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '19.09.37',
              androidSdkVersion: 34,
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      },
      4500
    );

    if (playerRes.ok) {
      const playerJson: any = await playerRes.json();
      const tracks: any[] =
        playerJson?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (tracks.length > 0) {
        const enTrack =
          tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
          tracks.find((t) => t.languageCode?.startsWith('en')) ||
          tracks[0];
        if (enTrack?.baseUrl) {
          const capRes = await fetchWithTimeout(enTrack.baseUrl, {}, 4000);
          if (capRes.ok) {
            const capBody = await capRes.text();
            const segments = parseCaptionPayload(capBody);
            if (segments.length > 0) {
              return formatCaptionSegments(segments);
            }
          }
        }
      }
    }
  } catch {
    // Proceed to Strategy 2
  }

  try {
    // Strategy 2: Watch page HTML captionTracks extraction
    const watchRes = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      4500
    );

    if (watchRes.ok) {
      const html = await watchRes.text();
      const trackMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])/);
      if (trackMatch) {
        const tracks = JSON.parse(trackMatch[1]);
        if (Array.isArray(tracks) && tracks.length > 0) {
          const enTrack =
            tracks.find((t: any) => t.languageCode === 'en' && t.kind !== 'asr') ||
            tracks.find((t: any) => t.languageCode?.startsWith('en')) ||
            tracks[0];
          if (enTrack?.baseUrl) {
            const capUrl = enTrack.baseUrl.replace(/\\u0026/g, '&');
            const capRes = await fetchWithTimeout(capUrl, {}, 4000);
            if (capRes.ok) {
              const capBody = await capRes.text();
              const segments = parseCaptionPayload(capBody);
              if (segments.length > 0) {
                return formatCaptionSegments(segments);
              }
            }
          }
        }
      }
    }
  } catch {
    // Proceed to Strategy 3
  }

  try {
    // Strategy 3: Direct timedtext API fallback
    for (const url of [
      `https://www.youtube.com/api/timedtext?lang=en&v=${encodeURIComponent(videoId)}`,
      `https://www.youtube.com/api/timedtext?lang=en&kind=asr&v=${encodeURIComponent(videoId)}`,
    ]) {
      const ttRes = await fetchWithTimeout(url, {}, 3000);
      if (ttRes.ok) {
        const ttXml = await ttRes.text();
        const segments = parseCaptionPayload(ttXml);
        if (segments.length > 0) {
          return formatCaptionSegments(segments);
        }
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Strips raw URL link dumps, channel boilerplate, merch/social links, and extracts
 * clean narrative lines + structured reference URLs separately.
 */
function sanitizeDescriptionAndExtractIntel(
  title: string,
  rawDescription: string,
  published: string,
  tags: string[]
): {
  cleanTitle: string;
  fileName: string;
  summary: string;
  synthesizedTranscript: string;
  referenceLinks: string[];
} {
  const datePart = (published || new Date().toISOString()).slice(0, 10);

  // Clean up title into a human-friendly intelligence title
  const cleanedRawTitle = title
    .replace(/\s*\|\s*S2\s*Underground.*$/i, '')
    .replace(/\s*-\s*S2\s*Underground.*$/i, '')
    .trim();

  const cleanTitle = cleanedRawTitle.toLowerCase().startsWith('s2')
    ? cleanedRawTitle
    : `S2 Briefing: ${cleanedRawTitle}`;

  // Build organized, human-readable filename slug based on the date and intel title (NOT gibberish videoId)
  const titleSlug = cleanedRawTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 7)
    .join('_');

  const fileName = `${datePart}_s2_${titleSlug || 'tactical_intel_briefing'}.md`;

  const referenceLinks: string[] = [];
  const urlRegex = /https?:\/\/[^\s"'<>)\]]+/gi;
  const allUrls = rawDescription.match(urlRegex) || [];
  for (const u of allUrls) {
    const lowerUrl = u.toLowerCase();
    // Ignore channel promo/merch/social links, keep only actual OSINT source references
    if (
      !lowerUrl.includes('patreon.com') &&
      !lowerUrl.includes(' locals.com') &&
      !lowerUrl.includes('s2underground.locals') &&
      !lowerUrl.includes('youtube.com/channel') &&
      !lowerUrl.includes('youtube.com/@') &&
      !lowerUrl.includes('twitter.com/s2') &&
      !lowerUrl.includes('x.com/s2') &&
      !lowerUrl.includes('instagram.com') &&
      !lowerUrl.includes('merch') &&
      !lowerUrl.includes('teespring') &&
      !lowerUrl.includes('substack.com/@s2') &&
      !lowerUrl.includes('buymeacoffee') &&
      !lowerUrl.includes('ko-fi')
    ) {
      if (!referenceLinks.includes(u)) {
        referenceLinks.push(u);
      }
    }
  }

  // Strip all URLs and promotional boilerplate from description text
  const proseLines = rawDescription
    .split(/\r?\n/)
    .map((line) => line.replace(/https?:\/\/[^\s"'<>)\]]+/gi, '').replace(/^[\s\-•*:]+/, '').trim())
    .filter((line) => {
      if (!line || line.length < 4) return false;
      const l = line.toLowerCase();
      if (
        l.includes('patreon') ||
        l.includes('support the channel') ||
        l.includes('s2 underground') ||
        l.includes('disclaimer') ||
        l.includes('for entertainment') ||
        l.includes('all rights reserved') ||
        l.includes('follow us on') ||
        l.includes('join our') ||
        l.includes('locals.com') ||
        l.includes('links to sources') ||
        l.includes('sources cited') ||
        l.includes('reference links') ||
        /^sources?:?$/i.test(l) ||
        /^links?:?$/i.test(l)
      ) {
        return false;
      }
      return true;
    });

  // Extract domain intelligence topics from the reference URLs (hostnames + article slugs)
  // in case the YouTube description was 100% links!
  const extractedTopicsFromUrls: string[] = [];
  for (const urlStr of referenceLinks.slice(0, 12)) {
    try {
      const parsedUrl = new URL(urlStr);
      const host = parsedUrl.hostname.replace(/^www\./, '');
      const pathSegments = parsedUrl.pathname
        .split('/')
        .filter((seg) => seg && seg.length > 3 && !/^\d+$/.test(seg) && !/^(index|article|news|story|stories|world|us|politics|html)$/i.test(seg));
      const lastSeg = pathSegments[pathSegments.length - 1] || '';
      const readableSlug = lastSeg
        .replace(/\.(html?|php|aspx?)$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b[a-f0-9]{8,}\b/gi, '')
        .replace(/\b\d{5,}\b/g, '')
        .trim();
      if (readableSlug && readableSlug.split(/\s+/).length >= 3) {
        const formattedTopic = readableSlug.charAt(0).toUpperCase() + readableSlug.slice(1);
        extractedTopicsFromUrls.push(`- **${formattedTopic}** *(Source: ${host})*`);
      }
    } catch {
      // Ignore malformed URL
    }
  }

  const summary =
    proseLines.length > 0
      ? proseLines.slice(0, 4).join(' ')
      : `Tactical situation report and multi-domain OSINT briefing covering ${cleanedRawTitle} (${datePart}). Classification domains: ${tags.join(', ')}.`;

  const topicBullets =
    extractedTopicsFromUrls.length > 0
      ? `\n\n### Primary Intelligence Signals & Monitored Flashpoints\n${extractedTopicsFromUrls.join('\n')}`
      : '';

  const proseSection =
    proseLines.length > 0
      ? `### Briefing Narrative & Analyst Notes\n${proseLines.map((l) => `- ${l}`).join('\n')}`
      : `### Briefing Narrative & Analyst Assessment\n- **Briefing Designation:** ${cleanedRawTitle}\n- **Publication Date:** ${datePart}\n- **Operational Scope:** Multi-theater open-source intelligence synthesis (${tags.join(', ')}).\n- **Assessment:** Automated transcript synthesis derived from S2 Underground briefing metadata and corroborated theater reporting.`;

  const synthesizedTranscript = `${proseSection}${topicBullets}`;

  return {
    cleanTitle,
    fileName,
    summary,
    synthesizedTranscript,
    referenceLinks: referenceLinks.slice(0, 15),
  };
}

export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  try {
    const feedRes = await fetch(S2_RSS_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 PixelOps-Intelligence/2.0',
        Accept: 'application/atom+xml, application/xml, text/xml, */*',
      },
    });

    if (!feedRes.ok) {
      throw new Error(`Upstream RSS fetch failed with status ${feedRes.status}`);
    }

    const xml = await feedRes.text();
    const rawEntries = xml.split('<entry>');
    const parsedItems: Array<{
      videoId: string;
      title: string;
      link: string;
      published: string;
      rawDescription: string;
      tags: string[];
    }> = [];

    // Parse up to 8 latest entries in the Atom feed
    for (let i = 1; i < rawEntries.length; i++) {
      const block = rawEntries[i].split('</entry>')[0];
      const videoIdMatch =
        block.match(/<yt:videoId>(.*?)<\/yt:videoId>/) ||
        block.match(/<id>yt:video:(.*?)<\/id>/);
      const titleMatch = block.match(/<title>(.*?)<\/title>/);
      const linkMatch = block.match(/<link[^>]+href="([^"]+)"/);
      const publishedMatch = block.match(/<published>(.*?)<\/published>/);
      const descMatch = block.match(/<media:description>([\s\S]*?)<\/media:description>/);

      const videoId = videoIdMatch ? videoIdMatch[1].trim() : '';
      if (!videoId) continue;

      const title = titleMatch
        ? decodeHtmlEntities(titleMatch[1])
        : 'Untitled Intelligence Briefing';
      const link = linkMatch ? linkMatch[1].trim() : `https://www.youtube.com/watch?v=${videoId}`;
      const published = publishedMatch ? publishedMatch[1].trim() : new Date().toISOString();
      const rawDescription = descMatch ? decodeHtmlEntities(descMatch[1]) : '';

      // Extract key topic tags based on title and content
      const lower = `${title} ${rawDescription}`.toLowerCase();
      const tags: string[] = ['OSINT', 'S2_UNDERGROUND'];
      if (lower.includes('grid') || lower.includes('power') || lower.includes('blackout') || lower.includes('substation')) {
        tags.push('POWER_GRID', 'INFRASTRUCTURE');
      }
      if (lower.includes('wire') || lower.includes('brief') || lower.includes('intel') || lower.includes('situation')) {
        tags.push('SITUATION_REPORT', 'TACTICAL_BRIEFING');
      }
      if (lower.includes('radio') || lower.includes('comms') || lower.includes('frequency') || lower.includes('ew') || lower.includes('jamming')) {
        tags.push('SPECTRUM_EW', 'TACTICAL_COMMS');
      }
      if (lower.includes('supply') || lower.includes('rail') || lower.includes('shipping') || lower.includes('food') || lower.includes('chokepoint')) {
        tags.push('SUPPLY_CHAIN', 'LOGISTICS');
      }
      if (lower.includes('drone') || lower.includes('uav') || lower.includes('air defense') || lower.includes('border') || lower.includes('military')) {
        tags.push('DEFENSE_SURVEILLANCE', 'FORCE_MOVEMENTS');
      }

      parsedItems.push({
        videoId,
        title,
        link,
        published,
        rawDescription,
        tags,
      });

      if (parsedItems.length >= 8) break;
    }

    // Fetch actual spoken transcripts concurrently for all entries
    const entries: FeedEntry[] = await Promise.all(
      parsedItems.map(async (item) => {
        const spokenTranscript = await fetchYouTubeSpokenTranscript(item.videoId);
        const sanitized = sanitizeDescriptionAndExtractIntel(
          item.title,
          item.rawDescription,
          item.published,
          item.tags
        );

        // If spoken captions were extracted, use the first ~450 chars of spoken transcript as executive summary
        const spokenPreview = spokenTranscript
          ? spokenTranscript
              .replace(/\*\*\[\d{2}:\d{2}\]\*\*\s*/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 480) + '...'
          : '';

        return {
          videoId: item.videoId,
          title: item.title,
          cleanTitle: sanitized.cleanTitle,
          fileName: sanitized.fileName,
          link: item.link,
          published: item.published,
          description: sanitized.summary,
          referenceLinks: sanitized.referenceLinks,
          threatTags: item.tags,
          summary: spokenPreview || sanitized.summary,
          transcript: spokenTranscript || sanitized.synthesizedTranscript,
          transcriptSource: spokenTranscript ? 'spoken_captions' : 'structured_briefing_synthesis',
        };
      })
    );

    return new Response(
      JSON.stringify({
        status: 'ok',
        source: 'S2 Underground Classified Telemetry',
        channelId: S2_CHANNEL_ID,
        feedUrl: S2_RSS_URL,
        count: entries.length,
        entries,
        ingestedAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          ...CORS_HEADERS,
        },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        status: 'error',
        error: 'CLASSIFIED_FEED_ERROR',
        message: err?.message || 'Failed to fetch classified intelligence feed.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
