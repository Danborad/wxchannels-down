import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { accountManager } from "./account-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3888;
const CHROME_PORT = process.env.CHROME_PORT ? Number(process.env.CHROME_PORT) : 9444;
const CHROME_PROFILE_DIR = path.join(__dirname, ".chrome-profile");

// 提取视频号链接正则
const SPH_URL_REGEX = /https:\/\/weixin\.qq\.com\/sph\/[a-zA-Z0-9_-]+/;

// 生成微信 finder 预览接口需要的 rid (时间戳16进制 + 8位随机16进制)
function generateRid() {
  const timestampHex = Math.floor(Date.now() / 1000).toString(16);
  let randomHex = "";
  const chars = "0123456789abcdef";
  for (let i = 0; i < 8; i++) {
    randomHex += chars[Math.floor(Math.random() * 16)];
  }
  return `${timestampHex}-${randomHex}`;
}

// 清理 HTML 实体与标签
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

// -------------------------------------------------------------
// Chrome CDP 无头浏览器管理 (仅管理员扫码登录时临时按需拉起，平时完全不占内存)
// -------------------------------------------------------------
let chromeProcess = null;
let currentLoginSession = null;
let currentVerify = null;

const CHROME_IDLE_MS = 2 * 60 * 1000; // 闲置2分钟自动关闭释放内存
let chromeIdleTimer = null;

function cancelChromeShutdown() {
  if (chromeIdleTimer) {
    clearTimeout(chromeIdleTimer);
    chromeIdleTimer = null;
  }
}

function scheduleChromeShutdown(delay) {
  cancelChromeShutdown();
  chromeIdleTimer = setTimeout(() => {
    chromeIdleTimer = null;
    shutdownChrome();
  }, delay || CHROME_IDLE_MS);
}

function shutdownChrome() {
  console.log("[Chrome] 闲置超时，自动彻底关闭无头浏览器释放内存");
  currentLoginSession = null;
  currentVerify = null;
  try {
    if (chromeProcess) {
      chromeProcess.kill("SIGTERM");
      chromeProcess = null;
    }
  } catch (_) {}
  try {
    execSync("pkill -TERM -f '[r]emote-debugging-port=" + CHROME_PORT + "'", { stdio: "ignore" });
  } catch (_) {}
}

const VERIFY_VIEWPORT = { width: 800, height: 540 };

async function cdpCommand(wsUrl, method, params, id) {
  if (!wsUrl) return null;
  return new Promise((resolve) => {
    let done = false;
    let ws;
    const finish = (v) => {
      if (done) return;
      done = true;
      try {
        ws && ws.close();
      } catch (_) {}
      resolve(v);
    };
    try {
      ws = new WebSocket(wsUrl);
    } catch (_) {
      return resolve(null);
    }
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ id: id || 1, method, params: params || {} }));
      } catch (_) {
        finish(null);
      }
      setTimeout(() => finish(null), 5000);
    };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.id === (id || 1)) finish(d.result);
      } catch (_) {
        finish(null);
      }
    };
    ws.onerror = () => finish(null);
  });
}

