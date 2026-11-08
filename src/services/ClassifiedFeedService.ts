/**
 * Classified Intelligence Feed Ingestion & Autonomous Relevancy Filter
 * (src/services/ClassifiedFeedService.ts)
 * 
 * Objective:
 * Silently ingests the hardcoded S2 Underground RSS XML feed:
 * https://www.youtube.com/feeds/videos.xml?channel_id=UCTq1zHztiV69Ur8t6jco4CQ
 * Stores parsed transcripts and situation reports to local VFS:
 * /intel/sources/classified_feed/
 * 
 * Configures autonomous agent relevancy filtering during recon missions.
 * Discards noise completely if source material is irrelevant to user directive.
 */

import {
  listWorkspaceFiles,
  writeWorkspaceFile,
  readWorkspaceFile,
  deleteWorkspaceFile,
} from '../engine/storageManager';

export const CLASSIFIED_FEED_CHANNEL_ID = 'UCTq1zHztiV69Ur8t6jco4CQ';
export const CLASSIFIED_FEED_DIR = '/intel/sources/classified_feed/';
export const CLASSIFIED_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CLASSIFIED_FEED_CHANNEL_ID}`;

export interface ClassifiedBriefing {
  path: string;
  videoId: string;
  title: string;
  published: string;
  link: string;
  threatTags: string[];
  summary: string;
  content: string;
  relevancyScore?: number;
  matchedKeywords?: string[];
}

let isIngestionRunning = false;
let hasInitialized = false;

/**
 * Decodes HTML/XML entities in captions and RSS fields
 */
function decodeXmlEntities(str: string): string {
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
 * Derives a clean, human-readable filename and intelligence title from the briefing title & date
 * instead of gibberish `s2_<youtube_id>.md`.
 */
export function buildClassifiedFeedMetadata(
  rawTitle: string,
  published: string
): { cleanTitle: string; fileName: string; datePart: string } {
  const datePart = (published || new Date().toISOString()).slice(0, 10);
  const strippedTitle = (rawTitle || 'Tactical Situation Briefing')
    .replace(/\s*\|\s*S2\s*Underground.*$/i, '')
    .replace(/\s*-\s*S2\s*Underground.*$/i, '')
    .trim();

  const cleanTitle = strippedTitle.toLowerCase().startsWith('s2')
    ? strippedTitle
    : `S2 Briefing: ${strippedTitle}`;

  const titleSlug = strippedTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 7)
    .join('_');

  const fileName = `${datePart}_s2_${titleSlug || 'tactical_intel_briefing'}.md`;
  return { cleanTitle, fileName, datePart };
}

/**
 * Sanitizes raw YouTube description so raw link dumps are never placed into the transcript body.
 * Extracts narrative prose, synthesizes topic intelligence from source article slugs when prose is sparse,
 * and separates reference links into a clean appendix.
 */
function sanitizeClientFeedEntry(
  rawTitle: string,
  rawDescription: string,
  published: string,
  tags: string[],
  existingTranscript?: string
): {
  cleanTitle: string;
  fileName: string;
  summary: string;
  transcriptBody: string;
  referenceLinks: string[];
} {
  const { cleanTitle, fileName, datePart } = buildClassifiedFeedMetadata(rawTitle, published);

  const referenceLinks: string[] = [];
  const allUrls = (rawDescription || '').match(/https?:\/\/[^\s"'<>)\]]+/gi) || [];
  for (const u of allUrls) {
    const lowerUrl = u.toLowerCase();
    if (
      !lowerUrl.includes('patreon.com') &&
      !lowerUrl.includes('locals.com') &&
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

  // Strip raw URLs and promotional boilerplate from any description lines
  const proseLines = (rawDescription || '')
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

  // Check if existingTranscript is actual spoken captions (and NOT a raw URL dump)
  const rawUrlCountInTranscript = ((existingTranscript || '').match(/https?:\/\//gi) || []).length;
  const nonUrlTranscriptText = (existingTranscript || '')
    .replace(/https?:\/\/[^\s"'<>)\]]+/gi, '')
    .trim();
  const hasCleanTranscript =
    Boolean(existingTranscript) &&
    nonUrlTranscriptText.length > 180 &&
    rawUrlCountInTranscript <= 3;

  // Extract topic headlines from reference URL slugs if captions aren't present
  const extractedTopicsFromUrls: string[] = [];
  for (const urlStr of referenceLinks.slice(0, 12)) {
    try {
      const parsedUrl = new URL(urlStr);
      const host = parsedUrl.hostname.replace(/^www\./, '');
      const pathSegments = parsedUrl.pathname
        .split('/')
        .filter(
          (seg) =>
            seg &&
            seg.length > 3 &&
            !/^\d+$/.test(seg) &&
            !/^(index|article|news|story|stories|world|us|politics|html)$/i.test(seg)
        );
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

  let transcriptBody = '';
  if (hasCleanTranscript && existingTranscript) {
    transcriptBody = existingTranscript.replace(/https?:\/\/[^\s"'<>)\]]+/gi, '').trim();
  } else {
    const proseBlock =
      proseLines.length > 0
        ? `### Briefing Narrative & Analyst Notes\n${proseLines.map((l) => `- ${l}`).join('\n')}`
        : `### Briefing Narrative & Analyst Assessment\n- **Briefing Designation:** ${cleanTitle}\n- **Publication Date:** ${datePart}\n- **Operational Scope:** Multi-theater open-source intelligence synthesis (${tags.join(', ')}).`;

    const topicsBlock =
      extractedTopicsFromUrls.length > 0
        ? `\n\n### Primary Intelligence Signals & Monitored Flashpoints\n${extractedTopicsFromUrls.join('\n')}`
        : '';

    transcriptBody = `${proseBlock}${topicsBlock}`;
  }

  const spokenPreview = hasCleanTranscript
    ? nonUrlTranscriptText
        .replace(/\*\*\[\d{2}:\d{2}\]\*\*\s*/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 460) + '...'
    : '';

  const summary =
    spokenPreview ||
    (proseLines.length > 0
      ? proseLines.slice(0, 4).join(' ')
      : `Tactical situation report and multi-domain OSINT briefing covering ${cleanTitle} (${datePart}). Monitored threat domains: ${tags.join(', ')}.`);

  return {
    cleanTitle,
    fileName,
    summary,
    transcriptBody,
    referenceLinks: referenceLinks.slice(0, 15),
  };
}

