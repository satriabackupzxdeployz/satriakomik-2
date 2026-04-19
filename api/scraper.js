const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://komiku.org/';

const httpClient = axios.create({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  timeout: 15000,
});

function getAbsoluteUrl(relativePath) {
  try {
    if (!relativePath) return null;
    if (relativePath.startsWith('http')) return relativePath;
    return new URL(relativePath, BASE_URL).href;
  } catch {
    return relativePath;
  }
}

async function scrapeSearch(keyword) {
  const url = `https://api.komiku.org/?post_type=manga&s=${encodeURIComponent(keyword)}`;
  const { data } = await httpClient.get(url);
  const $ = cheerio.load(data);
  const mangas = [];
  $('.bge').each((i, el) => {
    const bgei = $(el).find('.bgei > a');
    const href = bgei.attr('href');
    const thumbnail = bgei.find('img').attr('src');
    const tipeGenreText = bgei.find('.tpe1_inf').text().trim();
    const tipe = bgei.find('b').text().trim();
    const genre = tipeGenreText.replace(tipe, '').trim();
    const title = $(el).find('.kan > a > h3').text().trim();
    const last_update = $(el).find('.kan > p').text().trim();
    if (title) {
      mangas.push({
        url: href ? `https://komiku.org${href}` : null,
        thumbnail,
        type: tipe,
        genre,
        genres: genre ? [genre] : [],
        title,
        last_update,
      });
    }
  });
  return mangas;
}

async function scrapeByType(type) {
  const typeMap = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' };
  const keyword = typeMap[type] || type;
  const url = `https://api.komiku.org/?post_type=manga&s=${encodeURIComponent(keyword)}`;
  const { data } = await httpClient.get(url);
  const $ = cheerio.load(data);
  const mangas = [];
  $('.bge').each((i, el) => {
    const bgei = $(el).find('.bgei > a');
    const href = bgei.attr('href');
    const thumbnail = bgei.find('img').attr('src');
    const tipeText = bgei.find('b').text().trim();
    if (tipeText.toLowerCase() !== keyword.toLowerCase()) return;
    const tipeGenreText = bgei.find('.tpe1_inf').text().trim();
    const genre = tipeGenreText.replace(tipeText, '').trim();
    const title = $(el).find('.kan > a > h3').text().trim();
    if (title) {
      mangas.push({
        url: href ? `https://komiku.org${href}` : null,
        thumbnail,
        type: tipeText,
        genre,
        title,
      });
    }
  });
  return mangas;
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
              const chapterLink = getAbsoluteUrl(relHref);
              const views = $(el).find('td.pembaca i').text().trim();
              const date = $(el).find('td.tanggalseries').text().trim();
              if (!episodes.find(ep => ep.link === chapterLink)) {
                episodes.push({ title: chapterTitle, link: chapterLink, views: views || 'N/A', release_date: date || 'N/A', date: date || 'N/A' });
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
  const details = { url: comicUrl };

  details.title = $('h1 span[itemprop="name"]').text().trim() || $('h1').first().text().trim() || 'N/A';
  details.title_indonesian = $('p.j2').text().trim() || 'N/A';
  details.short_description = $('p[itemprop="description"]').text().trim().replace(/^Komik\s.*?\s-\s-\s/, '') || '';
  details.full_synopsis = $('section#Sinopsis p').first().text().trim() || details.short_description || 'Tidak ada sinopsis.';

  details.metaInfo = {};
  $('.inftable tr').each((i, el) => {
    const label = $(el).find('td').first().text().trim();
    const value = $(el).find('td').eq(1).text().trim();
    if (label === 'Pengarang') details.metaInfo.author = value;
    else if (label === 'Status') details.metaInfo.status = value;
    else if (label === 'Jenis Komik') details.metaInfo.type = value;
    else if (label === 'Umur Pembaca') details.metaInfo.age_rating = value;
  });

  details.genres = [];
  $('ul.genre li.genre a span[itemprop="genre"]').each((i, el) => {
    details.genres.push($(el).text().trim());
  });

  details.isAdult = details.genres.some(g => 
    g.toLowerCase().includes('mature') || 
    g.toLowerCase().includes('adult') || 
    g.toLowerCase().includes('18+') ||
    g.toLowerCase().includes('dewasa')
  ) || (details.metaInfo.age_rating && details.metaInfo.age_rating.includes('18'));

  details.thumbnail_url = $('img[itemprop="image"]').attr('src') || '';
  details.episodes = await getAllEpisodes(comicUrl);

  return details;
}

async function scrapeChapterImages(chapterUrl) {
  const { data } = await httpClient.get(chapterUrl);
  const $ = cheerio.load(data);
  const images = [];
  $('#Baca_Komik img').each((i, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src');
    if (src && src.startsWith('http')) images.push(src);
  });
  return images;
}

module.exports = { scrapeSearch, scrapeByType, scrapeDetail, scrapeChapterImages };