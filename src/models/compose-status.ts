/**
 * Typed models for a remote Docker Compose stack's status.
 */

import type { ContainerVisualStatus } from "./container-status.js";

export interface ComposeServiceStatus {
	name: string;
	/** Raw `State` field from `docker compose ps` (e.g. "running", "exited", "restarting"). */
	state: string;
	health?: string;
}

export interface RemoteComposeStatus {
	composePath: string;
	projectName?: string;
	visualStatus: ContainerVisualStatus;
	services: ComposeServiceStatus[];
	runningCount: number;
	totalCount: number;
	errorMessage?: string;
}

/**
 * Shape of one entry from `docker compose ps --format json`. Only the
 * fields we consume are declared; docker emits many more.
 */
export interface ComposePsEntry {
	Service?: string;
	Name?: string;
	State?: string;
	Health?: string;
}
