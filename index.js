// index.js – Addon Stremio PT-PT com TMDB, Addons externos e M3U
// Nuno: estrutura pensada para correr em Node (Stremio Addon SDK) ou Vercel/CF Worker

const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

// -----------------------------------------------------------------------------
// CONFIGURAÇÃO TMDB
// -----------------------------------------------------------------------------

const TMDB_API_KEY = "e55425032d3d0f371fc776f302e7c09b";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

// Tamanhos de imagem usados
const TMDB_POSTER_SIZE = "w342";
const TMDB_BACKDROP_SIZE = "w300";

// -----------------------------------------------------------------------------
// CONFIGURAÇÃO ADDONS EXTERNOS PT-PT (CATÁLOGOS / STREAMS)
// -----------------------------------------------------------------------------

const EXTERNAL_ADDONS = {
  cotonete: {
    base: "https://cotonetnet-cotonet.hf.space",
    supportsMetaSeries: true
  },
  animacaoPt: {
    base: "https://anima-o-pt-pt-addon-stremio-6dzv.vercel.app",
    supportsMetaSeries: false
  },
  ptptGdrive: {
    base: "https://pt-pt-gdrive.newptdrive.workers.dev",
    supportsMetaSeries: false
  }
};

// -----------------------------------------------------------------------------
// CONFIGURAÇÃO PLAYLIST M3U (Tugakids / Animação)
// -----------------------------------------------------------------------------

const M3U_ANIMACAO_URL = "https://tk26m3u.xyz/API/scraped-data.m3u";

// -----------------------------------------------------------------------------
// PROXIES CORS (safeFetchJson)
// -----------------------------------------------------------------------------

const CORS_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

// -----------------------------------------------------------------------------
// FUNÇÃO SAFE FETCH JSON (com proxies e fallback)
// -----------------------------------------------------------------------------

