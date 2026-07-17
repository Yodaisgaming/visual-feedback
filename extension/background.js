const activeTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
  console.log("Visual Feedback installed");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  if (msg.type === "writeBatchDownload") {
    writeBatchDownload(msg.batch).then(
      (name) => sendResponse({ ok: true, name }),
      (err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
    );
    return true;
  }

  if (msg.type === "vfb-pin" && sender.tab) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "vfb-addPin", pin: msg.pin }, { frameId: 0 }).catch(() => {});
    return false;
  }

  if (msg.type === "vfb-toggleActiveTab") {
    toggleActiveTab().then(
      (on) => sendResponse({ ok: true, on }),
      (err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
    );
    return true;
  }

  if (msg.type === "vfb-isActive") {
    getActiveTabId().then(async (id) => {
      if (id == null) return sendResponse({ on: false });
      // Ask the overlay itself — activeTabs is only a best-effort cache and is
      // lost whenever the service worker sleeps.
      const res = await chrome.tabs.sendMessage(id, { type: "vfb-queryActive" }, { frameId: 0 }).catch(() => null);
      sendResponse({ on: !!(res && res.on) });
    });
    return true;
  }

  if (msg.type === "vfb-shot" && sender.tab) {
    captureCrop(sender.tab.windowId, msg.rect).then(
      (dataUrl) => sendResponse({ dataUrl }),
      () => sendResponse({ dataUrl: null })
    );
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "toggle-overlay") toggleActiveTab().catch(() => {});
});

chrome.tabs.onRemoved.addListener((id) => activeTabs.delete(id));
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === "loading") activeTabs.delete(id);
});

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

async function ensureInjected(tabId) {
  const alive = await chrome.tabs
    .sendMessage(tabId, { type: "vfb-ping" }, { frameId: 0 })
    .then((r) => !!(r && r.ok))
    .catch(() => false);
  if (alive) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/overlay.js"] });
  // Child frames are best-effort; a single cross-origin frame must not abort.
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content/overlay.js"] });
  } catch (_) {}
}

async function toggleActiveTab() {
  const tabId = await getActiveTabId();
  if (tabId == null) throw new Error("No active tab");
  await ensureInjected(tabId);
  // The overlay owns the on/off truth (survives SW eviction) — ask it to flip and
  // tell us the new state, instead of guessing from wiped in-memory state.
  const res = await chrome.tabs.sendMessage(tabId, { type: "vfb-toggle-self" }, { frameId: 0 }).catch(() => null);
  const on = res && typeof res.on === "boolean" ? res.on : true;
  // Mirror the new state into child frames so their sub-overlays match the top.
  chrome.tabs.sendMessage(tabId, { type: "vfb-toggle", on }).catch(() => {});
  if (on) activeTabs.add(tabId); else activeTabs.delete(tabId);
  return on;
}

const SHOT_MAX_W = 900;

async function captureCrop(windowId, rect) {
  const shot = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  const dpr = rect.dpr || 1;
  const vw = bmp.width / dpr, vh = bmp.height / dpr;
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const x1 = Math.min(vw, rect.x + rect.w), y1 = Math.min(vh, rect.y + rect.h);
  if (x1 - x0 < 1 || y1 - y0 < 1) { bmp.close(); return null; }
  const sx = Math.round(x0 * dpr), sy = Math.round(y0 * dpr);
  const sw = Math.max(1, Math.min(Math.round((x1 - x0) * dpr), bmp.width - sx));
  const sh = Math.max(1, Math.min(Math.round((y1 - y0) * dpr), bmp.height - sy));
  const scale = Math.min(1, SHOT_MAX_W / sw);
  const cw = Math.max(1, Math.round(sw * scale));
  const ch = Math.max(1, Math.round(sh * scale));
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, ch);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.7 });
  return blobToDataUrl(blob);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return "data:" + (blob.type || "image/webp") + ";base64," + btoa(bin);
}

async function writeBatchDownload(batch) {
  const stamp = String(batch.createdAt).replace(/[:.]/g, "-");
  const filename = `visual-feedback/vfb-${stamp}-${String(batch.batchId).slice(0, 8)}.json`;
  const dataUrl = "data:application/json;base64," + utf8ToBase64(JSON.stringify(batch, null, 2));
  const id = await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });
  await waitForDownloadComplete(id);
  return filename;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function waitForDownloadComplete(id, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settle();
      reject(new Error("Download did not complete within 15s"));
    }, timeoutMs);
    function settle() {
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
    }
    function onChanged(delta) {
      if (delta.id !== id || settled) return;
      if (delta.error) { settle(); reject(new Error(delta.error.current)); }
      else if (delta.state && delta.state.current === "complete") { settle(); resolve(); }
    }
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id }).then((items) => {
      const it = items && items[0];
      if (!it || settled) return;
      if (it.state === "complete") { settle(); resolve(); }
      else if (it.state === "interrupted") { settle(); reject(new Error(it.error || "interrupted")); }
    }).catch(() => {});
  });
}
