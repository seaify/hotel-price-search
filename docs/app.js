const state = {
  cities: [],
  popularCities: ['北京', '上海', '广州', '深圳', '成都', '杭州', '南京', '武汉', '西安', '三亚'],
  lastQuery: null,
  loading: false,
  pageSize: 24,
  nextOffset: 0,
  displayed: 0,
  staticInventoryRows: [],
  staticImportNames: []
};

const staticHotelBlueprints = [
  { brand: '全季酒店', star: 4, style: '商务精选', base: 330, amenities: ['自助早餐', '洗衣房', '健身房'] },
  { brand: '汉庭酒店', star: 3, style: '轻住连锁', base: 220, amenities: ['免费 Wi-Fi', '24 小时前台', '行李寄存'] },
  { brand: '亚朵酒店', star: 4, style: '品质生活', base: 430, amenities: ['深夜粥到', '阅读空间', '健身房'] },
  { brand: '如家商旅', star: 3, style: '经济舒适', base: 210, amenities: ['免费 Wi-Fi', '自助洗衣', '近地铁'] },
  { brand: '锦江都城酒店', star: 4, style: '城市商旅', base: 360, amenities: ['早餐', '会议室', '停车场'] },
  { brand: '维也纳国际酒店', star: 4, style: '商务出行', base: 310, amenities: ['停车场', '早餐', '会议室'] },
  { brand: '希尔顿欢朋酒店', star: 4, style: '高端精选', base: 520, amenities: ['热早餐', '健身房', '商务中心'] },
  { brand: '万豪酒店', star: 5, style: '豪华品牌', base: 850, amenities: ['行政酒廊', '泳池', '礼宾服务'] },
  { brand: '洲际酒店', star: 5, style: '国际奢华', base: 980, amenities: ['江景房', '水疗', '行政酒廊'] },
  { brand: '香格里拉酒店', star: 5, style: '度假奢华', base: 1050, amenities: ['泳池', '亲子服务', '礼宾服务'] },
  { brand: '悦榕庄', star: 5, style: '度假隐奢', base: 1380, amenities: ['私汤', '水疗', '接送服务'] },
  { brand: '城市民宿', star: 3, style: '当地体验', base: 260, amenities: ['可做饭', '投影', '自助入住'] },
  { brand: '机场智选酒店', star: 4, style: '转机便捷', base: 390, amenities: ['机场接送', '早餐', '叫醒服务'] },
  { brand: '温泉度假酒店', star: 5, style: '休闲度假', base: 760, amenities: ['温泉', '亲子乐园', '晚餐套餐'] }
];

const staticImagePool = [
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80'
];

const staticInventoryCollectionKeys = ['hotels', 'items', 'data', 'results', 'records', 'list', '酒店列表', '酒店'];
const staticNestedRoomKeys = ['rooms', 'roomTypes', 'roomList', '房型', '房型列表', '房间'];
const staticNestedRateKeys = ['rates', 'offers', 'prices', 'roomRates', 'plans', 'products', '报价', '报价列表', '价格', '价格列表', '价格计划'];
const staticNestedCollectionKeys = new Set([...staticInventoryCollectionKeys, ...staticNestedRoomKeys, ...staticNestedRateKeys]);

const staticFieldAliases = {
  id: ['id', 'hotelId', 'hotel_id', '酒店ID', '酒店编号', '供应商酒店ID'],
  name: ['name', 'hotelName', 'hotel_name', '酒店名称', '酒店名', '酒店', '名称'],
  province: ['province', '省份', '省'],
  city: ['city', 'destination', '目的地', '城市', '市'],
  district: ['district', 'businessDistrict', '行政区', '区县', '区域', '商圈'],
  address: ['address', '酒店地址', '地址', '详细地址'],
  star: ['star', 'starRating', '星级', '酒店星级'],
  rating: ['rating', 'score', '评分', '用户评分'],
  price: ['price', 'lowestPrice', 'dailyPrice', 'salePrice', 'roomPrice', '最低价', '价格', '日价', '房价', '售卖价'],
  totalPrice: ['totalPrice', 'amount', '总价', '合计价'],
  amenities: ['amenities', 'facilities', '设施', '酒店设施'],
  tags: ['tags', '标签', '卖点', '推荐标签'],
  providerName: ['source', 'provider', 'supplier', '供应商', '渠道', '来源'],
  checkIn: ['checkIn', 'startDate', '入住日期', '入住', '开始日期'],
  checkOut: ['checkOut', 'endDate', '离店日期', '离店', '结束日期'],
  available: ['available', 'isAvailable', '可售', '是否可售', '库存状态', '状态'],
  bookingUrl: ['bookingUrl', 'url', '预订链接', '下单链接', '详情页', '链接'],
  roomName: ['style', 'roomName', 'rateName', '房型', '房型名称', '价格计划']
};

const elements = {
  form: document.querySelector('#searchForm'),
  cityInput: document.querySelector('#cityInput'),
  keywordInput: document.querySelector('#keywordInput'),
  checkInInput: document.querySelector('#checkInInput'),
  checkOutInput: document.querySelector('#checkOutInput'),
  adultsInput: document.querySelector('#adultsInput'),
  roomsInput: document.querySelector('#roomsInput'),
  cityList: document.querySelector('#cityList'),
  starSelect: document.querySelector('#starSelect'),
  minPriceInput: document.querySelector('#minPriceInput'),
  maxPriceInput: document.querySelector('#maxPriceInput'),
  sortSelect: document.querySelector('#sortSelect'),
  resetFilters: document.querySelector('#resetFilters'),
  sourcePill: document.querySelector('#sourcePill'),
  cityCount: document.querySelector('#cityCount'),
  providerStatus: document.querySelector('#providerStatus'),
  coverageDashboard: document.querySelector('#coverageDashboard'),
  inventoryFileInput: document.querySelector('#inventoryFileInput'),
  importButton: document.querySelector('#importButton'),
  coverageDownloadButton: document.querySelector('#coverageDownloadButton'),
  importStatus: document.querySelector('#importStatus'),
  resultMeta: document.querySelector('#resultMeta'),
  resultTitle: document.querySelector('#resultTitle'),
  notice: document.querySelector('#notice'),
  popularCities: document.querySelector('#popularCities'),
  results: document.querySelector('#results'),
  loadMoreButton: document.querySelector('#loadMoreButton'),
  emptyState: document.querySelector('#emptyState'),
  nationwideButton: document.querySelector('#nationwideButton'),
  nearBusinessButton: document.querySelector('#nearBusinessButton'),
  cardTemplate: document.querySelector('#hotelCardTemplate')
};

