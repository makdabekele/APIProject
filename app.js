// app.js — Cultural DNA Map
// -------------------------------------------------------
// High-level flow:
// 1) Load local genres JSON (genreMappings + genreGraph).
// 2) Render a D3 force-directed diagram of genres for now.
// 3) Later: connect tracks (Spotify) to these genres and recenter map per track.

// Global state-ish
let svg = null;
let simulation = null;
let currentTrack = null; // Store current track for back-to-track functionality
let currentTrackHTML = null; // Store original track info HTML

const width = 800;
const height = 500;

// Entry point
window.addEventListener("DOMContentLoaded", () => {
  initFeaturedTracks(); // temporary starter list
  initGraphSvg();
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
  "under 100 listeners",
  // Location/origin tags
  "american",
  "british",
  "uk",
  "usa",
  "united states",
  "chicago",
  "new york",
  "london",
  "los angeles",
  "oakland",
  "brooklyn",
  "atlanta",
  "austin",
  "nashville",
  "memphis",
  "seattle",
  "portland",
  "toronto",
  "vancouver",
  "sydney",
  "melbourne",
  "berlin",
  "paris",
  "tokyo",
  "moscow",
  "moscow metal",
  // Decade/era tags (not genres)
  "70s",
  "80s",
  "90s",
  "2000s",
  "1970s",
  "1980s",
  "1990s",
  "2000s",
  "early 2000s",
  // Other non-genre descriptors
  "male",
  "female",
  "male vocals",
  "female vocals",
  "instrumental",
  "remix",
  "cover",
  "live",
  "acoustic",
  "unplugged",
  "ost",
  "soundtrack",
  "anime",
  "video game",
  "game",
  "film"
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

// NOTE: We no longer use curated canonical mappings from a local JSON.
// Tags from Last.fm (and iTunes primary genres) are presented directly to the user.

// -------------------------------------------------------
// Wikipedia helpers + genre UI (chips, hover, click)
// -------------------------------------------------------

const wikiCache = new Map();

async function fetchGenreSummaryFromWikipedia(genreName) {
  if (!genreName) return null;
  if (wikiCache.has(genreName)) return wikiCache.get(genreName);
  // Check if there's an alias for better Wikipedia resolution
  const normalized = (genreName || "").toLowerCase().trim();
  const aliasedName = WIKI_ALIAS[normalized] || genreName;
  // Prefer searching for the music-specific article (e.g., "rock music")
  const searchTitle = `${aliasedName} music`;
  const tryTitles = [searchTitle, aliasedName];

  for (const t of tryTitles) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const payload = {
        title: json.title,
        extract: json.extract,
        url: json.content_urls?.desktop?.page || json.content_urls?.mobile?.page
      };
      wikiCache.set(genreName, payload);
      return payload;
    } catch (e) {
      console.debug("Wikipedia summary fetch failed for", t, e);
    }
  }

  return null;
}

