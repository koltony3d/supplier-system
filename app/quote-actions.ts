"use server";

import { requirePermission } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg: string, err = false) =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);

export async function createRfq(f: FormData) {
  await requirePermission("quotes.edit");
  const supplierId = s(f, "supplier_id");
  if (!supplierId) back("/quotes", "יש לבחור ספק", true);
  const [r] = await query<{ id: number }>(
    "INSERT INTO rfqs (supplier_id, due_date, notes) VALUES ($1, NULLIF($2,'')::date, $3) RETURNING id",
    [supplierId, s(f, "due_date"), s(f, "notes")]);
  revalidatePath("/quotes");
  redirect(`/quotes/${r.id}`);
}

export async function saveRfqHeader(f: FormData) {
  await requirePermission("quotes.edit");
  const id = s(f, "id");
  await query("UPDATE rfqs SET due_date=NULLIF($1,'')::date, notes=$2 WHERE id=$3", [s(f, "due_date"), s(f, "notes"), id]);
  back(`/quotes/${id}`, "נשמר");
}

export async function addRfqLine(f: FormData) {
  await requirePermission("quotes.edit");
  const id = s(f, "id");
  const sku = s(f, "sku");
  const qty = Number(s(f, "qty"));
  if (!sku || !(qty > 0)) back(`/quotes/${id}`, "יש לבחור פריט וכמות גדולה מאפס", true);
  const [item] = await query<{ id: number }>("SELECT id FROM items WHERE sku=$1 AND active", [sku]);
  if (!item) back(`/quotes/${id}`, `מק"ט ${sku} לא נמצא בפריטים הפעילים`, true);
  await query(`INSERT INTO rfq_lines (rfq_id, item_id, qty) VALUES ($1,$2,$3)
    ON CONFLICT (rfq_id, item_id) DO UPDATE SET qty = EXCLUDED.qty`, [id, item.id, qty]);
  revalidatePath(`/quotes/${id}`);
  back(`/quotes/${id}`, "השורה נוספה");
}

export async function removeRfqLine(f: FormData) {
  await requirePermission("quotes.edit");
  const id = s(f, "id");
  await query("DELETE FROM rfq_lines WHERE id=$1 AND rfq_id=$2", [s(f, "line_id"), id]);
  back(`/quotes/${id}`, "השורה הוסרה");
}

export async function markRfqSent(f: FormData) {
  await requirePermission("quotes.edit");
  const id = s(f, "id");
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM rfq_lines WHERE rfq_id=$1", [id]);
  if (n === 0) back(`/quotes/${id}`, "אי אפשר לשלוח בקשה בלי שורות", true);
  await query("UPDATE rfqs SET status='sent', sent_at=now() WHERE id=$1 AND status='draft'", [id]);
  revalidatePath("/quotes");
  back(`/quotes/${id}`, "הבקשה סומנה כנשלחה");
}

// הזנת המחירים שהספק החזיר. בהצעה שהתקבלה מעדכנים גם את המחיר האחרון בשיוך פריט-ספק.
export async function saveRfqAnswer(f: FormData) {
  await requirePermission("quotes.edit");
  const id = s(f, "id");
  const [rfq] = await query<{ supplier_id: number }>("SELECT supplier_id FROM rfqs WHERE id=$1", [id]);
  const lines = await query<{ id: number; item_id: number }>("SELECT id, item_id FROM rfq_lines WHERE rfq_id=$1", [id]);
  let priced = 0;
  for (const l of lines) {
    const price = s(f, `price_${l.id}`).replace(/,/g, "");
    const lead = s(f, `lead_${l.id}`);
    await query("UPDATE rfq_lines SET quoted_price=NULLIF($1,'')::numeric, quoted_lead_days=NULLIF($2,'')::int WHERE id=$3",
      [price, lead, l.id]);
    if (price) {
      priced++;
      await query(`INSERT INTO supplier_items (supplier_id, item_id, last_price, lead_time_days)
        VALUES ($1,$2,$3::numeric,NULLIF($4,'')::int) ON CONFLICT (supplier_id, item_id)
        DO UPDATE SET last_price=EXCLUDED.last_price, lead_time_days=COALESCE(EXCLUDED.lead_time_days, supplier_items.lead_time_days)`,
        [rfq.supplier_id, l.item_id, price, lead]);
    }
  }
  if (priced > 0)
    await query("UPDATE rfqs SET status='answered', answered_at=COALESCE(answered_at, now()) WHERE id=$1 AND status IN ('draft','sent')", [id]);
  revalidatePath("/quotes");
  back(`/quotes/${id}`, priced ? `נשמרו מחירים ל-${priced} שורות` : "נשמר");
}

export async function closeRfq(f: FormData) {
  await requirePermission("quotes.edit");
  const id = s(f, "id");
  await query("UPDATE rfqs SET status='closed' WHERE id=$1", [id]);
  revalidatePath("/quotes");
  back(`/quotes/${id}`, "הבקשה נסגרה");
}

// דרישה 21: מחיקת הצעות לא רלוונטיות (מחיקה רכה, נשמר תיעוד וסיבה)
export async function deleteRfq(f: FormData) {
  await requirePermission("quotes.edit");
  const id = s(f, "id");
  await query("UPDATE rfqs SET status='deleted', deleted_at=now(), delete_reason=NULLIF($2,'') WHERE id=$1",
    [id, s(f, "reason")]);
  revalidatePath("/quotes");
  back(s(f, "return") || "/quotes", "הבקשה נמחקה");
}

export async function restoreRfq(f: FormData) {
  await requirePermission("quotes.edit");
  const id = s(f, "id");
  await query(`UPDATE rfqs SET status = CASE WHEN answered_at IS NOT NULL THEN 'answered'
    WHEN sent_at IS NOT NULL THEN 'sent' ELSE 'draft' END, deleted_at=NULL, delete_reason=NULL WHERE id=$1`, [id]);
  revalidatePath("/quotes");
  back(`/quotes/${id}`, "הבקשה שוחזרה");
}
