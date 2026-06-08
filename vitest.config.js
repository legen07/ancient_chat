import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        compatibility_flags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    exclude: ["telegram-tt", "**/node_modules/**"],
  },
});
