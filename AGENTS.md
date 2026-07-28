# AGENTS.md — DockerDeck

This file is the primary reference for any AI agent (Claude Code, or otherwise) working on this repository. Read it before making changes.

## What this project is

DockerDeck is an Elgato Stream Deck plugin that lets the user monitor and control Docker containers and Docker Compose stacks running on a **remote** host, over SSH, from physical Stream Deck keys.

```
Stream Deck (physical device)
    ↓
Plugin (this repo) — runs locally on macOS, Node.js
    ↓
system `ssh` binary (uses the user's ~/.ssh/config — host aliases, users, keys)
    ↓
Remote host (reached over Tailscale in the reference setup)
    ↓
Docker / Docker Compose
```

The plugin never talks to the Docker daemon's TCP API directly and never touches the remote host's private keys — everything goes through the user's own `ssh` configuration and the local `ssh` client binary.

## Tech stack

- TypeScript (strict), Node.js (plugin runtime: Node 24, declared in `manifest.json`)
- `@elgato/streamdeck` — official Stream Deck SDK
- `@elgato/cli` — official Stream Deck CLI (`streamdeck` command, invoked via `npx @elgato/cli@latest`)
- Rollup — bundles `src/plugin.ts` into `com.alienriquebm.dockerdeck.sdPlugin/bin/plugin.js`
- Vitest — unit tests
- ESLint (`typescript-eslint` strict-type-checked config) + Prettier

## Directory structure (as built)

```
dockerdeck/
├── src/
│   ├── plugin.ts                        # entry point: registers all actions, connects
│   ├── actions/
│   │   ├── base-container-action.ts     # shared poll/render/validate lifecycle for
│   │   │                                # Status/Toggle/Restart (see "Shared action base" below)
│   │   ├── container-status-action.ts   # read-only status key
│   │   ├── container-toggle-action.ts   # start/stop, with confirm-before-stop
│   │   ├── container-restart-action.ts  # restart
│   │   └── compose-stack-action.ts      # Docker Compose stack control (standalone, not
│   │                                    # a BaseContainerAction subclass — different
│   │                                    # settings/status shape)
│   ├── services/
│   │   ├── ssh-service.ts               # SystemSSHService: execFile("ssh", [...]), never a shell string
│   │   ├── remote-docker-service.ts     # docker inspect/start/stop/restart + compose ps/up/down/restart
│   │   └── status-refresh-service.ts    # per-instance polling, in-flight guard, stale-result guard
│   ├── models/
│   │   ├── container-status.ts          # ContainerVisualStatus (shared status vocabulary), RemoteContainerStatus
│   │   ├── compose-status.ts            # RemoteComposeStatus, ComposePsEntry
│   │   └── settings.ts                  # per-action settings types + defaults/resolvers
│   ├── rendering/
│   │   ├── key-renderer.ts              # KeyRenderer: turns KeyRenderInput into a base64 SVG data URL
│   │   ├── status-theme.ts              # color + label per ContainerVisualStatus
│   │   └── svg-templates.ts             # raw SVG string builder + per-action icon glyphs
│   └── utils/
│       ├── shell-escape.ts              # POSIX single-quote escaping for the REMOTE command string
│       ├── validation.ts                # SSH host / container name / compose path / interval validators
│       ├── duration.ts                  # uptime computation + human formatting
│       ├── error-mapper.ts              # classifies ssh/docker/compose failures into ssh-error|missing|docker-error
│       └── compose-parser.ts            # docker compose ps --format json parser (NDJSON + array + single-object)
├── com.alienriquebm.dockerdeck.sdPlugin/
│   ├── manifest.json                    # 4 actions registered here
│   ├── ui/*.html                        # one Property Inspector per action (sdpi-components v4, via CDN script)
│   ├── imgs/actions/<action>/{icon,key}{,@2x}.png   # manifest fallback images (real face is drawn at runtime)
│   └── bin/plugin.js                    # rollup build output — do not edit directly
├── rollup.config.mjs
├── eslint.config.mjs
├── tsconfig.json / tsconfig.test.json
└── package.json
```

Every `*.ts` file under `src/` has a co-located `*.test.ts` sibling. Keep it that way — when you add a file, add its test.

## Architecture notes worth knowing before you touch anything

