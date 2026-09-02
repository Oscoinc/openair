// ---------------------------------------------------------------------------
// OPEN AIR — 商品マスタ（サーバー側・唯一の正）
//
// 価格はブラウザから受け取らない。クライアントは「商品ID」と「数量」だけを送り、
// 金額はすべてこのファイルの値で計算する。
// （クライアントの価格を信用すると ¥1 に書き換えて注文されます）
//
// 表示価格は税込。日本は消費税10%込み、スペイン/EUは IVA 21% 込み。
// Stripe に渡す unit_amount は「最小通貨単位」:
//   JPY は 0 桁通貨 → 1980 は 1980
//   EUR は 2 桁通貨 → €15.00 は 1500
// ---------------------------------------------------------------------------

export const PRODUCTS = {
  single: {
    id: 'single',
    name: 'OPEN AIR Single',
    description: { ja: '30枚 · 1ヶ月分', es: '30 unidades · 1 mes' },
    image: 'assets/part_package.png',
    // 税込表示価格
    display: { jpy: 1980, eur: 15 },
    // Stripe 用（最小通貨単位）
    unitAmount: { jpy: 1980, eur: 1500 },
  },
  three: {
    id: 'three',
    name: 'OPEN AIR Three',
    description: { ja: '90枚 · 3ヶ月分', es: '90 unidades · 3 meses' },
    image: 'assets/part_package.png',
    display: { jpy: 4980, eur: 39 },
    unitAmount: { jpy: 4980, eur: 3900 },
  },
  six: {
    id: 'six',
    name: 'OPEN AIR Six',
    description: { ja: '180枚 · 6ヶ月分', es: '180 unidades · 6 meses' },
    image: 'assets/part_package.png',
    display: { jpy: 8980, eur: 69 },
    unitAmount: { jpy: 8980, eur: 6900 },
  },
};

// 言語 → 通貨 / Stripe ロケール / 配送可能国
export const REGIONS = {
  ja: {
    currency: 'jpy',
    locale: 'ja',
    countries: ['JP'],
    // 送料（最小通貨単位）。0 = 送料無料
    shipping: 0,
    // 税込価格なので Stripe 側では税を上乗せしない
    taxBehavior: 'inclusive',
  },
  es: {
    currency: 'eur',
    locale: 'es',
    // スペイン + 主要EU圏。増やすときはここに ISO 3166-1 alpha-2 を足す
    countries: [
      'ES', 'PT', 'FR', 'IT', 'DE', 'NL', 'BE', 'AT', 'IE',
      'LU', 'FI', 'GR', 'PL', 'CZ', 'SK', 'SI', 'HR', 'EE', 'LV', 'LT',
      'DK', 'SE', 'HU', 'RO', 'BG', 'CY', 'MT',
    ],
    shipping: 0,
    taxBehavior: 'inclusive',
  },
};

// 数量の上限（転売・カード試行対策）
export const MAX_QTY_PER_ITEM = 10;
