# SubLang Skill

一个与 SPEX 共用工作流和配置的 Skill，面向 Codex 与 Claude Code。支持市场包搜索、指定包安装、Playbook 查看和执行、会话继续，以及自定义流程的创建、编译和注册。

## 安装与准备

本仓库包含可独立使用的 Skill、锁定依赖和 SPEX 运行包，不需要克隆 SPEX 源码或启动 App。

```sh
git clone https://github.com/yangbobo2021/sublang-skill.git ~/.codex/skills/sublang
sh ~/.codex/skills/sublang/scripts/setup.sh
```

Windows 可将仓库克隆到用户目录下的 `.codex\skills\sublang`，然后执行：

```powershell
$prepared = powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME\.codex\skills\sublang\scripts\setup.ps1" | ConvertFrom-Json
& $prepared.node $prepared.cli help
```

初始化会复用兼容的 Node/npm，或下载固定版本到用户缓存，再按锁定文件安装运行依赖。首次准备需要网络；Git、项目工具和 Agent 登录仍由用户环境提供。

默认安装目录可直接被 Codex 发现。Claude Code 可使用同一份目录；从另一个克隆位置执行 `node scripts/install.mjs` 会安装到 Codex 目录并创建 Claude 入口，Windows 使用目录 junction。已有 Git 工作副本通过 Git 更新，安装器不会移动或备份它。

直接克隆到默认目录后，Claude 的共享入口可按平台建立；已有入口时先检查，以下命令不会覆盖它。

