const express = require('express');
const cors = require('cors');

const app = express();

// 1. Configuração de CORS permissiva para Stremio (Web, Desktop, Android, TV)
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// ENDPOINTS BASE DAS FONTES PT-PT
const COTONETE_BASE = 'https://cotonetnet-cotonet.hf.space';
const ANIMACAO_PTPT_BASE = 'https://anima-o-pt-pt-addon-stremio-6dzv.vercel.app';
const GDRIVE_BASE = 'https://pt-pt-gdrive.newptdrive.workers.dev';
const M3U_ANIMATION_URL = 'https://tk26m3u.xyz/API/scraped-data.m3u';

// SERVIDORES EMBED (Configurados com externalUrl para abrir no navegador/player externo)
const EMBED_PROVIDERS = [
  {
    name: 'VidSrc.pro',
    getMovie: (id) => `https://vidsrc.pro/embed/movie/${id}`,
    getTv: (id, s, e) => `https://vidsrc.pro/embed/tv/${id}/${s}/${e}`
  },
  {
    name: 'VidLink.pro',
    getMovie: (id) => `https://vidlink.pro/movie/${id}?primaryColor=e50914`,
    getTv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}?primaryColor=e50914`
  },
  {
    name: 'VidSrc.cc',
    getMovie: (id) => `https://vidsrc.cc/v2/embed/movie/${id}?autoPlay=true`,
    getTv: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}?autoPlay=true`
  },
  {
    name: 'AutoEmbed',
    getMovie: (id) => `https://autoembed.co/movie/tmdb/${id}`,
    getTv: (id, s, e) => `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`
  },
  {
    name: 'VidSrc.xyz',
    getMovie: (id) => `https://vidsrc.xyz/embed/movie?tmdb=${id}&sub_lang=pt-PT`,
    getTv: (id, s, e) => `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}&sub_lang=pt-PT`
  }
];

// MANIFESTO DO ADDON
// REMOVIDO 'meta' dos resources! O Cinemeta oficial do Stremio cuida dos metadados IMDb (tt...).
const manifest = {
  id: 'org.comunidade.addonunificado.v3',
  version: '1.3.0',
  name: 'Unificado PT-PT + VidSrc Multi-Embed',
  description: 'Catálogo e streams unificados de fontes PT-PT (Cotonet, GDrive, NP, Tugakids) e VidSrc Multi-Server.',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'unificado_movies', name: 'Filmes PT-PT' },
    { type: 'series', id: 'unificado_series', name: 'Séries PT-PT' },
    { type: 'movie', id: 'tugakids_catalog', name: 'Tugakids Animação' }
  ],
  idPrefixes: ['tt', 'm3u_']
};

// CACHE DA LISTA M3U TUGAKIDS
let m3uCache = [];
let lastM3uFetch = 0;

// HELPER RESILIENTE (Timeout expandido para 10s para aguentar cold-starts do HuggingFace)
async function fetchJson(url, timeoutMs = 10000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    clearTimeout(timer);
    if (res.ok) return await res.json();
  } catch (e) {
    // Falhas em fontes individuais são ignoradas silenciosamente
  }
  return null;
}

// PARSER M3U TUGAKIDS
async function getM3uData() {
  const NOW = Date.now();
  if (m3uCache.length > 0 && (NOW - lastM3uFetch < 30 * 60 * 1000)) {
    return m3uCache;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(M3U_ANIMATION_URL, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const text = await res.text();
      const lines = text.split(/\r?\n/);
      const items = [];
      let currentTitle = '';
      let currentLogo = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF')) {
          const commaIdx = line.indexOf(',');
          if (commaIdx !== -1) currentTitle = line.substring(commaIdx + 1).trim();
          const logoMatch = line.match(/tvg-logo="([^"]+)"/);
          currentLogo = logoMatch ? logoMatch[1] : '';
        } else if (line.startsWith('http://') || line.startsWith('https://')) {
          const id = `m3u_${items.length}`;
          items.push({
            id: id,
            type: 'movie',
            name: currentTitle || 'Tugakids',
            poster: currentLogo || 'https://via.placeholder.com/300x450?text=Tugakids',
            description: 'Transmissão em Português PT-PT - Tugakids',
            streamUrl: line
          });
          currentTitle = '';
          currentLogo = '';
        }
      }
      if (items.length > 0) {
        m3uCache = items;
        lastM3uFetch = NOW;
      }
    }
  } catch (e) {
    console.error('Erro no M3U Tugakids:', e.message);
  }
  return m3uCache;
}

