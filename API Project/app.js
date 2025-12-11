// app.js — Cultural DNA Map
// -------------------------------------------------------
// High-level flow:
// 1) Load local genres JSON (genreMappings + genreGraph).
// 2) Render a D3 force-directed diagram of genres for now.
// 3) Later: connect tracks (Spotify) to these genres and recenter map per track.

// Global state-ish
let genreData = null; // loaded from JSON
let svg = null;
let simulation = null;

const width = 800;
const height = 500;

// Entry point
window.addEventListener("DOMContentLoaded", () => {
  initFeaturedTracks(); // temporary starter list
  initGraphSvg();
  loadGenreData();
  wireSearch();
});

// -------------------------------------------------------
// Last.fm + tag mapping helpers
// -------------------------------------------------------

const LASTFM_API_KEY = "c3951e83eab94f5ba6fe3b902b431403";
const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";

const LASTFM_BANNED_TAGS = new Set([
  "seen live",
  "favorites",
  "favourites",
  "favourite",
  "love",
  "under 2000 listeners",
  "under 100 listeners"
]);

function normalizeTagName(name) {
  return (name || "").toLowerCase().trim();
}

async function fetchArtistTopTags(artistName, limit = 15) {
  if (!artistName) return [];

  const params = new URLSearchParams({
    method: "artist.getTopTags",
    artist: artistName,
    api_key: LASTFM_API_KEY,
    format: "json"
  });

  const url = `${LASTFM_BASE}?${params.toString()}`;
  console.debug("Last.fm artist.getTopTags ->", url);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("Last.fm artist.getTopTags failed", res.status);
      return [];
    }

    const json = await res.json();
    if (json?.error) {
      console.warn("Last.fm artist.getTopTags returned error:", json.message || json.error);
      return [];
    }

    let rawTags = json?.toptags?.tag || [];
    if (rawTags && !Array.isArray(rawTags)) rawTags = [rawTags];

    const tags = (rawTags || [])
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, limit)
      .map((t) => normalizeTagName(t.name))
      .filter((tag) => tag && !LASTFM_BANNED_TAGS.has(tag));

    return tags;
  } catch (err) {
    console.error("Error calling Last.fm artist.getTopTags", err);
    return [];
  }
}

async function fetchTrackTopTags(artistName, trackName, limit = 15) {
  if (!artistName || !trackName) return [];

  const params = new URLSearchParams({
    method: "track.getTopTags",
    artist: artistName,
    track: trackName,
    api_key: LASTFM_API_KEY,
    format: "json"
  });

  const url = `${LASTFM_BASE}?${params.toString()}`;
  console.debug("Last.fm track.getTopTags ->", url);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("Last.fm track.getTopTags failed", res.status);
      return [];
    }

    const json = await res.json();
    if (json?.error) {
      console.warn("Last.fm track.getTopTags returned error:", json.message || json.error);
      return [];
    }

    let rawTags = json?.toptags?.tag || [];
    if (rawTags && !Array.isArray(rawTags)) rawTags = [rawTags];

    const tags = (rawTags || [])
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, limit)
      .map((t) => normalizeTagName(t.name))
      .filter((tag) => tag && !LASTFM_BANNED_TAGS.has(tag));

    return tags;
  } catch (err) {
    console.error("Error calling Last.fm track.getTopTags", err);
    return [];
  }
}

