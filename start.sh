#!/usr/bin/env bash
cd "$(dirname "$0")"

SCRIPT_DIR=$(pwd)
PORT=${PORT:-3888}
LOG_FILE="$SCRIPT_DIR/server.log"

# 优先使用 systemd 系统服务（开机自启、崩溃自愈、不受终端会话影响）
if command -v systemctl >/dev/null 2>&1 && [ -f /etc/systemd/system/wxchannels-down.service ]; then
    systemctl start wxchannels-down
    sleep 1.5
    if systemctl is-active --quiet wxchannels-down; then
        echo "=================================================="
        echo "✅ wxchannels-down 已通过 systemd 启动（开机自启/崩溃自愈）"
        echo "本地访问: http://localhost:$PORT"
        echo "运行日志: $LOG_FILE"
        echo "查看状态: systemctl status wxchannels-down"
        echo "=================================================="
    else
        echo "❌ systemd 启动失败，请查看日志:"
        systemctl status wxchannels-down --no-pager | tail -n 15
        exit 1
    fi
    exit 0
fi

# —— 降级方案：无 systemd 时使用后台守护循环 ——
PID_FILE="$SCRIPT_DIR/server.pid"
EXISTING_PID=$(pgrep -f "$SCRIPT_DIR/server.js" | head -n 1)
if [ -n "$EXISTING_PID" ]; then
    echo "服务已在运行中 (PID: $EXISTING_PID)"
    exit 0
fi

echo "starting" > "$PID_FILE"
setsid bash -c '
    DIR="'"$SCRIPT_DIR"'"
    PID_F="'"$PID_FILE"'"
    LOG_F="'"$LOG_FILE"'"
    cd "$DIR"
    while [ -f "$PID_F" ]; do
        bash "$DIR/run.sh" >> "$LOG_F" 2>&1
        [ -f "$PID_F" ] || break
        sleep 2
    done
' > /dev/null 2>&1 < /dev/null &
WATCHDOG_PID=$!
echo "$WATCHDOG_PID" > "$PID_FILE"
sleep 1.5
NODE_PID=$(pgrep -f "$SCRIPT_DIR/server.js" | head -n 1)
if [ -n "$NODE_PID" ]; then
    echo "✅ wxchannels-down 已启动 (服务 PID: $NODE_PID)"
    echo "本地访问: http://localhost:$PORT"
else
    echo "❌ 启动失败，请查看 $LOG_FILE"
    exit 1
fi
