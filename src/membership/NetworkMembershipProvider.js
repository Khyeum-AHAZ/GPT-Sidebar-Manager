(() => {
  "use strict";

  const CONTROL = "gsm.network.control.v1";
  const OBSERVATION = "gsm.network.observation.v1";
  const PROJECT = /^g-p-[a-zA-Z0-9]{12,}$/;
  const CONVERSATION = /^[a-zA-Z0-9_-]{8,}$/;

  class NetworkMembershipProvider {
    constructor(pageWindow, adapter, registry, { onMemberships = () => {} } = {}) {
      this.pageWindow = pageWindow;
      this.adapter = adapter;
      this.registry = registry;
      this.onMemberships = onMemberships;
      this.session = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      this.settingEnabled = false;
      this.available = false;
      this.temporaryCount = 0;
      this.active = false;
      this.ready = false;
      this.error = null;
      this.received = 0;
      this.lastProjectId = null;
      this.readyWaiters = [];
      this.boundMessage = (event) => this.receive(event);
      pageWindow.addEventListener("message", this.boundMessage);
    }

    state() {
      return { enabled: this.settingEnabled, active: this.active, ready: this.ready,
        kind: this.error ? "error" : this.active ? this.received ? "normal" : "waiting" :
          this.settingEnabled && !this.available ? "waiting" : "off",
        error: this.error, received: this.received, lastProjectId: this.lastProjectId };
    }

    static nonConflicting(observations, domResult) {
      const current = new Map(domResult?.observations.map((item) =>
        [item.conversationId, item.projectId]) ?? []);
      return observations.filter((item) =>
        !domResult?.conflicts.has(item.conversationId) &&
        (!current.has(item.conversationId) || current.get(item.conversationId) === item.projectId));
    }

    setEnabled(enabled) {
      if (!this.settingEnabled && enabled === true) this.error = null;
      this.settingEnabled = enabled === true;
      this.updateActive();
    }

    setAvailable(available) {
      this.available = available === true;
      this.updateActive();
    }

    beginTemporary() {
      this.error = null;
      this.temporaryCount += 1;
      this.updateActive();
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        this.temporaryCount -= 1;
        this.updateActive();
      };
    }

    updateActive() {
      const shouldRun = this.available &&
        (this.settingEnabled || this.temporaryCount > 0) && !this.error;
      if (shouldRun === this.active) return;
      this.active = shouldRun;
      this.ready = false;
      if (!shouldRun) this.resolveReady(false);
      if (shouldRun) {
        this.received = 0;
        this.lastProjectId = null;
      }
      this.pageWindow.postMessage({ type: CONTROL, session: this.session, enabled: shouldRun },
        this.pageWindow.location.origin);
    }

    receive(event) {
      if (event.source !== this.pageWindow || event.origin !== this.pageWindow.location.origin) return;
      const data = event.data;
      if (!this.active || data?.type !== OBSERVATION || data.session !== this.session) return;
      if (data.kind === "ready") {
        this.ready = true;
        this.resolveReady(true);
        return;
      }
      if (data.kind === "error") {
        this.error = "네트워크 응답 관찰을 중지했습니다.";
        this.updateActive();
        return;
      }
      if (data.kind !== "memberships" || !this.ready) return;
      try {
        if (!PROJECT.test(data.projectId || "") ||
            !Array.isArray(data.conversationIds) || data.conversationIds.length > 500 ||
            !data.conversationIds.every((id) => CONVERSATION.test(id))) return;
        if (typeof data.pathname !== "string" ||
            !data.pathname.includes("/backend-api/") ||
            !data.pathname.includes(data.projectId) ||
            !/(?:^|\/)conversations(?:\/|$)/.test(data.pathname)) return;
        if (!this.adapter.getProjectRows().some((row) => row.projectId === data.projectId)) return;
        const observations = data.conversationIds.map((conversationId) =>
          ({ conversationId, projectId: data.projectId }));
        this.onMemberships(observations);
        this.received += 1;
        this.lastProjectId = data.projectId;
      } catch {
        this.error = "네트워크 membership 처리 실패";
        this.updateActive();
      }
    }

    resolveReady(ready) {
      for (const resolve of this.readyWaiters.splice(0)) resolve(ready);
    }

    async waitReady(timeoutMs = 1500) {
      if (!this.active) return false;
      if (this.ready) return true;
      const ready = await new Promise((resolve) => {
        let timer;
        const waiter = (value) => { clearTimeout(timer); resolve(value); };
        timer = setTimeout(() => {
          this.readyWaiters = this.readyWaiters.filter((entry) => entry !== waiter);
          resolve(false);
        }, timeoutMs);
        this.readyWaiters.push(waiter);
      });
      if (!ready && this.active && !this.ready) {
        this.error = "네트워크 관찰 브리지에 연결하지 못했습니다.";
        this.updateActive();
      }
      return ready;
    }

    dispose() {
      this.settingEnabled = false;
      this.temporaryCount = 0;
      this.updateActive();
      this.pageWindow.removeEventListener("message", this.boundMessage);
    }
  }

  globalThis.GSMNetworkMembershipProvider = NetworkMembershipProvider;
  if (typeof module !== "undefined") module.exports = NetworkMembershipProvider;
})();
