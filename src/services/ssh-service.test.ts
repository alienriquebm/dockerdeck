import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { SystemSSHService } from "./ssh-service.js";

// `execFile` is imported by ssh-service.ts as a named export of node:child_process.
// Vitest cannot spy on a live ESM binding directly (the module namespace is
// non-configurable), so the module is mocked wholesale and the mock is
// reset/configured per test via vi.mocked().
vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

// Same reasoning for node:fs's `mkdirSync` (used to create the ControlPath socket dir):
// avoid ever touching the real filesystem from a unit test.
vi.mock("node:fs", () => ({
	mkdirSync: vi.fn(),
}));

const mkdirMock = vi.mocked(mkdirSync);

function setPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value: platform });
}

// ---------------------------------------------------------------------------
// Helpers to create a fake child process
// ---------------------------------------------------------------------------

interface FakeChildProcess extends EventEmitter {
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChildProcess {
	const child = new EventEmitter() as FakeChildProcess;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = vi.fn();
	return child;
}

const execFileMock = vi.mocked(execFile);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SystemSSHService", () => {
	const originalPlatform = process.platform;

	beforeEach(() => {
		execFileMock.mockReset();
		mkdirMock.mockReset();
		mkdirMock.mockReturnValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		setPlatform(originalPlatform);
	});

	it("resolves with stdout and exit code 0 on success", async () => {
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "docker version");

		fakeChild.stdout.emit("data", "Docker 24.0.0\n");
		fakeChild.emit("close", 0);

		const result = await promise;
		expect(result.stdout).toBe("Docker 24.0.0");
		expect(result.exitCode).toBe(0);
		expect(result.timedOut).toBe(false);
	});

	it("resolves with stderr and non-zero exit code on failure", async () => {
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "docker start missing-container");

		fakeChild.stderr.emit("data", "Error: No such container\n");
		fakeChild.emit("close", 1);

		const result = await promise;
		expect(result.stderr).toBe("Error: No such container");
		expect(result.exitCode).toBe(1);
		expect(result.timedOut).toBe(false);
	});

	it("marks timedOut when process is killed after timeout", async () => {
		vi.useFakeTimers();
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "sleep 60", { timeoutMs: 5000 });

		// Advance time past timeout
		vi.advanceTimersByTime(5001);
		// Simulate process being killed
		fakeChild.emit("close", null);

		const result = await promise;
		expect(result.timedOut).toBe(true);
		expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

		vi.useRealTimers();
	});

	it("caps stdout at maxStdoutBytes", async () => {
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "cat /large-file", { maxStdoutBytes: 10 });

		fakeChild.stdout.emit("data", "A".repeat(100));
		fakeChild.emit("close", 0);

		const result = await promise;
		expect(result.stdout.length).toBeLessThanOrEqual(10);
	});

	it("caps stderr at maxStderrBytes", async () => {
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "bad-command", { maxStderrBytes: 5 });

		fakeChild.stderr.emit("data", "E".repeat(100));
		fakeChild.emit("close", 1);

		const result = await promise;
		expect(result.stderr.length).toBeLessThanOrEqual(5);
	});

	it("resolves with error message when child process errors", async () => {
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("nonexistent-host", "echo hi");

		fakeChild.emit("error", new Error("spawn ssh ENOENT"));

		const result = await promise;
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("spawn ssh ENOENT");
		expect(result.timedOut).toBe(false);
	});

	it("uses BatchMode=yes in ssh arguments", async () => {
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "echo hi");
		fakeChild.emit("close", 0);
		await promise;

		const [cmd, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
		expect(cmd).toBe("ssh");
		expect(args).toContain("BatchMode=yes");
		expect(args).toContain("docker-server");
	});

	it("passes the remote command as the last argument", async () => {
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const remoteCmd = "docker inspect --format '{{json .State}}' my-container";
		const promise = service.execute("docker-server", remoteCmd);
		fakeChild.emit("close", 0);
		await promise;

		const [, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
		expect(args[args.length - 1]).toBe(remoteCmd);
	});

	it("accumulates chunked stdout correctly", async () => {
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "echo test");

		fakeChild.stdout.emit("data", "hel");
		fakeChild.stdout.emit("data", "lo");
		fakeChild.emit("close", 0);

		const result = await promise;
		expect(result.stdout).toBe("hello");
	});

	it("adds ControlMaster/ControlPersist/ControlPath options on non-Windows platforms", async () => {
		setPlatform("darwin");
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "echo hi");
		fakeChild.emit("close", 0);
		await promise;

		expect(mkdirMock).toHaveBeenCalledWith("/tmp/dockerdeck-ssh", { recursive: true, mode: 0o700 });

		const [, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
		expect(args).toContain("ControlMaster=auto");
		expect(args).toContain("ControlPersist=60s");
		expect(args).toContain("ControlPath=/tmp/dockerdeck-ssh/%C");
	});

	it("does not add multiplexing options on Windows", async () => {
		setPlatform("win32");
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "echo hi");
		fakeChild.emit("close", 0);
		await promise;

		expect(mkdirMock).not.toHaveBeenCalled();

		const [, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
		expect(args.join(" ")).not.toContain("ControlMaster");
		expect(args.join(" ")).not.toContain("ControlPersist");
		expect(args.join(" ")).not.toContain("ControlPath");
	});

	it("falls back to a plain connection when the socket directory can't be created", async () => {
		setPlatform("darwin");
		mkdirMock.mockImplementation(() => {
			throw new Error("EACCES: permission denied");
		});
		const fakeChild = makeFakeChild();
		execFileMock.mockReturnValue(fakeChild as unknown as ReturnType<typeof execFile>);

		const service = new SystemSSHService();
		const promise = service.execute("docker-server", "echo hi");
		fakeChild.emit("close", 0);
		const result = await promise;

		expect(result.exitCode).toBe(0);
		const [, args] = execFileMock.mock.calls[0] as unknown as [string, string[]];
		expect(args.join(" ")).not.toContain("ControlMaster");
	});
});
