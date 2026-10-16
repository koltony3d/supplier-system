"use server";

import { requirePermission } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool, query } from "@/lib/db";
import { parseCsv, pick } from "@/lib/csv";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOrNull = (v: string) => (v === "" ? null : Number(v.replace(/,/g, "")));
const back = (path: string, msg: string, err = false) =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);

// ---------- ספקים ----------
export async function saveSupplier(f: FormData) {
  await requirePermission("master.edit");
  const id = s(f, "id");
  const vals = [s(f, "erp_code"), s(f, "name"), s(f, "tax_id"), s(f, "contact_name"), s(f, "phone"),
    s(f, "email"), s(f, "address"), s(f, "payment_terms")];
  if (!vals[0] || !vals[1]) back(id ? `/suppliers/${id}` : "/suppliers", "חובה למלא קוד ספק ושם", true);
  try {
    if (id) {
      await query(`UPDATE suppliers SET erp_code=$1,name=$2,tax_id=$3,contact_name=$4,phone=$5,email=$6,
        address=$7,payment_terms=$8,updated_at=now() WHERE id=$9`, [...vals, id]);
    } else {
      const [r] = await query<{ id: number }>(`INSERT INTO suppliers (erp_code,name,tax_id,contact_name,phone,email,
        address,payment_terms,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual') RETURNING id`, vals);
      revalidatePath("/suppliers");
      back(`/suppliers/${r.id}`, "הספק נוסף");
    }
  } catch (e) {
    if ((e as { code?: string }).code === "23505") back(id ? `/suppliers/${id}` : "/suppliers", "קוד ספק כבר קיים", true);
    throw e;
  }
  revalidatePath("/suppliers");
  back(`/suppliers/${id}`, "הספק עודכן");
}

export async function setSupplierActive(f: FormData) {
  await requirePermission("master.edit");
  const id = s(f, "id");
  await query("UPDATE suppliers SET active=$1, updated_at=now() WHERE id=$2", [s(f, "active") === "1", id]);
  revalidatePath("/suppliers");
  back(`/suppliers/${id}`, s(f, "active") === "1" ? "הספק הופעל" : "הספק הושבת");
}

// ---------- פריטים (דרישות 6, 7) ----------
export async function saveItem(f: FormData) {
  await requirePermission("master.edit");
  const id = s(f, "id");
  const vals = [s(f, "sku"), s(f, "name"), s(f, "description"), s(f, "unit") || "יח'", s(f, "category"), s(f, "barcode")];
  const path = id ? `/items/${id}` : "/items";
  if (!vals[0] || !vals[1]) back(path, "חובה למלא מק\"ט ושם פריט", true);
  try {
    if (id) {
      await query(`UPDATE items SET sku=$1,name=$2,description=$3,unit=$4,category=$5,barcode=$6,updated_at=now()
        WHERE id=$7`, [...vals, id]);
    } else {
      const [r] = await query<{ id: number }>(`INSERT INTO items (sku,name,description,unit,category,barcode,source)
        VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING id`, vals);
      const supplierId = s(f, "supplier_id");
      if (supplierId)
        await query(`INSERT INTO supplier_items (supplier_id,item_id,supplier_sku,last_price) VALUES ($1,$2,$3,$4)`,
          [supplierId, r.id, s(f, "supplier_sku") || null, numOrNull(s(f, "last_price"))]);
      revalidatePath("/items");
      back(`/items/${r.id}`, "הפריט נוסף ידנית");
    }
  } catch (e) {
    if ((e as { code?: string }).code === "23505") back(path, "מק\"ט כבר קיים במערכת", true);
    throw e;
  }
  revalidatePath("/items");
  back(path, "הפריט עודכן");
}

export async function setItemActive(f: FormData) {
  await requirePermission("master.edit");
  const id = s(f, "id");
  const active = s(f, "active") === "1";
  await query("UPDATE items SET active=$1, updated_at=now() WHERE id=$2", [active, id]);
  revalidatePath("/items");
  back(s(f, "return") || `/items/${id}`, active ? "הפריט הוחזר לרשימה" : "הפריט הורד מהרשימה");
}

