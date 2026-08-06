import { createSessionCookie, passwordMatches } from "./_lib/auth.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  const password = String(req.body?.password || "");
  if (!passwordMatches(password)) {
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }
  res.setHeader("Set-Cookie", createSessionCookie());
  return res.status(200).json({ ok: true });
}
