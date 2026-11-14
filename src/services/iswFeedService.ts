/**
 * ISW (Institute for the Study of War) Intelligence Feed Service
 * (src/services/iswFeedService.ts)
 *
 * Objective:
 * Discovers, validates, cleans, and ingests daily and specialized conflict research articles from:
 * https://understandingwar.org/research/
 * Covers Russian Offensive Campaign Assessments, Middle East/Iran Updates,
 * Indo-Pacific/Korea/Taiwan assessments, and strategic military research.
 * Archives clean full-text dossiers to local VFS at `/intel/sources/isw_research/`
 * and provides correlation lookups, agent tool integration, and Recon Monitor map pin data.
 */

import {
  listWorkspaceFiles,
  writeWorkspaceFile,
  isWorkspaceFileDeleted,
  isCorruptedScrapedWorkspaceFile,
  purgeWorkspaceFileWithoutTombstone,
} from '../engine/storageManager';

export const ISW_BASE_URL = 'https://understandingwar.org';
export const ISW_RESEARCH_URL = 'https://understandingwar.org/research/';
export const ISW_FEED_DIR = '/intel/sources/isw_research/';

export interface ISWArticle {
  id: string;
  title: string;
  url: string;
  published: string;
  theater: 'russia_ukraine' | 'middle_east' | 'china_taiwan' | 'global_security';
  threatTags: string[];
  summary: string;
  keyTakeaways: string[];
  content: string;
  coordinates: { lat: number; lon: number };
  relevancyScore?: number;
}