const TAG_TO_CANONICAL = {
  "trap": ["Trap"],
  "trill": ["Trap"],
  "plug": ["Pluggnb"],
  "pluggnb": ["Pluggnb"],
  "plugg": ["Pluggnb"],
  "rage": ["Rage"],
  "hyperpop": ["Rage"],
  "emo rap": ["Hip hop", "Alternative hip hop"],
  "cloud rap": ["Hip hop", "Pluggnb"],
  "drill": ["Drill"],
  "uk drill": ["UK drill"],
  "grime": ["Grime"],
  "road rap": ["UK rap"],
  "uk rap": ["UK rap"],
  "british rap": ["UK rap"],
  "uk hip hop": ["UK rap"],
  "underground": ["UK underground"],
  "uk underground": ["UK underground"],
  "experimental hip-hop": ["UK underground", "Alternative hip hop"],
  "experimental rap": ["UK underground", "Alternative hip hop"],
  "hip-hop": ["Hip hop"],
  "hip hop": ["Hip hop"],
  "hip-hop/rap": ["Hip hop"],
  "rap": ["Hip hop"],
  "alternative hip hop": ["Alternative hip hop"],
  "r&b": ["R&B"],
  "rnb": ["R&B"],
  "afrobeats": ["Afrobeats"],
  "afrobeat": ["Afrobeats"],
  "dancehall": ["Dancehall"],
  "reggae": ["Reggae"],
  "house": ["House"],
  "garage": ["UK garage"],
  "uk garage": ["UK garage"],
  "jungle": ["Jungle"],
  "drum and bass": ["Drum & bass"],
  "dnb": ["Drum & bass"],
  "bassline": ["UK garage"],
  "club": ["House"],
  "bedroom pop": ["Bedroom pop"],
  "alt pop": ["Bedroom pop"],
  "indie": ["Indie"],
  "indie pop": ["Indie"],
  "pop": ["Pop"]
};

function mapTagsToCanonical(tags) {
  const result = new Set();
  tags.forEach((tag) => {
    const exact = TAG_TO_CANONICAL[tag];
    if (exact) {
      exact.forEach((g) => result.add(g));
    } else {
      Object.keys(TAG_TO_CANONICAL).forEach((key) => {
        if (tag.includes(key)) {
          TAG_TO_CANONICAL[key].forEach((g) => result.add(g));
        }
      });
    }
  });
  return Array.from(result);
}

const ITUNES_TO_CANONICAL_GENRES = {
  "Hip-Hop/Rap": ["Hip hop"],
  "R&B/Soul": ["R&B"],
  "Dance": ["House"],
  "Electronic": ["House"],
  "Reggae": ["Reggae"],
  "Afrobeats": ["Afrobeats"],
  "Pop": ["Pop"]
};

function getCanonicalFromITunes(track) {
  const primary = track.primaryGenreName;
  if (!primary) return [];
  const mapped = ITUNES_TO_CANONICAL_GENRES[primary];
  return mapped || [];
}

function mergeCanonicalSources(sources) {
  const set = new Set();
  (sources || []).forEach((s) => {
    if (!s) return;
    if (Array.isArray(s)) {
      s.forEach((x) => x && set.add(x));
    } else if (typeof s === "string") {
      set.add(s);
    }
  });
  return Array.from(set);
}

// -------------------------------------------------------
// Wikipedia helpers + genre UI (chips, hover, click)
// -------------------------------------------------------

const wikiCache = new Map();

async function fetchGenreSummaryFromWikipedia(genreName) {
  if (!genreName) return null;
  if (wikiCache.has(genreName)) return wikiCache.get(genreName);

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    genreName
  )}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();

    const payload = {
      title: json.title,
      extract: json.extract,
      url: json.content_urls?.desktop?.page || json.content_urls?.mobile?.page
    };

    wikiCache.set(genreName, payload);
    return payload;
  } catch (e) {
    console.error("Wikipedia summary fetch failed:", e);
    return null;
  }
}

let hoverInfoDiv = null;
async function showGenreHoverInfo(genreName) {
  if (!genreName) return;
  if (!hoverInfoDiv) {
    hoverInfoDiv = document.createElement("div");
    hoverInfoDiv.className = "info-section";
    hoverInfoDiv.id = "genreHoverInfo";
    const infoContent = document.getElementById("infoContent");
    infoContent.appendChild(hoverInfoDiv);
  }

  hoverInfoDiv.innerHTML = `
    <div class="info-label">Genre preview</div>
    <div class="info-main">Loading ${genreName}…</div>
  `;

  const data = await fetchGenreSummaryFromWikipedia(genreName);
  if (!data) {
    hoverInfoDiv.querySelector(".info-main").textContent = "No Wikipedia summary found.";
    return;
  }

  hoverInfoDiv.innerHTML = `
    <div class="info-label">${data.title}</div>
    <div class="info-main">${data.extract}
      ${data.url ? `<br/><a href="${data.url}" target="_blank">Open on Wikipedia</a>` : ""}
    </div>
  `;
}

