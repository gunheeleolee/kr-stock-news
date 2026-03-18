require('dotenv').config({ override: true });
const express = require('express');
const RSSParser = require('rss-parser');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const parser = new RSSParser();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const IS_VERCEL = process.env.VERCEL === '1';
const CACHE_FILE = 'cache.json';
let memoryCache = [];
let lastFetched = null;
let marketCache = null;
let marketLastFetched = null;

const CACHE_DURATION = 30 * 60 * 1000;
const MARKET_CACHE_DURATION = 5 * 60 * 1000;

const SOURCES = [
  { name: '한국경제', url: 'https://www.hankyung.com/feed/all-news' },
  { name: '매일경제', url: 'https://www.mk.co.kr/rss/30000001/' },
  { name: '연합인포맥스', url: 'https://news.einfomax.co.kr/rss/S1N1.xml' },
  { name: '뉴스핌', url: 'https://www.newspim.com/rss' },
  { name: '이데일리', url: 'https://www.edaily.co.kr/rss/edaily_news.xml' },
];

// 로컬에서만 파일 캐시 불러오기
if (!IS_VERCEL && fs.existsSync(CACHE_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    memoryCache = saved.cache || [];
    lastFetched = saved.lastFetched || null;
    console.log(`파일 캐시 불러옴 (${memoryCache.length}개 기사)`);
  } catch (e) {
    console.log('파일 캐시 불러오기 실패');
  }
}

async function fetchMarketData() {
  const now = Date.now();
  if (marketLastFetched && now - marketLastFetched < MARKET_CACHE_DURATION && marketCache) {
    return marketCache;
  }
  try {
    const symbols = [
      '^KS11', '^KQ11',
      '005930.KS', '000660.KS', '373220.KS', '005380.KS', '035420.KS', '035720.KS', '006400.KS'
    ];
    const query = symbols.join(',');
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(query)}&range=1d&interval=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      }
    );

    const data = response.data;
    const SYMBOL_NAMES = {
      '^KS11': 'KOSPI', '^KQ11': 'KOSDAQ',
      '005930.KS': '삼성전자', '000660.KS': 'SK하이닉스',
      '373220.KS': 'LG에너지솔루션', '005380.KS': '현대차',
      '035420.KS': 'NAVER', '035720.KS': '카카오', '006400.KS': '삼성SDI'
    };
    marketCache = symbols.map(sym => {
      const info = data[sym];
      if (!info) return null;
      const close = info.close?.[info.close.length - 1];
      const prevClose = info.chartPreviousClose;
      const change = prevClose ? ((close - prevClose) / prevClose * 100) : 0;
      return {
        symbol: SYMBOL_NAMES[sym] || sym,
        price: close,
        change,
        isIndex: sym.startsWith('^')
      };
    }).filter(Boolean);
    marketLastFetched = now;
    return marketCache;
  } catch (e) {
    console.log('시장 데이터 가져오기 실패:', e.message);
    return [];
  }
}

async function fetchVKOSPI() {
  try {
    const response = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent('^VKOSPI')}&range=1d&interval=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      }
    );
    const info = response.data['^VKOSPI'];
    if (!info) return null;
    const value = info.close?.[info.close.length - 1];
    if (!value) return null;

    let classification;
    if (value <= 15) classification = 'Extreme Greed';
    else if (value <= 20) classification = 'Greed';
    else if (value <= 25) classification = 'Neutral';
    else if (value <= 35) classification = 'Fear';
    else classification = 'Extreme Fear';

    return { value: Math.round(value * 10) / 10, classification };
  } catch (e) {
    console.log('VKOSPI 가져오기 실패:', e.message);
    return null;
  }
}

