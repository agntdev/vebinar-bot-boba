// Owner / organizer identity. The organizer is identified by the
// OWNER_TELEGRAM_ID env var when set; otherwise the FIRST person to tap /start
// claims the role (a sensible onboarding default for a single-organizer bot —
// the owner deploys the bot and starts it first). The claim is durable.
//
// AGENTS.md onboarding rule: we never DM a user by their numeric id, and we
// never ask the owner to type someone's Telegram id. Owner identity is the
// deployer's own chat id (their env var) or self-claimed on first /start — both
// are first-party opt-in, not onboarding a stranger.

import type { Ctx } from "./bot.js";
import { readSettings, writeSettings } from "./store.js";

/** Is this update's sender the organizer? (Async — reads durable settings.) */
export async function isOwner(ctx: Ctx): Promise<boolean> {
  if (!ctx.from) return false;
  const env = process.env.OWNER_TELEGRAM_ID;
  if (env && ctx.from.id === Number(env)) return true;
  const s = await readSettings();
  return s.ownerTgId === ctx.from.id;
}

/** On /start, claim ownership if no organizer is set yet (first-run onboarding). */
export async function claimOwnerIfNeeded(ctx: Ctx): Promise<void> {
  if (!ctx.from) return;
  const env = process.env.OWNER_TELEGRAM_ID;
  if (env && ctx.from.id === Number(env)) {
    const s = await readSettings();
    if (s.ownerTgId !== ctx.from.id) {
      s.ownerTgId = ctx.from.id;
      await writeSettings(s);
    }
    return;
  }
  const s = await readSettings();
  if (s.ownerTgId === undefined) {
    s.ownerTgId = ctx.from.id;
    await writeSettings(s);
  }
}