function hideGenreHoverInfo() {
  if (!hoverInfoDiv) return;
  hoverInfoDiv.remove();
  hoverInfoDiv = null;
}

function renderGenreChips(canonicalGenres) {
  // Remove any existing chips section
  const existing = document.getElementById("genreChipRow");
  if (existing && existing.parentElement) existing.parentElement.remove();

  const container = document.createElement("div");
  container.className = "info-section";
  container.innerHTML = `
    <div class="info-label">Genre DNA</div>
    <div class="info-main" id="genreChipRow"></div>
  `;

  const row = container.querySelector("#genreChipRow");

  (canonicalGenres || []).forEach((g) => {
    const chip = document.createElement("button");
    chip.className = "genre-chip";
    chip.textContent = g;

    chip.addEventListener("mouseenter", () => showGenreHoverInfo(g));
    chip.addEventListener("mouseleave", () => hideGenreHoverInfo());
    chip.addEventListener("click", () => onGenreChipClick(g));

    row.appendChild(chip);
  });

  const infoContent = document.getElementById("infoContent");
  infoContent.appendChild(container);
}

function findGenreNode(id) {
  if (!genreData || !genreData.genreGraph) return null;
  return genreData.genreGraph.find((g) => g.id.toLowerCase() === (id || "").toLowerCase());
}

async function onGenreChipClick(genreName) {
  if (!genreName) return;
  // visually focus that genre in the graph
  highlightCanonicalGenresOnGraph([genreName]);

  // Rebuild graph focused on this genre (auto-creates placeholders if needed)
  try {
    buildGenreFocusGraph(genreName);
  } catch (e) {
    console.debug('buildGenreFocusGraph failed', e);
  }

  // look up its parents/children
  const node = findGenreNode(genreName);

  const parents = (genreData.genreGraph || [])
    .filter((g) => node?.parents?.includes(g.id))
    .map((g) => g.id);

  const children = (genreData.genreGraph || [])
    .filter((g) => g.parents?.includes(node?.id))
    .map((g) => g.id);

  const wiki = await fetchGenreSummaryFromWikipedia(genreName);

  const infoContent = document.getElementById("infoContent");

  const treeSection = document.createElement("div");
  treeSection.className = "info-section";
  treeSection.innerHTML = `
    <div class="info-label">Genre family</div>
    <div class="info-main">
      <strong>${genreName}</strong><br/>
      <em>${node?.region || "—"}, ${node?.decade || "—"}</em><br/><br/>

      <strong>Influenced by:</strong>
      ${parents.length ? parents.join(", ") : "—"}<br/>

      <strong>Influences / descendants:</strong>
      ${children.length ? children.join(", ") : "—"}<br/><br/>

      ${wiki ? `
        <strong>Context:</strong><br/>
        ${wiki.extract}<br/>
        ${wiki.url ? `<a href="${wiki.url}" target="_blank">Read more</a>` : ""}
      ` : ""}
    </div>
  `;

  infoContent.appendChild(treeSection);
}

// -------------------------------------------------------
// Graph highlighting helpers

// -------------------------------------------------------
// Graph highlighting helpers
async function loadGenreData() {
  try {
    const res = await fetch("data/genres.json");
    genreData = await res.json();
    console.log("Loaded genre data:", genreData);
    console.debug("genreGraph length:", genreData?.genreGraph?.length);

    // Build nodes and links, auto-creating placeholder nodes for any missing parents
    const nodes = [];
    const nodesMap = new Map();

    function addNode(obj) {
      if (!nodesMap.has(obj.id)) {
        nodesMap.set(obj.id, obj);
        nodes.push(obj);
      }
      return nodesMap.get(obj.id);
    }

    // Seed nodes from the curated genreGraph
    genreData.genreGraph.forEach((g) => {
      addNode({ id: g.id, label: g.id, region: g.region, decade: g.decade });
    });

    // Build links; if a parent is missing from the curated list, create a placeholder node
    const links = [];
    genreData.genreGraph.forEach((g) => {
      (g.parents || []).forEach((parentId) => {
        if (!nodesMap.has(parentId)) {
          console.warn(`Auto-creating missing parent node: ${parentId}`);
          addNode({ id: parentId, label: parentId, region: "unknown", decade: "", isPlaceholder: true });
        }
        links.push({ source: parentId, target: g.id });
      });
    });

    renderGraph(nodes, links, "Base genre lineage");

  } catch (err) {
    console.error("Failed to load genre data", err);
  }
}

