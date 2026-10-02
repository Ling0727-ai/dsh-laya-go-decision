# dsh-laya-go-decision

[Laya Go Launcher](https://github.com/Ling0727-ai/Laya-Go-Launcher) 的 DeepSeek Harness 后台决策插件：由插件在后台托管 `layatrt-server.exe`，把它的结构化决策接口（`choice` / `score` / `noul`）注册成模型工具，**不打开任何窗口、不搬推理层**。

> 本插件对应的是 **Laya Go Launcher**（Go 实现），不是原版 Laya 的官方插件。仓库与包名都保留 `Go` 标识来源，避免被理解为原版插件。

## 它做什么

| 职责 | 实现 |
|---|---|
| 后台启动与托管 | 通过 `ctx.subprocess` 启动 `layatrt-server.exe`；Windows 走 Job 对象、Linux 走 user-systemd scope，插件卸载时整棵进程范围一起终止 |
| 就绪判定 | 启动后轮询 `/api/v1/load` 直到 `phase: ready`；`failed` 立刻带回退链原因返回，不会干等到超时 |
| 决策调用 | `POST /api/v1/predict`，一次请求提交多个问题（共享一次前向） |
| 模型接口 | `laya_go_decide`、`laya_go_status`、`laya_go_server` 三个工具 + `ctx.layaGoDecision` 服务 |
| 多会话复用 | 先探测端口：已有 Laya 服务就**领用**（adopt），不会为了抢端口再起一个进程、也不会重复加载模型 |

它**不做**的事：重新实现推理、模型选择或 TensorRT 回退链（那是 Launcher 的职责）；替代主模型做开放式规划、写代码、解释推理；替代 DSH 的审批与 sandbox 检查（Laya 只能给建议，不承担授权）。

## 环境要求

- DeepSeek Harness（`@deepseek-ai/cordis` ≥ 4.0.0、`@deepseek-ai/dsh-tools` ≥ 0.1.6-alpha.2）；插件是**宿主侧（host-plane）**插件，注册的工具对所有会话可见。
- 一份已构建的 Laya Go Launcher：`layatrt-server.exe`（或 `go build -o layatrt-server.exe ./cmd/layatrt-server`）以及可用的模型文件。
- Node.js ≥ 20（插件使用全局 `fetch` 与 `AbortSignal.any`）。
- **本仓库不包含、也不打包任何 Laya 二进制、DLL 或模型文件**（见「许可证与分发」）。

## 安装

```powershell
# 1. 构建插件自身的 lib/（linked checkout 不会自动构建）
cd C:\Users\lingxin\Desktop\dsh-plugin\dsh-laya-go-decision
pnpm install
pnpm build

# 2. 装进某个 profile（示例用 desktop）
dsh plugin --profile desktop add C:\Users\lingxin\Desktop\dsh-plugin\dsh-laya-go-decision

# 3. 不启动、只验证这一层已经合入
dsh --profile desktop --dump-config     # 应出现 "# == dsh-laya-go-decision" 层与 laya-go-decision 行
```

装好后重启 DSH，`laya_go_decide` / `laya_go_status` / `laya_go_server` 即可用。
卸载：`dsh plugin --profile desktop remove dsh-laya-go-decision`。

插件包声明了 `dsh.bundle.patch`，所以 `dsh plugin add` 会把它同时写进 `dsh.profile.bundles` 并激活 `cordis.patch.yml` 这一层。

## 配套 Skill

仓库自带一份面向 Agent 的使用手册：[skills/laya-go-decision/SKILL.md](skills/laya-go-decision/SKILL.md)。工具 schema 只说明「怎么调」，这份 Skill 说明「什么时候值得调、怎么问才问得准、答案怎么读」——包括三种题型的写法与边界描述、`confidence`（归一化熵）与 `certain` 的区别、`noul` 要读方向而不是只看 confidence、整批都不确定时该怀疑输入、`state` 从右侧截断的应对，以及失败码对应的动作。它同时写明了那条最重要的限制：当前 checkpoint 是英文的，中文 `choice` 可能塌成近似均匀分布。

安装（链接方式接入，不复制，`git pull` 即更新）：

```powershell
pnpm run install:skill            # 默认写入 ~/.dsh/skills，可用 DSH_SKILLS_DIR 覆盖
```

目标位置已存在同名**普通目录**时脚本会拒绝替换；已存在的链接只有在指向本仓库时才会被重建。移除时删掉 `~/.dsh/skills/laya-go-decision` 这个链接即可。

## 设置界面

插件自带一个设置页，用来改最常配错的三项——**启动器路径**、工作目录、服务地址——不用去手写 YAML：

**设置 → 插件（Plugins）→ `dsh-laya-go-decision` → 该行的「配置」**

| 字段 | 写入的 config 键 | 留空表示 |
|---|---|---|
| 启动器路径 | `executable` | 回退到出厂默认（PATH 中的 `layatrt-server.exe`） |
| 工作目录 | `serverCwd` | 使用 DSH 进程目录 |
| 服务地址 | `baseUrl` | `http://127.0.0.1:8420` |

- **保存**通过 Plugins 页的 `plugins.row.config` 通道写进 profile 的 `cordis.patch.yml`——和手写的是同一份文档，所以手改与界面改不会各说一套。
- **保存后会重新加载这一行**：正在运行的 launcher 会用新配置重启，旧进程由插件的 effect 收掉，不残留（换 exe 路径时这正是想要的行为）。
- **恢复默认** = `unset` 这几个键，回到随插件发布的默认值。
- 这三个字段是 DSH 的 **volatile 配置**：保存后不需要重新安装插件；Host 先终止旧 launcher，再把同一个工具服务切换到新路径/地址，下一次调用直接使用新配置。
- Host 不可写（配置不落盘的 memory 模式）时表单整体禁用。

浏览器半侧是在 DSH 启动时随其他客户端插件一起扫描进启动图的，因此**装好或改完 `dsh.client` 后需要重启 DSH** 才会出现这个设置页；`lib/client.js` 已经随包提交，`link:` 安装无需重新构建。

## 配置

所有可调项都在插件行里，默认值写在 schemastery schema 中；override 时**整行 config 会被替换**，因此要重述保留的键。

覆盖示例（profile 自己的 `cordis.patch.yml`，或 `--patch` overlay）：

```yaml
- id: laya-go-decision
  name: dsh-laya-go-decision
  config:
    mode: managed
    baseUrl: http://127.0.0.1:8420
    executable: C:\Users\me\laya-go-launcher\layatrt-server.exe
    serverCwd: C:\Users\me\laya-go-launcher
    args:
      - --no-convert
      - --engine
      - C:\Users\me\laya-go-launcher\engines\laya_s8192_fp16_p2.engine
    autoStart: true
    startTimeoutMs: 180000
    requestTimeoutMs: 15000
    confidenceThreshold: 0.5
    adminToken: my-admin-token
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `mode` | `managed` | `managed` 由插件启动/停止 Launcher；`external` 只连接用户自己启动的服务，绝不拉起进程 |
| `baseUrl` | `http://127.0.0.1:8420` | API 源（可带路径前缀，结尾的 `/api/v1` 会被去掉）。`managed` 模式下 `--addr` 由它推导 |
| `executable` | `layatrt-server.exe` | 绝对路径，或交给 PATH 解析的裸名字（相对路径含分隔符会被 provider 拒绝） |
| `args` | `[]` | Launcher 参数；若其中已有 `--addr`，则不再由 `baseUrl` 推导 |
| `serverCwd` | 未设置 | Launcher 工作目录（默认取 harness 进程目录）；模型目录/`layatrt.config.json` 按 Launcher 自己的发现规则解析，建议显式指定 |
| `env` | `{}` | 追加到 Launcher 进程的环境变量（在 harness 凭据清理**之后**合并） |
| `autoStart` | `true` | 首次决策时自动启动；插件**加载时不会**启动任何进程 |
| `startTimeoutMs` | `180000` | 启动并等到模型就绪的上限 |
| `loadIdleGraceMs` | `15000` | 端口已监听但迟迟不开始加载模型时，多久后报 `not_ready`（例如用了 `--no-load`） |
| `readyPollMs` | `500` | 就绪轮询间隔 |
| `requestTimeoutMs` | `15000` | 单次 API 请求超时 |
| `shutdownGraceMs` | `10000` | 终止 Launcher 时交给 subprocess provider 的宽限期 |
| `maxConcurrent` | `2` | 同时在飞的预测请求数，超出排队（精确计数信号量） |
| `maxQuestions` | `16` | 一次决策的问题数上限 |
| `maxStateChars` | `20000` | `state` 字符上限；**超出直接报错**，不做静默截断 |
| `confidenceThreshold` | `0.5` | 达到该 confidence 才标记 `certain` |
| `adminToken` | 未设置 | Launcher admin 端点的 Bearer token（仅用于需要鉴权的调用） |
| `logBytes` | `16384` | 保留的 Launcher stdout/stderr 字节数，用于失败诊断（退出原因会带上 stderr 尾部） |

## 工具

### `laya_go_decide`

对一段文本（`state`）一次前向回答多个类型化问题。题型的 `criteria` 形状就是 Laya 的契约：

```jsonc
{
  "state": "Subject: Duplicate charge on invoice #4411. We were billed twice for March. Please refund today.",
  "questions": [
    { "id": "department", "type": "choice", "instructions": "Which team should handle this?",
      "criteria": { "billing": "invoices, payments, refunds", "technical": "bugs, outages", "sales": "pricing" } },
    { "id": "urgency", "type": "score", "instructions": "How urgent is this?",
      "criteria": ["not urgent", "soon", "critical deadline"] },
    { "id": "churn_risk", "type": "noul", "instructions": "Does the user threaten to cancel?" }
  ]
}
```

规范化返回：每个问题的 `choice` / `score` + `legend` / `noul`、`probabilities`、`confidence`、`certain`，加 `uncertain` 列表、`usage`、`timing`、`server`（mode / baseUrl / 本次是否启动 / 是否领用）与 `warnings`。

`confidence` 是归一化熵，**不是正确率**：`certain: false` 表示这个答案该由主模型自己判断或补上下文，而不是照抄标签。

### `laya_go_status`

只读：服务是否应答、加载了哪个模型/内核/设备、最近一次 load 的每个回退尝试与失败原因、预测次数与延迟分位。服务不可达是一种正常结果（`reachable: false` + 可操作提示），不抛错。

### `laya_go_server`

`start` / `stop` / `restart`：

- `start`：立刻把服务弄到就绪——`managed` 模式启动配置的 exe，已有服务则领用（不会起第二个）；
- `stop`：只终止**本插件启动**的进程；若端口上跑着别人的 Launcher，会明确拒绝（`server_not_managed`）；
- `restart`：停止再启动同一个自有进程。`external` 模式下不会启动任何东西。

## 服务 API

其它插件可以注入 `layaGoDecision`：

```ts
export const inject = ['layaGoDecision']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.layaGoDecision.decide('...', [
    { id: 'intent', type: 'choice', instructions: 'What does the user want?',
      criteria: { question: 'asks something', command: 'asks for an action' } },
  ]).then(result => ctx.logger.info(JSON.stringify(result.uncertain))))
}
```

方法：`decide(state, questions, signal?)`、`status(signal?)`、`startServer(signal?)`、`stopServer(signal?)`、`dispose()`。

## 生命周期与运行语义

- **加载不启动进程。** 只有首次决策（`autoStart`）或显式 `laya_go_server start` 才会启动 Launcher。这样不会因为装了个插件就默默吃掉显存、也不会突然开始长时间 TensorRT 构建。
- **就绪 ≠ 端口活着。** Launcher 先监听、后加载模型，因此 `GET /health` 返回 200 只说明进程起来了；插件会一直轮询 `/load` 到 `ready`。
- **领用优先。** 探测到端口上已有 Laya 服务就直接用（`adopted: true`），不抢占、不重复加载；`stop` 永远不会杀掉领用的服务。多个 DSH 会话因此共享同一份已加载模型。
- **端口被别的服务占用**会明确报告 `start_failed`（而不是硬起一个必然因端口占用而退出的进程）。
- **超时与中止**区分开：调用方中止 → `aborted`；超过 `requestTimeoutMs` / `startTimeoutMs` → `timeout` / `start_timeout`。
- **卸载与热替换**：Launcher 进程是 `ctx.effect` 里的资源，插件卸载（或配置热替换）时通过 `ctx.subprocess` 终止自有进程范围并等待停稳，不留残留进程。
- **工具调用留档**：走 DSH 正常的 `tool/call`、`tool/result`，可在会话日志回放。

## 已知限制

1. **中文能力未经验证。** 当前 checkpoint 面向英文（Laya 自身的说明），接口接受中文不代表效果可用；中文场景需要代表性样本先评测。
2. **`confidence` 不是正确率。** 它是归一化熵（`choice`/`score`）与概率本身（`noul`），阈值要按任务验证。插件把它翻译成 `certain` / `uncertain` 只是提示，最终判断权仍在主模型。
3. **`state` 会被 Launcher 从右侧截断。** 因此插件在超过 `maxStateChars` 时报 `state_too_large` 而不是静默丢信息——请先摘要，而不是把长转录丢进来。8192 的引擎容量也不等于同长度的可靠决策能力。
4. **Laya 不承担授权。** 它可以给风险建议，但不能替代 DSH 的审批、sandbox 与权限预设。
5. **服务默认只监听 loopback。** 改 `--addr 0.0.0.0:8420` 会把推理接口暴露到局域网；`adminToken` 也只覆盖 mutating 端点，不是全 API 鉴权。
6. **DSH 接口兼容范围**：`@deepseek-ai/cordis` ≥ 4.0.0、`@deepseek-ai/dsh-tools` ≥ 0.1.6-alpha.2、`@deepseek-ai/dsh-subprocess` ≥ 0.1.6-alpha.2（可选 peer）。升级 DSH 后请重新执行 `pnpm typecheck && pnpm test`，不要假定源码 checkout 与实际安装版本一致。
7. **`external` 模式不做进程管理**：卸载时不会（也不该）停止你自己启动的服务。

## 许可证与分发

本插件代码为 MIT。但 **Laya-Go-Launcher 自身限制产品集成与再分发**，所以：

- 本仓库不分发 `layatrt-server.exe`、ONNX/TensorRT 运行库、模型文件；
- 第一版按「引用本地安装」使用：`executable` 指向你本机已构建的 Launcher；
- 公开发布或产品化之前，请先确认 Laya-Go-Launcher 的授权条款。

## 开发

```powershell
pnpm install
pnpm typecheck     # tsc --noEmit，宿主半侧与浏览器半侧分别用 tsconfig.json / tsconfig.client.json
pnpm build         # tsc 产出宿主半侧（lib/index.js + lib/host/* + .d.ts）；tsdown 产出 lib/client.js
pnpm test          # node --test：52 个用例（含浏览器 bundle 的模块契约）
pnpm check         # typecheck + build + test
```

`lib/` 是**提交进仓库的构建产物**（与本目录其他 DSH 插件一致），这样 `link:` 与 `github:` 安装都能直接解析到入口；因此改完 `src/` 必须重新 `pnpm build` 再提交，避免产物与源码漂移。

两个半侧的构建归属是明确的，避免两个工具写同一个文件：

- **宿主半侧归 `tsc`**：`lib/index.js`、`lib/host/*`，以及 `exports.types` 指向的声明文件。因此 `tsconfig.build.json` 只包含宿主入口。
- **浏览器半侧归 `tsdown`**：`lib/client.js` 是客户端模块系统的 lazy-CJS factory（`window.__ModuleLoader__.load({ id, factory })`），由 `scripts/build-client.mjs` 调用 harness 里的共享预设生成——那个预设不在任何已发布的 npm 包里，所以这一步只能在有 `deepseek-harness` checkout 的机器上跑，产物随仓库提交。`prepare` 只构建宿主半侧，因此消费者从 git 安装也能正常工作，不会去跑一个本机无法满足的客户端构建。

测试用真实的 `node:http` 假 Launcher 与 `ctx.subprocess` 替身覆盖：协议解析与错误映射、超时/中止、领用与停止拒绝、就绪/失败/空闲/超时四种启动结局、进程提前退出并带 stderr 诊断、并发上限、状态大小与题型校验、卸载无残留。

对一个真实安装做端到端验证（会真的加载模型、占用显存，结束时终止进程）：

```powershell
node scripts/smoke.mjs --server C:\Users\lingxin\Documents\laya-trt\layatrt-server.exe --timeout 240000
```

本仓库最后一次真实运行结果：TensorRT 引擎 `laya_s8192_fp16_p2.engine` 加载成功，一次三问决策 57 ms，`department=billing`（p=0.955）、`urgency=1.28`（`certain: false`）、`churn_risk=0.099`，随后 `stop` 终止进程且无残留。

## 目录结构

```
src/
├── index.ts               # 插件入口：name / inject / Config / apply
├── client/index.ts        # 浏览器半侧：本行配置页（plugins.row.config）
└── host/
    ├── config.ts          # Config schema、归一化、--addr 推导
    ├── errors.ts          # LayaGoError 与稳定错误码
    ├── protocol.ts        # Laya HTTP 契约类型与容错解析
    ├── client.ts          # fetch 客户端：超时、中止、错误映射、探测
    ├── supervisor.ts      # 受管进程：启动/领用/就绪/终止
    ├── service.ts         # ctx.layaGoDecision：校验、并发、决策与状态
    └── tools/             # 三个模型工具
skills/laya-go-decision/   # 面向 Agent 的配套 Skill
tests/                     # node --test（假 Launcher + 假 subprocess + 浏览器 bundle 契约）
scripts/smoke.mjs          # 对真实 Launcher 的端到端脚本
scripts/install-skill.mjs  # 把配套 Skill 链接进 ~/.dsh/skills
scripts/build-client.mjs   # 用 harness 的共享预设构建 lib/client.js
tsdown.config.ts           # 客户端构建配置（只保留浏览器半侧）
tsconfig.client.json       # 浏览器半侧的 typecheck（带 DOM lib）
```
