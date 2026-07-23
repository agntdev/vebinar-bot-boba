# Боб's Webinar Registration Bot — Bot specification

**Archetype:** booking

**Voice:** professional and warm — write every user-facing message, button label, error, and empty state in this voice.

Telegram bot for managing webinar registrations, collecting participant contacts, sending reminders, and notifying organizers via Telegram channel/group. Handles registration flow, automated reminders (24h/1h before event), and real-time registration notifications to admin channel.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- existing students/clients of Боб
- new subscribers
- general public

## Success criteria

- 100+ confirmed registrations tracked
- 90% reminder delivery rate to non-blocked users
- real-time admin notifications for all new registrations

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with webinar info and registration button
- **Записаться** (button, actor: user, callback: registration:start) — Initiate registration flow
  - inputs: name, email, phone
  - outputs: confirmation message, calendar invite
- **/cancel** (command, actor: user, command: /cancel) — Cancel registration

## Flows

### registration_flow
_Trigger:_ registration:start

1. Collect name and surname
2. Collect email
3. Collect phone number
4. Confirm data
5. Send confirmation

_Data touched:_ Registration

### reminder_flow
_Trigger:_ event:pre_start_24h

1. Send reminder message with event details

_Data touched:_ Registration

### admin_notification_flow
_Trigger:_ registration:confirmed

1. Send notification to admin channel/group with participant details

_Data touched:_ Registration

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Event** _(retention: persistent)_ — Webinar details including date/time, topic, and broadcast link
  - fields: date_time, topic, broadcast_link, organizer_timezone
- **Registration** _(retention: persistent)_ — Participant information and registration metadata
  - fields: name, surname, email, phone, telegram_id, registration_timestamp, reminder_status
- **ReminderSchedule** _(retention: session)_ — Scheduled reminder times
  - fields: 24h_before, 1h_before

## Integrations

- **Telegram** (required) — Bot API messaging and channel notifications
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Set webinar details (date/time, topic, broadcast link)
- Configure admin notification channel/group ID
- Generate CSV export of registrations

## Notifications

- Personal reminders to participants (24h/1h before event)
- Admin channel/group notifications on new registrations
- Calendar invite (ICS) sent after registration

## Permissions & privacy

- Collects personal contact info with explicit opt-in
- Stores data for event duration only
- Allows user to cancel registration at any time

## Edge cases

- Blocked users - skip reminders
- Timezone conversion for event display
- Invalid email/phone format handling
- Duplicate registrations from same Telegram ID

## Required tests

- End-to-end registration flow with data validation
- Reminder delivery to non-blocked users
- Admin channel notification on registration
- Timezone conversion display test

## Assumptions

- Single active webinar at a time
- Default to organizer's timezone for event display
- Basic format validation for email/phone
- Open registration without invite codes