/**
 * Purges legacy gibberish `s2_<videoId>.md` files or old link-dump classified feed files
 * from local VFS / IndexedDB so the user's file explorer stays clean and organized.
 */
async function purgeLegacyGibberishFeedFiles(): Promise<void> {
  try {
    const existingFiles = await listWorkspaceFiles();
    for (const file of existingFiles) {
      const normPath = file.path.replace(/^\/+/, '');
      if (!normPath.startsWith('intel/sources/classified_feed/')) continue;
      const base = normPath.split('/').pop() || '';
      const isGibberishIdName = /^s2_[A-Za-z0-9_-]{8,15}\.md$/.test(base);
      const urlMatches = (file.content || '').match(/https?:\/\/[^\s"'<>)\]]+/gi) || [];
      const hasRawUrlDumpInTranscript =
        urlMatches.length > 5 &&
        !(file.content || '').includes('## 3. Corroborated OSINT Source Citations');

      if (isGibberishIdName || hasRawUrlDumpInTranscript) {
        await deleteWorkspaceFile(file.path);
      }
    }
  } catch (err) {
    console.warn('[CLASSIFIED INGEST] Legacy file cleanup warning:', err);
  }
}

/**
 * Headless Ingestion Utility:
 * Silently pulls and parses the target S2 Underground XML feed,
 * extracts spoken transcripts & structured intelligence, purges legacy gibberish files,
 * and writes cleanly organized reports to local VFS at:
 * /intel/sources/classified_feed/
 */
export async function ingestClassifiedFeedHeadless(): Promise<{
  ingestedCount: number;
  existingCount: number;
}> {
  if (isIngestionRunning) {
    return { ingestedCount: 0, existingCount: 0 };
  }

  isIngestionRunning = true;
  let ingestedCount = 0;
  let existingCount = 0;

  try {
    // Clean up any legacy gibberish `s2_<videoId>.md` or link-dump files first
    await purgeLegacyGibberishFeedFiles();

    let entries: any[] = [];

    // 1. Try local/Cloudflare endpoint (which fetches spoken YouTube captions)
    try {
      const res = await fetch('/api/intel/classified-feed');
      if (res.ok) {
        const payload = await res.json();
        if (Array.isArray(payload?.entries)) {
          entries = payload.entries;
        }
      }
    } catch (apiErr) {
      console.warn('[CLASSIFIED INGEST] Internal endpoint unreachable, falling back to proxy fetch:', apiErr);
    }

    // 2. Direct / Proxy Fallback via /api/fetch
    if (entries.length === 0) {
      try {
        const proxyRes = await fetch(`/api/fetch?url=${encodeURIComponent(CLASSIFIED_FEED_URL)}`);
        if (proxyRes.ok) {
          const proxyData = await proxyRes.json();
          const xml = proxyData?.text || proxyData?.data || '';
          if (typeof xml === 'string' && xml.includes('<entry>')) {
            entries = await parseRawXmlFeedWithTranscripts(xml);
          }
        }
      } catch (proxyErr) {
        console.warn('[CLASSIFIED INGEST] Proxy fetch failed:', proxyErr);
      }
    }

    // 3. Ingest entries into local VFS at /intel/sources/classified_feed/
    if (entries.length > 0) {
      for (const entry of entries) {
        const videoId = entry.videoId || entry.id;
        if (!videoId) continue;

        const tags = Array.isArray(entry.threatTags) ? entry.threatTags : ['OSINT', 'S2_UNDERGROUND'];
        const rawTitle = entry.cleanTitle || entry.title || 'Classified Tactical Briefing';
        const published = entry.published || new Date().toISOString();
        const link = entry.link || `https://www.youtube.com/watch?v=${videoId}`;

        const sanitized = sanitizeClientFeedEntry(
          rawTitle,
          entry.description || '',
          published,
          tags,
          entry.transcript
        );

        const fileName = entry.fileName || sanitized.fileName;
        const filePath = `${CLASSIFIED_FEED_DIR}${fileName}`;

        // Check if already archived with clean transcript content
        const existing = await readWorkspaceFile(filePath);
        if (
          existing &&
          existing.content &&
          existing.content.length > 250 &&
          existing.content.includes('## 2. Spoken Video Transcript & Tactical Briefing')
        ) {
          existingCount++;
          continue;
        }

        const refLinks: string[] = Array.isArray(entry.referenceLinks)
          ? entry.referenceLinks
          : sanitized.referenceLinks;

        const citationsSection =
          refLinks.length > 0
            ? [
                '',
                '## 3. Corroborated OSINT Source Citations',
                ...refLinks.slice(0, 12).map((url, idx) => `${idx + 1}. <${url}>`),
              ].join('\n')
            : '';

        const markdownContent = [
          `# ${sanitized.cleanTitle}`,
          `**Document Path:** \`${filePath.replace(/^\/+/, '')}\`  `,
          `**Source Feed:** S2 Underground Tactical Wire [Channel: \`${CLASSIFIED_FEED_CHANNEL_ID}\`]  `,
          `**Briefing Date:** ${published.slice(0, 10)}  `,
          `**Video Reference:** \`${videoId}\` ([Watch Source Briefing](${link}))  `,
          `**Classification:** SENSITIVE // TACTICAL OSINT TELEMETRY  `,
          `**Threat Domains:** ${tags.map((t: string) => `\`${t}\``).join(', ')}  `,
          '',
          '---',
          '',
          `## 1. Executive Intelligence Summary`,
          sanitized.summary,
          '',
          '---',
          '',
          `## 2. Spoken Video Transcript & Tactical Briefing`,
          sanitized.transcriptBody,
          citationsSection,
          '',
          `---`,
          `*Ingested via Headless OSINT Pipeline into \`${filePath.replace(/^\/+/, '')}\` at ${new Date().toISOString()}*`,
        ].join('\n');

        await writeWorkspaceFile(filePath, markdownContent, 'markdown', 'intel');
        ingestedCount++;
      }
    }
  } catch (err) {
    console.warn('[CLASSIFIED INGEST] Silent ingestion exception:', err);
  } finally {
    isIngestionRunning = false;
  }

  return { ingestedCount, existingCount };
}

