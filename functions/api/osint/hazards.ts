/**
 * Cloudflare Pages Function: OSINT Global Hazards & Seismic Telemetry (USGS & GDACS)
 * Route: /api/osint/hazards
 * 
 * Provides zero-friction, keyless telemetry querying:
 * 1. USGS Real-Time Earthquake GeoJSON feeds (all magnitudes, M4.5+, significant events)
 * 2. GDACS (Global Disaster Alert and Coordination System) multi-hazard alerts
 *    (tsunamis, tropical cyclones, volcanic eruptions, floods, earthquakes)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  let minMagnitude = 2.5;
  let timespan = 'day'; // 'hour' | 'day' | 'week' | 'month'
  let queryCountry = '';
  let limit = 15;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    if (url.searchParams.get('min_magnitude')) {
      minMagnitude = Number(url.searchParams.get('min_magnitude')) || 2.5;
    }
    timespan = url.searchParams.get('timespan') || 'day';
    queryCountry = (url.searchParams.get('country') || url.searchParams.get('region') || url.searchParams.get('q') || '').toLowerCase().trim();
    limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 15));
  } else if (request.method === 'POST') {
    try {
      const body: any = await request.json();
      if (body.min_magnitude !== undefined || body.minMagnitude !== undefined) {
        minMagnitude = Number(body.min_magnitude || body.minMagnitude) || 2.5;
      }
      timespan = body.timespan || 'day';
      queryCountry = (body.country || body.region || body.q || body.query || '').toLowerCase().trim();
      limit = Math.min(50, Math.max(1, Number(body.limit) || 15));
    } catch {}
  }

  try {
    // 1. Fetch live USGS feed
    let usgsFeedUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
    if (timespan === 'hour') {
      usgsFeedUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson';
    } else if (minMagnitude >= 4.5 && timespan === 'day') {
      usgsFeedUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';
    } else if (timespan === 'week') {
      usgsFeedUrl = minMagnitude >= 4.5
        ? 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson'
        : 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';
    } else if (timespan === 'month') {
      usgsFeedUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson';
    }

    const usgsRes = await fetch(usgsFeedUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'PixelOps-OSINT-Agent/1.0' },
    });

    let rawEvents: any[] = [];
    if (usgsRes.ok) {
      const data: any = await usgsRes.json();
      rawEvents = Array.isArray(data?.features) ? data.features : [];
    }

    // Filter by minMagnitude and optional region query
    let filteredEvents = rawEvents
      .filter((ev: any) => {
        const mag = ev.properties?.mag || 0;
        if (mag < minMagnitude) return false;
        if (queryCountry) {
          const place = (ev.properties?.place || '').toLowerCase();
          return place.includes(queryCountry);
        }
        return true;
      })
      .slice(0, limit);

    const formattedEvents = filteredEvents.map((ev: any) => {
      const p = ev.properties || {};
      const coords = ev.geometry?.coordinates || [0, 0, 0];
      return {
        id: ev.id,
        title: p.title,
        magnitude: p.mag,
        magnitudeType: p.magType,
        location: p.place,
        coordinates: {
          longitude: coords[0],
          latitude: coords[1],
          depthKm: coords[2],
        },
        time: new Date(p.time).toISOString(),
        updated: new Date(p.updated).toISOString(),
        tsunamiWarning: Boolean(p.tsunami),
        alertLevel: p.alert || 'green', // 'green' | 'yellow' | 'orange' | 'red'
        status: p.status,
        feltReports: p.felt || 0,
        significance: p.sig,
        usgsUrl: p.url,
      };
    });

    // 2. Fetch live GDACS disaster alert signals
    let gdacsAlerts: any[] = [];
    try {
      const gdacsRes = await fetch('https://www.gdacs.org/xml/rss.xml', {
        headers: { Accept: 'application/xml, text/xml', 'User-Agent': 'PixelOps-OSINT-Agent/1.0' },
      });
      if (gdacsRes.ok) {
        const text = await gdacsRes.text();
        const itemMatches = text.match(/<item>[\s\S]*?<\/item>/gi) || [];
        for (const item of itemMatches.slice(0, 10)) {
          const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')?.trim() || '';
          const desc = item.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')?.trim() || '';
          const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() || '';
          const alertLevel = item.match(/<gdacs:alertlevel>([\s\S]*?)<\/gdacs:alertlevel>/i)?.[1]?.trim() || 'Green';
          const eventType = item.match(/<gdacs:eventtype>([\s\S]*?)<\/gdacs:eventtype>/i)?.[1]?.trim() || 'Disaster Alert';
          const country = item.match(/<gdacs:country>([\s\S]*?)<\/gdacs:country>/i)?.[1]?.trim() || '';

          if (title) {
            gdacsAlerts.push({
              title,
              description: desc.slice(0, 240),
              eventType,
              alertLevel,
              country,
              date: pubDate,
            });
          }
        }
      }
    } catch (gdacsErr) {
      console.warn('[OSINT Hazards] GDACS RSS parse warning:', gdacsErr);
    }

    const maxRecorded = formattedEvents.length > 0
      ? Math.max(...formattedEvents.map((e) => e.magnitude || 0))
      : 0;

    const tsunamiEvents = formattedEvents.filter((e) => e.tsunamiWarning);

    return new Response(
      JSON.stringify({
        status: 'ok',
        summary: {
          totalEventsFound: formattedEvents.length,
          minMagnitudeThreshold: minMagnitude,
          timespan,
          maxRecordedMagnitude: maxRecorded,
          tsunamiAlertCount: tsunamiEvents.length,
          activeGdacsDisasters: gdacsAlerts.length,
          tacticalThreatAssessment: maxRecorded >= 6.5 || tsunamiEvents.length > 0
            ? 'CRITICAL_SEISMIC_ALERT'
            : maxRecorded >= 5.0
            ? 'MODERATE_INFRASTRUCTURE_RISK'
            : 'NOMINAL_BASELINE',
        },
        tsunamiAlerts: tsunamiEvents,
        seismicEvents: formattedEvents,
        gdacsDisasters: gdacsAlerts,
        dataFeeds: [
          'USGS Earthquake Hazards Program (Real-time GeoJSON Feed)',
          'Global Disaster Alert and Coordination System (GDACS Multi-Hazard RSS)',
        ],
        queriedAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=120',
          ...CORS_HEADERS,
        },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        status: 'error',
        error: 'HAZARDS_QUERY_ERROR',
        message: err?.message || 'Failed to query global seismic & disaster telemetry.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
