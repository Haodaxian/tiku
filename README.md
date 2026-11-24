# 题库与讲义系统 · 源码工程

这套东西分两块：**源码**（这个文件夹）和**成品**（打出来的 exe）。
源码是原料，成品是发给老师的。老师只拿成品，你只改源码，改完重新打包即可。

- 项目位置：`E:\code\tiku-local\tiku-local`
- 技术栈：后端纯 Node（零第三方依赖，只用 `http/fs/zlib/crypto`）；前端 Vue 3 + Element Plus，全部本地化在 `public\vendor`，不联网
- 数据：单文件 JSON，不用数据库
- 模型：阶跃星辰，识图 `step-1o-turbo-vision`，文本 `step-3.5-flash`，写死在 `lib\config.js`

---

## 一、目录里都是什么

```
tiku-local\
├── 开发模式启动-Windows.bat     ← 双击就能跑源码（改代码时用这个）
├── 一键打包-Windows.bat         ← 双击就能打出给老师的包
├── server.js                    ← 后端入口：HTTP 服务、路由、启动/单实例
├── package.json                 ← 依赖与打包配置
├── electron-builder.json        ← Electron 桌面版的打包配置（Win / Mac）
├── app.ico                      ← 程序图标（红色底 + 白纸 + 「题」）
│
├── lib\
│   ├── config.js                ★ 模型、路径、端口相关的固定配置
│   ├── stepfun.js               ★ 阶跃星辰调用：提示词、超时、计费
│   ├── db.js                    ← 数据读写：db.json 原子写、每日备份、图片落盘、运行锁
│   ├── docx.js                  ← docx 解析 + 生成（导出试卷用）
│   ├── util.js                  ← JSON 抽取、mime、uid、富文本白名单、响应封装
│   └── zip.js                   ← 自写 zip（中文名不乱码、保留 0755 权限）
│
├── electron\                    ← Electron 桌面版（主进程 + 预加载）
│   ├── main.js                  ★ 启动内嵌服务、窗口、菜单、打印桥、数据目录
│   └── preload.js               ← 只把必要能力暴露给页面（contextBridge）
│
├── public\                      ← 前端（打包时会整体塞进 exe）
│   ├── index.html
│   ├── css\app.css
│   ├── js\                      ← api.js + app.js + 每个页面一个 view-*.js
│   │                              ＋ guide.js（指引引擎）、guide-data.js（指引文案）
│   ├── tpl\                     ← 每个页面一个 html 模板（改界面主要动这里）
│   ├── skills\tiku-json\        ← 题卡 Skill：外部智能体用它把材料转成题卡 JSON
│   └── vendor\                  ← vue / element-plus / icons / pdf.js（离线库）
│
├── tools\                       ← 构建与自测脚本
│   ├── build.js                 ★ 一键打包的总调度（win / mac / zip / all）
│   ├── build-package.js         ← 把 dist 里的程序压成发布 zip
│   ├── build-mac.sh             ← 在 Mac 上一键出 mac 包（只能在 macOS 上跑）
│   ├── build-skill.js           ← 打包题卡 Skill
│   ├── inject-icon.js           ← 给 exe 写图标和文件属性
│   ├── check-templates.mjs      ← 校验 12 个页面模板能否编译
│   ├── mock-llm.js              ← 本地假模型（7999 端口），不花额度测全链路
│   ├── make-test-bank.js        ← 生成各题型测试题库（带程序绘制的插图）
│   ├── png-draw.js              ← 零依赖 PNG 绘制器（画教学插图用）
│   ├── make-docx.js             ← 生成测试用 docx
│   ├── e2e\                     ← 端到端自测脚本（真模型 / 界面 / 打印）
│   └── pack.js                  ← 早期的源码压缩脚本（备用）
│
├── 测试材料\                     ← 测试用的试卷照片、PDF、示例题卡
│   └── 07-组卷测试题库.json      ← 41 道各题型测试题（11 道带图），可直接导入
│
├── node_modules\                ← npm install 装出来的依赖
├── dist\                        ← 打包产物 + 给老师的发布包（不进仓库）
└── data\                        ← 运行数据：db.json（含 API Key）、uploads、backup（不进仓库）
```

