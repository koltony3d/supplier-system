"use server";

import { requirePermission } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool, query } from "@/lib/db";
import { poNo, rfqNo } from "@/lib/format";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg: string, err = false) =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);
const logChange = (poId: string | number, change: string) =>
  query("INSERT INTO po_changes (po_id, change) VALUES ($1,$2)", [poId, change]);

async function editableOrFail(id: string) {
  const [po] = await query<{ status: string }>("SELECT status FROM purchase_orders WHERE id=$1", [id]);
  if (!po || po.status === "received" || po.status === "cancelled")
    back(`/orders/${id}`, "אי אפשר לעדכן הזמנה שהתקבלה במלואה או בוטלה", true);
}

// דרישה 9: הזמנה בלי הצעת מחיר
export async function createPo(f: FormData) {
  await requirePermission("orders.edit");
  const supplierId = s(f, "supplier_id");
  if (!supplierId) back("/orders", "יש לבחור ספק", true);
  const [r] = await query<{ id: number }>(
    "INSERT INTO purchase_orders (supplier_id, expected_date, notes) VALUES ($1, NULLIF($2,'')::date, $3) RETURNING id",
    [supplierId, s(f, "expected_date"), s(f, "notes")]);
  await logChange(r.id, "ההזמנה נוצרה");
  revalidatePath("/orders");
  redirect(`/orders/${r.id}`);
}

