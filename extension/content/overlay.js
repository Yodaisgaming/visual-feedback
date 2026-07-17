(function () {
  const isTop = window === window.top;
  const dead = () => !(chrome.runtime && chrome.runtime.id);
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
  const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  function detectSite(url) {
    try { return { host: new URL(url).hostname.replace(/^www\./, "") }; } catch (_) { return null; }
  }

  const KEEP_CSS = [
    "display", "position", "width", "height",
    "font-size", "font-weight", "line-height", "font-family",
    "color", "background-color", "text-align",
    "padding", "margin", "border", "border-radius",
    "flex-direction", "justify-content", "align-items", "gap",
  ];

  const STYLE = `
    .hl { position: fixed; z-index: 1; pointer-events: none; box-sizing: border-box;
      border: 2px solid #2563eb; background: rgba(37,99,235,.12); display: none; }
    .hl::before { content: attr(data-label); position: absolute; top: -18px; left: 0;
      font: 11px/1 ui-monospace, monospace; color: #fff; background: #2563eb;
      padding: 2px 5px; border-radius: 3px; white-space: nowrap; }
    .markers { position: fixed; inset: 0; z-index: 2; pointer-events: none; }
    .marker { position: fixed; transform: translate(-50%, -50%); min-width: 20px; height: 20px;
      padding: 0 4px; border-radius: 10px; background: #2563eb; color: #fff;
      font: 700 12px/20px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff; }
    .pop { position: fixed; z-index: 4; width: 280px; pointer-events: auto; box-sizing: border-box;
      background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px;
      padding: 10px; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
    .pop-sel { font: 11px/1.3 ui-monospace, monospace; color: #93c5fd; margin-bottom: 6px; word-break: break-all; }
    .pop-input { width: 100%; box-sizing: border-box; resize: vertical; background: #1e293b;
      color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 6px; font: inherit; }
    .pop-row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
    .pop-row button { border: 0; border-radius: 6px; padding: 6px 12px; font: 500 12px system-ui; cursor: pointer; }
    .pop-cancel { background: #334155; color: #e2e8f0; }
    .pop-save { background: #2563eb; color: #fff; }
    .panel { position: fixed; right: 12px; bottom: 12px; z-index: 3; width: 300px; max-height: 50vh;
      display: flex; flex-direction: column; pointer-events: auto; background: #0f172a; color: #e2e8f0;
      border: 1px solid #334155; border-radius: 8px; font: 12px/1.4 system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.4); overflow: hidden; }
    .panel-head { display: flex; justify-content: space-between; align-items: center;
      padding: 8px 10px; border-bottom: 1px solid #334155; font-weight: 600; }
    .panel-count { background: #2563eb; color: #fff; border-radius: 9px; padding: 1px 7px; font-size: 11px; }
    .panel-list { overflow: auto; padding: 4px 0; }
    .panel-row { padding: 6px 10px; border-bottom: 1px solid #1e293b; }
    .panel-row code { color: #93c5fd; font-size: 11px; word-break: break-all; }
    .panel-comment { color: #94a3b8; margin-top: 2px; }
    .panel-actions { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #334155; }
    .panel-actions button { flex: 1; border: 0; border-radius: 6px; padding: 6px; font: 500 12px system-ui;
      cursor: pointer; background: #334155; color: #e2e8f0; }
    .panel-actions .panel-submit { background: #2563eb; color: #fff; }
    .panel-rowhead { display: flex; justify-content: space-between; align-items: center; }
    .row-del { flex: none; border: 0; background: transparent; color: #94a3b8; cursor: pointer;
      font: 16px/1 system-ui; padding: 0 2px; }
    .row-del:hover { color: #ef4444; }
    .panel-msg { padding: 0 10px 8px; min-height: 8px; font-size: 11px; color: #22c55e; }
  `;

  let host = null, shadow = null, hi = null, markers = null, panel = null, popover = null;
  let hoverEl = null;
  const pins = [];
  const pinEls = new Map();
  let pinSeq = 0;
  // The overlay owns its own on/off truth. The MV3 service worker is ephemeral —
  // its in-memory state is wiped when it sleeps — so the background must not be
  // the source of truth for the toggle. This content script lives as long as the
  // page does, so it is the reliable authority (fixes "won't toggle off").
  let active = false;

  const g = (window.__vfb = window.__vfb || {});
  if (g.teardown) { try { g.teardown(); } catch (_) {} }
  if (g.listener) { try { chrome.runtime.onMessage.removeListener(g.listener); } catch (_) {} }
  const onRuntimeMessage = (msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "vfb-ping") { sendResponse({ ok: true }); return true; }
    if (msg.type === "vfb-toggle") setActive(msg.on);
    else if (msg.type === "vfb-toggle-self") { setActive(!active); sendResponse({ on: active }); return true; }
    else if (msg.type === "vfb-queryActive") { sendResponse({ on: active }); return true; }
    else if (msg.type === "vfb-addPin" && isTop) receivePin(msg.pin);
    else if (msg.type === "vfb-getPins" && isTop) { sendResponse({ pins }); return true; }
    return false;
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  g.listener = onRuntimeMessage;
  g.teardown = unmount;

  function setActive(on) {
    active = on;
    if (on) mount(); else unmount();
  }

  function mount() {
    if (!host) buildUi();
    host.style.display = "block";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onScrollResize);
    document.addEventListener("scroll", onScrollResize, true);
    positionAllMarkers();
  }

  function unmount() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onScrollResize);
    document.removeEventListener("scroll", onScrollResize, true);
    clearHighlight();
    closePopover();
    if (host) host.style.display = "none";
  }

  function buildUi() {
    for (const n of document.querySelectorAll("[data-vfb-host]")) n.remove();
    host = document.createElement("div");
    host.setAttribute("data-vfb-host", "1");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none;";
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);
    hi = document.createElement("div"); hi.className = "hl"; shadow.appendChild(hi);
    markers = document.createElement("div"); markers.className = "markers"; shadow.appendChild(markers);
    if (isTop) { panel = buildPanel(); shadow.appendChild(panel); }
    (document.documentElement || document.body).appendChild(host);
  }

  function isOurs(el) {
    return !!el && !!shadow && (el === host || el.getRootNode() === shadow);
  }

  function outerHost(el) {
    let node = el, h = null;
    while (node) {
      const root = node.getRootNode();
      if (root instanceof ShadowRoot && root !== shadow) { h = root.host; node = h; }
      else break;
    }
    return h;
  }

  function pickTarget(e) {
    const path = e.composedPath ? e.composedPath() : null;
    let el = path && path.length ? path[0] : e.target;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!(el instanceof Element)) return null;
    return outerHost(el) || el;
  }

  function onMove(e) {
    if (dead()) { unmount(); return; }
    if (!e.isTrusted) return;
    const el = pickTarget(e);
    if (!el || isOurs(el)) { return; }
    if (el === hoverEl) return;
    hoverEl = el;
    drawHighlight(el);
  }

  async function onClick(e) {
    if (dead()) { unmount(); return; }
    if (!e.isTrusted) return;
    const el = pickTarget(e);
    if (isOurs(el)) return;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const cap = capture(el);
    cap.screenshot = await grabShot(el);
    openPopover(el, cap);
  }

  function sendMessageAsync(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
    });
  }

  async function grabShot(el) {
    if (!isTop) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const rect = { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 };
    const prev = host ? host.style.display : "none";
    if (host) host.style.display = "none";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const res = await sendMessageAsync({ type: "vfb-shot", rect });
      return res && res.dataUrl ? res.dataUrl : null;
    } finally {
      if (host) host.style.display = prev;
    }
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (popover) { e.preventDefault(); closePopover(); }
    }
  }

  function drawHighlight(el) {
    const r = el.getBoundingClientRect();
    hi.style.display = "block";
    hi.style.top = r.top + "px";
    hi.style.left = r.left + "px";
    hi.style.width = r.width + "px";
    hi.style.height = r.height + "px";
    hi.dataset.label = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");
  }

  function clearHighlight() { if (hi) hi.style.display = "none"; hoverEl = null; }

  function isNoisyClass(c) {
    if (!c) return true;
    if (/^(css|sc|jsx|emotion|chakra|mui)-/i.test(c)) return true;
    if (/^[a-z]+-[a-f0-9]{5,}$/i.test(c) && /[a-f]/i.test(c.split("-").pop())) return true;
    if (/__[a-z0-9]{4,}$/i.test(c)) return true;
    if (/[a-f0-9]{6,}/i.test(c) && /[0-9]/.test(c) && /[a-f]/i.test(c)) return true;
    if (/^[a-z]{1,3}[0-9]{3,}$/i.test(c)) return true;
    return false;
  }

  function stableClassesOf(el) {
    return Array.from(el.classList || []).filter((c) => !isNoisyClass(c));
  }

  function indexOfType(node) {
    const parent = node.parentElement;
    if (!parent) return 0;
    const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
    if (same.length <= 1) return 0;
    return same.indexOf(node) + 1;
  }

  function buildSelector(el) {
    if (el.id && !isNoisyClass(el.id)) {
      const sel = "#" + esc(el.id);
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (_) {}
    }
    const testid = el.getAttribute("data-testid");
    if (testid) {
      const tsel = `[data-testid="${testid.replace(/"/g, '\\"')}"]`;
      try { if (document.querySelectorAll(tsel).length === 1) return tsel; } catch (_) {}
    }
    const parts = [];
    let node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      if (node.id && !isNoisyClass(node.id)) { parts.unshift("#" + esc(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const sc = stableClassesOf(node).slice(0, 2);
      if (sc.length) part += "." + sc.map(esc).join(".");
      const parent = node.parentElement;
      if (parent) {
        const twin = Array.prototype.some.call(parent.children, (c) =>
          c !== node && c.tagName === node.tagName && sc.every((cl) => c.classList.contains(cl))
        );
        if (twin) { const idx = indexOfType(node); if (idx) part += `:nth-of-type(${idx})`; }
      }
      parts.unshift(part);
      try { if (document.querySelectorAll(parts.join(" > ")).length === 1) break; } catch (_) {}
      node = node.parentElement; depth++;
    }
    return parts.join(" > ");
  }

  function instanceOf(el, selector) {
    try {
      const all = document.querySelectorAll(selector);
      if (all.length <= 1) return "1 of 1";
      return `${Array.prototype.indexOf.call(all, el) + 1} of ${all.length}`;
    } catch (_) { return "1 of 1"; }
  }

  function domPath(el) {
    const parts = [];
    let node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      let s = node.tagName.toLowerCase();
      const sc = stableClassesOf(node)[0];
      if (sc) s += "." + sc;
      parts.unshift(s);
      node = node.parentElement; depth++;
    }
    return parts.join(" > ");
  }

  function visibleText(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      return (el.getAttribute("placeholder") || el.value || "").trim().slice(0, 120);
    }
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function capture(el) {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cssBefore = {};
    for (const p of KEEP_CSS) {
      const v = cs.getPropertyValue(p).trim();
      if (v && v !== "normal" && v !== "none" && v !== "auto") cssBefore[camel(p)] = v;
    }
    const selector = buildSelector(el);
    return {
      anchor: {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        testid: el.getAttribute("data-testid") || null,
        ariaLabel: el.getAttribute("aria-label") || null,
        text: visibleText(el),
        selector,
        domPath: domPath(el),
        instance: instanceOf(el, selector),
        stableClasses: stableClassesOf(el),
        noisyClasses: Array.from(el.classList || []).filter(isNoisyClass),
      },
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      cssBefore,
    };
  }

  function openPopover(el, cap) {
    closePopover();
    const rect = el.getBoundingClientRect();
    popover = document.createElement("div");
    popover.className = "pop";
    popover.innerHTML =
      '<div class="pop-sel"></div>' +
      '<textarea class="pop-input" rows="2" placeholder="What should change?"></textarea>' +
      '<div class="pop-row"><button class="pop-cancel">Cancel</button><button class="pop-save">Save</button></div>';
    shadow.appendChild(popover);
    popover.querySelector(".pop-sel").textContent =
      cap.anchor.selector + "  ·  " + cap.anchor.instance + (cap.screenshot ? "" : "  ·  no screenshot");
    const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 130));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 292));
    popover.style.top = top + "px";
    popover.style.left = left + "px";
    const input = popover.querySelector(".pop-input");
    input.focus();
    popover.querySelector(".pop-cancel").addEventListener("click", closePopover);
    popover.querySelector(".pop-save").addEventListener("click", () => save(el, cap, input.value.trim()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(el, cap, input.value.trim()); }
      else if (e.key === "Escape") { e.preventDefault(); closePopover(); }
    });
  }

  function save(el, cap, comment) {
    const pin = {
      comment,
      frameUrl: isTop ? null : location.href,
      anchor: cap.anchor,
      box: cap.box,
      cssBefore: cap.cssBefore,
      screenshot: cap.screenshot || null,
    };
    if (isTop) pin._el = el;
    commitPin(pin);
    closePopover();
    clearHighlight();
  }

  function closePopover() { if (popover) { popover.remove(); popover = null; } }

  function commitPin(pin) {
    if (isTop) receivePin(pin);
    else chrome.runtime.sendMessage({ type: "vfb-pin", pin });
  }

  function receivePin(pin) {
    pin.n = ++pinSeq;
    const el = pin._el; delete pin._el;
    pins.push(pin);
    if (el) pinEls.set(pin.n, el);
    if (!pin.frameUrl) drawMarker(pin);
    updatePanel();
    console.log("[VFB] pin", pin);
  }

  function drawMarker(pin) {
    const m = document.createElement("div");
    m.className = "marker";
    m.textContent = pin.n;
    m.dataset.n = pin.n;
    markers.appendChild(m);
    positionMarker(m);
  }

  function positionMarker(m) {
    const n = +m.dataset.n;
    const el = pinEls.get(n);
    let cx, cy, off = false;
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      off = r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth;
    } else {
      const pin = pins.find((p) => p.n === n);
      if (!pin) return;
      cx = pin.box.x + pin.box.w / 2;
      cy = pin.box.y + pin.box.h / 2;
    }
    m.style.display = off ? "none" : "";
    m.style.left = cx + "px";
    m.style.top = cy + "px";
  }

  function positionAllMarkers() {
    if (!markers) return;
    for (const m of markers.children) positionMarker(m);
  }

  let repositionQueued = false;
  function onScrollResize() {
    if (dead()) { unmount(); return; }
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(() => { repositionQueued = false; positionAllMarkers(); });
  }

  function buildPanel() {
    const p = document.createElement("div");
    p.className = "panel";
    p.innerHTML =
      '<div class="panel-head"><span>Feedback</span><span class="panel-count">0</span></div>' +
      '<div class="panel-list"></div>' +
      '<div class="panel-actions"><button class="panel-submit">Submit</button><button class="panel-clear">Clear</button></div>' +
      '<div class="panel-msg"></div>';
    p.querySelector(".panel-submit").addEventListener("click", submitPins);
    p.querySelector(".panel-clear").addEventListener("click", clearPins);
    return p;
  }

  function updatePanel() {
    if (!panel) return;
    panel.querySelector(".panel-count").textContent = pins.length;
    const list = panel.querySelector(".panel-list");
    list.textContent = "";
    for (const pin of pins) {
      const row = document.createElement("div");
      row.className = "panel-row";
      const head = document.createElement("div");
      head.className = "panel-rowhead";
      const b = document.createElement("b");
      b.textContent = "#" + pin.n + (pin.frameUrl ? " (iframe)" : "") + (pin.screenshot ? " \u{1F4F7}" : "");
      const del = document.createElement("button");
      del.className = "row-del"; del.textContent = "×"; del.title = "Remove";
      del.addEventListener("click", () => removePin(pin.n));
      head.appendChild(b); head.appendChild(del);
      const code = document.createElement("code");
      code.textContent = pin.anchor.selector;
      const cm = document.createElement("div");
      cm.className = "panel-comment";
      cm.textContent = pin.comment || "(no comment)";
      row.appendChild(head); row.appendChild(code); row.appendChild(cm);
      list.appendChild(row);
    }
  }

  function removePin(n) {
    const i = pins.findIndex((p) => p.n === n);
    if (i >= 0) pins.splice(i, 1);
    pinEls.delete(n);
    redrawMarkers();
    updatePanel();
  }

  function redrawMarkers() {
    if (!markers) return;
    markers.textContent = "";
    for (const p of pins) if (!p.frameUrl) drawMarker(p);
  }

  async function submitPins() {
    if (!pins.length) { flash("No pins to submit"); return; }
    const createdAt = new Date().toISOString();
    const batchId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const site = detectSite(location.href);
    const fname = `vfb-${createdAt.replace(/[:.]/g, "-")}-${batchId.slice(0, 8)}.json`;
    const pointer =
      `Take my visual feedback — batch ${fname} ` +
      `(${site ? site.host : "this page"} · ${pins.length} pin${pins.length > 1 ? "s" : ""})`;
    let copied = false;
    if (navigator.clipboard) { try { await navigator.clipboard.writeText(pointer); copied = true; } catch (_) {} }
    const batch = {
      schemaVersion: 1,
      batchId,
      createdAt,
      pageUrl: location.href,
      site,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      annotations: pins.map((p, i) => Object.assign({}, p, { n: i + 1 })),
    };
    flash("Submitting…");
    chrome.runtime.sendMessage({ type: "writeBatchDownload", batch }, (res) => {
      if (chrome.runtime.lastError) return flash("Failed: " + chrome.runtime.lastError.message);
      if (res && res.ok) { flash(copied ? "Saved. Pointer copied, paste into your agent." : "Saved to Downloads. Clipboard was blocked."); clearPins(); }
      else flash("Failed: " + ((res && res.error) || "unknown"));
    });
  }

  let flashTimer = null;
  function flash(text) {
    if (!panel) return;
    const m = panel.querySelector(".panel-msg");
    m.textContent = text;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { m.textContent = ""; }, 4000);
  }

  function clearPins() {
    pins.length = 0; pinSeq = 0;
    pinEls.clear();
    if (markers) markers.textContent = "";
    updatePanel();
  }
})();