// -------------------------------------------------------
// 2) Initialize SVG for D3
// -------------------------------------------------------

function initGraphSvg() {
  const container = d3.select("#graph");
  container.selectAll("*").remove();

  svg = container
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${width} ${height}`);
}

// -------------------------------------------------------
// 3) Render graph with D3 force layout
// -------------------------------------------------------

function renderGraph(nodes, links, titleText) {
  if (!svg) initGraphSvg();

  d3.select("#mapTitle").text(titleText || "Cultural DNA Map");

  // Clear previous contents
  svg.selectAll("*").remove();

  console.debug("renderGraph called — nodes:", nodes?.length, "links:", links?.length);
  try {
    console.debug("svg node:", svg.node());
  } catch (e) {
    console.debug("svg debug failed", e);
  }

  if (!nodes || nodes.length === 0) {
    d3.select("#mapTitle").text("No genre nodes to display");
    const graphEl = document.getElementById("graph");
    if (graphEl) graphEl.innerHTML = '<div class="graph-empty">No genre data available — check console for errors.</div>';
    return;
  }

  simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(120)
    )
    .force("charge", d3.forceManyBody().strength(-280))
    .force("center", d3.forceCenter(width / 2, height / 2));

  const link = svg
    .append("g")
    .attr("stroke", "#444")
    .attr("stroke-opacity", 0.7)
    .selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("stroke-width", 1);

  const node = svg
    .append("g")
    .attr("stroke", "#050509")
    .attr("stroke-width", 1.2)
    .selectAll("circle")
    .data(nodes)
    .enter()
    .append("circle")
  .attr("data-id", (d) => d.id)
  .attr("data-placeholder", (d) => (d.isPlaceholder ? "true" : "false"))
  .classed("genre-node", true)
    .attr("r", (d) => (d.isCentral ? 14 : 9))
    .attr("fill", (d) => (d.isCentral ? "#b36cff" : "#3d365b"))
    .style("cursor", "pointer")
    .on("click", (_, d) => onNodeClick(d))
    .call(
      d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  const labels = svg
    .append("g")
    .selectAll("text")
    .data(nodes)
    .enter()
    .append("text")
    .text((d) => d.label)
    .attr("font-size", 10)
    .attr("fill", "#ddd")
    .attr("text-anchor", "middle")
    .attr("dy", 20);

  simulation.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);

    labels.attr("x", (d) => d.x).attr("y", (d) => d.y);
  });
}

// -------------------------------------------------------
// 4) Node click -> update info panel
// -------------------------------------------------------

function onNodeClick(node) {
  // Different behavior depending on node type
  if (!node) return;

  // If this is a track node, show track info in the right panel
  if (node.type === 'track') {
    const t = node.trackData || {};
    const infoTitle = document.getElementById('infoTitle');
    const infoContent = document.getElementById('infoContent');
    infoTitle.textContent = t.trackName || node.label;
    const art = t.artworkUrl100 ? t.artworkUrl100.replace(/100x100/, '500x500') : '';
    const previewUrl = t.previewUrl;
    const artist = t.artistName || 'Unknown artist';
    const album = t.collectionName || 'Unknown album';
    const year = t.releaseDate ? new Date(t.releaseDate).getFullYear() : '—';

    infoContent.innerHTML = `
      <div class="info-section"><div class="info-label">Artist</div><div class="info-main">${artist}</div></div>
      <div class="info-section"><div class="info-label">Album / Year</div><div class="info-main">${album} (${year})</div></div>
      ${art ? `<div class="info-section"><div class="info-label">Artwork</div><img src="${art}" style="width:100%;border-radius:8px;margin-top:0.25rem;"/></div>` : ''}
      ${previewUrl ? `<div class="info-section"><div class="info-label">Preview</div><audio controls src="${previewUrl}"></audio></div>` : `<div class="info-section"><div class="info-label">Preview</div><div class="info-main">No preview available.</div></div>`}
    `;

    // Rebuild track graph centered on this track
    buildTrackGenreGraph(t, []);
    return;
  }

  // If this is a tag node, map it to canonical and open the genre-focused graph
  if (node.type === 'tag') {
    const tagName = node.label;
    // Map tag to canonical if possible
    let mapped = [];
    try {
      mapped = mapTagsToCanonical([tagName]);
    } catch (e) {
      mapped = [];
    }
    const target = mapped.length ? mapped[0] : tagName;
    buildGenreFocusGraph(target);
    return;
  }

  // If this is a genre node, show its focused graph and details
  if (node.type === 'genre' || (node.id && node.id.startsWith('GENRE:'))) {
    const label = node.label;
    buildGenreFocusGraph(label);
    return;
  }

  // Fallback: show basic info (legacy behavior)
  const infoTitle = document.getElementById("infoTitle");
  const infoContent = document.getElementById("infoContent");

  infoTitle.textContent = node.label;
  const match =
    genreData &&
    genreData.genreGraph.find((g) => g.id.toLowerCase() === node.label.toLowerCase());
  const region = match?.region || "—";
  const decade = match?.decade || "—";
  infoContent.innerHTML = `
    <div class="info-section">
      <div class="info-label">Region / Era</div>
      <div class="info-main">${region}, ${decade}</div>
    </div>
    <div class="info-section">
      <div class="info-label">Description</div>
      <div class="info-main">
        This genre node is part of the broader lineage.
      </div>
    </div>
  `;
}

// -------------------------------------------------------
// 5) Featured tracks (manual for now, API later)
// -------------------------------------------------------

function initFeaturedTracks() {
  const featured = [
    {
      id: "EXAMPLE_SKEPTA_SHUTDOWN",
      title: "Shutdown",
      artist: "Skepta",
      // Later: real Spotify ID + cover pulled via API
      cover: "https://via.placeholder.com/64x64.png?text=Art"
    },
    {
      id: "EXAMPLE_JHUS_SPIRIT",
      title: "Spirit",
      artist: "J Hus",
      cover: "https://via.placeholder.com/64x64.png?text=Art"
    }
  ];

  const container = document.getElementById("featuredTracks");
  container.innerHTML = "";

  featured.forEach((track) => {
    const card = document.createElement("div");
    card.className = "track-card";
    card.innerHTML = `
      <img src="${track.cover}" alt="${track.title}" />
      <div class="track-meta">
        <strong>${track.title}</strong>
        <span>${track.artist}</span>
      </div>
    `;
    card.addEventListener("click", () => onFeaturedTrackClick(track));
    container.appendChild(card);
  });
}

// When a track is clicked: for now, just highlight one genre as “central”
function onFeaturedTrackClick(track) {
  // Later, this will:
  // 1) Fetch Spotify info for the track.
  // 2) Map its artist genres -> canonical genres.
  // 3) Mark those genres as central in the graph.

  document.getElementById("mapTitle").textContent =
    `Cultural DNA for: ${track.title} — ${track.artist}`;

  // TEMP: just update info panel to show track meta
  const infoTitle = document.getElementById("infoTitle");
  const infoContent = document.getElementById("infoContent");
  infoTitle.textContent = track.title;
  infoContent.innerHTML = `
    <div class="info-section">
      <div class="info-label">Artist</div>
      <div class="info-main">${track.artist}</div>
    </div>
    <div class="info-section">
      <div class="info-label">Overview</div>
      <div class="info-main">
        This is a placeholder for track-specific context.
        Later, this will pull Spotify audio features and
        a curated explanation of its genre DNA.
      </div>
    </div>
  `;
}

// -------------------------------------------------------
// 6) Search wiring (Spotify integration later)
// -------------------------------------------------------

function wireSearch() {
  const input = document.getElementById("searchInput");
  const button = document.getElementById("searchButton");
  button.addEventListener("click", async () => {
    const q = input.value.trim();
    if (!q) return;
    const tracks = await searchTracks(q);
    renderSearchResults(tracks);
  });
  // Enter key triggers search
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const q = input.value.trim();
      if (!q) return;
      const tracks = await searchTracks(q);
      renderSearchResults(tracks);
    }
  });
}


// -------------------------------------------------------
// iTunes Search API integration (lightweight)
// -------------------------------------------------------

async function searchTracks(q) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    q
  )}&entity=song&limit=25`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("iTunes search failed", res.status);
      return [];
    }
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error("Error calling iTunes API", err);
    return [];
  }
}


