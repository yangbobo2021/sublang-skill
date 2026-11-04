# Runtime provenance and engine resolution

The Skill's entry is `scripts/sublang.mjs`. Its client joins a local SPEX Core
or temporarily starts the distributed Core. Package management runs through
Core's environment API and the SPEX library; it does not shell out to the
Playbook CLI. This release retains that architecture.

| Component | Identity and purpose | Expected in v1.0.10 |
| --- | --- | --- |
| SPEX package library and CLI | npm `@sublang/spex`; environment, file and package operations | 5.0.0, rebuilt with the recorded source patch |
| SPEX Core | npm `@sublang/spex-core`; composition, configuration and sessions | 0.1.0, same source tree and lock as CLI; protocol 36 |
| Host engine | npm `@sublang/playbook`; Captain, Players and workflow runtime | 18.1.4 |
| Built-in workflow content | SPEX package `sublang/playbooks`, generated from the installed npm Playbook's reference content | 18.1.4, including decide/code |
| External workflow content | SPEX packages such as `merico-ai/extract-specs@0.3.0` and `yangbobo2021/app-delivery-acceptance@0.4.17` | Their own published versions; the executable registry must import the host engine |
| Compiler | npm `@sublang/slc` | 0.20.2 |
| Nested SPEX parser libraries | npm `@sublang/spex@3.0.0`, required by Playbook and SLC through `^3.0.0` | Retained API dependency; it does not replace Core's 5.0.0 package installer |

The built-in content package and npm engine are different package formats,
but built-in content is generated from that engine release during Core build.
Their matching version in this distribution is checked, not assumed.
SPEX CLI/Core package versions alone do not identify a patched build.

## Diagnose without executing

After preparation and project registration, use:

```text
<node> <cli> runtime-check --project <absolute-project>
```

The JSON result comes from the **serving Core**, not the caller's npm tree.
It records Core's source/build, host package roots and versions, built-in seed,
and every placed workflow's registry module plus its static engine imports.
`aligned: true` requires matching build provenance and host engine version,
matching shipped built-in content, and present workflows importing that same
physical host engine. Missing workflows remain explicitly `missing`; they
are not claimed installed. `unverified` can mean unresolved imports, a
different engine root, or an embedded engine without identifiable imports.
Static resolution does not establish live model behavior or discover every
possible computed/dynamic import. Inspect such workflows before execution.

Core normally replaces stale symlinks/junctions during environment preparation.
A real user-owned dependency directory is left intact. Diagnose mismatches;
do not delete caches, replace user directories, or rewrite installed packages
by hand. Before submitting a new run the Skill checks the selected workflow;
unverified engine resolution or mismatched Core build stops before submission.
An older Core protocol must be closed normally before the new runtime can own
the home; do not kill it or remove its lease.

Existing content pins are retained: upgrading the Skill does not silently
rewrite a user's `spex.yaml`/lock from `sublang/playbooks@18.1.3` to 18.1.4.
Fresh environments seed 18.1.4. Existing environments can run older content
on the new engine if imports align; explicitly update their package request
through package operations when the user wants that content upgrade.

## Rebuild a release

`runtime/source.json` pins the upstream repository/commit and the published
`runtime/vendor/spex-source.patch`. The patch includes the existing local
endpoint/session-selection integration and runtime diagnostics; upstream
Windows storage behavior is inherited from the pinned commit.

```text
node scripts/build-runtime.mjs --repository <local-SPEX-Git-repository>
node scripts/update-release.mjs --version <new-version>
```

The builder creates an isolated worktree, applies the patch to the index,
records its exact Git tree and source lock hash, installs with `npm ci`, and
rebuilds CLI, Core and built-in content together. Both tarballs carry the same
build record. Archive provenance, source patch hash and archive checksums are
published in `runtime/release.json`. `sourceDirty: false` means the build used
the recorded commit **plus the explicitly recorded patch**, with no extra
unrecorded changes; it does not mean an unmodified upstream build.

Use native macOS and Windows setup/installation tests, including stale engine
links and Windows read grants. The four manual acceptance workflows are never
executed by CI. These checks do not establish customer-machine acceptance.

Native file notifications can fail inside an agent sandbox even with a high file-descriptor limit. Core falls back to directory polling for synchronous or asynchronous watcher failures on macOS and Windows, retaining config/session change observation without changing permissions or limits.

If the host denies a PID signal probe with EPERM, the client still authenticates to the descriptor’s existing loopback endpoint and checks the exact protocol. A failed connection/authentication never starts a second Core; the existing writer and lease remain in place. A proven nonexistent PID still follows normal stale-endpoint handling.

A competing temporary Core start is allowed up to five seconds to publish its endpoint or finish; every start still acquires Core’s exclusive lease. Before any RPC, a connection failure caused by a retired/replaced endpoint is re-resolved at most twice. An unchanged live endpoint still fails (including rejected authentication); no command is replayed and no lease is removed. An already submitted operation that loses its connection retains its uncertain outcome for inspection.

A temporary host retains its Core until its other direct local API clients disconnect. Its printed result can precede process exit while another client still uses that Core. Explicit App shutdown retains its bounded cancellation behavior. Startup contention waits up to five seconds without removing a lease.

On Windows, a typed root-lease filesystem EPERM is treated as transient contention for at most five seconds, with every retry performing the same full lease checks. A persistent error still refuses startup. Permission/ownership validation is not bypassed.
