(() => {
  "use strict";

  class FullDragController {
    constructor({ adapter, registry, assignmentStore, folderStore,
      onBegin = () => {}, onEnd = () => {}, onStatus = () => {}, canInteract = () => true }) {
      this.adapter = adapter;
      this.registry = registry;
      this.assignmentStore = assignmentStore;
      this.folderStore = folderStore;
      this.onBegin = onBegin;
      this.onEnd = onEnd;
      this.onStatus = onStatus;
      this.canInteract = canInteract;
      this.enabled = false;
      this.busy = false;
      this.source = null;
      this.error = null;
      this.needsManualRecovery = false;
      this.hooks = {
        start: (event, source) => this.start(event, source),
        end: () => this.end(),
        over: (event, target) => this.over(event, target),
        drop: (event, target) => this.drop(event, target)
      };
    }

    state() {
      return { enabled: this.enabled, busy: this.busy, error: this.error,
        needsManualRecovery: this.needsManualRecovery };
    }

    notify() { this.onStatus(this.state()); }

    setEnabled(enabled) {
      this.enabled = enabled === true;
      if (!this.enabled) this.source = null;
      this.adapter.setFullDragHooks(this.enabled ? this.hooks : null);
      this.notify();
    }

    allowed(source, target) {
      return this.canInteract() && this.enabled && !this.busy && source && target &&
        source.projectId !== target.projectId &&
        typeof source.conversationId === "string" &&
        (target.projectId !== null || target.folderId === null);
    }

    start(event, source) {
      if (!this.canInteract() || !this.enabled || this.busy) return;
      this.source = null;
      const actual = this.adapter.nativeMembership(source.conversationId);
      if (!actual.known || actual.projectId !== source.projectId) {
        return;
      }
      this.source = source;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-gsm-full-drag", source.conversationId);
    }

    end() { this.source = null; }

    over(event, target) {
      if (!this.allowed(this.source, target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
    }

    drop(event, target) {
      if (!this.allowed(this.source, target)) return;
      event.preventDefault();
      event.stopPropagation();
      const source = this.source;
      this.source = null;
      this.busy = true;
      this.notify();
      Promise.resolve().then(() => this.execute(source, target))
        .catch((error) => {
          this.error = error.message || "전체 드래그에 실패했습니다.";
          this.notify();
        }).finally(() => { this.busy = false; this.notify(); });
    }

    bindOwnedSource(node, source) {
      if (!this.enabled) return;
      node.addEventListener("dragstart", (event) => this.start(event, source));
      node.addEventListener("dragend", () => this.end());
    }

    bindOwnedTarget(node, target) {
      if (!this.enabled) return;
      node.addEventListener("dragover", (event) => this.over(event, target));
      node.addEventListener("drop", (event) => this.drop(event, target));
    }

    async commit(conversationId, target) {
      if (target.projectId !== null && target.folderId !== null) {
        if (!this.folderStore.list(target.projectId).some((folder) =>
          folder.folderId === target.folderId)) throw new Error("대상 폴더가 더 이상 없습니다.");
        const ids = this.assignmentStore.list(target.projectId, target.folderId)
          .map((record) => record.conversationId).filter((id) => id !== conversationId);
        await this.assignmentStore.place(conversationId, target.projectId, target.folderId,
          [...ids, conversationId]);
      } else {
        await this.assignmentStore.clearMoved([{ conversationId, projectId: target.projectId }]);
      }
      await this.registry.observe([{ conversationId, projectId: target.projectId }]);
      if (!this.registry.writable) throw new Error("멤버십 캐시에 기록하지 못했습니다.");
    }

    async restoreLocal(conversationId, sourceProjectId, previous) {
      if (previous && sourceProjectId !== null) {
        await this.assignmentStore.saveMany([this.assignmentStore.make(
          conversationId, sourceProjectId, previous.folderId, previous.order)]);
      } else {
        await this.assignmentStore.clearMoved([{ conversationId, projectId: sourceProjectId }]);
      }
      await this.registry.observe([{ conversationId, projectId: sourceProjectId }]);
      if (!this.registry.writable) throw new Error("멤버십 캐시 복구 실패");
    }

    readActual(conversationId) {
      try { return this.adapter.nativeMembership(conversationId); }
      catch { return { known: false, projectId: null }; }
    }

    async execute(source, target) {
      const { conversationId } = source;
      const before = this.readActual(conversationId);
      if (!before.known || before.projectId !== source.projectId) {
        throw new Error("원본 채팅 소속이 바뀌어 이동을 중지했습니다.");
      }
      if (target.projectId !== null && target.folderId !== null &&
          !this.folderStore.list(target.projectId).some((folder) =>
            folder.folderId === target.folderId)) {
        throw new Error("대상 폴더가 더 이상 없습니다.");
      }
      if (!this.assignmentStore.writable || !this.registry.writable) {
        throw new Error("로컬 분류 저장을 사용할 수 없어 이동을 시작하지 않았습니다.");
      }
      const previous = source.projectId === null ? null :
        this.assignmentStore.get(conversationId, source.projectId);
      this.onBegin(conversationId);
      let moved = false;
      try {
        await this.adapter.moveConversationViaUI(conversationId, source.projectId, target.projectId);
        moved = true;
        await this.commit(conversationId, target);
        this.error = null;
        this.needsManualRecovery = false;
      } catch (error) {
        const actual = this.readActual(conversationId);
        if (moved || (actual.known && actual.projectId === target.projectId)) {
          try {
            await this.adapter.moveConversationViaUI(conversationId, target.projectId, source.projectId);
            await this.restoreLocal(conversationId, source.projectId, previous);
            this.error = `${error.message || "이동 실패"} · 원래 프로젝트로 되돌렸습니다.`;
            this.needsManualRecovery = false;
          } catch {
            const latest = this.readActual(conversationId);
            this.error = latest.known ?
              `복구에 실패했습니다. 현재 ChatGPT 소속: ${latest.projectId ?? "최근"}. 수동 복구가 필요합니다.` :
              "복구에 실패했고 실제 ChatGPT 소속도 확인되지 않습니다. 수동 확인이 필요합니다.";
            this.needsManualRecovery = true;
          }
        } else {
          this.error = error.message || "ChatGPT 이동을 확인하지 못했습니다.";
          this.needsManualRecovery = !actual.known;
        }
      } finally {
        this.onEnd(conversationId);
        this.adapter.scan();
        this.notify();
      }
    }
  }

  globalThis.GSMFullDragController = FullDragController;
  if (typeof module !== "undefined") module.exports = FullDragController;
})();
