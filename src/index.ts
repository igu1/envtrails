#!/usr/bin/env node
/**
 * envscan — scan the project for broken / missing / unused / drift env vars.
 *
 *   envscan
 *   envscan --strict      (exit code 1 when issues are found)
 *   envscan --json        (machine-readable)
 */
import * as path from "node:path";
import { scanEnv } from "./api";
import type { EnvIssue } from "./types";

const color = process.stderr.isTTY === true;
const g = (s: string) => (color ? `\x1b[32m${s}\x1b[0m` : s);
const y = (s: string) => (color ? `\x1b[33m${s}\x1b[0m` : s);
const r = (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s: string) => (color ? `\x1b[90m${s}\x1b[0m` : s);

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.error("envscan [--strict] [--json] [--root .]");
  process.exit(0);
}
const rootArg = args.indexOf("--root");
const root = rootArg >= 0 ? args[rootArg + 1] : process.cwd();

const report = scanEnv({ root });
const cwd = path.resolve(root);

if (args.includes("--json")) {
  const out = {
    root: cwd,
    declaredNames: [...report.declared.keys()],
    usedNames: [...report.used.keys()],
    issues: report.issues,
  };
  console.error(JSON.stringify(out, null, 2));
  process.exit(report.issues.length > 0 ? 1 : 0);
}

console.error("Environment Doctor\n");
console.error(dim(`scanned ${cwd}\n`));

const groups: Array<{ key: EnvIssue["severity"]; icon: string; heading: string }> = [
  { key: "missing", icon: "✗", heading: "Missing — used in source but not declared" },
  { key: "unused", icon: "⚠", heading: "Unused — declared but never referenced" },
  { key: "undocumented", icon: "⚠", heading: "Undocumented — missing from .env.example" },
  { key: "typo", icon: "⚠", heading: "Possible typos — suspiciously similar names" },
  { key: "duplicate", icon: "⚠", heading: "Duplicates — declared in more than one place" },
];

let cleanCount = 0;
for (const group of groups) {
  const items = report.issues.filter((i) => i.severity === group.key);
  if (items.length === 0) continue;
  console.error(`\n${y(group.heading)}`);
  for (const issue of items) {
    console.error(` ${group.icon} ${issue.variable}`);
    console.error(`   ${issue.detail}`);
    if (issue.suggestion) {
      console.error(`   did you mean: ${issue.suggestion}`);
    }
  }
}

for (const name of report.declared.keys()) {
  if (report.used.has(name) && report.issues.every((i) => i.variable !== name)) {
    cleanCount += 1;
    console.error(` ${g("✓")} ${name}`);
  }
}

if (report.issues.length === 0) {
  console.error(`\n${g("✓")} No environment issues found\n`);
  process.exit(0);
}

console.error(`\n${r(`${report.issues.length} issue(s) found`)}`);

if (args.includes("--strict")) {
  process.exitCode = 1;
}
