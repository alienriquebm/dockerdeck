/**
 * SSHService — executes commands on a remote host via the system `ssh` binary.
 *
 * Security principles applied here:
 * - Uses execFile (not exec/shell) for the LOCAL process: arguments are passed
 *   as an array and never interpreted by a local shell.
 * - BatchMode=yes: prevents SSH from prompting for passwords or passphrases.
 * - StrictHostKeyChecking: left at default (ask/yes). We do NOT set it to "no".
 * - ConnectTimeout: always set to avoid hanging indefinitely.
 * - ServerAliveInterval/CountMax: detect dead connections quickly.
 * - stdout/stderr are capped to avoid memory exhaustion from runaway output.
 * - The ssh host alias is validated before use (see validation.ts).
 * - The remote command string is built with shellEscapeArg (see shell-escape.ts).
 */

import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";

export interface SSHCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	/** True if the command was killed because it exceeded timeoutMs. */
	timedOut: boolean;
}

export interface SSHExecuteOptions {
	/** Maximum time in milliseconds to wait for the command. Default: 10 000 ms. */
	timeoutMs?: number;
	/** Maximum bytes to capture from stdout. Default: 512 KB. */
	maxStdoutBytes?: number;
	/** Maximum bytes to capture from stderr. Default: 64 KB. */
	maxStderrBytes?: number;
	/** When aborted, the underlying `ssh` child process is killed immediately instead of left to finish/time out. */
	signal?: AbortSignal;
}

/**
 * Interface that can be replaced by a mock in tests.
 */
export interface SSHService {
	execute(host: string, remoteCommand: string, options?: SSHExecuteOptions): Promise<SSHCommandResult>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_STDOUT = 512 * 1024; // 512 KB
const DEFAULT_MAX_STDERR = 64 * 1024; //  64 KB

// How long a ControlMaster connection is kept alive after the last command using it exits.
// A fresh command within this window reuses the master instead of paying a new handshake.
const CONTROL_PERSIST_DURATION = "60s";

// Hardcoded /tmp rather than os.tmpdir(): on macOS os.tmpdir() resolves to a long
// per-user path (/var/folders/xx/.../T, ~50 chars) which, combined with the 40-char
// hash %C expands to, blows past the 104-byte sun_path limit on Unix domain sockets.
// /tmp is short and fixed-length, which is why OpenSSH's own docs use it for this exact case.
const SOCKET_DIR = "/tmp/dockerdeck-ssh";

/**
 * Builds the -o args that enable SSH connection multiplexing (ControlMaster/ControlPersist),
 * so repeated calls to the same host reuse one connection instead of a fresh handshake each time.
 * Not supported on Windows: ControlPath is a Unix domain socket, which the Windows OpenSSH
 * client doesn't support reliably across versions — falls back to one connection per command.
 */
function buildMultiplexingArgs(): string[] {
	if (process.platform === "win32") {
		return [];
	}

	try {
		mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o700 });
	} catch {
		// If the socket directory can't be created, fall back to a plain, non-multiplexed
		// connection rather than failing the whole command.
		return [];
	}

	return [
		"-o",
		"ControlMaster=auto",
		"-o",
		`ControlPersist=${CONTROL_PERSIST_DURATION}`,
		"-o",
		`ControlPath=${SOCKET_DIR}/%C`,
	];
}

/**
 * Concrete implementation using the system `ssh` binary.
 * Relies on the user's ~/.ssh/config for host resolution, user and key.
 */
export class SystemSSHService implements SSHService {
	async execute(host: string, remoteCommand: string, options: SSHExecuteOptions = {}): Promise<SSHCommandResult> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const maxStdout = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT;
		const maxStderr = options.maxStderrBytes ?? DEFAULT_MAX_STDERR;
		const connectTimeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
		const multiplexingArgs = buildMultiplexingArgs();

		// Arguments passed as an array — NOT interpreted by a local shell.
		const sshArgs: string[] = [
			"-o",
			"BatchMode=yes",
			"-o",
			`ConnectTimeout=${String(connectTimeoutSec)}`,
			"-o",
			"ServerAliveInterval=5",
			"-o",
			"ServerAliveCountMax=2",
			"-o",
			"LogLevel=ERROR",
			...multiplexingArgs,
			// Do NOT add StrictHostKeyChecking=no — let the user's config decide.
			host,
			remoteCommand,
		];

		return new Promise((resolve) => {
			let timedOut = false;
			let stdoutBuf = "";
			let stderrBuf = "";

			// Built incrementally rather than as `{ ..., signal: options.signal }` because
			// exactOptionalPropertyTypes forbids assigning `undefined` to an optional field.
			const execFileOptions: { timeout: number; windowsHide: boolean; signal?: AbortSignal } = {
				timeout: 0,
				windowsHide: true,
			};
			if (options.signal !== undefined) {
				execFileOptions.signal = options.signal;
			}
			const child = execFile("ssh", sshArgs, execFileOptions);

			const timer = setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
				// Give it a moment to die, then force-kill
				setTimeout(() => {
					child.kill("SIGKILL");
				}, 500);
			}, timeoutMs);

			child.stdout?.on("data", (chunk: Buffer | string) => {
				const str = chunk.toString();
				if (stdoutBuf.length < maxStdout) {
					stdoutBuf += str.slice(0, maxStdout - stdoutBuf.length);
				}
			});

			child.stderr?.on("data", (chunk: Buffer | string) => {
				const str = chunk.toString();
				if (stderrBuf.length < maxStderr) {
					stderrBuf += str.slice(0, maxStderr - stderrBuf.length);
				}
			});

			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({
					stdout: stdoutBuf.trim(),
					stderr: stderrBuf.trim(),
					exitCode: code ?? (timedOut ? 124 : 1),
					timedOut,
				});
			});

			child.on("error", (err) => {
				clearTimeout(timer);
				resolve({
					stdout: "",
					stderr: err.message,
					exitCode: 1,
					timedOut: false,
				});
			});
		});
	}
}

/** Singleton instance for production use. */
export const sshService: SSHService = new SystemSSHService();
