const TRACKING_KEY = "parcelles-tracker:tracking:v1";
const STATUTS = [
  { value: "a_etudier", label: "À étudier" },
  { value: "contacte", label: "Contacté" },
  { value: "rdv", label: "RDV pris" },
  { value: "sans_interet", label: "Sans intérêt" },
  { value: "mandat", label: "Mandat signé" }
];
const PROSPECTION_NATURES = ["AB", "J", "AG"];

function loadTracking() {
  try {
    return JSON.parse(localStorage.getItem(TRACKING_KEY) || "{}");
  } catch {
    return {};
  }
}

const state = {
  rows: [],
  visibleRows: [],
  selectedCommune: null,
  suggestionTimer: null,
  tracking: loadTracking()
};

const $ = (selector) => document.querySelector(selector);

function trackingKey(row) {
  return `${row.codeCommune || state.selectedCommune?.code || ""}|${row.id}`;
}

function getTrackingEntry(row) {
  return state.tracking[trackingKey(row)] || { statut: "a_etudier", notes: "", updatedAt: null };
}

function saveTrackingEntry(row, patch) {
  const key = trackingKey(row);
  state.tracking[key] = { ...getTrackingEntry(row), ...patch, updatedAt: Date.now() };
  localStorage.setItem(TRACKING_KEY, JSON.stringify(state.tracking));
}

function priorityInfo(row) {
  if (row.typeTitulaire === "SCCV") return { stars: "★★★", label: "SCCV", cls: "priority-sccv" };
  if (row.typeTitulaire === "SCI") return { stars: "★★", label: "SCI", cls: "priority-sci" };
  return { stars: "★", label: "Autre", cls: "priority-autre" };
}

function priorityRank(row) {
  if (row.typeTitulaire === "SCCV") return 0;
  if (row.typeTitulaire === "SCI") return 1;
  return 2;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Une erreur est survenue.");
  return payload;
}

async function boot() {
  const session = await request("/api/me");
  $("#login").hidden = session.authenticated;
  $("#app").hidden = !session.authenticated;
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  try {
    await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#password").value })
    });
    await boot();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await request("/api/logout", { method: "POST" });
  location.reload();
});

$("#commune").addEventListener("input", () => {
  clearTimeout(state.suggestionTimer);
  const query = $("#commune").value.trim();
  if (query.length < 2) {
    $("#suggestions").hidden = true;
    return;
  }
  state.suggestionTimer = setTimeout(() => loadSuggestions(query), 250);
});

