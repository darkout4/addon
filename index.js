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

// Helper com timeout ajustado para 6 segundos (ideal para HuggingFace cold starts)
async function fetchJson(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

// ROTA DE CATÁLOGOS
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

// ROTA DE STREAMS (CORRIGIDA)
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

    const encodedId = encodeURIComponent(id);

    const results = await Promise.allSettled([
      fetchJson(`${COTONETE_BASE}/stream/${reqType}/${encodedId}.json`),
      fetchJson(`${ANIMACAO_PTPT_BASE}/stream/${reqType}/${encodedId}.json`),
      fetchJson(`${GDRIVE_BASE}/stream/${reqType}/${encodedId}.json`)
    ]);

    let aggregatedStreams = [];

    const sources = [
      { res: results[0], tag: 'Cotonet' },
      { res: results[1], tag: 'NP PT' },
      { res: results[2], tag: 'GDrive' }
    ];

    sources.forEach(({ res, tag }) => {
      if (res.status === 'fulfilled' && res.value?.streams && Array.isArray(res.value.streams)) {
        res.value.streams.forEach(s => {
          if (!s) return;

          // Clona o objeto original para NÃO perder headers, behaviorHints, etc.
          const streamObj = { ...s };

          // Define a tag/nome da fonte e o título
          streamObj.name = `[${tag}]`;
          streamObj.title = s.title || s.name || 'Áudio PT-PT';

          aggregatedStreams.push(streamObj);
        });
      }
    });

    // VidSrc como opção secundária (Abrir apenas no Navegador)
    if (realId.startsWith('tt') || !isNaN(realId)) {
      const vidsrcEmbedUrl = reqType === 'series'
        ? `https://vidsrc.me/embed/tv?tmdb=${realId}&season=${season}&episode=${episode}&sub_lang=pt-PT`
        : `https://vidsrc.me/embed/movie?tmdb=${realId}&sub_lang=pt-PT`;

      aggregatedStreams.push({
        name: '[VidSrc]',
        title: '🌐 Player Web (Abrir no Navegador Externo)',
        externalUrl: vidsrcEmbedUrl
      });
    }

    res.json({ streams: aggregatedStreams });
  } catch (err) {
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Servidor ativo na porta ${PORT}`));
