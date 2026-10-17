/* ═══ fleet-economy · selftest.ts · ראיות-מכונה לתיקון-השימור (גל-86) ═══
 * רץ ללא-שרת וללא-טיימרים (FE_NO_SERVE=1) על ספרית-מדינה נקייה (FE_STATE_DIR).
 * הרצה: bun run selftest
 * כל-טענה כאן מדודה מול הספר-עצמו — אפס-טענות-על-קופסאות-שחורות.
 * ============================================================================== */
import fs from "fs";

process.env.FE_NO_SERVE = "1";
process.env.FE_STATE_DIR = process.env.FE_STATE_DIR ?? `/tmp/fe-selftest-${process.pid}-${Date.now()}`;

const { apply, ammSwap, bal, verifyChain, sumBalances, checkConservation, seqNow, haltState } = await import("./index.ts");

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const EPS = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/* ── 1. גנסיס: שימור-הצע מדויק + בריכה-אובייקט-יחיד ────────────────────────── */
console.log("genesis:");
{
  const { s, u } = sumBalances();
  ok("ΣSAOS = 21,000 בגנסיס", near(s, 21_000), `Σ=${s.toFixed(4)}`);
  ok("ΣUSDS = 60,000 בגנסיס", near(u, 60_000), `Σ=${u.toFixed(4)}`);
  ok("checkConservation ירוק", checkConservation() === null);
  const poolAcc = bal("pool") as any;
  ok("בריכה-אובייקט-יחיד (המפה מחזיקה את המשתנה-עצמו — feesUsds חי-בתוכה)", typeof poolAcc.feesUsds === "number", `pool.saos=${poolAcc.saos?.toFixed?.(2)} · feesUsds=${poolAcc.feesUsds}`);
  const genesisTx = JSON.parse(fs.readFileSync(`${process.env.FE_STATE_DIR}/ledger.jsonl`, "utf8").split("\n")[0]);
  ok("עסקת-הגנסיס-הראשונה: הקצאה מתועדת מהכספת", genesisTx.kind === "genesis-alloc" && genesisTx.from === "treasury");
}

/* ── 2. קניית SAOS ב-USDS: הסוחר מקבל את-הפלט (תיקון-הבאג-ההיסטורי) ─────────── */
console.log("swap USDS→SAOS:");
{
  const pre = { ...(bal("yarden") as any) };
  const prePool = { ...(bal("pool") as any) };
  const tx: any = ammSwap("yarden", "USDS", 100, "selftest: קניית-ביקורת");
  ok("הסוואפ בוצע", !!tx);
  ok("פלט-SAOS חיובי", tx && tx.outSaos > 0, `outSaos=${tx?.outSaos}`);
  ok("הסוחר קיבל את-הפלט לארנקו", near((bal("yarden") as any).saos, pre.saos + tx.outSaos));
  ok("הסוחר שילם את-הקלט", near((bal("yarden") as any).usds, pre.usds - 100));
  ok("הבריכה קיבלה את-הקלט", near((bal("pool") as any).usds, prePool.usds + 100));
  ok("הבריכה שילמה את-הפלט", near((bal("pool") as any).saos, prePool.saos - tx.outSaos));
  ok("עמלה נרשמה בספירת-הבריכה", near((bal("pool") as any).feesUsds - prePool.feesUsds, tx.fee), `fee=${tx.fee}`);
  const { s, u } = sumBalances();
  ok("שימור-מלא אחרי-קנייה", near(s, 21_000) && near(u, 60_000), `ΣSAOS=${s.toFixed(4)} · ΣUSDS=${u.toFixed(4)}`);
}

