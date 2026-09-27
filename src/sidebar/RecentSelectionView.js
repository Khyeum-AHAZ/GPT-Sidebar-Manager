(() => {
  "use strict";

  const CSS = `
    [data-gsm-select-row] { user-select:none; }
    [data-gsm-selected="true"] { background:var(--color-bg-primary-ghost-hover,rgba(128,128,128,.16)); border-radius:8px; }
    [data-gsm-select-toolbar] { display:flex; align-items:center; gap:6px; font:inherit; }
    [data-gsm-select-toolbar] button { font:inherit; color:inherit; background:transparent; border:0; border-radius:6px; padding:3px 6px; cursor:pointer; }
    [data-gsm-select-toolbar] button:hover { background:rgba(128,128,128,.14); }
    [data-gsm-select-toolbar] button:disabled { opacity:.4; cursor:default; }
    [data-gsm-select-toolbar] [data-delete] { color:var(--color-chart-red,#e02e2a); }
    [data-gsm-select-status] { font:inherit; font-size:12px; padding:4px 8px; overflow-wrap:anywhere; }
    [data-gsm-select-status]:empty { display:none; }
    dialog[data-gsm-batch-confirm] { position:fixed; inset:0; margin:auto; box-sizing:border-box; width:420px; max-width:92vw; max-height:90vh; overflow:auto; padding:20px; border:1px solid var(--color-border,rgba(128,128,128,.2)); border-radius:24px; background:var(--color-surface-elevated-secondary,Canvas); color:var(--color-text,CanvasText); font:inherit; font-size:16px; line-height:24px; box-shadow:0 8px 24px #0002; }
    dialog[data-gsm-batch-confirm]::backdrop { background:#0002; }
    [data-gsm-batch-confirm] h2 { font-size:18px; font-weight:600; margin:0 0 8px; }
    [data-gsm-batch-confirm] p { margin:0; color:var(--color-text-secondary,inherit); }
    [data-gsm-batch-confirm] footer { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:12px; margin-top:16px; }
    [data-gsm-batch-confirm] button { font:inherit; line-height:18px; border:1px solid var(--color-border,#8883); border-radius:9999px; padding:6px 16px; color:inherit; background:var(--color-bg-primary-soft-alpha,#8881); cursor:pointer; }
    [data-gsm-batch-confirm] [data-delete] { border-color:transparent; color:var(--color-chart-red,#e02e2a); background:color-mix(in srgb,var(--color-chart-red,#e02e2a) 10%,transparent); }
  `;

  class RecentSelectionView {
    constructor(adapter, { canEnter = () => true, onFinished = () => {}, onModeChange = () => {} } = {}) {
      this.adapter = adapter;
      this.canEnter = canEnter;
      this.onFinished = onFinished;
      this.onModeChange = onModeChange;
      this.lastMode = "NORMAL";
      this.entries = [];
      this.rows = new Map();
      this.byId = new Map();
      this.model = new globalThis.GSMMultiSelectController({ onChange: (ids) => {
        if (this.model.mode !== this.lastMode) {
          this.lastMode = this.model.mode;
          this.onModeChange();
        }
        this.paint(ids);
      } });
      this.batch = new globalThis.GSMBatchDeleteController({ adapter, onStatus: (state) => {
        if (!state.finished) {
          this.status.textContent = `${state.completed.length} / ${state.total}개 삭제 확인`;
          this.paint([]);
        }
      } });
    }
    active() { return this.model.active(); }
    busy() { return this.batch.running; }
    element(tag, text) {
      const node = this.adapter.pageDocument.createElement(tag);
      if (text !== undefined) node.textContent = text;
      return node;
    }
    button(text, action) {
      const node = this.element("button", text);
      node.type = "button";
      node.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        if (event.isTrusted) {
          try { action(); } catch (error) { this.fail(error); }
        }
      });
      return node;
    }
    mount() {
      const doc = this.adapter.pageDocument;
      this.style = this.element("style", CSS);
      this.style.setAttribute("data-gsm-owned", "true");
      doc.head.append(this.style);
      this.root = this.element("div");
      this.root.setAttribute("data-gsm-owned", "true");
      this.root.setAttribute("data-gsm-select-toolbar", "true");
      this.toggle = this.button("선택", () => {
        if (this.active()) this.cancel();
        else if (this.canEnter()) { this.status.textContent = ""; this.model.enter(); }
        else this.status.textContent = "진행 중인 이동이나 학습이 끝난 뒤 선택해 주세요.";
      });
      this.toggle.setAttribute("aria-label", "최근 채팅 선택 모드");
      this.count = this.element("span");
      this.remove = this.button("삭제", () => this.confirm());
      this.remove.setAttribute("data-delete", "true");
      this.root.append(this.toggle, this.count, this.remove);
      this.status = this.element("div");
      this.status.setAttribute("data-gsm-owned", "true");
      this.status.setAttribute("data-gsm-select-status", "true");
      this.status.setAttribute("role", "status");
      this.adapter.bindRecentSelection({
        active: () => this.active(), busy: () => this.busy(),
        idForRow: (row) => this.rows.get(row),
        down: (id, shift) => this.model.down(id, shift),
        over: (id) => this.model.over(id), up: (id) => this.model.up(id),
        click: (id, shift) => this.model.click(id, shift), cancel: () => this.cancel(),
        error: (error) => this.fail(error)
      });
    }
    refresh(snapshot) {
      if (this.failure) return;
      if (!snapshot?.recognized) { this.clear(); return; }
      if (!this.root) this.mount();
      if (!this.adapter.mountRecentSelection(this.root)) { this.clear(); return; }
      this.adapter.mountRecentSelectionStatus(this.status);
      const entries = this.adapter.recentSelectionEntries();
      if (!entries) { this.clear(); return; }
      const currentRows = new Set(entries.map((item) => item.row));
      const old = this.entries.filter((item) => !currentRows.has(item.row));
      this.adapter.paintRecentSelection(old, new Set(), false);
      this.entries = entries;
      this.rows = new Map(entries.map(({ row, id }) => [row, id]));
      this.byId = new Map(entries.map((entry) => [entry.id, entry]));
      this.model.setRows(entries.map(({ id }) => id));
      this.paint();
    }
    paint(changed = null) {
      if (!this.root) return;
      const entries = changed ? changed.map((id) => this.byId.get(id)).filter(Boolean) : this.entries;
      this.adapter.paintRecentSelection(entries, this.model.selected, this.active());
      this.toggle.textContent = this.busy() ? "중지" : this.active() ? "완료" : "선택";
      this.toggle.setAttribute("aria-pressed", String(this.active()));
      this.count.hidden = !this.active();
      this.count.textContent = `${this.model.selected.size}개`;
      this.remove.hidden = !this.active();
      this.remove.disabled = !this.model.selected.size || this.model.mode !== "SELECTING";
    }
    cancel() {
      this.dismiss?.();
      if (this.busy()) {
        this.batch.cancel();
        this.status.textContent = "중지 요청 · 진행 중인 삭제 결과를 확인합니다.";
      } else this.model.exit();
    }
    confirm() {
      if (this.model.mode !== "SELECTING" || !this.model.selected.size || this.dismiss) return;
      const ids = [...this.model.selected];
      const dialog = this.element("dialog");
      dialog.setAttribute("data-gsm-owned", "true");
      dialog.setAttribute("data-gsm-batch-confirm", "true");
      dialog.setAttribute("aria-labelledby", "gsm-batch-title");
      dialog.setAttribute("aria-describedby", "gsm-batch-description");
      const title = this.element("h2", `선택한 ${ids.length}개 채팅을 삭제할까요?`);
      title.id = "gsm-batch-title";
      const description = this.element("p", "선택한 채팅을 영구적으로 삭제합니다. 되돌릴 수 없습니다.");
      description.id = "gsm-batch-description";
      const footer = this.element("footer");
      const close = () => { dialog.close(); dialog.remove(); this.dismiss = null; this.toggle.focus(); };
      this.dismiss = close;
      const cancel = this.button("취소", close);
      const remove = this.button(`${ids.length}개 삭제`, () => {
        close();
        if (!this.canEnter()) { this.status.textContent = "다른 작업이 진행 중이어서 삭제를 시작하지 않았습니다."; return; }
        this.execute(ids).catch((error) => this.fail(error));
      });
      remove.setAttribute("data-delete", "true");
      footer.append(cancel, remove); // Observed native order: cancel, destructive action, right aligned.
      dialog.append(title, description, footer);
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
      this.adapter.pageDocument.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    }
    async execute(ids) {
      if (!this.model.beginBatch()) return;
      try {
        const result = await this.batch.run(ids);
        this.status.textContent = result.error ?
          `${result.completed.length} / ${result.total}개 삭제 확인 · 중단: ${result.error}` :
          `${result.completed.length} / ${result.total}개 삭제 확인${result.cancelled ? " · 중지됨" : " · 완료"}`;
      } finally {
        this.model.exit();
        this.onFinished();
      }
    }
    fail(error) {
      console.warn("GSM recent selection stopped:", error);
      this.clear();
      this.failure = error.message || "최근 채팅 선택 기능을 사용할 수 없습니다.";
      if (this.status) {
        this.status.textContent = this.failure;
        try { this.adapter.mountRecentSelectionStatus(this.status); } catch { /* Host UI is unavailable. */ }
      }
    }
    clear() {
      this.failure = null;
      this.dismiss?.();
      this.batch.cancel();
      this.adapter.unbindRecentSelection();
      this.adapter.paintRecentSelection(this.entries, new Set(), false);
      this.entries = [];
      this.rows.clear();
      this.byId.clear();
      this.root?.remove(); this.style?.remove(); this.status?.remove();
      this.root = null;
      if (!this.busy()) this.model.exit();
    }
  }
  globalThis.GSMRecentSelectionView = RecentSelectionView;
  if (typeof module !== "undefined") module.exports = RecentSelectionView;
})();
