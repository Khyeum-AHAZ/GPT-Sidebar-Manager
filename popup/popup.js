(() => {
  "use strict";

  const connection = document.getElementById("connection");
  const syncStatus = document.getElementById("sync-status");
  const progress = document.getElementById("progress");
  const results = document.getElementById("results");
  const errorText = document.getElementById("error");
  const notice = document.getElementById("notice");
  const cancel = document.getElementById("cancel");
  const clear = document.getElementById("clear");
  const gsmEnabled = document.getElementById("gsm-enabled");
  const gsmStatus = document.getElementById("gsm-status");
  const networkEnabled = document.getElementById("network-enabled");
  const networkStatus = document.getElementById("network-status");
  const networkCheck = document.getElementById("network-check");
  const fullDragEnabled = document.getElementById("full-drag-enabled");
  const fullDragStatus = document.getElementById("full-drag-status");
  const modeButtons = [...document.querySelectorAll("[data-mode]")];
  let activeTabId = null;
  let updating = false;
  let networkUpdating = false;
  let fullDragUpdating = false;
  let statusError = false;
  let lastSettings = null;
  let lastFullDragSettings = null;

  async function send(type, extra = {}) {
    if (activeTabId === null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("활성 ChatGPT 탭을 찾지 못했습니다.");
      activeTabId = tab.id;
    }
    const response = await chrome.tabs.sendMessage(activeTabId, { type, ...extra });
    if (!response?.ok) throw new Error(response?.error || "ChatGPT 탭에 연결하지 못했습니다.");
    return response;
  }

  function render(response) {
    if (response.sync) {
      const sync = response.sync;
      syncStatus.textContent = sync.kind === "error" ? `동기화 오류: ${sync.error || "저장 실패"}` :
        sync.kind === "pending" ? `동기화 대기 · ${sync.pendingCount}개` : "동기화 저장소에 기록됨";
    }
    const state = response.state;
    const uiOff = response.uiSettings?.enabled === false;
    if (response.uiSettings) {
      gsmEnabled.checked = response.uiSettings.enabled;
      gsmStatus.textContent = uiOff ?
        response.uiActive ? "GSM 표시: 끄는 중…" : "GSM 표시: 꺼짐 · 원본 목록 표시" :
        "GSM 표시: 켜짐";
      if (response.uiSettings.error) errorText.textContent = response.uiSettings.error;
    }
    if (!state) return;
    connection.textContent = uiOff ? "GSM 꺼짐 · 원본 ChatGPT 화면" : response.recognized === false ?
      "ChatGPT 사이드바 인식 대기" : `프로젝트 ${response.projectCount ?? state.total}개 확인`;
    progress.textContent = state.running ?
      `학습 중 ${state.completed} / ${state.total}` :
      state.mode ? `학습 완료 ${state.completed} / ${state.total}` : "학습 대기";
    cancel.hidden = !state.running;
    for (const button of modeButtons) button.disabled = state.running || uiOff;
    clear.disabled = state.running || uiOff;
    networkCheck.disabled = state.running || uiOff;
    networkEnabled.disabled = uiOff || networkUpdating;
    fullDragEnabled.disabled = uiOff || fullDragUpdating;
    if (response.settings) {
      lastSettings = response.settings;
      networkEnabled.checked = response.settings.enabled;
    }
    if (response.network) {
      const label = { off: "꺼짐", waiting: "관찰 대기", normal: "정상", error: "오류" };
      networkStatus.textContent = `네트워크 인식: ${label[response.network.kind] || "오류"}`;
      if (response.network.error) networkStatus.textContent += ` — ${response.network.error}`;
    }
    if (response.fullDragSettings) {
      lastFullDragSettings = response.fullDragSettings;
      fullDragEnabled.checked = response.fullDragSettings.enabled;
    }
    if (response.fullDrag) {
      fullDragStatus.textContent = response.fullDrag.error ?
        `전체 드래그: 오류 — ${response.fullDrag.error}` :
        response.fullDrag.busy ? "전체 드래그: 이동 확인 중" :
          response.fullDrag.enabled ? "전체 드래그: 켜짐" : "전체 드래그: 꺼짐";
    }
    results.replaceChildren(...state.results.map((item) => {
      const li = document.createElement("li");
      const status = item.status === "success" ? `✓ 확인한 채팅 ${item.count}개` :
        item.status === "failed" ? `실패: ${item.error}` :
          item.status === "running" ? "확인 중…" :
            item.status === "cancelled" ? "취소" : "대기";
      li.textContent = `${item.label}: ${status}`;
      return li;
    }));
    if (state.error) errorText.textContent = state.error;
  }

  async function refresh() {
    if (updating) return;
    updating = true;
    try {
      const response = await send("gsm.learning.status");
      if (statusError) errorText.textContent = "";
      statusError = false;
      render(response);
    } catch (error) {
      connection.textContent = "상태 확인 실패";
      errorText.textContent = error.message;
      statusError = true;
    } finally {
      updating = false;
    }
  }

  gsmEnabled.addEventListener("change", async () => {
    const enabled = gsmEnabled.checked;
    gsmEnabled.disabled = true;
    try {
      errorText.textContent = "";
      notice.textContent = "";
      const response = await send("gsm.ui.set", { enabled });
      gsmEnabled.checked = response.uiSettings.enabled;
      await refresh();
    } catch (error) {
      gsmEnabled.checked = !enabled;
      errorText.textContent = error.message;
    } finally {
      gsmEnabled.disabled = false;
    }
  });

  for (const button of modeButtons) button.addEventListener("click", async () => {
    try {
      errorText.textContent = "";
      notice.textContent = "";
      render(await send("gsm.learning.start", { mode: button.dataset.mode }));
    } catch (error) {
      errorText.textContent = error.message;
    }
  });
  cancel.addEventListener("click", async () => {
    try { render(await send("gsm.learning.cancel")); }
    catch (error) { errorText.textContent = error.message; }
  });
  clear.addEventListener("click", async () => {
    try {
      notice.textContent = "";
      await send("gsm.learning.clear");
      await refresh();
      notice.textContent = "학습 캐시를 초기화했습니다.";
    } catch (error) {
      errorText.textContent = error.message;
    }
  });
  networkEnabled.addEventListener("change", async () => {
    const enabled = networkEnabled.checked;
    const firstEnable = enabled && !lastSettings?.noticeShown;
    networkUpdating = true;
    networkEnabled.disabled = true;
    try {
      errorText.textContent = "";
      const response = await send("gsm.network.set", { enabled });
      networkEnabled.checked = response.settings.enabled;
      if (firstEnable && response.settings.noticeShown) {
        notice.textContent = "실험 기능입니다. ChatGPT의 기존 프로젝트 응답에서 ID만 관찰하며, 응답이 없으면 분류를 갱신하지 않습니다.";
      }
      if (response.settings.error) errorText.textContent = response.settings.error;
      await refresh();
    } catch (error) {
      networkEnabled.checked = !enabled;
      errorText.textContent = error.message;
    } finally {
      networkUpdating = false;
      networkEnabled.disabled = !gsmEnabled.checked;
    }
  });
  fullDragEnabled.addEventListener("change", async () => {
    const enabled = fullDragEnabled.checked;
    const firstEnable = enabled && !lastFullDragSettings?.noticeShown;
    fullDragUpdating = true;
    fullDragEnabled.disabled = true;
    try {
      errorText.textContent = "";
      const response = await send("gsm.fullDrag.set", { enabled });
      fullDragEnabled.checked = response.fullDragSettings.enabled;
      if (firstEnable && response.fullDragSettings.noticeShown) {
        notice.textContent = "실험 기능입니다. ChatGPT 원본 메뉴의 프로젝트 이동을 확인한 뒤 GSM 분류를 반영합니다. 복구에 실패하면 수동 확인이 필요할 수 있습니다.";
      }
      if (response.fullDragSettings.error) errorText.textContent = response.fullDragSettings.error;
      await refresh();
    } catch (error) {
      fullDragEnabled.checked = !enabled;
      errorText.textContent = error.message;
    } finally {
      fullDragUpdating = false;
      fullDragEnabled.disabled = !gsmEnabled.checked;
    }
  });
  networkCheck.addEventListener("click", async () => {
    networkCheck.disabled = true;
    notice.textContent = "현재 프로젝트를 읽고 B 응답을 기다리는 중…";
    errorText.textContent = "";
    try {
      const result = await send("gsm.network.check");
      notice.textContent = result.observed ?
        `B 응답 확인 · 현재 프로젝트 DOM 채팅 ${result.domCount}개` :
        `현재 프로젝트 DOM 채팅 ${result.domCount}개 확인 · B 응답은 발생하지 않았습니다.`;
      await refresh();
    } catch (error) {
      notice.textContent = "";
      errorText.textContent = error.message;
    } finally {
      networkCheck.disabled = !gsmEnabled.checked;
    }
  });

  refresh();
  setInterval(refresh, 500);
})();
