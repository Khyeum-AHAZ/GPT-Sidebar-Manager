(() => {
  "use strict";

  class MultiSelectController {
    constructor({ onChange = () => {} } = {}) {
      this.onChange = onChange;
      this.mode = "NORMAL";
      this.selected = new Set();
      this.order = [];
      this.anchor = null;
      this.gesture = null;
    }

    setRows(ids) { this.order = [...new Set(ids)]; }
    active() { return this.mode !== "NORMAL"; }
    enter() { if (!this.active()) { this.mode = "SELECTING"; this.onChange(); } }
    exit() {
      this.mode = "NORMAL";
      this.selected.clear();
      this.anchor = null;
      this.gesture = null;
      this.onChange();
    }
    beginBatch() {
      if (this.mode !== "SELECTING" || !this.selected.size) return false;
      this.mode = "BATCH_DELETING";
      this.gesture = null;
      this.onChange();
      return true;
    }
    add(ids) {
      const changed = [];
      for (const id of ids) {
        if (!this.selected.has(id)) { this.selected.add(id); changed.push(id); }
      }
      if (changed.length) this.onChange(changed);
    }
    range(from, to) {
      const a = this.order.indexOf(from), b = this.order.indexOf(to);
      return a < 0 || b < 0 ? [to] : this.order.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    click(id, shift = false) {
      if (this.mode !== "SELECTING" || !this.order.includes(id)) return;
      if (shift && this.anchor && this.order.includes(this.anchor)) {
        this.add(this.range(this.anchor, id));
      } else {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.anchor = id;
        this.onChange([id]);
      }
    }
    down(id, shift = false) {
      if (this.mode !== "SELECTING" || !this.order.includes(id)) return;
      // Delay toggle until release: a sweep beginning on a selected row must not deselect it.
      this.gesture = { start: id, last: id, shift, swept: false };
    }
    over(id) {
      const g = this.gesture;
      if (this.mode !== "SELECTING" || !g || !this.order.includes(id) || g.last === id) return;
      g.swept = true;
      this.add(this.range(g.last, id));
      g.last = id;
      this.anchor = g.start;
    }
    up(id) {
      const g = this.gesture;
      this.gesture = null;
      if (g && !g.swept && id === g.start) this.click(id, g.shift);
    }
  }

  globalThis.GSMMultiSelectController = MultiSelectController;
  if (typeof module !== "undefined") module.exports = MultiSelectController;
})();
