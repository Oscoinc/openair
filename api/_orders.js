// ---------------------------------------------------------------------------
// 注文の共通処理（Stripe を注文データベースとして使う）
//
// 別途データベースを持たない。Stripe の Checkout Session が注文そのもので、
// 「印刷したか」「発送したか」は PaymentIntent の metadata に書き戻す。
// 増えるのは環境変数1つ（STRIPE_SECRET_KEY）だけで済む。
// ---------------------------------------------------------------------------

import Stripe from 'stripe';

let _stripe;
export const getStripe = () => (_stripe ||= new Stripe(process.env.STRIPE_SECRET_KEY));

export const hasStripe = () => !!process.env.STRIPE_SECRET_KEY;

// --- 認証 -------------------------------------------------------------------
// 自宅の印刷エージェントからしか叩けないようにする。ORDER_API_KEY は
// Vercel の環境変数に入れ、エージェント側の設定ファイルにも同じ値を書く。
export function authorized(req) {
  const expected = process.env.ORDER_API_KEY;
  if (!expected) return false;
  const given =
    (req.headers['x-api-key'] && String(req.headers['x-api-key'])) ||
    (req.query && req.query.key && String(req.query.key)) ||
    '';
  if (given.length !== expected.length) return false;
  // 長さが同じときだけ、1文字ずつ比較して早期returnしない（タイミング差を作らない）
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// --- 動作確認用のサンプル注文 ------------------------------------------------
// Stripe をまだ繋いでいなくても、ラベル印刷の流れだけ試せるようにしておく。
export const DEMO_ORDER = {
  id: 'OA-DEMO01',
  sessionId: 'cs_demo_openair_sample',
  date: '2026-09-02T03:00:00.000Z',
  status: 'paid',
  lang: 'ja',
  currency: 'jpy',
  email: 'demo@example.com',
  name: '見本 太郎',
  phone: '090-0000-0000',
  address: {
    postal_code: '150-0001',
    state: '東京都',
    city: '渋谷区神宮前1-2-3',
    line1: 'オープンエアビル 5F',
    line2: '',
    country: 'JP',
  },
  items: [{ id: 'three', name: 'OPEN AIR Three', qty: 1, amount: 4980 }],
  total: 4980,
  payment: 'card',
  plan: 'once',
  printedAt: null,
  shippedAt: null,
  carrier: null,
  tracking: null,
};

// --- Checkout Session → 扱いやすい形に -------------------------------------
export function normalize(session) {
  const pi = typeof session.payment_intent === 'object' ? session.payment_intent : null;
  const ship = (pi && pi.shipping) || {};
  const addr = ship.address || {};
  const md = { ...(session.metadata || {}), ...((pi && pi.metadata) || {}) };
  const currency = (session.currency || 'jpy').toLowerCase();
  const divisor = currency === 'jpy' ? 1 : 100;

  return {
    id: session.client_reference_id || md.order_ref || session.id.slice(-8).toUpperCase(),
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : pi?.id || null,
    date: new Date((session.created || 0) * 1000).toISOString(),
    status: session.payment_status === 'paid' ? 'paid' : 'awaiting_payment',
    lang: md.lang || 'ja',
    currency,
    email: session.customer_details?.email || session.customer_email || '',
    name: ship.name || md.ship_name || session.customer_details?.name || '',
    phone: ship.phone || md.phone || '',
    // 定期便（subscription モード）では payment_intent.shipping が存在しないので、
    // create-checkout-session が metadata に残した項目から組み立てる
    address: {
      postal_code: addr.postal_code || md.ship_zip || '',
      state: addr.state || md.ship_state || '',
      city: addr.city || md.ship_city || '',
      line1: addr.line1 || md.ship_line1 || '',
      line2: addr.line2 || md.ship_line2 || '',
      country: addr.country || md.ship_country || '',
    },
    plan: md.plan === 'subscription' ? 'subscription' : 'once',
    items: (session.line_items?.data || []).map((li) => ({
      name: li.description,
      qty: li.quantity,
      amount: (li.amount_total || 0) / divisor,
    })),
    total: (session.amount_total || 0) / divisor,
    payment: session.payment_method_types?.[0] || 'card',
    printedAt: md.printed_at || null,
    shippedAt: md.shipped_at || null,
    carrier: md.carrier || null,
    tracking: md.tracking || null,
  };
}

// --- 支払い済みの注文を新しい順に取ってくる --------------------------------
export async function listOrders({ limit = 50, since = null } = {}) {
  const params = { limit: Math.min(Number(limit) || 50, 100), expand: ['data.payment_intent'] };
  if (since) params.created = { gte: Math.floor(new Date(since).getTime() / 1000) };

  const sessions = await getStripe().checkout.sessions.list(params);
  const paid = sessions.data.filter((s) => s.payment_status === 'paid');

  // line_items は list では返ってこないので、必要な分だけ個別に取る
  const out = [];
  for (const s of paid) {
    try {
      const li = await getStripe().checkout.sessions.listLineItems(s.id, { limit: 20 });
      s.line_items = li;
    } catch { /* 明細が取れなくても住所は出せるので続行 */ }
    out.push(normalize(s));
  }
  return out;
}

export async function getOrder(sessionId) {
  const s = await getStripe().checkout.sessions.retrieve(String(sessionId), {
    expand: ['line_items', 'payment_intent'],
  });
  return normalize(s);
}

// --- 印刷済み / 発送済みを Stripe 側に書き戻す ------------------------------
export async function markMetadata(order, patch) {
  if (!order.paymentIntentId) return false;
  await getStripe().paymentIntents.update(order.paymentIntentId, { metadata: patch });
  return true;
}