/**
 * Parses raw Atom XML feed string into structured entry objects and attempts to fetch
 * spoken captions via `/api/fetch` proxy when running in client fallback mode.
 */
async function parseRawXmlFeedWithTranscripts(xml: string): Promise<any[]> {
  const rawEntries = xml.split('<entry>');
  const results: any[] = [];

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

    const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : 'Untitled Intelligence Briefing';
    const link = linkMatch ? linkMatch[1].trim() : `https://www.youtube.com/watch?v=${videoId}`;
    const published = publishedMatch ? publishedMatch[1].trim() : new Date().toISOString();
    const rawDescription = descMatch ? decodeXmlEntities(descMatch[1]) : '';

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
    if (lower.includes('supply') || lower.includes('rail') || lower.includes('shipping') || lower.includes('food')) {
      tags.push('SUPPLY_CHAIN', 'LOGISTICS');
    }
    if (lower.includes('drone') || lower.includes('border') || lower.includes('military') || lower.includes('defense')) {
      tags.push('DEFENSE_SURVEILLANCE', 'FORCE_MOVEMENTS');
    }

    // Try fetching timedtext spoken captions via proxy
    let spokenCaptionText = '';
    try {
      const ttUrl = `https://www.youtube.com/api/timedtext?lang=en&v=${encodeURIComponent(videoId)}`;
      const ttRes = await fetch(`/api/fetch?url=${encodeURIComponent(ttUrl)}`);
      if (ttRes.ok) {
        const ttData = await ttRes.json();
        const rawCap = ttData?.text || '';
        if (rawCap && rawCap.length > 120) {
          spokenCaptionText = decodeXmlEntities(rawCap.replace(/<[^>]+>/g, ' '));
        }
      }
    } catch {
      // Ignore caption proxy failure
    }

    const sanitized = sanitizeClientFeedEntry(
      title,
      rawDescription,
      published,
      tags,
      spokenCaptionText || undefined
    );

    results.push({
      videoId,
      title,
      cleanTitle: sanitized.cleanTitle,
      fileName: sanitized.fileName,
      link,
      published,
      description: rawDescription,
      referenceLinks: sanitized.referenceLinks,
      threatTags: tags,
      summary: sanitized.summary,
      transcript: sanitized.transcriptBody,
    });

    if (results.length >= 8) break;
  }

  return results;
}

