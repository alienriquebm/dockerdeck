import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SystemRemoteDockerService, deriveVisualStatus } from "./remote-docker-service.js";
import type { SSHService, SSHCommandResult } from "./ssh-service.js";
import type { DockerInspectState } from "../models/container-status.js";

function makeResult(overrides: Partial<SSHCommandResult>): SSHCommandResult {
	return { stdout: "", stderr: "", exitCode: 0, timedOut: false, ...overrides };
}

function makeMockSsh(result: SSHCommandResult): { ssh: SSHService; execute: ReturnType<typeof vi.fn> } {
	const execute = vi.fn().mockResolvedValue(result);
	return { ssh: { execute }, execute };
}

/** For operations that issue more than one SSH call (control command, then re-query status). */
function makeSequencedMockSsh(results: SSHCommandResult[]): { ssh: SSHService; execute: ReturnType<typeof vi.fn> } {
	const execute = vi.fn();
	for (const result of results) {
		execute.mockResolvedValueOnce(result);
	}
	return { ssh: { execute }, execute };
}

describe("deriveVisualStatus", () => {
	it("returns healthy for a running container with a healthy healthcheck", () => {
		const state: DockerInspectState = { Running: true, Health: { Status: "healthy" } };
		expect(deriveVisualStatus(state)).toBe("healthy");
	});

	it("returns unhealthy for a running container with an unhealthy healthcheck", () => {
		const state: DockerInspectState = { Running: true, Health: { Status: "unhealthy" } };
		expect(deriveVisualStatus(state)).toBe("unhealthy");
	});

	it("treats a starting healthcheck as restarting (transitional)", () => {
		const state: DockerInspectState = { Running: true, Health: { Status: "starting" } };
		expect(deriveVisualStatus(state)).toBe("restarting");
	});

	it("returns running for a running container with no healthcheck", () => {
		const state: DockerInspectState = { Running: true };
		expect(deriveVisualStatus(state)).toBe("running");
	});

	it("returns stopped for a non-running, non-paused, non-restarting container", () => {
		const state: DockerInspectState = { Running: false };
		expect(deriveVisualStatus(state)).toBe("stopped");
	});

	it("returns restarting when Restarting is true, regardless of Running", () => {
		const state: DockerInspectState = { Running: true, Restarting: true };
		expect(deriveVisualStatus(state)).toBe("restarting");
	});

	it("returns paused when Paused is true", () => {
		const state: DockerInspectState = { Running: false, Paused: true };
		expect(deriveVisualStatus(state)).toBe("paused");
	});
});

