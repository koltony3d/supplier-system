import { query } from "@/lib/db";

// מחשב מחדש כמה התקבל מכל שורת הזמנה לפי כל הקבלות שנקלטו, ומעדכן את סטטוס ההזמנה
export async function recomputePo(poId: number) {
  await query(`UPDATE po_lines l SET received_qty = coalesce((
      SELECT sum(rl.qty) FROM receipt_lines rl JOIN receipts r ON r.id=rl.receipt_id
      WHERE rl.po_line_id=l.id AND r.status='posted'), 0)
    WHERE l.po_id=$1`, [poId]);
  const [{ status }] = await query<{ status: string }>(`
    UPDATE purchase_orders p SET updated_at=now(), status = CASE
      WHEN p.status='cancelled' THEN 'cancelled'
      WHEN NOT EXISTS (SELECT 1 FROM po_lines WHERE po_id=p.id AND received_qty < qty) THEN 'received'
      WHEN EXISTS (SELECT 1 FROM po_lines WHERE po_id=p.id AND received_qty > 0) THEN 'partial'
      WHEN p.sent_at IS NOT NULL THEN 'sent' ELSE 'draft' END
    WHERE p.id=$1 RETURNING status`, [poId]);
  return status;
}
