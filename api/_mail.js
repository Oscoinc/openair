// ---------------------------------------------------------------------------
// メール送信（Resend）と、注文確認 / 発送通知のテンプレート
//
// ★ iPhone の Wallet に「配送状況」を出すための肝がここ。
//   Apple は Wallet で、メールアプリに届いた注文確認メール・発送通知メールを
//   読み取って注文を認識する（Apple Pay での購入である必要はない）。
//   認識されやすくするために、
//     - 件名と本文に注文番号を必ず入れる
//     - 発送通知には配送会社名と追跡番号を「見える形で」入れる
//     - schema.org の Order / ParcelDelivery を JSON-LD で埋める
//   の3つを守っている。文面を変えるときもこの3つは崩さないこと。
// ---------------------------------------------------------------------------

import { SHOP } from './_shop.js';

export const CARRIERS = {
  yamato: {
    name: 'ヤマト運輸',
    url: (t) => `https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number00=1&number01=${encodeURIComponent(t)}`,
  },
  japanpost: {
    name: '日本郵便',
    url: (t) => `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${encodeURIComponent(t)}&searchKind=S002&locale=ja`,
  },
  sagawa: {
    name: '佐川急便',
    url: (t) => `https://k2k.sagawa-exp.co.jp/p/sagawa/web/okurijoinput.jsp?okurijoNo=${encodeURIComponent(t)}`,
  },
  other: { name: '配送業者', url: () => '' },
};

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (o) =>
  o.currency === 'jpy' ? `¥${Number(o.total).toLocaleString('ja-JP')}` : `€${Number(o.total).toFixed(2)}`;

