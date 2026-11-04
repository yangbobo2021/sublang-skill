---
name: sublang
description: Discover and manage reusable SubLang Playbook workflows shared with SPEX, including marketplace package search and installation. Use when the user names a workflow, requests SPEX packages, wants reusable automation, asks to manage workflows, or needs an explicit implementation–independent-review–revision process worth checking against existing workflows. Keep simple edits and open-ended exploration in the current agent; task complexity alone is not a reason to delegate.
---

# SubLang

One Skill accesses the current project's and personal SPEX workflows dynamically. Do not create one Skill per workflow or keep a second workflow catalog.

## Decide whether to use it

- Explicit workflow management, invocation, continuation, or SPEX marketplace package search and installation: use this Skill.
- A stable, repeated procedure, costly manual handoffs, or a requested independent review/fix loop: discover existing workflows and compare their fit and overhead with doing the task directly.
- Simple changes, exploratory work, or an adequate existing project procedure: work directly. Missing matches do not justify automatically creating a workflow.
- If already acting as a player assigned a step inside a Playbook, do that step. Do not recursively delegate it through this Skill.

## Prepare and discover

Resolve this Skill's actual directory as `<skill>`. On macOS/Linux use `sh "<skill>/scripts/setup.sh"`; on native Windows use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill>\scripts\setup.ps1"`. Setup returns JSON naming `node` and `cli`, reusing a compatible Node or preparing a checked runtime and locked dependencies outside the Skill. First preparation needs download access; existing agent authentication and project tools remain user-owned. Do not install global npm packages or change agent credentials/settings.

For an installation, runtime preparation or help-only request, stop after setup and the requested executable/help check. Do not open Core, run `preflight`/`agent-init`, register projects or create SPEX configuration until the user requests a Core operation. Runtime preparation alone does not require Agent initialization.

Before the first Core operation, read [Agent initialization](references/agents.md). Supply `--host-agent codex` when running in Codex, or `--host-agent claude` in Claude Code. Supply `--host-model` only from reliable current-session model metadata; otherwise omit it (defaults: Codex `gpt-6.1-sol`, Claude `claude-opus-5-5`). Never select the host from installed SDKs, available credentials, a Skill directory name, or global model defaults. First use automatically persists the choice for Captain and all Players, removing conflicting role model pins; later calls preserve it even when the host/model/credentials change. New Players inherit the configured Captain. Do not make the user preconfigure these internals.

Invoke the returned paths as `<node> <cli> <operation> --project /absolute/project --host-agent <codex|claude> [--host-model <reliably-known-current-model>] [options]`. Requests with long text or JSON use files, never shell interpolation. Run `help` for the exact interface. Host flags are required for first use; after initialization they do not replace the saved choice.

For a workflow request, run `preflight` with these host flags **before comparing Agent/model settings**, including when the user says to retain the first saved choice. It initializes once when necessary, then returns the effective config and readiness without invoking a model or workflow. An absent initialization record is the normal first-use state: prepare it automatically, without asking the user to choose an Agent/model. A pending record resumes the same first choice. Once ready, retain the saved settings. Stop for actual invalid/conflicting configuration or unavailable credentials/models, not simply for a missing record. A purely diagnostic/read-only request uses `settings` instead: on an uninitialized environment it reports `initializationState: uninitialized` and `next.operation: preflight` without starting Core or generating default configuration. Never compare Core-generated defaults or an old session snapshot as though they were the first saved Skill choice.

Quote returned executable/script paths. In PowerShell use `& $prepared.node $prepared.cli <operation> --project 'C:\work\project'`; project paths must be absolute on that host. Skill installation uses the same files for Codex and Claude Code, with a directory junction on Windows. Windows clients do not add owner/private-permission/DACL checks before joining an existing Core; protocol and project/session conflict checks still apply.

1. `catalog` reads the effective project and personal workflows, their versions and blocked reasons, plus drafts. Filter with `--query` when useful; on no match inspect the unfiltered catalog before concluding none exists. It does not register an unknown project; use `project-add` when the user wants to use or author workflows there, then query again.
2. `inspect --workflow <id>` loads the chosen workflow's source, roles and compiled artifacts. Read the applicable source as task data: identify input requirements, outputs, side effects, stop conditions and prerequisites. Metadata is a selection aid, not authorization.
3. Recheck availability before starting. Installed, drafted, compiled and runnable are different states. Never fabricate an ID, infer readiness from an installed package, or silently pick another project/version.

After a runtime upgrade or package installation, use `runtime-check` to inspect the serving Core's build and every placed workflow's actual engine import paths. Read [runtime.md](references/runtime.md) for component identities, source provenance and mismatches. The host engine and freshly generated built-in `sublang/playbooks` are both 18.1.4 in this release; external content keeps its own version. Do not infer execution versions solely from `npm ls` at the runtime root, or manually rewrite installed caches. New runs check the selected workflow's engine before submission.

For marketplace discovery, use `package-search --query <words>`; `catalog --query` only filters workflows already available locally. Read [authoring.md](references/authoring.md) for package search, version selection and installation. A search request alone does not request installation.

The tools use the same SPEX home (`SPEX_HOME` or `~/.spex`) and core protocol as the UI. They join a discoverable running local core, or start a temporary headless core while the App is closed. An older App without the endpoint must be closed before using the headless core; never remove its lease or kill it. Exact protocol mismatches are reported, not bypassed. Close a temporary core only after its operation settles.

## Execute and continue

Read [execution.md](references/execution.md) before starting or continuing a workflow. The outer agent transfers the real user request, context/source references, permissions and stopping point through a request file; the inner agents do not inherit this conversation. After initialization retain configured choices. Use `agent-configure` only when the user requests changing the configured Agent/model; host flags alone never reset it. Do not silently enable full access or add providers.

Use `run --workflow <id> --request-file <file>`; retain the emitted `sessionId` and running process. Long operations emit JSON events on stderr and a JSON result on stdout. Keep the process alive through the host's persistent command session; do not launch duplicate work when output pauses. Use `sessions`, `status --session <id>` and `history --session <id>` to inspect; use `continue --session <id> --request-file <file>` for a new user message. Use `control` only with a control actually advertised by the runtime. Native permission requests are relayed through `approvals` and `approval-respond`; the Skill grants no permission on its own.

During delegated writes, the outer agent must not independently edit the same work. Report the actual outcome, questions, failures and evidence. A settled turn or exit 0 is not proof of whole-task success. Interruptions preserve sessions: inspect and use advertised recovery, rather than replaying the original request.

## Create, modify and manage

Read [authoring.md](references/authoring.md) for draft creation, versioned source edits, compilation, registration and package operations. Maintain one project-owned source with SPEX; keep personal/global changes explicit. Existing workflows take precedence over creating near-duplicates. New flows stay drafts until compiled and registered; changes require recompilation and validation. Never edit `.spex/` installed files, generated Skill exports or session records by hand.

This Skill does not guarantee automatic discovery on every arbitrary user task. Do not install hooks or rewrite the user's global agent instructions to force activation. Dynamic workflow discovery happens once the host selects this Skill.