init();

async function init() {
  setupDates();
  bindEvents();
  await loadCities();
  await loadProviderStatus();
  applyInitialQueryFromUrl();
  await runSearch();
}

function setupDates() {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  elements.checkInInput.value = toDateInput(today);
  elements.checkOutInput.value = toDateInput(tomorrow);
  elements.checkInInput.min = toDateInput(today);
  elements.checkOutInput.min = toDateInput(tomorrow);
}

function bindEvents() {
  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runSearch();
  });

  [elements.starSelect, elements.minPriceInput, elements.maxPriceInput, elements.sortSelect].forEach((element) => {
    element.addEventListener('change', runSearch);
  });

  elements.checkInInput.addEventListener('change', () => {
    const nextDay = new Date(`${elements.checkInInput.value}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    elements.checkOutInput.min = toDateInput(nextDay);
    if (elements.checkOutInput.value <= elements.checkInInput.value) {
      elements.checkOutInput.value = toDateInput(nextDay);
    }
  });

  elements.resetFilters.addEventListener('click', () => {
    elements.starSelect.value = '';
    elements.minPriceInput.value = '';
    elements.maxPriceInput.value = '';
    elements.sortSelect.value = 'recommend';
    runSearch();
  });

  elements.nationwideButton.addEventListener('click', () => {
    elements.cityInput.value = '';
    runSearch();
  });

  elements.nearBusinessButton.addEventListener('click', () => {
    elements.keywordInput.value = '近商圈';
    runSearch();
  });

  elements.loadMoreButton.addEventListener('click', () => {
    runSearch({ append: true });
  });

  elements.inventoryFileInput.addEventListener('change', () => {
    const file = elements.inventoryFileInput.files?.[0];
    elements.importButton.disabled = !file;
    elements.importStatus.textContent = file ? `${file.name} · ${formatFileSize(file.size)}` : '未选择文件';
  });

  elements.importButton.addEventListener('click', importInventoryFile);
  elements.coverageDownloadButton.addEventListener('click', downloadCoverageReport);
}

async function loadCities() {
  let data;
  try {
    data = isStaticMode() ? summarizeStaticCities() : await fetchJson('/api/cities');
  } catch {
    data = summarizeStaticCities();
  }
  state.cities = data.cities || [];
  elements.cityCount.textContent = String(data.count || state.cities.length);
  const provinceOptions = (data.provinces || [])
    .map((province) => `<option value="${escapeHtml(province)}">${escapeHtml(province)} · 全省</option>`);
  const cityOptions = state.cities
    .map((city) => `<option value="${escapeHtml(city.city)}">${escapeHtml(city.province)} · ${escapeHtml(city.code || '')}</option>`);
  elements.cityList.innerHTML = [...provinceOptions, ...cityOptions]
    .join('');
  renderPopularCities();
}

async function loadProviderStatus() {
  try {
    const data = isStaticMode() ? getStaticProviderStatus() : await fetchJson('/api/status');
    await syncProviderPanels(data);
  } catch {
    await syncProviderPanels(getStaticProviderStatus());
  }
}

async function importInventoryFile() {
  const file = elements.inventoryFileInput.files?.[0];
  if (!file || state.loading) return;

  elements.importButton.disabled = true;
  elements.importStatus.textContent = '正在导入';
  try {
    const content = await file.text();
    let data;
    try {
      if (isStaticMode()) {
        data = importStaticInventoryFile(file.name, content);
      } else {
      data = await fetchJson('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content })
      });
      }
    } catch (error) {
      if (error.status && ![404, 405, 501].includes(error.status)) throw error;
      data = importStaticInventoryFile(file.name, content);
    }
    await syncProviderPanels(data.providers);
    elements.importStatus.textContent = `已导入 ${data.imported.rowCount} 条`;
    elements.inventoryFileInput.value = '';
    await runSearch();
  } catch (error) {
    elements.importStatus.textContent = error.message || '导入失败';
  } finally {
    elements.importButton.disabled = true;
  }
}

async function downloadCoverageReport() {
  if (elements.coverageDownloadButton.disabled) return;
  elements.coverageDownloadButton.disabled = true;

  try {
    if (!isStaticMode()) {
      const response = await fetch(`/api/coverage.csv?${new URLSearchParams(getCoverageQuery())}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const csv = await response.text();
      downloadTextFile('hotel-coverage.csv', csv, 'text/csv;charset=utf-8');
    } else {
      const coverage = summarizeStaticInventoryCoverage(getCoverageQuery());
      downloadTextFile('hotel-coverage.csv', buildCoverageCsv(coverage), 'text/csv;charset=utf-8');
    }
    elements.importStatus.textContent = '已下载覆盖缺口表';
  } catch {
    elements.importStatus.textContent = '覆盖缺口表下载失败';
  } finally {
    elements.coverageDownloadButton.disabled = !hasCoverageSource();
  }
}

function hasCoverageSource() {
  return isStaticMode() ? state.staticInventoryRows.length > 0 : true;
}

function getCoverageQuery() {
  return {
    checkIn: elements.checkInInput.value,
    checkOut: elements.checkOutInput.value
  };
}

async function runSearch(options = {}) {
  const append = Boolean(options.append);
  if (state.loading) return;
  state.loading = true;
  renderLoading(append);

  const baseQuery = append && state.lastQuery ? state.lastQuery : getQuery();
  const query = {
    ...baseQuery,
    limit: String(state.pageSize),
    offset: String(append ? state.nextOffset : 0)
  };
  if (!append) {
    state.lastQuery = baseQuery;
    state.displayed = 0;
    updateUrl(baseQuery);
  }
  try {
    let data;
    try {
      data = isStaticMode() ? searchStaticHotels(query) : await fetchJson(`/api/search?${new URLSearchParams(query)}`);
    } catch {
      data = searchStaticHotels(query);
    }
    renderResults(data, { append });
    if (data.providers) await syncProviderPanels(data.providers);
  } catch (error) {
    elements.notice.hidden = false;
    elements.notice.textContent = '搜索失败，请确认服务正在运行后重试。';
    elements.results.innerHTML = '';
    elements.emptyState.hidden = false;
  } finally {
    state.loading = false;
    elements.loadMoreButton.disabled = false;
  }
}

