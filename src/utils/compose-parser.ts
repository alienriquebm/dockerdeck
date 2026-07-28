/**
 * Parses `docker compose ps --format json` output.
 *
 * Compatibility note (confirmed against a real Docker Compose v5.0.2
 * install): with a single service, the command prints one bare JSON object;
 * with multiple services, it prints one JSON object PER LINE (NDJSON) —
 * never a single wrapping `[...]` array. Older Compose versions are
 * documented to emit a genuine JSON array instead. This parser accepts
 * whichever shape is thrown at it, and only ever throws if a line is not
 * valid JSON at all, so the caller can map that to a clear "invalid
 * response" error rather than silently showing wrong data.
 */

import type { ComposePsEntry } from "../models/compose-status.js";

export function parseComposePsOutput(stdout: string): ComposePsEntry[] {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) {
		return [];
	}

	// A single JSON value covers both "one JSON array" (older Compose) and
	// "one bare object" (a single-service NDJSON stream).
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			return parsed as ComposePsEntry[];
		}
		if (typeof parsed === "object" && parsed !== null) {
			return [parsed];
		}
	} catch {
		// Not a single JSON value — fall through to NDJSON parsing.
	}

	return trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as ComposePsEntry);
}

/**
 * Aggregates per-service state into one visual status for the stack:
 * all running -> "up", none running -> "down", a mix -> "partial".
 * An empty service list (nothing ever brought up, or fully torn down via
 * `compose down`) is treated as "down".
 */
export function deriveComposeVisualStatus(runningCount: number, totalCount: number): "up" | "partial" | "down" {
	if (totalCount === 0 || runningCount === 0) {
		return "down";
	}
	if (runningCount === totalCount) {
		return "up";
	}
	return "partial";
}
