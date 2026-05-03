# OPEN AIR — Nasal Breathing Tape

Apple風ミニマルデザインのプロダクトLP＆ECサイト。日本語/スペイン語切替、ヨーロッパ配送対応、GDPR/EU消費者法準拠。

## ファイル構成

```
silent-air-github/
├── index.html          # openair.html へのリダイレクト
├── openair.html        # メインのランディングページ
├── cart.html           # カート
├── checkout.html       # 購入手続き
├── complete.html       # 注文完了
├── privacy.html        # プライバシーポリシー
├── terms.html          # 利用規約
├── support.html        # サポート（FAQ + お問い合わせ）
├── assets/             # 画像（30ファイル）
├── .gitignore
└── README.md
```

## 主な機能

- **シネマティックヒーロー**：スクロール連動の10フェーズアニメーション
- **i18n**：日本語 ⇔ スペイン語 完全切替（localStorage で永続化）
- **地域モーダル**：日本（¥）/ スペイン（€）/ ブラジル・USA（準備中）の4地域選択
- **マルチ通貨**：日本円（消費税10%）/ ユーロ（IVA 21%）自動切替
- **EU住所フォーム**：スペイン語時は国セレクター + ヨーロッパ式入力欄
- **法務ページ**：GDPR / LGDCU / LOPDGDD / Roma I 準拠

## ローカルで開く

```bash
# Python 3 簡易サーバ
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/openair.html` を開く。

## 技術スタック

- 純粋な HTML / CSS / JavaScript（バンドラ・フレームワーク不使用）
- Tailwind CSS（CDN経由）
- localStorage で言語・カート状態を保存

## ライセンス

© OPEN AIR, Inc.
