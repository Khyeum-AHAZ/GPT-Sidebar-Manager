const test = require("node:test");
const assert = require("node:assert/strict");
const FolderStore = require("../src/storage/FolderStore.js");
require("../src/storage/Migration.js");
const SyncStore = require("../src/storage/SyncStore.js");

const PROJECT = "g-p-aaaaaaaaaaaaaaaa";
const FOLDER = "folder-12345678";
const OTHER = "folder-87654321";

function record(folderId, name, updatedAt, deletedAt = null) {
  return {
    schemaVersion: 2, projectId: PROJECT, folderId, name,
    order: 0, collapsed: false, revision: 1, updatedAt, deletedAt
  };
}

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
      if (this.failSet) throw new Error("quota exceeded");
      values = { ...values, ...structuredClone(updates) };
    },
    async remove(keys) {
      for (const key of keys) delete values[key];
    },
    values() { return structuredClone(values); }
  };
}

test("Phase 3 active folders migrate and sync without copying deleted test folders", async () => {
  const oldActive = { ...record(FOLDER, "Saved", 10) };
  const oldDeleted = { ...record(OTHER, "Deleted", 12, 12) };
  delete oldActive.schemaVersion;
  delete oldDeleted.schemaVersion;
  delete oldActive.revision;
  delete oldDeleted.revision;
  const local = area({
    [`gsm.folder.v1.${PROJECT}.${FOLDER}`]: oldActive,
    [`gsm.folder.v1.${PROJECT}.${OTHER}`]: oldDeleted
  });
  const sync = area();
  const store = new SyncStore(local, sync);
  await store.load();
  const folderKey = FolderStore.key(PROJECT, FOLDER);
  assert.equal(local.values()[folderKey].schemaVersion, 2);
  assert.equal(sync.values()[folderKey].name, "Saved");
  assert.equal(sync.values()[FolderStore.key(PROJECT, OTHER)], undefined);
  assert.equal(store.status().kind, "synced");
});

test("sync failure preserves a local folder and retry clears pending state", async () => {
  const local = area();
  const sync = area();
  const bridge = new SyncStore(local, sync);
  await bridge.load();
  const folders = new FolderStore(bridge, { newId: () => FOLDER, now: () => 100 });
  await folders.load();
  sync.failSet = true;
  await folders.create(PROJECT, "Local only");
  const key = FolderStore.key(PROJECT, FOLDER);
  assert.equal(folders.list(PROJECT)[0].name, "Local only");
  assert.equal(local.values()[key].name, "Local only");
  assert.equal(sync.values()[key], undefined);
  assert.equal(bridge.status().kind, "error");
  assert.equal(bridge.status().pendingCount, 1);
  sync.failSet = false;
  await bridge.flush();
  assert.equal(sync.values()[key].name, "Local only");
  assert.equal(bridge.status().kind, "synced");
  assert.equal(local.values()[SyncStore.pendingKey(key)], undefined);
});

test("remote newer records and deletion tombstones win per folder", async () => {
  const firstKey = FolderStore.key(PROJECT, FOLDER);
  const otherKey = FolderStore.key(PROJECT, OTHER);
  const local = area({
    [firstKey]: record(FOLDER, "Old local", 10),
    [otherKey]: record(OTHER, "New local", 30)
  });
  const sync = area({
    [firstKey]: record(FOLDER, "Remote deleted", 20, 20),
    [otherKey]: record(OTHER, "Old remote", 5)
  });
  const bridge = new SyncStore(local, sync);
  await bridge.load();
  const folders = new FolderStore(bridge);
  await folders.load();
  assert.equal(folders.list(PROJECT).length, 1);
  assert.equal(folders.list(PROJECT)[0].folderId, OTHER);
  assert.equal(local.values()[firstKey].deletedAt, 20);
  assert.equal(sync.values()[otherKey].name, "New local");
});

test("incoming sync changes update only their own entity", async () => {
  const firstKey = FolderStore.key(PROJECT, FOLDER);
  const otherKey = FolderStore.key(PROJECT, OTHER);
  const local = area({
    [firstKey]: record(FOLDER, "First", 10),
    [otherKey]: record(OTHER, "Second", 10)
  });
  const sync = area(local.values());
  const bridge = new SyncStore(local, sync);
  await bridge.load();
  await bridge.applyChanges({ [firstKey]: { newValue: record(FOLDER, "Remote edit", 20) } }, "sync");
  assert.equal(local.values()[firstKey].name, "Remote edit");
  assert.equal(local.values()[otherKey].name, "Second");
  assert.equal(bridge.status().kind, "synced");
});

test("a newer remote revision rejects a stale local create without disabling folders", async () => {
  const local = area();
  const sync = area();
  const bridge = new SyncStore(local, sync);
  await bridge.load();
  const folders = new FolderStore(bridge, { newId: () => FOLDER, now: () => 100 });
  await folders.load();
  const key = FolderStore.key(PROJECT, FOLDER);
  await sync.set({ [key]: { ...record(FOLDER, "Remote", 200), revision: 2 } });
  await assert.rejects(folders.create(PROJECT, "Stale local"), { name: "ConflictError" });
  assert.equal(folders.writable, true);
  assert.equal(folders.list(PROJECT)[0].name, "Remote");
  assert.equal(local.values()[key].name, "Remote");
});

test("revision order wins over a clock-skewed timestamp", () => {
  const olderRevision = { ...record(FOLDER, "Clock ahead", 500), revision: 1 };
  const newerRevision = { ...record(FOLDER, "Later edit", 100), revision: 2 };
  assert.equal(SyncStore.compare(newerRevision, olderRevision), 1);
  assert.equal(SyncStore.compare(olderRevision, newerRevision), -1);
});
