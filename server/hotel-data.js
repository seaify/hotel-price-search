const provinceCities = {
  北京: ['北京'],
  天津: ['天津'],
  上海: ['上海'],
  重庆: ['重庆'],
  河北: ['石家庄', '唐山', '秦皇岛', '邯郸', '邢台', '保定', '张家口', '承德', '沧州', '廊坊', '衡水'],
  山西: ['太原', '大同', '阳泉', '长治', '晋城', '朔州', '晋中', '运城', '忻州', '临汾', '吕梁'],
  内蒙古: ['呼和浩特', '包头', '乌海', '赤峰', '通辽', '鄂尔多斯', '呼伦贝尔', '巴彦淖尔', '乌兰察布', '兴安盟', '锡林郭勒盟', '阿拉善盟'],
  辽宁: ['沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭', '朝阳', '葫芦岛'],
  吉林: ['长春', '吉林', '四平', '辽源', '通化', '白山', '松原', '白城', '延边'],
  黑龙江: ['哈尔滨', '齐齐哈尔', '鸡西', '鹤岗', '双鸭山', '大庆', '伊春', '佳木斯', '七台河', '牡丹江', '黑河', '绥化', '大兴安岭'],
  江苏: ['南京', '无锡', '徐州', '常州', '苏州', '南通', '连云港', '淮安', '盐城', '扬州', '镇江', '泰州', '宿迁'],
  浙江: ['杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '衢州', '舟山', '台州', '丽水'],
  安徽: ['合肥', '芜湖', '蚌埠', '淮南', '马鞍山', '淮北', '铜陵', '安庆', '黄山', '滁州', '阜阳', '宿州', '六安', '亳州', '池州', '宣城'],
  福建: ['福州', '厦门', '莆田', '三明', '泉州', '漳州', '南平', '龙岩', '宁德'],
  江西: ['南昌', '景德镇', '萍乡', '九江', '新余', '鹰潭', '赣州', '吉安', '宜春', '抚州', '上饶'],
  山东: ['济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽'],
  河南: ['郑州', '开封', '洛阳', '平顶山', '安阳', '鹤壁', '新乡', '焦作', '濮阳', '许昌', '漯河', '三门峡', '南阳', '商丘', '信阳', '周口', '驻马店', '济源'],
  湖北: ['武汉', '黄石', '十堰', '宜昌', '襄阳', '鄂州', '荆门', '孝感', '荆州', '黄冈', '咸宁', '随州', '恩施', '仙桃', '潜江', '天门', '神农架'],
  湖南: ['长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界', '益阳', '郴州', '永州', '怀化', '娄底', '湘西'],
  广东: ['广州', '深圳', '珠海', '汕头', '佛山', '韶关', '河源', '梅州', '惠州', '汕尾', '东莞', '中山', '江门', '阳江', '湛江', '茂名', '肇庆', '清远', '潮州', '揭阳', '云浮'],
  广西: ['南宁', '柳州', '桂林', '梧州', '北海', '防城港', '钦州', '贵港', '玉林', '百色', '贺州', '河池', '来宾', '崇左'],
  海南: ['海口', '三亚', '三沙', '儋州', '五指山', '琼海', '文昌', '万宁', '东方', '定安', '屯昌', '澄迈', '临高', '白沙', '昌江', '乐东', '陵水', '保亭', '琼中'],
  四川: ['成都', '自贡', '攀枝花', '泸州', '德阳', '绵阳', '广元', '遂宁', '内江', '乐山', '南充', '眉山', '宜宾', '广安', '达州', '雅安', '巴中', '资阳', '阿坝', '甘孜', '凉山'],
  贵州: ['贵阳', '六盘水', '遵义', '安顺', '毕节', '铜仁', '黔西南', '黔东南', '黔南'],
  云南: ['昆明', '曲靖', '玉溪', '保山', '昭通', '丽江', '普洱', '临沧', '楚雄', '红河', '文山', '西双版纳', '大理', '德宏', '怒江', '迪庆'],
  西藏: ['拉萨', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里'],
  陕西: ['西安', '铜川', '宝鸡', '咸阳', '渭南', '延安', '汉中', '榆林', '安康', '商洛'],
  甘肃: ['兰州', '嘉峪关', '金昌', '白银', '天水', '武威', '张掖', '平凉', '酒泉', '庆阳', '定西', '陇南', '临夏', '甘南'],
  青海: ['西宁', '海东', '海北', '黄南', '海南州', '果洛', '玉树', '海西'],
  宁夏: ['银川', '石嘴山', '吴忠', '固原', '中卫'],
  新疆: ['乌鲁木齐', '克拉玛依', '吐鲁番', '哈密', '昌吉', '博尔塔拉', '巴音郭楞', '阿克苏', '克孜勒苏', '喀什', '和田', '伊犁', '塔城', '阿勒泰', '石河子', '阿拉尔', '图木舒克', '五家渠', '北屯', '铁门关', '双河', '可克达拉', '昆玉', '胡杨河', '新星', '白杨'],
  香港: ['香港'],
  澳门: ['澳门'],
  台湾: ['台北', '新北', '桃园', '台中', '台南', '高雄', '基隆', '新竹', '嘉义', '宜兰', '新竹县', '苗栗', '彰化', '南投', '云林', '嘉义县', '屏东', '台东', '花莲', '澎湖', '金门', '连江']
};

const cityOverrides = {
  北京: { code: 'BJS', tier: 1, districts: ['朝阳', '东城', '西城', '海淀', '丰台', '通州'] },
  上海: { code: 'SHA', tier: 1, districts: ['黄浦', '静安', '徐汇', '浦东', '虹桥', '陆家嘴'] },
  广州: { code: 'CAN', tier: 1, districts: ['天河', '越秀', '海珠', '珠江新城', '白云', '番禺'] },
  深圳: { code: 'SZX', tier: 1, districts: ['福田', '南山', '罗湖', '宝安', '前海', '龙岗'] },
  香港: { code: 'HKG', tier: 1, districts: ['中环', '尖沙咀', '湾仔', '铜锣湾', '旺角', '机场'] },
  成都: { code: 'CTU', tier: 2, districts: ['锦江', '武侯', '青羊', '高新', '春熙路', '天府新区'] },
  重庆: { code: 'CKG', tier: 2, districts: ['渝中', '江北', '南岸', '沙坪坝', '解放碑', '观音桥'] },
  杭州: { code: 'HGH', tier: 2, districts: ['西湖', '上城', '滨江', '钱江新城', '萧山', '余杭'] },
  南京: { code: 'NKG', tier: 2, districts: ['玄武', '秦淮', '鼓楼', '建邺', '新街口', '河西'] },
  武汉: { code: 'WUH', tier: 2, districts: ['江汉', '武昌', '汉口', '光谷', '汉阳', '洪山'] },
  西安: { code: 'SIA', tier: 2, districts: ['雁塔', '碑林', '未央', '高新', '钟楼', '曲江'] },
  天津: { code: 'TSN', tier: 2, districts: ['和平', '河西', '南开', '滨海新区', '河东', '河北'] },
  沈阳: { code: 'SHE', tier: 2, districts: ['沈河', '和平', '铁西', '浑南', '大东', '皇姑'] },
  大连: { code: 'DLC', tier: 2, districts: ['中山', '西岗', '沙河口', '星海', '甘井子', '金州'] },
  青岛: { code: 'TAO', tier: 2, districts: ['市南', '市北', '崂山', '黄岛', '五四广场', '李沧'] },
  济南: { code: 'TNA', tier: 2, districts: ['历下', '市中', '槐荫', '高新', '天桥', '泉城路'] },
  厦门: { code: 'XMN', tier: 2, districts: ['思明', '湖里', '集美', '海沧', '中山路', '鼓浪屿'] },
  福州: { code: 'FOC', tier: 2, districts: ['鼓楼', '台江', '仓山', '晋安', '东街口', '马尾'] },
  长沙: { code: 'CSX', tier: 2, districts: ['芙蓉', '天心', '岳麓', '开福', '五一广场', '梅溪湖'] },
  郑州: { code: 'CGO', tier: 2, districts: ['金水', '二七', '郑东新区', '管城', '中原', '高新'] },
  昆明: { code: 'KMG', tier: 2, districts: ['五华', '盘龙', '官渡', '西山', '滇池', '呈贡'] },
  三亚: { code: 'SYX', tier: 2, districts: ['海棠湾', '亚龙湾', '大东海', '三亚湾', '天涯', '吉阳'] },
  澳门: { code: 'MFM', tier: 2, districts: ['半岛', '氹仔', '路氹', '路环', '新口岸', '望德堂'] }
};

const defaultDistricts = ['市中心', '火车站', '高新区', '万达广场', '老城区', '新区'];

export const cityCatalog = Object.entries(provinceCities).flatMap(([province, cities]) =>
  cities.map((city) => ({
    province,
    city,
    code: cityOverrides[city]?.code || '',
    tier: cityOverrides[city]?.tier || 3,
    districts: cityOverrides[city]?.districts || defaultDistricts
  }))
);

const hotelBlueprints = [
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

const imagePool = [
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80'
];

export function findCity(input) {
  if (!input) return null;
  const normalized = normalizeDestinationInput(input);
  return (
    cityCatalog.find((item) => item.city === normalized) ||
    cityCatalog.find((item) => item.city.includes(normalized))
  );
}

export function findProvince(input) {
  if (!input) return null;
  const normalized = normalizeDestinationInput(input);
  return Object.keys(provinceCities).find((province) => province === normalized) || null;
}

export function resolveDestination(input) {
  const normalized = normalizeDestinationInput(input);
  if (!normalized) {
    return {
      type: 'nationwide',
      label: '全国',
      cities: cityCatalog
    };
  }

  const exactCity = findExactCity(normalized);
  const province = findProvince(normalized);
  if (province && (isProvinceIntent(input) || !exactCity)) {
    return {
      type: 'province',
      label: province,
      province,
      cities: cityCatalog.filter((item) => item.province === province)
    };
  }

  const city = exactCity || findCity(normalized);
  if (city) {
    return {
      type: 'city',
      label: city.city,
      city,
      cities: [city]
    };
  }

  if (province) {
    return {
      type: 'province',
      label: province,
      province,
      cities: cityCatalog.filter((item) => item.province === province)
    };
  }

  return {
    type: 'unknown',
    label: normalized,
    cities: []
  };
}

export function normalizeDestinationInput(input) {
  return String(input || '')
    .trim()
    .replace(/特别行政区$/, '')
    .replace(/维吾尔自治区$/, '')
    .replace(/壮族自治区$/, '')
    .replace(/回族自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/[省市]$/, '');
}

function findExactCity(input) {
  const normalized = normalizeDestinationInput(input);
  return cityCatalog.find((item) => item.city === normalized) || null;
}

function isProvinceIntent(input) {
  return /(?:省|自治区|特别行政区)$/.test(String(input || '').trim());
}

export function buildDemoHotels(params = {}) {
  const city = findCity(params.city) ?? cityCatalog[0];
  const nights = getNightCount(params.checkIn, params.checkOut);
  const seed = hash(`${city.city}-${params.checkIn ?? ''}-${params.checkOut ?? ''}-${params.adults ?? 2}`);
  const multiplier = getDateMultiplier(params.checkIn, city);
  const hotels = hotelBlueprints.map((hotel, index) => {
    const district = city.districts[(index + seed) % city.districts.length];
    const locationScore = 0.92 + ((seed + index * 7) % 18) / 100;
    const tierPremium = city.tier === 1 ? 1.38 : city.tier === 2 ? 1.15 : 0.96;
    const variance = 0.9 + ((seed + index * 13) % 24) / 100;
    const price = roundToTen(hotel.base * tierPremium * multiplier * variance);
    const rating = Math.min(4.9, 4.15 + hotel.star * 0.11 + ((seed + index * 5) % 18) / 100);
    const distance = (0.4 + ((seed + index * 11) % 48) / 10).toFixed(1);

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
      originalPrice: roundToTen(price * (1.12 + ((seed + index) % 12) / 100)),
      currency: 'CNY',
      distance,
      amenities: hotel.amenities,
      tags: buildTags(hotel, index, city),
      image: imagePool[index % imagePool.length],
      payment: index % 3 === 0 ? '到店付' : '在线付',
      cancellation: index % 4 === 0 ? '限时免费取消' : '不可取消',
      source: 'demo'
    };
  });

  return applyFilters(hotels, params);
}

export function applyFilters(hotels, params = {}) {
  const keyword = (params.keyword || '').trim().toLowerCase();
  const minPrice = Number(params.minPrice || 0);
  const maxPrice = Number(params.maxPrice || 0);
  const star = Number(params.star || 0);
  const sort = params.sort || 'recommend';

  let results = hotels.filter((hotel) => {
    const amenities = Array.isArray(hotel.amenities) ? hotel.amenities : [];
    const tags = Array.isArray(hotel.tags) ? hotel.tags : [];
    const haystack = `${hotel.name} ${hotel.city} ${hotel.province} ${hotel.district} ${hotel.style} ${amenities.join(' ')} ${tags.join(' ')}`.toLowerCase();
    const matchesKeyword = !keyword || haystack.includes(keyword);
    const matchesMin = !minPrice || hotel.price >= minPrice;
    const matchesMax = !maxPrice || hotel.price <= maxPrice;
    const matchesStar = !star || hotel.star === star;
    return matchesKeyword && matchesMin && matchesMax && matchesStar;
  });

  results = results.sort((a, b) => {
    if (sort === 'price-asc') return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    if (sort === 'rating') return b.rating - a.rating;
    return b.rating * 100 - b.price / 10 - (a.rating * 100 - a.price / 10);
  });

  return results;
}

export function summarizeCities() {
  const provinces = [...new Set(cityCatalog.map((item) => item.province))];
  return {
    cities: cityCatalog,
    provinces,
    count: cityCatalog.length
  };
}

export function getNightCount(checkIn, checkOut) {
  const inDate = checkIn ? new Date(`${checkIn}T00:00:00`) : new Date();
  const outDate = checkOut ? new Date(`${checkOut}T00:00:00`) : new Date(inDate.getTime() + 24 * 60 * 60 * 1000);
  const diff = Math.round((outDate - inDate) / (24 * 60 * 60 * 1000));
  return Math.max(1, Number.isFinite(diff) ? diff : 1);
}

function buildTags(hotel, index, city) {
  const tags = [hotel.style];
  if (hotel.star >= 5) tags.push('高星酒店');
  if (index % 2 === 0) tags.push('近商圈');
  if (index % 3 === 0) tags.push(city.tier === 1 ? '近地铁' : '免费停车');
  if (index % 5 === 0) tags.push('亲子友好');
  return tags.slice(0, 4);
}

function getDateMultiplier(checkIn, city) {
  if (!checkIn) return 1;
  const date = new Date(`${checkIn}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 1;
  const month = date.getMonth() + 1;
  const day = date.getDay();
  let multiplier = day === 5 || day === 6 ? 1.15 : 1;
  if (city.city === '三亚' && [1, 2, 7, 8, 12].includes(month)) multiplier += 0.24;
  if (['北京', '上海', '广州', '深圳', '杭州'].includes(city.city) && [4, 5, 9, 10].includes(month)) multiplier += 0.12;
  return multiplier;
}

function roundToTen(value) {
  return Math.max(90, Math.round(value / 10) * 10);
}

function hash(input) {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value << 5) - value + input.charCodeAt(index);
    value |= 0;
  }
  return Math.abs(value);
}
