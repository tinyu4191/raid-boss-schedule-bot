# raid-boss-schedule-bot

Discord bot that watches raid-boss signup Forum channels (one discussion
thread per team) and keeps a weekly schedule Embed in sync in a separate
channel. Supports multiple bosses per server (each with its own signup
channel + schedule channel pair), configured entirely through `.env` —
adding a new boss is a config change, not a code change (and no DB
migration or slash command needed either).

## How it works

1. Each boss is defined by a numbered `BOSS_<n>_*` block in `.env` (name +
   signup channel + schedule channel, optionally emoji/color). The bot
   reads this list once at startup.
2. Team captains create/rename discussion threads in the signup Forum using
   a fixed title format (see below). The bot never touches the thread
   itself — captains own the title.
3. On every `threadCreate` / `threadUpdate` / `threadDelete` in a
   configured signup channel, the bot re-reads **all** threads in that
   channel, groups them by week (Tue–Mon, Asia/Taipei time), and
   edits/sends one Embed per week into the schedule channel. One message
   per boss per week — edited in place, never re-posted — so the channel
   doesn't get spammed.

## Thread title format

```
MM/DD(週X) HH:mm｜已滿
MM/DD(週X) HH:mm｜缺N(職業1,職業2,...)
```

Examples:
```
08/20(三) 20:00｜缺2(劍士,弓箭手)
08/20(三) 20:00｜已滿
08/22(五) 21:30｜缺1(火)
```

- `｜` is the full-width pipe (half-width `|` also works).
- The weekday text inside `()` after the date is not validated — it's for
  humans.
- Classes are free text — whatever the captain types is shown as-is (no
  fixed enum), so "力職" or "火" work the same as spelling out a full class
  name.
- A title that doesn't match this pattern is silently ignored (not shown
  as an error, just excluded from the schedule).

## Schedule output

- One Embed per boss per week, grouped by day, sorted by parsed date/time
  (not thread-creation time).
- 🈵 = full, 🈸 = still needs people.
- Threads whose date/time has already passed are shown with strikethrough
  and `*(已結束)*`, not removed — they naturally drop off once that week's
  message is replaced by the next week's.
- A week with zero valid threads shows a plain-text
  "🌳 <王名>突襲 — 本週尚無隊伍報名" instead of an embed.

## Setup

```bash
npm install
cp .env.example .env
# fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID, and at least BOSS_1_*

npm run deploy-commands   # registers /listboss and /syncboss
npm start
```

### `.env` boss configuration

```
BOSS_1_NAME=樹王
BOSS_1_SIGNUP_CHANNEL_ID=123456789012345678
BOSS_1_SCHEDULE_CHANNEL_ID=123456789012345679
BOSS_1_EMOJI=🌳
BOSS_1_COLOR=#57F287
```

- Numbering starts at `1` and must be contiguous — the bot stops reading
  at the first missing `BOSS_<n>_NAME`, so don't leave a gap.
- `EMOJI` / `COLOR` are optional and default to `⚔️` / `#57F287`.
- Get a channel ID: enable Developer Mode in Discord, then right-click the
  channel → Copy Channel ID.
- Changes to `.env` require a bot restart to take effect.

### Bot permissions / intents needed

- Gateway intents: `Guilds`, `GuildMessages` (already set in `src/index.js`)
- Bot permissions in the server: View Channel, Send Messages, Manage
  Threads or at least read access to the signup Forum, and Send
  Messages + Embed Links in the schedule channel.

## Commands

- `/listboss` — lists the bosses currently loaded from `.env`.
- `/syncboss name:<王名>` (requires Manage Server) — manually re-runs the
  sync for one boss. Useful right after editing `.env` + restarting, or if
  you ever suspect a missed event, without waiting for the next thread
  change.

## Adding a new boss

Append the next `BOSS_<n>_*` block to `.env`, save, restart the bot.
Example — adding 龍王 as boss #2:

```
BOSS_2_NAME=龍王
BOSS_2_SIGNUP_CHANNEL_ID=...
BOSS_2_SCHEDULE_CHANNEL_ID=...
BOSS_2_EMOJI=🐉
BOSS_2_COLOR=#ED4245
```

No deploy, no DB migration, no slash command.

## Data storage

SQLite (`better-sqlite3`), file at `./data.sqlite` (gitignored). One table:

- `weekly_summary_messages` — tracks which Discord message ID represents
  which (guild, boss, week) so re-syncs edit in place instead of
  re-posting. Boss definitions themselves live in `.env`, not the DB.

## Known limitations / next iterations

- Captains maintain the title by hand (Plan A from the design discussion);
  auto-updating titles from thread-member joins/leaves was deliberately
  deferred to keep v1 simple.
- No pagination — designed for up to ~10 threads/week per boss without
  the Embed hitting Discord's field/character limits.
- Boss config changes need a bot restart (`.env` is only read at startup).
- Single-guild by design (`GUILD_ID` is required) — matches the current
  server setup where every boss's channel pair lives in the same guild.
