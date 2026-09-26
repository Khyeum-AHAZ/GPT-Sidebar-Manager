const test = require("node:test");
const assert = require("node:assert/strict");
const ChatGPTAdapter = require("../src/adapter/ChatGPTAdapter.js");

function link(href, projectId = null) {
  return {
    nodeType: 1,
    getAttribute(name) {
      if (name === "href") return href;
      if (name === "data-project-id") return projectId;
      return null;
    },
    closest() { return null; }
  };
}

function navigation(links, projectLists = []) {
  const projectSection = {
    getAttribute: () => "Projects",
    querySelectorAll: () => projectLists
  };
  return {
    parentElement: null,
    closest() { return null; },
    contains() { return false; },
    querySelectorAll(selector) {
      if (selector === 'section[data-app-action-sidebar-section-heading]') {
        return [projectSection];
      }
      return links;
    }
  };
}

function environment(navigations, url = "https://chatgpt.com/") {
  class Observer {
    observe() {}
    disconnect() {}
  }
  const pageWindow = {
    location: { href: url },
    addEventListener() {},
    removeEventListener() {},
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 2; },
    clearTimeout() {}
  };
  const pageDocument = {
    visibilityState: "visible",
    querySelectorAll() { return navigations; },
    addEventListener() {},
    removeEventListener() {}
  };
  return new ChatGPTAdapter({ pageWindow, pageDocument, Observer });
}

test("only ChatGPT URL identifiers are accepted", () => {
  const conversationId = "12345678-1234-1234-1234-123456789abc";
  assert.equal(ChatGPTAdapter.parseConversationId(`https://chatgpt.com/c/${conversationId}`), conversationId);
  assert.equal(ChatGPTAdapter.parseConversationId(`https://other.example/c/${conversationId}`), null);
  assert.equal(ChatGPTAdapter.parseConversationId("https://chatgpt.com/c/short"), null);
  assert.equal(ChatGPTAdapter.parseProjectId("https://chatgpt.com/g/g-p-1234567890abcdef-sample/project"), "g-p-1234567890abcdef");
  assert.equal(ChatGPTAdapter.parseProjectId(`https://chatgpt.com/g/g-p-1234567890abcdef/c/${conversationId}`), "g-p-1234567890abcdef");
  assert.equal(ChatGPTAdapter.parseProjectId("https://chatgpt.com/g/g-p-short-sample/project"), null);
});

test("chat typography is read from a native chat rather than the sidebar container", () => {
  const native = link('/c/12345678-1234-1234-1234-123456789abc');
  const own = { ...native, closest: () => ({}) };
  const adapter = environment([]);
  adapter.sidebar = {};
  adapter.findSection = () => ({ querySelectorAll: () => [own, native] });
  adapter.pageWindow.getComputedStyle = (node) => {
    assert.equal(node, native);
    return { font: '14px / 20px TestFont', color: 'rgb(20, 20, 20)', letterSpacing: 'normal' };
  };
  assert.deepEqual(adapter.getChatAppearance(), {
    font: '14px / 20px TestFont', color: 'rgb(20, 20, 20)', letterSpacing: 'normal'
  });
});

test("a recognized sidebar reports IDs without changing host nodes", () => {
  const project = link("/g/g-p-1234567890abcdef-sample/project");
  const conversation = link("/c/12345678-1234-1234-1234-123456789abc");
  const adapter = environment([navigation([project, conversation])], "https://chatgpt.com/g/g-p-1234567890abcdef-sample/project");
  const snapshots = [];
  adapter.start((snapshot) => snapshots.push(snapshot));
  assert.deepEqual(snapshots, [{
    recognized: true,
    projectIds: ["g-p-1234567890abcdef"],
    conversationIds: ["12345678-1234-1234-1234-123456789abc"],
    currentProjectId: "g-p-1234567890abcdef",
    currentConversationId: null,
    recentChats: null,
    projectChats: []
  }]);
  adapter.stop();
});

test("missing or ambiguous sidebar fails open with empty identifiers", () => {
  const idLink = link("/c/12345678-1234-1234-1234-123456789abc");
  for (const navigations of [[], [navigation([idLink]), navigation([idLink])]]) {
    const adapter = environment(navigations);
    const snapshots = [];
    adapter.start((snapshot) => snapshots.push(snapshot));
    assert.deepEqual(snapshots, [{ recognized: false, projectIds: [], conversationIds: [], currentProjectId: null }]);
    adapter.stop();
  }
});

