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

export interface LocalDispatchIncident {
  id: string;
  sourceType: 'nws_polygon' | 'county_cad' | 'pulsepoint' | 'local_rss';
  sourceUrl: string;
  title: string;
  severity: string;
  summary: string;
  lat: number;
  lon: number;
  timestamp: string;
}

function stripXmlTags(input: string): string {
  return (input || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseLocalDispatchRssOrJson(
  rawText: string,
  sourceUrl: string,
  defaultLat: number,
  defaultLon: number
): LocalDispatchIncident[] {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return [];

  // 1. JSON CAD / PulsePoint / OpenMHz feed
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.incidents)
        ? parsed.incidents
        : Array.isArray(parsed?.calls)
        ? parsed.calls
        : Array.isArray(parsed?.features)
        ? parsed.features
        : Array.isArray(parsed?.items)
        ? parsed.items
        : [];
      return list.slice(0, 15).map((item: any, idx: number) => {
        const props = item?.properties || item;
        const coords = item?.geometry?.coordinates || props?.report_location?.coordinates;
        const lat = Number(
          props?.lat ??
            props?.latitude ??
            (Array.isArray(coords) ? coords[1] : defaultLat)
        );
        const lon = Number(
          props?.lon ??
            props?.lng ??
            props?.longitude ??
            (Array.isArray(coords) ? coords[0] : defaultLon)
        );
        const rawTitle = String(
          props?.title ||
            props?.event ||
            props?.callType ||
            props?.type ||
            props?.issue_reported ||
            props?.headline ||
            props?.talkgroupTag ||
            'Local CAD Incident'
        );
        const rawSummary = String(
          props?.summary ||
            props?.transcript ||
            props?.description ||
            props?.address ||
            props?.location ||
            ''
        ).slice(0, 320);
        const inferredHigh = /\b(active shooter|shots fired|hazmat|chemical|evacuation|lockdown|structure fire|working fire|multi-alarm|explosion|medevac|barricaded|swat)\b/i.test(
          `${rawTitle} ${rawSummary}`
        );
        return {
          id: String(
            props?.id ||
              props?.incident_number ||
              props?.traffic_report_id ||
              props?.callId ||
              props?._id ||
              item?.id ||
              `cad-${idx}-${rawTitle.slice(0, 16).replace(/\W+/g, '_')}`
          ),
          sourceType: sourceUrl.toLowerCase().includes('pulsepoint')
            ? 'pulsepoint'
            : sourceUrl.toLowerCase().includes('openmhz')
            ? 'openmhz_scanner'
            : 'county_cad',
          sourceUrl,
          title: rawTitle,
          severity: inferredHigh
            ? 'HIGH'
            : String(props?.severity || props?.priority || 'MED').toUpperCase(),
          summary: rawSummary,
          lat: Number.isFinite(lat) ? lat : defaultLat,
          lon: Number.isFinite(lon) ? lon : defaultLon,
          timestamp: String(
            props?.timestamp ||
              props?.datetime ||
              props?.published_date ||
              props?.time ||
              props?.receivedAt ||
              props?.sent ||
              new Date().toISOString()
          ),
        };
      });
    } catch {
      return [];
    }
  }

  // 2. RSS / Atom XML dispatch feed
  const incidents: LocalDispatchIncident[] = [];
  const itemMatches = trimmed.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (let i = 0; i < Math.min(12, itemMatches.length); i++) {
    const block = itemMatches[i];
    const title = stripXmlTags(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'Local Dispatch Alert');
    const desc = stripXmlTags(
      block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1] || ''
    );
    const pubDate = stripXmlTags(
      block.match(/<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i)?.[1] || ''
    );
    const guid = stripXmlTags(block.match(/<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i)?.[1] || '');
    incidents.push({
      id: guid || `rss-${i}-${title.slice(0, 24).replace(/\W+/g, '_')}`,
      sourceType: 'local_rss',
      sourceUrl,
      title,
      severity: /\b(evacuation|hazmat|active shooter|lockdown|tornado|emergency)\b/i.test(`${title} ${desc}`)
        ? 'HIGH'
        : 'MED',
      summary: desc.slice(0, 320),
      lat: defaultLat,
      lon: defaultLon,
      timestamp: pubDate && !isNaN(Date.parse(pubDate)) ? new Date(pubDate).toISOString() : new Date().toISOString(),
    });
  }
  return incidents;
}