const INVALID_PAGE_TITLE_RE =
  /\b(page not found|404|not found|nothing found|just a moment|attention required|access denied|forbidden|bad gateway|service unavailable|error\s+\d{3})\b|can[’']t be found/i;

const INVALID_PAGE_BODY_RE =
  /oops!\s*that page can[’']t be found|page not found\s*[-|]\s*institute for the study of war|^#{1,3}\s*(?:404|page not found|nothing found|access denied|just a moment|attention required)\b|enable javascript and cookies to continue|checking your browser before accessing|verify you are human/im;

/**
 * Strictly rejects HTTP >= 400 responses, 404/"Page not found" pages,
 * anti-bot challenge interstitials, and empty/stub responses.
 */
export function isInvalidWebArticlePage(
  title = '',
  content = '',
  status?: number
): boolean {
  if (typeof status === 'number' && status >= 400) return true;
  const cleanTitle = String(title || '').trim();
  if (cleanTitle && INVALID_PAGE_TITLE_RE.test(cleanTitle)) return true;

  const text = String(content || '').trim();
  if (text.length < 220) return true;

  const headSample = text.slice(0, 2500);
  if (INVALID_PAGE_BODY_RE.test(headSample)) return true;

  return false;
}

/**
 * Strips WordPress navigation chrome, share menus, footer subscribe blocks,
 * and trailing raw endnote URL dumps while preserving full ISW analytical prose.
 */
export function cleanISWArticleBody(rawContent: string): string {
  let text = String(rawContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return '';

  // Strip leading WordPress navigation/share boilerplate if present before main analytical headings
  const sectionStart = text.search(/^##\s+(?:Toplines|Key Takeaways|Executive Summary)\b/im);
  if (
    sectionStart > 0 &&
    sectionStart < 18000 &&
    /\[Skip to content\]|\bMenu\b|\bDonate\b|^####\s+Options\b/im.test(text.slice(0, sectionStart))
  ) {
    text = text.slice(sectionStart).trim();
  } else if (/^####\s+Options\b/i.test(text) || /\[Skip to content\]/i.test(text.slice(0, 2500))) {
    const firstH2 = text.search(/^##\s+(?!Options\b)/im);
    if (firstH2 > 0) {
      text = text.slice(firstH2).trim();
    }
  }

  // Strip duplicate top-level H1 if the body opens with `# Title`
  text = text.replace(/^#\s+[^\n]+\n+/, '').trim();

  // Strip trailing WordPress footer / newsletter / copyright blocks
  const footerIdx = text.search(
    /\n(?:##+\s*Subscribe to ISW|©\s*20\d{2}\s+Institute for the Study of War|1400\s+16th\s+Street\s+NW)/i
  );
  if (footerIdx > 600) {
    text = text.slice(0, footerIdx).trim();
  }

  // Strip trailing raw endnote URL dump (`[1] https://... \n [2] https://...`)
  const endnoteDumpIdx = text.search(/\n\[1\]\s*(?:https?:\/\/|\S+\s+https?:\/\/)[\s\S]{80,}$/);
  if (endnoteDumpIdx > 800) {
    text = text.slice(0, endnoteDumpIdx).trim();
  }

  // Convert empty map anchor links `[](https://understandingwar.org/map/... "Label")` into readable map citations
  text = text.replace(/\[\]\((https?:\/\/[^)\s"]+)(?:\s+"([^"]+)")?\)/g, (_m, url, label) =>
    label ? `*[Map Reference: ${label}](${url})*` : ''
  );

  // Clean inline bold-wrapped endnotes like `**[1]**` -> `[1]` and fix missing space after bold lead-ins (`.**Word` -> `.** Word`)
  text = text.replace(/\*{2,}\[(\d+)\]\*{2,}/g, '[$1]');
  text = text.replace(/([.!?:])\*\*([A-Z0-9\[])/g, '$1** $2');
  text = text.replace(/\[(\d+)\](?=[A-Z])/g, '[$1] ');

  // Collapse excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  // Cap cleanly at a paragraph boundary (~24,000 chars) so full assessments stay intact
  const maxChars = 24000;
  if (text.length > maxChars) {
    const cut = text.lastIndexOf('\n\n', maxChars);
    text = (cut > maxChars * 0.7 ? text.slice(0, cut) : text.slice(0, maxChars)).trim();
  }

  return text;
}

/**
 * Extracts structured plaintext bullets from ISW's `## Key Takeaways` section (or fallback takeaway headings).
 */
export function extractISWKeyTakeaways(cleanBody: string): string[] {
  const ktMatch = cleanBody.match(
    /(?:^|\n)##\s*(?:Key Takeaways|Executive Key Takeaways|Strategic Defense Takeaways|Key Strategic Takeaways|Key Findings)[^\n]*\n+([\s\S]*?)(?=\n#{1,3}\s+|\n---\s*\n|$)/i
  );
  if (!ktMatch) return [];

  const lines = ktMatch[1].split('\n');
  const items: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:\d+\.|[-*•])\s+(.+)$/);
    if (!m) continue;
    const cleaned = m[1]
      .replace(/\[(\d+)\]/g, '')
      .replace(/\*{2}([^*]+)\*{2}:?/g, '$1: ')
      .replace(/\*{2}/g, '')
      .replace(/:\s*:/g, ':')
      .replace(/([.!?:])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > 20) {
      items.push(cleaned);
    }
    if (items.length >= 8) break;
  }
  return items;
}

/**
 * Extracts a clean analytical summary paragraph from an ISW article body,
 * skipping metadata headers, map captions, and standard publishing disclaimers.
 */
export function extractISWSummary(cleanBody: string, keyTakeaways: string[] = []): string {
  // Strip any leading dossier metadata block (`**Source URL:** ... ---`) if called on a stored VFS file
  const strippedMeta = cleanBody.replace(/^(?:#\s+[^\n]+\n+)?(?:\*\*[^*\n]+:\*\*[^\n]*\n+)+(?:---\n+)?/, '').trim();

  const paragraphs = strippedMeta
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p.length > 85 &&
        !p.startsWith('#') &&
        !p.startsWith('![') &&
        !p.startsWith('*[Map') &&
        !p.startsWith('**Source') &&
        !/^_?(?:the\s+)?institute for the study of war\b.*\bpublish/i.test(p) &&
        !/^_?ISW(?:'s|’s)?\s+.*\bpublish/i.test(p) &&
        !/^_?Note:/i.test(p) &&
        !/^\d+\.\s+/.test(p) &&
        !/^[-*•]\s+/.test(p)
    );

  if (paragraphs.length > 0) {
    const first = paragraphs[0]
      .replace(/\[(\d+)\]/g, '')
      .replace(/\*{2}/g, '')
      .replace(/^_+|_+$/g, '')
      .replace(/([.!?:])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
    if (first.length > 75) {
      return first.slice(0, 480);
    }
  }

  if (keyTakeaways.length > 0) {
    return keyTakeaways.slice(0, 2).join(' ').slice(0, 480);
  }

  return strippedMeta
    .replace(/^#+\s+.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

// Offline fallback seed articles reflecting ISW's active theaters (used only if live network discovery is unreachable)
export const ISW_FEATURED_REPORTS: ISWArticle[] = [
  {
    id: 'isw_ru_ukr_latest',
    title: 'Russian Offensive Campaign Assessment // Eastern Front & Drone-EW Tactical Dynamics',
    url: 'https://understandingwar.org/analysis/russia-ukraine/',
    published: '2026-11-08T18:00:00Z',
    theater: 'russia_ukraine',
    threatTags: ['ukraine', 'russia', 'donbas', 'drone_warfare', 'ew_jamming', 'artillery', 'kinetic_strikes'],
    summary:
      'Russian forces conduct decentralized mechanized assaults along the Pokrovsk-Kurakhove axis while deploying FPV fiber-optic tethered drones to evade Ukrainian EW jamming umbrellas. Ukrainian forces leverage precision strike packages against tactical rear logistics nodes.',
    keyTakeaways: [
      'Russian tactical grouping executes localized offensives across Donetsk and Zaporizhia sectors.',
      'Deployment of fiber-optic wire-guided FPV drones degrades conventional electronic countermeasure effectiveness.',
      'Ukrainian combined strike complexes target command-and-control nodes and ammunition depots inside staging areas.',
      'Critical infrastructure targeting continues with Shahed-136/Geran-2 saturation waves against high-voltage substations.',
    ],
    coordinates: { lat: 48.2824, lon: 37.1818 },
    content: `## Toplines

**Russian forces continue decentralized mechanized and infantry assaults along the Pokrovsk-Kurakhove axis while expanding tactical deployment of fiber-optic tethered FPV drones to bypass electronic warfare umbrellas.** Ukrainian long-range strike units simultaneously continue deep interdiction operations against Russian energy infrastructure, ammunition arsenals, and tactical airfields supporting frontline aviation.

## Key Takeaways

1. **Frontline Assault Trajectory:** Russian tactical echelons maintain continuous grinding pressure across the Pokrovsk-Kurakhove operational direction, aiming to sever secondary logistics corridors.
2. **Technological Adaptation & EW Neutralization:** Frontline elements increasingly field tethered fiber-optic drones. By eliminating radio transmission links, these unmanned systems operate without susceptibility to local RF jamming sweeps.
3. **Deep Logistics Interdiction:** Ukrainian long-range strike capabilities continue systematic interdiction against fuel depots, refineries, and staging hubs across rear operational zones.
4. **Energy Infrastructure Strike Matrix:** Sustained missile-drone salvos focus on thermal generating capacity and high-voltage grid interconnects to strain industrial defense manufacturing.`,
  },
  {
    id: 'isw_me_iran_latest',
    title: 'Iran Update // Middle East Proxy Matrix, Air Defense Posture & Maritime Red Sea Threats',
    url: 'https://understandingwar.org/analysis/middle-east/',
    published: '2026-11-07T16:00:00Z',
    theater: 'middle_east',
    threatTags: ['iran', 'middle_east', 'red_sea', 'houthis', 'air_defense', 'ballistic_missiles', 'strait_of_hormuz'],
    summary:
      'Iranian defense leadership accelerates hardening of strategic missile facilities with mobile air defense radar batteries, while Axis of Resistance networks coordinate maritime reconnaissance and drone operations near Red Sea chokepoints.',
    keyTakeaways: [
      'IRGC aerospace engineering units fortify subterranean ballistic missile complexes and radar warning nets.',
      'Houthi maritime strike elements sustain anti-ship missile and unmanned surface vessel readiness near Bab al-Mandab.',
      'Iranian-backed Iraqi militia networks adapt dispersed command routing and covert logistics corridors.',
      'Iran-Russia dual-use defense-industrial cooperation continues across unmanned aerial guidance components.',
    ],
    coordinates: { lat: 32.4279, lon: 53.688 },
    content: `## Toplines

**Iranian defense and aerospace commands continue hardening subterranean missile and air defense infrastructure while maintaining operational coordination across regional Axis of Resistance partner networks.** Maritime security conditions across the southern Red Sea and Gulf of Aden remain contested amid persistent reconnaissance and unmanned strike readiness.

## Key Takeaways

1. **Subterranean Facility Hardening:** Iranian Aerospace Force engineering corps expand hardened tunnel complexes and reposition mobile surface-to-air missile batteries around strategic defense sites.
2. **Maritime Chokepoint Interdiction:** Houthi elements in Yemen maintain tracking posture over commercial transit lanes across Bab al-Mandab and the Gulf of Aden.
3. **Militia Force Reconstitution:** Regional proxy formations in Iraq and the Levant disperse command nodes and adopt hardened communications practices to reduce SIGINT exposure.
4. **Defense-Industrial Resupply:** Bilateral defense transfers between Tehran and Moscow prioritize unmanned aerial vehicle propulsion, energetics, and guidance electronics.`,
  },
  {
    id: 'isw_taiwan_indo_pacific',
    title: 'Indo-Pacific Strategic Assessment // Cross-Strait Gray-Zone Pressure & Korean Peninsula Deterrence',
    url: 'https://understandingwar.org/analysis/china-taiwan/',
    published: '2026-11-06T12:00:00Z',
    theater: 'china_taiwan',
    threatTags: ['taiwan', 'china', 'korea', 'pla', 'gray_zone', 'maritime_blockade', 'first_island_chain'],
    summary:
      'PLA theater commands sustain joint air-sea readiness patrols and coast guard gray-zone pressure around Taiwan Strait approaches while North Korea accelerates naval surface combatant modernization.',
    keyTakeaways: [
      'High-tempo joint sea-air combat patrols test reaction envelopes around northern and southwestern ADIZ corridors.',
      'Coast guard and maritime militia deployments normalize multi-axis quarantine and inspection drills.',
      'North Korean naval shipyard activity indicates continued investment in larger guided-missile surface combatants.',
    ],
    coordinates: { lat: 24.8138, lon: 120.9675 },
    content: `## Toplines

**People's Liberation Army (PLA) Eastern Theater Command elements continue integrated naval aviation, surface combatant, and coast guard patrols around the Taiwan Strait while North Korea expands naval modernization programs.** Regional defense forces across the First Island Chain are accelerating mobile anti-ship missile dispersion and resilient communications hardening.

## Key Takeaways

1. **Normalized Encirclement Drills:** PLA naval and air assets conduct recurring multi-axis patrols around Taiwan's sea lines of communication to rehearse joint blockade and quarantine scenarios.
2. **Gray-Zone Maritime Pressure:** Coast guard cutters systematically operate near outlying islands and contiguous zones to erode jurisdictional baselines below kinetic thresholds.
3. **Korean Peninsula Naval Modernization:** North Korean shipyard construction of larger surface combatants underscores efforts to diversify seaborne strike and nuclear deterrence platforms.`,
  },
];

let activeIngestionPromise: Promise<{
  ingestedCount: number;
  existingCount: number;
  articles: ISWArticle[];
}> | null = null;
let hasISWInitialized = false;

/**
 * Derives clean filename and path for an ISW research article
 */
export function buildISWFileMetadata(article: ISWArticle): { fileName: string; filePath: string } {
  const datePart = (article.published || new Date().toISOString()).slice(0, 10);
  const cleanTitle = article.title
    .replace(/^ISW:\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1 || /\d/.test(w))
    .slice(0, 8)
    .join('_');

  const fileName = `${datePart}_isw_${cleanTitle || 'research_brief'}.md`;
  const filePath = `intel/sources/isw_research/${fileName}`;
  return { fileName, filePath };
}

interface RawFetchedWebPage {
  title: string;
  content: string;
  publishedTime?: string;
  finalUrl: string;
  status?: number;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response | null> {
  if (typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches structured Markdown via Jina Reader (`https://r.jina.ai/<raw-url>`).
 * IMPORTANT: Jina Reader expects the unencoded target URL in the path.
 */
async function fetchViaJinaReader(
  targetUrl: string,
  timeoutMs = 10000
): Promise<RawFetchedWebPage | null> {
  const res = await fetchWithTimeout(
    `https://r.jina.ai/${targetUrl}`,
    { headers: { Accept: 'application/json' } },
    timeoutMs
  );
  if (!res || !res.ok) return null;

  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json: any = await res.json();
      if (typeof json?.code === 'number' && json.code >= 400) return null;
      const data = json?.data || {};
      if (typeof data?.status === 'number' && data.status >= 400) return null;
      const title = String(data.title || json.title || '').trim();
      const content = String(data.content || json.content || '').trim();
      if (!content) return null;
      return {
        title,
        content,
        publishedTime: typeof data.publishedTime === 'string' ? data.publishedTime : undefined,
        finalUrl: String(data.finalUrl || data.url || targetUrl),
        status: typeof data.status === 'number' ? data.status : 200,
      };
    }

    const rawText = await res.text();
    if (!rawText) return null;
    const titleMatch = rawText.match(/^Title:\s*(.+)$/m);
    const bodyStart = rawText.indexOf('Markdown Content:');
    const content =
      bodyStart >= 0 ? rawText.slice(bodyStart + 'Markdown Content:'.length).trim() : rawText.trim();
    return {
      title: titleMatch ? titleMatch[1].trim() : '',
      content,
      finalUrl: targetUrl,
      status: res.status,
    };
  } catch {
    return null;
  }
}

/**
 * Fallback fetch via local `/api/fetch` proxy when running in browser with backend server active.
 * Strictly validates `content-type: application/json`, `data.ok === true`, and `data.status < 400`.
 */
async function fetchViaLocalProxy(
  targetUrl: string,
  timeoutMs = 6500
): Promise<RawFetchedWebPage | null> {
  if (typeof window === 'undefined' || !/^https?:$/i.test(window.location?.protocol || '')) {
    return null;
  }
  const res = await fetchWithTimeout(
    `/api/fetch?url=${encodeURIComponent(targetUrl)}`,
    { headers: { Accept: 'application/json' } },
    timeoutMs
  );
  if (!res || !res.ok) return null;

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;

  try {
    const data: any = await res.json();
    if (data?.ok !== true) return null;
    if (typeof data?.status === 'number' && data.status >= 400) return null;
    const content = String(data?.text || (typeof data?.data === 'string' ? data.data : '') || '').trim();
    if (!content) return null;
    return {
      title: String(data?.title || '').trim(),
      content,
      finalUrl: String(data?.url || targetUrl),
      status: typeof data?.status === 'number' ? data.status : 200,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts canonical two-segment ISW research article URLs (`https://understandingwar.org/research/<category>/<slug>/`)
 * from an index or theater page and returns a theater-balanced selection.
 */
export function extractISWArticleUrlsFromIndex(markdown: string, maxCount = 5): string[] {
  const re = /https?:\/\/(?:www\.)?understandingwar\.org\/research\/([a-z0-9-]+)\/([a-z0-9-]+)\/?/gi;
  const excludedSegments = new Set(['page', 'category', 'tag', 'author', 'feed', 'search', 'wp-content', 'wp-json']);
  const byCategory = new Map<string, string[]>();
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const category = m[1].toLowerCase();
    const slug = m[2].toLowerCase();
    if (excludedSegments.has(category) || excludedSegments.has(slug) || slug.length < 4) {
      continue;
    }
    const canonical = `https://understandingwar.org/research/${category}/${slug}/`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(canonical);
  }

  const selected: string[] = [];
  const preferredOrder = [
    'russia-ukraine',
    'middle-east',
    'china-taiwan',
    'adversary-entente',
    'defense-of-europe',
    'cognitive-warfare',
  ];

  // First pass: one latest report per major strategic theater for breadth
  for (const cat of preferredOrder) {
    const list = byCategory.get(cat);
    if (list && list.length > 0 && selected.length < maxCount) {
      selected.push(list[0]);
    }
  }

  // Second pass: fill remaining slots with newest remaining reports across categories
  for (const list of byCategory.values()) {
    for (const url of list) {
      if (selected.length >= maxCount) break;
      if (!selected.includes(url)) {
        selected.push(url);
      }
    }
    if (selected.length >= maxCount) break;
  }

  return selected;
}

function parseISWPublishedDate(publishedTime: string | undefined, title: string, url: string): string {
  const monthNames =
    'january|february|march|april|may|june|july|august|september|october|november|december';

  // Prefer explicit report date in title or slug so filenames match the assessment date cleanly
  const titleDate = title.match(new RegExp(`(${monthNames})\\s+(\\d{1,2}),?\\s+(20\\d{2})`, 'i'));
  if (titleDate) {
    const d = new Date(`${titleDate[1]} ${titleDate[2]}, ${titleDate[3]} 12:00:00 UTC`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const slugDate = url.match(new RegExp(`(${monthNames})-(\\d{1,2})-(20\\d{2})`, 'i'));
  if (slugDate) {
    const d = new Date(`${slugDate[1]} ${slugDate[2]}, ${slugDate[3]} 12:00:00 UTC`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  if (publishedTime) {
    const d = new Date(publishedTime);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return new Date().toISOString();
}

function classifyISWTheaterAndMeta(
  url: string,
  title: string,
  body: string
): {
  theater: ISWArticle['theater'];
  threatTags: string[];
  coordinates: { lat: number; lon: number };
} {
  const combined = `${url} ${title} ${body.slice(0, 1200)}`.toLowerCase();

  if (
    url.includes('/russia-ukraine/') ||
    /\b(ukraine|russian offensive|donbas|pokrovsk|kharkiv|zaporizhia|kremlin)\b/.test(combined)
  ) {
    return {
      theater: 'russia_ukraine',
      threatTags: ['ukraine', 'russia', 'donbas', 'drone_warfare', 'isw_research'],
      coordinates: { lat: 48.2824, lon: 37.1818 },
    };
  }

  if (
    url.includes('/middle-east/') ||
    /\b(iran update|iran|middle east|tehran|hezbollah|houthi|red sea|gaza|syria|iraq)\b/.test(combined)
  ) {
    return {
      theater: 'middle_east',
      threatTags: ['iran', 'middle_east', 'red_sea', 'air_defense', 'isw_research'],
      coordinates: { lat: 32.4279, lon: 53.688 },
    };
  }

  if (
    url.includes('/china-taiwan/') ||
    /\b(china|taiwan|korean peninsula|north korea|dprk|indo-pacific|pla)\b/.test(combined)
  ) {
    const isKorea = /\b(korean peninsula|north korea|dprk|pyongyang)\b/.test(combined);
    return {
      theater: 'china_taiwan',
      threatTags: isKorea
        ? ['north_korea', 'indo_pacific', 'maritime_security', 'china_taiwan', 'isw_research']
        : ['taiwan', 'china', 'pla', 'indo_pacific', 'isw_research'],
      coordinates: isKorea ? { lat: 38.97, lon: 125.39 } : { lat: 24.8138, lon: 120.9675 },
    };
  }

  return {
    theater: 'global_security',
    threatTags: ['global_security', 'strategic_warning', 'isw_research'],
    coordinates: { lat: 50.1109, lon: 8.6821 },
  };
}

/**
 * Fetches and parses a single ISW article URL (or resolves the latest article if given an ISW catalog/hub URL).
 * Returns `null` if the target page is 404/"Page not found", blocked, or invalid.
 */
export async function fetchISWArticleByUrl(rawUrl: string): Promise<ISWArticle | null> {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;

  const isDirectArticle =
    /^https?:\/\/(?:www\.)?understandingwar\.org\/research\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i.test(trimmed);

  let targetArticleUrl = trimmed;

  // If caller passed a catalog/hub URL (e.g. /research/ or /analysis/middle-east/), discover the newest real article URL first
  if (!isDirectArticle && /understandingwar\.org/i.test(trimmed)) {
    const hubRaw = (await fetchViaJinaReader(trimmed, 9500)) || (await fetchViaLocalProxy(trimmed, 6000));
    const hubCandidates = hubRaw ? extractISWArticleUrlsFromIndex(hubRaw.content, 1) : [];
    if (hubCandidates.length > 0) {
      targetArticleUrl = hubCandidates[0];
    } else {
      const fallbackHub = await fetchViaJinaReader(ISW_RESEARCH_URL, 9500);
      const fallbackCandidates = fallbackHub ? extractISWArticleUrlsFromIndex(fallbackHub.content, 1) : [];
      if (fallbackCandidates.length === 0) return null;
      targetArticleUrl = fallbackCandidates[0];
    }
  }

  const raw =
    (await fetchViaJinaReader(targetArticleUrl, 11000)) ||
    (await fetchViaLocalProxy(targetArticleUrl, 6500));
  if (!raw) return null;

  if (isInvalidWebArticlePage(raw.title, raw.content, raw.status)) {
    return null;
  }

  const strippedTitle = raw.title
    .replace(/\s*[-|–—]\s*Institute for the Study of War.*$/i, '')
    .trim();

  // Reject catalog/index pages masquerading as articles
  if (/^(?:research library|research|analysis|publications|home)$/i.test(strippedTitle)) {
    return null;
  }

  const cleanBody = cleanISWArticleBody(raw.content);
  if (cleanBody.length < 300 || isInvalidWebArticlePage(strippedTitle, cleanBody)) {
    return null;
  }

  const titleFromBody = cleanBody.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
  const baseTitle =
    strippedTitle ||
    (titleFromBody && !/^(?:toplines|key takeaways)$/i.test(titleFromBody)
      ? titleFromBody
      : 'Conflict Research Assessment');
  const finalTitle = /^ISW:/i.test(baseTitle) ? baseTitle : `ISW: ${baseTitle}`;

  const canonicalUrl = raw.finalUrl && /understandingwar\.org\/research\//i.test(raw.finalUrl)
    ? raw.finalUrl
    : targetArticleUrl;

  const keyTakeaways = extractISWKeyTakeaways(cleanBody);
  const summary = extractISWSummary(cleanBody, keyTakeaways);
  const published = parseISWPublishedDate(raw.publishedTime, baseTitle, canonicalUrl);
  const { theater, threatTags, coordinates } = classifyISWTheaterAndMeta(
    canonicalUrl,
    baseTitle,
    cleanBody
  );

  const slugId =
    canonicalUrl
      .replace(/\/+$/, '')
      .split('/')
      .pop()
      ?.replace(/[^a-z0-9_-]/gi, '_') || `live_${Date.now()}`;

  return {
    id: `isw_${slugId}`,
    title: finalTitle,
    url: canonicalUrl,
    published,
    theater,
    threatTags,
    summary,
    keyTakeaways:
      keyTakeaways.length > 0
        ? keyTakeaways
        : [summary.slice(0, 220)],
    coordinates,
    content: cleanBody,
  };
}

/**
 * Discovers live article URLs from `https://understandingwar.org/research/` (fallback `https://understandingwar.org/`)
 * and extracts full-text validated ISW research assessments.
 * Falls back to `ISW_FEATURED_REPORTS` only when live network discovery yields zero valid articles.
 */
export async function fetchLiveISWArticles(): Promise<ISWArticle[]> {
  if (typeof fetch !== 'function') {
    return ISW_FEATURED_REPORTS;
  }

  try {
    let candidateUrls: string[] = [];

    // Stage 1: Discover latest individual article URLs from ISW's Research Library catalog
    const discoveryPages = [ISW_RESEARCH_URL, `${ISW_BASE_URL}/`];
    for (const indexUrl of discoveryPages) {
      const indexPage =
        (await fetchViaJinaReader(indexUrl, 10000)) ||
        (await fetchViaLocalProxy(indexUrl, 6500));
      if (indexPage && indexPage.content) {
        candidateUrls = extractISWArticleUrlsFromIndex(indexPage.content, 5);
        if (candidateUrls.length > 0) break;
      }
    }

    if (candidateUrls.length === 0) {
      return ISW_FEATURED_REPORTS;
    }

    // Stage 2: Fetch and clean each discovered ISW article concurrently
    const settled = await Promise.allSettled(
      candidateUrls.map((articleUrl) => fetchISWArticleByUrl(articleUrl))
    );

    const liveArticles: ISWArticle[] = [];
    for (const res of settled) {
      if (res.status === 'fulfilled' && res.value) {
        liveArticles.push(res.value);
      }
    }

    if (liveArticles.length > 0) {
      return liveArticles;
    }
  } catch (err) {
    console.warn('[ISW FEED] Live discovery error, using offline fallback:', err);
  }

  return ISW_FEATURED_REPORTS;
}

function formatISWDossierMarkdown(article: ISWArticle): string {
  const hasNativeSections = /^##\s+(?:Toplines|Key Takeaways|Executive Key Takeaways|Strategic Defense Takeaways|Key Findings)\b/im.test(
    article.content
  );

  const lines: string[] = [
    `# ${article.title}`,
    `**Source URL:** ${article.url}  `,
    `**Institution:** Institute for the Study of War (ISW)  `,
    `**Publication Date:** ${article.published}  `,
    `**Strategic Theater:** \`${article.theater.toUpperCase()}\`  `,
    `**Geographic Coordinates:** \`${article.coordinates.lat.toFixed(4)}, ${article.coordinates.lon.toFixed(4)}\`  `,
    `**Threat Domains:** ${article.threatTags.map((t) => `\`${t}\``).join(', ')}  `,
    '',
    '---',
    '',
  ];

  if (!hasNativeSections && article.keyTakeaways.length > 0) {
    lines.push('## Key Takeaways', '', ...article.keyTakeaways.map((k) => `- ${k}`), '', '---', '');
  }

  lines.push(article.content.trim());
  return lines.join('\n');
}

/**
 * Ingests ISW research articles and archives them as clean markdown files in VFS at:
 * `/intel/sources/isw_research/`
 * Automatically purges any previously stored 404/"Page not found" ISW scrape artifacts.
 */
export async function ingestISWResearchHeadless(options?: {
  forceRefresh?: boolean;
}): Promise<{
  ingestedCount: number;
  existingCount: number;
  articles: ISWArticle[];
}> {
  if (activeIngestionPromise) {
    return activeIngestionPromise;
  }

  activeIngestionPromise = (async () => {
    let ingestedCount = 0;
    let existingCount = 0;
    let articles: ISWArticle[] = [];

    try {
      // 1. Purge any corrupted 404 / "Page not found" / menu-dump ISW files without adding user tombstones
      const currentIntelFiles = await listWorkspaceFiles('intel');
      for (const f of currentIntelFiles) {
        const norm = f.path.replace(/^\/+/, '');
        if (
          norm.startsWith('intel/sources/isw_research/') &&
          isCorruptedScrapedWorkspaceFile(norm, f.content || '')
        ) {
          await purgeWorkspaceFileWithoutTombstone(norm);
        }
      }

      // 2. Fetch live ISW articles (falls back to curated seed articles only when offline)
      articles = await fetchLiveISWArticles();
      if (!articles || articles.length === 0) {
        articles = ISW_FEATURED_REPORTS;
      }

      const refreshedFiles = await listWorkspaceFiles('intel');
      const existingByPath = new Map(
        refreshedFiles.map((f) => [f.path.replace(/^\/+/, ''), f])
      );

      for (const article of articles) {
        if (isInvalidWebArticlePage(article.title, article.content)) {
          continue;
        }

        const { filePath } = buildISWFileMetadata(article);
        const normPath = filePath.replace(/^\/+/, '');

        if (isWorkspaceFileDeleted(normPath)) {
          continue;
        }

        const existingFile = existingByPath.get(normPath);
        if (
          existingFile &&
          !options?.forceRefresh &&
          existingFile.content &&
          existingFile.content.length >= 600 &&
          !isCorruptedScrapedWorkspaceFile(normPath, existingFile.content)
        ) {
          existingCount++;
          continue;
        }

        const markdownContent = formatISWDossierMarkdown(article);
        await writeWorkspaceFile(normPath, markdownContent, 'markdown', 'intel');
        ingestedCount++;
      }
    } catch (err) {
      console.warn('[ISW RESEARCH INGEST] Ingestion warning:', err);
    } finally {
      activeIngestionPromise = null;
    }

    return {
      ingestedCount,
      existingCount,
      articles,
    };
  })();

  return activeIngestionPromise;
}

function parseStoredISWFiles(files: Awaited<ReturnType<typeof listWorkspaceFiles>>): ISWArticle[] {
  const iswFiles = files.filter((f) => {
    const norm = f.path.replace(/^\/+/, '');
    if (!norm.startsWith('intel/sources/isw_research/')) return false;
    if (isCorruptedScrapedWorkspaceFile(norm, f.content || '')) {
      purgeWorkspaceFileWithoutTombstone(norm).catch(() => {});
      return false;
    }
    return true;
  });

  const articles: ISWArticle[] = [];
  for (const f of iswFiles) {
    const content = f.content || '';
    const titleMatch = content.match(/^#\s+(.*)$/m);
    const urlMatch = content.match(/\*\*Source URL:\*\*\s*(.*)$/m);
    const pubMatch = content.match(/\*\*Publication Date:\*\*\s*(.*)$/m);
    const coordsMatch = content.match(/\*\*Geographic Coordinates:\*\*\s*`?([-\d.]+),\s*([-\d.]+)`?/m);
    const theaterMatch = content.match(/\*\*Strategic Theater:\*\*\s*`?([A-Z_]+)`?/m);
    const tagsMatch = content.match(/\*\*Threat Domains:\*\*\s*(.*)$/m);

    const title = titleMatch ? titleMatch[1].trim() : 'ISW Research Briefing';
    const url = urlMatch ? urlMatch[1].trim() : ISW_RESEARCH_URL;
    const published = pubMatch ? pubMatch[1].trim() : f.updatedAt;
    const theater = (theaterMatch ? theaterMatch[1].toLowerCase() : 'global_security') as ISWArticle['theater'];
    const tags = tagsMatch
      ? tagsMatch[1]
          .replace(/[`]/g, '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : ['isw_research'];

    const coords = coordsMatch
      ? { lat: parseFloat(coordsMatch[1]), lon: parseFloat(coordsMatch[2]) }
      : { lat: 48.2824, lon: 37.1818 };

    const keyTakeaways = extractISWKeyTakeaways(content);
    const summary = extractISWSummary(content, keyTakeaways);

    articles.push({
      id: `isw_vfs_${f.id ?? f.path}`,
      title,
      url,
      published,
      theater,
      threatTags: tags,
      summary,
      keyTakeaways,
      content,
      coordinates: coords,
    });
  }

  return articles;
}

/**
 * Scans `/intel/sources/isw_research/` and returns structured ISW article records.
 * Automatically purges corrupted 404 files and re-ingests clean live articles when empty.
 */
export async function scanISWBriefings(): Promise<ISWArticle[]> {
  try {
    const files = await listWorkspaceFiles('intel');
    const articles = parseStoredISWFiles(files);

    if (articles.length === 0) {
      const ingestRes = await ingestISWResearchHeadless();
      const reloaded = parseStoredISWFiles(await listWorkspaceFiles('intel'));
      if (reloaded.length > 0) return reloaded;
      return ingestRes.articles.length > 0 ? ingestRes.articles : ISW_FEATURED_REPORTS;
    }

    return articles;
  } catch {
    return ISW_FEATURED_REPORTS;
  }
}

/**
 * Correlates a user query or intelligence directive with relevant ISW articles
 */
export async function retrieveRelevantISWBriefings(
  directive: string,
  limit = 3
): Promise<ISWArticle[]> {
  let articles = await scanISWBriefings();
  if (articles.length === 0) {
    await ingestISWResearchHeadless();
    articles = await scanISWBriefings();
  }
  if (articles.length === 0) return [];

  const raw = (directive || '').toLowerCase();
  const tokens = raw
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const scored: ISWArticle[] = [];
  for (const art of articles) {
    const titleLower = art.title.toLowerCase();
    const contentLower = art.content.toLowerCase();
    const tagsLower = art.threatTags.join(' ').toLowerCase();

    let score = 0;
    for (const t of tokens) {
      if (titleLower.includes(t)) score += 6;
      else if (tagsLower.includes(t)) score += 4;
      else if (contentLower.includes(t)) score += 1.5;
    }

    const isISWMention =
      raw.includes('isw') ||
      raw.includes('understanding war') ||
      raw.includes('understandingwar') ||
      raw.includes('study of war');
    if (isISWMention) score += 15;

    const isRussiaUkraine =
      raw.includes('russia') ||
      raw.includes('ukraine') ||
      raw.includes('donbas') ||
      raw.includes('pokrovsk');
    if (isRussiaUkraine && art.theater === 'russia_ukraine') score += 8;

    const isMiddleEast =
      raw.includes('iran') ||
      raw.includes('middle east') ||
      raw.includes('houthi') ||
      raw.includes('red sea');
    if (isMiddleEast && art.theater === 'middle_east') score += 8;

    const isIndoPacific =
      raw.includes('taiwan') ||
      raw.includes('china') ||
      raw.includes('korea') ||
      raw.includes('pacific');
    if (isIndoPacific && art.theater === 'china_taiwan') score += 8;

    if (score > 0 || isISWMention) {
      scored.push({ ...art, relevancyScore: score });
    }
  }

  scored.sort((a, b) => (b.relevancyScore || 0) - (a.relevancyScore || 0));
  return scored.slice(0, limit);
}

/**
 * Builds formatted ISW intelligence prompt block for agent system instructions
 */
export function buildAgentISWContext(articles: ISWArticle[]): string {
  if (!articles || articles.length === 0) return '';

  return [
    `### INSTITUTE FOR THE STUDY OF WAR (ISW) RESEARCH DOSSIERS (/intel/sources/isw_research/):`,
    `Grounded open-source conflict research from understandingwar.org/research/. Use these operational findings to correlate tactical positions, frontline updates, and strategic regional threats:`,
    '',
    ...articles.map((art, idx) => {
      const cleanDigest = art.content
        .replace(/^(?:#\s+[^\n]+\n+)?(?:\*\*[^*\n]+:\*\*[^\n]*\n+)+(?:---\n+)?/, '')
        .trim()
        .slice(0, 1200);
      return [
        `[ISW RESEARCH DOSSIER #${idx + 1}: ${art.title}]`,
        `• Source URL: ${art.url}`,
        `• Strategic Theater: ${art.theater.toUpperCase()} | Coordinates: ${art.coordinates.lat.toFixed(4)}, ${art.coordinates.lon.toFixed(4)}`,
        `• Summary: ${art.summary}`,
        art.keyTakeaways.length > 0
          ? `• Key Takeaways:\n${art.keyTakeaways.slice(0, 4).map((t) => `  - ${t}`).join('\n')}`
          : '',
        `• Content Digest:\n${cleanDigest}...`,
        '',
      ]
        .filter(Boolean)
        .join('\n');
    }),
  ].join('\n');
}

/**
 * Automatic startup ISW HTML scraping is intentionally disabled (Slice 2 Pre-Media Directive).
 * ISW briefings remain strictly on-demand via explicit CLI / tool / playbook invocation.
 */
export function initISWFeedIngestion(): void {
  hasISWInitialized = true;
}
