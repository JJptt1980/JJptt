// Retro (handheld, 4-shade green) explanatory image. Owner 11/20: only a hint of the console — a thin grey
// frame and tiny buttons; the screen holds the content in a clear, normal font with roomy lines.
// window.__jjRetro({gb, flip, title, sub, sections:[{h, rows:[...]}]}) -> Promise<Blob>
//   row: {k:'以前'|'現在', w:0-100, v:'3～4 秒'} = bar | {s:'...', tag:'爆'} = example line
window.__jjRetro = async function (o) {
  const load = (s) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = s; });
  const P = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
  const F = '"PingFang TC","Noto Sans TC",sans-serif';
  const W = 1080, c = document.createElement('canvas'); c.width = c.height = W; const g = c.getContext('2d');
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const font = (px, wt) => { g.font = (wt || 700) + ' ' + px + 'px ' + F; };

  // Background: green with a light pixel dither.
  g.fillStyle = P[2]; g.fillRect(0, 0, W, W);
  g.fillStyle = 'rgba(155,188,15,.6)'; for (let y = 0; y < W; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < W; x += 12) g.fillRect(x, y, 6, 6);

  // GB子 on the left.
  const G = typeof o.gb === 'string' ? { src: o.gb, r: [0, 0, 1, 1] } : o.gb;
  const gb = await load(G.src);
  { const bx = G.r[0] * gb.naturalWidth, by = G.r[1] * gb.naturalHeight, bw = G.r[2] * gb.naturalWidth, bh = G.r[3] * gb.naturalHeight;
    let sh = bh, sw = sh * 0.46; if (sw > bw) { sw = bw; sh = sw / 0.46; }
    const sx = bx + (bw - sw) / 2;
    g.save(); g.beginPath(); g.rect(0, 0, 460, W); g.clip();
    if (o.flip) { g.translate(460, 0); g.scale(-1, 1); }
    g.drawImage(gb, sx, by, sw, sh, 0, 0, 460, 1000); g.restore(); }
  g.fillStyle = P[0]; g.fillRect(456, 0, 8, W);
  font(22, 500); const lab = 'JJptt 看板娘 GB子（AI 生成）', lw = g.measureText(lab).width + 24;
  rr(14, 1016, lw, 38, 10); g.fillStyle = 'rgba(155,188,15,.92)'; g.fill();
  g.fillStyle = P[0]; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(lab, 26, 1036);

  // The console hint: thin grey body, big screen, tiny controls at the bottom.
  const bx = 486, by = 22, bw = 572, bh = 1036;
  g.fillStyle = 'rgba(15,56,15,.3)'; rr(bx + 6, by + 6, bw, bh, 22); g.fill();
  g.fillStyle = '#d6d6cb'; g.beginPath(); g.moveTo(bx + 22, by); g.lineTo(bx + bw - 22, by); g.arcTo(bx + bw, by, bx + bw, by + 22, 22);
  g.lineTo(bx + bw, by + bh - 70); g.arcTo(bx + bw, by + bh, bx + bw - 70, by + bh, 70); g.lineTo(bx + 22, by + bh); g.arcTo(bx, by + bh, bx, by + bh - 22, 22);
  g.lineTo(bx, by + 22); g.arcTo(bx, by, bx + 22, by, 22); g.closePath(); g.fill();
  const sx = bx + 16, sy = by + 16, sw2 = bw - 32, sh2 = bh - 92;
  g.fillStyle = '#5b5d6e'; rr(sx, sy, sw2, sh2, 14); g.fill();
  const X = sx + 14, Y = sy + 14, SW = sw2 - 28, SH = sh2 - 28;
  g.fillStyle = P[3]; g.fillRect(X, Y, SW, SH);
  // tiny controls
  const cy = by + bh - 38;
  g.fillStyle = '#3a3a44'; g.fillRect(bx + 40, cy - 6, 36, 12); g.fillRect(bx + 52, cy - 18, 12, 36);
  g.fillStyle = '#b8325f'; [[bx + bw - 140, cy + 6], [bx + bw - 104, cy - 6]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill(); });
  font(22, 900); g.fillStyle = '#2b2f7a'; g.textAlign = 'center'; g.fillText('JJptt', bx + bw / 2 - 30, cy);

  // Screen content.
  const L = X + 30, R = X + SW - 30;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  let y = Y + 78;
  font(46); g.fillStyle = P[0]; g.fillText(o.title, L, y);
  y += 60; font(34); g.fillStyle = P[1]; g.fillText(o.sub, L, y);
  y += 36; for (let x = L; x < R; x += 12) { g.fillStyle = P[1]; g.fillRect(x, y, 6, 4); }
  y += 26;
  for (const s of o.sections) {
    y += 62;
    g.fillStyle = P[0]; g.beginPath(); g.moveTo(L, y - 26); g.lineTo(L + 16, y - 14); g.lineTo(L, y - 2); g.closePath(); g.fill();
    font(38); g.fillText(s.h, L + 28, y);
    y += 12;
    for (const r of s.rows) {
      y += 60;
      if (r.k) {
        const now = r.k === '現在', col = now ? P[0] : P[1];
        font(28, now ? 800 : 600); g.fillStyle = col; g.fillText(r.k, L + 28, y);
        const x0 = L + 104, max = 230, n = Math.max(1, Math.round(r.w / 100 * max / 18));
        for (let i = 0; i < n; i++) { g.fillStyle = col; g.fillRect(x0 + i * 18, y - 24, 14, 24); }
        font(28, now ? 800 : 600); g.fillStyle = col; g.fillText(r.v, x0 + n * 18 + 12, y);
      } else {
        let x = L + 28;
        if (r.tag) { font(24, 800); const tw = g.measureText(r.tag).width + 16; g.fillStyle = P[0]; g.fillRect(x, y - 27, tw, 34); g.fillStyle = P[3]; g.fillText(r.tag, x + 8, y); x += tw + 14; }
        font(28, 600); g.fillStyle = P[0]; g.fillText(r.s, x, y);
      }
    }
    y += 30;
  }
  return await new Promise((r) => c.toBlob(r, 'image/png'));
};
'ok';
