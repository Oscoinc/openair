// ---------------------------------------------------------------------------
// 差出人・事業者情報（1箇所にまとめる）
//
// ★ ここは William が埋めること。ラベルの差出人、注文メール、
//    特定商取引法に基づく表記の3つが、このファイルを見ている。
//    未入力の項目は「（未設定）」と表示され、そのままでは出荷にも審査にも使えない。
// ---------------------------------------------------------------------------

export const SHOP = {
  brand: 'OPEN AIR',

  // 事業者名（特商法：販売業者）
  legalName: 'Osco Inc.',
  // 運営責任者
  manager: '（未設定）',

  // 差出人住所（ラベルに印字される）
  postalCode: '（未設定）',
  address1: '（未設定）',
  address2: '',
  // 電話番号。特商法では請求があれば遅滞なく開示する必要がある
  phone: '（未設定）',
  email: 'herberttsukamoto@icloud.com',

  // サイト
  siteUrl: 'https://openair-three.vercel.app',

  // 引渡し・支払い・返品（特商法の必須項目）
  deliveryTime: 'ご注文（ご入金）確認後、5〜10営業日以内に発送します。',
  paymentTiming: 'クレジットカードはご注文時、コンビニ決済はお支払い期限内のご入金時。',
  returnPolicy:
    '商品到着後8日以内で未開封の場合に限り返品を承ります（返送料はお客様負担）。' +
    '衛生商品のため開封後の返品はお受けできません。不良品は当社負担で交換します。',
  extraFees: '送料は無料です。決済手数料はかかりません。',
};

export function senderLines() {
  const l = [
    `${SHOP.legalName}`,
    `〒${SHOP.postalCode}`,
    SHOP.address1,
    SHOP.address2,
    `TEL ${SHOP.phone}`,
  ];
  return l.filter(Boolean);
}
