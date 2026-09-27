(() => {
  "use strict";

  const CONVERSATION_PATH = /(?:^|\/)c\/([a-zA-Z0-9-]{8,})(?:\/|$)/;
  const PROJECT_SEGMENT = /^g-p-([a-zA-Z0-9]{12,})(?:-[^/]*)?$/;
  const ID_VALUE = /^[a-zA-Z0-9_-]{8,}$/;
  const DEBOUNCE_MS = 200;
  const CHECK_INTERVAL_MS = 30_000;
  const INITIAL_RETRY_MS = 500;
  const MAX_INITIAL_RETRIES = 10;
  const HIDDEN_ATTRIBUTE = "data-gsm-recent-hidden";
  const PROJECT_HIDDEN_ATTRIBUTE = "data-gsm-native-project-hidden";

  class ChatGPTAdapter {
    constructor({ pageWindow = window, pageDocument = document, Observer = MutationObserver } = {}) {
      this.pageWindow = pageWindow;
      this.pageDocument = pageDocument;
      this.Observer = Observer;
      this.sidebar = null;
      this.sidebarObserver = null;
      this.parentObserver = null;
      this.rootObserver = null;
      this.appearanceObserver = null;
      this.debounceTimer = null;
      this.retryTimer = null;
      this.initialRetries = 0;
      this.interval = null;
      this.onSnapshot = null;
      this.lastFingerprint = null;
      this.started = false;
      this.filterStyle = null;
      this.hiddenRows = new Set();
      this.projectHiddenRows = new Set();
      this.projectFilterStyle = null;
      this.folderRoots = new Map();
      this.projectActions = new Map();
      this.fullDragHooks = null;
      this.fullDragBindings = new Map();
      this.boundScan = () => this.scan();
      this.boundVisibilityScan = () => {
        if (this.pageDocument.visibilityState === "visible") this.scan();
      };
    }

    static parseConversationId(href, baseUrl = "https://chatgpt.com/") {
      const url = this.chatgptUrl(href, baseUrl);
      if (!url) return null;
      const match = url.pathname.match(CONVERSATION_PATH);
      return match ? match[1] : null;
    }

    static parseProjectId(href, baseUrl = "https://chatgpt.com/") {
      const url = this.chatgptUrl(href, baseUrl);
      if (!url) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] !== "g" || !segments[1]) return null;
      const match = segments[1].match(PROJECT_SEGMENT);
      return match ? `g-p-${match[1]}` : null;
    }

    static chatgptUrl(href, baseUrl) {
      try {
        const url = new URL(href, baseUrl);
        return url.protocol === "https:" && url.hostname === "chatgpt.com" ? url : null;
      } catch {
        return null;
      }
    }

    getConversationId(node) {
      if (!node || node.closest?.('[data-gsm-owned="true"]')) return null;
      const href = node.getAttribute?.("href");
      return href ? ChatGPTAdapter.parseConversationId(href, this.pageWindow.location.href) : null;
    }

    getProjectId(node) {
      if (!node || node.closest?.('[data-gsm-owned="true"]')) return null;
      const attributeId = node.getAttribute?.("data-app-action-sidebar-project-id") ||
        node.getAttribute?.("data-project-id");
      if (attributeId && ID_VALUE.test(attributeId)) return attributeId;
      const href = node.getAttribute?.("href");
      return href ? ChatGPTAdapter.parseProjectId(href, this.pageWindow.location.href) : null;
    }

    getProjects() {
      if (!this.sidebar) return [];
      const projectIds = new Set();
      const currentProjectId = this.getCurrentProject()?.projectId;
      if (currentProjectId) projectIds.add(currentProjectId);
      for (const row of this.getProjectRows()) projectIds.add(row.projectId);
      for (const chat of this.getProjectChats()) projectIds.add(chat.projectId);
      return [...projectIds].map((projectId) => ({ projectId }));
    }

    getProjectRows() {
      const section = this.findSection("Projects");
      if (!section) return [];
      const rows = [];
      const seen = new Set();
      for (const node of section.querySelectorAll('[data-app-action-sidebar-project-row]')) {
        const projectId = this.getProjectId(node);
        if (!projectId || seen.has(projectId) || !node.closest?.('[role="listitem"]')) continue;
        seen.add(projectId);
        rows.push({
          projectId,
          label: node.getAttribute("data-app-action-sidebar-project-label") || projectId,
          collapsed: node.getAttribute("data-app-action-sidebar-project-collapsed") === "true"
        });
      }
      return rows;
    }

    findProjectRow(projectId) {
      const section = this.findSection("Projects");
      if (!section) return null;
      const matches = [...section.querySelectorAll('[data-app-action-sidebar-project-row]')]
        .filter((node) => this.getProjectId(node) === projectId);
      return matches.length === 1 ? matches[0] : null;
    }

    expandProject(projectId) {
      const row = this.findProjectRow(projectId);
      if (!row) return false;
      if (row.getAttribute("data-app-action-sidebar-project-collapsed") !== "true") return false;
      row.click();
      return true;
    }

    collapseProject(projectId) {
      const row = this.findProjectRow(projectId);
      if (row?.getAttribute("data-app-action-sidebar-project-collapsed") === "false") row.click();
    }

    getProjectIcon(projectId) {
      const svg = this.findProjectRow(projectId)?.querySelector?.('[data-sidebar-project-container-id] svg');
      if (!svg) return null;
      // Only copy inert geometry, never host attributes, IDs or event handlers.
      const paths = [...svg.querySelectorAll('path')].map((path) => ({
        d: path.getAttribute('d'), fillRule: path.getAttribute('fill-rule') || 'nonzero'
      })).filter((path) => path.d);
      const size = parseFloat(this.pageWindow.getComputedStyle?.(svg).width) ||
        Number(svg.getAttribute('width')) || 16;
      return paths.length ? { viewBox: svg.getAttribute('viewBox') || '0 0 16 16', paths, size } : null;
    }

    getChatAppearance() {
      if (!this.sidebar || !this.pageWindow.getComputedStyle) return null;
      const section = this.findSection("Recents") || this.sidebar;
      const reference = [...section.querySelectorAll('a[href]')]
        .find((node) => this.getConversationId(node));
      if (!reference) return null;
      const style = this.pageWindow.getComputedStyle(reference);
      return { font: style.font, color: style.color, letterSpacing: style.letterSpacing };
    }

    mountProjectActions(render) {
      const active = new Set();
      for (const project of this.getProjectRows()) {
        const row = this.findProjectRow(project.projectId);
        const labelId = row?.getAttribute('aria-labelledby');
        const label = labelId && this.pageDocument.getElementById(labelId);
        if (!label || !row.contains(label)) continue;
        active.add(project.projectId);
        let host = this.projectActions.get(project.projectId);
        if (!host?.isConnected || host.parentElement !== label) {
          host?.remove();
          host = this.pageDocument.createElement('span');
          host.setAttribute('data-gsm-owned', 'true');
          host.setAttribute('data-gsm-project-action', project.projectId);
          // The native title row remains the drop target; the added button is not one.
          for (const type of ['click', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'contextmenu']) {
            host.addEventListener(type, (event) => event.stopPropagation());
          }
          for (const type of ['dragstart', 'dragover', 'drop']) {
            host.addEventListener(type, (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
            });
          }
          label.append(host);
          this.projectActions.set(project.projectId, host);
        }
        render(host, { ...project, icon: this.getProjectIcon(project.projectId) });
      }
      for (const [id, host] of this.projectActions) {
        if (active.has(id)) continue;
        host.remove();
        this.projectActions.delete(id);
      }
    }

    getProjectScan(projectId) {
      const row = this.findProjectRow(projectId);
      if (!row) return { state: "missing", chats: [] };
      if (row.getAttribute("data-app-action-sidebar-project-collapsed") === "true") {
        return { state: "collapsed", chats: [] };
      }
      const item = row.closest('[role="listitem"]');
      const lists = [...item.querySelectorAll('[role="list"][aria-label]')];
      if (lists.length !== 1) return { state: "loading", chats: [] };
      const links = [...lists[0].querySelectorAll('a[href]')]
        .filter((link) => !link.closest?.('[data-gsm-owned="true"]'));
      const chats = [];
      for (const link of links) {
        const conversationId = this.getConversationId(link);
        if (!conversationId || this.getProjectId(link) !== projectId) {
          return { state: "invalid", chats: [] };
        }
        chats.push({ conversationId, projectId });
      }
      return { state: chats.length ? "ready" : "empty", chats };
    }

    findSection(heading) {
      if (!this.sidebar) return null;
      const sections = [...this.sidebar.querySelectorAll("section[data-app-action-sidebar-section-heading]")]
        .filter((section) => section.getAttribute("data-app-action-sidebar-section-heading") === heading);
      return sections.length === 1 ? sections[0] : null;
    }

    getProjectChats() {
      const section = this.findSection("Projects");
      if (!section) return [];
      const chats = new Map();
      for (const list of section.querySelectorAll('[role="list"][aria-label]')) {
        const links = [...list.querySelectorAll("a[href]")];
        const projectIds = new Set(links.map((link) => this.getProjectId(link)).filter(Boolean));
        if (projectIds.size !== 1) continue;
        const projectId = [...projectIds][0];
        for (const link of links) {
          const conversationId = this.getConversationId(link);
          if (conversationId && this.getProjectId(link) === projectId) {
            chats.set(`${projectId}:${conversationId}`, {
              conversationId, projectId,
              href: link.getAttribute("href"),
              title: link.getAttribute("aria-label") || link.textContent?.trim() || "제목 없는 채팅"
            });
          }
        }
      }
      return [...chats.values()];
    }

    getProjectLists() {
      const section = this.findSection("Projects");
      if (!section) return [];
      const result = [];
      for (const list of section.querySelectorAll('[role="list"][aria-label]')) {
        const links = [...list.querySelectorAll("a[href]")]
          .filter((link) => !link.closest?.('[data-gsm-owned="true"]'));
        const projectIds = new Set(links.map((link) => this.getProjectId(link)).filter(Boolean));
        if (!links.length) {
          const rows = [...(list.closest?.('[role="listitem"]')
            ?.querySelectorAll('[data-app-action-sidebar-project-row]') ?? [])];
          if (rows.length === 1) {
            const id = this.getProjectId(rows[0]);
            if (id) projectIds.add(id);
          }
        }
        if (projectIds.size !== 1 || links.some((link) => this.getProjectId(link) !== [...projectIds][0])) continue;
        const projectId = [...projectIds][0];
        const chats = links.map((link) => {
          const conversationId = this.getConversationId(link);
          return conversationId && this.getProjectId(link) === projectId ? {
            conversationId, projectId,
            href: link.getAttribute("href"),
            title: link.getAttribute("aria-label") || link.textContent?.trim() || "제목 없는 채팅"
          } : null;
        }).filter(Boolean);
        result.push({ list, projectId, chatCount: chats.length, chats });
      }
      return result;
    }

    mountFolderViews(render) {
      const candidates = this.getProjectLists();
      const firstProject = new Map();
      const ambiguous = new Set();
      for (const { projectId, chats } of candidates) {
        for (const { conversationId } of chats) {
          const previous = firstProject.get(conversationId);
          if (previous && previous !== projectId) ambiguous.add(conversationId);
          else firstProject.set(conversationId, projectId);
        }
      }
      const active = new Set(candidates.map(({ list }) => list));
      for (const [list, root] of this.folderRoots) {
        if (active.has(list) && root.isConnected) continue;
        root.remove();
        this.folderRoots.delete(list);
      }
      for (const { list, projectId, chats } of candidates) {
        let root = this.folderRoots.get(list);
        if (!root) {
          root = this.pageDocument.createElement("div");
          root.setAttribute("data-gsm-owned", "true");
          root.setAttribute("data-gsm-folder-root", "true");
          root.setAttribute("role", "listitem");
          list.prepend(root);
          this.folderRoots.set(list, root);
        }
        try {
          const certainChats = chats.filter((chat) => !ambiguous.has(chat.conversationId));
          render(root, { projectId, chatCount: certainChats.length, chats: certainChats });
        } catch (error) {
          root.remove();
          this.folderRoots.delete(list);
          throw error;
        }
      }
      const hidden = new Set();
      for (const { list, projectId } of candidates) {
        const root = this.folderRoots.get(list);
        if (!root?.isConnected) continue;
        for (const row of list.children ?? []) {
          if (row === root || row.getAttribute?.("role") !== "listitem") continue;
          const links = [...row.querySelectorAll("a[href]")]
            .filter((link) => !link.closest?.('[data-gsm-owned="true"]'));
          if (links.length !== 1 || this.getConversationId(links[0]) === null ||
              this.getProjectId(links[0]) !== projectId) continue;
          if (ambiguous.has(this.getConversationId(links[0]))) continue;
          hidden.add(row);
        }
      }
      this.applyProjectHiddenRows(hidden);
    }

    clearFolderViews() {
      this.clearProjectVisibility();
      for (const root of this.folderRoots.values()) root.remove();
      this.folderRoots.clear();
      for (const host of this.projectActions.values()) host.remove();
      this.projectActions.clear();
    }

    applyProjectHiddenRows(hidden) {
      if (hidden.size && !this.projectFilterStyle) {
        const style = this.pageDocument.createElement("style");
        style.setAttribute("data-gsm-owned", "true");
        style.textContent = `[${PROJECT_HIDDEN_ATTRIBUTE}="true"] { display: none !important; }`;
        this.pageDocument.head.append(style);
        this.projectFilterStyle = style;
      }
      for (const row of this.projectHiddenRows) {
        if (!hidden.has(row)) row.removeAttribute(PROJECT_HIDDEN_ATTRIBUTE);
      }
      for (const row of hidden) row.setAttribute(PROJECT_HIDDEN_ATTRIBUTE, "true");
      this.projectHiddenRows = hidden;
      if (!hidden.size) {
        this.projectFilterStyle?.remove();
        this.projectFilterStyle = null;
      }
    }

    clearProjectVisibility() {
      for (const row of this.projectHiddenRows) row.removeAttribute(PROJECT_HIDDEN_ATTRIBUTE);
      this.projectHiddenRows.clear();
      this.projectFilterStyle?.remove();
      this.projectFilterStyle = null;
    }

    getRecentRows() {
      const section = this.findSection("Recents");
      if (!section) return null;
      const lists = [...section.querySelectorAll('[role="list"]')];
      if (lists.length !== 1) return null;
      return [...lists[0].querySelectorAll(':scope > [role="listitem"]')];
    }

    readChatLink(link) {
      const conversationId = this.getConversationId(link);
      if (!conversationId) return null;
      const projectId = this.getProjectId(link);
      if (projectId) return { conversationId, projectId, membership: "project" };
      const url = ChatGPTAdapter.chatgptUrl(link.getAttribute("href"), this.pageWindow.location.href);
      const membership = url?.pathname === `/c/${conversationId}` ? "none" : "unknown";
      return { conversationId, projectId: null, membership };
    }

    getRecentChats() {
      const rows = this.getRecentRows();
      if (!rows) return null;
      const chats = [];
      for (const row of rows) {
        const links = [...row.querySelectorAll("a[href]")]
          .map((link) => this.readChatLink(link)).filter(Boolean);
        if (links.length === 1) chats.push(links[0]);
      }
      return chats;
    }

    findNativeChatLink(conversationId, projectId) {
      const links = projectId === null ?
        (this.getRecentRows() ?? []).flatMap((row) => [...row.querySelectorAll("a[href]")]) :
        [...(this.findProjectRow(projectId)?.closest?.('[role="listitem"]')?.querySelectorAll('a[href]') ?? [])];
      const matches = links.filter((link) => {
        const chat = this.readChatLink(link);
        return chat?.conversationId === conversationId &&
          (projectId === null ? chat.membership === "none" : chat.projectId === projectId);
      });
      return matches.length === 1 ? matches[0] : null;
    }

    openConversation(conversationId, projectId) {
      const link = this.findNativeChatLink(conversationId, projectId);
      if (!link?.isConnected) return false;
      // Keep ChatGPT's router and click handlers instead of navigating a cloned anchor.
      link.click();
      return true;
    }

    nativeMembership(conversationId) {
      const projects = new Set(this.getProjectChats()
        .filter((chat) => chat.conversationId === conversationId).map((chat) => chat.projectId));
      const recent = this.getRecentChats()?.filter((chat) =>
        chat.conversationId === conversationId && chat.membership === "none") ?? [];
      if (projects.size === 1 && recent.length === 0) return { known: true, projectId: [...projects][0] };
      if (projects.size === 0 && recent.length === 1) return { known: true, projectId: null };
      return { known: false, projectId: null };
    }

    async waitForNative(check, timeoutMs = 8_000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() <= end) {
        const value = check();
        if (value) return value;
        await new Promise((resolve) => this.pageWindow.setTimeout(resolve, 150));
      }
      throw new Error("ChatGPT 원본 화면에서 이동 결과를 확인하지 못했습니다.");
    }

    exactMenuItem(menu, label) {
      const items = [...menu.querySelectorAll('[role="menuitem"]')]
        .filter((item) => item.textContent?.trim() === label);
      return items.length === 1 ? items[0] : null;
    }

    findMenuItem(label) {
      const items = [...this.pageDocument.querySelectorAll('[role="menu"]')]
        .map((menu) => this.exactMenuItem(menu, label)).filter(Boolean);
      return items.length === 1 ? items[0] : null;
    }

    async openNativeChatMenu(conversationId, projectId) {
      const source = this.findNativeChatLink(conversationId, projectId);
      const action = source?.closest?.('[role="group"]')?.querySelector?.('button[aria-label="채팅 액션"]');
      if (!action) throw new Error("ChatGPT 원본 채팅 메뉴를 찾지 못했습니다.");
      action.dispatchEvent(new this.pageWindow.PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true
      }));
      await this.waitForNative(() =>
        this.pageDocument.querySelector('[role="menu"][data-state="open"]'), 2_000);
    }

    selectNativeMenuItem(item) {
      const pointer = (type) => new this.pageWindow.PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true
      });
      item.dispatchEvent(pointer("pointerdown"));
      item.dispatchEvent(pointer("pointerup"));
      item.click();
    }

    async moveConversationViaUI(conversationId, fromProjectId, toProjectId) {
      if (this.pageDocument.querySelector?.('[role="menu"][data-state="open"]')) {
        throw new Error("열려 있는 ChatGPT 메뉴를 닫고 다시 시도해 주세요.");
      }
      const rows = this.getProjectRows();
      if (fromProjectId !== null) {
        const source = rows.find((row) => row.projectId === fromProjectId);
        if (!source || rows.filter((row) => row.label === source.label).length !== 1) {
          throw new Error("원본 프로젝트를 이름으로 안전하게 구분할 수 없습니다.");
        }
      }
      let targetLabel = null;
      if (toProjectId !== null) {
        const target = rows.find((row) => row.projectId === toProjectId);
        if (!target || rows.filter((row) => row.label === target.label).length !== 1) {
          throw new Error("대상 프로젝트를 이름으로 안전하게 구분할 수 없습니다.");
        }
        targetLabel = target.label;
      }
      await this.openNativeChatMenu(conversationId, fromProjectId);
      const operation = toProjectId === null ? "프로젝트에서 제거" : "프로젝트로 이동";
      const item = await this.waitForNative(() => this.findMenuItem(operation), 2_000);
      item.click();
      if (targetLabel !== null) {
        const targetItem = await this.waitForNative(() => this.findMenuItem(targetLabel), 2_000);
        this.selectNativeMenuItem(targetItem);
      }
      await this.waitForNative(() => {
        if (toProjectId === null) {
          return this.getRecentChats()?.some((chat) =>
            chat.conversationId === conversationId && chat.membership === "none") &&
            this.findNativeChatLink(conversationId, fromProjectId) === null;
        }
        this.expandProject(toProjectId);
        return this.getProjectScan(toProjectId).chats.some((chat) =>
          chat.conversationId === conversationId) &&
          this.findNativeChatLink(conversationId, fromProjectId) === null;
      });
      return true;
    }

    setFullDragHooks(hooks) {
      if (this.fullDragHooks === hooks) return;
      this.clearFullDragBindings();
      this.fullDragHooks = hooks;
      this.refreshFullDragBindings();
    }

    clearFullDragBindings() {
      for (const [node, binding] of this.fullDragBindings) {
        binding.controller.abort();
        if (binding.source && node.getAttribute("draggable") === "true") {
          if (binding.originalDraggable === null) node.removeAttribute("draggable");
          else node.setAttribute("draggable", binding.originalDraggable);
        }
      }
      this.fullDragBindings.clear();
    }

    bindFullDragNode(node, kind, payload, active) {
      if (!node) return;
      active.add(node);
      const key = `${kind}:${JSON.stringify(payload)}`;
      const old = this.fullDragBindings.get(node);
      if (old?.key === key) return;
      if (old) {
        old.controller.abort();
        this.fullDragBindings.delete(node);
      }
      const controller = new AbortController();
      const source = kind === "source";
      const originalDraggable = source ? node.getAttribute("draggable") : null;
      if (source) {
        node.setAttribute("draggable", "true");
        node.addEventListener("dragstart", (event) => this.fullDragHooks?.start(event, payload),
          { signal: controller.signal });
        node.addEventListener("dragend", (event) => this.fullDragHooks?.end(event),
          { signal: controller.signal });
      } else {
        node.addEventListener("dragover", (event) => this.fullDragHooks?.over(event, payload),
          { signal: controller.signal });
        node.addEventListener("drop", (event) => this.fullDragHooks?.drop(event, payload),
          { signal: controller.signal });
      }
      this.fullDragBindings.set(node, { key, controller, source, originalDraggable });
    }

    refreshFullDragBindings() {
      if (!this.fullDragHooks || !this.sidebar) {
        this.clearFullDragBindings();
        return;
      }
      const active = new Set();
      for (const { list, projectId } of this.getProjectLists()) {
        for (const link of list.querySelectorAll("a[href]")) {
          const conversationId = this.getConversationId(link);
          if (conversationId && this.getProjectId(link) === projectId) {
            this.bindFullDragNode(link, "source", { conversationId, projectId }, active);
          }
        }
      }
      for (const row of this.getRecentRows() ?? []) {
        for (const link of row.querySelectorAll("a[href]")) {
          const chat = this.readChatLink(link);
          if (chat?.membership === "none") {
            this.bindFullDragNode(link, "source", {
              conversationId: chat.conversationId, projectId: null }, active);
          }
        }
      }
      for (const row of this.getProjectRows()) {
        this.bindFullDragNode(this.findProjectRow(row.projectId), "target",
          { projectId: row.projectId, folderId: null }, active);
      }
      this.bindFullDragNode(this.findSection("Recents"), "target",
        { projectId: null, folderId: null }, active);
      for (const [node, binding] of this.fullDragBindings) {
        if (active.has(node) && node.isConnected) continue;
        binding.controller.abort();
        if (binding.source && node.getAttribute("draggable") === "true") {
          if (binding.originalDraggable === null) node.removeAttribute("draggable");
          else node.setAttribute("draggable", binding.originalDraggable);
        }
        this.fullDragBindings.delete(node);
      }
    }

    applyRecentHiddenIds(hiddenIds) {
      const rows = this.getRecentRows();
      if (!rows) {
        this.clearRecentFilter();
        return false;
      }
      const targets = new Set();
      for (const row of rows) {
        const links = [...row.querySelectorAll("a[href]")]
          .map((link) => this.readChatLink(link)).filter(Boolean);
        if (links.length === 1 && hiddenIds.has(links[0].conversationId)) targets.add(row);
      }
      if (targets.size && !this.filterStyle) {
        const style = this.pageDocument.createElement("style");
        style.setAttribute("data-gsm-owned", "true");
        style.textContent = `[${HIDDEN_ATTRIBUTE}="true"] { display: none !important; }`;
        this.pageDocument.head.append(style);
        this.filterStyle = style;
      }
      for (const row of this.hiddenRows) {
        if (!targets.has(row)) row.removeAttribute(HIDDEN_ATTRIBUTE);
      }
      for (const row of targets) row.setAttribute(HIDDEN_ATTRIBUTE, "true");
      this.hiddenRows = targets;
      if (!targets.size) {
        this.filterStyle?.remove();
        this.filterStyle = null;
      }
      return true;
    }

    clearRecentFilter() {
      for (const row of this.hiddenRows) row.removeAttribute(HIDDEN_ATTRIBUTE);
      this.hiddenRows.clear();
      this.filterStyle?.remove();
      this.filterStyle = null;
    }

    getConversationIds() {
      if (!this.sidebar) return [];
      const ids = new Set();
      for (const link of this.sidebar.querySelectorAll("a[href]")) {
        const id = this.getConversationId(link);
        if (id) ids.add(id);
      }
      return [...ids];
    }

    getCurrentProject() {
      const projectId = ChatGPTAdapter.parseProjectId(this.pageWindow.location.href);
      return projectId ? { projectId } : null;
    }

    findSidebar() {
      const candidates = [...this.pageDocument.querySelectorAll("nav, aside, [role='navigation']")]
        .filter((node) => !node.closest?.('[data-gsm-owned="true"]'))
        .filter((node) => [...node.querySelectorAll("section[data-app-action-sidebar-section-heading]")]
          .some((section) => ["Projects", "Recents"].includes(
            section.getAttribute("data-app-action-sidebar-section-heading"))))
        .filter((node) => [...node.querySelectorAll("a[href], [data-project-id], [data-app-action-sidebar-project-id]")]
          .some((link) => this.getConversationId(link) || this.getProjectId(link)));
      const innermost = candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
      return innermost.length === 1 ? innermost[0] : null;
    }

    scan() {
      if (!this.started) return;
      let snapshot;
      try {
        const sidebar = this.findSidebar();
        this.bindObservers(sidebar);
        if (sidebar) {
          this.pageWindow.clearTimeout(this.retryTimer);
          this.retryTimer = null;
          this.initialRetries = 0;
        } else if (this.initialRetries < MAX_INITIAL_RETRIES && this.retryTimer === null) {
          this.initialRetries += 1;
          this.retryTimer = this.pageWindow.setTimeout(() => {
            this.retryTimer = null;
            this.scan();
          }, INITIAL_RETRY_MS);
        }
        const appearance = sidebar ? this.getChatAppearance() : null;
        snapshot = sidebar
          ? {
              recognized: true,
              projectIds: this.getProjects().map((project) => project.projectId),
              conversationIds: this.getConversationIds(),
              currentProjectId: this.getCurrentProject()?.projectId ?? null,
              currentConversationId: ChatGPTAdapter.parseConversationId(this.pageWindow.location.href),
              recentChats: this.getRecentChats(),
              projectChats: this.getProjectChats(),
              ...(appearance ? { chatAppearance: appearance } : {})
            }
          : { recognized: false, projectIds: [], conversationIds: [], currentProjectId: null };
        this.refreshFullDragBindings();
      } catch {
        this.bindObservers(null);
        this.clearFullDragBindings();
        snapshot = { recognized: false, projectIds: [], conversationIds: [], currentProjectId: null, reason: "adapter-error" };
      }
      const fingerprint = JSON.stringify(snapshot);
      const detachedUi = [...this.folderRoots.values(), ...this.projectActions.values()]
        .some((node) => !node.isConnected);
      if (fingerprint !== this.lastFingerprint || detachedUi) {
        this.lastFingerprint = fingerprint;
        this.onSnapshot?.(snapshot);
      }
      // Refresh row bindings even when React replaced nodes without changing their IDs.
      this.onRecentSelectionRefresh?.(snapshot);
    }

    scheduleScan(mutations) {
      if (mutations?.every((mutation) => this.isOwnedMutation(mutation))) return;
      this.pageWindow.clearTimeout(this.debounceTimer);
      this.debounceTimer = this.pageWindow.setTimeout(() => this.scan(), DEBOUNCE_MS);
    }

    isOwnedMutation(mutation) {
      if (mutation.target?.closest?.('[data-gsm-owned="true"]')) return true;
      if (mutation.type !== "childList") return false;
      if ([...mutation.removedNodes].some((node) =>
        [...this.folderRoots.values(), ...this.projectActions.values()].includes(node))) return false;
      const changed = [...mutation.addedNodes, ...mutation.removedNodes];
      return changed.length > 0 && changed.every((node) =>
        node.nodeType === 1 && (node.matches?.('[data-gsm-owned="true"]') || node.closest?.('[data-gsm-owned="true"]'))
      );
    }

    bindObservers(sidebar) {
      if (sidebar === this.sidebar) return;
      this.sidebarObserver?.disconnect();
      this.parentObserver?.disconnect();
      this.sidebar = sidebar;
      this.sidebarObserver = null;
      this.parentObserver = null;
      if (!sidebar) return;
      this.sidebarObserver = new this.Observer((mutations) => this.scheduleScan(mutations));
      this.sidebarObserver.observe(sidebar, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["href", "data-project-id", "data-app-action-sidebar-project-id", "data-app-action-sidebar-project-collapsed"] });
      if (sidebar.parentElement) {
        this.parentObserver = new this.Observer((mutations) => this.scheduleScan(mutations));
        this.parentObserver.observe(sidebar.parentElement, { childList: true });
      }
    }

    observeRoot() {
      if (this.rootObserver || !this.pageDocument.documentElement) return;
      this.rootObserver = new this.Observer((mutations) => {
        const relevant = mutations.some((mutation) => {
          if (!this.sidebar && mutation.target?.closest?.('nav, aside, [role="navigation"]')) return true;
          return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
            node.nodeType === 1 &&
            (node.matches?.('nav, aside, [role="navigation"]') ||
             node.querySelector?.('nav, aside, [role="navigation"]')));
        });
        if (relevant) this.scheduleScan(mutations);
      });
      this.rootObserver.observe(this.pageDocument.documentElement,
        { childList: true, subtree: true });
      this.appearanceObserver = new this.Observer(this.boundScan);
      const options = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };
      this.appearanceObserver.observe(this.pageDocument.documentElement, options);
      if (this.pageDocument.body) this.appearanceObserver.observe(this.pageDocument.body, options);
    }

    start(onSnapshot) {
      if (this.started) return;
      this.started = true;
      this.onSnapshot = onSnapshot;
      this.pageWindow.addEventListener("popstate", this.boundScan);
      this.pageWindow.addEventListener("hashchange", this.boundScan);
      this.pageWindow.addEventListener("pageshow", this.boundScan);
      this.pageWindow.addEventListener("focus", this.boundScan);
      this.pageWindow.navigation?.addEventListener("currententrychange", this.boundScan);
      this.pageDocument.addEventListener("visibilitychange", this.boundVisibilityScan);
      this.interval = this.pageWindow.setInterval(this.boundVisibilityScan, CHECK_INTERVAL_MS);
      this.observeRoot();
      this.scan();
    }

    stop() {
      if (!this.started) return;
      this.clearRecentFilter();
      this.clearFolderViews();
      this.clearFullDragBindings();
      this.setFullDragHooks(null);
      this.started = false;
      this.pageWindow.removeEventListener("popstate", this.boundScan);
      this.pageWindow.removeEventListener("hashchange", this.boundScan);
      this.pageWindow.removeEventListener("pageshow", this.boundScan);
      this.pageWindow.removeEventListener("focus", this.boundScan);
      this.pageWindow.navigation?.removeEventListener("currententrychange", this.boundScan);
      this.pageDocument.removeEventListener("visibilitychange", this.boundVisibilityScan);
      this.pageWindow.clearInterval(this.interval);
      this.pageWindow.clearTimeout(this.debounceTimer);
      this.pageWindow.clearTimeout(this.retryTimer);
      this.sidebarObserver?.disconnect();
      this.parentObserver?.disconnect();
      this.rootObserver?.disconnect();
      this.appearanceObserver?.disconnect();
      this.sidebar = null;
      this.sidebarObserver = null;
      this.parentObserver = null;
      this.rootObserver = null;
      this.appearanceObserver = null;
      this.interval = null;
      this.debounceTimer = null;
      this.retryTimer = null;
      this.initialRetries = 0;
      this.lastFingerprint = null;
      this.onSnapshot = null;
    }
  }

  globalThis.GSMChatGPTAdapter = ChatGPTAdapter;
  if (typeof module !== "undefined") module.exports = ChatGPTAdapter;
})();
