import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { addRfqLine, removeRfqLine, saveRfqHeader, markRfqSent, saveRfqAnswer, closeRfq, deleteRfq, restoreRfq }
  from "@/app/quote-actions";
import { createPoFromRfq } from "@/app/order-actions";
import { date, ils, poNo, rfqNo, RFQ_STATUS } from "@/lib/format";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

export default async function Rfq({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [rfq] = await query<{ id: number; supplier_id: number; supplier: string; email: string; contact_name: string;
    status: string; due_date: Date | null; notes: string; created_at: Date; sent_at: Date; delete_reason: string }>(`
    SELECT r.*, s.name AS supplier, s.email, s.contact_name FROM rfqs r JOIN suppliers s ON s.id=r.supplier_id WHERE r.id=$1`, [id]);
  if (!rfq) notFound();
  const lines = await query<{ id: number; sku: string; name: string; unit: string; qty: string; supplier_sku: string | null;
    last_price: string | null; quoted_price: string | null; quoted_lead_days: number | null }>(`
    SELECT l.id, i.sku, i.name, i.unit, l.qty, si.supplier_sku, si.last_price, l.quoted_price, l.quoted_lead_days
    FROM rfq_lines l JOIN items i ON i.id=l.item_id
    LEFT JOIN supplier_items si ON si.item_id=l.item_id AND si.supplier_id=$2
    WHERE l.rfq_id=$1 ORDER BY l.id`, [id, rfq.supplier_id]);
  const supplierItems = await query<{ sku: string; name: string; supplier_sku: string | null }>(`
    SELECT i.sku, i.name, si.supplier_sku FROM supplier_items si JOIN items i ON i.id=si.item_id
    WHERE si.supplier_id=$1 AND i.active ORDER BY i.sku`, [rfq.supplier_id]);
  const orders = await query<{ id: number }>("SELECT id FROM purchase_orders WHERE rfq_id=$1 ORDER BY id", [id]);
  const editable = rfq.status === "draft" || rfq.status === "sent";
  const no = rfqNo(rfq.id);
  const total = lines.reduce((t, l) => t + (l.quoted_price ? Number(l.qty) * Number(l.quoted_price) : 0), 0);

  const mailBody = [`שלום ${rfq.contact_name ?? ""},`, "", `נבקש הצעת מחיר עבור הפריטים הבאים (בקשה ${no}):`, "",
    ...lines.map((l) => `- ${l.supplier_sku ? `מק"ט ספק ${l.supplier_sku} / ` : ""}מק"ט ${l.sku} ${l.name}: ${Number(l.qty)} ${l.unit}`),
    "", rfq.due_date ? `נודה לתשובה עד ${date(rfq.due_date)}.` : "", rfq.notes ?? "", "", "תודה"].join("\n");
  const mailto = `mailto:${rfq.email ?? ""}?subject=${encodeURIComponent(`בקשה להצעת מחיר ${no}`)}&body=${encodeURIComponent(mailBody)}`;

  return (
    <>
      <p><Link href="/quotes">→ כל הצעות המחיר</Link></p>
      <h2><span className="ltr">{no}</span> · {rfq.supplier} <span className={`badge ${rfq.status === "deleted" ? "off" : ""}`}>{RFQ_STATUS[rfq.status]}</span></h2>
      <Msg sp={sp} />
      {rfq.status === "deleted" && <div className="msg err">הבקשה נמחקה{rfq.delete_reason ? `: ${rfq.delete_reason}` : ""}.</div>}

      <div className="toolbar">
        <a className="btn" href={mailto}>שליחה במייל לספק</a>
        <a className="btn secondary" href={`/quotes/${id}/print`} target="_blank">הורדה ל-PDF / הדפסה</a>
        {rfq.status === "draft" && <form action={markRfqSent} className="inline"><input type="hidden" name="id" value={id} />
          <button className="secondary">סימון כנשלחה</button></form>}
        {(rfq.status === "answered" || rfq.status === "sent") && lines.length > 0 && <form action={createPoFromRfq} className="inline">
          <input type="hidden" name="rfq_id" value={id} /><button>הוצאת הזמנה מההצעה</button></form>}
        {rfq.status === "answered" && <form action={closeRfq} className="inline"><input type="hidden" name="id" value={id} />
          <button className="secondary">סגירת הבקשה</button></form>}
        {rfq.status === "deleted" ? (
          <form action={restoreRfq} className="inline"><input type="hidden" name="id" value={id} /><button className="secondary">שחזור</button></form>
        ) : (
          <form action={deleteRfq} className="inline" style={{ display: "flex", gap: 6 }}>
            <input type="hidden" name="id" value={id} />
            <input name="reason" placeholder="סיבת מחיקה (לא חובה)" />
            <button className="danger">מחיקת בקשה לא רלוונטית</button></form>
        )}
      </div>
      {orders.length > 0 && <div className="msg">הזמנות מההצעה: {orders.map((o, i) => <span key={o.id}>{i ? ", " : ""}
        <Link href={`/orders/${o.id}`} className="ltr">{poNo(o.id)}</Link></span>)}</div>}
      <p className="muted">ספק: {rfq.supplier} · {rfq.email ? <span className="ltr">{rfq.email}</span> : "אין כתובת מייל לספק"} · נוצרה {date(rfq.created_at)}{rfq.sent_at ? ` · נשלחה ${date(rfq.sent_at)}` : ""}</p>

      <form action={saveRfqHeader} className="card form-grid">
        <input type="hidden" name="id" value={id} />
        <label>תאריך יעד לתשובה<input type="date" name="due_date"
          defaultValue={rfq.due_date ? new Date(rfq.due_date).toLocaleDateString("en-CA") : ""} /></label>
        <label style={{ gridColumn: "span 2" }}>הערות לספק<input name="notes" defaultValue={rfq.notes ?? ""} /></label>
        <button className="secondary">שמירה</button>
      </form>

      <h3>פריטים בבקשה ({lines.length})</h3>
      <form action={saveRfqAnswer}>
        <input type="hidden" name="id" value={id} />
        <table>
          <thead><tr><th>מק"ט</th><th>מק"ט ספק</th><th>שם פריט</th><th>כמות</th><th>מחיר אחרון</th><th>מחיר מוצע ליח'</th><th>זמן אספקה</th><th>סה"כ</th><th></th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="ltr">{l.sku}</td><td className="ltr">{l.supplier_sku}</td><td>{l.name}</td>
                <td>{Number(l.qty)} {l.unit}</td><td className="muted">{ils(l.last_price)}</td>
                <td><input name={`price_${l.id}`} defaultValue={l.quoted_price ?? ""} inputMode="decimal" style={{ width: 100 }}
                  disabled={rfq.status === "deleted" || rfq.status === "closed"} /></td>
                <td><input name={`lead_${l.id}`} defaultValue={l.quoted_lead_days ?? ""} inputMode="numeric" style={{ width: 70 }}
                  disabled={rfq.status === "deleted" || rfq.status === "closed"} /></td>
                <td>{l.quoted_price ? ils(Number(l.qty) * Number(l.quoted_price)) : ""}</td>
                <td>{editable && <button className="danger" formAction={removeRfqLine} name="line_id" value={l.id}>הסרה</button>}</td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={9} className="muted">עדיין אין פריטים בבקשה</td></tr>}
            {total > 0 && <tr><td colSpan={7}><b>סה"כ הצעה</b></td><td><b>{ils(total)}</b></td><td></td></tr>}
          </tbody>
        </table>
        {lines.length > 0 && rfq.status !== "deleted" && rfq.status !== "closed" && (
          <p><button>שמירת המחירים שהספק הציע</button> <span className="muted">המחירים יעודכנו גם כמחיר האחרון של הספק לפריט.</span></p>
        )}
      </form>

      {editable && (
        <>
          <h3>הוספת פריט</h3>
          <form action={addRfqLine} className="card form-grid">
            <input type="hidden" name="id" value={id} />
            <label style={{ gridColumn: "span 2" }}>מק"ט (פריטי הספק מוצעים ברשימה, אפשר גם כל מק"ט אחר)
              <input name="sku" list="supplier-items" required /></label>
            <datalist id="supplier-items">
              {supplierItems.map((i) => <option key={i.sku} value={i.sku}>{i.name}{i.supplier_sku ? ` (${i.supplier_sku})` : ""}</option>)}
            </datalist>
            <label>כמות *<input name="qty" inputMode="decimal" required /></label>
            <button>הוספה</button>
          </form>
        </>
      )}
    </>
  );
}
