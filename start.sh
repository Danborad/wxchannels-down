#!/usr/bin/env bash
cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
PORT=${PORT:-3888}
PID_FILE="$SCRIPT_DIR/server.pid"
LOG_FILE="$SCRIPT_DIR/server.log"

# 检查当前服务是否已在运行
EXISTING_PID=$(pgrep -f "$SCRIPT_DIR/server.js" | head -n 1)
if [ -n "$EXISTING_PID" ]; then
    echo "服务已在运行中 (PID: $EXISTING_PID)"
    echo "访问地址: http://localhost:$PORT"
    exit 0
fi

# 先写入守护标记，表示允许自动重启
echo "starting" > "$PID_FILE"

# 使用 setsid 彻底脱离终端会话，建立自动守护循环（异常退出 2 秒自愈）
setsid bash -c '
    DIR="'"$SCRIPT_DIR"'"
    PID_F="'"$PID_FILE"'"
    LOG_F="'"$LOG_FILE"'"
    cd "$DIR"
    while [ -f "$PID_F" ]; do
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 启动 wxchannels-down 服务..." >> "$LOG_F"
        node "$DIR/server.js" >> "$LOG_F" 2>&1
        EXIT_CODE=$?
        if [ ! -f "$PID_F" ]; then
            break
        fi
        echo "[$(date "+%Y-%m-%d %H:%M:%S")] 进程异常退出 (code=$EXIT_CODE)，2秒后自动恢复..." >> "$LOG_F"
        sleep 2
    done
' > /dev/null 2>&1 < /dev/null &

WATCHDOG_PID=$!
echo "$WATCHDOG_PID" > "$PID_FILE"

sleep 1.5
NODE_PID=$(pgrep -f "$SCRIPT_DIR/server.js" | head -n 1)

if [ -n "$NODE_PID" ]; then
    echo "=================================================="
    echo "✅ 微信视频号解析下载服务已启动 (独立守护自愈模式)!"
    echo "服务 PID: $NODE_PID | 守护 PID: $WATCHDOG_PID"
    echo "本地访问: http://localhost:$PORT"
    echo "运行日志: $LOG_FILE"
    echo "=================================================="
else
    echo "❌ 启动失败，请查看日志:"
    tail -n 20 "$LOG_FILE"
    rm -f "$PID_FILE"
    kill "$WATCHDOG_PID" 2>/dev/null
    exit 1
fi
