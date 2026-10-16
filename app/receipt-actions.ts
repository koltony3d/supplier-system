"use server";

import { requirePermission } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { recomputePo } from "@/lib/receiving";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg: string, err = false) =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);
const logChange = (id: string | number, change: string) =>
  query("INSERT INTO receipt_changes (receipt_id, change) VALUES ($1,$2)", [id, change]);
const refresh = () => { revalidatePath("/receiving"); revalidatePath("/orders"); revalidatePath("/discrepancies"); };

// דרישות 10, 11: קבלה לפי הזמנה. השורות נפתחות עם היתרה שעוד לא התקבלה.
export async function createReceiptFromPo(f: FormData) {
  await requirePermission("receiving.edit");
  const poId = s(f, "po_id");
  const [po] = await query<{ supplier_id: number; status: string }>("SELECT supplier_id, status FROM purchase_orders WHERE id=$1", [poId]);
  if (!po || !["sent", "partial", "draft"].includes(po.status)) back("/receiving", "ההזמנה לא פתוחה לקבלה", true);
  const [r] = await query<{ id: number }>(`INSERT INTO receipts (supplier_id, po_id, delivery_note_no) VALUES ($1,$2,NULLIF($3,''))
    RETURNING id`, [po.supplier_id, poId, s(f, "delivery_note_no")]);
  await query(`INSERT INTO receipt_lines (receipt_id, po_line_id, item_id, supplier_sku, qty, unit_price)
    SELECT $1, l.id, l.item_id, si.supplier_sku, GREATEST(l.qty - l.received_qty, 0), l.unit_price
    FROM po_lines l JOIN purchase_orders p ON p.id=l.po_id
    LEFT JOIN supplier_items si ON si.item_id=l.item_id AND si.supplier_id=p.supplier_id
    WHERE l.po_id=$2 AND l.qty > l.received_qty ORDER BY l.id`, [r.id, poId]);
  await logChange(r.id, "נפתחה קבלה לפי הזמנה");
  redirect(`/receiving/${r.id}`);
}

// דרישה 12: קבלה ללא הזמנת ספק
export async function createReceiptNoPo(f: FormData) {
  await requirePermission("receiving.edit");
  const supplierId = s(f, "supplier_id");
  if (!supplierId) back("/receiving", "יש לבחור ספק", true);
  const [r] = await query<{ id: number }>(`INSERT INTO receipts (supplier_id, delivery_note_no) VALUES ($1, NULLIF($2,''))
    RETURNING id`, [supplierId, s(f, "delivery_note_no")]);
  await logChange(r.id, "נפתחה קבלה ללא הזמנה");
  redirect(`/receiving/${r.id}`);
}

export async function saveReceiptHeader(f: FormData) {
  await requirePermission("receiving.edit");
  const id = s(f, "id");
  await query(`UPDATE receipts SET delivery_note_no=NULLIF($1,''), invoice_no=NULLIF($2,''), received_date=$3::date,
    notes=$4, updated_at=now() WHERE id=$5`,
    [s(f, "delivery_note_no"), s(f, "invoice_no"), s(f, "received_date") || new Date().toISOString().slice(0, 10), s(f, "notes"), id]);
  await logChange(id, `עודכנו פרטי מסמך (ת.משלוח ${s(f, "delivery_note_no") || "-"}, חשבונית ${s(f, "invoice_no") || "-"})`);
  back(`/receiving/${id}`, "נשמר");
}

