#!/usr/bin/env bash
cd "$(dirname "$0")"

PORT=${PORT:-3888}
PID_FILE="./server.pid"
LOG_FILE="./server.log"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "服务已在运行中 (PID: $PID)"
        echo "访问地址: http://localhost:$PORT"
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

nohup node server.js > "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

sleep 1
if ps -p "$PID" > /dev/null 2>&1; then
    echo "=================================================="
    echo "✅ 微信视频号解析下载服务已成功在后台启动!"
    echo "进程 PID: $PID"
    echo "本地访问: http://localhost:$PORT"
    echo "日志文件: $LOG_FILE"
    echo "详细局域网/IPv6 地址可在 $LOG_FILE 中查看"
    echo "=================================================="
else
    echo "❌ 启动失败，请查看日志:"
    cat "$LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi
