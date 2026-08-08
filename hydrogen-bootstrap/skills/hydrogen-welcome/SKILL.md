---
name: hydrogen-welcome
description: >
  The HD welcome page — shown after setup steps complete. Served from
  static/welcome.html at http://localhost:1420/welcome.html. Shows Adom
  branding, "Build and test electronics in the cloud", and an "Open Claude
  Code" button. This is NOT the adom.inc homepage — it's a local static page
  bundled with HD. Trigger words: welcome page, welcome tab, show welcome,
  onboarding page, setup complete page, first launch page.
---

# HD Welcome Page

The welcome page is a static HTML page bundled with HD at `static/welcome.html`.
It's served locally at `http://localhost:1420/welcome.html` by HD's dev file server.

## What it shows

- Adom logo and branding
- "Build and test electronics in the cloud"
- Description of the Adom cloud factory
- "Open Claude Code" button
- Links to documentation

## When it appears

- Automatically as the final setup step — the `open-welcome` gate (the last step of the
  setup cascade for the active runtime).
- Can be opened manually via the API

## How to open it

### From inside the workspace (the standard way)

This is how the setup steps do it, and how any AI inside the workspace should:

```bash
adom-cli hydrogen webview open-or-refresh \
  --name Welcome \
  --url http://localhost:1420/welcome.html \
  --panel-id desktop-pane-right
```

`localhost:1420` is HD's dev file server running on the host (where HD itself runs),
NOT anything inside the workspace. HD's webview renders the URL against the host, so the
page resolves on whatever platform HD is running on.

### From outside (via HD control API)

The workspace tabs API doesn't reliably store the URL in panelState when
creating tabs. The reliable method is to navigate an existing webview iframe:

```bash
# Method 1: Navigate right-pane iframe via eval (reliable)
curl -X POST http://127.0.0.1:47084/eval \
  -H Content-Type:application/json \
  -d '{"js":"(function(){var iframes=document.querySelectorAll(\"iframe\");for(var i=0;i<iframes.length;i++){var r=iframes[i].getBoundingClientRect();if(r.x>400&&r.width>200){iframes[i].src=\"http://localhost:1420/welcome.html\";return \"ok\"}}return \"no iframe\"})()"}'

# Method 2: Create tab then navigate (2 steps)
# Step 1: Create tab
curl -X POST http://127.0.0.1:47083/api/workspaces/editor/{owner}/{repo}/current/tabs \
  -H Content-Type:application/json \
  -d '{"name":"Welcome","panelType":"adom/a1b2c3d4-0031-4000-a000-000000000031","panelId":"desktop-pane-right","panelState":{"url":"http://localhost:1420/welcome.html","displayName":"Welcome","displayIcon":"mdi:hand-wave"}}'
# Step 2: If URL didn't load, navigate the iframe via eval (Method 1)
```

## IMPORTANT: This is NOT

- NOT the adom.inc homepage (https://adom.inc)
- NOT the Adom wiki (https://wiki.adom.inc)
- NOT the VS Code welcome tab inside code-server

It is a LOCAL static page at `http://localhost:1420/welcome.html`, bundled
in `static/welcome.html` in the HD repo.

## Panel type

Webview tabs in HD use panel type `adom/a1b2c3d4-0031-4000-a000-000000000031`.
Do NOT use `panelType: "webview"` — that shows "Unknown panel type" error.
