# doctorenv

**Find broken, missing, unused, and inconsistent environment variables across your project.**

> One small problem. One obvious API. Very little setup. Immediate value.

`.env`, `.env.local`, `.env.example`, Dockerfiles, compose files and source
code drift apart over time. `doctorenv` reads them all and tells you exactly
what's off.

## Install

```bash
npm i -g doctorenv    # or run via npx doctorenv
```

## Usage

```bash
doctorenv                 # friendly report
doctorenv --strict        # exit code 1 when issues are found (for CI)
doctorenv --json          # machine-readable
```

```text
Environment Doctor

scanned /your/project

Missing — used in source but not declared
 ✗ STRIPE_SECRT
   used in source but never declared
   in: src/index.ts
   did you mean: STRIPE_SECRET

Unused — declared but never referenced
 ⚠ STRIPE_SECRET
   declared but never referenced
   file: .env

Undocumented — missing from .env.example
 ⚠ REDIS_URL
   REDIS_URL is in your .env files but not in .env.example

Possible typos — suspiciously similar names
 ⚠ STRIPE_SECRET
   declared "STRIPE_SECRET" in .env but code uses "STRIPE_SECRT"
   did you mean: STRIPE_SECRT
 ✓ DATABASE_URL

5 issue(s) found
```

## What gets scanned

- `.env`, `.env.local`, `.env.production`, `.env.example…` (declarations)
- `Dockerfile` (`ENV KEY …`)
- `docker-compose.yml` (`environment:` sections)
- JavaScript / TypeScript / JSX / TSX / mjs / cjs (access patterns)

Access patterns understood:

```ts
process.env.DATABASE_URL
process.env["REDIS_URL"]
import.meta.env.VITE_API_URL   // Vite
Deno.env.get("API_KEY")        // Deno
```

## Categories

| severity | meaning |
|---|---|
| `missing` | used in source, declared nowhere (with a typo suggestion) |
| `unused` | declared but never referenced in code |
| `undocumented` | in your local `.env` files but missing from `.env.example` |
| `typo` | declared name suspiciously close to a used name |
| `duplicate` | declared in more than one non-example file |

`NODE_ENV` and `CI` are ignored by default; add more with the API:

```ts
import { scanEnv } from "doctorenv/api";

const report = scanEnv({
  root: process.cwd(),
  ignore: ["NODE_ENV"],
  exampleFiles: [".env.example"],
});
report.issues; // { severity, variable, detail, source?, suggestion? }
```

Zero dependencies. ESM + CJS + `.d.ts` + `bin`. Node >= 18.

## License

MIT
