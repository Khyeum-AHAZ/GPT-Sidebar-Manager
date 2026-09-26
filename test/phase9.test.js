const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ChatGPTAdapter = require("../src/adapter/ChatGPTAdapter.js");
const DomMembershipProvider = require("../src/membership/DomMembershipProvider.js");
const RecentFilter = require("../src/sidebar/RecentFilter.js");
const FolderStore = require("../src/storage/FolderStore.js");
const AssignmentStore = require("../src/storage/AssignmentStore.js");
require("../src/storage/Migration.js");
const SyncStore = require("../src/storage/SyncStore.js");
const UiSettingsStore = require("../src/storage/UiSettingsStore.js");
const BulkLearner = require("../src/learning/BulkLearner.js");

const PROJECT_A = "g-p-aaaaaaaaaaaaaaaa";
const PROJECT_B = "g-p-bbbbbbbbbbbbbbbb";
const CHAT = "11111111-1111-1111-1111-111111111111";

function projectChatLink(projectId, conversationId) {
  const href = `/g/${projectId}/c/${conversationId}`;
  return {
    textContent: "Same chat",
    getAttribute(name) {
      if (name === "href") return href;
      return null;
    },
    closest() { return null; }
  };
}

function area() {
  let values = {};
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(values);
      if (typeof keys === "string") keys = [keys];
      return Object.fromEntries(keys.filter((key) => Object.hasOwn(values, key))
        .map((key) => [key, structuredClone(values[key])]));
    },
    async set(updates) { values = { ...values, ...structuredClone(updates) }; },
    async remove(keys) { for (const key of keys) delete values[key]; },
    values() { return structuredClone(values); }
  };
}

test("a transient chat in two project lists remains ambiguous and visible", () => {
  const lists = [PROJECT_A, PROJECT_B].map((projectId) => {
    const link = projectChatLink(projectId, CHAT);
    return { querySelectorAll: () => [link] };
  });
  const section = {
    getAttribute: () => "Projects",
    querySelectorAll: () => lists
  };
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: {}, Observer: class {}
  });
  adapter.sidebar = { querySelectorAll: () => [section] };
  const projectChats = adapter.getProjectChats();
  assert.equal(projectChats.length, 2);
  assert.equal(adapter.nativeMembership(CHAT).known, false);
  const result = new DomMembershipProvider().read({
    recognized: true, projectChats, recentChats: [],
    currentConversationId: null, currentProjectId: null
  });
  assert.equal(result.conflicts.has(CHAT), true);
  assert.deepEqual(result.observations, []);
});

test("ambiguous project rows stay native and visible until membership settles", () => {
  const rows = [];
  const lists = [PROJECT_A, PROJECT_B].map((projectId) => {
    const link = projectChatLink(projectId, CHAT);
    const attributes = new Map([["role", "listitem"]]);
    const row = {
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      querySelectorAll: () => [link]
    };
    rows.push(row);
    return {
      children: [row],
      querySelectorAll: () => [link],
      prepend(root) { root.isConnected = true; this.children.unshift(root); }
    };
  });
  const section = { getAttribute: () => "Projects", querySelectorAll: () => lists };
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: { head: { append() {} }, createElement: () => ({
      setAttribute() {}, remove() { this.isConnected = false; }
    }) }, Observer: class {}
  });
  adapter.sidebar = { querySelectorAll: () => [section] };
  const rendered = [];
  adapter.mountFolderViews((root, project) => rendered.push(project.chats));
  assert.deepEqual(rendered.map((chats) => chats.length), [0, 0]);
  assert.deepEqual(rows.map((row) => row.getAttribute("data-gsm-native-project-hidden")),
    [null, null]);
  adapter.clearFolderViews();
});

