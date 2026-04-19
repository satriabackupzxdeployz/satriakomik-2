const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://komiku.org/';
const API_BASE = 'https://api.komiku.org/';

const httpClient = axios.create({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  timeout: 15000,
});

function fixLink(link) {
  if (!link) return null;
  return link.startsWith('http') ? link : BASE_URL + link;
}

async function fetchList(url) {
  const { data } = await httpClient.get(url);
  const $ = cheerio.load(data);
  const result = [];

  $('.bge').each((i, el) => {
    const title = $(el).find('h3').text().trim();
    if (!title) return;

    result.push({
      title: title,
      url: fixLink($(el).find('.bgei a').attr('href')),
      thumbnail: $(el).find('img').attr('src'),
      type: $(el).find('.tpe1_inf b').text().trim(),
      genre: $(el).find('.tpe1_inf').text().replace($(el).find('.tpe1_inf b').text(), '').trim(),
      last_update: $(el).find('.up').text().trim(),
      description: $(el).find('p').text().trim(),
      first_chapter: fixLink($(el).find('.new1').eq(0).find('a').attr('href')),
      last_chapter: fixLink($(el).find('.new1').eq(1).find('a').attr('href'))
    });
  });

  return result;
}

async function scrapeHome(type = 'manga', page = 1) {
  const typeMap = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' };
  const keyword = typeMap[type] || type;
  const url = `${API_BASE}?post_type=manga&s=${encodeURIComponent(keyword)}`;
  const data = await fetchList(url);
  return { type, page, data };
}

async function scrapeSearch(query) {
  if (!query) return [];
  const url = `${API_BASE}?post_type=manga&s=${encodeURIComponent(query)}`;
  return await fetchList(url);
}

async function getAllEpisodes(comicUrl) {
  const episodes = [];
  let pageNum = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    try {
      const pageUrl = pageNum === 1 ? comicUrl : `${comicUrl}?page=${pageNum}`;
      const { data } = await httpClient.get(pageUrl);
      const $ = cheerio.load(data);
      let foundEpisodes = 0;

      const selectors = ['#Daftar_Chapter tbody tr', '.chapter-list tr'];
      for (const selector of selectors) {
        if ($(selector).length > 0) {
          $(selector).each((i, el) => {
            if (i === 0 && $(el).find('th').length > 0) return;
            const linkEl = $(el).find('td.judulseries a, a');
            const chapterTitle = linkEl.find('span').text().trim() || linkEl.text().trim();
            const relHref = linkEl.attr('href');
            if (chapterTitle && relHref) {
              const chapterLink = fixLink(relHref);
              const date = $(el).find('td.tanggalseries').text().trim();
              if (!episodes.find(ep => ep.link === chapterLink)) {
                episodes.push({ title: chapterTitle, link: chapterLink, date: date || 'N/A' });
                foundEpisodes++;
              }
            }
          });
          break;
        }
      }

      const nextPageLink = $('a[rel="next"], .next-page');
      const hasNext = nextPageLink.length > 0 && !nextPageLink.hasClass('disabled');

      if (foundEpisodes === 0) {
        hasMorePages = false;
      } else if (!hasNext) {
        hasMorePages = false;
      } else {
        pageNum++;
        if (pageNum > 50 || episodes.length > 1000) hasMorePages = false;
      }
    } catch {
      hasMorePages = false;
    }
  }

  episodes.reverse();

  return episodes;
}

async function scrapeDetail(comicUrl) {
  const { data } = await httpClient.get(comicUrl);
  const $ = cheerio.load(data);

  const title = $('h1 span[itemprop="name"]').text().trim() || $('h1').first().text().trim() || 'N/A';
  const alternative = $('p.j2').text().trim() || 'N/A';
  const thumbnail = $('img[itemprop="image"]').attr('src') || $('.ims img').attr('src') || '';
  const description = $('p[itemprop="description"]').text().trim().replace(/^Komik\s.*?\s-\s-\s/, '') || $('.desc').text().trim() || '';

  const metaInfo = {};
  $('.inftable tr').each((i, el) => {
    const label = $(el).find('td').first().text().trim();
    const value = $(el).find('td').eq(1).text().trim();
    if (label === 'Pengarang') metaInfo.author = value;
    else if (label === 'Status') metaInfo.status = value;
    else if (label === 'Jenis Komik') metaInfo.type = value;
    else if (label === 'Umur Pembaca') metaInfo.age_rating = value;
  });

  const genres = [];
  $('ul.genre li.genre a span[itemprop="genre"], .genre li a span').each((i, el) => {
    const genre = $(el).text().trim();
    if (genre) genres.push(genre);
  });

  const isAdult = genres.some(g => 
    g.toLowerCase().includes('mature') || 
    g.toLowerCase().includes('adult') || 
    g.toLowerCase().includes('18+') ||
    g.toLowerCase().includes('dewasa')
  ) || (metaInfo.age_rating && metaInfo.age_rating.includes('18'));

  const episodes = await getAllEpisodes(comicUrl);

  return {
    url: comicUrl,
    title,
    alternative,
    thumbnail_url: thumbnail,
    full_synopsis: description,
    short_description: description.substring(0, 150) + '...',
    metaInfo,
    genres,
    isAdult,
    total_chapter: episodes.length,
    episodes
  };
}

async function scrapeChapterImages(chapterUrl) {
  const { data } = await httpClient.get(chapterUrl);
  const $ = cheerio.load(data);
  const images = [];
  $('#Baca_Komik img').each((i, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src');
    if (src && src.startsWith('http')) images.push(src);
  });

  const title = $('h1').first().text().trim();

  return {
    title,
    images,
    total_images: images.length
  };
}

module.exports = {
  scrapeHome,
  scrapeSearch,
  scrapeDetail,
  scrapeChapterImages
};const