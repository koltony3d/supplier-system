import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { allowed, currentUser, PERMISSIONS, PERMISSION_LABEL, ROLE_LABEL, type Permission, type Role } from "@/lib/auth";
import { saveUser, setUserActive } from "@/app/auth-actions";
import Msg from "@/components/Msg";

export const dynamic = "force-dynamic";

// דרישה 24: הרשאות למשתמשים לפי תפקיד
export default async function Users({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const me = await currentUser();
  if (!allowed(me, "users.manage")) redirect("/?err=" + encodeURIComponent("אין לך הרשאה: ניהול משתמשים"));
  const sp = await searchParams;
  const users = await query<{ id: number; username: string; full_name: string; role: Role; active: boolean; last_login_at: Date | null }>(
    "SELECT id, username, full_name, role, active, last_login_at FROM users ORDER BY active DESC, full_name");
  const roles = Object.keys(ROLE_LABEL) as Role[];
  const roleSelect = (value?: Role) => (
    <select name="role" defaultValue={value ?? "viewer"}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
  );
  return (
    <>
      <h2>משתמשים והרשאות</h2>
      <Msg sp={sp} />
      <h3>מה כל תפקיד מורשה לעשות</h3>
      <table>
        <thead><tr><th>פעולה</th>{roles.map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
        <tbody>
          <tr><td>צפייה בכל המסכים</td>{roles.map((r) => <td key={r}>✓</td>)}</tr>
          {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
            <tr key={p}><td>{PERMISSION_LABEL[p]}</td>
              {roles.map((r) => <td key={r}>{(PERMISSIONS[p] as readonly Role[]).includes(r) ? "✓" : <span className="muted">-</span>}</td>)}</tr>))}
        </tbody>
      </table>
      <h3>משתמשים</h3>
      <table>
        <thead><tr><th>שם משתמש</th><th>שם מלא</th><th>תפקיד</th><th>סיסמה חדשה</th><th></th><th>כניסה אחרונה</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.active ? "" : "inactive"}>
              <td className="ltr">{u.username}</td>
              <td colSpan={4}>
                <form action={saveUser} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="id" value={u.id} />
                  <input name="full_name" defaultValue={u.full_name} />{roleSelect(u.role)}
                  <input name="password" type="password" placeholder="ללא שינוי" autoComplete="new-password" />
                  <button className="secondary">שמירה</button>
                </form>
              </td>
              <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString("he-IL") : <span className="muted">לא נכנס</span>}</td>
              <td>{u.id !== me!.id && <form action={setUserActive} className="inline">
                <input type="hidden" name="id" value={u.id} /><input type="hidden" name="active" value={u.active ? "0" : "1"} />
                <button className={u.active ? "danger" : "secondary"}>{u.active ? "השבתה" : "הפעלה"}</button></form>}</td>
            </tr>))}
        </tbody>
      </table>
      <h3>הוספת משתמש</h3>
      <form action={saveUser} className="card form-grid">
        <label>שם משתמש *<input name="username" required autoComplete="off" /></label>
        <label>שם מלא *<input name="full_name" required /></label>
        <label>תפקיד{roleSelect()}</label>
        <label>סיסמה (8 תווים לפחות) *<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
        <button>הוספה</button>
      </form>
    </>
  );
}
