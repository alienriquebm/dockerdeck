/**
 * StatusRefreshService — drives the periodic polling for every action
 * instance (keyed by its Stream Deck action id).
 *
 * Responsibilities:
 * - Fire an immediate refresh when an instance starts polling.
 * - Poll on a fixed interval afterwards.
 * - Never run two refreshes concurrently for the same instance — if a
 *   refresh is still in flight when the next tick fires, that tick is
 *   skipped rather than queued.
 * - Restarting an already-running instance (e.g. settings changed) replaces
 *   its timer instead of stacking a second one, AND invalidates whatever
 *   refresh from the previous epoch may still be in flight: a slow SSH call
 *   started under old settings must not be allowed to render its result
 *   after a faster, newer refresh already has. Each task receives an
 *   `isCurrent()` guard it should check right before committing a visible
 *   side effect (e.g. `setImage`), and skip rendering if it is stale.
 */

export type RefreshTask = (isCurrent: () => boolean) => Promise<void>;

export class StatusRefreshService {
	private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
	private readonly inFlight = new Set<string>();
	private readonly generations = new Map<string, number>();

	/**
	 * Starts (or restarts) polling for `instanceId`. Runs `task` once
	 * immediately, then every `intervalSeconds`.
	 */
	start(instanceId: string, intervalSeconds: number, task: RefreshTask): void {
		this.stop(instanceId);

		const generation = this.generations.get(instanceId) ?? 0;
		const isCurrent = (): boolean => this.generations.get(instanceId) === generation;

		const intervalMs = Math.max(intervalSeconds, 1) * 1000;
		this.runOnce(instanceId, task, isCurrent);

		const timer = setInterval(() => {
			this.runOnce(instanceId, task, isCurrent);
		}, intervalMs);
		this.timers.set(instanceId, timer);
	}

	/** Stops polling for `instanceId`. Safe to call even if it was never started. */
	stop(instanceId: string): void {
		const timer = this.timers.get(instanceId);
		if (timer !== undefined) {
			clearInterval(timer);
			this.timers.delete(instanceId);
		}
		this.inFlight.delete(instanceId);
		// Bump the epoch so any refresh still in flight from before this stop()
		// sees isCurrent() === false and discards its (now stale) result.
		this.generations.set(instanceId, (this.generations.get(instanceId) ?? 0) + 1);
	}

	/** Triggers an out-of-band refresh (e.g. right after a user-initiated action) without touching the timer. */
	refreshNow(instanceId: string, task: RefreshTask): void {
		// Ensure the map has an explicit entry for a never-started instanceId,
		// so isCurrent() below reads a real, matching value instead of comparing
		// against the `?? 0` fallback forever.
		const generation = this.generations.get(instanceId) ?? 0;
		this.generations.set(instanceId, generation);
		const isCurrent = (): boolean => this.generations.get(instanceId) === generation;
		this.runOnce(instanceId, task, isCurrent);
	}

	/** True while a refresh for `instanceId` is in flight. */
	isRefreshing(instanceId: string): boolean {
		return this.inFlight.has(instanceId);
	}

	private runOnce(instanceId: string, task: RefreshTask, isCurrent: () => boolean): void {
		if (this.inFlight.has(instanceId)) {
			return;
		}
		this.inFlight.add(instanceId);
		task(isCurrent)
			.catch(() => {
				// Errors are the task's responsibility to surface (e.g. via the key
				// face or logger); the refresh loop itself must never throw.
			})
			.finally(() => {
				// A stale (superseded) task finishing later must not clear the
				// in-flight flag out from under whichever task is current now —
				// only the still-current generation's own completion may do that.
				if (isCurrent()) {
					this.inFlight.delete(instanceId);
				}
			});
	}
}

/** Singleton instance for production use. */
export const statusRefreshService = new StatusRefreshService();