/* ── 3. מכירת SAOS ל-USDS: הכיוון-ההפוך, הכול דרך-הספר ────────────────────── */
console.log("swap SAOS→USDS:");
{
  ammSwap("tamar", "USDS", 200, "selftest: קנייה-לקראת-מכירה");
  const pre = { ...(bal("tamar") as any) };
  const prePool = { ...(bal("pool") as any) };
  const tx: any = ammSwap("tamar", "SAOS", 30, "selftest: מכירת-ביקורת");
  ok("מכירה בוצעה", !!tx);
  ok("פלט-USDS חיובי", tx && tx.outUsds > 0, `outUsds=${tx?.outUsds}`);
  ok("המוכרת קיבלה USDS לארנקה", near((bal("tamar") as any).usds, pre.usds + tx.outUsds));
  ok("המוכרת שילמה SAOS", near((bal("tamar") as any).saos, pre.saos - 30));
  ok("הבריכה קיבלה SAOS ושילמה USDS", near((bal("pool") as any).saos, prePool.saos + 30) && near((bal("pool") as any).usds, prePool.usds - tx.outUsds));
  const { s, u } = sumBalances();
  ok("שימור-מלא אחרי-מכירה", near(s, 21_000) && near(u, 60_000));
}

/* ── 4. השרשרת: אימות-מלא מהגנסיס ─────────────────────────────────────────── */
console.log("chain:");
{
  const v = verifyChain();
  ok("verifyChain ok:true", v.ok === true, `checked=${v.checked}`);
  ok("כל-הרשומות נאמתו (checked === seq)", v.checked === seqNow(), `checked=${v.checked} · seq=${seqNow()}`);
}

/* ── 5. דחיית-יתרה fail-closed ─────────────────────────────────────────────── */
console.log("rejections:");
{
  const r1 = ammSwap("erez", "USDS", 1e12, "selftest: יתרה-חסרה");
  ok("סוואפ-על-חשבון-ריק נדחה", r1 === null);
  const r2 = apply({ seq: seqNow() + 1, ts: Date.now(), kind: "service", from: "gal", to: "treasury", asset: "USDS", amount: 1e9, reason: "selftest: חריגה" });
  ok("עסקה-מעל-יתרה נדחית", r2 === null);
  const { s, u } = sumBalances();
  ok("שימור לא נפגע מדחיות", near(s, 21_000) && near(u, 60_000));
}

/* ── 6. סטייק/ביטול-סטייק: שימור ──────────────────────────────────────────── */
console.log("stake:");
{
  const w = bal("shachar") as any;
  const tx: any = apply({ seq: seqNow() + 1, ts: Date.now(), kind: "stake", from: "shachar", to: "shachar", asset: "SAOS", amount: 5, reason: "selftest: סטייק" });
  ok("סטייק בוצע", !!tx && near(w.saosStaked, 5), `staked=${w.saosStaked}`);
  const pre = { ...w };
  const tx2: any = apply({ seq: seqNow() + 1, ts: Date.now(), kind: "unstake", from: "shachar", to: "shachar", asset: "SAOS", amount: 2, reason: "selftest: ביטול-סטייק" });
  ok("ביטול-סטייק מחזיר ליתרה", !!tx2 && near(w.saosStaked, 3) && near(w.saos, pre.saos + 2));
  const { s } = sumBalances();
  ok("שימור-SAOS דרך-סטייק (staked נספר)", near(s, 21_000), `Σ=${s.toFixed(4)}`);
}

/* ── 7. דוראביליות: כל-רשומה על-הדיסק במקום-עבודה ──────────────────────────── */
console.log("durability:");
{
  const lines = fs.readFileSync(`${process.env.FE_STATE_DIR}/ledger.jsonl`, "utf8").split("\n").filter(Boolean);
  ok("מספר-שורות-בדיסק === seq (אפס-רשומות-אבודות)", lines.length === seqNow(), `lines=${lines.length} · seq=${seqNow()}`);
}

/* ── 8. HALT fail-closed: הפרה-מלאכותית מקפיאה ────────────────────────────── */
console.log("halt (fail-closed):");
{
  (bal("gal") as any).saos += 777; // הנפקה-סמויה-מלאכותית
  const r = ammSwap("gal", "USDS", 1, "selftest: בדיקת-HALT");
  ok("עסקה נדחית והמנוע נעצר", r === null && haltState() !== null, `halt=${haltState()?.slice(0, 60)}`);
}

console.log(`\nSELFTEST ${pass}/${pass + fail} PASS${fail ? ` · FAILURES: ${failures.join(", ")}` : " · אפס-כשלים"}`);
process.exit(fail ? 1 : 0);
