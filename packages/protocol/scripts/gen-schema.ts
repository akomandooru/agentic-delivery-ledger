import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WorkItem, RecordEvent, Gate, Boundaries, PROTOCOL_VERSION } from "../src/schema.js";

/**
 * Generates the language-agnostic JSON Schema for the protocol from the Zod types, so the
 * published schema is always in sync with the reference implementation (single source of truth).
 *
 * Run: npm run schema   (writes schema/ledger.schema.json at the repo root)
 */
const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../../../schema/ledger.schema.json");

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Agentic Delivery Ledger Protocol",
  "x-protocolVersion": PROTOCOL_VERSION,
  description: "Generated from the Zod types in packages/protocol. Metadata only; no source code.",
  $defs: {
    WorkItem: zodToJsonSchema(WorkItem, { name: "WorkItem", target: "jsonSchema2020-12" }),
    RecordEvent: zodToJsonSchema(RecordEvent, { name: "RecordEvent", target: "jsonSchema2020-12" }),
    Gate: zodToJsonSchema(Gate, { name: "Gate", target: "jsonSchema2020-12" }),
    Boundaries: zodToJsonSchema(Boundaries, { name: "Boundaries", target: "jsonSchema2020-12" }),
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(schema, null, 2) + "\n", "utf-8");
console.log(`Wrote ${outPath}`);
