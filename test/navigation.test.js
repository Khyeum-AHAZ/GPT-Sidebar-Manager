const test = require("node:test");
const assert = require("node:assert/strict");
const ChatGPTAdapter = require("../src/adapter/ChatGPTAdapter.js");
require("../src/drag/SafeDragController.js");
const FolderTree = require("../src/sidebar/FolderTree.js");

const PROJECT = "g-p-aaaaaaaaaaaaaaaa";
const CHAT = "12345678-1234-1234-1234-123456789abc";
const HREF = `/g/${PROJECT}/c/${CHAT}`;

function fixture({ nativeCount = 1, connected = true, adapterEnabled = true } = {}) {
  let activations = 0;
  const native = {
    isConnected: connected,
    getAttribute: (name) => name === "href" ? HREF : null,
    closest: () => null,
    click() { activations++; }
  };
  const owned = { ...native, closest: () => ({}) };
  const adapter = new ChatGPTAdapter({ pageWindow: { location: { href: "https://chatgpt.com/" } },
    pageDocument: {}, Observer: class {} });
  adapter.findProjectRow = (id) => id === PROJECT ? {
    closest: () => ({ querySelectorAll: () => [owned, ...Array(nativeCount).fill(native)] })
  } : null;
  const doc = { createElement: (tag) => ({
    tag, children: [], listeners: {},
    append(...children) { this.children.push(...children); },
    setAttribute() {},
    addEventListener(type, callback) { this.listeners[type] = callback; }
  }) };
  const tree = new FolderTree({ writable: true }, { assignmentStore: { writable: true },
    adapter: adapterEnabled ? adapter : null });
  const body = tree.renderChats(doc, PROJECT, null,
    [{ conversationId: CHAT, href: HREF, title: "Example" }]);
  return { link: body.children[0].children[0], activations: () => activations };
}

function click(link, values = {}) {
  const event = { button: 0, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...values };
  link.listeners.click?.(event);
  return event;
}

test("GSM chat activates the unique original link without navigating its replacement", () => {
  const { link, activations } = fixture();
  const event = click(link);
  assert.equal(activations(), 1);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.equal(link.href, HREF);
});

test("keyboard activation follows the original chat while modified and canceled clicks stay native", () => {
  const { link, activations } = fixture();
  assert.equal(click(link, { detail: 0 }).defaultPrevented, true);
  for (const values of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true },
    { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) {
    const event = click(link, values);
    assert.equal(event.defaultPrevented, values.defaultPrevented ?? false);
    assert.equal(event.stopped, false);
  }
  assert.equal(activations(), 1);
});

test("missing, ambiguous or detached original links preserve the ordinary URL fallback", () => {
  for (const options of [{ nativeCount: 0 }, { nativeCount: 2 }, { connected: false },
    { adapterEnabled: false }]) {
    const { link, activations } = fixture(options);
    const event = click(link);
    assert.equal(activations(), 0);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, false);
    assert.equal(link.href, HREF);
  }
});
