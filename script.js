const SCORE_LABEL = {
  5: { text: '긴급', color: '#ff3b30' },
  4: { text: '주요', color: '#ff9500' },
  3: { text: '일반', color: '#34c759' },
  2: { text: '참고', color: '#007aff' },
  1: { text: '정보', color: '#8e8e93' }
};

const SIGNAL_STYLE = {
  '긍정': { text: '🟢 긍정', color: '#34c759' },
  '부정': { text: '🔴 부정', color: '#ff3b30' },
  '중립': { text: '🟡 중립', color: '#ff9500' }
};

let allNews = [];
let filters = { source: 'all', score: 'all', signal: 'all', tag: 'all' };

// 시장 데이터 불러오기
async function loadMarket() {
  const res = await fetch('/api/market');
  const { market, fearGreed } = await res.json();

  const bar = document.getElementById('market-bar');
  bar.innerHTML = market.map(item => {
    const change = item.change?.toFixed(2);
    const isUp = item.change >= 0;
    const priceStr = item.isIndex
      ? item.price?.toLocaleString('ko-KR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
      : '₩' + Math.round(item.price)?.toLocaleString('ko-KR');
    return `
      <div class="market-item">
        <span class="market-symbol">${item.symbol}</span>
        <span class="market-price">${priceStr}</span>
        <span class="market-change ${isUp ? 'up' : 'down'}">
          ${isUp ? '▲' : '▼'}&nbsp;${Math.abs(change)}%
        </span>
      </div>
    `;
  }).join('');

  // VKOSPI 변동성지수 표시
  if (fearGreed) {
    const fgColor = fearGreed.value >= 35 ? '#ff3b30'
      : fearGreed.value >= 25 ? '#ff9500'
      : fearGreed.value >= 20 ? '#34c759'
      : '#00c7be';

    bar.innerHTML += `
      <div class="fear-greed">
        <div class="fear-greed-label">VKOSPI 변동성</div>
        <div class="fear-greed-value" style="color: ${fgColor}">
          ${fearGreed.value}
          <span class="fear-greed-text">${translateVKOSPI(fearGreed.classification)}</span>
        </div>
      </div>
    `;
  }
}

function translateVKOSPI(classification) {
  if (!classification) return '';
  const normalized = classification.toLowerCase();
  const map = {
    'extreme fear': '극도의 공포',
    'fear': '공포',
    'neutral': '중립',
    'greed': '안정',
    'extreme greed': '매우 안정'
  };
  return map[normalized] || classification;
}

// 브리핑 불러오기
async function loadBrief(news) {
  const res = await fetch('/api/brief');
  const { briefText, picks } = await res.json();

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  document.getElementById('brief-date').textContent = `📅 ${today}`;
  document.getElementById('brief-text').textContent = briefText || '';

  const picksList = document.getElementById('picks-list');
  picksList.innerHTML = picks.map((pick, i) => {
    const matchIndex = news.findIndex(item => item.koreanTitle === pick);
    const anchor = matchIndex >= 0 ? `href="#article-${matchIndex}"` : '';
    return `<div class="pick-item"><a class="pick-link" ${anchor}>${i + 1}. ${pick}</a></div>`;
  }).join('');
}

// 필터 렌더링
function renderFilters(news) {
  const sources = ['all', ...new Set(news.map(i => i.source))];
  const allTags = [...new Set(news.flatMap(i => i.tags))].filter(Boolean);

  const container = document.getElementById('filters');
  container.innerHTML = `
    <div class="filter-group">
      <div class="filter-group-label">매체</div>
      <div class="filter-btns">
        ${sources.map(s => `
          <a class="filter-btn ${filters.source === s ? 'active' : ''}"
             onclick="setFilter('source', '${s}')">
            ${s === 'all' ? 'All' : s}
          </a>
        `).join('')}
      </div>
    </div>

    <div class="filter-group">
      <div class="filter-group-label">중요도</div>
      <div class="filter-btns">
        <a class="filter-btn ${filters.score === 'all' ? 'active' : ''}"
           onclick="setFilter('score', 'all')">All</a>
        ${[5,4,3,2,1].map(s => `
          <a class="filter-btn score-${s} ${filters.score === String(s) ? 'active' : ''}"
             onclick="setFilter('score', '${s}')">
            ${SCORE_LABEL[s].text}
          </a>
        `).join('')}
      </div>
    </div>

    <div class="filter-group">
      <div class="filter-group-label">시그널</div>
      <div class="filter-btns">
        ${['all','긍정','부정','중립'].map(s => `
          <a class="filter-btn ${filters.signal === s ? 'active' : ''}"
             onclick="setFilter('signal', '${s}')">
            ${s === 'all' ? 'All' : SIGNAL_STYLE[s]?.text || s}
          </a>
        `).join('')}
      </div>
    </div>

    ${allTags.length > 0 ? `
    <div class="filter-group">
      <div class="filter-group-label">종목 · 섹터</div>
      <div class="filter-btns">
        <a class="filter-btn ${filters.tag === 'all' ? 'active' : ''}"
           onclick="setFilter('tag', 'all')">All</a>
        ${allTags.map(t => `
          <a class="filter-btn ${filters.tag === t ? 'active' : ''}"
             onclick="setFilter('tag', '${t}')">
            ${t}
          </a>
        `).join('')}
      </div>
    </div>
    ` : ''}
  `;
}

// 필터 적용
function setFilter(type, value) {
  filters[type] = value;
  renderNews();
  renderFilters(allNews);
}

// 기사 렌더링
function renderNews() {
  let filtered = allNews;
  if (filters.source !== 'all') filtered = filtered.filter(i => i.source === filters.source);
  if (filters.score !== 'all') filtered = filtered.filter(i => i.score === parseInt(filters.score));
  if (filters.signal !== 'all') filtered = filtered.filter(i => i.signal === filters.signal);
  if (filters.tag !== 'all') filtered = filtered.filter(i => i.tags.includes(filters.tag));

  const list = document.getElementById('news-list');
  const isMobile = window.innerWidth <= 768;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty">해당하는 기사가 없어요.</div>';
    return;
  }

  list.innerHTML = filtered.map((item, index) => `
    <div class="news-card" id="article-${index}">
      <div class="card-header">
        <span class="score-badge" style="background:${SCORE_LABEL[item.score].color}">
          ${SCORE_LABEL[item.score].text}
        </span>
        ${item.signal && SIGNAL_STYLE[item.signal] ? `
          <span class="signal-badge" style="background:${SIGNAL_STYLE[item.signal].color}">
            ${SIGNAL_STYLE[item.signal].text}
          </span>
        ` : ''}
        <span class="source-badge">${item.source}</span>
        <span class="date">${new Date(item.date).toLocaleDateString('ko-KR')}</span>
      </div>
      <div class="korean-title ${isMobile ? 'accordion-title' : ''}"
           ${isMobile ? `onclick="toggleAccordion(this)"` : ''}>
        ${item.koreanTitle || '제목 없음'}
      </div>
      <div class="accordion-body ${isMobile ? 'collapsed' : ''}">
        <div class="summary">${item.summary || '요약 없음'}</div>
        ${item.tags.length > 0 ? `
          <div class="coin-tags">
            ${item.tags.map(tag => `
              <a class="coin-tag" onclick="setFilter('tag', '${tag}')">${tag}</a>
            `).join('')}
          </div>
        ` : ''}
        <a href="${item.link}" target="_blank" class="read-more">원문 보기 →</a>
      </div>
    </div>
  `).join('');
}

