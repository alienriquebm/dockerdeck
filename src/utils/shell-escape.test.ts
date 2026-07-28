import { describe, it, expect } from "vitest";
import { shellEscapeArg, buildRemoteCommand, buildRemoteCommandInDir } from "./shell-escape.js";

// ---------------------------------------------------------------------------
// shellEscapeArg
// ---------------------------------------------------------------------------
describe("shellEscapeArg", () => {
	it("wraps a simple string in single quotes", () => {
		expect(shellEscapeArg("hello")).toBe("'hello'");
	});

	it("escapes an embedded single quote", () => {
		// foo'bar  →  'foo'\''bar'
		expect(shellEscapeArg("foo'bar")).toBe("'foo'\\''bar'");
	});

	it("escapes multiple single quotes", () => {
		expect(shellEscapeArg("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
	});

	it("safely wraps a string with shell metacharacters", () => {
		const dangerous = "$(rm -rf /)";
		const escaped = shellEscapeArg(dangerous);
		// Must be wrapped in single quotes so $ is never interpreted
		expect(escaped).toMatch(/^'.*'$/);
		expect(escaped).toBe("'$(rm -rf /)'");
	});

	it("safely wraps backticks", () => {
		expect(shellEscapeArg("`id`")).toBe("'`id`'");
	});

	it("safely wraps semicolons and pipes", () => {
		expect(shellEscapeArg("a;b|c")).toBe("'a;b|c'");
	});

	it("safely wraps double quotes", () => {
		expect(shellEscapeArg('"quoted"')).toBe("'\"quoted\"'");
	});

	it("safely wraps newlines", () => {
		expect(shellEscapeArg("line1\nline2")).toBe("'line1\nline2'");
	});

	it("safely wraps spaces", () => {
		expect(shellEscapeArg("my container")).toBe("'my container'");
	});

	it("throws on null byte", () => {
		expect(() => shellEscapeArg("bad\x00arg")).toThrow("null bytes");
	});

	it("handles empty string", () => {
		expect(shellEscapeArg("")).toBe("''");
	});
});

// ---------------------------------------------------------------------------
// buildRemoteCommand — command injection prevention
// ---------------------------------------------------------------------------
describe("buildRemoteCommand", () => {
	it("builds a simple docker command", () => {
		expect(buildRemoteCommand("docker", ["start", "my-container"])).toBe("docker 'start' 'my-container'");
	});

	it("prevents injection via container name", () => {
		const malicious = "x'; rm -rf / ; echo '";
		const result = buildRemoteCommand("docker", ["start", malicious]);
		// The full result must be a properly single-quoted expression.
		// The literal chars appear inside quotes — they are NOT executable shell tokens.
		// Verify the dangerous arg is fully enclosed in single-quote escaping.
		const escapedArg = shellEscapeArg(malicious);
		expect(result).toBe(`docker 'start' ${escapedArg}`);
		// The result must start and end the arg with single quotes so
		// a POSIX shell treats it as one safe literal argument.
		expect(escapedArg).toMatch(/^'.*'$/s);
	});

	it("handles container name with subshell attempt", () => {
		const result = buildRemoteCommand("docker", ["inspect", "$(cat /etc/passwd)"]);
		// $ must be inside single quotes
		expect(result).toContain("'$(cat /etc/passwd)'");
	});

	it("handles empty args list", () => {
		expect(buildRemoteCommand("docker", [])).toBe("docker");
	});
});

// ---------------------------------------------------------------------------
// buildRemoteCommandInDir
// ---------------------------------------------------------------------------
describe("buildRemoteCommandInDir", () => {
	it("builds a cd && command correctly", () => {
		const result = buildRemoteCommandInDir("/srv/app", "docker", ["compose", "up", "-d"]);
		expect(result).toBe("cd '/srv/app' && docker 'compose' 'up' '-d'");
	});

	it("safely escapes a path with spaces", () => {
		const result = buildRemoteCommandInDir("/srv/my app", "docker", ["compose", "ps"]);
		expect(result).toBe("cd '/srv/my app' && docker 'compose' 'ps'");
	});

	it("safely escapes a path with a single quote", () => {
		const result = buildRemoteCommandInDir("/srv/it's-app", "docker", ["compose", "down"]);
		expect(result).toContain("cd '/srv/it'\\''s-app'");
	});

	it("prevents injection via path", () => {
		const malicious = "/srv/app'; rm -rf /";
		const result = buildRemoteCommandInDir(malicious, "docker", ["compose", "up", "-d"]);
		// The malicious text is expected to appear literally, but only as a fully
		// quoted argument — never as a second, executable shell command.
		expect(result).toBe(`cd ${shellEscapeArg(malicious)} && docker 'compose' 'up' '-d'`);
	});
});
