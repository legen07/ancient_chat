/**
 * Server-rendered settings page for the Telegram webhook.
 *
 * The page is a plain HTML string so it works with `wrangler dev`,
 * `standalone-run.js` and the Vitest Workers pool without any module
 * rules or bundler configuration.
 */

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatTimestamp = (epochSeconds) => {
  if (!epochSeconds) return "";
  const date = new Date(epochSeconds * 1000);
  return date.toISOString().slice(0, 19).replace("T", " ") + " UTC";
};

/**
 * @param {object} options
 * @param {string} options.suggestedUrl  Webhook URL of this Worker (origin + /api/webhook/).
 * @param {string} [options.currentUrl]  Webhook currently registered with Telegram.
 * @param {object|null} options.info     Telegram getWebhookInfo result (or null when unavailable).
 * @param {string} [options.infoError]   Why the current status could not be read.
 * @param {{kind: "success"|"error"|"info", text: string}|null} [options.banner]
 */
export function renderWebhookSettingsPage({
  suggestedUrl,
  currentUrl = "",
  info = null,
  infoError = "",
  banner = null,
}) {
  const safeSuggested = escapeHtml(suggestedUrl);
  const inputValue = escapeHtml(currentUrl || suggestedUrl);

  const bannerHtml = banner
    ? `<div class="banner ${escapeHtml(banner.kind)}" role="status">${escapeHtml(banner.text)}</div>`
    : "";

  let statusHtml;
  if (infoError) {
    statusHtml = `<p class="muted">Current status unavailable: ${escapeHtml(infoError)}</p>`;
  } else if (!info) {
    statusHtml = `<p class="muted">No status yet.</p>`;
  } else if (!info.url) {
    statusHtml = `<p class="muted">No webhook is set on this bot yet.</p>`;
  } else {
    const lastError = info.last_error_message
      ? `<p><span class="label">Last error</span> ${escapeHtml(info.last_error_message)}
           <span class="muted">${escapeHtml(formatTimestamp(info.last_error_date))}</span></p>`
      : `<p><span class="label">Last error</span> <span class="muted">none reported</span></p>`;

    statusHtml = `
      <p><span class="label">URL</span> <code>${escapeHtml(info.url)}</code></p>
      <p><span class="label">Pending updates</span> ${escapeHtml(info.pending_update_count ?? 0)}</p>
      ${lastError}
      <p><span class="label">Last check</span> <span class="muted">${escapeHtml(formatTimestamp(info.last_check_date))}</span></p>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ancient Chat · Webhook settings</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b1020;
    --panel: #141b31;
    --panel-2: #1b2440;
    --text: #e8ecf7;
    --muted: #94a0bd;
    --accent: #4f8cff;
    --ok: #2fbf71;
    --bad: #ff5d73;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(1200px 600px at 80% -10%, #1c2a55 0%, var(--bg) 55%);
    color: var(--text);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 720px; margin: 0 auto; padding: 40px 20px 64px; }
  h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: -0.02em; }
  h2 { margin: 0 0 14px; font-size: 17px; }
  .sub { margin: 0 0 24px; color: var(--muted); }
  .card {
    background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
    border: 1px solid #26314f;
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 18px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  }
  .banner {
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 18px;
    border: 1px solid transparent;
    font-size: 15px;
  }
  .banner.success { background: rgba(47, 191, 113, 0.12); border-color: rgba(47, 191, 113, 0.5); }
  .banner.error { background: rgba(255, 93, 115, 0.12); border-color: rgba(255, 93, 115, 0.5); }
  .banner.info { background: rgba(79, 140, 255, 0.12); border-color: rgba(79, 140, 255, 0.5); }
  p { margin: 8px 0; }
  code {
    background: #0d1426;
    border: 1px solid #26314f;
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 14px;
    word-break: break-all;
  }
  .label { display: inline-block; min-width: 130px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; }
  .muted { color: var(--muted); }
  label { display: block; font-size: 14px; color: var(--muted); margin-bottom: 8px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  input[type="url"] {
    flex: 1 1 320px;
    min-width: 0;
    background: #0d1426;
    border: 1px solid #2b3860;
    border-radius: 10px;
    color: var(--text);
    padding: 12px 14px;
    font-size: 15px;
  }
  input[type="url"]:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  button {
    border: 0;
    border-radius: 10px;
    padding: 12px 18px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    background: var(--accent);
    color: #fff;
  }
  button:hover { filter: brightness(1.08); }
  button.ghost { background: #26314f; color: var(--text); }
  button.danger { background: rgba(255, 93, 115, 0.16); color: var(--bad); border: 1px solid rgba(255, 93, 115, 0.5); }
  .hint { font-size: 13px; color: var(--muted); margin-top: 10px; }
  .actions { margin-top: 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .actions form { margin: 0; }
</style>
</head>
<body>
<main>
  <h1>Webhook settings</h1>
  <p class="sub">Point Telegram at the URL that should receive bot updates.</p>

  ${bannerHtml}

  <section class="card">
    <h2>Current webhook</h2>
    ${statusHtml}
  </section>

  <section class="card">
    <h2>Set a new webhook URL</h2>
    <form method="POST" action="/api/setWebhook">
      <label for="webhook-url">New webhook URL</label>
      <div class="row">
        <input
          type="url"
          id="webhook-url"
          name="url"
          required
          autocomplete="off"
          spellcheck="false"
          placeholder="{https://example.com/api/webhook/}"
          value="${inputValue}"
        >
        <button type="submit">Save webhook</button>
      </div>
      <p class="hint">
        Must be an <code>https://</code> endpoint that answers <code>200 OK</code>.
        This worker's own endpoint is <code>${safeSuggested}</code>.
      </p>
    </form>

    <div class="actions">
      <button type="button" class="ghost" data-fill="${safeSuggested}" id="use-worker">Use this worker's endpoint</button>
      <form method="POST" action="/api/deleteWebhook/" onsubmit="return confirm('Remove the webhook from Telegram?');">
        <button type="submit" class="danger">Delete webhook</button>
      </form>
    </div>
  </section>
</main>
<script>
  (function () {
    var fillButton = document.getElementById("use-worker");
    var input = document.getElementById("webhook-url");
    if (fillButton && input) {
      fillButton.addEventListener("click", function () {
        input.value = fillButton.getAttribute("data-fill");
        input.focus();
      });
    }
  })();
</script>
</body>
</html>`;
}
