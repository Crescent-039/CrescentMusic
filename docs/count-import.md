# 手工累计数导入

在来源目录放入 UTF-8 `counts.tsv` 与各行引用的图片。工具读取人工转录的表格；截图识别由用户自行完成。

TSV 表头（实际用制表符分隔）：

```text
rank	title	artist	total	captured_at	reference	local_title	local_artist
```

rank 为唯一正整数，total 为非负安全整数；captured_at 为带时区的 ISO 日期，如 `2026-01-01T12:00:00+08:00`。reference 是来源目录内图片的相对路径。可选 local_title、local_artist 显式提供匹配别名，空值沿用原字段。支持任意行数。

退出播放器，在当前版本本地升级成品存在时执行：

```powershell
node scripts/import-count-screenshots.mjs <来源目录>
```

工具备份 dist 中当前版本资料库后写入累计基准。基准覆盖历史重叠，日期事件继续用于周统计；后续有效播放累加，同来源重复导入去重，缺少音频的条目保留待匹配。来源图片与报告留在本机 Data/imports。