async function generateMarketAnalysis(news, vkospi) {
  const signalCount = {
    긍정: news.filter(n => n.signal === '긍정').length,
    부정: news.filter(n => n.signal === '부정').length,
    중립: news.filter(n => n.signal === '중립').length
  };

  const topNews = news.slice(0, 5).map((n, i) =>
    `${i + 1}. [${n.signal}] ${n.koreanTitle}`
  ).join('\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `아래 데이터를 기반으로 한국 주식 시장 단기 방향성을 분석해줘.

VKOSPI(변동성지수): ${vkospi?.value || '알 수 없음'} (${vkospi?.classification || ''})
뉴스 시그널: 긍정 ${signalCount.긍정}건, 부정 ${signalCount.부정}건, 중립 ${signalCount.중립}건
주요 뉴스:
${topNews}

아래 형식으로만 출력해줘:
방향성: (강한상승 또는 약한상승 또는 중립 또는 약한하락 또는 강한하락 중 하나)
분석: (2~3문장으로 핵심만. 왜 이런 방향성인지 근거 포함)
주목변수: (오늘 가장 주목해야 할 변수 한 줄)`
    }]
  });
  return message.content[0].text;
}

async function summarizeAndScore(title, content) {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `아래 한국 주식 관련 기사를 분석해줘.

제목: ${title}
본문: ${content}

아래 형식으로만 출력해줘:
요약: (본문을 5문장 내외로 요약. 핵심 내용을 충실하게 담아줘)
중요도: (1~5 숫자만. 기준: 5=한국은행 금리/정부 정책/시장 전체 영향, 4=대형 실적발표/M&A/기관 동향, 3=섹터 트렌드/일반 시장 동향, 2=개별 종목/특정 기업 뉴스, 1=단순 정보/오피니언)
시그널: (긍정 또는 부정 또는 중립 중 하나만)
태그: (기사에서 언급된 종목명 또는 섹터. 예: 삼성전자,SK하이닉스,반도체 / 없으면 없음)`
    }]
  });
  return message.content[0].text;
}

async function fetchAllNews() {
  const now = Date.now();

  if (lastFetched && now - lastFetched < CACHE_DURATION && memoryCache.length > 0) {
    console.log('메모리 캐시 사용');
    return memoryCache;
  }

  console.log('새 데이터 확인 중...');

  const { data: existingArticles } = await supabase
    .from('articles')
    .select('url');

  const existingUrls = new Set((existingArticles || []).map(a => a.url));

  const newItems = [];

  for (const source of SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      const items = feed.items.slice(0, 5);

      for (const item of items) {
        if (existingUrls.has(item.link)) {
          console.log(`건너뜀 (DB에 있음): ${item.title}`);
          continue;
        }

        const content = item.contentSnippet || item.content || '';
        if (!content || content.trim().length < 50) {
          console.log(`건너뜀 (본문 없음): ${item.title}`);
          continue;
        }

        console.log(`분석 중: ${item.title}`);
        const result = await summarizeAndScore(item.title, content);
        console.log(`분석 완료: ${item.title}`);

        const lines = result.split('\n').filter(l => l.trim());
        const summary = lines.find(l => l.startsWith('요약:'))?.replace('요약:', '').trim();
        const scoreText = lines.find(l => l.startsWith('중요도:'))?.replace('중요도:', '').trim();
        const signal = lines.find(l => l.startsWith('시그널:'))?.replace('시그널:', '').trim();
        const tagText = lines.find(l => l.startsWith('태그:'))?.replace('태그:', '').trim();
        const tags = tagText && tagText !== '없음' ? tagText.split(',').map(t => t.trim()) : [];
        const score = parseInt(scoreText) || 3;

        const newArticle = {
          url: item.link,
          original_title: item.title,
          korean_title: item.title,
          summary,
          source: source.name,
          score,
          signal,
          tags,
          pub_date: item.pubDate
        };

        await supabase.from('articles').insert(newArticle);
        console.log(`DB 저장 완료: ${item.title}`);

        newItems.push({
          originalTitle: item.title,
          koreanTitle: item.title,
          summary,
          link: item.link,
          date: item.pubDate,
          source: source.name,
          score,
          signal,
          tags
        });
      }
    } catch (e) {
      console.log(`${source.name} RSS 가져오기 실패:`, e.message);
    }
  }

  const { data: allArticles } = await supabase
    .from('articles')
    .select('*')
    .order('score', { ascending: false })
    .order('pub_date', { ascending: false })
    .limit(50);

  memoryCache = (allArticles || []).map(a => ({
    originalTitle: a.original_title,
    koreanTitle: a.korean_title,
    summary: a.summary,
    link: a.url,
    date: a.pub_date,
    source: a.source,
    score: a.score,
    signal: a.signal,
    tags: a.tags || []
  }));

  lastFetched = now;

  if (!IS_VERCEL) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ cache: memoryCache, lastFetched }));
    console.log(`파일 캐시 저장 완료`);
  }

  return memoryCache;
}

async function generateDailyBrief(news) {
  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await supabase
    .from('briefs')
    .select('*')
    .eq('brief_date', today)
    .single();

  const latestArticleTime = news[0]?.date ? new Date(news[0].date).getTime() : 0;
  const briefCreatedTime = existing ? new Date(existing.created_at).getTime() : 0;

  if (existing && briefCreatedTime > latestArticleTime) {
    console.log('브리핑 DB 캐시 사용 (최신 상태)');
    return { briefText: existing.brief_text, picks: existing.picks };
  }

  console.log('브리핑 새로 생성 중... (새 기사 반영)');
  const top5 = news.slice(0, 5);
  const articleSummaries = top5.map((item, i) =>
    `${i + 1}. ${item.koreanTitle} (${item.source}, ${item.signal})`
  ).join('\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `아래는 오늘의 주요 한국 주식 뉴스야.

${articleSummaries}

아래 형식으로만 출력해줘:
브리핑: (오늘 한국 주식 시장 전반을 3~4문장으로 핵심만 요약. 날카롭고 임팩트 있게)
픽1: (꼭 읽어야 할 기사 제목 1개)
픽2: (꼭 읽어야 할 기사 제목 1개)
픽3: (꼭 읽어야 할 기사 제목 1개)`
    }]
  });

  const brief = message.content[0].text;
  const briefLines = brief.split('\n').filter(l => l.trim());
  const briefText = briefLines.find(l => l.startsWith('브리핑:'))?.replace('브리핑:', '').trim();
  const pick1 = briefLines.find(l => l.startsWith('픽1:'))?.replace('픽1:', '').trim();
  const pick2 = briefLines.find(l => l.startsWith('픽2:'))?.replace('픽2:', '').trim();
  const pick3 = briefLines.find(l => l.startsWith('픽3:'))?.replace('픽3:', '').trim();
  const picks = [pick1, pick2, pick3].filter(Boolean);

  await supabase.from('briefs').upsert({
    brief_date: today,
    brief_text: briefText,
    picks,
    created_at: new Date().toISOString()
  }, { onConflict: 'brief_date' });
  console.log('브리핑 DB 저장 완료');

  return { briefText, picks };
}

// DART 전자공시
const DART_CACHE_DURATION = 30 * 60 * 1000;
let dartCache = null;
let dartLastFetched = null;

const TRACKED_CORPS = {
  '00126380': { name: '삼성전자', ticker: '005930' },
  '00164779': { name: 'SK하이닉스', ticker: '000660' },
  '01634089': { name: 'LG에너지솔루션', ticker: '373220' },
  '00164742': { name: '현대차', ticker: '005380' },
  '00266961': { name: 'NAVER', ticker: '035420' },
  '00258801': { name: '카카오', ticker: '035720' },
  '00126362': { name: '삼성SDI', ticker: '006400' }
};

async function fetchDartDisclosures() {
  const now = Date.now();
  if (dartLastFetched && now - dartLastFetched < DART_CACHE_DURATION && dartCache) {
    return dartCache;
  }

  const dartApiKey = process.env.DART_API_KEY;
  if (!dartApiKey) {
    console.log('DART API 키가 설정되지 않음');
    return [];
  }

  try {
    const disclosures = [];

    for (const [corpCode, info] of Object.entries(TRACKED_CORPS)) {
      try {
        const response = await axios.get(
          `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartApiKey}&corp_code=${corpCode}&bgn_de=${getDateStr(-30)}&end_de=${getDateStr(0)}&page_count=5`,
          { headers: { 'User-Agent': 'KRStockNews/1.0' } }
        );

        const items = response.data?.list || [];
        for (const item of items) {
          disclosures.push({
            ticker: info.ticker,
            company: info.name,
            title: item.report_nm,
            date: item.rcept_dt,
            type: item.pblntf_ty,
            url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`
          });
        }
      } catch (e) {
        // 개별 종목 실패는 무시
      }
    }

    dartCache = disclosures.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    dartLastFetched = now;
    return dartCache;
  } catch (e) {
    console.log('DART 공시 가져오기 실패:', e.message);
    return [];
  }
}

