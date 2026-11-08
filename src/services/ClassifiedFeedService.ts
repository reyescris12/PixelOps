/**
 * Classified Intelligence Feed Ingestion & S2 Underground Wire SITREP Service
 * (src/services/ClassifiedFeedService.ts)
 * 
 * Objective:
 * Pulls S2 Underground's structured text dispatches (//The Wire//, //BLUF://, //END REPORT//)
 * from https://feeds.buzzsprout.com/868255.rss via `s2Parser.ts`,
 * archives clean SITREP reports to local VFS at `/intel/sources/classified_feed/`,
 * and provides `buildAgentSITREPContext` + `runAgentReconMission` for Agent Vance, Nyx, and Cipher.
 */

import {
  listWorkspaceFiles,
  writeWorkspaceFile,
  readWorkspaceFile,
  deleteWorkspaceFile,
  isWorkspaceFileDeleted,
} from '../engine/storageManager';
import {
  S2_WIRE_FEED_URL,
  S2WireDispatch,
  fetchS2WireFeed,
  buildAgentSITREPContext,
  buildAgentReconMissionPrompts,
} from './s2Parser';

export { S2_WIRE_FEED_URL, fetchS2WireFeed, buildAgentSITREPContext, buildAgentReconMissionPrompts };
export const CLASSIFIED_FEED_DIR = '/intel/sources/classified_feed/';
export const CLASSIFIED_FEED_URL = S2_WIRE_FEED_URL;

export interface ClassifiedBriefing {
  path: string;
  videoId?: string;
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
 * Purges any legacy YouTube RSS files (`s2_<videoId>.md` or old YouTube channel references)
 * from local VFS / IndexedDB so only clean S2 Wire SITREP text dispatches remain.
 */
async function purgeLegacyYouTubeFeedFiles(): Promise<void> {
  try {
    const existingFiles = await listWorkspaceFiles();
    for (const file of existingFiles) {
      const normPath = file.path.replace(/^\/+/, '');
      if (!normPath.startsWith('intel/sources/classified_feed/')) continue;
      const base = normPath.split('/').pop() || '';
      const isLegacyYouTubeId = /^s2_[A-Za-z0-9_-]{8,15}\.md$/.test(base);
      const hasYouTubeChannelRef =
        (file.content || '').includes('UCTq1zHztiV69Ur8t6jco4CQ') ||
        (file.content || '').includes('youtube.com/watch');

      if (isLegacyYouTubeId || hasYouTubeChannelRef) {
        await deleteWorkspaceFile(file.path);
      }
    }
  } catch (err) {
    console.warn('[S2 WIRE INGEST] Legacy YouTube file cleanup warning:', err);
  }
}

/**
 * Derives a clean, human-readable filename and title from an S2 Wire SITREP dispatch.
 */
export function buildS2WireFileMetadata(
  rawTitle: string,
  timestamp: string
): { cleanTitle: string; fileName: string; datePart: string } {
  const datePart = (timestamp || new Date().toISOString()).slice(0, 10);
  const cleanTitle = (rawTitle || 'S2 Underground // The Wire SITREP').trim();

  const titleSlug = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 7)
    .join('_');

  const fileName = `${datePart}_s2_wire_${titleSlug || 'sitrep_dispatch'}.md`;
  return { cleanTitle, fileName, datePart };
}

/**
 * Headless Ingestion Utility:
 * Pulls the latest S2 Underground Wire text dispatches from https://feeds.buzzsprout.com/868255.rss,
 * formats them as structured military SITREPs, and writes them to local VFS at:
 * /intel/sources/classified_feed/
 */
