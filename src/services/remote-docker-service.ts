/**
 * RemoteDockerService — queries and controls container and Docker Compose
 * stack status on a remote host via SSH.
 *
 * Responsibilities: resolve a container's state through `docker inspect` and
 * turn it into a typed, UI-ready RemoteContainerStatus; start/stop/restart a
 * container and report its resulting state; resolve and control a Compose
 * stack's aggregate state via `docker compose ps/up/down/restart`;
 * distinguish SSH-level failures, missing resources, and Docker-level errors
 * throughout.
 */

import { sshService, type SSHCommandResult, type SSHService } from "./ssh-service.js";
import { buildRemoteCommand, buildRemoteCommandInDir } from "../utils/shell-escape.js";
import { computeUptimeSeconds } from "../utils/duration.js";
import { classifyCommandError, classifyComposeCommandError } from "../utils/error-mapper.js";
import { deriveComposeVisualStatus, parseComposePsOutput } from "../utils/compose-parser.js";
import type { ContainerVisualStatus, DockerInspectState, RemoteContainerStatus } from "../models/container-status.js";
import type { ComposeServiceStatus, RemoteComposeStatus } from "../models/compose-status.js";

export interface RemoteDockerServiceOptions {
	timeoutMs?: number;
	/** When aborted, the in-flight `ssh` child process for this call is killed immediately. */
	signal?: AbortSignal;
}

export interface ComposeOptions extends RemoteDockerServiceOptions {
	/** Passed as `docker compose -p <projectName>` when set. */
	projectName?: string;
}

export interface RemoteDockerService {
	getContainerStatus(
		host: string,
		containerName: string,
		options?: RemoteDockerServiceOptions,
	): Promise<RemoteContainerStatus>;
	startContainer(
		host: string,
		containerName: string,
		options?: RemoteDockerServiceOptions,
	): Promise<RemoteContainerStatus>;
	stopContainer(
		host: string,
		containerName: string,
		options?: RemoteDockerServiceOptions,
	): Promise<RemoteContainerStatus>;
	restartContainer(
		host: string,
		containerName: string,
		options?: RemoteDockerServiceOptions,
	): Promise<RemoteContainerStatus>;

	getComposeStatus(host: string, composePath: string, options?: ComposeOptions): Promise<RemoteComposeStatus>;
	composeUp(host: string, composePath: string, options?: ComposeOptions): Promise<RemoteComposeStatus>;
	composeDown(host: string, composePath: string, options?: ComposeOptions): Promise<RemoteComposeStatus>;
	composeRestart(host: string, composePath: string, options?: ComposeOptions): Promise<RemoteComposeStatus>;
}

const INSPECT_STATE_FORMAT = "{{json .State}}";

function sshOptionsFrom(options: RemoteDockerServiceOptions): { timeoutMs?: number; signal?: AbortSignal } {
	const sshOptions: { timeoutMs?: number; signal?: AbortSignal } = {};
	if (options.timeoutMs !== undefined) {
		sshOptions.timeoutMs = options.timeoutMs;
	}
	if (options.signal !== undefined) {
		sshOptions.signal = options.signal;
	}
	return sshOptions;
}

/** Maps a failed SSH/docker command result into an error-shaped RemoteContainerStatus. */
function errorStatus(containerName: string, result: SSHCommandResult): RemoteContainerStatus {
	const classified = classifyCommandError(result.exitCode, result.stderr, result.timedOut);
	return {
		name: containerName,
		visualStatus: classified.kind,
		running: false,
		errorMessage: classified.message,
	};
}

/** Builds `["compose", "-p", projectName, ...subArgs]`, or without `-p` when no project name is configured. */
function composeArgs(projectName: string | undefined, subArgs: string[]): string[] {
	return projectName !== undefined ? ["compose", "-p", projectName, ...subArgs] : ["compose", ...subArgs];
}

