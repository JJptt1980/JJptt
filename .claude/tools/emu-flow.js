// injected into the app's WebView: www.ptt.cc "down" for the kinds in
// SIM_DOWN, then the owner's flow: Gossiping 爆文 -> 止爆 -> 噓爆, the
// first N articles of each opened like a tap (after a pause like a user's),
// timed and checked against the row.
(async function() {
  var m = pttchrome.app.mobile, r = pttchrome.app.reader;
  if (!r._origWebDoc) r._origWebDoc = r.webDoc;
  window.SIM_DOWN = window.SIM_DOWN || { list: 1, search: 1, article: 1 };
  r.webDoc = function(url) {
    if (window.SIM_DOWN[PttReader.webKind(url)]) { var e = new Error('HTTP 500'); e.webStatus = 500; return Promise.reject(e); }
    return r._origWebDoc.call(r, url);
  };
  r.probeWeb = function() {};
  var sleep = function(ms) { return new Promise(function(res) { setTimeout(res, ms); }); };
  var norm = function(t) { return String(t || '').replace(/^\s*(?:(?:Re|R|Fw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim(); };
  var out = [];
  var queries = window.SIM_QUERIES || ['recommend:100', 'recommend:200', 'recommend:-100'];
  var N = window.SIM_N || 4;
  for (var qi = 0; qi < queries.length; ++qi) {
    var q = queries[qi];
    var t0 = Date.now();
    m.open({ type: 'board', board: 'Gossiping', query: q });
    var screen = m.stack[m.stack.length - 1];
    while (!(screen.entries && screen.entries.length) && Date.now() - t0 < 60000) await sleep(100);
    var listMs = Date.now() - t0;
    var ents = (screen.entries || []).filter(function(e) { return e.url && !e.pinned; }).slice(0, N);
    out.push({ q: q, listMs: listMs, n: (screen.entries || []).length, fromTerm: /jjterm/.test((ents[0] || {}).url || '') });
    await sleep(window.SIM_PAUSE || 1500);  // the user looks at the list
    for (var i = 0; i < ents.length; ++i) {
      var e = ents[i], ta = Date.now(), res = { i: i + 1, row: e.author + ' ' + e.title.slice(0, 20) };
      try {
        var a = await m.getArticle(e.url, function() {});
        res.ms = Date.now() - ta;
        var au = String(a.meta['作者'] || '').split(/\s/)[0];
        res.got = au + ' ' + String(a.meta['標題'] || '').slice(0, 20);
        res.ok = au.toLowerCase() === e.author.toLowerCase() &&
          (norm(a.meta['標題']).indexOf(norm(e.title).replace(/…$/, '')) === 0 || norm(e.title).indexOf(norm(a.meta['標題'])) === 0);
      } catch (err) { res.ms = Date.now() - ta; res.err = String(err && err.message); }
      out.push(res);
      await sleep(window.SIM_READ || 800);  // reading it, then back
    }
    m.back && m.back();
  }
  return JSON.stringify(out);
})()
