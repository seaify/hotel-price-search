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

如果多家远程供应商字段不同，也可以配置一个远程清单 URL。Node 后端会读取清单里的多个供应商导出源，并按每个源的 `fieldMap` 做字段映射：

```bash
export HOTEL_DATA_MANIFEST_URL=https://example.com/hotel-suppliers.json
npm start
```

清单格式与网页远程导入相同：

```json
{
  "sources": [
    {
      "name": "ctrip",
      "url": "https://example.com/ctrip-prices.json",
      "fieldMap": {
        "id": "offerId",
        "name": "hotel.title",
        "province": "hotel.provinceName",
        "city": "hotel.cityName",
        "price": ["rate.sale", "price"],
        "checkIn": "stay.from",
        "checkOut": "stay.to"
      }
    },
    {
      "name": "meituan",
      "url": "https://example.com/meituan-prices.csv"
    }
  ]
}
```

如果供应商提供的是实时查价接口，而不是定时导出文件，也可以配置通用实时 API。系统会把目的地、日期、成人、房间、价格等查询参数传给供应商，并把对方返回的 CSV/JSON/JSONL 统一归一化到酒店结果里：

```bash
export HOTEL_SUPPLIER_API_URL=https://example.com/api/hotel-search
export HOTEL_SUPPLIER_API_NAME=your_supplier_name
export HOTEL_SUPPLIER_API_METHOD=GET
export HOTEL_SUPPLIER_API_HEADERS='{"Authorization":"Bearer your_token"}'
npm start
```

多家实时供应商可以用逗号、分号或换行分隔，系统会并发查询并按同酒店合并报价，优先展示最低价：

```bash
export HOTEL_SUPPLIER_API_URLS=https://example.com/ctrip-live,https://example.com/meituan-live
export HOTEL_SUPPLIER_API_NAMES=ctrip,meituan
npm start
```

如果每家供应商需要不同的请求方式或鉴权头，用 JSON 数组配置：

```bash
export HOTEL_SUPPLIER_API_CONFIG='[
  {"name":"ctrip","url":"https://example.com/ctrip-live","method":"GET","headers":{"Authorization":"Bearer ctrip_token"},"fieldMap":{"id":"offerId","name":"hotel.title","province":"hotel.provinceName","city":"hotel.cityName","price":["rate.sale","price"],"checkIn":"stay.from","checkOut":"stay.to","bookingUrl":"rate.book"}},
  {"name":"meituan","url":"https://example.com/meituan-live","method":"POST","headers":{"X-Api-Key":"meituan_key"}}
]'
npm start
```

`GET` 会把 `city`、`destinationType`、`keyword`、`checkIn`、`checkOut`、`adults`、`rooms`、`minPrice`、`maxPrice`、`star`、`sort`、`limit`、`offset` 作为查询参数传递；`POST` 会传 JSON body。响应字段格式和本地供应商文件相同，支持嵌套 JSON、CSV、JSONL/NDJSON。若供应商字段不同，可用 `fieldMap` 把内部字段映射到供应商返回字段，支持点路径或候选路径数组，例如 `{"name":"hotel.title","price":["rate.sale","price"],"bookingUrl":"rate.book"}`。

CSV 字段可参考 [hotel-prices.sample.csv](data/hotel-prices.sample.csv)、[hotel-prices.partner.sample.csv](data/hotel-prices.partner.sample.csv) 和中文表头版 [hotel-prices.zh.sample.csv](data/hotel-prices.zh.sample.csv)。JSONL 可参考 [hotel-prices.jsonl.sample](data/hotel-prices.jsonl.sample)。嵌套 JSON 可参考 [hotel-prices.nested.sample.json](data/hotel-prices.nested.sample.json)，支持 `hotels/items/data/results/records/list` 作为酒店集合，也支持酒店下的 `rooms/roomTypes/roomList` 和房型下的 `rates/offers/prices` 多报价结构。核心字段是：

```text
id,name,province,city,district,address,star,rating,reviews,price,currency,amenities,tags,payment,cancellation,source,checkIn,checkOut,available,bookingUrl
```

省市字段会自动规范化，供应商文件里的 `广东省`、`深圳市`、`广西壮族自治区`、`广东省深圳市` 等写法会统一归并到内部的省份/城市名称，便于省级查询和覆盖率统计。

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

也可以直接在网页左侧“导入价格”上传 CSV/JSON/JSONL，或填入一个允许浏览器访问的远程价格源 URL。Node 版上传和远程导入都会写入 `data/imports`，搜索会立即优先使用这些真实库存；可用 `HOTEL_IMPORT_DIR` 改成其他导入目录。GitHub Pages 静态版也支持浏览器内导入远程 CSV/JSON/JSONL，并会在浏览器里保存远程源、下次打开自动重载；远程服务需要允许跨域访问。

如果有多家供应商远程导出，也可以把 URL 填成一个清单 JSON。每个供应商可配置自己的 `fieldMap`，用于把非标准字段映射到内部字段：

```json
{
  "sources": [
    {
      "name": "ctrip",
      "url": "https://example.com/ctrip-prices.json",
      "fieldMap": {
        "id": "offerId",
        "name": "hotel.title",
        "province": "hotel.provinceName",
        "city": "hotel.cityName",
        "price": ["rate.sale", "price"],
        "checkIn": "stay.from",
        "checkOut": "stay.to",
        "bookingUrl": "rate.book"
      }
    },
    {
      "name": "meituan",
      "url": "https://example.com/meituan-prices.csv"
    }
  ]
}
```

## 功能

- 全国、省份、城市、酒店名、商圈、设施关键词搜索
- 入住/离店日期、成人数、房间数
- 星级、价格区间、综合/价格/评分排序
- 全国模式：不填目的地时展示跨城市候选酒店；输入省份时展示该省所有城市候选酒店
- 全国结果分页加载，接口支持 `limit` / `offset`
- 覆盖全国地级/州/盟/特别行政区/台湾主要城市级别目的地
- 数据源状态提示：本地真实库存、实时接口、回退或示例数据
- 真实库存覆盖率看板：展示已覆盖城市数、总城市数、真实酒店数、按供应商覆盖和缺口城市
- 多供应商文件合并，同酒店保留多报价并优先显示最低价
- 网页上传供应商 CSV/JSON/JSONL，无需重启服务即可查询导入价格
- Node 版和 GitHub Pages 静态版都支持远程供应商清单 manifest、多源自动重载和每源字段映射
- `/api/status` 查看当前供应商接入状态
- `/api/coverage` 查看真实库存全国覆盖率，包含逐城市覆盖、按供应商分组覆盖和缺口城市；可传 `checkIn` / `checkOut` 计算指定入住日期的可售覆盖；`/api/coverage?format=csv` 或 `/api/coverage.csv` 可下载逐城市覆盖/缺口清单，CSV 会标出覆盖该城市的供应商来源
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

构建结果在 `docs/`，GitHub Pages 选择 `main` 分支的 `/docs` 目录即可。Pages 静态版没有 Node 后端，仍可使用全国示例价格库，也支持在浏览器内导入 CSV/JSON/JSONL 后查询，并可下载逐城市覆盖缺口表；需要服务器保存上传文件、读取 gzip 压缩包或接实时 API 时，请使用 `npm start` 的 Node 版本。
