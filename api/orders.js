// ---------------------------------------------------------------------------
// GET /api/orders?key=<ORDER_API_KEY>
//
// 自宅の印刷エージェントが定期的に叩く。支払い済みの注文を新しい順に返す。
//
//   ?unprinted=1   まだ印刷していない注文だけ
//   ?since=<ISO>   その日時以降の注文だけ
//   ?limit=50      件数
//   ?demo=1        Stripe 未接続でも動作確認できるサンプルを返す
// ---------------------------------------------------------------------------

import { authorized, hasStripe, listOrders, DEMO_ORDER } from './_orders.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query || {};

  // format=text は自宅の印刷エージェント用。JSONを解析しなくて済むように
  // 「session_id<TAB>注文番号」を1行ずつ返す（bash + curl だけで回せる）
  const asText = (orders) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(orders.map((o) => `${o.sessionId}\t${o.id}`).join('\n') + (orders.length ? '\n' : ''));
  };

  if (q.demo === '1' || !hasStripe()) {
    const orders = q.unprinted === '1' && DEMO_ORDER.printedAt ? [] : [DEMO_ORDER];
    if (q.format === 'text') return asText(orders);
    return res.status(200).json({ demo: true, configured: hasStripe(), orders });
  }

  try {
    let orders = await listOrders({ limit: q.limit, since: q.since });
    if (q.unprinted === '1') orders = orders.filter((o) => !o.printedAt);
    if (q.format === 'text') return asText(orders);
    return res.status(200).json({ demo: false, configured: true, orders });
  } catch (err) {
    console.error('[orders]', err);
    return res.status(500).json({ error: err?.message || 'Failed to list orders' });
  }
}