async function safeFetchJson(url, options = {}) {
  // 1. Tentativa direta
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // 2. Tentativas via proxies CORS
    for (const buildProxy of CORS_PROXIES) {
      const proxiedUrl = buildProxy(url);
      try {
        const res = await fetch(proxiedUrl, options);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        // continua para próximo proxy
      }
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// FUNÇÕES TMDB – METADATA
// -----------------------------------------------------------------------------

async function tmdbGet(path, params = {}) {
  const url = new URL(TMDB_BASE_URL + path);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("language", "pt-PT");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return safeFetchJson(url.toString());
}

function tmdbToMeta(type, tmdbItem) {
  // type: "movie" | "series"
  const idPrefix = type === "movie" ? "tmdb:movie:" : "tmdb:series:";
  const id = idPrefix + tmdbItem.id;

  const poster = tmdbItem.poster_path
    ? `${TMDB_IMAGE_BASE}/${TMDB_POSTER_SIZE}${tmdbItem.poster_path}`
    : null;

  const background = tmdbItem.backdrop_path
    ? `${TMDB_IMAGE_BASE}/${TMDB_BACKDROP_SIZE}${tmdbItem.backdrop_path}`
    : null;

  return {
    id,
    type,
    name: tmdbItem.title || tmdbItem.name,
    poster,
    background,
    description: tmdbItem.overview,
    releaseInfo: tmdbItem.release_date || tmdbItem.first_air_date,
    imdbRating: tmdbItem.vote_average ? tmdbItem.vote_average.toFixed(1) : null
  };
}

// -----------------------------------------------------------------------------
// PARSE M3U – LISTA DE ANIMAÇÃO
// -----------------------------------------------------------------------------

async function fetchM3UAnimacao() {
  const res = await fetch(M3U_ANIMACAO_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return parseM3U(text);
}

function parseM3U(m3uText) {
  const lines = m3uText.split("\n");
  const entries = [];
  let current = null;

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    if (l.startsWith("#EXTINF")) {
      // Exemplo: #EXTINF:-1 tvg-id="" tvg-name="Nome" ...
      const nameMatch = l.match(/tvg-name="([^"]+)"/);
      const name = nameMatch ? nameMatch[1] : l.split(",").slice(1).join(",").trim();
      current = { name, url: null };
    } else if (!l.startsWith("#") && current) {
      current.url = l;
      entries.push(current);
      current = null;
    }
  }

  return entries;
}

// -----------------------------------------------------------------------------
// STREAMS – VIDSRC.ME + YOUTUBE FALLBACK + ADDONS EXTERNOS
// -----------------------------------------------------------------------------

function buildVidSrcStream(type, tmdbId, season, episode) {
  if (type === "movie") {
    return {
      title: "VidSrc.me (PT-PT)",
      url: `https://vidsrc.me/embed/movie?tmdb=${tmdbId}&sub_lang=pt-PT&default_lang=pt-PT&ds_lang=pt`,
      behaviorHints: {
        notWebReady: false
      }
    };
  } else {
    return {
      title: "VidSrc.me (PT-PT)",
      url: `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}&sub_lang=pt-PT&default_lang=pt-PT&ds_lang=pt`,
      behaviorHints: {
        notWebReady: false
      }
    };
  }
}

function buildYouTubeFallback(ytId) {
  if (!ytId) return null;
  return {
    title: "YouTube (Trailer / Fallback)",
    url: `https://www.youtube.com/embed/${ytId}?autoplay=1`,
    behaviorHints: {
      notWebReady: false
    }
  };
}

// -----------------------------------------------------------------------------
// STREAMS – ADDONS EXTERNOS PT-PT
// -----------------------------------------------------------------------------

async function fetchExternalAddonStreams(type, id) {
  // type: "movie" | "series"
  const streams = [];

  for (const addon of Object.values(EXTERNAL_ADDONS)) {
    const url = `${addon.base}/stream/${type}/${encodeURIComponent(id)}.json`;
    try {
      const json = await safeFetchJson(url);
      if (Array.isArray(json.streams)) {
        streams.push(...json.streams);
      }
    } catch (e) {
      // ignora falhas individuais
    }
  }

  return streams;
}

// -----------------------------------------------------------------------------
// MANIFEST DO ADDON
// -----------------------------------------------------------------------------

const manifest = {
  id: "org.nuno.ptpt.tmdb.m3u",
  version: "1.0.0",
  name: "PT-PT TMDB + M3U + Addons",
  description: "Addon Stremio com TMDB, streams PT-PT (Cotonete, NP, GDrive) e lista M3U Tugakids.",
  resources: [
    "catalog",
    "meta",
    "stream"
  ],
  types: [
    "movie",
    "series"
  ],
  catalogs: [
    {
      id: "tmdb_trending_movies",
      type: "movie",
      name: "Filmes em Destaque (TMDB)",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false }
      ]
    },
    {
      id: "tmdb_trending_series",
      type: "series",
      name: "Séries em Destaque (TMDB)",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", isRequired: false }
      ]
    },
    {
      id: "animacao_m3u",
      type: "movie",
      name: "Animação Tugakids (M3U)",
      extra: []
    }
  ],
  idPrefixes: [
    "tmdb:movie:",
    "tmdb:series:",
    "m3u:animacao:"
  ]
};

const builder = new addonBuilder(manifest);

// -----------------------------------------------------------------------------
// HANDLER – CATALOG
// -----------------------------------------------------------------------------

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  // Catálogo TMDB – tendências / pesquisa / género
  if (id === "tmdb_trending_movies" && type === "movie") {
    if (extra && extra.search) {
      // Pesquisa TMDB
      const res = await tmdbGet("/search/movie", { query: extra.search });
      const metas = (res.results || []).map(item => tmdbToMeta("movie", item));
      return { metas };
    } else {
      // Tendências semanais
      const res = await tmdbGet("/trending/movie/week");
      const metas = (res.results || []).map(item => tmdbToMeta("movie", item));
      return { metas };
    }
  }

  if (id === "tmdb_trending_series" && type === "series") {
    if (extra && extra.search) {
      const res = await tmdbGet("/search/tv", { query: extra.search });
      const metas = (res.results || []).map(item => tmdbToMeta("series", item));
      return { metas };
    } else {
      const res = await tmdbGet("/trending/tv/week");
      const metas = (res.results || []).map(item => tmdbToMeta("series", item));
      return { metas };
    }
  }

  // Catálogo M3U – animação
  if (id === "animacao_m3u") {
    const entries = await fetchM3UAnimacao();
    const metas = entries.map((entry, index) => ({
      id: `m3u:animacao:${index}`,
      type: "movie",
      name: entry.name,
      poster: null,
      background: null,
      description: "Stream direto de animação (M3U Tugakids)."
    }));
    return { metas };
  }

  return { metas: [] };
});

// -----------------------------------------------------------------------------
// HANDLER – META
// -----------------------------------------------------------------------------

