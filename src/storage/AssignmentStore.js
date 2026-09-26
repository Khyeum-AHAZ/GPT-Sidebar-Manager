(() => {
  "use strict";

  const PREFIX = "gsm.assignment.v1.";
  const ID = /^[a-zA-Z0-9_-]{8,}$/;

  class AssignmentStore {
    constructor(storageArea, { now = Date.now } = {}) {
      this.storageArea = storageArea;
      this.now = now;
      this.assignments = new Map();
      this.writable = true;
    }

    static key(conversationId) { return `${PREFIX}${conversationId}`; }

    static valid(record) {
      return record && record.schemaVersion === 1 && ID.test(record.conversationId) &&
        ID.test(record.projectId) && (record.folderId === null || ID.test(record.folderId)) &&
        Number.isFinite(record.order) && Number.isInteger(record.revision) && record.revision > 0 &&
        Number.isFinite(record.updatedAt) &&
        (record.deletedAt === null || Number.isFinite(record.deletedAt));
    }

    async load() {
      const stored = await this.storageArea.get(null);
      const assignments = new Map();
      for (const [key, record] of Object.entries(stored)) {
        if (!key.startsWith(PREFIX)) continue;
        if (!AssignmentStore.valid(record) || key !== AssignmentStore.key(record.conversationId)) {
          this.writable = false;
          throw new Error("Assignment record is invalid");
        }
        assignments.set(key, record);
      }
      this.assignments = assignments;
    }

    get(conversationId, projectId) {
      const record = this.assignments.get(AssignmentStore.key(conversationId));
      return record?.deletedAt === null && record.projectId === projectId ? record : null;
    }

    list(projectId, folderId) {
      return [...this.assignments.values()].filter((record) =>
        record.deletedAt === null && record.projectId === projectId && record.folderId === folderId);
    }

    applyChanges(changes) {
      let changed = false;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(PREFIX)) continue;
        const record = change.newValue;
        if (!AssignmentStore.valid(record) || key !== AssignmentStore.key(record.conversationId)) continue;
        const previous = this.assignments.get(key);
        if (previous && globalThis.GSMFolderStore.compare(record, previous) < 0) continue;
        this.assignments.set(key, record);
        changed = true;
      }
      return changed;
    }

    async saveMany(records) {
      if (!this.writable) throw new Error("채팅 분류 저장을 사용할 수 없습니다.");
      const updates = Object.fromEntries(records.map((record) =>
        [AssignmentStore.key(record.conversationId), record]));
      if (!records.length) return;
      try {
        await this.storageArea.set(updates);
      } catch (error) {
        if (error.name === "ConflictError") {
          const authoritative = await this.storageArea.get(null);
          for (const key of Object.keys(updates)) {
            if (AssignmentStore.valid(authoritative[key])) this.assignments.set(key, authoritative[key]);
          }
        } else {
          this.writable = false;
        }
        throw error;
      }
      for (const record of records) this.assignments.set(AssignmentStore.key(record.conversationId), record);
    }

    make(conversationId, projectId, folderId, order) {
      if (!ID.test(conversationId) || !ID.test(projectId) ||
          (folderId !== null && !ID.test(folderId)) || !Number.isFinite(order)) {
        throw new Error("채팅 분류 ID 또는 순서가 올바르지 않습니다.");
      }
      const previous = this.assignments.get(AssignmentStore.key(conversationId));
      const updatedAt = Math.max(this.now(), (previous?.updatedAt ?? 0) + 1);
      return {
        schemaVersion: 1, conversationId, projectId, folderId, order,
        revision: (previous?.revision ?? 0) + 1, updatedAt, deletedAt: null
      };
    }

    async place(conversationId, projectId, folderId, orderedIds) {
      if (!orderedIds.includes(conversationId) || new Set(orderedIds).size !== orderedIds.length) {
        throw new Error("채팅 순서가 올바르지 않습니다.");
      }
      const records = orderedIds.flatMap((id, order) => {
        const previous = this.get(id, projectId);
        return previous?.folderId === folderId && previous.order === order ? [] :
          [this.make(id, projectId, folderId, order)];
      });
      await this.saveMany(records);
    }

    async clearFolder(projectId, folderId) {
      const assigned = this.list(projectId, folderId);
      if (!assigned.length) return;
      const records = assigned.map((record) => this.make(
        record.conversationId, projectId, null, record.order));
      await this.saveMany(records);
    }

    async clearMoved(observations) {
      const records = [];
      for (const { conversationId, projectId } of observations) {
        const previous = this.assignments.get(AssignmentStore.key(conversationId));
        if (!previous || previous.deletedAt !== null || previous.projectId === projectId) continue;
        records.push({
          ...previous, folderId: null, projectId: projectId ?? previous.projectId,
          revision: previous.revision + 1,
          updatedAt: Math.max(this.now(), previous.updatedAt + 1),
          deletedAt: projectId === null ? this.now() : null
        });
      }
      await this.saveMany(records);
    }
  }

  globalThis.GSMAssignmentStore = AssignmentStore;
  if (typeof module !== "undefined") module.exports = AssignmentStore;
})();
