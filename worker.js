/**
 * Cloudflare Worker 微信视频号解析下载器单文件版本
 *
 * 部署方法：
 * 1. 登录 Cloudflare Dashboard -> Workers & Pages -> Create Worker
 * 2. 复制此文件所有代码，替换 Worker 编辑器中的所有内容，点击「Save and Deploy」
 * 3. 在 Settings -> Variables 中可以添加环境变量 COOKIE (可选，也可在前端页面输入)
 * 4. 在 Settings -> Domains & Routes 中绑定你自己的域名（如 wx.yourdomain.com），国内即可直接访问！
 */

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>微信视频号无水印下载器 - 视频直链解析工具</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎬</text></svg>">
  <style>
    :root {
      --primary: #07c160;
      --primary-hover: #06ad56;
      --primary-subtle: #e8f8f0;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --danger: #ef4444;
      --danger-subtle: #fef2f2;
      --radius: 12px;
      --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --card-bg: #1e293b;
        --border: #334155;
        --text: #f8fafc;
        --text-muted: #94a3b8;
        --primary-subtle: #064e3b;
        --danger-subtle: #450a0a;
        --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.3);
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
      padding: 30px 16px;
    }
    .container { max-width: 860px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 28px; }
    header h1 {
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    header p { color: var(--text-muted); font-size: 14px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 24px;
      margin-bottom: 20px;
    }
    .input-group { display: flex; gap: 10px; margin-bottom: 14px; }
    input[type="text"], input[type="password"] {
      flex: 1;
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--card-bg);
      color: var(--text);
      font-size: 14px;
      transition: all 0.2s;
    }
    input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(7, 193, 96, 0.2);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 12px 22px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
      text-decoration: none;
    }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-secondary { background: #f1f5f9; color: #334155; }
    @media (prefers-color-scheme: dark) {
      .btn-secondary { background: #334155; color: #f1f5f9; }
    }
    .btn-secondary:hover { opacity: 0.85; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    details.cookie-drawer {
      border: 1px dashed var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      margin-top: 10px;
      font-size: 13px;
    }
    details.cookie-drawer summary {
      cursor: pointer;
      color: var(--text-muted);
      font-weight: 500;
      user-select: none;
    }
    .cookie-box { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
    .cookie-tip { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
    .cookie-tip a { color: var(--primary); text-decoration: none; }
    .alert {
      padding: 14px 18px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      display: none;
    }
    .alert-error {
      display: block;
      background: var(--danger-subtle);
      border: 1px solid var(--danger);
      color: var(--danger);
    }
    .alert-info {
      display: block;
      background: var(--primary-subtle);
      border: 1px solid var(--primary);
      color: var(--primary);
    }
    #resultArea { display: none; }
    .author-info { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .author-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid var(--border);
    }
    .author-name {
      font-size: 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .auth-badge { width: 16px; height: 16px; }
    .video-desc {
      font-size: 15px;
      margin-bottom: 16px;
      white-space: pre-wrap;
      word-break: break-all;
      background: rgba(0,0,0,0.02);
      padding: 10px 14px;
      border-radius: 8px;
    }
    .stats-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 18px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .stats-item { display: inline-flex; align-items: center; gap: 4px; }
    .media-container {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    video {
      width: 100%;
      max-width: 520px;
      max-height: 560px;
      border-radius: 10px;
      background: #000;
      outline: none;
    }
    .pic-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 10px;
      width: 100%;
      margin-bottom: 16px;
    }
    .pic-item {
      position: relative;
      aspect-ratio: 1;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .pic-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .pic-item img:hover { transform: scale(1.05); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
    .raw-json { margin-top: 16px; }
    .raw-json summary { cursor: pointer; color: var(--text-muted); font-size: 13px; }
    pre {
      background: rgba(0,0,0,0.04);
      padding: 12px;
      border-radius: 8px;
      font-size: 12px;
      max-height: 250px;
      overflow: auto;
      margin-top: 8px;
    }
    footer { text-align: center; font-size: 13px; color: var(--text-muted); margin-top: 40px; }
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.85);
      color: white;
      padding: 8px 18px;
      border-radius: 20px;
      font-size: 14px;
      display: none;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1>🎬 微信视频号解析下载器</h1>
    <p>通过元宝 API 免解密提取视频号原画真实下载直链</p>
  </header>
  <div class="card">
    <div class="input-group">
      <input type="text" id="urlInput" placeholder="在此粘贴微信视频号分享链接 (支持整段文本，自动提取)" autocomplete="off">
      <button class="btn btn-primary" id="parseBtn">立即解析</button>
    </div>
    <details class="cookie-drawer" id="cookieDrawer">
      <summary>🔑 腾讯元宝凭证设置 (Cookie)</summary>
      <div class="cookie-box">
        <div style="display: flex; gap: 8px;">
          <input type="password" id="cookieInput" placeholder="输入从 yuanbao.tencent.com 获取的 Cookie">
          <button class="btn btn-secondary" id="saveCookieBtn">保存凭证</button>
          <button class="btn btn-secondary" id="clearCookieBtn">清除</button>
        </div>
        <p class="cookie-tip">
          💡 <strong>如何获取 Cookie：</strong> 在电脑浏览器打开并登录 <a href="https://yuanbao.tencent.com" target="_blank">腾讯元宝 (yuanbao.tencent.com)</a>，按 <code>F12</code> 打开控制台，在【网络/Network】栏目中点击任意请求，复制请求头中的 <code>cookie</code> 粘贴到此处即可。
        </p>
      </div>
    </details>
  </div>
  <div id="alertBox" class="alert"></div>
  <div id="resultArea" class="card">
    <div class="author-info">
      <img id="authorAvatar" class="author-avatar" src="" alt="头像" onerror="this.style.display='none'">
      <div>
        <div class="author-name">
          <span id="authorName">-</span>
          <img id="authBadge" class="auth-badge" src="" style="display: none;">
        </div>
        <div id="createTime" style="font-size: 12px; color: var(--text-muted);">-</div>
      </div>
    </div>
    <div id="videoDesc" class="video-desc"></div>
    <div class="stats-bar">
      <span class="stats-item">👍 点赞 <span id="statLike">0</span></span>
      <span class="stats-item">❤️ 收藏 <span id="statFav">0</span></span>
      <span class="stats-item">↗️ 转发 <span id="statForward">0</span></span>
      <span class="stats-item">💬 评论 <span id="statComment">0</span></span>
    </div>
    <div class="media-container" id="videoWrapper">
      <video id="videoPlayer" controls playsinline preload="metadata"></video>
    </div>
    <div id="picGrid" class="pic-grid" style="display: none;"></div>
    <div class="actions">
      <a id="btnDownload" class="btn btn-primary" href="#" target="_blank">⬇️ 下载视频</a>
      <button id="btnCopyUrl" class="btn btn-secondary">📋 复制直链</button>
      <button id="btnCopyDesc" class="btn btn-secondary">📄 复制文案</button>
    </div>
    <details class="raw-json">
      <summary>查看原始 API 返回数据</summary>
      <pre id="jsonPreview"></pre>
    </details>
  </div>
  <footer>
    <p>仅供个人学习与离线备份研究使用 · 基于元宝与 Finder Preview 协议</p>
  </footer>
</div>
<div id="toast" class="toast"></div>

<script>
  const urlInput = document.getElementById("urlInput");
  const parseBtn = document.getElementById("parseBtn");
  const cookieInput = document.getElementById("cookieInput");
  const saveCookieBtn = document.getElementById("saveCookieBtn");
  const clearCookieBtn = document.getElementById("clearCookieBtn");
  const alertBox = document.getElementById("alertBox");
  const resultArea = document.getElementById("resultArea");
  const toast = document.getElementById("toast");

  const savedCookie = localStorage.getItem("YUANBAO_COOKIE") || "";
  if (savedCookie) cookieInput.value = savedCookie;

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    setTimeout(() => { toast.style.display = "none"; }, 2500);
  }

  function showAlert(msg, isError = false) {
    alertBox.textContent = msg;
    alertBox.className = "alert " + (isError ? "alert-error" : "alert-info");
    alertBox.style.display = "block";
  }

  function hideAlert() { alertBox.style.display = "none"; }

  saveCookieBtn.addEventListener("click", () => {
    const val = cookieInput.value.trim();
    if (val) {
      localStorage.setItem("YUANBAO_COOKIE", val);
      showToast("凭证 Cookie 保存成功！");
    } else {
      localStorage.removeItem("YUANBAO_COOKIE");
      showToast("凭证 Cookie 已清除");
    }
  });

  clearCookieBtn.addEventListener("click", () => {
    cookieInput.value = "";
    localStorage.removeItem("YUANBAO_COOKIE");
    showToast("凭证 Cookie 已清除");
  });

  function formatTimestamp(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false });
  }

  let currentVideoUrl = "";
  let currentDesc = "";

  async function handleParse() {
    const rawText = urlInput.value.trim();
    if (!rawText) {
      showAlert("请输入微信视频号分享链接！", true);
      return;
    }
    const match = rawText.match(/https:\\/\\/weixin\\.qq\\.com\\/sph\\/[a-zA-Z0-9_-]+/);
    const targetUrl = match ? match[0] : rawText;

    const cookie = cookieInput.value.trim() || localStorage.getItem("YUANBAO_COOKIE") || "";
    if (!cookie) {
      document.getElementById("cookieDrawer").open = true;
      showAlert("请先在下方输入腾讯元宝 Cookie 凭证后再解析！", true);
      return;
    }

    hideAlert();
    resultArea.style.display = "none";
    parseBtn.disabled = true;
    parseBtn.textContent = "解析中...";

    try {
      const resp = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, cookie }),
      });

      const res = await resp.json();
      if (!res.success) throw new Error(res.error || "解析失败");

      const { author, feed, raw } = res.data;

      document.getElementById("authorName").textContent = author.nickname || "视频作者";
      const avatarEl = document.getElementById("authorAvatar");
      if (author.headImgUrl) {
        avatarEl.src = author.headImgUrl;
        avatarEl.style.display = "block";
      } else {
        avatarEl.style.display = "none";
      }

      const badgeEl = document.getElementById("authBadge");
      if (author.authInfo) {
        badgeEl.src = author.authInfo;
        badgeEl.style.display = "inline-block";
      } else {
        badgeEl.style.display = "none";
      }

      document.getElementById("createTime").textContent = feed.createTime ? "发布时间: " + formatTimestamp(feed.createTime) : "";
      currentDesc = feed.description || "";
      document.getElementById("videoDesc").textContent = currentDesc || "（无文案标题）";

      document.getElementById("statLike").textContent = feed.stats.likeCount || "0";
      document.getElementById("statFav").textContent = feed.stats.favCount || "0";
      document.getElementById("statForward").textContent = feed.stats.forwardCount || "0";
      document.getElementById("statComment").textContent = feed.stats.commentCount || "0";

      const videoWrapper = document.getElementById("videoWrapper");
      const videoPlayer = document.getElementById("videoPlayer");
      const picGrid = document.getElementById("picGrid");
      const btnDownload = document.getElementById("btnDownload");
      const btnCopyUrl = document.getElementById("btnCopyUrl");

      if (feed.videoUrl) {
        currentVideoUrl = feed.videoUrl;
        videoWrapper.style.display = "flex";
        videoPlayer.src = feed.videoUrl;
        if (feed.coverUrl) videoPlayer.poster = feed.coverUrl;
        picGrid.style.display = "none";

        const filename = (author.nickname + "_" + (feed.description ? feed.description.slice(0, 30) : "video")).replace(/[\\\\/:*?"<>|]/g, "_") + ".mp4";
        btnDownload.href = "/api/download?url=" + encodeURIComponent(feed.videoUrl) + "&filename=" + encodeURIComponent(filename);
        btnDownload.style.display = "inline-flex";
        btnCopyUrl.style.display = "inline-flex";
      } else {
        currentVideoUrl = "";
        videoWrapper.style.display = "none";
        btnDownload.style.display = "none";
        btnCopyUrl.style.display = "none";

        if (feed.picList && feed.picList.length > 0) {
          picGrid.style.display = "grid";
          picGrid.innerHTML = feed.picList.map((p, idx) => '<div class="pic-item"><a href="' + p + '" target="_blank"><img src="' + p + '" loading="lazy" alt="图片"></a></div>').join("");
        }
      }

      document.getElementById("jsonPreview").textContent = JSON.stringify(raw, null, 2);
      resultArea.style.display = "block";
      showToast("解析成功！");
    } catch (err) {
      showAlert("解析失败：" + err.message, true);
    } finally {
      parseBtn.disabled = false;
      parseBtn.textContent = "立即解析";
    }
  }

  parseBtn.addEventListener("click", handleParse);
  urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleParse(); });

  document.getElementById("btnCopyUrl").addEventListener("click", () => {
    if (!currentVideoUrl) return;
    navigator.clipboard.writeText(currentVideoUrl).then(() => { showToast("视频直链已复制到剪贴板！"); });
  });

  document.getElementById("btnCopyDesc").addEventListener("click", () => {
    if (!currentDesc) return;
    navigator.clipboard.writeText(currentDesc).then(() => { showToast("视频文案已复制到剪贴板！"); });
  });
