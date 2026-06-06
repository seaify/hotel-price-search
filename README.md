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

多个文件里同一家酒店会合并成一张酒店卡，页面显示最低价和报价源数量。如果不同供应商使用不同渠道酒店 ID，可提供 `masterHotelId` / `standardHotelId` / `统一酒店ID`，系统会优先按这个统一 ID 合并报价。

也可以接远程供应商导出 URL，适合把携程、美团、飞猪、同程、渠道管理系统或自有合同库存定时导出到对象存储、内网接口、签名 URL：

```bash
export HOTEL_DATA_URL=https://example.com/hotel-prices.csv
npm start
```

```bash
export HOTEL_DATA_URLS=https://example.com/ctrip.csv,https://example.com/meituan.jsonl.gz
export HOTEL_DATA_URL_HEADERS='{"Authorization":"Bearer your_token"}'
export HOTEL_DATA_CACHE_SECONDS=60
export HOTEL_DATA_STALE_CACHE_SECONDS=300
npm start
```

远程 URL 使用和本地 CSV/JSON/JSONL 相同的字段格式，会和本地文件、网页导入文件一起合并，同酒店按最低价展示。远程文件默认缓存 60 秒，可用 `HOTEL_DATA_CACHE_SECONDS` 调整刷新间隔；本地文件会按修改时间和文件大小自动刷新。`HOTEL_DATA_STALE_CACHE_SECONDS` 可在远程源临时失败时继续使用最近成功拉取的过期缓存。带 `token`、`key`、`secret` 等查询参数的 URL 在 `/api/status` 中会自动脱敏。`/api/status` 的 `providers.localInventory.remoteInventory.loads` 会列出每个远程源的加载状态、行数、缓存命中和失败原因。

如果多家远程供应商字段不同，也可以配置一个远程清单 URL。Node 后端会读取清单里的多个供应商导出源，并按每个源的 `fieldMap` 做字段映射：

```bash
export HOTEL_DATA_MANIFEST_URL=https://example.com/hotel-suppliers.json
npm start
```

如果清单里需要放私密鉴权头，也可以不放远程文件，直接写进服务器环境变量：

```bash
export HOTEL_DATA_MANIFEST_CONFIG='{"sources":[{"name":"ctrip","url":"https://example.com/ctrip-prices.json","headers":{"Authorization":"Bearer ctrip_token"},"fieldMap":{"name":"hotel.title","city":"hotel.cityName","price":"rate.sale"}},{"name":"meituan","url":"https://example.com/meituan-prices.csv","headers":{"X-Api-Key":"meituan_key"}}]}'
npm start
```

清单格式与网页远程导入相同：

```json
{
  "sources": [
    {
      "name": "ctrip",
      "url": "https://example.com/ctrip-prices.json",
      "headers": {
        "Authorization": "Bearer ctrip_token"
      },
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
      "url": "https://example.com/meituan-prices.csv",
      "headers": {
        "X-Api-Key": "meituan_key"
      }
    }
  ]
}
```

