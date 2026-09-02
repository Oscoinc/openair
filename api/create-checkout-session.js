// ---------------------------------------------------------------------------
// POST /api/create-checkout-session
//
// checkout.html から呼ばれる。カート内容 + お届け先を受け取り、
// Stripe Checkout セッションを作って「決済画面のURL」を返す。
//
// 金額は絶対にクライアントから受け取らない（_products.js が唯一の正）。
// お届け先は自社フォームで集めた値を payment_intent_data.shipping に渡すので、
// Stripe 側では住所を再入力させない = 今のサイトのデザインをそのまま活かせる。
// ---------------------------------------------------------------------------

import Stripe from 'stripe';
import { PRODUCTS, REGIONS, MAX_QTY_PER_ITEM, SUB_MONTHS, parseItemId, subUnitAmount } from './_products.js';

// キー未設定でも import 時に落ちないよう遅延初期化する
let _stripe;
const getStripe = () => (_stripe ||= new Stripe(process.env.STRIPE_SECRET_KEY));

function bad(res, code, message) {
  return res.status(code).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');
  if (!process.env.STRIPE_SECRET_KEY) return bad(res, 500, 'STRIPE_SECRET_KEY is not set');

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { items, lang, customer, newsletter } = body;

    // --- 地域 / 通貨 ------------------------------------------------------
    const region = REGIONS[lang];
    if (!region) return bad(res, 400, `Unsupported region: ${lang}`);

    // --- カート検証 -------------------------------------------------------
    if (!Array.isArray(items) || items.length === 0) return bad(res, 400, 'Cart is empty');

    const line_items = [];
    let hasSubscription = false;

    for (const raw of items) {
      const { productId, isSub } = parseItemId(raw?.id);
      const product = PRODUCTS[productId];
      if (!product) return bad(res, 400, `Unknown product: ${raw?.id}`);
      if (isSub && !SUB_MONTHS[productId]) return bad(res, 400, `No subscription plan for ${productId}`);

      const qty = Number(raw.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
        return bad(res, 400, `Invalid quantity for ${raw.id}`);
      }

      const price_data = {
        currency: region.currency,
        unit_amount: isSub ? subUnitAmount(product, region.currency) : product.unitAmount[region.currency],
        tax_behavior: region.taxBehavior,
        product_data: {
          name: isSub ? `${product.name}（定期便）` : product.name,
          description: product.description[lang] || product.description.ja,
        },
      };

      if (isSub) {
        hasSubscription = true;
        // 容量に合わせた間隔で自動的にお届けする
        price_data.recurring = { interval: 'month', interval_count: SUB_MONTHS[productId] };
      }

      line_items.push({ quantity: qty, price_data });
    }

    // --- お届け先（自社フォームで収集済み）--------------------------------
    const c = customer || {};
    if (!c.email) return bad(res, 400, 'Email is required');

    const country = String(c.country || region.countries[0]).toUpperCase();
    if (!region.countries.includes(country)) {
      return bad(res, 400, `We do not ship to ${country} yet`);
    }

    const shipping = {
      name: [c.lastName, c.firstName].filter(Boolean).join(' ').trim() || c.name || 'Customer',
      phone: c.phone || undefined,
      address: {
        line1: c.address1 || '',
        line2: c.address2 || undefined,
        // 日本のフォームは「市区町村・番地」をまとめて address1 に入れてもらう作りなので、
        // city は空でよい。ここに都道府県を入れると宛名で「東京都 東京都」と二重になる。
        city: c.city || '',
        state: c.prefecture || c.province || undefined,
        postal_code: c.zip || '',
        country,
      },
    };
    if (!shipping.address.line1 || !shipping.address.postal_code) {
      return bad(res, 400, 'Incomplete shipping address');
    }

    // --- 決済手段 ---------------------------------------------------------
    // 【重要】automatic_payment_methods は PaymentIntent 用のパラメータで、
    // Checkout Session に渡すと "Received unknown parameter" で失敗する。
    // Checkout Session では payment_method_types を「指定しない」のが正解で、
    // その場合 Stripe ダッシュボードで有効にした決済手段（カード / Apple Pay /
    // Google Pay など）が端末に応じて自動で出る。

    // --- 送料 -------------------------------------------------------------
    const shippingOptions = region.shipping > 0
      ? [{
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: lang === 'es' ? 'Envío' : '配送料',
            fixed_amount: { amount: region.shipping, currency: region.currency },
          },
        }]
      : undefined;

    // --- サイトのオリジン（success/cancel URL 用）--------------------------
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = process.env.SITE_URL || `${proto}://${host}`;

    // --- 注文メモ（発注作業で使う情報を metadata に残す）------------------
    const orderRef = 'OA-' + Date.now().toString(36).toUpperCase().slice(-6);
    // 定期便（subscription モード）では payment_intent_data.shipping が使えないので、
    // 宛名ラベルに必要な住所は metadata に項目ごとに残しておく。
    // 通常購入でも同じものを入れておけば、読み出し側の処理を1本にできる。
    const metadata = {
      order_ref: orderRef,
      lang,
      items: items.map((i) => `${i.id}x${i.qty}`).join(','),
      plan: hasSubscription ? 'subscription' : 'once',
      // 案内メールを送っていい相手かどうか。既定は「送らない」
      newsletter: newsletter === true ? 'yes' : 'no',
      ship_name: shipping.name || '',
      ship_zip: shipping.address.postal_code || '',
      ship_state: shipping.address.state || '',
      ship_city: shipping.address.city || '',
      ship_line1: shipping.address.line1 || '',
      ship_line2: shipping.address.line2 || '',
      ship_country: shipping.address.country || '',
      // 発注時にそのまま貼れる1行版
      ship_to: [
        shipping.name,
        shipping.address.line1,
        shipping.address.line2,
        shipping.address.city,
        shipping.address.state,
        shipping.address.postal_code,
        shipping.address.country,
      ].filter(Boolean).join(', ').slice(0, 480),
      phone: shipping.phone || '',
    };

    const base = {
      mode: hasSubscription ? 'subscription' : 'payment',
      line_items,
      customer_email: c.email,
      locale: region.locale,
      client_reference_id: orderRef,
      metadata,
      shipping_options: shippingOptions,
      success_url: `${origin}/complete.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout.html`,
    };

    if (hasSubscription) {
      // subscription モードでは payment_intent_data / expires_at は使えない
      base.subscription_data = { metadata, description: `OPEN AIR ${orderRef}` };
    } else {
      base.payment_intent_data = { shipping, metadata, description: `OPEN AIR ${orderRef}` };
    }

    const session = await getStripe().checkout.sessions.create(base);

    return res.status(200).json({ url: session.url, orderRef, mode: base.mode });
  } catch (err) {
    console.error('[create-checkout-session]', err);
    return bad(res, 500, err?.message || 'Failed to create checkout session');
  }
}
