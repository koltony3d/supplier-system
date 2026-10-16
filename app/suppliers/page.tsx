import Link from "next/link";
import { query } from "@/lib/db";
import { saveSupplier } from "@/app/actions";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";
type SP = Promise<{ q?: string; show?: string; msg?: string; err?: string }>;

export default async function Suppliers({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const rows = await query<{ id: number; erp_code: string; name: string; contact_name: string; phone: string;
    email: string; active: boolean; source: string; items: number }>(`
    SELECT s.*, (SELECT count(*) FROM supplier_items si WHERE si.supplier_id=s.id)::int AS items
    FROM suppliers s
    WHERE ($1='' OR s.name ILIKE '%'||$1||'%' OR s.erp_code ILIKE '%'||$1||'%')
      AND ($2='all' OR s.active)
    ORDER BY s.name`, [q, sp.show === "all" ? "all" : ""]);
  return (
    <>
      <h2>ספקים</h2>
      <Msg sp={sp} />
      <form className="toolbar">
        <input name="q" defaultValue={q} placeholder="חיפוש לפי שם או קוד ספק" />
        <label style={{ flexDirection: "row", alignItems: "center" }}>
          <input type="checkbox" name="show" value="all" defaultChecked={sp.show === "all"} /> כולל לא פעילים
        </label>
        <button>חיפוש</button>
      </form>
      <table>
        <thead><tr><th>קוד ERP</th><th>שם ספק</th><th>איש קשר</th><th>טלפון</th><th>אימייל</th><th>פריטים</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.active ? "" : "inactive"}>
              <td className="ltr">{r.erp_code}</td>
              <td><Link href={`/suppliers/${r.id}`}>{r.name}</Link></td>
              <td>{r.contact_name}</td><td className="ltr">{r.phone}</td><td className="ltr">{r.email}</td>
              <td>{r.items}</td>
              <td>{!r.active && <span className="badge off">לא פעיל</span>} {r.source === "manual" && <span className="badge manual">ידני</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">לא נמצאו ספקים</td></tr>}
        </tbody>
      </table>
      <h3>הוספת ספק ידנית</h3>
      <form action={saveSupplier} className="card form-grid">
        <label>קוד ספק *<input name="erp_code" required /></label>
        <label>שם ספק *<input name="name" required /></label>
        <label>ח.פ<input name="tax_id" /></label>
        <label>איש קשר<input name="contact_name" /></label>
        <label>טלפון<input name="phone" /></label>
        <label>אימייל<input name="email" type="email" /></label>
        <label>כתובת<input name="address" /></label>
        <label>תנאי תשלום<input name="payment_terms" /></label>
        <button>הוספה</button>
      </form>
    </>
  );
}
