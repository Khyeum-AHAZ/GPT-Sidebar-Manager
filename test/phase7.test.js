const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const NetworkMembershipProvider = require("../src/membership/NetworkMembershipProvider.js");
const NetworkSettingsStore = require("../src/storage/NetworkSettingsStore.js");
const BulkLearner = require("../src/learning/BulkLearner.js");

const PROJECT = "g-p-aaaaaaaaaaaaaaaa";
const CHAT = "11111111-1111-1111-1111-111111111111";

function area(initial = {}) {
  let values = structuredClone(initial);
  return {
    async get(key) { return key === null ? structuredClone(values) : { [key]: values[key] }; },
    async set(update) { values = { ...values, ...structuredClone(update) }; },
    values() { return structuredClone(values); }
  };
}

test("main-world bridge observes only while enabled and emits IDs without response bodies", async () => {
  const messages = [];
  const listeners = new Map();
  const originalFetch = async () => ({ ok: true,
    headers: { get: (key) => key === "content-type" ? "application/json" : null },
    clone: () => ({ json: async () => ({ items: [{ id: CHAT, title: "private content" }] }) }) });
  class XHR {
    constructor() {
      this.status = 200;
      this.responseType = "";
      this.responseText = JSON.stringify({ items: [{ id: CHAT, title: "private xhr content" }] });
    }
    open() { return "opened"; }
    addEventListener(_type, callback) { this.onLoad = callback; }
    getResponseHeader(key) { return key === "content-type" ? "application/json" : null; }
    send() { this.onLoad?.(); return "sent"; }
  }
  const page = { fetch: originalFetch, XMLHttpRequest: XHR,
    location: { origin: "https://chatgpt.com", href: "https://chatgpt.com/" },
    addEventListener: (type, callback) => listeners.set(type, callback),
    postMessage: (data) => messages.push(data) };
  page.window = page;
  page.URL = URL;
  const source = fs.readFileSync(path.join(__dirname, "../src/adapter/NetworkBridgeMain.js"), "utf8");
  vm.runInNewContext(source, page);
  const contextWindow = vm.runInNewContext("window", page);
  assert.equal(page.fetch, originalFetch);
  const session = "1234567890abcdef1234567890abcdef";
  listeners.get("message")({ source: contextWindow, origin: page.location.origin,
    data: { type: "gsm.network.control.v1", enabled: true, session } });
  assert.notEqual(page.fetch, originalFetch, JSON.stringify(messages));
  await page.fetch(`https://chatgpt.com/backend-api/gizmos/${PROJECT}/conversations`);
  await new Promise((resolve) => setImmediate(resolve));
  const observed = messages.find((item) => item.kind === "memberships");
  assert.equal(observed.projectId, PROJECT);
  assert.deepEqual(Array.from(observed.conversationIds), [CHAT]);
  const xhr = new XHR();
  assert.equal(xhr.open("GET", `https://chatgpt.com/backend-api/gizmos/${PROJECT}/conversations`), "opened");
  assert.equal(xhr.send(), "sent");
  assert.equal(messages.filter((item) => item.kind === "memberships").length, 2);
  assert.equal(JSON.stringify(messages).includes("private content"), false);
  assert.equal(JSON.stringify(messages).includes("private xhr content"), false);
  listeners.get("message")({ source: contextWindow, origin: page.location.origin,
    data: { type: "gsm.network.control.v1", enabled: false, session } });
  assert.equal(page.fetch, originalFetch);
  assert.equal(XHR.prototype.open.name, "open");
});

