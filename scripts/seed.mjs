// נתוני דוגמה לסביבת הטסט בלבד
import pg from "pg";
import { randomBytes, scryptSync } from "node:crypto";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const suppliers = [
  ["S1001", "אלקטרו-טק בע\"מ", "514000001", "דני כהן", "03-5551234", "orders@electrotech.example", "המלאכה 12, חולון", "שוטף+60"],
  ["S1002", "מתכות הצפון", "514000002", "רונית לוי", "04-8887766", "sales@metal-north.example", "אזור תעשייה, כרמיאל", "שוטף+30"],
  ["S1003", "פלסט-פרו", "514000003", "יוסי מזרחי", "08-9123456", "info@plastpro.example", "הברזל 5, אשדוד", "שוטף+45"],
  ["S1004", "רובוטיקה ישראל", "514000004", "מיכל אברהם", "09-7654321", "quotes@robotics-il.example", "הנחושת 3, הרצליה", "מזומן"],
];
const items = [
  ["10001", "מנוע צעד NEMA17", "מנוע צעד 1.8° 42 מ\"מ", "יח'", "מנועים"],
  ["10002", "מנוע צעד NEMA23", "מנוע צעד 2.8A", "יח'", "מנועים"],
  ["10003", "ספק כוח 24V 10A", "ספק מיתוג לפס DIN", "יח'", "חשמל"],
  ["10004", "בקר PLC קומפקטי", "16 כניסות / 12 יציאות", "יח'", "בקרה"],
  ["10005", "פרופיל אלומיניום 40x40", "אורך 6 מטר", "מטר", "מכני"],
  ["10006", "ברגי M6x20 נירוסטה", "אריזה של 100", "אריזה", "מכני"],
  ["10007", "חיישן קרבה אינדוקטיבי M12", "PNP NO", "יח'", "חיישנים"],
  ["10008", "כבל 4x0.75 ממ\"ר", "גליל 100 מטר", "גליל", "חשמל"],
  ["10009", "גלגל שיניים T5 20 שיניים", "אלומיניום", "יח'", "מכני"],
  ["10010", "רצועת תזמון T5", "רוחב 10 מ\"מ", "מטר", "מכני"],
  ["10011", "מארז פלסטיק IP65", "200x150x100", "יח'", "מארזים"],
  ["10012", "מסך מגע HMI 7\"", "Ethernet + RS485", "יח'", "בקרה"],
];
// [supplier erp_code, our sku, supplier sku, price, lead days]
const links = [
  ["S1001", "10003", "ET-PS2410", 185, 7], ["S1001", "10008", "ET-CBL4075", 420, 3],
  ["S1001", "10007", "ET-IND12P", 62.5, 10], ["S1001", "10004", "ET-PLC1612", 1350, 21],
  ["S1002", "10005", "MN-AL4040", 48, 5], ["S1002", "10006", "MN-M620SS", 35, 2],
  ["S1003", "10011", "PP-BOX-IP65-L", 79.9, 14],
  ["S1004", "10001", "RIL-N17", 69, 7], ["S1004", "10002", "RIL-N23", 145, 7],
  ["S1004", "10009", "RIL-T5-20", 28, 10], ["S1004", "10010", "RIL-T5-10", 18, 10],
  ["S1004", "10012", "RIL-HMI7", 1890, 30], ["S1001", "10001", "ET-STP17", 74, 14],
];

for (const s of suppliers)
  await c.query(`INSERT INTO suppliers (erp_code,name,tax_id,contact_name,phone,email,address,payment_terms)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (erp_code) DO NOTHING`, s);
for (const i of items)
  await c.query(`INSERT INTO items (sku,name,description,unit,category) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (sku) DO NOTHING`, i);
for (const [code, sku, ssku, price, lead] of links)
  await c.query(`INSERT INTO supplier_items (supplier_id,item_id,supplier_sku,last_price,lead_time_days)
    SELECT s.id, i.id, $3, $4, $5 FROM suppliers s, items i WHERE s.erp_code=$1 AND i.sku=$2
    ON CONFLICT (supplier_id,item_id) DO NOTHING`, [code, sku, ssku, price, lead]);

// משתמשי דוגמה לטסט: סיסמה זהה לכולם, יש להחליף לפני כל שימוש אמיתי
const hash = (pw) => { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`; };
const testPassword = process.env.SEED_PASSWORD ?? "test1234";
for (const [username, full_name, role] of [["admin", "מנהל מערכת", "admin"], ["buyer", "קניין לדוגמה", "purchasing"],
    ["store", "מחסנאי לדוגמה", "warehouse"], ["viewer", "צופה לדוגמה", "viewer"]])
  await c.query(`INSERT INTO users (username, full_name, role, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING`,
    [username, full_name, role, hash(testPassword)]);
await c.end();
console.log("seeded");
