import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanEnv, usagesIn, declarationsIn } from "../src/api";

function scratch(): string {
  return mkdtempSync(path.join(os.tmpdir(), "envscan-"));
}

describe("patterns", () => {
  it("captures process.env[...], import.meta.env, Deno access", () => {
    const code = `
  const a = process.env.DATABASE_URL;
  const b = process.env["REDIS_URL"];
  const c = import.meta.env.VITE_API_URL;
  const d = Deno.env.get("API_KEY");
  `;
    expect(usagesIn(code).sort()).toEqual([
      "API_KEY",
      "DATABASE_URL",
      "REDIS_URL",
      "VITE_API_URL",
    ]);
  });

  it("captures declarations from .env, Dockerfile and compose", () => {
    expect(declarationsIn("STRIPE_SECRET=abc\nDEBUG=true\n", ".env", ".")).toEqual([
      ["STRIPE_SECRET", ".env"],
      ["DEBUG", ".env"],
    ]);
    expect(declarationsIn("ENV API_KEY\nRUN yes\n", "Dockerfile", ".")).toEqual([
      ["API_KEY", "Dockerfile"],
    ]);
    expect(
      declarationsIn("services:\n  web:\n    environment:\n      - TAX_RATE=0.2\n", "docker-compose.yml", "."),
    ).toEqual([["TAX_RATE", "docker-compose"]]);
  });
});

describe("scanEnv", () => {
  let dir = "";
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function scaffold() {
    dir = scratch();
    writeFileSync(
      path.join(dir, "app.ts"),
      "console.log(process.env.DATABASE_URL); use(process.env.STRIPE_SECRT as string);",
    );
    writeFileSync(path.join(dir, ".env"), "DATABASE_URL=postgres://\nSTRIPE_SECRET=sk_test\n");
    writeFileSync(path.join(dir, ".env.example"), "DATABASE_URL=postgres://\n");
    mkdirSync(path.join(dir, "somedir"), { recursive: true });
    writeFileSync(path.join(dir, "somedir", "ignored.js"), "process.env.UNTRACKED;");
  }

  it("flags missing / unused / undocumented and typos", () => {
    scaffold();
    const report = scanEnv({ root: dir, ignore: ["DEBUG"] });
    const sev = (v: string) => report.issues.filter((i) => i.variable === v).map((i) => i.severity);

    // DATABASE_URL is used, declared in .env AND documented in .env.example — clean
    expect(sev("DATABASE_URL")).toEqual([]);
    // STRIPE_SECRET is in .env but missing from .env.example, and unused in code
    expect(sev("STRIPE_SECRET")).toContain("undocumented");
    // .env has STRIPE_SECRET but code uses STRIPE_SECRT -> typo pair
    expect(report.issues.find((i) => i.severity === "typo")).toBeDefined();
    // STRIPE_SECRT used in code, undeclared -> missing (with a suggestion)
    const missing = report.issues.find((i) => i.variable === "STRIPE_SECRT" && i.severity === "missing");
    expect(missing).toBeDefined();
    expect(missing?.suggestion).toBe("STRIPE_SECRET");
  });

  it("detects duplicates across .env files", () => {
    dir = scratch();
    writeFileSync(path.join(dir, "app.ts"), "process.env.API_KEY;");
    writeFileSync(path.join(dir, ".env"), "API_KEY=abc");
    writeFileSync(path.join(dir, ".env.local"), "API_KEY=def");
    const report = scanEnv({ root: dir });
    expect(report.issues.map((i) => i.severity)).toContain("duplicate");
  });

  it("declared but unused shows 'unused'", () => {
    dir = scratch();
    writeFileSync(path.join(dir, ".env"), "NEVER_USED=1");
    const report = scanEnv({ root: dir });
    const unused = report.issues.find((i) => i.variable === "NEVER_USED");
    expect(unused?.severity).toBe("unused");
  });

  it("ignores requested variables", () => {
    dir = scratch();
    writeFileSync(path.join(dir, "app.ts"), "process.env.IGNORED_VARIABLE;");
    const report = scanEnv({ root: dir, ignore: ["IGNORED_VARIABLE"] });
    expect(report.issues.map((i) => i.variable)).not.toContain("IGNORED_VARIABLE");
  });
});
