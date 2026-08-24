# Traccoon Assistant for Obsidian

Chat with your personal [Traccoon](https://github.com/mcules/Traccoon) assistant from inside
Obsidian, approve the tools it wants to use, and turn a note into a Traccoon ticket.

Unlike Claudian, this plugin runs no agent locally. The assistant lives in Traccoon with your
provider token, your MCP servers and your permission rules; the plugin is the client that
talks to it. Vault access happens the way it always did — through the assistant's own
Obsidian MCP server — so a message names a note by path instead of pasting it.

## What it does

- **Chat** — the same conversation as `Assistant → Chat` in the web interface
  (`GET/POST /api/assistant/chat`), including the archive.
- **Permission cards** — when a run stops at a tool gate (`status = awaiting`), the message
  shows the tool and the three buttons *Once* / *Always* / *Never*
  (`POST /api/assistant/chat/{id}/decide`).
- **Live run** — tool calls, agent text and the end of a run arrive over the office websocket
  (`/api/ws`, envelope from `backend/app/services/office.py`) while the run is going.
- **Context** — the active note path, and the selection if you made one, travel with the
  message. The chip above the input has an `x` that drops it; it stays dropped until you click
  the chip again, also across a change of note. Settings turn it down to path-only or off.
- **Context** — a thin bar under the header shows how full the window was on the last run of
  this conversation, with the numbers in its tooltip. Needs the `context` field on the session
  payload (`docs/HANDOVER-context-fill.md`); without it the bar stays hidden.
- **Tickets** — `Create ticket from this note` opens a small form (project, summary,
  priority, description) and writes the resulting key back into the note as a link.

## Install

### From a release (any device, phone included)

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then *Add beta plugin* with
`mcules/obsidian-traccoon`. BRAT pulls the release and keeps it updated. On a phone this is
the whole installation — there is nothing to build there.

Manual alternative: download `main.js`, `manifest.json` and `styles.css` from the latest
release into `<vault>/.obsidian/plugins/traccoon-assistant/`.

### From source

```
npm install
npm run build
npm run deploy         # needs TRACCOON_VAULT=… or a vault.local file with the path
```

Then enable *Traccoon Assistant* under Settings → Community plugins, set the server URL
(the frontend address, without `/api`) and paste an access token.

Create the token in Traccoon under Settings → Personal → Access tokens. Scopes:

- `assistant` — the chat, the tool gate, the live stream. This is the minimum.
- `tickets` — additionally allows `Create ticket from this note`.

There is no e-mail/password login in this plugin by design: a token can be revoked on its
own, a password can only be changed, and changing it invalidates every session everywhere.

`npm run dev` keeps esbuild watching; run `npm run deploy` again to push a build into the
vault.

## Conversations

A bar above the message list switches between conversations: a dropdown of the open ones
(`●` while a run is going, message count in brackets), plus buttons for new, rename, close
and *show the closed ones*. The last one you were in is remembered in `data.json`, so
reopening the view lands where you left. `Start a new conversation` is also a command.

The session API is live in Traccoon (`docs/HANDOVER-sessions.md`). The fallback stays in the
code: against a backend without it, `GET /assistant/sessions` answers 404, the bar hides
itself and the chat behaves as it did before sessions existed.

## The icon

Ribbon, tab and view use a raccoon mask drawn as line art (`src/icon.ts`), registered through
`addIcon` and painted in `currentColor` so it follows the theme like every built-in icon.

Traccoon itself has no favicon yet. `docs/favicon.svg` is the same mark with fixed colours,
and `docs/HANDOVER-favicon.md` is the instruction to put it into the web app — after that the
browser tab and the vault sidebar show the same animal.

## Mobile

The plugin runs on the phone app — `isDesktopOnly` is false and nothing here touches a Node
API. `requestUrl` is the transport precisely because it is the one that works there.

What differs on a phone:

- Enter writes a new line instead of sending; use the *Send* button.
- The websocket lives only while a chat view is open, and drops when the app is suspended.
  It rebuilds itself on return, and the message list refreshes over REST regardless, so a
  missed stream costs the live tool log of that moment, never a result.
- The server must be reachable over `https` — the socket address is derived from it, and a
  mobile webview refuses a plaintext socket next to a secure page.

## Security

The **token is stored in plain text** in `.obsidian/plugins/traccoon-assistant/data.json`,
which is a normal vault file — every machine your vault syncs to holds a usable token. Two
consequences worth acting on:

- give the token only the scopes it needs (`assistant` alone if you never create tickets),
- when a device is lost, revoke that token in Traccoon. Nothing else changes, and no other
  client has to be touched.

## How the run of a message is followed

`GET /assistant/chat` returns `run_id` per message, so the live events of the office socket
are attributed to the message they belong to. When a payload arrives without that field
— an older backend — the plugin falls back to binding a fresh run to the newest running
message, which is right as long as only one message runs at a time.

## Notes on the API this speaks

| Purpose | Endpoint |
|---|---|
| Identity check | `GET /api/auth/me` (token in `Authorization: Bearer`) |
| Conversation | `GET /api/assistant/chat?limit&before&archive` |
| Send | `POST /api/assistant/chat` `{text}` |
| Tool gate | `POST /api/assistant/chat/{id}/decide` `{decision: once\|always\|never}` |
| Archive | `POST /api/assistant/chat/{id}/archive\|unarchive`, `/archive-all` |
| Projects | `GET /api/projects` |
| Ticket | `POST /api/projects/{id}/issues` |
| Live events | `WS /api/ws?token=…`, messages `{type: "office_ev", ev: {...}}` |

Project-less runs — the assistant and the scheduled jobs — reach their owner over the socket
regardless of the subscribed scope, so the plugin sends no `subscribe` message and filters on
`project_id` being empty.
