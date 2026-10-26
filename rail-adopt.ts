/* גל-82ג · אימוץ-קנוני מאומת-של-נתיבי-פס-הקבלות (trace 1a178c614313ad05 · wave #82)
 * ═══════════════════════════════════════════════════════════════════════════════
 * השורש-שנמדד (ראיות: 81910e2 15:14:03Z · guardian run 40308998903 intact=2):
 * sealRepo בענף-הספר (state/ledger.jsonl חי → merge -s ours — חוק-גל-57
 * "הספר-החי-הוא-הקאנון") מקדם-עץ-מקומי-מיושן; קבצי-פס-הקבלות בעץ (מהעידן-הכפול:
 * base64-טקסט) חוזרים-לענן כל-סבב-אטימה. נמדד-חי: הקלון-שלי-עצמו ירש-את-העץ-
 * המלוכלך (tests/receipt-sign.test.ts = base64-טקסט מ-81910e2).
 *
 * הריפוי: לפני-כל-מיזוג/דחיפה — נתיבי-הפס מאומצים-מ-FETCH_HEAD **רק-אם-התוכן
 * עובר-אימות-sha256 מול-תחילית-המניפסט**. אם-הענן-עצמו מושחת (בין-מחיקה-
 * להשבה) — האימוץ-מסרב (אפס-הפצת-קלון), משחזר-את-העץ-למצבו-הקודם, ומניח
 * למשביר-הדחיפה (rail-restorer) לרפא-את-הענן-מהבלובים-הקנוניים.
 * שני-החוקים-נשמרים: משמורת-הספר (-s ours לא-נוגע) והפס-הקנוני (אימוץ-מאומת).
 * אפס-רשת-חוץ: git מקומי-בלבד; fail-honest בכל-שלב; אפס-סודות. */
import { createHash } from "crypto";
import { execFile } from "child_process";
import type { ExecFileException } from "child_process";
import fs from "fs";
import path from "path";

export type AdoptLog = (e: Record<string, unknown>) => void;

/* יעד-אימוץ: נתיב + תחילית-sha256-של-האמת (מ-giant sovereign/rail-canonical/MANIFEST.sha256).
 * המניפסט-הוא-מקור-האמת; כאן-העתק-עבודה-מקומי — מתעדכן-עם-כל-רילנד-קנון. */
export interface RailAdoptTarget {
  path: string;
  sha256Prefix: string;
}

/* חמשת-נתיבי-פס-הקבלות + תחיליות-האמת (MANIFEST.sha256, שושלת 1969771/a618f33/8c7b87d) */
export const FLEET_RAIL_ADOPT_TARGETS: readonly RailAdoptTarget[] = [
  { path: "lib/receipt-sign.ts", sha256Prefix: "beff43c87e1da3b1" },
  { path: "tests/receipt-sign.test.ts", sha256Prefix: "c6337da164c63c65" },
  { path: "scripts/fleet-receipts-guard-core.py", sha256Prefix: "db896432ff6a0609" },
  { path: ".github/workflows/receipts-guard.yml", sha256Prefix: "0be08771e24dc785" },
  { path: "state/audit/verify_signatures.py", sha256Prefix: "cc935b38962b4c47" },
];

function git(dir: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: dir, timeout: 120_000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer" }, (err: ExecFileException | null, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout.toString("utf8")}${stderr.toString("utf8")}`.slice(0, 2000), buf: stdout as Buffer });
    });
  }).then((r) => r as { ok: boolean; out: string; buf: Buffer });
}

function sha256PrefixOf(buf: Buffer, prefixLen = 16): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, prefixLen);
}

/* מאמץ נתיבי-פס מ-FETCH_HEAD לתוך העץ-החי — רק-תוכן-שעובר-אימות-sha256.
 * עץ-מיושן-שלא-קומט → האימוץ-מנקה-לבד (הקנון-חוזר); עץ-מיושן-שקומט (HEAD-ישן)
 * → נשאר-שינוי-מוקפא → קומיט-אימוץ. כשל-אימות → העץ-משוחזר-בייטים-למצבו-הקודם.
 * כל-כשל כנה-ביומן ולא-מפיל את הקורא. */
export async function adoptCanonicalPaths(
  dir: string,
  remote: string,
  targets: readonly RailAdoptTarget[],
  log: AdoptLog = () => {},
): Promise<{ adopted: boolean; changed: string[] }> {
  const fp = await git(dir, ["fetch", remote, "main"]);
  if (!fp.ok) {
    log({ action: "adopt-fetch-fail", out: fp.out.slice(0, 180) });
    return { adopted: false, changed: [] };
  }
  const changed: string[] = [];
  let needsCommit = false;
  for (const t of targets) {
    const f = path.join(dir, t.path);
    const before = fs.existsSync(f) ? fs.readFileSync(f) : null;
    const ck = await git(dir, ["checkout", "FETCH_HEAD", "--", t.path]);
    if (!ck.ok) {
      log({ action: "adopt-path-fail", path: t.path, out: ck.out.slice(0, 180) });
      continue;
    }
    const after = fs.existsSync(f) ? fs.readFileSync(f) : null;
    /* אימות-מניפסט: התוכן-שנשלף-חייב-להיות-האמת — אחרת-הענן-מושחת והאימוץ-מסרב */
    const verified = after !== null && sha256PrefixOf(after).startsWith(t.sha256Prefix);
    if (!verified) {
      if (before !== null) fs.writeFileSync(f, before); else try { fs.rmSync(f, { force: true }); } catch { /* כנה */ }
      log({ action: "adopt-unverified", path: t.path, cloudSha: after ? sha256PrefixOf(after) : "absent", expectedPrefix: t.sha256Prefix, note: "הענן-מושחת? האימוץ-מסרב · העץ-משוחזר-למצבו · הריפוי-מצד-המשביר" });
      continue;
    }
    const differs = !before || !after || !before.equals(after);
    if (differs) {
      changed.push(t.path);
      // עץ-מיושן-שקומט (HEAD-ישן) → האימוץ-משאיר-שינוי-מוקפא → חייב-קומיט.
      // עץ-מיושן-שלא-קומט (לכלוך-חי) → האימוץ-מנקה-לבד (העץ-חוזר-לקנון) — אין-קומיט.
      const st = await git(dir, ["status", "--porcelain", "--", t.path]);
      const dirty = st.out.split("\n").filter((l) => l && !l.startsWith("##")).length > 0;
      if (dirty) needsCommit = true;
    }
  }
  if (changed.length === 0) {
    log({ action: "adopt-clean", note: "העץ-כבר-קנון-מאומת · אפס-אימוץ" });
    return { adopted: false, changed };
  }
  if (needsCommit) {
    const cm = await git(dir, [
      "commit", "-q", "-m",
      `vault-seal [rail-canonical-adopt]: ${changed.length} rail paths re-adopted sha-verified from cloud canon — עץ-החי-לא-מפרסם-פס-מיושן (גל-82ג · trace 1a178c614313ad05)`,
    ]);
    if (!cm.ok && !cm.out.includes("nothing to commit")) {
      log({ action: "adopt-commit-fail", out: cm.out.slice(0, 180) });
      return { adopted: false, changed };
    }
  }
  log({ action: "adopted", paths: changed, committed: needsCommit });
  return { adopted: true, changed };
}
