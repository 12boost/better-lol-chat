# Post-game chat interface

Reference for the League client DOM this plugin actually touches. The trimmed live export is `[docs/fixtures/postgame-screen.html](fixtures/postgame-screen.html)` (patch 16.18, 2026-09-22). Selectors below were confirmed there or in `rcp-fe-lol-postgame` / `rcp-fe-lol-social`. If a selector fails after a patch, re-check the live element before inventing a new one.

The plugin runs inside the client via Pengu. Host-page CSS is `style.css`. Message CSS is `frame.css`, injected as text into the messages iframe (`import frameCss from './frame.css?raw'`). A `<link>` does not work there.

## Two documents


| Surface         | Where                            | What lives there                                       |
| --------------- | -------------------------------- | ------------------------------------------------------ |
| Host page       | League client document           | Scoreboard, `lol-social-chat-room`, chat input, toggle |
| Messages iframe | `iframe#embedded-messages-frame` | Message rows, names, join/leave lines, credit          |


Host CSS does not apply inside the iframe. Do not call `textarea.focus()`. That scrolls the whole client.

## Chat room

```text
lol-social-chat-room[type="postGame"].scoreboard-v2
  .chat-box.focused-chat-box          open / fully expanded
    iframe#embedded-messages-frame
    lol-social-chat-input
      textarea.chat-input
      .chat-toggle-button
        .chat-placeholder-text        "Click or Enter to View" when collapsed
```

- Open means `focused-chat-box` on `lol-social-chat-room`. Blur removes that class from the room. `.chat-box` can keep `focused-chat-box` after that. The unfocused peek is a few recent lines, older lines clipped, background fading upward.
- Sticky chat (on by default) keeps that room class on while the Scoreboard tab is showing, so click-outside and blur do not collapse chat. The plugin rewrites the class only, and freezes `scrollTop` / `scrollLeft` around those writes. The X on the credit line, the chat button, and Esc remove the class (vanilla peek). The X also closes the options panel when that panel is open. Esc closes the options panel first, and collapses chat only when the panel is already closed.
- Sticky chat off leaves the room class to the client. When the class leaves, large-chat stretch is removed and the credit banner hides, so the window returns to the client's height. `#blc-options` counts as part of chat while it is open: clicks inside the panel do not collapse chat, including the click that turns sticky on. A click outside the panel and outside the chat room closes the panel and collapses chat. Once that panel has been open, the next click outside chat collapses it too, so closing the panel does not leave the room class stuck on.
- `.chat-toggle-button` is intercepted only while sticky chat is on. Toggle-off removes `focused-chat-box` (vanilla peek). Toggle-on puts it back. Clicking the text field while collapsed also opens chat. The native input is kept. With sticky chat off, the button is the client’s control.
- `can-hide-player-messages` is stripped so messages start visible. The room gets `blc-messages-unlocked`.
- Our collapsed flag is `blc-collapsed` on the room plus module state `windowCollapsed`.



## When chat is forced open

Post-game phases are `WaitingForStats`, `PreEndOfGame`, and `EndOfGame`.

Chat is forced open only when a `.scoreboard-team-container` is actually on screen (Scoreboard tab) and Automatically open chat is on. On Progression that element is not showing, so the plugin leaves vanilla collapse alone. Switching back to Progression clears `focused-chat-box` once, then stops managing it.

Sticky chat is separate from that open. On, scoreboard chat stays open until the chat button or Esc. Off, loss of focus closes it the way the client does, including after an automatic open. An open options panel is not loss of focus.

While open on the scoreboard, the room is stretched with `blc-stretched`. The stretch paints the room and `.chat-box` solid `#010a13`. Vanilla leaves the focused room at `rgba(1, 10, 19, 0.95)` and fades `.chat-box` from transparent to `#010a13`; that fade would stretch with the window. The room's top lines up with the top of `.scoreboard-header-component.is-player-team`. Width and bottom stay where vanilla put them. Each visible `.scoreboard-header-component` gets a leading flex child, `.blc-header-chat-gutter`, whose right edge lines up with the chat window. `.scoreboard-header-team-name` then has a 5px left margin. While shifted, `.scoreboard-header-content` drops Riot's fixed 500px width (inline, so it wins) and shrinks to its text. The header's own spacer absorbs that width, so `.scoreboard-column-icons-container` stays put. The iframe fills the height above the input. Numbers are measured, not hardcoded, and recomputed on resize.

