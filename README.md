# TrueSearchMCP

**v1.0.0** · Browser-cookie powered Google & YouTube search for AI agents — **no API keys, no quotas**.

An MCP (Model Context Protocol) server that reads your real browser cookies and searches Google / scrapes YouTube exactly like your browser would.

## Status: EXPERIMENTAL / UNSTABLE

> ⚠️ **This software is experimental and unstable.**
>
> - Scraping breaks when Google/YouTube change their HTML or APIs
> - No stability guarantees — APIs and tool schemas may change without notice
> - Cookies are sensitive; never share your `.cookies.json`
> - Chrome v127+ (App-Bound Encryption) requires a remote-debugging workaround
> - Not audited for security. Use at your own risk.
>
> Suitable for personal experimentation only. Do not use in production.

## Tools (8)

| Tool | Description |
|------|-------------|
| `search_google` | Google search using your browser cookies |
| `search_youtube` | YouTube video search |
| `scrape_youtube_video` | Full video details (title, views, tags, description) |
| `get_youtube_comments` | Top comments via InnerTube API |
| `get_firefox_cookies` | Extract Firefox cookies (plaintext SQLite) |
| `get_chrome_cookies` | Extract Chrome cookies (DPAPI + AES-GCM) |
| `set_cookies` | Upload cookies for later use |
| `get_stored_cookies` | List uploaded cookies |

## Resource Usage (measured)

| Metric | Value |
|--------|-------|
| Memory (working set) | ~98 MB |
| Idle CPU | 0% (event-driven, wakes only on requests) |
| Cold start | ~830 ms |
| Build size | 123 KB |
| node_modules | 165 MB (first install only) |
| Source | ~2,100 lines TypeScript |

Largest deps: `better-sqlite3` 68 MB, `koffi` 28 MB (native), rest is small.

## Release build

```bash
npm install         # prepare hook compiles TypeScript automatically
npm run release     # tsc + npm pack → truesearch-mcp-1.0.0.tgz
```

The tarball (`truesearch-mcp-1.0.0.tgz`) contains `build/`, `install.bat`, `tsmcp.bat`, `README.md`, `LICENSE`, and `package.json` — no cookies, no config, no logs.

**Windows installer (recommended):**

```powershell
# extract the tarball, then from the extracted folder:
.\install.bat
```

What it does:
1. Copies the app to `%LOCALAPPDATA%\TrueSearchMCP`
2. Runs `npm install --omit=dev` (one-time dependency setup)
3. Drops a `tsmcp.bat` shim into `%APPDATA%\npm` (already on PATH for npm users)

Then in a **new** CMD/PowerShell window:

```powershell
tsmcp                 # interactive menu
tsmcp search "query"  # CLI passthrough (any cli.js command)
tsmcp harness list
```

Uninstall: delete `%LOCALAPPDATA%\TrueSearchMCP` and `%APPDATA%\npm\tsmcp.bat`.

**npm pack install (alternative):**

```bash
npm install -g ./truesearch-mcp-1.0.0.tgz
truesearch          # interactive menu
truesearch-mcp      # MCP server on stdio
```

### Releasing to GitHub (not yet done)

Repo is initialized locally and files are staged. When you're ready:

```bash
git commit -m "Release v1.0.0"
git tag v1.0.0
git remote add origin <your-github-repo-url>
git push -u origin main --tags
```

Then attach `truesearch-mcp-1.0.0.tgz` to the GitHub Release for `v1.0.0`.

> `.cookies.json`, `.config.json`, `mcp.log`, `build/`, and `node_modules/` are gitignored — cookies never enter the repo.

## Installation

### 1. Build from source (once, required for every harness)

```bash
git clone <repo-url>
cd TrueSearchMCP
npm install          # runs `prepare` → builds automatically
```

The MCP entry point is `<repo>/build/index.js` (e.g. `D:\TrueSearchMCP\build\index.js`).

One-command installer for Claude Desktop + Claude Code:

```bash
npm run config -- install both
```

### 2. Add to a harness

> ⚠️ **All harness installs are EXPERIMENTAL / UNSTABLE.** Config formats change between harness versions; tool schemas may shift without notice. Verify with the harness's MCP status command after adding.

| # | Harness | Config location | Install command / snippet |
|---|---------|-----------------|---------------------------|
| 1 | **Claude Desktop** | `%AppData%\Claude\claude_desktop_config.json` | JSON below, or `npm run config -- install desktop` |
| 2 | **Claude Code** | `~/.claude.json` (user) / `.mcp.json` (project) | `claude mcp add truesearch -- node D:\TrueSearchMCP\build\index.js --scope user` |
| 3 | **Hermes** (Nous Research) | `~/.hermes/config.yaml` or `%AppData%\hermes\config.yaml` | YAML below (`mcp_servers:` key) |
| 4 | **OpenCode** | `~/.config/opencode/opencode.json` | JSON below (`mcp` key, `type: "local"`) |
| 5 | **Cline / Roo Code** (VS Code) | `cline_mcp_settings.json` (extension UI → MCP Servers) | JSON below via extension settings |
| 6 | **Cursor** | `~/.cursor/mcp.json` or Settings → MCP | JSON below (`mcpServers` key) |
| 7 | **Goose** (Block) | `~/.config/goose/config.yaml` | YAML below (`mcp_servers:` key) |
| 8 | **Zed** | `~/.config/zed/settings.json` | JSON below (`context_servers` key) |
| 9 | **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | JSON below (`mcpServers` key) |
| 10 | **Continue** (VS Code) | `~/.continue/config.yaml` | YAML below (`mcp_servers:` key) |

