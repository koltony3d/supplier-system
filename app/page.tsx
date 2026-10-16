import Link from "next/link";
import { query } from "@/lib/db";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const [c] = await query<{ suppliers: number; items: number; inactive: number; links: number; images: number; rfqs: number; pos: number; disc: number }>(`
    SELECT (SELECT count(*) FROM suppliers WHERE active)::int AS suppliers,
           (SELECT count(*) FROM items WHERE active)::int AS items,
           (SELECT count(*) FROM items WHERE NOT active)::int AS inactive,
           (SELECT count(*) FROM supplier_items)::int AS links,
           (SELECT count(*) FROM item_images)::int AS images,
           (SELECT count(*) FROM rfqs WHERE status IN ('draft','sent','answered'))::int AS rfqs,
           (SELECT count(*) FROM purchase_orders WHERE status IN ('draft','sent','partial'))::int AS pos,
           (SELECT count(*) FROM discrepancies d LEFT JOIN discrepancy_notes n ON n.key=d.key WHERE n.key IS NULL)::int AS disc`);
  const imports = await query<{ kind: string; file_name: string; inserted: number; updated: number; created_at: Date }>(
    "SELECT kind, file_name, inserted, updated, created_at FROM import_log ORDER BY id DESC LIMIT 5");
  return (
    <>
      <h2>ראשי</h2>
      <Msg sp={sp} />
      <div className="grid">
        <Link className="card" href="/suppliers"><div className="muted">ספקים פעילים</div><div className="stat">{c.suppliers}</div></Link>
        <Link className="card" href="/items"><div className="muted">פריטים פעילים</div><div className="stat">{c.items}</div></Link>
        <Link className="card" href="/items?show=inactive"><div className="muted">פריטים שהורדו</div><div className="stat">{c.inactive}</div></Link>
        <Link className="card" href="/sku-match"><div className="muted">שיוכי פריט-ספק</div><div className="stat">{c.links}</div></Link>
        <Link className="card" href="/import"><div className="muted">תמונות לפי מק"ט</div><div className="stat">{c.images}</div></Link>
        <Link className="card" href="/quotes"><div className="muted">הצעות מחיר פתוחות</div><div className="stat">{c.rfqs}</div></Link>
        <Link className="card" href="/orders"><div className="muted">הזמנות פתוחות</div><div className="stat">{c.pos}</div></Link>
        <Link className="card" href="/discrepancies"><div className="muted">אי התאמות פתוחות</div><div className="stat" style={{ color: c.disc ? "var(--danger)" : undefined }}>{c.disc}</div></Link>
      </div>
      <h3>יבואים אחרונים</h3>
      {imports.length === 0 ? <p className="muted">עדיין לא בוצע יבוא. <Link href="/import">ליבוא מ-ERP</Link></p> : (
        <table><thead><tr><th>סוג</th><th>קובץ</th><th>חדשים</th><th>עודכנו</th><th>תאריך</th></tr></thead>
          <tbody>{imports.map((r, i) => (
            <tr key={i}><td>{r.kind}</td><td>{r.file_name}</td><td>{r.inserted}</td><td>{r.updated}</td>
              <td>{new Date(r.created_at).toLocaleString("he-IL")}</td></tr>))}</tbody></table>
      )}
    </>
  );
}