```sh
mkdir -p ~/.claude/skills
ln -s ~/.codex/skills/sublang ~/.claude/skills/sublang
```

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
New-Item -ItemType Junction -Path "$HOME\.claude\skills\sublang" -Target "$HOME\.codex\skills\sublang"
```

## 使用

```text
$sublang 搜索 SPEX 市场中与 SPEC 抽取相关的 PACKAGE。
$sublang 将指定版本的 PLAYBOOK 包安装到当前项目。
$sublang 查看指定包的工作流，并按我的请求执行。
```

首次实际请求会按调用宿主初始化：Codex 使用 Codex，Claude Code 使用 Claude。能可靠取得当前会话模型时采用该模型，否则分别默认 `gpt-6.1-sol` / `claude-opus-5-5`。Captain、所有 Player 和角色模型保持一致；以后不随宿主、模型选择或凭据变化重设，新 Player 继承配置。用户可通过 Skill 明确要求重新配置。宿主登录不被修改。

完整说明：[SKILL.md](SKILL.md)、[Agent 初始化与修改](references/agents.md)、[包管理和流程创作](references/authoring.md)、[执行和恢复](references/execution.md)。

## 版本维护

本仓库直接维护可安装的 Skill。修改运行文件后刷新完整性清单，再验证、提交；日常版本变化使用 Git，不创建备份文件夹。

```sh
node scripts/update-release.mjs
sh scripts/setup.sh
git diff
git add SKILL.md agents references scripts runtime
git commit -m "Describe the skill change"
git push
```

Windows 用 `scripts/setup.ps1` 代替 Shell 初始化。发布新版本时可使用 `node scripts/update-release.mjs --version 1.0.1`，检查后提交并创建对应 Git tag；此命令本身不会发布或推送。

从远端更新使用 `git pull --ff-only`。保留用户未提交内容；回退共享历史优先使用 `git revert`。

`runtime/vendor` 保存当前锁定的 SPEX CLI/Core 运行包，来源由 `runtime/release.json` 记录。需要更新运行包时，使用本仓库 `scripts/build-runtime.mjs --repository <本地 SPEX Git 仓库>`，从 `runtime/source.json` 固定的上游提交加公开源码补丁统一重建 CLI、Core 和内置内容；不得只替换其中一个压缩包。组件关系、实际解析诊断和重建步骤见 [运行时说明](references/runtime.md)。

## 验证边界

2026-11-04：13 项 macOS 集成、独立分发与 Windows 路径模拟测试通过；PowerShell 语法检查通过。[公开仓库 CI](https://github.com/yangbobo2021/sublang-skill/actions/runs/41826418646) 已在 macOS 和 Windows 完成独立初始化、CLI help、Core 项目登记及目录发现冒烟检查。

这些基础检查没有执行 extract-specs、decide、code 或 acceptance-orchestrate。四工作流交付验收由操作者按[12 步手动操作文档](https://github.com/yangbobo2021/skills-acceptance-demo/blob/main/MANUAL-ACCEPTANCE.md)逐步触发，不放进 CI；真实模型、人工 Gate 和完整工作流结果须另外取证。Windows 客户端按用户要求不新增所有者、私有权限或 DACL 检查。

v1.0.2 增加执行前 `preflight`，修复 v1.0.1 在 settings 预检查时把未初始化误当成配置冲突而停下的问题。未初始化时的 settings 不启动 Core、不生成 Claude 默认配置；首次业务调用由 Skill 自动准备，再核对设置。升级现有安装后，历史会话仍保留原 Agent 快照；新会话使用初始化后的配置。

v1.0.3 将 npm 运行时 `@sublang/playbook` 精确升级到 `18.1.4`，锁文件和分发清单同步更新。该版本当时保留了旧 Core，所以内置 SPEX 内容包仍由 Playbook 18.1.3 生成；npm 引擎升级没有同步重建内置内容，此问题由 v1.0.5 修复。

v1.0.4 将 SPEX 上游 `420aba7b` 的 Windows 存储修复重新打包进 `runtime/vendor/spex-cli.tgz`，Core 复用这份文件/环境库：普通已有目录与包安装目标不再因只读授权被拒绝；依赖完整性的租约等位置仍拒绝其他主体可修改的记录。`release.json.artifactSources` 记录两个运行包各自的来源，CLI 版本号仍为 5.0.0，须按 Skill 标签和制品哈希识别修复。新增真实 package-add 的 Windows ACL 回归；只安装测试 Playbook，不执行工作流。

v1.0.5 将 CLI、Core、内置内容由同一固定源码树和锁文件统一重建，两个压缩包均携带相同构建记录。npm Playbook 与生成的内置 `sublang/playbooks` 均为 18.1.4；协议为 36。新增 `runtime-check` 检查实际提供服务的 Core 和各工作流的静态引擎导入路径，新运行在选定工作流无法对齐引擎或 Core/CLI 构建来源不符时，在创建会话前停止。已有内容版本锁定不被 Skill 升级静默改写。

本次 macOS 的 15 项回归通过，包括旧链接修复、保留真实依赖目录并在引擎不符时拒绝提交；两个真实市场包安装后，连同内置包的 39 个入口静态引擎解析全部指向本发布 Playbook 18.1.4，没有创建或执行工作流会话。原生 Windows 结果见对应提交的公开 CI；这不代表用户机器或四工作流的人工交付验收已经通过。

v1.0.6 修复 Codex workspace-write 沙箱内首次 Core 操作因文件监听器异步 `EMFILE` 而崩溃的问题。文件监听同步失败或异步报错时自动改用目录轮询，继续观察配置/会话变更；不改变权限、句柄限制或 Agent 配置。CLI、Core 和内置内容继续同源重建。18 项 macOS 回归通过，实际 Codex 沙箱内的候选 preflight 回归通过；Windows 同组测试已纳入 CI，原生执行结果另行记录。四工作流仍按手册逐步验收，不进入 CI。

v1.0.7 修复沙箱禁止 PID 信号探测时无法连接已有 Core 的问题。仅 EPERM 时改为连接原端点并验证令牌与协议；认证失败仍拒绝，保留原写入者与租约。原 CLI/Core 同源制品保持不变。本机 19 项回归通过，并在实际 Codex 沙箱复现旧版失败、确认新版附加到同一 PID/identity；兼容测试包含 Windows 的同组场景。

## License

保留所附 [Apache-2.0 LICENSE](LICENSE) 及上游版权声明。

v1.0.8 明确仅安装、准备运行时或查看帮助时不连接 Core、不初始化 Agent；首次实际 Core 请求仍由 Skill 自动初始化。CLI/Core 的成对归档和依赖锁定沿用 v1.0.7。

v1.0.9 修复临时 Core 的并发连接生命周期：启动和初始化短暂竞争有界等待，原拥有者等待其他本地 API 客户端断开后再关闭 Core，避免中断其他调用。握手前确认地址撤销或更换才重新解析，不重发业务请求，也不清除其他进程的锁或租约。CLI、Core、内置内容已按同一新源码树和锁文件重新构建，Playbook/内置内容仍为18.1.4。

v1.0.10 将 Windows 租约文件系统检查错误的代码与本地化文字分离，针对临时 EPERM 有界重试完整检查；持续错误仍拒绝，不删除或放宽租约。