function toggleAccordion(titleEl) {
  const body = titleEl.nextElementSibling;
  const isCollapsed = body.classList.contains('collapsed');

  if (isCollapsed) {
    body.classList.remove('collapsed');
  } else {
    body.classList.add('collapsed');
  }
}

// 모바일 메뉴
document.getElementById('mobile-menu-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('show');
});

document.getElementById('overlay').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
});

// DART 공시 불러오기
async function loadDart() {
  const res = await fetch('/api/dart');
  const disclosures = await res.json();

  const list = document.getElementById('insider-list');
  if (!disclosures || disclosures.length === 0) {
    list.innerHTML = '<div class="insider-empty">최근 30일간 주요 종목 공시 없음</div>';
    return;
  }

  list.innerHTML = disclosures.map(d => `
    <div class="insider-item">
      <div class="insider-header">
        <span class="insider-ticker">${d.company}</span>
        <span class="insider-date">${d.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')}</span>
      </div>
      <div class="insider-detail">
        <a href="${d.url}" target="_blank" class="dart-title">${d.title}</a>
      </div>
      ${d.summary ? `<div class="dart-summary">${d.summary}</div>` : ''}
    </div>
  `).join('');
}

// 초기 데이터 로딩
async function init() {
  const res = await fetch('/api/news');
  allNews = await res.json();

  renderNews();
  renderFilters(allNews);
  loadMarket();
  loadBrief(allNews);
  loadAnalysis();
  loadDart();
}

async function loadAnalysis() {
  const res = await fetch('/api/analysis');
  const { direction, comment, watchout } = await res.json();

  const directionColor = {
    '강한상승': '#ff3b30',
    '약한상승': '#ff9500',
    '중립': '#8e8e93',
    '약한하락': '#007aff',
    '강한하락': '#5856d6'
  };

  const analysisEl = document.getElementById('market-analysis');
  if (analysisEl) {
    analysisEl.innerHTML = `
      <div class="analysis-direction" style="color: ${directionColor[direction] || '#1a1a1a'}">
        ${direction || '분석 중...'}
      </div>
      <div class="analysis-comment">${comment || ''}</div>
      <div class="analysis-watchout">
        <span class="watchout-label">주목변수</span> ${watchout || ''}
      </div>
    `;
  }
}

init();