// Map some common genre terms to Wikipedia category titles for subgenre listing
const GENRE_TO_WIKI_CATEGORY = {
  // Hip-Hop / Rap
  "hip hop": "Hip hop music genres",
  "hip-hop": "Hip hop music genres",
  "rap": "Hip hop music genres",
  "trap": "Hip hop music genres",
  "boom bap": "Hip hop music genres",
  "drill": "Hip hop music genres",
  "alternative hip hop": "Hip hop music genres",
  
  // Electronic / Dance
  "electronic": "Electronic music genres",
  "house": "House music genres",
  "techno": "Techno",
  "trance": "Trance music",
  "drum and bass": "Drum and bass",
  "dubstep": "Dubstep",
  "uk garage": "Garage music",
  "ambient": "Ambient music",
  
  // Rock
  "rock": "Rock music genres",
  "alternative rock": "Alternative rock",
  "indie rock": "Indie rock",
  "punk rock": "Punk rock",
  "post-punk": "Post-punk",
  "metal": "Heavy metal music",
  "hardcore punk": "Hardcore punk",
  
  // Pop
  "pop": "Pop music genres",
  "synthpop": "Synthpop",
  "electropop": "Electropop",
  "indie pop": "Indie pop",
  
  // R&B / Soul
  "r&b": "Rhythm and blues music genres",
  "soul": "Soul music genres",
  "neo-soul": "Soul music genres",
  "funk": "Funk music",
  
  // Jazz / Blues
  "jazz": "Jazz genres",
  "blues": "Blues genres",
  "bebop": "Bebop",
  
  // Global / Regional
  "afrobeats": "Afrobeats",
  "reggae": "Reggae music",
  "dancehall": "Dancehall",
  "latin": "Latin music",
  "reggaeton": "Reggaeton",
  "salsa": "Salsa music",
  "bossa nova": "Bossa nova",
  
  // Experimental / Art
  "experimental": "Experimental music",
  "avant-garde": "Avant-garde music",
  "noise": "Noise music",
  "industrial": "Industrial music",
  
  // Folk / Acoustic
  "folk": "Folk music genres",
  "singer-songwriter": "Singer-songwriters",
  "americana": "Americana music",
  
  // Classical / Score
  "classical": "Classical music genres",
  "contemporary classical": "Contemporary classical music",
  "film score": "Film score",
  
  // Internet / Culture-Driven
  "hyperpop": "Hyperpop",
  "bedroom pop": "Bedroom pop",
  "vaporwave": "Vaporwave",
  
  // Other Anchors
  "grunge": "Grunge",
  "shoegaze": "Shoegaze",
  "emo": "Emo music",
  "gothic rock": "Gothic rock",
  "post-rock": "Post-rock",
  "chillout": "Chillhop",
  "lo-fi": "Lo-fi music",
  "world music": "World music"
};

// Map common genre variations to better Wikipedia pages
const WIKI_ALIAS = {
  "rap": "hip hop",
  "hip-hop": "hip hop",
  "r&b": "rhythm and blues",
  "edm": "electronic dance music"
};

async function fetchSubgenresFromWikipedia(genreName, limit = 20) {
  if (!genreName) return [];
  const key = String(genreName).toLowerCase().trim();
  const primaryTitle = GENRE_TO_WIKI_CATEGORY[key];
  
  // Generate variations of the genre name (dash, no-dash, hyphenated, etc.)
  const variations = [primaryTitle];
  if (genreName.includes(" ")) {
    variations.push(genreName.replace(/ /g, "-")); // Add dashes
    variations.push(genreName.replace(/ /g, "")); // Remove spaces
  }
  if (genreName.includes("-")) {
    variations.push(genreName.replace(/-/g, " ")); // Remove dashes
    variations.push(genreName.replace(/-/g, "")); // Remove dashes entirely
  }
  variations.push(`${genreName} music genres`);
  variations.push(`${genreName} music`);
  variations.push(genreName);
  variations.push(`${genreName} genres`);

  for (const categoryTitle of variations.filter(Boolean)) {
    const params = new URLSearchParams({
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${categoryTitle}`,
      cmlimit: String(limit),
      format: "json",
      origin: "*"
    });

    const url = `https://en.wikipedia.org/w/api.php?${params.toString()}`;
    console.debug("Trying Wikipedia category:", `Category:${categoryTitle}`);
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const members = json?.query?.categorymembers || [];
      const titles = members.map((m) => m.title).filter(Boolean);
      if (titles.length > 0) {
        console.debug("✓ Found", titles.length, "members in", categoryTitle);
        return titles;
      }
    } catch (e) {
      console.debug("Failed to fetch", categoryTitle, e);
      continue;
    }
  }
  
  console.warn("No Wikipedia categories found for:", genreName);
  return [];
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
    <div class="info-label">Last.fm tags</div>
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

async function renderWikiInfoForLabel(label) {
  if (!label) return;
  const infoTitle = document.getElementById('infoTitle');
  const infoContent = document.getElementById('infoContent');
  infoTitle.textContent = label;
  infoContent.innerHTML = `
    <div class="info-section">
      <div class="info-label">Overview</div>
      <div class="info-main">Loading summary…</div>
    </div>
  `;
  try {
    const wiki = await fetchGenreSummaryFromWikipedia(label);
    if (wiki) {
      infoContent.innerHTML = `
        ${currentTrack ? `<button id="backToTrackBtn" class="back-btn" style="margin-bottom: 1rem; padding: 0.5rem 1rem; background: #6c5ce7; color: #fff; border: none; border-radius: 4px; cursor: pointer;">← Back to track</button>` : ''}
        <div class="info-section">
          <div class="info-label">${wiki.title}</div>
          <div class="info-main">${wiki.extract}</div>
        </div>
        ${wiki.url ? `<div class="info-section"><a href="${wiki.url}" target="_blank">Read more on Wikipedia</a></div>` : ''}
      `;
      // Wire up back button if it exists
      const backBtn = document.getElementById('backToTrackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          if (currentTrackHTML) {
            infoContent.innerHTML = currentTrackHTML;
          }
        });
      }
    } else {
      infoContent.innerHTML = `<div class="info-section"><div class="info-main">No Wikipedia summary found.</div></div>`;
    }
  } catch (e) {
    infoContent.innerHTML = `<div class="info-section"><div class="info-main">Could not fetch summary.</div></div>`;
  }
}

