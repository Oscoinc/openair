// ---------------------------------------------------------------------------
// POST /api/webhook  — Stripe Webhook 受け口
//
// 支払いが完了したら2通のメールを出す。
//   1. 購入者へ「ご注文ありがとうございます」（注文番号入り）
//      → これが iPhone の Wallet に注文として認識される起点になる
//   2. William へ「要発注」通知（発注に必要な情報を全部入れる）
//
// Stripe ダッシュボード → 開発者 → Webhook で
//   URL: https://<ドメイン>/api/webhook
//   イベント: checkout.session.completed
//             checkout.session.async_payment_succeeded
//             checkout.session.async_payment_failed
// を登録し、署名シークレット(whsec_...)を STRIPE_WEBHOOK_SECRET に入れる。
// ---------------------------------------------------------------------------

import { getStripe, normalize } from './_orders.js';
import { sendMail, orderConfirmation } from './_mail.js';
import { SHOP } from './_shop.js';

// 署名検証には「生のリクエストボディ」が必要なのでパースを止める
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

// Webhook のイベントには line_items が入らないので取り直す
async function fullOrder(sessionId) {
  const s = await getStripe().checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent'],
  });
  return { order: normalize(s), session: s };
}

function ownerText(o, session) {
  const a = o.address || {};
  return [
    `注文番号 : ${o.id}`,
    `金額     : ${o.currency === 'jpy' ? '¥' + Number(o.total).toLocaleString('ja-JP') : '€' + o.total}`,
    `決済     : ${o.payment}`,
    `状態     : ${session.payment_status}`,
    `地域     : ${o.lang}`,
    '',
    '商品:',
    ...(o.items || []).map((i) => `  ${i.name} × ${i.qty}`),
    '',
    '--- 配送先（そのままコピーして使える）---',
    o.name,
    [a.postal_code && `〒${a.postal_code}`, a.state, a.city, a.line1, a.line2, a.country]
      .filter(Boolean).join(' '),
    `TEL  : ${o.phone || '-'}`,
    `MAIL : ${o.email || '-'}`,
    '',
    `ラベル印刷 : ${SHOP.siteUrl}/api/label?session_id=${o.sessionId}&key=<ORDER_API_KEY>`,
    `注文一覧   : ${SHOP.siteUrl}/admin.html`,
    `Stripe     : https://dashboard.stripe.com/payments/${o.paymentIntentId || ''}`,
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const raw = await readRawBody(req);
    event = getStripe().webhooks.constructEvent(
      raw,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook] signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const handled = [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
    ];
    if (handled.includes(event.type)) {
      const { order, session } = await fullOrder(event.data.object.id);
      const paid = session.payment_status === 'paid';
      const failed = event.type === 'checkout.session.async_payment_failed';

      // 1. 購入者へ（支払いが通ったときだけ）
      if (paid && order.email) {
        await sendMail({ to: order.email, ...orderConfirmation(order) });
      }

      // 2. William へ
      const tag = failed ? '【入金失敗】' : paid ? '【要発注】' : '【入金待ち】';
      await sendMail({
        to: process.env.ORDER_NOTIFY_EMAIL,
        subject: `${tag}OPEN AIR ${order.id}`,
        text: ownerText(order, session),
      });
    }
  } catch (err) {
    console.error('[webhook] handler error', err);
  }

  // Stripe には常に 200 を返す（失敗を返すと延々リトライされる）
  return res.status(200).json({ received: true });
}