async function getVerifyClip(wsUrl) {
  let targets = [];
  try {
    targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json`).then((r) => r.json());
  } catch (_) {
    return null;
  }
  const ifr = targets.find((t) => (t.url || "").includes("captcha.gtimg.com"));
  if (!ifr) return null;

  const innerRes = await cdpCommand(
    ifr.webSocketDebuggerUrl,
    "Runtime.evaluate",
    {
      expression: `(() => {
        const el = document.querySelector(".body-wrap") || document.querySelector(".tc-captcha");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })()`,
      returnByValue: true,
    },
    1
  );
  const inner = innerRes?.result?.value;
  if (!inner || inner.w < 60 || inner.h < 60) return null;

  const offRes = await cdpCommand(
    wsUrl,
    "Runtime.evaluate",
    {
      expression: `(() => {
        const f = document.getElementById("tcaptcha_iframe_dy") || document.querySelector("iframe");
        if (!f) return null;
        const r = f.getBoundingClientRect();
        if (r.x < -5000) return null;
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })()`,
      returnByValue: true,
    },
    2
  );
  const off = offRes?.result?.value;
  if (!off) return null;

  const pad = 12;
  let x = Math.round(off.x + inner.x - pad);
  let w = Math.round(inner.w + pad * 2);
  let y = Math.max(0, Math.round(off.y));
  let h = Math.round(off.y + inner.y + inner.h + pad - y);
  x = Math.max(0, x);
  w = Math.min(w, VERIFY_VIEWPORT.width - x);
  h = Math.min(h, VERIFY_VIEWPORT.height - y);
  if (w < 80 || h < 80) return null;
  return { x, y, w, h };
}

async function resolveCaptchaHostWs() {
  try {
    const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json`).then((r) => r.json());
    const ifr = targets.find((t) => (t.url || "").includes("captcha.gtimg.com"));
    if (ifr && ifr.parentId) {
      let pid = ifr.parentId;
      for (let i = 0; i < 5; i++) {
        const p = targets.find((t) => t.id === pid);
        if (!p) break;
        if (p.type === "page" && p.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
        if (!p.parentId) break;
        pid = p.parentId;
      }
    }
  } catch (_) {}
  return null;
}

