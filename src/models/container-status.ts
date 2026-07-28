/**
 * Typed models for remote Docker container status.
 *
 * `RemoteContainerStatus` is the shape every layer above the SSH/Docker
 * boundary works with — actions and renderers never touch raw docker CLI
 * output directly.
 */

/**
 * Shared visual vocabulary for every action's key face. Individual
 * containers use "running"/"healthy"/"unhealthy"/"stopped"/"restarting"/
 * "paused"; Compose stacks use "up"/"partial"/"down" instead (a stack has no
 * single health, just an aggregate of its services). The remaining values
 * (missing/connecting/working/ssh-error/docker-error/unknown) are shared by
 * both, so every action draws from one consistent color+label legend.
 */
export type ContainerVisualStatus =
	| "running"
	| "healthy"
	| "unhealthy"
	| "stopped"
	| "restarting"
	| "paused"
	| "up"
	| "partial"
	| "down"
	| "missing"
	| "connecting"
	| "working"
	| "ssh-error"
	| "docker-error"
	| "unknown";

export interface RemoteContainerStatus {
	name: string;
	visualStatus: ContainerVisualStatus;
	dockerStatus?: string;
	health?: string;
	running: boolean;
	exitCode?: number;
	startedAt?: string;
	finishedAt?: string;
	uptimeSeconds?: number;
	errorMessage?: string;
}

/**
 * Shape of `docker inspect --format '{{json .State}}' <name>` once parsed.
 * Only the fields we actually consume are declared; docker emits more.
 */
export interface DockerInspectState {
	Status?: string;
	Running?: boolean;
	Paused?: boolean;
	Restarting?: boolean;
	Dead?: boolean;
	ExitCode?: number;
	StartedAt?: string;
	FinishedAt?: string;
	Health?: {
		Status?: string;
	};
}
