const test = require("node:test");
const assert = require("node:assert/strict");
const Selection = require("../src/selection/MultiSelectController.js");
const Batch = require("../src/selection/BatchDeleteController.js");
const Adapter = require("../src/adapter/ChatGPTAdapter.js");
require("../src/adapter/RecentChatAdapter.js");
const FullDrag = require("../src/drag/FullDragController.js");
const SafeDrag = require("../src/drag/SafeDragController.js");
const View = require("../src/sidebar/RecentSelectionView.js");

function selection() { const s = new Selection(); s.setRows(["a", "b", "c", "d", "e"]); s.enter(); return s; }
test("selection toggle, independent IDs, shift ranges and cleanup", () => {
  const s = selection();
  s.click("b"); s.click("e", true);
  assert.deepEqual([...s.selected], ["b", "c", "d", "e"]);
  s.click("d"); assert.equal(s.selected.has("d"), false);
  s.click("a", true); assert.equal(s.selected.has("a"), true);
  s.exit(); assert.equal(s.mode, "NORMAL"); assert.equal(s.anchor, null); assert.equal(s.selected.size, 0);
  s.click("a"); assert.equal(s.selected.size, 0);
});
test("sweep both directions including repeated traversal is add-only; click still deselects", () => {
  const s = selection(); s.click("b"); s.down("b"); s.over("e"); s.over("c"); s.up("c");
  assert.deepEqual([...s.selected], ["b", "c", "d", "e"]);
  s.down("d"); s.over("a"); s.up("a"); assert.equal(s.selected.size, 5);
  s.down("b"); s.up("b"); assert.equal(s.selected.has("b"), false);
});
test("new DOM order preserves ID selection/anchor and does not join equal titles", () => {
  const s = selection(); s.click("b");
  s.setRows(["x", "b", "same-title-1", "same-title-2"]);
  s.click("same-title-1", true);
  assert.deepEqual([...s.selected], ["b", "same-title-1"]);
  s.setRows(["same-title-2"]); s.click("same-title-2", true);
  assert.equal(s.selected.has("same-title-2"), true);
});
test("batch state ignores new gestures and restores normal afterward", () => {
  const s = selection(); s.click("a"); assert.equal(s.beginBatch(), true);
  s.down("b"); s.over("c"); s.up("c"); s.click("e");
  assert.deepEqual([...s.selected], ["a"]);
  s.exit(); assert.equal(s.active(), false);
});
test("batch awaits each verified UI deletion, snapshots queue and never runs concurrently", async () => {
  let inflight = 0, maximum = 0; const calls = [];
  const ids = ["a", "b"];
  const batch = new Batch({ adapter: { async deleteRecentConversationViaUI(id) {
    maximum = Math.max(maximum, ++inflight); calls.push(id);
    await new Promise((r) => setImmediate(r)); inflight--; return true;
  } } });
  const promise = batch.run(ids); ids.push("c");
  await assert.rejects(batch.run(["x"]), /이미/);
  const result = await promise;
  assert.equal(maximum, 1); assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(result.completed, calls); assert.equal(batch.running, false);
});
test("single delete, false success, partial failure, and stop leave remaining IDs untouched", async () => {
  for (const failure of [false, new Error("menu missing")]) {
    const calls = [];
    const batch = new Batch({ adapter: { async deleteRecentConversationViaUI(id) {
      calls.push(id); if (id === "b") { if (failure instanceof Error) throw failure; return failure; } return true;
    } } });
    const result = await batch.run(["a", "b", "c"]);
    assert.deepEqual(result.completed, ["a"]); assert.equal(result.failedId, "b");
    assert.deepEqual(calls, ["a", "b"]); assert.equal(batch.running, false);
  }
  const single = new Batch({ adapter: { deleteRecentConversationViaUI: async () => true } });
  assert.deepEqual((await single.run(["a"])).completed, ["a"]);
  const batch = new Batch({ adapter: { async deleteRecentConversationViaUI() { batch.cancel(); return true; } } });
  const result = await batch.run(["a", "b"]);
  assert.equal(result.cancelled, true); assert.deepEqual(result.completed, ["a"]);
});
test("Safe/Full Drag block before handling input in SELECT and recover in NORMAL", async () => {
  const s = selection(); let safeDrops = 0, fullMoves = 0;
  const node = () => ({ listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } });
  const source = node(), target = node();
  const safe = new SafeDrag({ canDrag: () => !s.active(), onDrop: () => safeDrops++ });
  safe.sourceNode(source, { kind: "chat", id: "a", projectId: "p" });
  safe.targetNode(target, { kind: "folder", folderId: "f", projectId: "p" });
  const event = () => ({ preventDefault() {}, stopPropagation() {}, dataTransfer: { setData() {} } });
  source.listeners.dragstart(event()); target.listeners.drop(event());
  assert.equal(safe.source, null); assert.equal(safeDrops, 0);
  const full = new FullDrag({ adapter: { setFullDragHooks() {}, nativeMembership: () => ({known:true,projectId:null}) },
    canInteract: () => !s.active() });
  full.setEnabled(true); full.execute = async () => fullMoves++;
  const from = { conversationId: "a", projectId: null }, to = { projectId: "p", folderId: null };
  full.start(event(), from); full.drop(event(), to); assert.equal(fullMoves, 0);
  s.exit(); source.listeners.dragstart(event()); target.listeners.drop(event());
  full.start(event(), from); full.drop(event(), to);
  await new Promise((r) => setImmediate(r));
  assert.equal(safeDrops, 1); assert.equal(fullMoves, 1);
});