> **提交源码时注意**：`data\` 里有明文 API Key 和你自己的题库，`.gitignore` 已经把它排除了；
> `dist\`、`dist-electron\`、`node_modules\` 也都排除了。仓库里只留源码和测试素材。

---

## 二、改代码 → 看效果（开发模式）

### 最快的方式

双击 `开发模式启动-Windows.bat`，浏览器自动打开 `http://127.0.0.1:7788`。

| 你改了什么 | 怎么让它生效 |
|---|---|
| `public\tpl\*.html`、`public\js\*`、`public\css\*` | 存盘 → 浏览器 `Ctrl + F5`，**不用重启** |
| `server.js`、`lib\*.js` | 关掉黑窗口重新双击（后端代码只在启动时加载） |
| `app.ico` | 重新打包后才生效 |

### 命令行方式（更灵活）

```bat
cd /d E:\code\tiku-local\tiku-local
npm start                          :: 等价于 node server.js
set TIKU_PORT=7800 && npm start    :: 换端口，防止和成品程序抢 7788
set TIKU_DATA=.\data-test && npm start   :: 换数据目录，拿测试数据折腾不污染正式数据
node server.js --no-open           :: 不自动开浏览器
```

> 开发模式的 `data\` 就在项目里，**和打包后 exe 旁边的 `data\` 是两个独立目录**，互不影响。

### 不花 API 额度测全链路

```bat
:: 第一个窗口
node tools\mock-llm.js            :: 起一个假的阶跃星辰，端口 7999

:: 第二个窗口
set TIKU_PORT=7820 && node server.js --no-open

:: 第三个窗口：把程序指向假模型
curl -X POST http://127.0.0.1:7820/api/settings -H "Content-Type: application/json" -d "{\"apiKey\":\"test\",\"baseUrl\":\"http://127.0.0.1:7999/v1\"}"
```

之后识题、解题、讲义整理、费用统计全部能走通，一分钱不花。

### 题卡 Skill（不花平台额度，用外部智能体转题卡）

`public\skills\tiku-json\` 是一个可移植的 Skill 包，装在任意支持 skills 目录的智能体里（Claude Code、Cursor、自建 agent 都行），
让它把试卷 / 讲义整理成题库能直接导入的 JSON。老师的 token 花在自己的智能体上，不消耗平台的模型额度。

```
public\skills\tiku-json\
├── SKILL.md        Skill 定义：何时触发、字段规范、硬性规则、自检清单
├── SCHEMA.md       字段表 + 常见错误对照
├── example.json    可直接导入的样例（2 道题，含 1 道带图）
└── validate.mjs    零依赖自检脚本：node validate.mjs 题卡.json
```

- 界面入口：「导入 → 题卡 JSON」顶部有「下载 Skill 包」和「复制粘贴给智能体的话」，下载走 `GET /api/skill/tiku-json.zip`（运行时现打 zip，不写临时文件）。
- 改完 Skill 内容无需重新打包，重启程序即可；打包后 `public\**\*` 会整体进 exe。
- 图片限制：外部环境拿不到原图，所以 Skill 只输出 `[图1]` 占位 + `figures[].desc` 文字描述，不含 `bbox` / `url`；带图题目导入后到编辑抽屉里框选或上传补图。
- **题卡里 `figures[].url` 写 base64 的话，导入时会自动落盘，并把题干里的 `[图1]` 占位换成真正的内嵌图**（图会出现在题目原来的位置）。

### 组卷：从题库出一份像样的试卷

题库页勾选题目 → 点「生成试卷」→ 弹出**组卷设置**：

| 设置项 | 说明 |
|---|---|
| 试卷标题 / 学校 / 考试说明 | 印在卷首，例如「时间 90 分钟　满分 100 分」 |
| 考生信息 | 班级 / 姓名 / 学号 / 得分横线栏 |
| 注意事项 | 卷首下方的说明段落，内容可改 |
| 题型分区 | 按题型自动分大题：一、选择题　二、填空题　三、解答题　四、综合题 |
| 每题分值 | 选择题 / 填空题 / 解答题 / 综合题分别设分值，大题标题自动算总分 |
| 选择题排版 | 选择题区双栏，解答题区仍单栏 |
| 解答题留白 | 解答题下面留几行作答横线（选择和填空题不留，直接答在题旁） |

点「生成试卷」后进入**讲义排版页**，可以先看预览、改内容、再打印或另存为讲义。

### 测试题库（各题型 + 带图）
`tools\make-test-bank.js` 能生成一份 41 道题的测试题库（13 种题型，11 道带图），插图是程序画的（几何图、坐标图、电路图、光路图、杠杆图、统计图…），图文相符，不联网也能跑。

```bat
:: 预览题目清单（不入库）
node tools\make-test-bank.js --preview

