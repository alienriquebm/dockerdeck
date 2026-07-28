/**
 * Input validation utilities.
 * All validators return a typed result so callers can distinguish
 * "missing" from "invalid" and show the right error message on the key.
 *
 * Messages are kept to ~16 characters on purpose: this is the only place
 * they're shown (the key face's subtitle line), which hard-truncates at 16
 * chars (`svg-templates.ts`'s `MAX_LINE_LENGTH`). A full sentence here would
 * get chopped to an identical, undiagnosable fragment for every reason case.
 */

export type ValidationResult =
	| { valid: true }
	| { valid: false; reason: "missing" | "invalid"; message: string };

/**
 * SSH host alias characters: alphanumeric, hyphen, underscore, dot.
 * Must not start or end with a hyphen.
 * Max 253 characters (DNS hostname limit).
 */
const SSH_HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,251}[a-zA-Z0-9])?$/;

/**
 * Docker container names: alphanumeric, hyphen, underscore, dot.
 * Must start with alphanumeric. Max 255 characters.
 */
const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/;

/**
 * Absolute Unix path: starts with /, no double-dots traversal.
 * Max 4096 characters. Null bytes are rejected separately (see below) so this
 * pattern never needs a literal control-character escape.
 */
const ABSOLUTE_PATH_RE = /^\/[\s\S]{0,4094}$/;

export function validateSshHost(value: unknown): ValidationResult {
	if (value === undefined || value === null || value === "") {
		return { valid: false, reason: "missing", message: "Host required" };
	}
	if (typeof value !== "string") {
		return { valid: false, reason: "invalid", message: "Invalid host" };
	}
	if (value.length > 253) {
		return { valid: false, reason: "invalid", message: "Host too long" };
	}
	if (!SSH_HOST_RE.test(value)) {
		return { valid: false, reason: "invalid", message: "Invalid host" };
	}
	return { valid: true };
}

export function validateContainerName(value: unknown): ValidationResult {
	if (value === undefined || value === null || value === "") {
		return { valid: false, reason: "missing", message: "Name required" };
	}
	if (typeof value !== "string") {
		return { valid: false, reason: "invalid", message: "Invalid name" };
	}
	if (value.length > 255) {
		return { valid: false, reason: "invalid", message: "Name too long" };
	}
	if (!CONTAINER_NAME_RE.test(value)) {
		return { valid: false, reason: "invalid", message: "Invalid name" };
	}
	return { valid: true };
}

export function validateComposePath(value: unknown): ValidationResult {
	if (value === undefined || value === null || value === "") {
		return { valid: false, reason: "missing", message: "Path required" };
	}
	if (typeof value !== "string") {
		return { valid: false, reason: "invalid", message: "Invalid path" };
	}
	if (value.length > 4096) {
		return { valid: false, reason: "invalid", message: "Path too long" };
	}
	if (value.includes("\x00")) {
		return { valid: false, reason: "invalid", message: "Invalid path" };
	}
	if (!ABSOLUTE_PATH_RE.test(value)) {
		return { valid: false, reason: "invalid", message: "Must be absolute" };
	}
	// Reject path traversal attempts
	if (value.includes("/../") || value.endsWith("/..")) {
		return { valid: false, reason: "invalid", message: "Path traversal" };
	}
	return { valid: true };
}

export function validateRefreshInterval(value: unknown): ValidationResult {
	if (value === undefined || value === null || value === "") {
		return { valid: false, reason: "missing", message: "Refresh interval is required." };
	}
	const n = typeof value === "string" ? Number(value) : value;
	if (typeof n !== "number" || !Number.isFinite(n)) {
		return { valid: false, reason: "invalid", message: "Refresh interval must be a number." };
	}
	if (n < 2) {
		return { valid: false, reason: "invalid", message: "Refresh interval must be at least 2 seconds." };
	}
	if (n > 3600) {
		return { valid: false, reason: "invalid", message: "Refresh interval must not exceed 3600 seconds." };
	}
	return { valid: true };
}
