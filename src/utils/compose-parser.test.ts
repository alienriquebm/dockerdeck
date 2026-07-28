import { describe, it, expect } from "vitest";
import { parseComposePsOutput, deriveComposeVisualStatus } from "./compose-parser.js";

// Real single-service output captured from a live Docker Compose v5.0.2 host.
const REAL_SINGLE_SERVICE_LINE = `{"Command":"\\"docker-entrypoint.s…\\"","CreatedAt":"2026-07-06 21:37:01 +0000 UTC","ExitCode":255,"Health":"","ID":"0a6e4cb0b468","Image":"node:24-alpine","Name":"web-app","Networks":"dev-network","Project":"web-app","RunningFor":"3 weeks ago","Service":"web-app","State":"exited","Status":"Exited (255) 7 hours ago"}`;

// Real two-service NDJSON output captured from the same host.
const NDJSON_LINES: [string, string] = [
	`{"ID":"62f5d11d151b","Name":"sample-stack-api","Project":"sample-stack","Service":"sample-stack-api","State":"running","Health":""}`,
	`{"ID":"89a663ce869c","Name":"sample-stack-client","Project":"sample-stack","Service":"sample-stack-client","State":"running","Health":""}`,
];
const REAL_NDJSON_TWO_SERVICES = NDJSON_LINES.join("\n");

describe("parseComposePsOutput", () => {
	it("returns an empty array for empty output (no containers for this project)", () => {
		expect(parseComposePsOutput("")).toEqual([]);
		expect(parseComposePsOutput("   \n  ")).toEqual([]);
	});

	it("parses a single bare JSON object (real single-service output)", () => {
		const entries = parseComposePsOutput(REAL_SINGLE_SERVICE_LINE);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.Service).toBe("web-app");
		expect(entries[0]?.State).toBe("exited");
	});

	it("parses NDJSON — one JSON object per line (real multi-service output)", () => {
		const entries = parseComposePsOutput(REAL_NDJSON_TWO_SERVICES);
		expect(entries).toHaveLength(2);
		expect(entries.map((e) => e.Service)).toEqual(["sample-stack-api", "sample-stack-client"]);
		expect(entries.every((e) => e.State === "running")).toBe(true);
	});

	it("parses a genuine JSON array (older Compose compatibility fallback)", () => {
		const arrayOutput = `[${NDJSON_LINES.join(",")}]`;
		const entries = parseComposePsOutput(arrayOutput);
		expect(entries).toHaveLength(2);
	});

	it("ignores blank lines between NDJSON entries", () => {
		const withBlankLines = `${NDJSON_LINES[0]}\n\n${NDJSON_LINES[1]}\n`;
		const entries = parseComposePsOutput(withBlankLines);
		expect(entries).toHaveLength(2);
	});

	it("throws on a genuinely malformed line, letting the caller map it to a safe error", () => {
		expect(() => parseComposePsOutput("not json at all")).toThrow();
	});

	it("throws if only one line of a multi-line NDJSON stream is malformed", () => {
		const corrupted = `${NDJSON_LINES[0]}\nnot json`;
		expect(() => parseComposePsOutput(corrupted)).toThrow();
	});
});

describe("deriveComposeVisualStatus", () => {
	it("returns 'up' when every service is running", () => {
		expect(deriveComposeVisualStatus(3, 3)).toBe("up");
	});

	it("returns 'down' when no services are running", () => {
		expect(deriveComposeVisualStatus(0, 3)).toBe("down");
	});

	it("returns 'down' when there are no services at all", () => {
		expect(deriveComposeVisualStatus(0, 0)).toBe("down");
	});

	it("returns 'partial' for a mix of running and non-running services", () => {
		expect(deriveComposeVisualStatus(1, 3)).toBe("partial");
	});
});
