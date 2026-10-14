# Post-game preview

A local stand-in for the League post-game scoreboard. It serves a trimmed capture of one client screen and runs the real plugin (`pengu-plugin/better-lol-chat`) in the browser.

This is a best-effort mock, not a one-to-one copy of the live client. The capture is one patch, then cut down: unused styles, fonts, and images are gone, and the images that remain were resized. Layout, type, and color can drift from the client, and a League patch will not show up here until the capture is replaced. A match in the preview is not proof the client looks the same. Check the live post-game screen before trusting a visual change.

## Run

From the repo root, with Node installed:

```text
node preview/server.mjs
```

Open http://127.0.0.1:3000. The page is 1055×720. Set `PORT` to use another port. There is no install step and no dependency.

The server reads these files once at startup:

- `docs/fixtures/client-capture/client-capture.json`
- `docs/fixtures/client-capture/client-assets.json`

Restart the process after either file changes, or after `preview/server.mjs` changes. Plugin source is read on each request, so a browser reload is enough after edits under `pengu-plugin/better-lol-chat/`.

## Use

The plugin's `init` and `load` run for real. The gear, options panel, credit line, sticky chat, and message rewriting behave as they do in the client. Options are stored in this browser's `localStorage` under `blc-settings`.

On load, the preview injects sample chat rows. Typing in the post-game box and pressing Enter appends a local line. It is not sent anywhere. `/demo` and `/sample` inject the sample set again, `/clear` removes those rows, `/dialog` opens the update dialog, and `/notice` shows the notice line.

Client controls that are only painted do nothing. Play Again, View Advanced Details, the stat switchers, and the exit control are examples. The chat socket is a no-op, so the preview never hears a live game.
