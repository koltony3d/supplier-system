import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export type Role = "admin" | "purchasing" | "warehouse" | "viewer";
export type User = { id: number; username: string; full_name: string; role: Role };

export const ROLE_LABEL: Record<Role, string> = {
  admin: "מנהל", purchasing: "רכש", warehouse: "מחסן", viewer: "צפייה בלבד",
};

// מי רשאי לבצע מה. צפייה מותרת לכל משתמש מחובר.
export const PERMISSIONS = {
  "master.edit": ["admin", "purchasing"],          // ספקים, פריטים, יבוא, תמונות, מק"ט ספק
  "quotes.edit": ["admin", "purchasing"],
  "orders.edit": ["admin", "purchasing"],
  "receiving.edit": ["admin", "warehouse"],
  "discrepancies.resolve": ["admin", "purchasing"],
  "users.manage": ["admin"],
} satisfies Record<string, Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_LABEL: Record<Permission, string> = {
  "master.edit": "נתוני בסיס ויבוא", "quotes.edit": "הצעות מחיר", "orders.edit": "הזמנות",
  "receiving.edit": "קבלת סחורה", "discrepancies.resolve": "טיפול באי התאמות", "users.manage": "ניהול משתמשים",
};

export const allowed = (user: User | null, perm: Permission) =>
  !!user && (PERMISSIONS[perm] as readonly Role[]).includes(user.role);

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function currentUser(): Promise<User | null> {
  const uid = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  const [u] = await query<User>("SELECT id, username, full_name, role FROM users WHERE id=$1 AND active", [uid]);
  return u ?? null;
}

// לשימוש בתחילת כל פעולה שמשנה נתונים
export async function requirePermission(perm: Permission) {
  const user = await currentUser();
  const ref = (await headers()).get("referer");
  let returnTo = "/";
  try { if (ref) { const u = new URL(ref); u.searchParams.delete("msg"); u.searchParams.delete("err"); returnTo = u.pathname + u.search; } } catch {}
  if (!user) redirect("/login");
  if (!allowed(user, perm))
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}err=${encodeURIComponent(`אין לך הרשאה: ${PERMISSION_LABEL[perm]}`)}`);
  return user;
}
