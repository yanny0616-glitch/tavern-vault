# 📦 TavernVault 酒馆藏馆

一个独立运行的 SillyTavern / TauriTavern 资源仓库：角色卡、世界书、预设、正则、脚本、快速回复、主题、背景、聊天记录、提示词……都能收进来。

- **不开酒馆也能用**：手机 Safari、电脑浏览器直接访问，上传、浏览、编辑都可以。可以添加到 iPhone 主屏幕当 App 用。
- **在酒馆里也能用**：装上插件后，SillyTavern 和 TauriTavern 里都能全屏打开同一个仓库。在酒馆里打开时，还能把酒馆已有的内容一键收进仓库，或者把仓库内容一键导入酒馆。
- **实时互通**：所有入口连的是同一个服务，一边修改，另一边马上刷新。

```
             ┌──────────────────────────────┐
             │   藏馆服务（Node.js，零依赖）  │  ← 唯一数据源
             │   db.json + 去重文件仓库 + 网页 │
             └───────┬──────────────┬───────┘
                     │ HTTPS (Cloudflare Tunnel)
      ┌──────────────┘              └──────────────┐
 iPhone Safari / 电脑浏览器                 SillyTavern / TauriTavern
 直接访问网页                              插件全屏内嵌同一网页
                                          + postMessage 桥读写酒馆本地数据
```

## 功能

| 模块 | 内容 |
|---|---|
| 自动识别 | 角色卡 PNG（V2/V3，`chara`/`ccv3`）/ JSON / CHARX、世界书、对话补全预设、指令/上下文/系统提示词模板、文本补全预设、正则（单条或合集）、快速回复、主题、酒馆助手脚本、JS/CSS、聊天记录 JSONL、图片、ZIP |
| 角色卡信息 | 封面、作者、版本、标签、开场白数量、内嵌世界书条目、内嵌正则/脚本、深度提示词、估算 Token、卡片规范、图片尺寸；描述、性格、场景、全部开场白、对话示例、系统提示词、作者注释都能逐项查看 |
| 编辑角色卡 | 在网页里直接改卡。保存后生成新版本，PNG 卡保留原图并重新写入 `chara` 和 `ccv3` |
| 版本与附件 | 每个条目可以有多个文件，能切换主版本、加备注、设封面，也能附加插图、聊天记录等 |
| 自定义字段 | 自己决定要记录的信息，比如来源、推荐模型、搭配预设、NSFW、使用状态。支持 10 种字段类型，可以只对某些类型显示 |
| 整理 | 标签、合集、收藏、5 星评分、笔记、全文搜索（`#标签` 语法）、按类型/标签/合集筛选、5 种排序、网格/列表/紧凑视图 |
| 批量 | 多选后批量打标签、加合集、收藏、导出 ZIP、导入酒馆、删除 |
| 导入方式 | 选文件、拖拽、链接导入（服务器下载直链）、手动记录（只存链接或想法）、iOS 快捷指令分享上传 |
| 去重 | 按文件 SHA-256 检测重复，文件只存一份 |
| 其他 | 回收站、统计页（类型分布、标签云、空间占用）、完整备份 ZIP、访问密码、深浅色主题、强调色、PWA |

## 目录结构

```
tavern-vault/
├── server/              服务端（Node >= 18，无第三方依赖）
│   ├── server.js        HTTP API + 静态网页 + SSE 实时推送
│   └── lib/             存储、类型识别、PNG 读写、ZIP 打包
├── web/                 网页前端（原生 JS，无需构建）
├── extension/           酒馆插件（SillyTavern / TauriTavern 通用）
└── deploy/              systemd 服务与 Cloudflare Tunnel 示例配置
```

## 一、部署服务端（云服务器 + Cloudflare）

### 1. 运行

```bash
cd tavern-vault/server
TV_HOST=127.0.0.1 TV_PORT=5180 TV_PASSWORD='设置一个强密码' node server.js
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `TV_PORT` | `5180` | 端口 |
| `TV_HOST` | `0.0.0.0` | 用 Cloudflare Tunnel 时**请设为 `127.0.0.1`**，不要直接暴露端口 |
| `TV_DATA` | `server/data` | 数据目录 |
| `TV_PASSWORD` | 无 | 首次启动时设置的访问密码，之后可在网页「设置」里修改 |
| `TV_MAX_UPLOAD_MB` | `200` | 单个文件上传上限 |

开机自启：

```bash
sudo cp deploy/tavern-vault.service /etc/systemd/system/
# 按需修改里面的路径和密码
sudo systemctl daemon-reload && sudo systemctl enable --now tavern-vault
```

### 2. 用 Cloudflare Tunnel 绑定域名（推荐）

好处：不用开放端口，自动 HTTPS。iOS 上 TauriTavern 内嵌页面必须用 HTTPS。

**控制台方式（最简单）：**

1. Cloudflare 控制台 → Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared
2. 复制页面上给出的安装命令，在服务器上执行（`cloudflared service install <token>`）
3. Public Hostname 添加一条：子域名 `vault`，域名选你的，Service 填 `HTTP` + `127.0.0.1:5180`
4. 打开 `https://vault.你的域名`

