const test = require("node:test");
const assert = require("node:assert/strict");
const ChatGPTAdapter = require("../src/adapter/ChatGPTAdapter.js");
const FolderStore = require("../src/storage/FolderStore.js");

const PROJECT_A = "g-p-aaaaaaaaaaaaaaaa";
const PROJECT_B = "g-p-bbbbbbbbbbbbbbbb";

function storage() {
  let data = {};
  return {
    async get() { return structuredClone(data); },
    async set(update) { data = { ...data, ...structuredClone(update) }; },
    entries() { return data; }
  };
}

test("folders remain project-scoped and deletion leaves a tombstone", async () => {
  const area = storage();
  let id = 0;
  let time = 100;
  const store = new FolderStore(area, {
    newId: () => `folder-${++id}-abc`,
    now: () => ++time
  });
  await store.load();
  const first = await store.create(PROJECT_A, " 세계관 ");
  const second = await store.create(PROJECT_B, "자료");
  assert.equal(first.name, "세계관");
  assert.deepEqual(store.list(PROJECT_A).map((folder) => folder.name), ["세계관"]);
  assert.deepEqual(store.list(PROJECT_B).map((folder) => folder.name), ["자료"]);
  await store.rename(PROJECT_A, first.folderId, "설정");
  await store.setCollapsed(PROJECT_A, first.folderId, true);
  const legacyKey = FolderStore.key(PROJECT_A, "unclassified");
  await area.set({ [legacyKey]: {
    schemaVersion: 2, projectId: PROJECT_A, folderId: "unclassified",
    name: "미분류", order: Number.MAX_SAFE_INTEGER, collapsed: true,
    revision: 1, updatedAt: ++time, deletedAt: null
  } });
  const reloaded = new FolderStore(area);
  await reloaded.load();
  assert.equal(reloaded.list(PROJECT_A)[0].name, "설정");
  assert.equal(reloaded.list(PROJECT_A)[0].collapsed, true);
  assert.equal(reloaded.list(PROJECT_A).length, 1);
  assert.ok(area.entries()[legacyKey]);
  await store.remove(PROJECT_A, first.folderId);
  assert.deepEqual(store.list(PROJECT_A), []);
  assert.equal(store.list(PROJECT_B)[0].folderId, second.folderId);
  assert.ok(area.entries()[FolderStore.key(PROJECT_A, first.folderId)].deletedAt);
});

test("failed folder writes keep the previous state", async () => {
  const area = storage();
  const store = new FolderStore(area, { newId: () => "folder-12345678" });
  await store.load();
  const folder = await store.create(PROJECT_A, "Original");
  area.set = async () => { throw new Error("quota exceeded"); };
  await assert.rejects(store.rename(PROJECT_A, folder.folderId, "Changed"), /quota exceeded/);
  assert.equal(store.list(PROJECT_A)[0].name, "Original");
  assert.equal(store.writable, false);
});

test("20 optional vivid colors preserve old folders, survive reload, and reject invalid writes", async () => {
  const area = storage();
  const store = new FolderStore(area, { newId: () => "folder-color-123", now: () => 100 });
  await store.load();
  const folder = await store.create(PROJECT_A, "색상");
  assert.equal(folder.color, undefined);
  assert.equal(FolderStore.valid(folder), true);
  await store.setColor(PROJECT_A, folder.folderId, "sky");
  await store.rename(PROJECT_A, folder.folderId, "유지");
  const reloaded = new FolderStore(area);
  await reloaded.load();
  assert.equal(reloaded.list(PROJECT_A)[0].color, "sky");
  assert.equal(FolderStore.valid({ ...folder, color: "url(invalid)" }), false);
  assert.equal(FolderStore.colors.length, 21); // 20 colors plus inherited default.
  assert.throws(() => store.setColor(PROJECT_A, folder.folderId, "invalid-color"), /색상/);
  assert.equal(store.list(PROJECT_A)[0].color, "sky");
  await store.setColor(PROJECT_A, folder.folderId, "default");
  area.set = async () => { throw new Error("write failed"); };
  await assert.rejects(store.setColor(PROJECT_A, folder.folderId, "rose"), /write failed/);
  assert.equal(store.list(PROJECT_A)[0].color, "default");
});

