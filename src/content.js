(() => {
  "use strict";

  let learningHandler = null;
  let startupError = null;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id ||
        !["gsm.learning.", "gsm.network.", "gsm.fullDrag.", "gsm.ui."].some((prefix) =>
          message?.type?.startsWith(prefix))) return false;
    Promise.resolve().then(() => {
      if (startupError) throw startupError;
      if (!learningHandler) throw new Error("GSM 초기화 중입니다.");
      return learningHandler(message);
    }).then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "학습 명령 실패" }));
    return true;
  });

  async function start() {
    const adapter = new globalThis.GSMChatGPTAdapter();
    const provider = new globalThis.GSMDomMembershipProvider();
    const registry = new globalThis.GSMMembershipRegistry(chrome.storage.local);
    const learningStore = new globalThis.GSMLearningStore(chrome.storage.local);
    const filter = new globalThis.GSMRecentFilter(adapter, registry);
    const scanner = new globalThis.GSMProjectScanner(adapter);
    const syncStore = new globalThis.GSMSyncStore(chrome.storage.local, chrome.storage.sync);
    const networkSettings = new globalThis.GSMNetworkSettingsStore(chrome.storage.local, chrome.storage.sync);
    const fullDragSettings = new globalThis.GSMExperimentalSettingsStore(
      chrome.storage.local, chrome.storage.sync, { key: "gsm.fullDrag.settings.v1" });
    const uiSettings = new globalThis.GSMUiSettingsStore(chrome.storage.local);
    const folderStore = new globalThis.GSMFolderStore(syncStore);
    const assignmentStore = new globalThis.GSMAssignmentStore(syncStore);
    const pendingFullDragIds = new Set();
    const fullDragEpochs = new Map();
    let uiActive = false;
    const bumpFullDragEpoch = (id) =>
      fullDragEpochs.set(id, (fullDragEpochs.get(id) ?? 0) + 1);
    const currentObservations = (captured) => captured
      .filter(({ item, epoch }) => uiActive && !pendingFullDragIds.has(item.conversationId) &&
        (fullDragEpochs.get(item.conversationId) ?? 0) === epoch)
      .map(({ item }) => item);
    const captureObservations = (items) => items.map((item) => ({
      item, epoch: fullDragEpochs.get(item.conversationId) ?? 0
    }));
    let latestSnapshot = null;
    let sidebarRoot;
    const fullDrag = new globalThis.GSMFullDragController({
      adapter, registry, assignmentStore, folderStore,
      onBegin: (id) => { bumpFullDragEpoch(id); pendingFullDragIds.add(id); },
      onEnd: (id) => { bumpFullDragEpoch(id); pendingFullDragIds.delete(id); }
    });
    sidebarRoot = new globalThis.GSMSidebarRoot(adapter, folderStore, {
      assignmentStore,
      fullDrag
    });
    await uiSettings.load();
    try {
      await registry.load();
    } catch (error) {
      registry.writable = false;
      console.warn("GSM membership cache unavailable:", error);
    }
    let learningReady = true;
    try {
      await learningStore.load();
    } catch (error) {
      learningReady = false;
      console.warn("GSM learning state unavailable:", error);
    }
    let folderUiReady = true;
    try {
      await syncStore.load();
      await folderStore.load();
      await assignmentStore.load();
    } catch (error) {
      folderUiReady = false;
      console.warn("GSM folder storage unavailable:", error);
    }
    let writeQueue = Promise.resolve();
    let latestDomResult = null;
    const networkProvider = new globalThis.GSMNetworkMembershipProvider(window, adapter, registry, {
      onMemberships: (observations) => {
        if (!uiActive) return;
        const safe = globalThis.GSMNetworkMembershipProvider.nonConflicting(
          observations, latestDomResult);
        if (!safe.length) return;
        const captured = captureObservations(safe);
        writeQueue = writeQueue.then(async () => {
          const current = currentObservations(captured);
          if (!current.length) return;
          await registry.observe(current);
          if (latestSnapshot) filter.apply(provider.read(latestSnapshot));
        }).catch((error) => console.warn("GSM network membership update failed:", error));
      }
    });
    networkSettings.onChange = (state) => networkProvider.setEnabled(state.enabled && uiActive);
    try {
      await networkSettings.load();
    } catch (error) {
      console.warn("GSM network settings unavailable:", error);
    }
    fullDragSettings.onChange = (state) => {
      fullDrag.setEnabled(state.enabled && folderUiReady && uiActive);
      if (uiActive && latestSnapshot) sidebarRoot.render(latestSnapshot);
    };
    try {
      await fullDragSettings.load();
    } catch (error) {
      console.warn("GSM Full Drag settings unavailable:", error);
    }
    const learner = new globalThis.GSMBulkLearner(adapter, registry, learningStore, scanner, networkProvider);
    let manualScanBusy = false;
    syncStore.onStatusChange = () => {
      if (!folderUiReady || !latestSnapshot) return;
      try {
        sidebarRoot.render(latestSnapshot);
      } catch (error) {
        sidebarRoot.clear();
        console.warn("GSM folder UI stopped:", error);
      }
    };
    window.setInterval(() => syncStore.flush(), 30_000);
    const onSnapshot = (snapshot) => {
      if (!uiActive) return;
      latestSnapshot = snapshot;
      networkProvider.setAvailable(snapshot.recognized);
      try {
        const domResult = provider.read(snapshot);
        latestDomResult = domResult;
        filter.apply(domResult);
        if (domResult?.observations.length) {
          const observations = domResult.observations.filter((item) =>
            !pendingFullDragIds.has(item.conversationId));
          const captured = captureObservations(observations);
          writeQueue = writeQueue.then(async () => {
            const current = currentObservations(captured);
            if (!current.length) return;
            await registry.observe(current);
            if (folderUiReady) await assignmentStore.clearMoved(current);
          }).catch((error) => console.warn("GSM membership or assignment update failed:", error));
        }
      } catch (error) {
        latestDomResult = null;
        adapter.clearRecentFilter();
        console.warn("GSM recent filter stopped:", error);
      }
      if (folderUiReady) {
        try {
          sidebarRoot.render(snapshot);
        } catch (error) {
          sidebarRoot.clear();
          console.warn("GSM folder UI stopped:", error);
        }
      }
    };
    const applyUiState = () => {
      if (uiSettings.state().enabled) {
        if (uiActive) return;
        uiActive = true;
        networkProvider.setEnabled(networkSettings.state().enabled);
        fullDrag.setEnabled(fullDragSettings.state().enabled && folderUiReady);
        adapter.start(onSnapshot);
        return;
      }
      if (!uiActive) return;
      if (learner.status().running) learner.cancel();
      if (learner.status().running || fullDrag.state().busy || manualScanBusy) return;
      uiActive = false;
      latestSnapshot = null;
      latestDomResult = null;
      networkProvider.setAvailable(false);
      networkProvider.setEnabled(false);
      fullDrag.setEnabled(false);
      sidebarRoot.clear();
      adapter.stop();
    };
    uiSettings.onChange = applyUiState;
    learner.onFinished = applyUiState;
    fullDrag.onStatus = () => {
      if (!uiSettings.state().enabled && !fullDrag.state().busy) applyUiState();
    };
    applyUiState();
    chrome.storage.onChanged.addListener((changes, areaName) => {
      uiSettings.applyChanges(changes, areaName);
      networkSettings.applyChanges(changes, areaName);
      fullDragSettings.applyChanges(changes, areaName);
      syncStore.applyChanges(changes, areaName)
        .catch((error) => console.warn("GSM sync update failed:", error));
      if (areaName !== "local") return;
      learningStore.applyChanges(changes);
      if (registry.applyChanges(changes) && latestSnapshot) {
        try {
          filter.apply(provider.read(latestSnapshot));
        } catch (error) {
          adapter.clearRecentFilter();
          console.warn("GSM recent filter stopped:", error);
        }
      }
      if (folderUiReady && folderStore.applyChanges(changes) && latestSnapshot) {
        try {
          sidebarRoot.render(latestSnapshot);
        } catch (error) {
          sidebarRoot.clear();
          console.warn("GSM folder UI stopped:", error);
        }
      }
      if (folderUiReady && assignmentStore.applyChanges(changes) && latestSnapshot) {
        try {
          sidebarRoot.render(latestSnapshot);
        } catch (error) {
          sidebarRoot.clear();
          console.warn("GSM folder UI stopped:", error);
        }
      }
    });
    learningHandler = async (message) => {
      if (message.type === "gsm.ui.status") {
        return { uiSettings: uiSettings.state(), uiActive };
      }
      if (message.type === "gsm.ui.set") {
        const settings = await uiSettings.setEnabled(message.enabled);
        return { uiSettings: settings, uiActive };
      }
      if (message.type === "gsm.learning.status") {
        const state = learner.status();
        if (!learningReady) state.error = "프로젝트 학습 저장소를 사용할 수 없습니다.";
        return { state, recognized: latestSnapshot?.recognized ?? false,
          projectCount: adapter.getProjectRows().length,
          currentProjectId: adapter.getCurrentProject()?.projectId ?? null,
          network: networkProvider.state(), settings: networkSettings.state(),
          fullDrag: fullDrag.state(), fullDragSettings: fullDragSettings.state(),
          sync: syncStore.status(),
          uiSettings: uiSettings.state(), uiActive };
      }
      if (!uiSettings.state().enabled) throw new Error("GSM을 켠 뒤 사용해 주세요.");
      if (message.type === "gsm.network.status") {
        return { network: networkProvider.state(), settings: networkSettings.state() };
      }
      if (message.type === "gsm.network.set") {
        const settings = await networkSettings.setEnabled(message.enabled);
        return { network: networkProvider.state(), settings };
      }
      if (message.type === "gsm.fullDrag.set") {
        const settings = await fullDragSettings.setEnabled(message.enabled);
        return { fullDrag: fullDrag.state(), fullDragSettings: settings };
      }
      if (message.type === "gsm.fullDrag.status") {
        return { fullDrag: fullDrag.state(), fullDragSettings: fullDragSettings.state() };
      }
      if (!learningReady && message.type.startsWith("gsm.learning.")) {
        throw new Error("프로젝트 학습 저장소를 사용할 수 없습니다.");
      }
      if (message.type === "gsm.learning.start") return { state: learner.start(message.mode) };
      if (message.type === "gsm.learning.cancel") return { state: learner.cancel() };
      if (message.type === "gsm.learning.clear") {
        const result = await learner.clearCache();
        if (latestSnapshot) filter.apply(provider.read(latestSnapshot));
        return result;
      }
      if (message.type === "gsm.network.check") {
        if (learner.status().running) throw new Error("프로젝트 학습이 끝난 뒤 B를 확인해 주세요.");
        const currentId = adapter.getCurrentProject()?.projectId;
        if (!currentId) throw new Error("현재 프로젝트 채팅을 열어 주세요.");
        const endObservation = networkProvider.beginTemporary();
        manualScanBusy = true;
        const before = networkProvider.received;
        try {
          await networkProvider.waitReady();
          const chats = await scanner.scan(currentId);
          await registry.observe(chats);
          await learningStore.mark(currentId, chats.length);
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (latestSnapshot) filter.apply(provider.read(latestSnapshot));
          return { observed: networkProvider.received > before,
            domCount: chats.length, network: networkProvider.state(), settings: networkSettings.state() };
        } finally {
          try { endObservation(); }
          finally {
            manualScanBusy = false;
            applyUiState();
          }
        }
      }
      throw new Error("알 수 없는 학습 명령입니다.");
    };
  }

  start().catch((error) => {
    startupError = error;
    console.error("GSM failed to start:", error);
  });
})();
