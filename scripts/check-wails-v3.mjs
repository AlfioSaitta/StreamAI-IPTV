#!/usr/bin/env node
/**
 * Lint guard: blocca regressioni a Wails v2 nel codebase.
 *
 * Fa fallire il PR-check se compaiono pattern proibiti:
 *   - import `github.com/wailsapp/wails/v2/...`
 *   - cartelle/path `wailsjs/go/`
 *   - chiamate runtime v2: `runtime.EventsEmit`, `runtime.EventsOn`,
 *     `runtime.EventsOff`, `wails.Run(`
 *
 * Si attiva da `npm run check` e dalla CI dopo Fase 1 della migrazione
 * (vedi `docs/plan-go-wails-migration.md` §0 e §2.0).
 *
 * Esclusioni:
 *   - `node_modules/`, `dist/`, `build/`, `release/`, `android/`
 *   - `docs/` (può citare pattern proibiti a scopo didattico)
 *   - questo script stesso
 *   - branch "1.x-legacy" (gestita lato CI)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);

const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"build",
	"release",
	"public-repo",
	"android",
	".git",
	".vitest-cache",
	"coverage",
	"docs",
	"bindings",
	"frontend/bindings",
]);

const SCAN_EXTS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".json", ".yml", ".yaml", ".toml", ".md",
]);

// Pattern proibiti (regex). Tutti su singola linea.
const FORBIDDEN = [
	{
		id: "wails-v2-import",
		re: /github\.com\/wailsapp\/wails\/v2(?:\/|"|`)/,
		hint: "Usa github.com/wailsapp/wails/v3 (vedi plan §2.0). v2 è proibito.",
	},
	{
		id: "wailsjs-go-path",
		re: /["'`]wailsjs\/go\//,
		hint: "v3 genera bindings in frontend/bindings/ (wails3 generate bindings -ts -d frontend/bindings). Path wailsjs/go/ è v2.",
	},
	{
		id: "runtime-EventsEmit",
		re: /\bruntime\.EventsEmit\s*\(/,
		hint: "v3: usa app.EmitEvent(&application.CustomEvent{...}) lato Go.",
	},
	{
		id: "runtime-EventsOn",
		re: /\bruntime\.EventsO(n|ff|nce)\s*\(/,
		hint: "v3: usa Events.On(...) da @wailsio/runtime lato JS, app.OnEvent(...) lato Go.",
	},
	{
		id: "wails-Run",
		re: /\bwails\.Run\s*\(/,
		hint: "v3: usa application.New(application.Options{...}) + app.Run().",
	},
];

// Markdown skip rule: docs/ è già escluso; ma file MD nella root (es. AGENTS.md)
// possono citare i pattern dentro code-block. Per semplicità, su .md ignoriamo
// linee che iniziano con whitespace+grave (code block) o sono dentro fences.
function shouldSkipLineMd(line, inFence) {
	if (inFence) return true;
	return false;
}

const offenses = [];

function walk(dir) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		if (SKIP_DIRS.has(name)) continue;
		const abs = join(dir, name);
		const rel = relative(ROOT, abs);
		// Skip nested SKIP_DIRS components anywhere in path
		if (rel.split(sep).some((seg) => SKIP_DIRS.has(seg))) continue;
		let st;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			walk(abs);
			continue;
		}
		if (abs === SELF) continue;
		const dot = name.lastIndexOf(".");
		const ext = dot >= 0 ? name.slice(dot) : "";
		if (!SCAN_EXTS.has(ext)) continue;
		scanFile(abs, ext);
	}
}

function scanFile(abs, ext) {
	let content;
	try {
		content = readFileSync(abs, "utf8");
	} catch {
		return;
	}
	if (content.length === 0) return;
	const lines = content.split("\n");
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (ext === ".md") {
			if (line.startsWith("```")) inFence = !inFence;
			if (shouldSkipLineMd(line, inFence)) continue;
		}
		for (const rule of FORBIDDEN) {
			if (rule.re.test(line)) {
				offenses.push({
					file: relative(ROOT, abs),
					line: i + 1,
					col: line.search(rule.re) + 1,
					rule: rule.id,
					hint: rule.hint,
					snippet: line.trim().slice(0, 200),
				});
			}
		}
	}
}

walk(ROOT);

if (offenses.length === 0) {
	console.log("✅ check-wails-v3: nessun pattern Wails v2 trovato.");
	process.exit(0);
}

console.error(`❌ check-wails-v3: trovati ${offenses.length} riferimenti a Wails v2 (proibiti).`);
console.error("");
for (const o of offenses) {
	console.error(`  ${o.file}:${o.line}:${o.col}  [${o.rule}]`);
	console.error(`    ${o.snippet}`);
	console.error(`    → ${o.hint}`);
	console.error("");
}
console.error("Vedi docs/plan-go-wails-migration.md §2.0 per gli idiom v3 corretti.");
process.exit(1);

