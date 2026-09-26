(() => {
  "use strict";

  class DomMembershipProvider {
    read(snapshot) {
      if (!snapshot.recognized) return null;
      const positive = new Map();
      const negative = new Set();
      const conflicts = new Set();
      const observePositive = (conversationId, projectId) => {
        const previous = positive.get(conversationId);
        if (previous && previous !== projectId) conflicts.add(conversationId);
        else positive.set(conversationId, projectId);
      };
      for (const chat of snapshot.projectChats) observePositive(chat.conversationId, chat.projectId);
      for (const chat of snapshot.recentChats ?? []) {
        if (chat.membership === "project") observePositive(chat.conversationId, chat.projectId);
        if (chat.membership === "none") negative.add(chat.conversationId);
      }
      if (snapshot.currentConversationId && snapshot.currentProjectId) {
        observePositive(snapshot.currentConversationId, snapshot.currentProjectId);
      }
      for (const id of negative) if (positive.has(id)) conflicts.add(id);
      const observations = [];
      for (const [conversationId, projectId] of positive) {
        if (!conflicts.has(conversationId)) observations.push({ conversationId, projectId });
      }
      for (const conversationId of negative) {
        if (!conflicts.has(conversationId)) observations.push({ conversationId, projectId: null });
      }
      return { recentChats: snapshot.recentChats, observations, conflicts };
    }
  }

  globalThis.GSMDomMembershipProvider = DomMembershipProvider;
  if (typeof module !== "undefined") module.exports = DomMembershipProvider;
})();
