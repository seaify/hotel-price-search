# 酒店价格供应商交付包

这个目录用于把全国酒店价格数据交给 hotel-price-search 发布流程。请供应商或渠道系统按这里的模板导出 CSV/JSON/JSONL/XLSX/ZIP 文件。

## 交付物

- `supplier-inventory.template.csv`: 标准 CSV 表头模板。
- `supplier-source-manifest.template.json`: 多供应商或多分片 URL 清单模板。
- `supplier-field-map.template.json`: 非标准字段映射模板。
- `city-catalog.csv`: 发布验收使用的全国城市目录。
- `sample-valid-inventory.csv`: 可通过格式解析的少量示例行，不代表真实库存。
- `required-fields.md`: 字段说明和发布验收要求。

## 验收规则

发布全国真实价格时，至少需要覆盖 city-catalog.csv 中的 393 个城市。
每个城市至少要有 1 家可识别酒店、1 条可解析正价报价；生产发布建议提高到每城 20 家以上，并要求 `updatedAt` 足够新。

## 预检命令

```bash
npm run verify:supplier-inventory -- --input /absolute/path/supplier-nationwide.csv
npm run verify:supplier-inventory -- --input /absolute/path/supplier-nationwide.csv --check-in 2026-06-06 --check-out 2026-06-07 --min-hotels-per-city 20 --min-priced-hotels-per-city 20 --max-price-age-hours 6 --reference-time 2026-06-06T12:00:00Z
```

GitHub Actions 里先运行 `Publish supplier inventory` 并勾选 `dry_run`；预检通过后再取消 `dry_run` 正式发布到 GitHub Pages。
