import { requireAuth } from "./_lib/auth.mjs";

const API = "https://apicarto.ign.fr/api/cadastre/parcelle";

function parcelParts(value) {
  const parcel = String(value || "").trim().toUpperCase();
  if (!/^\d{5}[0-9A-Z]{3}[0-9A-Z]{2}\d{4}$/.test(parcel)) return null;
  return {
    parcel,
    codeInsee: parcel.slice(0, 5),
    communeAbsorbee: parcel.slice(5, 8),
    section: parcel.slice(8, 10),
    numero: parcel.slice(10, 14)
  };
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée." });

  const parts = parcelParts(req.query.parcelle);
  if (!parts) return res.status(400).json({ error: "Référence cadastrale invalide." });

  const params = new URLSearchParams({
    code_insee: parts.codeInsee,
    section: parts.section,
    numero: parts.numero,
    source_ign: "PCI"
  });
  if (parts.communeAbsorbee !== "000") params.set("com_abs", parts.communeAbsorbee);

  try {
    const response = await fetch(`${API}?${params}`, {
      headers: { Accept: "application/geo+json, application/json" }
    });
    if (!response.ok) throw new Error(`IGN ${response.status}`);

    const collection = await response.json();
    const feature = Array.isArray(collection.features) ? collection.features[0] : null;
    if (!feature?.geometry) {
      return res.status(404).json({ error: "Emprise cadastrale introuvable dans le PCI." });
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      parcelle: parts.parcel,
      geometry: feature.geometry,
      properties: feature.properties || {}
    });
  } catch (error) {
    console.error("cadastre_fetch_failed", error);
    return res.status(502).json({ error: "Le service cadastral de l’IGN est momentanément indisponible." });
  }
}