// דרישה 9: הזמנה עם שיוך להצעת מחיר. מעתיקה את השורות שתומחרו (או את כולן) עם המחיר המוצע.
export async function createPoFromRfq(f: FormData) {
  await requirePermission("orders.edit");
  const rfqId = s(f, "rfq_id");
  const client = await pool.connect();
  let poId = 0;
  try {
    await client.query("BEGIN");
    const { rows: [rfq] } = await client.query("SELECT supplier_id, status FROM rfqs WHERE id=$1", [rfqId]);
    if (!rfq || rfq.status === "deleted") throw new Error("הצעת המחיר לא קיימת או נמחקה");
    const { rows: [po] } = await client.query(
      "INSERT INTO purchase_orders (supplier_id, rfq_id) VALUES ($1,$2) RETURNING id", [rfq.supplier_id, rfqId]);
    poId = po.id;
    await client.query(`INSERT INTO po_lines (po_id, item_id, qty, unit_price)
      SELECT $1, item_id, qty, quoted_price FROM rfq_lines WHERE rfq_id=$2
        AND (quoted_price IS NOT NULL OR NOT EXISTS (SELECT 1 FROM rfq_lines WHERE rfq_id=$2 AND quoted_price IS NOT NULL))`,
      [poId, rfqId]);
    await client.query("UPDATE rfqs SET status='closed' WHERE id=$1", [rfqId]);
    await client.query("INSERT INTO po_changes (po_id, change) VALUES ($1,$2)", [poId, `נוצרה מהצעת מחיר ${rfqNo(Number(rfqId))}`]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    back(`/quotes/${rfqId}`, (e as Error).message, true);
  } finally {
    client.release();
  }
  revalidatePath("/orders"); revalidatePath("/quotes");
  back(`/orders/${poId}`, "ההזמנה נוצרה מהצעת המחיר");
}

export async function savePoHeader(f: FormData) {
  await requirePermission("orders.edit");
  const id = s(f, "id");
  await editableOrFail(id);
  await query("UPDATE purchase_orders SET expected_date=NULLIF($1,'')::date, notes=$2, updated_at=now() WHERE id=$3",
    [s(f, "expected_date"), s(f, "notes"), id]);
  await logChange(id, `עודכנו פרטי הזמנה (תאריך אספקה ${s(f, "expected_date") || "ללא"})`);
  back(`/orders/${id}`, "נשמר");
}

export async function addPoLine(f: FormData) {
  await requirePermission("orders.edit");
  const id = s(f, "id");
  await editableOrFail(id);
  const sku = s(f, "sku");
  const qty = Number(s(f, "qty"));
  if (!sku || !(qty > 0)) back(`/orders/${id}`, "יש לבחור פריט וכמות גדולה מאפס", true);
  const [item] = await query<{ id: number; last_price: string | null }>(`
    SELECT i.id, si.last_price FROM items i JOIN purchase_orders p ON p.id=$2
    LEFT JOIN supplier_items si ON si.item_id=i.id AND si.supplier_id=p.supplier_id
    WHERE i.sku=$1 AND i.active`, [sku, id]);
  if (!item) back(`/orders/${id}`, `מק"ט ${sku} לא נמצא בפריטים הפעילים`, true);
  const price = s(f, "unit_price").replace(/,/g, "") || item.last_price;
  await query(`INSERT INTO po_lines (po_id, item_id, qty, unit_price) VALUES ($1,$2,$3,$4)
    ON CONFLICT (po_id, item_id) DO UPDATE SET qty=EXCLUDED.qty, unit_price=EXCLUDED.unit_price`, [id, item.id, qty, price]);
  await query("UPDATE purchase_orders SET updated_at=now() WHERE id=$1", [id]);
  await logChange(id, `נוסף פריט ${sku}, כמות ${qty}`);
  back(`/orders/${id}`, "השורה נוספה");
}

// דרישה 22: עדכון כמויות ומחירים. אי אפשר להוריד כמות מתחת למה שכבר התקבל.
export async function savePoLines(f: FormData) {
  await requirePermission("orders.edit");
  const id = s(f, "id");
  await editableOrFail(id);
  const lines = await query<{ id: number; sku: string; qty: string; unit_price: string | null; received_qty: string }>(
    "SELECT l.id, i.sku, l.qty, l.unit_price, l.received_qty FROM po_lines l JOIN items i ON i.id=l.item_id WHERE po_id=$1", [id]);
  const changes: string[] = [];
  for (const l of lines) {
    const qty = Number(s(f, `qty_${l.id}`));
    const priceRaw = s(f, `price_${l.id}`).replace(/,/g, "");
    if (!(qty > 0)) back(`/orders/${id}`, `כמות לא תקינה במק"ט ${l.sku}`, true);
    if (qty < Number(l.received_qty))
      back(`/orders/${id}`, `במק"ט ${l.sku} כבר התקבלו ${Number(l.received_qty)}, אי אפשר להוריד מתחת לזה`, true);
    if (qty !== Number(l.qty)) changes.push(`${l.sku}: כמות ${Number(l.qty)} ← ${qty}`);
    const oldP = l.unit_price === null ? "" : String(Number(l.unit_price));
    const newP = priceRaw === "" ? "" : String(Number(priceRaw));
    if (oldP !== newP) changes.push(`${l.sku}: מחיר ${oldP || "-"} ← ${newP || "-"}`);
    await query("UPDATE po_lines SET qty=$1, unit_price=NULLIF($2,'')::numeric WHERE id=$3", [qty, priceRaw, l.id]);
  }
  if (changes.length) {
    await query("UPDATE purchase_orders SET updated_at=now() WHERE id=$1", [id]);
    await logChange(id, changes.join("; "));
  }
  back(`/orders/${id}`, changes.length ? `עודכנו ${changes.length} שינויים` : "אין שינויים");
}

export async function removePoLine(f: FormData) {
  await requirePermission("orders.edit");
  const id = s(f, "id");
  await editableOrFail(id);
  const [l] = await query<{ sku: string; received_qty: string }>(
    "SELECT i.sku, l.received_qty FROM po_lines l JOIN items i ON i.id=l.item_id WHERE l.id=$1 AND l.po_id=$2",
    [s(f, "line_id"), id]);
  if (l && Number(l.received_qty) > 0) back(`/orders/${id}`, `אי אפשר להסיר את ${l.sku}, כבר התקבלה ממנו סחורה`, true);
  await query("DELETE FROM po_lines WHERE id=$1 AND po_id=$2", [s(f, "line_id"), id]);
  if (l) await logChange(id, `הוסר פריט ${l.sku}`);
  back(`/orders/${id}`, "השורה הוסרה");
}

export async function markPoSent(f: FormData) {
  await requirePermission("orders.edit");
  const id = s(f, "id");
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM po_lines WHERE po_id=$1", [id]);
  if (n === 0) back(`/orders/${id}`, "אי אפשר לשלוח הזמנה בלי שורות", true);
  await query("UPDATE purchase_orders SET status='sent', sent_at=now(), updated_at=now() WHERE id=$1 AND status='draft'", [id]);
  await logChange(id, "ההזמנה נשלחה לספק");
  revalidatePath("/orders");
  back(`/orders/${id}`, `${poNo(Number(id))} סומנה כנשלחה`);
}

export async function cancelPo(f: FormData) {
  await requirePermission("orders.edit");
  const id = s(f, "id");
  const [{ rec }] = await query<{ rec: string }>("SELECT coalesce(sum(received_qty),0) AS rec FROM po_lines WHERE po_id=$1", [id]);
  if (Number(rec) > 0) back(`/orders/${id}`, "כבר התקבלה סחורה בהזמנה הזו, אי אפשר לבטל אותה", true);
  await query("UPDATE purchase_orders SET status='cancelled', updated_at=now() WHERE id=$1", [id]);
  await logChange(id, `ההזמנה בוטלה${s(f, "reason") ? `: ${s(f, "reason")}` : ""}`);
  revalidatePath("/orders");
  back(`/orders/${id}`, "ההזמנה בוטלה");
}
