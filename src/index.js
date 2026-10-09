import { Marked } from "marked";
import { callTelegram, validateWebhookUrl } from "./lib/telegram.js";
import { renderWebhookSettingsPage } from "./pages/webhook-settings.js";
/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request, env, ctx) {
    const url = request.url;
    const requestUrl = new URL(url);
    const { pathname, searchParams } = requestUrl;

		function markdownToHtml(text) {
			// Convert markdown to HTML
			console.log("Are you reaching here ? ")
			const html = Marked.parse(text);

			// Telegram only supports a subset of HTML tags
			// Strip unsupported tags, keep only what Telegram allows
			return html
				.replace(/<p>(.*?)<\/p>/gs, '$1\n')
				.replace(/<br\s*\/?>/g, '\n')
				.replace(/<h[1-6]>(.*?)<\/h[1-6]>/gs, '<b>$1</b>\n')
				.replace(/<ul>/g, '')
				.replace(/<\/ul>/g, '')
				.replace(/<ol>/g, '')
				.replace(/<\/ol>/g, '')
				.replace(/<li>(.*?)<\/li>/gs, '• $1\n')
				.replace(/<strong>(.*?)<\/strong>/gs, '<b>$1</b>')
				.replace(/<em>(.*?)<\/em>/gs, '<i>$1</i>')
				.replace(/<code>(.*?)<\/code>/gs, '<code>$1</code>')
				.replace(/<pre><code.*?>(.*?)<\/code><\/pre>/gs, '<pre>$1</pre>')
				.replace(/<a href="(.*?)">(.*?)<\/a>/gs, '<a href="$1">$2</a>')
				.replace(/<[^>]+>/g, '') // strip any remaining unsupported tags
				.trim();
		}


    if (url.endsWith("/api/init/")) {
      const res = await fetch("https://api.telegram.org/" + env.API_KEY + "/getUpdates");

      return new Response(res);
    }

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
        const result = await callTelegram(env, "setWebhook", { url: checked.value });

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

    //? This is the Ask function .
  	 async function ask(message){
      const text = `Your a customer support agent for a company called "Anti_Ancient".Your name is "Noti Ancient". It is a company that build automations and Ai for businesses solutions. The customer is asking: ${message.text}. Answer the question in a helpful and concise way. Sometimes add some emojis if you think it will be helpful. Always be polite and friendly.
			Here is some information about customer:
			name: ${message.first_name}
			language_code: ${message.language_code}

			`;

      const payload = {
        contents: [
          {
            parts: [{ text }],
          },
        ],
      };



      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEN_KEY,
        },
        body: JSON.stringify(payload),
      };

			console.log("Asking Gemini with the following prompt: " + text);
			console.log(message.text)


		const prompt = `You are a customer support agent for a company called "Anti_Ancient".Your name is "Noti Ancient". It is a company that build automations and Ai for businesses solutions. Answer the question in a helpful and concise way. Sometimes add some emojis if you think it will be helpful. Always be polite and friendly.
			Here is some information about customer:
			name: ${message.first_name}
			language_code: ${message.language_code}`

		const response = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
			prompt: `System: You are a customer support agent for a company called "Anti_Ancient". Your name is "Noti Ancient". It is a company that build automations and Ai for businesses solutions. Answer the question in a helpful and concise way. Sometimes add some emojis if you think it will be helpful. Always be polite and friendly.\n\nHere is some information about customer:\nname: ${message.first_name}\nlanguage_code: ${message.language_code}\n\nUser: ${message.text}`,
			parameters: {
				temperature: 0.3,
				max_tokens: 2048
			}
		});
		console.log("Raw AI Response:", response, typeof response);
		const aiText = (response && response.response) || (response && response.text) || (typeof response === 'string' ? response : JSON.stringify(response));

      // This is the fetch.
      // const response = await fetch(url, options);

      //! Telegram safe exit.
      /*if (!response.ok) {
        console.log("Error generating response from Gemini: ");
        console.log(await response.json());

        return new Response("{status: 40}");
      }*/

      return new Response(JSON.stringify({ response: aiText }), {
        headers: { "Content-Type": "application/json" },
      });
    };
    //!Ask function end here.

    //? Respond back to Telegram customer.
    const sendMessage = async (chat_id, text) => {
				// text = text.replace(/[_*[\]()~`>#+=|{}.!\\]/g, '\\$&');
console.log("Are you calling me ? ")

			console.log(text);

      const url = "https://api.telegram.org/bot" + env.API_KEY + "/sendMessage";
      const payload = {
        chat_id,
        text: text,
        // parse_mode: "HTML",
      };

      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      };
			console.log("aBOUT TO SEND MESSAGE TO tELEGRAM.")

      const response = await fetch(url, options);
			console.log("Have sent message to the Telegram bot. ");
			console.log(await response.json());
      return response;
    };
    //! End of respond function.

    if (url.endsWith("/api/webhook/")) {
			console.log("Are you even reaching here. ? ")
      const body = await request;
      const bodyText = await body.text();
      console.log(bodyText);

      // Telegram pings the webhook during setWebhook with a body that carries
      // no message — acknowledge those instead of crashing with a 500.
      let update = null;
      try {
        update = JSON.parse(bodyText);
      } catch {
        update = null;
      }

      if (!update || !update.message || !update.message.text) {
        console.log("Ignoring update without a text message.");
        return new Response("ok");
      }

      const { id, first_name, username, language_code } = update.message.from;
      const { date, text } = update.message;
      console.log("Received message: " + text);

      //Asking Gemini
      const response = await ask({ first_name, username, language_code, date, text });
			const genRes = await response.text();



      //! Telegram safe exit.
      if (genRes === "{status: 40}") {
        console.log(
          "Error generating response from Gemini. But charlie lets's just tell Telegram that everything is ok.",
        );
        return new Response("ok");
      }

      const genResJson = JSON.parse(genRes ?? "{}");
      console.log("Generated response: ");
			console.log( genResJson);

      const sent = await sendMessage(id, genResJson.response);

      return new Response(body);
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