/** Builds a RemoteComposeStatus, only setting `projectName` when present (exactOptionalPropertyTypes). */
function composeStatus(
	composePath: string,
	projectName: string | undefined,
	visualStatus: ContainerVisualStatus,
	services: ComposeServiceStatus[],
	errorMessage?: string,
): RemoteComposeStatus {
	const runningCount = services.filter((service) => service.state === "running").length;
	const status: RemoteComposeStatus = {
		composePath,
		visualStatus,
		services,
		runningCount,
		totalCount: services.length,
	};
	if (projectName !== undefined) {
		status.projectName = projectName;
	}
	if (errorMessage !== undefined) {
		status.errorMessage = errorMessage;
	}
	return status;
}

/** Maps a failed SSH/docker compose command result into an error-shaped RemoteComposeStatus. */
function composeErrorStatus(
	composePath: string,
	projectName: string | undefined,
	result: SSHCommandResult,
): RemoteComposeStatus {
	const classified = classifyComposeCommandError(result.exitCode, result.stderr, result.timedOut);
	return composeStatus(composePath, projectName, classified.kind, [], classified.message);
}

/**
 * Derives the visual status purely from the parsed `.State` object.
 * Exported separately so it can be unit tested without going through SSH.
 */
export function deriveVisualStatus(state: DockerInspectState): ContainerVisualStatus {
	if (state.Restarting) {
		return "restarting";
	}
	if (state.Paused) {
		return "paused";
	}
	if (!state.Running) {
		return "stopped";
	}

	const health = state.Health?.Status;
	if (health === "healthy") {
		return "healthy";
	}
	if (health === "unhealthy") {
		return "unhealthy";
	}
	if (health === "starting") {
		// Treat the healthcheck warm-up window like a transitional state.
		return "restarting";
	}
	return "running";
}

export class SystemRemoteDockerService implements RemoteDockerService {
	constructor(private readonly ssh: SSHService = sshService) {}

	async getContainerStatus(
		host: string,
		containerName: string,
		options: RemoteDockerServiceOptions = {},
	): Promise<RemoteContainerStatus> {
		const remoteCommand = buildRemoteCommand("docker", [
			"inspect",
			"--format",
			INSPECT_STATE_FORMAT,
			containerName,
		]);
		const result = await this.ssh.execute(host, remoteCommand, sshOptionsFrom(options));

		if (result.timedOut || result.exitCode !== 0) {
			return errorStatus(containerName, result);
		}

		let state: DockerInspectState;
		try {
			state = JSON.parse(result.stdout) as DockerInspectState;
		} catch {
			return {
				name: containerName,
				visualStatus: "docker-error",
				running: false,
				errorMessage: "Received an invalid response from Docker.",
			};
		}

		const running = state.Running ?? false;

		// Built incrementally (rather than as a single object literal) because
		// exactOptionalPropertyTypes forbids assigning `undefined` to an
		// optional field — each field is only set when actually present.
		const status: RemoteContainerStatus = {
			name: containerName,
			visualStatus: deriveVisualStatus(state),
			running,
		};
		if (state.Status !== undefined) {
			status.dockerStatus = state.Status;
		}
		if (state.Health?.Status !== undefined) {
			status.health = state.Health.Status;
		}
		if (state.ExitCode !== undefined) {
			status.exitCode = state.ExitCode;
		}
		if (state.StartedAt !== undefined) {
			status.startedAt = state.StartedAt;
		}
		if (state.FinishedAt !== undefined) {
			status.finishedAt = state.FinishedAt;
		}
		if (running) {
			const uptimeSeconds = computeUptimeSeconds(state.StartedAt);
			if (uptimeSeconds !== undefined) {
				status.uptimeSeconds = uptimeSeconds;
			}
		}
		return status;
	}

	async startContainer(
		host: string,
		containerName: string,
		options: RemoteDockerServiceOptions = {},
	): Promise<RemoteContainerStatus> {
		return this.runControlCommand(host, ["start", containerName], containerName, options);
	}

