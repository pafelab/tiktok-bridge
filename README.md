# TikTok gifts for the Black Swan overlay

This folder holds a small helper that watches your TikTok LIVE and turns every gift
into a Black Swan donation card. Your Streamlabs donations keep working exactly as
before — the two run side by side.

## Setup, once

1. Install **Node.js LTS** from <https://nodejs.org> if you do not have it.
2. Double-click **start.bat**. The first run downloads the TikTok libraries, which
   takes about a minute.
3. It asks which TikTok account you stream from. Type your username (`@` optional)
   and press Enter. It remembers your answer in `config.json`.

Leave that window open while you stream. It prints a line for every gift.

## OBS

Change your Black Swan browser source from a local file to a URL:

```
http://localhost:8899/donate%20board.html
```

In OBS: right-click the source → **Properties** → untick **Local file** → paste the
URL above. Keep your width, height, and **Shutdown source when not visible** off.

That is the only change. If you would rather keep **Local file** ticked, the overlay
still finds the bridge at `localhost:8899` on its own — the URL is just more reliable
because it survives OBS cache clears.

If you changed `port` in `config.json`, use that number instead of 8899 everywhere on
this page. The bridge window always prints the exact URL when it starts.

## Trying it before you go live

- Press **T** in the bridge window for a test gift.
- Or open <http://localhost:8899/test> in a browser.
- <http://localhost:8899/health> shows whether TikTok is connected and how many
  overlays are listening.

You can shape the test: `/test?name=Nara&gift=Galaxy&count=1&coins=1000&message=hello`

Test gifts only work from an address you open yourself. If someone sends you a link to
`/test`, clicking it does nothing — otherwise a viewer could put their own words on
your stream.

## Settings — `config.json`

| Setting | Default | What it does |
| --- | --- | --- |
| `tiktokUsername` | *(asked on first run)* | The account you stream from, without `@`. |
| `port` | `8899` | Change it if something else already uses this port. |
| `minCoins` | `1` | Gifts worth fewer coins than this make no card. Set `10` to hide Roses. |
| `amountMode` | `"coins"` | `"coins"` shows `COINS 1,000`. `"currency"` converts to money. |
| `currency` | `"THB"` | The label used when `amountMode` is `"currency"`. |
| `coinValue` | `0.35` | What one coin is worth to you, in that currency. |
| `messageTemplate` | `"{gift} ×{count}"` | The card message when the viewer wrote nothing. `{gift}`, `{count}`, `{coins}`, `{name}`. |
| `useRecentComment` | `true` | Use the viewer's own chat message from just before the gift, when they sent one. |
| `recentCommentWindowSeconds` | `90` | How recent that comment has to be. |
| `eyebrowText` | `"TikTok gift"` | The small line above the name. |
| `showGiftIcon` | `true` | Show TikTok's gift picture next to the amount. |
| `signApiKey` | `""` | Optional Euler Stream key — see below. |

Save the file and restart the bridge for changes to take effect.

## Gift streaks

TikTok sends one message per rose when someone taps a gift fifty times. The bridge
waits for the streak to finish, so "Rose ×50" makes **one** card worth 50 coins
rather than fifty separate cards.

## When something is wrong

**"@you is not live right now."** — Normal. The bridge keeps checking every 30
seconds and connects itself when your LIVE starts. Start it before you go live if
you like.

**"Rate limited by the signing service."** — TikTok's connection has to be signed by
a third-party service, and the free tier is shared. Get a free key at
<https://www.eulerstream.com>, paste it into `signApiKey` in `config.json`, and
restart. This also makes connecting more reliable in general.

**"Port 8899 is already in use."** — Change `port` in `config.json`, then use the new
number in the OBS URL.

**Cards appear in the bridge window but not in OBS** — the overlay is not connected.
Check `overlaysConnected` at <http://localhost:8899/health>. If it is `0`, refresh
the browser source (Properties → OK) and confirm the URL and port match.

**"Failed to retrieve Room ID"** — usually a typo in the username, or TikTok is
blocking the unsigned connection. Check the spelling, then try a sign key.

## Notes

- The bridge listens on `127.0.0.1` only. Nothing is exposed to the internet, and no
  TikTok login or password is involved — it reads the public LIVE feed.
- It talks to TikTok and to the Euler Stream signing service. Nothing else leaves
  your machine.
- `tiktok-live-connector`, the library that reads the LIVE feed, is licensed
  **AGPL-3.0-only**. That is fine for running it on your own stream. If you ever
  distribute this bridge or run it as a service for other people, read that licence
  first — it asks you to share your source under the same terms.
- TikTok can change the LIVE protocol at any time. If gifts stop arriving after a
  TikTok update, run `npm install tiktok-live-connector@latest` in this folder.
