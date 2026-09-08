const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// ENDPOINTS BASE DAS FONTES
const COTONETE_BASE = 'https://cotonetnet-cotonet.hf.space';
const ANIMACAO_PTPT_BASE = 'https://anima-o-pt-pt-addon-stremio-6dzv.vercel.app';
const GDRIVE_BASE = 'https://pt-pt-gdrive.newptdrive.workers.dev';
const M3U_ANIMATION_URL = 'https://tk26m3u.xyz/API/scraped-data.m3u';

// MANIFESTO DO ADDON STREMIO
const manifest = {
  id: 'org.comunidade.addonunificado.v2',
  version: '1.0.0',
  name: 'Unificado PT-PT (Animação, Filmes & Séries)',
  description: 'Catálogo e streams unificados de fontes PT-PT (Cotonet, GDrive, NP, Tugakids e VidSrc).',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'unificado_movies', name: 'Filmes PT-PT' },
    { type: 'series', id: 'unificado_series', name: 'Séries PT-PT' },
    { type: 'movie', id: 'tugakids_catalog', name: 'Tugakids Animação' }
  ],
  idPrefixes: ['tt', 'm3u_']
};

// CACHE INTERNA DE M3U TUGAKIDS
let m3uCache = [];
let lastM3uFetch = 0;

// HELPER RESILIENTE PARA REQUISIÇÕES HTTP COM USER-AGENT DE NAVEGADOR
async function fetchJson(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    clearTimeout(timer);
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

// PARSER DA LISTA M3U TUGAKIDS
async function getM3uData() {
  const NOW = Date.now();
  // Cache válida por 30 minutos
  if (m3uCache.length > 0 && (NOW - lastM3uFetch < 30 * 60 * 1000)) {
    return m3uCache;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
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
      m3uCache = items;
      lastM3uFetch = NOW;
      return m3uCache;
    }
  } catch (e) {
    console.error('Erro ao carregar M3U Tugakids:', e);
  }
  return m3uCache;
}

// PROCESSADOR DE STREAMS PARA MANTER METADADOS E RESOLVER VÍDEOS
function processStreams(streams, prefix) {
  if (!Array.isArray(streams)) return [];
  return streams.map(s => {
    const origTitle = s.title || s.name || 'PT-PT';
    const updated = {
      ...s, // Preserva headers, behaviorHints, subtitles, etc.
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

// ROTAS BASE
app.get('/', (req, res) => res.send('Addon Stremio PT-PT Unificado Ativo!'));
app.get('/manifest.json', (req, res) => res.json(manifest));

// ROTA DE CATÁLOGOS (/catalog/:type/:id.json OU /catalog/:type/:id/:extra.json)
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  try {
    const { type, id } = req.params;
    const reqType = type === 'series' ? 'series' : 'movie';

    // Catálogo Tugakids M3U
    if (id === 'tugakids_catalog') {
      const m3uItems = await getM3uData();
      return res.json({ metas: m3uItems });
    }

    // Catálogo Unificado (Cotonet, NP PT, GDrive)
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

    // Remove duplicados por ID
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

// ROTA DE METADADOS (/meta/:type/:id.json)
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { id } = req.params;

    if (id.startsWith('m3u_')) {
      const m3uItems = await getM3uData();
      const item = m3uItems.find(i => i.id === id);
      if (item) {
        return res.json({ meta: item });
      }
    }
    
    res.json({ meta: null });
  } catch (err) {
    res.json({ meta: null });
  }
});

// ROTA DE STREAMS (/stream/:type/:id.json)
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const reqType = type === 'series' ? 'series' : 'movie';

    // 1. Caso seja item da lista Tugakids M3U
    if (id.startsWith('m3u_')) {
      const m3uItems = await getM3uData();
      const item = m3uItems.find(i => i.id === id);
      if (item && item.streamUrl) {
        return res.json({
          streams: [
            {
              title: '[Tugakids] Stream Directo PT-PT',
              url: item.streamUrl
            }
          ]
        });
      }
    }

    let realId = id;
    let season = 1;
    let episode = 1;

    if (id.includes(':')) {
      const parts = id.split(':');
      realId = parts[0];
      season = parseInt(parts[1], 10) || 1;
      episode = parseInt(parts[2], 10) || 1;
    }

    // 2. Consulta aos 3 Addons em paralelo
    const results = await Promise.allSettled([
      fetchJson(`${COTONETE_BASE}/stream/${reqType}/${id}.json`),
      fetchJson(`${ANIMACAO_PTPT_BASE}/stream/${reqType}/${id}.json`),
      fetchJson(`${GDRIVE_BASE}/stream/${reqType}/${id}.json`)
    ]);

    let aggregatedStreams = [];

    if (results[0].status === 'fulfilled' && results[0].value?.streams) {
      aggregatedStreams.push(...processStreams(results[0].value.streams, 'Cotonet'));
    }

    if (results[1].status === 'fulfilled' && results[1].value?.streams) {
      aggregatedStreams.push(...processStreams(results[1].value.streams, 'Animação PT'));
    }

    if (results[2].status === 'fulfilled' && results[2].value?.streams) {
      aggregatedStreams.push(...processStreams(results[2].value.streams, 'GDrive'));
    }

    // 3. Fallback VidSrc e VidLink diretos para reprodução no player interno do Stremio
    if (realId.startsWith('tt') || !isNaN(realId)) {
      const isSeries = reqType === 'series';

      const vidsrcUrl = isSeries
        ? `https://vidsrc.pro/embed/tv/${realId}/${season}/${episode}`
        : `https://vidsrc.pro/embed/movie/${realId}`;

      const vidlinkUrl = isSeries
        ? `https://vidlink.pro/tv/${realId}/${season}/${episode}`
        : `https://vidlink.pro/movie/${realId}`;

      aggregatedStreams.push({
        title: '🎬 VidSrc Player (Direct Stremio)',
        url: vidsrcUrl,
        behaviorHints: {
          notSupported: false,
          proxyHeaders: {
            request: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://vidsrc.pro/'
            }
          }
        }
      });

      aggregatedStreams.push({
        title: '🎬 VidLink Player (Direct Stremio)',
        url: vidlinkUrl,
        behaviorHints: {
          notSupported: false
        }
      });
    }

    res.json({ streams: aggregatedStreams });
  } catch (err) {
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Servidor Addon ativo na porta ${PORT}`));