async function captureVerifyShot() {
  cancelChromeShutdown();
  const wsUrl = (await resolveCaptchaHostWs()) || currentVerify?.wsUrl || currentLoginSession?.wsUrl;
  if (!wsUrl) return { image: "", clip: null };

  await cdpCommand(wsUrl, "Emulation.setDeviceMetricsOverride", {
    width: VERIFY_VIEWPORT.width,
    height: VERIFY_VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  }, 1);

  let clip = null;
  for (let i = 0; i < 16; i++) {
    clip = await getVerifyClip(wsUrl);
    if (clip) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const params = { format: "png" };
  if (clip) {
    params.clip = { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 };
  }
  const res = await cdpCommand(wsUrl, "Page.captureScreenshot", params, 2);
  return { image: res?.data || "", clip };
}

async function replayClick(x, y) {
  cancelChromeShutdown();
  const wsUrl = (await resolveCaptchaHostWs()) || currentVerify?.wsUrl || currentLoginSession?.wsUrl;
  if (!wsUrl) return false;
  await cdpCommand(wsUrl, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, 1);
  await cdpCommand(wsUrl, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, 2);
  await new Promise((r) => setTimeout(r, 60));
  await cdpCommand(wsUrl, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, 3);
  return true;
}

async function enterVerifyMode(safeVerifyUrl, session, options = {}) {
  const wsUrl = session?.wsUrl || currentLoginSession?.wsUrl;
  const tabId = session?.tabId || currentLoginSession?.tabId;
  currentVerify = { safeVerifyUrl, wsUrl, tabId, createdAt: Date.now() };
  cancelChromeShutdown();
  if (wsUrl) {
    await cdpCommand(wsUrl, "Emulation.setDeviceMetricsOverride", {
      width: VERIFY_VIEWPORT.width,
      height: VERIFY_VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    }, 1);
    if (safeVerifyUrl && options.navigate) {
      await cdpCommand(wsUrl, "Page.navigate", { url: safeVerifyUrl }, 2);
    }
  }
  console.log(`[登录] 🔐 进入安全验证模式: ${safeVerifyUrl || "(当前页面)"}`);
}

async function isChromeResponsive() {
  try {
    const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function ensureChrome() {
  if (await isChromeResponsive()) {
    cancelChromeShutdown();
    return true;
  }

  const chromePaths = ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium", "google-chrome"];
  let bin = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      bin = p;
      break;
    }
  }

  if (!bin) {
    console.log("[Chrome] 系统未发现 Chrome/Chromium 浏览器");
    return false;
  }

  try {
    if (!fs.existsSync(CHROME_PROFILE_DIR)) fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
    for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      const p = path.join(CHROME_PROFILE_DIR, lock);
      if (fs.existsSync(p)) {
        try {
          fs.rmSync(p, { force: true });
        } catch (_) {}
      }
    }
  } catch (_) {}

  console.log(`[Chrome] 启动独立无头浏览器引擎: ${bin} (CDP 端口: ${CHROME_PORT})`);
  chromeProcess = spawn(
    bin,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--user-data-dir=${CHROME_PROFILE_DIR}`,
      `--remote-debugging-port=${CHROME_PORT}`,
      "about:blank",
    ],
    { detached: true, stdio: "ignore" }
  );

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isChromeResponsive()) {
      console.log("[Chrome] 无头浏览器已就绪");
      return true;
    }
  }

  return false;
}

process.on("exit", () => {
  if (chromeProcess) {
    try {
      chromeProcess.kill();
    } catch (_) {}
  }
});

async function navigateTab(wsUrl, url) {
  if (!wsUrl) return;
  try {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      setTimeout(() => reject(new Error("WS timeout")), 2500);
    });

    await new Promise((resolve) => {
      const handler = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.id === 99) {
            ws.removeEventListener("message", handler);
            ws.close();
            resolve(d.result);
          }
        } catch (_) {
          ws.close();
          resolve(null);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id: 99, method: "Page.navigate", params: { url } }));
      setTimeout(() => {
        try {
          ws.close();
        } catch (_) {}
        resolve(null);
      }, 2000);
    });
  } catch (err) {
    console.log("[CDP] navigateTab 异常:", err.message);
  }
}

async function executeInTab(wsUrl, expression) {
  if (!wsUrl) return null;
  try {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      setTimeout(() => reject(new Error("WS timeout")), 2500);
    });

    return await new Promise((resolve) => {
      const handler = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.id === 88) {
            ws.removeEventListener("message", handler);
            ws.close();
            resolve(d.result?.result?.value);
          }
        } catch (_) {
          ws.close();
          resolve(null);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(
        JSON.stringify({
          id: 88,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      );
      setTimeout(() => {
        try {
          ws.close();
        } catch (_) {}
        resolve(null);
      }, 3000);
    });
  } catch (err) {
    console.log("[CDP] executeInTab 异常:", err.message);
    return null;
  }
}

async function getTabAuthInfo(wsUrl) {
  if (!wsUrl) return { cookies: [], ybToken: "", ybUser: "" };
  try {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      setTimeout(() => reject(new Error("WS timeout")), 2500);
    });

    const cookies = await new Promise((resolve) => {
      const handler = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.id === 1) {
            ws.removeEventListener("message", handler);
            resolve(data.result?.cookies || []);
          }
        } catch (_) {
          resolve([]);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id: 1, method: "Network.getCookies", params: { urls: ["https://yuanbao.tencent.com"] } }));
    });

    const storageInfo = await new Promise((resolve) => {
      const handler = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.id === 2) {
            ws.removeEventListener("message", handler);
            resolve(data.result?.result?.value || {});
          }
        } catch (_) {
          resolve({});
        }
      };
      ws.addEventListener("message", handler);
      ws.send(
        JSON.stringify({
          id: 2,
          method: "Runtime.evaluate",
          params: {
            expression: `(() => ({
              token: (typeof localStorage !== "undefined" && localStorage.getItem("yb_token")) || "",
              userId: (typeof localStorage !== "undefined" && localStorage.getItem("yb_user_id")) || ""
            }))()`,
            returnByValue: true,
          },
        })
      );
    });

    ws.close();
    return { cookies, ybToken: storageInfo?.token || "", ybUser: storageInfo?.userId || "" };
  } catch (err) {
    return { cookies: [], ybToken: "", ybUser: "" };
  }
}

function buildCookieFromAuth(auth) {
  if (!auth) return "";
  const hasCookieToken = auth.cookies.find((c) => (c.name === "hy_token" || c.name === "hy_user") && c.value);
  if (!hasCookieToken && !auth.ybToken && !auth.ybUser) return "";
  const cookieMap = new Map();
  for (const c of auth.cookies) {
    if (c.name && c.value) cookieMap.set(c.name, c.value);
  }
  if (auth.ybToken) cookieMap.set("hy_token", auth.ybToken);
  if (auth.ybUser) cookieMap.set("hy_user", auth.ybUser);
  const full = Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return full.includes("hy_token=") || full.includes("hy_user=") ? full : "";
}

async function closeTab(tabId) {
  if (!tabId) return;
  try {
    await fetch(`http://127.0.0.1:${CHROME_PORT}/json/close/${tabId}`);
  } catch (_) {}
}

