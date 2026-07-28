/**
 * Classifies a failed remote command (ssh + docker) into one of the
 * categories the rest of the plugin understands, with a sanitized message
 * safe to log or show on a key face.
 *
 * SSH itself exits with status 255 for connection/auth-level failures
 * (unresolvable host, connection refused, permission denied, timeout) and
 * otherwise forwards the exact exit code of the remote command. That
 * distinction is what lets us tell "couldn't reach the host" apart from
 * "reached the host, but docker/the container has a problem".
 */

export type RemoteErrorKind = "ssh-error" | "missing" | "docker-error";

export interface ClassifiedError {
	kind: RemoteErrorKind;
	/** Short, sanitized message safe to display or log. */
	message: string;
}

const SSH_EXIT_CODE = 255;
const MAX_MESSAGE_LENGTH = 200;

const CONTAINER_MISSING_PATTERNS = [/no such object/i, /no such container/i];

// Confirmed against a live host: `cd <bad-path> && ...` fails with the
// shell's own "no such file or directory"; a path that exists but has no
// compose file fails with "no configuration file provided: not found".
const COMPOSE_MISSING_PATTERNS = [/no such file or directory/i, /no configuration file provided/i, /not a directory/i];

/**
 * Collapses whitespace and truncates so log/UI output stays bounded and
 * never dumps raw multi-line stack-trace-like content.
 */
function sanitize(message: string): string {
	const collapsed = message.replace(/\s+/g, " ").trim();
	if (collapsed.length === 0) {
		return "Unknown error.";
	}
	return collapsed.length > MAX_MESSAGE_LENGTH ? `${collapsed.slice(0, MAX_MESSAGE_LENGTH)}…` : collapsed;
}

function classify(
	exitCode: number,
	stderr: string,
	timedOut: boolean,
	missingPatterns: RegExp[],
	missingMessage: string,
	genericLabel: string,
): ClassifiedError {
	if (timedOut) {
		return { kind: "ssh-error", message: "SSH connection timed out." };
	}
	if (exitCode === SSH_EXIT_CODE) {
		return { kind: "ssh-error", message: sanitize(stderr || "SSH connection failed.") };
	}
	if (missingPatterns.some((pattern) => pattern.test(stderr))) {
		return { kind: "missing", message: missingMessage };
	}
	return { kind: "docker-error", message: sanitize(stderr || `${genericLabel} (exit code ${exitCode.toString()}).`) };
}

export function classifyCommandError(exitCode: number, stderr: string, timedOut: boolean): ClassifiedError {
	return classify(exitCode, stderr, timedOut, CONTAINER_MISSING_PATTERNS, "Container not found.", "Docker command failed");
}

export function classifyComposeCommandError(exitCode: number, stderr: string, timedOut: boolean): ClassifiedError {
	return classify(exitCode, stderr, timedOut, COMPOSE_MISSING_PATTERNS, "Compose path or file not found.", "Docker Compose command failed");
}
