const TEMPLATES: Record<string, string> = {
  suppliers: "קוד ספק,שם ספק,ח.פ,איש קשר,טלפון,אימייל,כתובת,תנאי תשלום\nS2001,ספק לדוגמה בע\"מ,515000000,ישראל ישראלי,03-1234567,info@example.com,רחוב 1 תל אביב,שוטף+30\n",
  items: "מקט,שם פריט,תיאור,יחידה,קטגוריה,ברקוד\n20001,פריט לדוגמה,תיאור קצר,יח',כללי,7290000000000\n",
  supplier_items: "קוד ספק,מקט,מקט ספק,מחיר,זמן אספקה\nS2001,20001,SUP-20001,12.50,7\n",
};

export async function GET(_: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const body = TEMPLATES[kind];
  if (!body) return new Response("not found", { status: 404 });
  return new Response("﻿" + body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-template.csv"` },
  });
}
