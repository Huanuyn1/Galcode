---
name: live2d-licensing
description: Live2D 许可与运行时安装说明 — 为什么公开仓库不带 live2d.min.js 和官方模型,缺文件时怎么补,预览没有模型时怎么排查。
whenToUse: 预览里看不到 Live2D 模型、用户问为什么没有模型/怎么装运行时,或需要解释 Live2D 素材的许可边界时。
---

# Live2D 许可与运行时

Live2D SDK/运行时是受版权保护的材料,Galcode 公开仓库不分发它们;官方模型素材同样不随公开仓库附带。

## WebGAL 需要的运行时文件

WebGAL 引擎目录下的 `public/lib/` 需要两个文件:

- `live2d.min.js`
- `live2dcubismcore.min.js`

缺失时 WebGAL 会静默禁用 Live2D,预览画面里只有背景和文字,没有模型。

## 用户自备后的安装方式

用户从合法渠道获得这两个文件后(例如 Cubism SDK for Web 的 Core 与 Framework 构建产物):

```bash
galcode cli install-live2d-runtime --from /path/to/live2d-sdk-lib
```

该命令会把两个文件复制到 `vendor/webgal-mygo/packages/webgal/public/lib/`。

## 模型素材

- 模型以 Cubism 2/3/4 的 zip 压缩包形式放在素材目录里时,`galcode cli prepare-live2d`(或生成时自动)会把可渲染的包解压到 `.galcode/live2d-cache` 并挂载到编译产物的 `game/figure/live2d/`。
- 公开仓库自带一个最小占位清单;没有官方模型时故事仍然可以编译——编译器会把缺失的立绘降级处理。告诉用户:想要完整 Live2D 画面,需要自行准备模型压缩包与上述运行时文件。

## 排查清单

1. `mcp__galcode__galcode_read_log` 看预览任务日志里有没有 Live2D 相关警告。
2. 确认 `public/lib/live2d.min.js` 与 `live2dcubismcore.min.js` 存在。
3. 确认编译产物 `game/figure/live2d/` 下有模型目录。
4. 运行时的可用性摘要也可读取 `galcode://runtime-status` 资源(含 ffmpeg、WebGAL 引擎、Live2D 运行时文件状态)。