### SSH is the only remote channel, and it is treated as an attack surface
- `SystemSSHService` (`services/ssh-service.ts`) uses `execFile("ssh", [...argsArray])` — arguments are never concatenated into a shell string locally. It always sets `BatchMode=yes`, `ConnectTimeout`, `ServerAliveInterval/CountMax`, caps stdout/stderr size, and enforces a timeout that kills the child process. It never sets `StrictHostKeyChecking=no`.
- The **remote** command (the string SSH hands to the remote shell) is built with `utils/shell-escape.ts`'s `shellEscapeArg`/`buildRemoteCommand`/`buildRemoteCommandInDir` — POSIX single-quote wrapping. Never hand-concatenate a remote command string; always go through these helpers.
- All user-supplied values that end up in a remote command (SSH host alias, container name, compose path) are validated first via `utils/validation.ts` (character allowlists, path traversal rejection, length limits) *and* shell-escaped. Both layers are intentional — validation gives clear UI error messages, escaping is the actual injection defense.
- **SSH exit-code convention this codebase relies on**: SSH itself exits **255** for connection/auth-level failures (unresolvable host, refused connection, permission denied, timeout) and otherwise forwards the *exact* exit code of the remote command. `utils/error-mapper.ts` uses this to distinguish `ssh-error` from `docker-error`/`missing`. This was confirmed against a real host, not assumed — see the two `classify*CommandError` functions and their tests for the exact stderr patterns matched (they're taken from real command output, e.g. `"no such object"`, `"no configuration file provided: not found"`, `"no such file or directory"`).

### Status model
- `ContainerVisualStatus` (`models/container-status.ts`) is a **shared** vocabulary used by both per-container actions and the Compose stack action: `running | healthy | unhealthy | stopped | restarting | paused` (containers) plus `up | partial | down` (compose aggregate) plus the common `missing | connecting | working | ssh-error | docker-error | unknown`. Don't fork this into two separate status enums — the whole point is one consistent color/label legend across every key. `rendering/status-theme.ts` maps every value to a `{background, foreground, dotColor, label}` theme; `up`/`partial`/`down` intentionally reuse the exact hex values of `healthy`/`restarting`/`stopped`.
- `RemoteDockerService` (`services/remote-docker-service.ts`) never throws — SSH/docker/parse failures are always mapped to a typed status object with `errorMessage` set, never a rejected promise. Callers (actions) rely on this and don't wrap calls in try/catch for that reason (they do wrap for genuinely unexpected errors, e.g. SDK-level failures).
- `docker compose ps --format json` output shape is version-dependent. Confirmed live against Compose v5.0.2: one bare JSON object for a single service, one JSON object **per line** (NDJSON, no wrapping array) for multiple services. Older Compose versions are documented to emit a real `[...]` array. `utils/compose-parser.ts`'s `parseComposePsOutput` handles all three shapes and only throws on a truly malformed line, which the service layer maps to a `docker-error` "invalid response" status — never silently shows wrong data.

### Concurrency / staleness (the two real bugs found via physical-device testing, don't reintroduce them)
1. **Stale async result overwriting a newer one.** If settings change (or the action reappears) while a previous SSH call is still in flight, that old call's result must not be allowed to render after a newer one already has. `services/status-refresh-service.ts` solves this with a per-instance-id generation counter: `start()`/`stop()` bump the generation, and every scheduled task receives an `isCurrent(): boolean` guard it must check *right before* committing a visible side effect (calling `setImage`). Actions check `isCurrent()` after every `await` on a docker/ssh call, before rendering.
2. **`inFlight` must only be cleared by the generation that's still current**, not by whichever task happens to resolve first — otherwise a stale task finishing after a newer one starts can prematurely clear the flag and let a duplicate request through. See `StatusRefreshService.runOnce`'s `if (isCurrent()) { this.inFlight.delete(...) }`.
3. Key presses on Toggle/Restart/Compose route through `refreshService.refreshNow(id, task)` rather than calling the docker service directly — this reuses the same in-flight guard, so a key press both blocks a repeated press *and* blocks the periodic poll from racing it, with no separate "busy" flag needed.

### Rendering
- `KeyRenderer.render()` returns a **base64 `data:image/svg+xml;base64,...` URL**, not a raw `<svg>` string. This was a real bug found on the physical device: the Stream Deck app (7.4.0) silently ignored raw SVG strings passed to `action.setImage()` even though the SDK's type declarations claim raw SVG is supported — `setImage()`'s promise only confirms the request was *sent*, not that it rendered. If you change this, re-verify on a physical device, not just unit tests (unit tests can't catch this class of bug).
- Every key face draws: title, status dot + label, optional subtitle (health / compose running-count), optional footer (uptime), and an action-type icon glyph at the bottom (`container`/`power`/`restart`/`stack` — one per action, drawn by `rendering/svg-templates.ts`'s `buildIconGlyph`). The icon identifies the *action type*, not the status — status is color + dot + label.
- Color is never the only signal — every status also has a distinct text label, per the plugin's original design brief.

### Shared action base
`actions/base-container-action.ts` is an abstract class extended by `ContainerStatusAction`, `ContainerToggleAction`, `ContainerRestartAction`. It owns: constructor DI (`dockerService`, `renderer`, `refreshService` — all default to the real singletons, swappable in tests), `onWillAppear`/`onDidReceiveSettings`/`onWillDisappear` wiring, the validate → query → render refresh loop, and `lastStatus` (per-instance-id map of the last known status, used by Toggle to decide start-vs-stop without an extra round trip). `ComposeStackAction` does **not** extend it (different settings type, different status shape, different render fields) but mirrors the same pattern by hand — if you add a fifth action with container-shaped settings, extend the base; if its shape is genuinely different, follow Compose's pattern instead of forcing a fit.

## Coding standards

- Formatting is enforced by Prettier: tabs (width 4), double quotes, semicolons, trailing commas, 120-col print width. Run `npm run format` — don't hand-format against this.
- ESLint uses `typescript-eslint`'s `strictTypeChecked` config. Notable consequences already hit in this codebase:
  - `exactOptionalPropertyTypes: true` — never assign `undefined` to an optional field explicitly. Build optional fields incrementally (`if (x !== undefined) obj.field = x;`) rather than spreading `{ field: possiblyUndefined }`.
  - `noUncheckedIndexedAccess: true` — array/tuple index access returns `T | undefined` unless the array's exact length is encoded in its type (e.g. a `[string, string]` tuple). Use `?.[0]` or a tuple type, not a bare non-null assumption.
  - Test mocks for `vi.fn()` must be given an explicit generic type argument (`vi.fn<SomeFunctionType>()`) when assigned to a typed interface field — a bare `vi.fn()` produces a type too wide to satisfy `RemoteDockerService`/`KeyRenderer` etc. `npm run lint` alone won't catch this; run `npm run typecheck` (or `npm run build`, which only covers files reachable from `src/plugin.ts`, i.e. not test files) after adding/editing test mocks.
  - `no-explicit-any` is an error; `no-floating-promises` and `no-misused-promises` are errors.
- Settings types (`models/settings.ts`) are declared as `type X = { field?: T }` object literals, **not** `interface`. The `@elgato/streamdeck` SDK constrains generic settings to `JsonObject` (an indexed type); a plain `type` literal structurally satisfies that via TypeScript's implicit-index-signature leniency for object literal types, an `interface` does not. Don't convert these to interfaces.
- Comments are rare and short by design (see the repo's general house style) — a comment exists only where it explains a non-obvious constraint or a bug that was actually hit (grep for "Regression test" / "found on the physical device" style comments — they're load-bearing documentation, don't delete them during refactors).

## Testing

- `npm run test` (Vitest). 214 tests as of the last phase, across 16 `*.test.ts` files, all passing.
- **Never make a real SSH connection or a real Docker call from a unit test.** Every service is injected via constructor DI specifically so tests can pass a mock. `SSHService`/`RemoteDockerService`/`KeyRenderer`/`StatusRefreshService` are all interfaces for this reason.
- `SystemSSHService`'s tests mock `node:child_process`'s `execFile` via `vi.mock("node:child_process", () => ({ execFile: vi.fn() }))` + `vi.mocked(execFile)` — **not** `vi.spyOn(childProcess, "execFile")`, which throws (`Cannot redefine property`) because ESM module namespaces aren't configurable. If you add another test that needs to mock a named ESM export, use the same `vi.mock` pattern.
- Async polling/interval logic is tested with `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)`, not real timers.
- `vitest` config (in `package.json`'s `"vitest"` field) sets `"fileParallelism": false`. This is required: importing `@elgato/streamdeck` (which every action file does, for `SingletonAction`/`action`) eagerly constructs a real file-based logger as a side effect of the import, writing to `./logs/` relative to CWD. Running test files in parallel workers races that file's rotation logic and throws `ENOENT`. Don't remove `fileParallelism: false` without solving that race a different way (e.g. mocking `@elgato/streamdeck` entirely, which is more invasive). A stray `logs/` directory at the repo root is a side effect of running tests, not a build artifact — safe to delete, don't commit it.
- When adding a new action file, its test needs a full `RemoteDockerService` mock object (all of `getContainerStatus`/`startContainer`/`stopContainer`/`restartContainer`/`getComposeStatus`/`composeUp`/`composeDown`/`composeRestart`) even if the action under test only calls one or two of them — the interface has all eight methods.

## Commands

```bash
npm run build           # rollup -> com.alienriquebm.dockerdeck.sdPlugin/bin/plugin.js
npm run watch           # rollup -w, restarts the plugin in Stream Deck on rebuild
npm run test            # vitest run
npm run test:watch      # vitest (watch mode)
npm run lint / lint:fix
npm run format / format:check
npm run typecheck       # tsc --noEmit against both tsconfig.json and tsconfig.test.json
npm run validate        # lint + typecheck + format:check + test + `streamdeck validate` on the manifest
npm run package         # build + `streamdeck pack` -> .streamDeckPlugin file

npx @elgato/cli@latest --list                       # list linked plugins
npx @elgato/cli@latest restart com.alienriquebm.dockerdeck   # reload after a build, during manual testing
```

## Known, accepted quirks — do not "fix" these without re-reading why

- **`TS1238: Unable to resolve signature of class decorator when called as an expression`** would otherwise appear on every `@action(...)`-decorated class (the 4 action files). It comes from a mismatch between the SDK's `.d.ts` (written for native TC39 decorators) and this project's `tsconfig.json` (`experimentalDecorators: true`, legacy decorators). Flipping `experimentalDecorators` to `false` removes it but **breaks `npm run test`** — Vitest's esbuild-based transform then fails to parse `@action(...)` at all (`SyntaxError: Invalid or unexpected token`). This was tried and reverted during Phase 4. Leave `experimentalDecorators: true`. Since Phase 7, each occurrence is suppressed with a `// @ts-expect-error TS1238: ...` comment immediately above the `@action(...)` line (not a blanket tsconfig/eslint suppression) so `npm run typecheck` stays meaningful — a *different* error at that exact spot would still surface as "unused @ts-expect-error directive" mismatch, or as ESLint's ts-expect-error checks flagging drift. If the SDK ever ships native-decorator-compatible types and the error stops occurring, `tsc` will fail with "Unused '@ts-expect-error' directive" — that's your signal to delete the comment, not a bug.
- Manifest fallback images (`imgs/actions/*/{icon,key}.png`) are all copies of one generic placeholder PNG — the real key face is always drawn at runtime by `KeyRenderer`, so these only matter for the action list icon and the split-second before the first `setImage()` call. If Phase 7 polish work wants custom art here, that's fine to add, but it's cosmetic, not functional.

## The user's development/testing environment (for context, not to hardcode)

- The user tests against a real remote host (SSH alias configured in their own `~/.ssh/config`), running Docker 29.2.1 / Docker Compose v5.0.2, with several containers and a multi-service Compose project available for live testing. None of the specific host/container/project names are referenced by the code — treat them as private; don't ask the user to paste them into files that get committed (this section intentionally avoids naming them for that reason).
- The user has a physical "Stream Deck 2" (5×3 keys) plus a virtual 3×2 device registered in the Stream Deck app.
- The project has followed a phased build process (scaffolding → SSH → status query → first working key → start/stop/restart → Compose → polish), stopping for the user's review/physical-device confirmation after each phase. Continue that pattern for new work unless told otherwise: make a change, run lint+test+build, explain what changed, and where relevant ask the user to confirm on the physical device before moving on.
