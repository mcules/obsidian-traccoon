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
  message. Configurable down to path-only or nothing.
- **Tickets** — `Create ticket from this note` opens a small form (project, summary,
  priority, description) and writes the resulting key back into the note as a link.

## Install

```
npm install
npm run build
npm run deploy         # copies into the vault, override with TRACCOON_VAULT=...
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

## Security

The **token is stored in plain text** in `.obsidian/plugins/traccoon-assistant/data.json`,
which is a normal vault file — every machine your vault syncs to holds a usable token. Two
consequences worth acting on:

- give the token only the scopes it needs (`assistant` alone if you never create tickets),
- when a device is lost, revoke that token in Traccoon. Nothing else changes, and no other
  client has to be touched.

## Optional backend patch: exact run binding

The chat payload does not carry the run id, although `AssistantTask.run_id` exists. Without
it the plugin binds an incoming event stream to the newest running message, which is right
whenever one message runs at a time and can mis-attribute when two run in parallel.

One line in `backend/app/api/mail.py::_chat_out` removes the guess:

```python
 return {
     "id": t.id, "text": (t.meta or {}).get("chat_text") or t.title,
     "status": t.status, "result": t.result, "error": t.error,
+    "run_id": t.run_id,
     "pending_tool": t.pending_tool, "created_at": t.created_at, "finished_at": t.finished_at,
 }
```

The plugin reads `run_id` when it is there and falls back to the heuristic when it is not, so
the patch is not required to run.

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
