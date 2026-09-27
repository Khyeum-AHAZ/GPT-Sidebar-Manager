(() => {
  "use strict";

  // Host DOM contracts verified on 2026-09-27. Keep native selectors in the Adapter layer.
  Object.assign(globalThis.GSMChatGPTAdapter.prototype, {
    recentSelectionEntries() {
      const rows = this.getRecentRows();
      if (!rows) return null;
      const entries = [];
      const counts = new Map();
      for (const row of rows) {
        const links = [...row.querySelectorAll("a[href]")].filter((link) => this.getConversationId(link));
        if (links.length !== 1) continue;
        const link = links[0], id = this.getConversationId(link);
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (row.getAttribute("data-gsm-recent-hidden") === "true" ||
            this.getProjectId(link) || !row.getClientRects().length) continue;
        const title = link.getAttribute("aria-label") || link.textContent.trim();
        entries.push({ id, row, link, title });
      }
      return entries.filter((entry) => counts.get(entry.id) === 1);
    },

    mountRecentSelection(root) {
      const section = this.findSection("Recents");
      const heading = section?.querySelector('[data-app-action-sidebar-section-toggle]');
      const header = heading?.parentElement?.parentElement?.parentElement;
      if (!header || !section.contains(header) || this.getRecentRows() === null) return false;
      if (!root.isConnected || !header.contains(root)) header.append(root);
      return true;
    },

    mountRecentSelectionStatus(node) {
      const section = this.findSection("Recents");
      const list = section?.querySelector('[role="list"]');
      if (list && (!node.isConnected || node.parentElement !== list.parentElement)) list.before(node);
    },

    paintRecentSelection(entries, selected, active, changedIds = null) {
      const changes = changedIds ? new Set(changedIds) : null;
      for (const { id, row, link, title } of entries) {
        if (changes && !changes.has(id)) continue;
        if (!active) {
          row.removeAttribute("data-gsm-select-row");
          row.removeAttribute("data-gsm-selected");
          row.querySelector('[data-gsm-selection-mark]')?.remove();
          continue;
        }
        row.setAttribute("data-gsm-select-row", "true");
        row.setAttribute("data-gsm-selected", String(selected.has(id)));
        let mark = row.querySelector('[data-gsm-selection-mark]');
        if (!mark) {
          mark = this.pageDocument.createElement("span");
          mark.setAttribute("data-gsm-owned", "true");
          mark.setAttribute("data-gsm-selection-mark", "true");
          mark.setAttribute("role", "checkbox");
          mark.style.cssText = "display:inline-flex;align-items:center;margin-inline-end:8px;pointer-events:none;flex-shrink:0";
          link.prepend(mark);
        }
        mark.textContent = selected.has(id) ? "☑" : "☐";
        mark.setAttribute("aria-label", `${title} 선택`);
        mark.setAttribute("aria-checked", String(selected.has(id)));
      }
    },

    bindRecentSelection(callbacks) {
      this.unbindRecentSelection();
      const bindings = [];
      const listen = (target, type, fn) => {
        const guarded = (event) => {
          try { fn(event); } catch (error) { callbacks.error(error); }
        };
        target.addEventListener(type, guarded, true);
        bindings.push(() => target.removeEventListener(type, guarded, true));
      };
      const stop = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
      const rowId = (target) => {
        const row = target?.closest?.('[role="listitem"]');
        return callbacks.idForRow(row);
      };
      listen(this.pageWindow, "pointerdown", (event) => {
        if (!callbacks.active() || !event.isTrusted || event.button !== 0) return;
        const id = rowId(event.target);
        if (id) { stop(event); callbacks.down(id, event.shiftKey); }
        else if (callbacks.busy() && this.sidebar?.contains(event.target) &&
            !event.target.closest?.('[data-gsm-owned="true"]')) { stop(event); callbacks.cancel(); }
      });
      listen(this.pageWindow, "pointerover", (event) => {
        if (!callbacks.active() || !event.isTrusted || !(event.buttons & 1)) return;
        const id = rowId(event.target);
        if (id) callbacks.over(id);
      });
      listen(this.pageWindow, "pointerup", (event) => {
        if (!callbacks.active() || !event.isTrusted || event.button !== 0) return;
        const id = rowId(event.target);
        if (id) stop(event);
        callbacks.up(id);
      });
      for (const type of ["click", "dblclick", "auxclick", "contextmenu"]) {
        listen(this.pageWindow, type, (event) => {
          if (!callbacks.active() || !event.isTrusted) return;
          if (rowId(event.target)) { stop(event); return; }
          if (callbacks.busy() && this.sidebar?.contains(event.target) &&
              !event.target.closest?.('[data-gsm-owned="true"]')) {
            stop(event);
            callbacks.cancel();
          }
        });
      }
      listen(this.pageWindow, "keydown", (event) => {
        if (!callbacks.active() || !event.isTrusted) return;
        const id = rowId(event.target);
        if (id && ["Enter", " "].includes(event.key)) { stop(event); callbacks.click(id, event.shiftKey); }
        if (event.key === "Escape") { stop(event); callbacks.cancel(); }
      });
      for (const type of ["dragstart", "dragover", "drop"]) {
        listen(this.pageWindow, type, (event) => {
          if (callbacks.active() && this.sidebar?.contains(event.target)) stop(event);
        });
      }
      for (const type of ["blur", "pointercancel"]) listen(this.pageWindow, type, () => callbacks.up(null));
      const navigate = () => {
        if (!callbacks.active()) return;
        if (this.deleteNavigationAllowed && new URL(this.pageWindow.location.href).pathname === "/") return;
        callbacks.cancel();
      };
      if (this.pageWindow.navigation) listen(this.pageWindow.navigation, "currententrychange", navigate);
      listen(this.pageWindow, "popstate", navigate);
      this.recentSelectionCleanup = () => bindings.forEach((dispose) => dispose());
    },
    unbindRecentSelection() {
      this.recentSelectionCleanup?.();
      this.recentSelectionCleanup = null;
    },

    recentDeleteTarget(id) {
      const matches = (this.recentSelectionEntries() ?? []).filter((entry) => entry.id === id);
      if (matches.length !== 1) throw new Error("선택한 최근 채팅 행을 찾거나 구분하지 못했습니다.");
      return matches[0];
    },
    nativeDeleteDialog(title) {
      const dialogs = [...this.pageDocument.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
        .filter((node) => !node.closest('[data-gsm-owned="true"]') && node.getClientRects().length);
      if (dialogs.length !== 1) return null;
      const dialog = dialogs[0];
      const heading = this.pageDocument.getElementById(dialog.getAttribute("aria-labelledby"));
      const description = this.pageDocument.getElementById(dialog.getAttribute("aria-describedby"));
      if (heading?.textContent.trim() !== "채팅을 삭제할까요?" ||
          description?.textContent.trim() !== `이 작업은 ${title}을(를) 영구적으로 삭제합니다. 되돌릴 수 없습니다.`) return null;
      const buttons = [...dialog.querySelectorAll("button")];
      const confirm = buttons.filter((node) => node.textContent.trim() === "채팅 삭제" && node.type === "submit");
      const cancel = buttons.filter((node) => node.textContent.trim() === "취소");
      return confirm.length === 1 && cancel.length === 1 ? { dialog, confirm: confirm[0], cancel: cancel[0] } : null;
    },

    async deleteRecentConversationViaUI(id, { cancelled = () => false } = {}) {
      const startUrl = this.pageWindow.location.href;
      let submitted = false, nativeDialog = null, ownedMenu = null;
      const ensure = () => {
        if (cancelled() && !submitted) throw new Error("삭제 작업을 중지했습니다.");
        const url = this.pageWindow.location.href;
        const deletingCurrent = globalThis.GSMChatGPTAdapter.parseConversationId(startUrl) === id;
        const expectedHome = submitted && deletingCurrent && new URL(url).pathname === "/";
        if (url !== startUrl && !expectedHome) throw new Error("화면이 이동되어 삭제를 중지했습니다.");
        const sidebar = this.findSidebar();
        if (sidebar !== this.sidebar) this.bindObservers(sidebar);
        if (!sidebar || this.getRecentRows() === null) throw new Error("최근 목록 인식이 끊겨 삭제를 중지했습니다.");
      };
      // Condition polling observes real UI transitions; timeout only bounds a failed step.
      const wait = async (check, message, timeout = 5000) => {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
          ensure();
          const value = check();
          if (value) return value;
          await new Promise((resolve) => this.pageWindow.setTimeout(resolve, 100));
        }
        throw new Error(message);
      };
      ensure();
      if (this.pageDocument.querySelector('[role="menu"][data-state="open"], [role="dialog"], [role="alertdialog"]')) {
        throw new Error("열려 있는 ChatGPT 메뉴나 확인창을 닫고 다시 시도해 주세요.");
      }
      const target = this.recentDeleteTarget(id);
      const action = target.row.querySelector('button[aria-label="채팅 액션"]');
      if (!action?.id) throw new Error("ChatGPT 원본 채팅 메뉴를 찾지 못했습니다.");
      try {
        action.dispatchEvent(new this.pageWindow.PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true
        }));
        ownedMenu = await wait(() => {
          const menus = [...this.pageDocument.querySelectorAll('[role="menu"][data-state="open"]')];
          return menus.length === 1 && menus[0].getAttribute("aria-labelledby") === action.id ? menus[0] : null;
        }, "선택한 채팅의 원본 메뉴를 확인하지 못했습니다.");
        this.recentDeleteTarget(id);
        const item = this.exactMenuItem(ownedMenu, "삭제");
        if (!item) throw new Error("원본 삭제 메뉴 항목을 찾지 못했습니다.");
        ensure();
        this.selectNativeMenuItem(item);
        nativeDialog = await wait(() => this.nativeDeleteDialog(target.title), "대상 채팅의 원본 삭제 확인창을 확인하지 못했습니다.");
        const current = this.recentDeleteTarget(id);
        if (current.title !== target.title) throw new Error("대상 채팅 정보가 변경되어 삭제를 중지했습니다.");
        ensure();
        if (!nativeDialog.confirm.isConnected || nativeDialog.confirm.disabled) throw new Error("원본 삭제 버튼을 사용할 수 없습니다.");
        submitted = true;
        this.deleteNavigationAllowed = globalThis.GSMChatGPTAdapter.parseConversationId(startUrl) === id;
        nativeDialog.confirm.click();
        let stableSince = null;
        await wait(() => {
          const rows = this.getRecentRows();
          const present = rows.some((row) => [...row.querySelectorAll("a[href]")].some((link) => this.getConversationId(link) === id));
          const closed = !nativeDialog.dialog.isConnected;
          if (present || !closed) { stableSince = null; return false; }
          stableSince ??= Date.now();
          return Date.now() - stableSince >= 700;
        }, "삭제 결과를 확인하지 못했습니다. 원본 목록을 확인해 주세요.", 10000);
        return true;
      } finally {
        this.deleteNavigationAllowed = false;
        // Only dismiss a dialog/menu opened by this operation, never an unrelated one.
        if (nativeDialog?.dialog.isConnected && nativeDialog.cancel.isConnected) nativeDialog.cancel.click();
        if (ownedMenu?.isConnected) ownedMenu.dispatchEvent(new this.pageWindow.KeyboardEvent("keydown", {
          key: "Escape", bubbles: true, cancelable: true
        }));
      }
    }
  });
})();
