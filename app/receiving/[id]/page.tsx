import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { addReceiptLine, removeReceiptLine, saveReceiptHeader, saveReceiptLines, postReceipt, unpostReceipt,
  deleteDraftReceipt } from "@/app/receipt-actions";
import { date, grNo, ils, poNo, qty } from "@/lib/format";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

export default async function Receipt({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [r] = await query<{ id: number; supplier_id: number; supplier: string; po_id: number | null; status: string;
    delivery_note_no: string; invoice_no: string; received_date: Date; notes: string; source: string; posted_at: Date }>(`
    SELECT r.*, s.name AS supplier FROM receipts r JOIN suppliers s ON s.id=r.supplier_id WHERE r.id=$1`, [id]);
  if (!r) notFound();
  const lines = await query<{ id: number; sku: string | null; name: string | null; supplier_sku: string | null; description: string | null;
    unit: string | null; qty: string; unit_price: string | null; po_line_id: number | null; ordered: string | null;
    po_price: string | null; received_total: string | null }>(`
    SELECT rl.id, i.sku, i.name, i.unit, rl.supplier_sku, rl.description, rl.qty, rl.unit_price, rl.po_line_id,
      pl.qty AS ordered, pl.unit_price AS po_price, pl.received_qty AS received_total
    FROM receipt_lines rl LEFT JOIN items i ON i.id=rl.item_id LEFT JOIN po_lines pl ON pl.id=rl.po_line_id
    WHERE rl.receipt_id=$1 ORDER BY rl.id`, [id]);
  const missing = r.po_id ? await query<{ sku: string; name: string; qty: string; received_qty: string }>(`
    SELECT i.sku, i.name, l.qty, l.received_qty FROM po_lines l JOIN items i ON i.id=l.item_id
    WHERE l.po_id=$1 AND NOT EXISTS (SELECT 1 FROM receipt_lines rl WHERE rl.receipt_id=$2 AND rl.po_line_id=l.id)
      AND l.received_qty < l.qty`, [r.po_id, id]) : [];
  const disc = await query<{ key: string; kind: string; resolved: boolean | null }>(`
    SELECT d.key, d.kind, n.resolved FROM discrepancies d LEFT JOIN discrepancy_notes n ON n.key=d.key
    WHERE d.receipt_id=$1 OR (d.po_id=$2 AND d.receipt_id IS NULL)`, [id, r.po_id]);
  const history = await query<{ change: string; created_at: Date }>(
    "SELECT change, created_at FROM receipt_changes WHERE receipt_id=$1 ORDER BY id DESC", [id]);
  const posted = r.status === "posted";
  const lineFlag = (l: (typeof lines)[number]) => {
    if (!l.sku) return <span className="badge off">מק"ט לא מזוהה</span>;
    if (r.po_id && !l.po_line_id) return <span className="badge off">לא הוזמן</span>;
    if (l.po_price && l.unit_price && Number(l.po_price) !== Number(l.unit_price)) return <span className="badge off">מחיר שונה</span>;
    if (l.ordered && !posted && Number(l.qty) + Number(l.received_total) < Number(l.ordered)) return <span className="badge manual">חלקי</span>;
    if (l.ordered && Number(l.received_total) + (posted ? 0 : Number(l.qty)) > Number(l.ordered)) return <span className="badge off">עודף</span>;
    return l.po_line_id ? <span className="badge">תואם</span> : null;
  };
  return (
    <>
      <p><Link href="/receiving">→ קבלת סחורה</Link></p>
      <h2><span className="ltr">{grNo(r.id)}</span> · {r.supplier} <span className={`badge ${posted ? "" : "manual"}`}>{posted ? "נקלטה" : "טיוטה"}</span></h2>
      <Msg sp={sp} />
      <p className="muted">{r.po_id ? <>לפי הזמנה <Link className="ltr" href={`/orders/${r.po_id}`}>{poNo(r.po_id)}</Link></> : "קבלה ללא הזמנת ספק"}
        {posted && ` · נקלטה ${date(r.posted_at)}`}{disc.length > 0 && <> · <Link href="/discrepancies">{disc.filter((d) => !d.resolved).length} אי התאמות פתוחות</Link></>}</p>
      <div className="toolbar">
        {!posted ? <>
          <form action={postReceipt} className="inline"><input type="hidden" name="id" value={id} /><button>קליטת הסחורה</button></form>
          <form action={deleteDraftReceipt} className="inline"><input type="hidden" name="id" value={id} /><button className="danger">מחיקת טיוטה</button></form>
        </> : (
          <form action={unpostReceipt} className="inline"><input type="hidden" name="id" value={id} /><button className="secondary">ביטול קליטה</button></form>
        )}
      </div>

      <form action={saveReceiptHeader} className="card form-grid">
        <input type="hidden" name="id" value={id} />
        <label>מספר תעודת משלוח<input name="delivery_note_no" defaultValue={r.delivery_note_no ?? ""} /></label>
        <label>מספר חשבונית<input name="invoice_no" defaultValue={r.invoice_no ?? ""} /></label>
        <label>תאריך קבלה<input type="date" name="received_date" defaultValue={new Date(r.received_date).toLocaleDateString("en-CA")} /></label>
        <label>הערות<input name="notes" defaultValue={r.notes ?? ""} /></label>
        <button className="secondary">שמירה</button>
      </form>

      <h3>שורות שהתקבלו ({lines.length})</h3>
      <form action={saveReceiptLines}>
        <input type="hidden" name="id" value={id} />
        <table>
          <thead><tr><th>מק"ט</th><th>מק"ט ספק</th><th>שם פריט</th>{r.po_id && <><th>הוזמן</th><th>התקבל עד כה</th></>}
            <th>כמות שהתקבלה</th><th>מחיר בתעודה</th>{r.po_id && <th>מחיר הזמנה</th>}<th>התאמה</th><th></th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="ltr">{l.sku ?? "?"}</td><td className="ltr">{l.supplier_sku}</td><td>{l.name ?? l.description}</td>
                {r.po_id && <><td>{qty(l.ordered)}</td><td>{qty(l.received_total)}</td></>}
                <td><input name={`qty_${l.id}`} defaultValue={Number(l.qty)} inputMode="decimal" style={{ width: 80 }} /> {l.unit}</td>
                <td><input name={`price_${l.id}`} defaultValue={l.unit_price ?? ""} inputMode="decimal" style={{ width: 90 }} /></td>
                {r.po_id && <td className="muted">{ils(l.po_price)}</td>}
                <td>{lineFlag(l)}</td>
                <td><button className="danger" formAction={removeReceiptLine} name="line_id" value={l.id}>הסרה</button></td>
              </tr>))}
            {lines.length === 0 && <tr><td colSpan={10} className="muted">אין שורות</td></tr>}
          </tbody>
        </table>
        {lines.length > 0 && <p><button className={posted ? "" : "secondary"}>{posted ? "שמירת עדכון קבלה" : "שמירת כמויות"}</button>
          {posted && <span className="muted"> העדכון יחשב מחדש את הכמויות שהתקבלו בהזמנה.</span>}</p>}
      </form>

      {missing.length > 0 && (
        <>
          <h3>פריטים מההזמנה שלא בקבלה הזו</h3>
          <table><thead><tr><th>מק"ט</th><th>שם</th><th>הוזמן</th><th>התקבל עד כה</th></tr></thead>
            <tbody>{missing.map((m) => <tr key={m.sku}><td className="ltr">{m.sku}</td><td>{m.name}</td><td>{qty(m.qty)}</td><td>{qty(m.received_qty)}</td></tr>)}</tbody></table>
        </>
      )}

      <h3>הוספת שורה</h3>
      <form action={addReceiptLine} className="card form-grid">
        <input type="hidden" name="id" value={id} />
        <label>מק"ט שלנו או מק"ט ספק *<input name="code" required /></label>
        <label>כמות *<input name="qty" inputMode="decimal" required /></label>
        <label>מחיר בתעודה<input name="unit_price" inputMode="decimal" /></label>
        <label>תיאור (למק"ט לא מוכר)<input name="description" /></label>
        <button>הוספה</button>
      </form>

      <h3>היסטוריה</h3>
      <table><tbody>{history.map((h, i) => (
        <tr key={i}><td style={{ width: 170 }} className="muted">{new Date(h.created_at).toLocaleString("he-IL")}</td><td>{h.change}</td></tr>))}
      </tbody></table>
    </>
  );
}
