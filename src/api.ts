import * as fs from "node:fs";
import * as path from "node:path";
import type { EnvIssue, EnvScanOptions, EnvScanReport } from "./types";

const DEFAULT_IGNORES = ["NODE_ENV", "CI"];

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const CONFIG_FILES = new Set(["Dockerfile", "docker-compose.yml", "docker-compose.yaml"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

const ENV_ACCESS_PATTERNS: RegExp[] = [
  /process\.env\.([A-Za-z][A-Za-z0-9_]+)/g,
  /process\.env\[\s*['"]([A-Za-z][A-Za-z0-9_]+)['"]\s*\]/g,
  /import\.meta\.env\.([A-Za-z][A-Za-z0-9_]+)/g,
  /Deno\.env\.get\(\s*['"]([A-Za-z][A-Za-z0-9_]+)['"]\s*\)/g,
];

function listFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      listFiles(full, out, depth + 1);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.startsWith(".env") || CONFIG_FILES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every env-style declaration in one file, along with a friendly file label. */
export function declarationsIn(text: string, file: string, root: string): Array<[string, string]> {
  const base = path.basename(file);
  const label = path.relative(root, file);
  const results: Array<[string, string]> = [];

  if (base.startsWith(".env")) {
    const re = /^[ \t]*(?:export[ \t]+)?([A-Za-z][A-Za-z0-9_]+)=/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) results.push([m[1], label]);
    return results;
  }
  if (base === "Dockerfile") {
    const re = /^[ \t]*ENV[ \t]+([A-Za-z][A-Za-z0-9_]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) results.push([m[1], "Dockerfile"]);
    return results;
  }
  if (file.endsWith(".yml") || file.endsWith(".yaml")) {
    // only inside `environment:` sections (both `- KEY=value` and `KEY: value` forms)
    const sections = text.split(/^[ \t]*environment:/m).slice(1);
    for (const section of sections) {
      const body = section.split(/^[a-z]+:/m)[0] ?? section;
      const re = /^[ \t]+(?:-[ \t]+)?([A-Za-z][A-Za-z0-9_]+)(?::|=)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) results.push([m[1], "docker-compose"]);
    }
    return results;
  }
  return results;
}

/** Every env ACCESS in a code file. */
export function usagesIn(text: string): string[] {
  const found: string[] = [];
  for (const pattern of ENV_ACCESS_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) found.push(m[1]);
  }
  return found;
}

/* ------------------------------------------------------- similarity --- */

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const lower = s.toLowerCase();
  for (let i = 0; i < Math.max(0, lower.length - 2); i++) {
    out.add(lower.slice(i, i + 3));
  }
  return out;
}

function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.max(A.size, B.size);
}

function findClosest(name: string, candidates: Iterable<string>): string | undefined {
  let bestScore = 0;
  let best: string | undefined;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const score = similarity(name, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 0.5 ? best : undefined;
}

/* -------------------------------------------------------------- scan --- */

export function scanEnv(options: EnvScanOptions = {}): EnvScanReport {
  const root = path.resolve(options.root ?? process.cwd());
  const ignore = new Set([...DEFAULT_IGNORES, ...(options.ignore ?? [])]);
  const exampleFiles = options.exampleFiles ?? [".env.example"];

  const declared = new Map<string, string[]>(); // var -> labels
  const used = new Map<string, string[]>();     // var -> relative source files

  for (const file of listFiles(root)) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (CODE_EXTENSIONS.has(path.extname(file))) {
      for (const name of usagesIn(text)) {
        if (ignore.has(name)) continue;
        const rel = path.relative(root, file);
        const files = used.get(name) ?? [];
        files.push(rel);
        used.set(name, files);
      }
    }

    const decls = declarationsIn(text, file, root);
    for (const [name, where] of decls) {
      if (ignore.has(name)) continue;
      const files = declared.get(name) ?? [];
      files.push(where);
      declared.set(name, files);
    }
  }

  /** which example-file variable names are known */
  const exampleKeys = new Set<string>();
  for (const name of exampleFiles) {
    try {
      const raw = fs.readFileSync(path.join(root, name), "utf8");
      for (const [key] of declarationsIn(raw, path.join(root, name), root)) {
        exampleKeys.add(key);
      }
    } catch {
      /* no example file — skip */
    }
  }

  /* --------------------------------------------------------- issues --- */
  const issues: EnvIssue[] = [];

  // used in source but not declared anywhere
  for (const [name, files] of used) {
    if (!declared.has(name)) {
      const issue: EnvIssue = {
        severity: "missing",
        variable: name,
        detail: `used in source but never declared\n   in: ${files.slice(0, 3).join(", ")}`,
        source: files[0],
      };
      const typo = findClosest(name, declared.keys());
      if (typo) issue.suggestion = typo;
      issues.push(issue);
    }
  }

  // declared but never used in code
  for (const name of declared.keys()) {
    if (used.has(name)) continue;
    const where = (declared.get(name) ?? [])[0];
    issues.push({
      severity: "unused",
      variable: name,
      detail: `declared but never referenced\n   file: ${where}`,
    });
  }

  // declared locally but missing from the example file
  for (const [name, labels] of declared) {
    if (exampleKeys.has(name)) continue;
    const locally = labels.some((label) => {
      const base = path.basename(label);
      return base.startsWith(".env") && base !== ".env.example";
    });
    if (locally) {
      issues.push({
        severity: "undocumented",
        variable: name,
        detail: `${name} is in your .env files but not in .env.example`,
      });
    }
  }

  // typos: declared names vs declared names that are unused AND similar — the classic
  // "STRIP_SECRT in .env" vs "STRIPE_SECRET in code url" case
  for (const [name, labels] of declared) {
    if (used.has(name)) continue;
    const closest = findClosest(name, used.keys());
    if (closest) {
      issues.push({
        severity: "typo",
        variable: name,
        detail: `declared "${name}" in ${labels[0]} but code uses "${closest}"`,
        source: labels[0],
        suggestion: closest,
      });
    }
  }

  // declared in multiple places (the example file doesn't count)
  for (const [name, labels] of declared) {
    const relevant = labels.filter((l) => path.basename(l) !== ".env.example");
    const unique = new Set(relevant);
    if (unique.size > 1) {
      issues.push({
        severity: "duplicate",
        variable: name,
        detail: `declared in multiple places\n   files: ${[...unique].join(", ")}`,
      });
    }
  }

  return {
    declared,
    used,
    issues,
    severityCount: issues.length,
  };
}
