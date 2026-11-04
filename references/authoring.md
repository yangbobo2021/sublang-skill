# Author and manage workflows

Search the catalog before creating. Create only when reusable orchestration is useful and matches the user's request; a missing workflow for a one-off edit normally means doing the task directly. Describe the actual procedure, actors, inputs, branches, stop conditions, evidence and failure handling. Unresolved business choices require the user's answer; the compiler is not authority to invent them.

Creating a recurring-use workflow does not schedule recurring execution. Set up a schedule only when requested, using the user's actual scheduling facility.

All examples use the `node` and `cli` returned by setup. `<root>` is the actual registered Git project root. Draft IDs are lowercase words joined by hyphens. The source and compiled package live under the project's `spex-packages/`; SPEX manages the associated authoring records.

Draft operations default to project scope. For an explicitly personal workflow, add `--scope personal` consistently to create, read, edit, compile and register; its package and authoring records then live in SPEX's own personal working folder. Catalog includes both project and personal drafts with their actual scope. A draft's scope is not changed by selecting another project.

1. `draft-create --project <root> --draft <id>` creates a SPEX draft without compiling or installing it.
2. `draft-open --project <root> --draft <id>` returns its source, `instance`, source `version`, compile state and records. Save those actual values.
3. Write procedure text to a UTF-8 file. `draft-write --project <root> --draft <id> --instance <instance> --source-file <file> --base-version <version>` updates with optimistic concurrency. An empty new draft has no source version and needs no `--base-version`; replacing existing source requires its last-read version. A conflict means reread and reconcile, never automatically overwrite.
4. Optional `draft-player --project <root> --draft <id> --instance <instance> --player <configured-player-id>` selects the actual configured compiler agent. Otherwise the configured Captain is used. This is a real model call when compilation begins; credentials and quota must be usable. Do not silently substitute a provider or model.
5. `draft-compile --project <root> --draft <id> --instance <instance>` invokes SPEX's supplied SLC, waits for the draft's compile to settle and returns the real outcome. A failed, interrupted or clarification-required result is not a registered workflow. Read returned questions and compile output, correct the source and recompile; do not fabricate generated artifacts.
6. `draft-artifacts --project <root> --draft <id>` reads the actual compiler output. Check the generated roles, branches and stop conditions against the authored procedure, and perform an isolated representative execution before declaring it ready for general reuse. Syntax/type/packaging success alone is insufficient.
7. `draft-register --project <root> --draft <id> --instance <instance> --json-file <file>` registers the compiled draft through SPEX. The file contains `command` (without `/`), `intent`, `bindings` (every derived role to a player ID), and optionally `newPlayers` using SPEX's agent block schema. Roles must come from the real compile, not guesses. Omit `newPlayers` to retain the core's configured/default players. Refresh `catalog` and inspect its availability afterward. Registration does not commit the package or publish it.

To modify, reopen the retained draft, edit its source with the version token, compile, validate and register again. If an installed package has no authoring draft, create a project-owned draft from permitted source; do not patch the installed cache or silently replace a shared/global package. `draft-delete` deletes an explicitly selected authoring session using its `instance`; it is not a generic workflow uninstall.

Package operations go through the same core as the UI:

- `package-search --query <words>` searches the selected environment's configured SPEX registry and returns package names, descriptions and published versions, including packages not installed locally. Queries must be nonempty and at most 200 characters. Project scope requires a registered project; use `project-add` when the user requests package management there, or explicit `--scope personal` for personal packages. Search does not add a package or change the registry; report an empty result separately from authentication, network or compatibility failures.
- `packages` lists the selected environment and lock/install status.
- `package-add --package <org/name> --version <exact-or-range>` adds from its configured registry; `--path <project-relative-folder>` or `--git <url> --rev <revision>` selects a local or Git source instead. Choose exactly one source. Registration of local drafts already adds their package.
- `package-install` restores locked files. `package-update` intentionally resolves newer allowed releases. `package-remove --package <org/name>` removes that request, possibly removing several exported workflows; inspect the package first. These commands await completion and preserve SPEX's conflict rules.
- Scope defaults to `--scope project`. `--scope personal` selects the current user's global environment for package/config operations; never silently escalate scope.

Use the actual search result's `org/name` and published versions when selecting a marketplace package. Follow the requested version or range; if omitted, select the newest published stable version that fits the request and report it, comparing version numbers rather than assuming response order. Resolve ambiguity when several packages match without a clear fit. For an already specified package and version, search is optional. After an authorized installation, check `packages` for the resolved version and installed state, then refresh `catalog` and inspect the intended workflow before declaring it runnable. Installing does not request running its workflows.

Example (replace the package and version with actual registry results; `<node>` and `<cli>` come from setup):

```sh
<node> <cli> package-search --project <root> --query "dependency review"
<node> <cli> package-add --project <root> --package <org/name> --version <version>
<node> <cli> packages --project <root>
<node> <cli> catalog --project <root>
```

Use `spex.yaml`, `spex.lock` and package manifests as SPEX defines them. Commit project-owned source and lock changes when the task authorizes commits. Published versions are immutable; publishing/share/upload is outside this Skill's automatic behavior. In-progress sessions retain their own runtime recovery rules; never rewrite stored sessions to force them onto a new definition.
