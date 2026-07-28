/**
 * Container Toggle — starts a stopped container or stops a running one.
 * Stopping asks for a confirmation press first (configurable), since it's
 * the more disruptive of the two operations.
 */

import { action, type KeyAction, type KeyDownEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { BaseContainerAction } from "./base-container-action.js";
import type { ActionIconKind } from "../rendering/key-renderer.js";
import { resolveSshTimeoutSeconds, type ContainerToggleSettings } from "../models/settings.js";
import { validateContainerName, validateSshHost } from "../utils/validation.js";

const CONFIRM_WINDOW_MS = 4000;

// @ts-expect-error TS1238: SDK's .d.ts targets native TC39 decorators; this project uses
// experimentalDecorators (required for Vitest's esbuild transform to parse @action(...) at
// all — see AGENTS.md's "Known, accepted quirks"). Compiled output is correct either way.
@action({ UUID: "com.alienriquebm.dockerdeck.container-toggle" })
export class ContainerToggleAction extends BaseContainerAction<ContainerToggleSettings> {
	protected readonly icon: ActionIconKind = "power";

	/** Instance id -> timestamp until which a repeat press confirms the pending stop. */
	private readonly armedUntil = new Map<string, number>();

	override onWillDisappear(ev: WillDisappearEvent<ContainerToggleSettings>): void {
		super.onWillDisappear(ev);
		this.armedUntil.delete(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<ContainerToggleSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}
		const keyAction = ev.action;
		const settings = ev.payload.settings;
		// Routed through refreshService so a toggle in flight both blocks a
		// repeated press AND the periodic status poll from racing it — the same
		// in-flight guard already protects the polling loop.
		this.refreshService.refreshNow(keyAction.id, (isCurrent, signal) =>
			this.handlePress(keyAction, settings, isCurrent, signal),
		);
	}

	private async handlePress(
		keyAction: KeyAction<ContainerToggleSettings>,
		settings: ContainerToggleSettings,
		isCurrent: () => boolean,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const hostCheck = validateSshHost(settings.sshHost);
			const nameCheck = validateContainerName(settings.containerName);
			if (!hostCheck.valid || !nameCheck.valid) {
				return;
			}

			const id = keyAction.id;
			const sshHost = settings.sshHost as string;
			const containerName = settings.containerName as string;
			const isRunning = this.lastStatus.get(id)?.running ?? false;
			const confirmBeforeStop = settings.confirmBeforeStop ?? true;

			if (isRunning && confirmBeforeStop && !this.isArmed(id)) {
				this.arm(id);
				await this.renderWorking(keyAction, containerName, "PRESS AGAIN");
				return;
			}
			this.disarm(id);

			const timeoutMs = resolveSshTimeoutSeconds(settings.sshTimeoutSeconds) * 1000;
			await this.renderWorking(keyAction, containerName);
			const status = isRunning
				? await this.dockerService.stopContainer(sshHost, containerName, { timeoutMs, signal })
				: await this.dockerService.startContainer(sshHost, containerName, { timeoutMs, signal });

			if (!isCurrent()) {
				return;
			}

			this.lastStatus.set(id, status);
			if (status.errorMessage !== undefined) {
				this.logger.warn(
					`${containerName}@${sshHost}: toggle -> ${status.visualStatus} — ${status.errorMessage}`,
				);
			}
			await this.renderStatus(keyAction, containerName, status, settings);
		} catch (error) {
			this.logger.error(
				"Unexpected failure while toggling the container",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	private isArmed(id: string): boolean {
		const until = this.armedUntil.get(id);
		return until !== undefined && Date.now() < until;
	}

	private arm(id: string): void {
		this.armedUntil.set(id, Date.now() + CONFIRM_WINDOW_MS);
	}

	private disarm(id: string): void {
		this.armedUntil.delete(id);
	}
}
