import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StatusRefreshService, type RefreshTask } from "./status-refresh-service.js";

describe("StatusRefreshService", () => {
	let service: StatusRefreshService;

	beforeEach(() => {
		vi.useFakeTimers();
		service = new StatusRefreshService();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs the task immediately on start", async () => {
		const task = vi.fn<RefreshTask>().mockResolvedValue(undefined);
		service.start("a", 5, task);
		await vi.advanceTimersByTimeAsync(0);
		expect(task).toHaveBeenCalledTimes(1);
	});

	it("re-runs the task on the configured interval", async () => {
		const task = vi.fn<RefreshTask>().mockResolvedValue(undefined);
		service.start("a", 5, task);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(5000);
		await vi.advanceTimersByTimeAsync(5000);
		expect(task).toHaveBeenCalledTimes(3);
	});

	it("stops firing after stop() is called", async () => {
		const task = vi.fn<RefreshTask>().mockResolvedValue(undefined);
		service.start("a", 5, task);
		await vi.advanceTimersByTimeAsync(0);
		service.stop("a");
		await vi.advanceTimersByTimeAsync(20_000);
		expect(task).toHaveBeenCalledTimes(1);
	});

	it("stop() is a no-op for an instance that was never started", () => {
		expect(() => {
			service.stop("never-started");
		}).not.toThrow();
	});

	it("restarting an instance replaces its timer instead of stacking a new one", async () => {
		const task = vi.fn<RefreshTask>().mockResolvedValue(undefined);
		service.start("a", 5, task);
		await vi.advanceTimersByTimeAsync(0);
		service.start("a", 5, task); // simulate a settings change
		await vi.advanceTimersByTimeAsync(0);

		task.mockClear();
		await vi.advanceTimersByTimeAsync(5000);
		// If the old timer had leaked, task would fire twice per tick.
		expect(task).toHaveBeenCalledTimes(1);
	});

	it("skips a tick if the previous refresh for the same instance is still in flight", async () => {
		let resolveTask: () => void = () => undefined;
		const task = vi.fn<RefreshTask>().mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveTask = resolve;
				}),
		);

		service.start("a", 2, task);
		await vi.advanceTimersByTimeAsync(0);
		expect(task).toHaveBeenCalledTimes(1);

		// Interval fires while the first call is still pending.
		await vi.advanceTimersByTimeAsync(2000);
		expect(task).toHaveBeenCalledTimes(1);

		resolveTask();
		await vi.advanceTimersByTimeAsync(0);

		await vi.advanceTimersByTimeAsync(2000);
		expect(task).toHaveBeenCalledTimes(2);
	});

	it("does not let a rejected task break future refreshes", async () => {
		const task = vi.fn<RefreshTask>().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
		service.start("a", 2, task);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(2000);
		expect(task).toHaveBeenCalledTimes(2);
	});

	it("tracks independent instances separately", async () => {
		const taskA = vi.fn<RefreshTask>().mockResolvedValue(undefined);
		const taskB = vi.fn<RefreshTask>().mockResolvedValue(undefined);
		service.start("a", 5, taskA);
		service.start("b", 5, taskB);
		await vi.advanceTimersByTimeAsync(0);

		service.stop("a");
		await vi.advanceTimersByTimeAsync(5000);

		expect(taskA).toHaveBeenCalledTimes(1);
		expect(taskB).toHaveBeenCalledTimes(2);
	});

	it("refreshNow triggers an out-of-band call without needing the interval to elapse", async () => {
		const task = vi.fn<RefreshTask>().mockResolvedValue(undefined);
		service.refreshNow("a", task);
		await vi.advanceTimersByTimeAsync(0);
		expect(task).toHaveBeenCalledTimes(1);
	});

	it("discards a stale refresh's result when it resolves after a newer refresh already committed", async () => {
		// Regression test: a slow refresh started under old settings must not be
		// able to overwrite a faster refresh started under newer settings, even
		// if the slow one happens to finish later.
		const committed: string[] = [];
		let resolveOld: () => void = () => undefined;

		const oldTask: RefreshTask = (isCurrent) =>
			new Promise<void>((resolve) => {
				resolveOld = () => {
					if (isCurrent()) {
						committed.push("old");
					}
					resolve();
				};
			});

		service.start("a", 5, oldTask);
		await vi.advanceTimersByTimeAsync(0); // old task is now in flight, unresolved

		const newTask: RefreshTask = (isCurrent) => {
			if (isCurrent()) {
				committed.push("new");
			}
			return Promise.resolve();
		};
		service.start("a", 5, newTask); // supersedes the old task while it's still pending
		await vi.advanceTimersByTimeAsync(0); // new task runs to completion

		resolveOld(); // old task finally settles, after the new one already committed
		await vi.advanceTimersByTimeAsync(0);

		expect(committed).toEqual(["new"]);
	});

	it("lets the current generation's own completion clear the in-flight flag even after an older generation was superseded", async () => {
		// Guards against the in-flight Set being cleared by whichever task
		// happens to finish first, rather than by the currently-active one.
		let resolveOld: () => void = () => undefined;
		const oldTask: RefreshTask = () =>
			new Promise<void>((resolve) => {
				resolveOld = resolve;
			});

		service.start("a", 2, oldTask);
		await vi.advanceTimersByTimeAsync(0);

		const newTask = vi.fn<RefreshTask>().mockResolvedValue(undefined);
		service.start("a", 2, newTask); // old task still pending when this supersedes it
		await vi.advanceTimersByTimeAsync(0);
		expect(newTask).toHaveBeenCalledTimes(1);

		resolveOld(); // old task settles after being superseded; must not unblock a duplicate new-generation run
		await vi.advanceTimersByTimeAsync(0);

		newTask.mockClear();
		await vi.advanceTimersByTimeAsync(2000);
		expect(newTask).toHaveBeenCalledTimes(1);
	});
});
