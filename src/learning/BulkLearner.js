(() => {
  "use strict";

  class BulkLearner {
    constructor(adapter, registry, learningStore, scanner, networkProvider = null) {
      this.adapter = adapter;
      this.registry = registry;
      this.learningStore = learningStore;
      this.scanner = scanner;
      this.networkProvider = networkProvider;
      this.onFinished = () => {};
      this.cancelRequested = false;
      this.state = { running: false, mode: null, total: 0, completed: 0, results: [], error: null };
    }

    status() { return structuredClone(this.state); }

    start(mode) {
      if (this.state.running) throw new Error("이미 프로젝트 학습이 진행 중입니다.");
      if (!this.registry.writable) throw new Error("멤버십 캐시를 사용할 수 없습니다.");
      if (!["current", "unlearned", "all"].includes(mode)) throw new Error("학습 모드가 올바르지 않습니다.");
      const rows = this.adapter.getProjectRows();
      if (!rows.length) throw new Error("ChatGPT 프로젝트 목록을 찾지 못했습니다.");
      let targets;
      if (mode === "current") {
        const currentId = this.adapter.getCurrentProject()?.projectId;
        if (!currentId) throw new Error("현재 프로젝트 채팅을 열어 주세요.");
        targets = rows.filter((row) => row.projectId === currentId);
        if (!targets.length) throw new Error("현재 프로젝트가 사이드바에 없습니다.");
      } else {
        targets = mode === "unlearned" ? rows.filter((row) => !this.learningStore.has(row.projectId)) : rows;
      }
      this.cancelRequested = false;
      this.state = { running: true, mode, total: targets.length, completed: 0,
        results: targets.map((row) => ({ projectId: row.projectId, label: row.label,
          status: "pending", count: 0, error: null })), error: null };
      this.run(targets).catch((error) => {
        this.state.error = error.message || "프로젝트 학습에 실패했습니다.";
        this.state.running = false;
      });
      return this.status();
    }

    async run(targets) {
      let endObservation;
      try {
        try {
          endObservation = this.networkProvider?.beginTemporary();
          await this.networkProvider?.waitReady?.();
        } catch (error) {
          console.warn("GSM network observation stopped during learning:", error);
        }
        for (let index = 0; index < targets.length; index++) {
          if (this.cancelRequested) break;
          const result = this.state.results[index];
          result.status = "running";
          try {
            const chats = await this.scanner.scan(result.projectId,
              { cancelled: () => this.cancelRequested });
            if (this.cancelRequested) break;
            if (!this.registry.writable) throw new Error("멤버십 캐시를 사용할 수 없습니다.");
            await this.registry.observe(chats);
            if (!this.registry.writable) throw new Error("멤버십 캐시를 사용할 수 없습니다.");
            await this.learningStore.mark(result.projectId, chats.length);
            result.status = "success";
            result.count = chats.length;
          } catch (error) {
            result.status = this.cancelRequested ? "cancelled" : "failed";
            result.error = this.cancelRequested ? null : (error.message || "학습 실패");
          }
          this.state.completed += 1;
        }
        if (this.cancelRequested) {
          for (const result of this.state.results) {
            if (result.status === "pending" || result.status === "running") result.status = "cancelled";
          }
        }
      } finally {
        try { endObservation?.(); }
        finally {
          this.state.running = false;
          this.onFinished();
        }
      }
    }

    cancel() {
      this.cancelRequested = true;
      return this.status();
    }

    async clearCache() {
      if (this.state.running) throw new Error("학습이 끝난 뒤 캐시를 초기화해 주세요.");
      await this.registry.clear();
      await this.learningStore.clear();
      return { cleared: true };
    }
  }

  globalThis.GSMBulkLearner = BulkLearner;
  if (typeof module !== "undefined") module.exports = BulkLearner;
})();
