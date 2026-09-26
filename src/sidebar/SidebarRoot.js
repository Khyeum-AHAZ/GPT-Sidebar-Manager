(() => {
  "use strict";

  class SidebarRoot {
    constructor(adapter, folderStore, options) {
      this.adapter = adapter;
      this.tree = new globalThis.GSMFolderTree(folderStore, {
        ...options,
        adapter,
        onChange: () => {
          try {
            this.render(this.snapshot);
          } catch (error) {
            console.warn("GSM folder UI stopped:", error);
          }
        }
      });
      this.snapshot = null;
    }

    render(snapshot) {
      this.snapshot = snapshot;
      if (!snapshot?.recognized) {
        this.adapter.clearFolderViews();
        return;
      }
      try {
        this.adapter.mountProjectActions((root, project) => this.tree.renderProjectAction(root, project));
        this.adapter.mountFolderViews((root, project) => this.tree.render(root, {
          ...project, icon: this.adapter.getProjectIcon(project.projectId),
          appearance: snapshot.chatAppearance,
          currentConversationId: snapshot.currentConversationId
        }));
      } catch (error) {
        this.adapter.clearFolderViews();
        throw error;
      }
    }

    clear() {
      this.snapshot = null;
      this.adapter.clearFolderViews();
    }
  }

  globalThis.GSMSidebarRoot = SidebarRoot;
  if (typeof module !== "undefined") module.exports = SidebarRoot;
})();