async function onGenreChipClick(genreName) {
  if (!genreName) return;
  try {
    buildGenreFocusGraph(genreName, null, { preserveTagColor: true });
  } catch (e) {
    console.debug("buildGenreFocusGraph failed", e);
  }

  // Update right-hand info panel with summary
  const infoTitle = document.getElementById("infoTitle");
  const infoContent = document.getElementById("infoContent");
  infoTitle.textContent = genreName;
  infoContent.innerHTML = `<div class="info-section"><div class="info-label">Overview</div><div class="info-main">Loading summary…</div></div>`;
  try {
    const wiki = await fetchGenreSummaryFromWikipedia(genreName);
    infoContent.innerHTML = `
      <div class="info-section"><div class="info-label">${wiki?.title || genreName}</div><div class="info-main">${wiki?.extract || 'No summary found.'}</div></div>
      ${wiki?.url ? `<div class="info-section"><a href="${wiki.url}" target="_blank">Read more on Wikipedia</a></div>` : ''}
    `;
  } catch (e) {
    infoContent.innerHTML = `<div class="info-section"><div class="info-label">Summary</div><div class="info-main">Could not fetch summary.</div></div>`;
  }
}

// -------------------------------------------------------
// Graph highlighting helpers

// -------------------------------------------------------
// Graph highlighting helpers
// Removed local `loadGenreData` — graph is now built dynamically from Last.fm + Wikipedia

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
        .distance((d) => {
          // Increase link distance for track->tag connections to create a larger orbit
          try {
            const sType = d.source && d.source.type;
            const tType = d.target && d.target.type;
            if (sType === 'track' || tType === 'track') return 220;
            return 160;
          } catch (e) {
            return 180;
          }
        })
    )
    .force("charge", d3.forceManyBody().strength(-600))
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
    .attr("r", (d) => {
      if (d.isCentral) return 20; // Central node larger
      if (d.isContext) return 14; // Context/source track (slightly smaller)
      if (d.type === 'tag') return 14; // Tag nodes larger for visibility
      return 12; // Subgenres
    })
    .attr("fill", (d) => {
      // Central nodes
      if (d.isCentral && d.type === 'genre') {
        // Preserve tag color when requested (keeps coral color for continuity)
        if (d.preserveTagColor) return "#ff9a76";
        return "#ffd93d"; // Bright gold for central genre
      }
      if (d.isCentral && d.type === 'track') return "#4dd0e1"; // Bright cyan for central track
      // Context/source nodes
      if (d.isContext) return "#80deea"; // Muted cyan for context track
      // Tag nodes
      if (d.type === 'tag') return "#ff9a76"; // Coral/orange for tags
      // Subgenres
      return "#ba68c8"; // Muted purple/lavender for subgenres
    })
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
    .attr("font-size", 12)
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