// Minimal native UI fixture: every lookup returns current state, including replaced rows.
function nativeFixture({ missing = false, menuMissing = false, noRemoval = false,
  wrongDialog = false, moved = false, conflict = false } = {}) {
  let now = 0, stage = "idle", deleted = 0, reads = 0, lastTarget;
  const win = { location: { href: "https://chatgpt.com/" }, PointerEvent: class {}, KeyboardEvent: class {},
    setTimeout(resolve) { now += 200; resolve(); } };
  const action = { id: "action-a", dispatchEvent() { stage = "menu"; } };
  const menu = { isConnected: true, getAttribute: () => "action-a", dispatchEvent() { stage = "idle"; },
    querySelectorAll: () => menuMissing ? [] : [{ textContent: "삭제", dispatchEvent() {}, click() { stage = "dialog"; } }] };
  const dialog = { get isConnected() { return stage === "dialog"; } };
  const confirm = { isConnected: true, disabled: false, click() { deleted++; if (!noRemoval) stage = "gone"; } };
  const cancel = { isConnected: true, click() { stage = "idle"; } };
  const doc = { querySelector: () => conflict ? {} : null,
    querySelectorAll: () => stage === "menu" ? [menu] : [] };
  const adapter = new Adapter({ pageWindow: win, pageDocument: doc, Observer: class {} });
  adapter.sidebar = {};
  adapter.findSidebar = () => adapter.sidebar;
  adapter.getRecentRows = () => stage === "gone" ? [] : [{ querySelectorAll: () => [{ getAttribute: () => "/c/aaaaaaaa" }] }];
  adapter.recentDeleteTarget = () => {
    reads++; if (missing) throw new Error("missing row");
    lastTarget = { title: "same title", row: { querySelector: () => action } }; return lastTarget;
  };
  adapter.nativeDeleteDialog = () => {
    if (moved) win.location.href = "https://chatgpt.com/c/bbbbbbbb";
    return !wrongDialog && stage === "dialog" ? { dialog, confirm, cancel } : null;
  };
  const originalNow = Date.now;
  return { adapter, deleted: () => deleted, reads: () => reads,
    clock() { Date.now = () => now; }, restore() { Date.now = originalNow; } };
}
test("Adapter refinds the target after re-render, confirms once, and observes removal", async () => {
  const f = nativeFixture(); f.clock();
  try { assert.equal(await f.adapter.deleteRecentConversationViaUI("aaaaaaaa"), true);
    assert.equal(f.deleted(), 1); assert.equal(f.reads(), 3);
  } finally { f.restore(); }
});
test("Adapter rejects missing row/menu, wrong dialog, route change and menu conflicts without deleting", async () => {
  for (const options of [{missing:true},{menuMissing:true},{wrongDialog:true},{moved:true},{conflict:true}]) {
    const f = nativeFixture(options); f.clock();
    try { await assert.rejects(f.adapter.deleteRecentConversationViaUI("aaaaaaaa")); assert.equal(f.deleted(), 0); }
    finally { f.restore(); }
  }
});
test("Adapter never confirms successful deletion while native row remains", async () => {
  const f = nativeFixture({noRemoval:true}); f.clock();
  try { await assert.rejects(f.adapter.deleteRecentConversationViaUI("aaaaaaaa"), /삭제 결과/); assert.equal(f.deleted(), 1); }
  finally { f.restore(); }
});
test("Adapter cancellation before submission executes no deletion", async () => {
  const f = nativeFixture();
  await assert.rejects(f.adapter.deleteRecentConversationViaUI("aaaaaaaa", {cancelled:()=>true}), /중지/);
  assert.equal(f.deleted(), 0);
});