`headers` 只适用于 Node 后端读取远程源；GitHub Pages 静态版由浏览器直接请求远程源，不能附加私密鉴权头，适合使用允许跨域访问的公开或签名 URL。静态版会在启动时自动尝试读取同目录的 `hotel-inventory.manifest.json`，可以把允许跨域访问的全国供应商分片 URL 写进这个文件，重新运行 `npm run build:pages` 后部署到 GitHub Pages。

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
  {"name":"ctrip","url":"https://example.com/ctrip-live","method":"GET","headers":{"Authorization":"Bearer ctrip_token"},"cityFanout":true,"cityFanoutConcurrency":4,"destinationMap":{"cities":{"南京":{"cityId":"320100","cityCode":"NKG"},"无锡":{"cityId":"320200","cityCode":"WUX"}}},"requestMap":{"cityId":"supplierDestination.cityId","cityName":"cityName","arrivalDate":"checkIn","departureDate":"checkOut","pageNo":"page","pageSize":"pageSize"},"requestDefaults":{"locale":"zh-CN","currency":"CNY"},"responsePath":"data.hotelList","paginationPath":"data.paging","fieldMap":{"id":"offerId","name":"hotel.title","province":"hotel.provinceName","city":"hotel.cityName","price":["rate.sale","price"],"checkIn":"stay.from","checkOut":"stay.to","bookingUrl":"rate.book"}},
  {"name":"meituan","url":"https://example.com/meituan-live","method":"POST","headers":{"X-Api-Key":"meituan_key"},"requestMap":{"destination.cityName":"city","stay.arrival":"checkIn","stay.departure":"checkOut","occupancy.adultCount":"adults","pagination.pageNo":"page","pagination.pageSize":"pageSize"}}
]'
npm start
```

`GET` 默认会把 `city`、`destinationType`、`keyword`、`checkIn`、`checkOut`、`adults`、`rooms`、`minPrice`、`maxPrice`、`star`、`sort`、`limit`、`offset` 作为查询参数传递；`POST` 默认会传同样的 JSON body。若供应商请求字段不同，可用 `requestMap` 改名：左边是供应商需要的请求字段，右边是本站内部查询字段。除原始 `limit` / `offset` 外，还可映射派生字段 `page` 和 `pageSize`，其中 `page = floor(offset / limit) + 1`。也可映射 `cityName`、`cityCode`、`cityId`、`provinceName`、`provinceCode`、`destinationId`、`supplierDestination.*` 等目的地字段。GET 会把嵌套路径展平成查询参数，例如 `stay.arrival=2026-06-06`；POST 会生成嵌套 JSON。`requestDefaults` 可放固定请求参数，例如 `locale`、`currency`、`channel`。

如果供应商需要自己的城市 ID 或目的地编码，可在单个源里配置 `destinationMap`，再在 `requestMap` 里引用 `supplierDestination.cityId`、`supplierDestination.cityCode` 或自定义字段：

```json
{
  "destinationMap": {
    "cities": {
      "南京": { "cityId": "320100", "cityCode": "NKG" },
      "无锡": { "cityId": "320200", "cityCode": "WUX" }
    },
    "provinces": {
      "江苏": { "provinceId": "320000" }
    }
  },
  "requestMap": {
    "cityId": "supplierDestination.cityId",
    "provinceId": "supplierDestination.provinceId"
  }
}
```

全国城市编码表较大时，也可以放到本地 JSON 文件或远程 JSON URL：

```json
{
  "destinationMapFile": "/absolute/path/supplier-destinations.json",
  "destinationMapUrl": "https://example.com/supplier-destinations.json",
  "destinationMapHeaders": { "Authorization": "Bearer map_token" },
  "requestMap": {
    "cityId": "supplierDestination.cityId",
    "cityCode": "supplierDestination.cityCode"
  }
}
```

编码表支持对象格式，也支持数组格式。数组适合从供应商城市表直接导出：

```json
[
  { "province": "江苏", "city": "南京", "cityId": "320100", "cityCode": "NKG" },
  { "province": "江苏", "city": "无锡", "cityId": "320200", "cityCode": "WUX" }
]
```

编码表接入后，可先检查它是否覆盖全国城市目录，不必真实调用查价接口：

```bash
curl 'http://localhost:5174/api/supplier-destinations?city=江苏省&cityLimit=20'
curl -OJ 'http://localhost:5174/api/supplier-destinations.csv'
```

如果供应商只支持城市级查价，不支持全国或省级目的地，可以启用 `cityFanout`。查询全国或省份时系统会按城市拆成多次请求，再合并酒店结果；`cityFanoutConcurrency` 控制并发数，`cityFanoutLimit` 可限制一次扇出的城市数量。

实时查价接口可启用短缓存，减少同一城市、日期、人数和分页条件的重复请求。默认 `0` 秒关闭；可用全局环境变量或单个源里的 `cacheSeconds` 开启：

```bash
export HOTEL_SUPPLIER_API_CACHE_SECONDS=30
export HOTEL_SUPPLIER_API_STALE_CACHE_SECONDS=300
export HOTEL_SUPPLIER_API_CACHE_MAX_ENTRIES=1000
```

```json
{
  "name": "ctrip",
  "url": "https://example.com/ctrip-live",
  "cacheSeconds": 30,
  "staleCacheSeconds": 300
}
```

`staleCacheSeconds` 只在同条件最近成功查过、但本次供应商接口失败时生效；它会返回标记为过期缓存的结果，并在状态里记录 `cacheStaleCount` 和对应错误信息。也可用别名 `staleTtlSeconds` 或 `staleIfErrorSeconds`。

供应商偶发 429/5xx 或网络错误时，可开启短重试。默认 `0` 次关闭；会优先遵守供应商返回的 `Retry-After`：

```bash
export HOTEL_SUPPLIER_API_RETRY_COUNT=2
export HOTEL_SUPPLIER_API_RETRY_DELAY_MS=300
export HOTEL_SUPPLIER_API_RETRY_STATUS_CODES=408,429,500,502,503,504
```

```json
{
  "name": "ctrip",
  "url": "https://example.com/ctrip-live",
  "retryCount": 2,
  "retryDelayMs": 300,
  "retryStatusCodes": [429, 500, 502, 503, 504]
}
```

供应商如果需要先换 access token，可以在单个源里配置 `auth`。`clientIdEnv` / `clientSecretEnv` 会从服务器环境变量读取密钥，token 会按 `expires_in` 缓存，并自动注入 `Authorization: Bearer ...`：

```json
{
  "auth": {
    "type": "client_credentials",
    "tokenUrl": "https://example.com/oauth/token",
    "clientIdEnv": "CTRIP_CLIENT_ID",
    "clientSecretEnv": "CTRIP_CLIENT_SECRET",
    "scope": "hotel.search"
  }
}
```

响应字段格式和本地供应商文件相同，支持嵌套 JSON、CSV、JSONL/NDJSON。若酒店列表在嵌套字段里，可用 `responsePath` 指向列表，例如 `data.hotelList`；若分页信息也在嵌套字段里，可用 `paginationPath`，例如 `data.paging`。若供应商返回字段不同，可用 `fieldMap` 把内部字段映射到供应商返回字段，支持点路径或候选路径数组，例如 `{"name":"hotel.title","price":["rate.sale","price"],"bookingUrl":"rate.book"}`。

单个实时供应商如果已经在接口侧做全国分页，可以返回总量和下一页信息，页面会沿用供应商的 `total` / `pagination`，不会把单页结果误判成全部结果：

```json
{
  "total": 1250,
  "coverageCities": 393,
  "pagination": {
    "offset": 24,
    "limit": 24,
    "nextOffset": 48,
    "hasMore": true
  },
  "hotels": [
    {
      "hotelName": "北京供应商酒店",
      "city": "北京市",
      "price": 688
    }
  ]
}
```

接入实时供应商后，可用覆盖探测接口验收“全国/省份每城是否有真实可售”。接口会按城市发小请求，默认每城每供应商只取 1 条结果，并使用同一套字段映射、日期可售和城市归一化逻辑判断覆盖：

```bash
curl 'http://localhost:5174/api/supplier-coverage?checkIn=2026-06-06&checkOut=2026-06-07&probeLimit=1&concurrency=4'
curl -OJ 'http://localhost:5174/api/supplier-coverage.csv?checkIn=2026-06-06&checkOut=2026-06-07'
```

也可以传 `city=江苏省` 探测单省，或用 `cityLimit=20` 先抽样。服务端环境变量 `HOTEL_SUPPLIER_COVERAGE_PROBE_LIMIT` 和 `HOTEL_SUPPLIER_COVERAGE_PROBE_CONCURRENCY` 可设置默认探测条数和并发数。

CSV 字段可参考 [hotel-prices.sample.csv](data/hotel-prices.sample.csv)、[hotel-prices.partner.sample.csv](data/hotel-prices.partner.sample.csv) 和中文表头版 [hotel-prices.zh.sample.csv](data/hotel-prices.zh.sample.csv)。JSONL 可参考 [hotel-prices.jsonl.sample](data/hotel-prices.jsonl.sample)。嵌套 JSON 可参考 [hotel-prices.nested.sample.json](data/hotel-prices.nested.sample.json)，支持 `hotels/items/data/results/records/list` 作为酒店集合，也支持酒店下的 `rooms/roomTypes/roomList` 和房型下的 `rates/offers/prices` 多报价结构。核心字段是：

```text
id,masterHotelId,name,province,city,district,address,star,rating,reviews,price,currency,amenities,tags,payment,cancellation,source,checkIn,checkOut,available,bookingUrl
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

