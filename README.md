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

完整说明：[SKILL.md](SKILL.md)、[包管理和流程创作](references/authoring.md)、[执行和恢复](references/execution.md)。

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

`runtime/vendor` 保存当前锁定的 SPEX CLI/Core 运行包，来源由 `runtime/release.json` 记录。需要更新这些上游运行包时使用 SPEX 仓库的独立分发构建器，再审查更新差异。

## 验证边界

2026-11-04：13 项 macOS 集成、独立分发与 Windows 路径模拟测试通过；PowerShell 语法检查通过。原生 Windows 和 Claude 实际模型端到端执行仍需单独验证，不把模拟检查计作实机通过。Windows 客户端按用户要求不新增所有者、私有权限或 DACL 检查。

## License

保留所附 [Apache-2.0 LICENSE](LICENSE) 及上游版权声明。
