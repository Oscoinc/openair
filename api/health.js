// ---------------------------------------------------------------------------
// GET /api/health
//
// 「何がまだ設定されていないか」を一目で分かるようにするだけの窓口。
// 値そのものは絶対に返さない。設定されているか / 形式が正しいか だけ。
// ---------------------------------------------------------------------------

const shape = (v, prefix) => {
  if (!v) return 'missing';
  if (prefix && !String(v).startsWith(prefix)) return 'set (形式が違うかも)';
  return 'set';
};

export default function handler(req, res) {
  const env = process.env;
  const stripeKey = env.STRIPE_SECRET_KEY || '';
  const mode = stripeKey.startsWith('sk_live_') ? 'live'
             : stripeKey.startsWith('sk_test_') ? 'test' : null;

  const checks = {
    STRIPE_SECRET_KEY:     shape(stripeKey, 'sk_'),
    STRIPE_WEBHOOK_SECRET: shape(env.STRIPE_WEBHOOK_SECRET, 'whsec_'),
    ORDER_API_KEY:         env.ORDER_API_KEY ? (env.ORDER_API_KEY.length >= 24 ? 'set' : 'set (短すぎます。24文字以上を推奨)') : 'missing',
    RESEND_API_KEY:        shape(env.RESEND_API_KEY, 're_'),
    ORDER_NOTIFY_EMAIL:    shape(env.ORDER_NOTIFY_EMAIL),
  };

  const missing = Object.entries(checks).filter(([, v]) => v === 'missing').map(([k]) => k);

  const next = [];
  if (checks.STRIPE_SECRET_KEY === 'missing') {
    next.push('Vercel の環境変数に STRIPE_SECRET_KEY（まずは sk_test_...）を入れて再デプロイすると、決済画面まで進めるようになります。');
  }
  if (checks.ORDER_API_KEY === 'missing') {
    next.push('ORDER_API_KEY を決めて入れると、/admin.html と自動印刷が使えるようになります。');
  }
  if (checks.STRIPE_WEBHOOK_SECRET === 'missing') {
    next.push('Stripe で Webhook を登録し、出てきた whsec_... を STRIPE_WEBHOOK_SECRET に入れると、注文メールが飛ぶようになります。');
  }
  if (checks.RESEND_API_KEY === 'missing') {
    next.push('RESEND_API_KEY を入れると、購入者への注文確認メールと発送通知メールが実際に送られます（未設定でも注文自体は通ります）。');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: missing.length === 0,
    // どのデプロイが動いているかを確認するための情報。
    // 環境変数を入れたのに missing のままなら、まずここを見る。
    deploy: {
      env: env.VERCEL_ENV || null,               // production / preview / development
      commit: (env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      branch: env.VERCEL_GIT_COMMIT_REF || null,
      // プロジェクトを間違えていないかの確認用
      project: env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || null,
    },
    stripeMode: mode,
    checks,
    missing,
    next,
    canTakeOrders: !!mode,
    note: '値は返しません。設定済みかどうかだけを表示しています。',
  });
}