也可以直接在网页左侧“导入价格”上传 CSV/JSON/JSONL，或填入一个允许浏览器访问的远程价格源 URL。Node 版上传和远程导入都会写入 `data/imports`，搜索会立即优先使用这些真实库存；可用 `HOTEL_IMPORT_DIR` 改成其他导入目录。GitHub Pages 静态版也支持浏览器内导入远程 CSV/JSON/JSONL，并会在浏览器里保存远程源、下次打开自动重载；远程服务需要允许跨域访问。静态版接入远程清单后，页面会在“接入状态”里显示每个远程源的加载结果、行数和失败摘要。

GitHub Pages 静态版默认会自动读取 `hotel-inventory.manifest.json`。把各供应商按省份、城市或渠道拆成多个 CSV/JSON/JSONL 分片后写入 `public/hotel-inventory.manifest.json`，再执行 `npm run build:pages`，上线页面会按目的地自动加载对应远程价格。清单源带 `cities` / `provinces` 时会在搜索对应城市或省份时懒加载；页面会先展示清单声明覆盖城市数，方便确认全国分片是否齐全；不带范围或设置 `preload: true` 时会启动即加载。也可以用 URL 参数临时接源：

```text
https://seaify.github.io/hotel-price-search/?inventoryManifestUrl=https%3A%2F%2Fexample.com%2Fhotel-suppliers.json
https://seaify.github.io/hotel-price-search/?inventoryUrl=https%3A%2F%2Fexample.com%2Fshenzhen-prices.csv
```

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
- Node 版和 GitHub Pages 静态版都支持远程供应商清单 manifest、多源自动重载、每源字段映射和远程源健康明细
- 实时供应商 API 支持每源请求字段映射、目的地编码映射、城市级扇出、分页元数据和覆盖探测
- `/api/status` 查看当前供应商接入状态
- `/api/coverage` 查看真实库存全国覆盖率，包含逐城市覆盖、按供应商分组覆盖和缺口城市；可传 `checkIn` / `checkOut` 计算指定入住日期的可售覆盖；`/api/coverage?format=csv` 或 `/api/coverage.csv` 可下载逐城市覆盖/缺口清单，CSV 会标出覆盖该城市的供应商来源
- `/api/supplier-destinations` 检查实时供应商目的地编码表覆盖率；可传 `city`、`cityLimit`，`/api/supplier-destinations.csv` 可下载逐城市编码覆盖表
- `/api/supplier-coverage` 对已配置的实时供应商 API 做按城市可售探测；可传 `city`、`checkIn` / `checkOut`、`probeLimit`、`concurrency`、`cityLimit`，`/api/supplier-coverage.csv` 可下载实时供应商覆盖缺口表
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

