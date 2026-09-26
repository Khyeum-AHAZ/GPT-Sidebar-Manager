const test = require("node:test");
const assert = require("node:assert/strict");
const FullDragController = require("../src/drag/FullDragController.js");
const ChatGPTAdapter = require("../src/adapter/ChatGPTAdapter.js");
const ExperimentalSettingsStore = require("../src/storage/NetworkSettingsStore.js");

const PROJECT_A = "g-p-aaaaaaaaaaaaaaaa";
const PROJECT_B = "g-p-bbbbbbbbbbbbbbbb";
const CHAT = "11111111-1111-1111-1111-111111111111";

function fixture() {
  let actual = PROJECT_A;
  const calls = [];
  const adapter = {
    nativeMembership: () => ({ known: true, projectId: actual }),
    async moveConversationViaUI(id, from, to) {
      calls.push(["move", id, from, to]);
      actual = to;
    },
    scan() { calls.push(["scan"]); },
    setFullDragHooks(hooks) { calls.push(["hooks", Boolean(hooks)]); }
  };
  const assignmentStore = {
    writable: true,
    get: () => null,
    list: () => [],
    async clearMoved(items) { calls.push(["clear", items[0].projectId]); },
    async place() { calls.push(["place"]); }
  };
  const registry = { writable: true,
    async observe(items) { calls.push(["registry", items[0].projectId]); } };
  const controller = new FullDragController({ adapter, registry, assignmentStore,
    folderStore: { list: () => [] },
    onBegin: (id) => calls.push(["begin", id]),
    onEnd: (id) => calls.push(["end", id]) });
  return { controller, adapter, assignmentStore, registry, calls,
    actual: () => actual };
}

test("Full Drag stays off and never accepts a same-project drop", () => {
  const { controller, calls } = fixture();
  assert.equal(controller.state().enabled, false);
  assert.equal(controller.allowed({ conversationId: CHAT, projectId: PROJECT_A },
    { projectId: PROJECT_B, folderId: null }), false);
  controller.setEnabled(true);
  assert.equal(controller.allowed({ conversationId: CHAT, projectId: PROJECT_A },
    { projectId: PROJECT_A, folderId: null }), false);
  controller.setEnabled(false);
  assert.deepEqual(calls.filter((item) => item[0] === "hooks"), [["hooks", true], ["hooks", false]]);
});

test("server UI move is verified before local membership is committed", async () => {
  const { controller, calls, actual } = fixture();
  await controller.execute({ conversationId: CHAT, projectId: PROJECT_A },
    { projectId: PROJECT_B, folderId: null });
  assert.equal(actual(), PROJECT_B);
  assert.deepEqual(calls.slice(0, 4), [
    ["begin", CHAT], ["move", CHAT, PROJECT_A, PROJECT_B],
    ["clear", PROJECT_B], ["registry", PROJECT_B]
  ]);
  assert.equal(controller.state().error, null);
});

test("failed local commit attempts the inverse UI move and reports the result", async () => {
  const { controller, assignmentStore, calls, actual } = fixture();
  let writes = 0;
  assignmentStore.clearMoved = async () => {
    if (++writes === 1) throw new Error("local unavailable");
  };
  await controller.execute({ conversationId: CHAT, projectId: PROJECT_A },
    { projectId: PROJECT_B, folderId: null });
  assert.equal(actual(), PROJECT_A);
  assert.deepEqual(calls.filter((item) => item[0] === "move"), [
    ["move", CHAT, PROJECT_A, PROJECT_B], ["move", CHAT, PROJECT_B, PROJECT_A]
  ]);
  assert.match(controller.state().error, /되돌렸습니다/);
  assert.equal(controller.state().needsManualRecovery, false);
});

test("failed inverse move reports actual ChatGPT membership for manual recovery", async () => {
  const { controller, adapter, assignmentStore, actual } = fixture();
  const originalMove = adapter.moveConversationViaUI;
  adapter.moveConversationViaUI = async (id, from, to) => {
    if (from === PROJECT_B) throw new Error("reverse unavailable");
    await originalMove(id, from, to);
  };
  assignmentStore.clearMoved = async () => { throw new Error("local unavailable"); };
  await controller.execute({ conversationId: CHAT, projectId: PROJECT_A },
    { projectId: PROJECT_B, folderId: null });
  assert.equal(actual(), PROJECT_B);
  assert.match(controller.state().error, new RegExp(PROJECT_B));
  assert.equal(controller.state().needsManualRecovery, true);
});

test("duplicate target project names abort before the original menu is clicked", async () => {
  let clicked = false;
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: {}, Observer: class {}
  });
  adapter.findNativeChatLink = () => ({ closest: () => ({ querySelector: () =>
    ({ click() { clicked = true; } }) }) });
  adapter.getProjectRows = () => [
    { projectId: PROJECT_A, label: "Duplicate" },
    { projectId: PROJECT_B, label: "Duplicate" }
  ];
  await assert.rejects(adapter.moveConversationViaUI(CHAT, PROJECT_A, PROJECT_B), /안전하게 구분/);
  assert.equal(clicked, false);
});

test("duplicate source project names abort a move to Recents before clicking", async () => {
  let clicked = false;
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: {}, Observer: class {}
  });
  adapter.openNativeChatMenu = () => { clicked = true; };
  adapter.getProjectRows = () => [
    { projectId: PROJECT_A, label: "Duplicate" },
    { projectId: PROJECT_B, label: "Duplicate" }
  ];
  await assert.rejects(adapter.moveConversationViaUI(CHAT, PROJECT_A, null), /안전하게 구분/);
  assert.equal(clicked, false);
});

test("GSM chat menu opens the native pointer trigger before reporting success", async () => {
  let opened = false;
  let eventType = null;
  const action = { dispatchEvent(event) {
    eventType = event.type;
    opened = true;
  } };
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" },
      PointerEvent: class { constructor(type) { this.type = type; } } },
    pageDocument: { querySelector: () => opened ? {} : null },
    Observer: class {}
  });
  adapter.findNativeChatLink = () => ({ closest: () => ({ querySelector: () => action }) });
  await adapter.openNativeChatMenu(CHAT, PROJECT_A);
  assert.equal(eventType, "pointerdown");
});

test("unverified cross-project source leaves Safe Drag event uncancelled", () => {
  const { controller, adapter } = fixture();
  adapter.nativeMembership = () => ({ known: false, projectId: null });
  controller.setEnabled(true);
  let cancelled = false;
  controller.start({ preventDefault() { cancelled = true; } },
    { conversationId: CHAT, projectId: PROJECT_A });
  assert.equal(cancelled, false);
  assert.equal(controller.source, null);
});

test("Full Drag setting uses its own Sync key and defaults off", async () => {
  const values = {};
  const area = { async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); } };
  const settings = new ExperimentalSettingsStore(area, area,
    { key: "gsm.fullDrag.settings.v1" });
  await settings.load();
  assert.equal(settings.state().enabled, false);
  await settings.setEnabled(true);
  assert.equal(values["gsm.fullDrag.settings.v1"].enabled, true);
  assert.equal(values["gsm.network.settings.v1"], undefined);
});
