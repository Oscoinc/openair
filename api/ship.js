// ---------------------------------------------------------------------------
// POST /api/ship
//   ヘッダ: x-api-key: <ORDER_API_KEY>
//   本文  : { session_id, carrier: 'yamato'|'japanpost'|'sagawa'|'other', tracking }
//
// 追跡番号を Stripe 側に記録し、購入者へ発送通知メールを送る。
// このメールが iPhone の Wallet に「配送状況」を出させる引き金になるので、
// 追跡番号と配送会社名を必ず入れること（_mail.js のテンプレートで担保している）。
// ---------------------------------------------------------------------------

import { authorized, hasStripe, getOrder, markMetadata, DEMO_ORDER } from './_orders.js';
import { sendMail, shippingNotice, CARRIERS } from './_mail.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { session_id, carrier, tracking } = body;

  if (!session_id) return res.status(400).json({ error: 'session_id is required' });
  if (!tracking || String(tracking).trim().length < 6) {
    return res.status(400).json({ error: 'tracking number looks invalid' });
  }
  const carrierKey = CARRIERS[carrier] ? carrier : 'other';

  try {
    const demo = !hasStripe() || String(session_id).startsWith('cs_demo');
    const order = demo ? DEMO_ORDER : await getOrder(session_id);
    const shippedAt = new Date().toISOString();

    if (!demo) {
      await markMetadata(order, {
        shipped_at: shippedAt,
        carrier: carrierKey,
        tracking: String(tracking).trim(),
      });
    }

    const mail = shippingNotice(order, carrierKey, String(tracking).trim());
    const result = await sendMail({ to: order.email, ...mail });

    return res.status(200).json({
      ok: true,
      demo,
      shippedAt,
      carrier: carrierKey,
      tracking: String(tracking).trim(),
      mail: result,
    });
  } catch (err) {
    console.error('[ship]', err);
    return res.status(500).json({ error: err?.message || 'Failed to record shipment' });
  }
}