async function onNodeClick(node) {
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

    // Rebuild track graph centered on this track (attempt to fetch tags)
    (async () => {
      try {
        const [artistTags, trackTags] = await Promise.all([
          fetchArtistTopTags(artist, 12),
          fetchTrackTopTags(artist, t.trackName || '', 12)
        ]);
        const combined = Array.from(new Set([...(artistTags || []), ...(trackTags || [])]));
        buildTrackGenreGraph(t, combined);
      } catch (e) {
        buildTrackGenreGraph(t, []);
      }
    })();
    return;
  }

  // If this is a tag node, build a genre-focused graph showing subgenres
  if (node.type === 'tag') {
    const tagName = node.label;
    buildGenreFocusGraph(tagName, currentTrack, { preserveTagColor: true });
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
  // Show a Wikipedia summary for the node label as a fallback
  const label = node.label || node.id || "";
  infoTitle.textContent = label;
  infoContent.innerHTML = `<div class="info-section"><div class="info-label">Overview</div><div class="info-main">Loading summary…</div></div>`;
  try {
    const wiki = await fetchGenreSummaryFromWikipedia(label);
    infoContent.innerHTML = `
      <div class="info-section"><div class="info-label">${wiki?.title || label}</div><div class="info-main">${wiki?.extract || 'No summary found.'}</div></div>
      ${wiki?.url ? `<div class="info-section"><a href="${wiki.url}" target="_blank">Read more on Wikipedia</a></div>` : ''}
    `;
  } catch (e) {
    infoContent.innerHTML = `<div class="info-section"><div class="info-label">Summary</div><div class="info-main">Could not fetch summary.</div></div>`;
  }
}

// -------------------------------------------------------
// 5) Featured tracks (manual for now, API later)
// -------------------------------------------------------

