import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  readEvent,
  readRegistration,
  readSettings,
  writeRegistration,
} from "../store.js";
import { formatEventInfo, buildIcs } from "../event.js";
import { now } from "../clock.js";

// Registration flow (button-first): reached from the main-menu "Записаться"
// button, NOT a slash command. Collects name+surname → email → phone → confirm
// → confirmation + ICS calendar invite + admin-channel notification.

registerMainMenuItem({ label: "Записаться", data: "registration:start", order: 10 });

const composer = new Composer<Ctx>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// At least 7 digits, optional leading +, spaces/dashes/parens allowed.
const PHONE_RE = /^\+?[\d\s()\-]{7,}$/;

const forceReply = (placeholder: string) => ({
  force_reply: true as const,
  input_field_placeholder: placeholder,
});

// --- Entry: "Записаться" button ---------------------------------------------

composer.callbackQuery("registration:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";

  const event = await readEvent();
  if (!event) {
    await ctx.reply(
      "Registration isn't open yet — there's no webinar scheduled. The organizer will announce one soon. Tap /start to come back later.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  const existing = await readRegistration(ctx.from.id);
  if (existing) {
    await ctx.reply(
      `You're already registered for "${event.topic}".\n\nIf you changed your mind, send /cancel to cancel your registration.`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  ctx.session.step = "awaiting_name";
  ctx.session.regName = undefined;
  ctx.session.regSurname = undefined;
  ctx.session.regEmail = undefined;
  ctx.session.regPhone = undefined;

  await ctx.reply(
    `Let's sign you up for "${event.topic}".\n\nWhat's your full name? (name and surname)`,
    { reply_markup: forceReply("e.g. Anna Smith") },
  );
});

// --- Step: name + surname ---------------------------------------------------

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_name") return next();

  const text = ctx.message.text.trim();
  const parts = text.split(/\s+/);
  if (parts.length < 2 || parts[0].length < 1 || parts[1].length < 1) {
    await ctx.reply(
      "Please send both your name and surname, e.g. \"Anna Smith\".",
      { reply_markup: forceReply("e.g. Anna Smith") },
    );
    return;
  }
  ctx.session.regName = parts[0];
  ctx.session.regSurname = parts.slice(1).join(" ");
  ctx.session.step = "awaiting_email";

  await ctx.reply(`Thanks, ${ctx.session.regName}! What's your email address?`, {
    reply_markup: forceReply("e.g. you@example.com"),
  });
});

// --- Step: email ------------------------------------------------------------

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_email") return next();

  const email = ctx.message.text.trim();
  if (!EMAIL_RE.test(email)) {
    await ctx.reply(
      "That email doesn't look right — check the spelling and send it again.",
      { reply_markup: forceReply("e.g. you@example.com") },
    );
    return;
  }
  ctx.session.regEmail = email;
  ctx.session.step = "awaiting_phone";

  await ctx.reply("Got it. What's your phone number?", {
    reply_markup: forceReply("e.g. +7 999 123 45 67"),
  });
});

// --- Step: phone ------------------------------------------------------------

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_phone") return next();

  const phone = ctx.message.text.trim();
  const digits = phone.replace(/\D/g, "");
  if (!PHONE_RE.test(phone) || digits.length < 7) {
    await ctx.reply(
      "That phone number doesn't look right — send it like +7 999 123 45 67.",
      { reply_markup: forceReply("e.g. +7 999 123 45 67") },
    );
    return;
  }
  ctx.session.regPhone = phone;
  ctx.session.step = "confirming";

  await ctx.reply(
    `Here's what you entered:\n\n` +
      `👤 Name: ${ctx.session.regName} ${ctx.session.regSurname}\n` +
      `📧 Email: ${ctx.session.regEmail}\n` +
      `📱 Phone: ${ctx.session.regPhone}\n\n` +
      `Does this look right? By confirming you agree to receive reminders about this webinar.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Confirm", "registration:confirm:yes")],
        [inlineButton("✏️ Re-enter", "registration:confirm:no")],
      ]),
    },
  );
});

// --- Confirm ----------------------------------------------------------------

composer.callbackQuery("registration:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.session.step !== "confirming") {
    await ctx.reply("Nothing to confirm — tap /start to begin again.");
    return;
  }
  const event = await readEvent();
  if (!event) {
    ctx.session.step = "idle";
    await ctx.reply("The webinar was removed before you finished. Tap /start to come back later.");
    return;
  }

  const reg = {
    telegramId: ctx.from.id,
    name: ctx.session.regName ?? "",
    surname: ctx.session.regSurname ?? "",
    email: ctx.session.regEmail ?? "",
    phone: ctx.session.regPhone ?? "",
    registrationTimestamp: now(),
    reminderStatus: "pending" as const,
  };

  // Duplicate guard: if a registration snuck in mid-flow, don't overwrite it.
  const existing = await readRegistration(ctx.from.id);
  if (existing) {
    ctx.session.step = "idle";
    await ctx.reply(
      `You're already registered for "${event.topic}". Send /cancel if you want to cancel.`,
    );
    return;
  }

  await writeRegistration(reg);
  ctx.session.step = "idle";

  await ctx.reply(
    `✅ You're registered for "${event.topic}"!\n\n` +
      `${formatEventInfo(event)}\n\n` +
      `I'll remind you 24 hours and 1 hour before it starts. The calendar invite is below 👇`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );

  // Calendar invite (ICS) as a document.
  const ics = buildIcs(event, reg);
  await ctx.api.sendDocument(ctx.chat!.id, new InputFile(new TextEncoder().encode(ics), "webinar.ics"), {
    caption: "📅 Add to your calendar",
  });

  // Admin channel notification (registration:confirmed). Best-effort: a 403 /
  // missing channel must NOT abort the user's confirmation.
  try {
    const settings = await readSettings();
    if (settings.adminChannelId !== undefined) {
      const uname = ctx.from.username ? `@${ctx.from.username}` : `id ${ctx.from.id}`;
      const adminText =
        `🔔 New registration for "${event.topic}":\n\n` +
        `👤 ${reg.name} ${reg.surname}\n` +
        `📧 ${reg.email}\n` +
        `📱 ${reg.phone}\n` +
        `🆔 ${uname}\n` +
        `🕒 ${new Date(reg.registrationTimestamp).toISOString()}`;
      await ctx.api.sendMessage(settings.adminChannelId, adminText);
    }
  } catch {
    // A failed admin notification never breaks the user's confirmation.
  }
});

composer.callbackQuery("registration:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_name";
  ctx.session.regName = undefined;
  ctx.session.regSurname = undefined;
  await ctx.reply("No problem — let's start over. What's your full name? (name and surname)", {
    reply_markup: forceReply("e.g. Anna Smith"),
  });
});

export default composer;
