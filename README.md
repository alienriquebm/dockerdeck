# DockerDeck

An [Elgato Stream Deck](https://www.elgato.com/stream-deck) plugin that lets you monitor and control Docker containers and Docker Compose stacks running on a **remote** host, straight from physical Stream Deck keys.

DockerDeck never talks to the Docker daemon's TCP API and never touches your remote host's private keys. Every action goes through the system `ssh` binary, using your own `~/.ssh/config` — the same trust boundary you already use from a terminal.

```
Stream Deck (physical device)
    ↓
DockerDeck (this plugin) — runs locally, Node.js
    ↓
system `ssh` binary (your ~/.ssh/config — host aliases, users, keys)
    ↓
Remote host (any network reachable via SSH)
    ↓
Docker / Docker Compose
```

## Features

- **Container Status** — read-only key showing a container's running/health state, uptime, and health check result.
- **Container Toggle** — starts a stopped container or stops a running one, with an optional "press again to confirm" step before stopping.
- **Container Restart** — restarts a container.
- **Compose Stack** — brings a Docker Compose project up, down, or restarts it, and shows how many of its services are running.

Every key is redrawn live (default every 5 seconds, configurable) with a colored background, a status dot, and a short text label — status is never conveyed by color alone.

## Requirements

- **Stream Deck app** 7.1 or newer, on macOS 12+ or Windows 10+.
- A local `ssh` client available on your `PATH` (already present on macOS/Linux; on Windows, the built-in OpenSSH client that ships with Windows 10+ works).
- An SSH host you can already reach with a plain `ssh <host>` from a terminal — **key-based auth with no passphrase prompt**, since the plugin runs SSH in batch mode (see [SSH configuration](#ssh-configuration)).
- Docker (and, for the Compose Stack action, Docker Compose v2/v5-style `docker compose`) installed on that remote host.
- A user account on the remote host that can run `docker` commands without `sudo` — see [Docker permissions on Linux](#docker-permissions-on-linux-a-real-security-tradeoff) below, it's a real security tradeoff, not just a convenience step.

## Installation

**End users** (no local build needed):

1. Grab the `.streamDeckPlugin` file (see [Packaging](#packaging)).
2. Double-click it. The Stream Deck app will prompt to install it.

**From source** (for development, or to build it yourself): see [Local development](#local-development).

## SSH configuration

DockerDeck does not store hostnames, users, or keys itself — every "SSH Host Alias" field in the plugin is just an alias looked up in your **own** `~/.ssh/config`. Set up an entry like:

```
Host docker-host
    HostName 192.0.2.10   # or a hostname / VPN address you already use
    User youruser
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

Requirements for that entry to work with DockerDeck specifically:

- **The key must not require a passphrase at connect time** (or must already be loaded in `ssh-agent`). The plugin runs `ssh` with `BatchMode=yes`, which makes SSH fail immediately instead of prompting — by design, so a plugin action can never hang waiting on interactive input it can't provide.
- **Host key checking is left at your configured default.** DockerDeck deliberately never passes `StrictHostKeyChecking=no`. The first connection to a brand-new host must be approved once from a terminal (`ssh docker-host`) so the host key lands in your `known_hosts` — the plugin will not silently accept an unknown/changed host key.
- Verify the alias works before configuring a key: `ssh docker-host docker ps` should just work, with no prompts.
- This works equally well whether the host is on your LAN, reached through a VPN or mesh network, or has a public IP with a locked-down `sshd` — DockerDeck only ever calls the local `ssh` binary and has no awareness of the network path underneath it.

## Docker permissions on Linux (a real security tradeoff)

To run `docker` commands without `sudo`, the SSH user on the remote host is typically added to the `docker` group:

```
sudo usermod -aG docker youruser
```

**Be aware: membership in the `docker` group is equivalent to root access on that host.** The Docker daemon runs as root, and anyone who can talk to it (directly, or via the `docker` CLI) can mount the host's root filesystem into a container and read/write it as root, trivially escaping any container boundary. This is a well-known, intentional characteristic of Docker's architecture — not a bug — but it means:

- Only put SSH keys with `docker` group access on machines/users you already trust with root on that host.
- Don't reuse a `docker`-group-enabled key for anything else you'd want to scope down.
- If you need a lower-privilege setup, look into rootless Docker or a proxy that mediates specific `docker` subcommands — DockerDeck itself does not attempt to restrict what the remote user's shell can do; it only controls what commands *it* sends.

## Creating buttons

1. In the Stream Deck app, find **DockerDeck** in the action list (left sidebar).
2. Drag one of the four actions onto a key.
3. Fill in the Property Inspector (the panel that appears when the key is selected):
   - **SSH Host Alias** — must match a `Host` entry in `~/.ssh/config` (see above).
   - **Container Name** (Status/Toggle/Restart) — the exact name Docker knows it by (`docker ps --format '{{.Names}}'` on the remote host to check).
   - **Compose Path** (Compose Stack) — the absolute path to the directory containing the project's `docker-compose.yml` on the remote host.
   - **Stack Name** (Compose Stack, optional) — overrides the Compose project name; defaults to the compose folder's basename.
   - **Operation** (Compose Stack) — `toggle` (up if down, down if up), or a fixed `up`/`down`/`restart`.
   - **Confirm Before Stop** (Toggle only) — when checked (default), stopping a running container requires a second press within 4 seconds; this only guards the *stop* direction, since starting is non-destructive.
   - **Refresh Interval (s)** — how often the key polls status (2–60s, default 5s).
   - **SSH Timeout (s)** — how long a single SSH call may take before it's treated as a failure (2–30s, default 10s).
   - **Show Health Status / Show Uptime** (Status/Toggle/Restart) — toggle the extra subtitle/footer lines on the key face.
4. The key starts polling immediately; give it a few seconds to show real status instead of "CONNECTING".

## Visual states

Every key shows a colored background, a status dot, and a short label — color is never the only signal.

| Label | Meaning | Shown by |
|---|---|---|
| RUNNING | Container running (healthy or no healthcheck) | Status/Toggle/Restart |
| UNHEALTHY | Running, but its healthcheck is failing | Status/Toggle/Restart |
| STOPPED | Container exists but is not running | Status/Toggle/Restart |
| RESTARTING | Docker reports the container mid-restart | Status/Toggle/Restart |
| PAUSED | Container paused | Status/Toggle/Restart |
| UP | All services in the stack are running | Compose Stack |
| PARTIAL | Some, but not all, services are running | Compose Stack |
| DOWN | No services running | Compose Stack |
| NOT FOUND | Container / compose project doesn't exist on that host | All |
| CONNECTING | First refresh hasn't completed yet | All |
| WORKING | An operation (start/stop/restart/up/down) is in flight | All |
| SSH ERROR | Couldn't reach the host (bad alias, network, auth) | All |
| DOCKER ERR | Reached the host, but the docker/compose command failed | All |
| UNKNOWN | Unrecognized state, or a settings problem — check the subtitle | All |

If a key shows **UNKNOWN** with a short subtitle like "Host required" or "Invalid path", that's a settings problem, not a connectivity one — open the Property Inspector and fix the flagged field.

## Local development

```bash
git clone https://github.com/alienriquebm/dockerdeck.git
cd dockerdeck
npm install

npm run watch   # rollup -w, restarts the plugin in the Stream Deck app on every rebuild
```

`npm run watch` requires the plugin to already be linked into your local Stream Deck app once:

```bash
npx @elgato/cli@latest link com.alienriquebm.dockerdeck.sdPlugin
```

Other useful commands during development:

```bash
npm run build             # one-off build -> com.alienriquebm.dockerdeck.sdPlugin/bin/plugin.js
npx @elgato/cli@latest restart com.alienriquebm.dockerdeck   # reload after a manual build
npx @elgato/cli@latest --list                                # list linked plugins
```

Logs from the running plugin land in `com.alienriquebm.dockerdeck.sdPlugin/logs/` — check there first when something behaves unexpectedly on the device but the key face doesn't show enough detail (see [Error messages: key vs. logs](#error-messages-key-vs-logs)).

## Testing

```bash
npm run test          # vitest run — all unit tests, once
npm run test:watch    # vitest — watch mode
npm run test:coverage # vitest run --coverage
```

No test ever makes a real SSH connection or a real Docker call — every service is dependency-injected so tests run against mocks, deterministically and offline.

```bash
npm run lint           # eslint src/
npm run lint:fix
npm run format         # prettier --write src/
npm run format:check
npm run validate       # lint + test + `streamdeck validate` on the manifest
```

## Packaging

```bash
npm run package
```

This builds the plugin and runs `streamdeck pack`, producing a `com.alienriquebm.dockerdeck.streamDeckPlugin` file you can distribute or double-click to install.

## Troubleshooting

**Key is stuck on CONNECTING**
The first refresh hasn't completed yet — give it a few seconds. If it never resolves, check the logs (see [Local development](#local-development)).

**Key shows SSH ERROR**
The `ssh` binary itself failed — bad host alias, unreachable network, refused connection, or an auth problem. Reproduce it directly: `ssh <your-alias> true`. If that hangs waiting for a passphrase, the plugin will always show this state, since it runs SSH in batch mode by design (see [SSH configuration](#ssh-configuration)).

**Key shows DOCKER ERR**
SSH itself succeeded, but the remote `docker`/`docker compose` command failed for another reason. Check the logs for the sanitized stderr snippet; common causes are the remote user lacking `docker` permissions (see [Docker permissions on Linux](#docker-permissions-on-linux-a-real-security-tradeoff)) or Docker/Compose not being installed.

**Key shows NOT FOUND**
The container name or Compose path is valid, but nothing by that name exists on the remote host — check for a typo, or that the container/stack hasn't been removed.

**Key shows UNKNOWN with a short message (e.g. "Host required", "Invalid path")**
This is a settings problem, not a connectivity one. Open the key's Property Inspector; the message tells you which field to fix.

**Changes I made in `npm run watch` aren't showing up on the device**
Make sure the plugin is linked (`npx @elgato/cli@latest link ...`, see [Local development](#local-development)) and that the Stream Deck app actually restarted the plugin — `watch`'s `--watch.onEnd` hook does this automatically, but a manual `npm run build` does not; run `npx @elgato/cli@latest restart com.alienriquebm.dockerdeck` afterward.

**A `TS1238` warning appears during `npm run build`**
This is a known, cosmetic mismatch between the Stream Deck SDK's type declarations (written for native TC39 decorators) and this project's `experimentalDecorators: true` setting (required for Vitest to parse the `@action(...)` decorator at all). It doesn't affect the compiled output. Don't "fix" it by flipping `experimentalDecorators` — that breaks the test suite instead.

### Error messages: key vs. logs

Key faces are small and deliberately terse by design — every subtitle line is hard-truncated to 16 characters, so it only ever shows a short label (`SSH ERROR`, `DOCKER ERR`, or a short settings hint like `Host required`). The **full** error detail — the sanitized stderr from the failed SSH/docker/compose command — is written to the plugin's logs, not the key face. If a key's short label isn't enough to diagnose an issue, check the logs next.

## Security considerations

- **No direct Docker API access.** DockerDeck never opens a TCP connection to the Docker daemon (`tcp://`, no `DOCKER_HOST` exposure) — every operation is `docker ...`/`docker compose ...` run over SSH as a normal remote shell command.
- **Your private keys never leave your SSH config.** The plugin invokes the system `ssh` binary and lets it resolve host, user, and identity file from your own `~/.ssh/config`, exactly like running `ssh` from a terminal. It never reads, copies, or reimplements key handling.
- **No shell injection surface, by construction.** Locally, SSH is invoked via `execFile("ssh", [...argsArray])` — arguments are passed as an array, never concatenated into a string a local shell could reinterpret. The *remote* command (the string handed to the remote shell) is built through dedicated POSIX single-quote–escaping helpers, and every user-supplied value that ends up in it (SSH host alias, container name, compose path) is validated against a strict character allowlist first. Both layers are intentional: validation gives a clear on-key error message, escaping is the actual injection defense.
- **Host key checking is never disabled.** `StrictHostKeyChecking=no` is never set — an unknown or changed host key will make SSH fail rather than silently connect, same as your terminal.
- **Batch mode, always.** SSH runs with `BatchMode=yes`, so it can never sit waiting on an interactive password/passphrase prompt it has no way to answer — a connection that would prompt simply fails fast instead.
- **The `docker` group is root-equivalent.** See [Docker permissions on Linux](#docker-permissions-on-linux-a-real-security-tradeoff) — this is the biggest real-world risk in this whole setup, and it's on the remote host's configuration, not something DockerDeck can mitigate from the client side.

## Future improvements

Ideas that came up during development but were deliberately left out of this initial release — not commitments, just a backlog:

- **Stream Deck+ dial support.** Actions currently only render on standard keys (`isKey()` gates every render); dials on Stream Deck+ devices are accepted by the SDK but silently ignored. Touch-strip status display and rotate-to-adjust (e.g. refresh interval) could be a natural fit.
- **Shared SSH connection/result cache across keys.** Each key currently makes its own independent SSH round trip on every poll, even when several keys point at the same host or container. A shared cache (keyed by host+command, short TTL) would cut redundant SSH connections when a dashboard has many related keys.
- **Real cancellation of in-flight SSH commands.** `StatusRefreshService`'s generation counter already prevents a *stale result* from rendering, but the underlying `ssh` child process for an abandoned request still runs to completion (or its own timeout) in the background rather than being killed immediately when superseded.
- **Persistent SSH connections (`ControlMaster`/`ControlPersist`).** Would remove per-command SSH handshake overhead, at the cost of extra setup complexity (control socket lifecycle, cleanup) — worth revisiting if per-key latency becomes noticeable with many keys.
- **Configurable key face layout / theme.** Colors, labels, and which optional lines (health, uptime) show are effectively fixed; a per-user theme or layout override could help with visual accessibility preferences.
- **Multi-container / log tail action.** A key or PI view listing all containers on a host, or a scrolling log tail, is a fundamentally different interaction model from the current single-target keys — out of scope for this plugin's current design, but a plausible companion action.

## License

[MIT](./LICENSE)
