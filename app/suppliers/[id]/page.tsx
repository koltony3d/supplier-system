import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { saveSupplier, setSupplierActive, linkSupplierItem, unlinkSupplierItem } from "@/app/actions";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

export default async function Supplier({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [sup] = await query<Record<string, string> & { active: boolean }>("SELECT * FROM suppliers WHERE id=$1", [id]);
  if (!sup) notFound();
  const items = await query<{ link_id: number; item_id: number; sku: string; name: string; unit: string;
    supplier_sku: string; last_price: string; lead_time_days: number; active: boolean }>(`
    SELECT si.id AS link_id, i.id AS item_id, i.sku, i.name, i.unit, i.active, si.supplier_sku, si.last_price, si.lead_time_days
    FROM supplier_items si JOIN items i ON i.id=si.item_id WHERE si.supplier_id=$1 ORDER BY i.sku`, [id]);
  const ret = `/suppliers/${id}`;
  const field = (k: string, label: string, type = "text") => (
    <label>{label}<input name={k} type={type} defaultValue={sup[k] ?? ""} /></label>
  );
  return (
    <>
      <p><Link href="/suppliers">→ כל הספקים</Link></p>
      <h2>{sup.name} {!sup.active && <span className="badge off">לא פעיל</span>}</h2>
      <Msg sp={sp} />
      <form action={saveSupplier} className="card form-grid">
        <input type="hidden" name="id" value={id} />
        {field("erp_code", "קוד ספק *")}{field("name", "שם ספק *")}{field("tax_id", "ח.פ")}
        {field("contact_name", "איש קשר")}{field("phone", "טלפון")}{field("email", "אימייל", "email")}
        {field("address", "כתובת")}{field("payment_terms", "תנאי תשלום")}
        <button>שמירה</button>
      </form>
      <form action={setSupplierActive} className="inline">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={sup.active ? "0" : "1"} />
        <button className={sup.active ? "danger" : "secondary"}>{sup.active ? "השבתת ספק" : "הפעלת ספק"}</button>
      </form>

      <h3>פריטים של הספק ({items.length})</h3>
      <table>
        <thead><tr><th></th><th>מק"ט שלנו</th><th>שם פריט</th><th>מק"ט ספק</th><th>מחיר אחרון</th><th>זמן אספקה (ימים)</th><th></th></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.link_id} className={r.active ? "" : "inactive"}>
              <td><img className="thumb" src={`/api/images/${encodeURIComponent(r.sku)}`} alt="" /></td>
              <td className="ltr"><Link href={`/items/${r.item_id}`}>{r.sku}</Link></td>
              <td>{r.name}</td><td className="ltr">{r.supplier_sku}</td>
              <td>{r.last_price ? `₪${Number(r.last_price).toLocaleString("he-IL")}` : ""}</td>
              <td>{r.lead_time_days}</td>
              <td><form action={unlinkSupplierItem} className="inline">
                <input type="hidden" name="link_id" value={r.link_id} /><input type="hidden" name="return" value={ret} />
                <button className="danger">הסרת שיוך</button></form></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={7} className="muted">אין פריטים משויכים</td></tr>}
        </tbody>
      </table>
      <h3>שיוך פריט לספק</h3>
      <form action={linkSupplierItem} className="card form-grid">
        <input type="hidden" name="supplier_id" value={id} /><input type="hidden" name="return" value={ret} />
        <label>מק"ט שלנו *<input name="sku" required /></label>
        <label>מק"ט ספק<input name="supplier_sku" /></label>
        <label>מחיר<input name="last_price" inputMode="decimal" /></label>
        <label>זמן אספקה (ימים)<input name="lead_time_days" inputMode="numeric" /></label>
        <button>שיוך</button>
      </form>
    </>
  );
}
