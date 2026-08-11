/**
 * Channel 42 — LucidDreamer.AI Feedback Worker
 *
 * Receives listener feedback from the web player,
 * stores in KV namespace FEEDBACK_KV.
 *
 * POST /api/feedback  → { feedback, track, timestamp }
 * GET  /api/feedback  → recent feedback (admin/debug)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ---- POST: submit feedback ----
    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const { feedback, track, trackId } = body;

      if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
        return new Response(JSON.stringify({ error: 'Feedback is required' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (feedback.length > 500) {
        return new Response(JSON.stringify({ error: 'Feedback too long (max 500 chars)' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const timestamp = body.timestamp || new Date().toISOString();
      const key = `fb:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

      const record = {
        feedback: feedback.trim(),
        track: track || 'Unknown',
        trackId: trackId || null,
        timestamp,
        ip: request.headers.get('CF-Connecting-IP') || null,
        country: request.cf?.country || null,
      };

      try {
        await env.FEEDBACK_KV.put(key, JSON.stringify(record), {
          expirationTtl: 60 * 60 * 24 * 30, // 30 days
        });

        return new Response(JSON.stringify({ ok: true, message: 'Feedback received' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('KV write failed:', err);
        return new Response(JSON.stringify({ error: 'Storage unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ---- GET: recent feedback (debug/admin) ----
    if (request.method === 'GET' && url.pathname === '/api/feedback') {
      const prefix = url.searchParams.get('prefix') || 'fb:';

      try {
        const list = await env.FEEDBACK_KV.list({ prefix, limit: 50 });
        const entries = [];

        for (const key of list.keys) {
          const value = await env.FEEDBACK_KV.get(key.name);
          if (value) {
            try {
              entries.push(JSON.parse(value));
            } catch { /* skip malformed */ }
          }
        }

        // Sort newest first
        entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return new Response(JSON.stringify({ count: entries.length, entries }, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        console.error('KV read failed:', err);
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
