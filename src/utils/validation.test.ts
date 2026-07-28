import { describe, it, expect } from "vitest";
import { validateSshHost, validateContainerName, validateComposePath, validateRefreshInterval } from "./validation.js";

// ---------------------------------------------------------------------------
// validateSshHost
// ---------------------------------------------------------------------------
describe("validateSshHost", () => {
	it("accepts a simple alias", () => {
		expect(validateSshHost("docker-server")).toEqual({ valid: true });
	});

	it("accepts a dotted hostname", () => {
		expect(validateSshHost("server.tailnet.ts.net")).toEqual({ valid: true });
	});

	it("accepts a single alphanumeric character", () => {
		expect(validateSshHost("a")).toEqual({ valid: true });
	});

	it("rejects empty string", () => {
		const r = validateSshHost("");
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.reason).toBe("missing");
	});

	it("rejects undefined", () => {
		expect(validateSshHost(undefined)).toMatchObject({ valid: false, reason: "missing" });
	});

	it("rejects null", () => {
		expect(validateSshHost(null)).toMatchObject({ valid: false, reason: "missing" });
	});

	it("rejects alias starting with hyphen", () => {
		expect(validateSshHost("-bad")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects alias ending with hyphen", () => {
		expect(validateSshHost("bad-")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects alias with spaces", () => {
		expect(validateSshHost("my server")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects alias with shell metacharacters", () => {
		expect(validateSshHost("server;rm -rf /")).toMatchObject({ valid: false, reason: "invalid" });
		expect(validateSshHost("server$(id)")).toMatchObject({ valid: false, reason: "invalid" });
		expect(validateSshHost("server`id`")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects alias exceeding 253 characters", () => {
		expect(validateSshHost("a".repeat(254))).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects non-string value", () => {
		expect(validateSshHost(42)).toMatchObject({ valid: false, reason: "invalid" });
	});
});

// ---------------------------------------------------------------------------
// validateContainerName
// ---------------------------------------------------------------------------
describe("validateContainerName", () => {
	it("accepts a simple name", () => {
		expect(validateContainerName("my-container")).toEqual({ valid: true });
	});

	it("accepts name with dots and underscores", () => {
		expect(validateContainerName("app_v1.0")).toEqual({ valid: true });
	});

	it("rejects empty string", () => {
		expect(validateContainerName("")).toMatchObject({ valid: false, reason: "missing" });
	});

	it("rejects name starting with a hyphen", () => {
		expect(validateContainerName("-bad")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects names with shell metacharacters", () => {
		expect(validateContainerName("name;drop")).toMatchObject({ valid: false, reason: "invalid" });
		expect(validateContainerName("name$(cmd)")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects names with spaces", () => {
		expect(validateContainerName("my container")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects names longer than 255 characters", () => {
		expect(validateContainerName("a".repeat(256))).toMatchObject({ valid: false, reason: "invalid" });
	});
});

// ---------------------------------------------------------------------------
// validateComposePath
// ---------------------------------------------------------------------------
describe("validateComposePath", () => {
	it("accepts a valid absolute path", () => {
		expect(validateComposePath("/srv/projects/myapp")).toEqual({ valid: true });
	});

	it("accepts a path with spaces", () => {
		expect(validateComposePath("/srv/my project/app")).toEqual({ valid: true });
	});

	it("rejects empty string", () => {
		expect(validateComposePath("")).toMatchObject({ valid: false, reason: "missing" });
	});

	it("rejects relative paths", () => {
		expect(validateComposePath("srv/app")).toMatchObject({ valid: false, reason: "invalid" });
		expect(validateComposePath("./app")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects path traversal", () => {
		expect(validateComposePath("/srv/../etc/passwd")).toMatchObject({ valid: false, reason: "invalid" });
		expect(validateComposePath("/srv/app/..")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects paths with null bytes", () => {
		expect(validateComposePath("/srv/app\x00evil")).toMatchObject({ valid: false, reason: "invalid" });
	});
});

// ---------------------------------------------------------------------------
// validateRefreshInterval
// ---------------------------------------------------------------------------
describe("validateRefreshInterval", () => {
	it("accepts minimum value of 2", () => {
		expect(validateRefreshInterval(2)).toEqual({ valid: true });
	});

	it("accepts default value of 5", () => {
		expect(validateRefreshInterval(5)).toEqual({ valid: true });
	});

	it("accepts string number", () => {
		expect(validateRefreshInterval("10")).toEqual({ valid: true });
	});

	it("rejects value below 2", () => {
		expect(validateRefreshInterval(1)).toMatchObject({ valid: false, reason: "invalid" });
		expect(validateRefreshInterval(0)).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects value above 3600", () => {
		expect(validateRefreshInterval(3601)).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects non-numeric string", () => {
		expect(validateRefreshInterval("fast")).toMatchObject({ valid: false, reason: "invalid" });
	});

	it("rejects undefined", () => {
		expect(validateRefreshInterval(undefined)).toMatchObject({ valid: false, reason: "missing" });
	});
});