// הוספת שורה לפי מק"ט שלנו או מק"ט ספק (דרישה 14 משמשת כאן)
export async function addReceiptLine(f: FormData) {
  await requirePermission("receiving.edit");
  const id = s(f, "id");
  const code = s(f, "code");
  const q = Number(s(f, "qty"));
  if (!code || !(q > 0)) back(`/receiving/${id}`, "יש להזין מק\"ט וכמות גדולה מאפס", true);
  const [r] = await query<{ supplier_id: number; po_id: number | null; status: string }>(
    "SELECT supplier_id, po_id, status FROM receipts WHERE id=$1", [id]);
  const [match] = await query<{ item_id: number; supplier_sku: string | null; last_price: string | null }>(`
    SELECT i.id AS item_id, si.supplier_sku, si.last_price FROM items i
    LEFT JOIN supplier_items si ON si.item_id=i.id AND si.supplier_id=$2
    WHERE i.sku=$1 OR si.supplier_sku=$1 ORDER BY (i.sku=$1) DESC LIMIT 1`, [code, r.supplier_id]);
  let poLineId: number | null = null;
  let price = s(f, "unit_price").replace(/,/g, "") || null;
  if (match && r.po_id) {
    const [pl] = await query<{ id: number; unit_price: string | null }>(
      "SELECT id, unit_price FROM po_lines WHERE po_id=$1 AND item_id=$2", [r.po_id, match.item_id]);
    if (pl) { poLineId = pl.id; price = price ?? pl.unit_price; }
  }
  if (match && price === null) price = match.last_price;
  await query(`INSERT INTO receipt_lines (receipt_id, po_line_id, item_id, supplier_sku, description, qty, unit_price)
    VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7)`,
    [id, poLineId, match?.item_id ?? null, match ? match.supplier_sku : code, s(f, "description"), q, price]);
  await logChange(id, `נוספה שורה ${code}, כמות ${q}${match ? "" : " (מק\"ט לא מזוהה)"}`);
  if (r.status === "posted" && r.po_id) await recomputePo(r.po_id);
  refresh();
  back(`/receiving/${id}`, match ? "השורה נוספה" : `מק"ט ${code} לא מזוהה. השורה נוספה ותופיע באי התאמות`, !match);
}

// דרישה 23: עדכון קבלת סחורה, גם אחרי קליטה. הכמויות בהזמנה מחושבות מחדש.
export async function saveReceiptLines(f: FormData) {
  await requirePermission("receiving.edit");
  const id = s(f, "id");
  const [r] = await query<{ po_id: number | null; status: string }>("SELECT po_id, status FROM receipts WHERE id=$1", [id]);
  const lines = await query<{ id: number; qty: string; unit_price: string | null; label: string }>(`
    SELECT rl.id, rl.qty, rl.unit_price, coalesce(i.sku, rl.supplier_sku) AS label
    FROM receipt_lines rl LEFT JOIN items i ON i.id=rl.item_id WHERE receipt_id=$1`, [id]);
  const changes: string[] = [];
  for (const l of lines) {
    const q = Number(s(f, `qty_${l.id}`));
    const pRaw = s(f, `price_${l.id}`).replace(/,/g, "");
    if (!(q >= 0) || s(f, `qty_${l.id}`) === "") back(`/receiving/${id}`, `כמות לא תקינה בשורה ${l.label}`, true);
    if (q !== Number(l.qty)) changes.push(`${l.label}: כמות ${Number(l.qty)} ← ${q}`);
    const oldP = l.unit_price === null ? "" : String(Number(l.unit_price));
    const newP = pRaw === "" ? "" : String(Number(pRaw));
    if (oldP !== newP) changes.push(`${l.label}: מחיר ${oldP || "-"} ← ${newP || "-"}`);
    await query("UPDATE receipt_lines SET qty=$1, unit_price=NULLIF($2,'')::numeric WHERE id=$3", [q, pRaw, l.id]);
  }
  if (changes.length) {
    await query("UPDATE receipts SET updated_at=now() WHERE id=$1", [id]);
    await logChange(id, (r.status === "posted" ? "עדכון אחרי קליטה: " : "") + changes.join("; "));
  }
  if (r.status === "posted" && r.po_id) await recomputePo(r.po_id);
  refresh();
  back(`/receiving/${id}`, changes.length ? `עודכנו ${changes.length} שינויים` : "אין שינויים");
}