async function isCaptchaPresent() {
  try {
    const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json`).then((r) => r.json());
    return targets.some((t) => (t.url || "").includes("captcha.gtimg.com"));
  } catch (_) {
    return false;
  }
}

let loginInFlight = false;
async function completeWechatLogin(jsCode, session) {
  if (loginInFlight) return "";
  if (!(session && session.mode === "chrome" && session.wsUrl)) return "";
  loginInFlight = true;
  try {
    let liveNonce = await executeInTab(
      session.wsUrl,
      `(function(){try{return localStorage.getItem("hyc-login-nonce")||"";}catch(e){return "";}})()`
    );
    if (!liveNonce) liveNonce = session.nonce || "";
    const scanUrl = `https://yuanbao.tencent.com/scan?nonce=${encodeURIComponent(liveNonce)}&code=${encodeURIComponent(jsCode)}&state=wechat_login`;
    console.log(`[登录] 驱动浏览器走官方原生回调 (nonce=${liveNonce})`);
    await navigateTab(session.wsUrl, scanUrl);

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const auth = await getTabAuthInfo(session.wsUrl);
      const cookie = buildCookieFromAuth(auth);
      if (cookie) {
        accountManager.upsertAccount(cookie);
        scheduleChromeShutdown(8000);
        console.log(`[登录] ✅ 成功获取新账号凭证并录入账号池 (长度 ${cookie.length})`);
        return cookie;
      }
      if (await isCaptchaPresent()) {
        console.log(`[登录] 🔐 检测到内嵌安全验证，进入验证模式`);
        await enterVerifyMode("", session, { navigate: false });
        return "__VERIFY__";
      }
    }
    return "";
  } finally {
    loginInFlight = false;
  }
}

// 启动扫码获取二维码
async function getWechatLoginQrcode() {
  const hasChrome = await ensureChrome();
  if (!hasChrome) {
    throw new Error("服务端未能成功拉起 Chrome 无头引擎");
  }

  try {
    currentVerify = null;
    try {
      const oldTargets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json`).then((r) => r.json());
      for (const t of oldTargets) {
        if (t.type === "page" && t.url !== "about:blank") {
          await fetch(`http://127.0.0.1:${CHROME_PORT}/json/close/${t.id}`).catch(() => {});
        }
      }
    } catch (_) {}

    console.log("[扫码登录] 创建全新的元宝登录标签页...");
    const tab = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?https://yuanbao.tencent.com`, {
      method: "PUT",
    }).then((r) => r.json());

    let qrIframe = null;
    let qrImgSrc = "";
    let realNonce = "";

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const targets = await fetch(`http://127.0.0.1:${CHROME_PORT}/json`).then((r) => r.json());
      qrIframe = targets.find((t) => t.type === "iframe" && t.parentId === tab.id && t.url.includes("qrconnect"));
      if (qrIframe) break;
    }

    if (qrIframe) {
      const nonceMatch = qrIframe.url.match(/nonce(?:%3D|=)([a-zA-Z0-9_-]+)/);
      if (nonceMatch) realNonce = nonceMatch[1];

      const ws = new WebSocket(qrIframe.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
        setTimeout(() => reject(new Error("WS timeout")), 3000);
      });

      qrImgSrc = await new Promise((resolve) => {
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.id === 10) {
              ws.close();
              resolve(data.result?.result?.value || data.result?.value || "");
            }
          } catch (_) {
            ws.close();
            resolve("");
          }
        };
        ws.send(
          JSON.stringify({
            id: 10,
            method: "Runtime.evaluate",
            params: {
              expression: `(() => {
                const img = document.querySelector(".js_qrcode_img") || document.querySelector("img");
                return img ? img.src : null;
              })()`,
              returnByValue: true,
            },
          })
        );
      });
    }

    if (qrImgSrc) {
      const m = qrImgSrc.match(/\/connect\/qrcode\/([a-zA-Z0-9_-]+)/);
      const uuid = m ? m[1] : "";
      if (uuid) {
        currentLoginSession = {
          mode: "chrome",
          tabId: tab.id,
          wsUrl: tab.webSocketDebuggerUrl,
          uuid,
          nonce: realNonce,
          createdAt: Date.now(),
        };
        scheduleChromeShutdown();
        console.log(`[扫码登录] 成功获取真实二维码 UUID: ${uuid}, Nonce: ${realNonce}`);
        return {
          uuid,
          nonce: realNonce,
          qrcodeUrl: `/api/admin/login/qrcode_img?uuid=${encodeURIComponent(uuid)}`,
          rawQrcodeUrl: `https://open.weixin.qq.com/connect/qrcode/${uuid}`,
        };
      }
    }
  } catch (err) {
    console.log("[扫码登录] Chrome 提取二维码异常:", err.message);
    throw err;
  }

  throw new Error("未能获取到有效的微信二维码");
}

