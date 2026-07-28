import { describe, it, expect } from "vitest";
import {
	DEFAULT_REFRESH_INTERVAL_SECONDS,
	DEFAULT_SSH_TIMEOUT_SECONDS,
	MIN_REFRESH_INTERVAL_SECONDS,
	resolveRefreshIntervalSeconds,
	resolveSshTimeoutSeconds,
} from "./settings.js";

describe("resolveRefreshIntervalSeconds", () => {
	it("returns the default when undefined", () => {
		expect(resolveRefreshIntervalSeconds(undefined)).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
	});

	it("returns the default when not finite", () => {
		expect(resolveRefreshIntervalSeconds(Number.NaN)).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
	});

	it("passes through a value at or above the minimum", () => {
		expect(resolveRefreshIntervalSeconds(10)).toBe(10);
	});

	it("clamps a value below the minimum up to the minimum", () => {
		expect(resolveRefreshIntervalSeconds(0.5)).toBe(MIN_REFRESH_INTERVAL_SECONDS);
	});
});

describe("resolveSshTimeoutSeconds", () => {
	it("returns the default when undefined", () => {
		expect(resolveSshTimeoutSeconds(undefined)).toBe(DEFAULT_SSH_TIMEOUT_SECONDS);
	});

	it("returns the default for zero or negative values", () => {
		expect(resolveSshTimeoutSeconds(0)).toBe(DEFAULT_SSH_TIMEOUT_SECONDS);
		expect(resolveSshTimeoutSeconds(-5)).toBe(DEFAULT_SSH_TIMEOUT_SECONDS);
	});

	it("passes through a positive value", () => {
		expect(resolveSshTimeoutSeconds(15)).toBe(15);
	});
});
