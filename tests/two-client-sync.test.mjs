#!/usr/bin/env node
/**
 * tests/two-client-sync.test.mjs
 *
 * Automated Two-Client Real-Time Synchronization Test Suite
 * ---------------------------------------------------------
 * Connects TWO independent WebSocket clients (Client A + Client B) to the
 * live production Cloudflare Worker, performs mutations via REST API as
 * Client A, and verifies Client B receives real-time events WITHOUT refresh.
 *
 * Usage:
 *   node tests/two-client-sync.test.mjs
 *   BASE_URL=https://nexrall-hr-manager-marketing.netviettv-hr-manager.workers.dev node tests/two-client-sync.test.mjs
 */

import assert from "node:assert/strict";

// polyfill WebSocket for Node
let WS;
try {
  const mod = await import("ws").catch(() => ({ default: null }));
  WS = mod.default || globalThis.WebSocket;
} catch {
  WS = globalThis.WebSocket;
}
if (!WS) {
  console.error("[FATAL] WebSocket not available. Install the ws package: npm i -D ws");
  process.exit(1);
}

const BASE_URL = process.env.BASE_URL || "https://nexrall-hr-manager-marketing.netviettv-hr-manager.workers.dev";
const WS_URL   = BASE_URL.replace(/^http/, "ws");
const CLIENT_A_LOGIN = process.env.CLIENT_A_LOGIN || "admin@company.com";
const CLIENT_A_PASS  = process.env.CLIENT_A_PASS  || "Admin@123";
const CLIENT_B_LOGIN = process.env.CLIENT_B_LOGIN || CLIENT_A_LOGIN;
const CLIENT_B_PASS  = process.env.CLIENT_B_PASS  || CLIENT_A_PASS;
const EVENT_TIMEOUT_MS   = 8_000;
const CONNECT_TIMEOUT_MS = 10_000;

let passed = 0; let failed = 0; const failures = [];
function pass(name) { passed++; console.log("  PASS  " + name); }
function fail(name, reason) { failed++; failures.push({ name, reason }); console.error("  FAIL  " + name + "\n         " + reason); }

async function api(path, { method = "GET", token, body, expected } = {}) {
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE_URL + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (expected !== undefined && res.status !== expected)
    throw new Error(method + " " + path + " => " + res.status + " (expected " + expected + "): " + JSON.stringify(data).slice(0, 200));
  return { status: res.status, data };
}

async function doLogin(loginName, password) {
  const { data } = await api("/api/auth/login", { method: "POST", body: { login: loginName, password }, expected: 200 });
  assert.match(data.token, /^[0-9a-f]{64}$/, "Login failed for " + loginName);
  return data;
}

class SyncClient {
  constructor(name) { this.name = name; this.token = null; this.user = null; this.ws = null; this.received = []; this._resolvers = []; }
  async authenticate(l, p) { const d = await doLogin(l, p); this.token = d.token; this.user = d.user; console.log("  [" + this.name + "] Authenticated as " + this.user.full_name + " (id=" + this.user.id + ")"); }
  async connect() {
    return new Promise((resolve, reject) => {
      const url = WS_URL + "/api/realtime/ws?token=" + this.token + "&topics=tasks,chat,leave,attendance,payroll,users,notifications";
      this.ws = new WS(url);
      const timeout = setTimeout(() => reject(new Error("[" + this.name + "] WS connect timeout")), CONNECT_TIMEOUT_MS);
      let authResolved = false;
      this.ws.onopen = () => {
        // Send explicit auth message for servers that require it via message
        try { this.ws.send(JSON.stringify({ type: "auth", token: this.token, topics: ["tasks","chat","leave","attendance","payroll","users","notifications"] })); } catch (_) {}
        // Resolve after 800ms if auth:ok never arrives (server may use query-string auth only)
        setTimeout(() => { if (!authResolved) { authResolved = true; clearTimeout(timeout); console.log("  [" + this.name + "] WebSocket ready (timeout fallback)"); resolve(); } }, 800);
      };
      this.ws.onerror = (err) => { clearTimeout(timeout); reject(new Error("[" + this.name + "] WS error: " + (err.message || err))); };
      this.ws.onmessage = (evt) => {
        let parsed; try { parsed = JSON.parse(evt.data); } catch { return; }
        // Resolve on auth:ok
        if (parsed.type === "auth:ok" && !authResolved) {
          authResolved = true; clearTimeout(timeout);
          console.log("  [" + this.name + "] Authenticated via WS (userId=" + parsed.userId + ")");
          resolve(); return;
        }
        if (["ping","pong","welcome","ack","auth:ok","auth:error","subscribe:ok","replay:complete"].includes(parsed.type)) return;
        this.received.push(parsed);
        for (const r of this._resolvers) { if (r.predicate(parsed)) { clearTimeout(r.timer); r.settled = true; r.resolve(parsed); } }
        this._resolvers = this._resolvers.filter(r => !r.settled);
      };
      this.ws.onclose = () => console.log("  [" + this.name + "] WebSocket closed");
    });
  }
  waitForEvent(predicate, ms = EVENT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const already = this.received.find(predicate);
      if (already) { resolve(already); return; }
      const entry = { predicate, settled: false };
      entry.timer = setTimeout(() => { entry.settled = true; reject(new Error("[" + this.name + "] Timeout (" + ms + "ms) waiting for event")); }, ms);
      entry.resolve = (v) => { entry.settled = true; resolve(v); };
      this._resolvers.push(entry);
    });
  }
  clearReceived() { this.received = []; }
  disconnect() { if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; } }
}