function renderSearchResults(tracks) {
  const container = document.getElementById("featuredTracks");
  container.innerHTML = ""; // clear previous

  if (!tracks || tracks.length === 0) {
    container.innerHTML = `<p style="font-size:0.8rem;color:#888;">No tracks found. Try another search.</p>`;
    return;
  }

  tracks.forEach((track) => {
    const card = document.createElement("div");
    card.className = "track-card";

    const art = track.artworkUrl100
      ? track.artworkUrl100.replace(/100x100/, "500x500")
      : "https://via.placeholder.com/64x64.png?text=Art";

    card.innerHTML = `
      <img src="${art}" alt="${track.trackName}" />
      <div class="track-meta">
        <strong>${track.trackName}</strong>
        <span>${track.artistName}</span>
      </div>
    `;

    card.addEventListener("click", () => onITunesTrackSelected(track));
    container.appendChild(card);
  });
}


async function onITunesTrackSelected(track) {
  // Update map title
  document.getElementById("mapTitle").textContent =
    `Cultural DNA for: ${track.trackName} — ${track.artistName}`;

  const infoTitle = document.getElementById("infoTitle");
  const infoContent = document.getElementById("infoContent");
  infoTitle.textContent = track.trackName;

  const art = track.artworkUrl100 ? track.artworkUrl100.replace(/100x100/, "500x500") : "";
  const artist = track.artistName || "Unknown artist";
  const album = track.collectionName || "Unknown album";
  const year = track.releaseDate ? new Date(track.releaseDate).getFullYear() : "—";
  const genre = track.primaryGenreName || "—";
  const previewUrl = track.previewUrl;

  infoContent.innerHTML = `
    <div class="info-section">
      <div class="info-label">Artist</div>
      <div class="info-main">${artist}</div>
    </div>

    <div class="info-section">
      <div class="info-label">Album / Year</div>
      <div class="info-main">${album} (${year})</div>
    </div>

    <div class="info-section">
      <div class="info-label">iTunes Genre</div>
      <div class="info-main">${genre}</div>
    </div>

    ${art ? `
      <div class="info-section">
        <div class="info-label">Artwork</div>
        <img src="${art}" alt="${track.trackName}" style="width:100%;border-radius:8px;margin-top:0.25rem;" />
      </div>
    ` : ""}

    ${previewUrl ? `
      <div class="info-section">
        <div class="info-label">Preview</div>
        <audio controls src="${previewUrl}"></audio>
      </div>
    ` : `
      <div class="info-section">
        <div class="info-label">Preview</div>
        <div class="info-main">No preview available for this track.</div>
      </div>
    `}
  `;

  // FIRST: derive canonical genres from iTunes primary genre
  const canonicalFromITunes = getCanonicalFromITunes(track);

  // NEXT: fetch Last.fm tags (artist + track) and map them to canonical genres
  try {
    const [artistTags, trackTags] = await Promise.all([
      fetchArtistTopTags(artist, 10),
      fetchTrackTopTags(artist, track.trackName, 10)
    ]);

    const combinedTags = Array.from(new Set([...(artistTags || []), ...(trackTags || [])]));
    console.log("Last.fm tags:", combinedTags);

    const canonicalFromTags = mapTagsToCanonical(combinedTags);
    console.log("Canonical from Last.fm:", canonicalFromTags);

    // Also check for simple genre overrides from your local JSON (genreMappings)
    const overrides = [];
    if (genreData && genreData.genreMappings) {
      const key = (track.primaryGenreName || "").toLowerCase();
      const mapped = genreData.genreMappings[key];
      if (mapped) overrides.push(mapped);
    }

    // Merge sources into a single canonical list
    const canonical = mergeCanonicalSources([canonicalFromITunes, canonicalFromTags, overrides]);

    // Ensure a Last.fm status block exists and update it
    let s = document.getElementById("lastfmStatus");
    if (!s) {
      s = document.createElement("div");
      s.className = "info-section";
      s.id = "lastfmStatus";
      const infoContent = document.getElementById("infoContent");
      if (infoContent) infoContent.appendChild(s);
    }

    if (combinedTags.length) {
      s.innerHTML = `<div class=\"info-label\">Last.fm tags</div><div class=\"info-main\">${combinedTags.slice(0,8).join(", ")}</div>`;
    } else {
      s.innerHTML = `<div class=\"info-label\">Last.fm tags</div><div class=\"info-main\">No tags found.</div>`;
    }

    // render the canonical genres as interactive chips
    if (canonical.length) {
      renderGenreChips(canonical);
    } else {
      infoContent.innerHTML += `<div class=\"info-section\"><div class=\"info-label\">Mapped genres</div><div class=\"info-main\">No canonical genres detected.</div></div>`;
    }

    highlightCanonicalGenresOnGraph(canonical);
      // Build a track-centered graph: central node for the track connected to its Last.fm tags
      buildTrackGenreGraph(track, combinedTags || []);
  } catch (err) {
    console.error("Error fetching Last.fm tags or mapping genres", err);
    // fallback: highlight whatever we got from iTunes
    // show error in status block if present
    const s = document.getElementById("lastfmStatus");
    if (s) s.innerHTML = `<div class="info-label">Last.fm</div><div class="info-main">Error fetching tags</div>`;
    highlightCanonicalGenresOnGraph(canonicalFromITunes);
  }
}


