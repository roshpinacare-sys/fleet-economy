/* גל-82ג · בדיקות-אימוץ-קנוני-מאומת (trace 1a178c614313ad05 · wave #82)
 * השורש-שנמדד: sealRepo בענף-הספר (merge -s ours) מקדם-עץ-מקומי-מיושן
 * → קבצי-פס-הקבלות (base64-טקסט-מהעידן-הכפול) חוזרים-לענן כל-סבב-אטימה.
 * הריפוי: adoptCanonicalPaths — אימוץ-מ-FETCH_HEAD **רק-אחרי-אימות-sha256**
 * מול-תחילית-המניפסט; ענן-מושחת → סירוב-כנה (אפס-הפצת-קלון).
 * TDD: הבדיקות נכתבו-ראשונות (אדום-מאומת), המימוש אחריהן.
 * אפס-רשת: repos-זמניים-מקומיים בלבד (git init + bare remote). */
import { describe, test, expect, beforeAll } from "bun:test";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { adoptCanonicalPaths, FLEET_RAIL_ADOPT_TARGETS, type RailAdoptTarget } from "../rail-adopt";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout;
}

const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

let tmp = "";

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rail-adopt-"));
});

/* בניית-עולם: cloud (bare) עם-פס-אמת; work (clone) עם-עץ-מיושן-מלוכלך */
async function makeWorld(files: Record<string, string>, stale: Record<string, string>) {
  const cloud = path.join(tmp, `cloud-${Math.random().toString(36).slice(2)}`);
  const work = path.join(tmp, `work-${Math.random().toString(36).slice(2)}`);
  await run("git", ["init", "--bare", "--initial-branch=main", cloud]);
  await run("git", ["clone", cloud, work]);
  await git(work, "config", "user.email", "test@local");
  await git(work, "config", "user.name", "test");
  for (const [p, c] of Object.entries(files)) {
    const f = path.join(work, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, c);
  }
  await git(work, "add", "-A");
  await git(work, "commit", "-q", "-m", "seed");
  await git(work, "push", "-q", "origin", "main");
  // עץ-מיושן: שינוי-מקומי-ללא-קומיט על אותם-נתיבים (הגרסה-המלוכלכת)
  for (const [p, c] of Object.entries(stale)) fs.writeFileSync(path.join(work, p), c);
  return { cloud, work };
}

