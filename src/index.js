import { Marked } from "marked";
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

      return new Response(await res);
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

    //? This is the Ask function .
    const ask = async (message) => {
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

		const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
			max_tokens: 1048,
			messages: [
		{content: prompt, role: "system"
			}, {content: message.text, role: "user"
		}]});
		console.log(response);

      // This is the fetch.
      // const response = await fetch(url, options);

      //! Telegram safe exit.
      /*if (!response.ok) {
        console.log("Error generating response from Gemini: ");
        console.log(await response.json());

        return new Response("{status: 40}");
      }*/

      return new Response(JSON.stringify(response), {
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

      const { id, first_name, username, language_code } = JSON.parse(bodyText).message.from;
      const { date, text } = JSON.parse(bodyText).message;
      console.log("Received message: " + text);

      //Asking Gemini
      const response = await ask({ first_name, username, language_code, date, text });

			console.log(response);

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
      console.log(await res.json());
      return new Response(await res);
    }

    return new Response("Hello World!");
  },
};