async function test(name, fn) { try { await fn(); pass(name); } catch (err) { fail(name, err.message); } }

// ─── MAIN ────────────────────────────────────────────────────────────
console.log("\n=== Two-Client Real-Time Synchronization Test Suite ===");
console.log("Target: " + BASE_URL + "\n");

const clientA = new SyncClient("Client-A");
const clientB = new SyncClient("Client-B");

try { await clientA.authenticate(CLIENT_A_LOGIN, CLIENT_A_PASS); } catch (e) { console.error("[FATAL] Client A auth: " + e.message); process.exit(1); }
try { await clientB.authenticate(CLIENT_B_LOGIN, CLIENT_B_PASS); } catch (e) { console.error("[FATAL] Client B auth: " + e.message); process.exit(1); }

let wsAvailable = true;
console.log("\n--- Connecting WebSockets ---\n");
try {
  await Promise.all([clientA.connect(), clientB.connect()]);
  await new Promise(r => setTimeout(r, 600));
} catch (e) {
  console.warn("WebSocket unavailable: " + e.message + "\nRunning API-only tests.\n");
  wsAvailable = false;
}

// === DOMAIN 1: TASKS ===
console.log("\n--- Domain 1: Tasks ---\n");
let createdTaskId = null;

await test("Tasks: Client A creates task => Client B receives task:created event", async () => {
  if (!wsAvailable) throw new Error("WebSocket not available");
  clientB.clearReceived();
  const title = "TwoClientTest-" + Date.now();
  const evtP = clientB.waitForEvent(e => e.topic === "tasks" || e.event === "task:created" || (e.payload && e.payload.title && e.payload.title.includes("TwoClientTest")));
  const { data, status } = await api("/api/tasks", { method: "POST", token: clientA.token, body: { title, status: "todo", priority: "normal", assigned_to: clientB.user.id } });
  assert.ok([200, 201].includes(status), "Task creation must return 200 or 201, got " + status);
  createdTaskId = (data.task && data.task.id) || data.id;
  assert.ok(createdTaskId, "Task creation must return ID (got: " + JSON.stringify(data) + ")");
  const evt = await evtP;
  assert.ok(evt, "Client B must receive task creation event");
});

await test("Tasks: Client A updates task status => Client B receives task:updated event", async () => {
  if (!wsAvailable || !createdTaskId) throw new Error("Skipped");
  clientB.clearReceived();
  const evtP = clientB.waitForEvent(e => e.topic === "tasks" || e.event === "task:updated");
  await api("/api/tasks/" + createdTaskId, { method: "PUT", token: clientA.token, body: { status: "in_progress" }, expected: 200 });
  const evt = await evtP;
  assert.ok(evt, "Client B must receive task update event");
});

await test("Tasks: Client A deletes task => Client B receives task:deleted event", async () => {
  if (!wsAvailable || !createdTaskId) throw new Error("Skipped");
  clientB.clearReceived();
  const evtP = clientB.waitForEvent(e => e.topic === "tasks" || e.event === "task:deleted");
  const { status } = await api("/api/tasks/" + createdTaskId, { method: "DELETE", token: clientA.token });
  assert.ok([200, 204].includes(status), "Delete must return 200/204");
  const evt = await evtP;
  assert.ok(evt, "Client B must receive task delete event");
  createdTaskId = null;
});

// === DOMAIN 2: TASK COMMENTS ===
console.log("\n--- Domain 2: Task Comments ---\n");
let commentTaskId = null;

await test("Comments: setup task", async () => {
  const { data, status } = await api("/api/tasks", { method: "POST", token: clientA.token, body: { title: "CommentTest-" + Date.now(), status: "todo" } });
  assert.ok([200, 201].includes(status), "Task creation must return 200 or 201");
  commentTaskId = (data.task && data.task.id) || data.id;
  assert.ok(commentTaskId, "Must return task ID");
});

await test("Comments: Client A posts comment => Client B receives comment:created event", async () => {
  if (!wsAvailable || !commentTaskId) throw new Error("Skipped");
  clientB.clearReceived();
  const evtP = clientB.waitForEvent(e => e.topic === "tasks" || e.event === "comment:created");
  await api("/api/tasks/" + commentTaskId + "/comments", { method: "POST", token: clientA.token, body: { content: "@" + clientB.user.full_name + " realtime mention test", mentions: [clientB.user.id] }, expected: 201 });
  const evt = await evtP;
  assert.ok(evt, "Client B must receive comment event");
});

