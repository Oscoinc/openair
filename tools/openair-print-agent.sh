#!/bin/bash
# ---------------------------------------------------------------------------
# OPEN AIR — 注文ラベル自動印刷エージェント（macOS）
#
# 注文が入ったら、自宅のプリンタから宛名ラベルと納品書が自動で出る。
# サイト側の /api/orders と /api/label を一定間隔で見に行くだけの単純な仕組み。
#
# 使い方
#   1. 設定ファイルを作る（キーをスクリプトに直接書かないため）
#        ~/.openair-print.conf
#      中身:
#        SITE="https://openair-three.vercel.app"
#        KEY="<Vercelに入れた ORDER_API_KEY と同じ文字列>"
#        PRINTER=""            # 空なら既定のプリンタ。lpstat -p で名前を確認できる
#        MODE="auto"           # auto | pdf | text
#        INTERVAL=30           # 何秒ごとに見に行くか
#        MEDIA=""              # 例: Custom.100x150mm （ラベルプリンタで必要なら）
#
#   2. 動作確認
#        bash openair-print-agent.sh --test     # サンプル注文を1枚印刷して終わる
#        bash openair-print-agent.sh --once     # 未印刷の注文を1回だけ処理する
#
#   3. 常駐させる（ログイン時に自動起動）
#        bash openair-print-agent.sh --install
#      解除は --uninstall
#
# 仕組みのメモ
#   - 「印刷済みかどうか」は Stripe 側（PaymentIntent の metadata）に記録される。
#     この Mac を買い替えても二重印刷にならない。
#   - MODE=pdf は Google Chrome をヘッドレスで使って HTML を PDF にしてから印刷する。
#     Chrome が無ければ自動でテキスト印刷に落ちる（MODE=auto のとき）。
# ---------------------------------------------------------------------------

set -uo pipefail

CONF="${OPENAIR_CONF:-$HOME/.openair-print.conf}"
SITE=""; KEY=""; PRINTER=""; MODE="auto"; INTERVAL=30; MEDIA=""
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

STATE_DIR="$HOME/Library/Application Support/OpenAirPrint"
LOG="$STATE_DIR/agent.log"
mkdir -p "$STATE_DIR"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

need_conf() {
  if [ -z "$SITE" ] || [ -z "$KEY" ]; then
    echo "設定がありません。$CONF に SITE と KEY を書いてください。" >&2
    echo '  SITE="https://openair-three.vercel.app"' >&2
    echo '  KEY="<ORDER_API_KEY>"' >&2
    exit 1
  fi
}

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

print_pdf() {   # $1 = session_id, $2 = 注文番号
  local sid="$1" ref="$2"
  local html="$STATE_DIR/$ref.html" pdf="$STATE_DIR/$ref.pdf"
  curl -fsS --max-time 30 "$SITE/api/label?session_id=$sid&key=$KEY&noprint=1" -o "$html" || return 1
  "$CHROME" --headless=new --disable-gpu --no-sandbox --no-pdf-header-footer \
            --print-to-pdf="$pdf" "file://$html" >/dev/null 2>&1 || return 1
  [ -s "$pdf" ] || return 1
  if [ -n "$PRINTER" ]; then
    if [ -n "$MEDIA" ]; then lpr -P "$PRINTER" -o "media=$MEDIA" "$pdf"; else lpr -P "$PRINTER" "$pdf"; fi
  else
    if [ -n "$MEDIA" ]; then lpr -o "media=$MEDIA" "$pdf"; else lpr "$pdf"; fi
  fi
}

print_text() {  # $1 = session_id, $2 = 注文番号
  local sid="$1" ref="$2"
  local txt="$STATE_DIR/$ref.txt"
  curl -fsS --max-time 30 "$SITE/api/label?session_id=$sid&key=$KEY&format=txt" -o "$txt" || return 1
  [ -s "$txt" ] || return 1
  if [ -n "$PRINTER" ]; then lpr -P "$PRINTER" "$txt"; else lpr "$txt"; fi
}

print_one() {   # $1 = session_id, $2 = 注文番号
  local sid="$1" ref="$2" ok=1
  case "$MODE" in
    pdf)  print_pdf "$sid" "$ref" && ok=0 ;;
    text) print_text "$sid" "$ref" && ok=0 ;;
    *)    if [ -x "$CHROME" ]; then print_pdf "$sid" "$ref" && ok=0; fi
          if [ $ok -ne 0 ]; then print_text "$sid" "$ref" && ok=0; fi ;;
  esac
  return $ok
}

mark_printed() { # $1 = session_id
  curl -fsS --max-time 20 -X POST "$SITE/api/label" \
    -H "Content-Type: application/json" -H "x-api-key: $KEY" \
    -d "{\"session_id\":\"$1\",\"printed\":true}" >/dev/null
}

run_once() {
  local list
  list=$(curl -fsS --max-time 30 "$SITE/api/orders?format=text&unprinted=1&key=$KEY") || {
    log "取得に失敗（ネットワークかキーを確認）"; return 1; }
  [ -z "$list" ] && return 0
  local n=0
  while IFS=$'\t' read -r sid ref; do
    [ -z "${sid:-}" ] && continue
    if print_one "$sid" "$ref"; then
      mark_printed "$sid" && log "印刷: $ref ($sid)" || log "印刷したが印刷済みの記録に失敗: $ref"
      n=$((n+1))
    else
      log "印刷に失敗: $ref ($sid)"
    fi
  done <<< "$list"
  [ $n -gt 0 ] && log "$n 件を処理しました"
  return 0
}

PLIST="$HOME/Library/LaunchAgents/com.openair.printagent.plist"

install_agent() {
  need_conf
  local self; self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.openair.printagent</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$self</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$STATE_DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$STATE_DIR/launchd.err</string>
</dict></plist>
PLISTEOF
  launchctl unload "$PLIST" >/dev/null 2>&1
  launchctl load "$PLIST" && echo "常駐を開始しました。ログ: $LOG"
}

uninstall_agent() {
  launchctl unload "$PLIST" >/dev/null 2>&1
  rm -f "$PLIST"
  echo "常駐を解除しました。"
}

case "${1:-}" in
  --install)   install_agent; exit 0 ;;
  --uninstall) uninstall_agent; exit 0 ;;
  --test)
    need_conf
    echo "サンプル注文を印刷します（MODE=$MODE, PRINTER=${PRINTER:-既定}）"
    if print_one "cs_demo_openair_sample" "OA-DEMO01"; then echo "プリンタに送りました。"; else echo "失敗しました。" >&2; exit 1; fi
    exit 0 ;;
  --once)      need_conf; run_once; exit $? ;;
  --help|-h)   sed -n '2,40p' "$0"; exit 0 ;;
esac

need_conf
log "監視を開始（$SITE / ${INTERVAL}秒ごと / MODE=$MODE / PRINTER=${PRINTER:-既定}）"
while true; do
  run_once
  sleep "$INTERVAL"
done
