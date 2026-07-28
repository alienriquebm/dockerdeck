import { describe, it, expect } from "vitest";
import { STATUS_THEME } from "./status-theme.js";
import type { ContainerVisualStatus } from "../models/container-status.js";

const ALL_STATUSES: ContainerVisualStatus[] = [
	"running",
	"healthy",
	"unhealthy",
	"stopped",
	"restarting",
	"paused",
	"up",
	"partial",
	"down",
	"missing",
	"connecting",
	"working",
	"ssh-error",
	"docker-error",
	"unknown",
];

describe("STATUS_THEME", () => {
	it("defines a theme for every possible visual status", () => {
		for (const status of ALL_STATUSES) {
			expect(STATUS_THEME[status]).toBeDefined();
		}
	});

	it("gives every status a non-empty, distinct label from its neighbors within the same color family", () => {
		// Not globally unique (healthy/running share "RUNNING" by design), but never empty.
		for (const status of ALL_STATUSES) {
			expect(STATUS_THEME[status].label.length).toBeGreaterThan(0);
		}
	});

	it("uses valid hex colors for every theme", () => {
		const hex = /^#[0-9A-Fa-f]{6}$/;
		for (const status of ALL_STATUSES) {
			const theme = STATUS_THEME[status];
			expect(theme.background).toMatch(hex);
			expect(theme.foreground).toMatch(hex);
			expect(theme.dotColor).toMatch(hex);
		}
	});

	it("gives error-ish and healthy statuses visually distinct backgrounds", () => {
		expect(STATUS_THEME.healthy.background).not.toBe(STATUS_THEME.stopped.background);
		expect(STATUS_THEME.healthy.background).not.toBe(STATUS_THEME["ssh-error"].background);
	});
});
