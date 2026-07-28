/**
 * Visual theme for each container/stack status. Color alone never carries
 * the meaning — every status also gets a distinct short label, so the key
 * face stays readable for colorblind users and at a glance.
 */

import type { ContainerVisualStatus } from "../models/container-status.js";

export interface StatusTheme {
	/** Key face background color. */
	background: string;
	/** Primary text color, chosen for contrast against `background`. */
	foreground: string;
	/** Accent color for the status dot. */
	dotColor: string;
	/** Short, all-caps label shown on the key (e.g. "RUNNING", "SSH ERROR"). */
	label: string;
}

export const STATUS_THEME: Record<ContainerVisualStatus, StatusTheme> = {
	healthy: { background: "#1B8A3D", foreground: "#FFFFFF", dotColor: "#7CFFA0", label: "RUNNING" },
	running: { background: "#2E5339", foreground: "#FFFFFF", dotColor: "#9CCBA6", label: "RUNNING" },
	unhealthy: { background: "#CC5500", foreground: "#FFFFFF", dotColor: "#FFDCA8", label: "UNHEALTHY" },
	stopped: { background: "#C62828", foreground: "#FFFFFF", dotColor: "#FFC1C1", label: "STOPPED" },
	restarting: { background: "#F2B705", foreground: "#1A1A1A", dotColor: "#7A5B00", label: "RESTARTING" },
	paused: { background: "#37474F", foreground: "#FFFFFF", dotColor: "#B0BEC5", label: "PAUSED" },
	// Compose-stack aggregate states — reuse the same hues as their closest
	// per-container equivalent so the whole plugin shares one color legend.
	up: { background: "#1B8A3D", foreground: "#FFFFFF", dotColor: "#7CFFA0", label: "UP" },
	partial: { background: "#F2B705", foreground: "#1A1A1A", dotColor: "#7A5B00", label: "PARTIAL" },
	down: { background: "#C62828", foreground: "#FFFFFF", dotColor: "#FFC1C1", label: "DOWN" },
	missing: { background: "#212121", foreground: "#BDBDBD", dotColor: "#616161", label: "NOT FOUND" },
	connecting: { background: "#616161", foreground: "#FFFFFF", dotColor: "#E0E0E0", label: "CONNECTING" },
	working: { background: "#1565C0", foreground: "#FFFFFF", dotColor: "#9FCBFF", label: "WORKING" },
	"ssh-error": { background: "#4A4A4A", foreground: "#FFCDD2", dotColor: "#FF8A80", label: "SSH ERROR" },
	"docker-error": { background: "#4A4A4A", foreground: "#FFE0B2", dotColor: "#FFB74D", label: "DOCKER ERR" },
	unknown: { background: "#757575", foreground: "#FFFFFF", dotColor: "#E0E0E0", label: "UNKNOWN" },
};
