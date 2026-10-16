import Link from "next/link";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// דרישה 14: התאמת מק"ט ספק למק"ט שלנו
export default async function SkuMatch({ searchParams }: { searchParams: Promise<{ q?: string; supplier?: string }> }) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const suppliers = await query<{ id: number; name: string }>("SELECT id, name FROM suppliers ORDER BY name");
  const rows = await query<{ supplier: string; supplier_id: number; supplier_sku: string; item_id: number; sku: string;
    name: string; last_price: string }>(`
    SELECT s.name AS supplier, s.id AS supplier_id, si.supplier_sku, i.id AS item_id, i.sku, i.name, si.last_price
    FROM supplier_items si JOIN suppliers s ON s.id=si.supplier_id JOIN items i ON i.id=si.item_id
    WHERE ($1='' OR si.supplier_sku ILIKE '%'||$1||'%' OR i.sku ILIKE '%'||$1||'%' OR i.name ILIKE '%'||$1||'%')
      AND ($2='' OR s.id::text=$2)
    ORDER BY s.name, si.supplier_sku LIMIT 500`, [q, sp.supplier ?? ""]);
  const missing = await query<{ c: number }>("SELECT count(*)::int AS c FROM supplier_items WHERE supplier_sku IS NULL");
  return (
    <>
      <h2>התאמת מק"ט ספק למק"ט שלנו</h2>
      <p className="muted">טבלה זו משמשת בקבלת סחורה ובסריקת מסמכים: מק"ט שמופיע בתעודת המשלוח של הספק יתורגם למק"ט שלנו.
        {missing[0].c > 0 && <> {missing[0].c} שיוכים עדיין ללא מק"ט ספק.</>}</p>
      <form className="toolbar">
        <input name="q" defaultValue={q} placeholder='מק"ט ספק / מק"ט שלנו / שם' />
        <select name="supplier" defaultValue={sp.supplier ?? ""}>
          <option value="">כל הספקים</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button>חיפוש</button>
      </form>
      <table>
        <thead><tr><th>ספק</th><th>מק"ט ספק</th><th>←</th><th>מק"ט שלנו</th><th>שם פריט</th><th>מחיר אחרון</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><Link href={`/suppliers/${r.supplier_id}`}>{r.supplier}</Link></td>
              <td className="ltr">{r.supplier_sku ?? <span className="badge off">חסר</span>}</td>
              <td className="muted">←</td>
              <td className="ltr"><Link href={`/items/${r.item_id}`}>{r.sku}</Link></td>
              <td>{r.name}</td>
              <td>{r.last_price ? `₪${Number(r.last_price).toLocaleString("he-IL")}` : ""}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">לא נמצאו התאמות</td></tr>}
        </tbody>
      </table>
    </>
  );
}
