(() => {
  "use strict";

  const KEY = "gsm.ui.settings.v1";

  class UiSettingsStore {
    constructor(localArea) {
      this.localArea = localArea;
      this.enabled = true;
      this.error = null;
      this.onChange = () => {};
    }

    static valid(value) {
      return value && value.schemaVersion === 1 && typeof value.enabled === "boolean";
    }

    state() { return { enabled: this.enabled, error: this.error }; }

    async load() {
      try {
        const value = (await this.localArea.get(KEY))[KEY];
        if (value !== undefined) {
          if (UiSettingsStore.valid(value)) this.enabled = value.enabled;
          else this.error = "GSM 표시 설정이 올바르지 않습니다.";
        }
      } catch (error) {
        this.error = error.message || "GSM 표시 설정을 읽지 못했습니다.";
      }
      this.onChange(this.state());
      return this.state();
    }

    async setEnabled(enabled) {
      if (typeof enabled !== "boolean") throw new Error("GSM 표시 설정이 올바르지 않습니다.");
      await this.localArea.set({ [KEY]: { schemaVersion: 1, enabled } });
      this.enabled = enabled;
      this.error = null;
      this.onChange(this.state());
      return this.state();
    }

    applyChanges(changes, areaName) {
      if (areaName !== "local" || !Object.hasOwn(changes, KEY)) return false;
      const incoming = changes[KEY].newValue;
      if (incoming === undefined) {
        const changed = !this.enabled;
        this.enabled = true;
        this.error = null;
        if (changed) this.onChange(this.state());
        return changed;
      }
      if (!UiSettingsStore.valid(incoming)) {
        this.error = "GSM 표시 설정이 올바르지 않습니다.";
        return false;
      }
      if (this.enabled === incoming.enabled) return false;
      this.enabled = incoming.enabled;
      this.error = null;
      this.onChange(this.state());
      return true;
    }
  }

  globalThis.GSMUiSettingsStore = UiSettingsStore;
  if (typeof module !== "undefined") module.exports = UiSettingsStore;
})();
