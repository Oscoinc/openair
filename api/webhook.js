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

// 【重要】Vercel の素の Serverless Function では、Next.js の
//   export const config = { api: { bodyParser: false } }
// が効かない。ボディは勝手にパースされてしまい、署名検証に必要な
// 「生のバイト列」が取れないことがある。そこで2段構えにする。
//   1. 生ボディが取れたときは、本来どおり署名を検証する
//   2. 取れなかったときは、届いたイベントIDで Stripe に問い合わせて
//      「自分のアカウントに本当に存在するイベントか」を確認する
// 2 でも、攻撃者は実在するイベントIDを作れないので偽の注文は通らない。
async function readRawBody(req) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks);
  } catch {
    return Buffer.alloc(0);
  }
}

async function resolveEvent(req) {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const raw = await readRawBody(req);

  if (raw.length > 0 && sig && secret) {
    return getStripe().webhooks.constructEvent(raw, sig, secret);
  }

  const parsed = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!parsed.id || !String(parsed.id).startsWith('evt_')) {
    throw new Error('raw body unavailable and no event id in payload');
  }
  console.warn('[webhook] 生ボディが取れなかったのでイベントIDで照会します', parsed.id);
  return await getStripe().events.retrieve(String(parsed.id));
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
    event = await resolveEvent(req);
  } catch (err) {
    console.error('[webhook] 検証に失敗', err.message);
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