export async function ingestClassifiedFeedHeadless(): Promise<{
  ingestedCount: number;
  existingCount: number;
  dispatches: S2WireDispatch[];
  sitrepContext: string;
}> {
  if (isIngestionRunning) {
    return { ingestedCount: 0, existingCount: 0, dispatches: [], sitrepContext: '' };
  }

  isIngestionRunning = true;
  let ingestedCount = 0;
  let existingCount = 0;
  let dispatches: S2WireDispatch[] = [];

  try {
    // 1. Remove any legacy YouTube RSS files from VFS
    await purgeLegacyYouTubeFeedFiles();

    // 2. Pull clean text dispatches using fetchS2WireFeed()
    dispatches = await fetchS2WireFeed();

    // 3. Save each SITREP dispatch into local VFS at /intel/sources/classified_feed/
    if (dispatches.length > 0) {
      for (const dispatch of dispatches) {
        const { cleanTitle, fileName, datePart } = buildS2WireFileMetadata(
          dispatch.title,
          dispatch.timestamp
        );
        const filePath = `${CLASSIFIED_FEED_DIR}${fileName}`;

        // Respect user deletion tombstones: if the user deleted this dispatch, do not recreate it
        if (isWorkspaceFileDeleted(filePath)) {
          continue;
        }

        const existing = await readWorkspaceFile(filePath);
        if (existing && existing.content && existing.content.length > 200) {
          existingCount++;
          continue;
        }

        const lower = `${cleanTitle} ${dispatch.content}`.toLowerCase();
        const tags: string[] = ['OSINT', 'S2_WIRE', 'SITREP'];
        if (lower.includes('grid') || lower.includes('power') || lower.includes('blackout') || lower.includes('substation')) {
          tags.push('POWER_GRID', 'INFRASTRUCTURE');
        }
        if (lower.includes('bluf') || lower.includes('the wire') || lower.includes('tearline')) {
          tags.push('BLUF_DISPATCH', 'TACTICAL_BRIEFING');
        }
        if (lower.includes('radio') || lower.includes('comms') || lower.includes('frequency') || lower.includes('ew') || lower.includes('jamming')) {
          tags.push('SPECTRUM_EW', 'TACTICAL_COMMS');
        }
        if (lower.includes('supply') || lower.includes('rail') || lower.includes('shipping') || lower.includes('chokepoint')) {
          tags.push('SUPPLY_CHAIN', 'LOGISTICS');
        }
        if (lower.includes('drone') || lower.includes('uav') || lower.includes('air defense') || lower.includes('border') || lower.includes('military')) {
          tags.push('DEFENSE_SURVEILLANCE', 'FORCE_MOVEMENTS');
        }

        // Extract BLUF summary if present in the text dispatch
        const blufMatch = dispatch.content.match(/(?:\/\/BLUF:\/\/|BLUF:)\s*([\s\S]*?)(?:\n\n|\/\/|$)/i);
        const summary = blufMatch
          ? blufMatch[1].trim().slice(0, 420)
          : dispatch.content.slice(0, 380);

        const markdownContent = [
          `# ${cleanTitle}`,
          `**Document Path:** \`${filePath.replace(/^\/+/, '')}\`  `,
          `**Source Feed:** S2 Underground Wire Dispatch (\`${S2_WIRE_FEED_URL}\`)  `,
          `**Dispatch Date:** ${datePart} (${dispatch.timestamp})  `,
          `**Classification:** SENSITIVE // SITREP TEXT TELEMETRY  `,
          `**Threat Domains:** ${tags.map((t) => `\`${t}\``).join(', ')}  `,
          '',
          '---',
          '',
          '## 1. BLUF / Executive Intelligence Summary',
          summary,
          '',
          '---',
          '',
          '## 2. Full SITREP Text Dispatch (//The Wire//)',
          dispatch.content,
          '',
          '---',
          `*Ingested via S2 Wire Text Parser into \`${filePath.replace(/^\/+/, '')}\` at ${new Date().toISOString()}*`,
        ].join('\n');

        await writeWorkspaceFile(filePath, markdownContent, 'markdown', 'intel');
        ingestedCount++;
      }
    }
  } catch (err) {
    console.warn('[S2 WIRE INGEST] Silent ingestion exception:', err);
  } finally {
    isIngestionRunning = false;
  }

  return {
    ingestedCount,
    existingCount,
    dispatches,
    sitrepContext: buildAgentSITREPContext(dispatches),
  };
}

/**
 * Initializes the automated headless S2 Wire text ingestion routine on app startup and periodic interval.
 */
export function initClassifiedFeedIngestion(): void {
  if (hasInitialized || typeof window === 'undefined') return;
  hasInitialized = true;

  setTimeout(() => {
    ingestClassifiedFeedHeadless().catch((err) => {
      console.warn('[S2 WIRE INGEST] Initial startup ingestion failed silently:', err);
    });
  }, 2500);

  setInterval(() => {
    ingestClassifiedFeedHeadless().catch(() => {});
  }, 30 * 60 * 1000);
}

