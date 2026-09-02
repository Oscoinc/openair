// ---------------------------------------------------------------------------
// GET /api/order?session_id=cs_xxx
//
// complete.html から呼ばれる。「本当に支払いが完了した注文」だけを返す。
// localStorage を信じると、URLを直接叩いただけで注文完了画面が出てしまうので、
// 完了画面は必ず Stripe に問い合わせて確認する。
// ---------------------------------------------------------------------------

import Stripe from 'stripe';
import { PRODUCTS } from './_products.js';

let _stripe;
const getStripe = () => (_stripe ||= new Stripe(process.env.STRIPE_SECRET_KEY));

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.query?.session_id;
  if (!sessionId || !String(sessionId).startsWith('cs_')) {
    return res.status(400).json({ error: 'Invalid session_id' });
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(String(sessionId), {
      expand: ['line_items', 'payment_intent'],
    });

    // paid = カード決済完了 / unpaid + konbini = 支払い番号発行済み（入金待ち）
    const isPaid = session.payment_status === 'paid';
    const isPending = session.payment_status === 'unpaid' && session.status === 'complete';
    if (!isPaid && !isPending) {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const pi = session.payment_intent;
    const ship = (pi && pi.shipping) || {};
    const addr = ship.address || {};
    const currency = (session.currency || 'jpy').toLowerCase();
    const divisor = currency === 'jpy' ? 1 : 100;

    const items = (session.line_items?.data || []).map((li) => {
      const idFromMeta = (session.metadata?.items || '')
        .split(',')
        .map((s) => s.split('x')[0])
        .find((id) => PRODUCTS[id] && li.description?.includes(PRODUCTS[id].name));
      return {
        id: idFromMeta || null,
        name: li.description,
        qty: li.quantity,
        amount: (li.amount_total || 0) / divisor,
      };
    });

    return res.status(200).json({
      id: session.client_reference_id || session.metadata?.order_ref || session.id.slice(-8).toUpperCase(),
      date: new Date((session.created || 0) * 1000).toISOString(),
      status: isPaid ? 'paid' : 'awaiting_payment',
      lang: session.metadata?.lang || 'ja',
      currency,
      email: session.customer_details?.email || session.customer_email || '',
      name: ship.name || session.customer_details?.name || '',
      phone: ship.phone || '',
      address: [addr.postal_code, addr.state, addr.city, addr.line1, addr.line2, addr.country]
        .filter(Boolean)
        .join(' '),
      payment: session.payment_method_types?.[0] || 'card',
      items,
      total: (session.amount_total || 0) / divisor,
    });
  } catch (err) {
    console.error('[order]', err);
    return res.status(500).json({ error: 'Failed to load order' });
  }
}