test("recent candidates exclude hidden, duplicate IDs and project rows while retaining custom GPT chats", () => {
  const f = nativeFixture();
  const make = (id, { hidden = false, project = false } = {}) => {
    const href = project ? `/g/g-p-aaaaaaaaaaaaaaaa/c/${id}` : `/g/custom-gpt/c/${id}`;
    const link = {getAttribute:(name)=>name === "href" ? href : name === "aria-label" ? "same title" : null,closest:()=>null};
    return {querySelectorAll:()=>[link],getAttribute:()=>hidden ? "true":null,getClientRects:()=>[{}]};
  };
  f.adapter.getRecentRows = ()=>[make("aaaaaaaa"),make("bbbbbbbb"),make("cccccccc",{hidden:true}),
    make("dddddddd",{project:true}),make("eeeeeeee"),make("eeeeeeee")];
  assert.deepEqual(f.adapter.recentSelectionEntries().map(e=>e.id),["aaaaaaaa","bbbbbbbb"]);
});
test("native dialog contract validates target description and exact destructive button", () => {
  const f = nativeFixture(); let description = "이 작업은 same title을(를) 영구적으로 삭제합니다. 되돌릴 수 없습니다.";
  const confirm = {textContent:"채팅 삭제",type:"submit"}, cancel = {textContent:"취소"};
  const dialog = {closest:()=>null,getClientRects:()=>[{}],
    getAttribute:(key)=>key === "aria-labelledby" ? "heading":"description",querySelectorAll:()=>[cancel,confirm]};
  f.adapter.pageDocument.querySelectorAll = ()=>[dialog];
  f.adapter.pageDocument.getElementById = (id)=>({textContent:id === "heading" ? "채팅을 삭제할까요?":description});
  const nativeDialog = Adapter.prototype.nativeDeleteDialog.bind(f.adapter);
  assert.equal(nativeDialog("same title").confirm,confirm);
  description = "이 작업은 other을(를) 영구적으로 삭제합니다. 되돌릴 수 없습니다.";
  assert.equal(nativeDialog("same title"),null);
});
test("delegated selection intercepts full rows only in SELECT, restores handlers, and ignores synthetic input", () => {
  const f = nativeFixture(), events = new Map(), selectedRow = {};
  f.adapter.pageWindow.addEventListener = (type,fn)=>events.set(type,fn);
  f.adapter.pageWindow.removeEventListener = (type)=>events.delete(type);
  f.adapter.sidebar = {contains:()=>true};
  const s = selection();
  f.adapter.bindRecentSelection({active:()=>s.active(),busy:()=>false,idForRow:r=>r===selectedRow ? "a":null,
    down:(...a)=>s.down(...a),over:(...a)=>s.over(...a),up:(...a)=>s.up(...a),click:(...a)=>s.click(...a),cancel:()=>s.exit(),error:e=>{throw e;}});
  const event = (trusted = true)=>({isTrusted:trusted,button:0,buttons:1,target:{closest:()=>selectedRow},
    prevented:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){}});
  events.get("pointerdown")(event()); events.get("pointerup")(event()); assert.equal(s.selected.has("a"),true);
  const click = event(); events.get("click")(click); assert.equal(click.prevented,true);
  events.get("pointerdown")(event(false)); events.get("pointerup")(event(false)); assert.equal(s.selected.has("a"),true);
  s.exit(); const normal = event(); events.get("click")(normal); assert.equal(normal.prevented,false);
  f.adapter.unbindRecentSelection(); assert.equal(events.size,0);
});

