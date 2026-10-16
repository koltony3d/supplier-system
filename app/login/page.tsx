import { login } from "@/app/auth-actions";
import Msg from "@/components/Msg";

export default async function Login({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <form action={login} className="card" style={{ width: 340, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>מערכת הזמנות ספק</h2>
        <span className="badge manual" style={{ justifySelf: "start" }}>סביבת טסט</span>
        <Msg sp={sp} />
        <label>שם משתמש<input name="username" autoComplete="username" required autoFocus /></label>
        <label>סיסמה<input name="password" type="password" autoComplete="current-password" required /></label>
        <button>כניסה</button>
      </form>
    </div>
  );
}
