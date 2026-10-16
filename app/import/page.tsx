import { importCsv, uploadImages } from "@/app/actions";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

const KINDS = [
  { kind: "suppliers", title: "1. ספקים", note: "קוד ספק, שם ספק, ח.פ, איש קשר, טלפון, אימייל, כתובת, תנאי תשלום" },
  { kind: "items", title: "2. פריטים", note: "מקט, שם פריט, תיאור, יחידה, קטגוריה, ברקוד" },
  { kind: "supplier_items", title: "3. שיוך פריט לספק", note: "קוד ספק, מקט, מקט ספק, מחיר, זמן אספקה" },
];

export default async function Import({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h2>יבוא נתונים מ-ERP</h2>
      <p className="muted">קובץ CSV (אפשר לשמור מ-Excel כ-CSV UTF-8). רשומה קיימת מתעדכנת לפי קוד ספק או מק"ט, רשומה חדשה נוספת.
        מומלץ לייבא בסדר: ספקים, פריטים, שיוך.</p>
      <Msg sp={sp} />
      {KINDS.map((k) => (
        <form key={k.kind} action={importCsv} className="card">
          <input type="hidden" name="kind" value={k.kind} />
          <h3 style={{ marginTop: 0 }}>{k.title}</h3>
          <p className="muted">עמודות: {k.note} · <a href={`/api/template/${k.kind}`}>הורדת קובץ דוגמה</a></p>
          <div className="toolbar"><input type="file" name="file" accept=".csv,text/csv" required /><button>יבוא</button></div>
        </form>
      ))}
      <form action={uploadImages} className="card">
        <h3 style={{ marginTop: 0 }}>4. תמונות לפי מק"ט</h3>
        <p className="muted">בוחרים כמה תמונות בבת אחת. שם כל קובץ הוא המק"ט, למשל <span className="ltr">10001.jpg</span>.</p>
        <div className="toolbar"><input type="file" name="files" accept="image/*" multiple required /><button>העלאה</button></div>
      </form>
    </>
  );
}
