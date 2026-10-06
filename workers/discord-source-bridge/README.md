# SillyTavern SRL Discord Bridge

A small self-hosted Cloudflare Worker used by SRL to save selected Discord messages into the user's local resource library and, when the user explicitly asks, check a saved Discord source for updates.

The Bridge is intentionally isolated from the SRL application. Each user deploys their own Worker and D1 database in their own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fjixiangruyi117%2FSRL-Discord-Bridge)

## What it does

For Bot replies without a message Apps menu, copy the actual Discord attachment URL
and run `/下载直链 链接:<download URL>`. This slash command uses the same paired resource
queue and attachment deduplication as the message download command; it does not save
post text. Only Discord CDN URLs are accepted, not message links or arbitrary websites.
The URL validator matches SRL Android's share parser, including Discord attachment URL
path variants. Expired pasted links require a fresh URL; ephemeral messages cannot be
reread by the Bot. Register commands again after updating the Worker.

If you cannot use Discord's message Apps menu, copy the Bot message text and run
`/粘贴收件 正文内容:<copied message text>` in a Discord DM, server channel, or thread.
The command extracts Discord CDN attachment links and queues them in the paired library;
it does not save the pasted post text. It is a user-installed slash command, so the Bot
does not need access to the original server. Expired signed links must be copied again.
`/下载直链` remains available for a single copied attachment URL.

The unsupported `/保存首楼帖子` and `/保存所有已标注信息` commands have been removed.
Register commands again after deploying this update to remove any old entries from the
Discord App.

SRL also supports paired temporary queues: `保存帖子到SRL（云端暂存）` saves a selected post;
`下载资源到SRL（云端暂存）` extracts supported Discord attachment links into a separate resource
queue. `/绑定资源库` uses a one-time pairing code from SRL. Both queues target the
paired endpoint and retain tasks for seven days. Legacy `保存到资源库` and its
one-time handoff remain available.

After updating the Worker, register commands in SRL connection settings to apply
the names. Registration renames the two previous cloud commands in place and
removes only their duplicate old names if both versions exist. Legacy direct
handoff and unrelated commands are preserved. Already cached old cloud command
interactions remain accepted. Worker backend updates alone do not require a new
SRL APK or Discord App installation.

The handoff page provides a compact progress receipt, an Android deep link and
copy-to-Web/PWA actions. Status refresh does not claim the post. If clipboard
access fails, a selectable temporary link remains available.

After SRL confirms that a post has been saved and read back locally, its cloud
body, attachment metadata and handoff chunks are deleted in the same transaction
as its saved/waiting-binding receipt. After a resource is fully imported, its
download URL and Discord channel/message identifiers are cleared. Downloading,
failed imports and pending version choices keep their transport data for retry.
Small status/deduplication receipts remain until their existing expiry; completed
tasks no longer provide their post body or a resource download URL. Older completed
tasks are cleared on a subsequent cleanup-triggering request. An hourly Cron also
deletes expired payloads, tasks, pairing codes and receipts without user activity.
Expiry deletion is independent of completed-data cleanup failures; temporary
database failures are retried by the next scheduled run, and incomplete runs fail
visibly in Cloudflare. The active library pairing remains available for new jobs.

Resource files are downloaded by the client, using the existing Android WorkManager
transport or an authenticated streaming Worker response for Web/iOS. Binary files
are not stored in D1. The local importer owns content deduplication and version
decisions; a downloaded file is not reported as imported until that owner commits.
iOS requires an open page. Android can continue an already claimed native download;
receiving new jobs and resuming parsing after process termination require reopening
SRL. No push or headless import service is included.

```text
Discord Message Context Command
  → your Cloudflare Worker
  → short-lived one-time D1 handoff
  → your local SRL

User taps “检查更新” in SRL
  → your Cloudflare Worker
  → bounded read-only Discord API check
  → comparison / confirmation happens in your local SRL
```

The Worker:

- verifies Discord interaction signatures with Ed25519;
- accepts only the selected message from the Message Context Command;
- stores the normalized capture in D1 under a high-entropy one-time token;
- expires handoffs after a short TTL;
- allows the handoff to be consumed once by SRL;
- performs a bounded, read-only source check only when SRL explicitly requests one;
- does not persist source-refresh responses in D1;
- does not act as a permanent Discord archive.

