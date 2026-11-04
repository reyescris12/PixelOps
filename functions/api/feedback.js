/**
 * Cloudflare Pages Function: /api/feedback
 * Handles feedback submissions from the PixelOps retro terminal.
 * Persists feedback records to Cloudflare D1 database (table: feedback)
 * and dispatches/forwards notifications to support@pixelops.app.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-username, x-device-id, x-resend-api-key',
};

const RESEND_TARGET_EMAIL = 'support@pixelops.app';
const SUPPORT_EMAIL = 'support@pixelops.app';

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

/**
 * Dispatches an email notification to Resend inbox using available credentials
 */
async function dispatchEmailNotification(env, { id, category, callsign, email, message, createdAt, payloadApiKey }) {
  const formattedDate = new Date(createdAt).toUTCString();
  const subject = '⚡ New Commander Feedback Transmission';
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
Target Inbox: ${SUPPORT_EMAIL}
Logged to Cloudflare D1 database: pixelops-db (table: feedback)
`.trim();

  // 1. Resend API Integration (Checks Request Payload, Header, or Cloudflare Environment Secret)
  const resendApiKey =
    (payloadApiKey && typeof payloadApiKey === 'string' && payloadApiKey.trim()) ||
    env?.RESEND_API_KEY ||
    (typeof process !== 'undefined' ? process.env?.RESEND_API_KEY : null);

  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'PixelOps Terminal <support@pixelops.app>',
          to: ['support@pixelops.app'],
          subject: '⚡ New Commander Feedback Transmission',
          text: `Incoming feedback from PWA terminal:\n\n${message}`,
          reply_to: email && email.includes('@') ? email.trim() : undefined,
        }),
      });

      const resData = await res.json().catch(() => ({}));

      if (res.ok) {
        return {
          success: true,
          provider: 'resend',
          id: resData.id,
          target: SUPPORT_EMAIL,
        };
      } else {
        const errorText = resData.message || resData.name || `Resend HTTP ${res.status}`;
        console.error('[FEEDBACK RESEND REJECTED]', res.status, resData);
        return {
          success: false,
          provider: 'resend',
          status: res.status,
          error: errorText,
          details: resData,
        };
      }
    } catch (err) {
      console.warn('[FEEDBACK EMAIL ERROR: RESEND]', err?.message || err);
      return {
        success: false,
        provider: 'resend',
        error: `Resend request failed: ${err?.message || 'Network failure'}`,
      };
    }
  }

  // 2. SendGrid API Integration (Fallback)
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
          personalizations: [{ to: [{ email: RESEND_TARGET_EMAIL }] }],
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
          `To: ${RESEND_TARGET_EMAIL}`,
          `Subject: ${subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          textContent,
        ].join('\r\n');
        const emailMsg = new EmailMessage('feedback-relay@pixelops.app', RESEND_TARGET_EMAIL, rawMime);
        await emailBinding.send(emailMsg);
      } else {
        await emailBinding.send({
          from: 'feedback-relay@pixelops.app',
          to: RESEND_TARGET_EMAIL,
          subject,
          text: textContent,
        });
      }
      return { success: true, provider: 'cloudflare_email_binding' };
    } catch (err) {
      console.warn('[FEEDBACK EMAIL ERROR: CF BINDING]', err?.message || err);
    }
  }

  return {
    success: false,
    reason: 'RESEND_API_KEY_MISSING',
    error: 'RESEND_API_KEY is not configured in Cloudflare Pages environment or Terminal settings.',
  };
}

export const onRequest = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  // GET /api/feedback - health check, table stats, and Resend configuration status
  if (request.method === 'GET') {
    const d1 = env?.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
    const resendApiKey = env?.RESEND_API_KEY || (typeof process !== 'undefined' ? process.env?.RESEND_API_KEY : null);
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
        targetEmail: RESEND_TARGET_EMAIL,
        supportEmail: SUPPORT_EMAIL,
        resendConfigured: Boolean(resendApiKey),
        databaseConnected: Boolean(d1),
        recordsCount: count,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  // POST /api/feedback - log feedback to D1 and dispatch to Resend
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
      const payloadApiKey = (request.headers.get('x-resend-api-key') || payload.resendApiKey || '').trim();

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

      // 2. Dispatch / Forward to Resend inbox address
      const emailResult = await dispatchEmailNotification(env, {
        id,
        category,
        callsign,
        email,
        message: rawMessage,
        createdAt,
        payloadApiKey,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          id,
          message: emailResult.success
            ? 'Feedback securely logged to Cloudflare D1 and delivered to Resend inbox.'
            : `Feedback logged to Cloudflare D1. Note on email dispatch: ${emailResult.error || emailResult.reason}`,
          d1Saved,
          emailDispatched: emailResult.success,
          emailError: emailResult.error || null,
          resendId: emailResult.id || null,
          dispatchProvider: emailResult.provider || null,
          targetEmail: RESEND_TARGET_EMAIL,
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
