import { describe, it, expect } from "vitest";
import { classifyCommandError, classifyComposeCommandError } from "./error-mapper.js";

describe("classifyCommandError", () => {
	it("classifies a timeout as ssh-error", () => {
		const result = classifyCommandError(124, "", true);
		expect(result.kind).toBe("ssh-error");
		expect(result.message).toBe("SSH connection timed out.");
	});

	it("classifies exit code 255 as ssh-error", () => {
		const result = classifyCommandError(255, "ssh: Could not resolve hostname foo: nodename nor servname provided", false);
		expect(result.kind).toBe("ssh-error");
		expect(result.message).toContain("Could not resolve hostname");
	});

	it("classifies permission denied as ssh-error", () => {
		const result = classifyCommandError(255, "alienriquebm@host: Permission denied (publickey,password).", false);
		expect(result.kind).toBe("ssh-error");
	});

	it("classifies 'no such object' as missing", () => {
		const result = classifyCommandError(1, "error: no such object: my-container", false);
		expect(result.kind).toBe("missing");
		expect(result.message).toBe("Container not found.");
	});

	it("classifies 'No such container' (legacy casing) as missing", () => {
		const result = classifyCommandError(1, "Error: No such container: my-container", false);
		expect(result.kind).toBe("missing");
	});

	it("classifies any other non-zero exit as docker-error", () => {
		const result = classifyCommandError(1, "Cannot connect to the Docker daemon. Is the docker daemon running?", false);
		expect(result.kind).toBe("docker-error");
		expect(result.message).toContain("Cannot connect to the Docker daemon");
	});

	it("falls back to a generic message when stderr is empty", () => {
		const result = classifyCommandError(1, "", false);
		expect(result.kind).toBe("docker-error");
		expect(result.message).toContain("exit code 1");
	});

	it("collapses whitespace and newlines in the sanitized message", () => {
		const result = classifyCommandError(1, "line one\nline two\n\twith tabs", false);
		expect(result.message).toBe("line one line two with tabs");
	});

	it("truncates very long stderr output", () => {
		const longMessage = "x".repeat(1000);
		const result = classifyCommandError(1, longMessage, false);
		expect(result.message.length).toBeLessThanOrEqual(201);
		expect(result.message.endsWith("…")).toBe(true);
	});

	it("never leaks the raw multi-line stack trace", () => {
		const result = classifyCommandError(1, "Error: boom\n    at Object.<anonymous> (/secret/path/app.js:1:1)", false);
		expect(result.message).not.toContain("\n");
	});
});

describe("classifyComposeCommandError", () => {
	it("classifies a timeout as ssh-error", () => {
		const result = classifyComposeCommandError(124, "", true);
		expect(result.kind).toBe("ssh-error");
	});

	it("classifies exit code 255 as ssh-error", () => {
		const result = classifyComposeCommandError(255, "ssh: Could not resolve hostname docker-host", false);
		expect(result.kind).toBe("ssh-error");
	});

	it("classifies a nonexistent compose path as missing (real shell error text)", () => {
		const result = classifyComposeCommandError(
			1,
			"zsh:cd:1: no such file or directory: /home/user/does-not-exist",
			false,
		);
		expect(result.kind).toBe("missing");
		expect(result.message).toBe("Compose path or file not found.");
	});

	it("classifies a path with no compose file as missing (real docker compose error text)", () => {
		const result = classifyComposeCommandError(1, "no configuration file provided: not found", false);
		expect(result.kind).toBe("missing");
	});

	it("classifies any other non-zero exit as docker-error", () => {
		const result = classifyComposeCommandError(1, "service \"backend\" has neither an image nor a build context", false);
		expect(result.kind).toBe("docker-error");
	});

	it("falls back to a generic compose-specific message when stderr is empty", () => {
		const result = classifyComposeCommandError(1, "", false);
		expect(result.kind).toBe("docker-error");
		expect(result.message).toContain("Docker Compose command failed");
	});
});