describe("SystemRemoteDockerService.getContainerStatus", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("parses a running, healthy container and computes uptime", async () => {
		const state: DockerInspectState = {
			Status: "running",
			Running: true,
			StartedAt: "2026-07-27T11:00:00Z",
			FinishedAt: "0001-01-01T00:00:00Z",
			Health: { Status: "healthy" },
		};
		const { ssh } = makeMockSsh(makeResult({ stdout: JSON.stringify(state), exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getContainerStatus("docker-server", "backend");

		expect(status.visualStatus).toBe("healthy");
		expect(status.running).toBe(true);
		expect(status.health).toBe("healthy");
		expect(status.uptimeSeconds).toBe(3600);
		expect(status.errorMessage).toBeUndefined();
	});

	it("parses a stopped container without computing uptime", async () => {
		const state: DockerInspectState = {
			Status: "exited",
			Running: false,
			ExitCode: 1,
			StartedAt: "2026-07-27T10:00:00Z",
			FinishedAt: "2026-07-27T11:00:00Z",
		};
		const { ssh } = makeMockSsh(makeResult({ stdout: JSON.stringify(state), exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getContainerStatus("docker-server", "backend");

		expect(status.visualStatus).toBe("stopped");
		expect(status.running).toBe(false);
		expect(status.exitCode).toBe(1);
		expect(status.uptimeSeconds).toBeUndefined();
	});

	it("maps a missing container to visualStatus 'missing'", async () => {
		const { ssh } = makeMockSsh(makeResult({ stdout: "", stderr: "error: no such object: backend", exitCode: 1 }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getContainerStatus("docker-server", "backend");

		expect(status.visualStatus).toBe("missing");
		expect(status.running).toBe(false);
		expect(status.errorMessage).toBe("Container not found.");
	});

	it("maps an SSH-level failure (exit 255) to visualStatus 'ssh-error'", async () => {
		const { ssh } = makeMockSsh(
			makeResult({ stdout: "", stderr: "ssh: Could not resolve hostname docker-server", exitCode: 255 }),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getContainerStatus("docker-server", "backend");

		expect(status.visualStatus).toBe("ssh-error");
		expect(status.errorMessage).toContain("Could not resolve hostname");
	});

	it("maps a timeout to visualStatus 'ssh-error'", async () => {
		const { ssh } = makeMockSsh(makeResult({ stdout: "", stderr: "", exitCode: 124, timedOut: true }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getContainerStatus("docker-server", "backend");

		expect(status.visualStatus).toBe("ssh-error");
		expect(status.errorMessage).toBe("SSH connection timed out.");
	});

	it("maps invalid JSON output to visualStatus 'docker-error'", async () => {
		const { ssh } = makeMockSsh(makeResult({ stdout: "not json", exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getContainerStatus("docker-server", "backend");

		expect(status.visualStatus).toBe("docker-error");
		expect(status.errorMessage).toBe("Received an invalid response from Docker.");
	});

	it("maps a generic docker failure to visualStatus 'docker-error'", async () => {
		const { ssh } = makeMockSsh(
			makeResult({
				stdout: "",
				stderr: "Got permission denied while trying to connect to the Docker daemon socket",
				exitCode: 1,
			}),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getContainerStatus("docker-server", "backend");

		expect(status.visualStatus).toBe("docker-error");
		expect(status.errorMessage).toContain("permission denied");
	});

	it("passes the configured timeout through to the SSH service", async () => {
		const state: DockerInspectState = { Running: true };
		const { ssh, execute } = makeMockSsh(makeResult({ stdout: JSON.stringify(state), exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		await service.getContainerStatus("docker-server", "backend", { timeoutMs: 3000 });

		expect(execute).toHaveBeenCalledWith("docker-server", expect.stringContaining("docker"), {
			timeoutMs: 3000,
		});
	});

	it("builds the inspect command with the container name safely escaped", async () => {
		const state: DockerInspectState = { Running: true };
		const { ssh, execute } = makeMockSsh(makeResult({ stdout: JSON.stringify(state), exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		await service.getContainerStatus("docker-server", "my-backend");

		const [, remoteCommand] = execute.mock.calls[0] as [string, string];
		expect(remoteCommand).toContain("'my-backend'");
		expect(remoteCommand).toContain("--format");
	});
});

describe("SystemRemoteDockerService control operations", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("startContainer runs docker start then re-queries status", async () => {
		const runningState: DockerInspectState = {
			Running: true,
			Status: "running",
			StartedAt: "2026-07-27T12:00:00Z",
		};
		const { ssh, execute } = makeSequencedMockSsh([
			makeResult({ stdout: "", exitCode: 0 }), // docker start
			makeResult({ stdout: JSON.stringify(runningState), exitCode: 0 }), // docker inspect
		]);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.startContainer("docker-server", "backend");

		expect(status.visualStatus).toBe("running");
		expect(status.running).toBe(true);
		expect(execute).toHaveBeenCalledTimes(2);
		const [, startCommand] = execute.mock.calls[0] as [string, string];
		expect(startCommand).toBe("docker 'start' 'backend'");
		const [, inspectCommand] = execute.mock.calls[1] as [string, string];
		expect(inspectCommand).toContain("inspect");
	});

	it("stopContainer runs docker stop then re-queries status", async () => {
		const stoppedState: DockerInspectState = { Running: false, Status: "exited" };
		const { ssh, execute } = makeSequencedMockSsh([
			makeResult({ stdout: "", exitCode: 0 }),
			makeResult({ stdout: JSON.stringify(stoppedState), exitCode: 0 }),
		]);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.stopContainer("docker-server", "backend");

		expect(status.visualStatus).toBe("stopped");
		const [, stopCommand] = execute.mock.calls[0] as [string, string];
		expect(stopCommand).toBe("docker 'stop' 'backend'");
	});

	it("restartContainer runs docker restart then re-queries status", async () => {
		const runningState: DockerInspectState = {
			Running: true,
			Status: "running",
			StartedAt: "2026-07-27T12:00:00Z",
		};
		const { ssh, execute } = makeSequencedMockSsh([
			makeResult({ stdout: "", exitCode: 0 }),
			makeResult({ stdout: JSON.stringify(runningState), exitCode: 0 }),
		]);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.restartContainer("docker-server", "backend");

		expect(status.visualStatus).toBe("running");
		const [, restartCommand] = execute.mock.calls[0] as [string, string];
		expect(restartCommand).toBe("docker 'restart' 'backend'");
	});

	it("does not re-query status when the control command itself fails", async () => {
		const { ssh, execute } = makeMockSsh(
			makeResult({ stdout: "", stderr: "error: no such object: backend", exitCode: 1 }),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.startContainer("docker-server", "backend");

		expect(status.visualStatus).toBe("missing");
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("maps an SSH-level failure during stop to visualStatus 'ssh-error' without re-querying", async () => {
		const { ssh, execute } = makeMockSsh(
			makeResult({ stdout: "", stderr: "ssh: Could not resolve hostname docker-server", exitCode: 255 }),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.stopContainer("docker-server", "backend");

		expect(status.visualStatus).toBe("ssh-error");
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("propagates the timeout option to both the control command and the re-query", async () => {
		const runningState: DockerInspectState = { Running: true };
		const { ssh, execute } = makeSequencedMockSsh([
			makeResult({ stdout: "", exitCode: 0 }),
			makeResult({ stdout: JSON.stringify(runningState), exitCode: 0 }),
		]);
		const service = new SystemRemoteDockerService(ssh);

		await service.startContainer("docker-server", "backend", { timeoutMs: 4000 });

		expect(execute).toHaveBeenNthCalledWith(1, "docker-server", expect.stringContaining("start"), {
			timeoutMs: 4000,
		});
		expect(execute).toHaveBeenNthCalledWith(2, "docker-server", expect.stringContaining("inspect"), {
			timeoutMs: 4000,
		});
	});
});

// Real NDJSON output captured from a live Docker Compose v5.0.2 host.
const REAL_TWO_SERVICE_NDJSON = [
	`{"ID":"62f5d11d151b","Name":"sample-stack-api","Project":"sample-stack","Service":"sample-stack-api","State":"running","Health":""}`,
	`{"ID":"89a663ce869c","Name":"sample-stack-client","Project":"sample-stack","Service":"sample-stack-client","State":"running","Health":""}`,
].join("\n");

describe("SystemRemoteDockerService.getComposeStatus", () => {
	it("returns 'up' when every service is running", async () => {
		const { ssh, execute } = makeMockSsh(makeResult({ stdout: REAL_TWO_SERVICE_NDJSON, exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getComposeStatus("docker-server", "/srv/sample-stack");

		expect(status.visualStatus).toBe("up");
		expect(status.runningCount).toBe(2);
		expect(status.totalCount).toBe(2);
		expect(status.services.map((s) => s.name)).toEqual(["sample-stack-api", "sample-stack-client"]);

		const [, remoteCommand] = execute.mock.calls[0] as [string, string];
		expect(remoteCommand).toBe("cd '/srv/sample-stack' && docker 'compose' 'ps' '-a' '--format' 'json'");
	});

	it("returns 'down' with zero services for an empty ps result (stack fully down)", async () => {
		const { ssh } = makeMockSsh(makeResult({ stdout: "", exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getComposeStatus("docker-server", "/srv/app");

		expect(status.visualStatus).toBe("down");
		expect(status.runningCount).toBe(0);
		expect(status.totalCount).toBe(0);
	});

	it("returns 'partial' when only some services are running", async () => {
		const mixed = [
			`{"Service":"api","State":"running","Health":""}`,
			`{"Service":"worker","State":"exited","Health":""}`,
		].join("\n");
		const { ssh } = makeMockSsh(makeResult({ stdout: mixed, exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getComposeStatus("docker-server", "/srv/app");

		expect(status.visualStatus).toBe("partial");
		expect(status.runningCount).toBe(1);
		expect(status.totalCount).toBe(2);
	});

	it("maps a nonexistent compose path to visualStatus 'missing' (real shell error text)", async () => {
		const { ssh } = makeMockSsh(
			makeResult({ stdout: "", stderr: "zsh:cd:1: no such file or directory: /srv/nope", exitCode: 1 }),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getComposeStatus("docker-server", "/srv/nope");

		expect(status.visualStatus).toBe("missing");
	});

	it("maps a path with no compose file to visualStatus 'missing' (real docker compose error text)", async () => {
		const { ssh } = makeMockSsh(
			makeResult({ stdout: "", stderr: "no configuration file provided: not found", exitCode: 1 }),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getComposeStatus("docker-server", "/srv/empty");

		expect(status.visualStatus).toBe("missing");
	});

	it("maps an SSH-level failure to visualStatus 'ssh-error'", async () => {
		const { ssh } = makeMockSsh(
			makeResult({ stdout: "", stderr: "ssh: Could not resolve hostname docker-host", exitCode: 255 }),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getComposeStatus("docker-server", "/srv/app");

		expect(status.visualStatus).toBe("ssh-error");
	});

	it("maps invalid JSON output to visualStatus 'docker-error'", async () => {
		const { ssh } = makeMockSsh(makeResult({ stdout: "not json", exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getComposeStatus("docker-server", "/srv/app");

		expect(status.visualStatus).toBe("docker-error");
		expect(status.errorMessage).toBe("Received an invalid response from Docker Compose.");
	});

	it("includes -p <projectName> in the command when a project name is configured", async () => {
		const { ssh, execute } = makeMockSsh(makeResult({ stdout: "", exitCode: 0 }));
		const service = new SystemRemoteDockerService(ssh);

		await service.getComposeStatus("docker-server", "/srv/app", { projectName: "my-stack" });

		const [, remoteCommand] = execute.mock.calls[0] as [string, string];
		expect(remoteCommand).toContain("'compose' '-p' 'my-stack' 'ps'");
	});

	it("omits health when the raw Health field is an empty string", async () => {
		const { ssh } = makeMockSsh(
			makeResult({ stdout: `{"Service":"api","State":"running","Health":""}`, exitCode: 0 }),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.getComposeStatus("docker-server", "/srv/app");

		expect(status.services[0]?.health).toBeUndefined();
	});
});

describe("SystemRemoteDockerService compose control operations", () => {
	it("composeUp runs docker compose up -d then re-queries status", async () => {
		const { ssh, execute } = makeSequencedMockSsh([
			makeResult({ stdout: "", exitCode: 0 }),
			makeResult({ stdout: REAL_TWO_SERVICE_NDJSON, exitCode: 0 }),
		]);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.composeUp("docker-server", "/srv/sample-stack");

		expect(status.visualStatus).toBe("up");
		const [, upCommand] = execute.mock.calls[0] as [string, string];
		expect(upCommand).toBe("cd '/srv/sample-stack' && docker 'compose' 'up' '-d'");
	});

	it("composeDown runs docker compose down then re-queries status", async () => {
		const { ssh, execute } = makeSequencedMockSsh([
			makeResult({ stdout: "", exitCode: 0 }),
			makeResult({ stdout: "", exitCode: 0 }),
		]);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.composeDown("docker-server", "/srv/app");

		expect(status.visualStatus).toBe("down");
		const [, downCommand] = execute.mock.calls[0] as [string, string];
		expect(downCommand).toBe("cd '/srv/app' && docker 'compose' 'down'");
	});

	it("composeRestart runs docker compose restart then re-queries status", async () => {
		const { ssh, execute } = makeSequencedMockSsh([
			makeResult({ stdout: "", exitCode: 0 }),
			makeResult({ stdout: REAL_TWO_SERVICE_NDJSON, exitCode: 0 }),
		]);
		const service = new SystemRemoteDockerService(ssh);

		await service.composeRestart("docker-server", "/srv/sample-stack");

		const [, restartCommand] = execute.mock.calls[0] as [string, string];
		expect(restartCommand).toBe("cd '/srv/sample-stack' && docker 'compose' 'restart'");
	});

	it("does not re-query status when the control command itself fails", async () => {
		const { ssh, execute } = makeMockSsh(
			makeResult({ stdout: "", stderr: "no configuration file provided: not found", exitCode: 1 }),
		);
		const service = new SystemRemoteDockerService(ssh);

		const status = await service.composeUp("docker-server", "/srv/app");

		expect(status.visualStatus).toBe("missing");
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("scopes control commands to a project name when configured", async () => {
		const { ssh, execute } = makeSequencedMockSsh([
			makeResult({ stdout: "", exitCode: 0 }),
			makeResult({ stdout: "", exitCode: 0 }),
		]);
		const service = new SystemRemoteDockerService(ssh);

		await service.composeDown("docker-server", "/srv/app", { projectName: "my-stack" });

		const [, downCommand] = execute.mock.calls[0] as [string, string];
		expect(downCommand).toContain("'compose' '-p' 'my-stack' 'down'");
	});
});
