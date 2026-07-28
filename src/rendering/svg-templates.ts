/**
 * Builds the raw SVG markup for a key face. Kept free of any Stream Deck or
 * Docker knowledge — it only knows how to lay out pre-resolved strings and
 * colors, which keeps it trivial to unit test.
 */

const CANVAS_SIZE = 144;
const MAX_LINE_LENGTH = 16;

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function safeLine(value: string, maxLength: number = MAX_LINE_LENGTH): string {
	return escapeXml(truncate(value, maxLength));
}

/**
 * Action-type glyphs drawn at the bottom of every key, one per action kind,
 * so all four actions share a consistent visual language instead of each
 * leaving that space empty or relying on ad-hoc icons.
 */
export const ACTION_ICON_KINDS = ["container", "power", "restart", "stack"] as const;
export type ActionIconKind = (typeof ACTION_ICON_KINDS)[number];

/** Each glyph is authored on a 24x24 grid; `buildKeySvg` positions and scales it. */
function buildIconGlyph(kind: ActionIconKind): string {
	switch (kind) {
		case "container":
			// Shipping-container / package outline.
			return `<path d="M12 3 L21 7.5 L21 16.5 L12 21 L3 16.5 L3 7.5 Z" />
				<path d="M3 7.5 L12 12 L21 7.5" />
				<path d="M12 12 L12 21" />`;
		case "power":
			// Standard power symbol: vertical line through a broken circle.
			return `<line x1="12" y1="2.5" x2="12" y2="11" />
				<path d="M6.5 6a7.5 7.5 0 1 0 11 0" />`;
		case "restart":
			// Circular arrow.
			return `<path d="M3.5 12a8.5 8.5 0 1 1 3.1 6.6" />
				<path d="M2.5 17.2v-5.4h5.4" />`;
		case "stack":
			// Three stacked layers (compose services).
			return `<path d="M12 2.5 L21 7 L12 11.5 L3 7 Z" />
				<path d="M3 12 L12 16.5 L21 12" />
				<path d="M3 17 L12 21.5 L21 17" />`;
	}
}

function buildIconMarkup(kind: ActionIconKind, color: string, centerX: number, centerY: number, size: number): string {
	const scale = size / 24;
	const offset = size / 2;
	return `<g transform="translate(${(centerX - offset).toString()}, ${(centerY - offset).toString()}) scale(${scale.toString()})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
		${buildIconGlyph(kind)}
	</g>`;
}

export interface KeySvgParams {
	title: string;
	statusLabel: string;
	subtitle?: string;
	footer?: string;
	icon?: ActionIconKind;
	background: string;
	foreground: string;
	dotColor: string;
}

export function buildKeySvg(params: KeySvgParams): string {
	const title = safeLine(params.title.toUpperCase());
	const statusLabel = safeLine(params.statusLabel);
	const subtitle = params.subtitle !== undefined ? safeLine(params.subtitle) : undefined;
	const footer = params.footer !== undefined ? safeLine(params.footer) : undefined;
	const background = escapeXml(params.background);
	const foreground = escapeXml(params.foreground);
	const dotColor = escapeXml(params.dotColor);

	const subtitleLine =
		subtitle !== undefined
			? `<text x="72" y="82" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${foreground}" opacity="0.85">${subtitle}</text>`
			: "";
	const iconGlyph = params.icon !== undefined ? buildIconMarkup(params.icon, foreground, 72, 104, 40) : "";
	const footerLine =
		footer !== undefined
			? `<text x="72" y="138" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${foreground}" opacity="0.75">${footer}</text>`
			: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE.toString()}" height="${CANVAS_SIZE.toString()}" viewBox="0 0 ${CANVAS_SIZE.toString()} ${CANVAS_SIZE.toString()}">
	<rect width="${CANVAS_SIZE.toString()}" height="${CANVAS_SIZE.toString()}" fill="${background}" />
	<text x="72" y="30" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="700" fill="${foreground}">${title}</text>
	<text x="72" y="58" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="${foreground}"><tspan fill="${dotColor}">●</tspan> ${statusLabel}</text>
	${subtitleLine}
	<g opacity="0.8">${iconGlyph}</g>
	${footerLine}
</svg>`;
}
