#!/usr/bin/env bash
cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
PID_FILE="$SCRIPT_DIR/server.pid"

echo "正在停止 wxchannels-down 服务..."

# 1. 优先停止 systemd 服务
if command -v systemctl >/dev/null 2>&1 && [ -f /etc/systemd/system/wxchannels-down.service ]; then
    systemctl stop wxchannels-down 2>/dev/null
    echo "✅ systemd 服务已停止（如需彻底禁用开机自启：systemctl disable wxchannels-down）"
fi

# 2. 清理降级模式的守护循环
if [ -f "$PID_FILE" ]; then
    WATCHDOG_PID=$(cat "$PID_FILE" 2>/dev/null)
    rm -f "$PID_FILE"
    [ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null
fi

# 3. 清理可能残留的本项目 node 进程
PIDS=$(pgrep -f "wxchannels-down/server.js")
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null

# 4. 清理专属无头浏览器
pkill -TERM -f "\[r\]emote-debugging-port=9444" 2>/dev/null || true
echo "✅ 停止完成"
