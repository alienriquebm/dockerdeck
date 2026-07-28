/**
 * POSIX shell argument escaping for remote commands sent over SSH.
 *
 * The SSH client receives a single string and passes it to the remote shell.
 * We must escape every argument individually using single-quote wrapping,
 * which is the safest POSIX method: no characters are interpreted inside
 * single quotes, except the single quote itself.
 *
 * Strategy: wrap in single quotes and replace every embedded single quote
 * with: '\''  (end quote, escaped quote, reopen quote)
 *
 * Example:  foo'bar  →  'foo'\''bar'
 *
 * NEVER use this for local arguments passed to execFile/spawn — those
 * accept arrays of strings and require no shell escaping at all.
 */

/**
 * Escapes a single argument for safe embedding in a POSIX shell command string.
 * Rejects strings containing null bytes, which are never valid in shell arguments.
 */
export function shellEscapeArg(arg: string): string {
	if (arg.includes("\x00")) {
		throw new Error("Argument must not contain null bytes.");
	}
	// Wrap in single quotes; replace any embedded ' with '\''
	return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Builds a remote command string from a command and its arguments,
 * safely escaping each argument for POSIX shell execution.
 *
 * @example
 * buildRemoteCommand("docker", ["start", "my-container"])
 * // → "docker 'my-container'"  (start is safe but still escaped)
 */
export function buildRemoteCommand(command: string, args: string[]): string {
	const parts = [command, ...args.map(shellEscapeArg)];
	return parts.join(" ");
}

/**
 * Builds a `cd <path> && <command> <args>` remote command.
 * Both the path and each arg are individually shell-escaped.
 */
export function buildRemoteCommandInDir(dir: string, command: string, args: string[]): string {
	const cdPart = `cd ${shellEscapeArg(dir)}`;
	const cmdPart = buildRemoteCommand(command, args);
	return `${cdPart} && ${cmdPart}`;
}
