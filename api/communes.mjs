import { requireAuth } from "./_lib/auth.mjs";

const API = "https://geo.api.gouv.fr/communes";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const query = String(req.query?.q || "").trim();
  if (query.length < 2 || query.length > 80) {
    return res.status(400).json({ error: "Saisissez au moins deux caractères." });
  }

  const url = new URL(API);
  url.searchParams.set("nom", query);
  url.searchParams.set("fields", "nom,code,codeDepartement,departement,population");
  url.searchParams.set("boost", "population");
  url.searchParams.set("limit", "8");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ParcellesTracker/0.1" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`API Communes ${response.status}`);
    const rows = await response.json();
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      results: rows.map((row) => ({
        nom: row.nom,
        code: row.code,
        departement: row.departement?.nom || row.codeDepartement || "",
        population: row.population || null
      }))
    });
  } catch {
    return res.status(502).json({ error: "Le référentiel des communes est temporairement indisponible." });
  }
}