test("long Recents hides only verified project chats and restores every original row", () => {
  const rows = Array.from({ length: 900 }, (_, index) => {
    const id = `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
    const href = index % 3 === 0 ? `/g/${PROJECT_A}/c/${id}` :
      index % 3 === 1 ? `/c/${id}` : `/archive/c/${id}`;
    const attributes = new Map();
    return {
      id, index, attributes,
      querySelectorAll: () => [{
        getAttribute: (name) => name === "href" ? href : null,
        closest: () => null
      }],
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name)
    };
  });
  const list = { querySelectorAll: () => rows };
  const section = { getAttribute: () => "Recents", querySelectorAll: () => [list] };
  const adapter = new ChatGPTAdapter({
    pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: {
      head: { append() {} },
      createElement: () => ({ setAttribute() {}, remove() {} })
    }, Observer: class {}
  });
  adapter.sidebar = { querySelectorAll: () => [section] };
  const recentChats = adapter.getRecentChats();
  assert.equal(recentChats.length, rows.length);
  const result = new DomMembershipProvider().read({
    recognized: true, projectChats: [], recentChats,
    currentConversationId: null, currentProjectId: null
  });
  const registry = {
    writable: true,
    getProjectId(id) {
      const index = rows.find((row) => row.id === id)?.index;
      return index % 6 === 2 ? PROJECT_A : null;
    }
  };
  new RecentFilter(adapter, registry).apply(result);
  const hidden = rows.filter((row) => row.attributes.get("data-gsm-recent-hidden") === "true");
  assert.equal(hidden.length, 450);
  assert.equal(rows.filter((row) => row.index % 3 === 1 && row.attributes.size).length, 0);
  adapter.clearRecentFilter();
  assert.equal(rows.filter((row) => row.attributes.size).length, 0);
});

test("many folders remain isolated across projects after reorder and deletion", async () => {
  const storage = area();
  let nextId = 0;
  let time = 100;
  const folders = new FolderStore(storage, {
    newId: () => `folder-${String(++nextId).padStart(8, "0")}`,
    now: () => ++time
  });
  await folders.load();
  const projectIds = Array.from({ length: 10 }, (_, index) =>
    `g-p-${index.toString(16).padStart(16, "0")}`);
  for (const projectId of projectIds) {
    for (let index = 0; index < 15; index++) await folders.create(projectId, `Folder ${index}`);
  }
  const moved = folders.list(projectIds[0]).at(-1);
  await folders.reorder(projectIds[0], moved.folderId, folders.list(projectIds[0])[0].folderId);
  await folders.rename(projectIds[1], folders.list(projectIds[1])[0].folderId, "Renamed");
  await folders.remove(projectIds[2], folders.list(projectIds[2])[0].folderId);
  assert.equal(folders.list(projectIds[0])[0].folderId, moved.folderId);
  assert.equal(folders.list(projectIds[1])[0].name, "Renamed");
  assert.equal(folders.list(projectIds[2]).length, 14);
  for (const projectId of projectIds.slice(3)) {
    assert.equal(folders.list(projectId).length, 15);
    assert.equal(folders.list(projectId)[0].name, "Folder 0");
  }
});

test("two Chrome Sync clients exchange folder and assignment edits in both directions", async () => {
  const sync = area();
  const first = new SyncStore(area(), sync);
  const second = new SyncStore(area(), sync);
  await first.load();
  await second.load();
  const folderA = new FolderStore(first, { newId: () => "folder-12345678", now: () => 100 });
  const folderB = new FolderStore(second, { now: () => 200 });
  const assignmentA = new AssignmentStore(first, { now: () => 300 });
  const assignmentB = new AssignmentStore(second, { now: () => 400 });
  await Promise.all([folderA.load(), folderB.load(), assignmentA.load(), assignmentB.load()]);
  const folder = await folderA.create(PROJECT_A, "From A");
  const folderKey = FolderStore.key(PROJECT_A, folder.folderId);
  const syncFolder = async (bridge, store) => {
    const changes = { [folderKey]: { newValue: sync.values()[folderKey] } };
    await bridge.applyChanges(changes, "sync");
    store.applyChanges(changes);
  };
  await syncFolder(second, folderB);
  assert.equal(folderB.list(PROJECT_A)[0].name, "From A");
  await folderB.rename(PROJECT_A, folder.folderId, "From B");
  await syncFolder(first, folderA);
  assert.equal(folderA.list(PROJECT_A)[0].name, "From B");
  await folderA.setColor(PROJECT_A, folder.folderId, "mint");
  await syncFolder(second, folderB);
  assert.equal(folderB.list(PROJECT_A)[0].color, "mint");
  await folderB.setColor(PROJECT_A, folder.folderId, "lavender");
  await folderB.rename(PROJECT_A, folder.folderId, "Color preserved");
  await syncFolder(first, folderA);
  assert.equal(folderA.list(PROJECT_A)[0].color, "lavender");

  await assignmentA.place(CHAT, PROJECT_A, folder.folderId, [CHAT]);
  const assignmentKey = AssignmentStore.key(CHAT);
  const syncAssignment = async (bridge, store) => {
    const changes = { [assignmentKey]: { newValue: sync.values()[assignmentKey] } };
    await bridge.applyChanges(changes, "sync");
    store.applyChanges(changes);
  };
  await syncAssignment(second, assignmentB);
  assert.equal(assignmentB.get(CHAT, PROJECT_A).folderId, folder.folderId);
  await assignmentB.clearFolder(PROJECT_A, folder.folderId);
  await syncAssignment(first, assignmentA);
  assert.equal(assignmentA.get(CHAT, PROJECT_A).folderId, null);
  assert.equal(first.status().kind, "synced");
  assert.equal(second.status().kind, "synced");
});

test("SPA navigation, sidebar replacement, and repeated start-stop keep fresh snapshots", () => {
  const listeners = new Map();
  const add = (name, callback) => listeners.set(name, callback);
  const remove = (name, callback) => {
    if (listeners.get(name) === callback) listeners.delete(name);
  };
  const pageWindow = {
    location: { href: "https://chatgpt.com/" },
    addEventListener: add, removeEventListener: remove,
    setInterval: () => 1, clearInterval() {},
    setTimeout: () => 2, clearTimeout() {}
  };
  const link = projectChatLink(PROJECT_A, CHAT);
  const section = { getAttribute: () => "Projects", querySelectorAll: () => [] };
  const sidebar = {
    parentElement: null,
    closest: () => null,
    contains: () => false,
    querySelectorAll(selector) {
      return selector === 'section[data-app-action-sidebar-section-heading]' ?
        [section] : [link];
    }
  };
  let navigations = [sidebar];
  const pageDocument = {
    visibilityState: "visible",
    querySelectorAll: () => navigations,
    addEventListener: add, removeEventListener: remove
  };
  class Observer { observe() {} disconnect() {} }
  const adapter = new ChatGPTAdapter({ pageWindow, pageDocument, Observer });
  const snapshots = [];
  adapter.start((snapshot) => snapshots.push(snapshot));
  assert.equal(snapshots.at(-1).recognized, true);
  assert.equal(snapshots.at(-1).currentProjectId, null);
  pageWindow.location.href = `https://chatgpt.com/g/${PROJECT_A}/c/${CHAT}`;
  listeners.get("popstate")();
  assert.equal(snapshots.at(-1).currentProjectId, PROJECT_A);
  assert.equal(snapshots.at(-1).currentConversationId, CHAT);
  navigations = [];
  listeners.get("pageshow")();
  assert.equal(snapshots.at(-1).recognized, false);
  navigations = [sidebar];
  listeners.get("focus")();
  assert.equal(snapshots.at(-1).recognized, true);
  adapter.stop();
  assert.equal(listeners.size, 0);
  for (let index = 0; index < 2; index++) {
    const cycle = [];
    adapter.start((snapshot) => cycle.push(snapshot));
    assert.equal(cycle[0].recognized, true);
    assert.equal(cycle[0].currentProjectId, PROJECT_A);
    adapter.stop();
    assert.equal(listeners.size, 0);
  }
});

test("stopping the adapter restores native rows and removes drag bindings", () => {
  const adapter = new ChatGPTAdapter({
    pageWindow: {
      location: { href: "https://chatgpt.com/" },
      addEventListener() {}, removeEventListener() {},
      setInterval: () => 1, clearInterval() {},
      clearTimeout() {}
    },
    pageDocument: { addEventListener() {}, removeEventListener() {} },
    Observer: class { observe() {} disconnect() {} }
  });
  const makeRow = (name) => {
    const attributes = new Map([[name, "true"]]);
    return {
      attributes,
      getAttribute: (key) => attributes.get(key) ?? null,
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: (key) => attributes.delete(key)
    };
  };
  const recent = makeRow("data-gsm-recent-hidden");
  const project = makeRow("data-gsm-native-project-hidden");
  const source = makeRow("draggable");
  let removed = 0;
  let aborted = 0;
  adapter.started = true;
  adapter.hiddenRows.add(recent);
  adapter.projectHiddenRows.add(project);
  adapter.filterStyle = { remove() { removed++; } };
  adapter.projectFilterStyle = { remove() { removed++; } };
  adapter.folderRoots.set({}, { remove() { removed++; } });
  adapter.fullDragBindings.set(source, {
    source: true, originalDraggable: null, controller: { abort() { aborted++; } }
  });
  adapter.stop();
  assert.equal(recent.attributes.size, 0);
  assert.equal(project.attributes.size, 0);
  assert.equal(source.attributes.size, 0);
  assert.equal(removed, 3);
  assert.equal(aborted, 1);
  assert.equal(adapter.folderRoots.size, 0);
  assert.equal(adapter.fullDragBindings.size, 0);
});

test("GSM display switch is local, defaults on, and persists off across reload", async () => {
  const local = area();
  const settings = new UiSettingsStore(local);
  await settings.load();
  assert.equal(settings.state().enabled, true);
  await settings.setEnabled(false);
  assert.deepEqual(local.values()["gsm.ui.settings.v1"],
    { schemaVersion: 1, enabled: false });
  const reloaded = new UiSettingsStore(local);
  await reloaded.load();
  assert.equal(reloaded.state().enabled, false);
  const changed = reloaded.applyChanges({
    "gsm.ui.settings.v1": { newValue: { schemaVersion: 1, enabled: true } }
  }, "local");
  assert.equal(changed, true);
  assert.equal(reloaded.state().enabled, true);
  assert.equal(reloaded.applyChanges({
    "gsm.ui.settings.v1": { newValue: { schemaVersion: 1, enabled: false } }
  }, "sync"), false);
  await reloaded.setEnabled(false);
  assert.equal(reloaded.applyChanges({
    "gsm.ui.settings.v1": { newValue: undefined }
  }, "local"), true);
  assert.equal(reloaded.state().enabled, true);
  const failing = new UiSettingsStore({
    get: local.get,
    async set() { throw new Error("local unavailable"); }
  });
  await failing.load();
  await assert.rejects(failing.setEnabled(true), /local unavailable/);
  assert.equal(failing.state().enabled, false);
});

async function contentHarness(local) {
  const trace = [];
  const errors = [];
  let onMessage;
  class Adapter {
    start(callback) {
      trace.push("adapter.start");
      callback({ recognized: true, projectIds: [], conversationIds: [],
        currentProjectId: null, projectChats: [], recentChats: [] });
    }
    stop() { trace.push("adapter.stop"); }
    getProjectRows() { return []; }
    getCurrentProject() { return null; }
    clearRecentFilter() { trace.push("recent.clear"); }
  }
  class Store {
    async load() {}
    applyChanges() { return false; }
    status() { return { kind: "synced" }; }
    async flush() {}
  }
  class Settings {
    constructor() { this.onChange = () => {}; this.value = { enabled: false }; }
    async load() { this.onChange(this.value); }
    state() { return this.value; }
    applyChanges() { return false; }
  }
  class FullDrag {
    constructor() { this.onStatus = () => {}; this.enabled = false; }
    setEnabled(enabled) {
      this.enabled = enabled;
      trace.push(`drag.${enabled}`);
      this.onStatus();
    }
    state() { return { enabled: this.enabled, busy: false }; }
  }
  class Network {
    static nonConflicting(items) { return items; }
    setEnabled(enabled) { trace.push(`network.${enabled}`); }
    setAvailable() {}
    state() { return { kind: "off" }; }
  }
  class SidebarRoot {
    render() { trace.push("sidebar.render"); }
    clear() { trace.push("sidebar.clear"); }
  }
  class Learner {
    constructor() { this.onFinished = () => {}; }
    status() { return { running: false, results: [] }; }
    cancel() { trace.push("learner.cancel"); }
  }
  const sandbox = {
    chrome: {
      runtime: { id: "gsm-test", onMessage: { addListener(callback) { onMessage = callback; } } },
      storage: { local, sync: area(), onChanged: { addListener() {} } }
    },
    window: { setInterval() {} },
    console: { warn() {}, error(...args) { errors.push(args); } },
    GSMChatGPTAdapter: Adapter,
    GSMDomMembershipProvider: class { read() { return { observations: [], recentChats: [] }; } },
    GSMMembershipRegistry: Store,
    GSMLearningStore: Store,
    GSMRecentFilter: class { apply() {} },
    GSMProjectScanner: class {},
    GSMSyncStore: Store,
    GSMNetworkSettingsStore: Settings,
    GSMExperimentalSettingsStore: Settings,
    GSMUiSettingsStore: UiSettingsStore,
    GSMFolderStore: Store,
    GSMAssignmentStore: Store,
    GSMFullDragController: FullDrag,
    GSMSidebarRoot: SidebarRoot,
    GSMNetworkMembershipProvider: Network,
    GSMBulkLearner: Learner
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8"), sandbox);
  await new Promise((resolve) => setImmediate(resolve));
  async function send(type, extra = {}) {
    return new Promise((resolve) => {
      assert.equal(onMessage({ type, ...extra }, { id: "gsm-test" }, resolve), true);
    });
  }
  return { trace, errors, send };
}

test("popup OFF restores the adapter immediately and ON remounts it without reload", async () => {
  const local = area();
  const app = await contentHarness(local);
  assert.deepEqual(app.errors, []);
  assert.equal(app.trace.filter((entry) => entry === "adapter.start").length, 1);
  const off = await app.send("gsm.ui.set", { enabled: false });
  assert.equal(off.ok, true);
  assert.equal(off.uiActive, false);
  assert.ok(app.trace.includes("sidebar.clear"));
  assert.ok(app.trace.includes("adapter.stop"));
  assert.equal((await app.send("gsm.learning.status")).uiSettings.enabled, false);
  assert.match((await app.send("gsm.learning.start", { mode: "all" })).error, /GSM을 켠 뒤/);
  const on = await app.send("gsm.ui.set", { enabled: true });
  assert.equal(on.uiActive, true);
  assert.equal(app.trace.filter((entry) => entry === "adapter.start").length, 2);
  await app.send("gsm.ui.set", { enabled: false });
  const reloaded = await contentHarness(local);
  assert.deepEqual(reloaded.errors, []);
  assert.equal(reloaded.trace.includes("adapter.start"), false);
  assert.equal((await reloaded.send("gsm.learning.status")).uiSettings.enabled, false);
});

test("a cancelled learning scan signals completion before UI teardown", async () => {
  let releaseScan;
  let finished = 0;
  const learner = new BulkLearner(
    { getProjectRows: () => [{ projectId: PROJECT_A, label: "A" }] },
    { writable: true, async observe() {} },
    { async mark() {} },
    { scan: () => new Promise((resolve) => { releaseScan = resolve; }) }
  );
  learner.onFinished = () => { finished++; };
  learner.start("all");
  await new Promise((resolve) => setImmediate(resolve));
  learner.cancel();
  releaseScan([{ conversationId: CHAT, projectId: PROJECT_A }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(learner.status().running, false);
  assert.equal(learner.status().results[0].status, "cancelled");
  assert.equal(finished, 1);
});