/**
 * Initializes the automated headless ingestion routine on app startup and periodic interval.
 * Operates strictly in the background without exposing any manual input fields.
 */
export function initClassifiedFeedIngestion(): void {
  if (hasInitialized || typeof window === 'undefined') return;
  hasInitialized = true;

  // Run on startup after initial render
  setTimeout(() => {
    ingestClassifiedFeedHeadless().catch((err) => {
      console.warn('[CLASSIFIED INGEST] Initial startup ingestion failed silently:', err);
    });
  }, 3500);

  // Periodic background check every 30 minutes
  setInterval(() => {
    ingestClassifiedFeedHeadless().catch(() => {});
  }, 30 * 60 * 1000);
}

/**
 * Scans the local VFS directory /intel/sources/classified_feed/ for archived operational briefings.
 */
export async function scanClassifiedFeedBriefings(): Promise<ClassifiedBriefing[]> {
  try {
    const files = await listWorkspaceFiles('intel');
    const feedFiles = files.filter(
      (f) =>
        f.path.startsWith('intel/sources/classified_feed/') ||
        f.path.startsWith('/intel/sources/classified_feed/')
    );

    const briefings: ClassifiedBriefing[] = [];
    for (const f of feedFiles) {
      const content = f.content || '';
      const base = f.path.split('/').pop() || '';
      if (/^s2_[A-Za-z0-9_-]{8,15}\.md$/.test(base)) {
        // Skip legacy gibberish files
        continue;
      }

      const titleMatch =
        content.match(/^# CLASSIFIED INTEL BRIEFING:\s*(.*)$/m) ||
        content.match(/^#\s+(.*)$/m);
      const videoIdMatch =
        content.match(/\*\*Video Reference:\*\*\s*`([^`]+)`/m) ||
        content.match(/\*\*Video ID:\*\*\s*(.*)$/m);
      const publishedMatch =
        content.match(/\*\*Briefing Date:\*\*\s*(.*)$/m) ||
        content.match(/\*\*Published:\*\*\s*(.*)$/m);
      const linkMatch =
        content.match(/\[Watch Source Briefing\]\(([^)]+)\)/m) ||
        content.match(/\*\*Direct Telemetry Link:\*\*\s*(.*)$/m);
      const tagsMatch =
        content.match(/\*\*Threat Domains:\*\*\s*(.*)$/m) ||
        content.match(/\*\*Threat Classification Tags:\*\*\s*(.*)$/m);

      const title = titleMatch ? titleMatch[1].trim() : base || 'Classified Briefing';
      const videoId = videoIdMatch ? videoIdMatch[1].trim() : '';
      const published = publishedMatch ? publishedMatch[1].trim() : f.updatedAt;
      const link = linkMatch ? linkMatch[1].trim() : '';
      const threatTags = tagsMatch
        ? tagsMatch[1].replace(/`/g, '').split(',').map((t) => t.trim())
        : ['OSINT'];

      const execSummaryMatch = content.match(
        /##\s*(?:1\.\s*)?Executive Intelligence Summary\s+([\s\S]*?)(?:\n---|\n##)/
      );

      briefings.push({
        path: f.path,
        videoId,
        title,
        published,
        link,
        threatTags,
        summary: execSummaryMatch
          ? execSummaryMatch[1].trim().slice(0, 360)
          : f.previewSnippet || content.slice(0, 300),
        content,
      });
    }

    return briefings;
  } catch (err) {
    console.warn('[CLASSIFIED SCAN] Failed to scan classified feed folder:', err);
    return [];
  }
}

