/**
 * Cloudflare Pages Function: Headless Classified Intel Ingestion
 * Route: /api/intel/classified-feed
 * 
 * Silently ingests the hardcoded S2 Underground RSS XML feed:
 * https://www.youtube.com/feeds/videos.xml?channel_id=UCTq1zHztiV69Ur8t6jco4CQ
 * Parses entries, extracts transcripts / executive summaries, and returns structured
 * telemetry objects for storage into local VFS at /intel/sources/classified_feed/.
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

interface FeedEntry {
  videoId: string;
  title: string;
  link: string;
  published: string;
  description: string;
  threatTags: string[];
  summary: string;
  transcript: string;
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
    const entries: FeedEntry[] = [];

    // Parse each entry in the Atom feed
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

      // Generate a structured executive summary from the briefing notes
      const cleanDescLines = rawDescription
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('http://') && !l.startsWith('https://') && !l.includes('Patreon') && !l.includes('Disclaimer'));

      const summary = cleanDescLines.slice(0, 8).join('\n') || `Tactical situation report and open-source intelligence analysis for ${title}.`;

      entries.push({
        videoId,
        title,
        link,
        published,
        description: rawDescription,
        threatTags: tags,
        summary,
        transcript: rawDescription,
      });

      if (entries.length >= 10) break;
    }

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