## Messages iframe

The host export’s iframe is empty. The connected list is `[docs/fixtures/messages.html](fixtures/messages.html)`, paired with `[docs/fixtures/postgame-messages.json](fixtures/postgame-messages.json)` (2026-09-23). That HTML was captured while this plugin was running: chat names are already champion names, join rows have `blc-hide-join`, and leave rows already contain `.blc-system-name`.

Rows are rendered inside `iframe#embedded-messages-frame`. The list element is `<div class="messages" lang="en-US">`. Client template (`lol-social-chat-room`, `rcp-fe-lol-social`):

```html
<div class="messages" ref="messageContainer">
  <div class="message-box"
       class-mine="message.fromId === me.id"
       class-my-team="not me && end of game && same team as message.fromSummonerId"
       class-other-team="not me && end of game && not same team">
    <!-- system, celebration, or other non-chat -->
    <div class="system-message">
      <span chat-message="message"></span>
    </div>
    <!-- groupchat -->
    <div class="chat-message">
      <div class="message-name">{{displayName}}</div>
      <span class="message">:</span>
      <span class="message" chat-message="message"></span>
    </div>
  </div>
</div>
```

Only one of `.system-message` or `.chat-message` is present. A row is a system row when the message is not a chat message. Confirmed from the live iframe:

```html
<div class="messages" lang="en-US">
  <div class="message-box my-team blc-hide-join">
    <div class="system-message">
      <span>⁦⁦Name⁩ #⁦TAG⁩⁩ joined the lobby</span>
    </div>
  </div>
  <div class="message-box other-team">
    <div class="system-message">
      <span><span class="blc-system-name">Braum</span> left the lobby</span>
    </div>
  </div>
  <div class="message-box mine">
    <div class="chat-message">
      <div class="message-name">Jhin</div>
      <span class="message">:</span>
      <span class="message">gg tho was fun</span>
    </div>
  </div>
  <div class="message-box other-team">
    <div class="system-message">
      <span class="celebration">Everyone on your team honored a teammate! You got a little extra Honor progress this game.</span>
    </div>
  </div>
</div>
```

This capture has `.mine` and `.other-team` chat lines. `.my-team` appears on join and leave rows. No ally chat line was in the log.

Inject sample rows into `iframe.contentDocument.querySelector('.messages')`. An expired or disconnected session still has that node (`class="messages disconnected"`) and the frame stylesheet. The chat socket does not need to be connected. Do not append to the iframe `body`: it is `display: flex; flex-wrap: wrap`, so rows sit side by side, and the 12px font, line-height, and padding (`5px 7px 7px 10px`) are on `.messages`, not on `body`. If `.messages` is missing, create one and append it to `body`. Re-running should remove the previous sample nodes from that same parent.

The plugin registers `window.__blcInjectSampleMessages()` on load. From the League client console, with the post-game scoreboard open, that call reads scoreboard names, seeds the roster, and appends the sample. `window.__blcClearSampleMessages()` removes those rows. `util/inject-sample-messages.js` is the same call.

Typing `/sample` or `/demo` in the post-game `textarea.chat-input` and pressing Enter runs that same call. The line is not sent. The field is cleared. Shift, Alt, Ctrl, or Meta with Enter still go to the client.

### Chat line

- `.message-name` is one node. Before this plugin rewrites it, the text is the Riot ID. The plugin replaces that text only when it matches a mapped alias (`Name#TAG` or the game name before `#`). A champion name already in `.message-name` is left as-is. Team color still comes from the row class.
- With champion icons on, `.message-name` starts with `<img class="blc-champ-icon" alt="">`. The `src` is the roster portrait (`squarePortraitPath`, or `/lol-game-data/assets/v1/champion-icons/{id}.png`). Leave rows wrap that image and the name in `.blc-leave-label`, then the verb ( `left the lobby`) stays a text node so the line can wrap. The icon is `1.75em` square. The iframe root gets `blc-chat-icons`, which sets the row line-height to `1.75em` and centers the name on the icon so it stays level with the colon and body.
- The colon is its own `<span class="message">:</span>`. The text is `:`, with no spaces inside the span. The body is a second `<span class="message">` whose text is the LCU `body`.
- The client template leaves whitespace between those three nodes. Collapsed, that is one space before the colon and one space after it. Sample rows need those space text nodes. Without them the colon sits against the name.



