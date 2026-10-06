# dsh-galcode

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) bundle for
[Galcode](https://github.com/Furinaaa-Cancan/Galcode) — the MyGO/Ave Mujica WebGAL
fan-work generator.

Installed into a dsh profile, this bundle contributes:

- **`mcp-galcode`** — an `@deepseek-ai/dsh-mcp-client` row bridging the
  `galcode-mcp` stdio MCP server. Its tools register globally as
  `mcp__galcode__galcode_validate_story`, `mcp__galcode__galcode_compile_story`,
  `mcp__galcode__galcode_preview_start`, `mcp__galcode__galcode_preview_stop`,
  `mcp__galcode__galcode_list_outputs`, `mcp__galcode__galcode_read_output`,
  `mcp__galcode__galcode_read_log`.
- **`preset-galcode`** — an `@deepseek-ai/dsh-agent-preset` declaration: the
  Galcode creative-director persona (ported from the CLI's built-in prompts),
  the bundled skills, filesystem/shell/ask-user/todo tools, and compaction.
- **skills/** — `story-schema`, `webgal-rules`, `asset-conventions`,
  `live2d-licensing`, mounted through `@deepseek-ai/dsh-skill-filesystem`.
- Overrides: `agent-default-model` → `deepseek-official/deepseek-chat`, and the
  community TUI's preset-registry default → `galcode` (when
  `@deepseek-harness-tui/dsh-tui` is installed).

## MCP server command resolution

1. `$GALCODE_MCP_SERVER` — absolute path of `bin/galcode-mcp.js`, set by the
   `galcode` launcher before spawning dsh; the row then runs it with the
   current Node executable (Windows-safe: no `.cmd` shim spawning).
2. `galcode-mcp` — the bin the published `galcode` npm package puts on PATH
   (POSIX fallback for dsh sessions launched without the `galcode` wrapper).

For local development:

```bash
GALCODE_MCP_SERVER=/path/to/Galcode/bin/galcode-mcp.js dsh --profile galcode
```

## Layout

```
cordis.patch.yml          host-plane rows (mcp bridge, model/preset defaults)
presets/galcode.patch.yml the galcode agent preset declaration
skills/<name>/SKILL.md    bundled skills
```

This package contains no runtime code; everything is declarative YAML plus
skill markdown. It is shipped inside the `galcode` npm package
(`packages/dsh-galcode`) and installed into the dsh profile from that local
path — it is not published to npm on its own.
