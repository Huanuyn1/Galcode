# 添加自己的素材

`figure/` 是 Galcode 的本地素材库。背景、BGM 和解压后的 Live2D 模型可以直接放入对应目录；素材只在本地使用，版权资源已被 `.gitignore` 排除，不要公开二次分发。

## 目录与格式

```text
figure/
├── 背景/                 场景图：png、jpg、jpeg、webp、gif、svg
│   └── 角色或地点/       可选的子目录，方便分类
├── bgm/                  音乐：mp3、ogg、wav、flac、m4a
├── chara/                chara 包：保留原有目录结构
│   └── <角色>/<服装>/    .model3.json、.moc3、贴图、动作、表情
├── mygo/                 旧版 Cubism 2 模型（可选）
└── _mtn_exp/             旧版模型共用的动作、表情（随模型包保留）
```

- **场景图**放进 `figure/背景/`，**BGM** 放进 `figure/bgm/`。可以使用子目录和中文文件名；不要把文件只放在 `figure/` 顶层。
- **解压后的 chara 模型**按 `figure/chara/<角色>/<服装>/` 放置。一个服装目录必须包含 `.model3.json` 以及它引用的 `.moc3`、贴图、动作和表情；请复制完整目录，不要只复制入口 JSON。角色目录使用资源包既有的英文标识，例如 `anon`、`tomorin`；姓名对照见 `chara/name.md`。
- 若模型的 `.model3.json` 引用 `../../共享表情动作/` 等相对路径，也必须一起保留 `figure/chara/共享表情动作/`。移动或重命名角色、服装目录后，要同步检查这些引用。
- **Live2D zip 包**也可以放在素材目录中，由 `galcode cli prepare-live2d figure` 或生成流程自动准备。解压后的模型无需重复打包。
- 旧版 `mygo` 模型的共享动作、表情在 `_mtn_exp/` 时，两者要一起保留。

## 让 AI 使用新素材

素材索引在生成、校验或编译时更新，无需重启 TUI。可以直接对 AI 说：

```text
重新读取本地素材清单，告诉我新增的背景、BGM，以及各角色可用的 Live2D 服装。
```

校验或编译故事后，读取 `galcode://assets`，按 `characterKey`、服装、`motions` 和 `expressions` 选择实际存在的资产。不要只凭文件名猜测动作。源码目录也可以运行：

```bash
node bin/galcode.js cli index figure
```

如果 AI 没有使用刚添加的资源，让它重新读取清单，确认文件位于上述目录，且模型入口与支持文件完整。

## Live2D 运行时与版权

模型和 WebGAL 的 Live2D 运行时是两回事。引擎还需要用户合法取得的 `live2d.min.js` 与 `live2dcubismcore.min.js`；安装命令：

```bash
galcode cli install-live2d-runtime --from <runtime 文件所在目录>
```

公开仓库和 npm 包不分发官方模型、动作、贴图及 Live2D SDK/runtime。获取演示素材的方式见项目 `README.md`；使用或分享素材前请遵守对应权利方的许可。