function isStaticMode() {
  return Boolean(window.HOTEL_STATIC_MODE);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function applyInitialQueryFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const keys = ['city', 'keyword', 'checkIn', 'checkOut', 'adults', 'rooms', 'star', 'minPrice', 'maxPrice', 'sort'];
  const hasQuery = keys.some((key) => params.has(key));
  if (!hasQuery) return false;

  const mapping = {
    city: elements.cityInput,
    keyword: elements.keywordInput,
    checkIn: elements.checkInInput,
    checkOut: elements.checkOutInput,
    adults: elements.adultsInput,
    rooms: elements.roomsInput,
    star: elements.starSelect,
    minPrice: elements.minPriceInput,
    maxPrice: elements.maxPriceInput,
    sort: elements.sortSelect
  };

  keys.forEach((key) => {
    if (params.has(key)) mapping[key].value = params.get(key);
  });
  return true;
}

function updateUrl(query) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
    if (key === 'city' && value === '') params.set(key, '');
  });
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', nextUrl);
}

function getQuery() {
  return {
    city: elements.cityInput.value.trim(),
    keyword: elements.keywordInput.value.trim(),
    checkIn: elements.checkInInput.value,
    checkOut: elements.checkOutInput.value,
    adults: elements.adultsInput.value,
    rooms: elements.roomsInput.value,
    star: elements.starSelect.value,
    minPrice: elements.minPriceInput.value,
    maxPrice: elements.maxPriceInput.value,
    sort: elements.sortSelect.value
  };
}

function renderLoading(append = false) {
  elements.resultMeta.textContent = '正在查询价格';
  elements.sourcePill.textContent = '查询中';
  elements.notice.hidden = true;
  elements.emptyState.hidden = true;
  if (append) {
    elements.loadMoreButton.disabled = true;
    elements.loadMoreButton.textContent = '正在加载';
    return;
  }
  elements.loadMoreButton.hidden = true;
  elements.results.innerHTML = Array.from({ length: 4 }, () => '<article class="hotel-card skeleton"><div class="hotel-image-wrap"></div><div class="hotel-body"><h2 class="hotel-name">加载中</h2><p class="amenities">正在获取酒店与价格...</p></div></article>').join('');
}

function renderResults(data, options = {}) {
  const append = Boolean(options.append);
  const hotels = data.hotels || [];
  const cityLabel = data.query?.city || '全国';
  const nights = getNights(data.query?.checkIn, data.query?.checkOut);
  state.displayed = append ? state.displayed + hotels.length : hotels.length;
  state.nextOffset = data.pagination?.nextOffset || state.displayed;

  elements.resultTitle.textContent = `${cityLabel}酒店价格`;
  elements.resultMeta.textContent = `已显示 ${state.displayed} / ${data.total || hotels.length} 家酒店 · 覆盖 ${data.coverageCities || 1} 城 · ${nights} 晚 · ${data.query?.adults || 2} 成人 · ${data.query?.rooms || 1} 间房`;
  elements.sourcePill.textContent = data.sourceLabel || '数据源未知';
  elements.notice.hidden = !data.notice;
  elements.notice.textContent = data.notice || '';
  elements.emptyState.hidden = state.displayed > 0;
  if (!append) elements.results.innerHTML = '';
  elements.nationwideButton.classList.toggle('active', !data.query?.city);
  renderPopularCities(data.query?.city);

  const fragment = document.createDocumentFragment();
  hotels.forEach((hotel) => fragment.appendChild(renderHotelCard(hotel)));
  elements.results.appendChild(fragment);

  const hasMore = Boolean(data.pagination?.hasMore);
  elements.loadMoreButton.hidden = !hasMore;
  elements.loadMoreButton.textContent = hasMore ? `加载更多酒店（剩余 ${(data.total || 0) - state.displayed}）` : '已加载全部';
}

function renderHotelCard(hotel) {
  const node = elements.cardTemplate.content.firstElementChild.cloneNode(true);
  const image = node.querySelector('.hotel-image');
  image.src = hotel.image;
  image.alt = hotel.name;
  node.querySelector('.hotel-source').textContent = getSourceText(hotel.source);
  node.querySelector('.hotel-name').textContent = hotel.name;
  node.querySelector('.hotel-location').textContent = `${hotel.province || ''}${hotel.city || ''} · ${hotel.district || ''} · ${hotel.address || ''}`;
  node.querySelector('.hotel-rating').textContent = hotel.rating ? `${hotel.rating} 分` : `${hotel.star || '-'} 星`;
  node.querySelector('.tag-row').innerHTML = (hotel.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  node.querySelector('.amenities').textContent = [
    `${hotel.star || '-'} 星`,
    hotel.cancellation,
    hotel.payment,
    hotel.offerCount > 1 ? `${hotel.offerCount} 个报价源` : '',
    ...(hotel.amenities || [])
  ].filter(Boolean).join(' · ');
  renderRates(node.querySelector('.rates-panel'), hotel);
  node.querySelector('.price').textContent = `¥${formatNumber(hotel.price)}`;
  node.querySelector('.total-price').textContent = `${hotel.nights || 1} 晚合计 ¥${formatNumber(hotel.totalPrice || hotel.price)}`;

  const button = node.querySelector('.hotel-action');
  if (hotel.bookingUrl) {
    button.textContent = '查看预订';
    button.classList.add('linked');
    button.addEventListener('click', () => window.open(hotel.bookingUrl, '_blank', 'noopener,noreferrer'));
  } else {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(hotel.name);
      button.textContent = '已复制';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = '复制酒店名';
        button.classList.remove('copied');
      }, 1200);
    });
  }

  return node;
}

