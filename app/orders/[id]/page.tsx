import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { addPoLine, removePoLine, savePoHeader, savePoLines, markPoSent, cancelPo } from "@/app/order-actions";
import { date, ils, poNo, rfqNo, PO_STATUS } from "@/lib/format";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

export default async function Order({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [po] = await query<{ id: number; supplier_id: number; supplier: string; email: string; contact_name: string;
    rfq_id: number | null; status: string; expected_date: Date | null; notes: string; created_at: Date; sent_at: Date }>(`
    SELECT p.*, s.name AS supplier, s.email, s.contact_name FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.id=$1`, [id]);
  if (!po) notFound();
  const lines = await query<{ id: number; sku: string; name: string; unit: string; qty: string; unit_price: string | null;
    received_qty: string; supplier_sku: string | null }>(`
    SELECT l.id, i.sku, i.name, i.unit, l.qty, l.unit_price, l.received_qty, si.supplier_sku
    FROM po_lines l JOIN items i ON i.id=l.item_id
    LEFT JOIN supplier_items si ON si.item_id=l.item_id AND si.supplier_id=$2 WHERE l.po_id=$1 ORDER BY l.id`, [id, po.supplier_id]);
  const history = await query<{ change: string; created_at: Date }>(
    "SELECT change, created_at FROM po_changes WHERE po_id=$1 ORDER BY id DESC", [id]);
  const supplierItems = await query<{ sku: string; name: string; supplier_sku: string | null }>(`
    SELECT i.sku, i.name, si.supplier_sku FROM supplier_items si JOIN items i ON i.id=si.item_id
    WHERE si.supplier_id=$1 AND i.active ORDER BY i.sku`, [po.supplier_id]);
  const editable = !["received", "cancelled"].includes(po.status);
  const no = poNo(po.id);
  const total = lines.reduce((t, l) => t + Number(l.qty) * Number(l.unit_price ?? 0), 0);
  const mailBody = [`שלום ${po.contact_name ?? ""},`, "", `מצורפת הזמנת רכש ${no}:`, "",
    ...lines.map((l) => `- ${l.supplier_sku ? `מק"ט ספק ${l.supplier_sku} / ` : ""}מק"ט ${l.sku} ${l.name}: ${Number(l.qty)} ${l.unit}${l.unit_price ? ` × ${ils(l.unit_price)}` : ""}`),
    "", `סה"כ לפני מע"מ: ${ils(total)}`, po.expected_date ? `מועד אספקה מבוקש: ${date(po.expected_date)}` : "", po.notes ?? "",
    "", "נבקש אישור קבלת ההזמנה. תודה"].join("\n");
  const mailto = `mailto:${po.email ?? ""}?subject=${encodeURIComponent(`הזמנת רכש ${no}`)}&body=${encodeURIComponent(mailBody)}`;
  return (
    <>
      <p><Link href="/orders">→ כל ההזמנות</Link></p>
      <h2><span className="ltr">{no}</span> · {po.supplier} <span className={`badge ${po.status === "cancelled" ? "off" : ""}`}>{PO_STATUS[po.status]}</span></h2>
      <Msg sp={sp} />
      <div className="toolbar">
        <a className="btn" href={mailto}>שליחה במייל לספק</a>
        <a className="btn secondary" href={`/orders/${id}/print`} target="_blank">הורדה ל-PDF / הדפסה</a>
        {po.status === "draft" && <form action={markPoSent} className="inline"><input type="hidden" name="id" value={id} />
          <button className="secondary">סימון כנשלחה</button></form>}
        {editable && (
          <form action={cancelPo} className="inline" style={{ display: "flex", gap: 6 }}>
            <input type="hidden" name="id" value={id} /><input name="reason" placeholder="סיבת ביטול (לא חובה)" />
            <button className="danger">ביטול הזמנה</button></form>
        )}
      </div>
      <p className="muted">ספק: {po.supplier} · הצעת מחיר: {po.rfq_id ? <Link href={`/quotes/${po.rfq_id}`} className="ltr">{rfqNo(po.rfq_id)}</Link> : "ללא"}
        {" "}· נוצרה {date(po.created_at)}{po.sent_at ? ` · נשלחה ${date(po.sent_at)}` : ""}</p>

      <form action={savePoHeader} className="card form-grid">
        <input type="hidden" name="id" value={id} />
        <label>תאריך אספקה צפוי<input type="date" name="expected_date" disabled={!editable}
          defaultValue={po.expected_date ? new Date(po.expected_date).toLocaleDateString("en-CA") : ""} /></label>
        <label style={{ gridColumn: "span 2" }}>הערות<input name="notes" defaultValue={po.notes ?? ""} disabled={!editable} /></label>
        {editable && <button className="secondary">שמירה</button>}
      </form>

      <h3>שורות הזמנה ({lines.length})</h3>
      <form action={savePoLines}>
        <input type="hidden" name="id" value={id} />
        <table>
          <thead><tr><th>מק"ט</th><th>מק"ט ספק</th><th>שם פריט</th><th>כמות</th><th>מחיר ליח'</th><th>סה"כ</th><th>התקבל</th><th></th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="ltr">{l.sku}</td><td className="ltr">{l.supplier_sku}</td><td>{l.name}</td>
                <td><input name={`qty_${l.id}`} defaultValue={Number(l.qty)} inputMode="decimal" style={{ width: 80 }} disabled={!editable} /> {l.unit}</td>
                <td><input name={`price_${l.id}`} defaultValue={l.unit_price ?? ""} inputMode="decimal" style={{ width: 100 }} disabled={!editable} /></td>
                <td>{ils(Number(l.qty) * Number(l.unit_price ?? 0))}</td>
                <td>{Number(l.received_qty)} / {Number(l.qty)}</td>
                <td>{editable && Number(l.received_qty) === 0 &&
                  <button className="danger" formAction={removePoLine} name="line_id" value={l.id}>הסרה</button>}</td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={8} className="muted">עדיין אין שורות בהזמנה</td></tr>}
            {total > 0 && <tr><td colSpan={5}><b>סה"כ לפני מע"מ</b></td><td><b>{ils(total)}</b></td><td colSpan={2}></td></tr>}
          </tbody>
        </table>
        {editable && lines.length > 0 && <p><button>שמירת עדכון הזמנה</button></p>}
      </form>

      {editable && (
        <>
          <h3>הוספת פריט</h3>
          <form action={addPoLine} className="card form-grid">
            <input type="hidden" name="id" value={id} />
            <label style={{ gridColumn: "span 2" }}>מק"ט (פריטי הספק מוצעים ברשימה)<input name="sku" list="supplier-items" required /></label>
            <datalist id="supplier-items">
              {supplierItems.map((i) => <option key={i.sku} value={i.sku}>{i.name}{i.supplier_sku ? ` (${i.supplier_sku})` : ""}</option>)}
            </datalist>
            <label>כמות *<input name="qty" inputMode="decimal" required /></label>
            <label>מחיר ליח' (ריק = מחיר אחרון)<input name="unit_price" inputMode="decimal" /></label>
            <button>הוספה</button>
          </form>
        </>
      )}

      <h3>היסטוריית עדכונים</h3>
      <table><tbody>{history.map((h, i) => (
        <tr key={i}><td style={{ width: 170 }} className="muted">{new Date(h.created_at).toLocaleString("he-IL")}</td><td>{h.change}</td></tr>))}
      </tbody></table>
    </>
  );
}