describe("FLEET_RAIL_ADOPT_TARGETS (חוזה-היעדים)", () => {
  test("חמשת-נתיבי-הפס-הקנוניים עם-תחיליות-מניפסט (MANIFEST.sha256)", () => {
    expect(FLEET_RAIL_ADOPT_TARGETS.map((t) => t.path)).toEqual([
      "lib/receipt-sign.ts",
      "tests/receipt-sign.test.ts",
      "scripts/fleet-receipts-guard-core.py",
      ".github/workflows/receipts-guard.yml",
      "state/audit/verify_signatures.py",
    ]);
    for (const t of FLEET_RAIL_ADOPT_TARGETS) {
      expect(t.sha256Prefix).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe("adoptCanonicalPaths", () => {
  const TRUE = "/* receipt-sign TRUE */\nexport const LAW = 1;\n";
  const target: RailAdoptTarget[] = [{ path: "lib/receipt-sign.ts", sha256Prefix: sha16(TRUE) }];

  test("עץ-מיושן → מאמץ-אמת-מהענן (sha-עובר) + עץ-נקי", async () => {
    const { work } = await makeWorld(
      { "lib/receipt-sign.ts": TRUE, "state/ledger.jsonl": "{\"seq\":1}\n" },
      { "lib/receipt-sign.ts": "Lyog4pWQ4pWQIHJlY2Vp — base64-טקסט-מיושן" },
    );
    const logs: Record<string, unknown>[] = [];
    const r = await adoptCanonicalPaths(work, "origin", target, (e) => logs.push(e));
    expect(r.adopted).toBe(true);
    expect(r.changed).toContain("lib/receipt-sign.ts");
    expect(fs.readFileSync(path.join(work, "lib/receipt-sign.ts"), "utf8")).toBe(TRUE);
    const st = await git(work, "status", "--porcelain");
    expect(st.trim()).toBe(""); // הלכלוך-החי-נמחק-לבד (ללא-קומיט)
    expect(logs.some((l) => l.action === "adopted")).toBe(true);
  });

  test("עץ-מיושן-שקומט (HEAD-ישן) → אימוץ + קומיט-אימוץ", async () => {
    const { work } = await makeWorld({ "lib/receipt-sign.ts": TRUE }, {});
    // קומט-גרסה-מיושנת ב-HEAD (כמו-העץ-של-האוטם-אחרי-סבב-אטימה-מלוכלך)
    fs.writeFileSync(path.join(work, "lib/receipt-sign.ts"), "committed-stale-b64-text");
    await git(work, "add", "-A");
    await git(work, "commit", "-q", "-m", "stale seal commit");
    await git(work, "push", "-q", "origin", "main");
    // הענן-עכשיו-מיושן-גם-הוא → מחזירים-אותו-לאמת (כמו-המשביר-יעשה)
    await git(work, "push", "-q", "-f", "origin", `${await (async () => {
      // בלי-force: בונים-קומיט-אמת-חדש-מעל
      fs.writeFileSync(path.join(work, "lib/receipt-sign.ts"), TRUE);
      await git(work, "add", "-A");
      await git(work, "commit", "-q", "-m", "restore TRUE");
      return (await git(work, "rev-parse", "HEAD")).trim();
    })()}:main`);
    // עץ-עבודה: מיושן-שוב (מצב-האוטם)
    fs.writeFileSync(path.join(work, "lib/receipt-sign.ts"), "committed-stale-b64-text-2");
    await git(work, "add", "-A");
    await git(work, "commit", "-q", "-m", "stale seal commit 2");
    const logs: Record<string, unknown>[] = [];
    const r = await adoptCanonicalPaths(work, "origin", target, (e) => logs.push(e));
    expect(r.adopted).toBe(true);
    expect(fs.readFileSync(path.join(work, "lib/receipt-sign.ts"), "utf8")).toBe(TRUE);
    const st = await git(work, "status", "--porcelain");
    expect(st.trim()).toBe(""); // קומיט-האימוץ בוצע — העץ-נקי
    const count = parseInt((await git(work, "rev-list", "--count", "HEAD")).trim());
    expect(count).toBeGreaterThan(3); // נוסף-קומיט-אימוץ
  });

  test("עץ-כבר-אמת → אין-אימוץ, אין-קומיט, יומן-adopt-clean", async () => {
    const { work } = await makeWorld({ "lib/receipt-sign.ts": TRUE }, {});
    const logs: Record<string, unknown>[] = [];
    const r = await adoptCanonicalPaths(work, "origin", target, (e) => logs.push(e));
    expect(r.adopted).toBe(false);
    expect(r.changed).toEqual([]);
    expect(logs.some((l) => l.action === "adopt-clean")).toBe(true);
    const count = (await git(work, "rev-list", "--count", "HEAD")).trim();
    expect(count).toBe("1");
  });

  test("ענן-מושחת (sha-לא-תואם) → סירוב-כנה, אפס-הפצת-קלון, העץ-לא-נפגע", async () => {
    const GOOD = "export const LAW = 3;\n";
    const { work } = await makeWorld({ "lib/receipt-sign.ts": GOOD }, { "lib/receipt-sign.ts": "live-dirty-junk" });
    // יעד-עם-sha-של-אמת-אחרת → תוכן-הענן-לא-עובר
    const badTarget: RailAdoptTarget[] = [{ path: "lib/receipt-sign.ts", sha256Prefix: sha16("a different truth") }];
    const logs: Record<string, unknown>[] = [];
    const r = await adoptCanonicalPaths(work, "origin", badTarget, (e) => logs.push(e));
    expect(r.adopted).toBe(false);
    expect(r.changed).toEqual([]);
    expect(logs.some((l) => l.action === "adopt-unverified" && l.path === "lib/receipt-sign.ts")).toBe(true);
    // העץ-נשאר-בדיוק-כפי-שהיה (הלכלוך-החי-לא-הוחלף-בקלון-הענן ולא-באמת-אחרת)
    expect(fs.readFileSync(path.join(work, "lib/receipt-sign.ts"), "utf8")).toBe("live-dirty-junk");
  });

  test("נתיב-חסר-בענן → כשל-כנה-ביומן, לא-מפיל, שאר-הנתיבים מאומצים", async () => {
    const T2 = "export const LAW = 4;\n";
    const { work } = await makeWorld(
      { "lib/receipt-sign.ts": T2 },
      { "lib/receipt-sign.ts": "stale-junk" },
    );
    const logs: Record<string, unknown>[] = [];
    const r = await adoptCanonicalPaths(
      work, "origin",
      [{ path: "lib/receipt-sign.ts", sha256Prefix: sha16(T2) }, { path: "lib/does-not-exist-upstream.ts", sha256Prefix: "0123456789abcdef" }],
      (e) => logs.push(e),
    );
    expect(r.adopted).toBe(true);
    expect(r.changed).toEqual(["lib/receipt-sign.ts"]);
    expect(logs.some((l) => l.action === "adopt-path-fail" && l.path === "lib/does-not-exist-upstream.ts")).toBe(true);
  });

  test("remote-שבור → כשל-כנה adopted=false, אפס-הטלה", async () => {
    const { work } = await makeWorld({ "lib/receipt-sign.ts": "x" }, {});
    const logs: Record<string, unknown>[] = [];
    const r = await adoptCanonicalPaths(work, "no-such-remote", target, (e) => logs.push(e));
    expect(r.adopted).toBe(false);
    expect(logs.some((l) => l.action === "adopt-fetch-fail")).toBe(true);
  });
});
