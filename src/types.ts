export interface EnvIssue {
  severity: "missing" | "unused" | "undocumented" | "duplicate" | "typo";
  variable: string;
  /** human lines shown under the headline */
  detail: string;
  /** file that referenced/declared it (context) */
  source?: string;
  /** suggestion for likely typos */
  suggestion?: string;
}

export interface EnvScanOptions {
  /** project root (default cwd) */
  root?: string;
  /** skip these variables (default NODE_ENV, CI) */
  ignore?: string[];
  /** key names for declaring envs (default [".env.example"]) */
  exampleFiles?: string[];
}

export interface EnvScanReport {
  declared: Map<string, string[]>;
  used: Map<string, string[]>;
  issues: EnvIssue[];
  severityCount: number;
}
