// ---------------------------------------------------------------------------
// GET  /api/label?session_id=cs_xxx&key=<ORDER_API_KEY>
//        → 印刷用のHTMLを返す（宛名ラベル + 納品書）
//          &size=100x150（サーマルラベル・初期値） | a4
//          &only=label | slip   （初期値は両方）
//          &demo=1              Stripe 未接続でも見た目を確認できる
//
// POST /api/label   { session_id, printed: true }   ヘッダ x-api-key
//        → Stripe 側に printed_at を書き戻す（二重印刷を防ぐ）
// ---------------------------------------------------------------------------

import { authorized, hasStripe, getOrder, markMetadata, DEMO_ORDER } from './_orders.js';
import { SHOP, senderLines } from './_shop.js';

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function jpDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// 宛名の並び。日本は 〒 → 都道府県市区町村 → 建物 の順、海外は line1 が先
function addressLines(o) {
  const a = o.address || {};
  if ((a.country || 'JP').toUpperCase() === 'JP') {
    return [
      a.postal_code ? `〒${a.postal_code}` : '',
      [a.state, a.city].filter(Boolean).join(' '),
      [a.line1, a.line2].filter(Boolean).join(' '),
    ].filter(Boolean);
  }
  return [
    [a.line1, a.line2].filter(Boolean).join(', '),
    [a.city, a.state, a.postal_code].filter(Boolean).join(' '),
    a.country,
  ].filter(Boolean);
}

