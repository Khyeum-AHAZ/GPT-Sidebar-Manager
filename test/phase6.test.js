const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ChatGPTAdapter = require("../src/adapter/ChatGPTAdapter.js");
const MembershipRegistry = require("../src/membership/MembershipRegistry.js");
const LearningStore = require("../src/learning/LearningStore.js");
const ProjectScanner = require("../src/learning/ProjectScanner.js");
const BulkLearner = require("../src/learning/BulkLearner.js");

const PROJECT_A = "g-p-aaaaaaaaaaaaaaaa";
const PROJECT_B = "g-p-bbbbbbbbbbbbbbbb";
const CHAT_A = "11111111-1111-1111-1111-111111111111";
const CHAT_B = "22222222-2222-2222-2222-222222222222";

function area(initial = {}) {
  let values = structuredClone(initial);
  return {
    async get() { return structuredClone(values); },
    async set(update) { values = { ...values, ...structuredClone(update) }; },
    async remove(keys) { for (const key of keys) delete values[key]; },
    values() { return structuredClone(values); }
  };
}

test("adapter accepts verified project-row IDs without guessing from titles", () => {
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: {}, Observer: class {}
  });
  const row = {
    getAttribute(name) {
      return ({
        "data-app-action-sidebar-project-id": PROJECT_A,
        "data-app-action-sidebar-project-label": "Example",
        "data-app-action-sidebar-project-collapsed": "true"
      })[name] ?? null;
    },
    closest(selector) { return selector === '[role="listitem"]' ? {} : null; }
  };
  const section = {
    getAttribute: (name) => name === "data-app-action-sidebar-section-heading" ? "Projects" : null,
    querySelectorAll: () => [row]
  };
  adapter.sidebar = { querySelectorAll: () => [section] };
  assert.equal(adapter.getProjectId(row), PROJECT_A);
  assert.deepEqual(adapter.getProjectRows(),
    [{ projectId: PROJECT_A, label: "Example", collapsed: true }]);
});

test("scanner records only stable verified IDs and restores a collapsed row", async () => {
  let opened = false;
  let restored = false;
  let calls = 0;
  const adapter = {
    getProjectRows: () => [{ projectId: PROJECT_A, collapsed: true }],
    expandProject: () => { opened = true; return true; },
    getProjectScan: () => {
      calls++;
      return calls === 1 ? { state: "loading", chats: [] } :
        { state: "ready", chats: [{ conversationId: CHAT_A, projectId: PROJECT_A }] };
    },
    collapseProject: () => { restored = true; }
  };
  const scanner = new ProjectScanner(adapter, { delay: async () => {}, pollMs: 250, timeoutMs: 2000 });
  const chats = await scanner.scan(PROJECT_A);
  assert.equal(opened, true);
  assert.equal(restored, true);
  assert.deepEqual(chats, [{ conversationId: CHAT_A, projectId: PROJECT_A }]);
});

test("scanner fails open on uncertain project list and restores UI", async () => {
  let restored = false;
  const scanner = new ProjectScanner({
    getProjectRows: () => [{ projectId: PROJECT_A }],
    expandProject: () => true,
    getProjectScan: () => ({ state: "invalid", chats: [] }),
    collapseProject: () => { restored = true; }
  }, { delay: async () => {} });
  await assert.rejects(scanner.scan(PROJECT_A), /안전하게 확인하지/);
  assert.equal(restored, true);
});

test("unlearned bulk scan skips learned projects and cache reset preserves folders and assignments", async () => {
  const storage = area({
    "gsm.folder.v2.keep": { name: "preserve" },
    "gsm.assignment.v1.keep": { folderId: "preserve" }
  });
  const registry = new MembershipRegistry(storage);
  const learning = new LearningStore(storage, { now: () => 100 });
  await registry.load();
  await learning.load();
  await learning.mark(PROJECT_A, 1);
  const scanned = [];
  const adapter = {
    getProjectRows: () => [
      { projectId: PROJECT_A, label: "A" },
      { projectId: PROJECT_B, label: "B" }
    ],
    getCurrentProject: () => ({ projectId: PROJECT_A })
  };
  const scanner = { async scan(projectId) {
    scanned.push(projectId);
    return [{ conversationId: CHAT_B, projectId }];
  } };
  const learner = new BulkLearner(adapter, registry, learning, scanner);
  learner.start("unlearned");
  while (learner.status().running) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scanned, [PROJECT_B]);
  assert.equal(registry.getProjectId(CHAT_B), PROJECT_B);
  assert.equal(learning.has(PROJECT_B), true);
  await learner.clearCache();
  assert.equal(registry.getProjectId(CHAT_B), null);
  assert.equal(learning.has(PROJECT_A), false);
  assert.equal(storage.values()["gsm.folder.v2.keep"].name, "preserve");
  assert.equal(storage.values()["gsm.assignment.v1.keep"].folderId, "preserve");
  assert.equal(storage.values()[`gsm.membership.v1.${CHAT_B}`], undefined);
});

test("current project scan requires a project page", () => {
  const learner = new BulkLearner({
    getProjectRows: () => [{ projectId: PROJECT_A, label: "A" }],
    getCurrentProject: () => null
  }, { writable: true }, { has: () => false }, {});
  assert.throws(() => learner.start("current"), /현재 프로젝트 채팅/);
});

test("cache reset propagates to another open tab's learning and membership state", async () => {
  const storage = area();
  const registry = new MembershipRegistry(storage);
  const learning = new LearningStore(storage, { now: () => 100 });
  await registry.load();
  await learning.load();
  await registry.observe([{ conversationId: CHAT_A, projectId: PROJECT_A }]);
  await learning.mark(PROJECT_A, 1);
  const otherRegistry = new MembershipRegistry(storage);
  const otherLearning = new LearningStore(storage);
  await otherRegistry.load();
  await otherLearning.load();
  await registry.clear();
  await learning.clear();
  assert.equal(otherRegistry.applyChanges({
    [`gsm.membership.v1.${CHAT_A}`]: { oldValue: { projectId: PROJECT_A }, newValue: undefined }
  }), true);
  otherLearning.applyChanges({
    [`gsm.learning.v1.${PROJECT_A}`]: { oldValue: { projectId: PROJECT_A }, newValue: undefined }
  });
  assert.equal(otherRegistry.getProjectId(CHAT_A), null);
  assert.equal(otherLearning.has(PROJECT_A), false);
});

test("popup receives a startup error when the content script fails to initialize", async () => {
  let listener;
  let response;
  const context = {
    chrome: { runtime: { id: "test-extension", onMessage: {
      addListener(callback) { listener = callback; }
    } } },
    GSMChatGPTAdapter: class { constructor() { throw new Error("startup probe"); } },
    console: { error() {} }
  };
  const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(listener({ type: "gsm.learning.status" }, { id: "test-extension" },
    (result) => { response = result; }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(response.ok, false);
  assert.equal(response.error, "startup probe");
});
