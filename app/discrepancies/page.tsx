import Link from "next/link";
import { query } from "@/lib/db";
import { resolveDiscrepancy } from "@/app/receipt-actions";
import { date, grNo, ils, poNo, qty } from "@/lib/format";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";
type SP = Promise<{ show?: string; kind?: string; msg?: string; err?: string }>;

// דרישה 19: ריכוז אי התאמות
export default async function Discrepancies({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const show = sp.show === "resolved" ? "resolved" : "open";
  const rows = await query<{ key: string; kind: string; supplier: string; po_id: number | null; receipt_id: number | null;
    sku: string | null; name: string | null; supplier_sku: string | null; expected: string | null; actual: string | null;
    detected_at: Date; note: string | null; resolved_at: Date | null }>(`
    SELECT d.key, d.kind, s.name AS supplier, d.po_id, d.receipt_id, i.sku, i.name, d.supplier_sku, d.expected, d.actual,
      d.detected_at, n.note, n.resolved_at
    FROM discrepancies d JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN items i ON i.id=d.item_id
    LEFT JOIN discrepancy_notes n ON n.key=d.key
    WHERE (n.key IS NULL) = ($1='open') AND ($2='' OR d.kind=$2)
    ORDER BY d.detected_at DESC NULLS LAST`, [show, sp.kind ?? ""]);
  const kinds = await query<{ kind: string; n: number }>(`SELECT d.kind, count(*)::int AS n FROM discrepancies d
    LEFT JOIN discrepancy_notes n ON n.key=d.key WHERE n.key IS NULL GROUP BY d.kind ORDER BY d.kind`);
  const isPrice = (k: string) => k.startsWith("מחיר");
  const ret = `/discrepancies?show=${show}${sp.kind ? `&kind=${encodeURIComponent(sp.kind)}` : ""}`;
  return (
    <>
      <h2>ריכוז אי התאמות</h2>
      <Msg sp={sp} />
      <div className="grid" style={{ marginBottom: 16 }}>
        {kinds.map((k) => (
          <Link key={k.kind} className="card" href={`/discrepancies?kind=${encodeURIComponent(k.kind)}`}>
            <div className="muted">{k.kind}</div><div className="stat">{k.n}</div></Link>))}
        {kinds.length === 0 && <div className="card"><div className="muted">אי התאמות פתוחות</div><div className="stat">0</div></div>}
      </div>
      <div className="toolbar">
        <Link className={`btn ${show === "open" ? "" : "secondary"}`} href="/discrepancies">פתוחות</Link>
        <Link className={`btn ${show === "resolved" ? "" : "secondary"}`} href="/discrepancies?show=resolved">טופלו</Link>
        {sp.kind && <span className="badge">{sp.kind} · <Link href={`/discrepancies?show=${show}`}>הסרת סינון</Link></span>}
      </div>
      <table>
        <thead><tr><th>סוג</th><th>ספק</th><th>הזמנה</th><th>קבלה</th><th>פריט</th><th>צפוי</th><th>בפועל</th><th>הפרש</th><th>תאריך</th><th>{show === "open" ? "טיפול" : "הערה"}</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const fmt = isPrice(r.kind) ? ils : qty;
            const diff = r.expected !== null && r.actual !== null ? Number(r.actual) - Number(r.expected) : null;
            return (
              <tr key={r.key}>
                <td><span className="badge off">{r.kind}</span></td><td>{r.supplier}</td>
                <td className="ltr">{r.po_id ? <Link href={`/orders/${r.po_id}`}>{poNo(r.po_id)}</Link> : "-"}</td>
                <td className="ltr">{r.receipt_id ? <Link href={`/receiving/${r.receipt_id}`}>{grNo(r.receipt_id)}</Link> : "-"}</td>
                <td>{r.sku ? <><span className="ltr">{r.sku}</span> {r.name}</> : r.supplier_sku ? <span className="ltr">{r.supplier_sku}</span> : "-"}</td>
                <td>{fmt(r.expected)}</td><td>{fmt(r.actual)}</td>
                <td>{diff !== null ? <span style={{ color: diff ? "var(--danger)" : undefined }} className="ltr">{diff > 0 ? "+" : ""}{isPrice(r.kind) ? diff.toFixed(2) : diff}</span> : ""}</td>
                <td>{date(r.detected_at)}</td>
                <td>{show === "open" ? (
                  <form action={resolveDiscrepancy} style={{ display: "flex", gap: 4 }}>
                    <input type="hidden" name="key" value={r.key} /><input type="hidden" name="return" value={ret} />
                    <input name="note" placeholder="הערת טיפול" style={{ width: 130 }} /><button className="secondary">טופל</button>
                  </form>) : (
                  <form action={resolveDiscrepancy} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="hidden" name="key" value={r.key} /><input type="hidden" name="undo" value="1" />
                    <input type="hidden" name="return" value={ret} />
                    <span>{r.note}</span><button className="secondary">החזרה</button></form>)}</td>
              </tr>);
          })}
          {rows.length === 0 && <tr><td colSpan={10} className="muted">{show === "open" ? "אין אי התאמות פתוחות" : "אין אי התאמות שטופלו"}</td></tr>}
        </tbody>
      </table>
    </>
  );
}
