(() => {
  "use strict";

  const PREFIXES = ["gsm.folder.v2.", "gsm.assignment.v1."];
  const PENDING_PREFIX = "gsm.sync.pending.v2.";

  class SyncStore {
    constructor(localArea, syncArea) {
      this.localArea = localArea;
      this.syncArea = syncArea;
      this.records = new Map();
      this.pending = new Set();
      this.lastError = null;
      this.onStatusChange = () => {};
      this.flushQueue = Promise.resolve();
    }

    static pendingKey(key) {
      return key.startsWith(PREFIXES[0]) ?
        `${PENDING_PREFIX}${key.slice(PREFIXES[0].length)}` : `${PENDING_PREFIX}${key}`;
    }

    static managed(key) { return PREFIXES.some((prefix) => key.startsWith(prefix)); }

    static recordKeyFromPending(key) {
      const suffix = key.slice(PENDING_PREFIX.length);
      return suffix.startsWith(PREFIXES[1]) ? suffix : `${PREFIXES[0]}${suffix}`;
    }

    static compare(a, b) {
      return globalThis.GSMFolderStore.compare(a, b);
    }

    valid(key, record) {
      if (key.startsWith(PREFIXES[0])) {
        return globalThis.GSMFolderStore.valid(record) &&
          key === globalThis.GSMFolderStore.key(record.projectId, record.folderId);
      }
      if (key.startsWith(PREFIXES[1])) {
        return globalThis.GSMAssignmentStore.valid(record) &&
          key === globalThis.GSMAssignmentStore.key(record.conversationId);
      }
      return false;
    }

    status() {
      return {
        kind: this.lastError ? "error" : this.pending.size ? "pending" : "synced",
        pendingCount: this.pending.size,
        error: this.lastError
      };
    }

    notify() {
      this.onStatusChange(this.status());
    }

    async get() {
      return Object.fromEntries(this.records);
    }

    async load() {
      const localStored = await this.localArea.get(null);
      const migrated = globalThis.GSMMigration.fromLocal(localStored);
      if (Object.keys(migrated).length) {
        await this.localArea.set(migrated);
        Object.assign(localStored, migrated);
      }
      let remoteStored = {};
      let remoteReadable = true;
      try {
        remoteStored = await this.syncArea.get(null);
      } catch (error) {
        remoteReadable = false;
        this.lastError = error.message || "Chrome Sync read failed";
      }
      const keys = new Set([...Object.keys(localStored), ...Object.keys(remoteStored)]
        .filter(SyncStore.managed));
      const localUpdates = {};
      const clearPending = [];
      for (const key of keys) {
        const local = localStored[key];
        const remote = remoteStored[key];
        if (local !== undefined && !this.valid(key, local)) throw new Error("Local GSM record is invalid");
        if (remote !== undefined && !this.valid(key, remote)) {
          this.lastError = "Chrome Sync GSM record is invalid";
          if (local) this.records.set(key, local);
          continue;
        }
        const winner = SyncStore.compare(local, remote) >= 0 ? local : remote;
        if (!winner) continue;
        this.records.set(key, winner);
        if (remoteReadable && SyncStore.compare(winner, remote) > 0) {
          this.pending.add(key);
          localUpdates[SyncStore.pendingKey(key)] = { updatedAt: winner.updatedAt };
        } else if (!remoteReadable) {
          this.pending.add(key);
          localUpdates[SyncStore.pendingKey(key)] = { updatedAt: winner.updatedAt };
        } else if (Object.hasOwn(localStored, SyncStore.pendingKey(key))) {
          clearPending.push(SyncStore.pendingKey(key));
        }
        if (SyncStore.compare(winner, local) > 0) localUpdates[key] = winner;
      }
      if (Object.keys(localUpdates).length) await this.localArea.set(localUpdates);
      if (clearPending.length) await this.localArea.remove(clearPending);
      this.notify();
      if (remoteReadable && this.pending.size) await this.flush();
    }

    async set(updates) {
      const localUpdates = {};
      const currentStored = await this.localArea.get(Object.keys(updates));
      for (const [key, record] of Object.entries(updates)) {
        if (!this.valid(key, record)) throw new Error("GSM update is invalid");
        if (currentStored[key] !== undefined && !this.valid(key, currentStored[key])) {
          throw new Error("Local GSM record is invalid");
        }
        const current = SyncStore.compare(currentStored[key], this.records.get(key)) > 0 ?
          currentStored[key] : this.records.get(key);
        if (current && SyncStore.compare(record, current) <= 0 &&
            JSON.stringify(record) !== JSON.stringify(current)) {
          const error = new Error("다른 탭에서 폴더가 변경됐습니다. 다시 시도해 주세요.");
          error.name = "ConflictError";
          throw error;
        }
        localUpdates[key] = record;
        localUpdates[SyncStore.pendingKey(key)] = { updatedAt: record.updatedAt };
      }
      if (!Object.keys(localUpdates).length) return;
      await this.localArea.set(localUpdates);
      for (const [key, record] of Object.entries(updates)) {
        this.records.set(key, record);
        this.pending.add(key);
      }
      this.notify();
      await this.flush();
      for (const [key, record] of Object.entries(updates)) {
        if (JSON.stringify(this.records.get(key)) !== JSON.stringify(record)) {
          const error = new Error("다른 기기에서 폴더가 변경됐습니다. 다시 확인해 주세요.");
          error.name = "ConflictError";
          throw error;
        }
      }
    }

    flush() {
      this.flushQueue = this.flushQueue.then(() => this.flushOnce()).catch((error) => {
        this.lastError = error.message || "Chrome Sync write failed";
        this.notify();
      });
      return this.flushQueue;
    }

    async flushOnce() {
      if (!this.pending.size) return;
      const keys = [...this.pending];
      const remoteStored = await this.syncArea.get(keys);
      const updates = {};
      const resolved = [];
      const localWins = [];
      for (const key of keys) {
        const local = this.records.get(key);
        const remote = remoteStored[key];
        if (remote !== undefined && !this.valid(key, remote)) throw new Error("Chrome Sync GSM record is invalid");
        const relation = SyncStore.compare(local, remote);
        if (relation < 0) {
          updates[key] = remote;
          resolved.push(key);
        } else if (relation === 0) {
          resolved.push(key);
        } else {
          localWins.push(key);
        }
      }
      if (Object.keys(updates).length) {
        await this.localArea.set(updates);
        for (const [key, record] of Object.entries(updates)) this.records.set(key, record);
      }
      for (const key of resolved) this.pending.delete(key);
      if (resolved.length) await this.localArea.remove(resolved.map(SyncStore.pendingKey));
      if (localWins.length) {
        const batch = Object.fromEntries(localWins.map((key) => [key, this.records.get(key)]));
        await this.syncArea.set(batch);
        const done = localWins.filter((key) =>
          JSON.stringify(this.records.get(key)) === JSON.stringify(batch[key]));
        for (const key of done) this.pending.delete(key);
        if (done.length) await this.localArea.remove(done.map(SyncStore.pendingKey));
      }
      this.lastError = null;
      this.notify();
    }

    async applyChanges(changes, areaName) {
      if (areaName === "local") {
        let changed = false;
        for (const [key, change] of Object.entries(changes)) {
          if (SyncStore.managed(key) && change.newValue !== undefined &&
              !this.valid(key, change.newValue)) {
            this.lastError = "Local GSM record is invalid";
            changed = true;
            continue;
          }
          if (SyncStore.managed(key) && this.valid(key, change.newValue) &&
              SyncStore.compare(change.newValue, this.records.get(key)) >= 0) {
            this.records.set(key, change.newValue);
            changed = true;
          }
          if (key.startsWith(PENDING_PREFIX) && change.newValue) {
            this.pending.add(SyncStore.recordKeyFromPending(key));
            changed = true;
          }
        }
        if (changed) this.notify();
        return;
      }
      if (areaName !== "sync") return;
      const updates = {};
      const pendingUpdates = {};
      const clearPending = [];
      const resolvedKeys = [];
      for (const [key, change] of Object.entries(changes)) {
        if (!SyncStore.managed(key)) continue;
        const remote = change.newValue;
        if (!this.valid(key, remote)) {
          this.lastError = "Chrome Sync GSM record is invalid";
          this.notify();
          continue;
        }
        const relation = SyncStore.compare(remote, this.records.get(key));
        if (relation > 0) {
          updates[key] = remote;
          clearPending.push(SyncStore.pendingKey(key));
          resolvedKeys.push(key);
        } else if (relation < 0) {
          this.pending.add(key);
          pendingUpdates[SyncStore.pendingKey(key)] = { updatedAt: this.records.get(key).updatedAt };
        } else if (this.pending.has(key)) {
          clearPending.push(SyncStore.pendingKey(key));
          resolvedKeys.push(key);
        }
      }
      if (Object.keys(updates).length || Object.keys(pendingUpdates).length) {
        await this.localArea.set({ ...updates, ...pendingUpdates });
      }
      if (clearPending.length) await this.localArea.remove(clearPending);
      for (const [key, record] of Object.entries(updates)) this.records.set(key, record);
      for (const key of resolvedKeys) this.pending.delete(key);
      this.notify();
      if (Object.keys(pendingUpdates).length) await this.flush();
    }
  }

  globalThis.GSMSyncStore = SyncStore;
  if (typeof module !== "undefined") module.exports = SyncStore;
})();
