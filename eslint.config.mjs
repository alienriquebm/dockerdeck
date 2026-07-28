import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	prettier,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		// Relax a few rules that conflict with the Stream Deck SDK patterns
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/explicit-function-return-type": "off",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
			"no-console": "warn",
		},
	},
	{
		// Ignore compiled output and node_modules
		ignores: [
			"node_modules/**",
			"com.alienriquebm.dockerdeck.sdPlugin/bin/**",
			"rollup.config.mjs",
		],
	},
);
