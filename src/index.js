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

		if (url.endsWith('/api/init/')) {
			const res = await fetch('https://api.telegram.org/' + env.API_KEY + '/getUpdates');

			return new Response(await res);
		}

		if (url.includes('/api/listen')) {
			const getUrl = new URL(request.url);
			const domain = getUrl.searchParams.get("domain");
	

			console.log('Listening for messages...');
			console.log(domain);

			const res = await fetch('https://api.telegram.org/bot' + env.API_KEY + '/setWebhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					url: 'https://'+domain+'/api/webhook/',
				}),
			});
			console.log(await res.json());
			return new Response(await res);
		}

		//? This is the Ask function .
		const ask = async (message ) => {
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

			const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

			const options = {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-goog-api-key': env.GEN_KEY,
				},
				body: JSON.stringify(payload),
			};
			const response = await fetch(url, options);
			console.log(response);
			const data = await response.json();

			return new Response(JSON.stringify(data.candidates[0].content), { headers: { 'Content-Type': 'application/json' } });
		};
		//!Ask function end here.

		//? Respond back to Telegram customer.
		const sendMessage = async (chat_id, text) => {
			const url = 'https://api.telegram.org/bot' + env.API_KEY + '/sendMessage';
			const payload = {
				chat_id,
				text,
				parse_mode: "Markdown"
			};

			const options = {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(payload),
			};

			const response = await fetch(url, options);
			return response;
		};
		//? End of respond function.

		if (url.endsWith('/api/webhook/')) {
			const body = await request;
			const bodyText = await body.text();

			const { id, first_name, username, language_code } = JSON.parse(bodyText).message.from;
			const { date, text } = JSON.parse(bodyText).message;
			console.log('Received message: ' + text);

			const response = await ask({ first_name, username, language_code, date, text });
			console.log('Received response from Gemini: ' + response);

			const genRes = await response.text();
			console.log('Raw generated response: ' + genRes);

			const genResJson = JSON.parse(genRes ?? '{}');
			console.log('Generated response: ' + genResJson.parts[0].text);


			const sent = await sendMessage(id, genResJson.parts[0].text);

			console.log('Sent response: ' + sent);

			await new Promise(resolve => setTimeout(resolve, 1e5));

			return new Response(body);
		}

		if (url.endsWith('/api/deleteWebhook/')) {
			const res = await fetch('https://api.telegram.org/bot' + env.API_KEY + '/deleteWebhook', {
				method: 'POST',
			});
			console.log(await res.json());
			return new Response(await res);
		}

		return new Response('Hello World!');
	},
};
