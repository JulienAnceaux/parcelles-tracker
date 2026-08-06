import crypto from "node:crypto";

const COOKIE_NAME = "parcelles_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secret() {
  const value = process.env.APP_SESSION_SECRET;
  if (!value || value.length < 24) {
    throw new Error("APP_SESSION_SECRET doit contenir au moins 24 caractères.");
  }
  return value;
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionCookie() {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const value = `${expires}.${sign(String(expires))}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isAuthenticated(req) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
  );
  const session = cookies[COOKIE_NAME];
  if (!session) return false;
  const [expires, signature] = session.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  return safeEqual(signature, sign(expires));
}

export function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: "Session expirée. Reconnectez-vous." });
  return false;
}

export function passwordMatches(candidate) {
  const expected = process.env.APP_PASSWORD || process.env.PASSWORD;
  return Boolean(expected) && safeEqual(candidate, expected);
}
