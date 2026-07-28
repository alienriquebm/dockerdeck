import { describe, it, expect } from "vitest";
import { buildKeySvg, ACTION_ICON_KINDS } from "./svg-templates.js";

const baseParams = {
	title: "backend",
	statusLabel: "RUNNING",
	background: "#1B8A3D",
	foreground: "#FFFFFF",
	dotColor: "#7CFFA0",
};

describe("buildKeySvg", () => {
	it("produces a well-formed SVG root element", () => {
		const svg = buildKeySvg(baseParams);
		expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
		expect(svg).toContain("</svg>");
	});

	it("uppercases and embeds the title", () => {
		const svg = buildKeySvg(baseParams);
		expect(svg).toContain("BACKEND");
	});

	it("embeds the status label and colors", () => {
		const svg = buildKeySvg(baseParams);
		expect(svg).toContain("RUNNING");
		expect(svg).toContain("#1B8A3D");
		expect(svg).toContain("#7CFFA0");
	});

	it("omits subtitle and footer lines when not provided", () => {
		const svg = buildKeySvg(baseParams);
		expect(svg).not.toContain('opacity="0.85"');
		expect(svg).not.toContain('opacity="0.75"');
	});

	it("includes subtitle and footer when provided", () => {
		const svg = buildKeySvg({ ...baseParams, subtitle: "healthy", footer: "2h 43m" });
		expect(svg).toContain("healthy");
		expect(svg).toContain("2h 43m");
	});

	it("escapes XML-significant characters in the title", () => {
		const svg = buildKeySvg({ ...baseParams, title: "<script>alert(1)</script>" });
		expect(svg).not.toContain("<script>");
		expect(svg).toContain("&lt;SCRIPT&gt;");
	});

	it("escapes XML-significant characters in the subtitle and footer", () => {
		const svg = buildKeySvg({ ...baseParams, subtitle: "a & b", footer: '"quoted"' });
		expect(svg).toContain("a &amp; b");
		expect(svg).toContain("&quot;quoted&quot;");
	});

	it("truncates a title longer than the max line length", () => {
		const svg = buildKeySvg({ ...baseParams, title: "a-very-long-container-name-indeed" });
		expect(svg).toContain("…");
	});

	it("never leaves an untruncated long title in the output", () => {
		const longTitle = "x".repeat(100);
		const svg = buildKeySvg({ ...baseParams, title: longTitle });
		expect(svg).not.toContain(longTitle.toUpperCase());
	});

	it("omits the icon group's glyph markup when no icon is given", () => {
		const withIcon = buildKeySvg({ ...baseParams, icon: "container" });
		const withoutIcon = buildKeySvg(baseParams);
		expect(withIcon).not.toBe(withoutIcon);
		expect(withoutIcon).not.toContain("stroke-linecap");
	});

	it("renders a distinct glyph for every action icon kind", () => {
		const rendered = ACTION_ICON_KINDS.map((icon) => buildKeySvg({ ...baseParams, icon }));
		const unique = new Set(rendered);
		expect(unique.size).toBe(ACTION_ICON_KINDS.length);
	});

	it("keeps the icon markup well-formed for every icon kind", () => {
		for (const icon of ACTION_ICON_KINDS) {
			const svg = buildKeySvg({ ...baseParams, icon });
			expect(svg).toContain("</svg>");
			expect((svg.match(/<g/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
		}
	});
});