### System line

- One `<span>` inside `.system-message`. No `.message-name`.
- LCU `type: "system"` and `body: "joined_room"` render as `{displayName} joined the lobby`. `body: "left_room"` renders as `{displayName} left the lobby`. The body field is the localization key, not the sentence. The iframe span does not receive that key or the message id.
- A player joins once, then may leave. System spans are tied to a player by the Riot ID inside the text (`Name #TAG`, with or without the space before `#`). For each player, top to bottom, the first line gets `blc-hide-join` on the `.message-box`. The second stays. Its matched name is wrapped in `.blc-system-name` (inside `.blc-leave-label` with the icon) and the rest of the sentence, on either side, stays gray. Sample rows (`blc-sample`) are counted on their own, so the demo join and leave do not take the live leave slot.
- `type: "celebration"` uses the same `.system-message` wrapper. In this capture the span itself has class `celebration`, and its text is the LCU `body` (the honor sentence). `fromId`, `fromPuuid`, and `fromSummonerId` are empty. The row class was `other-team`.



### Display name

Rendered names wrap the game name and tag in left-to-right isolates:

```text
U+2066 U+2066 {gameName} U+2069 # U+2066 {tagLine} U+2069 U+2069
```

Example: `⁦⁦SummonerJ⁩ #⁦NA1⁩⁩`. Strip `U+200E`, `U+200F`, `U+202A–U+202E`, and `U+2066–U+2069` before comparing. Sample rows can omit the marks; the plugin strips them when present.

### Team class

The client sets the class on `.message-box` from `message.fromId === me.id` (mine), otherwise `fromSummonerId` against the end-of-game roster (my-team or other-team). Post-game `groupchat` messages often have `fromSummonerId: 0`, so allies are wrongly marked `.other-team`.

This plugin reclassifies each row from the eog roster (`player.ally`): match the speaker via Riot ID / leave text / unique champion name, then force `.my-team` or `.other-team`. `.mine` and celebration rows are left alone. A sample row only needs the correct class:


| Row class     | Who          |
| ------------- | ------------ |
| `.my-team`    | Allies       |
| `.other-team` | Enemies      |
| `.mine`       | Local player |


Body colors apply while `.blc-tint-bodies` is on the iframe root. The options panel can change every name and body color. Leave-row `.blc-system-name` inherits the client's system gray.

LCU `groupchat` messages in the 2026-09-23 capture use `fromSummonerId: 0`. `fromPuuid` is the bare puuid. `fromId` and `fromPid` are `{puuid}@{region}.pvp.net`. System `joined_room` / `left_room` messages use the bare puuid as `fromId` and a nonzero `fromSummonerId`. The post-game conversation id looks like `{gameId}-eog@lol-post-game.{region}.pvp.net`.

### Credit

`#blc-credit` is appended to the iframe `<html>`, not inside the scrolling message list. It is `position: fixed` at the top of the frame so it does not scroll away. Text comes from `CREDIT_TEXT` in `index.js` (currently `better-lol-chat by wryguy`). Font family is copied from a `.chat-message` / `.message` node. Size is that node's size plus 2px, because LoL Body at the message size reads smaller than the old fallback. Line-height stays at 1.15 and vertical padding is 6px, so the banner does not inherit the message row's icon line-height. Class `blc-credit-hidden` hides it whenever chat is collapsed: the room has lost `focused-chat-box`, or our collapse flag is set. Sticky chat does not matter. The message-list padding added for the banner is removed with it. The gear on that line opens `#blc-options` on the host page. The X to its right collapses chat. If the options panel is open, that click closes the panel and collapses chat.

