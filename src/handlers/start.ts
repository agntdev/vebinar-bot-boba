import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  mainMenuItems,
} from "../toolkit/index.js";
import { readEvent } from "../store.js";
import { formatEventInfo } from "../event.js";
import { claimOwnerIfNeeded, isOwner } from "../auth.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem()` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered, plus owner-only controls (gated by isOwner)
// and a Help button. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

const WELCOME = "👋 Welcome! Tap a button below to get started.";

/** Build the main-menu keyboard: public items + owner-only controls + Help. */
async function buildMenu(ctx: Ctx): Promise<{ inline_keyboard: ReturnType<typeof inlineButton>[][] }> {
  const items = mainMenuItems();
  const rows: ReturnType<typeof inlineButton>[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2).map((it) => inlineButton(it.label, it.data)));
  }
  if (await isOwner(ctx)) {
    rows.push([inlineButton("⚙️ Webinar", "owner:event")]);
    rows.push([inlineButton("📨 Admin channel", "owner:channel")]);
    rows.push([inlineButton("📤 Export CSV", "owner:export")]);
    rows.push([inlineButton("🔔 Send reminders", "owner:remind")]);
  }
  rows.push([inlineButton("❓ Help", "menu:help")]);
  return { inline_keyboard: rows };
}

async function menuText(ctx: Ctx): Promise<string> {
  const event = await readEvent();
  return event ? `${WELCOME}\n\n${formatEventInfo(event)}` : WELCOME;
}

composer.command("start", async (ctx) => {
  await claimOwnerIfNeeded(ctx);
  ctx.session.step = "idle"; // /start always returns to a clean state
  await ctx.reply(await menuText(ctx), { reply_markup: await buildMenu(ctx) });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  await ctx.editMessageText(await menuText(ctx), { reply_markup: await buildMenu(ctx) });
});

export default composer;
