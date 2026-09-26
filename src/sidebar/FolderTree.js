(() => {
  "use strict";

  const PALETTE = [
    { id: "default", label: "기본", value: "currentColor" },
    { id: "red", label: "레드", value: "#ff3b30" },
    { id: "coral", label: "코랄", value: "#ff6257" },
    { id: "peach", label: "오렌지", value: "#ff7a00" },
    { id: "amber", label: "앰버", value: "#ffaa00" },
    { id: "gold", label: "골드", value: "#ffc400" },
    { id: "butter", label: "옐로", value: "#ffea00" },
    { id: "lime", label: "라임", value: "#c6ff00" },
    { id: "chartreuse", label: "연두", value: "#76e000" },
    { id: "green", label: "그린", value: "#2bd900" },
    { id: "emerald", label: "에메랄드", value: "#00cc66" },
    { id: "mint", label: "민트", value: "#00ddaa" },
    { id: "teal", label: "틸", value: "#00c9c2" },
    { id: "cyan", label: "시안", value: "#00ccff" },
    { id: "sky", label: "스카이", value: "#009dff" },
    { id: "blue", label: "블루", value: "#2979ff" },
    { id: "indigo", label: "인디고", value: "#536dfe" },
    { id: "lavender", label: "바이올렛", value: "#7c4dff" },
    { id: "purple", label: "퍼플", value: "#aa33ff" },
    { id: "magenta", label: "마젠타", value: "#e040fb" },
    { id: "rose", label: "핑크", value: "#ff4081" }
  ];
  const ACTION_CSS = `
    [data-gsm-project-action] { display: inline-flex; flex: none; margin-inline-start: 6px; }
    [data-gsm-project-action] button { display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; padding: 4px; border: 0; border-radius: 6px; cursor: pointer;
      color: inherit; background: transparent; }
    [data-gsm-project-action] button:hover { background: var(--bg-primary-ghost-hover, rgba(127,127,127,.12)); }
    [data-gsm-project-action] button:disabled { opacity: .45; cursor: default; }
    [data-gsm-project-action] svg { width: 18px; height: 18px; }
  `;
  const CSS = `
    [data-gsm-folder-root] { padding: 0 8px 4px 16px; color: inherit; font: inherit; }
    [data-gsm-folder-root] .gsm-folder-line { display: flex; align-items: center; gap: 4px;
      min-height: var(--height-token-row, 36px); border-radius: 6px; }
    [data-gsm-folder-root] button { font: inherit; color: inherit; background: transparent; border: 0; border-radius: 6px; cursor: pointer; }
    [data-gsm-folder-root] button:hover { background: var(--bg-primary-ghost-hover, rgba(127,127,127,.12)); }
    [data-gsm-folder-root] button:disabled { cursor: default; opacity: .45; }
    [data-gsm-folder-root] .gsm-folder-toggle { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
      min-height: var(--height-token-row, 36px); text-align: left; padding: 4px 6px; }
    [data-gsm-folder-root] .gsm-folder-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-gsm-folder-root] .gsm-folder-chevron { flex: none; width: 10px; font-size: .75em; }
    [data-gsm-folder-root] .gsm-folder-icon { flex: none;
      width: var(--gsm-folder-icon-size, 16px); height: var(--gsm-folder-icon-size, 16px); }
    [data-gsm-folder-root] .gsm-small-button { font-size: 12px; padding: 4px 6px; }
    [data-gsm-folder-root] .gsm-folder-body { padding: 0 0 0 48px; }
    [data-gsm-folder-root] .gsm-project-chats { min-height: 10px; padding-left: 4px; }
    [data-gsm-folder-root] .gsm-empty { padding: 4px 6px; }
    [data-gsm-folder-root] .gsm-editor { display: flex; gap: 4px; padding: 4px; }
    [data-gsm-folder-root] .gsm-editor input { min-width: 0; flex: 1; padding: 4px; border: 1px solid #8888; border-radius: 6px; background: transparent; color: inherit; font: inherit; }
    [data-gsm-folder-root] .gsm-error { padding: 4px 6px; font-size: 12px; color: #c44; }
    [data-gsm-folder-root] .gsm-chat { display: block; padding: 6px; border-radius: 6px; color: inherit;
      font: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-gsm-folder-root] .gsm-chat-row { display: flex; align-items: center; min-width: 0;
      min-height: var(--height-token-row, 36px); border-radius: 6px; }
    [data-gsm-folder-root] .gsm-chat-row:hover,
    [data-gsm-folder-root] .gsm-chat-row:has([aria-current="page"]) { background: var(--bg-primary-ghost-hover, rgba(127,127,127,.12)); }
    [data-gsm-folder-root] .gsm-chat-row .gsm-chat { flex: 1; min-width: 0; }
    [data-gsm-folder-root] .gsm-chat-menu,
    [data-gsm-folder-root] .gsm-folder-menu-trigger { flex: none; padding: 4px 6px; opacity: 0; }
    [data-gsm-folder-root] .gsm-chat-row:hover .gsm-chat-menu,
    [data-gsm-folder-root] .gsm-chat-row:focus-within .gsm-chat-menu,
    [data-gsm-folder-root] .gsm-folder-line:hover .gsm-folder-menu-trigger,
    [data-gsm-folder-root] .gsm-folder-line:focus-within .gsm-folder-menu-trigger { opacity: 1; }
    [data-gsm-folder-root] .gsm-folder-menu { position: fixed; inset: auto; margin: 0; padding: 6px;
      border: 1px solid rgba(127,127,127,.25); border-radius: 12px; box-shadow: 0 6px 24px #0002;
      background: var(--bg-primary, Canvas); color: inherit; font: inherit;
      width: 238px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; }
    [data-gsm-folder-root] .gsm-folder-menu > button { display: block; width: 100%; text-align: left; padding: 6px 8px; }
    [data-gsm-folder-root] .gsm-folder-menu > button[hidden] { display: none; }
    [data-gsm-folder-root] .gsm-palette-title { padding: 8px 8px 4px; font-size: .85em; }
    [data-gsm-folder-root] .gsm-palette { display: grid; grid-template-columns: repeat(7, 28px); gap: 3px; padding: 4px; }
    [data-gsm-folder-root] .gsm-swatch { flex: none; width: 28px; height: 28px; padding: 0;
      display: flex; align-items: center; justify-content: center; border: 1px solid transparent; }
    [data-gsm-folder-root] .gsm-swatch[aria-checked="true"] { border-color: currentColor; }
    [data-gsm-folder-root] .gsm-color-dot { display: flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border-radius: 50%; background: var(--gsm-swatch); color: #263238; font-size: 13px; }
    [data-gsm-folder-root] .gsm-swatch[data-color="default"] .gsm-color-dot { background: transparent; color: inherit; border: 1px solid currentColor; }
    [data-gsm-folder-root] .gsm-drop-end { min-height: 4px; }
    [data-gsm-folder-root] [draggable="true"] { cursor: grab; }
  `;

  class FolderTree {
    constructor(store, { assignmentStore, fullDrag = null, adapter = null,
      onChange = () => {} } = {}) {
      this.store = store;
      this.assignmentStore = assignmentStore;
      this.fullDrag = fullDrag;
      this.adapter = adapter;
      this.onChange = onChange;
      this.pending = false;
      this.error = null;
      this.editor = null;
      this.deleteConfirmation = null;
      this.projects = new Map();
      this.drag = new globalThis.GSMSafeDragController({
        canDrag: () => !this.pending && this.store.writable && this.assignmentStore.writable,
        onDrop: (source, target) => this.drop(source, target),
        onError: (error) => { this.error = error.message || "드래그 저장에 실패했습니다."; this.onChange(); }
      });
    }

    groupedChats(projectId, chats) {
      const folders = new Set(this.store.list(projectId).map((folder) => folder.folderId));
      const groups = new Map([[null, []]]);
      for (const folderId of folders) groups.set(folderId, []);
      chats.forEach((chat, index) => {
        const assignment = this.assignmentStore.get(chat.conversationId, projectId);
        const folderId = folders.has(assignment?.folderId) ? assignment.folderId : null;
        groups.get(folderId).push({ ...chat, order: assignment?.order ?? Number.MAX_SAFE_INTEGER, index });
      });
      for (const group of groups.values()) {
        group.sort((a, b) => a.order - b.order || a.index - b.index);
      }
      return groups;
    }

    async drop(source, target) {
      const project = this.projects.get(source.projectId);
      if (!project || target.projectId !== source.projectId || this.pending ||
          !this.store.writable || !this.assignmentStore.writable) return;
      const { projectId, chats } = project;
      const groups = this.groupedChats(projectId, chats);
      this.pending = true;
      try {
        if (source.kind === "folder" && target.kind === "folder-position") {
          if (!this.store.list(projectId).some((folder) => folder.folderId === source.id) ||
              (target.id !== null && !this.store.list(projectId).some((folder) => folder.folderId === target.id))) return;
          await this.store.reorder(projectId, source.id, target.id);
        } else if (source.kind === "chat") {
          if (!chats.some((chat) => chat.conversationId === source.id)) return;
          const folderId = target.folderId ?? null;
          if (folderId !== null && !groups.has(folderId)) return;
          if (target.kind === "chat" && !groups.get(folderId).some((chat) => chat.conversationId === target.id)) return;
          const ids = groups.get(folderId).map((chat) => chat.conversationId).filter((id) => id !== source.id);
          const index = target.kind === "chat" ? ids.indexOf(target.id) : ids.length;
          if (index < 0) return;
          ids.splice(index, 0, source.id);
          await this.assignmentStore.place(source.id, projectId, folderId, ids);
        }
        this.error = null;
      } finally {
        this.pending = false;
        this.onChange();
      }
    }

    renderChats(doc, projectId, folderId, chats, { direct = false, currentConversationId = null } = {}) {
      const body = this.element(doc, "div", direct ? "gsm-folder-body gsm-project-chats" : "gsm-folder-body");
      if (!chats.length && !direct) body.append(this.element(doc, "div", "gsm-empty", "채팅 없음"));
      for (const chat of chats) {
        const row = this.element(doc, "div", "gsm-chat-row");
        const link = this.element(doc, "a", "gsm-chat", chat.title);
        link.href = chat.href;
        link.setAttribute("aria-label", chat.title);
        if (chat.conversationId === currentConversationId) link.setAttribute("aria-current", "page");
        this.drag.sourceNode(link, { kind: "chat", id: chat.conversationId, projectId });
        this.fullDrag?.bindOwnedSource(link, { conversationId: chat.conversationId, projectId });
        this.drag.targetNode(link, { kind: "chat", id: chat.conversationId, folderId, projectId });
        const menu = this.element(doc, "button", "gsm-chat-menu", "···");
        menu.type = "button";
        menu.addEventListener("click", async () => {
          try {
            if (!this.adapter) throw new Error("ChatGPT Adapter를 사용할 수 없습니다.");
            await this.adapter.openNativeChatMenu(chat.conversationId, projectId);
          }
          catch (error) {
            this.error = error.message || "ChatGPT 채팅 메뉴를 열지 못했습니다.";
            this.onChange();
          }
        });
        menu.setAttribute("aria-label", `${chat.title} ChatGPT 메뉴`);
        row.append(link, menu);
        body.append(row);
      }
      this.drag.targetNode(body, { kind: "folder", folderId, projectId });
      this.fullDrag?.bindOwnedTarget(body, { projectId, folderId });
      return body;
    }

    element(doc, tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    run(action) {
      if (this.pending || !this.store.writable) return;
      this.pending = true;
      Promise.resolve().then(action)
        .then(() => { this.error = null; })
        .catch((error) => { this.error = error.message || "폴더 저장에 실패했습니다."; })
        .finally(() => { this.pending = false; this.onChange(); });
    }

    button(doc, label, className, action) {
      const button = this.element(doc, "button", className, label);
      button.type = "button";
      button.disabled = this.pending || !this.store.writable;
      button.addEventListener("click", action);
      return button;
    }

    folderIcon(doc, geometry, color = "default") {
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "gsm-folder-icon");
      svg.setAttribute("viewBox", geometry?.viewBox || "0 0 16 16");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.style.color = (PALETTE.find((item) => item.id === color) || PALETTE[0]).value;
      const paths = geometry?.paths || [{ d: "M1.5 5V3.5h4L7 5h7.5v7.5h-13V5Zm0 1.5h13", outline: true }];
      for (const shape of paths) {
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", shape.d);
        path.setAttribute("fill", shape.outline ? "none" : "currentColor");
        path.setAttribute("fill-rule", shape.fillRule || "nonzero");
        if (shape.outline) {
          path.setAttribute("stroke", "currentColor");
          path.setAttribute("stroke-linejoin", "round");
        }
        svg.append(path);
      }
      return svg;
    }

    renderProjectAction(root, { projectId, label, icon }) {
      const existing = root.querySelector("button");
      if (existing) {
        existing.disabled = this.pending || !this.store.writable;
        return;
      }
      const doc = root.ownerDocument;
      const style = this.element(doc, "style");
      style.textContent = ACTION_CSS;
      const button = this.button(doc, "", "gsm-new-folder", () => {
        this.adapter.expandProject(projectId);
        this.edit(projectId);
      });
      button.setAttribute("aria-label", `${label}에 새 폴더`);
      button.title = "새 폴더";
      const svg = this.folderIcon(doc, icon);
      // A small plus distinguishes this action from the native project icon.
      const plus = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      plus.setAttribute("d", "M11 10h4m-2-2v4");
      plus.setAttribute("stroke", "currentColor");
      plus.setAttribute("stroke-width", "1.5");
      svg.append(plus);
      button.append(svg);
      root.append(style, button);
    }

    renderFolderMenu(doc, projectId, folder, line) {
      const trigger = this.button(doc, "···", "gsm-folder-menu-trigger", () => open());
      trigger.setAttribute("aria-label", `${folder.name} 폴더 메뉴`);
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      const menu = this.element(doc, "div", "gsm-folder-menu");
      menu.setAttribute("popover", "auto");
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", `${folder.name} 폴더 메뉴`);
      const close = () => menu.hidePopover();
      const open = () => {
        if (this.pending || !this.store.writable) return;
        const rect = trigger.getBoundingClientRect();
        menu.showPopover();
        const win = doc.defaultView;
        menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, win.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, win.innerHeight - menu.offsetHeight - 8))}px`;
        trigger.setAttribute("aria-expanded", "true");
        menu.querySelector("button")?.focus();
      };
      menu.addEventListener("toggle", (event) => {
        trigger.setAttribute("aria-expanded", String(event.newState === "open"));
        if (event.newState === "closed") {
          this.deleteConfirmation = null;
          remove.textContent = "삭제";
          cancel.hidden = true;
        }
      });
      line.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        open();
      });
      for (const type of ["dragstart", "dragover", "drop"]) menu.addEventListener(type, (event) => {
        event.preventDefault(); event.stopPropagation();
      });
      menu.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); trigger.focus(); return; }
        if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
        const index = buttons.indexOf(doc.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
          (index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      });
      const action = (label, callback) => {
        const button = this.button(doc, label, "", callback);
        button.setAttribute("role", "menuitem");
        return button;
      };
      menu.append(action("이름 변경", () => { close(); this.edit(projectId, folder); }));
      menu.append(this.element(doc, "div", "gsm-palette-title", "폴더 색상"));
      const palette = this.element(doc, "div", "gsm-palette");
      palette.setAttribute("role", "group");
      palette.setAttribute("aria-label", "폴더 색상");
      for (const color of PALETTE) {
        const selected = (folder.color || "default") === color.id;
        const swatch = this.button(doc, "", "gsm-swatch", () => {
          close();
          this.run(() => this.store.setColor(projectId, folder.folderId, color.id));
        });
        swatch.setAttribute("role", "menuitemradio");
        swatch.setAttribute("aria-label", color.label);
        swatch.setAttribute("aria-checked", String(selected));
        swatch.setAttribute("data-color", color.id);
        swatch.title = color.label;
        const dot = this.element(doc, "span", "gsm-color-dot", selected ? "✓" : "");
        dot.style.setProperty("--gsm-swatch", color.value);
        swatch.append(dot);
        palette.append(swatch);
      }
      menu.append(palette);
      const confirming = this.deleteConfirmation === folder.folderId;
      const remove = action(confirming ? "삭제 확인" : "삭제", () => {
        if (this.deleteConfirmation === folder.folderId) {
          close();
          this.run(async () => {
            await this.assignmentStore.clearFolder(projectId, folder.folderId);
            await this.store.remove(projectId, folder.folderId);
            this.deleteConfirmation = null;
          });
        } else {
          this.deleteConfirmation = folder.folderId;
          remove.textContent = "삭제 확인";
          cancel.hidden = false;
        }
      });
      const cancel = action("취소", () => {
        this.deleteConfirmation = null;
        remove.textContent = "삭제";
        cancel.hidden = true;
        close();
      });
      cancel.hidden = !confirming;
      menu.append(remove, cancel);
      line.append(trigger, menu);
    }

    edit(projectId, folder = null) {
      this.editor = {
        projectId,
        folderId: folder?.folderId ?? null,
        value: folder?.name ?? ""
      };
      this.deleteConfirmation = null;
      this.onChange();
    }

    renderEditor(doc, editor) {
      const form = this.element(doc, "form", "gsm-editor");
      const input = this.element(doc, "input");
      input.type = "text";
      input.maxLength = 200;
      input.value = editor.value;
      input.setAttribute("aria-label", editor.folderId ? "폴더 이름 변경" : "새 폴더 이름");
      input.addEventListener("input", () => { editor.value = input.value; });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value;
        this.run(async () => {
          if (editor.folderId) await this.store.rename(editor.projectId, editor.folderId, value);
          else await this.store.create(editor.projectId, value);
          this.editor = null;
        });
      });
      const submit = this.button(doc, "저장", "gsm-small-button", () => form.requestSubmit());
      form.append(input, submit, this.button(doc, "취소", "gsm-small-button", () => {
        this.editor = null;
        this.onChange();
      }));
      return form;
    }

    render(root, { projectId, chats = [], icon = null, appearance = null, currentConversationId = null }) {
      if (icon?.size) root.style.setProperty("--gsm-folder-icon-size", `${icon.size * .95}px`);
      if (appearance) {
        root.style.font = appearance.font;
        root.style.color = appearance.color;
        root.style.letterSpacing = appearance.letterSpacing;
      }
      if (!root.dataset.gsmDragGuard) {
        root.dataset.gsmDragGuard = "true";
        root.addEventListener("dragover", (event) => event.stopPropagation());
        root.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      }
      if (this.fullDrag?.enabled && !root.dataset.gsmFullDragTarget) {
        root.dataset.gsmFullDragTarget = "true";
        this.fullDrag.bindOwnedTarget(root, { projectId, folderId: null });
      }
      this.projects.set(projectId, { projectId, chats });
      const groups = this.groupedChats(projectId, chats);
      const doc = root.ownerDocument;
      const style = this.element(doc, "style");
      style.textContent = CSS;
      const tree = this.element(doc, "div", "gsm-tree");
      tree.setAttribute("role", "group");
      if (this.editor?.projectId === projectId && !this.editor.folderId) {
        tree.append(this.renderEditor(doc, this.editor));
      }
      for (const folder of this.store.list(projectId)) {
        const line = this.element(doc, "div", "gsm-folder-line");
        this.drag.sourceNode(line, { kind: "folder", id: folder.folderId, projectId });
        this.drag.targetNode(line, { kind: "folder-position", id: folder.folderId, folderId: folder.folderId, projectId });
        this.drag.targetNode(line, { kind: "folder", folderId: folder.folderId, projectId });
        this.fullDrag?.bindOwnedTarget(line, { projectId, folderId: folder.folderId });
        const toggle = this.button(doc, "", "gsm-folder-toggle", () =>
          this.run(() => this.store.setCollapsed(projectId, folder.folderId, !folder.collapsed)));
        toggle.setAttribute("aria-expanded", String(!folder.collapsed));
        const chevron = this.element(doc, "span", "gsm-folder-chevron", folder.collapsed ? "▸" : "▾");
        chevron.setAttribute("aria-hidden", "true");
        toggle.append(chevron, this.folderIcon(doc, icon, folder.color),
          this.element(doc, "span", "gsm-folder-name", folder.name));
        line.append(toggle);
        this.renderFolderMenu(doc, projectId, folder, line);
        tree.append(line);
        if (this.editor?.projectId === projectId && this.editor.folderId === folder.folderId) {
          tree.append(this.renderEditor(doc, this.editor));
        }
        if (!folder.collapsed) tree.append(this.renderChats(doc, projectId, folder.folderId, groups.get(folder.folderId), { currentConversationId }));
      }
      const folderEnd = this.element(doc, "div", "gsm-drop-end");
      this.drag.targetNode(folderEnd, { kind: "folder-position", id: null, projectId });
      tree.append(folderEnd);
      tree.append(this.renderChats(doc, projectId, null, groups.get(null), { direct: true, currentConversationId }));
      const children = [style, tree];
      if (this.error || !this.store.writable) {
        children.push(this.element(doc, "div", "gsm-error", this.error || "폴더 저장을 사용할 수 없습니다."));
      }
      root.replaceChildren(...children);
    }
  }

  globalThis.GSMFolderTree = FolderTree;
  if (typeof module !== "undefined") module.exports = FolderTree;
})();