function initFeaturedTracks() {
  const featured = [];

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
  let debounceTimer;
  
  // Create suggestions dropdown
  const suggestionsDiv = document.createElement("div");
  suggestionsDiv.id = "searchSuggestions";
  suggestionsDiv.className = "search-suggestions";
  suggestionsDiv.style.cssText = `
    position: fixed;
    background: #1a1a2e;
    border: 1px solid #444;
    border-radius: 8px;
    max-height: 300px;
    overflow-y: auto;
    display: none;
    z-index: 1000;
    min-width: 300px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;
  document.body.appendChild(suggestionsDiv);
  
  // Function to position suggestions below input
  function positionSuggestions() {
    const rect = input.getBoundingClientRect();
    suggestionsDiv.style.top = (rect.bottom + 5) + "px";
    suggestionsDiv.style.left = rect.left + "px";
    suggestionsDiv.style.width = rect.width + "px";
  }
  
  // Search on input (with debounce)
  input.addEventListener("input", async (e) => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    
    if (!q || q.length < 2) {
      suggestionsDiv.style.display = "none";
      return;
    }
    
    debounceTimer = setTimeout(async () => {
      const tracks = await searchTracks(q);
      displaySuggestions(tracks, suggestionsDiv, input);
      positionSuggestions();
    }, 300);
  });
  
  // Search on button click
  button.addEventListener("click", async () => {
    const q = input.value.trim();
    if (!q) return;
    const tracks = await searchTracks(q);
    renderSearchResults(tracks);
    suggestionsDiv.style.display = "none";
  });
  
  // Enter key triggers full search
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const q = input.value.trim();
      if (!q) return;
      const tracks = await searchTracks(q);
      renderSearchResults(tracks);
      suggestionsDiv.style.display = "none";
    }
  });
  
  // Hide suggestions when clicking outside
  document.addEventListener("click", (e) => {
    if (e.target !== input && e.target !== button && !suggestionsDiv.contains(e.target)) {
      suggestionsDiv.style.display = "none";
    }
  });
}

function displaySuggestions(tracks, suggestionsDiv, searchInput) {
  suggestionsDiv.innerHTML = "";
  
  if (!tracks || tracks.length === 0) {
    suggestionsDiv.style.display = "none";
    return;
  }
  
  // Show top 8 suggestions
  tracks.slice(0, 8).forEach((track) => {
    const suggestion = document.createElement("div");
    suggestion.className = "suggestion-item";
    suggestion.style.cssText = `
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #333;
      cursor: pointer;
      transition: background 0.2s;
    `;
    suggestion.innerHTML = `
      <div style="font-weight: 500; color: #ddd;">${track.trackName}</div>
      <div style="font-size: 0.85rem; color: #999;">${track.artistName}</div>
    `;
    
    suggestion.addEventListener("mouseenter", () => {
      suggestion.style.background = "#2a2a3e";
    });
    suggestion.addEventListener("mouseleave", () => {
      suggestion.style.background = "transparent";
    });
    
    suggestion.addEventListener("click", () => {
      searchInput.value = `${track.trackName} — ${track.artistName}`;
      suggestionsDiv.style.display = "none";
      onITunesTrackSelected(track);
    });
    
    suggestionsDiv.appendChild(suggestion);
  });
  
  suggestionsDiv.style.display = "block";
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
  // Store track for back-to-track functionality
  currentTrack = track;
  
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
  
  // Store the original track HTML for back-to-track functionality
  currentTrackHTML = infoContent.innerHTML;

  // Fetch Last.fm tags for artist + track and use them directly as chips + graph nodes
  try {
    const [artistTags, trackTags] = await Promise.all([
      fetchArtistTopTags(artist, 12),
      fetchTrackTopTags(artist, track.trackName, 12)
    ]);

    const combinedTags = Array.from(new Set([...(artistTags || []), ...(trackTags || [])]));
    
    // Filter out the track's artist name to prevent artist appearing as a tag
    const artistName = (artist || "").toLowerCase().trim();
    const filteredTags = combinedTags.filter(tag => {
      const normalized = normalizeTagName(tag);
      return normalized !== artistName && !artistName.includes(normalized) && !normalized.includes(artistName);
    });
    
    console.log("Last.fm tags (filtered):", filteredTags);
    // Render the raw Last.fm tags as chips (deduped)
    if (filteredTags.length) {
      renderGenreChips(filteredTags);
    }

    // Build a track-centered graph: central node for the track connected to its Last.fm tags
    buildTrackGenreGraph(track, filteredTags || []);
  } catch (err) {
    console.error("Error fetching Last.fm tags", err);
    // still build a minimal graph with no tags
    buildTrackGenreGraph(track, []);
  }
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
  // Pin track node to center for better layout
  const trackNode = { 
    id: centralId, 
    label: centralLabel, 
    type: 'track', 
    isCentral: true, 
    trackData: track,
    fx: width / 2,
    fy: height / 2
  };
  add(trackNode);

  // Add tag nodes
  const uniq = Array.from(new Set((tags || []).slice(0, 12))); // Limit to 12 tags for clarity
  uniq.forEach((t) => {
    const id = `TAG:${t}`;
    add({ id, label: t, type: 'tag' });
    links.push({ source: centralId, target: id });
  });

  // Optionally: also add canonical genre nodes for any mapped tags (lightweight)
  // No curated canonical mappings — only track and tag nodes are shown here.

  renderGraph(nodes, links, `Track: ${track.trackName} — ${track.artistName}`);
}


// -------------------------------------------------------
// Build a genre-focused graph: genre node + parents + children
// -------------------------------------------------------
async function buildGenreFocusGraph(genreName, sourceTrack = null, options = {}) {
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

  // If we came from a track, optionally add it as context
  // (visual reference to where this genre came from)
  if (sourceTrack) {
    const trackId = `TRACK:${sourceTrack.trackId || sourceTrack.trackName + ' - ' + (sourceTrack.artistName||'')}`;
    const trackLabel = `${sourceTrack.trackName} — ${sourceTrack.artistName}`;
    add({ 
      id: trackId, 
      label: trackLabel, 
      type: 'track', 
      isContext: true,
      trackData: sourceTrack 
    });
    // Link track to the genre
    const genreId = `GENRE:${name}`;
    links.push({ source: trackId, target: genreId });
  }

  // central genre node
  const centralId = `GENRE:${name}`;
  const centralNode = { id: centralId, label: name, type: 'genre', isCentral: true };
  // preserveTagColor indicates we should keep the tag color (coral) when arriving from a tag
  if (options && options.preserveTagColor) centralNode.preserveTagColor = true;
  add(centralNode);

  // Fetch subgenres from Wikipedia categories
  let subgenres = [];
  try {
    subgenres = await fetchSubgenresFromWikipedia(name, 24);
  } catch (e) {
    console.error('Error fetching subgenres from Wikipedia', e);
  }

  subgenres.forEach((title) => {
    const sid = `SUBGENRE:${title}`;
    add({ id: sid, label: title, type: 'genre' });
    links.push({ source: centralId, target: sid });
  });

  const titleText = sourceTrack 
    ? `${sourceTrack.trackName} → ${name}` 
    : `Genre: ${name}`;

  renderGraph(nodes, links, titleText);

  // Update right-hand info panel with Wikipedia summary + back button
  const infoTitle = document.getElementById('infoTitle');
  const infoContent = document.getElementById('infoContent');
  infoTitle.textContent = name;
  infoContent.innerHTML = `<div class="info-section"><div class="info-label">Overview</div><div class="info-main">Loading summary…</div></div>`;
  try {
    const wiki = await fetchGenreSummaryFromWikipedia(name);
    let wikiSection = `
      ${currentTrack ? `<button id="backToTrackBtn" class="back-btn" style="margin-bottom: 1rem; padding: 0.5rem 1rem; background: #6c5ce7; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;">← Back to track</button>` : ''}
      <div class="info-section"><div class="info-label">${wiki?.title || name}</div><div class="info-main">${wiki?.extract || 'No summary found.'}</div></div>
      ${wiki?.url ? `<div class="info-section"><a href="${wiki.url}" target="_blank" style="color: #64b5f6; text-decoration: underline; font-weight: 500;">Read more on Wikipedia</a></div>` : ''}
    `;
    
    // Only show "On Missing Categories" if Wikipedia knows about it but has no subgenres
    // This indicates it's a real genre with no Wikipedia category structure
    // Check if the Wikipedia page is actually music-related (contains "music" or "genre" keywords)
    const isMusicRelated = wiki && (
      (wiki.title && (wiki.title.toLowerCase().includes('music') || wiki.title.toLowerCase().includes('genre'))) ||
      (wiki.extract && (wiki.extract.toLowerCase().includes('music') || wiki.extract.toLowerCase().includes('genre')))
    );
    
    if (subgenres.length === 0 && isMusicRelated) {
      wikiSection += `
        <div class="info-section" style="margin-top: 2rem; padding: 1rem; border-left: 4px solid #ffd93d; background: rgba(255, 217, 61, 0.08); border-radius: 4px;">
          <div class="info-label" style="color: #ffd93d; font-weight: 600;">On Missing Categories</div>
          <div class="info-main" style="color: #e0e0e0; line-height: 1.6;">
            The absence of "<strong>${name}</strong>" in these classification systems reveals something crucial: 
            music creation is outpacing our ability to categorize it. When genres go unnamed or misclassified, 
            we risk erasing local scenes, severing historical lineage, and flattening the cultural specificity 
            that makes music meaningful. Genre matters—not as a box, but as a story.
          </div>
        </div>
      `;
    }
    
    infoContent.innerHTML = wikiSection;
    // Wire up back button
    const backBtn = document.getElementById('backToTrackBtn');
    if (backBtn && currentTrackHTML) {
      backBtn.addEventListener('click', () => {
        infoContent.innerHTML = currentTrackHTML;
        // Rebuild the original track graph
        if (currentTrack) {
          (async () => {
            try {
              const artist = currentTrack.artistName || 'Unknown artist';
              const [artistTags, trackTags] = await Promise.all([
                fetchArtistTopTags(artist, 12),
                fetchTrackTopTags(artist, currentTrack.trackName || '', 12)
              ]);
              const combined = Array.from(new Set([...(artistTags || []), ...(trackTags || [])]));

              // Filter out artist name and banned tags (same logic as initial load)
              const artistName = (artist || "").toLowerCase().trim();
              const filtered = combined.filter(tag => {
                const n = normalizeTagName(tag);
                return n && n !== artistName && !artistName.includes(n) && !n.includes(artistName) && !LASTFM_BANNED_TAGS.has(n);
              });

              // Re-render genre chips and rebuild graph with filtered tags
              if (filtered.length) renderGenreChips(filtered);
              buildTrackGenreGraph(currentTrack, filtered);
            } catch (e) {
              buildTrackGenreGraph(currentTrack, []);
            }
          })();
        }
      });
    }
  } catch (e) {
    infoContent.innerHTML = `<div class="info-section"><div class="info-label">Summary</div><div class="info-main">Could not fetch summary.</div></div>`;
  }
}
