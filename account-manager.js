import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_FILE = path.join(process.cwd(), "accounts.json");
const OLD_COOKIE_FILE = path.join(process.cwd(), "cookie.txt");

class AccountManager {
  constructor() {
    this.data = {
      adminPassword: "admin", // 默认管理密码，可在管理面板修改
      accounts: [],
    };
    this.currentIndex = 0;
    this.adminSessions = new Set();
    this.load();
  }

  load() {
    let exists = false;
    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        this.data = JSON.parse(raw);
        if (!this.data.accounts) this.data.accounts = [];
        if (!this.data.adminPassword) this.data.adminPassword = "admin";
        exists = true;
      } catch (err) {
        console.error("[AccountManager] 读取 accounts.json 异常:", err.message);
      }
    }

    // 迁移老旧的 cookie.txt
    if (!exists && fs.existsSync(OLD_COOKIE_FILE)) {
      try {
        const oldCookie = fs.readFileSync(OLD_COOKIE_FILE, "utf-8").trim();
        if (oldCookie) {
          const userMatch = oldCookie.match(/hy_user=([a-zA-Z0-9_-]+)/);
          const userId = userMatch ? userMatch[1] : `legacy_${Date.now()}`;
          this.data.accounts.push({
            id: "acc_" + Math.random().toString(36).substring(2, 10),
            userId,
            nickname: "默认账号 1",
            cookie: oldCookie,
            status: "active",
            errorMsg: "",
            callCount: 0,
            successCount: 0,
            addedAt: Date.now(),
            lastUsedAt: null,
          });
          this.save();
          console.log("[AccountManager] 已将历史 cookie.txt 迁移为账号池第一个账号");
        }
      } catch (_) {}
    }
  }

  save() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("[AccountManager] 保存 accounts.json 失败:", err.message);
    }
  }

  // 验证管理密码
  verifyPassword(password) {
    return this.data.adminPassword === password;
  }

  // 修改管理密码
  setPassword(newPassword) {
    if (!newPassword || newPassword.length < 3) {
      throw new Error("密码长度不能少于3位");
    }
    this.data.adminPassword = newPassword;
    this.save();
  }

  // 创建管理员会话
  createSession() {
    const token = crypto.randomBytes(24).toString("hex");
    this.adminSessions.add(token);
    return token;
  }

  // 校验管理员会话
  checkSession(token) {
    return token && this.adminSessions.has(token);
  }

  // 销毁会话
  destroySession(token) {
    this.adminSessions.delete(token);
  }

  // 获取公开的账号池状态统计（访客可见）
  getPublicStatus() {
    const total = this.data.accounts.length;
    const active = this.data.accounts.filter((a) => a.status === "active").length;
    return {
      ready: active > 0,
      totalAccounts: total,
      activeAccounts: active,
    };
  }

  // 获取管理员账号列表（安全脱敏）
  getAdminAccounts() {
    return this.data.accounts.map((a) => ({
      id: a.id,
      userId: a.userId,
      nickname: a.nickname,
      status: a.status,
      errorMsg: a.errorMsg || "",
      callCount: a.callCount || 0,
      successCount: a.successCount || 0,
      addedAt: a.addedAt,
      lastUsedAt: a.lastUsedAt,
      cookieMasked: a.cookie ? a.cookie.substring(0, 16) + "..." : "",
    }));
  }

  // 添加或更新账号
  upsertAccount(cookie, nickname = "") {
    if (!cookie) throw new Error("Cookie 不能为空");
    const userMatch = cookie.match(/hy_user=([a-zA-Z0-9_-]+)/);
    const userId = userMatch ? userMatch[1] : `user_${Date.now()}`;

    let exist = this.data.accounts.find((a) => a.userId === userId);
    if (exist) {
      exist.cookie = cookie;
      exist.status = "active";
      exist.errorMsg = "";
      if (nickname) exist.nickname = nickname;
      this.save();
      return exist;
    }

    const newAcc = {
      id: "acc_" + Math.random().toString(36).substring(2, 10),
      userId,
      nickname: nickname || `元宝账号 ${this.data.accounts.length + 1}`,
      cookie,
      status: "active",
      errorMsg: "",
      callCount: 0,
      successCount: 0,
      addedAt: Date.now(),
      lastUsedAt: null,
    };
    this.data.accounts.push(newAcc);
    this.save();
    return newAcc;
  }

  // 删除账号
  deleteAccount(id) {
    const idx = this.data.accounts.findIndex((a) => a.id === id);
    if (idx !== -1) {
      this.data.accounts.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  // 获取所有候选账号用于轮询调度
  getCandidates() {
    if (this.data.accounts.length === 0) return [];
    // 优先活跃账号，如果全被标记为 error 也允许尝试以防偶发恢复
    const actives = this.data.accounts.filter((a) => a.status === "active");
    const list = actives.length > 0 ? actives : this.data.accounts;

    // 根据当前轮询索引调整顺序
    const len = list.length;
    const start = this.currentIndex % len;
    this.currentIndex = (this.currentIndex + 1) % len;

    const reordered = [];
    for (let i = 0; i < len; i++) {
      reordered.push(list[(start + i) % len]);
    }
    return reordered;
  }

  // 记录调用成功
  markSuccess(accountId) {
    const acc = this.data.accounts.find((a) => a.id === accountId);
    if (acc) {
      acc.callCount = (acc.callCount || 0) + 1;
      acc.successCount = (acc.successCount || 0) + 1;
      acc.lastUsedAt = Date.now();
      acc.status = "active";
      acc.errorMsg = "";
      this.save();
    }
  }

  // 记录调用异常
  markError(accountId, errMsg) {
    const acc = this.data.accounts.find((a) => a.id === accountId);
    if (acc) {
      acc.callCount = (acc.callCount || 0) + 1;
      acc.lastUsedAt = Date.now();
      acc.status = "error";
      acc.errorMsg = errMsg || "调用失败";
      this.save();
    }
  }
}

export const accountManager = new AccountManager();
