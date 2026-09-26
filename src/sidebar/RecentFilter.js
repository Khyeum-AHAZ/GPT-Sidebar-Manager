(() => {
  "use strict";

  class RecentFilter {
    constructor(adapter, registry) {
      this.adapter = adapter;
      this.registry = registry;
    }

    apply(domResult) {
      if (!domResult || !domResult.recentChats) {
        this.adapter.clearRecentFilter();
        return false;
      }
      const hiddenIds = new Set();
      for (const chat of domResult.recentChats) {
        if (domResult.conflicts.has(chat.conversationId)) continue;
        if (chat.membership === "project" && chat.projectId) hiddenIds.add(chat.conversationId);
        if (chat.membership === "unknown" && this.registry.writable &&
            this.registry.getProjectId(chat.conversationId)) {
          hiddenIds.add(chat.conversationId);
        }
      }
      return this.adapter.applyRecentHiddenIds(hiddenIds);
    }
  }

  globalThis.GSMRecentFilter = RecentFilter;
  if (typeof module !== "undefined") module.exports = RecentFilter;
})();
