/**
 * Channel 42 — LucidDreamer.AI Now-Playing Worker
 *
 * Returns the current track info as JSON.
 * Reads from KV (updated by the scheduler/fleet).
 *
 * GET /api/now-playing → { trackId, title, model, mood, description,
 *                           durationSeconds, elapsedSeconds, upNext[], listenerCount }
 * PUT /api/now-playing → update now-playing (called by scheduler, protected by API key)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ---- GET: current now-playing ----
    if (request.method === 'GET') {
      try {
        const raw = await env.NOW_PLAYING_KV.get('now-playing');
        const scheduleRaw = await env.NOW_PLAYING_KV.get('schedule');

        let nowPlaying = null;
        let upNext = [];

        if (raw) {
          try {
            nowPlaying = JSON.parse(raw);
          } catch { /* malformed */ }
        }

        if (scheduleRaw) {
          try {
            const schedule = JSON.parse(scheduleRaw);
            const now = Date.now();

            // Filter to upcoming tracks
            upNext = schedule
              .filter(item => new Date(item.scheduledAt).getTime() > now)
              .slice(0, 5);

            // Calculate elapsed time for current track
            if (nowPlaying && nowPlaying.startedAt) {
              const startTime = new Date(nowPlaying.startedAt).getTime();
              const elapsed = Math.max(0, (now - startTime) / 1000);
              nowPlaying.elapsedSeconds = Math.round(elapsed);

              // If track has ended and there's a next track, advance
              if (nowPlaying.durationSeconds && elapsed > nowPlaying.durationSeconds) {
                const nextTrack = schedule.find(item =>
                  new Date(item.scheduledAt).getTime() > startTime
                );
                if (nextTrack) {
                  nowPlaying = {
                    ...nextTrack,
                    elapsedSeconds: Math.round((now - new Date(nextTrack.scheduledAt).getTime()) / 1000),
                  };
                  // Update KV for subsequent reads
                  await env.NOW_PLAYING_KV.put('now-playing', JSON.stringify(nowPlaying));
                }
              }
            }
          } catch { /* malformed schedule */ }
        }

        // Fallback if nothing is loaded yet
        if (!nowPlaying) {
          nowPlaying = {
            trackId: 'ch42-bootstrap',
            title: 'Channel 42 is warming up…',
            model: 'Fleet',
            mood: 'Ambient',
            description: 'The AI fleet is initializing. Dreamscapes will begin shortly.',
            durationSeconds: 0,
            elapsedSeconds: 0,
            upNext: upNext,
            listenerCount: await env.NOW_PLAYING_KV.get('listener-count') || null,
          };
        } else {
          nowPlaying.upNext = upNext;
          nowPlaying.listenerCount = await env.NOW_PLAYING_KV.get('listener-count') || null;
        }

        return new Response(JSON.stringify(nowPlaying), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...corsHeaders,
          },
        });
      } catch (err) {
        console.error('Now-playing read failed:', err);
        return new Response(JSON.stringify({ error: 'Service unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ---- PUT: update now-playing (scheduler only) ----
    if (request.method === 'PUT') {
      // API key auth
      const apiKey = request.headers.get('X-API-Key');
      const expectedKey = env.SCHEDULER_API_KEY;

      if (!expectedKey || apiKey !== expectedKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      try {
        const key = body.key || 'now-playing';
        await env.NOW_PLAYING_KV.put(key, JSON.stringify(body.data || body));

        return new Response(JSON.stringify({ ok: true, key }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('Now-playing write failed:', err);
        return new Response(JSON.stringify({ error: 'Storage unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ---- 404 ----
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};
