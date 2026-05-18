import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Hello World worker', () => {
	/* 	it('responds with Hello World! (unit style)', async () => {
		const request = new Request('http://localhost:8787/api/init/');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"[object Response]"`);
	});*/

	/* 	it('respond when initiating telegram webhook', async () => {
		const request = new Request('http://localhost:8787/api/listen/');

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"[object Response]"`);
	});  */

	it('respond when initiating telegram webhook', async () => {
		const request = new Request('http://localhost:8787/api/listen?domain=installation-decision-pharmacy-even.trycloudflare.com');

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"[object Response]"`);
	});

	/*it('respond when deleting webhook', async () => {
		const request = new Request('http://localhost:8787/api/deleteWebhook/');

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"[object Response]"`);
	});*/

	it('responds when there is a post request from outside', async () => {
		const response = await SELF.fetch('http://localhost:8787/api/webhk/');
		expect(await response);
	});
});
