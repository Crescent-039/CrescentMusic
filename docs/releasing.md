# 发布流程

执行 `npm run notices` 和 `npm run source:export`。导出使用白名单并生成逐文件 SHA-256 清单。已有导出可用 `npm run source:export -- --refresh` 更新；归档只包含审核的源码，依赖与测试输出留在归档外。

解压源码 ZIP，在 CrescentMusic 目录创建 Git 仓库并提交到指定远程。首次提交前核对暂存内容仅为源码、测试素材、文档和配置。

## 成品

1. 更新 package.json、package-lock.json 和 CHANGELOG.md 的版本。
2. 运行 `npm ci`、`npm test`、`npm run test:desktop`。
3. 运行 `npm run dist:clean`、`npm run test:clean`、`npm run release:zip`。
4. 将 release 下 ZIP 和 `.sha256` 附到 GitHub Release，保留第三方版权声明。

公开成品 Music/Data 必须为空；个人升级入口 `npm run dist` 会迁移本机资料。

Electron 首次使用时获取官方运行时。代理环境可在当前终端设置 `ELECTRON_GET_USE_PROXY=1`，配合现有 HTTP/HTTPS 代理变量。代理地址和凭据保留在本机环境中。

## 仓库设置

启用 Actions、Dependency graph 与私密漏洞报告。Windows workflow 只读仓库，产物作为 Actions artifact 提供。远程执行结果以仓库实际运行记录为准。
