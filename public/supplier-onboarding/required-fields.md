# 字段要求

| 字段 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- |
| `id` | 是 | 供应商报价或酒店在该源内的唯一 ID | `ctrip-10001` |
| `masterHotelId` | 建议 | 跨渠道合并同一家酒店的标准 ID | `CN-BJ-000001` |
| `name` | 是 | 酒店名称 | `北京国贸供应商酒店` |
| `province` | 是 | 省级行政区，建议不带“省/市/自治区”后缀也可 | `北京` |
| `city` | 是 | 城市或地区名，需要能匹配 `city-catalog.csv` | `北京` |
| `district` | 否 | 区县或商圈 | `朝阳` |
| `address` | 否 | 酒店地址 | `北京市朝阳区示例路 1 号` |
| `star` | 否 | 星级，数字 1-5 | `5` |
| `rating` | 否 | 评分 | `4.8` |
| `reviews` | 否 | 点评数 | `1200` |
| `price` | 是 | 当前可售最低价，必须是大于 0 的数字 | `688` |
| `totalPrice` | 否 | 入住周期总价；缺省时按 `price * nights` 计算 | `1376` |
| `currency` | 否 | 币种，默认 CNY | `CNY` |
| `source` | 是 | 供应商或渠道名 | `直接签约供应商` |
| `checkIn` | 建议 | 报价可覆盖入住开始日期 | `2026-06-06` |
| `checkOut` | 建议 | 报价可覆盖离店日期 | `2026-06-07` |
| `available` | 建议 | 是否可售，`true/false` | `true` |
| `updatedAt` | 建议 | 价格更新时间，用于新鲜度验收 | `2026-06-06T12:00:00Z` |
| `bookingUrl` | 否 | 跳转预订 URL | `https://supplier.example.com/hotel/10001` |

如果供应商字段名不同，使用 `supplier-field-map.template.json` 配置映射。