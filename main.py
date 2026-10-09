#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信视频号无水印直链提取工具 (Python 零依赖单文件版)
支持本地 Web UI 和命令行直接解析，支持微信扫码登录自动获取腾讯元宝 Cookie。
"""

import os
import sys
import json
import time
import socket
import random
import re
import urllib.request
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("PORT", 3888))
COOKIE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookie.txt")

DEFAULT_COOKIE = os.environ.get("YUANBAO_COOKIE", "")
if os.path.exists(COOKIE_FILE):
    try:
        with open(COOKIE_FILE, "r", encoding="utf-8") as f:
            saved = f.read().strip()
            if saved:
                DEFAULT_COOKIE = saved
    except Exception:
        pass

def persist_cookie(cookie):
    global DEFAULT_COOKIE
    DEFAULT_COOKIE = (cookie or "").strip()
    try:
        with open(COOKIE_FILE, "w", encoding="utf-8") as f:
            f.write(DEFAULT_COOKIE)
    except Exception:
        pass

SPH_REGEX = re.compile(r"https://weixin\.qq\.com/sph/[a-zA-Z0-9_-]+")

def generate_rid():
    timestamp_hex = hex(int(time.time()))[2:]
    chars = "0123456789abcdef"
    random_hex = "".join(random.choice(chars) for _ in range(8))
    return f"{timestamp_hex}-{random_hex}"

def plain_text_from_html(val):
    if not val:
        return ""
    text = re.sub(r"<[^>]+>", " ", str(val))
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'")
    return re.sub(r"\s+", " ", text).strip()

def get_wechat_login_qrcode():
    nonce = "".join(random.choice("0123456789abcdefghijklmnopqrstuvwxyz") for _ in range(16))
    qr_connect_url = f"https://open.weixin.qq.com/connect/qrconnect?appid=wx12b75947931a04ec&scope=snsapi_login&redirect_uri=https%3A%2F%2Fyuanbao.tencent.com%2Fscan%3Fnonce%3D{nonce}&state=wechat_login&login_type=jssdk&self_redirect=false"

    req = urllib.request.Request(qr_connect_url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8")

    m = re.search(r"/connect/qrcode/([a-zA-Z0-9_-]+)", html)
    if not m:
        raise RuntimeError("从微信开放平台获取二维码失败，请稍后重试")

    uuid = m.group(1)
    return {
        "uuid": uuid,
        "nonce": nonce,
        "qrcodeUrl": f"/api/login/qrcode_img?uuid={urllib.parse.quote(uuid)}",
        "rawQrcodeUrl": f"https://open.weixin.qq.com/connect/qrcode/{uuid}"
    }

def check_wechat_login_status(uuid, nonce):
    poll_url = f"https://long.open.weixin.qq.com/connect/l/qrconnect?uuid={urllib.parse.quote(uuid)}&_={int(time.time() * 1000)}"
    req = urllib.request.Request(poll_url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Referer": "https://open.weixin.qq.com/"
    })

    try:
        with urllib.request.urlopen(req, timeout=28) as resp:
            text = resp.read().decode("utf-8")
    except Exception:
        return {"status": "waiting", "message": "等待扫码中..."}

    err_match = re.search(r"window\.wx_errcode\s*=\s*(\d+)", text)
    err_code = int(err_match.group(1)) if err_match else 408

    if err_code == 408:
        return {"status": "waiting", "message": "等待扫码中..."}
    elif err_code == 404:
        return {"status": "scanned", "message": "已在微信中扫描，请在手机上点击确认登录"}
    elif err_code == 403:
        return {"status": "canceled", "message": "您已在手机微信上取消登录"}
    elif err_code == 402:
        return {"status": "expired", "message": "二维码已过期，请刷新二维码重试"}
    elif err_code == 405:
        code_match = re.search(r"window\.wx_code\s*=\s*['\"]([^'\"]+)['\"]", text)
        if not code_match:
            raise RuntimeError("微信扫码确认成功，但未解析到授权码 (wx_code)")
        js_code = code_match.group(1)

        yuanbao_login_url = "https://yuanbao.tencent.com/api/joint/login"
        payload = json.dumps({
            "type": "wx",
            "jsCode": js_code,
            "appid": "wx12b75947931a04ec",
            "apiFeature": "team"
        }).encode("utf-8")

        headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": "https://yuanbao.tencent.com",
            "Referer": f"https://yuanbao.tencent.com/scan?nonce={nonce}&state=wechat_login",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest",
            "X-Instance-ID": "5",
            "X-Source": "web",
            "X-Language": "zh-CN",
            "X-Platform": "web"
        }

        login_req = urllib.request.Request(yuanbao_login_url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(login_req, timeout=15) as login_resp:
            login_data = json.loads(login_resp.read().decode("utf-8"))
            cookie_headers = login_resp.headers.get_all("Set-Cookie") or []

        cookie_map = {}
        for sc in cookie_headers:
            pair = sc.split(";")[0].strip()
            if "=" in pair:
                k, v = pair.split("=", 1)
                cookie_map[k.strip()] = v.strip()

        data_obj = login_data.get("data") or {}
        if data_obj.get("userId"):
            cookie_map["hy_user"] = data_obj["userId"]
        if data_obj.get("token"):
            cookie_map["hy_token"] = data_obj["token"]

        full_cookie = "; ".join(f"{k}={v}" for k, v in cookie_map.items())
        if not full_cookie:
            raise RuntimeError("元宝未返回有效登录 Cookie 凭据")

        persist_cookie(full_cookie)

        return {
            "status": "success",
            "message": "登录成功！已自动获取并保存元宝凭证！",
            "cookie": full_cookie,
            "user": {
                "userId": data_obj.get("userId", ""),
                "nickname": data_obj.get("nickname", "")
            }
        }

    return {"status": "unknown", "message": f"未知状态码 ({err_code})"}

def parse_share_url_with_yuanbao(share_url, cookie):
    parse_url = "https://yuanbao.tencent.com/api/weixin/get_parse_result"
    payload = json.dumps({
        "type": "video_channel_url",
        "url": share_url,
        "scene": 1
    }).encode("utf-8")

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": "https://yuanbao.tencent.com",
        "Referer": "https://yuanbao.tencent.com/chat",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Cookie": cookie or ""
    }

    req = urllib.request.Request(parse_url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise RuntimeError(f"元宝接口请求异常: {str(e)}")

    if data.get("code") != 0 or not data.get("data"):
        msg = data.get("msg") or "元宝解析失败，请检查 Cookie 是否有效（可点击扫码重新登录）"
        raise RuntimeError(msg)

    return data["data"]

def get_feed_info_from_wechat(export_id, general_token):
    rid = generate_rid()
    api_url = f"https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info?_rid={rid}&_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Ffeed"
    referer = f"https://channels.weixin.qq.com/finder-preview/pages/feed?entry_card_type=48&comment_scene=39&appid=0&token={urllib.parse.quote(general_token)}&entry_scene=0&eid={urllib.parse.quote(export_id)}"

    payload = json.dumps({
        "baseReq": {"generalToken": general_token},
        "exportId": export_id
    }).encode("utf-8")

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": "https://channels.weixin.qq.com",
        "Referer": referer,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    }

    req = urllib.request.Request(api_url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise RuntimeError(f"微信预览接口请求异常: {str(e)}")

    if data.get("errCode") != 0:
        msg = plain_text_from_html(data.get("errMsg")) or f"错误码 {data.get('errCode')}"
        raise RuntimeError(f"微信接口返回错误: {msg}")

    return data

def parse_video(share_url, cookie):
    m = SPH_REGEX.search(share_url)
    clean_url = m.group(0) if m else share_url.strip()

    if not clean_url.startswith("https://weixin.qq.com/sph/"):
        raise ValueError("无效的视频号分享链接，格式形如 https://weixin.qq.com/sph/xxxx")

    active_cookie = cookie or DEFAULT_COOKIE
    if not active_cookie:
        raise ValueError("请先提供腾讯元宝 (yuanbao.tencent.com) 的 Cookie（可扫码登录获取）")

    parse_data = parse_share_url_with_yuanbao(clean_url, active_cookie)

    export_id = parse_data.get("wx_export_id", "")
    general_token = ""
    playable_url = parse_data.get("playable_url", "")

    if playable_url:
        parsed = urllib.parse.urlparse(playable_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "token" in qs:
            general_token = qs["token"][0]
        if "eid" in qs:
            export_id = qs["eid"][0]

    if not export_id or not general_token:
        raise RuntimeError("未能从元宝结果中提取到 exportId 或 Token")

    feed_result = get_feed_info_from_wechat(export_id, general_token)
    data = feed_result.get("data", {})
    feed_info = data.get("feedInfo", {})
    author_info = data.get("authorInfo", {})

    video_url = (
        feed_info.get("h264VideoInfo", {}).get("videoUrl")
        or feed_info.get("videoUrl")
        or feed_info.get("h265VideoInfo", {}).get("videoUrl")
        or ""
    )

    return {
        "success": True,
        "data": {
            "author": {
                "nickname": author_info.get("nickname") or parse_data.get("author", "未知作者"),
                "headImgUrl": author_info.get("headImgUrl") or parse_data.get("author_icon", ""),
                "authInfo": author_info.get("authIconUrl") or parse_data.get("author_certification_icon", "")
            },
            "feed": {
                "description": feed_info.get("description") or parse_data.get("desc", ""),
                "coverUrl": feed_info.get("coverUrl") or parse_data.get("cover_url", ""),
                "videoUrl": video_url,
                "createTime": feed_info.get("createtime"),
                "stats": {
                    "likeCount": feed_info.get("likeCountFmt", "0"),
                    "favCount": feed_info.get("favCountFmt", "0"),
                    "forwardCount": feed_info.get("forwardCountFmt", "0"),
                    "commentCount": feed_info.get("commentCountFmt", "0")
                },
                "picList": [p.get("url") for p in feed_info.get("picInfo", []) if p.get("url")],
                "bgm": {
                    "name": feed_info.get("bgmInfo", {}).get("name", "背景音乐"),
                    "url": feed_info.get("bgmInfo", {}).get("bgmUrl") or feed_info.get("bgmInfo", {}).get("mediaStreamingUrl", "")
                } if feed_info.get("bgmInfo") else None
            },
            "exportId": export_id,
            "raw": feed_result
        }
    }

class RequestHandler(BaseHTTPRequestHandler):
    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET(head_only=True)

    def do_GET(self, head_only=False):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            cur_dir = os.path.dirname(os.path.abspath(__file__))
            html_file = os.path.join(cur_dir, "public", "index.html")
            if os.path.exists(html_file):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                if not head_only:
                    with open(html_file, "rb") as f:
                        self.wfile.write(f.read())
                return

        if parsed.path == "/api/login/qrcode":
            try:
                data = get_wechat_login_qrcode()
                self.send_json(200, {"success": True, "data": data})
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        if parsed.path == "/api/login/qrcode_img":
            qs = urllib.parse.parse_qs(parsed.query)
            uuid = qs.get("uuid", [""])[0]
            if not uuid:
                self.send_error(400, "Missing uuid")
                return
            img_url = f"https://open.weixin.qq.com/connect/qrcode/{urllib.parse.quote(uuid)}"
            req = urllib.request.Request(img_url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    self.send_response(200)
                    self.send_header("Content-Type", resp.headers.get("Content-Type", "image/jpeg"))
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    if not head_only:
                        self.wfile.write(resp.read())
                return
            except Exception as e:
                self.send_error(500, f"Fetch QR error: {str(e)}")
                return

        if parsed.path == "/api/login/check":
            qs = urllib.parse.parse_qs(parsed.query)
            uuid = qs.get("uuid", [""])[0]
            nonce = qs.get("nonce", [""])[0]
            if not uuid or not nonce:
                self.send_json(400, {"success": False, "error": "Missing uuid or nonce"})
                return
            try:
                res = check_wechat_login_status(uuid, nonce)
                self.send_json(200, {"success": True, "data": res})
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        if parsed.path == "/api/cookie/status":
            self.send_json(200, {
                "success": True,
                "data": {
                    "hasCookie": bool(DEFAULT_COOKIE),
                    "cookie": DEFAULT_COOKIE
                }
            })
            return

        if parsed.path == "/api/download":
            qs = urllib.parse.parse_qs(parsed.query)
            target_url = qs.get("url", [""])[0]
            filename = qs.get("filename", ["video.mp4"])[0]
            if not target_url:
                self.send_error(400, "Missing target url")
                return

            req = urllib.request.Request(target_url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    self.send_response(200)
                    self.send_header("Content-Type", resp.headers.get("Content-Type", "video/mp4"))
                    encoded_fn = urllib.parse.quote(filename)
                    self.send_header("Content-Disposition", f'attachment; filename="{encoded_fn}"; filename*=UTF-8\'\'{encoded_fn}')
                    cl = resp.headers.get("Content-Length")
                    if cl:
                        self.send_header("Content-Length", cl)
                    self.end_headers()
                    if not head_only:
                        while True:
                            chunk = resp.read(64 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                return
            except Exception as e:
                self.send_error(500, f"Download failed: {str(e)}")
                return

        self.send_error(404, "Not Found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len)
        body = json.loads(body_bytes.decode("utf-8") or "{}")

        if parsed.path == "/api/cookie/save":
            persist_cookie(body.get("cookie", ""))
            self.send_json(200, {"success": True, "data": {"hasCookie": bool(DEFAULT_COOKIE)}})
            return

        if parsed.path == "/api/parse":
            try:
                url = body.get("url", "")
                cookie = body.get("cookie", "") or DEFAULT_COOKIE
                res = parse_video(url, cookie)
                self.send_json(200, res)
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        self.send_error(404, "Not Found")

class DualStackServer(HTTPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except Exception:
            pass
        super().server_bind()

def cli_login():
    print("=" * 50)
    print("📲 正在获取微信扫码登录二维码...")
    qr_data = get_wechat_login_qrcode()
    uuid = qr_data["uuid"]
    nonce = qr_data["nonce"]
    print("二维码图片直链 (可在浏览器打开扫码):")
    print(qr_data["rawQrcodeUrl"])
    print("\n等待微信扫码确认中...")
    while True:
        res = check_wechat_login_status(uuid, nonce)
        status = res.get("status")
        if status == "scanned":
            print("📱 已扫描，请在手机上点击确认登录...")
        elif status == "expired":
            print("⌛ 二维码已过期，退出")
            sys.exit(1)
        elif status == "canceled":
            print("⚠️ 已取消登录")
            sys.exit(1)
        elif status == "success":
            print("🎉 登录成功！元宝凭证已自动保存到本地 cookie.txt！")
            break
        time.sleep(1)

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--login":
        cli_login()
        return

    if len(sys.argv) > 1 and sys.argv[1].startswith("http"):
        share_url = sys.argv[1]
        cookie = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("YUANBAO_COOKIE", DEFAULT_COOKIE)
        if not cookie:
            print("错误: 缺少元宝 Cookie，请先执行 `python3 main.py --login` 扫码登录")
            sys.exit(1)
        res = parse_video(share_url, cookie)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    server = DualStackServer(("::", PORT), RequestHandler)
    print("=" * 50)
    print(f"🎬 微信视频号解析下载工具 (Python版) 已启动! (支持 IPv4 & IPv6 双栈)")
    print(f"本地访问: http://localhost:{PORT}")
    print(f"监听地址: [::]:{PORT}")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")

if __name__ == "__main__":
    main()
