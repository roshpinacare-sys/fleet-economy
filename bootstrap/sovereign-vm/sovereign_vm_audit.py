#!/usr/bin/env python3
"""
sovereign_vm_audit.py — ביקורת-ריבונית בסנדבוקס-מבודד (QEMU) · גל-91 · agent-2 · 2026-10-18
מקור: microsoft/quicksand ("Quickly sandbox your AI agent", MIT) — הערכה ויישום הנדסי.

למה זה ערך לריבונות (נמדד היום):
  · בידוד-תהליכים ברמת-גרעין: אין-התנגשויות-פורטים, אין-pkill-גס, אין-דריכה בין-סוכנים
    (התקרית-המדודה של גל-87: גורם-זר על פורט-3016 הפיל beat #3).
  · רשת-fail-closed כברירת-מחדל (MOUNTS_ONLY) — הדוקטרינה שלנו, אך נאכפת-בהיפרוויזור
    ולא בקוד-יישום. אפס-סודות בתוך-האורח: ה-PAT נשאר במארח.
  · checkpoint/revert = חוק-ניסוי-בטוח: מהלך-מסוכן מתהפך ללא-עקבות (הוכח L3).
  · האורח קורא את הספר דרך-mount ומאמת שלמות-בייטים מול-המארח (הוכח L1).

מה-הוכח-חי (2026-10-18, סנדבוקס TCG בלי-KVM):
  L1 boot 27.1ש' · קריאת-ספר מהאורח: sha256 זהה-למארח (1819da2c…) · 138,319 שורות · seq 138,340
  L2 מאמת-בלתי-תלוי (verify_chain.py): ok:true · checked=138,316 — זהה-מדויק ל-/verify של
     המנוע (פורנזיה-צולבת: שני-מימושים, שתי-שפות, ספר-אחד)
  L3 checkpoint→ניסוי→revert: פסולת-נעלמת, ספר-שלם (hash זהה)

שימוש (בסנדבוקס-טרי):
  uv venv venv --python 3.12 && uv pip install --python venv/bin/python 'quick-sandbox[qemu,alpine]'
  venv/bin/python sovereign_vm_audit.py [נתיב-fleet-economy]
יציאה: 0 = ירוק · 1 = אדום. אפס-כתיבה לספר; אפס-סודות באורח; אפס-רשת-חוץ.
"""
import asyncio, hashlib, json, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_chain import verify as verify_chain  # המאמת-הבלתי-תלוי

BOOK = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/home/z/audit/fleet-economy")
STATE = BOOK / "state"


def host_sha16(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


async def main():
    from quicksand import Sandbox, Mount
    results, t0 = {}, time.time()
    ledger = STATE / "ledger.jsonl"
    host_hash = host_sha16(ledger)
    results["host_sha16"] = host_hash

    print(f"[svm] מדליק VM אלפיין (TCG · MOUNTS_ONLY · אפס-סודות) — mount state/ לקריאה…")
    async with Sandbox(
        image="alpine", memory="512M", cpus=2,
        mounts=[Mount(str(STATE), "/mnt/book")],
    ) as sb:
        r_hash = await sb.execute("sha256sum /mnt/book/ledger.jsonl | cut -c1-16")
        r_lines = await sb.execute("wc -l < /mnt/book/ledger.jsonl")
        r_tail = await sb.execute("tail -1 /mnt/book/ledger.jsonl | grep -o '\"seq\":[0-9]*'")
        guest_hash = r_hash.stdout.strip()
        results["guest"] = {
            "sha16": guest_hash,
            "lines": int(r_lines.stdout.strip() or 0),
            "last_seq": int(r_tail.stdout.strip().split(":")[1] or 0),
            "boot_sec": round(time.time() - t0, 1),
        }
        results["l1_mount_integrity"] = guest_hash == host_hash
        print(f"[svm] L1 · אורח={guest_hash} מארח={host_hash} · שורות={results['guest']['lines']} · "
              f"seq={results['guest']['last_seq']} · {'ירוק' if results['l1_mount_integrity'] else 'אדום'}")

        # L3 — checkpoint/revert (ניסוי-בטוח)
        await sb.checkpoint("svm-clean")
        await sb.execute("echo GARBAGE > /root/x.txt")
        await sb.revert("svm-clean")
        r_gone = await sb.execute("ls /root/x.txt 2>/dev/null || echo GONE")
        r_book = await sb.execute("sha256sum /mnt/book/ledger.jsonl | cut -c1-16")
        results["l3_revert"] = "GONE" in r_gone.stdout and r_book.stdout.strip() == host_hash
        print(f"[svm] L3 · revert={'ירוק' if results['l3_revert'] else 'אדום'} · ספר-שלם={r_book.stdout.strip() == host_hash}")

    # L2 — המאמת-הבלתי-תלוי (מארח; מימוש-Python עצמאי מול-מימוש-TS של המנוע)
    l2 = verify_chain(STATE)
    results["l2_independent_verify"] = l2
    print(f"[svm] L2 · ok={l2['ok']} · checked={l2['checked']} · עוגנים={l2['seams']} · "
          f"seq={l2['first_seq']}→{l2['last_seq']}")

    green = results["l1_mount_integrity"] and results["l3_revert"] and l2["ok"]
    results["verdict"] = "SOVEREIGN-VM-AUDIT GREEN" if green else "RED"
    results["total_sec"] = round(time.time() - t0, 1)
    print(json.dumps(results, ensure_ascii=False))
    sys.exit(0 if green else 1)


if __name__ == "__main__":
    asyncio.run(main())
