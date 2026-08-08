#!/usr/bin/env bash
# postinstall.sh — adom/hydrogen-windows-bootstrap
#
# The Windows (WSL2) platform layer. Runs after adom/hydrogen-bootstrap (generic) and
# all deps install. Applies ONLY what is specific to the WSL2 runtime:
#   - deploy the WSL2/networking/lifecycle hd-* skills (this package's skills/)
#   - seed the WSL2 code-server workbench.html (trusted domains + activity bar)
# The generic editor config (Claude CLI, extensions, settings.json) is in
# adom/hydrogen-bootstrap. (The workspace-updater daemon dep was RETIRED 2026-07-16 —
# updates are registry-native: adom-wiki pkg update via adom/hook.) Mac/Ubuntu siblings provide their own platform layer instead.
#
# Idempotent + live-installable; the golden WSL2 image runs the same install.
set -euo pipefail
log() { echo "[hydrogen-windows-bootstrap] $*"; }
HERE="$(cd "$(dirname "$0")" && pwd)"

# 0. Deploy the bundled WSL2-specific hd-* skills into ~/.claude/skills/.
if [ -d "$HERE/skills" ]; then
  log "deploying bundled WSL2 hd-* skills"
  install -d -m 0755 "$HOME/.claude/skills"
  count=0
  for d in "$HERE"/skills/hd-*/; do
    [ -f "${d}SKILL.md" ] || continue
    name="$(basename "$d")"
    install -d -m 0755 "$HOME/.claude/skills/${name}"
    install -m 0644 "${d}SKILL.md" "$HOME/.claude/skills/${name}/SKILL.md"
    count=$((count + 1))
  done
  log "  deployed ${count} WSL2 hd-* skills"
fi

# 1. workbench.html state seed — patches the WSL2 code-server install. Seeds
#    VS Code's per-origin IndexedDB/layout on every load: (1) trusted domains "*"
#    (suppress the 'open external website?' dialog), (2) unpin Search/SCM/Run-
#    and-Debug from the activity bar (once per profile, marker
#    adom.activityBarSeeded), (3) collapse the primary sidebar once per profile
#    (marker adom.sidebarSeeded) so the golden image opens to a CLEAN editor —
#    no Explorer, no tabs, no panel, no welcome (startupEditor:none in settings).
#    System-owned file → sudo (adom has NOPASSWD sudo).
WB=/usr/lib/code-server/lib/vscode/out/vs/code/browser/workbench/workbench.html
if [ -f "$WB" ] && ! grep -q __hdAbSeed "$WB"; then
  log "seeding WSL2 code-server workbench.html (trusted domains + activity bar + clean sidebar)"
  sudo python3 - "$WB" <<'PY'
import sys
wb = sys.argv[1]
html = open(wb).read()
SCRIPT = ('<script>(function(){try{var r=indexedDB.open("vscode-web-state-db-global",1);'
 'r.onsuccess=function(e){var d=e.target.result;'
 'try{var t=d.transaction("ItemTable","readwrite");t.objectStore("ItemTable").put(JSON.stringify(["*"]),"http.linkProtectionTrustedDomains")}catch(_){}'
 'try{var t1=d.transaction("ItemTable","readonly");var os1=t1.objectStore("ItemTable");'
 'var sg=os1.get("adom.activityBarSeeded");sg.onsuccess=function(){if(sg.result)return;'
 'var pg=os1.get("workbench.activity.pinnedViewlets2");pg.onsuccess=function(){'
 'var arr=[];try{if(pg.result)arr=JSON.parse(pg.result)}catch(_){}'
 'var ids=["workbench.view.search","workbench.view.scm","workbench.view.debug"];'
 'ids.forEach(function(id){var f=null;for(var i=0;i<arr.length;i++){if(arr[i].id===id)f=arr[i]}'
 'if(f){f.pinned=false}else{arr.push({id:id,pinned:false,visible:false})}});'
 'try{var t2=d.transaction("ItemTable","readwrite");var o2=t2.objectStore("ItemTable");'
 'o2.put(JSON.stringify(arr),"workbench.activity.pinnedViewlets2");o2.put("1","adom.activityBarSeeded")}catch(_){}}}}catch(_){}};'
 'window.__hdTrustedDomains=1;window.__hdAbSeed=1}catch(_){}})();</script>'
 # Collapse the primary sidebar ONCE per profile so the golden image opens clean
 # (no Explorer panel). Guarded by a localStorage marker so it won't fight the
 # user if they later open it. Sidebar visibility is workspace-scoped (not a
 # global IndexedDB key), so we drive VS Code's own toggle (Ctrl+B / keyCode 66)
 # after the workbench mounts rather than hand-crafting the grid serialization.
 '<script>(function(){try{'
 'var fk="adom.sidebarSeeded:"+((new URLSearchParams(location.search)).get("folder")||"_");'
 'if(localStorage.getItem(fk))return;'
 'var n=0;var iv=setInterval(function(){n++;try{'
 'if(document.querySelector(".monaco-workbench .part.editor")){'
 'var sb=document.querySelector(".part.sidebar");'
 'if(sb&&sb.getBoundingClientRect().width>3){'
 'var e=new KeyboardEvent("keydown",{key:"b",code:"KeyB",ctrlKey:true,bubbles:true,cancelable:true});'
 'Object.defineProperty(e,"keyCode",{get:function(){return 66}});'
 'Object.defineProperty(e,"which",{get:function(){return 66}});'
 'var t=document.querySelector(".monaco-workbench")||document.body;'
 '[window,document,t].forEach(function(x){try{x.dispatchEvent(e)}catch(_){}});}'
 'localStorage.setItem(fk,"1");clearInterval(iv);}'
 'else if(n>120){clearInterval(iv);}}catch(_){clearInterval(iv);}},500);}catch(_){}})();</script>')
if '__hdAbSeed' not in html:
    html = html.replace('</head>', SCRIPT + '</head>')
    open(wb, 'w').write(html)
PY
fi
log "done"
