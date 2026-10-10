# 回归测试

改完代码后跑一遍，确认没把别的功能弄坏：

```bash
tests/run.sh              # 全部（约 10 分钟）
tests/run.sh fold merge   # 只跑指定的几项
```

需要 Node 22+、全局安装的 playwright，以及 Chromium（默认 `/usr/bin/chromium`，也可以用环境变量 `CHROMIUM` 指定）。

每项测试都会拿一份全新的测试数据，单独启动一个只监听 127.0.0.1 的藏馆服务，跑完就停掉。测试数据由 `fixtures/make.mjs` 现场生成，全是虚构的卡，不含任何真实藏馆内容。

| 端口 | 用途 |
| --- | --- |
| 5199 | 测试用藏馆服务 |
| 5198 | 模拟酒馆（`mock/tavern.mjs`，测插件桥） |
| 5197 | 模拟 AI 接口（`mock/ai.mjs`，不会请求真实服务） |
| 5189 | 生成测试数据时临时使用 |

截图、日志和测试数据都放在 `tests/.work/`（不进仓库），失败时看 `tests/.work/logs/<测试名>.log`。
