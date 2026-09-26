(() => {
  "use strict";

  const CONTROL = "gsm.network.control.v1";
  const OBSERVATION = "gsm.network.observation.v1";
  const PROJECT = /^g-p-[a-zA-Z0-9]{12,}$/;
  const CONVERSATION = /^[a-zA-Z0-9_-]{8,}$/;
  const MAX_ITEMS = 500;
  let originalFetch = null;
  let fetchWrapper = null;
  let originalOpen = null;
  let originalSend = null;
  let openWrapper = null;
  let sendWrapper = null;
  let active = false;
  let session = null;
  const xhrTargets = new WeakMap();

  function target(raw) {
    try {
      const url = new URL(typeof raw === "string" ? raw : raw?.url, location.href);
      if (url.origin !== location.origin || !url.pathname.includes("/backend-api/")) return null;
      if (!/(?:^|\/)conversations(?:\/|$)/.test(url.pathname)) return null;
      const projectId = url.pathname.split("/").find((part) => PROJECT.test(part)) ||
        url.searchParams.get("project_id") || url.searchParams.get("gizmo_id");
      return PROJECT.test(projectId || "") ? { projectId, pathname: url.pathname } : null;
    } catch {
      return null;
    }
  }

  function extract(value) {
    const rows = Array.isArray(value) ? value :
      Array.isArray(value?.items) ? value.items :
        Array.isArray(value?.conversations) ? value.conversations : null;
    if (!rows || rows.length > MAX_ITEMS) return null;
    const ids = [];
    for (const row of rows) {
      const id = row?.id ?? row?.conversation_id ?? row?.conversationId;
      if (!CONVERSATION.test(id || "")) return null;
      ids.push(id);
    }
    return [...new Set(ids)];
  }

  function report(kind, payload = {}) {
    window.postMessage({ type: OBSERVATION, session, kind, ...payload }, location.origin);
  }

  function accept(info, body) {
    if (!active || !info) return;
    const ids = extract(body);
    if (ids === null) return;
    report("memberships", { projectId: info.projectId, pathname: info.pathname,
      conversationIds: ids });
  }

  function fail(error) {
    if (!active) return;
    report("error", { reason: error?.name || "bridge-error" });
    stop();
  }

  function inspectFetch(response, info) {
    if (!active || !info || !response?.ok ||
        !response.headers?.get("content-type")?.includes("json")) return;
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > 1_000_000) return;
    response.clone().json().then((body) => accept(info, body)).catch(fail);
  }

  function start() {
    if (active) { report("ready"); return; }
    active = true;
    originalFetch = window.fetch;
    const baseFetch = originalFetch;
    fetchWrapper = function (...args) {
      const info = target(args[0]);
      const result = baseFetch.apply(this, args);
      if (info) result.then((response) => inspectFetch(response, info), () => {}).catch(fail);
      return result;
    };
    window.fetch = fetchWrapper;
    originalOpen = XMLHttpRequest.prototype.open;
    originalSend = XMLHttpRequest.prototype.send;
    const baseOpen = originalOpen;
    const baseSend = originalSend;
    openWrapper = function (method, url, ...rest) {
      xhrTargets.set(this, target(url));
      return baseOpen.call(this, method, url, ...rest);
    };
    sendWrapper = function (...args) {
      const info = xhrTargets.get(this);
      if (info) this.addEventListener("loadend", () => {
        if (!active || this.status < 200 || this.status >= 300) return;
        try {
          const type = this.getResponseHeader("content-type");
          if (!type?.includes("json")) return;
          const length = Number(this.getResponseHeader("content-length"));
          if (Number.isFinite(length) && length > 1_000_000) return;
          const body = this.responseType === "json" ? this.response :
            this.responseType === "" || this.responseType === "text" ? JSON.parse(this.responseText) : null;
          if (body) accept(info, body);
        } catch (error) { fail(error); }
      }, { once: true });
      return baseSend.apply(this, args);
    };
    XMLHttpRequest.prototype.open = openWrapper;
    XMLHttpRequest.prototype.send = sendWrapper;
    report("ready");
  }

  function stop() {
    active = false;
    if (window.fetch === fetchWrapper) window.fetch = originalFetch;
    if (XMLHttpRequest.prototype.open === openWrapper) XMLHttpRequest.prototype.open = originalOpen;
    if (XMLHttpRequest.prototype.send === sendWrapper) XMLHttpRequest.prototype.send = originalSend;
    originalFetch = fetchWrapper = originalOpen = originalSend = openWrapper = sendWrapper = null;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== CONTROL) return;
    const next = event.data;
    if (typeof next.session !== "string" || !/^[a-zA-Z0-9_-]{16,}$/.test(next.session)) return;
    session = next.session;
    try {
      if (next.enabled === true) start();
      else if (next.enabled === false) stop();
    } catch (error) { fail(error); }
  });
})();
