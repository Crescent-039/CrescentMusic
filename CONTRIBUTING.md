# 参与开发

使用 Windows x64、Node.js 24 和 `npm ci`。阅读 AGENTS.md，保持受管音乐目录与 SQLite 的资料归属。

提交前执行 `npm test`。交互或播放变化运行 `npm run test:desktop`；构建变化运行 `npm run dist:clean` 与 `npm run test:clean`。增加依赖后运行 `npm run notices` 更新版权声明。

PR 写明具体问题、最终行为和已运行验证。聚焦根因，保持失败可见。测试使用可再生成的合成素材，输出放在 test-results。

提交源码、锁文件和必要文档。个人音频、数据库、截图、日志、账号缓存和密钥保留在忽略目录。贡献以项目 MIT 许可证提供，请确认内容有相应授权。
