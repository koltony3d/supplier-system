import Link from "next/link";
import { query } from "@/lib/db";
import { createPo } from "@/app/order-actions";
import { date, ils, poNo, rfqNo, PO_STATUS } from "@/lib/format";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";
type SP = Promise<{ status?: string; supplier?: string; msg?: string; err?: string }>;

// דרישה 18: דשבורד הזמנות פתוחות
export default async function Orders({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const suppliers = await query<{ id: number; name: string }>("SELECT id, name FROM suppliers WHERE active ORDER BY name");
  const counts = Object.fromEntries((await query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM purchase_orders GROUP BY status")).map((r) => [r.status, r.n]));
  const [kpi] = await query<{ overdue: number; open_value: string | null }>(`
    SELECT (SELECT count(*)::int FROM purchase_orders WHERE status IN ('sent','partial') AND expected_date < current_date) AS overdue,
           (SELECT sum((l.qty - l.received_qty) * l.unit_price) FROM po_lines l JOIN purchase_orders p ON p.id=l.po_id
            WHERE p.status IN ('draft','sent','partial')) AS open_value`);
  const rows = await query<{ id: number; supplier: string; supplier_id: number; rfq_id: number | null; status: string;
    expected_date: Date | null; created_at: Date; lines: number; total: string | null; ordered: string; received: string }>(`
    SELECT p.id, s.name AS supplier, s.id AS supplier_id, p.rfq_id, p.status, p.expected_date, p.created_at,
      count(l.id)::int AS lines, sum(l.qty * l.unit_price) AS total,
      coalesce(sum(l.qty),0) AS ordered, coalesce(sum(l.received_qty),0) AS received
    FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN po_lines l ON l.po_id=p.id
    WHERE (CASE WHEN $1='open' THEN p.status IN ('draft','sent','partial') WHEN $1='all' THEN TRUE ELSE p.status=$1 END)
      AND ($2='' OR s.id::text=$2)
    GROUP BY p.id, s.name, s.id ORDER BY p.expected_date NULLS LAST, p.id DESC`, [status, sp.supplier ?? ""]);
  const tab = (key: string, label: string, n?: number) => (
    <Link className={`btn ${status === key ? "" : "secondary"}`} href={`/orders?status=${key}`}>{label}{n !== undefined ? ` (${n})` : ""}</Link>
  );
  const today = new Date(new Date().toDateString());
  return (
    <>
      <h2>הזמנות רכש</h2>
      <Msg sp={sp} />
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card"><div className="muted">טיוטות</div><div className="stat">{counts.draft ?? 0}</div></div>
        <div className="card"><div className="muted">ממתינות לסחורה</div><div className="stat">{(counts.sent ?? 0) + (counts.partial ?? 0)}</div></div>
        <div className="card"><div className="muted">באיחור אספקה</div><div className="stat" style={{ color: kpi.overdue ? "var(--danger)" : undefined }}>{kpi.overdue}</div></div>
        <div className="card"><div className="muted">שווי פתוח לקבלה</div><div className="stat">{ils(kpi.open_value ?? 0)}</div></div>
      </div>
      <div className="toolbar">
        {tab("open", "פתוחות")}{tab("draft", "טיוטות", counts.draft ?? 0)}{tab("sent", "נשלחו", counts.sent ?? 0)}
        {tab("partial", "התקבלו חלקית", counts.partial ?? 0)}{tab("received", "התקבלו", counts.received ?? 0)}
        {tab("cancelled", "בוטלו", counts.cancelled ?? 0)}{tab("all", "הכל")}
      </div>
      <table>
        <thead><tr><th>מספר</th><th>ספק</th><th>הצעת מחיר</th><th>סטטוס</th><th>שורות</th><th>התקבל</th><th>סה"כ</th><th>נוצרה</th><th>אספקה צפויה</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const late = (r.status === "sent" || r.status === "partial") && r.expected_date && new Date(r.expected_date) < today;
            const pct = Number(r.ordered) ? Math.round((Number(r.received) / Number(r.ordered)) * 100) : 0;
            return (
              <tr key={r.id}>
                <td className="ltr"><Link href={`/orders/${r.id}`}>{poNo(r.id)}</Link></td>
                <td><Link href={`/suppliers/${r.supplier_id}`}>{r.supplier}</Link></td>
                <td className="ltr">{r.rfq_id ? <Link href={`/quotes/${r.rfq_id}`}>{rfqNo(r.rfq_id)}</Link> : <span className="muted">ללא</span>}</td>
                <td><span className={`badge ${r.status === "cancelled" ? "off" : r.status === "draft" ? "manual" : ""}`}>{PO_STATUS[r.status]}</span>
                  {late && <> <span className="badge off">באיחור</span></>}</td>
                <td>{r.lines}</td><td>{pct}%</td><td>{ils(r.total)}</td>
                <td>{date(r.created_at)}</td><td>{date(r.expected_date)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={9} className="muted">אין הזמנות להצגה</td></tr>}
        </tbody>
      </table>
      <h3>הזמנה חדשה (בלי הצעת מחיר)</h3>
      <p className="muted">להזמנה מתוך הצעת מחיר: פותחים את ההצעה ולוחצים "הוצאת הזמנה מההצעה".</p>
      <form action={createPo} className="card form-grid">
        <label>ספק *<select name="supplier_id" required defaultValue="">
          <option value="" disabled>בחירת ספק</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label>תאריך אספקה צפוי<input type="date" name="expected_date" /></label>
        <label>הערות<input name="notes" /></label>
        <button>יצירה והוספת פריטים</button>
      </form>
    </>
  );
}
