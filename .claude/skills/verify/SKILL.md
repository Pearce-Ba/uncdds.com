---
name: verify
description: How to build, launch, and drive this static DDS site for end-to-end verification (headless Chrome + CDP, no node needed).
when_to_use: Verifying changes to index.html, dashboard.html, or any dds-*.js at the real browser surface.
---

# Verifying the DDS site

Static site — no build. `serve.mjs` needs node, which is NOT installed on this
machine; use python instead:

```bash
python3 -m http.server 8123 --directory <repo>
```

Drive it with headless Chrome + CDP (no selenium/playwright/node available;
a stdlib-only raw-socket WebSocket CDP client is ~100 lines and works fine):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 \
  --user-data-dir=<scratch>/chrome-profile --no-first-run \
  --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1" about:blank
```

## Gotchas

- **ALWAYS block external DNS** (the `--host-resolver-rules` line above).
  `dds-cloud-config.js` points at the real production Firebase project
  (`unc-dds`); any localStorage write in a test session would otherwise be
  PUSHED to the live chapter database via DDSCloud.touch().
- `dashboard.html` redirects to login unless a session exists. Seed by first
  loading any same-origin doc (e.g. `/robots.txt`), then via Runtime.evaluate:
  `localStorage.setItem('dds-members-v1', JSON.stringify([...rows...]))` and
  `localStorage.setItem('dds-session-v1', JSON.stringify({id:<row id>, ts:Date.now()}))`.
  A member row needs id/name/email/gradYear/major/role; no password hash needed.
- Exec powers come from `role:'exec'` OR the email being on the EXEC_BOARD
  roster in `dds-auth.js` (president = pjbarnes@unc.edu).
- The member profile modal can be deep-linked: `dashboard.html?member=<id>`.
- Open a CDP target with `PUT /json/new?<url>` (GET is rejected on new Chrome).
- `index.html` has NO global `[hidden]{display:none}` rule (dashboard.html
  does, line ~19). Any new `display:flex/grid` element on index that uses the
  `hidden` attribute needs its own `[hidden]{display:none}` override.

## Flows worth driving

- Directory (`dashboard.html#members`): exec top row (5 + See more), general
  grid 5×2 paged 10-at-a-time (‹ › + page info), See more expands all, search
  filters both groups, exec-only "Edit chapter members" → click member →
  status editor (board title / custom role / demote), email shown in modal.
- Front page spotlight (`#members-preview` on index.html): indexes only
  members with photo + bio/quote from the roster, falls back to the sample
  cast when none qualify; `#om-see-all` opens the profiles overlay when real
  members exist, otherwise navigates to the dashboard.
