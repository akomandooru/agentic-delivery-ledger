#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RecordStore, project, computeRetro, auditForIntent } from "@adl/core";
import type { LifecycleState } from "@adl/protocol";
import {
  buildItemDeclared,
  buildClaim,
  buildGateSatisfied,
  buildGroundTruth,
  type EventInput,
} from "./record.js";
import { resolveGitAuthor, type ApproverResolver } from "./identity.js";
import { runVerificationStep, ghFetchPr, type PrFetcher } from "./verify-step.js";

/**
 * `adlx`: the deterministic append + verify CLI. It is the ONLY writer of the ledger. Hooks and
 * the verification step invoke it; the model triggers it but never edits the ledger. Every write
 * is validated (schema + metadata-only) before it touches disk, and goes through
 * `RecordStore.append`, which links the hash chain.
 */

const DEFAULT_DB = "aidlc-docs/ledger.jsonl";

export interface CliDeps {
  resolveApprover?: ApproverResolver;
  fetchPr?: PrFetcher;
  /** working directory for git identity resolution */
  cwd?: string;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface Parsed {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const body = tok.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[body] = argv[++i];
      } else {
        flags[body] = true;
      }
    } else {
      positional.push(tok);
    }
  }
  return { positional, flags };
}

class UsageError extends Error {}

