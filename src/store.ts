// Durable domain storage for the webinar bot.
//
// AGENTS.md: durable data (records, settings) MUST use the toolkit's persistent
// store (Redis-backed in production), never an in-memory Map. We reuse the
// toolkit's StorageAdapter selection (`resolveSessionStorage`): when REDIS_URL is
// set the adapter is Redis; otherwise (dev + the test harness) it is the
// toolkit's MemorySessionStorage. We NEVER enumerate the keyspace — collections
// are read through explicit index records (registration:index, settings) so there
// is no `KEYS`/`SCAN`/`readAll` O(N) hazard.
//
// Per-bot isolation: `resetDurableStore()` is called from `buildBot` before the
// handlers run, so the test harness (which builds a FRESH bot per spec) gets a
// clean store each time — matching how grammY sessions are isolated per bot. In
// production `buildBot` runs once, so the store is created once and (with
// REDIS_URL) backed by Redis — durable across restarts.

import type { StorageAdapter } from "grammy";
import { resolveSessionStorage } from "./toolkit/session/redis.js";

// --- Entities (the spec's data model) ---------------------------------------

export interface WebinarEvent {
  topic: string;
  /** ISO 8601 with offset, e.g. "2026-07-23T15:00:00+03:00". */
  dateTime: string;
  broadcastLink: string;
  /** UTC offset label, e.g. "+03:00". */
  organizerTimezone: string;
}

export type ReminderStatus = "pending" | "sent_24" | "sent_both" | "blocked";

export interface Registration {
  telegramId: number;
  name: string;
  surname: string;
  email: string;
  phone: string;
  /** epoch ms */
  registrationTimestamp: number;
  reminderStatus: ReminderStatus;
}

export interface Settings {
  /** The Telegram user id of the organizer. Claimed by the first /start when
   *  OWNER_TELEGRAM_ID env is unset (onboarding), or fixed by that env var. */
  ownerTgId?: number;
  /** Admin channel/group id to post new registrations to. */
  adminChannelId?: number | string;
}

// --- Adapter (Redis in prod, memory in dev/test) ----------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adapter: StorageAdapter<any> | null = null;

/** Drop the in-memory adapter (called from buildBot for test isolation). In
 *  production this is a no-op the first time and never resets a live Redis store
 *  because buildBot runs exactly once. */
export function resetDurableStore(): void {
  adapter = null;
}

function store(): StorageAdapter<any> {
  if (adapter === null) adapter = resolveSessionStorage<any>(undefined);
  return adapter;
}

async function get<T>(key: string): Promise<T | undefined> {
  return (await store().read(key)) as T | undefined;
}
async function put(key: string, value: unknown): Promise<void> {
  await store().write(key, value as never);
}
async function del(key: string): Promise<void> {
  await store().delete(key);
}

// --- Keys (namespaced; no scans, read via explicit indices) -----------------

const EVENT_KEY = "webinar:event";
const INDEX_KEY = "webinar:registration:index";
const SETTINGS_KEY = "webinar:settings";
const regKey = (tgId: number) => `webinar:registration:${tgId}`;

// --- Event ------------------------------------------------------------------

export async function readEvent(): Promise<WebinarEvent | undefined> {
  return get<WebinarEvent>(EVENT_KEY);
}
export async function writeEvent(event: WebinarEvent): Promise<void> {
  await put(EVENT_KEY, event);
}

// --- Settings ---------------------------------------------------------------

export async function readSettings(): Promise<Settings> {
  return (await get<Settings>(SETTINGS_KEY)) ?? {};
}
export async function writeSettings(settings: Settings): Promise<void> {
  await put(SETTINGS_KEY, settings);
}

// --- Registrations (+ explicit index, no keyspace scan) ----------------------

export async function readRegistration(tgId: number): Promise<Registration | undefined> {
  return get<Registration>(regKey(tgId));
}

export async function writeRegistration(reg: Registration): Promise<void> {
  await put(regKey(reg.telegramId), reg);
  const idx = (await get<number[]>(INDEX_KEY)) ?? [];
  if (!idx.includes(reg.telegramId)) {
    idx.push(reg.telegramId);
    await put(INDEX_KEY, idx);
  }
}

export async function deleteRegistration(tgId: number): Promise<void> {
  await del(regKey(tgId));
  const idx = (await get<number[]>(INDEX_KEY)) ?? [];
  const next = idx.filter((id) => id !== tgId);
  if (next.length !== idx.length) await put(INDEX_KEY, next);
}

export async function readRegistrationIndex(): Promise<number[]> {
  return (await get<number[]>(INDEX_KEY)) ?? [];
}