// -------------------------------------------------------
// Graph highlighting helpers
// -------------------------------------------------------

function highlightCanonicalGenresOnGraph(canonicalGenres) {
  if (!svg) return;

  // Reset all nodes to default
  svg.selectAll("circle.genre-node").attr("fill", "#3d365b").attr("r", 9).attr("opacity", 1);

  if (!canonicalGenres || canonicalGenres.length === 0) {
    // show a small message in info panel
    const infoContent = document.getElementById("infoContent");
    infoContent.innerHTML += `<div class=\"info-section\"><div class=\"info-label\">Genre mapping</div><div class=\"info-main\">No canonical genre mapping available for this track.</div></div>`;
    return;
  }

  // Highlight matches (case-insensitive)
  canonicalGenres.forEach((g) => {
    const sel = svg.selectAll("circle.genre-node").filter((d) => {
      // match either the node id or the display label (both case-insensitive)
      return (d.id && d.id.toLowerCase() === g.toLowerCase()) || (d.label && d.label.toLowerCase() === g.toLowerCase());
    });

    sel
      .attr("fill", "#b36cff")
      .attr("r", 14)
      .attr("opacity", 1)
      .each(function (d) {
        // small pulse animation
        d3.select(this)
          .transition()
          .duration(600)
          .attr("r", 18)
          .transition()
          .duration(400)
          .attr("r", 14);
      });
  });

  // Also update info panel to show the highlighted canonical genres
  const infoContent = document.getElementById("infoContent");
  infoContent.innerHTML += `<div class=\"info-section\"><div class=\"info-label\">Mapped genres</div><div class=\"info-main\">${canonicalGenres.join(", ")}</div></div>`;
}


