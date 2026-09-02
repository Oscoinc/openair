// ---------------------------------------------------------------------------
// GET /api/zip?code=1500001
//
// 郵便番号から住所を引く。ブラウザから外部APIを直接叩くと CORS で弾かれたり、
// お客様の環境から第三者へ通信が飛んだりするので、必ずここを経由させる。
//
// 返すもの: { ok, zipcode, prefecture, city, town, address }
//   prefecture … 都道府県（フォームの選択肢とそのまま一致する表記）
//   city       … 市区町村
//   town       … 町域
//   address    … 市区町村 + 町域（フォームの「市区町村・番地」にそのまま入れる用）
//
// 上流が落ちても購入を止めないこと。引けなければ 200 で ok:false を返し、
// 画面側は黙って手入力に任せる（エラーを出して不安にさせない）。
// ---------------------------------------------------------------------------

const UPSTREAM = 'https://zipcloud.ibsnet.co.jp/api/search?zipcode=';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const raw = String((req.query && req.query.code) || '');
  const code = raw.replace(/[^0-9]/g, '');
  if (code.length !== 7) {
    return res.status(400).json({ ok: false, error: 'code must be 7 digits' });
  }

  // 同じ郵便番号は何度も引かれるので、CDN側で1日キャッシュさせる
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(UPSTREAM + code, { signal: ac.signal });
    clearTimeout(timer);

    if (!r.ok) return res.status(200).json({ ok: false, error: `upstream ${r.status}` });

    const data = await r.json();
    const hit = data && Array.isArray(data.results) && data.results[0];
    if (!hit) return res.status(200).json({ ok: false, error: 'not found', zipcode: code });

    const prefecture = hit.address1 || '';
    const city = hit.address2 || '';
    const town = hit.address3 || '';

    return res.status(200).json({
      ok: true,
      zipcode: code,
      prefecture,
      city,
      town,
      address: (city + town).trim(),
    });
  } catch (err) {
    console.warn('[zip]', err?.name === 'AbortError' ? 'timeout' : err);
    return res.status(200).json({ ok: false, error: 'lookup failed' });
  }
}