:: 灌进正在运行的程序（端口按实际改；先起程序再执行）
node tools\make-test-bank.js --port=7788

:: 只导出成题卡 JSON（可从「导入 → 题卡 JSON」逐题导入，不会覆盖现有题库）
node tools\make-test-bank.js --export="测试材料\07-组卷测试题库.json" --export-only
```

现成的一份在 `测试材料\07-组卷测试题库.json`（41 道，11 道带图，base64 内嵌），用「导入 → 题卡 JSON」选它即可导入。

### 指引与帮助（内置的新手引导）

程序自带三层指引，老师不用翻文档：

| 入口 | 在哪 | 内容 |
|---|---|---|
| **新手引导** | 第一次打开自动出现（10 步），可跳过 | 从「拍张照录题」到「填 API Key」走通一遍，会自动跳到对应页面并高亮那个功能 |
| **页面说明** | 右上角 **?** 按钮，或按 `F1` | 当前页面是干什么的、有哪些功能区、怎么用、有哪些坑 |
| **使用指南** | 侧边栏最下方 | 总览：一条龙流程图 + 每个页面一句话 + 几条要紧的 |

- 每个页面的说明面板里还有「看这个页面的操作引导」按钮，走该页专属的分步引导。
- 设置页有「重看新手引导」，随时能再走一遍。
- 引导内容全部在 `public\js\guide-data.js` 里（纯数据，改文字不用碰逻辑）；引擎在 `public\js\guide.js`。
- 界面元素上的 `data-guide="xxx"` 是高亮锚点，新增功能时照着加一个即可被指引到。

---

## 三、打包（三种粒度的说法，其实是一件事）

### 两种打包方式，各有各的用处

| 方式 | 命令 | 产物 | 适合谁 |
|---|---|---|---|
| **pkg 单文件** | `npm run build:win` | `dist\题库与讲义系统-win.exe`（约 58MB） | 想要最小体积、双击就开、不装任何东西 |
| **Electron 桌面版** | `npm run build:electron` | `dist-electron\` 下的安装版 + 免安装版（各约 110～120MB） | 想要真正的桌面程序（有独立窗口、菜单栏、系统打印框） |

Electron 版只是给原来那套纯 Node 服务套了个桌面壳：

```
┌─────────────────────────────────────┐
│ Electron 主进程 (electron/main.js)   │
│   ├─ 启动 server.js（同一个 HTTP 服务）│
│   ├─ 窗口加载 http://127.0.0.1:7788  │
│   └─ 打印走 webContents.print()      │
└─────────────────────────────────────┘
```

前端一行代码都没改，两种方式跑的是同一套界面和数据。

**Electron 版的差异**

| | 说明 |
|---|---|
| 数据目录 | 优先放 exe 同级的 `data\`（免安装版最方便，也能和 pkg 版共用）；装到 Program Files 之类写不了的地方自动改存 `%APPDATA%\题库与讲义系统\data\` |
| 打印 | 走系统打印框（`文件 → 打印当前试卷` 或 `Ctrl+P`），不是浏览器打印预览 |
| 菜单栏 | 文件 / 编辑 / 视图 / 帮助；「文件 → 打开数据目录」直接打开题库文件夹 |
| 单实例 | 重复双击只会聚焦已有窗口，不会起第二份 |
| 体积 | 比 pkg 版大（Electron 自带 Chromium），换来独立窗口和原生体验 |

开发模式跑桌面版：

```bat
npm run electron          :: 用本机数据目录起一个桌面窗口
```

### pkg 单文件版（原有方式）


### 方式一：双击（推荐，pkg 单文件版）

双击 `一键打包-Windows.bat`，按提示选：

| 选项 | 干什么 | 耗时 |
|---|---|---|
| 1 | 只打 Windows（含图标） | 约 1 分钟 |
| 2 | 只打 Mac 两版 | 约 2 分钟 |
| 3 | Windows + Mac + 三个 zip | 约 3 分钟 |
| 4 | 只把现有程序重新压 zip | 几秒 |

**第一次打包会联网下载 ~50MB 的 Node 运行时并缓存到 `C:\Users\你\.pkg-cache`，之后离线也能打。**

### 方式二：npm 脚本

```bat
npm run build:win     :: = node tools/build.js win
npm run build:mac     :: = node tools/build.js mac
npm run zip           :: = node tools/build.js zip
npm run build         :: = node tools/build.js all
```

### 方式三：完全手动（想知道每一步在干嘛就看这个）

```bat
cd /d E:\code\tiku-local\tiku-local

