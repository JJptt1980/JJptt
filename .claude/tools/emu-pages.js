// Injected into the app's WebView (.claude/tools/emu-cdp.sh "$(cat .claude/tools/emu-pages.js)"):
// opens the pages the owner uses, like taps, and reads each one's load time
// (the corner, JJMobile.loaded). window.SIM_DOWN as in emu-flow.js; {} = the
// web site as it is. Prints one line per page: ms, where from, what.
(async function() {
  var m = pttchrome.app.mobile, r = pttchrome.app.reader;
  if (!r._origWebDoc) r._origWebDoc = r.webDoc;
  var down = window.SIM_DOWN || {};
  r.webDoc = function(url) {
    if (down[PttReader.webKind(url)]) { var e = new Error('HTTP 500'); e.webStatus = 500; return Promise.reject(e); }
    return r._origWebDoc.call(r, url);
  };
  if (Object.keys(down).length) r.probeWeb = function() {};
  var sleep = function(ms) { return new Promise(function(res) { setTimeout(res, ms); }); };
  var out = [];
  var top = function() { return m.stack[m.stack.length - 1]; };
  var timed = async function(what) {
    var s = top(), t0 = Date.now();
    while (s.loadMs === null && Date.now() - t0 < 30000) await sleep(20);
    out.push((s.loadMs === null ? 'NONE' : s.loadMs) + 'ms ' + (s.loadHow || '') + ' ' + what);
    await sleep(window.SIM_PAUSE || 1200);  // looking at it
  };
  while (m.stack.length > 1) m.back();
  m.articles = {};
  var home = m.stack[0];
  home.tab = 'hot'; m.reload(home); await timed('首頁 熱門看板');
  var board = window.SIM_BOARD || 'Gossiping';
  var lists = [''].concat(window.SIM_QUERIES || ['recommend:100', 'recommend:-100']);
  for (var qi = 0; qi < lists.length; ++qi) {
    m.open({ type: 'board', board: board, query: lists[qi] || undefined }); await timed('列表 ' + board + ' ' + (lists[qi] || '全部'));
    var list = top();
    var ents = list.entries.filter(function(e) { return e.url && !e.pinned; }).slice(0, window.SIM_N || 3);
    for (var i = 0; i < ents.length; ++i) {
      m.open({ type: 'article', url: ents[i].url, list: list, index: list.entries.indexOf(ents[i]), title: board });
      await timed('文章 ' + ents[i].title.slice(0, 18));
      m.back();
    }
    m.back();
  }
  return out.join('\n');
})()
