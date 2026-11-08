/**
 * Cloudflare Pages Function: Headless Classified Intel Ingestion (S2 Underground Wire Text Parser)
 * Route: /api/intel/classified-feed
 * 
 * Pulls clean text dispatches from S2 Underground's Buzzsprout feed:
 * https://feeds.buzzsprout.com/868255.rss
 * (formatted with clear military SITREP headers like //The Wire//, //BLUF://, and //END REPORT//)
 * Strips HTML/CDATA tags and formats them into agent-ready SITREP context blocks.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const S2_WIRE_FEED_URL = 'https://feeds.buzzsprout.com/868255.rss';

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export interface S2WireDispatch {
  title: string;
  content: string;
  timestamp: string;
  link?: string;
  fileName?: string;
  threatTags?: string[];
  summary?: string;
}

/**
 * Pulls clean text dispatches from https://feeds.buzzsprout.com/868255.rss
 * and strips CDATA/HTML tags so agents receive pure SITREP text.
 */
export async function fetchS2WireFeed(): Promise<S2WireDispatch[]> {
  try {
    const response = await fetch(S2_WIRE_FEED_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 PixelOps-Intelligence/2.0',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!response.ok) {
      throw new Error(`Upstream S2 Wire RSS fetch failed with status ${response.status}`);
    }

    const xmlText = await response.text();
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const dispatches: S2WireDispatch[] = [];
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xmlText)) !== null && dispatches.length < 5) {
      const itemContent = match[1];
      const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
      const descMatch =
        itemContent.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) ||
        itemContent.match(/<description>([\s\S]*?)<\/description>/);
      const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const linkMatch =
        itemContent.match(/<link>([\s\S]*?)<\/link>/) ||
        itemContent.match(/<enclosure[^>]+url="([^"]+)"/);

      if (titleMatch && descMatch) {
        // Strip HTML entities and tags to leave clean SITREP text
        const cleanDesc = descMatch[1]
          // Remove CDATA tags if present
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          // Convert block-level/line-break HTML tags to newlines before stripping tags
          .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, '\n')
          // Strip standard HTML tags
          .replace(/<\/?[^>]+(>|$)/g, '')
          // Clean up HTML entities
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&apos;/g, "'")
          .replace(/&nbsp;/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        const cleanTitle = titleMatch[1]
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          .replace(/<\/?[^>]+(>|$)/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();

        let timestamp = new Date().toISOString();
        if (pubDateMatch && pubDateMatch[1]) {
          const parsedDate = new Date(pubDateMatch[1].trim());
          if (!isNaN(parsedDate.getTime())) {
            timestamp = parsedDate.toISOString();
          }
        }

        const datePart = timestamp.slice(0, 10);
        const titleSlug = cleanTitle
          .toLowerCase()
          .replace(/[^a-z0-9\s_-]/g, ' ')
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 1)
          .slice(0, 7)
          .join('_');

        const fileName = `${datePart}_s2_wire_${titleSlug || 'sitrep_dispatch'}.md`;

        // Extract threat domain tags
        const lower = `${cleanTitle} ${cleanDesc}`.toLowerCase();
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

        const blufMatch = cleanDesc.match(/(?:\/\/BLUF:\/\/|BLUF:)\s*([\s\S]*?)(?:\n\n|\/\/|$)/i);
        const summary = blufMatch
          ? blufMatch[1].trim().slice(0, 420)
          : cleanDesc.slice(0, 400);

        dispatches.push({
          title: cleanTitle,
          content: cleanDesc,
          timestamp,
          link: linkMatch ? linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : S2_WIRE_FEED_URL,
          fileName,
          threatTags: tags,
          summary,
        });
      }
    }

    return dispatches;
  } catch (error) {
    console.error('[PixelOps Intel Error] Failed to parse S2 Wire feed:', error);
    return [];
  }
}

/**
 * Formats raw dispatches into a structured prompt context block for Agent Vance or Nyx
 */
export function buildAgentSITREPContext(dispatches: S2WireDispatch[]): string {
  if (!dispatches || !dispatches.length) return 'No active intelligence dispatches available.';

  return dispatches
    .map(
      (dispatch, index) => `
[INTEL REPORT 0${index + 1}]
TITLE: ${dispatch.title}
TIMESTAMP: ${dispatch.timestamp}
CONTENT:
${dispatch.content}
----------------------------------------
  `
    )
    .join('\n');
}

export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  try {
    const dispatches = await fetchS2WireFeed();
    const sitrepContext = buildAgentSITREPContext(dispatches);

    // Map to `entries` as well for seamless compatibility with VFS archiver
    const entries = dispatches.map((d, idx) => ({
      id: `s2_wire_${idx + 1}_${d.timestamp.slice(0, 10)}`,
      title: d.title,
      cleanTitle: d.title,
      fileName: d.fileName,
      link: d.link || S2_WIRE_FEED_URL,
      published: d.timestamp,
      timestamp: d.timestamp,
      content: d.content,
      description: d.summary || d.content.slice(0, 400),
      threatTags: d.threatTags || ['OSINT', 'S2_WIRE', 'SITREP'],
      summary: d.summary || d.content.slice(0, 400),
      transcript: d.content,
    }));

    return new Response(
      JSON.stringify({
        status: 'ok',
        source: 'S2 Underground Wire SITREP Dispatches',
        feedUrl: S2_WIRE_FEED_URL,
        count: dispatches.length,
        dispatches,
        sitrepContext,
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
        error: 'S2_WIRE_FEED_ERROR',
        message: err?.message || 'Failed to fetch S2 Wire text dispatches.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
