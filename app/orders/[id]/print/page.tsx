import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { date, ils, poNo, rfqNo } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function PoPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [po] = await query<{ id: number; supplier_id: number; supplier: string; erp_code: string; contact_name: string;
    phone: string; email: string; address: string; payment_terms: string; rfq_id: number | null; expected_date: Date | null;
    notes: string; created_at: Date }>(`
    SELECT p.*, s.name AS supplier, s.erp_code, s.contact_name, s.phone, s.email, s.address, s.payment_terms
    FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1`, [id]);
  if (!po) notFound();
  const lines = await query<{ sku: string; name: string; unit: string; qty: string; unit_price: string | null; supplier_sku: string }>(`
    SELECT i.sku, i.name, i.unit, l.qty, l.unit_price, si.supplier_sku FROM po_lines l JOIN items i ON i.id=l.item_id
    LEFT JOIN supplier_items si ON si.item_id=l.item_id AND si.supplier_id=$2 WHERE l.po_id=$1 ORDER BY l.id`, [id, po.supplier_id]);
  const total = lines.reduce((t, l) => t + Number(l.qty) * Number(l.unit_price ?? 0), 0);
  return (
    <div className="print-doc">
      <style>{`.side{display:none} .shell{display:block} main{max-width:none;padding:0}
        .print-doc{background:#fff;max-width:800px;margin:0 auto;padding:40px;border:1px solid var(--border)}
        @media print{.no-print{display:none} .print-doc{border:none;padding:0} body{background:#fff}}`}</style>
      <PrintButton />
      <h1 style={{ marginBottom: 4 }}>הזמנת רכש</h1>
      <div style={{ fontSize: 18, marginBottom: 20 }}><span className="ltr">{poNo(po.id)}</span>
        {po.rfq_id && <span className="muted"> · לפי הצעת מחיר <span className="ltr">{rfqNo(po.rfq_id)}</span></span>}</div>
      <table style={{ border: "none", marginBottom: 20 }}><tbody>
        <tr><td style={{ border: "none" }}><b>לכבוד:</b> {po.supplier} (ספק {po.erp_code})<br />
          {po.contact_name && <>לידי {po.contact_name}<br /></>}{po.address}<br /><span className="ltr">{po.phone} {po.email}</span></td>
          <td style={{ border: "none", verticalAlign: "top" }}><b>תאריך:</b> {date(po.created_at)}<br />
            {po.expected_date && <><b>מועד אספקה:</b> {date(po.expected_date)}<br /></>}
            {po.payment_terms && <><b>תנאי תשלום:</b> {po.payment_terms}</>}</td></tr>
      </tbody></table>
      <table>
        <thead><tr><th>#</th><th>מק"ט ספק</th><th>מק"ט שלנו</th><th>תיאור</th><th>כמות</th><th>יחידה</th><th>מחיר ליח'</th><th>סה"כ</th></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}><td>{i + 1}</td><td className="ltr">{l.supplier_sku}</td><td className="ltr">{l.sku}</td><td>{l.name}</td>
            <td>{Number(l.qty)}</td><td>{l.unit}</td><td>{ils(l.unit_price)}</td><td>{ils(Number(l.qty) * Number(l.unit_price ?? 0))}</td></tr>))}
          <tr><td colSpan={7}><b>סה"כ לפני מע"מ</b></td><td><b>{ils(total)}</b></td></tr></tbody>
      </table>
      {po.notes && <p><b>הערות:</b> {po.notes}</p>}
      <p style={{ marginTop: 30 }}>נא לציין את מספר ההזמנה בתעודת המשלוח ובחשבונית.</p>
    </div>
  );
}
