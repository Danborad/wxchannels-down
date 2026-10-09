#!/usr/bin/env bash
cd "$(dirname "$0")"

PID_FILE="./server.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        kill "$PID"
        rm -f "$PID_FILE"
        echo "✅ 服务已成功停止 (PID: $PID)"
    else
        echo "⚠️ 进程未运行，已清理残留 PID 文件"
        rm -f "$PID_FILE"
    fi
else
    # 尝试查找匹配的 node server.js 进程
    PID=$(pgrep -f "node server.js" | head -n 1)
    if [ -n "$PID" ]; then
        kill "$PID"
        echo "✅ 查找到对应服务并停止 (PID: $PID)"
    else
        echo "⚠️ 未发现正在运行的服务"
    fi
fi