/**
 * Scans the local VFS directory /intel/sources/classified_feed/ for archived S2 Wire SITREP dispatches.
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
      // Skip any legacy YouTube files
      if (/^s2_[A-Za-z0-9_-]{8,15}\.md$/.test(base) || content.includes('UCTq1zHztiV69Ur8t6jco4CQ')) {
        continue;
      }

      const titleMatch = content.match(/^#\s+(.*)$/m);
      const publishedMatch =
        content.match(/\*\*Dispatch Date:\*\*\s*([^\n(]+)/m) ||
        content.match(/\*\*Briefing Date:\*\*\s*(.*)$/m);
      const tagsMatch = content.match(/\*\*Threat Domains:\*\*\s*(.*)$/m);

      const title = titleMatch ? titleMatch[1].trim() : base || 'S2 Wire SITREP';
      const published = publishedMatch ? publishedMatch[1].trim() : f.updatedAt;
      const threatTags = tagsMatch
        ? tagsMatch[1].replace(/`/g, '').split(',').map((t) => t.trim())
        : ['OSINT', 'S2_WIRE', 'SITREP'];

      const sitrepBodyMatch = content.match(
        /##\s*2\.\s*Full SITREP Text Dispatch[^\n]*\n+([\s\S]*?)(?:\n---|$)/
      );
      const cleanSitrepBody = sitrepBodyMatch ? sitrepBodyMatch[1].trim() : content;

      const blufMatch = content.match(
        /##\s*1\.\s*BLUF \/ Executive Intelligence Summary\s+([\s\S]*?)(?:\n---|\n##)/
      );

      briefings.push({
        path: f.path,
        title,
        published,
        link: S2_WIRE_FEED_URL,
        threatTags,
        summary: blufMatch
          ? blufMatch[1].trim().slice(0, 380)
          : f.previewSnippet || cleanSitrepBody.slice(0, 300),
        content: cleanSitrepBody,
      });
    }

    return briefings;
  } catch (err) {
    console.warn('[S2 WIRE SCAN] Failed to scan classified feed folder:', err);
    return [];
  }
}

/**
 * Returns formatted `[INTEL REPORT 01..05]` SITREP context directly for Agent Vance, Nyx, or Cipher.
 * Pulls from cached VFS dispatches first or fetches live from `fetchS2WireFeed()`.
 */
export async function getAgentSITREPStreamContext(limit = 5): Promise<string> {
  const archived = await scanClassifiedFeedBriefings();
  if (archived.length > 0) {
    const dispatches: S2WireDispatch[] = archived.slice(0, limit).map((b) => ({
      title: b.title,
      timestamp: b.published,
      content: b.content,
      link: b.link,
    }));
    return buildAgentSITREPContext(dispatches);
  }

  const liveDispatches = await fetchS2WireFeed();
  return buildAgentSITREPContext(liveDispatches.slice(0, limit));
}

/**
 * Evaluates the S2 Wire text dispatches against the user's current directive
 * and returns matching briefings (or latest SITREPs for general recon/OSINT sweeps).
 */
export async function retrieveRelevantClassifiedBriefings(
  directive: string,
  limit = 3
): Promise<ClassifiedBriefing[]> {
  let briefings = await scanClassifiedFeedBriefings();
  if (briefings.length === 0) {
    await ingestClassifiedFeedHeadless();
    briefings = await scanClassifiedFeedBriefings();
  }
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

    for (const [, keywords] of Object.entries(RECON_THEME_KEYWORDS)) {
      const directiveHasCategory = keywords.some((kw) => rawDirective.includes(kw));
      if (directiveHasCategory) {
        const briefingMatches = keywords.filter(
          (kw) => titleLower.includes(kw) || tagsLower.includes(kw) || contentLower.includes(kw)
        );
        if (briefingMatches.length > 0) {
          score += briefingMatches.length * 4;
          matchedKeywords.push(...briefingMatches);
        }
      }
    }

    for (const token of directiveTokens) {
      if (titleLower.includes(token)) {
        score += 5;
        matchedKeywords.push(token);
      } else if (contentLower.includes(token)) {
        score += 1.5;
        matchedKeywords.push(token);
      }
    }

    const isGeneralRecon =
      rawDirective.includes('recon') ||
      rawDirective.includes('threat') ||
      rawDirective.includes('intel') ||
      rawDirective.includes('briefing') ||
      rawDirective.includes('sitrep') ||
      rawDirective.includes('situation report') ||
      rawDirective.includes('the wire') ||
      rawDirective.includes('s2') ||
      rawDirective.includes('osint') ||
      rawDirective.includes('infrastructure');

    if (isGeneralRecon && score === 0) {
      score = 3;
    }

    if (score >= 2) {
      scoredBriefings.push({
        ...briefing,
        relevancyScore: score,
        matchedKeywords: Array.from(new Set(matchedKeywords)),
      });
    }
  }

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
  civil_preparedness: ['preparedness', 'disaster', 'fema', 'emergency', 'evacuation', 'shelter', 'wire', 'sitrep', 'bluf', 'situation report'],
};
