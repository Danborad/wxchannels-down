# 微信视频号分享链接无水印直链解析与下载器 (wxchannels-down)

> 🎬 基于腾讯元宝开放解析接口与微信官方 Finder Preview 协议，实现**免抓包、免证书代理、无需在微信客户端解密**，直接提取微信视频号**无水印视频直链（自动选择可用最高画质）**、图集和音频，支持一键下载。

项目开源地址：[https://github.com/Danborad/wxchannels-down](https://github.com/Danborad/wxchannels-down)  
在线体验 Demo：[https://wx.znas.cc.cd/](https://wx.znas.cc.cd/)

---

## ✨ 核心特性

- **🛡️ 权限与角色分离**：
  - **普通访客**：直接粘贴视频号分享链接即可一键解析与下载，**无需登录、无需配置凭证**，界面极简纯粹。
  - **管理员后台**：右上角 `⚙️` 密码保护入口（默认密码 `admin`），支持查看账号池、删除失效账号、修改密码以及一键扫码导入新账号。
- **🔄 多账号轮询容灾池 (Round-Robin Failover)**：
  - 支持录入多个腾讯元宝账号形成高可用池。
  - 解析时自动轮询调度，单个账号风控或超频时**无感自动切替至下一账号重试**，保障服务 7×24h 稳定可用。
- **⚡ 极致轻量与内存安全 (常驻仅 ~60MB)**：
  - 普通用户解析视频只走纯 Node.js 原生请求，**绝不会拉起 Chromium 浏览器**，多人并发毫无压力；
  - 仅管理员点击“扫码添加账号”时才临时启动无头 Chrome，添加完成或闲置 2 分钟后**自动彻底销毁并释放内存**。
- **📱 超紧凑单屏 UI & 移动端完美适配**：
  - 桌面端：左右分栏紧凑布局（左侧原生播放器/图集缩略图，右侧作者元数据、文案与下载按钮），一屏尽览无多余滚屏。
  - 移动端：根据手机屏幕流式自适应，支持一键读取剪贴板粘贴，触摸手感极佳。
- **🌐 局域网 IPv4 + 公网 IPv6 双栈支持**：
  - 绑定 `::` 全网卡监听，家庭 NAS 或云服务器部署后，内网外网均可直接访问。

---

## 📺 关于视频画质的重要说明（必读）

本项目通过**腾讯元宝解析接口 + 微信官方 Preview 协议**在服务端完成解析，**这条 Web 链路存在客观画质上限**，请知悉：

- 微信对视频号内容采用「按需分发」：**分享预览链路（Web）只会下发被签名锁定的那一个规格**，通常为 `xWT113`(H.264) 或 `xWT158`(H.265) 的中等码率版本。
- 该规格由微信服务端用 **`basedata`(Protobuf + HMAC 签名) 与 `sign` 加密签名**共同绑定。**删除或修改任何参数都会被 CDN 拒绝（返回 `400 X-videoerrno: -5103397`）**，因此无法通过“剥离参数”方式在服务端还原原始母带。
- 经实测（包括用真实浏览器加载微信官方网页播放器抓包），微信官方 Web 播放器本身也只请求这两个规格，**说明这是整条 Web 链路的天花板，而非本项目实现的缺陷**。

> 因此：本工具会在解析时**自动探测 h264 / h265 两路的所有可用变体，挑选体积最大且可下载的那一路**作为主下载画质（例如某视频给出 `11.4 MB` 的 H.264 版本）。

### ❓ 为什么别的工具能下到 150MB 的原始文件？

那类工具（如 `res-downloader`、桌面版视频号下载器）走的是**微信桌面客户端本地链路**：

1. 客户端会以本地凭证请求**另一套带客户端签名的原始请求**（规格码与 Web 端不同）；
2. 返回的原始文件是**加密流**，还需用响应中的 `decodeKey` 做 **ISAAC-64 解密**后才能播放；
3. 抓包/嗅探工具正是拦截并解密了这条**客户端本地请求**，所以能拿到未压缩母带。

**这条链路无法在纯服务端复现**（缺少客户端本地凭证与签名算法），因此任何基于元宝 Web 接口的在线工具（包括 `wxchannel.solua.one` 等）都拿不到该原始文件。

### ✅ 如何获取真正的 1080P/原始母带？

如果你确实需要原始母带，请使用以下**桌面端方案**（需在装有微信 PC 客户端的电脑上运行）：

- [ltaoo/wx_channels_download](https://github.com/ltaoo/wx_channels_download)（桌面版，支持“下载原始视频”）
- [putyy/res-downloader](https://github.com/putyy/res-downloader)（资源嗅探器，支持原画）

---

## 🛠️ 快速启动

### 方式一：本地 Node.js 极速运行（推荐）

本项目**零第三方 npm 依赖**（纯原生 Node.js 内置模块与 Fetch API），秒级启动。

```bash
# 1. 确保安装了 Node.js (推荐 v18 或更高版本)
node -v

# 2. 进入项目目录
cd /vol1/1000/share1/AI/wxchannels-down

# 3. 启动后台服务
bash start.sh

# 查看实时运行日志
tail -f server.log

# 停止服务
bash stop.sh
```

启动后，访问地址：
- 本地访问：`http://localhost:3888`
- 局域网 IPv4：`http://<你的局域网IP>:3888`
- 公网/局域网 IPv6：`http://[<你的IPv6地址>]:3888`

---

### 方式二：Docker / Docker Compose 部署

```yaml
version: '3.8'

services:
  wxchannels-down:
    build: .
    container_name: wxchannels-down
    restart: unless-stopped
    ports:
      - "3888:3888"
    environment:
      - PORT=3888
```

启动命令：
```bash
docker compose up -d
```

---

## 📖 管理员使用说明

1. 打开网页后，点击右上角的 **`⚙️`** 图标。
2. 输入管理密码（初次默认为 **`admin`**，进入后可在下方自行修改）。
3. **添加元宝账号到账号池**：
   - 方式一（推荐）：点击 **“➕ 扫码添加账号”**，微信扫码并在手机上确认，后台自动抓取凭据录入账号池并销毁浏览器释放内存。
   - 方式二：展开高级折叠栏，手动粘贴抓取到的元宝 Cookie 导入。
4. 账号池建立后，所有访客均可无限畅享高可用解析！

---

## 🔒 隐私与安全性

- 配置文件 `accounts.json`、`cookie.txt` 和浏览器缓存目录 `.chrome-profile` 已默认加入 `.gitignore`，**严禁提交至公共仓库**。
- 开源版本附带 `accounts.example.json` 作为配置参考。

---

## 💖 致谢与灵感来源 (Acknowledgements & References)

本项目在开发过程中，深受开源社区众多前辈与优秀项目的启发，特别鸣谢以下项目与作者的无私分享：

- 🌟 **[ltaoo/wx_channels_download](https://github.com/ltaoo/wx_channels_download)**  
  本项目的核心启发者！感谢作者开源的微信视频号解析器，以及利用腾讯元宝接口转换直链的开拓性思路。
- 🌟 **[kanadeblisst00/WechatVideoSniffer2.0](https://github.com/kanadeblisst00/WechatVideoSniffer2.0)**  
  微信视频号网络请求抓包嗅探与视频流协议分析参考。
- 🌟 **[Hanson/WechatSphDecrypt](https://github.com/Hanson/WechatSphDecrypt)**  
  微信视频号后端解密与流媒体封装逆向研究。
- 🌟 **[res-downloader](https://github.com/putyy/res-downloader)**  
  网络资源嗅探与真实原画母带（剥离 `X-snsvideoflag` 还原 1080P 超高码率）下载方案参考。
- 🌟 **[wxchannel.solua.one](https://wxchannel.solua.one/)**  
  优秀的第三方社区网页版实现与 UI 布局参考。

向所有为开源社区做出贡献的开发者致敬！

---

## 开源协议

本项目采用 [MIT License](LICENSE) 授权。仅供个人学习、自动化测试与离线备份研究使用。