builder.defineMetaHandler(async ({ type, id }) => {
  // id: "tmdb:movie:123" ou "tmdb:series:456" ou "m3u:animacao:idx"
  if (id.startsWith("tmdb:")) {
    const [, tmdbType, tmdbIdStr] = id.split(":");
    const tmdbId = tmdbIdStr;

    if (tmdbType === "movie") {
      const data = await tmdbGet(`/movie/${tmdbId}`);
      const meta = tmdbToMeta("movie", data);
      return { meta };
    } else if (tmdbType === "series") {
      const data = await tmdbGet(`/tv/${tmdbId}`);
      const meta = tmdbToMeta("series", data);

      // Episódios básicos (opcional)
      if (Array.isArray(data.seasons)) {
        meta.videos = [];
        for (const season of data.seasons) {
          if (!season.season_number) continue;
          const seasonData = await tmdbGet(`/tv/${tmdbId}/season/${season.season_number}`);
          if (Array.isArray(seasonData.episodes)) {
            for (const ep of seasonData.episodes) {
              meta.videos.push({
                id: `${tmdbId}:${season.season_number}:${ep.episode_number}`,
                season: season.season_number,
                episode: ep.episode_number,
                title: ep.name,
                overview: ep.overview
              });
            }
          }
        }
      }

      return { meta };
    }
  }

  if (id.startsWith("m3u:animacao:")) {
    const entries = await fetchM3UAnimacao();
    const idx = parseInt(id.split(":")[2], 10);
    const entry = entries[idx];

    if (!entry) return { meta: null };

    const meta = {
      id,
      type: "movie",
      name: entry.name,
      description: "Stream direto de animação (M3U Tugakids).",
      poster: null,
      background: null
    };

    return { meta };
  }

  return { meta: null };
});

// -----------------------------------------------------------------------------
// HANDLER – STREAM
// -----------------------------------------------------------------------------

builder.defineStreamHandler(async ({ type, id }) => {
  const streams = [];

  // TMDB – usar VidSrc.me + Addons externos + YouTube fallback
  if (id.startsWith("tmdb:")) {
    const [, tmdbType, tmdbIdStr] = id.split(":");
    const tmdbId = tmdbIdStr;

    if (tmdbType === "movie") {
      // VidSrc
      streams.push(buildVidSrcStream("movie", tmdbId));

      // Addons externos PT-PT
      const externalStreams = await fetchExternalAddonStreams("movie", tmdbId);
      streams.push(...externalStreams);

      // YouTube fallback (trailer)
      const data = await tmdbGet(`/movie/${tmdbId}`, { append_to_response: "videos" });
      const ytTrailer = (data.videos?.results || []).find(
        v => v.site === "YouTube" && v.type === "Trailer"
      );
      const ytStream = buildYouTubeFallback(ytTrailer?.key);
      if (ytStream) streams.push(ytStream);

      return { streams };
    }

    if (tmdbType === "series") {
      // id de vídeo: "tmdb:series:ID" ou "tmdb:series:ID:season:episode"
      const parts = id.split(":");
      const hasEpisode = parts.length === 5;
      let season = 1;
      let episode = 1;

      if (hasEpisode) {
        season = parseInt(parts[3], 10);
        episode = parseInt(parts[4], 10);
      }

      // VidSrc
      streams.push(buildVidSrcStream("series", tmdbId, season, episode));

      // Addons externos PT-PT
      const externalStreams = await fetchExternalAddonStreams("series", tmdbId);
      streams.push(...externalStreams);

      // YouTube fallback (trailer da série)
      const data = await tmdbGet(`/tv/${tmdbId}`, { append_to_response: "videos" });
      const ytTrailer = (data.videos?.results || []).find(
        v => v.site === "YouTube" && v.type === "Trailer"
      );
      const ytStream = buildYouTubeFallback(ytTrailer?.key);
      if (ytStream) streams.push(ytStream);

      return { streams };
    }
  }

  // M3U – stream direto
  if (id.startsWith("m3u:animacao:")) {
    const entries = await fetchM3UAnimacao();
    const idx = parseInt(id.split(":")[2], 10);
    const entry = entries[idx];

    if (!entry) return { streams: [] };

    streams.push({
      title: entry.name,
      url: entry.url,
      // HLS.js será usado no cliente (WebView) – aqui apenas fornecemos URL .m3u8
      behaviorHints: {
        notWebReady: false
      }
    });

    return { streams };
  }

  return { streams: [] };
});

// -----------------------------------------------------------------------------
// SERVE HTTP
// -----------------------------------------------------------------------------

module.exports = serveHTTP(builder);
