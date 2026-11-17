# Crescent Music

Windows 本地音乐播放器。音乐副本放在 EXE 同级的 `Music/`，SQLite 资料库放在 `Data/`。主题色为 `#006cff`。

## 功能

- 单文件、多选或文件夹导入，解析 MP3、FLAC、WAV、M4A、AAC、OGG、Opus、AIFF、WebM 的元数据和封面。实际编码播放能力由 Electron Chromium 决定。
- 完整文件 SHA-256 去重；同名不同内容、不同音质或格式可以共存。
- 歌单、收藏、搜索、拖动排序、最近播放、周统计和累计排行；大列表虚拟化与按需缩略图。
- 每轮实际听超过 60 秒计一次；时长不超过 60 秒的短曲听满 90% 并结束计一次。暂停、拖动和卡顿时间排除。
- 标题或封面单击进入详情，双击播放，其余区域单击高亮。动态封面、同步歌词、歌词跳转、LRC 导入和轻量过渡。
- 可拖动置顶的桌面歌词、Windows 任务栏封面与播放控制、队列、随机/循环、定时停止、媒体键和上次进度恢复。
- SQLite 备份/恢复，以及由用户主动触发的网易云本地历史、自创歌单和歌词匹配。

## 开发与验证

目前支持 **Windows x64**，需要 **Node.js 24**。

```powershell
npm ci
npm test
npm start
```

依赖安装后也可以运行 `启动播放器.cmd`。桌面测试需要 Windows 图形桌面，使用独立资料目录与合成素材：

```powershell
npm run test:desktop
```

素材来源及生成方法见 [tests/fixtures/README.md](tests/fixtures/README.md)。测试输出位于 `test-results/`。

## 公开发行：空曲库构建

```powershell
npm run dist:clean
npm run test:clean
npm run release:zip
```

成品位于 `release/CrescentMusic-<版本>/`。运行其中的 `Crescent Music.exe`，移动时保留整个目录。该入口打包应用与第三方许可证，生成空的 Music/Data；`portable-only` 标记关闭首次启动时从旧 AppData 自动导入。

输出目录已存在时构建停止，避免覆盖已有资料。先移走旧输出，再构建同一版本。`release:zip` 生成 ZIP 和 SHA-256 校验文件。

## 本地升级：保留使用资料

```powershell
npm run dist
```

先正常退出旧播放器。此入口输出到 `dist/`，复制上一版本的 Music、Data 和 SQLite 快照，重写歌曲路径，保留旧版。目标资料库已存在时保持原数据。此目录用于个人升级，可能包含音乐和记录。

公开发行版手动升级时，退出播放器，将旧版完整 Music/Data 复制到新版 EXE 同级目录后启动；旧路径会校正。完整备份需同时保留这两个目录。

## 网易云与歌词

网易云本地来源通常为 `%LOCALAPPDATA%/NetEase/CloudMusic/Library/webdb.dat`，由用户主动读取，来源保持只读。迁移前备份本应用数据库；日期事件保留，通过来源键去重。来源覆盖范围取决于客户端留存的缓存。

只同步自己创建的普通歌单。歌名、艺人、专辑和时长用于本地关联，同录音重复文件优先 FLAC；缺少音频的条目保留待导入。再次同步保留本地额外添加歌曲和自定义排序。

歌词匹配为需要联网的非官方功能，接口和结果可能变化。支持自行提供 UTF-8 LRC。本项目与网易云音乐独立，无账号登录或音乐下载功能；使用时应遵守服务条款与内容授权。本地播放可离线使用，联网请求由用户操作触发。

手工累计次数的通用 TSV 导入见 [docs/count-import.md](docs/count-import.md)。

## 快捷键与许可证

- 空格：播放/暂停；Ctrl+K：搜索；Escape：返回列表。
- Ctrl+Alt+Space、Ctrl+Alt+Left/Right：全局播放和切歌；支持媒体键。
- 设置中可打开音乐文件夹、导出和恢复数据库。

项目采用 [MIT](LICENSE)，自有图标与合成测试素材同样采用 MIT。用户音乐、歌词和封面保留各自权利。第三方声明见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)；成品另附 Electron/Chromium 完整声明。

参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)，发布步骤见 [docs/releasing.md](docs/releasing.md)。Windows CI 配置已提供，远程执行结果以仓库 Actions 实际运行记录为准。
