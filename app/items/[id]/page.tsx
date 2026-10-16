import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { saveItem, setItemActive, linkSupplierItem, unlinkSupplierItem, uploadItemImage } from "@/app/actions";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

export default async function Item({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [item] = await query<Record<string, string> & { active: boolean }>("SELECT * FROM items WHERE id=$1", [id]);
  if (!item) notFound();
  const links = await query<{ link_id: number; supplier_id: number; name: string; supplier_sku: string;
    last_price: string; lead_time_days: number }>(`
    SELECT si.id AS link_id, s.id AS supplier_id, s.name, si.supplier_sku, si.last_price, si.lead_time_days
    FROM supplier_items si JOIN suppliers s ON s.id=si.supplier_id WHERE si.item_id=$1 ORDER BY si.last_price NULLS LAST`, [id]);
  const suppliers = await query<{ id: number; name: string }>("SELECT id, name FROM suppliers WHERE active ORDER BY name");
  const ret = `/items/${id}`;
  const field = (k: string, label: string) => <label>{label}<input name={k} defaultValue={item[k] ?? ""} /></label>;
  return (
    <>
      <p><Link href="/items">→ כל הפריטים</Link></p>
      <h2><span className="ltr">{item.sku}</span> · {item.name} {!item.active && <span className="badge off">הורד</span>}</h2>
      <Msg sp={sp} />
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="card">
          <img className="thumb big" src={`/api/images/${encodeURIComponent(item.sku)}`} alt={item.name} />
          <form action={uploadItemImage} style={{ marginTop: 10, display: "grid", gap: 6 }}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="sku" value={item.sku} />
            <input type="file" name="file" accept="image/*" />
            <button className="secondary">החלפת תמונה</button>
          </form>
        </div>
        <form action={saveItem} className="card form-grid" style={{ flex: 1 }}>
          <input type="hidden" name="id" value={id} />
          {field("sku", "מק\"ט *")}{field("name", "שם פריט *")}{field("description", "תיאור")}
          {field("unit", "יחידה")}{field("category", "קטגוריה")}{field("barcode", "ברקוד")}
          <button>שמירה</button>
        </form>
      </div>
      <form action={setItemActive} className="inline">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="active" value={item.active ? "0" : "1"} />
        <button className={item.active ? "danger" : "secondary"}>{item.active ? "הורדת פריט מהרשימה" : "החזרת פריט לרשימה"}</button>
      </form>

      <h3>ספקים ומק"ט ספק</h3>
      <table>
        <thead><tr><th>ספק</th><th>מק"ט ספק</th><th>מחיר אחרון</th><th>זמן אספקה (ימים)</th><th></th></tr></thead>
        <tbody>
          {links.map((l) => (
            <tr key={l.link_id}>
              <td><Link href={`/suppliers/${l.supplier_id}`}>{l.name}</Link></td>
              <td className="ltr">{l.supplier_sku}</td>
              <td>{l.last_price ? `₪${Number(l.last_price).toLocaleString("he-IL")}` : ""}</td>
              <td>{l.lead_time_days}</td>
              <td><form action={unlinkSupplierItem} className="inline">
                <input type="hidden" name="link_id" value={l.link_id} /><input type="hidden" name="return" value={ret} />
                <button className="danger">הסרת שיוך</button></form></td>
            </tr>
          ))}
          {links.length === 0 && <tr><td colSpan={5} className="muted">הפריט לא משויך לאף ספק</td></tr>}
        </tbody>
      </table>
      <h3>שיוך לספק</h3>
      <form action={linkSupplierItem} className="card form-grid">
        <input type="hidden" name="sku" value={item.sku} /><input type="hidden" name="return" value={ret} />
        <label>ספק *<select name="supplier_id" required>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label>מק"ט ספק<input name="supplier_sku" /></label>
        <label>מחיר<input name="last_price" inputMode="decimal" /></label>
        <label>זמן אספקה (ימים)<input name="lead_time_days" inputMode="numeric" /></label>
        <button>שיוך</button>
      </form>
    </>
  );
}
