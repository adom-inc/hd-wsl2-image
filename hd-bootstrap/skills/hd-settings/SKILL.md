---
name: hd-settings
description: >
  Hydrogen Desktop's Settings dialog and the full preference tree the user can
  change — theme, vim mode, launch-on-login, console-on-startup, 3D control style,
  font, line numbers, schematic nudge, the embedded Adom Desktop options, and
  more. READ THIS when the user asks "how do I turn on vim mode", "change the
  theme", "make HD launch at startup", "stop Adom Desktop's window popping up",
  "switch to blender/solidworks orbit controls", "hide line numbers", "show the
  console on startup", "make the UI compact", or "where are the settings". Opened
  from the Adom logo menu → Settings. Trigger words — settings, preferences,
  settings dialog, options, config, theme, dark mode, light mode, high contrast,
  compact ui, developer mode, vim mode, vim emulation, line numbers, code font,
  editor font, launch on login, launch on startup, launch on boot, show console,
  console on startup, 3d controls, control style, fusion solidworks blender orbit,
  schematic nudge, auto approve, foreground hd, adom desktop window, turn on, turn
  off, change setting, how do I configure.
---

# HD Settings — the preference tree

Open it from the **Adom logo menu** (upper-left teal logo) → **Settings** (see
[hd-adom-menu](../hd-adom-menu/SKILL.md)). The dialog is
`src/lib/components/editor/settings/SettingsDialog.svelte`; the canonical tree of
sections and keys lives in `src/lib/stores/settings.ts` (`settingsTree`).

Preferences are saved per-user (`saveUserSetting` → `PATCH /user/hydrogen/settings`)
and persist across sessions. Setting a key back to its default removes the
override. Keys are dotted (`section.subsection.name`).

> **The Settings search box is currently a no-op** — it's a placeholder input
> with a `<!-- TODO: Implement settings search -->` in `SettingsDialog.svelte`.
> Typing in it filters nothing yet; scroll/scan the sections instead.

## Sections, keys, and what each does

### general
| Key | Default | What it does |
|---|---|---|
| `general.developer_mode` | `false` | Enables extra developer/debugging features in the app |
| `general.pane_focus_mode` | `true` | Only the focused pane is active + highlighted; turn OFF to keep every pane always active |

**general.appearance** (subsection)
| Key | Default | What it does |
|---|---|---|
| `general.appearance.theme` | `adom-dark` | App-wide theme. Options: `adom-dark`, `adom-light`, `adom-dark-high-contrast`, `adom-light-high-contrast` (→ "change the theme" / "light mode" / "high contrast") |
| `general.appearance.user_interface_style` | `standard` | UI compactness: `standard` or `compact` (→ "make the UI more compact") |

### desktop  *(Hydrogen Desktop app itself)*
| Key | Default | What it does |
|---|---|---|
| `desktop.show_console_on_startup` | `false` | Show the debug console window when HD starts (→ "show the console on startup") |
| `desktop.launch_on_boot` | `true` | Auto-launch HD on login / at startup (→ "make HD launch at startup" / "stop HD launching on login" = set false) |

### adom_desktop  *(the embedded Adom Desktop / AD that HD runs)*
When HD is running it takes over AD, so AD's options live here. See
[hd-adom-desktop](../hd-adom-desktop/SKILL.md) for the HD↔AD relationship.
| Key | Type / default | What it does |
|---|---|---|
| `adom_desktop.open` | action button | "Open Adom Desktop" — brings the AD window to the foreground (persists nothing) |
| `adom_desktop.auto_approve_when_running` | bool, `true` | While HD runs, keep AD in permanent auto-approve mode (auto-accept AD permission prompts) |
| `adom_desktop.show_window_on_launch` | bool, `true` | Show AD's window + taskbar icon when HD launches, so you can see it's running (→ "stop AD's window popping up" = set false) |
| `adom_desktop.foreground_hd_on_launch` | bool, `true` | Bring HD to the front on launch; AD still shows in the taskbar but stays behind HD |

### schematic  *(Schematic Workspace)*
| Key | Default | What it does |
|---|---|---|
| `schematic.nudge_amount.small` | `1` px | Arrow-key nudge distance for components |
| `schematic.nudge_amount.large` | `8` px | Shift+arrow nudge distance |
| `schematic.invert_zoom_direction` | `false` | Invert mouse-wheel zoom direction |
| `schematic.default_cursor` | `crosshair` | Default cursor: `crosshair` or `pointer` |

### 3d  *(3D Settings)*
| Key | Default | What it does |
|---|---|---|
| `3d.control_style` | `fusion` | Orbit/pan/zoom control scheme: `fusion`, `solidworks`, or `blender` (→ "use blender/solidworks controls") |
| `3d.invert_zoom_direction` | `false` | Invert mouse-wheel zoom direction in 3D |

### code  *(Code Workspace)*
| Key | Default | What it does |
|---|---|---|
| `code.appearance.font.family` | `DM Mono` | Code editor font family (→ "change the code font") |
| `code.line_numbers.enabled` | `true` | Show line numbers (→ "hide line numbers" = set false) |
| `code.line_numbers.style` | `absolute` | Line-number style: `absolute` or `relative` |
| `code.vim_emulation_mode` | `false` | Vim motions in the code editor (→ "turn on vim mode" = set true) |

### simulator  *(Simulator Workspace)*
| Key | Default | What it does |
|---|---|---|
| `simulator.code_editor_position` | `right` | Code editor position relative to the 3D environment: `right` or `left` |

### extensions
Present in the tree but currently has **no properties** (reserved for future
extension-specific settings).

## Answering common asks

- **"Turn on vim mode"** → `code.vim_emulation_mode` = true
- **"Change the theme / dark mode / high contrast"** → `general.appearance.theme`
- **"Make HD launch on login / at startup"** / "don't launch on login" → `desktop.launch_on_boot`
- **"Stop Adom Desktop's window popping up"** → `adom_desktop.show_window_on_launch` = false
- **"Blender / SolidWorks orbit controls"** → `3d.control_style`
- **"Hide line numbers / change code font"** → `code.line_numbers.enabled` / `code.appearance.font.family`
- **"Show the console when HD starts"** → `desktop.show_console_on_startup`
- **"Make the UI compact"** → `general.appearance.user_interface_style` = compact

## Related skills
- [hd-adom-menu](../hd-adom-menu/SKILL.md) — the logo menu that opens Settings (and Ports, API Explorer, etc.)
- [hd-ui](../hd-ui/SKILL.md) — the broader HD UI / panel layout this dialog sits in
- [hd-adom-desktop](../hd-adom-desktop/SKILL.md) — what the `adom_desktop.*` prefs control (the embedded AD)
