import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  readEvent,
  writeEvent,
  readSettings,
  writeSettings,
  readRegistration,
  readRegistrationIndex,
  writeRegistration,
  type Registration,
  type WebinarEvent,
} from "../store.js";
import { formatEventInfo } from "../event.js";
import { now } from "../clock.js";
import { isOwner } from "../auth.js";

// Organizer controls — reached from /start main-menu buttons (owner-only).
//   ⚙️ Webinar settings — set topic, date/time, UTC offset, broadcast link
//   📨 Admin channel — set the channel/group to post new registrations to
//   📤 Export CSV — download all registrations as a CSV document
//   🔔 Send reminders — process due 24h/1h reminders now
//
// Non-owners who tap a reserved button get a plain-language refusal.

const composer = new Composer<Ctx>();

const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

const forceReply = (placeholder: string) => ({
  force_reply: true as const,
  input_field_placeholder: placeholder,
});

const ownerRefuse = async (ctx: Ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Only the organizer can use this. Tap /start to see what you can do.");
};

// --- ⚙️ Webinar settings (multi-step flow) ----------------------------------

composer.callbackQuery("owner:event", async (ctx) => {
  if (!(await isOwner(ctx))) {
    await ownerRefuse(ctx);
    return;
  }
  await ctx.answerCallbackQuery();
  ctx.session.step = "owner_topic";
  ctx.session.evTopic = undefined;
  ctx.session.evDateTime = undefined;
  ctx.session.evOffset = undefined;

  const event = await readEvent();
  const intro = event
    ? `Current webinar:\n\n${formatEventInfo(event)}\n\nLet's update it. What's the topic?`
    : "Let's set up your webinar. What's the topic?";
  await ctx.reply(intro, { reply_markup: forceReply("e.g. Mastering cold outreach") });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner_topic") return next();
  const topic = ctx.message.text.trim();
  if (topic.length < 2) {
    await ctx.reply("The topic is a bit short — send a clear title.", {
      reply_markup: forceReply("e.g. Mastering cold outreach"),
    });
    return;
  }
  ctx.session.evTopic = topic;
  ctx.session.step = "owner_datetime";
  await ctx.reply("Got it. Send the date and time (YYYY-MM-DD HH:MM).", {
    reply_markup: forceReply("e.g. 2026-07-23 15:00"),
  });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner_datetime") return next();
  const dt = ctx.message.text.trim();
  if (!DATETIME_RE.test(dt) || Number.isNaN(Date.parse(`${dt.replace(" ", "T")}:00Z`))) {
    await ctx.reply("That date/time doesn't look right — send it as YYYY-MM-DD HH:MM.", {
      reply_markup: forceReply("e.g. 2026-07-23 15:00"),
    });
    return;
  }
  ctx.session.evDateTime = dt;
  ctx.session.step = "owner_offset";
  await ctx.reply("Thanks. Send the UTC offset (e.g. +03:00 or -05:00).", {
    reply_markup: forceReply("e.g. +03:00"),
  });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner_offset") return next();
  const offset = ctx.message.text.trim();
  if (!OFFSET_RE.test(offset)) {
    await ctx.reply("That offset doesn't look right — send it like +03:00 or -05:00.", {
      reply_markup: forceReply("e.g. +03:00"),
    });
    return;
  }
  ctx.session.evOffset = offset;
  ctx.session.step = "owner_link";
  await ctx.reply('Last one — send the broadcast link (or type "none" to skip).', {
    reply_markup: forceReply("e.g. https://meet.example/abc"),
  });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "owner_link") return next();
  const raw = ctx.message.text.trim();
  let link = raw;
  if (raw.toLowerCase() === "none") link = "";
  else if (!/^https?:\/\//i.test(raw)) {
    await ctx.reply('Send a link starting with http(s)://, or type "none" to skip.', {
      reply_markup: forceReply("e.g. https://meet.example/abc"),
    });
    return;
  }

  const event: WebinarEvent = {
    topic: ctx.session.evTopic ?? "",
    dateTime: `${(ctx.session.evDateTime ?? "").replace(" ", "T")}:00${ctx.session.evOffset ?? "+00:00"}`,
    broadcastLink: link,
    organizerTimezone: ctx.session.evOffset ?? "+00:00",
  };
  await writeEvent(event);
  ctx.session.step = "idle";
  ctx.session.evTopic = undefined;
  ctx.session.evDateTime = undefined;
  ctx.session.evOffset = undefined;

  await ctx.reply(`✅ Webinar saved!\n\n${formatEventInfo(event)}`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// --- 📨 Admin channel -------------------------------------------------------

composer.callbackQuery("owner:channel", async (ctx) => {
  if (!(await isOwner(ctx))) {
    await ownerRefuse(ctx);
    return;
  }
  await ctx.answerCallbackQuery();
  const settings = await readSettings();
  const current =
    settings.adminChannelId !== undefined
      ? `Current admin channel: ${settings.adminChannelId}\n\n`
      : "";
  ctx.session.step = "owner_channel";
  await ctx.reply(
    `${current}Send the admin channel or group id (a negative number, like -1001234567890). You can also forward a message from the channel and I'll grab it automatically.`,
    { reply_markup: forceReply("e.g. -1001234567890") },
  );
});

async function captureChannel(ctx: Ctx): Promise<number | string | null> {
  const msg = ctx.message;
  // Forwarded from a channel/group — use its id directly.
  const fwd = (msg as unknown as { forward_origin?: { chat?: { id: number } } }).forward_origin;
  if (fwd?.chat?.id !== undefined) return fwd.chat.id;
  if (msg && "text" in msg && typeof msg.text === "string") {
    const t = msg.text.trim();
    if (/^-?\d+$/.test(t)) return Number(t);
  }
  return null;
}

composer.on("message", async (ctx, next) => {
  if (ctx.session.step !== "owner_channel") return next();
  const id = await captureChannel(ctx);
  if (id === null) {
    await ctx.reply(
      "That doesn't look like a channel id. Send a negative number, or forward a message from the channel.",
      { reply_markup: forceReply("e.g. -1001234567890") },
    );
    return;
  }
  const settings = await readSettings();
  settings.adminChannelId = id;
  await writeSettings(settings);
  ctx.session.step = "idle";
  await ctx.reply("✅ Admin channel set. New registrations will be posted there.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// --- 📤 Export CSV ----------------------------------------------------------

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

composer.callbackQuery("owner:export", async (ctx) => {
  if (!(await isOwner(ctx))) {
    await ownerRefuse(ctx);
    return;
  }
  await ctx.answerCallbackQuery();
  const ids = await readRegistrationIndex();
  if (ids.length === 0) {
    await ctx.reply("No registrations to export yet. Once people sign up, you'll get them here as a CSV.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const header = ["name", "surname", "email", "phone", "telegram_id", "registered_at", "reminder_status"];
  const lines: string[] = [header.join(",")];
  for (const id of ids) {
    const r: Registration | undefined = await readRegistration(id);
    if (!r) continue;
    lines.push(
      [r.name, r.surname, r.email, r.phone, String(r.telegramId), new Date(r.registrationTimestamp).toISOString(), r.reminderStatus]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
  }
  const csv = lines.join("\n");
  await ctx.api.sendDocument(ctx.chat!.id, new InputFile(new TextEncoder().encode(csv), "registrations.csv"), {
    caption: `📤 ${ids.length} registration(s)`,
  });
});

// --- 🔔 Send reminders ------------------------------------------------------

const HOUR = 60 * 60 * 1000;

async function sendDueReminders(ctx: Ctx): Promise<{ sent: number; skipped: number }> {
  const event = await readEvent();
  if (!event) return { sent: 0, skipped: 0 };
  const eventMs = Date.parse(event.dateTime);
  const due24 = eventMs - 24 * HOUR;
  const due1 = eventMs - HOUR;
  const n = now();
  const ids = await readRegistrationIndex();
  let sent = 0;
  let skipped = 0;

  for (const id of ids) {
    const reg = await readRegistration(id);
    if (!reg) continue;
    if (reg.reminderStatus === "blocked" || reg.reminderStatus === "sent_both") {
      skipped++;
      continue;
    }
    const due1now = n >= due1;
    const due24now = n >= due24;
    try {
      if (due1now) {
        await ctx.api.sendMessage(
          id,
          `⏰ "${event.topic}" starts in 1 hour!\n\n${formatEventInfo(event)}`,
        );
        reg.reminderStatus = "sent_both";
        sent++;
      } else if (due24now) {
        await ctx.api.sendMessage(
          id,
          `⏰ Reminder: "${event.topic}" starts in 24 hours.\n\n${formatEventInfo(event)}`,
        );
        reg.reminderStatus = "sent_24";
        sent++;
      } else {
        skipped++;
      }
    } catch (e) {
      // A user who blocked the bot (403) is marked so we never retry — and so a
      // 403 on one recipient never aborts reminders to the rest.
      if ((e as { error_code?: number }).error_code === 403) {
        reg.reminderStatus = "blocked";
      }
      skipped++;
    }
    await writeRegistration(reg);
  }
  return { sent, skipped };
}

composer.callbackQuery("owner:remind", async (ctx) => {
  if (!(await isOwner(ctx))) {
    await ownerRefuse(ctx);
    return;
  }
  await ctx.answerCallbackQuery();
  const { sent, skipped } = await sendDueReminders(ctx);
  await ctx.reply(`🔔 Reminders processed: sent ${sent}, skipped ${skipped}.`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

export default composer;
