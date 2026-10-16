import Link from "next/link";
import { query } from "@/lib/db";
import { createRfq, deleteRfq } from "@/app/quote-actions";
import { date, ils, rfqNo, RFQ_STATUS } from "@/lib/format";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";
type SP = Promise<{ status?: string; supplier?: string; msg?: string; err?: string }>;

// דרישה 17: דשבורד הצעות מחיר פתוחות
export default async function Quotes({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const suppliers = await query<{ id: number; name: string }>("SELECT id, name FROM suppliers WHERE active ORDER BY name");
  const counts = Object.fromEntries((await query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM rfqs GROUP BY status")).map((r) => [r.status, r.n]));
  const [overdue] = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM rfqs WHERE status='sent' AND due_date < current_date");
  const rows = await query<{ id: number; supplier: string; supplier_id: number; status: string; due_date: Date;
    created_at: Date; sent_at: Date; lines: number; total: string | null; priced: number; delete_reason: string }>(`
    SELECT r.id, s.name AS supplier, s.id AS supplier_id, r.status, r.due_date, r.created_at, r.sent_at, r.delete_reason,
      count(l.id)::int AS lines, count(l.quoted_price)::int AS priced, sum(l.qty * l.quoted_price) AS total
    FROM rfqs r JOIN suppliers s ON s.id=r.supplier_id LEFT JOIN rfq_lines l ON l.rfq_id=r.id
    WHERE (CASE WHEN $1='open' THEN r.status IN ('draft','sent','answered') WHEN $1='all' THEN r.status<>'deleted'
           ELSE r.status=$1 END)
      AND ($2='' OR s.id::text=$2)
    GROUP BY r.id, s.name, s.id ORDER BY r.id DESC`, [status, sp.supplier ?? ""]);
  const tab = (key: string, label: string, n?: number) => (
    <Link className={`btn ${status === key ? "" : "secondary"}`} href={`/quotes?status=${key}`}>
      {label}{n !== undefined ? ` (${n})` : ""}</Link>
  );
  const isOverdue = (r: { status: string; due_date: Date }) =>
    r.status === "sent" && r.due_date && new Date(r.due_date) < new Date(new Date().toDateString());
  return (
    <>
      <h2>הצעות מחיר</h2>
      <Msg sp={sp} />
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card"><div className="muted">טיוטות</div><div className="stat">{counts.draft ?? 0}</div></div>
        <div className="card"><div className="muted">ממתינות לתשובת ספק</div><div className="stat">{counts.sent ?? 0}</div></div>
        <div className="card"><div className="muted">עבר תאריך היעד</div><div className="stat" style={{ color: overdue.n ? "var(--danger)" : undefined }}>{overdue.n}</div></div>
        <div className="card"><div className="muted">התקבלו הצעות</div><div className="stat">{counts.answered ?? 0}</div></div>
      </div>
      <div className="toolbar">
        {tab("open", "פתוחות")}{tab("draft", "טיוטות", counts.draft ?? 0)}{tab("sent", "נשלחו", counts.sent ?? 0)}
        {tab("answered", "התקבלו", counts.answered ?? 0)}{tab("closed", "סגורות", counts.closed ?? 0)}
        {tab("deleted", "נמחקו", counts.deleted ?? 0)}{tab("all", "הכל")}
      </div>
      <table>
        <thead><tr><th>מספר</th><th>ספק</th><th>סטטוס</th><th>שורות</th><th>תומחרו</th><th>סה"כ מוצע</th><th>נוצרה</th><th>תאריך יעד</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="ltr"><Link href={`/quotes/${r.id}`}>{rfqNo(r.id)}</Link></td>
              <td><Link href={`/suppliers/${r.supplier_id}`}>{r.supplier}</Link></td>
              <td><span className={`badge ${r.status === "deleted" ? "off" : r.status === "draft" ? "manual" : ""}`}>{RFQ_STATUS[r.status]}</span>
                {isOverdue(r) && <> <span className="badge off">באיחור</span></>}</td>
              <td>{r.lines}</td><td>{r.priced}/{r.lines}</td><td>{ils(r.total)}</td>
              <td>{date(r.created_at)}</td><td>{date(r.due_date)}</td>
              <td>{r.status !== "deleted" ? (
                <form action={deleteRfq} className="inline">
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="return" value={`/quotes?status=${status}`} />
                  <button className="danger">מחיקה</button></form>
              ) : <span className="muted">{r.delete_reason}</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="muted">אין בקשות להצגה</td></tr>}
        </tbody>
      </table>
      <h3>בקשה חדשה להצעת מחיר</h3>
      <form action={createRfq} className="card form-grid">
        <label>ספק *<select name="supplier_id" required defaultValue="">
          <option value="" disabled>בחירת ספק</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label>תאריך יעד לתשובה<input type="date" name="due_date" /></label>
        <label>הערות לספק<input name="notes" /></label>
        <button>יצירה והוספת פריטים</button>
      </form>
    </>
  );
}