// FORMATADOR DE STREAMS
function processStreams(streams, prefix) {
  if (!Array.isArray(streams)) return [];
  return streams.map(s => {
    const origTitle = s.title || s.name || 'PT-PT';
    const updated = {
      ...s,
      title: `[${prefix}] ${origTitle}`
    };

    if (!updated.url && updated.externalUrl) {
      if (updated.externalUrl.match(/\.(m3u8|mp4|mkv)(\?.*)?$/i)) {
        updated.url = updated.externalUrl;
        delete updated.externalUrl;
      }
    }
    return updated;
  });
}

// ROTAS
app.get('/', (req, res) => res.send('Addon Stremio PT-PT Unificado Funcional!'));
app.get('/manifest.json', (req, res) => res.json(manifest));

// ROTA DE CATÁLOGOS (Captura flexível de sub-rotas e .json)
app.get('/catalog/:type/:id*', async (req, res) => {
  try {
    const type = req.params.type;
    const reqType = type === 'series' ? 'series' : 'movie';
    let id = (req.params.id || '').replace(/\.json$/i, '');

    // 1. Catálogo M3U Tugakids
    if (id === 'tugakids_catalog') {
      const m3uItems = await getM3uData();
      return res.json({ metas: m3uItems });
    }

    // 2. Catálogos agregados PT-PT
    const results = await Promise.allSettled([
      fetchJson(`${COTONETE_BASE}/catalog/${reqType}/cotonet.json`),
      fetchJson(`${ANIMACAO_PTPT_BASE}/catalog/${reqType}/catalog.json`),
      fetchJson(`${GDRIVE_BASE}/catalog/${reqType}/catalog.json`)
    ]);

    let allMetas = [];
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value?.metas) {
        allMetas.push(...result.value.metas);
      }
    });

    // Remover itens duplicados por ID
    const uniqueMap = new Map();
    allMetas.forEach(item => {
      if (item && item.id && !uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    });

    res.json({ metas: Array.from(uniqueMap.values()) });
  } catch (err) {
    res.json({ metas: [] });
  }
});

// ROTA DE STREAMS (Tratamento limpo de IDs IMDb tt... e m3u_)
app.get('/stream/:type/:id*', async (req, res) => {
  try {
    const type = req.params.type;
    const reqType = type === 'series' ? 'series' : 'movie';
    let cleanId = (req.params.id || '').replace(/\.json$/i, '');

    // 1. Stream M3U Tugakids
    if (cleanId.startsWith('m3u_')) {
      const m3uItems = await getM3uData();
      const item = m3uItems.find(i => i.id === cleanId);
      if (item && item.streamUrl) {
        return res.json({
          streams: [
            {
              title: '[Tugakids] Stream Direto PT-PT',
              url: item.streamUrl
            }
          ]
        });
      }
    }

    // Extrair ID, Temporada e Episódio (ex: tt0944947:1:1)
    let realId = cleanId;
    let season = 1;
    let episode = 1;

    if (cleanId.includes(':')) {
      const parts = cleanId.split(':');
      realId = parts[0];
      season = parseInt(parts[1], 10) || 1;
      episode = parseInt(parts[2], 10) || 1;
    }

    // 2. Consulta paralela aos Addons PT-PT
    const results = await Promise.allSettled([
      fetchJson(`${COTONETE_BASE}/stream/${reqType}/${cleanId}.json`),
      fetchJson(`${ANIMACAO_PTPT_BASE}/stream/${reqType}/${cleanId}.json`),
      fetchJson(`${GDRIVE_BASE}/stream/${reqType}/${cleanId}.json`)
    ]);

    let aggregatedStreams = [];

    if (results[0].status === 'fulfilled' && results[0].value?.streams) {
      aggregatedStreams.push(...processStreams(results[0].value.streams, 'Cotonet PT'));
    }

    if (results[1].status === 'fulfilled' && results[1].value?.streams) {
      aggregatedStreams.push(...processStreams(results[1].value.streams, 'NP PT'));
    }

    if (results[2].status === 'fulfilled' && results[2].value?.streams) {
      aggregatedStreams.push(...processStreams(results[2].value.streams, 'GDrive PT'));
    }

    // 3. Servidores VidSrc Embed (External Links)
    if (realId.startsWith('tt') || !isNaN(realId)) {
      const isSeries = reqType === 'series';

      EMBED_PROVIDERS.forEach(provider => {
        const embedUrl = isSeries
          ? provider.getTv(realId, season, episode)
          : provider.getMovie(realId);

        aggregatedStreams.push({
          title: `🌐 [${provider.name}] Player Web External`,
          externalUrl: embedUrl
        });
      });
    }

    res.json({ streams: aggregatedStreams });
  } catch (err) {
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Servidor Addon ativo na porta ${PORT}`));
