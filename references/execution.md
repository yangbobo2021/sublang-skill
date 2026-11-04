# Execute a workflow

First register an unknown existing Git project with `project-add --project <absolute-root>`. This pairs it with SPEX; it does not create a Git repository, make commits, or run a workflow. Discovery before registration returns `projectRegistered: false`, the global catalog and a concrete next step; local package execution must wait for registration.

Prepare a UTF-8 request file containing the real user wording and necessary original context, source references, authorized effects, constraints, selected models/effort and stopping point. A plain text file is sufficient. Do not paste credentials. Do not replace nuanced requirements with an optimistic short summary. An installed workflow may edit or commit; verify its contract against the current authorization. A request for review alone does not authorize a fixing workflow's writes.

```text
<node> <cli> run --project <root> --workflow <id> --request-file <request.txt>
<node> <cli> continue --project <root> --session <session-id> --request-file <followup.txt>
<node> <cli> status --project <root> --session <session-id>
<node> <cli> history --project <root> --session <session-id> --after-seq 0
```

`run` refreshes the effective catalog, refuses blocked/missing flows, records the selected workflow and version in an event, creates a SPEX session, and submits the command once. If submission fails after creation, the error retains the session ID: inspect it, do not blindly run again. Each follow-up uses the retained session; a session belonging to another project is refused. Settled output includes current session state and new visible history. Semantic terminal success and any expected deliverables must be established from the runtime's actual results and referenced evidence, not `ok`, turn settlement, text claims or exit code alone.

Workflow aliases are matched by exported name first. For colliding names, the core's one runnable definition wins; use `--package <org/name>` to inspect a particular blocked definition. Do not execute a blocked alternative or invent precedence rules.

`--wait-seconds <n>` is an operation deadline (default 1800). At expiry the tool requests cancellation, reports interruption and retains identifiers. SIGINT/SIGTERM also request cancellation for this command's active turn/compile only. A normal settled question is continued with a new user message. Uncertain interrupted work requires the runtime's advertised control; it must not be replayed as a new session.

If a `native_approval` event appears while the long command runs, use another command session to inspect `approvals`. Obtain the user's decision unless it is already explicitly authorized under the host's applicable policy. Respond with `approval-respond --json-file <file>` holding exactly `generation`, `requestId`, `owner`, and `decision` (`allow_once` or `deny`). Never approve all pending requests, copy provider credentials, or change permissions to make a blocked action succeed. Process exit does not leave an approval broker behind; a canceled owned core aborts and checkpoints its calls.

For workflow recovery/ending, `control --session <id> --kind recovery|ending --action <advertised-id>` invokes the core's advertised action. `abort --session <id>` requests stopping an active turn. Do not use `session.discard`, delete records or remove locks as a generic repair.

`settings` reads effective config and readiness without returning credential values. `configure --json-file <file>` forwards a documented SPEX `config.edit` op at the selected scope; use only for a user-requested change, preserving existing providers/models by default. Read `help` for the supported operations. A caller's active model/auth is not assumed to be available to subprocesses.
