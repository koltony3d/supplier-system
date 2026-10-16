import Link from "next/link";
import { query } from "@/lib/db";
import { createReceiptFromPo, createReceiptNoPo } from "@/app/receipt-actions";
import { date, grNo, poNo } from "@/lib/format";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

// דרישה 16: דשבורד קבלת סחורה (ידני; סריקת מסמך תתווסף בשלב 5)
export default async function Receiving({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const openPos = await query<{ id: number; supplier: string; expected_date: Date | null; status: string; remaining: string }>(`
    SELECT p.id, s.name AS supplier, p.expected_date, p.status, sum(GREATEST(l.qty - l.received_qty, 0)) AS remaining
    FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id JOIN po_lines l ON l.po_id=p.id
    WHERE p.status IN ('sent','partial') GROUP BY p.id, s.name ORDER BY p.expected_date NULLS LAST, p.id`);
  const suppliers = await query<{ id: number; name: string }>("SELECT id, name FROM suppliers WHERE active ORDER BY name");
  const receipts = await query<{ id: number; supplier: string; po_id: number | null; status: string; delivery_note_no: string;
    received_date: Date; lines: number; total_qty: string; disc: number }>(`
    SELECT r.id, s.name AS supplier, r.po_id, r.status, r.delivery_note_no, r.received_date,
      (SELECT count(*)::int FROM receipt_lines WHERE receipt_id=r.id) AS lines,
      (SELECT coalesce(sum(qty),0) FROM receipt_lines WHERE receipt_id=r.id) AS total_qty,
      (SELECT count(*)::int FROM discrepancies d LEFT JOIN discrepancy_notes n ON n.key=d.key
        WHERE n.key IS NULL AND d.receipt_id=r.id) AS disc
    FROM receipts r JOIN suppliers s ON s.id=r.supplier_id ORDER BY r.id DESC LIMIT 100`);
  const [{ open_disc }] = await query<{ open_disc: number }>(`SELECT count(*)::int AS open_disc FROM discrepancies d
    LEFT JOIN discrepancy_notes n ON n.key=d.key WHERE n.key IS NULL`);
  const drafts = receipts.filter((r) => r.status === "draft").length;
  return (
    <>
      <h2>קבלת סחורה</h2>
      <Msg sp={sp} />
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card"><div className="muted">הזמנות שממתינות לסחורה</div><div className="stat">{openPos.length}</div></div>
        <div className="card"><div className="muted">קבלות בטיוטה</div><div className="stat">{drafts}</div></div>
        <Link className="card" href="/discrepancies"><div className="muted">אי התאמות פתוחות</div>
          <div className="stat" style={{ color: open_disc ? "var(--danger)" : undefined }}>{open_disc}</div></Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <form action={createReceiptFromPo} className="card">
          <h3 style={{ marginTop: 0 }}>קבלה לפי הזמנה</h3>
          <p className="muted">השורות נפתחות עם הכמות שנשארה לקבל. התאמה מלאה: מאשרים. חלקית: מעדכנים כמויות.</p>
          <div className="form-grid">
            <label>הזמנה *<select name="po_id" required defaultValue="">
              <option value="" disabled>בחירת הזמנה</option>
              {openPos.map((p) => <option key={p.id} value={p.id}>{poNo(p.id)} · {p.supplier}{p.expected_date ? ` · ${date(p.expected_date)}` : ""}</option>)}
            </select></label>
            <label>מספר תעודת משלוח<input name="delivery_note_no" /></label>
            <button>פתיחת קבלה</button>
          </div>
        </form>
        <form action={createReceiptNoPo} className="card">
          <h3 style={{ marginTop: 0 }}>קבלה ללא הזמנת ספק</h3>
          <p className="muted">לסחורה שהגיעה בלי הזמנה. מזינים שורות לפי מק"ט שלנו או מק"ט ספק.</p>
          <div className="form-grid">
            <label>ספק *<select name="supplier_id" required defaultValue="">
              <option value="" disabled>בחירת ספק</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
            <label>מספר תעודת משלוח<input name="delivery_note_no" /></label>
            <button>פתיחת קבלה</button>
          </div>
        </form>
        <div className="card" style={{ opacity: 0.6 }}>
          <h3 style={{ marginTop: 0 }}>סריקת מסמך PDF / JPG</h3>
          <p className="muted">קריאה אוטומטית של תעודת משלוח והתאמה להזמנה. ייבנה בשלב 5.</p>
        </div>
      </div>

      <h3>הזמנות שממתינות לסחורה</h3>
      <table>
        <thead><tr><th>הזמנה</th><th>ספק</th><th>אספקה צפויה</th><th>יתרה לקבלה (יח')</th></tr></thead>
        <tbody>
          {openPos.map((p) => (
            <tr key={p.id}><td className="ltr"><Link href={`/orders/${p.id}`}>{poNo(p.id)}</Link></td><td>{p.supplier}</td>
              <td>{date(p.expected_date)}</td><td>{Number(p.remaining)}</td></tr>))}
          {openPos.length === 0 && <tr><td colSpan={4} className="muted">אין הזמנות פתוחות</td></tr>}
        </tbody>
      </table>

      <h3>קבלות אחרונות</h3>
      <table>
        <thead><tr><th>מספר</th><th>ספק</th><th>הזמנה</th><th>ת. משלוח</th><th>תאריך</th><th>שורות</th><th>סה"כ יח'</th><th>סטטוס</th></tr></thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.id}>
              <td className="ltr"><Link href={`/receiving/${r.id}`}>{grNo(r.id)}</Link></td><td>{r.supplier}</td>
              <td className="ltr">{r.po_id ? <Link href={`/orders/${r.po_id}`}>{poNo(r.po_id)}</Link> : <span className="muted">ללא הזמנה</span>}</td>
              <td>{r.delivery_note_no}</td><td>{date(r.received_date)}</td><td>{r.lines}</td><td>{Number(r.total_qty)}</td>
              <td><span className={`badge ${r.status === "draft" ? "manual" : ""}`}>{r.status === "draft" ? "טיוטה" : "נקלטה"}</span>
                {r.disc > 0 && <> <span className="badge off">{r.disc} אי התאמות</span></>}</td>
            </tr>))}
          {receipts.length === 0 && <tr><td colSpan={8} className="muted">עדיין אין קבלות</td></tr>}
        </tbody>
      </table>
    </>
  );
}