test("network provider rejects malformed and unknown-project data and isolates bridge failure", () => {
  const messages = [];
  const listeners = new Map();
  const page = { location: { origin: "https://chatgpt.com" },
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: () => {}, postMessage: (data) => messages.push(data) };
  const accepted = [];
  const provider = new NetworkMembershipProvider(page,
    { getProjectRows: () => [{ projectId: PROJECT }] }, {},
    { onMemberships: (items) => accepted.push(...items) });
  provider.setEnabled(true);
  assert.equal(provider.state().kind, "waiting");
  assert.equal(messages.length, 0);
  provider.setAvailable(true);
  const receive = (data) => listeners.get("message")({ source: page, origin: page.location.origin,
    data: { type: "gsm.network.observation.v1", session: provider.session, ...data } });
  receive({ kind: "ready" });
  receive({ kind: "memberships", projectId: "g-p-bbbbbbbbbbbbbbbb",
    pathname: "/backend-api/gizmos/g-p-bbbbbbbbbbbbbbbb/conversations", conversationIds: [CHAT] });
  receive({ kind: "memberships", projectId: PROJECT,
    pathname: `/backend-api/gizmos/${PROJECT}/conversations`, conversationIds: ["bad"] });
  assert.equal(accepted.length, 0);
  receive({ kind: "memberships", projectId: PROJECT,
    pathname: `/backend-api/gizmos/${PROJECT}/conversations`, conversationIds: [CHAT] });
  assert.deepEqual(accepted, [{ conversationId: CHAT, projectId: PROJECT }]);
  receive({ kind: "error", reason: "SyntaxError" });
  assert.equal(provider.state().kind, "error");
  assert.equal(messages.at(-1).enabled, false);
  provider.setEnabled(false);
  assert.equal(provider.state().kind, "error");
  provider.setEnabled(true);
  assert.equal(provider.state().kind, "waiting");
  provider.onMemberships = () => { throw new Error("merge failure"); };
  receive({ kind: "ready" });
  receive({ kind: "memberships", projectId: PROJECT,
    pathname: `/backend-api/gizmos/${PROJECT}/conversations`, conversationIds: [CHAT] });
  assert.equal(provider.state().kind, "error");
  assert.equal(messages.at(-1).enabled, false);
});

test("current DOM membership and DOM conflicts override B observations", () => {
  const other = "22222222-2222-2222-2222-222222222222";
  const network = [
    { conversationId: CHAT, projectId: PROJECT },
    { conversationId: other, projectId: PROJECT }
  ];
  const dom = { observations: [{ conversationId: CHAT, projectId: null }],
    conflicts: new Set([other]) };
  assert.deepEqual(NetworkMembershipProvider.nonConflicting(network, dom), []);
  assert.deepEqual(NetworkMembershipProvider.nonConflicting(network, null), network);
});

test("experimental setting defaults off, mirrors to sync and survives sync failure locally", async () => {
  const local = area();
  const remote = area();
  const settings = new NetworkSettingsStore(local, remote);
  await settings.load();
  assert.equal(settings.state().enabled, false);
  await settings.setEnabled(true);
  assert.equal(local.values()["gsm.network.settings.v1"].enabled, true);
  assert.equal(remote.values()["gsm.network.settings.v1"].noticeShown, true);
  const failingRemote = { get: remote.get, async set() { throw new Error("sync unavailable"); } };
  const recovered = new NetworkSettingsStore(local, failingRemote);
  await recovered.load();
  await recovered.setEnabled(false);
  assert.equal(recovered.state().enabled, false);
  assert.equal(recovered.state().error, "sync unavailable");
  assert.equal(local.values()["gsm.network.settings.v1"].enabled, false);
});

test("bulk learning releases temporary B observation after a project failure", async () => {
  let active = false;
  const network = { beginTemporary() { active = true; return () => { active = false; }; } };
  const learner = new BulkLearner(
    { getProjectRows: () => [{ projectId: PROJECT, label: "A" }],
      getCurrentProject: () => ({ projectId: PROJECT }) },
    { writable: true, observe: async () => {} }, { mark: async () => {} },
    { scan: async () => { throw new Error("scan failure"); } }, network);
  learner.start("all");
  while (learner.status().running) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, false);
  assert.equal(learner.status().results[0].status, "failed");
});

test("a bridge startup failure does not stop DOM bulk learning", async () => {
  const learned = [];
  const learner = new BulkLearner(
    { getProjectRows: () => [{ projectId: PROJECT, label: "A" }],
      getCurrentProject: () => ({ projectId: PROJECT }) },
    { writable: true, observe: async (rows) => learned.push(...rows) },
    { mark: async () => {} },
    { scan: async () => [{ conversationId: CHAT, projectId: PROJECT }] },
    { beginTemporary() { throw new Error("bridge unavailable"); } });
  learner.start("all");
  while (learner.status().running) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(learned, [{ conversationId: CHAT, projectId: PROJECT }]);
  assert.equal(learner.status().results[0].status, "success");
});