// ---------- שיוך פריט לספק + מק"ט ספק (דרישות 3, 14) ----------
export async function linkSupplierItem(f: FormData) {
  await requirePermission("master.edit");
  const ret = s(f, "return");
  const sku = s(f, "sku");
  const [item] = await query<{ id: number }>("SELECT id FROM items WHERE sku=$1", [sku]);
  if (!item) back(ret, `מק"ט ${sku} לא נמצא`, true);
  await query(`INSERT INTO supplier_items (supplier_id,item_id,supplier_sku,last_price,lead_time_days)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (supplier_id,item_id) DO UPDATE SET supplier_sku=EXCLUDED.supplier_sku,
    last_price=COALESCE(EXCLUDED.last_price, supplier_items.last_price),
    lead_time_days=COALESCE(EXCLUDED.lead_time_days, supplier_items.lead_time_days)`,
    [s(f, "supplier_id"), item.id, s(f, "supplier_sku") || null, numOrNull(s(f, "last_price")),
      numOrNull(s(f, "lead_time_days"))]);
  revalidatePath(ret);
  back(ret, "השיוך נשמר");
}

export async function unlinkSupplierItem(f: FormData) {
  await requirePermission("master.edit");
  const ret = s(f, "return");
  await query("DELETE FROM supplier_items WHERE id=$1", [s(f, "link_id")]);
  revalidatePath(ret);
  back(ret, "השיוך הוסר");
}

// ---------- יבוא מ-ERP (דרישות 1-4) ----------
type ImportResult = { inserted: number; updated: number; errors: string[] };

