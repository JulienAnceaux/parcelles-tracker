import { requireAuth } from "./_lib/auth.mjs";

const API = "https://opendata.koumoul.com/data-fair/api/v1/datasets/parcelles-des-personnes-morales/lines";
const PAGE_SIZE = 500;
const MAX_ROWS = 10000;
const SELECT = [
  "_id",
  "code_commune",
  "nom_commune",
  "adresse",
  "code_parcelle",
  "contenance_parcelle",
  "nature_culture",
  "contenance_suf",
  "code_droit",
  "denomination",
  "numero_siren",
  "code_forme_juridique",
  "forme_juridique_abregee",
  "groupe_personne",
  "_geopoint"
].join(",");

const PUBLIC_GROUP_LABELS = {
  "1": "État",
  "2": "Région",
  "3": "Département",
  "4": "Commune",
  "5": "Organisme HLM",
  "6": "Société d’économie mixte",
  "7": "Copropriétaires",
  "8": "Associés",
  "9": "Établissement public"
};

const PUBLIC_NAME_PATTERNS = [
  /\bSOCIETE PUBLIQUE LOCALE\b/,
  /\bETABLISSEMENT PUBLIC\b/,
  /\bOFFICE PUBLIC\b/,
  /\bCENTRE HOSPITALIER\b/,
  /\bCAISSE DES DEPOTS\b/,
  /\bCOMMUNE DE\b/,
  /\bDEPARTEMENT (DU|DE LA|DES|D')\b/,
  /\bREGION (DE|DU|DES|D')\b/,
  /\bMETROPOLE\b/,
  /\bCOMMUNAUTE D[' ]AGGLOMERATION\b/,
  /\bCOMMUNAUTE DE COMMUNES\b/,
  /\bSYNDICAT (MIXTE|INTERCOMMUNAL)\b/,
  /\bSNCF\b/,
  /\bRATP\b/
];

function values(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("fr-FR");
}

function holderQualification(row) {
  const name = normalizedText(row.denomination);
  const legalForm = normalizedText(row.forme_juridique_abregee);
  const group = String(row.groupe_personne ?? "");
  const siren = String(row.numero_siren || "").trim();
  const sirenValide = /^\d{9}$/.test(siren);

  if (PUBLIC_GROUP_LABELS[group] || legalForm === "AUDP" || legalForm === "SEM" || PUBLIC_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return {
      typeTitulaire: PUBLIC_GROUP_LABELS[group] || "Public / parapublic probable",
      segmentTitulaire: "public",
      estPriveProbable: false,
      sirenValide
    };
  }

  if (legalForm.startsWith("ASS") || /\bASSOCIATION\b/.test(name)) {
    return {
      typeTitulaire: "Association",
      segmentTitulaire: "association",
      estPriveProbable: false,
      sirenValide
    };
  }

  if (/\bSCCV\b/.test(name) || /CONSTRUCTION.?VENTE/.test(name)) {
    return { typeTitulaire: "SCCV", segmentTitulaire: "immobilier", estPriveProbable: true, sirenValide };
  }

  if (legalForm === "SCI" || legalForm === "SC" || /\bSCI\b/.test(name)) {
    return { typeTitulaire: "SCI", segmentTitulaire: "immobilier", estPriveProbable: true, sirenValide };
  }

  if (/\b(AMENAGEMENT|IMMOBILIER|PROMOTION|FONCIERE|HABITAT)\b/.test(name)) {
    return {
      typeTitulaire: "Professionnel immobilier probable",
      segmentTitulaire: "immobilier",
      estPriveProbable: true,
      sirenValide
    };
  }

  return {
    typeTitulaire: "Entreprise / autre personne morale",
    segmentTitulaire: "entreprise",
    // Public/parapublic et associations sont déjà exclus par les branches ci-dessus,
    // donc tout le reste (SAS, SARL, SNC, SA, sociétés civiles...) est considéré privé.
    estPriveProbable: true,
    sirenValide
  };
}

// TODO Julien : compléter avec les SIREN des grands acteurs institutionnels à exclure
// manuellement (bailleurs sociaux, aménageurs publics, grandes foncières nationales)
// qui échapperaient à la détection automatique ci-dessus.
const EXCLUDED_SIRENS = new Set([]);

function targetCategory(natures) {
  if (natures.includes("AB")) return { rank: 1, code: "AB", label: "Terrain à bâtir (cadastre)" };
  if (natures.includes("J")) return { rank: 2, code: "J", label: "Jardin" };
  if (natures.includes("AG")) return { rank: 3, code: "AG", label: "Terrain d’agrément" };
  if (natures.some((code) => ["T", "TP", "P", "PA", "PC", "PE", "PH", "PP"].includes(code))) {
    return { rank: 4, code: "AGRICOLE", label: "Terre ou pré" };
  }
  if (natures.some((code) => ["B", "BF", "BM", "BO", "BP", "BR", "BS", "BT", "LB"].includes(code))) {
    return { rank: 5, code: "BOISE", label: "Parcelle boisée" };
  }
  return { rank: 6, code: "AUTRE", label: "Autre nature cadastrale" };
}

function normalize(row) {
  const natures = values(row.nature_culture);
  const rights = values(row.code_droit);
  const category = targetCategory(natures);
  const qualification = holderQualification(row);
  return {
    id: row._id || row.code_parcelle,
    codeCommune: String(row.code_commune || ""),
    commune: row.nom_commune || "",
    adresse: row.adresse || "",
    codeParcelle: row.code_parcelle || "",
    surface: Number(row.contenance_parcelle || 0),
    natures,
    contenancesSuf: values(row.contenance_suf).map(Number),
    categorieCode: category.code,
    categorie: category.label,
    categorieRank: category.rank,
    droits: rights,
    estProprietaire: rights.includes("P"),
    // "S" = Sol (nomenclature cadastrale) : emprise déjà occupée par une construction.
    // Peut cohabiter avec d'autres codes (ex: AB) sur des parcelles mixtes — on l'expose
    // séparément plutôt que de l'exclure silencieusement, pour que l'UI puisse avertir.
    estBati: natures.includes("S"),
    denomination: row.denomination || "",
    siren: String(row.numero_siren || ""),
    formeJuridique: row.forme_juridique_abregee || "",
    codeFormeJuridique: row.code_forme_juridique || "",
    groupePersonne: String(row.groupe_personne ?? ""),
    geopoint: row._geopoint || null,
    ...qualification
  };
}

function mergeUnique(left = [], right = []) {
  return [...new Set([...left, ...right])];
}

function deduplicate(rows) {
  const unique = new Map();

  for (const row of rows) {
    const ownerKey = row.siren || row.denomination.toLocaleLowerCase("fr-FR");
    const key = `${row.codeParcelle}|${ownerKey}`;
    const existing = unique.get(key);

    if (!existing) {
      unique.set(key, row);
      continue;
    }

    existing.natures = mergeUnique(existing.natures, row.natures);
    existing.contenancesSuf = mergeUnique(existing.contenancesSuf, row.contenancesSuf);
    existing.droits = mergeUnique(existing.droits, row.droits);
    existing.estProprietaire = existing.estProprietaire || row.estProprietaire;
    existing.estBati = existing.estBati || row.estBati;
  }

  return [...unique.values()];
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const code = String(req.query?.code || "").trim();
  if (!/^\d{5}$/.test(code)) {
    return res.status(400).json({ error: "Code INSEE de commune invalide." });
  }

  try {
    const all = [];
    let total = 0;
    for (let page = 1; all.length < MAX_ROWS; page += 1) {
      const url = new URL(API);
      url.searchParams.set("size", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));
      url.searchParams.set("qs", `code_commune:"${code}"`);
      url.searchParams.set("select", SELECT);

      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "ParcellesTracker/0.1" },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`API Koumoul ${response.status}`);
      const payload = await response.json();
      const batch = payload.results || [];
      total = Number(payload.total || 0);
      all.push(...batch);
      if (!batch.length || all.length >= total) break;
    }

    const normalized = deduplicate(all.map(normalize).filter((row) => !EXCLUDED_SIRENS.has(row.siren)));
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({
      total,
      truncated: all.length < total,
      fetched: normalized.length,
      sourceRows: all.length,
      duplicatesRemoved: all.length - normalized.length,
      results: normalized,
      sourceUpdatedAt: "2026-07-20",
      disclaimer: "Une nature cadastrale ne prouve pas la constructibilité. Vérifier le PLU/PLUi et les servitudes."
    });
  } catch (error) {
    console.error("Koumoul search failed", error instanceof Error ? error.message : error);
    return res.status(502).json({ error: "La source cadastrale est temporairement indisponible." });
  }
}