	async stopContainer(
		host: string,
		containerName: string,
		options: RemoteDockerServiceOptions = {},
	): Promise<RemoteContainerStatus> {
		return this.runControlCommand(host, ["stop", containerName], containerName, options);
	}

	async restartContainer(
		host: string,
		containerName: string,
		options: RemoteDockerServiceOptions = {},
	): Promise<RemoteContainerStatus> {
		return this.runControlCommand(host, ["restart", containerName], containerName, options);
	}

	/**
	 * Runs a docker start/stop/restart command, then re-queries the
	 * container's state so the caller always gets the post-operation status
	 * rather than docker's terse command output.
	 */
	private async runControlCommand(
		host: string,
		dockerArgs: string[],
		containerName: string,
		options: RemoteDockerServiceOptions,
	): Promise<RemoteContainerStatus> {
		const remoteCommand = buildRemoteCommand("docker", dockerArgs);
		const result = await this.ssh.execute(host, remoteCommand, sshOptionsFrom(options));

		if (result.timedOut || result.exitCode !== 0) {
			return errorStatus(containerName, result);
		}

		return this.getContainerStatus(host, containerName, options);
	}

	async getComposeStatus(
		host: string,
		composePath: string,
		options: ComposeOptions = {},
	): Promise<RemoteComposeStatus> {
		const args = composeArgs(options.projectName, ["ps", "-a", "--format", "json"]);
		const remoteCommand = buildRemoteCommandInDir(composePath, "docker", args);
		const result = await this.ssh.execute(host, remoteCommand, sshOptionsFrom(options));

		if (result.timedOut || result.exitCode !== 0) {
			return composeErrorStatus(composePath, options.projectName, result);
		}

		let services: ComposeServiceStatus[];
		try {
			services = parseComposePsOutput(result.stdout).map((entry) => {
				const service: ComposeServiceStatus = {
					name: entry.Service ?? entry.Name ?? "unknown",
					state: entry.State ?? "unknown",
				};
				if (entry.Health !== undefined && entry.Health !== "") {
					service.health = entry.Health;
				}
				return service;
			});
		} catch {
			return composeStatus(
				composePath,
				options.projectName,
				"docker-error",
				[],
				"Received an invalid response from Docker Compose.",
			);
		}

		const runningCount = services.filter((service) => service.state === "running").length;
		return composeStatus(
			composePath,
			options.projectName,
			deriveComposeVisualStatus(runningCount, services.length),
			services,
		);
	}

	async composeUp(host: string, composePath: string, options: ComposeOptions = {}): Promise<RemoteComposeStatus> {
		return this.runComposeControlCommand(host, composePath, ["up", "-d"], options);
	}

	async composeDown(host: string, composePath: string, options: ComposeOptions = {}): Promise<RemoteComposeStatus> {
		return this.runComposeControlCommand(host, composePath, ["down"], options);
	}

	async composeRestart(
		host: string,
		composePath: string,
		options: ComposeOptions = {},
	): Promise<RemoteComposeStatus> {
		return this.runComposeControlCommand(host, composePath, ["restart"], options);
	}

	/**
	 * Runs a docker compose up/down/restart command, then re-queries the
	 * stack's state so the caller always gets the post-operation status.
	 */
	private async runComposeControlCommand(
		host: string,
		composePath: string,
		subArgs: string[],
		options: ComposeOptions,
	): Promise<RemoteComposeStatus> {
		const args = composeArgs(options.projectName, subArgs);
		const remoteCommand = buildRemoteCommandInDir(composePath, "docker", args);
		const result = await this.ssh.execute(host, remoteCommand, sshOptionsFrom(options));

		if (result.timedOut || result.exitCode !== 0) {
			return composeErrorStatus(composePath, options.projectName, result);
		}

		return this.getComposeStatus(host, composePath, options);
	}
}

/** Singleton instance for production use. */
export const remoteDockerService: RemoteDockerService = new SystemRemoteDockerService();
