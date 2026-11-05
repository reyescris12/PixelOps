/**
 * Cloudflare Pages Function: Universal Web & Google Search Engine
 * Route: /api/search
 * 
 * Provides operatives unrestricted search access to Google News, Google Search,
 * DuckDuckGo, Hacker News, and Wikipedia without client-side CORS barriers.
 */

interface Env {
  GOOGLE_SEARCH_API_KEY?: string;
  GOOGLE_CSE_CX?: string;
  GEMINI_API_KEY?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-google-api-key, x-google-cx',
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  let query = '';
  let limit = 5;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    query = (url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
    limit = Math.min(10, Math.max(1, Number(url.searchParams.get('limit')) || 5));
  } else if (request.method === 'POST') {
    try {
      const body: any = await request.json();
      query = (body.q || body.query || '').trim();
      limit = Math.min(10, Math.max(1, Number(body.limit || body.maxResults) || 5));
    } catch {
      // Ignore
    }
  }

  if (!query) {
    return new Response(
      JSON.stringify({ error: 'MISSING_QUERY', message: 'A search query "q" or "query" parameter is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const results: Array<{
    title: string;
    snippet: string;
    extract: string;
    url: string;
    source: string;
    publishedAt?: string;
  }> = [];

  // 1. Google News Live RSS Feed (Real-time Google search index)
  try {
    const googleNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const gnRes = await fetch(googleNewsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PixelOps-Agent/2.0',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });

    if (gnRes.ok) {
      const xml = await gnRes.text();
      const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

      for (const itemXml of itemMatches.slice(0, 4)) {
        if (results.length >= limit) break;
        const rawTitle = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
        const cleanTitle = rawTitle
          .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .trim();

        const rawLink = itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
        const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
        const sourceName = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || 'Google News';

        const rawDesc = itemXml.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
        const cleanDesc = rawDesc
          .replace(/<[^>]+>/g, ' ')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();

        if (cleanTitle) {
          results.push({
            title: cleanTitle,
            snippet: cleanDesc ? cleanDesc.slice(0, 320) : `${cleanTitle} (${sourceName})`,
            extract: `Google News Real-Time Intelligence: "${cleanTitle}". Source: ${sourceName}. Published: ${pubDate}. URL: ${rawLink}`,
            url: rawLink || `https://news.google.com/search?q=${encodeURIComponent(cleanTitle)}`,
            source: 'Google News',
            publishedAt: pubDate,
          });
        }
      }
    }
  } catch {}

  // 2. Google Official Custom Search API (If credentials configured)
  const googleKey = request.headers.get('x-google-api-key') || env.GOOGLE_SEARCH_API_KEY || env.GEMINI_API_KEY;
  const googleCx = request.headers.get('x-google-cx') || env.GOOGLE_CSE_CX;
  if (googleKey && googleCx && results.length < limit) {
    try {
      const cseUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googleKey)}&cx=${encodeURIComponent(googleCx)}&q=${encodeURIComponent(query)}&num=4`;
      const cseRes = await fetch(cseUrl);
      if (cseRes.ok) {
        const cseData: any = await cseRes.json();
        for (const item of cseData.items || []) {
          if (results.length >= limit) break;
          results.push({
            title: item.title,
            snippet: item.snippet || item.title,
            extract: `Google Search: "${item.title}" - ${item.snippet}. URL: ${item.link}`,
            url: item.link,
            source: 'Google Search',
          });
        }
      }
    } catch {}
  }

  // 3. DuckDuckGo Instant Knowledge API
  if (results.length < limit) {
    try {
      const ddgRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
      );
      if (ddgRes.ok) {
        const ddgData: any = await ddgRes.json();
        if (ddgData.AbstractText && ddgData.AbstractText.length > 20) {
          results.push({
            title: ddgData.Heading || query,
            snippet: ddgData.AbstractText.slice(0, 350),
            extract: ddgData.AbstractText,
            url: ddgData.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
            source: 'DuckDuckGo',
          });
        }
        if (Array.isArray(ddgData.RelatedTopics)) {
          for (const topic of ddgData.RelatedTopics) {
            if (results.length >= limit) break;
            if (topic.Text && topic.FirstURL && !results.some((r) => r.url === topic.FirstURL)) {
              results.push({
                title: (topic.Text.split(' - ')[0] || topic.Text).slice(0, 60),
                snippet: topic.Text.slice(0, 320),
                extract: topic.Text,
                url: topic.FirstURL,
                source: 'DuckDuckGo Topics',
              });
            }
          }
        }
      }
    } catch {}
  }

  // 4. Algolia Hacker News Real-Time Index
  if (results.length < limit) {
    try {
      const hnRes = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=3`
      );
      if (hnRes.ok) {
        const hnData: any = await hnRes.json();
        for (const hit of hnData.hits || []) {
          if (results.length >= limit) break;
          const hitUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
          if (results.some((r) => r.url === hitUrl)) continue;
          results.push({
            title: hit.title,
            snippet: `${hit.title} (${hit.points || 0} pts, ${hit.num_comments || 0} comments, author: ${hit.author || 'author'}). URL: ${hit.url || hitUrl}`,
            extract: `Hacker News telemetry: "${hit.title}". Points: ${hit.points || 0}. URL: ${hitUrl}`,
            url: hitUrl,
            source: 'Hacker News',
          });
        }
      }
    } catch {}
  }

  // 5. Wikipedia Open Search API
  if (results.length < limit) {
    try {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&origin=*`
      );
      if (wikiRes.ok) {
        const wikiData: any = await wikiRes.json();
        for (const item of wikiData?.query?.search || []) {
          if (results.length >= limit) break;
          if (!item || !item.title) continue;
          const cleanSnippet = String(item.snippet || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&')
            .trim();
          const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`;
          if (results.some((r) => r.url === wikiUrl)) continue;
          results.push({
            title: `${item.title} (Encyclopedia)`,
            snippet: cleanSnippet.slice(0, 320),
            extract: `${item.title}: ${cleanSnippet}. Verified encyclopedia reference node.`,
            url: wikiUrl,
            source: 'Wikipedia',
          });
        }
      }
    } catch {}
  }

  // Always append direct Google Search portal reference if results are sparse
  if (results.length === 0) {
    results.push({
      title: `Google Search: "${query}"`,
      snippet: `Live Google Search portal query for "${query}". Access primary documentation, live indices, and global telemetry.`,
      extract: `Google Search query node for "${query}". Direct URL: https://www.google.com/search?q=${encodeURIComponent(query)}`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      source: 'Google Search Direct',
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      query,
      resultCount: results.length,
      results,
      googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      fetchedAt: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        ...CORS_HEADERS,
      },
    }
  );
};
