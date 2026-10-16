import { createHmac, timingSafeEqual } from "node:crypto";

// עוגיית התחברות חתומה. לא תלויה במסד הנתונים, כדי שגם ה-proxy יוכל לבדוק אותה.
export const SESSION_COOKIE = "sps_session";
const MAX_AGE_SEC = 60 * 60 * 12;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_SECRET !== "1")
    throw new Error("SESSION_SECRET is not set");
  return s ?? "dev-only-secret-change-me";
}

const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function createSessionToken(userId: number) {
  const data = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC })).toString("base64url");
  return { token: `${data}.${sign(data)}`, maxAge: MAX_AGE_SEC };
}

export function verifySessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(data, "base64url").toString());
    return exp > Date.now() / 1000 ? Number(uid) : null;
  } catch {
    return null;
  }
}