function renderRates(container, hotel) {
  const rates = Array.isArray(hotel.rates) ? hotel.rates.filter((rate) => Number(rate.price) > 0) : [];
  if (rates.length <= 1) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.innerHTML = `
    <div class="rates-heading">
      <strong>报价明细</strong>
      <span>${rates.length} 个来源 · 最低 ¥${formatNumber(rates[0].price)}</span>
    </div>
    <div class="rate-list">
      ${rates.slice(0, 4).map((rate, index) => `
        <div class="rate-row ${index === 0 ? 'best' : ''}">
          <div>
            <strong>${escapeHtml(rate.providerName || '供应商')}</strong>
            <span>${escapeHtml([rate.roomName, rate.payment, rate.cancellation].filter(Boolean).join(' · '))}</span>
          </div>
          <div class="rate-price">
            <b>¥${formatNumber(rate.price)}</b>
            ${rate.bookingUrl ? `<a href="${escapeAttribute(rate.bookingUrl)}" target="_blank" rel="noopener noreferrer">预订</a>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderProviderStatus(providers) {
  const localReady = Boolean(providers?.localInventory?.readable);
  const remoteCount = Number(providers?.localInventory?.remoteCount || 0);
  const supplierApiReady = Boolean(providers?.supplierApi?.configured);
  const supplierApiCount = Number(providers?.supplierApi?.apiCount || 0);
  const apiReady = Boolean(providers?.amadeus?.configured);
  const coverage = providers?.localInventory?.coverage;
  const rows = [
    ['本地/导入库存', localReady ? `${providers.localInventory.readableCount || 1} 源` : '未接入', localReady ? 'on' : ''],
    ['真实覆盖城市', coverage ? `${coverage.coveredCities}/${coverage.totalCities} 城` : '未统计', coverage?.coveredCities ? 'on' : ''],
    ['远程供应商文件', remoteCount ? `${remoteCount} 源` : '未接入', remoteCount ? 'on' : ''],
    ['实时供应商 API', supplierApiReady ? `${supplierApiCount || 1} 源` : '未配置', supplierApiReady ? 'on' : ''],
    ['Amadeus API', apiReady ? '已配置' : '未配置', apiReady ? 'on' : ''],
    ['示例价格库', `${providers?.demo?.cities || state.cities.length} 城`, 'demo']
  ];

  elements.providerStatus.innerHTML = `
    <strong>接入状态</strong>
    ${rows.map(([name, value, stateClass]) => `
      <div class="provider-row">
        <span><i class="status-dot ${stateClass}"></i> ${escapeHtml(name)}</span>
        <b>${escapeHtml(value)}</b>
      </div>
    `).join('')}
  `;
  elements.coverageDownloadButton.disabled = !localReady;
  elements.sourcePill.textContent = localReady ? '供应商真实库存已接入' : supplierApiReady ? '实时供应商 API 已配置' : apiReady ? 'Amadeus API 已配置' : '全国示例价格库';
}

async function syncProviderPanels(providers) {
  renderProviderStatus(providers);
  await refreshCoverageDashboard(providers);
}

async function refreshCoverageDashboard(providers) {
  const localReady = Boolean(providers?.localInventory?.readable);
  if (!localReady) {
    renderCoverageDashboard(null);
    return;
  }

  try {
    const coverage = isStaticMode()
      ? summarizeStaticInventoryCoverage(getCoverageQuery())
      : await fetchJson(`/api/coverage?${new URLSearchParams(getCoverageQuery())}`);
    renderCoverageDashboard(coverage);
  } catch {
    renderCoverageDashboard(providers?.localInventory?.coverage || null);
  }
}

function renderCoverageDashboard(coverage) {
  if (!elements.coverageDashboard) return;
  if (!coverage || !Number(coverage.totalCities)) {
    elements.coverageDashboard.hidden = true;
    elements.coverageDashboard.innerHTML = '';
    return;
  }

  const coveredCities = Number(coverage.coveredCities || 0);
  const totalCities = Number(coverage.totalCities || 0);
  const ratio = totalCities ? coveredCities / totalCities : Number(coverage.coverageRatio || 0);
  const missingCities = (coverage.missingCities || []).slice(0, 8);
  const sourceCoverage = (coverage.sourceCoverage || []).slice(0, 4);
  const dateLabel = coverage.query?.checkIn && coverage.query?.checkOut
    ? `${coverage.query.checkIn} 至 ${coverage.query.checkOut}`
    : '全部日期';

  elements.coverageDashboard.hidden = false;
  elements.coverageDashboard.innerHTML = `
    <div class="coverage-dashboard-heading">
      <strong>真实库存覆盖</strong>
      <span>${escapeHtml(dateLabel)}</span>
    </div>
    <div class="coverage-meter" aria-label="真实库存城市覆盖率">
      <div style="width: ${escapeAttribute(formatCoverageWidth(ratio))}"></div>
    </div>
    <div class="coverage-summary">
      <div>
        <b>${escapeHtml(formatCoveragePercent(ratio))}</b>
        <span>${escapeHtml(`${coveredCities}/${totalCities} 城`)}</span>
      </div>
      <div>
        <b>${escapeHtml(formatNumber(coverage.hotelCount || 0))}</b>
        <span>真实酒店</span>
      </div>
      <div>
        <b>${escapeHtml(formatNumber(coverage.rowCount || 0))}</b>
        <span>报价行</span>
      </div>
    </div>
    ${sourceCoverage.length ? `
      <div class="coverage-source-list">
        ${sourceCoverage.map((source) => `
          <div class="coverage-source-row">
            <span>${escapeHtml(source.sourceName || '供应商')}</span>
            <b>${escapeHtml(`${source.coveredCities || 0} 城 · ${source.hotelCount || 0} 酒店`)}</b>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${missingCities.length ? `
      <div class="coverage-missing">
        <span>缺口城市</span>
        <div>
          ${missingCities.map((city) => `<i>${escapeHtml(`${city.province} · ${city.city}`)}</i>`).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function getSourceText(source) {
  if (source === 'amadeus') return '实时';
  if (source === 'supplier-api') return '实时';
  if (source === 'local' || source === '供应商CSV') return '真实';
  return '示例';
}

function renderPopularCities(activeCity = elements.cityInput.value.trim()) {
  elements.popularCities.innerHTML = state.popularCities.map((city) => {
    const activeClass = activeCity === city ? ' class="active"' : '';
    return `<button type="button"${activeClass} data-city="${escapeHtml(city)}">${escapeHtml(city)}</button>`;
  }).join('');

  elements.popularCities.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      elements.cityInput.value = button.dataset.city;
      runSearch();
    });
  });
}

function summarizeStaticCities() {
  const cities = getStaticCities();
  return {
    cities,
    provinces: [...new Set(cities.map((city) => city.province))],
    count: cities.length
  };
}

function summarizeStaticInventoryCoverage(params = {}) {
  const dateFiltered = Boolean(params.checkIn && params.checkOut);
  const normalized = state.staticInventoryRows
    .map((row, index) => normalizeStaticHotel(row, index, 1))
    .filter((hotel) => hotel.available && hotel.city)
    .filter((hotel) => !dateFiltered || isStaticAvailableForDates(hotel, params));
  const mergedHotels = mergeStaticRates(normalized);
  const coveredCitySet = new Set(normalized.map((hotel) => hotel.city));
  const cities = getStaticCities();
  const coveredCities = cities.filter((city) => coveredCitySet.has(city.city));
  const provinceSet = new Set(cities.map((city) => city.province));
  const rowCountByCity = countStaticBy(normalized.map((hotel) => hotel.city));
  const hotelCountByCity = countStaticBy(mergedHotels.map((hotel) => hotel.city));
  const sourcesByCity = groupStaticSourcesByCity(normalized);
  const cityCoverage = cities.map(({ province, city }) => ({
    province,
    city,
    covered: coveredCitySet.has(city),
    rowCount: rowCountByCity.get(city) || 0,
    hotelCount: hotelCountByCity.get(city) || 0,
    sourceCount: sourcesByCity.get(city)?.length || 0,
    sources: sourcesByCity.get(city) || []
  }));

  return {
    rowCount: state.staticInventoryRows.length,
    hotelCount: mergedHotels.length,
    coveredCities: coveredCities.length,
    totalCities: cities.length,
    coverageRatio: cities.length ? Number((coveredCities.length / cities.length).toFixed(4)) : 0,
    coveredProvinces: new Set(coveredCities.map((city) => city.province)).size,
    totalProvinces: provinceSet.size,
    cityCoverage,
    missingCities: cityCoverage
      .filter((item) => !item.covered)
      .map(({ province, city }) => ({ province, city })),
    sourceCoverage: buildStaticSourceCoverage(normalized),
    query: dateFiltered ? { checkIn: params.checkIn, checkOut: params.checkOut } : null
  };
}

function groupStaticSourcesByCity(hotels) {
  const citySources = new Map();
  hotels.forEach((hotel) => {
    if (!hotel.city) return;
    const sources = citySources.get(hotel.city) || [];
    citySources.set(hotel.city, [...new Set([...sources, hotel.providerName || '浏览器导入'].filter(Boolean))]);
  });
  return citySources;
}

function buildStaticSourceCoverage(hotels) {
  const cities = getStaticCities();
  const totalProvinces = new Set(cities.map((city) => city.province)).size;
  const bySource = new Map();
  hotels.forEach((hotel) => {
    const sourceName = hotel.providerName || '浏览器导入';
    bySource.set(sourceName, [...(bySource.get(sourceName) || []), hotel]);
  });

  return [...bySource.entries()].map(([sourceName, sourceHotels]) => {
    const citySet = new Set(sourceHotels.map((hotel) => hotel.city).filter(Boolean));
    const coveredCities = cities.filter((city) => citySet.has(city.city));
    return {
      sourceName,
      rowCount: sourceHotels.length,
      hotelCount: mergeStaticRates(sourceHotels).length,
      coveredCities: coveredCities.length,
      totalCities: cities.length,
      coverageRatio: cities.length ? Number((coveredCities.length / cities.length).toFixed(4)) : 0,
      coveredProvinces: new Set(coveredCities.map((city) => city.province)).size,
      totalProvinces,
      missingCities: cities
        .filter((city) => !citySet.has(city.city))
        .map(({ province, city }) => ({ province, city }))
    };
  }).sort((a, b) => b.coveredCities - a.coveredCities || b.hotelCount - a.hotelCount || a.sourceName.localeCompare(b.sourceName, 'zh-CN'));
}

function countStaticBy(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return counts;
}

function getStaticProviderStatus() {
  const localReady = state.staticInventoryRows.length > 0;
  return {
    localInventory: {
      configured: localReady,
      readable: localReady,
      readableCount: state.staticImportNames.length,
      importedCount: state.staticImportNames.length,
      importedFiles: state.staticImportNames.map((filename) => ({ filename })),
      coverage: localReady ? summarizeStaticInventoryCoverage() : null
    },
    supplierApi: { configured: false },
    amadeus: { configured: false },
    demo: { enabled: true, cities: getStaticCities().length }
  };
}

function importStaticInventoryFile(filename, content) {
  const extension = getStaticInventoryExtension(filename);
  const rows = parseStaticInventory(content, extension).map((row) => ({
    ...row,
    __inventoryFile: filename
  }));
  if (!rows.length) throw new Error('没有识别到酒店价格记录。');
  state.staticInventoryRows.push(...rows);
  state.staticImportNames = [...new Set([...state.staticImportNames, filename])];
  return {
    imported: { filename, rowCount: rows.length },
    providers: getStaticProviderStatus()
  };
}

function searchStaticHotels(query) {
  const normalized = normalizeStaticQuery(query);
  const hasInventory = state.staticInventoryRows.length > 0;
  const hotels = hasInventory
    ? searchStaticInventory(normalized)
    : searchStaticDemo(normalized);
  const page = paginateStaticHotels(hotels, normalized);
  return {
    source: hasInventory ? 'local' : 'demo',
    sourceLabel: hasInventory ? '本地真实库存' : '全国示例价格库',
    mode: hasInventory ? 'browser-file' : 'static-demo',
    generatedAt: new Date().toISOString(),
    query: normalized,
    total: page.total,
    returned: page.hotels.length,
    coverageCities: page.coverageCities,
    pagination: page.pagination,
    hotels: page.hotels,
    notice: hasInventory
      ? `价格来自 ${state.staticImportNames.length} 个浏览器导入文件，已按同酒店合并并优先显示最低价。`
      : 'GitHub Pages 静态版当前展示全国示例价格；可在左侧导入供应商 CSV/JSON/JSONL 后查询真实价格。',
    providers: getStaticProviderStatus()
  };
}

function searchStaticInventory(params) {
  const nights = getNights(params.checkIn, params.checkOut);
  const destination = resolveStaticDestination(params.city);
  const citySet = new Set((destination.cities || []).map((item) => item.city));
  const hotels = state.staticInventoryRows
    .map((row, index) => normalizeStaticHotel(row, index, nights))
    .filter((hotel) => hotel.available)
    .filter((hotel) => destination.type === 'nationwide'
      || (destination.type === 'city' && hotel.city === destination.label)
      || (destination.type === 'province' && (hotel.province === destination.label || citySet.has(hotel.city))))
    .filter((hotel) => isStaticAvailableForDates(hotel, params));
  return applyStaticFilters(mergeStaticRates(hotels), params);
}

function searchStaticDemo(params) {
  const destination = resolveStaticDestination(params.city);
  if (destination.type === 'unknown') return [];
  const cities = destination.type === 'city' ? [destination.city] : destination.cities;
  const hotels = cities.flatMap((item) => buildStaticDemoHotels(item, params));
  return applyStaticFilters(hotels, params);
}

function buildStaticDemoHotels(city, params) {
  const nights = getNights(params.checkIn, params.checkOut);
  const seed = hashStatic(`${city.city}-${params.checkIn}-${params.checkOut}-${params.adults || 2}`);
  const multiplier = getStaticDateMultiplier(params.checkIn, city);
  return staticHotelBlueprints.map((hotel, index) => {
    const district = city.districts[(index + seed) % city.districts.length];
    const tierPremium = city.tier === 1 ? 1.38 : city.tier === 2 ? 1.15 : 0.96;
    const variance = 0.9 + ((seed + index * 13) % 24) / 100;
    const price = Math.max(90, Math.round((hotel.base * tierPremium * multiplier * variance) / 10) * 10);
    const rating = Math.min(4.9, 4.15 + hotel.star * 0.11 + ((seed + index * 5) % 18) / 100);
    return {
      id: `${city.code || city.city}-${index + 1}`,
      name: `${city.city}${district}${hotel.brand}`,
      city: city.city,
      province: city.province,
      district,
      address: `${city.city}${district}核心商圈 ${88 + index} 号`,
      star: hotel.star,
      style: hotel.style,
      rating: Number(rating.toFixed(1)),
      reviews: 180 + ((seed + index * 97) % 4200),
      price,
      totalPrice: price * nights,
      nights,
      currency: 'CNY',
      amenities: hotel.amenities,
      tags: buildStaticTags(hotel, index, city),
      image: staticImagePool[index % staticImagePool.length],
      payment: index % 3 === 0 ? '到店付' : '在线付',
      cancellation: index % 4 === 0 ? '限时免费取消' : '不可取消',
      source: 'demo'
    };
  });
}

function normalizeStaticHotel(row, index, nights) {
  const price = parseStaticMoney(pickStatic(row, 'price'));
  const totalPrice = parseStaticMoney(pickStatic(row, 'totalPrice')) || price * nights;
  const location = normalizeStaticInventoryLocation(pickStatic(row, 'city'), pickStatic(row, 'province'));
  const providerName = pickStatic(row, 'providerName') || row.__inventoryFile || '浏览器导入';
  const roomName = pickStatic(row, 'roomName') || '供应商库存';
  return {
    id: pickStatic(row, 'id') || `static-${index}`,
    name: pickStatic(row, 'name') || '未命名酒店',
    city: location.city,
    province: location.province,
    district: pickStatic(row, 'district') || '',
    address: pickStatic(row, 'address') || '',
    star: Number(pickStatic(row, 'star') || 0) || null,
    style: roomName,
    rating: Number(pickStatic(row, 'rating') || 0) || null,
    reviews: 0,
    price,
    totalPrice,
    nights,
    currency: 'CNY',
    amenities: splitStaticList(pickStatic(row, 'amenities')),
    tags: splitStaticList(pickStatic(row, 'tags')).length ? splitStaticList(pickStatic(row, 'tags')) : ['真实库存'],
    image: staticImagePool[index % staticImagePool.length],
    payment: '预订前确认',
    cancellation: '预订前确认',
    source: 'local',
    providerName,
    checkIn: normalizeStaticDate(pickStatic(row, 'checkIn')),
    checkOut: normalizeStaticDate(pickStatic(row, 'checkOut')),
    available: pickStatic(row, 'available') === undefined ? true : parseStaticBoolean(pickStatic(row, 'available')),
    bookingUrl: pickStatic(row, 'bookingUrl') || '',
    rates: [{
      providerName,
      roomName,
      price,
      totalPrice,
      currency: 'CNY',
      payment: '预订前确认',
      cancellation: '预订前确认',
      bookingUrl: pickStatic(row, 'bookingUrl') || ''
    }]
  };
}

function applyStaticFilters(hotels, params) {
  const keyword = (params.keyword || '').trim().toLowerCase();
  const minPrice = Number(params.minPrice || 0);
  const maxPrice = Number(params.maxPrice || 0);
  const star = Number(params.star || 0);
  const sort = params.sort || 'recommend';
  return hotels.filter((hotel) => {
    const haystack = `${hotel.name} ${hotel.city} ${hotel.province} ${hotel.district} ${hotel.style} ${(hotel.amenities || []).join(' ')} ${(hotel.tags || []).join(' ')}`.toLowerCase();
    return (!keyword || haystack.includes(keyword))
      && (!minPrice || hotel.price >= minPrice)
      && (!maxPrice || hotel.price <= maxPrice)
      && (!star || hotel.star === star);
  }).sort((a, b) => {
    if (sort === 'price-asc') return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
    return (b.rating || 0) * 100 - b.price / 10 - ((a.rating || 0) * 100 - a.price / 10);
  });
}

function mergeStaticRates(hotels) {
  const merged = new Map();
  hotels.forEach((hotel) => {
    const key = `${hotel.province}|${hotel.city}|${hotel.name}|${hotel.address || hotel.district}`.toLowerCase().replace(/\s+/g, '');
    if (!merged.has(key)) {
      merged.set(key, { ...hotel, rates: [...hotel.rates], providerNames: [hotel.providerName], offerCount: 1 });
      return;
    }
    const existing = merged.get(key);
    existing.rates.push(...hotel.rates);
    existing.providerNames = [...new Set([...existing.providerNames, hotel.providerName].filter(Boolean))];
    existing.offerCount = existing.rates.length;
    if (hotel.price > 0 && (!existing.price || hotel.price < existing.price)) {
      Object.assign(existing, {
        price: hotel.price,
        totalPrice: hotel.totalPrice,
        bookingUrl: hotel.bookingUrl,
        providerName: hotel.providerName
      });
    }
  });
  return [...merged.values()].map((hotel) => ({
    ...hotel,
    rates: hotel.rates.filter((rate) => rate.price > 0).sort((a, b) => a.price - b.price),
    tags: [...new Set([...(hotel.tags || []), hotel.rates.length > 1 ? `${hotel.rates.length} 个报价` : '真实库存'])]
  }));
}

function paginateStaticHotels(hotels, params) {
  const offset = Math.min(Number(params.offset || 0), hotels.length);
  const limit = Number(params.limit || state.pageSize);
  const pageHotels = hotels.slice(offset, offset + limit);
  return {
    hotels: pageHotels,
    total: hotels.length,
    coverageCities: new Set(hotels.map((hotel) => hotel.city).filter(Boolean)).size,
    pagination: {
      offset,
      limit,
      nextOffset: offset + pageHotels.length,
      hasMore: offset + pageHotels.length < hotels.length
    }
  };
}

function getStaticCities() {
  return window.HOTEL_STATIC_DATA?.cities || [];
}

function findStaticCity(input) {
  if (!input) return null;
  const normalized = normalizeStaticDestinationInput(input);
  const cities = getStaticCities();
  return cities.find((item) => item.city === normalized)
    || cities.find((item) => item.city.includes(normalized))
    || null;
}

function findStaticProvince(input) {
  if (!input) return null;
  const normalized = normalizeStaticDestinationInput(input);
  return [...new Set(getStaticCities().map((item) => item.province))]
    .find((province) => province === normalized) || null;
}

function normalizeStaticInventoryLocation(cityValue, provinceValue) {
  const rawCity = String(cityValue || '').trim();
  const rawProvince = String(provinceValue || '').trim();
  const explicitProvince = findStaticProvince(rawProvince) || findStaticProvince(rawCity) || '';
  const exactCity = findExactStaticCity(rawCity);
  const embeddedCity = exactCity || findEmbeddedStaticCity(rawCity);
  const city = embeddedCity?.city || normalizeStaticDestinationInput(rawCity);
  const province = explicitProvince || embeddedCity?.province || '';

  return {
    city: findStaticProvince(city) && !embeddedCity ? '' : city,
    province
  };
}

function findEmbeddedStaticCity(value) {
  const normalized = normalizeStaticDestinationInput(value);
  if (!normalized || findStaticProvince(normalized)) return null;
  return getStaticCities().find((item) => normalized.includes(item.city)) || null;
}

function resolveStaticDestination(input) {
  const normalized = normalizeStaticDestinationInput(input);
  if (!normalized) return { type: 'nationwide', label: '全国', cities: getStaticCities() };
  const exactCity = findExactStaticCity(normalized);
  const province = findStaticProvince(normalized);
  if (province && (isStaticProvinceIntent(input) || !exactCity)) {
    return {
      type: 'province',
      label: province,
      province,
      cities: getStaticCities().filter((item) => item.province === province)
    };
  }
  const city = exactCity || findStaticCity(normalized);
  if (city) return { type: 'city', label: city.city, city, cities: [city] };
  if (province) {
    return {
      type: 'province',
      label: province,
      province,
      cities: getStaticCities().filter((item) => item.province === province)
    };
  }
  return { type: 'unknown', label: normalized, cities: [] };
}

function normalizeStaticDestinationInput(input) {
  return String(input || '')
    .trim()
    .replace(/特别行政区$/, '')
    .replace(/维吾尔自治区$/, '')
    .replace(/壮族自治区$/, '')
    .replace(/回族自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/[省市]$/, '');
}

function findExactStaticCity(input) {
  const normalized = normalizeStaticDestinationInput(input);
  return getStaticCities().find((item) => item.city === normalized) || null;
}

function isStaticProvinceIntent(input) {
  return /(?:省|自治区|特别行政区)$/.test(String(input || '').trim());
}

function normalizeStaticQuery(query) {
  const destination = resolveStaticDestination(query.city);
  return {
    ...query,
    city: destination.type === 'nationwide'
      ? ''
      : destination.type === 'unknown'
        ? query.city || ''
        : destination.label,
    destinationType: destination.type,
    limit: Number(query.limit || state.pageSize),
    offset: Number(query.offset || 0)
  };
}

function parseStaticInventory(content, extension) {
  if (extension === '.json') {
    const parsed = JSON.parse(content);
    return flattenStaticInventoryDocument(parsed);
  }
  if (extension === '.jsonl' || extension === '.ndjson') {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => flattenStaticInventoryDocument(JSON.parse(line)));
  }
  return parseStaticCsv(content);
}

function getStaticInventoryExtension(filename) {
  const lowered = filename.toLowerCase();
  if (lowered.endsWith('.jsonl')) return '.jsonl';
  if (lowered.endsWith('.ndjson')) return '.ndjson';
  if (lowered.endsWith('.json')) return '.json';
  return '.csv';
}

function flattenStaticInventoryDocument(parsed) {
  const records = getStaticInventoryRecords(parsed);
  return records.flatMap(flattenStaticInventoryRecord);
}

function getStaticInventoryRecords(value, inherited = {}) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ ...inherited, ...item }));
  }
  if (!value || typeof value !== 'object') return [];
  const rootFields = { ...inherited, ...stripStaticNestedCollections(value) };

  for (const key of staticInventoryCollectionKeys) {
    const nested = value[key];
    if (Array.isArray(nested)) return getStaticInventoryRecords(nested, rootFields);
    if (nested && typeof nested === 'object') {
      const nestedRecords = getStaticInventoryRecords(nested, rootFields);
      if (nestedRecords.length) return nestedRecords;
    }
  }

  return [{ ...inherited, ...value }];
}

function flattenStaticInventoryRecord(record) {
  if (!record || typeof record !== 'object') return [];
  const rooms = getFirstStaticArray(record, staticNestedRoomKeys);
  const directRates = getFirstStaticArray(record, staticNestedRateKeys);

  if (rooms.length) {
    const rows = rooms.flatMap((room) => {
      if (!room || typeof room !== 'object') return [];
      const rates = getFirstStaticArray(room, staticNestedRateKeys);
      return rates.length
        ? rates.map((rate) => mergeStaticInventoryParts(record, room, rate))
        : [mergeStaticInventoryParts(record, room, null)];
    });
    if (rows.length) return rows;
  }

  if (directRates.length) return directRates.map((rate) => mergeStaticInventoryParts(record, null, rate));
  return [stripStaticNestedCollections(record)];
}

function mergeStaticInventoryParts(hotel, room, rate) {
  const hotelFields = stripStaticNestedCollections(hotel || {});
  const roomFields = stripStaticNestedCollections(room || {});
  const rateFields = stripStaticNestedCollections(rate || {});
  const row = { ...hotelFields, ...roomFields, ...rateFields };
  const roomName = pickStaticFromParts([roomFields], 'roomName') || pickStaticFromParts([roomFields], 'name');
  const rateName = pickStaticFromParts([rateFields], 'roomName') || pickStaticFromParts([rateFields], 'name');

  row.id = pickStaticFromParts([hotelFields, row], 'id') || row.id;
  row.name = pickStaticFromParts([hotelFields, row], 'name') || row.name;
  row.roomName = formatStaticRoomRateName(roomName, rateName) || row.roomName;
  row.amenities = [
    ...splitStaticList(pickStaticFromParts([hotelFields], 'amenities')),
    ...splitStaticList(pickStaticFromParts([roomFields], 'amenities')),
    ...splitStaticList(pickStaticFromParts([rateFields], 'amenities'))
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  row.tags = [
    ...splitStaticList(pickStaticFromParts([hotelFields], 'tags')),
    ...splitStaticList(pickStaticFromParts([roomFields], 'tags')),
    ...splitStaticList(pickStaticFromParts([rateFields], 'tags'))
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  return row;
}

function stripStaticNestedCollections(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([key, item]) => {
      const nestedValue = item && typeof item === 'object';
      return !staticNestedCollectionKeys.has(key) || !nestedValue;
    })
  );
}

function getFirstStaticArray(value, keys) {
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function pickStaticFromParts(parts, field) {
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const value = pickStatic(part, field);
    if (value !== undefined) return value;
  }
  return undefined;
}

function formatStaticRoomRateName(roomName, rateName) {
  if (roomName && rateName && roomName !== rateName) return `${roomName} · ${rateName}`;
  return rateName || roomName || '';
}

function parseStaticCsv(content) {
  const rows = content.trim().split(/\r?\n/);
  if (rows.length < 2) return [];
  const headers = splitStaticCsvLine(rows[0]).map((header) => header.trim());
  return rows.slice(1).filter(Boolean).map((line) => {
    const values = splitStaticCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function splitStaticCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function pickStatic(row, field) {
  for (const key of staticFieldAliases[field] || [field]) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return undefined;
}

function parseStaticMoney(value) {
  if (!value) return 0;
  const number = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function normalizeStaticDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})[年/.-]?(\d{1,2})[月/.-]?(\d{1,2})/);
  if (!match) return raw;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function splitStaticList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  return String(value).split(/[|,，、;]/).map((item) => item.trim()).filter(Boolean);
}

function parseStaticBoolean(value) {
  if (typeof value === 'boolean') return value;
  return !['false', '0', 'no', '否', '不可用', '无房', '满房', '停售', '下架'].includes(String(value).trim().toLowerCase());
}

function isStaticAvailableForDates(hotel, params) {
  if (hotel.checkIn && hotel.checkOut) return hotel.checkIn <= params.checkIn && hotel.checkOut >= params.checkOut;
  if (hotel.checkIn) return hotel.checkIn === params.checkIn;
  if (hotel.checkOut) return hotel.checkOut === params.checkOut;
  return true;
}

function buildStaticTags(hotel, index, city) {
  const tags = [hotel.style];
  if (hotel.star >= 5) tags.push('高星酒店');
  if (index % 2 === 0) tags.push('近商圈');
  if (index % 3 === 0) tags.push(city.tier === 1 ? '近地铁' : '免费停车');
  if (index % 5 === 0) tags.push('亲子友好');
  return tags.slice(0, 4);
}

function getStaticDateMultiplier(checkIn, city) {
  const date = new Date(`${checkIn}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 1;
  const month = date.getMonth() + 1;
  const day = date.getDay();
  let multiplier = day === 5 || day === 6 ? 1.15 : 1;
  if (city.city === '三亚' && [1, 2, 7, 8, 12].includes(month)) multiplier += 0.24;
  if (['北京', '上海', '广州', '深圳', '杭州'].includes(city.city) && [4, 5, 9, 10].includes(month)) multiplier += 0.12;
  return multiplier;
}

function hashStatic(input) {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value << 5) - value + input.charCodeAt(index);
    value |= 0;
  }
  return Math.abs(value);
}

function getNights(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  const nights = Math.round((end - start) / 86_400_000);
  return Math.max(1, Number.isFinite(nights) ? nights : 1);
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatCoveragePercent(value) {
  const percent = Math.max(0, Math.min(100, Number(value || 0) * 100));
  const rounded = percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10;
  return `${rounded}%`;
}

function formatCoverageWidth(value) {
  const percent = Math.max(0, Math.min(100, Number(value || 0) * 100));
  return `${percent}%`;
}

function buildCoverageCsv(coverage) {
  const rows = [
    ['province', 'city', 'covered', 'hotelCount', 'rowCount', 'sourceCount', 'sources'],
    ...(coverage.cityCoverage || []).map((item) => [
      item.province,
      item.city,
      item.covered ? 'yes' : 'no',
      item.hotelCount || 0,
      item.rowCount || 0,
      item.sourceCount || 0,
      (item.sources || []).join(';')
    ])
  ];
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function downloadTextFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content.startsWith('\uFEFF') ? content : `\uFEFF${content}\n`], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
