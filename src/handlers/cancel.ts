import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  readRegistration,
  deleteRegistration,
} from "../store.js";

// /cancel — the escape hatch. Cancels an in-progress flow (clears session) or,
// if no flow is active, cancels the user's existing registration. Reachable as a
// slash command because the spec lists it as an entry point; a "Cancel
// registration" button would be redundant with the always-available command.
const composer = new Composer<Ctx>();

composer.command("cancel", async (ctx) => {
  const step = ctx.session.step;

  if (step && step !== "idle") {
    // Mid-flow: clear ephemeral conversation state, nothing was persisted yet
    // (registration is only stored on confirm). Owner event scratch is cleared too.
    ctx.session.step = "idle";
    ctx.session.regName = undefined;
    ctx.session.regSurname = undefined;
    ctx.session.regEmail = undefined;
    ctx.session.regPhone = undefined;
    ctx.session.evTopic = undefined;
    ctx.session.evDateTime = undefined;
    ctx.session.evOffset = undefined;
    await ctx.reply("Cancelled — nothing was saved. Tap /start to begin again.", {
      reply_markup: { remove_keyboard: true },
    });
    return;
  }

  const existing = await readRegistration(ctx.from!.id);
  if (existing) {
    await deleteRegistration(ctx.from!.id);
    await ctx.reply(
      "Your registration has been cancelled. You can sign up again anytime from the menu.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  await ctx.reply("You don't have a registration to cancel.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

export default composer;
