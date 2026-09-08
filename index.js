const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// BASE URLS
const COTONETE_BASE = 'https://cotonetnet-cotonet.hf.space';
const ANIMACAO_PTPT_BASE = 'https://anima-o-pt-pt-addon-stremio-6dzv.vercel.app';
const GDRIVE_BASE = 'https://pt-pt-gdrive.newptdrive.workers.dev';

// MANIFESTO DO ADDON
const manifest = {
  id: 'org.comunidade.addonunificado.v2',
  version: '1.0.0',
  name: 'Animação e Filmes PT-PT',
  description: 'Catálogo unificado PT-PT (Cotonet, GDrive, NP)',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'unificado_movies', name: 'Filmes PT-PT' },
    { type: 'series', id: 'unificado_series', name: 'Séries PT-PT' }
  ]
};

app.get('/', (req, res) => res.send('Addon Stremio PT-PT ativo!'));
app.get('/manifest.json', (req, res) => res.json(manifest));

// Helper seguro para fetch com User-Agent (evita bloqueios de Vercel/Cloudflare)
async function fetchJson(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
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

// Helper para processar streams SEM perder metadados (Headers, Subtitles, behaviorHints)
function processStreams(streams, prefix) {
  if (!Array.isArray(streams)) return [];
  return streams.map(s => {
    const origTitle = s.title || s.name || 'PT-PT';
    const updatedStream = {
      ...s, // Preserva headers, behaviorHints, subtitles, etc.
      title: `[${prefix}] ${origTitle}`
    };

    // Se a stream apenas contiver externalUrl para um ficheiro direto (.m3u8/.mp4), converte para url
    if (!updatedStream.url && updatedStream.externalUrl) {
      if (updatedStream.externalUrl.match(/\.(m3u8|mp4|mkv)(\?.*)?$/i)) {
        updatedStream.url = updatedStream.externalUrl;
        delete updatedStream.externalUrl;
      }
    }

    return updatedStream;
  });
}

// ROTA DE CATÁLOGOS (UNIFICADO)
app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    const { type } = req.params;
    const reqType = type === 'series' ? 'series' : 'movie';

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

// ROTA DE STREAMS
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const reqType = type === 'series' ? 'series' : 'movie';

    let realId = id;
    let season = 1;
    let episode = 1;

    if (id.includes(':')) {
      const parts = id.split(':');
      realId = parts[0];
      season = parseInt(parts[1], 10) || 1;
      episode = parseInt(parts[2], 10) || 1;
    }

    const results = await Promise.allSettled([
      fetchJson(`${COTONETE_BASE}/stream/${reqType}/${id}.json`),
      fetchJson(`${ANIMACAO_PTPT_BASE}/stream/${reqType}/${id}.json`),
      fetchJson(`${GDRIVE_BASE}/stream/${reqType}/${id}.json`)
    ]);

    let aggregatedStreams = [];

    // Cotonet
    if (results[0].status === 'fulfilled' && results[0].value?.streams) {
      aggregatedStreams.push(...processStreams(results[0].value.streams, 'Cotonet'));
    }

    // Animação PT-PT
    if (results[1].status === 'fulfilled' && results[1].value?.streams) {
      aggregatedStreams.push(...processStreams(results[1].value.streams, 'Animação PT'));
    }

    // GDrive
    if (results[2].status === 'fulfilled' && results[2].value?.streams) {
      aggregatedStreams.push(...processStreams(results[2].value.streams, 'GDrive'));
    }

    // VidSrc / External Players (Reprodução Direta dentro do Stremio)
    if (realId.startsWith('tt') || !isNaN(realId)) {
      const isSeries = reqType === 'series';

      // 1. VidSrc Direct
      const vidsrcUrl = isSeries
        ? `https://vidsrc.pro/embed/tv/${realId}/${season}/${episode}`
        : `https://vidsrc.pro/embed/movie/${realId}`;

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

      // 2. VidLink (Alternativa fluida no Stremio)
      const vidlinkUrl = isSeries
        ? `https://vidlink.pro/tv/${realId}/${season}/${episode}`
        : `https://vidlink.pro/movie/${realId}`;

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
app.listen(PORT, () => console.log(`Servidor ativo na porta ${PORT}`));
