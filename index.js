const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// BASE URLS DAS SUAS FONTES
const COTONETE_BASE = 'https://cotonetnet-cotonet.hf.space';
const ANIMACAO_PTPT_BASE = 'https://anima-o-pt-pt-addon-stremio-6dzv.vercel.app';
const GDRIVE_BASE = 'https://pt-pt-gdrive.newptdrive.workers.dev';

// MANIFESTO DO ADDON
const manifest = {
  id: 'org.comunidade.addonunificado.render',
  version: '1.0.0',
  name: 'Animação e Filmes PT-PT',
  description: 'Catálogo unificado com Cotonet, GDrive, NP Animação e VidSrc',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'unificado_movies', name: 'Filmes PT-PT' },
    { type: 'series', id: 'unificado_series', name: 'Séries PT-PT' }
  ]
};

// Rota inicial de teste e manifesto
app.get('/', (req, res) => {
  res.send('Addon do Stremio Unificado online! Adicione /manifest.json ao Stremio.');
});

app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Helper seguro para chamadas de API com timeout de 5s
async function fetchJson(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

// Extrator direto de ficheiros .m3u8 do VidSrc
async function getVidSrcDirectStream(tmdbId, type = 'movie', season = 1, episode = 1) {
  try {
    const endpoint = type === 'series'
      ? `https://vidsrc.xyz/embed/tv/${tmdbId}/${season}/${episode}`
      : `https://vidsrc.xyz/embed/movie/${tmdbId}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://vidsrc.xyz/'
      }
    });
    clearTimeout(timer);

    if (!response.ok) return null;
    const html = await response.text();

    // Procura por links diretos .m3u8 no código do player
    const m3u8Match = html.match(/(https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)/i);

    if (m3u8Match && m3u8Match[1]) {
      return {
        url: m3u8Match[1],
        referer: 'https://vidsrc.xyz/'
      };
    }
  } catch (e) {}
  return null;
}

// ROTA DE CATÁLOGOS UNIFICADOS
app.get('/catalog/:type/:id.json', async (req, res) => {
  const { type } = req.params;
  const reqType = type === 'series' ? 'series' : 'movie';

  const [cotonetData, animData, gdriveData] = await Promise.all([
    fetchJson(`${COTONETE_BASE}/catalog/${reqType}/cotonet.json`),
    fetchJson(`${ANIMACAO_PTPT_BASE}/catalog/${reqType}/catalog.json`),
    fetchJson(`${GDRIVE_BASE}/catalog/${reqType}/catalog.json`)
  ]);

  let allMetas = [];
  if (cotonetData?.metas) allMetas.push(...cotonetData.metas);
  if (animData?.metas) allMetas.push(...animData.metas);
  if (gdriveData?.metas) allMetas.push(...gdriveData.metas);

  // Remove duplicados mantendo o primeiro ID encontrado
  const uniqueMap = new Map();
  allMetas.forEach(item => {
    if (item.id && !uniqueMap.has(item.id)) {
      uniqueMap.set(item.id, item);
    }
  });

  res.json({ metas: Array.from(uniqueMap.values()) });
});

// ROTA DE STREAMS UNIFICADOS
app.get('/stream/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const reqType = type === 'series' ? 'series' : 'movie';

  // Processa o formato de IDs de séries do Stremio (ex: tt123456:1:2)
  let realId = id;
  let season = 1;
  let episode = 1;

  if (id.includes(':')) {
    const parts = id.split(':');
    realId = parts[0];
    season = parseInt(parts[1], 10) || 1;
    episode = parseInt(parts[2], 10) || 1;
  }

  // Consulta todas as fontes em paralelo
  const [cotonetStream, animStream, gdriveStream, vidsrcDirect] = await Promise.all([
    fetchJson(`${COTONETE_BASE}/stream/${reqType}/${id}.json`),
    fetchJson(`${ANIMACAO_PTPT_BASE}/stream/${reqType}/${id}.json`),
    fetchJson(`${GDRIVE_BASE}/stream/${reqType}/${id}.json`),
    getVidSrcDirectStream(realId, reqType, season, episode)
  ]);

  let aggregatedStreams = [];

  // 1. Cotonet
  if (cotonetStream?.streams) {
    cotonetStream.streams.forEach(s => {
      if (s.url) {
        aggregatedStreams.push({
          title: `[Cotonet] ${s.title || s.name || 'Servidor 1'} (PT-PT)`,
          url: s.url
        });
      }
    });
  }

  // 2. GDrive PT
  if (gdriveStream?.streams) {
    gdriveStream.streams.forEach(s => {
      if (s.url) {
        aggregatedStreams.push({
          title: `[GDrive] ${s.title || s.name || 'Servidor 2'} (PT-PT)`,
          url: s.url
        });
      }
    });
  }

  // 3. NP Animação PT
  if (animStream?.streams) {
    animStream.streams.forEach(s => {
      if (s.url) {
        aggregatedStreams.push({
          title: `[NP PT] ${s.title || s.name || 'Servidor 3'} (PT-PT)`,
          url: s.url
        });
      }
    });
  }

  // 4. VidSrc Direto (.m3u8) para reprodução no leitor interno do Stremio
  if (vidsrcDirect && vidsrcDirect.url) {
    aggregatedStreams.push({
      title: '🎥 VidSrc Player Nativo (Legendas PT)',
      url: vidsrcDirect.url,
      behaviorHints: {
        notSupported: false,
        requestHeaders: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': vidsrcDirect.referer
        }
      }
    });
  }

  // 5. VidSrc Fallback (Navegador Externo caso o leitor nativo falhe)
  if (realId.startsWith('tt') || !isNaN(realId)) {
    const vidsrcEmbedUrl = reqType === 'series'
      ? `https://vidsrc.me/embed/tv?tmdb=${realId}&season=${season}&episode=${episode}&sub_lang=pt-PT`
      : `https://vidsrc.me/embed/movie?tmdb=${realId}&sub_lang=pt-PT`;

    aggregatedStreams.push({
      title: '🌐 VidSrc (Abrir no Navegador)',
      externalUrl: vidsrcEmbedUrl
    });
  }

  res.json({ streams: aggregatedStreams });
});

// A porta é gerida automaticamente pelo Render (process.env.PORT)
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Addon Stremio ativo na porta ${PORT}`);
});