function uiFixture() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.isConnected = true; }
    setAttribute(k,v) { this.attributes[k] = v; }
    addEventListener(k,fn) { this.listeners[k] = fn; }
    append(...items) { this.children.push(...items); }
    remove() { this.isConnected = false; }
    focus() {} close() {} showModal() {}
  }
  const body = new Node("body"), head = new Node("head"); const paints = [];
  let deletes = 0;
  const adapter = { pageDocument: { head, body, createElement: (tag) => new Node(tag) },
    bindRecentSelection() {}, unbindRecentSelection() {}, mountRecentSelection:()=>true,
    mountRecentSelectionStatus() {}, recentSelectionEntries:()=>[{ id:"a", row:{}, title:"same" },{id:"b",row:{},title:"same"}],
    paintRecentSelection(entries, selected, active) { paints.push({ids:entries.map(e=>e.id),selected:[...selected],active}); },
    async deleteRecentConversationViaUI() { deletes++; return true; }
  };
  const view = new View(adapter); view.refresh({recognized:true});
  return {view,body,paints,deletes:()=>deletes};
}
test("view restores selection on replacement rows; confirmation cancel does not delete", () => {
  const {view,body,paints,deletes} = uiFixture(); view.model.enter(); view.model.click("a");
  view.refresh({recognized:true}); assert.deepEqual(paints.at(-1).selected,["a"]);
  view.confirm(); const dialog = body.children.at(-1), footer = dialog.children.at(-1);
  assert.deepEqual(footer.children.map(n=>n.textContent),["취소","1개 삭제"]);
  footer.children[0].listeners.click({isTrusted:true,preventDefault(){},stopPropagation(){}});
  assert.equal(deletes(),0); assert.equal(view.model.mode,"SELECTING");
  view.clear(); assert.equal(view.model.mode,"NORMAL");
});
test("view requires trusted confirmation and ends in NORMAL after success/partial failure", async () => {
  const {view,body,deletes} = uiFixture(); view.model.enter(); view.model.click("a"); view.model.click("b");
  view.confirm(); const confirm = body.children.at(-1).children.at(-1).children[1];
  confirm.listeners.click({isTrusted:false,preventDefault(){},stopPropagation(){}}); assert.equal(deletes(),0);
  confirm.listeners.click({isTrusted:true,preventDefault(){},stopPropagation(){}});
  await new Promise(r=>setImmediate(r));
  assert.equal(deletes(),2); assert.equal(view.model.mode,"NORMAL"); assert.match(view.status.textContent,/2 \/ 2/);
  view.model.enter(); view.model.click("a");
  view.adapter.deleteRecentConversationViaUI = async()=>{throw new Error("missing row");};
  await view.execute(["a"]); assert.equal(view.model.mode,"NORMAL"); assert.match(view.status.textContent,/중단/);
});
