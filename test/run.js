// JJptt tests: plain Node, no extra packages.  npm test
//
// Loads the browser source files into this context with a few stubs, then
// checks the 真.事實查核 rules and the 連推 / 臨時黑名單 behaviour.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assert = require('assert');
var root = path.join(__dirname, '..');

global.window = global;
global.document = { addEventListener: function() {}, createElement: function() { return {}; } };
global.locale = {};
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/zh_TW_messages.js'), 'utf8'));
global.i18n = function(k) { return (locale.zh_TW[k] && locale.zh_TW[k].message) || k; };
global.$ = function() { return { length: 0 }; };
global.lib = { safeGetItem: function(k) { return global.lib.store[k] || null; },
               safeSetItem: function(k, v) { global.lib.store[k] = v; }, store: {} };
['js/string_util.js', 'js/predefined_config.js', 'js/fact_check.js', 'js/reader.js', 'js/mobile_ptt.js', 'js/mobile.js', 'js/mobile_article.js', 'js/mobile_board.js', 'js/mobile_home.js', 'js/pref.js', 'js/spam_guard.js'].forEach(function(f) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
});

var failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// ---- helpers ---------------------------------------------------------------

function push(id, minute, block) {
  var p = { id: id, tag: '推', content: id + ' ' + Math.random(), ip: '',
            time: '11/12 10:' + (minute < 10 ? '0' + minute : minute) };
  if (block !== undefined) p.block = block;
  return p;
}
function many(id, count, minute, block) {
  var out = [];
  for (var i = 0; i < count; ++i) out.push(push(id, minute, block));
  return out;
}
function article(pushes, author) {
  return { url: 'https://www.ptt.cc/bbs/Test/M.1.A.html', text: '',
           meta: { '作者': (author || 'op') + ' (nick)', '時間': 'Thu Nov 12 10:00:00 2026',
                   '標題': '[問卦] 測試', '看板': 'Test' },
           pushes: pushes };
}

// A real PttChromePref with storage / screen calls stubbed out.
function makePref(values) {
  var app = { redraws: 0, toasts: [], reader: null };
  app.view = { redraw: function() { app.redraws++; } };
  app.showToast = function(t) { app.toasts.push(t); };
  app.doAddBlacklistUserId = function(id) { app.pref.blacklistedUserIds[id] = true; };
  var pref = new PttChromePref(app, function() {});
  pref.values = Object.assign({}, DEFAULT_PREFS, values || {});
  pref.setStorage = function() {};
  pref.refreshTempBlacklistOnUi = function() {};
  pref.refreshBlacklistOnUi = function() {};
  app.pref = pref;
  return pref;
}

// Runs the fact check; the blacklist step is deferred with setTimeout, so
// run that at once here.
function analyze(art, values, pref) {
  pref = pref || makePref(values);
  if (values) Object.assign(pref.values, values);
  var fc = new FactCheck(pref.app);
  fc.history = { record: function() {}, count: function() { return 0; } };
  fc.historyTags = function() {};
  var timers = [];
  var real = global.setTimeout;
  global.setTimeout = function(fn) { timers.push(fn); };
  try { var r = fc.analyze(art); } finally { global.setTimeout = real; }
  timers.forEach(function(fn) { fn(); });
  return { report: r.report, tags: r.tags, pref: pref, fc: fc,
           floodLine: r.report.filter(function(t) { return /^連續推文/.test(t); })[0] || '' };
}

// Fake DOM good enough for PttReader.toLines.
function text(s) { return { nodeType: 3, nodeValue: s }; }
function elem(attrs, kids) {
  var n = { nodeType: 1, tagName: 'DIV', firstChild: null, nextSibling: null,
            hasAttribute: function(k) { return k in attrs; },
            getAttribute: function(k) { return k in attrs ? attrs[k] : null; } };
  for (var i = kids.length - 1; i >= 0; --i) { kids[i].nextSibling = n.firstChild; n.firstChild = kids[i]; }
  return n;
}
function pushNode(i) { return elem({ 'data-push-index': String(i) }, [text('push\n')]); }

// ---- FactCheck.chains ------------------------------------------------------

console.log('FactCheck.chains');

test('joins a run across up to 2 other floors', function() {
  var ps = [push('a', 1), push('b', 1), push('c', 1), push('a', 1)];
  assert.deepStrictEqual(FactCheck.chains([0, 1, 2, 3], ps), [[0, 3], [1], [2]]);
});
test('3 other floors in between breaks the run', function() {
  var ps = [push('a', 1), push('b', 1), push('c', 1), push('d', 1), push('a', 1)];
  assert.deepStrictEqual(FactCheck.chains([0, 1, 2, 3, 4], ps)[0], [0]);
});
test('more than 2 minutes later breaks the run', function() {
  var ps = [push('a', 1), push('b', 1), push('a', 4)];
  assert.deepStrictEqual(FactCheck.chains([0, 1, 2], ps)[0], [0]);
});
test('IDs compare without case', function() {
  var ps = [push('Abc', 1), push('x', 1), push('abc', 1)];
  assert.deepStrictEqual(FactCheck.chains([0, 1, 2], ps)[0], [0, 2]);
});
test('FactCheck.blocks splits on push.block', function() {
  var ps = [push('a', 1, 1), push('a', 1, 1), push('a', 1, 2)];
  assert.deepStrictEqual(FactCheck.blocks(ps), [[0, 1], [2]]);
  assert.deepStrictEqual(FactCheck.blocks([push('a', 1), push('b', 1)]), [[0, 1]]);
});

// ---- reader uses the same runs ----------------------------------------------

console.log('PttReader.groupRuns / assignBlocks');

test('groupRuns shows the runs FactCheck.chains finds', function() {
  var ps = [push('a', 1), push('b', 1), push('a', 1), push('c', 1), push('b', 1)];
  var lines = ps.map(function(p, i) { var l = []; l.push_index = i; return l; });
  PttReader.groupRuns(lines, ps);
  assert.deepStrictEqual(lines.map(function(l) { return l.push_index; }), [0, 2, 1, 4, 3]);
});
test('groupRuns never moves a push past a ※ 編輯 line', function() {
  var ps = [push('a', 1), push('b', 1), push('a', 1)];
  var mk = function(i) { var l = []; l.push_index = i; return l; };
  var lines = [mk(0), mk(1), [{ text: '※ 編輯' }], mk(2)];
  PttReader.groupRuns(lines, ps);
  assert.deepStrictEqual(lines.map(function(l) { return l.push_index; }), [0, 1, undefined, 2]);
});
test('assignBlocks numbers the blocks between other lines', function() {
  var ps = [push('a', 1), push('a', 1), push('a', 1)];
  var body = elem({}, [text('內文\n'), pushNode(0), pushNode(1), text('※ 編輯: a\n'), pushNode(2)]);
  PttReader.assignBlocks(body, ps);
  assert.deepStrictEqual(ps.map(function(p) { return p.block; }), [1, 1, 2]);
});

