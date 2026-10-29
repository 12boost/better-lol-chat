# Agents

User-facing install and feature notes are in `README.md`. Do not add DOM docs, fixtures, capture steps, or other technical references there.

Implemented behavior is the plugin source plus the docs below.

## Read first

- `docs/CHAT_INTERFACE.md` — post-game DOM, selectors, identity, and what this plugin already changes.
- `docs/PREVIEW.md` — local scoreboard preview. Best effort, not a one-to-one client render.
- `docs/fixtures/` — trimmed exports named from that doc.
- Plugin source: `pengu-plugin/better-lol-chat/`.

If a selector fails after a patch, re-check the live element. Do not invent a new one.

## Product

This repo is the Pengu plugin. It changes Riot's existing post-game chat screen.

One remote notice line in post-game chat is allowed (gist-backed pitches for the author's other projects). 

## Client constraints

Settings live in the League client's `localStorage` under `blc-settings`. On load, merge saved values over the defaults so a new key does not wipe prior choices. Do not write settings through `context.fs`. Losing them if the user wipes client storage is acceptable.

Do not call `textarea.focus()`. That scrolls the whole client.

Do not set `z-index` unless a live check shows the element is covered, or is covering something it should not. Leave stacking alone until that is proven.

The plugin runs inside the League client:

- It cannot raise its own permissions. `context.fs` cannot write outside the plugin folder. Program Files is read-only from that process.
- Pengu only loads `index.js` from its `plugins` folder. A second writable folder is not a plugin and is not reachable through `context.fs`.
- The user still turns Pengu on once. A League patch that breaks Pengu is fixed by Pengu's own update.

Macros stay user-initiated: do not auto-send on game end, auto-reply, or schedule chat.