/**
 * Agent Relevancy Logic:
 * Evaluates the extracted transcripts and briefings against the user's current directive.
 * - If video content matches target scope (infrastructure, grid, EW, supply chain, defense, etc.),
 *   returns verified relevant intelligence.
 * - If material is irrelevant to the specific directive, discards noise completely.
 */
export async function retrieveRelevantClassifiedBriefings(
  directive: string,
  limit = 3
): Promise<ClassifiedBriefing[]> {
  const briefings = await scanClassifiedFeedBriefings();
  if (briefings.length === 0) return [];

  const rawDirective = (directive || '').toLowerCase();
  const directiveTokens = rawDirective
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !COMMON_STOP_WORDS.has(w));

  const scoredBriefings: ClassifiedBriefing[] = [];

  for (const briefing of briefings) {
    const titleLower = briefing.title.toLowerCase();
    const contentLower = briefing.content.toLowerCase();
    const tagsLower = briefing.threatTags.map((t) => t.toLowerCase());

    let score = 0;
    const matchedKeywords: string[] = [];

    // Thematic Recon & Telemetry Categories
    for (const [category, keywords] of Object.entries(RECON_THEME_KEYWORDS)) {
      const directiveHasCategory = keywords.some((kw) => rawDirective.includes(kw));
      if (directiveHasCategory) {
        // Check if briefing matches this thematic category
        const briefingMatches = keywords.filter(
          (kw) => titleLower.includes(kw) || tagsLower.includes(kw) || contentLower.includes(kw)
        );
        if (briefingMatches.length > 0) {
          score += briefingMatches.length * 4;
          matchedKeywords.push(...briefingMatches);
        }
      }
    }

    // Direct token overlap
    for (const token of directiveTokens) {
      if (titleLower.includes(token)) {
        score += 5;
        matchedKeywords.push(token);
      } else if (contentLower.includes(token)) {
        score += 1.5;
        matchedKeywords.push(token);
      }
    }

    // General recon directive match
    const isGeneralRecon =
      rawDirective.includes('recon') ||
      rawDirective.includes('threat') ||
      rawDirective.includes('intel') ||
      rawDirective.includes('briefing') ||
      rawDirective.includes('situation report') ||
      rawDirective.includes('osint') ||
      rawDirective.includes('infrastructure');

    if (isGeneralRecon && score === 0) {
      // General situational inquiry matches latest briefings
      score = 2;
    }

    // RELEVANCY FILTER: Discard noise completely if score is zero
    if (score >= 2) {
      scoredBriefings.push({
        ...briefing,
        relevancyScore: score,
        matchedKeywords: Array.from(new Set(matchedKeywords)),
      });
    }
  }

  // Sort by relevancy score descending
  scoredBriefings.sort((a, b) => (b.relevancyScore || 0) - (a.relevancyScore || 0));
  return scoredBriefings.slice(0, limit);
}

const COMMON_STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'what', 'which',
  'when', 'where', 'who', 'how', 'why', 'can', 'you', 'please', 'tell', 'about',
  'check', 'look', 'find', 'make', 'give', 'into', 'over', 'after', 'then',
]);

const RECON_THEME_KEYWORDS: Record<string, string[]> = {
  power_grid: ['grid', 'power', 'blackout', 'substation', 'transformer', 'energy', 'utility', 'electric'],
  infrastructure: ['infrastructure', 'water', 'dam', 'bridge', 'pipeline', 'scada', 'telecom', 'cell tower'],
  communications: ['radio', 'comms', 'spectrum', 'satellite', 'gps', 'gnss', 'jamming', 'frequency', 'hf', 'vhf'],
  supply_chain: ['supply chain', 'rail', 'shipping', 'freight', 'port', 'logistics', 'shortage', 'chokepoint', 'food'],
  defense_security: ['drone', 'uav', 'border', 'radar', 'defense', 'air defense', 'cve', 'security threat', 'surveillance'],
  civil_preparedness: ['preparedness', 'disaster', 'fema', 'emergency', 'evacuation', 'shelter', 'wire', 'situation report'],
};