function addressText(o) {
  const a = o.address || {};
  if ((a.country || 'JP').toUpperCase() === 'JP') {
    return [a.postal_code ? `〒${a.postal_code}` : '', a.state, a.city, a.line1, a.line2]
      .filter(Boolean).join(' ');
  }
  return [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(', ');
}

// --- Resend で送る（キー未設定ならログだけ出して静かに続行）-----------------
export async function sendMail({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    console.log('[mail:skipped]', to, subject, '\n', text);
    return { sent: false, reason: key ? 'no recipient' : 'RESEND_API_KEY not set' };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ORDER_NOTIFY_FROM || 'OPEN AIR <onboarding@resend.dev>',
        to: [to],
        subject,
        text,
        html,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.error('[mail] resend failed', r.status, body);
      return { sent: false, reason: `resend ${r.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('[mail] error', err);
    return { sent: false, reason: String(err) };
  }
}

function shell(inner, jsonLd) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head>
<body style="margin:0;background:#f5f5f7;padding:24px 12px;
  font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',sans-serif;color:#1d1d1f;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 24px;">
  <div style="font-size:12px;letter-spacing:.28em;color:#86868b;margin-bottom:20px;">OPEN AIR</div>
  ${inner}
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e8e8ed;font-size:12px;color:#86868b;line-height:1.7;">
    ${esc(SHOP.legalName)}<br>
    お問い合わせ: <a href="mailto:${esc(SHOP.email)}" style="color:#86868b;">${esc(SHOP.email)}</a><br>
    <a href="${esc(SHOP.siteUrl)}" style="color:#86868b;">${esc(SHOP.siteUrl)}</a>
  </div>
</div></body></html>`;
}

function itemRows(o) {
  return (o.items || [])
    .map(
      (i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f2;font-size:14px;">${esc(i.name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f2;font-size:14px;text-align:right;">×${esc(i.qty)}</td></tr>`
    )
    .join('');
}

// --- 注文確認メール（購入直後） --------------------------------------------
export function orderConfirmation(o) {
  const subject = `【OPEN AIR】ご注文ありがとうございます（注文番号 ${o.id}）`;

  const text = [
    `${o.name} 様`,
    '',
    'このたびは OPEN AIR をご購入いただきありがとうございます。',
    'ご注文を承りました。',
    '',
    `注文番号: ${o.id}`,
    `注文日: ${new Date(o.date).toLocaleDateString('ja-JP')}`,
    `合計金額: ${money(o)}（税込）`,
    '',
    'ご注文内容:',
    ...(o.items || []).map((i) => `  ${i.name} × ${i.qty}`),
    '',
    'お届け先:',
    `  ${o.name} 様`,
    `  ${addressText(o)}`,
    '',
    SHOP.deliveryTime,
    '発送が完了しましたら、追跡番号をメールでお知らせします。',
    '',
    `${SHOP.legalName}`,
    `${SHOP.email}`,
    `${SHOP.siteUrl}`,
  ].join('\n');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Order',
    merchant: { '@type': 'Organization', name: SHOP.brand, url: SHOP.siteUrl },
    orderNumber: o.id,
    orderDate: o.date,
    orderStatus: 'https://schema.org/OrderProcessing',
    priceCurrency: (o.currency || 'jpy').toUpperCase(),
    price: String(o.total),
    acceptedOffer: (o.items || []).map((i) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Product', name: i.name },
      eligibleQuantity: { '@type': 'QuantitativeValue', value: i.qty },
    })),
    customer: { '@type': 'Person', name: o.name },
    url: `${SHOP.siteUrl}/complete.html?session_id=${o.sessionId || ''}`,
  };

  const html = shell(
    `<h1 style="font-size:22px;margin:0 0 8px;">ご注文ありがとうございます</h1>
     <p style="font-size:14px;line-height:1.8;color:#424245;margin:0 0 20px;">
       ${esc(o.name)} 様<br>ご注文を承りました。発送までしばらくお待ちください。</p>
     <div style="background:#f5f5f7;border-radius:12px;padding:16px;margin-bottom:20px;">
       <div style="font-size:12px;color:#86868b;">注文番号</div>
       <div style="font-size:20px;font-weight:600;letter-spacing:.04em;">${esc(o.id)}</div>
     </div>
     <table style="width:100%;border-collapse:collapse;">${itemRows(o)}
       <tr><td style="padding:12px 0 0;font-size:15px;font-weight:600;">合計（税込）</td>
       <td style="padding:12px 0 0;font-size:15px;font-weight:600;text-align:right;">${esc(money(o))}</td></tr>
     </table>
     <div style="margin-top:20px;font-size:13px;line-height:1.8;color:#424245;">
       <b>お届け先</b><br>${esc(o.name)} 様<br>${esc(addressText(o))}</div>
     <p style="margin-top:20px;font-size:13px;line-height:1.8;color:#424245;">
       ${esc(SHOP.deliveryTime)}<br>発送が完了しましたら、追跡番号をメールでお知らせします。</p>`,
    jsonLd
  );

  return { subject, text, html };
}

// --- 発送通知メール（追跡番号を入れる。ここが Wallet に効く）---------------
export function shippingNotice(o, carrierKey, tracking) {
  const c = CARRIERS[carrierKey] || CARRIERS.other;
  const url = c.url(tracking);
  const subject = `【OPEN AIR】商品を発送しました（注文番号 ${o.id} / 追跡番号 ${tracking}）`;

  const text = [
    `${o.name} 様`,
    '',
    'ご注文の商品を発送しました。',
    '',
    `注文番号: ${o.id}`,
    `配送業者: ${c.name}`,
    `追跡番号: ${tracking}`,
    ...(url ? [`追跡URL: ${url}`] : []),
    '',
    'お届け先:',
    `  ${o.name} 様`,
    `  ${addressText(o)}`,
    '',
    'ご注文内容:',
    ...(o.items || []).map((i) => `  ${i.name} × ${i.qty}`),
    '',
    `${SHOP.legalName}`,
    `${SHOP.email}`,
  ].join('\n');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ParcelDelivery',
    deliveryAddress: {
      '@type': 'PostalAddress',
      streetAddress: [o.address?.line1, o.address?.line2].filter(Boolean).join(' '),
      addressLocality: o.address?.city || '',
      addressRegion: o.address?.state || '',
      postalCode: o.address?.postal_code || '',
      addressCountry: o.address?.country || 'JP',
    },
    expectedArrivalUntil: new Date(Date.now() + 7 * 864e5).toISOString(),
    carrier: { '@type': 'Organization', name: c.name },
    itemShipped: (o.items || []).map((i) => ({ '@type': 'Product', name: i.name })),
    trackingNumber: tracking,
    trackingUrl: url || undefined,
    partOfOrder: {
      '@type': 'Order',
      orderNumber: o.id,
      merchant: { '@type': 'Organization', name: SHOP.brand, url: SHOP.siteUrl },
    },
  };

  const html = shell(
    `<h1 style="font-size:22px;margin:0 0 8px;">商品を発送しました</h1>
     <p style="font-size:14px;line-height:1.8;color:#424245;margin:0 0 20px;">
       ${esc(o.name)} 様<br>ご注文の商品を発送しました。到着まで今しばらくお待ちください。</p>
     <div style="background:#f5f5f7;border-radius:12px;padding:16px;margin-bottom:16px;">
       <div style="font-size:12px;color:#86868b;">注文番号</div>
       <div style="font-size:18px;font-weight:600;margin-bottom:12px;">${esc(o.id)}</div>
       <div style="font-size:12px;color:#86868b;">配送業者</div>
       <div style="font-size:15px;margin-bottom:12px;">${esc(c.name)}</div>
       <div style="font-size:12px;color:#86868b;">追跡番号</div>
       <div style="font-size:20px;font-weight:600;letter-spacing:.06em;">${esc(tracking)}</div>
     </div>
     ${url ? `<a href="${esc(url)}" style="display:inline-block;background:#1d1d1f;color:#fff;
        text-decoration:none;padding:12px 24px;border-radius:999px;font-size:14px;">配送状況を確認する</a>` : ''}
     <div style="margin-top:22px;font-size:13px;line-height:1.8;color:#424245;">
       <b>お届け先</b><br>${esc(o.name)} 様<br>${esc(addressText(o))}</div>`,
    jsonLd
  );

  return { subject, text, html };
}