export async function removeReceiptLine(f: FormData) {
  await requirePermission("receiving.edit");
  const id = s(f, "id");
  const [r] = await query<{ po_id: number | null; status: string }>("SELECT po_id, status FROM receipts WHERE id=$1", [id]);
  const [l] = await query<{ label: string }>(`SELECT coalesce(i.sku, rl.supplier_sku) AS label FROM receipt_lines rl
    LEFT JOIN items i ON i.id=rl.item_id WHERE rl.id=$1 AND rl.receipt_id=$2`, [s(f, "line_id"), id]);
  await query("DELETE FROM receipt_lines WHERE id=$1 AND receipt_id=$2", [s(f, "line_id"), id]);
  if (l) await logChange(id, `הוסרה שורה ${l.label}`);
  if (r.status === "posted" && r.po_id) await recomputePo(r.po_id);
  refresh();
  back(`/receiving/${id}`, "השורה הוסרה");
}

// קליטה: הכמויות נכנסות להזמנה ולמלאי (שליחה למערכת המלאי תתווסף בשלב 6)
export async function postReceipt(f: FormData) {
  await requirePermission("receiving.edit");
  const id = s(f, "id");
  const [r] = await query<{ po_id: number | null; status: string; n: number; total: string }>(`
    SELECT r.po_id, r.status, count(rl.id)::int AS n, coalesce(sum(rl.qty),0) AS total
    FROM receipts r LEFT JOIN receipt_lines rl ON rl.receipt_id=r.id WHERE r.id=$1 GROUP BY r.id`, [id]);
  if (r.status === "posted") back(`/receiving/${id}`, "הקבלה כבר נקלטה", true);
  if (r.n === 0 || Number(r.total) === 0) back(`/receiving/${id}`, "אין כמויות לקליטה", true);
  await query("DELETE FROM receipt_lines WHERE receipt_id=$1 AND qty=0", [id]);
  await query("UPDATE receipts SET status='posted', posted_at=now(), updated_at=now() WHERE id=$1", [id]);
  await logChange(id, "הקבלה נקלטה");
  let summary = "הקבלה נקלטה";
  if (r.po_id) {
    const status = await recomputePo(r.po_id);
    summary += status === "received" ? ", ההזמנה התקבלה במלואה" : ", ההזמנה התקבלה חלקית";
  }
  const [{ d }] = await query<{ d: number }>(`SELECT count(*)::int AS d FROM discrepancies
    WHERE receipt_id=$1 OR (po_id=$2 AND receipt_id IS NULL)`, [id, r.po_id]);
  if (d) summary += ` · ${d} אי התאמות`;
  refresh();
  back(`/receiving/${id}`, summary, d > 0);
}

export async function unpostReceipt(f: FormData) {
  await requirePermission("receiving.edit");
  const id = s(f, "id");
  const [r] = await query<{ po_id: number | null }>("SELECT po_id FROM receipts WHERE id=$1", [id]);
  await query("UPDATE receipts SET status='draft', posted_at=NULL, updated_at=now() WHERE id=$1", [id]);
  await logChange(id, "הקליטה בוטלה, הקבלה חזרה לטיוטה");
  if (r.po_id) await recomputePo(r.po_id);
  refresh();
  back(`/receiving/${id}`, "הקליטה בוטלה");
}

export async function deleteDraftReceipt(f: FormData) {
  await requirePermission("receiving.edit");
  const id = s(f, "id");
  await query("DELETE FROM receipts WHERE id=$1 AND status='draft'", [id]);
  refresh();
  back("/receiving", "טיוטת הקבלה נמחקה");
}

// דרישה 19: סימון אי התאמה כמטופלת
export async function resolveDiscrepancy(f: FormData) {
  await requirePermission("discrepancies.resolve");
  const key = s(f, "key");
  if (s(f, "undo") === "1") await query("DELETE FROM discrepancy_notes WHERE key=$1", [key]);
  else await query(`INSERT INTO discrepancy_notes (key, note) VALUES ($1, NULLIF($2,''))
    ON CONFLICT (key) DO UPDATE SET note=EXCLUDED.note, resolved=TRUE, resolved_at=now()`, [key, s(f, "note")]);
  revalidatePath("/discrepancies");
  back(s(f, "return") || "/discrepancies", s(f, "undo") === "1" ? "הוחזר לפתוחות" : "סומן כמטופל");
}
