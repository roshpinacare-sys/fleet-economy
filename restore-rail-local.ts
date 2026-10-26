/* גל-82ג · משביר-קנוני חד-פעמי של עץ-עבודה מהבלובים-הקנוניים (trace 1a178c614313ad05)
 * מקור-אמת: giant sovereign/rail-canonical/*.b64 + MANIFEST.sha256 (השושלת 1969771/a618f33/8c7b87d).
 * קריאה: bun run restore-rail-local.ts <giant-canonical-dir>
 * בונה כל קובץ מה-blob (base64-decode), מאמת sha256 מול התחילית, כותב לעץ. אפס-המצאות. */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

const canonDir = process.argv[2];
if (!canonDir || !fs.existsSync(canonDir)) { console.error("usage: bun run restore-rail-local.ts <giant/sovereign/rail-canonical>"); process.exit(2); }

const map: Array<{ blob: string; path: string; prefix: string }> = [
  { blob: "lib_receipt-sign.ts.b64", path: "lib/receipt-sign.ts", prefix: "beff43c87e1da3b1" },
  { blob: "tests_receipt-sign.test.ts.b64", path: "tests/receipt-sign.test.ts", prefix: "c6337da164c63c65" },
  { blob: "scripts_fleet-receipts-guard-core.py.b64", path: "scripts/fleet-receipts-guard-core.py", prefix: "db896432ff6a0609" },
  { blob: ".github_workflows_receipts-guard.yml.b64", path: ".github/workflows/receipts-guard.yml", prefix: "0be08771e24dc785" },
  { blob: "state_audit_verify_signatures.py.b64", path: "state/audit/verify_signatures.py", prefix: "cc935b38962b4c47" },
];

let restored = 0, skipped = 0;
for (const m of map) {
  const bp = path.join(canonDir, m.blob);
  if (!fs.existsSync(bp)) { console.log(`SKIP ${m.path} — blob ${m.blob} absent (fail-honest)`); skipped++; continue; }
  const content = Buffer.from(fs.readFileSync(bp, "utf8").replace(/\s+/g, ""), "base64");
  const sha = createHash("sha256").update(content).digest("hex");
  if (!sha.startsWith(m.prefix)) { console.log(`REFUSE ${m.path} — sha ${sha.slice(0, 16)} != manifest ${m.prefix} (fail-closed, אפס-כתיבה)`); skipped++; continue; }
  fs.mkdirSync(path.dirname(m.path), { recursive: true });
  fs.writeFileSync(m.path, content);
  console.log(`RESTORED ${m.path} · ${content.length}B · sha256[:16]=${sha.slice(0, 16)} == manifest`);
  restored++;
}
console.log(`done: restored=${restored} skipped=${skipped}`);