function getDateStr(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

app.get('/api/dart', async (req, res) => {
  const disclosures = await fetchDartDisclosures();
  res.json(disclosures);
});

app.get('/api/news', async (req, res) => {
  const news = await fetchAllNews();
  res.json(news);
});

app.get('/api/market', async (req, res) => {
  const [market, vkospi] = await Promise.all([fetchMarketData(), fetchVKOSPI()]);
  res.json({ market, fearGreed: vkospi });
});

app.get('/api/analysis', async (req, res) => {
  const [news, vkospi] = await Promise.all([fetchAllNews(), fetchVKOSPI()]);
  const analysis = await generateMarketAnalysis(news, vkospi);

  const lines = analysis.split('\n').filter(l => l.trim());
  const direction = lines.find(l => l.startsWith('방향성:'))?.replace('방향성:', '').trim();
  const comment = lines.find(l => l.startsWith('분석:'))?.replace('분석:', '').trim();
  const watchout = lines.find(l => l.startsWith('주목변수:'))?.replace('주목변수:', '').trim();

  res.json({ direction, comment, watchout });
});

app.get('/api/brief', async (req, res) => {
  const news = await fetchAllNews();
  const { briefText, picks } = await generateDailyBrief(news);
  res.json({ briefText, picks });
});

async function autoRefresh() {
  console.log('자동 새로고침 시작...');
  lastFetched = null;
  await fetchAllNews();
  console.log('자동 새로고침 완료');
}

if (!IS_VERCEL) {
  app.listen(3000, async () => {
    console.log('서버 실행 중 → http://localhost:3000');
    await fetchAllNews();
    setInterval(autoRefresh, CACHE_DURATION);
  });
}

module.exports = app;
