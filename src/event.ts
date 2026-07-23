// Event display + ICS calendar-invite generation.
//
// Time correctness (AGENTS.md): the event's wall-clock time is stored as an ISO
// 8601 string WITH its UTC offset (e.g. "2026-07-23T15:00:00+03:00"), so every
// UTC conversion is unambiguous and `Date.parse` gives the correct epoch. We
// avoid Intl timezone-name → offset lookups (a Node/ICU fragility and a Workers
// gap) by having the organizer enter the UTC offset directly; the IANA tz
// label is shown only for display. All "now" decisions route through `now()`.

import type { WebinarEvent, Registration } from "./store.js";
import { now } from "./clock.js";

/** "2026-07-23 15:00" from an ISO-with-offset string. */
export function wallClock(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** "2026-07-23 12:00" — the UTC equivalent, derived deterministically. */
export function utcClock(iso: string): string {
  const u = new Date(iso).toISOString();
  return `${u.slice(0, 10)} ${u.slice(11, 16)}`;
}

/** Friendly multi-line summary of the webinar (used in /start, registration). */
export function formatEventInfo(event: WebinarEvent): string {
  const when = wallClock(event.dateTime);
  const utc = utcClock(event.dateTime);
  const link = event.broadcastLink && event.broadcastLink.length > 0
    ? event.broadcastLink
    : "—";
  return (
    `📅 ${event.topic}\n` +
    `🗓 When: ${when} (UTC${event.organizerTimezone})\n` +
    `⏱ UTC: ${utc}\n` +
    `🌐 Broadcast: ${link}`
  );
}

/** RFC 5545 ICS for the webinar, sent as a calendar invite after registration.
 *  Times are emitted in UTC (Z) — universally understood by calendar apps. */
export function buildIcs(event: WebinarEvent, reg: Registration): string {
  const start = new Date(event.dateTime);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1-hour webinar
  const stamp = new Date(now());
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//agntdev//webinar-bot//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${reg.telegramId}-${reg.registrationTimestamp}@agntdev-webinar`,
    `DTSTAMP:${fmt(stamp)}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${event.topic}`,
    `DESCRIPTION:Broadcast: ${event.broadcastLink}`,
    `LOCATION:${event.broadcastLink}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}