Plugin version is the single `VERSION` constant in `index.js` (`X.X`). It is logged once on `load()` as `[better-lol-chat] vX.X` and shown on the update row in the options panel.

The bug icon at the top right of the update row in `#blc-options` opens the GitHub issues page. It is the beetle from Riot’s report-bug button, without that button’s frame, at 16px. Hover shows “Report a Bug” in a `lol-uikit-tooltip` with `type="system"` and a `lol-uikit-content-block` of `type="tooltip-system"`. `.blc-bug-tip` paints the frame (`#010a13` fill, `#463714` border, and a caret) because that component’s chrome is not part of the captured screen.

The plugin asks GitHub for the latest release once each time a post-game screen starts (8 second timeout; on failure the options row says it couldn't check). When that release is newer, one local row is inserted as the first child of `.messages`. It uses the normal chat-message shape (`better-lol-chat` as the name, then `vX.X is available. Click for details.`), with classes `blc-injected blc-update-note`. Later messages stay below it, and it scrolls with the list. Clicking the row opens the update dialog. The row is not sent through League chat. `rewriteMessages` skips `.blc-injected`. The options-panel update row shows the status text, and a "What's new" button when an update is available. That button opens the same dialog.

### Remote notice

A second local chat row can appear under the update note (or at the top of `.messages` when there is no update). Classes `blc-injected blc-notice`. Same chat-message shape and name (`better-lol-chat`), without the update note's fill or left bar. When the notice has a `url`, the row also gets `blc-notice-link`: the body is underlined and the row is clickable. That link color is fixed so a custom ally name color does not change it. The row is not sent through League chat. `rewriteMessages` skips `.blc-injected`. Champion-icon line-height rules also exclude `.blc-injected`.

The plugin fetches a public gist JSON once per post-game screen (8 second timeout; failure or an empty `notices` list shows nothing). URL is `NOTICE_URL` in `notice.js`. The gist is live config, not a demo file: keep `"notices": []` until a real pitch should ship. Unknown fields are ignored. Array order is ignored.

Root fields:


| Field                  | Required | Default                       | Meaning                                                         |
| ---------------------- | -------- | ----------------------------- | --------------------------------------------------------------- |
| `gamesBetweenNotices`  | no       | `5`                           | Games between any standard notice. Values below `1` become `1`. |
| `gamesBetweenPriority` | no       | same as `gamesBetweenNotices` | Games between notices while any priority notice is eligible.    |
| `notices`              | yes      | —                             | Array of notice objects. `[]` is the kill switch.               |


Each notice:


| Field            | Required | Meaning                                                                                                                                      |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | yes      | `[\w.-]+`, up to 64 characters. Stable identity for turn-taking and message cycling.                                                         |
| `messages`       | yes      | Non-empty string array. Each show uses the next entry, then wraps. Each string is trimmed and capped at 120 characters.                      |
| `url`            | no       | `https://` only. When set, the row is clickable and opens with `window.open`.                                                                |
| `from` / `until` | no       | `YYYY-MM-DD`, inclusive on the player's local calendar. Either may be omitted. Outside the window the notice is ineligible.                  |
| `priority`       | no       | `true` pauses standard notices while this notice is eligible. Priority notices share `gamesBetweenPriority` and take turns among themselves. |


One channel counter `gamesSince` in `blc-settings.notice` counts games since any notice was shown (one count each time post-game starts, including a client reload). A line is due when that counter meets the current gap: `gamesBetweenPriority` while any priority notice is eligible, otherwise `gamesBetweenNotices`. Eligible notices in the active pool take turns by per-id `gamesSince` (longest wait wins; ties use `id` ascending; never-shown wins). Leaving priority mode resets the channel counter so the next game is not immediately a standard line. There is no dismiss control and no options toggle.

Example gist body:

```json
{
  "gamesBetweenNotices": 5,
  "gamesBetweenPriority": 1,
  "notices": [
    {
      "id": "launch",
      "priority": true,
      "from": "2026-10-07",
      "until": "2026-10-14",
      "url": "https://blc.lol",
      "messages": ["Better League Chat desktop is out now!"]
    },
    {
      "id": "jokes",
      "messages": [
        "Lee Sin walks into a bar. And a table. And a chair.",
        "Why did Twisted Fate get deported? He doesn't have a green card.",
        "Why do chefs love cooking for Ekko? He always goes back four seconds.",
        "Why are garbagemen so good at League? They're used to carrying trash.",
        "Why does Taliyah travel well? She's a sand witch.",
      ]
    },
    {
      "id": "statcheck",
      "url": "https://statcheck.lol",
      "messages": ["Theorycraft at statcheck.lol"]
    }
  ]
}
```

Preview: `window.__blcPreviewNotice()` or `/notice` in the post-game chat input paints the line that would be due if the gap had elapsed, without writing settings.

### Update dialog

Plain HTML in `update-dialog.html`, filled in by `update-dialog.js`, styled by `update-dialog.css`. It is appended to the host `document.body` (not the messages iframe) as `#blc-update-dialog`, hidden until shown. The dim covers the window. The frame is centered on the post-game `.screen-root`, so the social panel beside that screen does not pull it right. Structure and classes follow the client's exit dialog (`[docs/fixtures/client-exit-dialog.html](fixtures/client-exit-dialog.html)`): `lol-uikit-dialog-frame[close-button]`, `lol-uikit-content-block[type="dialog-small"]` with an `h4` and `hr.heading-spacer`. Download Now and View on GitHub are centered `lol-uikit-flat-button` elements (`button-accept` / `button-decline`). They are not inside `lol-uikit-flat-button-group`: that group's `::before` and `::after` pieces are for buttons pinned to the bottom edge of the frame. The notes box is a `lol-uikit-scrollable` inside a bordered frame, as in the privacy notice (`[docs/fixtures/client-privacy-notice.html](fixtures/client-privacy-notice.html)`). The frame holds the border and background. The scrollable's overflow mask fades its own edges, so a border on the scrollable itself disappears at the top or bottom as the notes move. The component starts as "more below" and only updates that on scroll. After the notes are shown, if the text fits, `scrolled-bottom` is set true so the bottom fade is off. Longer notes keep it until the user scrolls.

- Notes are the release `body` from GitHub, inserted with `textContent` and shown as written (`white-space: pre-wrap`). No markdown is parsed. A leading "What's new" line is centered; the rest is left aligned. A trailing Full Changelog line is dropped. An empty body shows a placeholder line.
- **Download Now** opens the `.bat` asset on the release that was checked, using that asset's `browser_download_url`. A release with both `install.bat` and `blc-install-1.2.bat` uses the `blc-install-` file. If the release has no single installer asset, the button opens the release page instead. It then fades out the buttons and Skip link and fades in the install steps under the notes. The patch notes stay. "Download initiated." sits with the checked frame of the client checkbox sprite, inlined at 14px. The plugin stylesheet does not load `/fe/` image paths. The install steps name the downloaded file. The fallback line there opens the release page.
- **View on GitHub** opens `releases/tag/{tag}` and leaves the dialog open.
- **Skip this update** is a text link under the buttons. It closes the dialog, stores the version in `blc-settings` as `skippedUpdate`, and removes the chat note. The note is suppressed only while the latest version equals `skippedUpdate`; a newer release brings it back. The options row still reports the update and the dialog can still be opened from it.
- The close X and Esc dismiss the dialog with no other effect. The dialog is closed when post-game ends (not on other phase changes, so a console preview survives them). Pointer events inside it are exempt from the chat/options outside-click handling in `index.js`.
- `z-index: 12` is set on purpose: `#blc-options` is `10` and `.blc-bug-tip` is `11`, and the dialog can be opened from the panel.
- The X is `lol-uikit-close-button`, or the frame's `lol-uikit-dialog-frame-close-button` / `toast-close-button` element, on the click path. The frame itself is classed `dismissable-close-button`, so a match on any class containing `close` closes the dialog on every click inside it. Re-check this live.
- Preview: `window.__blcPreviewUpdateDialog()` from the client console works on any screen. `/dialog` does the same from the post-game chat input. It uses sample notes. Download Now does not open anything in preview and Skip does nothing.



## Identity

Built when post-game starts, from:

- `/lol-summoner/v1/current-summoner`
- `/lol-end-of-game/v1/eog-stats-block` (`teams[].isPlayerTeam`, players with `puuid`, `summonerId`, `championId`, `riotId`)
- `/lol-game-data/assets/v1/champion-summary.json` (`id` → `name`, `squarePortraitPath`)
- `/lol-chat/v1/conversations` type `postGame`, then that conversation’s messages

`joined_room` system messages map `fromPuuid` to `fromSummonerId` when the end-of-game block is missing one of them. Displayed names match `Name#TAG`, or the game name before `#`.

Champion icons from that summary look like `/lol-game-data/assets/v1/champion-icons/222.png`. The client serves them. Use the path as an `<img src>`.

## Scoreboard rows

Relevant classes from the post-game screen (Summoner’s Rift row):

```text
.scoreboard-team-container
  .scoreboard-row-component.is-local-player.is-ally | .is-ally | (no team class = enemy)
    .scoreboard-row-content-container.centered-flex-box
      .scoreboard-row-player-details-container
        .scoreboard-row-player-name
          .player-name__game-name
        .scoreboard-row-champ-name
      .scoreboard-row-pike
      .scoreboard-row-items-container
        .postgame-player-item          filled slots, empty slots (background url "undefined"), .item-spacer
      .scoreboard-row-stat-display-component.INDIVIDUAL_KDA
        .scoreboard-row-stat-line-primary
      .scoreboard-row-stat-display-component.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS
      .scoreboard-row-stat-display-component.GOLD_EARNED
      .scoreboard-updated-challenge-component
        img.scoreboard-updated-challenge-icon
```

Live row markup, with Ember noise removed: `[docs/fixtures/postgame-screen.html](fixtures/postgame-screen.html)`. That file keeps the local player, one ally, one enemy, and the post-game chat shell. The messages iframe in the export is empty.

The KDA column (`.INDIVIDUAL_KDA` / `.scoreboard-row-stat-line-primary`) is the scoreline immediately after the items. Challenge icons sit after gold, not between items and KDA.

With **Mid-row icons and level** on (`showMidRow`, default on), each visible scoreboard row gets a flex child `.blc-mid-row` inside `.scoreboard-row-content-container`, after `.scoreboard-row-pike` and before `.scoreboard-row-keystone-container`. It holds the in-game level, then the champion portrait. The level copies the font, weight, line-height, and color of `.scoreboard-row-in-game-level` and sits in a fixed two-digit slot so `8` and `18` take the same width. There is 4px between the pike and the level, and 4px between the level and the icon. The icon matches the primary keystone holder (`.postgame-player-keystone-icon.circle-icon-holder`, 30px at the default client scale). While the badge is up, the keystone alignment box's left margin is pulled in to 4px. The client uses 16px there, which was the gap after the pike. `pointer-events: none`.

The player details, player controls, and actions containers stay at the width they had before the badge, so they do not slide left under the chat. `.scoreboard-row-items-container` loses the badge width, minus the keystone margin that was pulled in. Its slots are packed left, so the empty space on its right is what moves. The keystone, summoner spells, and items shift right. KDA stays put.

The badge is removed, and those widths are restored, while chat is collapsed (`blc-collapsed`, or `focused-chat-box` absent) and while the toggle is off. Not-in-chat rows fade the icon to 0.5. The level stays full color. Strong dim grayscales the icon only.

## Honor tooltip

Hovering an honor pip opens a name-only system tooltip in `#lol-uikit-tooltip-root` (confirmed 16.20). The grantor is `.player-name__game-name` inside `lol-uikit-content-block[type="tooltip-system"]` `p`. The plugin inserts `.blc-honor-champ` immediately after that span, ` (Champion)`, when the tooltip text is only that game name and the roster has a champion. Scoreboard `.player-name__game-name` nodes are outside this root and are left alone.

## Plugin entry

Pengu calls `init(context)` then `load()`. `context.socket.observe(api, listener)` delivers `{ data, uri, eventType }`. Inside the client, `fetch('/lol-...')` needs no basic auth.

Console prefix: `[better-lol-chat]`. Version is logged once on load.