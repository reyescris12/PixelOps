/**
 * Cloudflare Pages Function: /api/feedback
 * Handles feedback submissions from the PixelOps retro terminal.
 * Persists feedback records to Cloudflare D1 database (table: feedback)
 * and dispatches/forwards notifications to support@pixelops.app.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-username, x-device-id',
};

const SUPPORT_EMAIL = 'support@pixelops.app';

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

/**
 * Dispatches an email notification to support@pixelops.app using available provider bindings
 */
async function dispatchEmailNotification(env, { id, category, callsign, email, message, createdAt }) {
  const formattedDate = new Date(createdAt).toUTCString();
  const subject = `[PixelOps Feedback] ${category || 'Field Intel'} from ${callsign || 'Operative'}`;
  const textContent = `
=====================================================
 PIXELOPS FIELD INTELLIGENCE // OPERATIVE FEEDBACK
=====================================================
ID:         ${id}
Timestamp:  ${formattedDate} (${createdAt})
Category:   ${category || 'GENERAL'}
Operative:  ${callsign || 'ANONYMOUS'}
Contact:    ${email || 'N/A'}

MESSAGE:
-----------------------------------------------------
${message}
-----------------------------------------------------
Logged to Cloudflare D1 database: pixelops-db (table: feedback)
`.trim();

  // 1. Resend API Integration
  const resendApiKey = env?.RESEND_API_KEY || (typeof process !== 'undefined' ? process.env?.RESEND_API_KEY : null);
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'PixelOps Feedback Terminal <onboarding@resend.dev>',
          to: [SUPPORT_EMAIL],
          subject,
          text: textContent,
          reply_to: email && email.includes('@') ? email.trim() : undefined,
        }),
      });
      if (res.ok) {
        return { success: true, provider: 'resend' };
      }
    } catch (err) {
      console.warn('[FEEDBACK EMAIL ERROR: RESEND]', err?.message || err);
    }
  }

  // 2. SendGrid API Integration
  const sendgridApiKey = env?.SENDGRID_API_KEY || (typeof process !== 'undefined' ? process.env?.SENDGRID_API_KEY : null);
  if (sendgridApiKey) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridApiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: SUPPORT_EMAIL }] }],
          from: { email: 'terminal@pixelops.app', name: 'PixelOps Feedback' },
          subject,
          content: [{ type: 'text/plain', value: textContent }],
        }),
      });
      if (res.ok || res.status === 202) {
        return { success: true, provider: 'sendgrid' };
      }
    } catch (err) {
      console.warn('[FEEDBACK EMAIL ERROR: SENDGRID]', err?.message || err);
    }
  }

  // 3. Cloudflare Email Routing Binding (env.SEND_EMAIL / env.EMAIL)
  const emailBinding = env?.SEND_EMAIL || env?.EMAIL;
  if (emailBinding && typeof emailBinding.send === 'function') {
    try {
      if (typeof EmailMessage !== 'undefined') {
        const rawMime = [
          `From: feedback-relay@pixelops.app`,
          `To: ${SUPPORT_EMAIL}`,
          `Subject: ${subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          textContent,
        ].join('\r\n');
        const emailMsg = new EmailMessage('feedback-relay@pixelops.app', SUPPORT_EMAIL, rawMime);
        await emailBinding.send(emailMsg);
      } else {
        await emailBinding.send({
          from: 'feedback-relay@pixelops.app',
          to: SUPPORT_EMAIL,
          subject,
          text: textContent,
        });
      }
      return { success: true, provider: 'cloudflare_email_binding' };
    } catch (err) {
      console.warn('[FEEDBACK EMAIL ERROR: CF BINDING]', err?.message || err);
    }
  }

  // 4. Mailchannels Free Transactional Relay for Cloudflare Workers
  try {
    const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: SUPPORT_EMAIL, name: 'PixelOps Support' }] }],
        from: { email: 'relay@pixelops.app', name: 'PixelOps Terminal Relay' },
        subject,
        content: [{ type: 'text/plain', value: textContent }],
      }),
    });
    if (res.ok || res.status === 202) {
      return { success: true, provider: 'mailchannels' };
    }
  } catch {
    // Mailchannels might restrict unverified domains in some regions
  }

  return { success: false, reason: 'NO_CONFIGURED_EMAIL_DISPATCHER' };
}

export const onRequest = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  // GET /api/feedback - health check and table stats
  if (request.method === 'GET') {
    const d1 = env?.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
    let count = 0;
    if (d1) {
      try {
        const row = await d1.prepare('SELECT COUNT(*) as count FROM feedback').first();
        count = row?.count || 0;
      } catch {
        // Table may not exist yet
      }
    }
    return new Response(
      JSON.stringify({
        ok: true,
        endpoint: '/api/feedback',
        targetEmail: SUPPORT_EMAIL,
        databaseConnected: Boolean(d1),
        recordsCount: count,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  // POST /api/feedback - log feedback to D1 and dispatch to support@pixelops.app
  if (request.method === 'POST') {
    try {
      const payload = await request.json().catch(() => ({}));
      const rawMessage = (payload.message || '').trim();

      if (!rawMessage) {
        return new Response(
          JSON.stringify({
            error: 'MESSAGE_REQUIRED',
            message: 'Feedback message cannot be empty.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }

      const id = payload.id || `fb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const createdAt = typeof payload.created_at === 'number' ? payload.created_at : Date.now();
      const category = (payload.category || 'GENERAL').toUpperCase();
      const callsign = (payload.callsign || payload.username || '').trim();
      const email = (payload.email || '').trim();

      // Assemble structured message content with metadata header
      const formattedMessage = (category || callsign || email)
        ? `[CATEGORY: ${category}]${callsign ? ` [OPERATIVE: ${callsign}]` : ''}${email ? ` [CONTACT: ${email}]` : ''}\n\n${rawMessage}`
        : rawMessage;

      // 1. Persist to Cloudflare D1 database (feedback table)
      const d1 = env?.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
      let d1Saved = false;

      if (d1) {
        try {
          await d1.prepare(`
            INSERT INTO feedback (id, message, created_at)
            VALUES (?, ?, ?)
          `).bind(id, formattedMessage, createdAt).run();
          d1Saved = true;
        } catch {
          // If table does not exist, auto-migrate and retry
          try {
            await d1.prepare(`
              CREATE TABLE IF NOT EXISTS feedback (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                created_at INTEGER NOT NULL
              )
            `).run();
            await d1.prepare(`
              INSERT INTO feedback (id, message, created_at)
              VALUES (?, ?, ?)
            `).bind(id, formattedMessage, createdAt).run();
            d1Saved = true;
          } catch (d1Err) {
            console.error('[D1 FEEDBACK WRITE ERROR]', d1Err?.message || d1Err);
          }
        }
      }

      // 2. Dispatch / Forward to support@pixelops.app
      const emailResult = await dispatchEmailNotification(env, {
        id,
        category,
        callsign,
        email,
        message: rawMessage,
        createdAt,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          id,
          message: 'Feedback securely logged to Cloudflare D1 and relayed to support@pixelops.app',
          d1Saved,
          emailDispatched: emailResult.success,
          dispatchProvider: emailResult.provider || null,
          targetEmail: SUPPORT_EMAIL,
          created_at: createdAt,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: 'FEEDBACK_ERROR',
          message: err?.message || 'Server error processing feedback.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: 'Use POST /api/feedback' }),
    { status: 405, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
};
