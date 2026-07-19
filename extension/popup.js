import { testBatch } from "./lib/schema.js";

const el = (id) => document.getElementById(id);

function message(text, ok = true) {
  const m = el("msg");
  m.textContent = text;
  m.className = "msg " + (ok ? "ok" : "err");
}

function setLabel(on) {
  el("annotate").textContent = on ? "Stop annotating" : "Start annotating";
}

chrome.runtime.sendMessage({ type: "vfb-isActive" }, (res) => {
  if (chrome.runtime.lastError) return;
  setLabel(!!(res && res.on));
});

el("annotate").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "vfb-toggleActiveTab" }, (res) => {
    if (chrome.runtime.lastError) return message(chrome.runtime.lastError.message, false);
    if (res && res.ok) {
      setLabel(res.on);
      if (res.on) window.close();
      else message("Stopped");
    } else {
      message((res && res.error) || "Not available on this page", false);
    }
  });
});

const OPTS = [
  ["optShots", "vfbShots"],
  ["optCss", "vfbCss"],
];
chrome.storage.local.get({ vfbShots: true, vfbCss: true }, (s) => {
  if (chrome.runtime.lastError) return;
  for (const [id, key] of OPTS) el(id).checked = !!s[key];
});
for (const [id, key] of OPTS) {
  el(id).addEventListener("change", () => {
    chrome.storage.local.set({ [key]: el(id).checked });
  });
}

el("test").addEventListener("click", () => {
  const btn = el("test");
  btn.disabled = true;
  message("Writing…");
  chrome.runtime.sendMessage({ type: "writeBatchDownload", batch: testBatch() }, (res) => {
    btn.disabled = false;
    if (chrome.runtime.lastError) return message(chrome.runtime.lastError.message, false);
    if (res && res.ok) message(`Saved ${res.name}`);
    else message((res && res.error) || "Download failed", false);
  });
});