:: 1) 打 Windows 程序
node node_modules\@yao-pkg\pkg\lib-es5\bin.js . --targets node22-win-x64 --output "dist\题库与讲义系统-win.exe"

:: 2) 写入图标（pkg 6 已删掉 --icon 参数，只能事后改 PE 资源）
node tools\inject-icon.js "dist\题库与讲义系统-win.exe"

:: 3) 打 Mac —— 必须在 macOS 上打（见下面「在 Mac 上打包」）
::    Windows 上打不了：pkg 会报 "only for 'win'"，electron-builder 会报 "supported only on macOS"

:: 4) 压成发布包
node tools\build-package.js
```

产物：`dist\题库与讲义系统-win.exe`（约 58MB）和 `dist\发布包\*.zip`（每个约 22MB）。

### 在 Mac 上打包

**mac 包只能在 macOS 上构建**，Windows / Linux 都会被工具链拒绝（这不是配置问题，是硬限制）：

| 工具 | 在 Windows 上打 mac 的结果 |
|---|---|
| pkg 6 | `Error! Not able to build for 'macos' here, only for 'win'` |
| electron-builder 26 | `Build for macOS is supported only on macOS` |

所以要出 mac 包，需要一台 Mac（自己的、或借一台、或用 CI 的 macOS 机器）。在 Mac 上：

```bash
cd 项目目录
chmod +x tools/build-mac.sh
./tools/build-mac.sh              # pkg 单文件版 + Electron 版 + 发布包
./tools/build-mac.sh arm64        # 只打 Apple 芯片
```

脚本会打三个东西：`dist\题库与讲义系统-mac-Apple芯片`、`dist\题库与讲义系统-mac-Intel`（pkg 单文件版）、`dist-electron\*.zip`（Electron 桌面版）、以及 `dist\发布包\*.zip`。

两个提醒：

- **Apple 芯片上未签名的程序会被系统直接杀掉**（提示"已损坏"）。pkg 版靠 `dist\启动-Mac.command` 做 ad-hoc 本地签名（分发时必须带上这个脚本）；Electron 版在 `electron-builder.json` 里已设 `"identity": null`，构建时会自动做本地签名。
- **Mac 包没法在这台 Windows 上实测**，只能验证构建成功和包内文件齐全。第一次发给 Mac 用户前，建议自己先跑一遍。

---

## 四、打包到底做了什么（去黑盒）

`pkg` 做的事只有一件：**把 Node 22 运行时和一个只读的文件快照拼成一个 exe**。

```
题库与讲义系统.exe
├── PE 头 + 图标 + 版本信息      ← inject-icon.js 改的部分
├── Node 22 运行时（约 50MB）    ← pkg 从 ~/.pkg-cache 里取
└── 快照（只读）
    ├── server.js
    ├── lib\*.js
    └── public\**               ← 由 package.json 的 pkg.assets 决定
