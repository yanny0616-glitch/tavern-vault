#!/bin/bash
# 全套回归测试：每项用一份干净的测试数据，测试服务只监听 127.0.0.1
# 用法：tests/run.sh            跑全部
#       tests/run.sh fold merge  只跑指定的几项
# 需要：Node 22+、playwright（全局安装即可）、Chromium（默认 /usr/bin/chromium，可用 CHROMIUM 指定）
# 端口：5199 测试服务，5198 模拟酒馆，5197 模拟 AI 接口，5189 生成测试数据时临时用
set -u
T=$(cd "$(dirname "$0")" && pwd); ROOT=$(dirname "$T")
WORK=${TV_TEST_WORK:-$T/.work}
export NODE_PATH=${NODE_PATH:-$(npm root -g)}
[ -z "${CHROMIUM:-}" ] && [ -x /usr/bin/chromium ] && export CHROMIUM=/usr/bin/chromium

for port in 5199 5198 5197 5189; do
  if ss -ltn 2>/dev/null | grep -q ":$port "; then echo "端口 $port 被占用，先停掉占用它的程序"; exit 2; fi
done

rm -rf "$WORK/run" "$WORK/shots" "$WORK/logs"; mkdir -p "$WORK/shots" "$WORK/logs"
node "$T/fixtures/make.mjs" "$WORK/data" || exit 2

PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; }
trap cleanup EXIT
node "$T/mock/ai.mjs" > "$WORK/logs/mock-ai.log" 2>&1 & PIDS+=($!)

want() { [ ${#ONLY[@]} -eq 0 ] && return 0; for o in "${ONLY[@]}"; do [ "$o" = "$1" ] && return 0; done; return 1; }
wait_port() { for _ in $(seq 50); do ss -ltn | grep -q ":$1 " && return 0; sleep 0.1; done; return 1; }
ONLY=("$@"); PASS=0; FAILED=()

# run <名字> <数据(seed|sec|perf)> <是否需要模拟酒馆 0|1> <测试文件>
run() {
  local name=$1 data=$2 tavern=$3 file=$4
  want "$name" || return 0
  rm -rf "$WORK/run"; cp -a "$WORK/data/$data" "$WORK/run"
  local out="$WORK/shots/$name" log="$WORK/logs/$name.log"; mkdir -p "$out"
  # 安全测试要读写数据目录本身，其它测试拿截图目录
  case $name in security|backups) out="$WORK/run" ;; esac
  TV_HOST=127.0.0.1 TV_PORT=5199 TV_DATA="$WORK/run" node "$ROOT/server/server.js" > "$WORK/logs/$name-server.log" 2>&1 & local sp=$!
  local mp=""
  if [ "$tavern" = 1 ]; then node "$T/mock/tavern.mjs" > "$WORK/logs/$name-tavern.log" 2>&1 & mp=$!; wait_port 5198; fi
  wait_port 5199 || { echo "!! $name：测试服务没起来，见 $WORK/logs/$name-server.log"; }
  local t0=$SECONDS
  (cd "$T" && timeout 300 node "$file" "$out") > "$log" 2>&1; local code=$?
  kill $sp $mp 2>/dev/null; wait $sp $mp 2>/dev/null
  if [ $code -eq 0 ] && ! grep -q "^FAIL" "$log"; then
    PASS=$((PASS + 1)); printf '  通过  %-16s %3ss\n' "$name" $((SECONDS - t0))
  else
    FAILED+=("$name"); printf '  失败  %-16s %3ss  (退出码 %s，日志 %s)\n' "$name" $((SECONDS - t0)) $code "$log"
    grep -E "^FAIL|^ERR |Error" "$log" | head -6 | sed 's/^/        /'
  fi
}

run detail         seed 0 detail.cjs
run settings       perf 0 settings.cjs
run fold           perf 0 fold.cjs
run import         seed 0 import.cjs
run dupes-merge    perf 0 dupes-merge.cjs
run desktop        perf 0 desktop.cjs
run sheet-height   perf 0 sheet-height.cjs
run sheet-round    seed 0 sheet-round.cjs
run fenced-html    perf 0 fenced-html.cjs
run search-version perf 0 search-version.mjs
run search-edit    perf 0 search-edit.cjs
run ui-misc        perf 0 ui-misc.cjs
run help           perf 0 help.cjs
run round8         perf 0 round8.cjs
run sync-ignore    perf 0 sync-ignore.mjs
run merge          perf 0 merge.mjs
run ai-batch       seed 0 ai-batch.mjs
run ai-fix         seed 0 ai-fix.mjs
run dup-separators seed 0 dup-separators.cjs
run ai-ui          seed 0 ai-ui.cjs
run ai-chat-api    seed 0 ai-chat-api.mjs
run ai-chat-ui     seed 0 ai-chat-ui.cjs
run security       sec  0 security.mjs
run backups        seed 0 backups.mjs
run tags           seed 0 tags.mjs
run tags-ui        seed 0 tags-ui.cjs
run live-refresh   seed 0 live-refresh.cjs
run scroll-chrome  perf 0 scroll-chrome.cjs
run tavern-ignore  seed 1 tavern-ignore.cjs
run tavern-bridge  seed 1 tavern-bridge.cjs
run embed          seed 1 embed.cjs

echo
if [ ${#FAILED[@]} -eq 0 ]; then echo "全部通过（$PASS 项）"; exit 0; fi
echo "通过 $PASS 项，失败 ${#FAILED[@]} 项：${FAILED[*]}"; exit 1
