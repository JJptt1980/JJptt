// New-style explanatory image: GB子 left + two 3-step panels (before / after) on the right. Drawn fresh, no old screenshots.
// window.__jjPanels({gb, L1, L2, top:{label, col, steps:[[..],[..],[..]], last:'bad'|'good'}, bottom:{...}}) -> Promise<Blob>
window.__jjPanels = async function (o) {
  const load = (s) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = s; });
  const W = 1080, c = document.createElement('canvas'); c.width = c.height = W; const g = c.getContext('2d');
  const F = '"PingFang TC","Noto Sans TC",sans-serif';
  const bg = g.createLinearGradient(0, 0, W, W); bg.addColorStop(0, '#fbe7f1'); bg.addColorStop(1, '#f3c9dc'); g.fillStyle = bg; g.fillRect(0, 0, W, W);
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fit = (t, max, size, wt) => { let s = size; do { g.font = wt + ' ' + s + 'px ' + F; s -= 2; } while (g.measureText(t).width > max && s > 16); };
  // o.gb: url string, or {src, r:[fx,fy,fw,fh]} = one person's box inside a collage (fractions of the photo)
  const G = typeof o.gb === 'string' ? { src: o.gb, r: [0, 0, 1, 1] } : o.gb;
  const gb = await load(G.src);
  { const bx = G.r[0] * gb.naturalWidth, by = G.r[1] * gb.naturalHeight, bw = G.r[2] * gb.naturalWidth, bh = G.r[3] * gb.naturalHeight;
    let sh = bh, sw = sh * 0.521; if (sw > bw) { sw = bw; sh = sw / 0.521; }
    const sx = bx + (bw - sw) / 2, sy = by;
    if (o.flip) { g.save(); g.translate(511, 0); g.scale(-1, 1); g.drawImage(gb, sx, sy, sw, sh, 0, 80, 521, 1000); g.restore(); }
    else g.drawImage(gb, sx, sy, sw, sh, -10, 80, 521, 1000); }
  rr(470, 30, 580, 160, 30); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#262844'; g.stroke();
  g.textAlign = 'center'; g.fillStyle = '#262844'; fit(o.L1, 540, 48, '700'); g.fillText(o.L1, 760, 100);
  g.fillStyle = '#d0325a'; fit(o.L2, 540, 30, '500'); g.fillText(o.L2, 760, 155);
  const K = { term: { fill: '#1d1f2e', stroke: '#1d1f2e', color: '#e8e8e8' }, good: { fill: '#e6f6e8', stroke: '#3fae5c', color: '#1f5a30' }, bad: { fill: '#fde7ea', stroke: '#d0325a', color: '#8a1d36' } };
  const step = (x, y, w, h, lines, k) => { rr(x, y, w, h, 16); g.fillStyle = k.fill; g.fill(); g.lineWidth = 3; g.strokeStyle = k.stroke; g.stroke();
    g.textAlign = 'center'; g.fillStyle = k.color; lines.forEach((t, i) => { fit(t, w - 16, i === 0 ? 24 : 20, i === 0 ? '700' : '500'); g.fillText(t, x + w / 2, y + h / 2 - ((lines.length - 1) * 15) + i * 30 + 8); }); };
  const arrow = (x, y) => { g.fillStyle = '#262844'; g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 18, y); g.lineTo(x, y + 12); g.closePath(); g.fill(); };
  const panel = (y, p) => {
    rr(470, y, 580, 390, 28); g.fillStyle = 'rgba(255,255,255,.92)'; g.fill(); g.lineWidth = 5; g.strokeStyle = p.col; g.stroke();
    g.font = '700 28px ' + F; const lw = Math.max(150, g.measureText(p.label).width + 40);
    rr(495, y + 22, lw, 52, 26); g.fillStyle = p.col; g.fill(); g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(p.label, 495 + lw / 2, y + 58);
    const bw = 162, gap = 24, bx = 490, by = y + 105, bh = 250;
    p.steps.forEach((s, i) => { step(bx + i * (bw + gap), by, bw, bh, s, i < 2 ? K.term : K[p.last]); if (i < 2) arrow(bx + i * (bw + gap) + bw + 3, by + bh / 2); });
  };
  panel(215, o.top); panel(635, o.bottom);
  g.textAlign = 'left'; g.font = '500 22px ' + F; g.fillStyle = 'rgba(38,40,68,.75)'; g.fillText('JJptt 看板娘 GB子（AI 生成）', 24, 1062);
  for (let i = 0; i < 54; i++) { g.fillStyle = i % 2 ? '#262844' : '#fff'; g.fillRect(i * 20, 1070, 20, 10); }
  return await new Promise((r) => c.toBlob(r, 'image/png'));
};
'ok';
