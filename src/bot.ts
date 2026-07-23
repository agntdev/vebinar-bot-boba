import { Composer } from "grammy";
import { createBot, type BotContext, type CreateBotOptions } from "./toolkit/index.js";
import type { StorageAdapter } from "grammy";
import { resetDurableStore } from "./store.js";

// The per-chat session shape (ephemeral conversation state only). Extend as the
// bot grows. Durable domain data must NOT live here — use the toolkit's
// persistent storage (see AGENTS.md).
export type Step =
  | "idle"
  | "awaiting_name"
  | "awaiting_email"
  | "awaiting_phone"
  | "confirming"
  | "owner_topic"
  | "owner_datetime"
  | "owner_offset"
  | "owner_link"
  | "owner_channel";

export interface Session {
  step?: Step;
  // registration flow scratch
  regName?: string;
  regSurname?: string;
  regEmail?: string;
  regPhone?: string;
  // owner event-setup scratch
  evTopic?: string;
  evDateTime?: string; // "YYYY-MM-DD HH:MM"
  evOffset?: string; // "+HH:MM"
}

export type Ctx = BotContext<Session>;

/**
 * BuildBotOptions lets a runtime-specific ENTRY POINT (never a feature handler)
 * override how the bot is assembled:
 *
 *  - `handlers`: a pre-loaded list of feature Composers. The Cloudflare Workers
 *    entry (src/worker.ts) passes these from a BUILD-TIME manifest, because the
 *    Workers runtime has no filesystem — `readdirSync` + dynamic `import()` only
 *    work under Node (dev, the test harness, and the Fly/long-poll entry). When
 *    omitted, buildBot falls back to the Node disk scan, so nothing on the Node
 *    path changes.
 *  - `storage`: an explicit grammY session StorageAdapter (Workers passes a
 *    Durable-Object-backed one; Node auto-selects Redis/in-memory).
 */
export interface BuildBotOptions {
  handlers?: Composer<Ctx>[];
  storage?: StorageAdapter<Session>;
  telemetryEnv?: CreateBotOptions<Session>["telemetryEnv"];
  telemetryReporterOptions?: CreateBotOptions<Session>["telemetryReporterOptions"];
}

/**
 * buildBot — assembles the bot, AUTO-LOADS every feature handler from
 * src/handlers/, then registers the global fallback. Does NOT start the bot.
 * Add a feature by creating src/handlers/<name>.ts that default-exports a grammY
 * Composer — NEVER edit this file (concurrent feature PRs would conflict).
 *
 * Runtime-agnostic: the Node entry (src/index.ts) and the test harness call
 * `buildBot(token)` and get the disk-scanned handlers; the Workers entry
 * (src/worker.ts) calls `buildBot(token, { handlers, storage })` with a
 * build-time manifest because Workers has no filesystem.
 */
export async function buildBot(token: string, opts: BuildBotOptions = {}) {
  // Reset durable domain storage so a freshly-built bot starts clean. The test
  // harness builds a NEW bot per spec, so this gives each spec an isolated
  // store (mirroring grammY's per-bot session isolation). In production
  // buildBot runs once, so this is a one-time init.
  resetDurableStore();
  const bot = createBot<Session>(token, {
    initial: () => ({}),
    storage: opts.storage,
    telemetryEnv: opts.telemetryEnv,
    telemetryReporterOptions: opts.telemetryReporterOptions,
  });

  const handlers = opts.handlers ?? (await loadHandlersFromDisk());
  for (const h of handlers) bot.use(h);

  bot.on("message", (ctx) => ctx.reply("Sorry, I didn't understand that. Try /help."));

  return bot;
}

/**
 * loadHandlersFromDisk — the Node/dev/harness path: scan src/handlers/ and
 * import each Composer. Never CALLED in the Workers bundle (worker.ts always
 * passes an explicit manifest) — and `node:fs` must be imported DYNAMICALLY
 * here, not at the top of the file: Cloudflare validates the bundle's static
 * import graph at upload and rejects any static node:* import, even one whose
 * code never runs.
 */
async function loadHandlersFromDisk(): Promise<Composer<Ctx>[] > {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("./handlers/", import.meta.url);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter(
      (f) =>
        (f.endsWith(".js") || f.endsWith(".ts")) &&
        !f.endsWith(".d.ts") &&
        !f.includes(".test.") &&
        !f.includes(".spec."),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    files = []; // no handlers/ dir yet → nothing to load
  }
  const out: Composer<Ctx>[] = [];
  for (const file of files.sort()) {
    const mod = (await import(new URL(file, dir).href)) as { default?: Composer<Ctx> };
    if (!mod.default) {
      throw new Error(`handler ${file} must default-export a grammY Composer`);
    }
    out.push(mod.default);
  }
  return out;
}