// -------------------------------------------------------
// Build a track-centered graph: central track node + tag nodes
// -------------------------------------------------------
function buildTrackGenreGraph(track, tags) {
  if (!track) return;
  const nodes = [];
  const links = [];
  const map = new Map();

  function add(n) {
    if (!map.has(n.id)) {
      map.set(n.id, n);
      nodes.push(n);
    }
    return map.get(n.id);
  }

  const centralId = `TRACK:${track.trackId || track.trackName + ' - ' + (track.artistName||'')}`;
  const centralLabel = `${track.trackName} — ${track.artistName}`;
  add({ id: centralId, label: centralLabel, type: 'track', isCentral: true, trackData: track });

  // Add tag nodes
  const uniq = Array.from(new Set((tags || []).slice(0, 20)));
  uniq.forEach((t) => {
    const id = `TAG:${t}`;
    add({ id, label: t, type: 'tag' });
    links.push({ source: centralId, target: id });
  });

  // Optionally: also add canonical genre nodes for any mapped tags (lightweight)
  try {
    const mapped = mapTagsToCanonical(uniq);
    mapped.forEach((g) => {
      const gid = `GENRE:${g}`;
      add({ id: gid, label: g, type: 'genre' });
      // link central to canonical genre as a secondary relation
      links.push({ source: centralId, target: gid });
    });
  } catch (e) {
    console.debug('No mapping to canonical genres for tags', e);
  }

  renderGraph(nodes, links, `Track: ${track.trackName} — ${track.artistName}`);
}