test("project action owns its DOM, blocks drops, survives rerender and cleans up", () => {
  const doc = { getElementById: () => label,
    createElement: () => ({
      attrs: {}, listeners: {}, isConnected: false,
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      remove() { this.isConnected = false; }
    }) };
  const label = { append(node) { node.isConnected = true; node.parentElement = this; } };
  const row = { getAttribute: () => "project-label", contains: (node) => node === label };
  const adapter = new ChatGPTAdapter({ pageWindow: {}, pageDocument: doc, Observer: class {} });
  adapter.getProjectRows = () => [{ projectId: PROJECT_A, label: "Project" }];
  adapter.findProjectRow = () => row;
  adapter.getProjectIcon = () => null;
  adapter.mountProjectActions(() => {});
  const action = adapter.projectActions.get(PROJECT_A);
  assert.equal(action.attrs['data-gsm-owned'], 'true');
  const event = { stopped: false, prevented: false, dataTransfer: {},
    stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  action.listeners.drop(event);
  assert.equal(event.stopped, true);
  assert.equal(event.prevented, true);
  assert.equal(event.dataTransfer.dropEffect, 'none');
  adapter.mountProjectActions(() => {});
  assert.equal(adapter.projectActions.get(PROJECT_A), action);
  action.remove();
  assert.equal(adapter.isOwnedMutation({ type: 'childList', target: {},
    addedNodes: [], removedNodes: [action] }), false);
  adapter.mountProjectActions(() => {});
  const replacement = adapter.projectActions.get(PROJECT_A);
  assert.notEqual(replacement, action);
  adapter.clearFolderViews();
  assert.equal(replacement.isConnected, false);
  assert.equal(adapter.projectActions.size, 0);
});

test("an empty native project list still has an ID-based folder insertion point", () => {
  const row = { closest: () => null,
    getAttribute: (key) => key === 'data-app-action-sidebar-project-id' ? PROJECT_A : null };
  const list = { querySelectorAll: () => [], closest: () => ({ querySelectorAll: () => [row] }) };
  const adapter = new ChatGPTAdapter({ pageWindow: {}, pageDocument: {}, Observer: class {} });
  adapter.findSection = () => ({ querySelectorAll: () => [list] });
  assert.equal(adapter.getProjectLists()[0].projectId, PROJECT_A);
  assert.equal(adapter.getProjectLists()[0].chatCount, 0);
});

test("folder roots are owned and clearing them preserves original project chats", () => {
  const chatLink = {
    getAttribute: (name) => name === "href" ?
      `/g/${PROJECT_A}/c/11111111-1111-1111-1111-111111111111` : null,
    closest: () => null
  };
  const list = {
    querySelectorAll: () => [chatLink],
    prepend(root) { root.isConnected = true; },
  };
  const section = {
    getAttribute: () => "Projects",
    querySelectorAll: () => [list]
  };
  const sidebar = { querySelectorAll: () => [section] };
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: {
      createElement: () => ({
        setAttribute() {},
        remove() { this.isConnected = false; }
      })
    },
    Observer: class {}
  });
  adapter.sidebar = sidebar;
  const rendered = [];
  adapter.mountFolderViews((root, project) => rendered.push(project));
  assert.deepEqual(rendered.map(({ projectId, chatCount, chats }) =>
    ({ projectId, chatCount, conversationIds: chats.map((chat) => chat.conversationId) })),
  [{ projectId: PROJECT_A, chatCount: 1, conversationIds: ["11111111-1111-1111-1111-111111111111"] }]);
  assert.equal(adapter.folderRoots.size, 1);
  adapter.clearFolderViews();
  assert.equal(adapter.folderRoots.size, 0);
  assert.equal(list.querySelectorAll()[0], chatLink);
});

test("rendered GSM tree reversibly hides only verified native project rows", () => {
  const attributes = new Map([["role", "listitem"]]);
  const href = `/g/${PROJECT_A}/c/11111111-1111-1111-1111-111111111111`;
  const chatLink = {
    getAttribute: (name) => name === "href" ? href : null,
    closest: () => null,
    textContent: "Original"
  };
  const nativeRow = {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    querySelectorAll: () => [chatLink]
  };
  const list = {
    children: [nativeRow],
    querySelectorAll: () => [chatLink],
    prepend(root) { root.isConnected = true; this.children.unshift(root); }
  };
  const section = { getAttribute: () => "Projects", querySelectorAll: () => [list] };
  const styles = [];
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: {
      head: { append(style) { styles.push(style); } },
      createElement: () => ({ setAttribute() {}, remove() { this.isConnected = false; } })
    }, Observer: class {}
  });
  adapter.sidebar = { querySelectorAll: () => [section] };
  adapter.mountFolderViews(() => {});
  assert.equal(nativeRow.getAttribute("data-gsm-native-project-hidden"), "true");
  assert.equal(styles.length, 1);
  assert.equal(list.children[0].isConnected, true);
  adapter.clearFolderViews();
  assert.equal(nativeRow.getAttribute("data-gsm-native-project-hidden"), null);
  assert.equal(list.querySelectorAll()[0], chatLink);
});
