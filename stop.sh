#!/usr/bin/env bash
cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
PID_FILE="$SCRIPT_DIR/server.pid"

echo "正在停止 wxchannels-down 服务..."

# 1. 先删除 PID 文件，通知守护循环退出
if [ -f "$PID_FILE" ]; then
    WATCHDOG_PID=$(cat "$PID_FILE" 2>/dev/null)
    rm -f "$PID_FILE"
    if [ -n "$WATCHDOG_PID" ]; then
        kill "$WATCHDOG_PID" 2>/dev/null
    fi
fi

# 2. 精确杀死本项目的 node 进程
PIDS=$(pgrep -f "$SCRIPT_DIR/server.js")
if [ -n "$PIDS" ]; then
    kill $PIDS 2>/dev/null
    sleep 0.5
    kill -9 $PIDS 2>/dev/null
    echo "✅ 服务进程已成功停止 ($PIDS)"
else
    echo "ℹ️ 未发现运行中的服务进程"
fi

# 3. 清理可能残留的专属无头浏览器
pkill -TERM -f "\[r\]emote-debugging-port=9444" 2>/dev/null || true
echo "✅ 停止完成"
