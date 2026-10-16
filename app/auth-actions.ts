"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { checkPassword, hashPassword, requirePermission, ROLE_LABEL, type Role } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg: string, err = false) =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);

export async function login(f: FormData) {
  const [u] = await query<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE lower(username)=lower($1) AND active", [s(f, "username")]);
  if (!u || !checkPassword(String(f.get("password") ?? ""), u.password_hash)) back("/login", "שם משתמש או סיסמה שגויים", true);
  const { token, maxAge } = createSessionToken(u.id);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && !process.env.INSECURE_COOKIES, maxAge, path: "/" });
  await query("UPDATE users SET last_login_at=now() WHERE id=$1", [u.id]);
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

const isRole = (r: string): r is Role => r in ROLE_LABEL;

export async function saveUser(f: FormData) {
  const me = await requirePermission("users.manage");
  const id = s(f, "id");
  const role = s(f, "role");
  if (!isRole(role)) back("/users", "תפקיד לא תקין", true);
  const password = String(f.get("password") ?? "");
  if (id) {
    if (Number(id) === me.id && role !== "admin") back("/users", "אי אפשר להוריד לעצמך את הרשאת המנהל", true);
    await query("UPDATE users SET full_name=$1, role=$2 WHERE id=$3", [s(f, "full_name"), role, id]);
    if (password) {
      if (password.length < 8) back("/users", "סיסמה חייבת להיות לפחות 8 תווים", true);
      await query("UPDATE users SET password_hash=$1 WHERE id=$2", [hashPassword(password), id]);
    }
    revalidatePath("/users");
    back("/users", "המשתמש עודכן");
  }
  if (!s(f, "username") || !s(f, "full_name")) back("/users", "חובה למלא שם משתמש ושם מלא", true);
  if (password.length < 8) back("/users", "סיסמה חייבת להיות לפחות 8 תווים", true);
  try {
    await query("INSERT INTO users (username, full_name, role, password_hash) VALUES ($1,$2,$3,$4)",
      [s(f, "username"), s(f, "full_name"), role, hashPassword(password)]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") back("/users", "שם המשתמש כבר קיים", true);
    throw e;
  }
  revalidatePath("/users");
  back("/users", "המשתמש נוסף");
}

export async function setUserActive(f: FormData) {
  const me = await requirePermission("users.manage");
  const id = Number(s(f, "id"));
  if (id === me.id) back("/users", "אי אפשר להשבית את עצמך", true);
  await query("UPDATE users SET active=$1 WHERE id=$2", [s(f, "active") === "1", id]);
  revalidatePath("/users");
  back("/users", s(f, "active") === "1" ? "המשתמש הופעל" : "המשתמש הושבת");
}
