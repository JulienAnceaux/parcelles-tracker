import { requireAuth } from "./_lib/auth.mjs";

const CADASTRE_API = "https://apicarto.ign.fr/api/cadastre/parcelle";
const URBANISME_API = "https://apicarto.ign.fr/api/gpu/zone-urba";

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

async function fetchParcelGeometry(parts) {
  const params = new URLSearchParams({
    code_insee: parts.codeInsee,
    section: parts.section,
    numero: parts.numero,
    source_ign: "PCI"
  });
  if (parts.communeAbsorbee !== "000") params.set("com_abs", parts.communeAbsorbee);

  const response = await fetch(`${CADASTRE_API}?${params}`, {
    headers: { Accept: "application/geo+json, application/json" }
  });
  if (!response.ok) throw new Error(`IGN cadastre ${response.status}`);
  const collection = await response.json();
  return collection.features?.[0]?.geometry || null;
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée." });

  const parts = parcelParts(req.query.parcelle);
  if (!parts) return res.status(400).json({ error: "Référence cadastrale invalide." });

  try {
    const geometry = await fetchParcelGeometry(parts);
    if (!geometry) return res.status(404).json({ error: "Emprise cadastrale introuvable." });

    const params = new URLSearchParams({ geom: JSON.stringify(geometry) });
    const response = await fetch(`${URBANISME_API}?${params}`, {
      headers: { Accept: "application/geo+json, application/json" }
    });
    if (!response.ok) throw new Error(`IGN urbanisme ${response.status}`);

    const collection = await response.json();
    const zones = (collection.features || []).map(({ properties = {} }) => ({
      libelle: properties.libelle || "",
      libelleLong: properties.libelong || properties.libelle_long || "",
      type: properties.typezone || "",
      documentId: properties.idurba || "",
      documentFichier: properties.nomfic || "",
      statut: properties.gpu_status || "",
      dateMiseAJour: properties.gpu_timestamp || ""
    }));

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ parcelle: parts.parcel, zones });
  } catch (error) {
    console.error("urbanisme_fetch_failed", error);
    return res.status(502).json({ error: "Le service d’urbanisme de l’IGN est momentanément indisponible." });
  }
}
