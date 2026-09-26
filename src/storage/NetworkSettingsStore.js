(() => {
  "use strict";

  const KEY = "gsm.network.settings.v1";

  class NetworkSettingsStore {
    constructor(localArea, syncArea, { key = KEY } = {}) {
      this.localArea = localArea;
      this.syncArea = syncArea;
      this.key = key;
      this.value = { enabled: false, noticeShown: false, updatedAt: 0 };
      this.error = null;
      this.onChange = () => {};
    }

    static valid(value) {
      return value && typeof value.enabled === "boolean" &&
        typeof value.noticeShown === "boolean" &&
        Number.isFinite(value.updatedAt) && value.updatedAt >= 0;
    }

    state() { return { ...this.value, error: this.error }; }

    async load() {
      const local = (await this.localArea.get(this.key))[this.key];
      let remote;
      if (local !== undefined && !NetworkSettingsStore.valid(local)) {
        this.error = "로컬 네트워크 설정이 올바르지 않습니다.";
        return;
      }
      try {
        remote = (await this.syncArea.get(this.key))[this.key];
        if (remote !== undefined && !NetworkSettingsStore.valid(remote)) {
          this.error = "동기화된 네트워크 설정이 올바르지 않습니다.";
          remote = undefined;
        }
      } catch (error) {
        this.error = error.message || "네트워크 설정 동기화 실패";
      }
      const winner = remote && (!local || remote.updatedAt > local.updatedAt) ? remote : local;
      if (winner) this.value = winner;
      if (remote && winner === remote && (!local || JSON.stringify(local) !== JSON.stringify(remote))) {
        await this.localArea.set({ [this.key]: remote });
      } else if (winner && winner === local && !this.error &&
          (!remote || JSON.stringify(local) !== JSON.stringify(remote))) {
        try { await this.syncArea.set({ [this.key]: local }); }
        catch (error) { this.error = error.message || "네트워크 설정 동기화 실패"; }
      }
      this.onChange(this.state());
    }

    async setEnabled(enabled) {
      if (typeof enabled !== "boolean") throw new Error("네트워크 설정이 올바르지 않습니다.");
      const next = { enabled, noticeShown: this.value.noticeShown || enabled,
        updatedAt: Math.max(Date.now(), this.value.updatedAt + 1) };
      await this.localArea.set({ [this.key]: next });
      this.value = next;
      this.onChange(this.state());
      try {
        await this.syncArea.set({ [this.key]: next });
        this.error = null;
      } catch (error) {
        this.error = error.message || "네트워크 설정 동기화 실패";
      }
      return this.state();
    }

    applyChanges(changes, areaName) {
      const incoming = changes[this.key]?.newValue;
      if (!incoming) return false;
      if (!NetworkSettingsStore.valid(incoming)) {
        this.error = "네트워크 설정이 올바르지 않습니다.";
        return false;
      }
      if (incoming.updatedAt < this.value.updatedAt) return false;
      if (JSON.stringify(incoming) === JSON.stringify(this.value)) return false;
      this.value = incoming;
      this.onChange(this.state());
      if (areaName === "sync") this.localArea.set({ [this.key]: incoming })
        .catch((error) => { this.error = error.message || "네트워크 설정 저장 실패"; });
      return true;
    }
  }

  globalThis.GSMNetworkSettingsStore = NetworkSettingsStore;
  globalThis.GSMExperimentalSettingsStore = NetworkSettingsStore;
  if (typeof module !== "undefined") module.exports = NetworkSettingsStore;
})();