// 轮询微信扫码状态
async function checkWechatLoginStatus(uuid, nonce) {
  if (currentLoginSession && currentLoginSession.mode === "chrome" && currentLoginSession.tabId) {
    const auth = await getTabAuthInfo(currentLoginSession.wsUrl);
    const fullCookie = buildCookieFromAuth(auth);

    if (fullCookie) {
      accountManager.upsertAccount(fullCookie);
      scheduleChromeShutdown(8000);
      console.log(`[元宝登录] 🎉 成功捕获登录凭证！已写入账号池`);

      await closeTab(currentLoginSession.tabId);
      currentLoginSession = null;

      return {
        status: "success",
        message: "🎉 登录成功！元宝账号已自动录入账号池！",
        cookie: fullCookie,
      };
    }
  }

  const pollUrl = `https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=${encodeURIComponent(uuid)}&_=${Date.now()}`;
  let text = "";
  try {
    const res = await fetch(pollUrl, {
      signal: AbortSignal.timeout(3500),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Referer": "https://open.weixin.qq.com/",
      },
    });
    text = await res.text();
  } catch (err) {
    return { status: "waiting", message: "等待微信扫码确认中..." };
  }

  const errCodeMatch = text.match(/window\.wx_errcode\s*=\s*(\d+)/);
  const errCode = errCodeMatch ? parseInt(errCodeMatch[1], 10) : 408;

  if (errCode === 408) {
    return { status: "waiting", message: "请使用手机微信扫描上方二维码" };
  } else if (errCode === 404) {
    return { status: "scanned", message: "📱 已在微信中扫描！请在手机上点击【允许登录】..." };
  } else if (errCode === 403) {
    return { status: "canceled", message: "⚠️ 您已在手机微信上取消登录" };
  } else if (errCode === 402) {
    return { status: "expired", message: "⌛ 二维码已过期，请点击刷新二维码" };
  } else if (errCode === 405) {
    const codeMatch = text.match(/window\.wx_code\s*=\s*['"]([^'"]+)['"]/);
    const jsCode = codeMatch ? codeMatch[1] : "";

    if (currentVerify) {
      const auth = await getTabAuthInfo(currentVerify.wsUrl || currentLoginSession?.wsUrl);
      const fullCookie = buildCookieFromAuth(auth);
      if (fullCookie) {
        accountManager.upsertAccount(fullCookie);
        scheduleChromeShutdown(8000);
        console.log(`[登录] ✅ 安全验证通过，已保存凭证`);
        if (currentVerify.tabId) await closeTab(currentVerify.tabId);
        if (currentLoginSession?.tabId) await closeTab(currentLoginSession.tabId);
        currentVerify = null;
        currentLoginSession = null;
        return { status: "success", message: "🎉 登录成功！新账号已录入账号池！", cookie: fullCookie };
      }
      return { status: "verify", message: "🔐 请在下方完成人机验证（依次点击提示的图案）" };
    }

    console.log(`[扫码登录] 微信已确认登录，提取到授权码: ${jsCode ? "成功" : "失败"}`);

    if (jsCode) {
      const result = await completeWechatLogin(jsCode, currentLoginSession);
      if (result === "__VERIFY__") {
        return { status: "verify", message: "🔐 请在下方完成人机验证（依次点击提示的图案）" };
      }
      if (result) {
        if (currentLoginSession?.tabId) await closeTab(currentLoginSession.tabId);
        currentLoginSession = null;
        return {
          status: "success",
          message: "🎉 登录成功！新账号已录入账号池！",
          cookie: result,
        };
      }
    }

    if (currentLoginSession?.mode === "chrome" && (await isCaptchaPresent())) {
      await enterVerifyMode("", currentLoginSession, { navigate: false });
      return { status: "verify", message: "🔐 请在下方完成人机验证（依次点击提示的图案）" };
    }

    return { status: "scanned", message: "📱 微信已确认，正在同步元宝授权与凭证..." };
  }

  return { status: "waiting", message: "等待微信扫码确认中..." };
}

