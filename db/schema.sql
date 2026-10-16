-- שלב 1: ספקים, פריטים, שיוך פריט-ספק, תמונות לפי מק"ט

CREATE TABLE IF NOT EXISTS suppliers (
  id            SERIAL PRIMARY KEY,
  erp_code      TEXT UNIQUE NOT NULL,          -- קוד ספק במערכת ה-ERP
  name          TEXT NOT NULL,
  tax_id        TEXT,                          -- ח.פ / עוסק מורשה
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  payment_terms TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  source        TEXT NOT NULL DEFAULT 'erp',   -- erp | manual
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id          SERIAL PRIMARY KEY,
  sku         TEXT UNIQUE NOT NULL,            -- המק"ט שלנו
  name        TEXT NOT NULL,
  description TEXT,
  unit        TEXT NOT NULL DEFAULT 'יח''',
  category    TEXT,
  barcode     TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = פריט שהורד ידנית
  source      TEXT NOT NULL DEFAULT 'erp',     -- erp | manual
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- שיוך פריט לספק + התאמת מק"ט ספק למק"ט שלנו (דרישה 14)
CREATE TABLE IF NOT EXISTS supplier_items (
  id             SERIAL PRIMARY KEY,
  supplier_id    INT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  item_id        INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  supplier_sku   TEXT,
  last_price     NUMERIC(12,2),
  currency       TEXT NOT NULL DEFAULT 'ILS',
  lead_time_days INT,
  is_preferred   BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (supplier_id, item_id)
);
CREATE INDEX IF NOT EXISTS supplier_items_supplier_sku ON supplier_items (supplier_id, supplier_sku);

-- תמונות לפי מק"ט (דרישה 5)
CREATE TABLE IF NOT EXISTS item_images (
  sku        TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- יומן יבוא מה-ERP
CREATE TABLE IF NOT EXISTS import_log (
  id         SERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,
  file_name  TEXT,
  inserted   INT NOT NULL DEFAULT 0,
  updated    INT NOT NULL DEFAULT 0,
  errors     JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- שלב 2: בקשות להצעת מחיר (דרישות 8, 15, 17, 21)
CREATE TABLE IF NOT EXISTS rfqs (
  id          SERIAL PRIMARY KEY,
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | answered | closed | deleted
  due_date    DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  delete_reason TEXT
);

CREATE TABLE IF NOT EXISTS rfq_lines (
  id               SERIAL PRIMARY KEY,
  rfq_id           INT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  item_id          INT NOT NULL REFERENCES items(id),
  qty              NUMERIC(12,3) NOT NULL,
  quoted_price     NUMERIC(12,2),             -- המחיר שהספק הציע
  quoted_lead_days INT,
  UNIQUE (rfq_id, item_id)
);

-- שלב 3: הזמנות רכש (דרישות 9, 18, 22)
CREATE TABLE IF NOT EXISTS purchase_orders (
  id            SERIAL PRIMARY KEY,
  supplier_id   INT NOT NULL REFERENCES suppliers(id),
  rfq_id        INT REFERENCES rfqs(id),        -- NULL = הזמנה בלי הצעת מחיר
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | partial | received | cancelled
  expected_date DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS po_lines (
  id           SERIAL PRIMARY KEY,
  po_id        INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id      INT NOT NULL REFERENCES items(id),
  qty          NUMERIC(12,3) NOT NULL,
  unit_price   NUMERIC(12,2),
  received_qty NUMERIC(12,3) NOT NULL DEFAULT 0,  -- מתעדכן בקבלת סחורה (שלב 4)
  UNIQUE (po_id, item_id)
);

-- היסטוריית עדכונים בהזמנה (דרישה 22)
CREATE TABLE IF NOT EXISTS po_changes (
  id         SERIAL PRIMARY KEY,
  po_id      INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  change     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- שלב 4: קבלת סחורה (דרישות 10, 11, 12, 16, 19, 23)
CREATE TABLE IF NOT EXISTS receipts (
  id               SERIAL PRIMARY KEY,
  supplier_id      INT NOT NULL REFERENCES suppliers(id),
  po_id            INT REFERENCES purchase_orders(id),  -- NULL = קבלה ללא הזמנת ספק
  status           TEXT NOT NULL DEFAULT 'draft',       -- draft | posted
  delivery_note_no TEXT,                                 -- מספר תעודת משלוח
  invoice_no       TEXT,
  received_date    DATE NOT NULL DEFAULT current_date,
  source           TEXT NOT NULL DEFAULT 'manual',      -- manual | scan
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at        TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipt_lines (
  id           SERIAL PRIMARY KEY,
  receipt_id   INT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  po_line_id   INT REFERENCES po_lines(id),  -- NULL = פריט שלא הוזמן
  item_id      INT REFERENCES items(id),     -- NULL = מק"ט ספק לא מזוהה
  supplier_sku TEXT,
  description  TEXT,
  qty          NUMERIC(12,3) NOT NULL,
  unit_price   NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS receipt_changes (
  id         SERIAL PRIMARY KEY,
  receipt_id INT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  change     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- טיפול באי התאמות (דרישה 19). המפתח מזהה את אי ההתאמה, למשל line-12-price
CREATE TABLE IF NOT EXISTS discrepancy_notes (
  key         TEXT PRIMARY KEY,
  resolved    BOOLEAN NOT NULL DEFAULT TRUE,
  note        TEXT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ריכוז אי התאמות מחושב תמיד מהנתונים העדכניים
CREATE OR REPLACE VIEW discrepancies AS
  -- כמות: חוסר או עודף מול שורת הזמנה (אחרי לפחות קבלה אחת להזמנה)
  SELECT 'poline-' || l.id || '-' || CASE WHEN l.received_qty > l.qty THEN 'over' ELSE 'short' END AS key,
         CASE WHEN l.received_qty > l.qty THEN 'עודף כמות' ELSE 'חוסר כמות' END AS kind,
         p.supplier_id, p.id AS po_id, NULL::int AS receipt_id, l.item_id, NULL::text AS supplier_sku,
         l.qty AS expected, l.received_qty AS actual,
         (SELECT max(r.posted_at) FROM receipts r WHERE r.po_id=p.id AND r.status='posted') AS detected_at
  FROM po_lines l JOIN purchase_orders p ON p.id=l.po_id
  WHERE p.status <> 'cancelled' AND l.received_qty <> l.qty
    AND EXISTS (SELECT 1 FROM receipts r WHERE r.po_id=p.id AND r.status='posted')
  UNION ALL
  -- מחיר: מחיר בתעודה שונה ממחיר ההזמנה
  SELECT 'line-' || rl.id || '-price', 'מחיר שונה מההזמנה', r.supplier_id, r.po_id, r.id, rl.item_id, rl.supplier_sku,
         pl.unit_price, rl.unit_price, r.posted_at
  FROM receipt_lines rl JOIN receipts r ON r.id=rl.receipt_id JOIN po_lines pl ON pl.id=rl.po_line_id
  WHERE r.status='posted' AND rl.unit_price IS NOT NULL AND pl.unit_price IS NOT NULL AND rl.unit_price <> pl.unit_price
  UNION ALL
  -- פריט שהתקבל ולא הוזמן
  SELECT 'line-' || rl.id || '-notinpo', 'פריט שלא הוזמן', r.supplier_id, r.po_id, r.id, rl.item_id, rl.supplier_sku,
         0, rl.qty, r.posted_at
  FROM receipt_lines rl JOIN receipts r ON r.id=rl.receipt_id
  WHERE r.status='posted' AND r.po_id IS NOT NULL AND rl.po_line_id IS NULL AND rl.item_id IS NOT NULL
  UNION ALL
  -- מק"ט ספק לא מזוהה
  SELECT 'line-' || rl.id || '-unknown', 'מק"ט לא מזוהה', r.supplier_id, r.po_id, r.id, NULL, rl.supplier_sku,
         NULL, rl.qty, r.posted_at
  FROM receipt_lines rl JOIN receipts r ON r.id=rl.receipt_id
  WHERE r.status='posted' AND rl.item_id IS NULL
  UNION ALL
  -- קבלה ללא הזמנת ספק
  SELECT 'receipt-' || r.id || '-nopo', 'קבלה ללא הזמנה', r.supplier_id, NULL, r.id, NULL, NULL, NULL,
         (SELECT sum(qty) FROM receipt_lines WHERE receipt_id=r.id), r.posted_at
  FROM receipts r WHERE r.status='posted' AND r.po_id IS NULL;

-- שלב 7: משתמשים והרשאות (דרישה 24)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',  -- admin | purchasing | warehouse | viewer
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
