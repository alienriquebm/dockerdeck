import { describe, it, expect } from "vitest";
import { isZeroTime, computeUptimeSeconds, formatDuration } from "./duration.js";

describe("isZeroTime", () => {
	it("treats the Go zero time as zero", () => {
		expect(isZeroTime("0001-01-01T00:00:00Z")).toBe(true);
	});

	it("treats undefined as zero", () => {
		expect(isZeroTime(undefined)).toBe(true);
	});

	it("treats empty string as zero", () => {
		expect(isZeroTime("")).toBe(true);
	});

	it("treats a real timestamp as non-zero", () => {
		expect(isZeroTime("2026-07-21T19:36:34.530131902Z")).toBe(false);
	});
});

describe("computeUptimeSeconds", () => {
	const now = new Date("2026-07-27T12:00:00Z");

	it("computes elapsed seconds since startedAt", () => {
		const startedAt = new Date(now.getTime() - 3600_000).toISOString();
		expect(computeUptimeSeconds(startedAt, now)).toBe(3600);
	});

	it("returns undefined for the Go zero time", () => {
		expect(computeUptimeSeconds("0001-01-01T00:00:00Z", now)).toBeUndefined();
	});

	it("returns undefined for undefined input", () => {
		expect(computeUptimeSeconds(undefined, now)).toBeUndefined();
	});

	it("returns undefined for an unparsable timestamp", () => {
		expect(computeUptimeSeconds("not-a-date", now)).toBeUndefined();
	});

	it("returns undefined when startedAt is in the future", () => {
		const future = new Date(now.getTime() + 3600_000).toISOString();
		expect(computeUptimeSeconds(future, now)).toBeUndefined();
	});
});

describe("formatDuration", () => {
	it("formats seconds under a minute", () => {
		expect(formatDuration(45)).toBe("45s");
	});

	it("formats minutes", () => {
		expect(formatDuration(5 * 60)).toBe("5m");
	});

	it("formats hours and minutes", () => {
		expect(formatDuration(2 * 3600 + 43 * 60)).toBe("2h 43m");
	});

	it("formats days and hours", () => {
		expect(formatDuration(3 * 86400 + 5 * 3600)).toBe("3d 5h");
	});

	it("formats exactly one minute", () => {
		expect(formatDuration(60)).toBe("1m");
	});

	it("formats zero seconds", () => {
		expect(formatDuration(0)).toBe("0s");
	});
});
