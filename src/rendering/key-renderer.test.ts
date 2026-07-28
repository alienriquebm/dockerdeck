import { describe, it, expect } from "vitest";
import { SvgKeyRenderer, type KeyRenderInput } from "./key-renderer.js";
import { STATUS_THEME } from "./status-theme.js";

function decode(dataUrl: string): string {
	const prefix = "data:image/svg+xml;base64,";
	expect(dataUrl.startsWith(prefix)).toBe(true);
	return Buffer.from(dataUrl.slice(prefix.length), "base64").toString("utf-8");
}

describe("SvgKeyRenderer", () => {
	const renderer = new SvgKeyRenderer();

	function renderDecoded(input: KeyRenderInput): string {
		return decode(renderer.render(input));
	}

	it("returns a base64 SVG data URL", () => {
		const output = renderer.render({ title: "backend", status: "healthy" });
		expect(output.startsWith("data:image/svg+xml;base64,")).toBe(true);
	});

	it("decodes to a well-formed SVG", () => {
		const svg = renderDecoded({ title: "backend", status: "healthy" });
		expect(svg.startsWith("<svg")).toBe(true);
		expect(svg).toContain("</svg>");
	});

	it("renders the theme's label for the given status", () => {
		const svg = renderDecoded({ title: "backend", status: "healthy" });
		expect(svg).toContain(STATUS_THEME.healthy.label);
		expect(svg).toContain(STATUS_THEME.healthy.background);
	});

	it("renders distinct output for distinct statuses", () => {
		const running = renderer.render({ title: "backend", status: "running" });
		const stopped = renderer.render({ title: "backend", status: "stopped" });
		expect(running).not.toBe(stopped);
	});

	it("omits subtitle/footer markup when not given", () => {
		const svg = renderDecoded({ title: "backend", status: "unknown" });
		expect(svg).not.toContain('opacity="0.85"');
	});

	it("includes subtitle when given", () => {
		const svg = renderDecoded({ title: "backend", status: "healthy", subtitle: "healthy" });
		expect(svg).toContain('opacity="0.85"');
	});

	it("includes footer when given", () => {
		const svg = renderDecoded({ title: "backend", status: "running", footer: "2h 43m" });
		expect(svg).toContain("2h 43m");
	});

	it("passes the icon kind through to the SVG", () => {
		const withIcon = renderer.render({ title: "backend", status: "running", icon: "container" });
		const withoutIcon = renderer.render({ title: "backend", status: "running" });
		expect(withIcon).not.toBe(withoutIcon);
	});
});
