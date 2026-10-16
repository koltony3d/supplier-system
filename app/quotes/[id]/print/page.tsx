import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { date, rfqNo } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// מסמך בקשה להצעת מחיר להדפסה או שמירה כ-PDF (דרישה 15)
export default async function RfqPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [rfq] = await query<{ id: number; supplier_id: number; supplier: string; erp_code: string; contact_name: string;
    phone: string; email: string; address: string; due_date: Date | null; notes: string; created_at: Date }>(`
    SELECT r.*, s.name AS supplier, s.erp_code, s.contact_name, s.phone, s.email, s.address
    FROM rfqs r JOIN suppliers s ON s.id=r.supplier_id WHERE r.id=$1`, [id]);
  if (!rfq) notFound();
  const lines = await query<{ sku: string; name: string; description: string; unit: string; qty: string; supplier_sku: string }>(`
    SELECT i.sku, i.name, i.description, i.unit, l.qty, si.supplier_sku FROM rfq_lines l JOIN items i ON i.id=l.item_id
    LEFT JOIN supplier_items si ON si.item_id=l.item_id AND si.supplier_id=$2 WHERE l.rfq_id=$1 ORDER BY l.id`,
    [id, rfq.supplier_id]);
  return (
    <div className="print-doc">
      <style>{`.side{display:none} .shell{display:block} main{max-width:none;padding:0}
        .print-doc{background:#fff;max-width:800px;margin:0 auto;padding:40px;border:1px solid var(--border)}
        @media print{.no-print{display:none} .print-doc{border:none;padding:0} body{background:#fff}}`}</style>
      <PrintButton />
      <h1 style={{ marginBottom: 4 }}>בקשה להצעת מחיר</h1>
      <div style={{ fontSize: 18, marginBottom: 20 }}><span className="ltr">{rfqNo(rfq.id)}</span></div>
      <table style={{ border: "none", marginBottom: 20 }}><tbody>
        <tr><td style={{ border: "none" }}><b>לכבוד:</b> {rfq.supplier} (ספק {rfq.erp_code})<br />
          {rfq.contact_name && <>לידי {rfq.contact_name}<br /></>}
          {rfq.address}<br /><span className="ltr">{rfq.phone} {rfq.email}</span></td>
          <td style={{ border: "none", verticalAlign: "top" }}><b>תאריך:</b> {date(rfq.created_at)}<br />
            {rfq.due_date && <><b>נבקש תשובה עד:</b> {date(rfq.due_date)}</>}</td></tr>
      </tbody></table>
      <table>
        <thead><tr><th>#</th><th>מק"ט ספק</th><th>מק"ט שלנו</th><th>תיאור</th><th>כמות</th><th>יחידה</th><th>מחיר ליח'</th><th>זמן אספקה</th></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}><td>{i + 1}</td><td className="ltr">{l.supplier_sku}</td><td className="ltr">{l.sku}</td>
            <td>{l.name}{l.description ? ` · ${l.description}` : ""}</td><td>{Number(l.qty)}</td><td>{l.unit}</td>
            <td style={{ minWidth: 80 }}></td><td style={{ minWidth: 70 }}></td></tr>))}</tbody>
      </table>
      {rfq.notes && <p><b>הערות:</b> {rfq.notes}</p>}
      <p style={{ marginTop: 30 }}>נבקש לציין מחיר ליחידה לפני מע"מ, זמן אספקה ותנאי תשלום. תודה.</p>
    </div>
  );
}
