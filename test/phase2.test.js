const test = require("node:test");
const assert = require("node:assert/strict");
const ChatGPTAdapter = require("../src/adapter/ChatGPTAdapter.js");
const DomMembershipProvider = require("../src/membership/DomMembershipProvider.js");
const MembershipRegistry = require("../src/membership/MembershipRegistry.js");
const RecentFilter = require("../src/sidebar/RecentFilter.js");

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const PROJECT = "g-p-aaaaaaaaaaaaaaaa";

test("current DOM membership overrides a stale cache and conflicts fail open", () => {
  const provider = new DomMembershipProvider();
  const result = provider.read({
    recognized: true,
    projectChats: [{ conversationId: A, projectId: PROJECT }],
    recentChats: [
      { conversationId: A, projectId: null, membership: "none" },
      { conversationId: B, projectId: null, membership: "none" }
    ],
    currentConversationId: null,
    currentProjectId: null
  });
  assert.deepEqual([...result.conflicts], [A]);
  assert.deepEqual(result.observations, [{ conversationId: B, projectId: null }]);
  const calls = [];
  const filter = new RecentFilter({
    applyRecentHiddenIds: (ids) => { calls.push([...ids]); return true; },
    clearRecentFilter: () => calls.push("clear")
  }, { getProjectId: () => PROJECT });
  filter.apply(result);
  assert.deepEqual(calls, [[]]);
  filter.apply(null);
  assert.deepEqual(calls[1], "clear");
});

test("only confirmed project or previously verified unknown chats are hidden", () => {
  const calls = [];
  const filter = new RecentFilter({
    applyRecentHiddenIds: (ids) => { calls.push([...ids]); return true; },
    clearRecentFilter() {}
  }, { writable: true, getProjectId: (id) => id === B ? PROJECT : null });
  filter.apply({
    recentChats: [
      { conversationId: A, projectId: PROJECT, membership: "project" },
      { conversationId: B, projectId: null, membership: "unknown" },
      { conversationId: "33333333-3333-3333-3333-333333333333", projectId: null, membership: "none" }
    ],
    conflicts: new Set(),
    observations: []
  });
  assert.deepEqual(calls, [[A, B]]);
});

test("unavailable membership cache does not hide uncertain Recents", () => {
  let hidden;
  new RecentFilter({ applyRecentHiddenIds: (ids) => { hidden = ids; } },
    { writable: false, getProjectId: () => PROJECT }).apply({
    recentChats: [{ conversationId: B, projectId: null, membership: "unknown" }],
    conflicts: new Set()
  });
  assert.equal(hidden.size, 0);
});

test("conflicting project observations stay visible and do not rewrite membership", () => {
  const result = new DomMembershipProvider().read({
    recognized: true,
    projectChats: [
      { conversationId: A, projectId: PROJECT },
      { conversationId: A, projectId: "g-p-bbbbbbbbbbbbbbbb" }
    ],
    recentChats: [{ conversationId: A, projectId: PROJECT, membership: "project" }],
    currentConversationId: null,
    currentProjectId: null
  });
  assert.equal(result.conflicts.has(A), true);
  assert.deepEqual(result.observations, []);
  let hidden;
  new RecentFilter({ applyRecentHiddenIds: (ids) => { hidden = ids; } },
    { getProjectId: () => PROJECT }).apply(result);
  assert.equal(hidden.size, 0);
});

test("membership cache commits only after storage succeeds", async () => {
  let persisted = {};
  const storage = {
    async get() { return structuredClone(persisted); },
    async set(value) { persisted = { ...persisted, ...structuredClone(value) }; }
  };
  const registry = new MembershipRegistry(storage);
  await registry.load();
  await registry.observe([{ conversationId: A, projectId: PROJECT }]);
  assert.equal(registry.getProjectId(A), PROJECT);
  assert.equal(persisted[`gsm.membership.v1.${A}`].projectId, PROJECT);
  await registry.observe([{ conversationId: A, projectId: null }]);
  assert.equal(registry.getProjectId(A), null);
  assert.equal(persisted[`gsm.membership.v1.${A}`].projectId, null);
  const reloaded = new MembershipRegistry(storage);
  await reloaded.load();
  assert.equal(reloaded.getProjectId(A), null);
  storage.set = async () => { throw new Error("storage unavailable"); };
  await assert.rejects(registry.observe([{ conversationId: B, projectId: PROJECT }]));
  assert.equal(registry.getProjectId(B), null);
  assert.equal(registry.writable, false);
});

test("adapter hides only Recents rows and restores their original DOM", () => {
  const makeLink = (href) => ({
    getAttribute: (name) => name === "href" ? href : null,
    closest: () => null
  });
  const makeRow = (href) => {
    const attributes = new Map();
    return {
      attributes,
      querySelectorAll: () => [makeLink(href)],
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name)
    };
  };
  const projectRow = makeRow(`/g/${PROJECT}/c/${A}`);
  const normalRow = makeRow(`/c/${B}`);
  const list = { querySelectorAll: () => [projectRow, normalRow] };
  const section = {
    getAttribute: () => "Recents",
    querySelectorAll: () => [list]
  };
  const sidebar = { querySelectorAll: () => [section] };
  let styleRemoved = false;
  const pageDocument = {
    head: { append() {} },
    createElement: () => ({ setAttribute() {}, remove() { styleRemoved = true; } })
  };
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument,
    Observer: class {}
  });
  adapter.sidebar = sidebar;
  assert.deepEqual(adapter.getRecentChats().map((chat) => chat.membership), ["project", "none"]);
  assert.equal(adapter.applyRecentHiddenIds(new Set([A])), true);
  assert.equal(projectRow.attributes.get("data-gsm-recent-hidden"), "true");
  assert.equal(normalRow.attributes.has("data-gsm-recent-hidden"), false);
  adapter.sidebar = { querySelectorAll: () => [] };
  assert.equal(adapter.applyRecentHiddenIds(new Set([A])), false);
  assert.equal(projectRow.attributes.has("data-gsm-recent-hidden"), false);
  assert.equal(styleRemoved, true);
});