如果要让 GitHub Pages 页面打开后自动加载真实供应商库存，把公开或签名的供应商导出 URL 写入 [public/hotel-inventory.manifest.json](public/hotel-inventory.manifest.json)，例如：

```json
{
  "sources": [
    {
      "name": "ctrip-east",
      "url": "https://example.com/hotel-prices/east-china.csv",
      "provinces": ["上海", "江苏", "浙江", "安徽", "福建", "江西", "山东"]
    },
    {
      "name": "meituan-south",
      "url": "https://example.com/hotel-prices/south-china.jsonl",
      "cities": ["广州", "深圳", "珠海", "佛山", "东莞"],
      "fieldMap": {
        "id": "hotel.channelId",
        "masterHotelId": "hotel.standardId",
        "name": "hotel.name",
        "province": "hotel.province",
        "city": "hotel.city",
        "price": "rate.price",
        "bookingUrl": "rate.url"
      }
    }
  ]
}
```

然后重新运行 `npm run build:pages` 并推送，构建后的 `docs/hotel-inventory.manifest.json` 会随站点一起发布。全国库存建议按城市或省份分片，避免用户打开页面时一次下载完整全国价格库。

如果供应商已经给了多份 CSV/JSON/JSONL 分片文件，也可以放在 `public/inventory/` 下自动生成清单：

```bash
npm run build:pages
```

`build:pages` 会先扫描 `public/inventory/**/*.{csv,json,jsonl,ndjson}`，自动读取每个分片覆盖的城市，刷新 `public/hotel-inventory.manifest.json`，再递归复制到 `docs/`。如果库存文件托管在独立对象存储，可用 `--base-url` 手动生成绝对 URL：

```bash
npm run build:inventory-manifest -- --base-url https://static.example.com/hotel-price-search/
```

如果供应商给的是一份全国大文件，可以先自动拆成按城市懒加载的 JSONL 分片：

```bash
npm run split:inventory-shards -- --input /absolute/path/supplier-nationwide.csv --clean
npm run build:pages
```

拆分脚本会读取供应商文件里的省市字段，把记录写入 `public/inventory/<province>/<city>.jsonl`，并自动刷新 `public/hotel-inventory.manifest.json`。无法识别城市的行会被跳过并让命令返回非零退出码，便于先修数据再发布。

发布前可以用覆盖审计确认是否真的达到全国覆盖：

```bash
npm run audit:inventory-coverage
npm run audit:inventory-coverage -- --require-all-cities --missing-csv missing-cities.csv
HOTEL_PAGES_REQUIRE_FULL_INVENTORY_COVERAGE=true npm run build:pages
```

`--require-all-cities` 和 `HOTEL_PAGES_REQUIRE_FULL_INVENTORY_COVERAGE=true` 会在任一城市缺库存分片、存在未知城市名或存在未标注 `cities` / `provinces` 的源时返回非零退出码，防止“全国都要有”的数据目标被漏掉。