</script>
</body>
</html>`;

function generateRid() {
  const timestampHex = Math.floor(Date.now() / 1000).toString(16);
  let randomHex = "";
  const chars = "0123456789abcdef";
  for (let i = 0; i < 8; i++) {
    randomHex += chars[Math.floor(Math.random() * 16)];
  }
  return `${timestampHex}-${randomHex}`;
}

function plainTextFromHtml(value) {
  if (!value) return "";
  return String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function parseShareUrlWithYuanbao(shareUrl, cookie) {
  const parseUrl = "https://yuanbao.tencent.com/api/weixin/get_parse_result";
  const payload = JSON.stringify({
    type: "video_channel_url",
    url: shareUrl,
    scene: 1,
  });

  const headers = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "origin": "https://yuanbao.tencent.com",
    "referer": "https://yuanbao.tencent.com/chat",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
    "cookie": cookie || "",
  };

  const response = await fetch(parseUrl, {
    method: "POST",
    headers,
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`元宝接口网络错误: HTTP ${response.status}`);
  }

  const result = await response.json();
  if (result.code !== 0 || !result.data) {
    const errorMsg = result.msg || "元宝接口解析失败，请检查 Cookie 是否有效";
    const err = new Error(errorMsg);
    err.code = result.code;
    throw err;
  }

  return result.data;
}

async function getFeedInfoFromWechat(exportId, generalToken) {
  const rid = generateRid();
  const apiUrl = `https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info?_rid=${rid}&_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Ffeed`;

  const referer =
    `https://channels.weixin.qq.com/finder-preview/pages/feed` +
    `?entry_card_type=48&comment_scene=39&appid=0` +
    `&token=${encodeURIComponent(generalToken)}` +
    `&entry_scene=0&eid=${encodeURIComponent(exportId)}`;

  const headers = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "Origin": "https://channels.weixin.qq.com",
    "Referer": referer,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  };

  const payload = JSON.stringify({
    baseReq: { generalToken },
    exportId,
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`微信视频接口网络请求失败: HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result.errCode !== 0) {
    const errMsg = plainTextFromHtml(result.errMsg) || `错误码 ${result.errCode}`;
    throw new Error(`微信接口返回错误: ${errMsg}`);
  }

  const detail = result.data?.errMsg;
  if (detail && (detail.type !== 0 || detail.title || detail.content)) {
    const title = plainTextFromHtml(detail.title) || "视频无法访问";
    const content = plainTextFromHtml(detail.content) || "";
    throw new Error(`${title}${content ? ": " + content : ""}`);
  }

  return result;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // GET / 首页返回
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(HTML_CONTENT, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // POST /api/parse
    if (request.method === "POST" && url.pathname === "/api/parse") {
      try {
        const body = await request.json();
        const shareUrl = body.url || "";
        const cookie = body.cookie || env.COOKIE || "";

        if (!shareUrl) {
          return new Response(JSON.stringify({ success: false, error: "缺少视频链接" }), {
            status: 400,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }

        const match = shareUrl.match(/https:\/\/weixin\.qq\.com\/sph\/[a-zA-Z0-9_-]+/);
        const cleanUrl = match ? match[0] : shareUrl.trim();

        if (!cookie) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "请先配置或提供腾讯元宝 (yuanbao.tencent.com) 的 Cookie",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            }
          );
        }

        const parseData = await parseShareUrlWithYuanbao(cleanUrl, cookie);

        let generalToken = "";
        let exportId = parseData.wx_export_id || "";
        if (parseData.playable_url) {
          try {
            const u = new URL(parseData.playable_url);
            generalToken = u.searchParams.get("token") || "";
            const eid = u.searchParams.get("eid");
            if (eid) exportId = eid;
          } catch (_) {}
        }

        const feedResult = await getFeedInfoFromWechat(exportId, generalToken);
        const feedInfo = feedResult.data?.feedInfo || {};
        const authorInfo = feedResult.data?.authorInfo || {};

        const bestVideoUrl =
          feedInfo.h264VideoInfo?.videoUrl ||
          feedInfo.videoUrl ||
          feedInfo.h265VideoInfo?.videoUrl ||
          "";

        const responsePayload = {
          success: true,
          data: {
            author: {
              nickname: authorInfo.nickname || parseData.author || "未知作者",
              headImgUrl: authorInfo.headImgUrl || parseData.author_icon || "",
              authInfo: authorInfo.authIconUrl || parseData.author_certification_icon || "",
            },
            feed: {
              description: feedInfo.description || parseData.desc || "",
              coverUrl: feedInfo.coverUrl || parseData.cover_url || "",
              videoUrl: bestVideoUrl,
              createTime: feedInfo.createtime ? Number(feedInfo.createtime) : null,
              stats: {
                likeCount: feedInfo.likeCountFmt || "0",
                favCount: feedInfo.favCountFmt || "0",
                forwardCount: feedInfo.forwardCountFmt || "0",
                commentCount: feedInfo.commentCountFmt || "0",
              },
              picList: Array.isArray(feedInfo.picInfo) ? feedInfo.picInfo.map((p) => p.url) : [],
              bgm: feedInfo.bgmInfo
                ? {
                    name: feedInfo.bgmInfo.name || "背景音乐",
                    url: feedInfo.bgmInfo.bgmUrl || feedInfo.bgmInfo.mediaStreamingUrl || "",
                  }
                : null,
            },
            exportId,
            raw: feedResult,
          },
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({
            success: false,
            error: err.message || "解析过程发生未知错误",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          }
        );
      }
    }

    // GET /api/download 代理下载
    if (request.method === "GET" && url.pathname === "/api/download") {
      const targetUrl = url.searchParams.get("url");
      const filename = encodeURIComponent(url.searchParams.get("filename") || "video.mp4");

      if (!targetUrl) {
        return new Response("Missing target url", { status: 400 });
      }

      const mediaResp = await fetch(targetUrl);
      const newHeaders = new Headers(mediaResp.headers);
      newHeaders.set(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${filename}`
      );
      newHeaders.set("Access-Control-Allow-Origin", "*");

      return new Response(mediaResp.body, {
        status: mediaResp.status,
        headers: newHeaders,
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
