// Copies the built extension pages into mobile/www for the Android app.
// Run `npm run build` at the top first (it builds extension/).
const fs = require('fs');
const path = require('path');

const ext = path.join(__dirname, '..', 'extension');
const out = path.join(__dirname, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const d of ['css', 'fonts', 'cursor', 'icon', 'data', 'js']) {
  fs.cpSync(path.join(ext, d), path.join(out, d), { recursive: true });
}
for (const f of ['icon_16.png', 'icon_48.png', 'icon_128.png', 'icon_512.png', 'LICENSE']) {
  fs.copyFileSync(path.join(ext, f), path.join(out, f));
}
// which build this is (GitHub Actions run number and commit), shown in
// 設定 → 關於 so a phone can tell whether it has the newest one
const info = {
  version: require('../package.json').version,  // JJptt's (the extension's)
  run: process.env.GITHUB_RUN_NUMBER || 'dev',
  sha: (process.env.GITHUB_SHA || '').slice(0, 7),
  time: new Date().toISOString()
};
fs.writeFileSync(path.join(out, 'build-info.js'), 'window.JJPTT_BUILD = ' + JSON.stringify(info) + ';\n');
let page = fs.readFileSync(path.join(ext, 'app.html'), 'utf8');
page = page.replace('</head>', '<script src="build-info.js"></script>\n</head>');
// JJ Sans (Inter + Noto Sans JP, SIL OFL 1.1), only in the app: a cut-down
// set (common Taiwan + Japan kanji, kana, PTT's bopomofo, box drawing...).
// Characters it lacks fall back to the phone's own font. The phone UI in
// css/main.css asks for "JJ Sans" first; the extension and the web version
// have no such font and go on with the next in the list.
fs.cpSync(path.join(__dirname, 'assets', 'jjsans'), path.join(out, 'jjsans'), { recursive: true });
page = page.replace('</head>', '<style>\n' + [400, 700].map(function(w) {
  return '@font-face { font-family: "JJ Sans"; font-weight: ' + w + '; font-style: normal; font-display: block; src: url("jjsans/jj-sans-' + w + '.woff2") format("woff2"); }';
}).join('\n') + '\n</style>\n</head>');
// the page runs under the status bar and the navigation bar (it paints
// them in its own dark color; the top bar and the lists keep clear of them
// with env(safe-area-inset-*))
page = page.replace('initial-scale=1, maximum-scale=1"', 'initial-scale=1, maximum-scale=1, viewport-fit=cover"');
if (page.indexOf('viewport-fit=cover') < 0) throw new Error('app page: viewport meta not found');
fs.writeFileSync(path.join(out, 'index.html'), page);
// the app's own icon (the home screen title)
fs.copyFileSync(path.join(__dirname, 'assets', 'jjptt-app-icon-192.png'), path.join(out, 'app-icon.png'));
console.log('mobile/www updated');