**命令行方式：** 参考 `deploy/cloudflared-config.example.yml`。

> 注意：Cloudflare 免费套餐单个请求上限 100MB，超过的文件请直接在服务器本机上传。

### 3. 第一次打开

- 如果没有用 `TV_PASSWORD` 启动，请立刻到「设置 → 访问密码」设置密码。在这之前，任何知道网址的人都能访问。
- iPhone：Safari 打开 → 分享 → 「添加到主屏幕」。

## 二、安装酒馆插件

插件目录是 `extension/`，SillyTavern 和 TauriTavern 共用一份。

### TauriTavern（iOS / Android / 桌面）

TauriTavern 只能**通过 Git 地址**安装第三方扩展，而且要求 `manifest.json` 在仓库根目录。所以需要把 `extension/` 单独推送成一个仓库：

```bash
cd tavern-vault/extension
git init && git add . && git commit -m "TavernVault extension"
git remote add origin https://github.com/<你>/tavern-vault-extension.git
git push -u origin main
```

然后在 TauriTavern 中：扩展 → 安装扩展 → 填入 `https://github.com/<你>/tavern-vault-extension`（仓库需要公开）。

> **iOS 注意**：公开 TestFlight 包（`ios_external_beta` 配置）默认禁用第三方扩展。自签 IPA 或 Stable/Canary 包默认允许。

### SillyTavern

可以用同样的 Git 地址安装；也可以在藏馆「设置」页下载插件压缩包，解压到 `SillyTavern/data/default-user/extensions/tavern-vault/`。

### 配置

扩展设置 →「📦 TavernVault 酒馆藏馆」→ 填写服务器地址（如 `https://vault.example.com`）和密码 → 点「连接」。

打开方式：左下角魔棒菜单 →「酒馆藏馆」，或者点可拖动的 📦 悬浮按钮。

在酒馆里打开时，底部会多出「🍺 酒馆」页：

- **酒馆 → 仓库**：浏览酒馆里的角色卡、世界书、预设、正则、快速回复、主题、背景，会标出哪些已经收藏。可以单个或批量收藏进仓库，角色卡导出为完整 PNG。
- **仓库 → 酒馆**：在任意条目详情里点「导入到酒馆」，或多选后批量导入。角色卡和世界书会立即刷新；预设、正则、主题、快速回复需要刷新酒馆页面后才能在列表里看到。

## 三、iOS 快捷指令：分享即上传

在「设置 → iPhone 小技巧」里有地址和访问令牌：

1. 新建快捷指令，打开「在共享表单中显示」，接收类型选「文件」「图像」
2. 添加「获取 URL 内容」：URL 填 `https://vault.你的域名/api/items?filename=快捷指令上传`，方法选 POST，请求体选「文件」并选择「快捷指令输入」
3. 如果设置了密码，在头部添加 `Authorization`，值为 `Bearer <令牌>`
4. 之后在 Safari、Discord、「文件」等 App 里分享角色卡，选这个快捷指令即可

## 四、数据与备份

- 数据都在 `server/data/`：`db.json` 是索引，`files/` 存按 SHA-256 命名的原始文件
- 「设置 → 下载完整备份」得到的 ZIP 解压回 data 目录即可恢复
- 删除的内容先进回收站，永久删除后会自动清理没有被引用的文件

## API 一览

除 `/api/health`、`/api/login`、`/api/extension.zip` 外，其余接口在设置密码后需要带 `Authorization: Bearer <token>`（或 `?token=`）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 全部条目、合集、字段、设置、统计 |
| GET | `/api/events` | SSE 实时事件 |
| POST | `/api/items?filename=&type=&tags=&collections=&mode=` | 上传文件（原始 body），自动识别 |
| POST | `/api/import-url` | `{url}` 由服务器下载 |
| POST | `/api/items/manual` | 新建无文件条目 |
| GET/PATCH/DELETE | `/api/items/:id` | 读取 / 修改 / 删除（`?hard=1` 永久删除） |
| GET | `/api/items/:id/content` | 主文件解析后的内容 |
| PUT | `/api/items/:id/card` | 保存编辑后的角色卡（生成新版本） |
| POST/PATCH/DELETE | `/api/items/:id/files[/:fid]` | 版本与附件管理 |
| POST | `/api/batch` | 批量操作 |
| POST | `/api/export` | `{ids}` 导出 ZIP |
| GET | `/api/backup` | 完整备份 |
| GET | `/api/files/:sha` | 下载文件 |
