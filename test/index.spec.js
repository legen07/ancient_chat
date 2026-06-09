import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src";

// beforeEach(() => {
//   vi.stubGlobal("fetch", vi.fn());
// });

describe("Telegram bot Ai chat Assist. ", () => {
  /* 	it('responds with Hello World! (unit style)', async () => {
		const request = new Request('http://localhost:8787/api/init/');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"[object Response]"`);
	});*/

  describe("POST /api/webhk", () => {
    it("returns 200 for a valid telegram message update", async () => {
      const body = {
        update_id: 123,
        message: {
          chat: { id: 456 },
          text: "Hello bot",
        },
      };

      const request = new Request("http://localhost:8787/api/webhk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
    });

    it.skip("returns 400 for an empty body", async () => {
      const request = new Request("http://localhost:8787/api/webhk", {
        method: "POST",
        body: "",
      });

      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(400);
    });
  });

  it("respond when initiating telegram webhook", async () => {
    const request = new Request(
      "http://localhost:8787/api/listen?domain=colors-why-irc-otherwise.trycloudflare.com",
    );

    const ctx = createExecutionContext();
    console.log("is is happening here ? ");

    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    // const text = await response.text();
    // console.log(response);
    // const result = await response.json();
    console.log(await response.text());
    expect(response).toMatchInlineSnapshot({}, `{}`);
  });

  it.skip("respond when deleting webhook", async () => {
    const request = new Request("http://localhost:8787/api/deleteWebhook/");

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toMatchInlineSnapshot(`"[object Response]"`);
  });
  it.skip("responds when telegram makes a request.", async () => {
    const request = new Request("http://localhost:8787/api/webhook/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          from: {
            id: 37373,
            first_name: "joen Legn",
            username: "lejlej",
          },
          date: new Date(),
          text: "hi there",
        },
      }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);

    await waitOnExecutionContext(ctx);
    console.log(response);
    expect(await response);
  });

  it.skip("responds when there is a post request from outside", async () => {
    const response = await SELF.fetch("http://localhost:8787/api/webhook/", {
      body: {
        message: {
          from: {
            id: 37373,
            first_name: "joen Legn",
            username: "lejlej",
          },
        },
      },
    });
    expect(await response);
  });
});