For a thread/forum source, the refresh read is intentionally bounded and only returns messages relevant to SRL's source model: the starter, messages from the starter author, Bot/Webhook messages, and already-saved message IDs. It does not silently archive arbitrary participant comments.

A user-installed Message Command can save the interaction snapshot even when this Bot is not a member of that community. Automatic refresh is different: it uses `DISCORD_BOT_TOKEN`, so the Bot must be in the guild and able to view the source channel. When that access is absent, the Worker reports the source as temporarily uncheckable instead of claiming that the post was deleted. SRL then uses manual refresh for that source: running the same Message Command again updates the existing local source instead of creating a duplicate.

## Required values

Cloudflare deployment asks for the Discord values belonging to **your own Discord App**:

- `DISCORD_APPLICATION_ID`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_BOT_TOKEN` — store this as a secret

The D1 binding name is fixed to `DB`.

## Routes

- `POST /interactions` — Discord Interactions Endpoint
- `GET /health` — connection check used by SRL
- `GET /setup/status` — checks the real Discord Message Command registration
- `POST /setup/register` — registers legacy/post/resource Message Commands and pairing
- `POST /source/read` — authenticated, bounded, read-only source check used by SRL
- `POST /source/messages/check` — checks a bounded batch of explicitly saved message IDs
- `GET /handoff/:token` — one-time SRL handoff
- `GET /open/:token` — opens SRL with the handoff token
- `GET /inbox/resources` — paired resource queue and recent receipts (bounded pages)
- `GET /inbox/resources/:id` — paired task and a validated/refreshed Discord URL
- `GET /inbox/resources/:id/file` — authenticated CDN streaming response, no redirects
- `POST /inbox/resources/:id/ack` — local download/import/version-choice status

Resource routes require the existing endpoint secret and `X-SRL-Library-ID` header.
Only HTTPS Discord CDN attachment paths are accepted. Refreshing an expired URL
requires Bot access to the selected original message; otherwise SRL asks the user
to resend. Apply migration `0003_resources.sql` along with the existing migrations
before deploying through Wrangler. Dashboard-generated code initializes the same
schema. Update SRL and the Android shell before enabling native resource intake.

Users normally do not need to type these routes. SRL derives them automatically from the Worker root URL. For Android and iOS web apps, the `/open/:token` page can copy a temporary link to paste inside the intended app; this keeps the handoff in that app's own local storage context and does not require an SRL site URL setting.

## Deploy without GitHub / GitLab

SRL also provides a browser-only Cloudflare deployment guide. It generates a Quick Editor version from this same Worker source and adds idempotent D1 schema initialization, so users without a Git account do not need Wrangler or manual SQL.

## Privacy boundary

This repository contains no SRL library data, no Discord credentials and no user content. Credentials are supplied by each user to their own Cloudflare deployment. Discord Message Context Command payloads are kept only long enough to complete the one-time handoff to the user's local SRL. Large handoffs are split across temporary D1 rows instead of being limited by one row's size; total capacity still depends on the user's Cloudflare account and database limits. The Bridge can read up to two `.txt` attachments per message, at up to 1 MB each and 2 MB total per request, from Discord's HTTPS CDN; the client keeps that text in the local source record. Other attachments remain links. Source-refresh reads are initiated by the user, returned directly to SRL, and are not stored by the Bridge.

## Development

Outgoing attachment and message requests use `redirect: 'manual'` and reject non-success
responses. Workers does not implement `redirect: 'error'`; using it causes an exception
before the CDN download starts. Completed resource jobs reject repeated claims with
`409 resource_already_imported` after successful import acknowledgement clears their links.

```bash
npm ci
npm run typecheck
```

For a normal Wrangler deployment:

```bash
npm run deploy
```

The deploy script applies D1 migrations and then deploys the Worker.

For automatic deployment, connect this repository to the Worker with Cloudflare Workers Builds,
use `main` as the production branch, `npm run typecheck` as the build command, and
`npm run deploy` as the deploy command. Keep non-production branch deployments disabled unless
you explicitly need preview Workers. Discord credentials remain Cloudflare secrets and must never
be committed to Git.
