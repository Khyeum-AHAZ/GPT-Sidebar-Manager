(() => {
  "use strict";

  const STORAGE_PREFIX = "gsm.membership.v1.";
  const ID = /^[a-zA-Z0-9_-]{8,}$/;

  class MembershipRegistry {
    constructor(storageArea) {
      this.storageArea = storageArea;
      this.entries = Object.create(null);
      this.writable = true;
      this.writeQueue = Promise.resolve();
    }

    async load() {
      const stored = await this.storageArea.get(null);
      const entries = Object.create(null);
      for (const [key, entry] of Object.entries(stored)) {
        if (!key.startsWith(STORAGE_PREFIX)) continue;
        const conversationId = key.slice(STORAGE_PREFIX.length);
        if (!ID.test(conversationId) || !entry ||
            (entry.projectId !== null && (typeof entry.projectId !== "string" || !ID.test(entry.projectId))) ||
            !Number.isFinite(entry.verifiedAt)) {
          this.writable = false;
          throw new Error("Membership cache entry is invalid");
        }
        entries[conversationId] = { projectId: entry.projectId, verifiedAt: entry.verifiedAt };
      }
      this.entries = entries;
    }

    getProjectId(conversationId) {
      return this.entries[conversationId]?.projectId ?? null;
    }

    enqueue(action) {
      const task = this.writeQueue.then(action);
      this.writeQueue = task.catch(() => {});
      return task;
    }

    applyChanges(changes) {
      let changed = false;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(STORAGE_PREFIX)) continue;
        const conversationId = key.slice(STORAGE_PREFIX.length);
        if (!ID.test(conversationId)) continue;
        const incoming = change.newValue;
        if (incoming === undefined) {
          if (Object.hasOwn(this.entries, conversationId)) {
            delete this.entries[conversationId];
            changed = true;
          }
          continue;
        }
        if (!incoming) continue;
        if (incoming.projectId !== null && (typeof incoming.projectId !== "string" || !ID.test(incoming.projectId))) continue;
        if (!Number.isFinite(incoming.verifiedAt)) continue;
        if (incoming.verifiedAt < (this.entries[conversationId]?.verifiedAt ?? 0)) continue;
        this.entries[conversationId] = incoming;
        changed = true;
      }
      return changed;
    }

    observe(observations) {
      return this.enqueue(() => this.observeNow(observations));
    }

    async observeNow(observations) {
      if (!this.writable || observations.length === 0) return;
      const now = Date.now();
      const changed = Object.create(null);
      for (const { conversationId, projectId } of observations) {
        if (!ID.test(conversationId)) continue;
        if (projectId !== null && !ID.test(projectId)) continue;
        if (projectId === null && !this.entries[conversationId]) continue;
        if (this.entries[conversationId]?.projectId === projectId) continue;
        changed[conversationId] = { projectId, verifiedAt: now };
      }
      if (Object.keys(changed).length === 0) return;
      const updates = Object.fromEntries(Object.entries(changed)
        .map(([conversationId, entry]) => [`${STORAGE_PREFIX}${conversationId}`, entry]));
      try {
        await this.storageArea.set(updates);
      } catch (error) {
        this.writable = false;
        throw error;
      }
      Object.assign(this.entries, changed);
    }

    clear() {
      return this.enqueue(async () => {
        if (!this.writable) throw new Error("Membership cache is unavailable");
        try {
          const stored = await this.storageArea.get(null);
          const keys = Object.keys(stored).filter((key) => key.startsWith(STORAGE_PREFIX));
          if (keys.length) await this.storageArea.remove(keys);
        } catch (error) {
          this.writable = false;
          throw error;
        }
        this.entries = Object.create(null);
      });
    }
  }

  globalThis.GSMMembershipRegistry = MembershipRegistry;
  if (typeof module !== "undefined") module.exports = MembershipRegistry;
})();
