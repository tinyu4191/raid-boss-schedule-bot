# raid-boss-schedule-bot

Discord bot that watches raid-boss signup Forum channels (one discussion
thread per team) and keeps a weekly schedule Embed in sync in a separate
channel, sends a pre-raid reminder, and does its best to auto-fix a
near-miss thread title. Supports many bosses across many servers, all
configured entirely through `.env` — adding a boss, a server, or changing
how something looks is a config change, not a code change.

## How it works

1. Each boss is defined by a numbered `BOSS_<n>_*` block in `.env` (name +
   signup channel + schedule channel, plus a handful of optional fields
   covered below). The bot reads this list once at startup.
2. Team captains create/rename discussion threads in the signup Forum using
   a fixed title format (see [Thread title format](#thread-title-format)).
   The bot never touches the thread's content — captains own the roster
   and details — but it will try to fix the *title* if it's close but not
   quite right (see [Thread title auto-fix](#thread-title-auto-fix)).
3. On every `threadCreate` / `threadUpdate` / `threadDelete` in a
   configured signup channel, the bot re-reads **all** threads in that
   channel, groups them by week (Tue–Mon, Asia/Taipei time), and
   edits/sends one Embed per week into the schedule channel. One message
   per boss per week — edited in place, never re-posted — so the channel
   doesn't get spammed. This also runs once a day regardless of activity
   (see [Daily midnight resync](#daily-midnight-resync)), and once every
   minute the bot separately checks for raids starting soon (see
   [Pre-raid reminders](#pre-raid-reminders-30-minutes-before)) and for
   still-short-handed teams a day out (see
   [24-hour missing-people nudge](#24-hour-missing-people-nudge)).

## Quick setup

```bash
npm install
cp .env.example .env
# fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID, and at least BOSS_1_*
# — see "Configuring .env" below for what each of those needs

npm run deploy-commands   # registers /listboss and /syncboss
npm start
```

See [Bot permissions / intents needed](#bot-permissions--intents-needed)
before inviting the bot to a server — a few things (Message Content
intent, Manage Threads) have to be turned on or the bot will fail to
start or silently can't do part of its job.

## Configuring `.env`

Everything the bot does per-boss is driven by a numbered `BOSS_<n>_*`
block. This section covers every field, from the minimum needed to get
one boss running up through the more advanced setups (multiple servers,
one Forum shared by several bosses, custom look-and-feel).

### The basics

```
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=111111111111111111   # default server — see "Multiple servers" below
```

### One boss = one signup Forum (the common case)

```
BOSS_1_NAME=樹王
BOSS_1_SIGNUP_CHANNEL_ID=123456789012345678
BOSS_1_SCHEDULE_CHANNEL_ID=123456789012345679
BOSS_1_EMOJI=🌳
BOSS_1_COLOR="#57F287"
```

- Numbers don't need to be contiguous or start from any particular value —
  every `BOSS_<n>_NAME` actually present is picked up in ascending order,
  gaps and all. Pick any unused number for a new boss (continuing past the
  current max is the obvious convention, but not required).
- `EMOJI` / `COLOR` are optional and default to `⚔️` / `#57F287`.
- **Quote `COLOR`'s value.** `dotenv` treats an unquoted `#` as the start
  of a comment and silently truncates the rest of the line — including
  the `#` itself — so `BOSS_1_COLOR=#ED4245` (no quotes) quietly becomes
  an empty value and the bot falls back to the default color with no
  error. Always write `BOSS_1_COLOR="#ED4245"`.
- Get a channel ID: enable Developer Mode in Discord, then right-click the
  channel → Copy Channel ID.
- Changes to `.env` require a bot restart to take effect.

### Shared styles across bosses (`STYLE_<n>_*`)

The same boss (樹王, 龍王, ...) often repeats across several guild
sections with identical emoji/color/status-emoji. Instead of repeating
those on every `BOSS_<n>` block, define the look once by name:

```
STYLE_1_NAME=樹王
STYLE_1_EMOJI=🌳
STYLE_1_COLOR="#57F287"
# STYLE_1_FULL_EMOJI=🈵        (optional — see "Custom status emoji" below)
# STYLE_1_MISSING_EMOJI=🈸

STYLE_2_NAME=龍王
STYLE_2_EMOJI=🐉
STYLE_2_COLOR="#ED4245"
```

Any `BOSS_<n>_NAME` matching a `STYLE_<n>_NAME` picks up that styling
automatically. Resolution order, independently for each field: the
`BOSS_<n>_*` value if explicitly set (a per-instance override) → the
matching `STYLE_<n>` entry by name → the hardcoded default. `STYLE_<n>`
numbering is independent of `BOSS_<n>` numbering, and — same as
`BOSS_<n>` — doesn't need to be contiguous.

### Multiple Discord servers, one bot

The bot doesn't care how many servers it's in — thread events are matched
purely by channel ID, which is globally unique. The only thing that needs
telling apart is which boss belongs to which server, which the top-level
`GUILD_ID` handles as a **default**:

```
GUILD_ID=111111111111111111        # default guild for any boss below that doesn't override it

BOSS_1_NAME=樹王                    # no BOSS_1_GUILD_ID -> uses the default above
BOSS_1_SIGNUP_CHANNEL_ID=...
BOSS_1_SCHEDULE_CHANNEL_ID=...

BOSS_2_NAME=蝴蝶王                  # a boss in a *different* server
BOSS_2_GUILD_ID=222222222222222222 # overrides the default for this boss only
BOSS_2_SIGNUP_CHANNEL_ID=...
BOSS_2_SCHEDULE_CHANNEL_ID=...
```

To bring a second server online:

1. Invite the same bot application to the new server (same OAuth2 invite
   flow as the first one — Developer Portal → OAuth2 → URL Generator →
   pick the new server when authorizing). Make sure both `bot` and
   `applications.commands` scopes are checked — missing the latter is a
   common cause of `/listboss` and `/syncboss` failing to register on a
   newly-added server even though the bot itself works fine there.
2. Add the new server's `BOSS_<n>_*` block to `.env`, with its own
   `BOSS_<n>_GUILD_ID`.
3. Run `npm run deploy-commands` again — it registers `/listboss` and
   `/syncboss` to every distinct guild ID found across `GUILD_ID` and all
   `BOSS_<n>_GUILD_ID` values, so the new server gets the commands too
   without affecting the others. Each server is handled independently —
   one server failing (bot not actually invited yet, missing scope, etc.)
   doesn't block the rest from succeeding.
4. Restart the bot (`pm2 restart` / `npm start`).

`/listboss` and `/syncboss` are guild-aware: run in server A, they only
show/act on server A's bosses, even though it's all one bot process and
one `.env` file.

### Shared forum, multiple bosses via Discord tags

Some servers don't run one signup Forum per boss — every team posts into
the same Forum, and Discord's own **Forum tags** feature distinguishes
which boss it's for (often mixed with unrelated tags like time-of-day or
session length, which the bot simply ignores). `BOSS_<n>_TAGS` turns a
config into this mode:

```
BOSS_8_NAME=ESC混合突襲池              # a label for you/DB/listboss — not shown per-entry
BOSS_8_SIGNUP_CHANNEL_ID=...           # the one shared Forum
BOSS_8_SCHEDULE_CHANNEL_ID=...
BOSS_8_TAGS=普拉,困拉,龍王             # tag names (as configured on the Forum) that mean "this is boss X"
```

How it resolves per thread: the bot reads the thread's applied Forum tags,
maps each tag ID to its name via the Forum's own tag list, and the first
name that matches `BOSS_<n>_TAGS` becomes that thread's boss label. If the
tag's name itself has an emoji baked in (e.g. a tag literally named
`⏰拉圖`), that leading emoji is stripped off, matched against the plain
name (`拉圖`), and reused as the boss's display emoji — so `BOSS_<n>_TAGS`
only ever needs the plain names, whichever way the tags happen to be
named. Any other applied tag (早/中/晚, 連7/連14, etc.) that isn't in the
list is simply not looked at — there's no need to tell the bot they exist.

The schedule for a shared config mixes every boss into one weekly embed,
sorted by time. Since the arrow already links to the thread, and Discord
renders that thread's own title inline right after it, repeating the team
name/status text in the embed line would just be a duplicate of what's
already shown — so instead, the part after `｜` shows **which boss this
is**: the Forum tag's own configured emoji if it has one (or one baked
into its name, per above), falling back to `STYLE_<n>_EMOJI` by name, or
`【王名】` as a last resort when nothing else is set. That's usually all
one needs at a glance; the full team name and status are one click away
via the thread link. Example:

```
🗓️ 本週出團行程表
**09/22 (二)**
🈸 20:00 ｜⚔️ → [討論串]
🈵 21:00 ｜🐉 → [討論串]
```

A thread with no matching boss tag applied (captain forgot to tag it)
still shows up, labeled **未標籤突襲**, rather than silently vanishing —
unlike a malformed title, a missing tag is usually a one-off mistake worth
surfacing so someone notices and fixes it.

Reminders (30-minute pre-raid pings) work the same way in this mode: the
reminder embed's title uses the thread's resolved boss label instead of a
fixed boss name.

Adding a new boss later is a two-step, no-restart-of-the-forum-structure
change: create the new tag on the Forum channel in Discord, then add its
name to `BOSS_<n>_TAGS` in `.env` and restart the bot.

### Separate reminder channel (`BOSS_<n>_REMINDER_CHANNEL_ID`)

Pre-raid reminders default to posting in the same channel as the weekly
schedule embed (`BOSS_<n>_SCHEDULE_CHANNEL_ID`). That's fine for a typical
one-boss-one-channel-pair setup, but when several `BOSS_<n>` configs
(different signup Forums) all point at the *same* schedule channel — one
server's "everything in one place" setup — that channel ends up mixing
several long-lived, repeatedly-edited schedule embeds with a stream of
one-off reminder pings, which gets busy fast. Point reminders somewhere
else instead:

```
BOSS_9_NAME=闇黑龍王
BOSS_9_SIGNUP_CHANNEL_ID=...
BOSS_9_SCHEDULE_CHANNEL_ID=boss王團聯絡簿的頻道ID      # shared with other bosses
BOSS_9_REMINDER_CHANNEL_ID=另外開的提醒頻道ID          # this boss's reminders go here instead
```

Optional — omit it and reminders keep going to the schedule channel
exactly as before. `/listboss` shows `（提醒另發 #頻道）` next to any boss
where this is set, so you can confirm it's wired up without checking
`.env` directly.

### Custom status emoji (`FULL_EMOJI` / `MISSING_EMOJI`)

The 🈵 (full) / 🈸 (missing people) status emoji shown on every schedule
line default to those two, but some servers want their own — same
override pattern as `EMOJI`/`COLOR`, and also available on `STYLE_<n>` as
a shared default:

```
BOSS_1_FULL_EMOJI=🔴
BOSS_1_MISSING_EMOJI=🟢
```

Resolution order, independently for each of the two: its own
`BOSS_<n>_*_EMOJI` if explicitly set → the matching `STYLE_<n>` entry by
name → the hardcoded default (`🈵` / `🈸`).

### Bot permissions / intents needed

- Gateway intents: `Guilds`, `GuildMessages`, `MessageContent` (already set
  in `src/index.js`). `MessageContent` is a **privileged** intent — it also
  needs to be toggled on in the Developer Portal (Bot page → Privileged
  Gateway Intents → Message Content Intent), or the bot will fail to start
  with a "disallowed intents" error. Restart the bot after toggling it.
- Bot permissions in the signup Forum: View Channel, Read Message History,
  **Manage Threads** (needed to rename a thread — see
  [Thread title auto-fix](#thread-title-auto-fix)), Send Messages (for the
  "please fix the title manually" notice), and **Mention @everyone, @here,
  and All Roles** (needed for the
  [24-hour missing-people nudge](#24-hour-missing-people-nudge) — without
  it, that message still sends but the `@everyone` silently doesn't ping
  anyone).
- Bot permissions in the schedule channel and reminder channel (if
  different): Send Messages + Embed Links.
- A channel's permissions can differ from the server's overall
  integration permissions if it has its own overwrites — when the bot
  works in most channels but not one specific one, check that channel's
  own permission settings, not just the server-wide integration page.

## Thread title format

```
MM/DD(週X) HH:mm｜已滿
MM/DD(週X) HH:mm｜<團名>
MM/DD(週X) HH:mm｜<缺人資訊，含「缺」或「-」，格式自由>
MM/DD(週X) HH:mm｜<團名><缺人資訊>
```

Examples:
```
08/20(三) 20:00｜缺2(劍士,弓箭手)
08/20(三) 20:00｜已滿
08/20(三) 20:00｜無敵樹王團(-2打手)
08/20(三) 20:00｜屠龍小隊
09/19(六) 14:00｜叭叭後面有樹王拓荒-兩法 -火
```

- `｜` is the full-width pipe (half-width `|` also works).
- The weekday text inside `()` after the date is not validated — it's for
  humans.
- **Team names are optional.** After `｜`: the literal `已滿` means full,
  no name. Anything that contains **neither** `缺` nor `-` is treated as a
  full team's name (e.g. `屠龍小隊` alone means that team is full).
  Otherwise, everything from the **first** `缺` or `-` onward is shown
  **verbatim** as-is in the schedule — there's no attempt to parse out a
  structured headcount or class list, since real usage varies too much for
  that to hold up (Arabic numerals, Chinese numerals like `兩`, multiple
  `-X -Y` segments, parens wrapping the whole thing or not — all of it is
  just passed through). Everything before that first marker is the team
  name.
- A title that doesn't match this pattern is silently ignored (not shown
  as an error, just excluded from the schedule) — unless it's close
  enough to auto-fix; see below.

## Thread title auto-fix

Most bad titles are just full-width characters or stray whitespace, not
genuinely wrong information — so at the moment a thread is **created or
edited** (not during periodic scans), if the title fails the strict format
above, the bot tries a best-effort fix and, if successful, renames the
thread on the spot:

- Full-width digits/slash/colon/parens (`９２１`, `／`, `：`, `（）`) are
  converted to their half-width equivalents.
- Missing, extra, or inconsistently-placed whitespace around the date,
  weekday, and time is normalized.
- A missing `｜` separator is simply inserted — nothing needs to be found
  for this, since the rebuilt title always includes one.
- The date, weekday-parens, and time may appear in **any order** in the
  original title; each is located and removed independently, so the
  result is correct even when they're scrambled or interleaved with the
  name/status text.
- The weekday shown in the fixed title is **recomputed from the date**,
  never trusted from the original text — this fixes a wrong weekday for
  free and means a missing weekday-parens block isn't a blocker either.
- Whatever text is left after removing the date/weekday/time/separator
  becomes the name/status portion, trimmed only at the outer edges —
  internal spacing (e.g. between a team name and its status) is left
  exactly as typed.

This is deliberately a best-effort pass, not a full parser: it requires
finding *at least* a valid date and a valid time somewhere in the title,
and a title whose name/status text happens to contain something
date- or time-shaped could confuse it. When it can't find enough to work
with, it does **not** guess — instead it @-mentions the thread's creator
once (via a database-tracked flag, so it doesn't repeat on every further
edit) asking them to fix the title by hand.

## Schedule output

- One Embed per boss per week, grouped by day, sorted by parsed date/time
  (not thread-creation time).
- 🈵 = full, 🈸 = still needs people (customizable — see
  [Custom status emoji](#custom-status-emoji-full_emoji--missing_emoji)).
- Threads whose date/time has already passed are shown with strikethrough
  and `*(已結束)*`, not removed — they naturally drop off once that week's
  message is replaced by the next week's, and are kept accurate day to day
  by the [daily midnight resync](#daily-midnight-resync) even with no
  thread activity.
- A week with zero valid threads shows a plain-text
  "🌳 <王名>突襲 — 本週尚無隊伍報名" instead of an embed (or a generic
  "🗓️ 本週尚無隊伍報名" in shared/tag mode).

## Pre-raid reminders (30 minutes before)

Every minute, the bot scans every configured boss's active signup threads
and, once a thread's parsed raid time is 30 minutes away (and only once
per thread), posts a reminder to that boss's **reminder channel** — a new
message, separate from the weekly schedule embed. This defaults to the
same channel as the schedule embed, or a dedicated channel if
`BOSS_<n>_REMINDER_CHANNEL_ID` is set (see above).

The reminder pulls its roster and channel info from the thread's
**starter message** (the original post that created the thread), not the
title:

- **Roster** = the thread's creator (the captain, detected automatically
  via Discord's own thread-ownership data) **plus** everyone the captain
  `@mentions` in that starter message. Captains are expected to edit the
  roster into the starter post as people confirm. Nicknames/class tags
  written next to each mention are just decoration for humans; the bot
  only reads the mention itself. A role mention (e.g. `@麵包師們`, used to
  broadcast for interest rather than confirm a roster) is never included —
  Discord keeps role mentions structurally separate from user mentions, so
  this happens automatically with no special-casing needed.
- **In-game channel (CH)** is read from free text in the starter message
  matching `頻道88`, `頻道：88`, `CH88`, `CH 231`, etc. (`頻道` or `CH`,
  case-insensitive, directly followed by a number). If the captain hasn't
  posted a channel number yet, the reminder shows "⚠️ 待隊長另行公布"
  instead of blocking.

This requires the bot to read message content, which needs the
**Message Content** privileged intent — see
[Bot permissions / intents needed](#bot-permissions--intents-needed).
Editing the starter message any time before the 30-minute mark is picked
up correctly, since the bot re-reads it fresh at reminder time rather than
caching an earlier version.

## 24-hour missing-people nudge

Separate from the 30-minute reminder above, the same every-minute scan
also checks: is this thread's raid time within 24 hours, **and** is it
still marked as missing people (`isFull: false` from the title)? If both,
the bot posts a one-time `@everyone` nudge **directly in that thread**
(not the schedule/reminder channel) —

```
@everyone 距離出團時間還有 24 小時，這團目前還缺人，想報名的人趕快喔！
```

— to attract sign-ups from people who aren't already watching that
specific thread. A few things worth knowing about how this is scoped:

- **Only fires for teams still missing people.** An already-full team
  never gets this nudge — there's nothing to attract more people for.
- **Fires at most once per thread**, tracked the same way as the
  30-minute reminder (a DB flag), regardless of how long the team stays
  short-handed afterward. It's a one-time attention-getter, not a
  recurring nag.
- **Needs its own permission** — Mention @everyone, @here, and All Roles
  — in the signup Forum. Without it, Discord still lets the message send,
  but the `@everyone` inside it silently doesn't notify anyone; see
  [Bot permissions / intents needed](#bot-permissions--intents-needed).
- Independent of shared/tag mode — this only looks at the thread's own
  title, so it behaves identically whether its signup Forum serves one
  boss or several via `BOSS_<n>_TAGS`.

## Daily midnight resync

The schedule embed only gets re-edited when something actually happens in
its signup forum (a thread created, edited, archived, or deleted). On a
quiet day, an entry that crosses its raid time doesn't pick up its
`~~已結束~~` strikethrough until the next unrelated thread event happens
to touch that boss — which might not be until the next signup. To keep
"已結束" accurate regardless, every boss gets a full resync once a day at
Asia/Taipei 00:00, independent of any thread activity.

## Commands

- `/listboss` — lists the bosses currently loaded from `.env` for the
  server it's run in, including which channel reminders go to when it
  differs from the schedule channel.
- `/syncboss name:<王名>` (requires Manage Server) — manually re-runs the
  sync for one boss. Useful right after editing `.env` + restarting, or if
  you ever suspect a missed event, without waiting for the next thread
  change.

## Operational scripts

- `npm run check-status` — connects to Discord and, for every boss in
  `.env`, actually tries to fetch its signup + schedule channels (not
  just read the `.env` values), then reports per-boss and per-server
  whether the bot can really see them. Useful after adding a new server
  or boss, instead of checking `/listboss` in every server one by one or
  waiting for a thread event to surface a permissions problem in the
  logs. Exits with a non-zero status if anything failed, so it's also
  usable in a script.

## Adding a new boss

Append the next `BOSS_<n>_*` block to `.env`, save, restart the bot.
Example — adding 龍王 as boss #2:

```
BOSS_2_NAME=龍王
BOSS_2_SIGNUP_CHANNEL_ID=...
BOSS_2_SCHEDULE_CHANNEL_ID=...
BOSS_2_EMOJI=🐉
BOSS_2_COLOR="#ED4245"
```

No deploy, no DB migration, no slash command. (Unless the boss is on a
server the bot hasn't been invited to yet — see
[Multiple Discord servers, one bot](#multiple-discord-servers-one-bot).)

## Data storage

SQLite (`better-sqlite3`), file at `./data.sqlite` (gitignored). Boss
definitions themselves live in `.env`, not the DB — these tables only
track state that has to persist between restarts:

- `weekly_summary_messages` — which Discord message ID represents which
  (guild, boss, week), so re-syncs edit in place instead of re-posting.
- `reminded_threads` — which threads have already had their 30-minute
  reminder sent, so the periodic scan never double-sends.
- `title_fix_notices` — which threads have already gotten a "please fix
  your title manually" notice, so a captain who doesn't fix it isn't
  @-mentioned again on every subsequent edit.
- `day_before_notices` — which threads have already gotten the 24-hour
  missing-people `@everyone` nudge, so it only ever fires once per thread.

## Known limitations / next iterations

- Captains maintain the title by hand (auto-fix handles formatting
  mistakes, not wrong information); auto-updating titles from
  thread-member joins/leaves was deliberately deferred to keep this
  simple.
- No pagination — designed for up to ~10 threads/week per boss without
  the Embed hitting Discord's field/character limits.
- Boss config changes need a bot restart (`.env` is only read at
  startup).
- Multi-server is supported, but each new server still needs its own
  OAuth invite + a `deploy-commands` run.