async function loadSuggestions(query) {
  try {
    const data = await request(`/api/communes?q=${encodeURIComponent(query)}`);
    const box = $("#suggestions");
    box.innerHTML = "";
    data.results.forEach((commune) => {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<span>${escapeHtml(commune.nom)} <small>(${escapeHtml(commune.code)})</small></span><small>${escapeHtml(commune.departement)}</small>`;
      button.addEventListener("click", () => selectCommune(commune));
      box.appendChild(button);
    });
    box.hidden = !data.results.length;
  } catch {
    $("#suggestions").hidden = true;
  }
}

async function selectCommune(commune) {
  state.selectedCommune = commune;
  $("#commune").value = `${commune.nom} (${commune.code})`;
  $("#suggestions").hidden = true;
  $("#empty").hidden = true;
  $("#workspace").hidden = false;
  $("#workspace").classList.add("loading");
  $("#status").textContent = "Chargement et qualification des parcelles…";
  try {
    const data = await request(`/api/parcelles?code=${encodeURIComponent(commune.code)}`);
    state.rows = data.results;
    $("#metric-commune").textContent = commune.nom;
    $("#metric-loaded").textContent = data.fetched.toLocaleString("fr-FR");
    $("#metric-truncated").textContent = data.truncated ? "Oui" : "Non";
    applyFilters();
    const duplicateNote = data.duplicatesRemoved
      ? ` ${data.duplicatesRemoved.toLocaleString("fr-FR")} doublons techniques supprimés.`
      : "";
    $("#status").textContent = `${data.fetched.toLocaleString("fr-FR")} parcelles/titulaires uniques chargés.${duplicateNote} Source actualisée le ${new Date(data.sourceUpdatedAt).toLocaleDateString("fr-FR")}.`;
  } catch (error) {
    state.rows = [];
    render([]);
    $("#status").textContent = error.message;
  } finally {
    $("#workspace").classList.remove("loading");
  }
}

function applyFilters() {
  const query = $("#text-filter").value.trim().toLowerCase();
  const nature = $("#nature-filter").value;
  const owner = $("#owner-filter").value;
  const statut = $("#statut-filter").value;
  const minSurface = Number($("#surface-filter").value || 0);
  const rows = state.rows
    .filter((row) => row.surface >= minSurface)
    .filter((row) => {
      if (nature === "PROSPECTION") return PROSPECTION_NATURES.includes(row.categorieCode);
      return !nature || row.categorieCode === nature;
    })
    .filter((row) => {
      if (owner === "all") return true;
      if (owner === "private") return row.estPriveProbable;
      return row.segmentTitulaire === owner;
    })
    .filter((row) => !$("#owner-only-filter").checked || row.estProprietaire)
    .filter((row) => !statut || getTrackingEntry(row).statut === statut)
    .filter((row) => {
      if (!query) return true;
      return [row.denomination, row.adresse, row.siren, row.codeParcelle]
        .some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((a, b) => priorityRank(a) - priorityRank(b) || a.categorieRank - b.categorieRank || b.surface - a.surface);
  render(rows);
}

["#text-filter", "#nature-filter", "#owner-filter", "#surface-filter", "#statut-filter"].forEach((selector) => {
  $(selector).addEventListener("input", applyFilters);
});
$("#owner-only-filter").addEventListener("change", applyFilters);

function render(rows) {
  state.visibleRows = rows;
  $("#metric-filtered").textContent = rows.length.toLocaleString("fr-FR");
  const tbody = $("#rows");
  tbody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    const priority = priorityInfo(row);
    const tracking = getTrackingEntry(row);
    const statutLabel = STATUTS.find((item) => item.value === tracking.statut)?.label || "À étudier";
    tr.innerHTML = `
      <td><span class="priority-badge ${priority.cls}" title="${escapeHtml(priority.label)}">${priority.stars}</span></td>
      <td><span class="badge">${escapeHtml(row.categorie)}</span>${row.estBati ? ' <span class="bati-badge" title="Emprise déjà occupée par une construction (code cadastral S)">⚠ Déjà bâti</span>' : ""}</td>
      <td>${escapeHtml(titleCase(row.adresse) || "—")}</td>
      <td>${escapeHtml(row.codeParcelle || "—")}</td>
      <td>${Number(row.surface).toLocaleString("fr-FR")} m²</td>
      <td><strong>${escapeHtml(row.denomination || "—")}</strong><br><span class="muted">${escapeHtml(row.siren || "")}</span></td>
      <td><span class="holder-type holder-${escapeHtml(row.segmentTitulaire)}">${escapeHtml(row.typeTitulaire)}</span></td>
      <td>${escapeHtml(row.formeJuridique || "—")}</td>
      <td>${row.estProprietaire ? "Propriétaire déclaré" : escapeHtml(row.droits.join(", ") || "—")}</td>
      <td><span class="statut-badge statut-${escapeHtml(tracking.statut)}">${escapeHtml(statutLabel)}</span></td>
      <td class="row-actions">
        ${row.sirenValide ? `<a class="pappers" href="https://www.pappers.fr/entreprise/${encodeURIComponent(row.siren)}" target="_blank" rel="noopener noreferrer">Pappers ↗</a>` : ""}
        <button type="button" class="details-button" data-detail-id="${escapeHtml(row.id)}">Détails</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

$("#export").addEventListener("click", () => {
  const headers = ["commune", "adresse", "parcelle", "surface_m2", "categorie_cadastrale", "titulaire", "type_titulaire", "siren", "siren_valide", "forme_juridique", "priorite", "statut", "notes"];
  const lines = [headers, ...state.visibleRows.map((row) => {
    const tracking = getTrackingEntry(row);
    const statutLabel = STATUTS.find((item) => item.value === tracking.statut)?.label || "À étudier";
    return [
      state.selectedCommune?.nom || row.commune || "",
      titleCase(row.adresse),
      row.codeParcelle,
      row.surface,
      row.categorie,
      row.denomination,
      row.typeTitulaire,
      row.siren,
      row.sirenValide ? "oui" : "non",
      row.formeJuridique,
      priorityInfo(row).label,
      statutLabel,
      tracking.notes || ""
    ];
  })];
  const csv = lines.map((line) => line.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `parcelles_${state.selectedCommune?.code || "export"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

$("#rows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-detail-id]");
  if (!button) return;
  const row = state.rows.find((item) => item.id === button.dataset.detailId);
  if (row) openParcelDetail(row);
});

async function openParcelDetail(row) {
  $("#detail-title").textContent = row.codeParcelle || "Parcelle";
  $("#detail-commune").textContent = row.commune || state.selectedCommune?.nom || "—";
  $("#detail-parcelle").textContent = row.codeParcelle || "—";
  $("#detail-adresse").textContent = titleCase(row.adresse) || "—";
  $("#detail-surface").textContent = `${Number(row.surface).toLocaleString("fr-FR")} m²`;
  $("#detail-categorie").textContent = row.categorie || "—";
  $("#detail-bati-warning").hidden = !row.estBati;
  $("#detail-titulaire").textContent = row.denomination || "—";
  $("#detail-type").textContent = row.typeTitulaire || "—";
  $("#detail-siren").textContent = row.siren
    ? `${row.siren}${row.sirenValide ? "" : " (identifiant non reconnu comme SIREN)"}`
    : "—";

  const pappers = $("#detail-pappers");
  pappers.hidden = !row.sirenValide;
  if (row.sirenValide) pappers.href = `https://www.pappers.fr/entreprise/${encodeURIComponent(row.siren)}`;

  const point = parseGeopoint(row.geopoint);
  const osm = $("#detail-osm");
  osm.hidden = !point;
  const copyParcel = $("#detail-copy-parcel");
  copyParcel.textContent = "Copier la référence cadastrale";
  copyParcel.onclick = async () => {
    await navigator.clipboard.writeText(row.codeParcelle || "");
    copyParcel.textContent = "Référence copiée";
  };

  if (point) {
    const [lat, lon] = point;
    osm.href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=18/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
    $("#detail-urbanisme").href = `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&zoom=18`;
  } else {
    osm.hidden = true;
    $("#detail-urbanisme").href = "https://www.geoportail-urbanisme.gouv.fr/map/";
  }

  const tracking = getTrackingEntry(row);
  $("#tracking-statut").value = tracking.statut;
  $("#tracking-notes").value = tracking.notes || "";
  $("#tracking-updated").textContent = tracking.updatedAt
    ? `Mis à jour le ${new Date(tracking.updatedAt).toLocaleString("fr-FR")}`
    : "Jamais mis à jour";

  $("#tracking-statut").onchange = () => {
    saveTrackingEntry(row, { statut: $("#tracking-statut").value });
    $("#tracking-updated").textContent = `Mis à jour le ${new Date().toLocaleString("fr-FR")}`;
    applyFilters();
  };
  $("#tracking-notes").onblur = () => {
    saveTrackingEntry(row, { notes: $("#tracking-notes").value });
    $("#tracking-updated").textContent = `Mis à jour le ${new Date().toLocaleString("fr-FR")}`;
  };

  $("#parcel-dialog").showModal();
  await Promise.all([
    loadParcelShape(row.codeParcelle),
    loadUrbanisme(row.codeParcelle)
  ]);
}

async function loadParcelShape(parcelCode) {
  const svg = $("#detail-parcel-svg");
  const status = $("#detail-map-status");
  svg.hidden = true;
  svg.replaceChildren();
  status.hidden = false;
  status.textContent = "Chargement de la parcelle…";

  try {
    const response = await fetch(`/api/cadastre?parcelle=${encodeURIComponent(parcelCode)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Emprise indisponible.");
    renderParcelGeometry(svg, data.geometry);
    status.hidden = true;
    svg.hidden = false;
  } catch (error) {
    status.textContent = error.message || "Emprise cadastrale indisponible.";
  }
}

function renderParcelGeometry(svg, geometry) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
  const points = [];
  const collectPoints = (value) => {
    if (Array.isArray(value) && value.length >= 2 && value.every((item) => Number.isFinite(Number(item)))) {
      points.push(value);
      return;
    }
    if (Array.isArray(value)) value.forEach(collectPoints);
  };
  collectPoints(polygons);
  if (!points.length) throw new Error("Format géométrique non pris en charge.");

  const xs = points.map(([x]) => Number(x));
  const ys = points.map(([, y]) => Number(y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 0.000001);
  const height = Math.max(maxY - minY, 0.000001);
  const viewWidth = 800;
  const viewHeight = 360;
  const padding = 28;
  const scale = Math.min((viewWidth - padding * 2) / width, (viewHeight - padding * 2) / height);
  const offsetX = (viewWidth - width * scale) / 2;
  const offsetY = (viewHeight - height * scale) / 2;

  const project = ([x, y]) => [
    offsetX + (Number(x) - minX) * scale,
    viewHeight - (offsetY + (Number(y) - minY) * scale)
  ];
  const pathData = polygons.map((polygon) =>
    polygon.map((ring) =>
      ring.map((point, index) => {
        const [x, y] = project(point);
        return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
      }).join(" ") + " Z"
    ).join(" ")
  ).join(" ");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  path.setAttribute("class", "parcel-outline");
  path.setAttribute("fill-rule", "evenodd");
  svg.append(path);
}

async function loadUrbanisme(parcelCode) {
  const status = $("#detail-urbanisme-status");
  const zonesWrap = $("#detail-urbanisme-zones");
  status.hidden = false;
  status.textContent = "Chargement du zonage…";
  zonesWrap.hidden = true;
  zonesWrap.replaceChildren();

  try {
    const response = await fetch(`/api/urbanisme?parcelle=${encodeURIComponent(parcelCode)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Zonage indisponible.");

    if (!data.zones?.length) {
      status.textContent = "Aucun zonage opposable n’a été trouvé pour cette emprise.";
      return;
    }

    data.zones.forEach((zone) => {
      const article = document.createElement("article");
      article.className = "urbanisme-zone";

      const badge = document.createElement("strong");
      badge.className = "urbanisme-badge";
      badge.textContent = zone.libelle || zone.type || "Zone";

      const description = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = zone.libelleLong || `Zone ${zone.libelle || zone.type || "non renseignée"}`;
      const meta = document.createElement("span");
      meta.textContent = [
        zone.documentId && `Document ${zone.documentId}`,
        zone.documentFichier && `Règlement ${zone.documentFichier}`
      ].filter(Boolean).join(" · ");
      description.append(title, meta);
      article.append(badge, description);
      zonesWrap.append(article);
    });

    status.hidden = true;
    zonesWrap.hidden = false;
  } catch (error) {
    status.textContent = error.message || "Zonage d’urbanisme indisponible.";
  }
}

function parseGeopoint(value) {
  const coordinates = Array.isArray(value)
    ? value.map(Number)
    : String(value || "").split(",").map((item) => Number(item.trim()));
  if (coordinates.length < 2 || coordinates.some((item) => !Number.isFinite(item))) return null;
  return coordinates;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function titleCase(value) {
  return String(value || "").toLocaleLowerCase("fr-FR").replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("fr-FR"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

boot().catch(() => {
  $("#login").hidden = false;
  $("#app").hidden = true;
});