export async function fetchLocalDispatchFeeds(options?: {
  extraFeedUrls?: string[];
  logToLedger?: boolean;
}): Promise<{
  incidents: LocalDispatchIncident[];
  feedsPolled: number;
  deltasEmitted: number;
}> {
  const { getLocalGeofenceConfig, filterItemsWithinGeofence } = await import('./OsintToolsService');
  const geofence = getLocalGeofenceConfig();
  const nwsUrl = `https://api.weather.gov/alerts/active?point=${geofence.lat.toFixed(4)},${geofence.lon.toFixed(4)}`;
  const customUrls = Array.from(
    new Set([...(geofence.dispatchFeedUrls || []), ...(options?.extraFeedUrls || [])].filter(Boolean))
  );

  const collected: LocalDispatchIncident[] = [];
  let feedsPolled = 0;

  // 1. NWS Local Polygon Alerts
  try {
    feedsPolled += 1;
    const res = await fetch(nwsUrl, {
      headers: { Accept: 'application/geo+json', 'User-Agent': 'PixelOps-Tactical-PWA/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data: any = await res.json();
      const features = Array.isArray(data?.features) ? data.features : [];
      for (const f of features.slice(0, 10)) {
        const p = f?.properties || {};
        collected.push({
          id: String(f.id || p.id || `nws-${Date.now()}`),
          sourceType: 'nws_polygon',
          sourceUrl: nwsUrl,
          title: String(p.headline || p.event || 'NWS Local Polygon Alert'),
          severity: String(p.severity || 'Moderate').toUpperCase(),
          summary: String(p.description || p.instruction || p.event || '').slice(0, 320),
          lat: geofence.lat,
          lon: geofence.lon,
          timestamp: String(p.sent || p.effective || new Date().toISOString()),
        });
      }
    }
  } catch {}

  // 2. Custom County CAD / PulsePoint / OpenMHz RSS or JSON feeds
  await Promise.allSettled(
    customUrls.map(async (feedUrl) => {
      feedsPolled += 1;
      const res = await fetch(feedUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const rawText = await res.text();
      const parsed = parseLocalDispatchRssOrJson(rawText, feedUrl, geofence.lat, geofence.lon);
      collected.push(...parsed);
    })
  );

  const bounded = filterItemsWithinGeofence(
    collected,
    (item) => ({ lat: item.lat, lon: item.lon }),
    geofence
  );

  let deltasEmitted = 0;
  try {
    const { ingestPacket } = await import('./CorroborationEngine');
    for (const inc of bounded.slice(0, 8)) {
      const res = await ingestPacket({
        sourceTrack: 'WRITTEN_WIRE',
        sourceType: 'local_dispatch',
        canonicalTargetKey: inc.id,
        payloadTimestamp: inc.timestamp,
        sourceEndpoint: inc.sourceUrl,
        ingestedBy: 'nyx',
        ttlSeconds: 600,
        geoAnchor: {
          lat: inc.lat,
          lon: inc.lon,
          radiusKm: geofence.radiusKm,
          precision: 'EXACT',
        },
        sectorKey: geofence.label || 'LOCAL-SECTOR',
        summaryHeadline: `[${inc.sourceType.toUpperCase()}] ${inc.title}`,
        rawPayload: inc,
      });
      if (res.deltaEmitted) deltasEmitted += 1;
    }
  } catch {}

  if (options?.logToLedger !== false) {
    try {
      const { appendCommandLedgerEntry } = await import('./CommandLedgerDb');
      await appendCommandLedgerEntry({
        timestamp: new Date().toISOString(),
        command_input: `LOCAL_DISPATCH_POLL (${geofence.lat.toFixed(3)}, ${geofence.lon.toFixed(3)} r=${geofence.radiusKm}km)`,
        involved_agent: 'rec_nyx',
        tool_used: 'local_dispatch_feed',
        result_summary: `Polled ${feedsPolled} local feed(s); ${bounded.length} bounded incident(s), ${deltasEmitted} new delta(s).`,
        success_boost_achieved: deltasEmitted > 0 ? 90 : 50,
      });
    } catch {}
  }

  return {
    incidents: bounded,
    feedsPolled,
    deltasEmitted,
  };
}
