"use strict";
// Credentials stay in this browser, outside exported workout backups.
const CLOUD_KEY = "liftlog.sheets.v1";
let cloud;
try { cloud = JSON.parse(localStorage.getItem(CLOUD_KEY)) || {}; } catch (_) { cloud = {}; }
let cloudBusy = false, cloudTimer, cloudMessage = "Not connected";
function cloudData() { return { sessions: S.sessions, bw: S.bw }; }
function cloudSignature() { return JSON.stringify(cloudData()); }
function cloudConfigSave() { localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud)); }
function cloudStatus(message) {
  cloudMessage = message;
  const el = document.getElementById("cloudStatus");
  if (el) el.textContent = message;
}
function cloudCard() {
  return `<div class="card"><h2>Google Sheets backup</h2>
  <p class="mute">Completed workouts and bodyweight save automatically when online. Drafts stay on this device. Restore manually on another device. Local deletions do not delete sheet backups.</p>
  <label class="mute">Apps Script web app URL<input id="cloudUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cloud.url || "")}"></label>
  <label class="mute">Private backup key<input id="cloudToken" type="password" autocomplete="off" value="${esc(cloud.token || "")}"></label>
  <div class="row wrap" style="margin-top:10px">
  <button class="pri sm" data-cloud="connect">Connect &amp; test</button>
  <button class="sm" data-cloud="backup">Back up now</button>
  <button class="sm" data-cloud="restore">Restore from Sheets</button>
  <button class="sm" data-cloud="disconnect">Disconnect</button></div>
  <p class="mute" id="cloudStatus" role="status" aria-live="polite">${esc(cloudMessage)}</p>
  <p class="mute">Last confirmed backup: ${cloud.lastAt ? esc(new Date(cloud.lastAt).toLocaleString()) : "none"}. Setup: see GOOGLE_SHEETS_SETUP.md in the repository.</p></div>`;
}
const originalViewSettings = viewSettings;
viewSettings = function () { return originalViewSettings() + cloudCard(); };
async function cloudRequest(action, data) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(cloud.url || "") || !cloud.token)
    throw Error("Enter the deployed /exec URL and private backup key, then connect.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(cloud.url, {
      method: "POST", redirect: "follow", credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: cloud.token, data }),
      signal: controller.signal, cache: "no-store"
    });
    if (!response.ok) throw Error("Google returned HTTP " + response.status);
    let result;
    try { result = await response.json(); } catch (_) { throw Error("Google did not return JSON. Check deployment access and use the /exec URL."); }
    if (!result.ok) throw Error(result.error || "Backup request failed.");
    return result;
  } finally { clearTimeout(timeout); }
}
function scheduleSheetsBackup() {
  clearTimeout(cloudTimer);
  if (!cloud.connected || !cloud.url || cloudSignature() === cloud.lastData) return;
  cloudStatus(navigator.onLine === false ? "Offline — changes are waiting on this device." : "Changes waiting for backup…");
  if (navigator.onLine !== false) cloudTimer = setTimeout(() => runCloud("backup"), 1500);
}
async function runCloud(action) {
  if (cloudBusy) { cloudStatus("A Sheets request is already running."); return; }
  cloudBusy = true;
  const connection = cloud.url + cloud.token;
  cloudStatus(action === "restore" ? "Reading backup…" : action === "test" ? "Testing connection…" : "Saving to Sheets…");
  let success = false;
  try {
    const snapshot = JSON.parse(cloudSignature());
    const signature = JSON.stringify(snapshot);
    const result = await cloudRequest(action, action === "backup" ? snapshot : undefined);
    if (connection !== cloud.url + cloud.token) return;
    if (action === "restore") {
      const data = result.data;
      validateCloudData(data);
      if (S.draft) throw Error("Finish or discard the current workout before restoring.");
      if (!confirm("Merge " + data.sessions.length + " workouts and " + data.bw.length + " bodyweight records? Existing local records with the same ID/date stay unchanged.")) {
        cloudStatus("Restore cancelled."); return;
      }
      const sessions = new Map(data.sessions.map(s => [s.id, s]));
      S.sessions.forEach(s => sessions.set(s.id, s));
      const bw = new Map(data.bw.map(b => [b.date, b]));
      S.bw.forEach(b => bw.set(b.date, b));
      const next = { ...S, sessions: [...sessions.values()].sort((a,b) => a.date.localeCompare(b.date)), bw: [...bw.values()].sort((a,b) => a.date.localeCompare(b.date)) };
      localStorage.setItem(KEY, JSON.stringify(next));
      S = next;
      cloudStatus("Restored. Existing local records were preserved.");
      render();
    } else if (action === "test") {
      cloud.connected = true; cloudConfigSave();
      cloudStatus("Connected. Your sheet is ready.");
    } else {
      cloud.lastData = signature; cloud.lastAt = new Date().toISOString(); cloudConfigSave();
      cloudStatus("Saved to Google Sheets — confirmed.");
    }
    success = true;
  } catch (error) {
    cloudStatus("Not confirmed: " + (error.name === "AbortError" ? "request timed out. Retry safely; records are matched by ID." : error.message));
  } finally {
    cloudBusy = false;
    if (success && cloud.connected && cloudSignature() !== cloud.lastData) scheduleSheetsBackup();
  }
}
function validateCloudData(data) {
  if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.bw)) throw Error("Invalid backup data.");
  const date = /^\d{4}-\d{2}-\d{2}$/;
  data.sessions.forEach(s => {
    if (!s || typeof s.id !== "string" || !s.id || !date.test(s.date) || typeof s.type !== "string" || !Array.isArray(s.exercises)) throw Error("Invalid workout record.");
    s.exercises.forEach(e => {
      if (!e || typeof e.name !== "string" || !["wt","bw","time"].includes(e.kind) || !Array.isArray(e.sets)) throw Error("Invalid exercise record.");
      e.sets.forEach(t => {
        if (!t || typeof t.done !== "boolean" || !Number.isFinite(Number(t.r)) || Number(t.r) < 0 || (e.kind === "wt" && (!Number.isFinite(Number(t.w)) || Number(t.w) < 0))) throw Error("Invalid set record.");
      });
    });
  });
  data.bw.forEach(b => { if (!b || !date.test(b.date) || !Number.isFinite(b.kg) || b.kg < 20 || b.kg > 300) throw Error("Invalid bodyweight record."); });
}
document.addEventListener("click", event => {
  const button = event.target.closest("[data-cloud]");
  if (!button) return;
  const action = button.dataset.cloud;
  if (cloudBusy) { cloudStatus("Wait for the current request to finish."); return; }
  if (action === "connect") {
    const url = document.getElementById("cloudUrl").value.trim();
    const token = document.getElementById("cloudToken").value.trim();
    if (cloud.url !== url || cloud.token !== token) cloud = { url, token };
    cloud.connected = false;
    cloudConfigSave(); runCloud("test");
  } else if (action === "disconnect") {
    clearTimeout(cloudTimer); cloud = {}; localStorage.removeItem(CLOUD_KEY);
    cloudStatus("Disconnected. Your local records and sheet backup are kept."); render();
  } else runCloud(action);
});
window.addEventListener("online", scheduleSheetsBackup);
window.addEventListener("offline", () => { if (cloud.connected) cloudStatus("Offline — local saving continues."); });
if (cloud.connected) { cloudStatus("Connected. Checking for changes…"); scheduleSheetsBackup(); }

