/**
 * Persisted settings shapes for each action, as configured through the
 * Property Inspector. All fields are optional because Stream Deck delivers
 * an empty settings object before the user has configured anything.
 *
 * Declared as `type` (not `interface`) so it structurally satisfies the SDK's
 * `JsonObject` constraint without needing an explicit index signature.
 */

export type ContainerActionSettings = {
	sshHost?: string;
	containerName?: string;
	refreshIntervalSeconds?: number;
	sshTimeoutSeconds?: number;
	showHealth?: boolean;
	showUptime?: boolean;
};

/** Settings for Container Toggle: same as the base plus the stop-confirmation preference. */
export type ContainerToggleSettings = {
	sshHost?: string;
	containerName?: string;
	refreshIntervalSeconds?: number;
	sshTimeoutSeconds?: number;
	showHealth?: boolean;
	showUptime?: boolean;
	/** Require a second press within a few seconds before stopping a running container. Defaults to true. */
	confirmBeforeStop?: boolean;
};

export type ComposeOperation = "toggle" | "up" | "down" | "restart";

/** Settings for Docker Compose Stack. */
export type ComposeActionSettings = {
	sshHost?: string;
	composePath?: string;
	projectName?: string;
	operation?: ComposeOperation;
	refreshIntervalSeconds?: number;
	sshTimeoutSeconds?: number;
};

export const MIN_REFRESH_INTERVAL_SECONDS = 2;
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 5;
export const DEFAULT_SSH_TIMEOUT_SECONDS = 10;

export function resolveRefreshIntervalSeconds(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return DEFAULT_REFRESH_INTERVAL_SECONDS;
	}
	return Math.max(MIN_REFRESH_INTERVAL_SECONDS, value);
}

export function resolveSshTimeoutSeconds(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_SSH_TIMEOUT_SECONDS;
	}
	return value;
}
