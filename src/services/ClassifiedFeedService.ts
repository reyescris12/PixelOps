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

import { listWorkspaceFiles, writeWorkspaceFile, readWorkspaceFile } from '../engine/storageManager';

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
 * Headless Ingestion Utility:
 * Silently pulls and parses the target S2 Underground XML feed,
 * extracts entries & transcripts, and writes them to local VFS at:
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
    let entries: any[] = [];

    // 1. Try local/Cloudflare endpoint
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
            entries = parseRawXmlFeed(xml);
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

        const fileName = `s2_${videoId}.md`;
        const filePath = `${CLASSIFIED_FEED_DIR}${fileName}`;

        // Check if already archived
        const existing = await readWorkspaceFile(filePath);
        if (existing && existing.content && existing.content.length > 200) {
          existingCount++;
          continue;
        }

        const tags = Array.isArray(entry.threatTags) ? entry.threatTags : ['OSINT', 'S2_UNDERGROUND'];
        const title = entry.title || 'Classified Tactical Briefing';
        const published = entry.published || new Date().toISOString();
        const link = entry.link || `https://www.youtube.com/watch?v=${videoId}`;
        const summary = entry.summary || 'Tactical situation report and open-source intelligence analysis.';
        const transcript = entry.transcript || entry.description || summary;

        const markdownContent = [
          `# CLASSIFIED INTEL BRIEFING: ${title}`,
          `**Source:** S2 Underground [Channel: ${CLASSIFIED_FEED_CHANNEL_ID}]`,
          `**Video ID:** ${videoId}`,
          `**Published:** ${published}`,
          `**Direct Telemetry Link:** ${link}`,
          `**Classification:** SENSITIVE / TACTICAL OSINT TELEMETRY`,
          `**Threat Classification Tags:** ${tags.join(', ')}`,
          '',
          `## Executive Intelligence Summary`,
          summary,
          '',
          `## Tactical Briefing / Intercepted Telemetry`,
          transcript,
          '',
          `---`,
          `*Ingested via Headless Pipeline into ${filePath} at ${new Date().toISOString()}*`,
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
 * Parses raw Atom XML feed string into structured entry objects
 */
function parseRawXmlFeed(xml: string): any[] {
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
    const title = titleMatch
      ? titleMatch[1]
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim()
      : 'Untitled Intelligence Briefing';
    const link = linkMatch ? linkMatch[1].trim() : `https://www.youtube.com/watch?v=${videoId}`;
    const published = publishedMatch ? publishedMatch[1].trim() : new Date().toISOString();
    const rawDescription = descMatch
      ? descMatch[1]
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim()
      : '';

    if (!videoId) continue;

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

    results.push({
      videoId,
      title,
      link,
      published,
      description: rawDescription,
      threatTags: tags,
      summary: rawDescription.slice(0, 500),
      transcript: rawDescription,
    });

    if (results.length >= 10) break;
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
      const titleMatch = content.match(/^# CLASSIFIED INTEL BRIEFING:\s*(.*)$/m);
      const videoIdMatch = content.match(/\*\*Video ID:\*\*\s*(.*)$/m);
      const publishedMatch = content.match(/\*\*Published:\*\*\s*(.*)$/m);
      const linkMatch = content.match(/\*\*Direct Telemetry Link:\*\*\s*(.*)$/m);
      const tagsMatch = content.match(/\*\*Threat Classification Tags:\*\*\s*(.*)$/m);

      const title = titleMatch ? titleMatch[1].trim() : f.path.split('/').pop() || 'Classified Briefing';
      const videoId = videoIdMatch ? videoIdMatch[1].trim() : '';
      const published = publishedMatch ? publishedMatch[1].trim() : f.updatedAt;
      const link = linkMatch ? linkMatch[1].trim() : '';
      const threatTags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : ['OSINT'];

      briefings.push({
        path: f.path,
        videoId,
        title,
        published,
        link,
        threatTags,
        summary: f.previewSnippet || content.slice(0, 300),
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
