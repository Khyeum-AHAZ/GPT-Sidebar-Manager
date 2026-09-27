(() => {
  "use strict";

  class BatchDeleteController {
    constructor({ adapter, onStatus = () => {} }) {
      this.adapter = adapter;
      this.onStatus = onStatus;
      this.running = false;
      this.cancelled = false;
    }
    cancel() { this.cancelled = true; }
    async run(ids) {
      if (this.running) throw new Error("이미 채팅 삭제가 진행 중입니다.");
      const queue = [...new Set(ids)];
      this.running = true;
      this.cancelled = false;
      const result = { total: queue.length, completed: [], failedId: null, error: null, cancelled: false };
      try {
        for (const id of queue) {
          if (this.cancelled) break;
          this.onStatus({ ...result, currentId: id });
          try {
            const verified = await this.adapter.deleteRecentConversationViaUI(id,
              { cancelled: () => this.cancelled });
            if (verified !== true) throw new Error("원본 화면에서 삭제 결과를 확인하지 못했습니다.");
            result.completed.push(id);
          } catch (error) {
            result.failedId = id;
            result.error = error.message || "채팅 삭제에 실패했습니다.";
            break;
          }
        }
        result.cancelled = this.cancelled;
        return result;
      } finally {
        this.running = false;
        this.onStatus({ ...result, finished: true });
      }
    }
  }
  globalThis.GSMBatchDeleteController = BatchDeleteController;
  if (typeof module !== "undefined") module.exports = BatchDeleteController;
})();
