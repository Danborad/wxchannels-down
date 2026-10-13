#!/usr/bin/env bash
# 启动器：自动选择一个支持 WebSocket / fetch 的现代 Node.js（>= 20）
cd "$(dirname "$0")"

pick_node() {
  local candidates=()
  # 优先 nvm 下较新的版本
  for c in /root/.nvm/versions/node/v2*/bin/node; do
    [ -x "$c" ] && candidates+=("$c")
  done
  candidates+=(/usr/local/bin/node /usr/bin/node)

  for bin in "${candidates[@]}"; do
    if [ -x "$bin" ]; then
      local major
      major=$("$bin" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
      if [ -n "$major" ] && [ "$major" -ge 20 ]; then
        echo "$bin"
        return 0
      fi
    fi
  done
  # 兜底：返回第一个可用的
  for bin in "${candidates[@]}"; do
    [ -x "$bin" ] && { echo "$bin"; return 0; }
  done
  return 1
}

NODE_BIN=$(pick_node)
if [ -z "$NODE_BIN" ]; then
  echo "未找到可用的 Node.js" >&2
  exit 1
fi

exec "$NODE_BIN" server.js