// -------------------------------------------------------------
// 视频号解析核心逻辑（多账号轮询调度池，纯轻量 HTTP 请求，0 Chrome 消耗）
// -------------------------------------------------------------

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
    const errorMsg = result.msg || "元宝接口解析失败";
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

// 统一视频解析（自动进行账号池多账号轮询与自动容灾切替）
async function parseChannelsVideo(shareUrl) {
  const matched = shareUrl.match(SPH_URL_REGEX);
  const cleanUrl = matched ? matched[0] : shareUrl.trim();

  if (!cleanUrl.startsWith("https://weixin.qq.com/sph/")) {
    throw new Error("无效的视频号分享链接，格式形如 https://weixin.qq.com/sph/xxxx");
  }

  const candidates = accountManager.getCandidates();
  if (candidates.length === 0) {
    throw new Error("服务端暂无可用元宝账号，请联系管理员添加账号");
  }

  let lastError = null;
  for (const account of candidates) {
    try {
      console.log(`[解析调度] 正在尝试使用账号 [${account.nickname || account.userId}] 进行解析...`);
      const parseData = await parseShareUrlWithYuanbao(cleanUrl, account.cookie);

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

      if (!exportId || !generalToken) {
        throw new Error("未能从元宝解析结果中提取到视频标识或 Token");
      }

      const feedResult = await getFeedInfoFromWechat(exportId, generalToken);
      const feedInfo = feedResult.data?.feedInfo || {};
      const authorInfo = feedResult.data?.authorInfo || {};

      const bestVideoUrl =
        feedInfo.h264VideoInfo?.videoUrl ||
        feedInfo.videoUrl ||
        feedInfo.h265VideoInfo?.videoUrl ||
        "";

      // 标记该账号调用成功
      accountManager.markSuccess(account.id);

      return {
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
            rawVideoUrl: bestVideoUrl.replace(/[?&]X-snsvideoflag=[^&]*/g, ""),
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
          accountId: account.id,
        },
      };
    } catch (err) {
      console.log(`[解析调度] 账号 [${account.nickname || account.userId}] 解析失败: ${err.message}，自动尝试下一个账号...`);
      accountManager.markError(account.id, err.message);
      lastError = err;
    }
  }

  throw new Error(lastError ? `所有账号均解析失败: ${lastError.message}` : "解析失败");
}