```

运行时发生的事：

1. 双击 exe → Windows 加载它 → 里面的 Node 运行时启动
2. 程序从**自身内部**找到 `server.js` 并在内存里执行（**不读**你磁盘上的这个源码目录）
3. 它监听 `127.0.0.1:7788`，然后调系统命令打开浏览器
4. 浏览器请求页面 → 程序从**快照**里读 `public\*` 返回，所以断网也能开
5. 你的数据写在哪：`lib\config.js` 判断了 `process.pkg`，打包后数据目录 = **exe 所在文件夹\data**

所以：

- **改了源码，必须重新打包**，成品才会变；直接改磁盘上的源码或直接改 exe 都不会生效
- **只改前端时**，如果想偷懒不重新打包，可以改完 `public` 后用 `node tools\build.js zip` 之外的办法——实际上做不到，快照是封死的；老老实实重打包，1 分钟
- 老师那边要备份/搬家，只需拷 **exe + data 目录** 两样

### 单实例保护

两道锁，防止两个进程同时写 `db.json`（后写的整库快照会把先写的数据覆盖掉）：

1. **运行锁文件**：数据目录下有 `app.lock`，记录着正在运行的进程号。启动时如果发现锁里的进程还活着，就直接退出（并帮你打开已有实例的页面），绝不起第二个。
2. **端口探测**：端口被占用时请求 `http://127.0.0.1:端口/api/ping`，通了说明是本程序在跑，只开浏览器然后退出。

进程正常退出时会删掉自己的锁；异常退出留下的残留锁，会在下次启动时因「进程号已不存在」被自动覆盖，不影响使用。

### 端口

默认 7788，被占用会自动往后试到 7798（再被占用就提示启动失败）。想固定换端口：`set TIKU_PORT=7900` 后再启动（对 exe 同样有效，但老师不会去设）。

---

## 五、常见改动手册

| 我想改 | 改哪里 | 要重新打包吗 |
|---|---|---|
| 换模型 | `lib\config.js` 的 `VISION_MODEL` / `TEXT_MODEL`，同步改 `MODEL_LABELS` 里显示的名字 | 要 |
| 识题/解题/讲义的提示词 | `lib\stepfun.js` 里的 `RECOGNIZE_SYSTEM`、`recognizePrompt()`、`recognize()`、`solve()`、`organizeLecture()`（提示词就写在这几个函数里，没有单独的常量） | 要 |
| 超时、并发、压缩图片 | 超时看 `lib\stepfun.js` 的 `timeout`；并发看 `public\js\api.js` 的 `TK.pool`；压缩看 `downscaleImage` 里的 1400px / 0.82 | 要 |
| 单次最大输出 | `lib\stepfun.js` 里的 `maxTokens`（单题识别 2048 / 整页 4096 / 文本拆题 8192 / 举一反三 4096 / 解题 1024 / 讲义 8192） | 要 |
| 界面文字、布局 | `public\tpl\*.html`（结构）+ 对应 `public\js\view-*.js`（逻辑） | 要 |
| 颜色、字体、间距 | `public\css\app.css` | 要 |
| 菜单项与顺序 | `public\js\app.js` 里的菜单数组 | 要 |
| 组卷的题型分组（哪几种题算"选择题"、各组默认分值） | `public\js\app.js` 里的 `TYPE_GROUPS` | 要 |
| 系统支持的题型清单 | `public\js\api.js` / `qedit.js` / `view-bank.js` 里的 `types` 数组（三处要一致），另有 `public\skills\tiku-json\validate.mjs` | 要 |
| 程序名 / 图标 / 文件属性 | 图标 `app.ico`；名字在 `tools\inject-icon.js` 的 `ProductName`（pkg 版）、`electron-builder.json` 的 `productName`（Electron 版） | 要 |
| 桌面版菜单、窗口、打印桥 | `electron\main.js`（菜单、窗口、IPC）+ `electron\preload.js`（暴露给页面的能力） | 要（Electron 版） |
| 指引文案（引导步骤、页面说明） | `public\js\guide-data.js`（纯数据，改文字不用碰逻辑） | 要 |
| 指引引擎（高亮、气泡、定位） | `public\js\guide.js` | 要 |
| 费用价目表 | `lib\stepfun.js` 的 `PRICES` + `public\js\view-stats.js` 的 `priceRows` | 要 |
| 默认端口 | `server.js` 的 `PORT_START` | 要 |
| 增删接口 | `server.js` 里的 `route('POST', /^\/api\/xxx$/, ...)` | 要 |

改完记得跑一遍模板校验（模板写错会白屏，这个脚本能提前发现）：

