# 全国酒店价格查询网站

这是一个可运行的酒店价格查询网站，默认提供覆盖全国城市的示例价格库；接入供应商 API 或本地供应商价格文件后，后端会优先查询真实价格并自动显示数据源状态。

## 运行

```bash
cd /Users/seaify/hotel-price-search
npm start
```

打开 `http://localhost:5174`。

## 接入真实价格

最直接的方式是接入供应商、渠道管理系统或酒店价格聚合服务导出的 CSV/JSON/JSONL 文件。可以接一个文件，也可以接多个供应商文件；本地和远程源也支持 `.csv.gz`、`.json.gz`、`.jsonl.gz`、`.ndjson.gz` 压缩包：

```bash
export HOTEL_DATA_FILE=/absolute/path/to/hotel-prices.csv
npm start
```

```bash
export HOTEL_DATA_FILES=/absolute/path/ctrip.csv,/absolute/path/meituan.jsonl,/absolute/path/direct-contracts.json.gz
npm start
```

多个文件里同一家酒店会合并成一张酒店卡，页面显示最低价和报价源数量。

也可以接远程供应商导出 URL，适合把携程、美团、飞猪、同程、渠道管理系统或自有合同库存定时导出到对象存储、内网接口、签名 URL：

```bash
export HOTEL_DATA_URL=https://example.com/hotel-prices.csv
npm start
```

```bash
export HOTEL_DATA_URLS=https://example.com/ctrip.csv,https://example.com/meituan.jsonl.gz
export HOTEL_DATA_URL_HEADERS='{"Authorization":"Bearer your_token"}'
export HOTEL_DATA_CACHE_SECONDS=60
npm start
```

远程 URL 使用和本地 CSV/JSON/JSONL 相同的字段格式，会和本地文件、网页导入文件一起合并，同酒店按最低价展示。远程文件默认缓存 60 秒，可用 `HOTEL_DATA_CACHE_SECONDS` 调整刷新间隔；本地文件会按修改时间和文件大小自动刷新。带 `token`、`key`、`secret` 等查询参数的 URL 在 `/api/status` 中会自动脱敏。

CSV 字段可参考 [hotel-prices.sample.csv](data/hotel-prices.sample.csv)、[hotel-prices.partner.sample.csv](data/hotel-prices.partner.sample.csv) 和中文表头版 [hotel-prices.zh.sample.csv](data/hotel-prices.zh.sample.csv)。JSONL 可参考 [hotel-prices.jsonl.sample](data/hotel-prices.jsonl.sample)。嵌套 JSON 可参考 [hotel-prices.nested.sample.json](data/hotel-prices.nested.sample.json)，支持 `hotels/items/data/results/records/list` 作为酒店集合，也支持酒店下的 `rooms/roomTypes/roomList` 和房型下的 `rates/offers/prices` 多报价结构。核心字段是：

```text
id,name,province,city,district,address,star,rating,reviews,price,currency,amenities,tags,payment,cancellation,source,checkIn,checkOut,available,bookingUrl
```

也识别常见中文表头，例如：

```text
酒店ID,酒店名称,省份,城市,行政区,酒店地址,星级,用户评分,点评数,最低价,币种,酒店设施,推荐标签,付款方式,取消政策,供应商,入住日期,离店日期,是否可售,预订链接
```

也可以接入实时 API。复制 `.env.example` 中的配置并设置环境变量：

```bash
export AMADEUS_CLIENT_ID=your_client_id
export AMADEUS_CLIENT_SECRET=your_client_secret
export AMADEUS_BASE_URL=https://test.api.amadeus.com
npm start
```

当前实时适配器使用 Amadeus Hotel List 和 Hotel Search 接口。国内酒店“全国全量、实时、可预订”需要携程、同程、美团、飞猪、Booking.com、Amadeus 等供应商的正式接口、分销合作或渠道管理系统数据，仅靠前端页面无法保证全量实时价格。

也可以直接在网页左侧“导入价格”上传 CSV/JSON/JSONL。上传文件会写入 `data/imports`，搜索会立即优先使用这些真实库存；可用 `HOTEL_IMPORT_DIR` 改成其他导入目录。

## 功能

- 全国、省份、城市、酒店名、商圈、设施关键词搜索
- 入住/离店日期、成人数、房间数
- 星级、价格区间、综合/价格/评分排序
- 全国模式：不填目的地时展示跨城市候选酒店；输入省份时展示该省所有城市候选酒店
- 全国结果分页加载，接口支持 `limit` / `offset`
- 覆盖全国地级/州/盟/特别行政区/台湾主要城市级别目的地
- 数据源状态提示：本地真实库存、实时接口、回退或示例数据
- 真实库存覆盖率统计：展示已覆盖城市数、总城市数和缺口城市
- 多供应商文件合并，同酒店保留多报价并优先显示最低价
- 网页上传供应商 CSV/JSON/JSONL，无需重启服务即可查询导入价格
- `/api/status` 查看当前供应商接入状态
- `/api/coverage` 查看真实库存全国覆盖率
- `/api/imports` 查看或上传供应商文件

## 验证

```bash
npm test
```

## 部署到 GitHub Pages

这个仓库支持和 `https://seaify.github.io/douyin-live-schedule/` 相同的项目页部署方式。生成静态站点：

```bash
npm run build:pages
```

构建结果在 `docs/`，GitHub Pages 选择 `main` 分支的 `/docs` 目录即可。Pages 静态版没有 Node 后端，仍可使用全国示例价格库，也支持在浏览器内导入 CSV/JSON/JSONL 后查询；需要服务器保存上传文件、读取 gzip 压缩包或接实时 API 时，请使用 `npm start` 的 Node 版本。