if (commentTaskId) await api("/api/tasks/" + commentTaskId, { method: "DELETE", token: clientA.token }).catch(() => {});

// === DOMAIN 3: LEAVE ===
console.log("\n--- Domain 3: Leave Requests ---\n");
let leaveId = null;

await test("Leave: Client A submits leave => Client B receives leave:created event", async () => {
  if (!wsAvailable) throw new Error("Skipped");
  clientB.clearReceived();
  const evtP = clientB.waitForEvent(e => e.topic === "leave" || e.event === "leave:created");
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const { data, status } = await api("/api/leave", { method: "POST", token: clientA.token, body: { leave_type: "annual", start_date: tomorrow, end_date: tomorrow, reason: "two-client-sync-test" } });
  if ([200, 201].includes(status)) leaveId = (data.leave && data.leave.id) || data.id;
  const evt = await evtP;
  assert.ok(evt, "Client B must receive leave event");
});

if (leaveId) await api("/api/leave/" + leaveId, { method: "DELETE", token: clientA.token }).catch(() => {});

// === DOMAIN 4: CHAT ===
console.log("\n--- Domain 4: Chat Messages ---\n");

await test("Chat: GET /api/conversations returns list", async () => {
  const { data } = await api("/api/conversations", { token: clientA.token, expected: 200 });
  const list = data.conversations || data;
  assert.ok(Array.isArray(list), "Must return conversations array");
});

await test("Chat: Client A sends HTTP message => Client B receives chat event", async () => {
  if (!wsAvailable) throw new Error("Skipped");
  const { data: convData } = await api("/api/conversations", { token: clientA.token, expected: 200 });
  const list = convData.conversations || convData;
  if (!Array.isArray(list) || list.length === 0) throw new Error("No conversations available");
  clientB.clearReceived();
  const evtP = clientB.waitForEvent(e => e.topic === "chat" || e.event === "chat:message" || e.event === "message:new");
  await api("/api/conversations/" + list[0].id + "/messages", { method: "POST", token: clientA.token, body: { content: "[two-client-sync] " + Date.now() }, expected: 201 });
  const evt = await evtP;
  assert.ok(evt, "Client B must receive chat event");
});

// === DOMAIN 5: INFRA HEALTH ===
console.log("\n--- Domain 5: Infrastructure Health ---\n");

await test("Infra: /api/realtime/ws rejects unauthenticated connections", async () => {
  let rejected = false;
  try {
    await new Promise((resolve) => {
      const ws = new WS(WS_URL + "/api/realtime/ws");
      const t = setTimeout(() => { try { ws.close(); } catch (_) {} resolve(); }, 5000);
      ws.onopen = () => { clearTimeout(t); ws.close(); resolve(); };
      ws.onclose = (evt) => { clearTimeout(t); if (evt.code !== 1000) rejected = true; resolve(); };
      ws.onerror = () => { clearTimeout(t); rejected = true; resolve(); };
    });
  } catch { rejected = true; }
  assert.ok(rejected, "Unauthenticated WS must be rejected");
});

await test("Infra: Both clients have active WebSocket connections", async () => {
  if (!wsAvailable) throw new Error("Skipped");
  assert.ok(clientA.ws, "Client A WS must be connected");
  assert.ok(clientB.ws, "Client B WS must be connected");
});

// === DOMAIN 6: RECONNECT ===
console.log("\n--- Domain 6: Reconnection Resilience ---\n");

await test("Reconnect: Client B reconnects and receives new events without F5", async () => {
  if (!wsAvailable) throw new Error("Skipped");
  clientB.disconnect();
  await new Promise(r => setTimeout(r, 400));
  await clientB.connect();
  await new Promise(r => setTimeout(r, 500));
  clientB.clearReceived();
  const evtP = clientB.waitForEvent(e => e.topic === "tasks" || e.topic === "chat" || e.topic === "users");
  await api("/api/tasks", { method: "POST", token: clientA.token, body: { title: "ReconnectTest-" + Date.now(), status: "todo" } });
  const evt = await evtP;
  assert.ok(evt, "Client B must receive events after reconnecting — no F5 needed");
});

// ─── TEARDOWN ─────────────────────────────────────────────────────────
clientA.disconnect();
clientB.disconnect();

// ─── REPORT ───────────────────────────────────────────────────────────
console.log("\n=== RESULTS ===");
console.log("Total: " + (passed + failed) + "  |  Pass: " + passed + "  |  Fail: " + failed);
if (failures.length > 0) {
  console.log("\nFailed tests:");
  for (const { name, reason } of failures) console.log("  - " + name + "\n    " + reason);
}
console.log(failed === 0 ? "\nALL TESTS PASSED — Real-time sync is working correctly. F5 NOT required." : "\n" + failed + " TEST(S) FAILED — Review sync pipeline.");
process.exit(failed === 0 ? 0 : 1);