// -------------------------------------------------------------
// HTTP 服务路由
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // 辅助函数：校验管理员鉴权
  const isAuthorizedAdmin = () => {
    const authHeader = req.headers["authorization"] || "";
    const tokenHeader = req.headers["x-admin-token"] || "";
    let token = tokenHeader;
    if (!token && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }
    return accountManager.checkSession(token);
  };

  // 静态页面根路径 (普通访客)
  if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/" || pathname === "/index.html")) {
    const htmlPath = path.join(__dirname, "public", "index.html");
    if (fs.existsSync(htmlPath)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (req.method === "HEAD") {
        res.statusCode = 200;
        return res.end();
      }
      return fs.createReadStream(htmlPath).pipe(res);
    }
  }

  // 管理后台页面 (/admin)
  if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/admin" || pathname === "/admin.html")) {
    const adminHtmlPath = path.join(__dirname, "public", "admin.html");
    if (fs.existsSync(adminHtmlPath)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (req.method === "HEAD") {
        res.statusCode = 200;
        return res.end();
      }
      return fs.createReadStream(adminHtmlPath).pipe(res);
    }
  }

  // 公开接口：查询系统账号池健康概览（普通访客可见）
  if (req.method === "GET" && pathname === "/api/status") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ success: true, data: accountManager.getPublicStatus() }));
  }

  // 公开接口：访客解析视频（全自动多账号轮询，访客无需任何账号或登录）
  if (req.method === "POST" && pathname === "/api/parse") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const url = payload.url || "";
        if (!url) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ success: false, error: "缺少视频链接" }));
        }

        const data = await parseChannelsVideo(url);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify(data));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(
          JSON.stringify({
            success: false,
            error: err.message || "解析过程发生未知错误",
          })
        );
      }
    });
    return;
  }

  // 公开接口：代理流式下载
  if (req.method === "GET" && pathname === "/api/download") {
    const targetUrl = parsedUrl.searchParams.get("url");
    const rawFilename = parsedUrl.searchParams.get("filename") || "video.mp4";
    const filename = encodeURIComponent(rawFilename);

    if (!targetUrl) {
      res.statusCode = 400;
      return res.end("Missing target url");
    }

    try {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        res.statusCode = response.status;
        return res.end("Failed to fetch remote media");
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", response.headers.get("content-type") || "video/mp4");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${filename}`
      );

      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }

      const reader = response.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) return res.end();
        res.write(Buffer.from(value));
        return pump();
      };
      return pump();
    } catch (err) {
      res.statusCode = 500;
      return res.end("Download error: " + err.message);
    }
  }

  // ---------------- 管理员接口 ----------------

  // 管理员登录
  if (req.method === "POST" && pathname === "/api/admin/login") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        if (accountManager.verifyPassword(payload.password)) {
          const token = accountManager.createSession();
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ success: true, data: { token } }));
        } else {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ success: false, error: "密码错误" }));
        }
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 管理员登出
  if (req.method === "POST" && pathname === "/api/admin/logout") {
    const token = req.headers["x-admin-token"] || "";
    accountManager.destroySession(token);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ success: true }));
  }

  // 管理员修改密码
  if (req.method === "POST" && pathname === "/api/admin/password") {
    if (!isAuthorizedAdmin()) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ success: false, error: "无权操作" }));
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        accountManager.setPassword(payload.newPassword);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 管理员获取账号列表
  if (req.method === "GET" && pathname === "/api/admin/accounts") {
    if (!isAuthorizedAdmin()) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ success: false, error: "无权访问" }));
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ success: true, data: accountManager.getAdminAccounts() }));
  }

  // 管理员删除账号
  if (req.method === "POST" && pathname === "/api/admin/accounts/delete") {
    if (!isAuthorizedAdmin()) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ success: false, error: "无权操作" }));
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const ok = accountManager.deleteAccount(payload.id);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: ok }));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 管理员手动追加 Cookie 导入账号
  if (req.method === "POST" && pathname === "/api/admin/accounts/add_manual") {
    if (!isAuthorizedAdmin()) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ success: false, error: "无权操作" }));
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const acc = accountManager.upsertAccount(payload.cookie, payload.nickname);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: true, data: acc }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 管理员扫码：获取二维码（仅管理员可调用拉起 Chrome）
  if (req.method === "GET" && pathname === "/api/admin/login/qrcode") {
    if (!isAuthorizedAdmin()) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ success: false, error: "仅管理员可发起扫码" }));
    }
    try {
      const qrData = await getWechatLoginQrcode();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ success: true, data: qrData }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // 代理二维码图片
  if (req.method === "GET" && pathname === "/api/admin/login/qrcode_img") {
    const uuid = parsedUrl.searchParams.get("uuid");
    if (!uuid) {
      res.statusCode = 400;
      return res.end("Missing uuid");
    }
    try {
      const imgRes = await fetch(`https://open.weixin.qq.com/connect/qrcode/${encodeURIComponent(uuid)}`);
      res.statusCode = imgRes.status;
      res.setHeader("Content-Type", imgRes.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "no-cache");
      const reader = imgRes.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) return res.end();
        res.write(Buffer.from(value));
        return pump();
      };
      return pump();
    } catch (err) {
      res.statusCode = 500;
      return res.end("Fetch QR error: " + err.message);
    }
  }

  // 轮询微信扫码状态
  if (req.method === "GET" && pathname === "/api/admin/login/check") {
    if (!isAuthorizedAdmin()) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ success: false, error: "无权操作" }));
    }
    const uuid = parsedUrl.searchParams.get("uuid");
    const nonce = parsedUrl.searchParams.get("nonce");
    if (!uuid) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ success: false, error: "Missing uuid" }));
    }
    try {
      const result = await checkWechatLoginStatus(uuid, nonce);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ success: true, data: result }));
    } catch (err) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // 管理员获取安全验证截图
  if (req.method === "GET" && pathname === "/api/admin/login/verify/shot") {
    if (!isAuthorizedAdmin()) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ success: false, error: "无权操作" }));
    }
    try {
      const image = await captureVerifyShot();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ success: !!image.image, data: { image: image.image ? "data:image/png;base64," + image.image : "", clip: image.clip } }));
    } catch (err) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // 管理员回放验证点击
  if (req.method === "POST" && pathname === "/api/admin/login/verify/click") {
    if (!isAuthorizedAdmin()) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ success: false, error: "无权操作" }));
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const x = Math.round(Number(payload.x) || 0);
        const y = Math.round(Number(payload.y) || 0);
        await replayClick(x, y);
        await new Promise((r) => setTimeout(r, 800));
        const auth = await getTabAuthInfo(currentVerify?.wsUrl || currentLoginSession?.wsUrl);
        const fullCookie = buildCookieFromAuth(auth);
        if (fullCookie) {
          accountManager.upsertAccount(fullCookie);
          scheduleChromeShutdown(8000);
          console.log(`[登录] ✅ 安全验证通过，已成功保存账号凭证`);
          const tabId = currentVerify?.tabId || currentLoginSession?.tabId;
          if (tabId) await closeTab(tabId);
          currentVerify = null;
          currentLoginSession = null;
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ success: true, data: { loggedIn: true, cookie: fullCookie } }));
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: true, data: { loggedIn: false } }));
      } catch (err) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 其他静态文件处理
  const staticFile = path.join(__dirname, "public", pathname);
  if (req.method === "GET" && fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
    const ext = path.extname(staticFile).toLowerCase();
    const mimeTypes = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".ico": "image/x-icon",
      ".svg": "image/svg+xml",
    };
    res.setHeader("Content-Type", mimeTypes[ext] || "text/plain");
    return fs.createReadStream(staticFile).pipe(res);
  }

  res.statusCode = 404;
  res.end("Not Found");
});

server.listen(PORT, "::", () => {
  console.log(`=================================================`);
  console.log(`🎬 微信视频号解析下载服务已就绪! (支持 IPv4 & IPv6 双栈)`);
  console.log(`本地访问: http://localhost:${PORT}`);

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.internal) continue;
      if (iface.family === "IPv4") {
        console.log(`局域网 IPv4: http://${iface.address}:${PORT}`);
      } else if (iface.family === "IPv6" && !iface.address.startsWith("fe80")) {
        console.log(`公网/局域网 IPv6: http://[${iface.address}]:${PORT}`);
      }
    }
  }
  console.log(`=================================================`);
});
