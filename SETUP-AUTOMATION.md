# 購入後の自動化 — セットアップ手順

注文が入ってから発送するまでを、なるべく手を動かさずに回すための仕組みです。

```
お客様が購入
   ↓  Stripe Checkout
Stripe が /api/webhook を叩く
   ↓
   ├─ お客様へ「ご注文ありがとうございます」メール（注文番号入り）
   │     └→ iPhone の Wallet がこのメールを読んで注文として認識する
   └─ William へ「要発注」メール（住所・電話・商品が全部入っている）

自宅のMacの印刷エージェント（30秒ごとに確認）
   ↓
未印刷の注文を見つける → 宛名ラベル + 納品書を自動で印刷
   ↓
Stripe 側に「印刷済み」を記録（二重印刷しない）

梱包して発送 → admin.html で追跡番号を入力
   ↓
お客様へ「発送しました（追跡番号◯◯）」メール
   └→ Wallet に配送状況が出る
```

注文データベースは持っていません。**Stripe の Checkout Session が注文そのもの**で、
「印刷済み」「発送済み」は PaymentIntent の metadata に書き戻しています。
別のDBを用意しなくていい代わりに、Stripe を止めると注文履歴も見えなくなります。

---

## 1. Vercel の環境変数（Settings → Environment Variables）

| 変数名 | 値 | 必須 |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...`（テスト）→ 公開時に `sk_live_...` | ● |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...`（手順3で出る） | ● |
| `ORDER_API_KEY` | 自分で決めた長いランダム文字列（例: `openssl rand -hex 24` の出力） | ● |
| `RESEND_API_KEY` | `re_...` | ● メールを出すなら |
| `ORDER_NOTIFY_EMAIL` | 自分の受信用アドレス | ● |
| `ORDER_NOTIFY_FROM` | `OPEN AIR <onboarding@resend.dev>`（独自ドメイン検証後は自分のドメインに） | |
| `SITE_URL` | 独自ドメインを使うときだけ | |

入れたあと **必ず再デプロイ**してください（環境変数は再デプロイで反映されます）。

## 2. Stripe の準備

1. Stripe に登録し、まず**テストモード**のキー（`sk_test_...`）を使う
2. テストカード `4242 4242 4242 4242` / 有効期限は未来 / CVC は任意 で通し確認できる
3. 本番化には Stripe の審査があり、**特定商取引法に基づく表記のページが必須**です
   （`tokushoho.html` を用意済み。ただし4項目が未記入 → 下の「やること」参照）

## 3. Webhook の登録

Stripe ダッシュボード → 開発者 → Webhook → エンドポイントを追加

- URL: `https://openair-three.vercel.app/api/webhook`
- イベント:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`

登録後に出る `whsec_...` を `STRIPE_WEBHOOK_SECRET` に入れて再デプロイ。

## 4. 自宅Macの自動印刷

```bash
# 設定ファイルを作る
cat > ~/.openair-print.conf <<'CONF'
SITE="https://openair-three.vercel.app"
KEY="<ORDER_API_KEY と同じ文字列>"
PRINTER=""          # 空なら既定のプリンタ。lpstat -p で名前が分かる
MODE="auto"         # auto | pdf | text
INTERVAL=30
MEDIA=""            # ラベルプリンタで必要なら 例: Custom.100x150mm
CONF

# 動作確認（サンプル注文が1枚出る）
bash tools/openair-print-agent.sh --test

# 常駐させる（ログイン時に自動起動）
bash tools/openair-print-agent.sh --install
```

- `MODE=auto` は Google Chrome があれば HTML→PDF で綺麗に印刷し、無ければ
  テキスト印刷に自動で落ちます
- ログは `~/Library/Application Support/OpenAirPrint/agent.log`
- 解除は `bash tools/openair-print-agent.sh --uninstall`
- Mac がスリープしている間は印刷されませんが、**起きたときにまとめて印刷されます**
  （未印刷かどうかは Stripe 側で持っているため取りこぼしません）

## 5. 注文管理画面

`https://openair-three.vercel.app/admin.html`

`ORDER_API_KEY` を入れると注文一覧が出ます。各注文で

- **ラベルを印刷** — 手動でも刷れる
- **追跡番号を入力 → 発送を記録して通知** — お客様に発送メールが飛ぶ

検索エンジンには出ないようにしてありますが、URLを知られると
キーの総当たりを試される可能性はあります。キーは長くしてください。

---

## iPhone の Wallet に配送状況を出す件

Apple の「Wallet の注文追跡」には2通りあります。

**A. メール経由（今こちらで対応済み・追加費用なし）**

Apple のメールアプリが注文確認メール・発送通知メールを読み取って、
Wallet に注文として表示します。**Apple Pay で買っている必要はありません。**
店側の登録も不要で、Apple 側が自動で判定します。効きやすくするために、

- 件名と本文に注文番号を必ず入れる
- 発送通知に配送会社名と追跡番号を「見える形で」入れる
- schema.org の `Order` / `ParcelDelivery` を JSON-LD で埋める

の3つを `api/_mail.js` で実装済みです。文面を変えるときもこの3つは崩さないでください。

ただし Apple 側の判定なので、**必ず出るとは保証できません**。
また、お客様が Apple の「メール」アプリを使っていることが前提です。

**B. 直接連携（Apple Business への登録が必要）**

Wallet の中でリアルタイムに配送状況を出す本格版です。こちらは

- Apple Business（旧 Apple Business Connect）への事業者登録と審査
- Branded Mail の有効化
- **独自ドメインの所有と検証**（`vercel.app` のままでは不可）

が必要です。独自ドメインを取ってからでないと着手できないので、
今の段階では A で運用し、ドメインを決めたら B を検討する、が現実的です。

---

## ★ まだ William がやること

1. **`api/_shop.js` の「（未設定）」を埋める** — 差出人住所・電話・責任者名。
   ここがラベルの差出人になります。空のまま出荷はできません
2. **`tokushoho.html` の「（準備中）」4項目を埋める** — 販売業者名・運営統括責任者・
   所在地・電話番号。Stripe の審査項目でもあります
3. **Vercel に環境変数を5つ入れて再デプロイ**（上の表）
4. **Stripe で Webhook を登録**（手順3）
5. **Mac で印刷エージェントを設定**（手順4）
6. **チャットに貼った GitHub のトークンを失効させる**
   https://github.com/settings/personal-access-tokens

1〜2 は情報さえあれば5分で終わります。教えてもらえればこちらで書き込みます。