```bat
npm run check
```

---

## 六、踩过的坑（重打包前值得看一眼）

1. **mac 包必须在 macOS 上打**。pkg 会直接报 `Not able to build for 'macos' here, only for 'win'`，electron-builder 报 `Build for macOS is supported only on macOS`。用 `tools\build-mac.sh`（要在 Mac 上跑）。
2. **pkg 6 已经没有 `--icon` 参数**。图标只能事后用 `resedit` 改 PE 资源里 `RT_GROUP_ICON` 组 1，顺带改版本信息（`tools\inject-icon.js` 干的就是这个）。
3. **打包后 `__dirname` 指向只读快照**，往里写文件会失败。所有可写路径都走 `lib\config.js` 的 `DATA_DIR`。
4. **快照上 `createReadStream` 不可靠**，静态资源改成 `readFileSync` 整块返回 + 内存缓存。
5. **Apple 芯片不加签名会被内核直接杀掉**（提示"已损坏"）。`启动-Mac.command` 里做了 `codesign --sign -` 本地签名（ad-hoc），所以分发时必须带上这个脚本。
6. **zip 里的中文名**要用 UTF-8 通用标志位（bit 11），否则 Windows 自带解压会乱码 → `tools\zip.js` 已处理。
7. **Mac 的 `.command` 必须是 LF 换行 + 0755 权限**，`tools\zip.js` 里用 `mode: 0o100755` 写进压缩包。
8. **`.bat` 必须是 CRLF + `chcp 65001`**，否则中文提示全是乱码。
9. **前端模板改动后如果整个页面空白**，先跑 `npm run check`，再看浏览器 F12 Console —— 大概率是模板里用了没在 `setup()` 返回的变量。
10. **杀毒软件可能误报**：pkg 打的包是"自解压+自执行"形态，360/火绒偶尔报毒。发给老师前可以先用 Windows Defender 扫一遍，必要时加白名单或做代码签名证书。
11. **覆盖层的层级必须写死**。指引的遮罩和气泡如果靠"谁先插入 DOM 谁在下"来决定叠放顺序，插入顺序一变就出两种事故：遮罩盖住气泡 → 按钮点不动；遮罩没被清理 → 面板关了但整个程序点不动。现在 `.tk-guide-mask / .tk-guide-hl / .tk-guide-bubble / .tk-guide-close` 都写死了 z-index（1/2/3/4），帮助面板的遮罩在关闭时必须和面板一起 `remove()`。
12. **测"能不能点到"不能用 `element.click()`**。那是直接派发事件、绕过命中检测的，遮罩挡着也会"通过"。要用真实鼠标点击，或用 `document.elementFromPoint()` 看那个点上到底是哪个元素——只有它返回目标元素，才说明真的点得到。
13. **提示气泡的 z-index 要比覆盖层高，或者延后弹**。Element Plus 的消息提示是 2000 上下，指引遮罩是 30000，两者同时出现时提示会被完全盖住。所以引导期间不弹"请填 API Key"这类提示，改成引导结束后再弹（`TKGuide.onTourEnd`）。

---

## 七、数据和备份

