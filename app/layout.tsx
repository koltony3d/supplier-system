import "./globals.css";
import Link from "next/link";
import { allowed, currentUser, ROLE_LABEL } from "@/lib/auth";
import { logout } from "@/app/auth-actions";

export const metadata = { title: "מערכת הזמנות ספק" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="he" dir="rtl">
      <body>
        {!user ? children : (
          <div className="shell">
            <aside className="side">
              <h1>מערכת הזמנות ספק</h1>
              <span className="env">סביבת טסט</span>
              <nav>
                <Link href="/">ראשי</Link>
                <div className="group">נתוני בסיס</div>
                <Link href="/suppliers">ספקים</Link>
                <Link href="/items">פריטים</Link>
                <Link href="/sku-match">התאמת מק"ט ספק</Link>
                {allowed(user, "master.edit") && <Link href="/import">יבוא מ-ERP</Link>}
                <div className="group">רכש</div>
                <Link href="/quotes">הצעות מחיר</Link>
                <Link href="/orders">הזמנות</Link>
                <div className="group">מחסן</div>
                <Link href="/receiving">קבלת סחורה</Link>
                <Link href="/discrepancies">אי התאמות</Link>
                {allowed(user, "users.manage") && <><div className="group">ניהול</div><Link href="/users">משתמשים והרשאות</Link></>}
              </nav>
              <div className="me">
                <div>{user.full_name}</div>
                <div className="muted-side">{ROLE_LABEL[user.role]}</div>
                <form action={logout}><button className="link-btn">יציאה</button></form>
              </div>
            </aside>
            <main>{children}</main>
          </div>
        )}
      </body>
    </html>
  );
}