test("an unrelated navigation link does not make the ChatGPT sidebar ambiguous", () => {
  const conversation = link("/c/12345678-1234-1234-1234-123456789abc");
  const unrelated = {
    closest() { return null; }, contains() { return false; },
    querySelectorAll(selector) {
      return selector === 'section[data-app-action-sidebar-section-heading]' ? [] : [conversation];
    }
  };
  const adapter = environment([navigation([conversation]), unrelated]);
  const snapshots = [];
  adapter.start((snapshot) => snapshots.push(snapshot));
  assert.equal(snapshots[0].recognized, true);
  adapter.stop();
});

test("losing a previously recognized sidebar clears the snapshot", () => {
  const idLink = link("/c/12345678-1234-1234-1234-123456789abc");
  const navigations = [navigation([idLink])];
  const adapter = environment(navigations);
  const snapshots = [];
  adapter.start((snapshot) => snapshots.push(snapshot));
  navigations.length = 0;
  adapter.scan();
  assert.equal(snapshots[0].recognized, true);
  assert.deepEqual(snapshots[1], { recognized: false, projectIds: [], conversationIds: [], currentProjectId: null });
  adapter.stop();
});

test("project IDs in Recents are not mistaken for the project list", () => {
  const recentProjectChat = link("/g/g-p-aaaaaaaaaaaaaaaa/c/12345678-1234-1234-1234-123456789abc");
  const expandedProjectChat = link("/g/g-p-bbbbbbbbbbbbbbbb/c/abcdefab-1234-1234-1234-123456789abc");
  const projectList = {
    getAttribute: () => "Example의 채팅",
    querySelectorAll: () => [expandedProjectChat]
  };
  const adapter = environment([navigation([recentProjectChat, expandedProjectChat], [projectList])]);
  const snapshots = [];
  adapter.start((snapshot) => snapshots.push(snapshot));
  assert.deepEqual(snapshots[0].projectIds, ["g-p-bbbbbbbbbbbbbbbb"]);
  adapter.stop();
});

test("owned DOM mutations do not schedule another scan", () => {
  const adapter = environment([]);
  const owned = { nodeType: 1, matches: () => true };
  adapter.scheduleScan([{ type: "childList", target: { closest: () => null }, addedNodes: [owned], removedNodes: [] }]);
  assert.equal(adapter.debounceTimer, null);
});

test("host removal of a mounted GSM root triggers another scan", () => {
  const adapter = environment([]);
  const root = { nodeType: 1, matches: () => true };
  adapter.folderRoots.set({}, root);
  const mutation = { type: "childList", target: { closest: () => null },
    addedNodes: [], removedNodes: [root] };
  assert.equal(adapter.isOwnedMutation(mutation), false);
  adapter.folderRoots.clear();
  assert.equal(adapter.isOwnedMutation(mutation), true);
});

test("a sidebar inserted after initial retries is recognized through the root observer", () => {
  const navigations = [];
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const pageWindow = {
    location: { href: "https://chatgpt.com/" },
    addEventListener() {}, removeEventListener() {},
    setInterval() { return 1; }, clearInterval() {},
    setTimeout() { return 2; }, clearTimeout() {}
  };
  const pageDocument = {
    documentElement: {}, visibilityState: "visible",
    querySelectorAll() { return navigations; },
    addEventListener() {}, removeEventListener() {}
  };
  const adapter = new ChatGPTAdapter({ pageWindow, pageDocument, Observer });
  const snapshots = [];
  adapter.scheduleScan = () => adapter.scan();
  adapter.start((snapshot) => snapshots.push(snapshot));
  adapter.initialRetries = 10;
  const sidebar = navigation([link("/c/12345678-1234-1234-1234-123456789abc")]);
  sidebar.nodeType = 1;
  sidebar.matches = () => true;
  navigations.push(sidebar);
  adapter.rootObserver.callback([{ target: {}, addedNodes: [sidebar], removedNodes: [] }]);
  assert.equal(snapshots.at(-1).recognized, true);
  assert.equal(adapter.initialRetries, 0);
  adapter.stop();
  assert.equal(adapter.rootObserver, null);
});