function str(flags: Parsed["flags"], name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function req(flags: Parsed["flags"], name: string): string {
  const v = str(flags, name);
  if (!v) throw new UsageError(`missing required --${name}`);
  return v;
}

function dbPath(flags: Parsed["flags"]): string {
  return str(flags, "db") ?? process.env.ADLX_DB ?? DEFAULT_DB;
}

/** Append a validated event input through the single write path. */
function append(store: RecordStore, input: EventInput): string {
  const stored = store.append({
    kind: input.kind,
    itemId: input.itemId,
    actor: input.actor,
    trustLevel: input.trustLevel,
    data: input.data,
    ...(input.id ? { id: input.id } : {}),
    ...(input.at ? { at: input.at } : {}),
  });
  return stored.id;
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<CliResult> {
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);

  try {
    switch (command) {
      case "declare": {
        const store = new RecordStore(dbPath(flags));
        const input = buildItemDeclared({
          itemId: req(flags, "item"),
          actor: str(flags, "actor") ?? "planner",
          type: req(flags, "type") as "intent" | "epic" | "feature" | "task",
          title: str(flags, "title"),
          parentId: str(flags, "parent"),
          gates: str(flags, "gates") ? JSON.parse(req(flags, "gates")) : undefined,
          initialState: str(flags, "initial") as LifecycleState | undefined,
          id: str(flags, "id"),
          at: str(flags, "at"),
        });
        const id = append(store, input);
        return ok(`declared ${input.itemId} (${id})`);
      }

      case "claim": {
        const store = new RecordStore(dbPath(flags));
        const input = buildClaim({
          itemId: req(flags, "item"),
          actor: str(flags, "actor") ?? "agent",
          claimedState: req(flags, "state") as LifecycleState,
          id: str(flags, "id"),
          at: str(flags, "at"),
        });
        const id = append(store, input);
        return ok(`claim ${input.itemId} -> ${str(flags, "state")} (${id})`);
      }

      case "gate": {
        const store = new RecordStore(dbPath(flags));
        const itemId = req(flags, "item");
        const gate = req(flags, "gate");
        const resolve = deps.resolveApprover ?? resolveGitAuthor;
        // Resolve identity BEFORE any write: a gate without a resolvable identity is not satisfied.
        const approver = resolve({ cwd: deps.cwd, commit: str(flags, "commit") });
        // Build both events first so a validation failure leaves the ledger untouched.
        const gateEvent = buildGateSatisfied({
          itemId,
          gate,
          by: approver.subject,
          identityMethod: approver.identityMethod,
          id: str(flags, "id"),
          at: str(flags, "at"),
        });
        const truthEvent = buildGroundTruth({
          itemId,
          actor: approver.subject,
          signal: "review_approved",
          evidence: `gate:${gate}`,
          trustLevel: "L3",
          at: str(flags, "at"),
        });
        append(store, gateEvent);
        append(store, truthEvent);
        return ok(`gate '${gate}' satisfied for ${itemId} by ${approver.subject} (${approver.identityMethod})`);
      }

      case "ground-truth": {
        const store = new RecordStore(dbPath(flags));
        const input = buildGroundTruth({
          itemId: req(flags, "item"),
          actor: str(flags, "by") ?? str(flags, "actor") ?? "adapter",
          signal: req(flags, "signal"),
          evidence: str(flags, "evidence"),
          by: str(flags, "by"),
          id: str(flags, "id"),
          at: str(flags, "at"),
        });
        const id = append(store, input);
        return ok(`ground-truth ${input.itemId} signal=${str(flags, "signal")} (${id})`);
      }

      case "observe": {
        // Bind a ground-truth signal to a REAL command result: run the command, and record the
        // signal only if it exits 0. This keeps the signal an observation, not an assertion.
        const store = new RecordStore(dbPath(flags));
        const item = req(flags, "item");
        const signal = str(flags, "signal") ?? "tests_passed";
        const cmd = req(flags, "cmd");
        const run = spawnSync(cmd, { shell: true, stdio: "inherit" });
        if (run.status !== 0) {
          return {
            code: 1,
            stdout: "",
            stderr: `adlx: command failed (exit ${run.status ?? "unknown"}); no ground truth recorded for ${item}`,
          };
        }
        const input = buildGroundTruth({
          itemId: item,
          actor: str(flags, "by") ?? "adapter:local",
          signal,
          evidence: str(flags, "evidence") ?? "local-command",
          by: str(flags, "by"),
        });
        const id = append(store, input);
        return ok(`observed ${signal} for ${item} (command exited 0) (${id})`);
      }

      case "verify-step": {
        const store = new RecordStore(dbPath(flags));
        const item = req(flags, "item");
        const prRef = req(flags, "pr");
        const fetchPr = deps.fetchPr ?? ghFetchPr;
        const signals = await runVerificationStep({
          itemId: item,
          prRef,
          fetchPr,
          append: (input) => append(store, input),
        });
        return ok(signals.length ? `observed: ${signals.join(", ")}` : "no signals observed (tool unavailable)");
      }

      case "verify": {
        const path = positional[0] ?? dbPath(flags);
        const store = new RecordStore(path);
        const res = store.verify();
        if (res.ok) {
          return { code: 0, stdout: `INTACT (${store.all().length} records)`, stderr: "" };
        }
        return { code: 1, stdout: `BROKEN at record ${res.brokenAt}`, stderr: "" };
      }

      case "report": {
        const store = new RecordStore(dbPath(flags));
        const what = positional[0];
        if (what === "board") return ok(JSON.stringify(project(store), null, 2));
        if (what === "retro") return ok(JSON.stringify(computeRetro(store, { intentId: str(flags, "intent") }), null, 2));
        if (what === "audit") return ok(JSON.stringify(auditForIntent(store, req(flags, "intent")), null, 2));
        throw new UsageError("report requires one of: board | retro | audit");
      }

      case "init":
        return runInit(flags);

      case "help":
      case "--help":
      case "-h":
      case undefined:
        return ok(USAGE);

      default:
        throw new UsageError(`unknown command '${command}'`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof UsageError ? 2 : 2;
    return { code, stdout: "", stderr: `adlx: ${message}` };
  }
}

function ok(stdout: string): CliResult {
  return { code: 0, stdout, stderr: "" };
}

/**
 * `adlx init`: install the verification extension's rule pack into an AI-DLC project's
 * extensions slot. Copies the two rule files (verification.md, verification.opt-in.md) from the
 * package's bundled assets into <rule-details-dir>/extensions/verification/baseline/.
 *
 * The rule-details directory is resolved in this order:
 *   1. --dir <path>            explicit target (relative to cwd or absolute)
 *   2. --ide <name>            kiro | amazonq | cursor | cline | copilot | codex
 *   3. auto-detection          first known rule-details dir that exists under cwd
 *
 * Idempotent: existing files are left untouched unless --force (alias --update) is passed.
 */
function runInit(flags: Parsed["flags"]): CliResult {
  const force = flags["force"] === true || flags["update"] === true;
  const cwd = process.cwd();

  // Locate the bundled rule assets inside the installed package. The same relative path holds
  // whether running from dist/cli.js (built) or src/cli.ts (dev), since dist-extension sits at
  // the package root in both layouts.
  const here = dirname(fileURLToPath(import.meta.url));
  const assetCandidates = [
    resolve(here, "../dist-extension/extensions/verification"),
    resolve(here, "../../dist-extension/extensions/verification"),
  ];
  const assetsDir = assetCandidates.find((p) => existsSync(join(p, "verification.md")));
  if (!assetsDir) {
    return {
      code: 2,
      stdout: "",
      stderr: "adlx init: could not locate the bundled verification rule assets inside the package",
    };
  }

  // Resolve the AI-DLC rule-details directory for the target project.
  const ideMap: Record<string, string> = {
    kiro: ".kiro/aws-aidlc-rule-details",
    amazonq: ".amazonq/aws-aidlc-rule-details",
    q: ".amazonq/aws-aidlc-rule-details",
    cursor: ".aidlc-rule-details",
    cline: ".aidlc-rule-details",
    copilot: ".aidlc-rule-details",
    codex: ".aidlc-rule-details",
  };
  const detectCandidates = [
    ".kiro/aws-aidlc-rule-details",
    ".aidlc/aidlc-rules/aws-aidlc-rule-details",
    ".aidlc-rule-details",
    ".amazonq/aws-aidlc-rule-details",
  ];

  let ruleDir: string | undefined;
  const explicit = str(flags, "dir");
  const ide = str(flags, "ide");
  if (explicit) {
    ruleDir = resolve(cwd, explicit);
  } else if (ide) {
    const mapped = ideMap[ide.toLowerCase()];
    if (!mapped) {
      return { code: 2, stdout: "", stderr: `adlx init: unknown --ide '${ide}' (expected one of: ${Object.keys(ideMap).join(", ")})` };
    }
    ruleDir = resolve(cwd, mapped);
  } else {
    const found = detectCandidates.find((p) => existsSync(resolve(cwd, p)));
    if (found) ruleDir = resolve(cwd, found);
  }

  if (!ruleDir) {
    return {
      code: 2,
      stdout: "",
      stderr:
        "adlx init: no AI-DLC rule-details directory found. Pass --ide <kiro|amazonq|cursor|cline|copilot|codex> or --dir <path>.",
    };
  }

  const dest = join(ruleDir, "extensions", "verification", "baseline");
  mkdirSync(dest, { recursive: true });

  const files = ["verification.md", "verification.opt-in.md"];
  const written: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const target = join(dest, f);
    if (existsSync(target) && !force) {
      skipped.push(f);
      continue;
    }
    copyFileSync(join(assetsDir, f), target);
    written.push(f);
  }

  const lines = [`adlx init: verification extension installed into ${dest}`];
  if (written.length) lines.push(`  wrote:   ${written.join(", ")}`);
  if (skipped.length) lines.push(`  skipped (exists, use --force to overwrite): ${skipped.join(", ")}`);
  lines.push("Answer 'Yes' to the Verification Ledger opt-in during Requirements Analysis to enable it.");
  return ok(lines.join("\n"));
}

const USAGE = `adlx - the only writer of the AI-DLC verification ledger

Usage:
  adlx declare --item <id> --type <intent|epic|feature|task> [--parent <id>] [--title <t>] [--gates <json>] [--initial <state>]
  adlx claim --item <id> --state <lifecycleState> [--actor <agent>]
  adlx gate --item <id> --gate <name> [--commit <ref>]
  adlx ground-truth --item <id> --signal <signal> [--evidence <ref>] [--by <source>]
  adlx observe --item <id> --cmd "<test command>" [--signal <signal>] [--evidence <ref>]
  adlx verify-step --item <id> --pr <owner/repo#number>
  adlx verify [path]
  adlx report board|retro|audit [--intent <id>]
  adlx init [--ide <kiro|amazonq|cursor|cline|copilot|codex>] [--dir <path>] [--force]

Default ledger: ${DEFAULT_DB} (override with --db or ADLX_DB).`;

// Run as a CLI when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((res) => {
    if (res.stdout) process.stdout.write(res.stdout + "\n");
    if (res.stderr) process.stderr.write(res.stderr + "\n");
    // Set exitCode (rather than process.exit) so buffered stdout/stderr flush before exit.
    process.exitCode = res.code;
  });
}
