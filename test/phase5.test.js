const test = require("node:test");
const assert = require("node:assert/strict");
const FolderStore = require("../src/storage/FolderStore.js");
const AssignmentStore = require("../src/storage/AssignmentStore.js");
const SafeDragController = require("../src/drag/SafeDragController.js");
require("../src/storage/Migration.js");
const SyncStore = require("../src/storage/SyncStore.js");

const PROJECT = "g-p-aaaaaaaaaaaaaaaa";
const OTHER = "g-p-bbbbbbbbbbbbbbbb";
const CHATS = ["chat-11111111", "chat-22222222", "chat-33333333"];

function area(initial = {}) {
  let values = structuredClone(initial);
  return {
    failSet: false,
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(values);
      return Object.fromEntries(keys.filter((key) => Object.hasOwn(values, key))
        .map((key) => [key, structuredClone(values[key])]));
    },
    async set(updates) {
      if (this.failSet) throw new Error("write failed");
      values = { ...values, ...structuredClone(updates) };
    },
    async remove(keys) { for (const key of keys) delete values[key]; },
    values() { return structuredClone(values); }
  };
}

test("chat placements persist through Sync and folder deletion returns chats to the project root", async () => {
  const local = area();
  const sync = area();
  const bridge = new SyncStore(local, sync);
  await bridge.load();
  const folders = new FolderStore(bridge, { newId: () => "folder-12345678", now: () => 100 });
  const assignments = new AssignmentStore(bridge, { now: () => 101 });
  await folders.load();
  await assignments.load();
  const folder = await folders.create(PROJECT, "자료");
  await assignments.place(CHATS[0], PROJECT, folder.folderId, [CHATS[0], CHATS[1]]);
  assert.deepEqual(assignments.list(PROJECT, folder.folderId).map((item) => item.conversationId), CHATS.slice(0, 2));
  assert.equal(sync.values()[AssignmentStore.key(CHATS[0])].folderId, folder.folderId);
  await assignments.clearFolder(PROJECT, folder.folderId);
  await folders.remove(PROJECT, folder.folderId);
  assert.equal(assignments.get(CHATS[0], PROJECT).folderId, null);
  assert.equal(assignments.get(CHATS[1], PROJECT).folderId, null);
  assert.equal(sync.values()[AssignmentStore.key(CHATS[0])].folderId, null);
  assert.equal(folders.list(PROJECT).length, 0);
});

test("observed project move clears the former folder assignment", async () => {
  const data = area();
  const assignments = new AssignmentStore(data, { now: () => 100 });
  await assignments.load();
  await assignments.place(CHATS[0], PROJECT, "folder-12345678", [CHATS[0]]);
  await assignments.clearMoved([{ conversationId: CHATS[0], projectId: OTHER }]);
  assert.equal(assignments.get(CHATS[0], PROJECT), null);
  assert.equal(assignments.get(CHATS[0], OTHER).folderId, null);
});

test("chat order is stored and failed reorder keeps the previous order", async () => {
  const data = area();
  const assignments = new AssignmentStore(data, { now: () => 100 });
  await assignments.load();
  await assignments.place(CHATS[0], PROJECT, null, CHATS);
  assert.deepEqual(assignments.list(PROJECT, null).sort((a, b) => a.order - b.order)
    .map((item) => item.conversationId), CHATS);
  data.failSet = true;
  await assert.rejects(assignments.place(CHATS[2], PROJECT, null,
    [CHATS[2], CHATS[0], CHATS[1]]), /write failed/);
  assert.deepEqual(assignments.list(PROJECT, null).sort((a, b) => a.order - b.order)
    .map((item) => item.conversationId), CHATS);
});

test("folder order changes only after a successful storage write", async () => {
  const data = area();
  let id = 0;
  const folders = new FolderStore(data, { newId: () => `folder-${++id}-abcdef`, now: () => 100 });
  await folders.load();
  const first = await folders.create(PROJECT, "첫째");
  const second = await folders.create(PROJECT, "둘째");
  await folders.reorder(PROJECT, second.folderId, first.folderId);
  assert.deepEqual(folders.list(PROJECT).map((folder) => folder.folderId), [second.folderId, first.folderId]);
  data.failSet = true;
  await assert.rejects(folders.reorder(PROJECT, first.folderId, second.folderId), /write failed/);
  assert.deepEqual(folders.list(PROJECT).map((folder) => folder.folderId), [second.folderId, first.folderId]);
});

function node() {
  const listeners = {};
  return {
    addEventListener(type, callback) { listeners[type] = callback; },
    fire(type, event) { listeners[type]?.(event); }
  };
}

test("Safe Drag rejects cross-project and external drops without writing", async () => {
  const operations = [];
  const drag = new SafeDragController({ onDrop: (...args) => operations.push(args) });
  const source = node();
  const other = node();
  const same = node();
  drag.sourceNode(source, { kind: "chat", id: CHATS[0], projectId: PROJECT });
  drag.targetNode(other, { kind: "folder", folderId: "folder-12345678", projectId: OTHER });
  drag.targetNode(same, { kind: "folder", folderId: "folder-12345678", projectId: PROJECT });
  let prevented = 0;
  let stopped = 0;
  const event = { preventDefault: () => prevented++, stopPropagation: () => stopped++, dataTransfer: {
    setData() {}, effectAllowed: "", dropEffect: ""
  } };
  other.fire("drop", event);
  source.fire("dragstart", event);
  other.fire("dragover", event);
  other.fire("drop", event);
  assert.equal(prevented, 2);
  assert.equal(operations.length, 0);
  same.fire("drop", event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(operations.length, 1);
  assert.ok(stopped >= 4);
});
