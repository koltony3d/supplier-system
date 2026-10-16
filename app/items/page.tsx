import Link from "next/link";
import { query } from "@/lib/db";
import { saveItem, setItemActive } from "@/app/actions";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";
type SP = Promise<{ q?: string; supplier?: string; show?: string; msg?: string; err?: string }>;

export default async function Items({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const show = sp.show === "inactive" ? "inactive" : "active";
  const suppliers = await query<{ id: number; name: string }>("SELECT id, name FROM suppliers WHERE active ORDER BY name");
  const rows = await query<{ id: number; sku: string; name: string; unit: string; category: string; source: string;
    suppliers: string | null }>(`
    SELECT i.id, i.sku, i.name, i.unit, i.category, i.source,
      (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM supplier_items si JOIN suppliers s ON s.id=si.supplier_id
       WHERE si.item_id=i.id) AS suppliers
    FROM items i
    WHERE i.active = $2
      AND ($1='' OR i.sku ILIKE '%'||$1||'%' OR i.name ILIKE '%'||$1||'%' OR i.barcode = $1
           OR EXISTS (SELECT 1 FROM supplier_items si WHERE si.item_id=i.id AND si.supplier_sku ILIKE '%'||$1||'%'))
      AND ($3='' OR EXISTS (SELECT 1 FROM supplier_items si WHERE si.item_id=i.id AND si.supplier_id::text=$3))
    ORDER BY i.sku LIMIT 500`, [q, show === "active", sp.supplier ?? ""]);
  const ret = `/items?show=${show}`;
  return (
    <>
      <h2>פריטים</h2>
      <Msg sp={sp} />
      <form className="toolbar">
        <input name="q" defaultValue={q} placeholder='מק"ט, שם, ברקוד או מק"ט ספק' />
        <select name="supplier" defaultValue={sp.supplier ?? ""}>
          <option value="">כל הספקים</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="show" defaultValue={show}>
          <option value="active">פריטים פעילים</option>
          <option value="inactive">פריטים שהורדו</option>
        </select>
        <button>סינון</button>
      </form>
      <table>
        <thead><tr><th></th><th>מק"ט</th><th>שם פריט</th><th>יחידה</th><th>קטגוריה</th><th>ספקים</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><img className="thumb" src={`/api/images/${encodeURIComponent(r.sku)}`} alt="" /></td>
              <td className="ltr"><Link href={`/items/${r.id}`}>{r.sku}</Link></td>
              <td>{r.name} {r.source === "manual" && <span className="badge manual">ידני</span>}</td>
              <td>{r.unit}</td><td>{r.category}</td>
              <td>{r.suppliers ?? <span className="muted">ללא ספק</span>}</td>
              <td><form action={setItemActive} className="inline">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="active" value={show === "active" ? "0" : "1"} />
                <input type="hidden" name="return" value={ret} />
                <button className={show === "active" ? "danger" : "secondary"}>{show === "active" ? "הורדה" : "החזרה"}</button>
              </form></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">לא נמצאו פריטים</td></tr>}
        </tbody>
      </table>
      <h3>הוספת פריט ידנית</h3>
      <form action={saveItem} className="card form-grid">
        <label>מק"ט *<input name="sku" required /></label>
        <label>שם פריט *<input name="name" required /></label>
        <label>תיאור<input name="description" /></label>
        <label>יחידה<input name="unit" placeholder="יח'" /></label>
        <label>קטגוריה<input name="category" /></label>
        <label>ברקוד<input name="barcode" /></label>
        <label>ספק (לא חובה)<select name="supplier_id" defaultValue="">
          <option value="">ללא</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label>מק"ט ספק<input name="supplier_sku" /></label>
        <label>מחיר<input name="last_price" inputMode="decimal" /></label>
        <button>הוספה</button>
      </form>
    </>
  );
}
