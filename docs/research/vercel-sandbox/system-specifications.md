# System Specifications

## Runtimes

| Runtime | Path | Package Managers |
|---------|------|------------------|
| node24 | `/vercel/runtimes/node24` | npm, pnpm |
| node22 | `/vercel/runtimes/node22` | npm, pnpm |
| python3.13 | `/vercel/runtimes/python` | pip, uv |

Default: `node24`

## User & Permissions

- User: `vercel-sandbox`
- Default directory: `/vercel/sandbox`
- Sudo: Available

## Available Packages

Amazon Linux 2023 base plus:

- bind-utils, bzip2, findutils, git, gzip, iputils
- libicu, libjpeg, libpng, ncurses-libs
- openssl, openssl-libs, procps, tar, unzip
- which, whois, zstd

## Installing Additional Packages

Use `dnf` (Amazon Linux 2023 package manager):

```bash
sudo dnf install <package-name>
```

See [AWS AL2023 packages](https://docs.aws.amazon.com/linux/al2023/release-notes/all-packages-AL2023.7.html) for full list.

## Sudo Configuration

- `HOME` = `/root` (sourced from root's config)
- `PATH` = unchanged (project binaries available with sudo)
- Environment variables inherited