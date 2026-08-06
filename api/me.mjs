import { isAuthenticated } from "./_lib/auth.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Cookie");
  return res.status(200).json({ authenticated: isAuthenticated(req) });
}