// ---- 連推 runs as one line -------------------------------------------------
console.log('連推 collapsed into one line');
function runLines(ps) {
  var lines = ps.map(function(p, i) { var l = []; l.push_index = i; return l; });
  PttReader.groupRuns(lines, ps);
  return lines;
}
function said(id, minute, words) { var p = push(id, minute); p.content = words; return p; }
test('a run of 5 (cut in once) becomes one line; 4 does not', function() {
  var ps = many('a', 3, 1).concat([push('x', 1)]).concat(many('a', 2, 2)).concat(many('b', 4, 3));
  var runs = PttReader.collapsedRuns(runLines(ps), ps, DEFAULT_PREFS, 'op');
  assert.strictEqual(runs.length, 1);
  assert.deepStrictEqual(runs[0].idx, [0, 1, 2, 4, 5]);
});
test('the run length can be changed; the setting off collapses nothing', function() {
  var ps = many('b', 4, 3);
  assert.strictEqual(PttReader.collapsedRuns(runLines(ps), ps, Object.assign({}, DEFAULT_PREFS, { readerCollapseRunMin: 4 }), 'op').length, 1);
  assert.strictEqual(PttReader.collapsedRuns(runLines(many('a', 8, 1)), many('a', 8, 1), Object.assign({}, DEFAULT_PREFS, { readerCollapseRuns: false }), 'op').length, 0);
});
test('the author\'s own replies: left alone by default, collapsed (not 連推) when turned on', function() {
  var ps = many('op', 6, 1);
  assert.strictEqual(DEFAULT_PREFS.readerCollapseAuthorRuns, false);
  assert.strictEqual(PttReader.collapsedRuns(runLines(ps), ps, DEFAULT_PREFS, 'op').length, 0);
  var runs = PttReader.collapsedRuns(runLines(ps), ps, Object.assign({}, DEFAULT_PREFS, { readerCollapseAuthorRuns: true }), 'OP');
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].author, true);
});
test('summary: floors, times and the text joined (Chinese without spaces)', function() {
  var ps = [push('z', 0), said('a', 1, '我覺得這件事'), said('a', 1, '其實沒有那麼簡單'), said('a', 2, '大家想想'), said('a', 2, 'ok then'), said('a', 3, 'bye')];
  var s = PttReader.runSummary(ps, [1, 2, 3, 4, 5]);
  assert.strictEqual(s.n, 5);
  assert.strictEqual(s.floors, '#2–#6');
  assert.strictEqual(s.time, '10:01–10:03');
  assert.strictEqual(s.text, '我覺得這件事其實沒有那麼簡單大家想想ok then bye');
});
test('summary: the same sentence repeated is 「同一句 ×N」', function() {
  var ps = [1, 2, 3, 4, 5].map(function(m) { return said('a', m, '支持 '); });
  assert.strictEqual(PttReader.runSummary(ps, [0, 1, 2, 3, 4]).text, '同一句 ×5：支持');
});
test('both the extension\'s reading mode and the app draw runs as one line', function() {
  assert.ok(/collapsedRuns\(/.test(PttReader.prototype.render.toString()), 'reader.render');
  assert.ok(/collapsedRuns\(/.test(JJMobile.prototype.fillArticle.toString()), 'app');
  assert.ok(typeof JJMobile.prototype.runRow === 'function');
});

// ---- 連推 rule --------------------------------------------------------------

console.log('連推 (factFloodRun)');

test('10 in a row: tagged and blacklisted 24 hours with the reason', function() {
  var r = analyze(article(many('aaa', 10, 1)));
  assert.ok(r.pref.isBlacklisted('aaa'));
  var left = r.pref.tempBlacklist.aaa - Date.now();
  assert.ok(left > 23.9 * 3600000 && left <= 24 * 3600000);
  var info = r.pref.tempBlacklistInfo.aaa;
  assert.strictEqual(info.kind, 'flood');
  assert.strictEqual(info.n, 10);
  assert.strictEqual(info.title, '[問卦] 測試');
  assert.strictEqual(info.board, 'Test');
  assert.ok(/ptt\.cc/.test(info.url));
  assert.ok(r.tags[0].some(function(t) { return t.t === '連推10'; }));
});
test('9 in a row is under the threshold', function() {
  var r = analyze(article(many('aaa', 9, 1)));
  assert.ok(!r.pref.isBlacklisted('aaa'));
  assert.strictEqual(r.floodLine, '');
});
test('the threshold can be changed', function() {
  assert.ok(analyze(article(many('aaa', 5, 1)), { factFloodRunMin: 5 }).pref.isBlacklisted('aaa'));
});
test('rule off: nothing happens', function() {
  assert.ok(!analyze(article(many('aaa', 20, 1)), { factFloodRun: false }).pref.isBlacklisted('aaa'));
});
test('one cut-in does not dodge it (9 + other + 5)', function() {
  var ps = many('aaa', 9, 1).concat([push('bbb', 1)], many('aaa', 5, 2));
  var r = analyze(article(ps));
  assert.ok(r.pref.isBlacklisted('aaa'));
  assert.strictEqual(r.pref.tempBlacklistInfo.aaa.n, 14);
});
test('[公告] / [測試] articles: 連推 does not count', function() {
  ['[公告] 每週六清除本板文章.', '[測試]', 'Re: [公告] 板規', ' [ 測試 ] abc'].forEach(function(title) {
    var art = article(many('aaa', 20, 1));
    art.meta['標題'] = title;
    var r = analyze(art);
    assert.ok(!r.pref.isBlacklisted('aaa'), title);
    assert.strictEqual(r.floodLine, '', title);
    assert.ok(!r.tags[0] || !r.tags[0].some(function(t) { return /^連推/.test(t.t); }), title);
  });
  assert.ok(analyze(article(many('aaa', 20, 1))).pref.isBlacklisted('aaa'), '[問卦] 測試 still counts');
});
test('old 連推 entries from [公告] / [測試] articles are dropped; others stay', function() {
  var pref = makePref();
  var until = Date.now() + 3600000;
  pref.tempBlacklist = { a: until, b: until, c: until, d: until };
  pref.tempBlacklistInfo = {
    a: { kind: 'flood', n: 30, title: '[公告] 每週六清除本板文章.' },
    b: { kind: 'flood', n: 12, title: '[測試]' },
    c: { kind: 'flood', n: 12, title: '[問卦] 測試' },
    d: { kind: 'spam', n: 4, title: '[公告] 板規' }
  };
  assert.strictEqual(pref.dropExemptFlood(), true);
  assert.deepStrictEqual(Object.keys(pref.tempBlacklist).sort(), ['c', 'd']);
  assert.deepStrictEqual(Object.keys(pref.tempBlacklistInfo).sort(), ['c', 'd']);
  assert.strictEqual(pref.dropExemptFlood(), false);
});
test('cut-ins counting off: 9 + other + 5 is not a run', function() {
  var ps = many('aaa', 9, 1).concat([push('bbb', 1)], many('aaa', 5, 2));
  assert.ok(!analyze(article(ps), { factFloodRunChain: false }).pref.isBlacklisted('aaa'));
});
test('a ※ 編輯 line splits runs (6 + edit + 6)', function() {
  var ps = many('aaa', 6, 1, 1).concat(many('aaa', 6, 1, 2));
  assert.ok(!analyze(article(ps)).pref.isBlacklisted('aaa'));
  assert.ok(!analyze(article(ps), { factFloodRunChain: false }).pref.isBlacklisted('aaa'));
});
test('the author replying in their own article is not counted', function() {
  var r = analyze(article(many('op', 12, 1), 'op'));
  assert.ok(!r.pref.isBlacklisted('op'));
});
test('author rule off: the author is counted too', function() {
  assert.ok(analyze(article(many('op', 12, 1), 'op'), { factFloodRunSkipAuthor: false }).pref.isBlacklisted('op'));
});
test('taken off by hand: not put back for 24 hours', function() {
  var pref = makePref();
  var art = article(many('aaa', 10, 1));
  analyze(art, null, pref);
  assert.ok(pref.isBlacklisted('aaa'));
  pref.removeTempBlacklist('aaa');
  assert.ok(!pref.isBlacklisted('aaa'));
  assert.ok(!('aaa' in pref.tempBlacklistInfo));
  var r = analyze(art, null, pref);
  assert.ok(!pref.isBlacklisted('aaa'));
  assert.ok(/手動移除過/.test(r.floodLine));
  assert.ok(!/已加入/.test(r.floodLine));
});
test('keep-removed rule off: put back on next time', function() {
  var pref = makePref({ factFloodRunKeepRemoved: false });
  var art = article(many('aaa', 10, 1));
  analyze(art, null, pref);
  pref.removeTempBlacklist('aaa');
  analyze(art, null, pref);
  assert.ok(pref.isBlacklisted('aaa'));
});
test('the exemption runs out after 24 hours', function() {
  var pref = makePref();
  pref.removeTempBlacklist('aaa');
  pref.floodExempt.aaa = Date.now() - 1;
  analyze(article(many('aaa', 10, 1)), null, pref);
  assert.ok(pref.isBlacklisted('aaa'));
});

// ---- loading an article ------------------------------------------------------

console.log('loading articles');

test('every loaded article (read or prefetched) goes through the fact check', function() {
  var src = PttReader.prototype.articleFromDoc.toString();
  assert.ok(/factCheck\.analyze\(article\)/.test(src), 'fetchArticle runs the fact check');
  assert.ok(/assignBlocks\(body, pushes\)/.test(src), 'fetchArticle sets push.block');
  assert.ok(/findArticle\(/.test(PttReader.prototype.startPrefetch.toString()), 'prefetch loads through findArticle');
  assert.ok(/fetchArticle\(/.test(PttReader.prototype.findArticle.toString()), 'findArticle uses fetchArticle');
});

// ---- spam guard ---------------------------------------------------------------

console.log('同網址洗版 (SpamGuard)');

test('same URL in 4 articles: blacklisted with the reason', function() {
  lib.store = {};
  var pref = makePref();
  var guard = new SpamGuard(pref.app);
  for (var i = 1; i <= 4; ++i) {
    guard.record({ url: 'https://www.ptt.cc/bbs/Test/M.' + i + '.A.html', text: '',
                   meta: { '作者': 'op', '標題': '文' + i, '看板': 'Test' },
                   pushes: [{ id: 'spammer', content: 'https://example.com/buy' }] });
  }
  assert.ok(pref.isBlacklisted('spammer'));
  var info = pref.tempBlacklistInfo.spammer;
  assert.strictEqual(info.kind, 'spam');
  assert.strictEqual(info.n, 4);
  assert.strictEqual(info.link, 'example.com/buy');
  assert.strictEqual(info.title, '文4');
});

function spamArticle(i, id) {
  return { url: 'https://www.ptt.cc/bbs/Test/M.' + i + '.A.html', text: '',
           meta: { '作者': 'op', '標題': '文' + i, '看板': 'Test' },
           pushes: [{ id: id || 'spammer', content: 'https://example.com/buy' }] };
}

test('spam: taken off by hand, not put back when the article is opened again', function() {
  lib.store = {};
  var pref = makePref();
  var guard = new SpamGuard(pref.app);
  for (var i = 1; i <= 4; ++i) guard.record(spamArticle(i));
  assert.ok(pref.isBlacklisted('spammer'));
  pref.removeTempBlacklist('spammer');
  guard.record(spamArticle(4));
  guard.record(spamArticle(5));
  assert.ok(!pref.isBlacklisted('spammer'));
});
test('spam: keep-removed rule off: put back', function() {
  lib.store = {};
  var pref = makePref({ factFloodRunKeepRemoved: false });
  var guard = new SpamGuard(pref.app);
  for (var i = 1; i <= 4; ++i) guard.record(spamArticle(i));
  pref.removeTempBlacklist('spammer');
  guard.record(spamArticle(4));
  assert.ok(pref.isBlacklisted('spammer'));
});
test('spam: no pop-up; the log names the article', function() {
  lib.store = {};
  var pref = makePref();
  var guard = new SpamGuard(pref.app);
  for (var i = 1; i <= 4; ++i) guard.record(spamArticle(i));
  assert.strictEqual(pref.app.toasts.length, 0);
  var log = pref.autoBlackLog();
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].id, 'spammer');
  assert.strictEqual(log[0].kind, 'spam');
  assert.strictEqual(log[0].title, '文4');
  assert.strictEqual(log[0].board, 'Test');
});

test('spam: one article reloaded with ?_=… (after a push) is still one article', function() {
  lib.store = {};
  var pref = makePref();
  var guard = new SpamGuard(pref.app);
  for (var i = 0; i < 6; ++i) {
    var a = spamArticle(1);
    a.url += '?_=' + (1000 + i);
    guard.record(a);
  }
  assert.ok(!pref.isBlacklisted('spammer'));
});
test('spam: copies recorded before under ?_=… are folded into the article', function() {
  lib.store = {};
  var now = Date.now();
  lib.store[SpamGuard.KEY] = JSON.stringify({ hiimdaniel: { 'i.mopix.cc/a.jpg': {
    '/bbs/Gossiping/M.1.A.html': now, '/bbs/Gossiping/M.1.A.html?_=1': now, '/bbs/Gossiping/M.1.A.html?_=2': now } } });
  var pref = makePref();
  var guard = new SpamGuard(pref.app);
  guard.record({ url: 'https://www.ptt.cc/bbs/Gossiping/M.1.A.html?_=3', text: '', meta: { '作者': 'op', '標題': 't', '看板': 'Gossiping' },
                 pushes: [{ id: 'hiimdaniel', content: 'https://i.mopix.cc/a.jpg' }] });
  assert.ok(!pref.isBlacklisted('hiimdaniel'));
  assert.deepStrictEqual(Object.keys(guard.load().hiimdaniel['i.mopix.cc/a.jpg']), ['/bbs/Gossiping/M.1.A.html']);
});
test('共伴 history: an article under ?_=… is the same article; old copies folded', function() {
  lib.store = {};
  var h = new FactHistory();
  var art = function(q) { return { url: 'https://www.ptt.cc/bbs/G/M.1.A.html' + q, meta: { '作者': 'op' } }; };
  h.record(art(''), ['a', 'b'], {});
  h.record(art('?_=1'), ['a', 'b', 'c'], {});
  h.record(art('?_=2'), ['a', 'b', 'c', 'd'], {});
  assert.strictEqual(h.count(), 1);
  lib.store = {};
  lib.store[FactHistory.KEY] = JSON.stringify({ a: { '/bbs/G/M.1.A.html': { u: 'op', p: ['a'], f: [] },
    '/bbs/G/M.1.A.html?_=5': { u: 'op', p: ['a'], f: [] }, '/bbs/G/M.2.A.html?_=6': { u: 'op', p: ['b'], f: [] } },
    order: ['/bbs/G/M.1.A.html', '/bbs/G/M.1.A.html?_=5', '/bbs/G/M.2.A.html?_=6'] });
  var h2 = new FactHistory();
  assert.deepStrictEqual(h2.load().order, ['/bbs/G/M.1.A.html', '/bbs/G/M.2.A.html']);
  assert.deepStrictEqual(Object.keys(h2.data.a).sort(), ['/bbs/G/M.1.A.html', '/bbs/G/M.2.A.html']);
});
test('fetchArticle keeps the article\'s own address (no ?_= cache query)', function() {
  assert.strictEqual(PttReader.articleUrl('https://www.ptt.cc/bbs/G/M.1.A.html?_=123'), 'https://www.ptt.cc/bbs/G/M.1.A.html');
  assert.ok(/PttReader\.articleUrl\(doc\.jjUrl \|\| url\)/.test(PttReader.prototype.articleFromDoc.toString()));
});

// ---- automatic blacklist: batch, toast, permanent ---------------------------------

console.log('自動黑名單');

test('3 flooders in one article: one redraw, no pop-ups, 3 log entries naming the article', function() {
  lib.store = {};
  var ps = many('a1', 10, 1).concat(many('a2', 10, 1), many('a3', 10, 1));
  var r = analyze(article(ps));
  ['a1', 'a2', 'a3'].forEach(function(id) { assert.ok(r.pref.isBlacklisted(id), id); });
  assert.strictEqual(r.pref.app.redraws, 1);
  assert.strictEqual(r.pref.app.toasts.length, 0);
  var log = r.pref.autoBlackLog();
  assert.deepStrictEqual(log.map(function(e) { return e.id; }).sort(), ['a1', 'a2', 'a3']);
  log.forEach(function(e) { assert.strictEqual(e.title, '[問卦] 測試'); assert.strictEqual(e.board, 'Test'); assert.strictEqual(e.n, 10); });
});
test('log: taken off by hand is marked on the newest entry; kept after leaving the list', function() {
  lib.store = {};
  var r = analyze(article(many('aaa', 10, 1)));
  r.pref.removeTempBlacklist('aaa');
  var log = r.pref.autoBlackLog();
  assert.strictEqual(log.length, 1);
  assert.ok(log[0].removed > 0);
  assert.ok(!r.pref.isBlacklisted('aaa'));
});
test('log: keeps the last 200', function() {
  lib.store = {};
  var pref = makePref();
  for (var i = 0; i < 205; ++i) pref.logAutoBlack([{ id: 'u' + i, info: { kind: 'flood', n: 10 } }]);
  var log = pref.autoBlackLog();
  assert.strictEqual(log.length, 200);
  assert.strictEqual(log[0].id, 'u204');
});
test('連推 boards: no 連推 tag or blacklist on a listed board (any case, commas or spaces)', function() {
  var r = analyze(article(many('aaa', 12, 1)), { factFloodRunBoards: 'Baseball, test' });
  assert.ok(!r.pref.isBlacklisted('aaa'));
  r = analyze(article(many('aaa', 12, 1)), { factFloodRunBoards: 'Baseball C_Chat' });
  assert.ok(r.pref.isBlacklisted('aaa'));
});
test('連推 boards: board from the URL when the header has none', function() {
  var art = article(many('aaa', 12, 1));
  delete art.meta['看板'];
  assert.ok(!analyze(art, { factFloodRunBoards: 'Test' }).pref.isBlacklisted('aaa'));
});
test('連推 boards: adding a board lets out who was caught there', function() {
  lib.store = {};
  var r = analyze(article(many('aaa', 12, 1)));
  assert.ok(r.pref.isBlacklisted('aaa'));
  r.pref.addFloodRunBoard('Test');
  assert.strictEqual(r.pref.values.factFloodRunBoards, 'Test');
  assert.ok(!r.pref.isBlacklisted('aaa'));
  r.pref.values.factFloodRunBoards = 'Baseball,';
  r.pref.addFloodRunBoard('C_Chat');
  assert.strictEqual(r.pref.values.factFloodRunBoards, 'Baseball, C_Chat');
});
test('不顯示 hides the hand-made blacklist only; the automatic one is faded', function() {
  var r = analyze(article(many('aaa', 10, 1)));
  r.pref.hideBlacklisted = true;
  r.pref.blacklistedUserIds.bbb = true;
  assert.ok(r.pref.isBlacklisted('aaa') && !r.pref.hidesBlacklisted('aaa'));
  assert.ok(r.pref.hidesBlacklisted('BBB'));
  r.pref.hideBlacklisted = false;
  assert.ok(!r.pref.hidesBlacklisted('bbb'));
});
test('make permanent: moves from the temporary list to the blacklist', function() {
  var r = analyze(article(many('aaa', 10, 1)));
  r.pref.makeTempBlacklistPermanent('aaa');
  assert.ok(!('aaa' in r.pref.tempBlacklist));
  assert.ok(!('aaa' in r.pref.tempBlacklistInfo));
  assert.ok(r.pref.blacklistedUserIds.aaa);
  assert.ok(r.pref.isBlacklisted('aaa'));
});

// ---- single-article rules: 脈衝, 罐頭, 秒推, 門檻 ----------------------------------

console.log('脈衝 / 罐頭 / 秒推 / 門檻');

// pushes at "11/12 10:MM", `count` per minute for the given minutes
function steady(fromMin, toMin, perMin, prefix) {
  var out = [];
  for (var m = fromMin; m <= toMin; ++m) {
    for (var k = 0; k < perMin; ++k) out.push(push((prefix || 'u') + m + '_' + k, m));
  }
  return out;
}
function bursts(r) { return r.report.filter(function(t) { return /^脈衝/.test(t); }); }
// Date.now() fixed at 11/12 hh:mm (local time, like the push times)
function at(hh, mm, fn) {
  var real = Date.now;
  Date.now = function() { return new Date(2026, 10, 12, hh, mm).getTime(); };
  try { return fn(); } finally { Date.now = real; }
}

test('脈衝: a steady busy thread has none (not at the start, not at the end)', function() {
  at(12, 0, function() {
    assert.deepStrictEqual(bursts(analyze(article(steady(0, 20, 4)))), []);
  });
});
test('脈衝: a busy thread being read live has none in its newest minute', function() {
  at(10, 20, function() {
    assert.deepStrictEqual(bursts(analyze(article(steady(0, 20, 4)))), []);
  });
});
test('脈衝: a wave after 5+ quiet minutes is caught', function() {
  var ps = steady(0, 3, 1, 'a').concat(many('w', 8, 12));
  var b = bursts(analyze(article(ps)));
  assert.strictEqual(b.length, 1);
  assert.ok(/之前 8 分鐘沒人推/.test(b[0]), b[0]);
});
test('脈衝: nobody for 8 minutes after posting, then a wave', function() {
  var b = bursts(analyze(article(many('w', 8, 8))));
  assert.strictEqual(b.length, 1);
  assert.ok(/發文後 8 分鐘都沒人推/.test(b[0]), b[0]);
});
test('脈衝: lots of pushes right after posting is 秒推, not a wave', function() {
  at(12, 0, function() {
    assert.deepStrictEqual(bursts(analyze(article(many('w', 8, 0).concat(steady(1, 6, 2))))), []);
  });
});
test('脈衝: a quiet thread, a wave, then nobody until now is caught', function() {
  // 2 pushes in the 5 minutes before, so not quiet *before* the wave
  var ps = [push('a', 5), push('b', 7)].concat(many('w', 8, 9));
  at(12, 0, function() {
    var b = bursts(analyze(article(ps)));
    assert.strictEqual(b.length, 1);
    assert.ok(/之後到現在沒人推/.test(b[0]), b[0]);
  });
  at(10, 11, function() {  // still going on: not known yet
    assert.deepStrictEqual(bursts(analyze(article(ps))), []);
  });
});

function meme(fastCount) {
  // 6 accounts saying nearly the same thing, spread out (not 接龍);
  // the first `fastCount` of them push within 2 minutes of the post
  var ps = [], ends = ['哈', '啦', '欸', '喔', '耶', '嗎'];
  for (var i = 0; i < 6; ++i) {
    var p = push('m' + i, i < fastCount ? 1 : 4 + i);
    p.content = '政府真的是爛到不行了吧' + ends[i];
    ps.push(p);
    ps.push(push('f' + i, i < fastCount ? 1 : 4 + i));
  }
  return ps;
}
function cannedTags(r) {
  var out = {};
  r.tags.forEach(function(ts) { ts.forEach(function(t) { if (/^(罐頭|同梗)/.test(t.t)) out[t.t] = (out[t.t] || 0) + 1; }); });
  return out;
}
test('罐頭: a meme with only one early pusher stays grey 同梗', function() {
  var r = analyze(article(meme(1)));
  assert.deepStrictEqual(cannedTags(r), { '同梗': 6 });
  assert.ok(!r.report.some(function(t) { return /^罐頭/.test(t); }));
});
test('罐頭: two accounts with another sign make it 罐頭', function() {
  var r = analyze(article(meme(2)));
  assert.ok(cannedTags(r)['罐頭A'] >= 5, JSON.stringify(cannedTags(r)));
  assert.ok(r.report.some(function(t) { return /^罐頭A/.test(t); }));
});

// ---- 相似帳號 ----------------------------------------------------------------
function similarTags(r) {
  var out = {};
  r.tags.forEach(function(ts) { ts.forEach(function(t) { if (t.t === '相似帳號') out[t.lvl] = (out[t.lvl] || 0) + 1; }); });
  return out;
}
function similarLine(r) { return r.report.filter(function(t) { return /^相似帳號/.test(t); })[0] || ''; }
test('相似帳號: crispy01～03 pushing within the hour, two also 秒推 -> red, in the report', function() {
  var ps = [push('crispy01', 1), push('crispy02', 1), push('a1', 20), push('crispy03', 50)];
  var r = analyze(article(ps));
  assert.deepStrictEqual(similarTags(r), { warn: 3 });
  assert.strictEqual(similarLine(r).indexOf('相似帳號：3 個名稱相似的帳號在 1 小時內推文（crispy01～03）'), 0, similarLine(r));
});
test('相似帳號: no other sign -> grey, not in the report', function() {
  var ps = [push('crispy01', 10), push('crispy02', 30), push('crispy03', 50)];
  var r = analyze(article(ps));
  assert.deepStrictEqual(similarTags(r), { grey: 3 });
  assert.strictEqual(similarLine(r), '');
});
test('相似帳號: more than 60 minutes apart does not count', function() {
  var ps = [push('crispy01', 0), push('crispy02', 10)];
  var late = push('crispy03', 0); late.time = '11/12 11:30';
  var r = analyze(article(ps.concat([late])));
  assert.deepStrictEqual(similarTags(r), {});
});
test('相似帳號: two accounts are not enough; the count can be changed', function() {
  var ps = [push('crispy01', 10), push('crispy02', 30)];
  assert.deepStrictEqual(similarTags(analyze(article(ps))), {});
  assert.deepStrictEqual(similarTags(analyze(article(ps), { factSimilarMin: 2 })), { grey: 2 });
});
test('相似帳號: abc123 / abc124 / abc125 count; ab1 / ab2 / ab3 (short start) do not', function() {
  assert.deepStrictEqual(similarTags(analyze(article([push('abc123', 10), push('abc124', 20), push('abc125', 30)]))), { grey: 3 });
  assert.deepStrictEqual(similarTags(analyze(article([push('ab1', 10), push('ab2', 20), push('ab3', 30)]))), {});
  assert.deepStrictEqual(similarTags(analyze(article([push('abc1', 10), push('abc2', 20), push('abc3', 30)]))), {});
});
test('相似帳號: rule off -> nothing', function() {
  var ps = [push('crispy01', 1), push('crispy02', 1), push('crispy03', 5)];
  assert.deepStrictEqual(similarTags(analyze(article(ps), { factSimilar: false })), {});
});

test('秒推: the author adding a note right after posting is not 秒推', function() {
  var r = analyze(article([push('op', 0), push('x', 1)], 'op'));
  assert.deepStrictEqual(r.tags[0], []);
  assert.ok(r.tags[1].some(function(t) { return t.t === '秒推'; }));
  assert.ok(!('op' in r.fc.lastFastIds));
});
test('秒推 off: no tags, but still worked out for 首殺班底 / history', function() {
  var r = analyze(article([push('x', 1)]), { factFastPush: false });
  assert.deepStrictEqual(r.tags[0], []);
  assert.ok(!r.report.some(function(t) { return /^秒推/.test(t); }));
  assert.ok(r.fc.lastFastIds.x);
});
test('首殺班底 works with 秒推 off', function() {
  lib.store = {};
  var pref = makePref({ factFastPush: false, factSquadMin: 3 });
  var fc = new FactCheck(pref.app);
  fc.history = new FactHistory();
  var r;
  for (var i = 1; i <= 3; ++i) {
    var a = article([push('fan', 1), push('x' + i, 30)], 'op');
    a.url = 'https://www.ptt.cc/bbs/Test/M.' + i + '.A.html';
    r = fc.analyze(a);
  }
  assert.ok(r.tags[0].some(function(t) { return t.t === '首殺班底'; }), JSON.stringify(r.tags[0]));
});
test('門檻推文 off: no tags, but the first 10 are still remembered for 門檻班底', function() {
  var ps = [];
  for (var i = 0; i < 10; ++i) { var p = push('c' + i, 1); p.content = '推'; ps.push(p); }
  at(14, 0, function() {
    var r = analyze(article(ps), { factTask: false });
    assert.ok(!r.tags.some(function(ts) { return ts.some(function(t) { return t.t === '門檻推文'; }); }));
    assert.ok(r.fc.lastTaskIds && r.fc.lastTaskIds.c0);
    var on = analyze(article(ps));
    assert.ok(on.tags[0].some(function(t) { return t.t === '門檻推文'; }));
  });
});

// ---- Android app: versions, http pictures (js/mobile.js, js/reader.js) ------

console.log('Android app (versions)');

test('app search: 推文數 labels (爆文, 噓爆) and the quick buttons', function() {
  assert.strictEqual(JJMobile.pushQueryLabel('100'), '爆文');
  assert.strictEqual(JJMobile.pushQueryLabel('-100'), '噓爆');
  assert.strictEqual(JJMobile.pushQueryLabel('20'), '推 ≥ 20');
  assert.strictEqual(JJMobile.pushQueryLabel('-10'), '噓 ≥ 10');
  assert.strictEqual(JJMobile.pushQueryLabel('200'), '止爆');
  assert.deepStrictEqual(JJMobile.QUICK_PUSH.map(function(q) { return q[0]; }), [20, 100, 200, -100]);
});
test('app 發表文章 / 回文: shown on the list at once (剛送出), the board page read again until www.ptt.cc has it, then the list drawn once (it looked lost)', function() {
  var mine = { author: 'mikeeeee', title: 'JJptt25' };
  assert.ok(JJMobile.isMyArticle({ author: 'MikeEEEE', title: '[測試] JJptt25' }, mine));
  assert.ok(!JJMobile.isMyArticle({ author: 'someone', title: '[測試] JJptt25' }, mine));
  assert.ok(!JJMobile.isMyArticle({ author: 'mikeeeee', title: '[測試] 測測測試' }, mine));
  // a 回文: only the Re: one counts, not the article it answers
  var re = { author: 'mikeeeee', title: '[測試] JJptt25', reply: true };
  assert.ok(JJMobile.isMyArticle({ author: 'mikeeeee', title: 'Re: [測試] JJptt25' }, re));
  assert.ok(!JJMobile.isMyArticle({ author: 'mikeeeee', title: '[測試] JJptt25' }, re));
  var parse = JJMobile.parseIndex, realNow = Date.now, clock = 1000, realTimeout = global.setTimeout;
  Date.now = function() { return clock; };
  global.setTimeout = function(fn, ms) { clock += ms; fn(); };  // the waits between reads, at once
  // a promise that runs its callback at once (no microtask queue to drain)
  var now = function(v) { return { then: function(ok) { return ok(v); } }; };
  try {
    var run = function(hasItFrom) {
      var reads = 0, draws = 0, fresh = [];
      JJMobile.parseIndex = function(doc) { return { entries: doc }; };
      var screen = { board: 'Test', view: { innerHTML: 'old list', scrollTop: 5 } };
      var m = { stack: [screen],
        listDoc: function(url, f) {
          reads++; fresh.push(f); clock += 400;
          assert.ok(/\/bbs\/Test\/index\.html$/.test(url), url);
          assert.strictEqual(screen.view.innerHTML, 'old list', 'the list on screen is kept while reading');
          return now(reads >= hasItFrom ? [{ author: 'mikeeeee', title: '[測試] JJptt25' }] : [{ author: 'x', title: 'old' }]);
        },
        render: function() { draws++; },
        showPendingArticle: function() {},
        redrawList: JJMobile.prototype.redrawList,
        reload: function() { throw new Error('the list itself is not reloaded'); } };
      JJMobile.prototype.reloadAfterArticle.call(m, screen, mine);
      return { reads: reads, draws: draws, fresh: fresh };
    };
    var r = run(3);
    assert.strictEqual(r.reads, 3, 'read until the article is there, then stopped');
    assert.strictEqual(r.draws, 1, 'drawn once, from that page');
    assert.ok(r.fresh.every(Boolean), 'never from the cache');
    var r2 = run(Infinity);
    assert.strictEqual(r2.draws, 1, 'never there: drawn after POST_WAIT_MS anyway');
    assert.ok(r2.reads >= JJMobile.POST_WAIT_MS / 1400 && r2.reads <= JJMobile.POST_WAIT_MS / 1400 + 2, String(r2.reads));
    assert.ok(/reloadAfterArticle\(/.test(fs.readFileSync(path.join(root, 'js/mobile_article.js'), 'utf8')), 'not used after 發表文章');
  } finally {
    JJMobile.parseIndex = parse;
    Date.now = realNow;
    global.setTimeout = realTimeout;
  }
});
test('version: JJptt\'s version and the run; before that 0.0.N', function() {
  assert.strictEqual(JJMobile.version(57, '1.33.0'), '1.33.0 (57)');
  assert.strictEqual(JJMobile.version(57), '0.0.57');
  assert.strictEqual(JJMobile.version(NaN, '1.33.0'), '?');
});
test('version: the run from the release page, new and old wording', function() {
  assert.strictEqual(JJMobile.runFromRelease('版次 0.0.58・JJptt Android 測試版 1.33.0 (58)（abc1234）'), 58);
  assert.strictEqual(JJMobile.runFromRelease('JJptt Android 測試版 0.0.41（abc1234）'), 41);
  assert.strictEqual(JJMobile.runFromRelease('JJptt Android 1.12.0'), 12);
  assert.ok(isNaN(JJMobile.runFromRelease('nothing here')));
});
test('repeat pushers: the app CSS uses the colour PushInsights sets (--jj-rp)', function() {
  var css = fs.readFileSync(path.join(root, 'css/main.css'), 'utf8');
  assert.ok(/\.jjm \.jjm-push-id\[data-jj-rp\]\s*\{\s*color:\s*var\(--jj-rp\)/.test(css), 'app push ID colour rule');
  assert.ok(!/--jj-repeat/.test(css), 'no rule waits for a --jj-repeat nobody sets');
  assert.ok(/setProperty\('--jj-rp'/.test(fs.readFileSync(path.join(root, 'js/push_insights.js'), 'utf8')));
});
test('article swipe keeps text selectable (Hammer must not set user-select: none)', function() {
  var src = fs.readFileSync(path.join(root, 'js/mobile_article.js'), 'utf8');
  var m = /new Hammer\.Manager\(screen\.view, \{([\s\S]*?)\}\);/.exec(src);
  assert.ok(m, 'swipe set up with Hammer.Manager');
  assert.ok(/userSelect:\s*'auto'/.test(m[1]) && /touchCallout:\s*'default'/.test(m[1]), 'selection and long-press menu kept');
});
test('ask AI about the article: title, its own address, the text before 發信站', function() {
  var q = JJMobile.articleForAi({ url: 'https://www.ptt.cc/bbs/G/M.1.A.html?_=9', meta: { '標題': '[問卦] 標題' },
    text: '第一行\n第二行\n※ 發信站: 批踢踢實業坊(ptt.cc), 來自: 1.2.3.4\n推 x: y' });
  assert.strictEqual(q, '[問卦] 標題\nhttps://www.ptt.cc/bbs/G/M.1.A.html\n\n第一行\n第二行');
});
test('own push: found on the web page by ID and the start of the text', function() {
  var art = { pushes: [{ id: 'other', content: '加油' }, { id: 'MikeEeee', content: '加油啦 大家' }] };
  assert.ok(JJMobile.hasPush(art, { id: 'mikeeeee', text: '加油啦 大家' }));
  assert.ok(!JJMobile.hasPush(art, { id: 'mikeeeee', text: '不是這句' }));
  assert.ok(!JJMobile.hasPush({ pushes: [] }, { id: 'mikeeeee', text: '加油' }));
});
test('pictures: http:// asked for over https://', function() {
  assert.strictEqual(PttReader.imageSrc('http://i.imgur.com/abcdefg.jpg'), 'https://i.imgur.com/abcdefg.jpg');
  assert.strictEqual(PttReader.imageSrc('https://i.imgur.com/abcdefg.png'), 'https://i.imgur.com/abcdefg.png');
  assert.strictEqual(PttReader.imageSrc('http://imgur.com/abcdefg'), 'https://i.imgur.com/abcdefg.jpg');
});

// ---- Android app: the PttSocket plugin as a native-messaging port -----------

test('the tab says JJptt (not ptt.cc), and its icons are the Game Boy ones', function() {
  var src = fs.readFileSync(path.join(root, 'js/pttchrome.js'), 'utf8') + fs.readFileSync(path.join(root, 'js/term_view.js'), 'utf8');
  assert.ok(!/document\.title = (url|self\.connectedUrl\.site|app\.connectedUrl\.site)/.test(src));
  var logo = fs.readFileSync(path.join(root, 'icon/logo.png'));
  assert.ok(logo.equals(fs.readFileSync(path.join(root, 'icon/logo_connect.png'))));
});

console.log('Android app (lib.openAppPort)');

// js/app_conn.js in a context of its own (it makes its own `lib`), with a
// fake Capacitor + PttSocket plugin
function appContext() {
  var listeners = {}, calls = [];
  var plugin = {
    addListener: function(name, fn) { listeners[name] = fn; return Promise.resolve({ remove: function() { delete listeners[name]; } }); },
    connect: function(o) { calls.push(['connect', o]); return Promise.resolve(); },
    send: function(o) { calls.push(['send', o.data]); return Promise.resolve(); },
    close: function() { calls.push(['close']); return Promise.resolve(); }
  };
  var ctx = { console: console, setTimeout: setTimeout, Promise: Promise, btoa: btoa, atob: atob };
  ctx.window = ctx;
  var local = {};
  ctx.localStorage = { getItem: function(k) { return k in local ? local[k] : null; },
                       setItem: function(k, v) { local[k] = String(v); },
                       removeItem: function(k) { delete local[k]; } };
  // the SecureStore plugin: what it holds is "encrypted" (kept apart here)
  var secret = {};
  var secure = {
    set: function(o) { secret[o.key] = o.value; return Promise.resolve(); },
    get: function(o) { return Promise.resolve({ value: secret[o.key] || '' }); },
    remove: function(o) { delete secret[o.key]; return Promise.resolve(); }
  };
  ctx.Capacitor = { isNativePlatform: function() { return true; }, Plugins: { PttSocket: plugin, SecureStore: secure } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/app_conn.js'), 'utf8'), ctx);
  return { lib: ctx.lib, listeners: listeners, calls: calls, plugin: plugin, local: local, secret: secret };
}
// objects from the other context have other prototypes: compare contents
function sameJson(a, b) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b)); }
function tick() { return new Promise(function(r) { setImmediate(r); }); }
var asyncTests = [];
function testAsync(name, fn) { asyncTests.push([name, fn]); }

testAsync('app: detected; can read www.ptt.cc', async function() {
  var a = appContext();
  assert.ok(a.lib.isApp());
  assert.ok(a.lib.canReadPttWeb());
  assert.ok(!a.lib.isExtension());
});
testAsync('app port: connect waits for the listeners, then data and close come through', async function() {
  var a = appContext();
  var port = a.lib.openAppPort(), got = [], closed = 0;
  port.onMessage.addListener(function(m) { got.push(m); });
  port.onDisconnect.addListener(function() { closed++; });
  port.postMessage({ type: 'connect', host: 'ptt.cc', port: 22 });
  await tick(); await tick();
  sameJson(a.calls[0], ['connect', { host: 'ptt.cc', port: 22 }]);
  ['connected', 'data', 'error', 'closed'].forEach(function(n) { assert.ok(a.listeners[n], n + ' listener'); });
  a.listeners.connected({});
  a.listeners.data({ data: 'aGk=' });
  port.postMessage({ type: 'send', data: 'eA==' });
  a.listeners.closed({});
  a.listeners.closed && a.listeners.closed({});  // only once
  sameJson(got, [{ type: 'connected' }, { type: 'data', data: 'aGk=' }]);
  sameJson(a.calls[1], ['send', 'eA==']);
  assert.strictEqual(closed, 1);
});
testAsync('app port: closing on purpose closes the socket and reports nothing', async function() {
  var a = appContext();
  var port = a.lib.openAppPort(), closed = 0;
  port.onDisconnect.addListener(function() { closed++; });
  await tick();
  port.disconnect();
  sameJson(a.calls, [['close']]);
  assert.strictEqual(closed, 0);
  assert.strictEqual(Object.keys(a.listeners).length, 0);
});
testAsync('app port: a refused connect becomes an error and a disconnect', async function() {
  var a = appContext();
  a.plugin.connect = function() { return Promise.reject(new Error('target not allowed')); };
  var port = a.lib.openAppPort(), got = [], closed = 0;
  port.onMessage.addListener(function(m) { got.push(m); });
  port.onDisconnect.addListener(function() { closed++; });
  port.postMessage({ type: 'connect', host: 'evil.example', port: 22 });
  await tick(); await tick(); await tick();
  sameJson(got, [{ type: 'error', message: 'target not allowed' }]);
  assert.strictEqual(closed, 1);
});

// the saved PTT password: SecureStore, never localStorage
function storageConn(a) {
  var got = [];
  var c = new a.lib.AppConnection({ onStorageDone: function(m) { got.push(m.data); } });
  return { conn: c, got: got };
}
var LOGIN_DEFAULTS = { values: {}, logins: { u: '', p: '' } };
testAsync('app storage: a saved password goes to SecureStore, localStorage keeps p empty', async function() {
  var a = appContext(), s = storageConn(a);
  s.conn.handleStorage({ type: 'set', data: { logins: { u: 'me', p: 'hunter2' } } });
  await tick(); await tick();
  assert.strictEqual(a.secret.pttPass, 'hunter2');
  assert.ok(a.local['jjptt.storage'].indexOf('hunter2') < 0);
  sameJson(JSON.parse(a.local['jjptt.storage']).logins, { u: 'me', p: '' });
  s.conn.handleStorage({ type: 'get', defaults: LOGIN_DEFAULTS });
  await tick(); await tick(); await tick();
  sameJson(s.got[0].logins, { u: 'me', p: 'hunter2' });
});
testAsync('app storage: a password from before is moved off localStorage', async function() {
  var a = appContext(), s = storageConn(a);
  a.local['jjptt.storage'] = JSON.stringify({ values: { x: 1 }, logins: { u: 'me', p: 'old' } });
  s.conn.handleStorage({ type: 'get', defaults: LOGIN_DEFAULTS });
  await tick(); await tick(); await tick(); await tick();
  sameJson(s.got[0].logins, { u: 'me', p: 'old' });
  assert.strictEqual(a.secret.pttPass, 'old');
  sameJson(JSON.parse(a.local['jjptt.storage']), { values: { x: 1 }, logins: { u: 'me', p: '' } });
});
testAsync('app storage: 登出 right after a login leaves no password', async function() {
  var a = appContext(), s = storageConn(a);
  s.conn.handleStorage({ type: 'set', data: { logins: { u: 'me', p: 'pw' } } });
  s.conn.handleStorage({ type: 'set', data: { logins: { u: '', p: '' } } });
  await tick(); await tick(); await tick();
  assert.ok(!('pttPass' in a.secret));
});
testAsync('app storage: other settings are saved as before', async function() {
  var a = appContext(), s = storageConn(a);
  s.conn.handleStorage({ type: 'set', data: { values: { fontSize: 20 } } });
  sameJson(JSON.parse(a.local['jjptt.storage']), { values: { fontSize: 20 } });
});

// ---- Android app: 正式版 / 測試版 channels (JJMobile.latestBuild) ---------

console.log('Android app (update channels)');

// releases: tag -> version.json text, or an Error to reject with
function channelApp(releases, beta) {
  var store = {};
  if (beta) store[JJMobile.BETA_KEY] = '1';
  global.localStorage = { getItem: function(k) { return k in store ? store[k] : null; }, setItem: function(k, v) { store[k] = v; } };
  global.Capacitor = { Plugins: { ApkUpdater: { fetchText: function(o) {
    var tag = /download\/([^\/]+)\//.exec(o.url)[1];
    var r = releases[tag];
    if (r instanceof Error) return Promise.reject(r);
    if (r === undefined) return Promise.reject(new Error('HTTP 404'));
    return Promise.resolve({ text: r });
  } } } };
  global.fetch = function(url) {
    var tag = /tags\/(.+)$/.exec(url)[1];
    var r = releases[tag];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({ ok: false, status: r === undefined ? 404 : 500 });
  };
  return Object.create(JJMobile.prototype);
}
function channelDone() { delete global.Capacitor; delete global.fetch; delete global.localStorage; }
var V = function(run) { return JSON.stringify({ run: run, version: '1.33.2', sha: 'abc1234' }); };

testAsync('channels: 正式版 by default', async function() {
  try {
    var b = await channelApp({ 'android-stable': V(56), 'android-latest': V(60) }).latestBuild();
    assert.strictEqual(b.run, 56); assert.strictEqual(b.channel, 'stable');
    assert.ok(/android-stable\/JJptt\.apk$/.test(b.url));
  } finally { channelDone(); }
});
testAsync('channels: 接收測試版 -> the newest test build', async function() {
  try {
    var b = await channelApp({ 'android-stable': V(56), 'android-latest': V(60) }, true).latestBuild();
    assert.strictEqual(b.run, 60); assert.strictEqual(b.channel, 'test');
    assert.ok(/android-latest\/JJptt\.apk$/.test(b.url));
  } finally { channelDone(); }
});
testAsync('channels: no 正式版 yet -> the test build, as before', async function() {
  try {
    var b = await channelApp({ 'android-latest': V(57) }).latestBuild();
    assert.strictEqual(b.run, 57); assert.strictEqual(b.channel, 'test');
  } finally { channelDone(); }
});
testAsync('channels: no network is an error, not a switch to 測試版', async function() {
  try {
    await assert.rejects(channelApp({ 'android-stable': new Error('timeout'), 'android-latest': V(60) }).latestBuild());
  } finally { channelDone(); }
});

testAsync('copy link: the article\'s own address goes to the clipboard, with a toast', async function() {
  var copied = null, toasts = [];
  var nav = Object.getOwnPropertyDescriptor(global, 'navigator');
  Object.defineProperty(global, 'navigator', { configurable: true, writable: true, value: { clipboard: { writeText: function(t) { copied = t; return Promise.resolve(); } } } });
  try {
    var m = Object.create(JJMobile.prototype);
    m.app = { showToast: function(t) { toasts.push(t); } };
    m.copyArticleUrl({ url: 'https://www.ptt.cc/bbs/Beauty/M.1774944082.A.AC4.html?_=123' });
    await tick(); await tick();
    assert.strictEqual(copied, 'https://www.ptt.cc/bbs/Beauty/M.1774944082.A.AC4.html');
    assert.deepStrictEqual(toasts, ['已複製這篇的網址']);
  } finally { if (nav) Object.defineProperty(global, 'navigator', nav); else delete global.navigator; }
});

// ---- Android app: the background PTT connection (js/mobile_ptt.js) ----------

console.log('Android app (JJPtt: login / push / reply)');

// A fake PTT: a list of [screen text, { keys typed -> next screen index }].
// Keys typed are recorded; `typed` joins send() and type().
function fakePtt(script) {
  var at = 0, typed = [];
  script.echo = ECHO;
  var app = {
    pref: { values: {} },
    buf: { rows: 24, cols: 80, getRowText: function(r) { return script[at][0].split('\n')[r] || ''; } },
    conn: {
      isConnected: false,
      send: function(k) {
        // like the app's port (btoa): only bytes; text goes through convSend
        if (/[^\x00-\xff]/.test(k)) throw new Error("Failed to execute 'btoa': outside of the Latin1 range");
        typed.push(k); move(k);
      },
      convSend: function(k) { typed.push(k); move(k); },
      disconnect: function() { this.isConnected = false; }
    },
    // a new connection starts at PTT's first screen again
    connect: function() { var c = this.conn; at = 0; setTimeout(function() { c.isConnected = true; }, 5); }
  };
  function move(k) {
    var next = script[at][1] && script[at][1][k];
    // a push's text typed without Enter (typePush reads it back first): PTT
    // shows it on its input line (the last), and the Enter goes on as the
    // script's 「text + \r」 says
    if (next === undefined && script[at][1] && script[at][1][k + '\r'] !== undefined && k) {
      var lines = script[at][0].split('\n');
      lines[lines.length - 1] += ' ' + k;
      script.echoed = [lines.join('\n'), { '\r': script[at][1][k + '\r'] }];
      at = 'echoed';
      return;
    }
    if (next === undefined) return;  // keys PTT isn't waiting for are lost
    at = next;
    // a screen with [text, keys, { after: ms, to: n }] moves on by itself
    var auto = script[at][2];
    if (auto) setTimeout(function() { if (script[at][2] === auto) at = auto.to; }, auto.after);
  }
  var ptt = new JJPtt(app);
  return { ptt: ptt, typed: typed, app: app };
}
JJPtt.STEP_MS = 2;
JJPtt.sleep = function() { return Promise.resolve(); };

test('AID from the web address (known pair M.1451110159.A.379 = 1MVYyFDv)', function() {
  assert.strictEqual(JJPtt.aidFromUrl('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html'), '1MVYyFDv');
  assert.strictEqual(JJPtt.aidFromUrl('https://www.ptt.cc/bbs/Test/index.html'), '');
  assert.strictEqual(JJPtt.boardFromUrl('https://www.ptt.cc/bbs/Gossiping/M.1.A.1.html'), 'Gossiping');
});

// After the account PTT shows it for a moment (screen 6), then asks for the
// password (ECHO); anything typed before that is lost, like on the real PTT.
var LOGIN = [
  ['請輸入代號，或以 guest 參觀，或以 new 註冊:', { 'tester\r': 'echo' }],
  ['請輸入代號，或以 guest 參觀，或以 new 註冊: tester\n請輸入您的密碼:', { 'right\r': 2, 'wrong\r': 5 }],
  ['您想刪除其他重複登入的連線嗎？[Y/n]', { 'n\r': 3 }],
  ['請按任意鍵繼續', { ' ': 4 }],
  ['【主功能表】 批踢踢實業坊', {}],
  ['密碼不對喔！請輸入代號:', {}]
];
var ECHO = ['請輸入代號，或以 guest 參觀，或以 new 註冊: tester', {}, { after: 40, to: 1 }];

testAsync('login: account, password, keeps the other login, any key, main menu', async function() {
  var f = fakePtt(LOGIN);
  await f.ptt.login('tester', 'right');
  assert.deepStrictEqual(f.typed, ['tester\r', 'right\r', 'n\r', ' ']);
  assert.strictEqual(f.ptt.state, 'in');
  assert.strictEqual(f.ptt.user, 'tester');
});
// back from the background (JJPtt.resume)
JJPtt.PROBE_MS = 60;
async function loggedIn(answers) {
  var f = fakePtt(LOGIN.slice());
  await f.ptt.login('tester', 'right');
  var send = f.app.conn.send;
  f.app.conn.send = function(k) {
    send.call(this, k);
    if (k === '\x0c' && answers) f.app.lastDataAt = Date.now();  // PTT redraws
  };
  f.typed.length = 0;
  return f;
}
testAsync('resume: back after a moment, nothing is sent', async function() {
  var f = await loggedIn(true);
  await f.ptt.resume(5000);
  assert.deepStrictEqual(f.typed, []);
  assert.strictEqual(f.ptt.state, 'in');
});
testAsync('resume: back after a while, PTT answers Ctrl-L -> stays in', async function() {
  var f = await loggedIn(true);
  await f.ptt.resume(10 * 60000);
  assert.deepStrictEqual(f.typed, ['\x0c']);
  assert.strictEqual(f.ptt.state, 'in');
});
testAsync('resume: back after a while, no answer -> logged in again', async function() {
  var f = await loggedIn(false);
  await f.ptt.resume(10 * 60000);
  assert.deepStrictEqual(f.typed, ['\x0c', 'tester\r', 'right\r', 'n\r', ' ']);
  assert.strictEqual(f.ptt.state, 'in');
});
testAsync('resume: the connection dropped while away -> logged in again', async function() {
  var f = await loggedIn(true);
  f.app.conn.isConnected = false;
  await f.ptt.resume(1000);
  assert.deepStrictEqual(f.typed, ['tester\r', 'right\r', 'n\r', ' ']);
  assert.strictEqual(f.ptt.state, 'in');
});
testAsync('resume: not logged in -> nothing', async function() {
  var f = fakePtt(LOGIN.slice());
  await f.ptt.resume(10 * 60000);
  assert.deepStrictEqual(f.typed, []);
});
testAsync('login: wrong password says so and is not logged in', async function() {
  var f = fakePtt(LOGIN);
  await assert.rejects(f.ptt.login('tester', 'wrong'), /帳號或密碼錯誤/);
  assert.notStrictEqual(f.ptt.state, 'in');
  assert.strictEqual(f.ptt.user, '');
});

testAsync('login: an account that starts in 【分類看板】 is logged in', async function() {
  var s = LOGIN.slice();
  s[4] = ['【分類看板】                    批踢踢實業坊\n  >  1   市民廣場   報告站長 PTT咬我\n分類看板  (m)加入最愛 (v)已讀/未讀 (t)標記 (y)只列最愛', {}];
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  assert.strictEqual(f.ptt.state, 'in');
});
testAsync('login: PTT opening an article after login (an announcement) is logged in', async function() {
  var s = LOGIN.slice();
  s[4] = ['※ [本文轉錄自 NTU_Service 看板]\n連署結束時間\n  瀏覽 第 1/2 頁 ( 71%)  目前顯示: 第 04~25 行 (y)回應(X)推文', {}];
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  assert.strictEqual(f.ptt.state, 'in');
});
testAsync('login: the 重複登入 question stays on the screen and is answered once', async function() {
  var s = LOGIN.slice();
  var q = '您想刪除其他重複登入的連線嗎？[Y/n]';
  s[2] = [q, { 'n\r': 6 }];
  s.push([q + ' n\n正在更新與同步線上使用者及好友名單', {}, { after: 60, to: 3 }]);  // 6: still there for a moment
  s[3] = ['請按任意鍵繼續', { ' ': 4, 'n\r': 99 }];
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  sameJson(f.typed.filter(function(k) { return k === 'n\r'; }), ['n\r']);
  assert.strictEqual(f.ptt.state, 'in');
});
testAsync('login: from where PTT put us, ← until the main menu', async function() {
  var s = LOGIN.slice();
  s[4] = ['  瀏覽 第 1/2 頁 ( 71%)  目前顯示: 第 04~25 行 (y)回應(X)推文', { '\x1b[D': 6 }];
  s.push(['【分類看板】      批踢踢實業坊\n分類看板  (m)加入最愛', { '\x1b[D': 7 }]);  // 6
  s.push(['【主功能表】 批踢踢實業坊', {}]);                                             // 7
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  assert.ok(/主功能表/.test(f.ptt.screen()), f.ptt.screen());
});
testAsync('login: in as soon as PTT takes the password, even if a later screen is unknown', async function() {
  var s = LOGIN.slice();
  s[4] = ['某個 App 不認得的畫面', {}];
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  assert.strictEqual(f.ptt.state, 'in');
  assert.strictEqual(f.ptt.user, 'tester');
});
testAsync('login: an old 「密碼不對或無此帳號」 still on the screen is not PTT\'s answer', async function() {
  var old = '密碼不對或無此帳號。請檢查大小寫及有無輸入錯誤。';
  var s = [
    [old + '\n請輸入代號，或以 guest 參觀，或以 new 註冊:', { 'tester\r': 'echo' }],
    [old + '\n請輸入代號，或以 guest 參觀，或以 new 註冊: tester\n請輸入您的密碼:', { 'right\r': 2 }],
    ['【主功能表】 批踢踢實業坊', {}]
  ];
  var f = fakePtt(s);
  f.app.buf.clear = function() {};  // the fake keeps its text, like a screen not cleared
  ECHO[0] = old + '\n請輸入代號，或以 guest 參觀，或以 new 註冊: tester';
  try {
    await f.ptt.login('tester', 'right');
  } finally {
    ECHO[0] = '請輸入代號，或以 guest 參觀，或以 new 註冊: tester';
  }
  assert.strictEqual(f.ptt.state, 'in');
});
testAsync('login: PTT\'s 「密碼不對或無此帳號」 after the password is a wrong password, with PTT\'s words', async function() {
  var s = LOGIN.slice();
  s[5] = ['請輸入代號: tester\n請輸入您的密碼:\n密碼不對或無此帳號。請檢查大小寫及有無輸入錯誤。', {}];
  var f = fakePtt(s);
  await assert.rejects(f.ptt.login('tester', 'wrong'), /帳號或密碼錯誤（PTT：密碼不對或無此帳號/);
});

var AID = JJPtt.aidFromUrl('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html');
function boardScript(after) {
  var main = 4;
  var s = LOGIN.slice(0, 6);  // keeps the numbering: 6 on are added below
  // like PTT: "s" does nothing in the main menu; 我的最愛 (a list) first
  s[main] = ['【主功能表】 批踢踢實業坊', { 'f': 'fav' }];
  s.fav = ['【 我 的 最愛 】\n   編號   看 板   類別   轉信  中   文   敘   述\n     1   Test   測試 ◎測試', { 's': 6 }];
  s.push(['請輸入看板名稱(按空白鍵自動搜尋):', { 'Test\r': 7 }]);                 // 6
  s.push(['請按任意鍵繼續（進板畫面）', { ' ': 8 }]);                                // 7
  s.push(['【板主:x】 看板《Test》 文章選讀', { '#': 9 }]);                        // 8
  s.push(['搜尋文章代碼(AID): #', {}]);                                            // 9
  s[9][1][AID + '\r'] = 10;
  s.push(['【板主:x】 看板《Test》 ●', after]);                                     // 10
  // Q: the 文章網址 under the cursor (the AID landed on the right one);
  // # again: the second jump (PTT's first one can land a few articles off)
  after.Q = 'qbox';
  after['#'] = 9;
  s.qbox = ['【板主:x】 看板《Test》 ●\n│ 文章網址: http://www.ptt.cc/bbs/Test/M.1451110159.A.379.html │\n請按任意鍵繼續', { ' ': 10 }];
  return s;
}

testAsync('push: to the board, the article by AID, X, 推, text, confirm', async function() {
  var s = boardScript({ 'X': 11 });
  s.push(['您覺得這篇文章 1.值得推薦 2.給它噓聲 3.只加→註解 [1]', { '1': 12 }]);    // 11
  s.push(['推 tester:', { '說得好': 14 }]);                                         // 12
  s.push(['確定[y/N]:', { 'y\r': 8 }]);                                             // 13
  s.push(['推 tester: 說得好', { '\r': 13 }]);                                       // 14
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.push('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '1', '說得好');
  assert.deepStrictEqual(f.typed, ['f', 's', 'Test\r', ' ', '#', AID + '\r', '#', AID + '\r', 'Q', ' ', 'X', '1', '說得好', '\r', 'y\r']);
});
// the backspaces typePush sends to erase s
function BS(s) { return new Array(JJPtt.big5Length(s) + 3).join('\b'); }
testAsync('push: what PTT\'s input already holds is erased before the text', async function() {
  var s = boardScript({ 'X': 11 });
  s.push(['您覺得這篇文章 1.值得推薦 2.給它噓聲 3.只加→註解 [1]', { '1': 12 }]);    // 11
  s.push(['推 tester: 26851', { '\b\b\b\b\b\b\b': 14 }]);                         // 12
  s.push(['確定[y/N]:', { 'y\r': 8 }]);                                             // 13
  s.push(['推 tester:', { '說得好': 15 }]);                                          // 14
  s.push(['推 tester: 說得好', { '\r': 13 }]);                                       // 15
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.push('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '1', '說得好');
  sameJson(f.typed.slice(-4), ['\b\b\b\b\b\b\b', '說得好', '\r', 'y\r']);
  assert.ok(/26851/.test(f.ptt.lastFailure.message));
});
testAsync('push: the input holding more than was typed is erased and typed again', async function() {
  var s = boardScript({ 'X': 11 });
  s.push(['您覺得這篇文章 1.值得推薦 2.給它噓聲 3.只加→註解 [1]', { '1': 12 }]);    // 11
  s.push(['推 tester:', { '說得好': 14 }]);                                          // 12
  s.push(['確定[y/N]:', { 'y\r': 8 }]);                                             // 13
  s.push(['推 tester: 1說得好', { [BS('1說得好')]: 15 }]);                  // 14: one more 1
  s.push(['推 tester:', { '說得好': 16 }]);                                          // 15
  s.push(['推 tester: 說得好', { '\r': 13 }]);                                       // 16
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.push('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '1', '說得好');
  sameJson(f.typed.slice(-5), ['說得好', BS('1說得好'), '說得好', '\r', 'y\r']);
});
testAsync('push: still more than was typed -> cancelled, nothing sent', async function() {
  var s = boardScript({ 'X': 11 });
  s.push(['您覺得這篇文章 1.值得推薦 2.給它噓聲 3.只加→註解 [1]', { '1': 12 }]);    // 11
  s.push(['推 tester:', { '說得好': 13 }]);                                          // 12
  s.push(['推 tester: 1說得好', { [BS('1說得好')]: 12, '\r': 99 }]);       // 13: always the 1
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await assert.rejects(f.ptt.push('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '1', '說得好'), /多了「1」，這次沒有送出/);
  assert.strictEqual(f.typed[f.typed.length - 1], '\r');
  assert.strictEqual(f.typed.filter(function(k) { return k === '\r'; }).length, 1);
});
test('push input: what is left after 「推 ID:」', function() {
  assert.strictEqual(JJPtt.pushInputLeft('看板\n推 Mikeeeee: 2685', 'mikeeeee'), '2685');
  assert.strictEqual(JJPtt.pushInputLeft('推 tester:   ', 'tester'), '');
  assert.strictEqual(JJPtt.pushInputLeft('推 other: hi', 'tester'), null);
});
testAsync('push: a board that does not allow it says so', async function() {
  var s = boardScript({ 'X': 11 });
  s.push(['本板禁止推薦', {}]);
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  await assert.rejects(f.ptt.push('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '1', 'x'), /不能推文/);
});
testAsync('push: not logged in -> asks to log in', async function() {
  var f = fakePtt(LOGIN);
  await assert.rejects(f.ptt.push('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '1', 'x'), /請先登入/);
});
testAsync('reply: y, to the board, same title, no quote, lines, Ctrl-X, save, signature', async function() {
  var s = boardScript({ 'y': 11 });
  s.push(['▲ 回應至 (F)看板 (M)作者信箱 (B)二者皆是 (Q)取消？[F]', { 'f\r': 12 }]);  // 11
  s.push(['採用原標題[Y/n]?', { 'y\r': 13 }]);                                       // 12
  s.push(['請問要引用原文嗎(Y/N/All/Repost/1-9)?[Y]', { 'n\r': 14 }]);               // 13
  s.push(['【 編輯文章 】 (^X)檔案處理', { '\x18': 15 }]);                           // 14
  s.push(['檔案處理: (S)存檔 (L)站內信 (A)放棄', { 's\r': 16 }]);                   // 15
  s.push(['請選擇簽名檔 (1-9, 0=不加 x=隨機)[0]:', { '0\r': 17 }]);                 // 16
  s.push(['順利貼出佈告，請按任意鍵繼續', { ' ': 8 }]);                              // 17
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.reply('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '第一行\n第二行', false);
  assert.deepStrictEqual(f.typed, ['f', 's', 'Test\r', ' ', '#', AID + '\r', '#', AID + '\r', 'Q', ' ', 'y', 'f\r', 'y\r', 'n\r',
                                   '第一行', '\r', '第二行', '\x18', 's\r', '0\r', ' ']);
});

testAsync('reply: an answered question stays on the screen and is not answered again', async function() {
  // the real PTT asks each question under the last one
  var q1 = '▲ 回應至 (F)看板 (M)作者信箱 (B)二者皆是 (Q)取消？[F] f';
  var q2 = q1 + '\n採用原標題[Y/n]? y';
  var s = boardScript({ 'y': 11 });
  s.push([q1.slice(0, -2), { 'f\r': 12 }]);                                           // 11
  s.push([q1 + '\n採用原標題[Y/n]?', { 'y\r': 13, 'f\r': 99 }]);                     // 12
  s.push([q2 + '\n請問要引用原文嗎(Y/N/All/Repost/1-9)?[Y]', { 'n\r': 14, 'f\r': 99, 'y\r': 99 }]);  // 13
  s.push(['【 編輯文章 】 (^Z/F1)說明 (^X/^Q)離開', { '\x18': 15 }]);                // 14
  s.push(['檔案處理: (S)存檔 (L)站內信 (A)放棄', { 's\r': 16 }]);                   // 15
  s.push(['順利貼出佈告，請按任意鍵繼續', { ' ': 8 }]);                              // 16
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.reply('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '嗨', false);
  sameJson(f.typed.slice(10), ['y', 'f\r', 'y\r', 'n\r', '嗨', '\x18', 's\r', ' ']);
});

test('發文 categories from the Ctrl-P screen', function() {
  sameJson(JJPtt.parsePostTypes('發表文章於【 Test 】 測試 看板\n種類：1.問題 2.建議 3.討論 4.心得 5.閒聊 6.請益 7.情報 8.公告 (1-8或不選)'),
           ['問題', '建議', '討論', '心得', '閒聊', '請益', '情報', '公告']);
  sameJson(JJPtt.parsePostTypes('種類：1.問卦 2.爆卦 (1-2或不選)'), ['問卦', '爆卦']);
  sameJson(JJPtt.parsePostTypes('沒有種類這一行'), []);
});

// The board list (screen 8) with Ctrl-P; its footer says (^X)轉錄, which is
// not the editor.
function postScript() {
  var s = boardScript({});
  s[8] = ['【板主:x】 看板《Test》\n文章選讀  (y)回應(X)推文(^X)轉錄 (=[]<>)相關主題', { '\x10': 11 }];
  var head = '發表文章於【 Test 】 測試 看板\n種類：1.問題 2.建議 3.閒聊 (1-3或不選)';
  s.push(['本板發文注意事項：請先看板規\n請按任意鍵繼續', { ' ': 12 }]);                  // 11
  s.push([head, {}]);                                                                     // 12: the category
  s.push([head + ' 3\n標題：', {}]);                                                       // 13: title, 種類 still there
  s.push(['【 編輯文章 】 (^Z/F1)說明 (^X/^Q)離開', { '\x18': 15 }]);                    // 14
  s.push(['檔案處理: (S)存檔 (L)站內信 (A)放棄', { 's\r': 16 }]);                       // 15
  s.push(['請選擇簽名檔 (1-9, 0=不加 x=隨機)[0]:', { '0\r': 17 }]);                     // 16
  s.push(['順利貼出佈告，請按任意鍵繼續', { ' ': 8 }]);                                  // 17
  return s;
}
testAsync('post: board, Ctrl-P, board rules, category by number, title, lines, save, signature', async function() {
  var s = postScript();
  s[12][1] = { '3\r': 13 };
  s[13][1] = { '測試發文\r': 14, '3\r': 99 };
  var f = fakePtt(s);
  var store = {};
  global.localStorage = { getItem: function(k) { return store[k] || null; }, setItem: function(k, v) { store[k] = v; } };
  try {
    await f.ptt.login('tester', 'right');
    f.typed.length = 0;
    await f.ptt.post('Test', '閒聊', '測試發文', '第一行\n\n第三行');
    sameJson(JJPtt.postTypes('test'), ['問題', '建議', '閒聊']);
  } finally {
    delete global.localStorage;
  }
  sameJson(f.typed, ['f', 's', 'Test\r', ' ', '\x10', ' ', '3\r', '測試發文\r',
                     '第一行', '\r', '\r', '第三行', '\x18', 's\r', '0\r', ' ']);
});
testAsync('post: a category the board does not have goes in front of the title', async function() {
  var s = postScript();
  s[12][1] = { '\r': 13 };
  s[13][1] = { '[自訂] 標題\r': 14 };
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.post('Test', '自訂', '標題', '內容');
  assert.ok(f.typed.indexOf('[自訂] 標題\r') >= 0, JSON.stringify(f.typed));
});
testAsync('post: a board that does not let this account post says so', async function() {
  var s = postScript();
  s[11] = ['對不起，您目前無法在此發表文章！', {}];
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  await assert.rejects(f.ptt.post('Test', '', '標題', '內容'), /不能在 Test 板發文/);
});
testAsync('post: needs a title and text', async function() {
  var f = fakePtt(LOGIN);
  await assert.rejects(f.ptt.post('Test', '', '', '內容'), /標題/);
  await assert.rejects(f.ptt.post('Test', '', '標題', '  '), /沒有內容/);
});

testAsync('push: s in 我的最愛 only moves the cursor onto the board -> → goes in', async function() {
  var s = boardScript({ 'X': 11 });
  // like the real PTT: after s + name, the cursor is on the board, not in it
  s[6] = ['請輸入看板名稱(按空白鍵自動搜尋):', { 'Test\r': 'cur' }];
  s.cur = ['【看板列表】   批踢踢實業坊\n   編號   看 板   類別   轉信  中   文   敘   述\n     1   MyFavFolder 目錄 □MLB\n>    2 ˇTest       測試 ◎測試', { '\x1b[C': 7 }];
  s.push(['您覺得這篇文章 1.值得推薦 2.給它噓聲 3.只加→註解 [1]', { '1': 12 }]);    // 11
  s.push(['推 tester:', { '讚': 14 }]);                                            // 12
  s.push(['確定[y/N]:', { 'y\r': 8 }]);                                             // 13
  s.push(['推 tester: 讚', { '\r': 13 }]);                                          // 14
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.push('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '1', '讚');
  assert.ok(f.typed.indexOf('\x1b[C') >= 0, JSON.stringify(f.typed));
  assert.ok(f.typed.indexOf('讚') >= 0, JSON.stringify(f.typed));
});

testAsync('push: the list header 看板《…》 is not the answer to the text -> the 確定 question is answered', async function() {
  var s = boardScript({ 'X': 11 });
  s.push(['【板主:x】 看板《Test》\n作者本人, 使用 → 加註方式\n→ tester:', { '滾蛋\r': 'sending' }]);  // 11
  s.sending = ['【板主:x】 看板《Test》\n作者本人, 使用 → 加註方式\n→ tester: 滾蛋', {}, { after: 60, to: 'sure' }];
  s.sure = ['【板主:x】 看板《Test》\n→ tester: 滾蛋\n確定要加入嗎？ [y/N]:', { 'y\r': 8 }];
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.push('https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html', '3', '滾蛋');
  assert.strictEqual(f.typed[f.typed.length - 1], 'y\r', JSON.stringify(f.typed));
});
function confirmScript(afterYes) {
  var s = boardScript({ 'X': 11 });
  var head = '【板主:x】 看板《Test》';
  s[10] = [head + '\n●   1 1/01 tester  □ 測試', { 'X': 11, 'Q': 'qbox', '#': 9 }];
  s.push([head + '\n●   1 1/01 tester  □ 測試\n作者本人, 使用 → 加註方式\n→ tester:', { '滾蛋\r': 'sure' }]);  // 11
  s.sure = [head + '\n●   1 1/01 tester  □ 測試\n→ tester: 滾蛋\n確定要加入嗎？ [y/N]:', { 'y\r': 'after' }];
  s.after = afterYes;
  return s;
}
var PUSH_URL = 'https://www.ptt.cc/bbs/Test/M.1451110159.A.379.html';
testAsync('push 確定: the Enter after y opened the article (瀏覽 第) -> pushed', async function() {
  var f = fakePtt(confirmScript([' 作者 tester\n→ tester: 滾蛋\n  瀏覽 第 1/1 頁 (100%)  (y)回應(X%)推文', {}]));
  await f.ptt.login('tester', 'right');
  await f.ptt.push(PUSH_URL, '3', '滾蛋');
});
testAsync('push 確定: the question gone, the list header unchanged -> pushed', async function() {
  var f = fakePtt(confirmScript(['【板主:x】 看板《Test》\n●   1 1/01 tester  □ 測試', {}]));
  await f.ptt.login('tester', 'right');
  await f.ptt.push(PUSH_URL, '3', '滾蛋');
});
testAsync('push 確定: PTT refuses (推文太快) -> its words, and the screen is kept', async function() {
  var f = fakePtt(confirmScript(['【板主:x】 看板《Test》\n●   1 1/01 tester  □ 測試\n推文太快，請稍候再試 請按任意鍵繼續', {}]));
  await f.ptt.login('tester', 'right');
  await assert.rejects(f.ptt.push(PUSH_URL, '3', '滾蛋'), /沒讓這則推文出去：推文太快/);
  assert.ok(/推文太快/.test(f.ptt.lastFailure.screen), f.ptt.lastFailure.screen);
});
testAsync('push 確定: an article line saying 不能 is not a refusal', async function() {
  var f = fakePtt(confirmScript([' 作者 tester\n我不能接受\n  瀏覽 第 1/1 頁 (100%)', {}]));
  await f.ptt.login('tester', 'right');
  await f.ptt.push(PUSH_URL, '3', '滾蛋');
});
testAsync('board: a push line left open on the bottom is emptied and closed before s', async function() {
  var s = LOGIN.slice(0, 4);
  var bs = new Array(81).join('\b') + '\r';
  s[4] = ['【板主:x】 看板《Other》\n[→]閱讀 [s]選擇看板\n作者本人, 使用 → 加註方式\n→ tester: 奢音', {}];
  s[4][1][bs] = 'list';
  s.list = ['【板主:x】 看板《Other》\n[→]閱讀 [s]選擇看板\n文章選讀 (y)回應(X)推文', { 's': 'prompt' }];
  s.prompt = ['【板主:x】 看板《Other》\n請輸入看板名稱(按空白鍵自動搜尋):', { 'Test\r': 'in' }];
  s.in = ['【板主:y】 看板《Test》 文章選讀', {}];
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.toBoard('Test');
  assert.deepStrictEqual(f.typed, [bs, 's', 'Test\r']);
});
testAsync('reader (extension): after X, back on the article -> waits for the push on the web, not the page from before', async function() {
  var h = { board: 'Test', author: 'a', title: 't', key: 'Test|a|t' };
  var r = Object.create(PttReader.prototype);
  var sent = [], fetched = [], shown = [], opened = 0, n = 0;
  r.app = { buf: { pageState: 3 }, conn: { send: function(k) { sent.push(k); } }, setInputAreaFocus: function() {} };
  r.enabled = true;
  r.available = function() { return true; };
  r.trackTerminal = function() { r.lastHeader = h; };
  r.headerFromTerminal = function() { return h; };
  r.close = function() {};
  r.render = function(a) { shown.push(a.pushes.length); };
  r.show = r.restorePosition = function() {};
  r.openFor = function() { opened++; };
  r.fetchArticle = function(url) {
    fetched.push(url);
    return Promise.resolve({ url: 'u', pushes: new Array(++n >= 2 ? 3 : 2) });
  };
  r.currentKey = h.key;
  r.article = { url: 'https://www.ptt.cc/bbs/Test/M.1.A.1.html', pushes: [1, 2] };
  var poll = PttReader.PUSH_POLL_MS;
  PttReader.PUSH_POLL_MS = 5;
  try {
    r.closeAndSend('X');
    r.app.buf.pageState = 0; r.onTerminalUpdate();  // the push prompt
    r.app.buf.pageState = 3; r.onTerminalUpdate();  // the article again
    r.onTerminalUpdate();                           // more redraws: one wait
    await new Promise(function(res) { setTimeout(res, 60); });
  } finally {
    PttReader.PUSH_POLL_MS = poll;
  }
  assert.deepStrictEqual(sent, ['X']);
  assert.strictEqual(opened, 0);
  assert.deepStrictEqual(shown, [3]);
  assert.strictEqual(fetched.length, 2);
  assert.ok(/M\.1\.A\.1\.html\?_=\d+$/.test(fetched[0]), fetched[0]);
});
testAsync('board prompt: waits for 請輸入看板名稱, not the list header\'s 「選擇看板」', async function() {
  // straight from the list of another board, the prompt shows only after a while
  var s = LOGIN.slice(0, 4);
  s[4] = ['【板主:x】 看板《Other》\n[→]閱讀 [s]選擇看板\n文章列表', { 's': 'opening' }];
  s.opening = ['【板主:x】 看板《Other》\n[→]閱讀 [s]選擇看板\n文章列表', {}, { after: 80, to: 'prompt' }];
  s.prompt = ['【板主:x】 看板《Other》\n[→]閱讀 [s]選擇看板\n請輸入看板名稱(按空白鍵自動搜尋):', { 'Test\r': 'in' }];
  s.in = ['【板主:y】 看板《Test》 文章選讀', {}];
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  await f.ptt.toBoard('Test');
  assert.deepStrictEqual(f.typed, ['s', 'Test\r']);
});

test('我的最愛 rows: board name and title; folders and lines skipped', function() {
  var b = JJPtt.parseBoardRow('     3 ˇGossiping    綜合 ◎[八卦] 亂講話                  爆! 板主a/板主b');
  assert.strictEqual(b.name, 'Gossiping');
  assert.strictEqual(b.title, '[八卦] 亂講話');
  assert.strictEqual(b.n, 3);
  assert.strictEqual(JJPtt.parseBoardRow('>    1   C_Chat      閒談 ◎[希洽] 孤獨搖滾        HOT abc').name, 'C_Chat');
  assert.strictEqual(JJPtt.parseBoardRow('     4   NewsFolder  目錄 Σ我的新聞資料夾'), null);
  assert.strictEqual(JJPtt.parseBoardRow('     5 ------------------------------------------'), null);
  assert.strictEqual(JJPtt.parseBoardRow('   編號   看 板   類別   轉信  中   文   敘   述'), null);
});
test('我的最愛 rows: folders 「目錄 □」 skipped; full titles cut before 爆!/HOT/人氣 and 板主', function() {
  assert.strictEqual(JJPtt.parseBoardRow('     1   MyFavFolder 目錄 □使用頻率較低'), null);
  assert.strictEqual(JJPtt.parseBoardRow('    18   MyFavFolder 目錄 □新的目錄'), null);
  var t = function(row) { return JJPtt.parseBoardRow(row).title; };
  assert.strictEqual(t('>    3 ˇGossiping   綜合 ◎[八卦] 板主"又"徵選 徵選文可回文…爆!ubcs/redDe…'), '[八卦] 板主"又"徵選 徵選文可回文…');
  assert.strictEqual(t('     9 ˇBaseball    棒球 ◎[棒球] 味全龍/軟銀鷹/釀酒人/三星獅爆!GreenChamb…'), '[棒球] 味全龍/軟銀鷹/釀酒人/三星獅');
  assert.strictEqual(t('    10 ˇNBA         NBA. ◎NBA 26-27賽季 傑梯已無法觸及龍布…爆!hasebe/jou…'), 'NBA 26-27賽季 傑梯已無法觸及龍布…');
  assert.strictEqual(t('     8 ˇSteam       平台 ◎本板禁止買賣合購代購代刷       HOThn9480412/…'), '本板禁止買賣合購代購代刷');
  assert.strictEqual(t('    11 ˇmarvel      生二 ◎[媽佛] 你吃了誰煮的麵             21 a6234709'), '[媽佛] 你吃了誰煮的麵');
  assert.strictEqual(t('     5 ˇC_Chat      閒談 ◎[希洽] 孤獨搖滾劇場版 2027上映    爆!daniel0527…'), '[希洽] 孤獨搖滾劇場版 2027上映');
  assert.strictEqual(JJPtt.parseBoardRow('    13   JOJO        日本 ◎SBR動畫版網飛熱烈放送中          wxes50608').name, 'JOJO');
});
testAsync('我的最愛: main menu, f, two pages, stops at the last one', async function() {
  var head = '【 我 的 最愛 】\n   編號   看 板   類別   轉信  中   文   敘   述\n';
  var page1 = head + [1, 2].map(function(i) { return '   ' + i + ' ˇBoard' + i + '      綜合 ◎[標題' + i + ']  中文' ; }).join('\n');
  var page2 = head + '   3   Stock       學術 ◎[股市] 股票板       爆! x\n   4   Folder      目錄 Σ資料夾';
  var s = LOGIN.slice(0, 6);
  // like the real main menu: its F item says 「我 的 最愛」; and the list
  // shows its header first, the rows a moment later
  s[4] = ['【主功能表】 批踢踢實業坊\n      (F)avorite     【 我 的 最愛 】', { 'f': 8 }];
  s.push([page1, { '\x1b[6~': 7 }]);              // 6
  s.push([page2, { '\x1b[6~': 7, '\x1b[D': 4 }]);  // 7: last page stays
  s.push([head, {}, { after: 300, to: 6 }]);         // 8: header only, rows come later
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  f.typed.length = 0;
  var boards = await f.ptt.favorites();
  sameJson(boards.map(function(b) { return b.name; }), ['Board1', 'Board2', 'Stock']);
  assert.strictEqual(boards[2].title, '[股市] 股票板');
  sameJson(f.typed, ['f', '\x1b[6~', '\x1b[6~', '\x1b[D']);
});

testAsync('我的最愛: F only moves the menu cursor -> → goes in', async function() {
  var head = '【 我 的 最愛 】\n   編號   看 板   類別   轉信  中   文   敘   述\n';
  var page = head + '   1 ˇGossiping   綜合 ◎[八卦] 亂講話   爆! x';
  var s = LOGIN.slice(0, 6);
  s[4] = ['【主功能表】 批踢踢實業坊\n      (F)avorite     【 我 的 最愛 】', { 'f': 6 }];
  s.push(['【主功能表】 批踢踢實業坊\n    > (F)avorite     【 我 的 最愛 】', { '\x1b[C': 7 }]);  // 6: cursor moved
  s.push([page, { '\x1b[6~': 7, '\x1b[D': 4 }]);                                          // 7
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  var boards = await f.ptt.favorites();
  sameJson(boards.map(function(b) { return b.name; }), ['Gossiping']);
});
testAsync('我的最愛 with folders: each folder\'s boards where the folder was, named after it', async function() {
  var head = '【 我 的 最愛 】\n   編號   看 板   類別   轉信  中   文   敘   述\n';
  var top = head + ['     1   MyFavFolder 目錄 □MLB',
                    '     2 ˇGossiping   綜合 ◎[八卦] 亂講話   爆! x',
                    '     3   MyFavFolder 目錄 □新的目錄',
                    '     4 ˇStock       學術 ◎[股市] 股票板   爆! y'].join('\n');
  var s = LOGIN.slice(0, 6);
  s[4] = ['【主功能表】 批踢踢實業坊', { 'f': 6 }];
  s.push([top, { '\x1b[6~': 6, '1\r': 7, '3\r': 9, '\x1b[D': 4 }]);                 // 6: one page
  s.push([top.replace('     1 ', '>    1 '), { '\x1b[C': 8 }]);                     // 7: cursor on 1
  s.push([head + '     1 ˇMLB         棒球 ◎[MLB] 大聯盟   12 z', { '\x1b[6~': 8, '\x1b[D': 6 }]);  // 8: inside MLB
  s.push([top.replace('     3 ', '>    3 '), { '\x1b[C': 10 }]);                    // 9: cursor on 3
  s.push([head, { '\x1b[6~': 10, '\x1b[D': 6 }]);                                     // 10: empty folder
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  var boards = await f.ptt.favorites();
  sameJson(boards, [{ name: 'MLB', title: '[MLB] 大聯盟', folder: 'MLB' },
                    { name: 'Gossiping', title: '[八卦] 亂講話' },
                    { name: 'Stock', title: '[股市] 股票板' }]);
});
testAsync('a failed job keeps the screen it failed on', async function() {
  var s = LOGIN.slice(0, 6);
  s[4] = ['【主功能表】 批踢踢實業坊', {}];  // F does nothing at all
  var f = fakePtt(s);
  await f.ptt.login('tester', 'right');
  await assert.rejects(f.ptt.favorites());
  assert.ok(f.ptt.lastFailure && /主功能表/.test(f.ptt.lastFailure.screen));
});

// ---- settings defaults ----------------------------------------------------------

console.log('settings');

test('every fact-check rule has a default in DEFAULT_PREFS', function() {
  Object.keys(FactCheck.DEFAULTS).forEach(function(k) {
    assert.ok(k in DEFAULT_PREFS, k + ' missing from predefined_config.js');
    assert.strictEqual(DEFAULT_PREFS[k], FactCheck.DEFAULTS[k], k + ' defaults differ');
  });
});
test('every fact-check rule has a place in the settings page', function() {
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  Object.keys(FactCheck.DEFAULTS).forEach(function(k) {
    assert.ok(html.indexOf('id="opt_' + k + '"') >= 0, k + ' missing from index.html');
  });
});
test('every fact-check rule has Chinese and English text', function() {
  var zh = fs.readFileSync(path.join(root, 'js/zh_TW_messages.js'), 'utf8');
  var en = fs.readFileSync(path.join(root, 'js/en_US_messages.js'), 'utf8');
  Object.keys(FactCheck.DEFAULTS).forEach(function(k) {
    assert.ok(zh.indexOf('"options_' + k + '"') >= 0, k + ' missing from zh_TW_messages.js');
    assert.ok(en.indexOf('"options_' + k + '"') >= 0, k + ' missing from en_US_messages.js');
  });
});

test('custom-list (網軍) pushers get no image thumbnails, like the blacklist (also inside 連推 runs)', function() {
  // runs reuse these push nodes, so the rule covers their floors too
  var desk = PttReader.prototype.renderPushes.toString();
  assert.ok(/if \(blackListed \|\| id in notes\) return;/.test(desk), 'reader shows thumbnails for custom-list users');
  assert.ok(desk.indexOf('var notes =') < desk.indexOf('id in notes) return'), 'notes read before the thumbnails');
  var app = JJMobile.prototype.pushInfo.toString();
  assert.ok(/if \(!black && !\(id in notes\)\)/.test(app), 'app shows thumbnails for custom-list users');
});

test('custom list: the label uses the user\'s own list name; fading is a setting, off by default', function() {
  assert.strictEqual(DEFAULT_PREFS.customListFade, false, 'fading the custom list is opt-in');
  var pref = makePref({ customListName: '幹他媽網軍' });
  pref.notedUserIds = { z2wen: '', abc: '帶風向' };
  assert.strictEqual(pref.customListLabel('Z2wen'), '幹他媽網軍');
  assert.strictEqual(pref.customListLabel('abc', '：'), '幹他媽網軍：帶風向');
  assert.strictEqual(pref.customListLabel('nobody'), '');
  assert.strictEqual(pref.fadesNoted('z2wen'), false);
  pref.values.customListFade = true;
  assert.strictEqual(pref.fadesNoted('z2wen'), true);
  assert.strictEqual(pref.fadesNoted('nobody'), false);
  pref.values.customListEnabled = false;
  assert.strictEqual(pref.customListLabel('z2wen'), '', 'list off: no label');
  assert.strictEqual(pref.fadesNoted('z2wen'), false, 'list off: not faded');
  ['index.html', 'extension/app.html'].forEach(function(f) {
    assert.ok(fs.readFileSync(path.join(root, f), 'utf8').indexOf('id="opt_customListFade"') >= 0, f + ' has no field');
  });
  var zh = fs.readFileSync(path.join(root, 'js/zh_TW_messages.js'), 'utf8');
  var en = fs.readFileSync(path.join(root, 'js/en_US_messages.js'), 'utf8');
  assert.ok(zh.indexOf('"options_customListFade"') >= 0 && en.indexOf('"options_customListFade"') >= 0);
});
test('custom list: the 連推 line shows the list name on the right, like a single push (and in the app)', function() {
  var desk = PttReader.prototype.runNode.toString();
  assert.ok(/customListLabel\(sum\.id\)/.test(desk) && /jjt-itag-note/.test(desk), 'reader 連推 line has no list name');
  var app = JJMobile.prototype.runRow.toString();
  assert.ok(/customListLabel\(sum\.id/.test(app) && /jjm-pchip-note/.test(app), 'app 連推 row has no list name');
  assert.ok(/fadesNoted\(id\)/.test(PttReader.prototype.renderPushes.toString()), 'reader does not fade the custom list');
  assert.ok(/fadesNoted\(id\)/.test(JJMobile.prototype.pushInfo.toString()), 'app does not fade the custom list');
});
test('reader: space past the end of the last article goes back to the list, not to the same article in the terminal', function() {
  var sent = [], opened = [];
  var r = Object.create(PttReader.prototype);
  var h = { board: 'Gossiping', author: 'ztopip', title: '[新聞]翡翠' };
  var key = h.board + '|' + h.author + '|' + h.title;
  r.enabled = true;
  r.currentKey = key; r.loadingKey = ''; r.dismissedKey = '';
  r.listSnap = { board: 'Gossiping', rows: [{}, {}], index: 1 };
  r.app = { buf: { pageState: 3 }, conn: { send: function(k) { sent.push(k); } } };
  r.available = function() { return true; };
  r.trackTerminal = function() {};
  r.dismiss = function() { this.dismissedKey = this.currentKey; this.currentKey = ''; };
  r.openFor = function(hh, k) { opened.push(k); };
  r.headerFromTerminal = function() { return h; };
  r.closeAndSend(PttReader.KEYS_NEXT);  // the last article: PTT reopens the same one
  r.onTerminalUpdate();
  sameJson(sent, [PttReader.KEYS_NEXT, '\x1b[D']);
  assert.strictEqual(r.listSnap.index, 1, 'list position moved past the end');
  // a real next article opens in reading mode as before
  sent = [];
  r.app.buf.pageState = 2; r.onTerminalUpdate();
  r.app.buf.pageState = 3; r.currentKey = key;
  r.closeAndSend(PttReader.KEYS_NEXT);
  h = { board: 'Gossiping', author: 'other', title: '[問卦]下一篇' };
  r.onTerminalUpdate();
  sameJson(sent, [PttReader.KEYS_NEXT]);
  sameJson(opened, ['Gossiping|other|[問卦]下一篇']);
});

// ---- classic window frames (js/frame_style.js) ----------------------------
console.log('extension update bar');
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/updater.js'), 'utf8'), { filename: 'js/updater.js' });
test('update bar: closed with × for a version, it does not come back for that version (each check, opening settings)', function() {
  var store = {};
  global.localStorage = { getItem: function(k) { return k in store ? store[k] : null; }, setItem: function(k, v) { store[k] = String(v); } };
  try {
    var u = Object.create(JJUpdater.prototype);
    var bars = [];
    u.running = function() { return '1.35.1'; };
    u.setStatus = u.startPolling = u.stopPolling = u.hideBar = function() {};
    u.app = { showToast: function() {} };
    var close = null;
    u.showBar = function(text, btn, action, version) {
      bars.push(version);
      close = function() { localStorage.setItem(JJUpdater.CLOSED_KEY, version); };  // what × does
    };
    u.diskVersion = '1.35.1';
    u.remoteVersion = '1.35.2';
    u.refresh(false);
    sameJson(bars, ['1.35.2']);
    close();
    u.refresh(false);
    sameJson(bars, ['1.35.2'], 'not again for 1.35.2');
    u.refresh(true);
    sameJson(bars, ['1.35.2', '1.35.2'], 'the settings button still shows it');
    u.remoteVersion = '1.35.3';
    u.refresh(false);
    sameJson(bars, ['1.35.2', '1.35.2', '1.35.3'], 'a newer version is shown again');
  } finally {
    delete global.localStorage;
  }
});
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/frame_style.js'), 'utf8'), { filename: 'js/frame_style.js' });
test('視窗風格: setting, choices, page fields and text in both languages', function() {
  assert.strictEqual(DEFAULT_PREFS.frameStyle, 0, 'plain (all black) stays the default');
  assert.strictEqual(PREF_OPTIONS.frameStyle.length, JJFrame.STYLES.length);
  var zh = fs.readFileSync(path.join(root, 'js/zh_TW_messages.js'), 'utf8');
  var en = fs.readFileSync(path.join(root, 'js/en_US_messages.js'), 'utf8');
  ['options_frameStyle', 'frame_wip', 'frame_connecting', 'frame_motto', 'frame_online', 'frame_offline'].concat(PREF_OPTIONS.frameStyle).forEach(function(k) {
    assert.ok(zh.indexOf('"' + k + '"') >= 0, k + ' missing from zh_TW_messages.js');
    assert.ok(en.indexOf('"' + k + '"') >= 0, k + ' missing from en_US_messages.js');
  });
  assert.strictEqual(i18n('frame_wip'), '施工中');
  ['index.html', 'dev.html'].forEach(function(f) {
    assert.ok(fs.readFileSync(path.join(root, f), 'utf8').indexOf('id="opt_frameStyle"') >= 0, f + ' has no 視窗風格 field');
  });
});
test('視窗風格: frame_style.js is built and loaded like the other files', function() {
  var grunt = fs.readFileSync(path.join(root, 'Gruntfile.js'), 'utf8');
  assert.strictEqual(grunt.split("'js/frame_style.js'").length - 1, 2, 'needs to be in concat.js and jshint.files');
  assert.ok(fs.readFileSync(path.join(root, 'dev.html'), 'utf8').indexOf('js/frame_style.js') >= 0);
});
test('視窗風格: styles by number, no frame means no offset', function() {
  assert.strictEqual(JJFrame.styleFor(0), '');
  assert.strictEqual(JJFrame.styleFor(1), 'netterm');
  assert.strictEqual(JJFrame.styleFor('1'), 'netterm');
  assert.strictEqual(JJFrame.styleFor(2), 'kkman');
  assert.strictEqual(JJFrame.styleFor(7), '');
  assert.deepStrictEqual(JJFrame.insets(), { top: 0, left: 0, right: 0, bottom: 0 });
});
test('視窗風格: mouse positions, the terminal size and the reader allow for the frame', function() {
  var src = fs.readFileSync(path.join(root, 'js/pttchrome.js'), 'utf8');
  var c2p = src.slice(src.indexOf('prototype.clientToPos'), src.indexOf('prototype.onMouse_click'));
  assert.ok(/cX -= f\.left/.test(c2p) && /cY -= f\.top/.test(c2p), 'clientToPos ignores the frame');
  var gib = src.slice(src.indexOf('prototype.getWindowInnerBounds'), src.indexOf('prototype.getFirstGridOffsets'));
  assert.ok(/f\.left - f\.right/.test(gib) && /f\.top - f\.bottom/.test(gib), 'terminal size ignores the frame');
  var lay = PttReader.prototype.layout.toString();
  assert.ok(lay.indexOf('window.innerWidth - (rect.left') < 0, 'reader places itself by the window');
  // render() lays the overlay out before show(): its box is still empty then
  assert.ok(/getComputedStyle\(o\)/.test(lay) && !/o\.getBoundingClientRect\(\)/.test(lay), 'reader reads its place from a hidden box');
});
test('視窗風格 KKMan: 連線時間 counts from the connection, tabs are the two sites', function() {
  assert.strictEqual(JJFrame.upTime(0, 5000), '0:00:00', 'not connected');
  assert.strictEqual(JJFrame.upTime(1000, 1000 + 3723 * 1000 + 400), '1:02:03');
  var html = JJFrame.kkmanHtml();
  ['ptt.cc', 'ptt2.cc'].forEach(function(site) { assert.ok(html.indexOf('data-site="' + site + '"') >= 0, site + ' tab missing'); });
  ['jjf-hole', 'jjf-up', 'jjf-clock', 'jjf-addr', 'jjf-led'].forEach(function(c) { assert.ok(html.indexOf(c) >= 0, c + ' missing'); });
  var realNow = Date.now;
  try {
    Date.now = function() { return 42; };
    JJFrame.onConnect();
    assert.strictEqual(JJFrame.connectedAt, 42);
    JJFrame.onClose();
    assert.strictEqual(JJFrame.connectedAt, 0, 'the clock keeps running after a disconnect');
  } finally { Date.now = realNow; }
});
test('視窗風格 KKMan: the welcome screen says 花魁異色館 in big letters, rules below', function() {
  assert.strictEqual(JJFrame.KK_SPLASH.title, '花魁異色館', 'the owner asked for 花魁異色館');
  var html = JJFrame.kkSplashHtml();
  ['jjf-name', 'jjf-code', 'jjf-rules', '【花魁異色館】'].forEach(function(c) { assert.ok(html.indexOf(c) >= 0, c + ' missing'); });
  JJFrame.KK_SPLASH.rules.forEach(function(l, i) { assert.ok(html.indexOf('<b>' + i + '.</b><span>' + l) >= 0); });
});
test('視窗風格: the welcome screen goes on the first data, at most once', function() {
  var calls = [];
  var realSetTimeout = global.setTimeout;
  global.setTimeout = function(fn, ms) { calls.push(ms); };
  try {
    JJFrame.splashWaiting = true;
    JJFrame.splashShownAt = Date.now();
    JJFrame.onData();
    JJFrame.onData();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(JJFrame.SPLASH_MS, 3000, 'the owner asked for 3 seconds');
    assert.ok(calls[0] > 2900 && calls[0] <= 3000, 'shown 3 seconds first');
  } finally { global.setTimeout = realSetTimeout; JJFrame.splashWaiting = false; }
});
test('視窗風格: a failed connection drops the welcome screen so the error shows', function() {
  var removed = false;
  JJFrame.splashEl = { parentNode: { removeChild: function() { removed = true; } } };
  JJFrame.splashWaiting = true;
  JJFrame.onClose();
  assert.ok(removed, 'welcome screen still covers the connection error');
  assert.strictEqual(JJFrame.splashEl, null);
  assert.strictEqual(JJFrame.splashWaiting, false);
  var src = fs.readFileSync(path.join(root, 'js/pttchrome.js'), 'utf8');
  var onClose = src.slice(src.indexOf('prototype.onClose'), src.indexOf('prototype.sendData'));
  assert.ok(/JJFrame\.onClose\(\)/.test(onClose), 'App.onClose does not tell the frame');
});

// The real case (Gossiping, 11/17): PTT cut orange7's URL at the end of a
// full push and put the rest in the next one.
var splitPushes = [
  { id: 'TOEY', content: '能自己坦白錯誤很好，但是男性跟正常女性還' },
  { id: 'orange7', content: 'https://houde-lawyer.com/%E6%9D%8E%E6%' },
  { id: 'orange7', content: '83%A0%E6%9A%84/' },
  { id: 'orange7', content: '也差太多了吧' }
];
var splitWhole = 'https://houde-lawyer.com/%E6%9D%8E%E6%83%A0%E6%9A%84/';

test('split URL: a URL cut at the end of a full push is joined with the next push', function() {
  var j = SplitUrl.joins(splitPushes);
  assert.ok(!j[0], 'a push without a URL');
  assert.deepStrictEqual(j[1], { url: splitWhole, first: true });
  assert.deepStrictEqual(j[2], { url: splitWhole, tail: '83%A0%E6%9A%84/' });
  assert.ok(!j[3], 'the push after the URL is not part of it');
  // three lines: the middle one is all URL and full again
  var mid = 'abcdefghij%E6%9D%8E%E6%83%A0%E6%9A%84/abcd';  // 7 + 42 >= 44
  var three = SplitUrl.joins([
    { id: 'orange7', content: 'https://houde-lawyer.com/%E6%9D%8E%E6%' },
    { id: 'orange7', content: mid },
    { id: 'orange7', content: 'xyz/1 看這個' }
  ]);
  assert.strictEqual(three[0].url, 'https://houde-lawyer.com/%E6%9D%8E%E6%' + mid + 'xyz/1');
  assert.strictEqual(three[2].tail, 'xyz/1');
});

test('split URL: not joined when the push is not full, the user changes, or the reply is a word', function() {
  var short = 'https://i.imgur.com/abc.jpg';
  assert.strictEqual(SplitUrl.joins([{ id: 'orange7', content: short }, { id: 'orange7', content: '123/' }]).length, 0, 'short push');
  assert.strictEqual(SplitUrl.joins([splitPushes[1], { id: 'TOEY', content: '83%A0%E6%9A%84/' }]).length, 0, 'other user');
  assert.strictEqual(SplitUrl.joins([splitPushes[1], { id: 'orange7', content: 'XD' }]).length, 0, '"XD" is not a URL');
  assert.strictEqual(SplitUrl.joins([splitPushes[1], { id: 'orange7', content: 'https://a.com/' }]).length, 0, 'a new URL');
  assert.strictEqual(SplitUrl.joins([splitPushes[1], { id: 'orange7', content: '對啊' }]).length, 0, 'text');
});

test('split URL: reading mode and the app link both parts to the whole URL', function() {
  var st = { fg: 3, bg: 0, hl: false, href: '' };
  var j = SplitUrl.joins(splitPushes);
  var a = PttReader.pushSegs(splitPushes[1].content, j[1], st, ':');
  assert.deepStrictEqual(a.map(function(s) { return [s.text, s.st.href]; }),
    [[':', ''], ['https://houde-lawyer.com/%E6%9D%8E%E6%', splitWhole]]);
  var b = PttReader.pushSegs('83%A0%E6%9A%84/ 這篇', j[2], st);
  assert.deepStrictEqual(b.map(function(s) { return [s.text, s.st.href]; }),
    [['83%A0%E6%9A%84/', splitWhole], [' 這篇', '']]);
  assert.ok(b[0].tail, 'the rest of a URL would show its picture twice');
  var plain = PttReader.pushSegs('哈哈', undefined, st, ':');
  assert.deepStrictEqual(plain.map(function(s) { return s.text; }), [':', '哈哈']);
  ['js/reader.js', 'js/mobile_article.js'].forEach(function(f) {
    var src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(/lineNode\(PttReader\.pushSegs\(p\.content, (join|urlJoins\[i\])/.test(src), f + ' does not join split URLs');
  });
  assert.ok(/!seg\.tail/.test(PttReader.prototype.lineNode.toString()), 'the rest of a URL is counted as a picture');
});

test('split URL: the whole URL gets its thumbnail or link card, and is the one fetched ahead', function() {
  var j = SplitUrl.joins(splitPushes);
  assert.ok(PttReader.pushMedia(splitWhole, j[1]), 'a joined web page gets no card');
  assert.ok(!PttReader.pushMedia('https://houde-lawyer.com/x', undefined), 'a plain web page link in a push gets a card');
  assert.ok(PttReader.pushMedia('https://i.imgur.com/abcdefg.jpg', undefined), 'pictures in pushes');
  ['js/reader.js', 'js/mobile_article.js'].forEach(function(f) {
    var src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(/PttReader\.pushMedia\(u, (join|urlJoins\[i\])\)/.test(src), f + ' shows only pictures under pushes');
  });
  var fetched = [], realImage = global.Image;
  global.Image = function() {};
  try {
    var article = { pushes: splitPushes, text: splitPushes.map(function(p) { return p.content; }).join('\n') };
    PttReader.prototype.preloadMedia.call({
      preloadImages: function() { return true; },
      displaySrc: function(s) { return s; },
      previewPermission: function() { return { then: function(f) { f(true); } }; },
      fetchPreview: function(u) { fetched.push(u); return { then: function() {} }; }
    }, article);
  } finally { global.Image = realImage; }
  assert.deepStrictEqual(fetched, [splitWhole], 'the cut URL is fetched (HTTP 400) instead of the whole one');
});

test('reader: a picture refused without a referrer (i.verb.tw, 403) is tried once more with one', function() {
  var attrs = { src: 'https://i.verb.tw/ck58LPU3.jpg' }, sets = [];
  var im = { referrerPolicy: 'no-referrer', style: {},
    getAttribute: function(k) { return attrs[k]; },
    removeAttribute: function(k) { delete attrs[k]; },
    setAttribute: function(k, v) { attrs[k] = v; sets.push(v); } };
  var onError = PttReader.imageRetry(im);
  onError();
  assert.strictEqual(im.referrerPolicy, 'strict-origin-when-cross-origin', 'not retried with a referrer');
  assert.deepStrictEqual(sets, ['https://i.verb.tw/ck58LPU3.jpg'], 'not loaded again');
  assert.notStrictEqual(im.style.display, 'none', 'hidden before the retry');
  onError();
  assert.strictEqual(im.style.display, 'none', 'a picture that fails twice stays on screen');
  assert.strictEqual(sets.length, 1, 'retried more than once');
  var src = fs.readFileSync(path.join(root, 'js/reader.js'), 'utf8');
  assert.ok(/addEventListener\('error', PttReader\.imageRetry\(im\)\)/.test(src), 'article / push pictures are not retried');
  assert.ok((src.match(/PttReader\.imageRetry\(/g) || []).length >= 3, 'hover preview and link-card pictures are not retried');
});

test('YouTube links: Shorts, phone, live and watch?…&v= are videos too', function() {
  var id = function(u) { return u.parseYoutubeUrl(); };
  assert.strictEqual(id('https://youtube.com/shorts/0tGN0HRUZkQ?si=p1eJoQZWfmEUPoHW'), '0tGN0HRUZkQ');
  assert.strictEqual(id('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(id('https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(id('https://youtu.be/dQw4w9WgXcQ?t=30'), 'dQw4w9WgXcQ');
  assert.strictEqual(id('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(id('https://www.youtube.com/@channel'), null);
  assert.strictEqual(id('https://example.com/?u=https://youtu.be/dQw4w9WgXcQ'), null, 'a YouTube URL inside another one');
  assert.ok(PttReader.pushMedia('https://youtube.com/shorts/0tGN0HRUZkQ'), 'videos in pushes get no thumbnail');
});

test('short links in pushes: a card only when they lead to YouTube', function() {
  assert.ok(PttReader.isShortLink('https://reurl.cc/mzVaZl'));
  assert.ok(PttReader.isShortLink('https://bit.ly/3abcDEF'));
  assert.ok(!PttReader.isShortLink('https://reurl.cc/'), 'the site itself');
  assert.ok(!PttReader.isShortLink('https://ppt.cc/fAbcd'), 'ppt.cc is a picture host');
  assert.ok(!PttReader.isShortLink('https://example.com/abc'));
  // the reurl.cc page (11/17): the target is in a hidden field
  var reurl = { querySelector: function(sel) {
    return /input/.test(sel) ? { getAttribute: function() { return 'https://youtube.com/shorts/0tGN0HRUZkQ?si=p1eJoQZWfmEUPoHW'; } } : null;
  } };
  assert.strictEqual(PttReader.pageTarget(reurl, '').parseYoutubeUrl(), '0tGN0HRUZkQ');
  var none = { querySelector: function() { return null; } };
  assert.strictEqual(PttReader.pageTarget(none, '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">x</a>').parseYoutubeUrl(), 'dQw4w9WgXcQ');
  assert.strictEqual(PttReader.pageTarget(none, '<p>nothing</p>'), '');
  assert.ok(/PttReader\.pageTarget\(doc, html\)/.test(PttReader.prototype.fetchPreview.toString()), 'previews do not look for the target');

  // fake DOM for the cards
  var mk = function(tag, cls) {
    var kids = [], classes = (cls || '').split(' ').filter(Boolean), attrs = {};
    var n = { tagName: tag, style: {}, childNodes: kids, parentNode: null,
      get className() { return classes.join(' '); }, set className(v) { classes = String(v).split(' ').filter(Boolean); },
      classList: { contains: function(c) { return classes.indexOf(c) >= 0; }, add: function(c) { if (classes.indexOf(c) < 0) classes.push(c); },
                   remove: function(c) { classes = classes.filter(function(x) { return x !== c; }); } },
      setAttribute: function(k, v) { attrs[k] = v; }, getAttribute: function(k) { return attrs[k]; },
      addEventListener: function() {},
      appendChild: function(c) { c.parentNode = n; kids.push(c); return c; },
      insertBefore: function(c, ref) { c.parentNode = n; var i = kids.indexOf(ref); kids.splice(i < 0 ? 0 : i, 0, c); return c; },
      removeChild: function(c) { kids.splice(kids.indexOf(c), 1); c.parentNode = null; },
      querySelector: function(sel) {
        var want = sel.replace(/^\./, ''), found = null;
        (function walk(list) { list.forEach(function(k) { if (!found && k.classList.contains(want)) found = k; if (!found) walk(k.childNodes); }); })(kids);
        return found;
      } };
    return n;
  };
  var realDoc = global.document;
  global.document = { createElement: function(tag) { return mk(tag); } };
  try {
    var shortCard = function() {
      var wrap = mk('div', 'jjr-media'), page = mk('div');
      page.appendChild(wrap);
      var card = mk('a', 'jjr-card jjr-short');
      card.setAttribute('data-preview-url', 'https://reurl.cc/mzVaZl');
      var text = mk('div', 'jjr-card-text');
      text.appendChild(mk('div', 'jjr-card-host'));
      card.appendChild(text);
      wrap.appendChild(card);
      return { page: page, wrap: wrap, card: card };
    };
    var answer = function(info) { return { fetchPreview: function() { return { then: function(f) { f(info); } }; }, displaySrc: function(s) { return s; } }; };
    var yt = shortCard();
    PttReader.prototype.fillCard.call(answer({ title: '- YouTube', youtube: '0tGN0HRUZkQ' }), yt.card);
    assert.ok(yt.card.classList.contains('jjr-yt') && !yt.card.classList.contains('jjr-short'), 'short link to YouTube not shown as a video');
    var box = yt.card.querySelector('.jjr-yt-thumb');
    assert.ok(box, 'no thumbnail');
    assert.strictEqual(box.childNodes[0].src, 'https://i.ytimg.com/vi/0tGN0HRUZkQ/hqdefault.jpg');
    assert.ok(box.querySelector('.jjr-yt-play'), 'no YouTube play button on the thumbnail');
    assert.strictEqual(yt.card.querySelector('.jjr-card-host').textContent, 'YouTube');
    var other = shortCard();
    PttReader.prototype.fillCard.call(answer({ title: 'Some shop', image: 'https://x/y.jpg' }), other.card);
    assert.strictEqual(other.page.childNodes.length, 0, 'short link that is not a video still has a card');
    // in the article body a short link keeps its usual card
    var src = PttReader.prototype.linkBlock.toString();
    assert.ok(/inPush && PttReader\.isShortLink\(url\)/.test(src), 'short links in the article lose their card');
    // a YouTube card drawn directly also has the play button
    var direct = PttReader.ytThumb('dQw4w9WgXcQ');
    assert.ok(direct.querySelector('.jjr-yt-play'));
  } finally { global.document = realDoc; }
  var css = fs.readFileSync(path.join(root, 'css/main.css'), 'utf8');
  assert.ok(/\.jjr-yt-play \{[^}]*position: absolute/.test(css) && /\.jjr-yt-play::after/.test(css), 'play button has no style');
  ['js/reader.js', 'js/mobile_article.js'].forEach(function(f) {
    assert.ok(/linkBlock\(u, true, true\)/.test(fs.readFileSync(path.join(root, f), 'utf8')), f + ': push media not marked as in a push');
  });
});

test('imgur album in a push: shown as its first picture, not an empty card', function() {
  assert.ok(PttReader.isImgurAlbum('https://imgur.com/a/gj1g3yJ'));
  assert.ok(PttReader.isImgurAlbum('https://imgur.com/gallery/some-title-gj1g3yJ'));
  assert.ok(PttReader.isImgurAlbum('https://m.imgur.com/a/gj1g3yJ'));
  assert.ok(!PttReader.isImgurAlbum('https://imgur.com/gj1g3yJ'), 'a single picture is not an album');
  assert.ok(!PttReader.isImgurAlbum('https://i.imgur.com/59qIm1A.jpeg'));
  assert.ok(PttReader.pushMedia('https://imgur.com/a/gj1g3yJ'), 'albums get nothing under the push');
  assert.strictEqual(PttReader.albumPicture('https://i.imgur.com/59qIm1A.jpeg?fb'), 'https://i.imgur.com/59qIm1A.jpeg', 'the Facebook crop is shown');
  // the card is replaced by the picture once the album page is read
  var replaced = null;
  var card = { classList: { contains: function(c) { return c === 'jjr-imgur-album'; }, add: function() {} },
    getAttribute: function() { return 'https://imgur.com/a/gj1g3yJ'; },
    parentNode: { replaceChild: function(n) { replaced = n; } } };
  var realDoc = global.document;
  global.document = { createElement: function(tag) {
    var a = {};
    return { tagName: tag, style: {}, setAttribute: function(k, v) { a[k] = v; }, getAttribute: function(k) { return a[k]; },
             addEventListener: function() {}, appendChild: function() {} };
  } };
  try {
    PttReader.prototype.fillCard.call({
      displaySrc: function(s) { return PttReader.lowResSrc(s); },
      fetchPreview: function() { return { then: function(f) { f({ title: 'imgur.com', image: 'https://i.imgur.com/59qIm1A.jpeg?fb' }); } }; }
    }, card);
  } finally { global.document = realDoc; }
  assert.ok(replaced, 'album card not replaced by its picture');
  assert.strictEqual(replaced.className, 'jjr-img');
  assert.strictEqual(replaced.src, 'https://i.imgur.com/59qIm1Al.jpg', 'not the low-res picture like other imgur pictures');
  assert.strictEqual(replaced.getAttribute('data-full'), 'https://i.imgur.com/59qIm1A.jpeg', 'click does not open the full picture');
});

test('reader: ↓ pressed again right after moving to the next article does not reach PTT', function() {
  var r = Object.create(PttReader.prototype);
  var key = function(k, mod) { return { key: k, ctrlKey: !!mod, metaKey: false, altKey: false }; };
  r.navFrom = { key: 'Gossiping|a|t', at: Date.now() };
  ['ArrowDown', ' ', 'ArrowRight', 'Enter', 'PageDown', 'ArrowUp'].forEach(function(k) {
    assert.ok(r.swallowsNavKey(key(k)), k + ' goes to PTT while it is still moving');
  });
  assert.ok(!r.swallowsNavKey(key('ArrowLeft')), '← (back to the list) is kept');
  assert.ok(!r.swallowsNavKey(key('X')), 'X is kept');
  assert.ok(!r.swallowsNavKey(key('ArrowDown', true)), 'browser shortcuts are kept');
  r.navFrom = { key: 'Gossiping|a|t', at: Date.now() - PttReader.NAV_SWALLOW_MS - 10 };
  assert.ok(!r.swallowsNavKey(key('ArrowDown')), 'keys are held back too long');
  r.navFrom = null;
  assert.ok(!r.swallowsNavKey(key('ArrowDown')), 'keys held back without a move');
  var src = PttReader.prototype.ensureOverlay.toString();
  var closed = src.slice(src.indexOf('if (!self.isOpen())'), src.indexOf('self.onKeyDown(e)'));
  assert.ok(/swallowsNavKey\(e\)/.test(closed) && /stopPropagation/.test(closed), 'closed reader lets the keys through');
});

test('split URL: the terminal links both parts to the whole URL, and undoes it', function() {
  var ctx = { SplitUrl: SplitUrl, console: console };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/term_buf.js'), 'utf8'), ctx);
  var cols = 80;
  var row = function(text) {
    var line = [];
    for (var i = 0; i < cols; ++i) line.push({ ch: text.charAt(i) || ' ', partOfURL: false, startOfURL: false, endOfURL: false, fullurl: '' });
    return line;
  };
  var pad = function(s) { while (s.length < 50) s += ' '; return s + ' 223.137.219.47 11/17 19:31'; };
  var texts = ['推 orange7: https://houde-lawyer.com/%E6%9D%8E%E6%', '→ orange7: 83%A0%E6%9A%84/', '→ orange7: 也差太多了吧'];
  var buf = { rows: 3, cols: cols, lineChangeds: [], lines: texts.map(function(t) { return row(pad(t)); }),
    getRowText: function(r) { return this.lines[r].map(function(c) { return c.ch; }).join(''); } };
  // what the URI pass found on the first line
  var start = texts[0].indexOf('https'), end = texts[0].length;
  buf.lines[0].uris = [[start, end]];
  buf.lines[0][start].startOfURL = true;
  buf.lines[0][start].fullurl = 'https://houde-lawyer.com/%E6%9D%8E%E6%';
  ctx.TermBuf.prototype.joinSplitUrls.call(buf);
  assert.strictEqual(buf.lines[0][start].fullurl, splitWhole, 'first part links to the cut URL');
  var t = texts[1].indexOf('83');
  var l1 = buf.lines[1];
  assert.ok(l1[t].startOfURL && l1[t].partOfURL && l1[t + 14].endOfURL && l1[t + 14].partOfURL, 'rest of the URL is not a link');
  assert.strictEqual(l1[t].fullurl, splitWhole);
  assert.ok(!l1[t + 15].partOfURL && !l1[t - 1].partOfURL, 'link runs past the URL');
  assert.strictEqual(JSON.stringify(l1.uris), JSON.stringify([[t, t + 15]]), 'the URI pass would not clear it');
  assert.ok(!buf.lines[2].uris, 'the next push is not a link');
  assert.ok(buf.lineChangeds[0] && buf.lineChangeds[1], 'rows not redrawn');
  // the second push changes (e.g. scrolled): both parts go back
  buf.lines[1] = row(pad('→ orange7: XD'));
  buf.lineChangeds = [];
  ctx.TermBuf.prototype.joinSplitUrls.call(buf);
  assert.strictEqual(buf.lines[0][start].fullurl, 'https://houde-lawyer.com/%E6%9D%8E%E6%', 'first part still joined');
  assert.ok(buf.lineChangeds[0], 'first row not redrawn');
  // the first line goes away while the rest stays: its link goes too
  buf.lines[0] = row(pad('推 someone: 哈哈'));
  buf.lines[1] = row(pad(texts[1]));
  ctx.TermBuf.prototype.joinSplitUrls.call(buf);
  buf.lines[0] = row(pad(texts[0]));
  buf.lines[0].uris = [[start, end]];
  buf.lines[0][start].startOfURL = true;
  buf.lines[0][start].fullurl = 'https://houde-lawyer.com/%E6%9D%8E%E6%';
  ctx.TermBuf.prototype.joinSplitUrls.call(buf);
  assert.strictEqual(buf.lines[1][t].fullurl, splitWhole);
  buf.lines[0] = row(pad('推 someone: 哈哈'));
  ctx.TermBuf.prototype.joinSplitUrls.call(buf);
  assert.ok(!buf.lines[1][t].partOfURL && !buf.lines[1].uris, 'rest of a URL still a link without its start');
  var upd = fs.readFileSync(path.join(root, 'js/term_buf.js'), 'utf8');
  var uca = upd.slice(upd.indexOf('updateCharAttr: function'), upd.indexOf('joinSplitUrls: function'));
  assert.ok(/this\.joinSplitUrls\(\)/.test(uca), 'updateCharAttr does not join');
});

test('hover picture preview stays inside the window and off the mouse', function() {
  var src = fs.readFileSync(path.join(root, 'js/pttchrome.js'), 'utf8');
  var start = src.indexOf('pttchrome.App.picPreviewSide = ');
  assert.ok(start >= 0, 'picPreviewSide missing');
  var ctx = { pttchrome: { App: {} }, Math: Math };
  vm.runInNewContext(src.slice(start, src.indexOf('\n};', start) + 3), ctx);
  var side = ctx.pttchrome.App.picPreviewSide;
  // the reported case: 679px window, mouse at 217, picture 608px wide
  var p = side(217, 608, 679);
  assert.strictEqual(p.right, true, 'more room on the right');
  assert.ok(217 + 20 + p.maxWidth <= 679, 'runs past the right edge');
  // mouse near the right edge: goes left, not over the mouse
  p = side(600, 500, 679);
  assert.strictEqual(p.right, false);
  assert.ok(600 - 20 - p.maxWidth >= 0, 'runs past the left edge');
  // small picture with room on the right stays on the right
  assert.strictEqual(side(500, 100, 679).right, true);
  assert.strictEqual(side(500, 100, 679).maxWidth, 155);
  var upd = src.slice(src.indexOf('prototype.updatePicPreviewPosition'), start);
  assert.ok(/'left:'\+left\+'px'/.test(upd) && !/curX\+20\)\+'px'/.test(upd), 'still always right of the mouse');
});

test('the settings page does not wipe the temporary blacklist list', function() {
  var src = PttChromePref.prototype.updateSettingsToUi.toString();
  var skip = src.indexOf("i === 'tempBlacklist'"), wipe = src.indexOf("$('#opt_'+i).empty()");
  assert.ok(skip >= 0 && wipe > skip, '#opt_tempBlacklist is emptied before the skip check');
});

// ---- 機房 report line: accounts only when expanded ---------------------------

console.log('report: 機房 accounts');

test('expanded 機房 line names the accounts; the collapsed line does not', function() {
  global.HostingIp = { ready: true, load: function() {}, lookup: function(ip) {
    return /^1\.1\./.test(ip) ? 'Zenlayer' : /^2\.2\./.test(ip) ? 'DigitalOcean' : '';
  } };
  try {
    var ps = many('x', 12, 1);
    ps[0] = push('OpenBook13', 1); ps[0].ip = '1.1.1.1';
    ps[1] = push('crispy04', 1);   ps[1].ip = '2.2.2.2';
    ps[2] = push('crispy05', 1);   ps[2].ip = '2.2.2.3';
    var r = analyze(article(ps), { factFloodRun: false });
    var host = r.report.filter(function(t) { return /機房/.test(t); })[0];
    assert.strictEqual(host, '同機房：DigitalOcean 2 個帳號（crispy04、crispy05）；Zenlayer 1 個帳號（openbook13）');
    var sum = PttReader.factSummary(PttReader.mergeFactLines(r.report));
    assert.strictEqual(sum.hostLine, '同機房：DigitalOcean×2、Zenlayer×1');
    assert.ok(!/crispy|OpenBook/i.test(sum.hostLine + sum.kinds.join('')), 'no account in the collapsed line');
    assert.strictEqual(PttReader.factSummary(['機房／VPN IP：Zenlayer 1 個帳號（openbook13）', '秒推：發文 2 分鐘內 5 人推文'])
                         .hostLine, '機房：Zenlayer×1');
  } finally {
    delete global.HostingIp;
  }
});

// ---- article list with 置底公告 hidden ---------------------------------------

console.log('list: hide pinned posts');
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/term_view.js'), 'utf8'), { filename: 'js/term_view.js' });

// ---- ANSI art: triangles and two-colour blocks drawn as exact shapes ------
test('ANSI art: triangles and diagonals are drawn as shapes, not font glyphs', function() {
  ['◢', '◣', '◤', '◥', '╱', '╲', '╳'].forEach(function(c) {
    assert.ok(TermView.BLOCK_CLASSES[c], c + ' has no shape');
  });
  var css = fs.readFileSync(path.join(root, 'css/main.css'), 'utf8');
  ['jjb-t1', 'jjb-t2', 'jjb-t3', 'jjb-t4', 'jjb-d1', 'jjb-d2', 'jjb-d3', 'jjb-lh'].forEach(function(k) {
    assert.ok(css.indexOf('i.' + k + ' {') >= 0, k + ' has no CSS');
  });
});
test('ANSI art: grey blocks keep the real grey, not the brighter text colour', function() {
  var css = fs.readFileSync(path.join(root, 'css/main.css'), 'utf8');
  var color = fs.readFileSync(path.join(root, 'css/color.css'), 'utf8');
  var grey = /\.b7\{background-color:(#[0-9a-f]+);\}/.exec(color)[1];
  var m = /#mainContainer > span > i\.jjb,\s*#mainContainer \.q7 > i\.jjb,\s*#mainContainer i\.jjb\.q7 \{\s*color: (#[0-9a-f]+);/.exec(css);
  assert.ok(m, 'no grey rule for blocks');
  assert.strictEqual(m[1], grey, 'a grey block must match a grey background');
  assert.ok(css.indexOf(m[0]) > css.indexOf('color: var(--jj-text-color'), 'must come after the text colour rule');
});
test('ANSI art: a two-colour block is the right shape plus the left half, no font glyph', function() {
  var fake = { setCurColorStyle: function() {}, closeSpanIfIsOpen: function() { return ''; }, deffg: 7, defbg: 0 };
  var html = TermView.prototype.createTwoColorWord.call(fake, { blink: false }, { blink: false }, '█', 1, 3, 0, 4, 0);
  assert.ok(/jjb2/.test(html) && /jjb jjb-f">/.test(html), html);
  assert.ok(/jjb-lh q1"><\/i>/.test(html), 'left half not drawn in the left colour: ' + html);
  assert.ok(!/ t="/.test(html), 'still drawn with the font overlay: ' + html);
  assert.strictEqual(html.replace(/<[^>]+>/g, ''), '█', 'copy / column counting must see one character');
  // ordinary two-colour characters keep the old way
  var word = TermView.prototype.createTwoColorWord.call(fake, { blink: false }, { blink: false }, '中', 1, 3, 0, 0, 0);
  assert.ok(/ t="中"/.test(word));
});

function listScreen(nums, pinnedCount, cursorNum) {
  var rows = ['【板主:x】 看板《Gossiping》', '', '   編號    日 期 作 者       文  章  標  題'];
  nums.forEach(function(n) {
    rows.push((n === cursorNum ? '>' : ' ') + n + ' + 3 11/12 user     □ [問卦] title ' + n);
  });
  for (var p = 0; p < pinnedCount; ++p) rows.push('   ★    11/12 mod      □ [公告] 板規');
  while (rows.length < 23) rows.push('');
  rows.push(' 文章列表 (^P)發表');
  return rows;
}
function listView(rows, sent, state) {
  var v = Object.create(TermView.prototype);
  v.buf = { rows: 24, cols: 80, pageState: 2, cur_y: 0, getRowText: function(r) { return rows[r] || ''; } };
  v.htmlRowStrArray = rows.map(function(t, r) {
    return '<span type="bbsrow" srow="' + r + '">' + t.replace('>', '&gt;') + '</span>';
  });
  v.bbscore = { pref: { values: { hidePinned: true, listNewestFirst: false } } };
  v.conn = { send: function(k) { sent.push(k); } };
  v.pinFillState = state;
  return v;
}
function range(a, b) { var out = []; for (var n = a; n <= b; ++n) out.push(n); return out; }
function shownNums(v) {
  return v.listMap.html.slice(3, 23).map(function(h) { var m = /(\d{6})/.exec(h); return m ? +m[1] : 0; });
}

test('last page: the hidden pinned rows are filled with the articles before, up to the bottom', function() {
  var log = console.log; console.log = function() {};
  try {
    var sent = [];
    var lastRows = listScreen(range(780708, 780724), 3, 780724);
    var v = listView(lastRows, sent);
    v.updateListMap();
    assert.deepStrictEqual(sent, ['\x1b[5~'], 'nothing remembered yet: look at the previous page');
    listView(listScreen(range(780688, 780707), 0, 780704), sent, v.pinFillState).updateListMap();
    assert.strictEqual(sent[1], new Array(21).join('\x1b[B'), 'back to the newest with ↓ x20');
    var back = listView(lastRows, sent, v.pinFillState);
    back.updateListMap();
    assert.deepStrictEqual(shownNums(back), range(780705, 780724));
    assert.strictEqual(back.slotOfRow(lastRows.indexOf(lastRows.filter(function(t) { return /^>/.test(t); })[0])), 22);
    assert.strictEqual(sent.length, 2, 'no more keys once filled');
  } finally {
    console.log = log;
  }
});
test('Z 搜尋推文數 question on the bottom row: the filled list stays, no keys typed into the answer', function() {
  var log = console.log; console.log = function() {};
  try {
    var sent = [];
    var lastRows = listScreen(range(780708, 780724), 3, 780724);
    var v = listView(lastRows, sent);
    v.updateListMap();
    listView(listScreen(range(780688, 780707), 0, 780704), sent, v.pinFillState).updateListMap();
    listView(lastRows, sent, v.pinFillState).updateListMap();
    sent.length = 0;
    var asking = lastRows.slice();
    asking[23] = '搜尋推文數高於多少 (<0則搜噓文數) 的文章: 10';
    var q = listView(asking, sent, v.pinFillState);
    q.updateListMap();
    assert.deepStrictEqual(shownNums(q), range(780705, 780724), 'rows above the last page went blank');
    assert.deepStrictEqual(sent, [], 'keys sent while the question is up');
    // entering a board straight into the question: nothing typed either
    var sent2 = [];
    listView(asking, sent2).updateListMap();
    assert.deepStrictEqual(sent2, []);
  } finally {
    console.log = log;
  }
});
test('hidden 置底: ↓ on the last article stays there (no jump onto a hidden pinned post and back)', function() {
  var log = console.log; console.log = function() {};
  try {
    var sent = [];
    var lastRows = listScreen(range(780708, 780724), 3, 780724);
    var v = listView(lastRows, sent);
    v.updateListMap();
    listView(listScreen(range(780688, 780707), 0, 780704), sent, v.pinFillState).updateListMap();
    var atLast = listView(lastRows, sent, v.pinFillState);
    atLast.updateListMap();
    assert.ok(atLast.listAtLastBeforePinned(), 'cursor on the last article: ↓ would go onto a hidden pinned post');
    var oneUp = listView(listScreen(range(780708, 780724), 3, 780723), sent, v.pinFillState);
    oneUp.updateListMap();
    assert.ok(!oneUp.listAtLastBeforePinned(), '↓ blocked one article before the last');
    // last article at the bottom of a page, pinned posts on the next page:
    // not known from this page, ↓ goes to PTT (it is pulled back as before)
    var full = listView(listScreen(range(780705, 780724), 0, 780724), sent, v.pinFillState);
    full.updateListMap();
    assert.ok(!full.listAtLastBeforePinned(), '↓ blocked without pinned posts on the page');
    // pinned posts shown: nothing to stop at
    var shown = listView(lastRows, sent);
    shown.bbscore.pref.values.hidePinned = false;
    shown.updateListMap();
    assert.ok(!shown.listAtLastBeforePinned(), '↓ blocked with the pinned posts on screen');
  } finally {
    console.log = log;
  }
  var src = TermView.prototype.onkeyDown.toString();
  var down = src.slice(src.indexOf('case 40:'), src.indexOf('case 45:'));
  assert.ok(/listAtLastBeforePinned\(\)/.test(down), '↓ does not check for the last article');
});

test('app: the hidden terminal sends no keys of its own for a newest-first list (pushes got 26851 in front)', function() {
  var log = console.log; console.log = function() {};
  var isApp = global.lib.isApp;
  try {
    // a short first page in a newest-first list: the terminal asks PTT for the page before
    var short = function() {
      var sent = [];
      var v = listView(listScreen(range(780715, 780724), 0, 780724), sent);
      v.bbscore.pref.values.listNewestFirst = true;
      v.updateListMap();
      return sent;
    };
    global.lib.isApp = function() { return false; };
    assert.ok(short().length > 0, 'the extension pages back (else this test checks nothing)');
    global.lib.isApp = function() { return true; };
    assert.deepStrictEqual(short(), [], 'no keys in the app');
  } finally {
    global.lib.isApp = isApp;
    console.log = log;
  }
});
test('a page without pinned posts is shown as PTT draws it', function() {
  var v = listView(listScreen(range(780688, 780707), 0, 780700), []);
  v.updateListMap();
  assert.deepStrictEqual(shownNums(v), range(780688, 780707));
});

test('cursor on a hidden pinned post: moved up to the newest article, not left to open the 公告', function() {
  var log = console.log; console.log = function() {};
  try {
    // ↓ past the last article: PTT's cursor is on the 2nd of 3 hidden ★ rows
    var rows = listScreen(range(780705, 780724), 0, 0);
    rows[20] = '   ★    11/12 mod      □ [公告] 板規';
    rows[21] = '>  ★    11/12 mod      □ [公告] 置底';
    rows[22] = '   ★    11/12 mod      □ [公告] 活動';
    var sent = [];
    listView(rows, sent, { board: 'Gossiping|文章列表', cache: {}, fill: 'done' }).updateListMap();
    assert.deepStrictEqual(sent, ['\x1b[A\x1b[A'], 'two ↑ reach the last article');
    // a board that opens on a page of pinned posts only (it looked blank)
    var only = listScreen([], 0, 0);
    for (var p = 0; p < 4; ++p) only[3 + p] = (p === 0 ? '>' : ' ') + '  ★    11/12 mod      □ [公告] ' + p;
    var sent2 = [];
    listView(only, sent2).updateListMap();
    assert.deepStrictEqual(sent2, ['\x1b[A'], 'one ↑ goes to the page before');
    // the app's hidden terminal jumped to a 公告 with #AID to push on it: leave it there
    var isApp = global.lib.isApp;
    global.lib.isApp = function() { return true; };
    try {
      var sent3 = [];
      listView(rows, sent3, { board: 'Gossiping|文章列表', cache: {}, fill: 'done' }).updateListMap();
      assert.deepStrictEqual(sent3, [], 'no keys in the app');
    } finally {
      global.lib.isApp = isApp;
    }
  } finally {
    console.log = log;
  }
});
test('↓ held past the last article: the ↑ back is retried and the list is never blank', function() {
  var log = console.log, realSetTimeout = global.setTimeout;
  var timers = [];
  console.log = function() {};
  global.setTimeout = function(fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
  try {
    var cache = {};
    range(780705, 780724).forEach(function(n) { cache[n] = '<span type="bbsrow" srow="-1"> ' + n + ' cached</span>'; });
    var st = { board: 'Gossiping|文章列表', cache: cache, fill: 'done' };
    // a page of pinned posts only, the cursor on the first one
    var only = listScreen([], 0, 0);
    for (var p = 0; p < 4; ++p) only[3 + p] = (p === 0 ? '>' : ' ') + '  ★    11/12 mod      □ [公告] ' + p;
    var sent = [];
    var v = listView(only, sent, st);
    v.updateListMap();
    assert.deepStrictEqual(sent, ['\x1b[A'], 'first time: ↑ at once');
    assert.deepStrictEqual(shownNums(v), range(780705, 780724), 'the newest remembered articles, not an empty list');
    // still ↓ held: back on a pinned post right away, inside the wait
    var redraws = 0;
    var v2 = listView(only, sent, st);
    v2.redraw = function() { redraws++; };
    v2.updateListMap();
    assert.strictEqual(sent.length, 1, 'no second ↑ inside the wait');
    assert.strictEqual(timers.length, 1, 'but a look again is planned');
    assert.ok(timers[0].ms > 0 && timers[0].ms <= 650);
    v2.updateListMap();
    assert.strictEqual(timers.length, 1, 'only one planned at a time');
    timers[0].fn();
    assert.strictEqual(redraws, 1, 'the screen is checked again after the wait');
  } finally {
    console.log = log;
    global.setTimeout = realSetTimeout;
  }
});

// ---- Android app: reading on the BBS when www.ptt.cc is down ----------------------

test('BBS list rows: number, 推文數, date, author, title (Re/Fw), deleted, 置底', function() {
  var r = JJPtt.parseArticleRow('  12345 +10 11/19 someone      □ [問卦] 測試標題');
  assert.strictEqual(JJPtt.parseArticleRow(' 780705 + 3 11/12 user     □ [問卦] title').nrec, '3');
  assert.deepStrictEqual(r, { num: 12345, nrec: '10', date: '11/19', author: 'someone', title: '[問卦] 測試標題', deleted: false });
  r = JJPtt.parseArticleRow('>12346  爆 1/05 other        R:[新聞] 回文');
  assert.strictEqual(r.num, 12346); assert.strictEqual(r.nrec, '爆'); assert.strictEqual(r.date, '1/05');
  assert.strictEqual(r.title, 'Re: [新聞] 回文');
  r = JJPtt.parseArticleRow('  12347  X111/19 third        轉 [轉錄] 轉的');
  assert.strictEqual(r.nrec, 'X1'); assert.strictEqual(r.title, 'Fw: [轉錄] 轉的');
  r = JJPtt.parseArticleRow('  12348 ~    11/19 -            □ (本文已被刪除) [someone]');
  assert.ok(r.deleted);
  r = JJPtt.parseArticleRow('   ★    11/12 mod      □ [公告] 板規');
  assert.strictEqual(r.num, 0);
  assert.strictEqual(JJPtt.parseArticleRow('【板主:abc】   看板《Test》'), null);
});

test('BBS list rows as PTT draws them: 推文數 runs into the date (fixed columns)', function() {
  // pttbbs: "%6d", " " + mark + 2-column 推文數, then "%-6.5s" date
  var p = JJPtt.parseArticleRow;
  var r = p('  12345 + 311/19 someone      □ [問卦] 三推');
  assert.strictEqual(r.nrec, '3'); assert.strictEqual(r.date, '11/19'); assert.strictEqual(r.num, 12345);
  r = p('  12345 + 9 1/05 someone      □ [問卦] 九推');
  assert.strictEqual(r.nrec, '9'); assert.strictEqual(r.date, '1/05');
  r = p('  12346 +4211/19 someone      R:[問卦] 四十二推');
  assert.strictEqual(r.nrec, '42'); assert.strictEqual(r.date, '11/19'); assert.strictEqual(r.title, 'Re: [問卦] 四十二推');
  r = p('●780705  爆11/19 someone      □ [新聞] 爆');
  assert.strictEqual(r.num, 780705); assert.strictEqual(r.nrec, '爆'); assert.strictEqual(r.date, '11/19');
  r = p('  12347  XX11/19 someone      □ [問卦] 噓爆');
  assert.strictEqual(r.nrec, 'XX');
  r = p('  12348 +  11/19 someone      □ [問卦] 沒人推');
  assert.strictEqual(r.nrec, ''); assert.strictEqual(r.date, '11/19');
  r = p('  12349 !--11/19 someone      □ [問卦] 鎖文');
  assert.strictEqual(r.nrec, ''); assert.strictEqual(r.date, '11/19');
});

test('BBS article lines -> a page like www.ptt.cc\'s (header, body with links, pushes)', function() {
  var html = JJPtt.articleHtml([
    ' 作者  tester (測試)                                  看板  Test',
    ' 標題  [問卦] 測試',
    ' 時間  Thu Nov 19 01:00:00 2026',
    '───────────────────────────────────────',
    '內文 <b> https://i.imgur.com/abcdefg.jpg',
    '推 alice: 好文 https://x.y/z  1.2.3.4 11/19 01:02',
    '→ bob: 補                           11/19 01:03'
  ]);
  assert.ok(html.indexOf('<span class="article-meta-tag">作者</span><span class="article-meta-value">tester (測試)</span>') >= 0);
  assert.ok(html.indexOf('<span class="article-meta-tag">看板</span><span class="article-meta-value">Test</span>') >= 0);
  assert.ok(html.indexOf('<span class="article-meta-value">[問卦] 測試</span>') >= 0);
  assert.ok(html.indexOf('內文 &lt;b&gt; <a href="https://i.imgur.com/abcdefg.jpg">') >= 0, 'escaped, links kept');
  assert.ok(html.indexOf('───') < 0, 'the line under the header is not in the body');
  assert.ok(html.indexOf('<span class="push-tag">推 </span><span class="push-userid">alice</span><span class="push-content">: 好文 <a href="https://x.y/z">https://x.y/z</a></span><span class="push-ipdatetime"> 1.2.3.4 11/19 01:02') >= 0);
  assert.ok(html.indexOf('<span class="push-userid">bob</span><span class="push-content">: 補</span><span class="push-ipdatetime"> 11/19 01:03') >= 0);
});

test('BBS article lines keep their colours: spans like www.ptt.cc\'s, read by the reader', function() {
  // a fake screen row: [text, fg, bg, bright] runs; 中 is a double-byte character
  var mk = function(runs) {
    var row = [];
    runs.forEach(function(r) {
      r[0].split('').forEach(function(ch) {
        var a = { fg: r[1], bg: r[2], bright: !!r[3], invert: false };
        if (ch === '中') { row.push(Object.assign({ ch: 'x', isLeadByte: true }, a)); row.push(Object.assign({ ch: 'y' }, a)); }
        else row.push(Object.assign({ ch: ch }, a));
      });
    });
    while (row.length < 20) row.push({ ch: ' ', fg: 7, bg: 0, bright: false });
    return row;
  };
  var buf = { cols: 20, lines: [
    mk([['plain ', 7, 0], ['red', 1, 0, 1], [' 中', 3, 4]]),
    mk([['see https://a.b/c', 7, 0]]),
    mk([['bar  ', 7, 2]])
  ], getRowText: function() { return '中'; } };
  var h0 = JJPtt.rowHtml(buf, 0);
  assert.strictEqual(h0, 'plain <span class="f1 hl b0">red</span><span class="f3 b4"> 中</span>');
  assert.strictEqual(JJPtt.rowHtml(buf, 1), 'see <a href="https://a.b/c">https://a.b/c</a>', 'trailing blanks on black dropped, URL linked');
  assert.strictEqual(JJPtt.rowHtml(buf, 2), '<span class="f7 b2">bar  </span>', 'a coloured background keeps its blanks');
  var lines = [' 作者  t (t)', ' 標題  x', ' 時間  y', '───────────────────', 'plain red  中'];
  lines.html = [];
  lines.html[4] = h0;
  var html = JJPtt.articleHtml(lines);
  assert.ok(html.indexOf('<span class="f1 hl b0">red</span>') >= 0);
  var st = PttReader.colorState({ getAttribute: function(a) { return a === 'class' ? 'f3 b4' : null; } }, { fg: 7, bg: 0, hl: false });
  assert.strictEqual(st.fg, 3); assert.strictEqual(st.bg, 4); assert.strictEqual(st.hl, false);
  st = PttReader.colorState({ getAttribute: function(a) { return a === 'class' ? 'f1 hl b0' : null; } }, { fg: 7, bg: 0, hl: false });
  assert.ok(st.fg === 1 && st.hl, 'the reader sees the colour');
});

test('BBS board page -> index HTML with jjterm: links, older page below the lowest number', function() {
  var html = JJPtt.indexHtml('Test', [{ num: 5, nrec: '', date: '11/19', author: 'a', title: 't5' },
                                      { num: 6, nrec: '', date: '11/19', author: '-', title: '(本文已被刪除)', deleted: true }], 'jjterm:list/Test/5');
  assert.ok(html.indexOf('<a href="jjterm:art/Test/5#a/t5">t5</a>') >= 0, 'the author and title come along');
  assert.ok(html.indexOf('jjterm:art/Test/6') < 0, 'a deleted article has no link');
  assert.ok(html.indexOf('href="jjterm:list/Test/5">‹ 上頁') >= 0);
  assert.strictEqual(JJMobile.webUrl('jjterm:art/Test/5'), 'jjterm:art/Test/5');
  assert.strictEqual(JJMobile.webUrl('/bbs/Test/index.html'), 'https://www.ptt.cc/bbs/Test/index.html');
});

testAsync('BBS article: Enter, every page by Page Down until 100%, back with q', async function() {
  var LIST = '【板主:x】  看板《Test》\n>  5 + 1 11/19 tester  □ [問卦] 測試\n\n\n\n';
  var f = fakePtt([
    [LIST, { '\r': 1 }],
    [' 作者  tester (測試)    看板  Test\n 標題  [問卦] 測試\n 時間  Thu Nov 19 01:00:00 2026\n──────────────────\n第一行\n 瀏覽 第 1/2 頁 ( 50%)  目前顯示: 第 01~05 行', { '\x1b[6~': 2 }],
    ['第一行\n第二行\n--\n推 alice: 好文 1.2.3.4 11/19 01:02\n→ bob: 補 11/19 01:03\n 瀏覽 第 2/2 頁 (100%)  目前顯示: 第 05~09 行', { 'q': 3 }],
    [LIST, {}]
  ]);
  f.app.buf.rows = 6;
  f.app.conn.isConnected = true;
  var lines = await f.ptt.readHere();
  assert.deepStrictEqual(f.typed, ['\r', '\x1b[6~', 'q']);
  assert.strictEqual(lines.length, 9);
  assert.strictEqual(lines[4], '第一行');
  assert.strictEqual(lines[8], '→ bob: 補 11/19 01:03');
});

test('BBS search: www.ptt.cc search?q= as PTT\'s own keys (a / Z /), its addresses and links', function() {
  var c = JJPtt.searchCmd('author:alice');
  assert.strictEqual(c.key, 'a'); assert.strictEqual(c.text, 'alice');
  assert.ok(c.ask.test('搜尋作者: ') && c.ask.test('增加條件 作者: '));
  c = JJPtt.searchCmd('recommend:-100');
  assert.strictEqual(c.key, 'Z'); assert.strictEqual(c.text, '-100');
  assert.ok(c.ask.test('搜尋推文數高於多少 (<0則搜噓文數) 的文章: '));
  c = JJPtt.searchCmd(' 颱風 假 ');
  assert.strictEqual(c.key, '/'); assert.strictEqual(c.text, '颱風 假'); assert.ok(c.ask.test('搜尋標題: '));
  assert.strictEqual(JJPtt.searchCmd(''), null);
  assert.strictEqual(JJPtt.searchCmd('recommend:0'), null);
  assert.deepStrictEqual(PttReader.termSearch('https://www.ptt.cc/bbs/Gossiping/search?q=recommend%3A100'),
    { board: 'Gossiping', query: 'recommend:100', before: 0, page: 1 });
  assert.strictEqual(PttReader.termSearch('https://www.ptt.cc/bbs/Test/search?page=2&q=a+b').page, 2);
  assert.strictEqual(PttReader.termSearch('https://www.ptt.cc/bbs/Test/search?page=2&q=a+b').query, 'a b');
  assert.deepStrictEqual(PttReader.termSearch('jjterm:search/Test/40/' + encodeURIComponent('author:bob')),
    { board: 'Test', query: 'author:bob', before: 40, page: 1 });
  assert.strictEqual(PttReader.termSearch('https://www.ptt.cc/bbs/Test/index.html'), null);
  var html = JJPtt.indexHtml('Test', [{ num: 3, nrec: '爆', date: '11/19', author: 'a', title: 't' }], '', 'recommend:100');
  assert.ok(html.indexOf('href="jjterm:art/Test/3/recommend%3A100#a/t"') >= 0, 'opened inside the search');
  html = JJPtt.indexHtml('Test', [{ num: 3, nrec: '爆', date: '11/19', author: 'I26921216', title: '[新聞] 女子打卡竟拉扯「雷門大燈籠」 700/公斤' }], '', 'recommend:100');
  var href = /href="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&');
  assert.deepStrictEqual(JJPtt.wantFromUrl(href), { author: 'I26921216', title: '[新聞] 女子打卡竟拉扯「雷門大燈籠」 700/公斤' });
  assert.strictEqual(PttReader.articleUrl(href), 'jjterm:art/Test/3/recommend%3A100', 'the same article key as before');
  assert.strictEqual(JJPtt.wantFromUrl('jjterm:art/Test/3'), null);
});

testAsync('BBS search: into the board, the search key, its prompt, the words; the list newest first', async function() {
  var LIST = '【板主:x】  看板《Test》  文章選讀\n  1 + 511/19 a  □ [問卦] 舊\n  2 + 311/19 b  □ [問卦] 新\n\n 文章選讀 (y)回應';
  var ASK = LIST.replace(' 文章選讀 (y)回應', '搜尋推文數高於多少 (<0則搜噓文數) 的文章: ');
  var HITS = '【板主:x】  看板《Test》  文章選讀\n  1 + 511/19 a  □ [問卦] 舊\n  2 + 311/19 b  □ [問卦] 新\n\n 文章選讀 (y)回應 ';
  var f = fakePtt([[LIST, { 'Z': 1 }], [ASK, { '3\r': 2, '3': 1 }], [HITS, { '\x1b[4~': 2 }]]);
  f.app.buf.rows = 5;
  f.app.conn.isConnected = true;
  f.ptt.user = 'me';
  f.ptt.ensureIn = function() { return Promise.resolve(); };
  var html = await f.ptt.boardPage('Test', 0, 'recommend:3');
  assert.strictEqual(f.typed[0], 'Z');
  assert.strictEqual(f.ptt.listQuery, 'recommend:3');
  assert.ok(html.indexOf('jjterm:art/Test/2/recommend%3A3') < html.indexOf('jjterm:art/Test/1/recommend%3A3'), 'newest first');
});

testAsync('BBS search with nothing found: the message is closed, an empty list (not the whole board\'s)', async function() {
  var LIST = '【板主:x】  看板《Test》  文章選讀\n  1 + 511/19 a  □ [問卦] 舊\n\n\n 文章選讀 (y)回應';
  var ASK = LIST.replace(' 文章選讀 (y)回應', '搜尋標題: ');
  var NONE = LIST.replace(' 文章選讀 (y)回應', '找不到符合條件的文章。     請按任意鍵繼續');
  var f = fakePtt([[LIST, { '/': 1 }], [ASK, { 'zzz\r': 2 }], [NONE, { ' ': 3 }], [LIST + ' ', {}]]);
  f.app.buf.rows = 5;
  f.app.conn.isConnected = true;
  f.ptt.user = 'me';
  f.ptt.ensureIn = function() { return Promise.resolve(); };
  var html = await f.ptt.boardPage('Test', 0, 'zzz');
  assert.ok(html.indexOf('r-ent') < 0, 'no rows');
  assert.ok(!f.ptt.listQuery, 'not in a search');
  assert.strictEqual(f.typed[f.typed.length - 1], ' ', 'the message closed');
});

testAsync('BBS article already open further down: Home to the first page, then every page', async function() {
  var P1 = ' 作者  tester (測試)    看板  Test\n 標題  [問卦] 測試\n 時間  Thu Nov 19 01:00:00 2026\n──────────────────\n第一行\n 瀏覽 第 1/2 頁 ( 50%)  目前顯示: 第 01~05 行';
  var P2 = '第一行\n第二行\n--\n推 alice: 好文 1.2.3.4 11/19 01:02\n→ bob: 補 11/19 01:03\n 瀏覽 第 2/2 頁 (100%)  目前顯示: 第 05~09 行';
  var f = fakePtt([[P2, { '\x1b[1~': 1 }], [P1, { '\x1b[6~': 2 }], [P2, { '\x1b[1~': 1 }]]);
  f.app.buf.rows = 6;
  f.app.conn.isConnected = true;
  var lines = await f.ptt.readPages();
  assert.deepStrictEqual(f.typed, ['\x1b[1~', '\x1b[6~']);
  assert.strictEqual(lines[0], ' 作者  tester (測試)    看板  Test');
  assert.strictEqual(lines[7], '推 alice: 好文 1.2.3.4 11/19 01:02');
});

testAsync('BBS article: each page is handed over as it comes; false stops the paging', async function() {
  var P1 = ' 作者  tester (測試)    看板  Test\n 標題  [問卦] 測試\n 時間  Thu Nov 19 01:00:00 2026\n──────────────────\n第一行\n 瀏覽 第 1/2 頁 ( 50%)  目前顯示: 第 01~05 行';
  var P2 = '第一行\n第二行\n--\n推 alice: 好文 1.2.3.4 11/19 01:02\n→ bob: 補 11/19 01:03\n 瀏覽 第 2/2 頁 (100%)  目前顯示: 第 05~09 行';
  var f = fakePtt([[P1, { '\x1b[6~': 1 }], [P2, {}]]);
  f.app.buf.rows = 6;
  f.app.conn.isConnected = true;
  var seen = [];
  var lines = await f.ptt.readPages(function(n, total, sofar) { seen.push([n, total, sofar.length]); });
  assert.deepStrictEqual(seen, [[1, 2, 5], [2, 2, 9]]);
  assert.ok(!lines.stopped);
  var g = fakePtt([[P1, { '\x1b[6~': 1 }], [P2, {}]]);
  g.app.buf.rows = 6;
  g.app.conn.isConnected = true;
  lines = await g.ptt.readPages(function() { return false; });
  assert.ok(lines.stopped);
  assert.deepStrictEqual(g.typed, [], 'no Page Down after stopping');
});

testAsync('BBS article: a page still being drawn (status line not moved on yet) is not read as the next one', async function() {
  var P1 = ' 作者  tester (測試)    看板  Test\n 標題  [問卦] 測試\n 時間  Thu Nov 19 01:00:00 2026\n──────────────────\n第一行\n 瀏覽 第 1/2 頁 ( 50%)  目前顯示: 第 01~05 行';
  var HALF = '第一行\n第二行\n 時間  Thu Nov 19 01:00:00 2026\n──────────────────\n第一行\n 瀏覽 第 1/2 頁 ( 50%)  目前顯示: 第 01~05 行';
  var P2 = '第一行\n第二行\n--\n推 alice: 好文 1.2.3.4 11/19 01:02\n→ bob: 補 11/19 01:03\n 瀏覽 第 2/2 頁 (100%)  目前顯示: 第 05~09 行';
  var f = fakePtt([[P1, { '\x1b[6~': 1 }], [HALF, {}, { after: 30, to: 2 }], [P2, {}]]);
  f.app.buf.rows = 6;
  f.app.conn.isConnected = true;
  var lines = await f.ptt.readPages();
  assert.strictEqual(lines[0], ' 作者  tester (測試)    看板  Test', 'page 1 not overwritten by the half-drawn screen');
  assert.strictEqual(lines[1], ' 標題  [問卦] 測試');
  assert.strictEqual(lines[7], '推 alice: 好文 1.2.3.4 11/19 01:02');
});

testAsync('reading ahead on the BBS gives way to what the user opens', async function() {
  var f = fakePtt([['x', {}]]);
  f.ptt.user = 'tester';
  f.ptt.ensureIn = function() { return Promise.resolve(); };
  f.ptt.toArticle = function() { return Promise.resolve(); };
  var pages = 0;
  f.ptt.readHere = function(onPage) {
    var go = function() {
      ++pages;
      if (onPage(pages, 10, []) === false || pages >= 10) return Promise.resolve([]);
      if (pages === 2) f.ptt.run(function() { return Promise.resolve('fg'); });  // the user opens another
      return Promise.resolve().then(go);
    };
    return go();
  };
  await assert.rejects(f.ptt.termArticle('https://www.ptt.cc/bbs/Test/M.1.A.2.html', null, { bg: true }), function(e) { return e.yielded; });
  assert.strictEqual(pages, 3, 'stopped on the page after the other job came');
  pages = 0;
  f.ptt.run(function() { return Promise.resolve(); });
  var r = await f.ptt.termArticle('https://www.ptt.cc/bbs/Test/M.1.A.2.html', null, {});
  assert.strictEqual(pages, 10, 'not read ahead: read to the end');
  assert.ok(r.html);
});

testAsync('app: an article being read ahead shows its pages when opened; one that gave way is read again', async function() {
  var calls = [];
  var m = Object.create(JJMobile.prototype);
  m.articles = {};
  m.app = { reader: { fetchArticle: function(url, opts) {
    calls.push(opts.bg);
    if (opts.bg) {
      opts.onPartial({ part: 1 }, 1, 3);
      var e = new Error('讓給前面的工作'); e.yielded = true;
      return new Promise(function(res, rej) { setTimeout(function() { rej(e); }, 5); });
    }
    opts.onPartial({ part: 2 }, 2, 3);
    return Promise.resolve({ done: true });
  } } };
  m.getArticle('u', null, true).catch(function() {});
  var seen = [];
  var a = await m.getArticle('u', function(x, i) { seen.push(i); });
  assert.deepStrictEqual(a, { done: true });
  assert.deepStrictEqual(calls, [true, false]);
  assert.deepStrictEqual(seen, [1, 2], 'the page already read, then the new read');
});

testAsync('app: an article read ahead a while ago is read again and drawn again when it has more pushes', async function() {
  var m = Object.create(JJMobile.prototype);
  m.articles = {};
  var asked = [];
  var fresh = { url: 'jjterm:art/Test/5', fromTerm: true, pushes: [1, 2, 3] };
  m.app = { reader: { fetchArticle: function(url) { asked.push(url); return Promise.resolve(fresh); } } };
  var old = { url: 'https://www.ptt.cc/bbs/Test/M.1.A.2.html', fromTerm: true, pushes: [1] };
  var drawn = [];
  m.fillArticle = function(screen, a) { screen.article = a; drawn.push(a); };
  var view = { isConnected: true, scrollTop: 300, innerHTML: 'x' };
  var screen = { view: view, article: old };
  m.articles['jjterm:art/Test/5'] = { at: Date.now() - 5000, promise: Promise.resolve(old) };
  assert.ok(!m.freshen(screen, old, 'jjterm:art/Test/5'), 'just read: as it is');
  m.articles['jjterm:art/Test/5'].at = Date.now() - JJMobile.STALE_MS - 1;
  assert.ok(m.freshen(screen, old, 'jjterm:art/Test/5'));
  await new Promise(function(res) { setTimeout(res, 5); });
  assert.deepStrictEqual(asked, ['jjterm:art/Test/5'], 'on the BBS: no ?_= added');
  assert.deepStrictEqual(drawn, [fresh]);
  assert.strictEqual(view.scrollTop, 300, 'the place kept');
  assert.strictEqual(fresh.url, old.url, 'the web address kept for pushing');
  // web: past the cache; no more pushes: not drawn again
  m.articles['https://x/1.html'] = { at: 0, promise: Promise.resolve(old) };
  fresh.pushes = [1];
  screen.article = old;
  assert.ok(m.freshen(screen, { pushes: [1] }, 'https://x/1.html'));
  assert.ok(/^https:\/\/x\/1\.html\?_=\d+$/.test(asked[1]));
});

test('app: the pushes heading counts 推 / 噓 / → (the list shows 推 minus 噓)', function() {
  var ps = [{ tag: '推' }, { tag: '推' }, { tag: '→' }, { tag: '噓' }];
  assert.strictEqual(JJMobile.pushTally(ps), '推文 4　推 2・噓 1・→ 1');
  assert.strictEqual(JJMobile.pushTally([]), '推文 0');
});

test('app: www.ptt.cc down is kept over a restart; other kinds down -> a shorter wait', function() {
  var isApp = lib.isApp, store = {};
  global.localStorage = { getItem: function(k) { return k in store ? store[k] : null; }, setItem: function(k, v) { store[k] = String(v); } };
  try {
    lib.isApp = function() { return true; };
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
    PttReader.markWebDown('https://www.ptt.cc/bbs/Test/index.html');
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
    PttReader.loadWebDown();
    assert.ok(PttReader.webRecentlyDown('list'), 'remembered');
    assert.ok(!PttReader.webRecentlyDown('article'));
    assert.ok(PttReader.webRecentlyDown(), 'something down: the article page is given ' + PttReader.WEB_TIMEOUT_SHORT_MS + ' ms');
    assert.ok(/WEB_TIMEOUT_SHORT_MS/.test(PttReader.prototype.webDocTimed.toString()));
    assert.ok(/ptt\.loggingIn/.test(PttReader.prototype.fetchDoc.toString()), 'still logging in: to the BBS, waiting for it');
    PttReader.markWebUp('https://www.ptt.cc/bbs/Test/index.html');
    PttReader.webDownBy = {}; PttReader.loadWebDown();
    assert.ok(!PttReader.webRecentlyDown('list'), 'back up: forgotten');
  } finally {
    lib.isApp = isApp;
    delete global.localStorage;
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
  }
});

testAsync('app: reading ahead skips 置底 and starts while the app is still logging in (www.ptt.cc down)', async function() {
  var isApp = lib.isApp;
  try {
    lib.isApp = function() { return true; };
    var m = Object.create(JJMobile.prototype);
    var read = [];
    m.getArticle = function(url) { read.push(url); return Promise.resolve({}); };
    var ptt = { user: '', loggingIn: Promise.resolve() };
    m.app = { pref: { values: { readerPrefetchCount: 3 } },
              reader: { termSource: function() { return ptt; }, preloadMedia: function() {} } };
    var screen = { entries: [{ url: 'jjterm:art/Gossiping/0#a/p1', pinned: true }, { url: 'jjterm:art/Gossiping/0#a/p2', pinned: true },
                             { url: 'jjterm:art/Gossiping/9#a/t9' }, { url: '' }, { url: 'jjterm:art/Gossiping/8#a/t8' },
                             { url: 'jjterm:art/Gossiping/7#a/t7' }, { url: 'jjterm:art/Gossiping/6#a/t6' }] };
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
    PttReader.markWebDown('https://www.ptt.cc/bbs/Gossiping/M.1.A.2.html');
    m.prefetchList(screen, 0);
    for (var i = 0; i < 10; ++i) await Promise.resolve();
    assert.deepStrictEqual(read, ['jjterm:art/Gossiping/9#a/t9', 'jjterm:art/Gossiping/8#a/t8', 'jjterm:art/Gossiping/7#a/t7'],
      'the newest first, no 置底, while logging in');
    read = [];
    ptt.loggingIn = null;
    m.prefetchList(screen, 0);
    for (i = 0; i < 10; ++i) await Promise.resolve();
    assert.deepStrictEqual(read, [], 'not logged in and not logging in: nothing on the BBS');
  } finally {
    lib.isApp = isApp;
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
  }
});

testAsync('extension: a copy read ahead on the hidden connection a while ago is marked stale', async function() {
  var r = new PttReader({ conn: {} });
  var a = { url: 'u', meta: { '時間': '' }, pushes: [] };
  r.prefetch = { k: { board: 'test', author: 'a1', title: PttReader.prefetchKey('', '', 't1').slice(2), bg: true, done: true,
                      at: Date.now() - 60000, doneAt: Date.now() - PttReader.STALE_MS - 1, promise: Promise.resolve(a) } };
  var p = r.takePrefetch({ board: 'Test', author: 'a1', title: 't1', time: '' });
  assert.ok(p.stale);
  assert.strictEqual(await p, a);
  r.prefetch = { k: { board: 'test', author: 'a1', title: PttReader.prefetchKey('', '', 't1').slice(2), bg: true, done: true,
                      at: Date.now() - 60000, doneAt: Date.now() - 1000, promise: Promise.resolve(a) } };
  assert.ok(!r.takePrefetch({ board: 'Test', author: 'a1', title: 't1', time: '' }).stale, 'just read');
  assert.ok(/pre\.stale\) self\.refreshFromTerminal/.test(PttReader.prototype.openFor.toString()));
});

test('extension reading mode: www.ptt.cc down -> read the article in the terminal (not in the app, not for 404)', function() {
  var isApp = lib.isApp;
  try {
    var r = new PttReader({ conn: {}, buf: { pageState: 3 } });
    var e500 = new Error('HTTP 500'); e500.webStatus = 500;
    var e404 = new Error('HTTP 404'); e404.webStatus = 404;
    lib.isApp = function() { return false; };
    assert.ok(r.canReadTerminal(e500));
    assert.ok(r.canReadTerminal(new TypeError('Failed to fetch')));
    assert.ok(!r.canReadTerminal(e404));
    r.app.buf.pageState = 2;
    assert.ok(!r.canReadTerminal(e500), 'only with the article open in the terminal');
    r.app.buf.pageState = 3;
    lib.isApp = function() { return true; };
    assert.ok(!r.canReadTerminal(e500), 'the app reads on its own connection');
    assert.ok(/canReadTerminal\(e\)/.test(PttReader.prototype.openFor.toString()), 'openFor falls back');
    assert.ok(/canReadTerminal\(err\)/.test(PttReader.prototype.waitForPush.toString()), 'after a push too');
  } finally {
    lib.isApp = isApp;
  }
});

testAsync('hidden connection: a number from a filtered list lands elsewhere -> found among the author\'s posts', async function() {
  var LIST = '【板主:x】  看板《Test》\n>  14295 + 3 11/03 ii49     □ [新聞] 舊的\n';
  var AFTER = '【板主:x】  看板《Test》\n  14295 + 3 11/03 ii49     □ [新聞] 舊的\n 請輸入欲搜尋的作者:';
  // the search done: its footer back at the bottom (系列文章)
  var FOUND = '【板主:x】  系列《Test》\n     12 + 5 11/18 Ho1liday  □ [問卦] 光電水為何在脆上燒起來了?\n>    13   11/18 Ho1liday  □ [問卦] 別篇\n 系列文章  (y)回應';
  var ON = '【板主:x】  系列《Test》\n>    12 + 5 11/18 Ho1liday  □ [問卦] 光電水為何在脆上燒起來了?\n     13   11/18 Ho1liday  □ [問卦] 別篇\n 系列文章  (y)回應';
  var f = fakePtt([[LIST, { 'a': 1 }], [AFTER, { 'Ho1liday\r': 2 }], [FOUND, { '12\r': 3 }], [ON, {}]]);
  f.app.buf.rows = 6;
  f.app.conn.isConnected = true;
  await f.ptt.cursorTo(14295, { author: 'Ho1liday', title: '[問卦] 光電水為何在脆上燒起來了?' });
  assert.deepStrictEqual(f.typed, ['14295\r', 'a', 'Ho1liday\r', '12\r']);
  assert.ok(JJPtt.sameTitle('Re: [問卦] 光電水為何在脆上燒起', '[問卦] 光電水為何在脆上燒起來了?'), 'cut at the screen edge');
  assert.ok(!JJPtt.sameTitle('[問卦] 別篇', '[問卦] 光電水為何在脆上燒起來了?'));
});

testAsync('BBS list: PTT opens another article than the row -> not shown, found among the author\'s posts', async function() {
  var mk = function(author, title) {
    return [' 作者  ' + author + ' (暱稱)                                   看板  Gossiping', ' 標題  ' + title, ' 時間  Thu Nov 19 08:39:00 2026', '', '內文'];
  };
  var WRONG = mk('Taiwan007', '[新聞]普發2萬藍力拚20日三讀　賴清德點3疑慮');
  var RIGHT = mk('I26921216', '[新聞] 女子打卡竟拉扯「雷門大燈籠」 700公斤');
  var want = { author: 'I26921216', title: '[新聞] 女子打卡竟拉扯「雷門大燈籠」 700公斤' };
  var setup = function(reads) {
    var p = Object.create(JJPtt.prototype), calls = [];
    p.run = function(f) { return Promise.resolve().then(f); };
    p.ensureIn = p.toList = p.wait = p.settle = function() { return Promise.resolve(); };
    p.send = function() {};
    p.screen = function() { return '文章網址: https://www.ptt.cc/bbs/Gossiping/M.1.A.2.html'; };
    p.cursorTo = function(n, w, byAuthor) { calls.push([n, w && w.author, !!byAuthor]); return Promise.resolve(); };
    p.readHere = function(onPage) { var l = reads.shift(); onPage(1, 1, l); return Promise.resolve(l); };
    return { p: p, calls: calls };
  };
  var f = setup([WRONG, RIGHT]), drawn = [];
  var r = await f.p.termArticle('jjterm:art/Gossiping/3/recommend%3A100', want, { onPage: function(i, n, l) { drawn.push(l[1]); } });
  assert.deepStrictEqual(f.calls, [[3, 'I26921216', false], [3, 'I26921216', true]], 'again among the author\'s posts');
  assert.deepStrictEqual(drawn, [RIGHT[1]], 'the wrong one never drawn');
  assert.ok(r.html.indexOf('雷門大燈籠') >= 0 && r.html.indexOf('普發') < 0);
  f = setup([WRONG, WRONG]);
  await assert.rejects(f.p.termArticle('jjterm:art/Gossiping/3/recommend%3A100', want, {}), /開到別篇/);
  f = setup([RIGHT]);
  r = await f.p.termArticle('jjterm:art/Gossiping/3/recommend%3A100', want, {});
  assert.deepStrictEqual(f.calls, [[3, 'I26921216', false]], 'the right one: once');
  assert.ok(JJPtt.linesAre(mk('i26921216', 'Re: [新聞] 女子打卡竟拉扯「雷門大燈籠」 700公斤'), { author: 'I26921216', title: 'Re: [新聞] 女子打卡竟拉扯「雷門大燈籠」' }));
});

testAsync('BBS: the AID landing on another article (the list still in a search) -> out of the search and again; never the wrong one', async function() {
  var WANT = 'https://www.ptt.cc/bbs/Gossiping/M.1794600000.A.123.html';
  var NEAR = 'https://www.ptt.cc/bbs/Gossiping/M.1794618914.A.E04.html';
  var setup = function(inSearch, stuck, miss) {
    var p = Object.create(JJPtt.prototype), sent = [], q = false, cur = '';
    p.app = {};
    p.listQuery = '';
    p.toBoard = function() { return Promise.resolve(); };
    p.wait = p.settle = function() { return Promise.resolve(); };
    p.screen = function() {
      return q ? '│ 文章網址: ' + cur.replace(/^https/, 'http') + ' │' : '列表\n' + (inSearch ? ' 系列文章  (y)回應' : ' 文章列表  (y)回應');
    };
    p.send = function(k) {
      sent.push(k);
      if (k === 'Q') q = true;
      else if (k === ' ') q = false;
      else if (k === '\x1b[D' && !stuck) inSearch = false;
      else if (/\r$/.test(k)) cur = inSearch || miss-- > 0 ? NEAR : WANT;
    };
    return { p: p, sent: sent };
  };
  var f = setup(true);
  await f.p.toArticle(WANT);
  assert.deepStrictEqual(f.sent, ['#', JJPtt.aidFromUrl(WANT) + '\r', '#', JJPtt.aidFromUrl(WANT) + '\r', 'Q', ' ', '\x1b[D', '#', JJPtt.aidFromUrl(WANT) + '\r', '#', JJPtt.aidFromUrl(WANT) + '\r', 'Q', ' ']);
  f = setup(false);
  await f.p.toArticle(WANT);
  assert.deepStrictEqual(f.sent, ['#', JJPtt.aidFromUrl(WANT) + '\r', '#', JJPtt.aidFromUrl(WANT) + '\r', 'Q', ' '], 'right at once (two jumps): no more keys');
  // landed elsewhere in the whole list: tried again without ← (which would leave the board)
  var g = setup(false, false, 2);  // both jumps land elsewhere
  await g.p.toArticle(WANT);
  assert.deepStrictEqual(g.sent, ['#', JJPtt.aidFromUrl(WANT) + '\r', '#', JJPtt.aidFromUrl(WANT) + '\r', 'Q', ' ', '#', JJPtt.aidFromUrl(WANT) + '\r', '#', JJPtt.aidFromUrl(WANT) + '\r', 'Q', ' '], 'no ← outside a search');
  f = setup(true, true);
  await assert.rejects(f.p.toArticle(WANT), /跳到別篇/);
  assert.ok(JJPtt.sameArticle('http://www.ptt.cc/bbs/Gossiping/M.1.A.ABC.html', 'https://www.ptt.cc/bbs/Gossiping/M.1.A.abc.html?_=1'));
  assert.ok(!JJPtt.sameArticle('', ''));
});

testAsync('BBS list: the footer tells a search (系列文章) from the whole list (文章列表), whatever listQuery says', async function() {
  var HEAD = '【板主:x】  看板《Gossiping》\n   編號    日 期 作  者       文  章  標  題\n>779951  1111/19 end56        □ [問卦] 把228\n';
  var SEARCH = HEAD + ' 系列文章  (^P)發表 (y)回應 (X)推文 (d)刪除 (→)閱讀 (b)進板  (←)離開';
  var WHOLE = HEAD + ' 文章列表  (^P)發表 (y)回應 (X)推文 (d)刪除 (→)閱讀 (b)進板  (←)離開 (h)說明';
  var p = Object.create(JJPtt.prototype), sent = [], now = SEARCH;
  p.app = {};
  p.screen = function() { return now; };
  p.settle = function() { return Promise.resolve(true); };
  p.send = function(k) { sent.push(k); if (k === '\x1b[D') now = WHOLE; };
  p.listQuery = '';  // out of date: a job stopped half way
  assert.strictEqual(p.listFoot(), 'search');
  assert.ok(p.inList('Gossiping'), 'the current footers count as the list');
  await p.toBoard('Gossiping');
  assert.deepStrictEqual(sent, ['\x1b[D'], 'out of the search first (s would keep it)');
  sent.length = 0;
  await p.toBoard('Gossiping');
  assert.deepStrictEqual(sent, [], 'the whole list: nothing to do');
  p.listQuery = 'recommend:100';
  assert.strictEqual(p.listFoot(), 'list');
  var asked = [];
  p.toBoard = function() { asked.push('toBoard'); return Promise.reject(new Error('stop')); };
  await assert.rejects(p.toList('Gossiping', 'recommend:100'), /stop/);
  assert.deepStrictEqual(asked, ['toBoard'], 'listQuery says searched, the footer says the whole list: searched again');
});

testAsync('app: a list read on the BBS (jjterm: links) is read ahead though articles were never marked down', async function() {
  var isApp = lib.isApp;
  try {
    lib.isApp = function() { return true; };
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
    var m = Object.create(JJMobile.prototype), read = [];
    m.getArticle = function(url) { read.push(url); return Promise.resolve({}); };
    m.app = { pref: { values: { readerPrefetchCount: 2 } },
              reader: { termSource: function() { return { user: 'u' }; }, preloadMedia: function() {} } };
    m.prefetchList({ entries: [{ url: 'jjterm:art/G/9#a/t9' }, { url: 'jjterm:art/G/8#a/t8' }, { url: 'jjterm:art/G/7#a/t7' }] }, 0);
    for (var i = 0; i < 10; ++i) await Promise.resolve();
    assert.deepStrictEqual(read, ['jjterm:art/G/9#a/t9', 'jjterm:art/G/8#a/t8'], 'as many as the setting');
  } finally {
    lib.isApp = isApp;
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
  }
});

testAsync('app: list pages within a minute come from the cache, a reload reads again, a failure is not kept', async function() {
  var m = Object.create(JJMobile.prototype), asked = [], fail = false;
  m.app = { reader: { fetchDoc: function(url) { asked.push(url); return fail ? Promise.reject(new Error('x')) : Promise.resolve({ url: url }); } } };
  var a = await m.listDoc('u1');
  assert.strictEqual(await m.listDoc('u1'), a, 'the same page again: cached');
  await m.listDoc('u1', true);
  assert.deepStrictEqual(asked, ['u1', 'u1'], 'fresh: asked again');
  m.listDocs.u1.at = Date.now() - JJMobile.LIST_CACHE_MS - 1;
  await m.listDoc('u1');
  assert.strictEqual(asked.length, 3, 'a minute old: asked again');
  fail = true;
  await assert.rejects(m.listDoc('u2'));
  fail = false;
  await m.listDoc('u2');
  assert.strictEqual(asked.length, 5, 'a failure is not kept');
});

testAsync('app: a board\'s one-tap 推文數 searches are read ahead one at a time, not while search is down', async function() {
  var m = Object.create(JJMobile.prototype), asked = [];
  m.app = { reader: { fetchDoc: function(url) { asked.push(url); return Promise.resolve({}); } } };
  PttReader.webDownAt = 0; PttReader.webDownBy = {};
  try {
    m.prefetchSearches('Gossiping');
    assert.strictEqual(asked.length, 1, 'one at a time');
    for (var i = 0; i < 20; ++i) await Promise.resolve();
    assert.deepStrictEqual(asked, JJMobile.QUICK_PUSH.map(function(q) {
      return 'https://www.ptt.cc/bbs/Gossiping/search?q=recommend%3A' + q[0];
    }));
    var before = asked.length;
    m.prefetchSearches('Gossiping');
    for (i = 0; i < 20; ++i) await Promise.resolve();
    assert.strictEqual(asked.length, before, 'read a moment ago: not again');
    PttReader.webDownBy.search = PttReader.webDownAt = Date.now();
    m.prefetchSearches('Stock');
    assert.strictEqual(asked.length, before, 'search failing: nothing');
  } finally {
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
  }
});

test('app: 熱門看板 rows read from www.ptt.cc', function() {
  var node = function(kids) {
    return { querySelector: function(sel) { return kids[sel] || null; } };
  };
  var doc = { querySelectorAll: function() {
    return [node({ '.board-name': { textContent: ' Gossiping ' }, '.board-nuser': { textContent: ' 9999 ' },
                   '.board-title': { textContent: '◎[八卦] 測試' } }), node({})];
  } };
  assert.deepStrictEqual(JJMobile.parseHot(doc), [['Gossiping', '[八卦] 測試', '9999']]);
});

test('BBS search: what PTT filled in after the question is erased first', function() {
  var ask = JJPtt.searchCmd('recommend:100').ask;
  assert.strictEqual(JJPtt.filledIn('x\n搜尋推文數高於多少 (<0則搜噓文數) 的文章: 10      ', ask), 2);
  assert.strictEqual(JJPtt.filledIn('x\n搜尋推文數高於多少 (<0則搜噓文數) 的文章:      ', ask), 0);
  assert.strictEqual(JJPtt.filledIn('x\n 文章列表  (^P)發表', ask), 0, 'no question: nothing');
  assert.strictEqual(JJPtt.filledIn('x\n[Gossiping] 搜尋標題: 柯文哲', JJPtt.searchCmd('柯').ask), 6, 'double-byte: 2 each');
});

test('BBS search: 推文數 beyond 100 (止爆 200) as 100, PTT counting no further', function() {
  assert.strictEqual(JJPtt.searchCmd('recommend:200').text, '100');
  assert.strictEqual(JJPtt.searchCmd('recommend:-300').text, '-100');
  assert.strictEqual(JJPtt.searchCmd('recommend:50').text, '50');
});

testAsync('BBS search: Backspaces before the words though what PTT filled in is not on the screen yet', async function() {
  var p = Object.create(JJPtt.prototype), keys = [];
  var now = '【板主:x】  看板《Gossiping》\n 1 a\n搜尋推文數高於多少 (<0則搜噓文數) 的文章: ';
  p.screen = function() { return now; };
  p.toBoard = p.wait = function() { return Promise.resolve(); };
  p.send = function(k) { keys.push(k); };
  p.type = function(k) { keys.push(k); now = '【板主:x】  系列《Gossiping》\n 1 a\n 系列文章  (y)回應'; };
  p.searched = function() { return Promise.resolve('done'); };
  await p.toList('Gossiping', 'recommend:100');
  assert.deepStrictEqual(keys, ['Z', new Array(JJPtt.SEARCH_ERASE + 1).join('\x7f'), '100\r']);
});

testAsync('BBS search: done when the list\'s footer is back, not at the echo of the words typed', async function() {
  var ASK = '【板主:x】  看板《Test》\n 1 a\n搜尋推文數高於多少 (<0則搜噓文數) 的文章: ';
  var ECHO = ASK + '10';
  var DONE = '【板主:x】  系列《Test》\n 1 a\n 系列文章  (y)回應';
  var p = Object.create(JJPtt.prototype), now = ECHO, t0 = Date.now(), synced = 0;
  p.app = { conn: { isConnected: true } };
  p.connected = function() { return true; };
  p.screen = function() { return now; };
  p.sendSync = function(k) { synced++; return Promise.resolve(); };
  setTimeout(function() { now = DONE; }, 120);  // PTT searching a moment after the echo
  await p.searched(ASK);
  assert.ok(Date.now() - t0 >= 100, 'waited past the echo for the search');
  assert.strictEqual(synced, 1, 'then a whole redraw: the list after the search');
  now = ECHO;
  setTimeout(function() { now = ASK.replace(/搜尋.*$/, '◆ 找不到符合條件的文章。'); }, 30);
  assert.strictEqual(await p.searched(ASK), 'fail');
  assert.strictEqual(synced, 1, 'no Ctrl-L on 找不到 (it would close the message as any key)');
});

testAsync('BBS: keys that may leave the screen as it is (End at the newest) wait for PTT\'s redraw (Ctrl-L), not 2 s', async function() {
  var p = Object.create(JJPtt.prototype), sent = [], fed = [];
  p.app = { parser: { feed: function(d) { fed.push(d); } } };
  p.connected = function() { return true; };
  // PTT: an answer of its own (no redraw), then Ctrl-L's whole redraw, in two pieces
  p.send = function(k) {
    sent.push(k);
    setTimeout(function() { p.app.parser.feed('\x1b[?2026h\x1b[5;1H>\x1b[?2026l'); }, 10);
    setTimeout(function() { p.app.parser.feed('\x1b[?2026h\x1b[H\x1b[2J list'); }, 30);
    setTimeout(function() { p.app.parser.feed(' rows\x1b[?20'); }, 50);
    setTimeout(function() { p.app.parser.feed('26l'); }, 70);
  };
  var t0 = Date.now();
  await p.sendSync('\x1b[4~', 2000);
  var took = Date.now() - t0;
  assert.deepStrictEqual(sent, ['\x1b[4~\x0c']);
  assert.ok(took >= 60 && took < 1000, 'after the whole redraw, its end split over pieces: ' + took + ' ms');
  assert.strictEqual(fed.length, 4, 'what PTT sends still goes to the screen');
});

test('app: each screen\'s load time, once, in the corner (green within a second, orange slower)', function() {
  assert.strictEqual(JJMobile.loadText(420, '預讀'), '0.42s 預讀');
  assert.strictEqual(JJMobile.loadText(1234, ''), '1.23s');
  var m = Object.create(JJMobile.prototype), shown = [];
  var screen = { openedAt: Date.now() - 1500, loadMs: null };
  m.stack = [screen];
  m.showLoadTime = function(s) { shown.push(s.loadMs + ' ' + s.loadHow); };
  m.loaded(screen, 'BBS');
  assert.ok(screen.loadMs >= 1500 && screen.loadHow === 'BBS');
  var first = screen.loadMs;
  m.loaded(screen, '網頁');
  assert.strictEqual(screen.loadMs, first, 'the first content counts, not what comes after');
  assert.strictEqual(shown.length, 1);
  var below = { openedAt: Date.now(), loadMs: null };
  m.loaded(below, '網頁');
  assert.strictEqual(shown.length, 1, 'a screen not on top: kept for when it is back');
  assert.ok(JJMobile.LOAD_SLOW_MS === 1000);
});

testAsync('extension, www.ptt.cc down: reading ahead on a hidden connection, nearest first; an unfinished one is not waited for', async function() {
  var isApp = lib.isApp, isExt = lib.isExtension, DP = global.DOMParser;
  try {
    lib.isApp = function() { return false; };
    lib.isExtension = function() { return true; };
    global.DOMParser = function() { this.parseFromString = function(html) { return { html: html }; }; };
    var r = new PttReader({ conn: {}, pref: { values: { readerPrefetchCount: 2 }, logins: ['tester', 'pw'] } });
    var read = [];
    var release = [];
    r.bg = { termArticle: function(u) { read.push(u); return new Promise(function(res) { release.push(function() { res({ url: 'https://www.ptt.cc/bbs/Test/M.1.A.2.html', html: '<x>' }); }); }); } };
    r.articleFromDoc = function(doc, url) { return { url: url, meta: { '時間': '' }, text: '', pushes: [] }; };
    r.preloadMedia = function() {};
    var rows = [10, 11, 12, 13, 14].map(function(n) { return { author: 'a' + n, title: 't' + n, num: n }; });
    var snap = { board: 'Test', rows: rows, index: 2 };
    assert.ok(!r.bgPlan(snap, 2, 0), 'web up: as usual');
    PttReader.markWebDown('https://www.ptt.cc/bbs/Test/M.1.A.2.html');
    assert.deepStrictEqual(r.bgOrder(snap, 2, 0), [2, 3, 1, 4, 0]);
    assert.deepStrictEqual(r.bgOrder(snap, 2, -1), [2, 1, 3, 0, 4], 'reading upwards: up first');
    assert.ok(r.bgPlan(snap, 2, 0));
    assert.deepStrictEqual(read, ['jjterm:art/Test/12'], 'one at a time, the article itself first');
    assert.strictEqual(r.takePrefetch({ board: 'Test', author: 'a12', title: 't12', time: '' }), null, 'not finished: not waited for');
    release.shift()();
    await new Promise(function(res) { setTimeout(res, 5); });
    assert.deepStrictEqual(read, ['jjterm:art/Test/12', 'jjterm:art/Test/13']);
    var got = await r.takePrefetch({ board: 'Test', author: 'a12', title: 't12', time: '' });
    assert.strictEqual(got.url, 'https://www.ptt.cc/bbs/Test/M.1.A.2.html');
    // a new plan drops what was waiting (not the one being read)
    r.bgPlan({ board: 'Test', rows: rows, index: 0 }, 0, 0);
    assert.ok(!r.prefetch[PttReader.prefetchKey('Test', 'a14', 't14')], 'dropped');
    r.app.pref.logins = ['tester', ''];
    assert.strictEqual(r.bgPtt(), null, 'no saved password: no hidden connection');
  } finally {
    lib.isApp = isApp;
    lib.isExtension = isExt;
    global.DOMParser = DP;
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
  }
});

test('extension: picture hosts that need a referrer are in the manifest\'s host permissions', function() {
  var m = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  PttReader.REFERER_HOSTS.forEach(function(h) {
    assert.ok(m.host_permissions.indexOf('https://' + h + '/*') >= 0, h);
  });
  assert.ok(/1802/.test(PttReader.prototype.ensureOver18.toString()), 'the referrer rule');
});

testAsync('the app just opened, logging in: a board read on the BBS waits for the login instead of failing', async function() {
  var isApp = lib.isApp, DP = global.DOMParser;
  try {
    global.DOMParser = function() { this.parseFromString = function(html) { return { html: html }; }; };
    lib.isApp = function() { return true; };
    var calls = [];
    var ptt = { user: '', boardPage: function(b) { calls.push(b); return Promise.resolve('<list>'); } };
    ptt.waitLogin = JJPtt.prototype.waitLogin;
    var finish;
    ptt.waitLogin(new Promise(function(res) { finish = res; }));
    var r = new PttReader({ mobile: { ptt: ptt } });
    r.webDoc = function() { var e = new Error('HTTP 500'); e.webStatus = 500; return Promise.reject(e); };
    var got = r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    await new Promise(function(res) { setTimeout(res, 5); });
    assert.deepStrictEqual(calls, [], 'not yet');
    ptt.user = 'tester';
    finish();
    var doc = await got;
    assert.ok(doc.jjFromTerm);
    assert.deepStrictEqual(calls, ['Test']);
    assert.strictEqual(ptt.loggingIn, null, 'over');
    // the login failed: the usual message
    ptt.user = '';
    ptt.waitLogin(Promise.reject(new Error('密碼不對')));
    await assert.rejects(r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html'), /登入 PTT 帳號後/);
  } finally {
    lib.isApp = isApp;
    global.DOMParser = DP;
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
  }
});

testAsync('www.ptt.cc down for board lists and articles only: its search still answers and is used', async function() {
  var isApp = lib.isApp, DP = global.DOMParser;
  try {
    global.DOMParser = function() { this.parseFromString = function(html) { return { html: html }; }; };
    lib.isApp = function() { return true; };
    var calls = [], web = [];
    var ptt = { user: 'tester', boardPage: function(b, before, q) { calls.push([b, q]); return Promise.resolve('<list>'); } };
    var r = new PttReader({ mobile: { ptt: ptt } });
    r.webDoc = function(u) {
      web.push(u);
      if (/search/.test(u)) return Promise.resolve({ web: true });
      var e = new Error('HTTP 500'); e.webStatus = 500; return Promise.reject(e);
    };
    PttReader.probeAt = Date.now();  // no look at the web site in this test
    var doc = await r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    assert.ok(doc.jjFromTerm && PttReader.webRecentlyDown('list'));
    assert.strictEqual(PttReader.webKind('https://www.ptt.cc/bbs/Test/search?q=recommend%3A100'), 'search');
    assert.ok(!PttReader.webRecentlyDown('search'));
    doc = await r.fetchDoc('https://www.ptt.cc/bbs/Test/search?q=recommend%3A100');
    assert.ok(doc.web, 'search from the web site');
    assert.deepStrictEqual(calls, [['Test', undefined]]);
    doc = await r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    assert.strictEqual(web.filter(function(u) { return /index/.test(u); }).length, 1, 'the list straight from the BBS now');
  } finally {
    lib.isApp = isApp;
    global.DOMParser = DP;
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
    PttReader.probeAt = 0;
  }
});

testAsync('www.ptt.cc down a moment ago: straight to the BBS, a look at the web a minute, back once it answers', async function() {
  var isApp = lib.isApp, DP = global.DOMParser, T = PttReader.WEB_TIMEOUT_MS;
  try {
    global.DOMParser = function() { this.parseFromString = function(html) { return { html: html }; }; };
    lib.isApp = function() { return true; };
    var calls = [], web = [];
    var ptt = { user: 'tester',
      boardPage: function(b) { calls.push(['list', b]); return Promise.resolve('<list>'); },
      termArticle: function() { var e = new Error('PTT 沒有回應'); return Promise.reject(e); } };
    var r = new PttReader({ mobile: { ptt: ptt } });
    var answer = 'down';
    r.webDoc = function(u) {
      web.push(u);
      if (answer === 'ok') return Promise.resolve({ web: true });
      if (answer === 'hang') return new Promise(function() {});
      var e = new Error('HTTP 503'); e.webStatus = 503; return Promise.reject(e);
    };
    PttReader.markWebDown('https://www.ptt.cc/bbs/Test/index.html');
    PttReader.markWebDown('https://www.ptt.cc/bbs/Test/M.1.A.2.html');
    PttReader.probeAt = 0;
    var doc = await r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    assert.ok(doc.jjFromTerm);
    assert.strictEqual(web.length, 1, 'only the one look at the web site, in the background');
    await r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    assert.strictEqual(web.length, 1, 'no second look within the minute');
    // a BBS failure is not tried again on the web site
    await assert.rejects(r.fetchDoc('https://www.ptt.cc/bbs/Test/M.1.A.2.html'), /沒有回應/);
    assert.strictEqual(web.length, 1);
    // what the BBS can't open still goes to the web site
    await assert.rejects(r.fetchDoc('https://www.ptt.cc/bbs/Test/x.html'), /HTTP 503|故障/);
    assert.strictEqual(web.length, 2);
    // the web site answers again: the next look ends the BBS stand-in
    answer = 'ok';
    PttReader.probeAt = 0;
    await r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    await new Promise(function(res) { setTimeout(res, 5); });
    assert.ok(!PttReader.webRecentlyDown('list'), 'board lists answer again');
    doc = await r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    assert.ok(doc.web, 'the web site again');
    // no answer at all counts as down
    answer = 'hang';
    PttReader.WEB_TIMEOUT_MS = 20;
    calls.length = 0;
    doc = await r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    assert.ok(doc.jjFromTerm && PttReader.webRecentlyDown());
  } finally {
    lib.isApp = isApp;
    global.DOMParser = DP;
    PttReader.WEB_TIMEOUT_MS = T;
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
    PttReader.probeAt = 0;
  }
});

testAsync('www.ptt.cc down (HTTP 500) in the app: read on the BBS; 404 and the extension are not', async function() {
  var isApp = lib.isApp;
  var DP = global.DOMParser;
  try {
    global.DOMParser = function() { this.parseFromString = function(html) { return { html: html }; }; };
    var calls = [];
    var ptt = { user: 'tester',
      boardPage: function(b, before) { calls.push(['list', b, before]); return Promise.resolve('<list>'); },
      termArticle: function(u, want) { calls.push(want ? ['art', u, want] : ['art', u]); return Promise.resolve({ url: 'https://www.ptt.cc/bbs/Test/M.1.A.2.html', html: '<art>' }); } };
    var r = new PttReader({ mobile: { ptt: ptt } });
    var status = 500;
    r.webDoc = function() { var e = new Error('HTTP ' + status); e.webStatus = status; return Promise.reject(e); };
    lib.isApp = function() { return true; };
    var doc = await r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html');
    assert.ok(doc.jjFromTerm);
    assert.deepStrictEqual(calls.pop(), ['list', 'Test', 0]);
    assert.ok(PttReader.webRecentlyDown());
    doc = await r.fetchDoc('https://www.ptt.cc/bbs/Test/M.1.A.2.html?_=123');
    assert.deepStrictEqual(calls.pop(), ['art', 'https://www.ptt.cc/bbs/Test/M.1.A.2.html'], 'without the cache query');
    assert.strictEqual(doc.jjUrl, 'https://www.ptt.cc/bbs/Test/M.1.A.2.html');
    await r.fetchDoc('jjterm:list/Test/120');
    assert.deepStrictEqual(calls.pop(), ['list', 'Test', 120]);
    await r.fetchDoc('jjterm:art/Test/7');
    assert.deepStrictEqual(calls.pop(), ['art', 'jjterm:art/Test/7']);
    ptt.boardPage = function(b, before, q) { calls.push(['list', b, before, q]); return Promise.resolve('<list>'); };
    await r.fetchDoc('https://www.ptt.cc/bbs/Test/search?q=abc');
    assert.deepStrictEqual(calls.pop(), ['list', 'Test', 0, 'abc'], 'searched on the BBS');
    await r.fetchDoc('jjterm:search/Test/30/author%3Abob');
    assert.deepStrictEqual(calls.pop(), ['list', 'Test', 30, 'author:bob']);
    await r.fetchDoc('jjterm:art/Test/7/author%3Abob');
    assert.deepStrictEqual(calls.pop(), ['art', 'jjterm:art/Test/7/author%3Abob']);
    // from a list read on the BBS: the number is checked against the row's author and title
    await r.fetchDoc('jjterm:art/Test/7/recommend%3A100#bob/' + encodeURIComponent('[新聞] 某某'));
    assert.deepStrictEqual(calls.pop(), ['art', 'jjterm:art/Test/7/recommend%3A100', { author: 'bob', title: '[新聞] 某某' }]);
    await assert.rejects(r.fetchDoc('https://www.ptt.cc/bbs/Test/search?page=2&q=abc'), /重新搜尋/);
    await assert.rejects(r.fetchDoc('https://www.ptt.cc/bbs/Test/M.1.A.2.html/x'), /網頁版現在故障.*暫時不能用/);
    ptt.user = '';
    await assert.rejects(r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html'), /登入 PTT 帳號後/);
    ptt.user = 'tester';
    PttReader.webDownAt = 0; PttReader.webDownBy = {};  // not down a moment ago: the web site first
    status = 404;
    await assert.rejects(r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html'), /HTTP 404/);
    status = 500;
    lib.isApp = function() { return false; };
    await assert.rejects(r.fetchDoc('https://www.ptt.cc/bbs/Test/index.html'), /HTTP 500/, 'the extension stays in the terminal as before');
    assert.strictEqual(calls.length, 0);
  } finally {
    lib.isApp = isApp;
    global.DOMParser = DP;
    PttReader.webDownAt = 0; PttReader.webDownBy = {};
  }
});

// ---- SSH: BigInteger.modPow with BigInt (js/fast_modpow.js) -------------------

(function() {
  // the SSH library as the page loads it, then fast_modpow.js on top
  var ctx = { navigator: { userAgent: '', appName: 'Netscape', platform: '' }, document: {}, console: { log: function() {}, debug: function() {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/paramikojs_ssh.min.js'), 'utf8'), ctx);
  var BI = ctx.BigInteger;
  var jsbn = BI.prototype.modPow;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/fast_modpow.js'), 'utf8'), ctx, { filename: 'js/fast_modpow.js' });
  var crypto = require('crypto');
  function rnd(bytes) { return new BI(crypto.randomBytes(bytes).toString('hex'), 16); }
  function big(s) { return new BI(s, 10); }

  test('ssh: modPow is the BigInt one, with the same results as jsbn', function() {
    assert.notStrictEqual(BI.prototype.modPow, jsbn);
    assert.strictEqual(BI.prototype.modPow.jsbn, jsbn);
    var cases = [
      [big('2'), rnd(512), rnd(512).setBit(4095).setBit(0)],      // the DH group exchange: 4096-bit p
      [rnd(512), big('65537'), rnd(256).setBit(2047).setBit(0)],  // an RSA host key check
      [rnd(64), rnd(64), rnd(64).clearBit(0).setBit(511)],        // an even modulus
      [rnd(80), big('0'), rnd(32)], [big('0'), rnd(8), rnd(8)],
      [rnd(8), rnd(8), big('1')], [rnd(16), big('1'), rnd(8)],
      [big('-12345'), big('7'), big('1000003')]                   // negative: left to jsbn
    ];
    for (var i = 0; i < 20; ++i) cases.push([rnd(1 + i * 3), rnd(1 + i * 5), rnd(1 + i * 4).setBit(i)]);
    cases.forEach(function(c, i) {
      var want = jsbn.call(c[0], c[1], c[2]).toString(16);
      var got = c[0].modPow(c[1], c[2]);
      assert.ok(got instanceof BI, 'case ' + i + ': a BigInteger back');
      assert.strictEqual(got.toString(16), want, 'case ' + i);
    });
  });

  test('ssh: modPow of a 4096-bit group exchange is fast', function() {
    var p = rnd(512).setBit(4095).setBit(0), x = rnd(512);
    var t = Date.now();
    big('2').modPow(x, p);
    assert.ok(Date.now() - t < 400, (Date.now() - t) + ' ms');
  });

  test('ssh: fast_modpow installs once, and not without BigInt', function() {
    assert.strictEqual(ctx.FastModPow.install(BI), true);
    assert.strictEqual(BI.prototype.modPow.jsbn, jsbn, 'not wrapped twice');
    var Fake = function() {};
    Fake.prototype.modPow = function() { return 'old'; };
    var B = ctx.BigInt;
    ctx.BigInt = undefined;
    try {
      assert.strictEqual(vm.runInContext('FastModPow.install', ctx).call(ctx.FastModPow, Fake), false);
    } finally { ctx.BigInt = B; }
    assert.strictEqual(new Fake().modPow(), 'old');
  });
})();

// ---- 使用聲明 shown once on first use (js/notice.js) ---------------------------------

(function() {
  var store = {};
  var ctx = vm.createContext({
    window: { localStorage: { getItem: function(k) { return k in store ? store[k] : null; }, setItem: function(k, v) { store[k] = String(v); } } },
    lib: { isApp: function() { return false; }, isExtension: function() { return true; } }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/notice.js'), 'utf8'), ctx, { filename: 'js/notice.js' });
  var N = vm.runInContext('JJPTT_NOTICE', ctx);
  test('notice: says that more connections may be used to be faster, and that passwords stay here', function() {
    var all = N.points.map(function(p) { return p.join(' '); }).join('\n');
    assert.ok(/多開連線/.test(all) && /重複登入/.test(all), all);
    assert.ok(/密碼/.test(all) && /不會上傳/.test(all), all);
  });
  test('notice: the web version gets the relay point, the extension and app do not', function() {
    assert.strictEqual(N.list().length, N.points.length);
    ctx.lib.isExtension = function() { return false; };
    assert.strictEqual(N.list().length, N.points.length + 1);
    assert.ok(/轉接/.test(N.list().pop()[1]));
    ctx.lib.isApp = function() { return true; };
    assert.strictEqual(N.list().length, N.points.length);
  });
  test('notice: shown until 我知道了, then not again until its version goes up', function() {
    assert.strictEqual(N.seen(), false);
    N.markSeen();
    assert.strictEqual(N.seen(), true);
    N.version++;
    assert.strictEqual(N.seen(), false);
    N.version--;
  });
  test('notice: in the build (Gruntfile concat and jshint), dev.html and 設定 → 關於', function() {
    var grunt = fs.readFileSync(path.join(root, 'Gruntfile.js'), 'utf8');
    assert.strictEqual(grunt.split("'js/notice.js'").length - 1, 2);
    assert.ok(/js\/notice\.js/.test(fs.readFileSync(path.join(root, 'dev.html'), 'utf8')));
    assert.ok(/id="about_notice"/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')));
    assert.ok(/使用聲明/.test(fs.readFileSync(path.join(root, 'js/mobile_settings.js'), 'utf8')));
  });
})();

(async function() {
  for (var i = 0; i < asyncTests.length; ++i) {
    try { await asyncTests[i][1](); passed++; console.log('  ok  ' + asyncTests[i][0]); }
    catch (e) { failed++; console.log('  FAIL ' + asyncTests[i][0] + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