| 内容 | 位置（开发模式） | 位置（成品程序） |
|---|---|---|
| 题库、讲义、设置、用量 | `data\db.json` | `exe 同级\data\db.json` |
| 题目配图 | `data\uploads\` | `exe 同级\data\uploads\` |
| 每日自动备份（留 7 天） | `data\backup\` | `exe 同级\data\backup\` |
| 运行锁（防止两个实例同时写库） | `data\app.lock` | `exe 同级\data\app.lock` |

- API Key 存在 `db.json` 的 `settings.apiKey` 里，**明文**。这台电脑只有你用，够用；如果以后给全校老师用，建议改成每人各填各的 Key，或者做一个统一代理服务（那时候就不该用本地版形态了）。
- 想去掉 Key：设置页点「清除」，或直接删 `data\db.json`（会连题库一起没）。
- 手动备份：把整个 `data` 文件夹复制走就行，几条命令的事。
- **数据文件损坏时不会丢数据**：`db.json` 一旦解析失败，程序会把原始内容原样另存为 `db.json.broken-<时间戳>`，同时在界面上弹红色告警提示「去设置页从备份恢复」，绝不会拿空库把原文件覆盖掉。恢复办法：把那个 `.broken-` 文件改名回 `db.json`，或在设置页「从备份恢复」导入最近的备份。

---

## 八、v1.3 修了什么（给老师看的一页纸）

**打印（原来最要命的几处）**

- 题库勾题点「生成试卷」，打印出来**以前是整个题库界面**，现在只有试卷
- 讲义打印**丢了「年级 · 学科」副标题**，现在和屏幕预览一致
- 超过一页时，**第 2 页起的内容顶在纸张边缘**，现在每页都有正常的上下边距
- 作文格一行格子太多时**右侧被裁掉**，现在自动按版心宽度收缩

**数据安全**

- `db.json` 一旦损坏，原来会**静默拿空库覆盖原文件**（题库凭空消失且找不到原因）；现在原文件完整留成 `.broken-` 备份，界面弹红色告警指引恢复
- 存盘前会真正落盘（fsync），断电不再留下 0 字节的坏文件
- 从备份恢复时，题目富文本会重新过一遍白名单，**别人给的备份文件里藏的脚本不会再被执行**
- 每日备份改用本地日期（原来用 UTC，本地凌晨启动当天反而没有备份），程序一直开着跨天也会自动补备份

**稳定性**

- 畸形地址（如 `/%zz`）和直接访问图片目录会让请求**永久卡死**，浏览器一直转圈 —— 已修复
- 重复双击现在用**运行锁文件**判定，不再只看端口，避免两个进程同时写数据互相覆盖
- 导入 docx 加了解压上限，构造的压缩包不会再把程序内存打爆、直接退出
- 模型服务地址必须是 https（http 会把 API Key 明文发出去），本机地址除外
- 网络抖动不再无条件重试（原来会重复计费），也不再把原始错误吞掉

**编辑与题库**

- 编辑器里 A+/A- 调字号，**保存后会被还原**，现在字号保留
- 文本处理「整段一键整理」会**把题干里的图全清掉**，现在图会留在原位
- 要点块的编辑框**永远是空的、改了就丢**，现在能正常编辑
- 图形库里「删」只删列表、题干里的图还在，现在两处一起删
- 打开编辑抽屉就显示「有未保存的修改」，现在改过才算
- 删完最后一页的题，列表会一片空白且页码越界，现在自动回到有效页
- 纯图片的题目会被当成空题丢掉、界面却提示「已新增」，现在能正常保存且提示真实结果
- 题库能挂到自己的下级里形成环，成环后那两个题库在界面上**彻底消失**，现在直接拒绝

**补上的功能**

- 设置页的「默认分栏」以前**写了没人读**，现在新建讲义时真的按它来
- 设置页补上「清除」按钮（README 早就写了，实际没有）
- 讲义里可以手动加「公式 / 例题 / 作文格」内容块（以前只能靠 AI 生成）
- 启动时先显示「正在读取本地题库」，不再一闪而过「题库是空的」
- 试卷导入页拖进来非图片文件会明确提示，不再默默丢掉

---

## 九、发版检查清单

- [ ] `npm run check` 通过
- [ ] 开发模式点一遍：录题、解题、讲义、导出、设置页保存
- [ ] 打印验证：题库勾几道题点「生成试卷」，打印预览里应当**只有纸面**，不是题库界面；讲义页打印应当带上「年级 · 学科」副标题；超过一页时第 2 页起也要有上下页边距
- [ ] `npm run build:win`（单文件版）
- [ ] `npm run build:electron`（桌面版：安装版 + 免安装版）
- [ ] 把新 exe 拷到一个**干净的空文件夹**，双击起来点几个页面（确认不是靠 `data` 里残留的东西正常）
- [ ] 看 exe 图标是不是「题」字图标
- [ ] 打包后 `dist\发布包\` 里的 zip 解压一次，直接双击确认可用
- [ ] 桌面版：免安装版跑一次，确认 `data\` 生成在 exe 旁边（不是临时目录里）
- [ ] 版本号：`package.json` 的 `version`，`tools\inject-icon.js` 的文件属性、`electron-builder.json` 的 `productName`（要一致）
