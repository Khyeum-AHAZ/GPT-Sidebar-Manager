(() => {
  "use strict";

  const PREFIX = "gsm.folder.v2.";
  const ID = /^[a-zA-Z0-9_-]{8,}$/;
  const UNCLASSIFIED_ID = "unclassified"; // 이전 버전의 가상 폴더 기록은 보존하되 표시하지 않는다.
  const COLORS = Object.freeze(["default", "red", "coral", "peach", "amber", "gold", "butter",
    "lime", "chartreuse", "green", "emerald", "mint", "teal", "cyan", "sky", "blue", "indigo",
    "lavender", "purple", "magenta", "rose"]);

  class FolderStore {
    constructor(storageArea, { now = Date.now, newId = () => crypto.randomUUID() } = {}) {
      this.storageArea = storageArea;
      this.now = now;
      this.newId = newId;
      this.folders = new Map();
      this.writable = true;
    }

    static valid(record) {
      return record && record.schemaVersion === 2 && ID.test(record.projectId) && ID.test(record.folderId) &&
        typeof record.name === "string" && record.name.trim() &&
        Number.isFinite(record.order) && typeof record.collapsed === "boolean" &&
        (record.color === undefined || COLORS.includes(record.color)) &&
        Number.isInteger(record.revision) && record.revision > 0 &&
        Number.isFinite(record.updatedAt) &&
        (record.deletedAt === null || Number.isFinite(record.deletedAt));
    }

    static compare(a, b) {
      if (!a) return b ? -1 : 0;
      if (!b) return 1;
      if (a.revision !== b.revision) return a.revision > b.revision ? 1 : -1;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
      if ((a.deletedAt !== null) !== (b.deletedAt !== null)) return a.deletedAt !== null ? 1 : -1;
      const left = JSON.stringify(a);
      const right = JSON.stringify(b);
      return left === right ? 0 : left > right ? 1 : -1;
    }

    static key(projectId, folderId) {
      return `${PREFIX}${projectId}.${folderId}`;
    }

    static get colors() { return COLORS; }

    async load() {
      const stored = await this.storageArea.get(null);
      const folders = new Map();
      for (const [key, record] of Object.entries(stored)) {
        if (!key.startsWith(PREFIX)) continue;
        if (!FolderStore.valid(record) || key !== FolderStore.key(record.projectId, record.folderId)) {
          this.writable = false;
          throw new Error("Folder record is invalid");
        }
        folders.set(key, record);
      }
      this.folders = folders;
    }

    list(projectId) {
      return [...this.folders.values()]
        .filter((folder) => folder.projectId === projectId && folder.folderId !== UNCLASSIFIED_ID && folder.deletedAt === null)
        .sort((a, b) => a.order - b.order || a.folderId.localeCompare(b.folderId));
    }

    applyChanges(changes) {
      let changed = false;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(PREFIX)) continue;
        const record = change.newValue;
        if (!FolderStore.valid(record) || key !== FolderStore.key(record.projectId, record.folderId)) continue;
        const previous = this.folders.get(key);
        if (previous && FolderStore.compare(record, previous) < 0) continue;
        this.folders.set(key, record);
        changed = true;
      }
      return changed;
    }

    async save(record) {
      await this.saveMany([record]);
      return record;
    }

    async saveMany(records) {
      if (!this.writable) throw new Error("Folder storage is unavailable");
      if (!records.length) return;
      const updates = Object.fromEntries(records.map((record) =>
        [FolderStore.key(record.projectId, record.folderId), record]));
      try {
        await this.storageArea.set(updates);
      } catch (error) {
        if (error.name === "ConflictError") {
          const current = await this.storageArea.get(null);
          for (const key of Object.keys(updates)) {
            if (FolderStore.valid(current[key])) this.folders.set(key, current[key]);
          }
        } else {
          this.writable = false;
        }
        throw error;
      }
      for (const record of records) this.folders.set(FolderStore.key(record.projectId, record.folderId), record);
    }

    name(value) {
      const name = String(value ?? "").trim();
      if (!name || name.length > 200) throw new Error("폴더 이름은 1~200자여야 합니다.");
      return name;
    }

    async create(projectId, value) {
      if (!ID.test(projectId)) throw new Error("Project ID is invalid");
      const folders = this.list(projectId);
      const folderId = this.newId();
      if (!ID.test(folderId)) throw new Error("Folder ID is invalid");
      return this.save({
        schemaVersion: 2,
        projectId,
        folderId,
        name: this.name(value),
        order: folders.length ? Math.max(...folders.map((folder) => folder.order)) + 1 : 0,
        collapsed: false,
        revision: 1,
        updatedAt: this.now(),
        deletedAt: null
      });
    }

    async update(projectId, folderId, changes) {
      const previous = this.folders.get(FolderStore.key(projectId, folderId));
      if (!previous || previous.deletedAt !== null) throw new Error("Folder does not exist");
      return this.save({
        ...previous,
        ...changes,
        revision: previous.revision + 1,
        updatedAt: Math.max(this.now(), previous.updatedAt + 1)
      });
    }

    rename(projectId, folderId, value) {
      return this.update(projectId, folderId, { name: this.name(value) });
    }

    setCollapsed(projectId, folderId, collapsed) {
      return this.update(projectId, folderId, { collapsed: Boolean(collapsed) });
    }

    setColor(projectId, folderId, color) {
      if (!COLORS.includes(color)) throw new Error("폴더 색상이 올바르지 않습니다.");
      return this.update(projectId, folderId, { color });
    }

    remove(projectId, folderId) {
      const previous = this.folders.get(FolderStore.key(projectId, folderId));
      if (!previous || previous.deletedAt !== null) throw new Error("Folder does not exist");
      const deletedAt = Math.max(this.now(), previous.updatedAt + 1);
      return this.save({ ...previous, revision: previous.revision + 1, updatedAt: deletedAt, deletedAt });
    }

    async reorder(projectId, sourceId, beforeId) {
      const folders = this.list(projectId);
      const source = folders.find((folder) => folder.folderId === sourceId);
      if (!source || (beforeId !== null && !folders.some((folder) => folder.folderId === beforeId))) {
        throw new Error("폴더 위치가 올바르지 않습니다.");
      }
      const ordered = folders.filter((folder) => folder.folderId !== sourceId);
      const index = beforeId === null ? ordered.length : ordered.findIndex((folder) => folder.folderId === beforeId);
      ordered.splice(index, 0, source);
      const records = ordered.filter((folder, order) => folder.order !== order).map((folder) => ({
        ...folder, order: ordered.indexOf(folder), revision: folder.revision + 1,
        updatedAt: Math.max(this.now(), folder.updatedAt + 1)
      }));
      await this.saveMany(records);
    }
  }

  globalThis.GSMFolderStore = FolderStore;
  if (typeof module !== "undefined") module.exports = FolderStore;
})();
