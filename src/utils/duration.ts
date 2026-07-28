/**
 * Uptime calculation and human-readable duration formatting for key faces.
 */

/**
 * Docker reports "never happened" timestamps as the Go zero time.
 * Any timestamp sharing this date is treated as unset.
 */
const GO_ZERO_TIME_PREFIX = "0001-01-01T00:00:00";

export function isZeroTime(isoString: string | undefined | null): boolean {
	return !isoString || isoString.startsWith(GO_ZERO_TIME_PREFIX);
}

/**
 * Computes elapsed seconds since `startedAt`. Returns undefined when the
 * timestamp is missing, the Go zero time, or fails to parse.
 */
export function computeUptimeSeconds(startedAt: string | undefined, now: Date = new Date()): number | undefined {
	if (isZeroTime(startedAt)) {
		return undefined;
	}
	const started = new Date(startedAt as string);
	if (Number.isNaN(started.getTime())) {
		return undefined;
	}
	const seconds = Math.floor((now.getTime() - started.getTime()) / 1000);
	return seconds >= 0 ? seconds : undefined;
}

/**
 * Formats a duration for display on a key face, e.g. "2h 43m", "3d 5h", "45m", "12s".
 * Uses the two most significant units; falls back to seconds under a minute.
 */
export function formatDuration(totalSeconds: number): string {
	if (totalSeconds < 60) {
		return `${totalSeconds.toString()}s`;
	}
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);

	if (days > 0) {
		return `${days.toString()}d ${hours.toString()}h`;
	}
	if (hours > 0) {
		return `${hours.toString()}h ${minutes.toString()}m`;
	}
	return `${minutes.toString()}m`;
}
