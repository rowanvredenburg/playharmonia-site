// Harmonia — Android closed-beta signup API
//
// POST /signup  { email, device?, android_version?, turnstileToken }
//   -> validates email, verifies Cloudflare Turnstile, inserts into D1.
// GET  /        -> health check.
//
// Bindings (see wrangler.toml):
//   env.DB                D1 database (harmonia-beta)
//   env.TURNSTILE_SECRET  Turnstile secret key (wrangler secret)

// Origins allowed to call this API from the browser.
const ALLOWED_ORIGINS = new Set([
  "https://playharmonia.app",
  "https://www.playharmonia.app",
]);
// Any localhost port (the local static-preview port is dynamic).
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin) || LOCALHOST_RE.test(origin);
}

// Basic, permissive email shape check. Real validation is "does Google
// accept it as a tester" — we only guard against obvious junk here.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin) {
  const allow = isAllowedOrigin(origin) ? origin : "https://playharmonia.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function verifyTurnstile(token, secret, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form }
    );
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "harmonia-beta-api" }, 200, origin);
    }

    // "Get the full game" from the web daily (daily.playharmonia.app/download):
    // route to the right destination by User-Agent. iOS-first launch, so Android
    // goes to the closed-beta signup rather than a Play Store listing.
    if (request.method === "GET" && url.pathname === "/download") {
      const ua = request.headers.get("User-Agent") || "";
      const src = url.searchParams.get("src");
      let dest;
      if (/android/i.test(ua)) {
        dest = "https://playharmonia.app/beta/";
      } else if (/iphone|ipad|ipod/i.test(ua)) {
        dest = "https://apps.apple.com/app/id6787542089";
      } else {
        dest = "https://playharmonia.app/download/";
      }
      // Forward the click source to our own pages (not to the App Store).
      if (src && dest.startsWith("https://playharmonia.app")) {
        dest += "?src=" + encodeURIComponent(src);
      }
      return Response.redirect(dest, 302);
    }

    if (request.method !== "POST" || url.pathname !== "/signup") {
      return json({ ok: false, error: "not_found" }, 404, origin);
    }

    // Parse body.
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "bad_json" }, 400, origin);
    }

    const email = String(payload.email || "").trim().toLowerCase();
    const device = String(payload.device || "").trim().slice(0, 120) || null;
    const androidVersion =
      String(payload.android_version || "").trim().slice(0, 60) || null;
    const token = payload.turnstileToken;

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return json({ ok: false, error: "invalid_email" }, 400, origin);
    }

    // Spam gate.
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const human = await verifyTurnstile(token, env.TURNSTILE_SECRET, ip);
    if (!human) {
      return json({ ok: false, error: "turnstile_failed" }, 403, origin);
    }

    // Insert. Duplicate emails are silently ignored so a re-submit still
    // reports success to the user.
    const ua = request.headers.get("User-Agent") || null;
    try {
      await env.DB.prepare(
        `INSERT INTO beta_signups (email, device, android_version, user_agent)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO NOTHING`
      )
        .bind(email, device, androidVersion, ua)
        .run();
    } catch (err) {
      return json({ ok: false, error: "db_error" }, 500, origin);
    }

    return json({ ok: true }, 200, origin);
  },
};