export function render(o, { size = '100x150', only = 'both' } = {}) {
  const isA4 = size === 'a4';
  const page = isA4 ? 'A4' : '100mm 150mm';
  const honorific = (o.address?.country || 'JP').toUpperCase() === 'JP' ? ' 様' : '';
  const addr = addressLines(o).map((l) => `<div class="al">${esc(l)}</div>`).join('');
  const items = (o.items || [])
    .map((i) => `<tr><td>${esc(i.name)}</td><td class="q">${esc(i.qty)}</td></tr>`)
    .join('');
  const sender = senderLines().map((l) => `<div>${esc(l)}</div>`).join('');
  const cur = o.currency === 'jpy' ? '¥' : '€';
  const total = o.currency === 'jpy' ? Number(o.total).toLocaleString('ja-JP') : Number(o.total).toFixed(2);

  const labelSheet = `
  <section class="sheet label">
    <div class="hd"><span class="brand">${esc(SHOP.brand)}</span><span class="ref">${esc(o.id)}</span></div>
    <div class="to">
      ${addr}
      <div class="nm">${esc(o.name)}${honorific}</div>
      ${o.phone ? `<div class="tel">TEL ${esc(o.phone)}</div>` : ''}
    </div>
    <div class="ft">
      <div class="from">${sender}</div>
      <div class="meta">${esc(jpDate(o.date))}<br>${(o.items || []).reduce((n, i) => n + (i.qty || 0), 0)}点</div>
    </div>
  </section>`;

  const slipSheet = `
  <section class="sheet slip">
    <h1>納品書</h1>
    <div class="row"><span>注文番号</span><b>${esc(o.id)}</b></div>
    <div class="row"><span>注文日</span><b>${esc(jpDate(o.date))}</b></div>
    <div class="row"><span>お届け先</span><b>${esc(o.name)}${honorific}</b></div>
    <table>${items}</table>
    <div class="row total"><span>合計（税込）</span><b>${cur}${total}</b></div>
    <p class="thanks">このたびはご購入ありがとうございます。<br>
      ご不明な点は ${esc(SHOP.email)} までご連絡ください。</p>
    <div class="from small">${sender}</div>
  </section>`;

  const body =
    only === 'label' ? labelSheet : only === 'slip' ? slipSheet : labelSheet + slipSheet;

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(o.id)} — ラベル</title>
<style>
  @page { size: ${page}; margin: 0; }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; background:#fff; color:#000;
    font-family:"Hiragino Sans","Yu Gothic","Noto Sans JP",system-ui,sans-serif;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .sheet{ width:${isA4 ? '210mm' : '100mm'}; height:${isA4 ? '297mm' : '150mm'};
    padding:${isA4 ? '18mm' : '6mm'}; page-break-after:always; break-after:page;
    display:flex; flex-direction:column; }
  .sheet:last-child{ page-break-after:auto; break-after:auto; }

  .label .hd{ display:flex; justify-content:space-between; align-items:baseline;
    border-bottom:1.2pt solid #000; padding-bottom:2mm; }
  .brand{ font-size:${isA4 ? '16pt' : '11pt'}; letter-spacing:.22em; font-weight:600; }
  .ref{ font-size:${isA4 ? '16pt' : '12pt'}; font-weight:700; font-variant-numeric:tabular-nums; }
  .label .to{ flex:1; display:flex; flex-direction:column; justify-content:center; padding:3mm 0; }
  .al{ font-size:${isA4 ? '15pt' : '11.5pt'}; line-height:1.5; }
  .nm{ font-size:${isA4 ? '26pt' : '19pt'}; font-weight:700; margin-top:3mm; letter-spacing:.04em; }
  .tel{ font-size:${isA4 ? '12pt' : '9.5pt'}; margin-top:1.5mm; }
  .label .ft{ display:flex; justify-content:space-between; align-items:flex-end;
    border-top:.6pt solid #666; padding-top:2mm; }
  .from{ font-size:${isA4 ? '9pt' : '7pt'}; line-height:1.45; color:#333; }
  .meta{ font-size:${isA4 ? '9pt' : '7pt'}; text-align:right; color:#333; }

  .slip h1{ font-size:${isA4 ? '20pt' : '13pt'}; margin:0 0 4mm; letter-spacing:.1em; }
  .slip .row{ display:flex; justify-content:space-between; font-size:${isA4 ? '11pt' : '9pt'};
    padding:1.4mm 0; border-bottom:.4pt solid #ddd; }
  .slip table{ width:100%; border-collapse:collapse; margin:3mm 0; }
  .slip td{ font-size:${isA4 ? '11pt' : '9pt'}; padding:1.4mm 0; border-bottom:.4pt solid #eee; }
  .slip td.q{ text-align:right; width:14mm; }
  .slip .total{ border-bottom:none; border-top:1pt solid #000; margin-top:2mm;
    font-size:${isA4 ? '13pt' : '10pt'}; }
  .thanks{ font-size:${isA4 ? '10pt' : '7.5pt'}; line-height:1.6; color:#333; margin-top:auto; }
  .from.small{ margin-top:3mm; }
</style></head><body>${body}
<script>
  // 印刷エージェントはヘッドレスでPDF化するので何もしない。
  // ブラウザで開いたときだけ印刷ダイアログを出す。
  if (!/HeadlessChrome/.test(navigator.userAgent) && location.search.indexOf('noprint') < 0) {
    window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 350); });
  }
</script>
</body></html>`;
}

// --- プレーンテキスト版 -----------------------------------------------------
// HTML→PDF の変換が使えない環境でも、これなら lpr にそのまま流せる。
// サーマルラベルプリンタは幅32〜48桁程度が多いので、余白を詰めた素朴な体裁にする。
export function renderText(o) {
  const a = o.address || {};
  const jp = (a.country || 'JP').toUpperCase() === 'JP';
  const honorific = jp ? ' 様' : '';
  const lines = [
    `OPEN AIR            ${o.id}`,
    '--------------------------------',
    ...addressLines(o),
    '',
    `${o.name}${honorific}`,
    o.phone ? `TEL ${o.phone}` : '',
    '--------------------------------',
    ...(o.items || []).map((i) => `${i.name}  x${i.qty}`),
    '',
    ...senderLines(),
    jpDate(o.date),
    '',
    '',
    '',
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  // --- 印刷済みの書き戻し ---
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!body.session_id) return res.status(400).json({ error: 'session_id is required' });
    if (!hasStripe() || String(body.session_id).startsWith('cs_demo')) {
      return res.status(200).json({ ok: true, demo: true });
    }
    try {
      const order = await getOrder(body.session_id);
      await markMetadata(order, { printed_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[label:post]', err);
      return res.status(500).json({ error: err?.message || 'Failed to mark printed' });
    }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const opts = { size: q.size === 'a4' ? 'a4' : '100x150', only: q.only || 'both' };

  let order;
  if (q.demo === '1' || !hasStripe() || String(q.session_id || '').startsWith('cs_demo')) {
    order = DEMO_ORDER;
  } else {
    if (!q.session_id) return res.status(400).json({ error: 'session_id is required' });
    try {
      order = await getOrder(q.session_id);
    } catch (err) {
      console.error('[label]', err);
      return res.status(500).json({ error: err?.message || 'Failed to load order' });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  if (q.format === 'txt') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(renderText(order));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(render(order, opts));
}