#### Claude Desktop

`%AppData%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "truesearch": {
      "command": "node",
      "args": ["D:\\TrueSearchMCP\\build\\index.js"],
      "type": "stdio"
    }
  }
}
```

Restart Claude Desktop after saving.

#### Claude Code

CLI (recommended):

```bash
claude mcp add --scope user truesearch -- node D:\TrueSearchMCP\build\index.js
claude mcp list          # verify: ✔ Connected
```

Or edit `~/.claude.json` (user scope) / `.mcp.json` (project scope):

```json
{
  "mcpServers": {
    "truesearch": {
      "type": "stdio",
      "command": "node",
      "args": ["D:\\TrueSearchMCP\\build\\index.js"]
    }
  }
}
```

Verify inside a session with `/mcp`.

#### Hermes

Append to `~/.hermes/config.yaml` (or `%AppData%\hermes\config.yaml`), then `/reload-mcp`:

```yaml
mcp_servers:
  truesearch:
    command: "node"
    args: ["D:/TrueSearchMCP/build/index.js"]
    enabled: true
    timeout: 120
```

Tools appear as `mcp__truesearch__search_google`, etc.

#### OpenCode

`~/.config/opencode/opencode.json` (note: `type` must be `"local"`, not `"stdio"`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "truesearch": {
      "type": "local",
      "command": ["node", "D:/TrueSearchMCP/build/index.js"],
      "enabled": true
    }
  }
}
```

#### Cline / Roo Code

VS Code → Cline extension → MCP Servers → Add New MCP Server, paste:

```json
{
  "mcpServers": {
    "truesearch": {
      "command": "node",
      "args": ["D:\\TrueSearchMCP\\build\\index.js"],
      "type": "stdio"
    }
  }
}
```

#### Cursor

`~/.cursor/mcp.json` (or Settings → MCP → Add new global MCP server):

```json
{
  "mcpServers": {
    "truesearch": {
      "command": "node",
      "args": ["D:\\TrueSearchMCP\\build\\index.js"]
    }
  }
}
```

#### Goose

`~/.config/goose/config.yaml`:

```yaml
mcp_servers:
  truesearch:
    command: node
    args: ["D:/TrueSearchMCP/build/index.js"]
```

#### Zed

`~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "truesearch": {
      "command": "node",
      "args": ["D:\\TrueSearchMCP\\build\\index.js"]
    }
  }
}
```

#### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "truesearch": {
      "command": "node",
      "args": ["D:\\TrueSearchMCP\\build\\index.js"]
    }
  }
}
```

#### Continue

`~/.continue/config.yaml`:

```yaml
mcp_servers:
  truesearch:
    command: node
    args: ["D:/TrueSearchMCP/build/index.js"]
```

### Global install from release tarball (experimental)

```bash
npm install -g ./truesearch-mcp-1.0.0.tgz
truesearch                      # interactive menu
truesearch-mcp                  # MCP server on stdio
```

(`npm install -g truesearch-mcp` will work once the package is published to npm — not yet.)

Every harness row above is **unstable/experimental** when paired with this server — HTML scraping is inherently brittle and breaks when Google/YouTube change their markup.

## Usage

### Interactive menu

```bash
npm start
```

Arrow keys / `j k` to navigate, Enter to select, `1-9` hotkeys, Esc/q to go back.

### CLI

```bash
npm run search -- "query" --browser stored
node build/cli.js yt search "rust tutorial"
node build/cli.js yt video "dQw4w9WgXcQ"
node build/cli.js yt comments "dQw4w9WgXcQ"
node build/cli.js config health
node build/cli.js harness list              # auto-detect installed harnesses
node build/cli.js harness install <id>      # install MCP into a harness
node build/cli.js harness uninstall <id>    # remove MCP from a harness
```

### REPL

```bash
npm run repl
```

## Browser notes

- **Firefox** — cookies read directly from `cookies.sqlite` (plaintext). Works out of the box.
- **Chrome ≤126** — cookies decrypted via Windows DPAPI + AES-256-GCM.
- **Chrome 127+ (App-Bound Encryption / v20)** — cannot decrypt externally. Either:
  - Use Firefox or `stored` cookies, or
  - Restart Chrome with `--remote-debugging-port=9222` (falls back to DevTools Protocol).
- **System proxy** — auto-detected from Windows settings; override with `config proxy auto|off|URL`.

## Proxy

Reads Windows system proxy automatically (`HKCU\...\Internet Settings\ProxyServer`).
Default mode: `auto`. Change with:

```bash
npm run config -- proxy off
npm run config -- proxy http://127.0.0.1:7890
```

## License

MIT — see [LICENSE](LICENSE).
