/**
 * KeyRenderer — turns a status into the visual representation of a key.
 * Separate from actions and SSH access: it knows nothing about Docker or
 * Stream Deck, only how to turn a status into pixels.
 */

import type { ContainerVisualStatus } from "../models/container-status.js";
import { STATUS_THEME } from "./status-theme.js";
import { buildKeySvg, type ActionIconKind } from "./svg-templates.js";

export type { ActionIconKind } from "./svg-templates.js";

export interface KeyRenderInput {
	title: string;
	status: ContainerVisualStatus;
	/** Identifies which action this key belongs to, so every instance of that action shares one glyph. */
	icon?: ActionIconKind;
	subtitle?: string;
	footer?: string;
}

export interface KeyRenderer {
	/** Returns a `data:image/svg+xml;base64,...` URL suitable for passing directly to `action.setImage()`. */
	render(input: KeyRenderInput): string;
}

export class SvgKeyRenderer implements KeyRenderer {
	render(input: KeyRenderInput): string {
		const theme = STATUS_THEME[input.status];
		const params: Parameters<typeof buildKeySvg>[0] = {
			title: input.title,
			statusLabel: theme.label,
			background: theme.background,
			foreground: theme.foreground,
			dotColor: theme.dotColor,
		};
		if (input.icon !== undefined) {
			params.icon = input.icon;
		}
		if (input.subtitle !== undefined) {
			params.subtitle = input.subtitle;
		}
		if (input.footer !== undefined) {
			params.footer = input.footer;
		}
		const svg = buildKeySvg(params);
		// A bare `<svg>...</svg>` string is accepted by some Stream Deck app
		// versions but silently ignored by others (setImage only confirms the
		// request was *sent*, not that it rendered) — a base64 data URL is the
		// broadly compatible form.
		return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
	}
}

/** Singleton instance for production use. */
export const keyRenderer: KeyRenderer = new SvgKeyRenderer();
