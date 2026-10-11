import { answerMessage, stopGeneration, stopChatGeneration } from "./lib/answer.js";
import * as canned from "./lib/canned.js";
import * as memory from "./lib/memory.js";
import {
  ALLOWED_UPDATES,
  handleBusinessConnection,
  handleBusinessMessage,
  handleCallbackQuery,
  handleDeletedBusinessMessages,
} from "./lib/secretary.js";
import { callTelegram, sendMessage, validateWebhookUrl } from "./lib/telegram.js";
import { renderWebhookSettingsPage } from "./pages/webhook-settings.js";

export default {
  async fetch(request, env, ctx) {
    const url = request.url;
    const requestUrl = new URL(url);
    const { pathname, searchParams } = requestUrl;

    if (url.includes("/api/listen")) {
      const getUrl = new URL(request.url);
      const domain = getUrl.searchParams.get("domain");

      console.log("Listening for messages...");
      console.log(domain);

      const res = await fetch("https://api.telegram.org/bot" + env.API_KEY + "/setWebhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://" + domain + "/api/webhook/",
          allowed_updates: ALLOWED_UPDATES,
        }),
      });
      const text = await res.text();
      console.log(text);
      return new Response(text);
    }

    //! Webhook settings: HTML page + JSON endpoints.

    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    // 303 back to the settings page so a plain HTML form lands on a fresh GET.
    const redirectToSettings = (params) => {
      const target = new URL("/", requestUrl.origin);
      for (const [key, value] of Object.entries(params)) {
        target.searchParams.set(key, value);
      }
      return new Response(null, {
        status: 303,
        headers: { Location: target.pathname + target.search },
      });
    };

    // Read the submitted URL from a JSON body, an HTML form, or a raw body.
    const readSubmittedUrl = async () => {
      const contentType = request.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const body = await request.json().catch(() => null);
        return { raw: body && body.url, fromForm: false };
      }

      if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        const form = await request.formData().catch(() => null);
        return { raw: form && form.get("url"), fromForm: true };
      }

      return { raw: await request.text().catch(() => ""), fromForm: false };
    };

    // GET /api/webhook/info — what Telegram currently has configured.
    if (pathname === "/api/webhook/info" && request.method === "GET") {
      try {
        const info = await callTelegram(env, "getWebhookInfo", {});
        return jsonResponse(info, info.ok ? 200 : 502);
      } catch (err) {
        return jsonResponse({ ok: false, description: String(err && err.message) }, 502);
      }
    }

    // POST /api/setWebhook — {"url": "https://..."} for JSON callers,
    // or the settings page form, which is redirected back with a status banner.
    if (pathname === "/api/setWebhook" && request.method === "POST") {
      const submitted = await readSubmittedUrl();

      const finish = (payload, status) => {
        if (submitted.fromForm) {
          return payload.ok
            ? redirectToSettings({ saved: payload.url })
            : redirectToSettings({ error: payload.error });
        }
        return jsonResponse(payload, status);
      };

      const checked = validateWebhookUrl(submitted.raw);
      if (checked.error) {
        console.log("Rejected webhook URL: " + checked.error);
        return finish({ ok: false, error: checked.error }, 400);
      }

      try {
        const result = await callTelegram(env, "setWebhook", {
          url: checked.value,
          allowed_updates: ALLOWED_UPDATES,
        });

        if (!result.ok) {
          const description = result.description || "Telegram rejected this URL.";
          console.log("Telegram rejected the webhook: " + description);
          return finish({ ok: false, error: description }, 502);
        }

        console.log("Webhook set to " + checked.value);
        return finish({ ok: true, url: checked.value }, 200);
      } catch (err) {
        return finish({ ok: false, error: "Could not reach Telegram: " + err.message }, 502);
      }
    }

    // GET / and /webhook-settings — the settings page itself.
    if (
      request.method === "GET" &&
      (pathname === "/" || pathname === "/webhook-settings" || pathname === "/webhook-settings/")
    ) {
      const suggestedUrl = requestUrl.origin + "/api/webhook/";

      let info = null;
      let infoError = "";

      try {
        const result = await callTelegram(env, "getWebhookInfo", {});
        if (result.ok) {
          info = Object.assign({}, result.result, {
            last_check_date: Math.floor(Date.now() / 1000),
          });
        } else {
          infoError = result.description || "Telegram returned an error.";
        }
      } catch (err) {
        infoError = String(err && err.message);
      }

      let banner = null;
      const saved = searchParams.get("saved");
      const error = searchParams.get("error");
      const deleted = searchParams.get("deleted");

      if (saved) {
        banner = { kind: "success", text: "Webhook updated to " + saved };
      } else if (error) {
        banner = { kind: "error", text: error };
      } else if (deleted) {
        banner = { kind: "info", text: "Webhook removed from Telegram." };
      }

      const html = renderWebhookSettingsPage({
        suggestedUrl,
        currentUrl: info && info.url ? info.url : "",
        info,
        infoError,
        banner,
      });

      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // Secretary intake + direct owner chat (see docs/chats-specs.md).

    if (url.endsWith("/api/webhook/")) {
      const bodyText = await request.text();
      console.log(bodyText);

      // Telegram pings the webhook during setWebhook with a body that carries
      // no message — acknowledge those instead of crashing with a 500.
      let update = null;
      try {
        update = JSON.parse(bodyText);
      } catch {
        update = null;
      }

      if (!update) {
        return new Response("ok");
      }

      // Background helper: Telegram only needs a fast "ok"; everything else
      // runs in waitUntil (falls back to awaiting when no ctx is available).
      const later = (promise) => {
        const guarded = promise.catch((err) => {
          console.log("background task failed: " + (err && err.stack ? err.stack : String(err)));
        });
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(guarded);
          return guarded;
        }
        return guarded;
      };

      // The user pressed Stop on a streaming draft (direct chat).
      if (update.stopped_message_generation) {
        const stopped = update.stopped_message_generation;
        const cancelled = stopGeneration(stopped.chat && stopped.chat.id, stopped.draft_id);
        console.log(
          "Stop pressed for draft " + stopped.draft_id + (cancelled ? " (cancelled)" : " (not running)"),
        );
        return new Response("ok");
      }

      // Bot connected / edited / ended → remember the connection & rights.
      if (update.business_connection) {
        later(handleBusinessConnection(env, update.business_connection));
        return new Response("ok");
      }

      // A new message landed in one of the owner's private chats — the
      // secretary decides whether it is answered (spec §3–§6).
      if (update.business_message) {
        later(handleBusinessMessage({ env, message: update.business_message }));
        return new Response("ok");
      }

      // Messages deleted from a managed chat → forget the transcript.
      if (update.deleted_business_messages) {
        later(handleDeletedBusinessMessages(env, update.deleted_business_messages));
        return new Response("ok");
      }

      // Delete / Request Human button presses (callback answers, no chat post).
      if (update.callback_query) {
        later(handleCallbackQuery({ env, query: update.callback_query }));
        return new Response("ok");
      }

      if (!update.message || !update.message.text) {
        console.log("Ignoring update without a text message.");
        return new Response("ok");
      }

      // ---------------------------------------------------------- direct mode
      // Someone (normally the owner) is talking to the bot itself.

      const message = update.message;
      const chat = message.chat || { id: message.from.id, type: "private" };
      const text = message.text;
      console.log("Received message: " + text);

      if (chat.type === "private" && text.startsWith("/")) {
        const [commandToken] = text.split(/\s+/);
        const command = commandToken.split("@")[0].toLowerCase();
        const arg = text.slice(commandToken.length).trim();
        const botName = env.BOT_NAME || "Noti";
        const ownerName = env.OWNER_NAME || "the boss";

        if (command === "/start") {
          // "Manage Bot" deep link: /start bizChat<user_chat_id>.
          const deepLink = arg.match(/^bizChat(\d+)$/);
          if (deepLink) {
            later(memory.setOwnerChatId(env, Number(deepLink[1])));
            console.log("owner chat id set from deep link: " + deepLink[1]);
          }
          await sendMessage(env, {
            chat_id: chat.id,
            text: canned.DIRECT_START(ownerName, botName),
          });
          return new Response("ok");
        }

        if (command === "/help") {
          await sendMessage(env, { chat_id: chat.id, text: canned.DIRECT_HELP });
          return new Response("ok");
        }

        if (command === "/stop") {
          const stopped = stopChatGeneration(chat.id);
          await sendMessage(env, {
            chat_id: chat.id,
            text: stopped ? canned.DIRECT_STOP_OK : "Nothing dey generate right now ✅",
          });
          return new Response("ok");
        }

        await sendMessage(env, { chat_id: chat.id, text: canned.DIRECT_UNKNOWN });
        return new Response("ok");
      }

      // Draft ids must be non-zero; the message id is unique per chat and
      // makes follow-up drafts animate instead of swapping abruptly.
      const draftId =
        message.message_id > 0 ? message.message_id : Math.floor(Math.random() * 1000000000);

      // Answer in the background: the streamed draft updates go out as
      // separate Bot API calls (direct chat keeps the streaming pipeline).
      later(
        answerMessage({
          env,
          chat,
          draftId,
          from: message.from || {},
          text,
          threadId: message.message_thread_id,
        }),
      );

      return new Response("ok");
    }

    if (url.endsWith("/api/deleteWebhook/")) {
      const res = await fetch("https://api.telegram.org/bot" + env.API_KEY + "/deleteWebhook", {
        method: "POST",
      });
      const text = await res.text();
      console.log(text);

      // The settings page posts this form; send the browser back to the page.
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        return redirectToSettings({ deleted: "1" });
      }

      return new Response(text, { headers: { "Content-Type": "application/json" } });
    }

    return new Response("Hello World!");
  },
};
