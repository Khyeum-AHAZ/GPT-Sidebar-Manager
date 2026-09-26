(() => {
  "use strict";

  const PREFIX = "gsm.learning.v1.";
  const ID = /^[a-zA-Z0-9_-]{8,}$/;

  class LearningStore {
    constructor(storageArea, { now = Date.now } = {}) {
      this.storageArea = storageArea;
      this.now = now;
      this.entries = new Map();
    }

    static key(projectId) { return `${PREFIX}${projectId}`; }

    async load() {
      const stored = await this.storageArea.get(null);
      this.entries.clear();
      for (const [key, record] of Object.entries(stored)) {
        if (!key.startsWith(PREFIX)) continue;
        if (!ID.test(record?.projectId) || key !== LearningStore.key(record.projectId) ||
            !Number.isInteger(record.count) || record.count < 0 || !Number.isFinite(record.scannedAt)) continue;
        this.entries.set(record.projectId, record);
      }
    }

    has(projectId) { return this.entries.has(projectId); }

    applyChanges(changes) {
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(PREFIX)) continue;
        const projectId = key.slice(PREFIX.length);
        if (!ID.test(projectId)) continue;
        const record = change.newValue;
        if (record === undefined) {
          this.entries.delete(projectId);
        } else if (record?.projectId === projectId &&
                   Number.isInteger(record.count) && record.count >= 0 &&
                   Number.isFinite(record.scannedAt)) {
          this.entries.set(projectId, record);
        }
      }
    }

    async mark(projectId, count) {
      if (!ID.test(projectId) || !Number.isInteger(count) || count < 0) throw new Error("Learning result is invalid");
      const record = { projectId, count, scannedAt: this.now() };
      await this.storageArea.set({ [LearningStore.key(projectId)]: record });
      this.entries.set(projectId, record);
    }

    async clear() {
      const stored = await this.storageArea.get(null);
      const keys = Object.keys(stored).filter((key) => key.startsWith(PREFIX));
      if (keys.length) await this.storageArea.remove(keys);
      this.entries.clear();
    }
  }

  globalThis.GSMLearningStore = LearningStore;
  if (typeof module !== "undefined") module.exports = LearningStore;
})();