// -------------------------------------------------------
// Build a genre-focused graph: genre node + parents + children
// -------------------------------------------------------
async function buildGenreFocusGraph(genreName) {
  if (!genreName) return;
  const name = String(genreName).trim();
  const nodes = [];
  const links = [];
  const map = new Map();

  function add(n) {
    if (!map.has(n.id)) {
      map.set(n.id, n);
      nodes.push(n);
    }
    return map.get(n.id);
  }

  // Try to find the genre in curated data
  const match = genreData && genreData.genreGraph && genreData.genreGraph.find((g) => g.id.toLowerCase() === name.toLowerCase());

  // If we have a curated node, include it plus its parents and children; otherwise create a single node
  if (match) {
    add({ id: `GENRE:${match.id}`, label: match.id, type: 'genre', region: match.region, decade: match.decade, isCentral: true });

    (match.parents || []).forEach((p) => {
      // find parent node details if available
      const pmatch = genreData.genreGraph.find((gg) => gg.id.toLowerCase() === (p||'').toLowerCase());
      if (pmatch) {
        add({ id: `GENRE:${pmatch.id}`, label: pmatch.id, type: 'genre', region: pmatch.region, decade: pmatch.decade });
      } else {
        add({ id: `GENRE:${p}`, label: p, type: 'genre', isPlaceholder: true });
      }
      links.push({ source: `GENRE:${p}`, target: `GENRE:${match.id}` });
    });

    // children: find nodes that list this genre as parent
    (genreData.genreGraph || []).forEach((gg) => {
      if ((gg.parents || []).some((pid) => (pid||'').toLowerCase() === match.id.toLowerCase())) {
        add({ id: `GENRE:${gg.id}`, label: gg.id, type: 'genre', region: gg.region, decade: gg.decade });
        links.push({ source: `GENRE:${match.id}`, target: `GENRE:${gg.id}` });
      }
    });
  } else {
    // no curated info: create single node and try to enrich via Wikipedia
    add({ id: `GENRE:${name}`, label: name, type: 'genre', isCentral: true });
  }

  renderGraph(nodes, links, `Genre: ${name}`);

  // Update right info panel with Wikipedia summary (no preview or artwork)
  const infoTitle = document.getElementById('infoTitle');
  const infoContent = document.getElementById('infoContent');
  infoTitle.textContent = name;
  infoContent.innerHTML = `<div class="info-section"><div class="info-label">Overview</div><div class="info-main">Loading summary…</div></div>`;
  try {
    const wiki = await fetchGenreSummaryFromWikipedia(name);
    infoContent.innerHTML = `
      <div class="info-section"><div class="info-label">Summary</div><div class="info-main">${wiki?.extract || 'No summary found.'}</div></div>
      ${wiki?.url ? `<div class="info-section"><a href="${wiki.url}" target="_blank">Read more on Wikipedia</a></div>` : ''}
    `;
  } catch (e) {
    infoContent.innerHTML = `<div class="info-section"><div class="info-label">Summary</div><div class="info-main">Could not fetch summary.</div></div>`;
  }
}
