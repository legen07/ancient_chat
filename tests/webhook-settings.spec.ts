import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { validateWebhookUrl } from "../src/lib/telegram.js";

const env = { API_KEY: "123:test-token", GEN_KEY: "gen-key" };
const ctx = {};

const jsonResponse = (data) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** Stub Telegram: getWebhookInfo reports "no webhook", setWebhook answers `setWebhookReply`. */
function stubTelegram({ setWebhookReply = { ok: true, result: true } } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = String(typeof input === "string" ? input : input.url);
    const method = url.slice(url.lastIndexOf("/") + 1);
    calls.push({ method, body: init.body ? JSON.parse(init.body) : null });

    if (method === "getWebhookInfo") {
      return jsonResponse({
        ok: true,
        result: { url: "", pending_update_count: 0 },
      });
    }
    if (method === "setWebhook") return jsonResponse(setWebhookReply);
    if (method === "deleteWebhook") return jsonResponse({ ok: true, result: true });

    return jsonResponse({ ok: false, description: "unexpected method " + method });
  });
  return calls;
}

beforeEach(() => {
  stubTelegram();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webhook settings page", () => {
  it("renders an HTML page with a webhook URL input", async () => {
    const res = await worker.fetch(new Request("http://example.com/"), env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("<title>Ancient Chat · Webhook settings</title>");
    expect(html).toContain('name="url"');
    expect(html).toContain('action="/api/setWebhook"');
    expect(html).toContain("http://example.com/api/webhook/");
    expect(html).toContain("No webhook is set on this bot yet.");
  });

  it("is also served at /webhook-settings", async () => {
    const res = await worker.fetch(new Request("http://example.com/webhook-settings"), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="webhook-url"');
  });

  it("shows a success banner after a form post redirect", async () => {
    const res = await worker.fetch(
      new Request("http://example.com/?saved=https%3A%2F%2Fhooks.example%2Ftg"),
      env,
      ctx,
    );
    const html = await res.text();
    expect(html).toContain("Webhook updated to https://hooks.example/tg");
    expect(html).toContain('class="banner success"');
  });

  it("shows an error banner when Telegram rejected the URL", async () => {
    const res = await worker.fetch(
      new Request("http://example.com/?error=" + encodeURIComponent("Bad webhook: not found")),
      env,
      ctx,
    );
    const html = await res.text();
    expect(html).toContain('class="banner error"');
    expect(html).toContain("Bad webhook: not found");
  });
});

describe("POST /api/setWebhook", () => {
  it("sets a valid https URL and returns JSON", async () => {
    const calls = stubTelegram();
    const res = await worker.fetch(
      new Request("http://example.com/api/setWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://hooks.example/api/webhook" }),
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: "https://hooks.example/api/webhook" });

    const setCall = calls.find((c) => c.method === "setWebhook");
    expect(setCall.body).toEqual({ url: "https://hooks.example/api/webhook" });
  });

  it("redirects an HTML form post back to the page on success", async () => {
    stubTelegram();
    const res = await worker.fetch(
      new Request("http://example.com/api/setWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "url=https%3A%2F%2Fhooks.example%2Fapi%2Fwebhook%2F",
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/?saved=https%3A%2F%2Fhooks.example%2Fapi%2Fwebhook%2F");
  });

  it("rejects a non-https URL without calling Telegram", async () => {
    const calls = stubTelegram();
    const res = await worker.fetch(
      new Request("http://example.com/api/setWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://evil.example/api/webhook/" }),
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/https:\/\//);
    expect(calls.some((c) => c.method === "setWebhook")).toBe(false);
  });

  it("reports Telegram's rejection through the form redirect", async () => {
    stubTelegram({
      setWebhookReply: { ok: false, description: "Bad webhook: not found" },
    });
    const res = await worker.fetch(
      new Request("http://example.com/api/setWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "url=https%3A%2F%2Fhooks.example%2Fapi%2Fwebhook%2F",
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toContain("error=Bad+webhook%3A+not+found");
  });

  it("returns Telegram's failure as JSON for API callers", async () => {
    stubTelegram({
      setWebhookReply: { ok: false, description: "Bad Request: bad webhook" },
    });
    const res = await worker.fetch(
      new Request("http://example.com/api/setWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://hooks.example/api/webhook/" }),
      }),
      env,
      ctx,
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Bad Request: bad webhook" });
  });
});

describe("GET /api/webhook/info", () => {
  it("proxies Telegram's getWebhookInfo", async () => {
    const res = await worker.fetch(new Request("http://example.com/api/webhook/info"), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      result: { url: "", pending_update_count: 0 },
    });
  });
});

describe("validateWebhookUrl", () => {
  it("accepts https URLs and normalises them", () => {
    expect(validateWebhookUrl("  https://Hooks.example/API/webhook  ")).toEqual({
      value: "https://hooks.example/API/webhook",
    });
  });

  it("allows plain http only for localhost", () => {
    expect(validateWebhookUrl("http://localhost:8787/api/webhook/").value).toBe(
      "http://localhost:8787/api/webhook/",
    );
    expect(validateWebhookUrl("http://example.com/hook").error).toMatch(/https:\/\//);
  });

  it("rejects empty, malformed and credentialed URLs", () => {
    expect(validateWebhookUrl("").error).toMatch(/Enter a webhook URL/);
    expect(validateWebhookUrl("not a url").error).toMatch(/valid URL/);
    expect(validateWebhookUrl("https://user:pass@example.com/hook").error).toMatch(
      /username or password/,
    );
  });
});
