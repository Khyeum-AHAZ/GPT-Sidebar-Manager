(() => {
  "use strict";

  class SafeDragController {
    constructor({ onDrop, onError = () => {}, canDrag = () => true }) {
      this.onDrop = onDrop;
      this.onError = onError;
      this.canDrag = canDrag;
      this.source = null;
      this.busy = false;
    }

    sourceNode(node, source) {
      node.draggable = this.canDrag();
      node.addEventListener("dragstart", (event) => {
        if (this.busy || !this.canDrag()) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        this.source = source;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-gsm-safe-drag", source.id);
      });
      node.addEventListener("dragend", (event) => {
        event.stopPropagation();
        this.source = null;
      });
    }

    targetNode(node, target) {
      const valid = () => this.source && !this.busy && this.canDrag() &&
        this.source.projectId === target.projectId &&
        ((this.source.kind === "chat" && (target.kind === "folder" || target.kind === "chat")) ||
         (this.source.kind === "folder" && target.kind === "folder-position")) &&
        !(this.source.kind === target.kind && this.source.id === target.id);
      node.addEventListener("dragover", (event) => {
        event.stopPropagation();
        if (!valid()) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      node.addEventListener("drop", (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!valid()) return;
        const source = this.source;
        this.source = null;
        this.busy = true;
        Promise.resolve().then(() => this.onDrop(source, target)).catch((error) => this.onError(error))
          .finally(() => { this.busy = false; });
      });
    }
  }

  globalThis.GSMSafeDragController = SafeDragController;
  if (typeof module !== "undefined") module.exports = SafeDragController;
})();