async function importRows(kind: string, rows: Record<string, string>[]): Promise<ImportResult> {
  const res: ImportResult = { inserted: 0, updated: 0, errors: [] };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [i, row] of rows.entries()) {
      const line = i + 2;
      if (kind === "suppliers") {
        const code = pick(row, "קוד ספק", "erp_code", "supplier_code");
        const name = pick(row, "שם ספק", "name");
        if (!code || !name) { res.errors.push(`שורה ${line}: חסר קוד ספק או שם`); continue; }
        const r = await client.query(`INSERT INTO suppliers (erp_code,name,tax_id,contact_name,phone,email,address,payment_terms)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (erp_code) DO UPDATE SET name=EXCLUDED.name,
          tax_id=EXCLUDED.tax_id, contact_name=EXCLUDED.contact_name, phone=EXCLUDED.phone, email=EXCLUDED.email,
          address=EXCLUDED.address, payment_terms=EXCLUDED.payment_terms, updated_at=now()
          RETURNING (xmax = 0) AS inserted`,
          [code, name, pick(row, "ח.פ", "tax_id"), pick(row, "איש קשר", "contact_name"), pick(row, "טלפון", "phone"),
            pick(row, "אימייל", "email"), pick(row, "כתובת", "address"), pick(row, "תנאי תשלום", "payment_terms")]);
        r.rows[0].inserted ? res.inserted++ : res.updated++;
      } else if (kind === "items") {
        const sku = pick(row, "מקט", "מק\"ט", "sku");
        const name = pick(row, "שם פריט", "name");
        if (!sku || !name) { res.errors.push(`שורה ${line}: חסר מק"ט או שם`); continue; }
        const r = await client.query(`INSERT INTO items (sku,name,description,unit,category,barcode)
          VALUES ($1,$2,$3,COALESCE(NULLIF($4,''),'יח'''),$5,$6) ON CONFLICT (sku) DO UPDATE SET name=EXCLUDED.name,
          description=EXCLUDED.description, unit=EXCLUDED.unit, category=EXCLUDED.category, barcode=EXCLUDED.barcode,
          updated_at=now() RETURNING (xmax = 0) AS inserted`,
          [sku, name, pick(row, "תיאור", "description"), pick(row, "יחידה", "unit"), pick(row, "קטגוריה", "category"),
            pick(row, "ברקוד", "barcode")]);
        r.rows[0].inserted ? res.inserted++ : res.updated++;
      } else if (kind === "supplier_items") {
        const code = pick(row, "קוד ספק", "erp_code", "supplier_code");
        const sku = pick(row, "מקט", "מק\"ט", "sku");
        const r = await client.query(`INSERT INTO supplier_items (supplier_id,item_id,supplier_sku,last_price,lead_time_days)
          SELECT s.id, i.id, NULLIF($3,''), NULLIF($4,'')::numeric, NULLIF($5,'')::int
          FROM suppliers s, items i WHERE s.erp_code=$1 AND i.sku=$2
          ON CONFLICT (supplier_id,item_id) DO UPDATE SET supplier_sku=EXCLUDED.supplier_sku,
          last_price=COALESCE(EXCLUDED.last_price, supplier_items.last_price),
          lead_time_days=COALESCE(EXCLUDED.lead_time_days, supplier_items.lead_time_days)
          RETURNING (xmax = 0) AS inserted`,
          [code, sku, pick(row, "מקט ספק", "מק\"ט ספק", "supplier_sku"),
            pick(row, "מחיר", "price").replace(/,/g, ""), pick(row, "זמן אספקה", "lead_time_days")]);
        if (r.rowCount === 0) { res.errors.push(`שורה ${line}: ספק ${code} או מק"ט ${sku} לא קיימים`); continue; }
        r.rows[0].inserted ? res.inserted++ : res.updated++;
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return res;
}

const KIND_LABEL: Record<string, string> = { suppliers: "ספקים", items: "פריטים", supplier_items: "שיוך פריט-ספק" };

export async function importCsv(f: FormData) {
  await requirePermission("master.edit");
  const kind = s(f, "kind");
  const file = f.get("file") as File | null;
  if (!file || file.size === 0) back("/import", "לא נבחר קובץ", true);
  const rows = parseCsv(await file!.text());
  let res: ImportResult;
  try {
    res = await importRows(kind, rows);
  } catch (e) {
    back("/import", `היבוא נכשל: ${(e as Error).message}`, true);
    return;
  }
  await query("INSERT INTO import_log (kind,file_name,inserted,updated,errors) VALUES ($1,$2,$3,$4,$5)",
    [KIND_LABEL[kind] ?? kind, file!.name, res.inserted, res.updated, JSON.stringify(res.errors)]);
  revalidatePath("/", "layout");
  const errs = res.errors.length ? ` · ${res.errors.length} שורות נדחו: ${res.errors.slice(0, 3).join("; ")}` : "";
  back("/import", `${KIND_LABEL[kind]}: ${res.inserted} חדשים, ${res.updated} עודכנו${errs}`, res.errors.length > 0);
}

// ---------- תמונות לפי מק"ט (דרישה 5) ----------
async function saveImage(sku: string, file: File) {
  const buf = Buffer.from(await file.arrayBuffer());
  await query(`INSERT INTO item_images (sku,mime,data) VALUES ($1,$2,$3)
    ON CONFLICT (sku) DO UPDATE SET mime=EXCLUDED.mime, data=EXCLUDED.data, updated_at=now()`,
    [sku, file.type || "image/jpeg", buf]);
}

export async function uploadImages(f: FormData) {
  await requirePermission("master.edit");
  const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
  if (!files.length) back("/import", "לא נבחרו תמונות", true);
  const skus = new Set((await query<{ sku: string }>("SELECT sku FROM items")).map((r) => r.sku));
  let ok = 0;
  const unknown: string[] = [];
  for (const file of files) {
    const sku = file.name.replace(/\.[^.]+$/, "").trim();
    if (!skus.has(sku)) { unknown.push(file.name); continue; }
    await saveImage(sku, file);
    ok++;
  }
  revalidatePath("/", "layout");
  const extra = unknown.length ? ` · ללא מק"ט תואם: ${unknown.slice(0, 5).join(", ")}` : "";
  back("/import", `נקלטו ${ok} תמונות${extra}`, unknown.length > 0);
}

export async function uploadItemImage(f: FormData) {
  await requirePermission("master.edit");
  const id = s(f, "id");
  const file = f.get("file") as File | null;
  if (!file || file.size === 0) back(`/items/${id}`, "לא נבחרה תמונה", true);
  await saveImage(s(f, "sku"), file!);
  revalidatePath(`/items/${id}`);
  back(`/items/${id}`, "התמונה נשמרה");
}
