(() => {
  "use strict";

  class ProjectScanner {
    constructor(adapter, { delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      pollMs = 250, timeoutMs = 10_000 } = {}) {
      this.adapter = adapter;
      this.delay = delay;
      this.pollMs = pollMs;
      this.timeoutMs = timeoutMs;
    }

    async scan(projectId, { cancelled = () => false } = {}) {
      const row = this.adapter.getProjectRows().find((candidate) => candidate.projectId === projectId);
      if (!row) throw new Error("프로젝트 행을 찾지 못했습니다.");
      const opened = this.adapter.expandProject(projectId);
      let lastIds = "";
      let stable = 0;
      let elapsed = 0;
      try {
        while (elapsed <= this.timeoutMs) {
          if (cancelled()) throw new Error("학습이 취소됐습니다.");
          const result = this.adapter.getProjectScan(projectId);
          if (result.state === "invalid" || result.state === "missing") {
            throw new Error("프로젝트 채팅 ID를 안전하게 확인하지 못했습니다.");
          }
          if (result.state === "ready") {
            const ids = JSON.stringify(result.chats.map((chat) => chat.conversationId));
            stable = ids === lastIds ? stable + 1 : 0;
            lastIds = ids;
            if (stable >= 4 && elapsed >= 1_000) return result.chats;
          } else {
            stable = 0;
            lastIds = "";
          }
          await this.delay(this.pollMs);
          elapsed += this.pollMs;
        }
        throw new Error("채팅 목록을 확인하지 못했습니다. 빈 프로젝트이거나 로딩이 끝나지 않았습니다.");
      } finally {
        if (opened) this.adapter.collapseProject(projectId);
      }
    }
  }

  globalThis.GSMProjectScanner = ProjectScanner;
  if (typeof module !== "undefined") module.exports = ProjectScanner;
})();
