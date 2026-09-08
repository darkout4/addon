const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// ENDPOINTS DAS SUAS FONTES
const COTONETE_BASE = 'https://cotonetnet-cotonet.hf.space';
const ANIMACAO_PTPT_BASE = 'https://anima-o-pt-pt-addon-stremio-6dzv.vercel.app';
const GDRIVE_BASE = 'https://pt-pt-gdrive.newptdrive.workers.dev';

// MANIFESTO DO ADDON
const manifest = {
  id: 'org.comunidade.addonunificado.render',
  version: '1.0.0',
  name: 'Animação e Filmes PT-PT (Render)',
  description: 'Catálogo unificado com Cotonet, GDrive e NP Animação',
  resources: ['catalog', 'stream'],
  types: ['movie', 'series'],
  catalogs: [
    { type: 'movie', id: 'unificado_movies', name: 'Filmes PT-PT' },
    { type: 'series', id: 'unificado_series', name: 'Séries PT-PT' }
  ]
};

app.get('/', (req, res) => {
  res.send('Addon Stremio Unificado está a funcionar! Adicione /manifest.json ao Stremio.');
});

app.get('/manifest.json', (req, res) => res.json(manifest));

// HELPER FETCH COM TIMEOUT
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

// ROTA DE CATÁLOGO
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

  const uniqueMap = new Map();
  allMetas.forEach(item => {
    if (item.id && !uniqueMap.has(item.id)) {
      uniqueMap.set(item.id, item);
    }
  });

  res.json({ metas: Array.from(uniqueMap.values()) });
});

// ROTA DE STREAMS
app.get('/stream/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const reqType = type === 'series' ? 'series' : 'movie';

  const [cotonetStream, animStream, gdriveStream] = await Promise.all([
    fetchJson(`${COTONETE_BASE}/stream/${reqType}/${id}.json`),
    fetchJson(`${ANIMACAO_PTPT_BASE}/stream/${reqType}/${id}.json`),
    fetchJson(`${GDRIVE_BASE}/stream/${reqType}/${id}.json`)
  ]);

  let aggregatedStreams = [];

  if (cotonetStream?.streams) {
    cotonetStream.streams.forEach(s => {
      if (s.url || s.externalUrl) {
        aggregatedStreams.push({
          title: `[Cotonet] ${s.title || s.name || 'Opção 1'} (PT-PT)`,
          url: s.url || s.externalUrl
        });
      }
    });
  }

  if (gdriveStream?.streams) {
    gdriveStream.streams.forEach(s => {
      if (s.url || s.externalUrl) {
        aggregatedStreams.push({
          title: `[GDrive] ${s.title || s.name || 'Opção 2'} (PT-PT)`,
          url: s.url || s.externalUrl
        });
      }
    });
  }

  if (animStream?.streams) {
    animStream.streams.forEach(s => {
      if (s.url || s.externalUrl) {
        aggregatedStreams.push({
          title: `[NP PT] ${s.title || s.name || 'Opção 3'} (PT-PT)`,
          url: s.url || s.externalUrl
        });
      }
    });
  }

  if (id.startsWith('tt') || !isNaN(id)) {
    const vidsrcUrl = type === 'series' 
      ? `https://vidsrc.me/embed/tv?tmdb=${id}&sub_lang=pt-PT`
      : `https://vidsrc.me/embed/movie?tmdb=${id}&sub_lang=pt-PT`;
    
    aggregatedStreams.push({
      title: '🎥 VidSrc (Legendas PT-PT)',
      url: vidsrcUrl
    });
  }

  res.json({ streams: aggregatedStreams });
});

// O RENDER DEFINE A PORTA ATRAVÉS DA VARIÁVEL DE AMBIENTE process.env.PORT
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`Addon a rodar na porta ${PORT}`);
});
