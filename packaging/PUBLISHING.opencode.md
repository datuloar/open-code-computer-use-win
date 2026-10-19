# Publish the Repository on GitHub

The maintained repository is [datuloar/open-code-computer-use-win](https://github.com/datuloar/open-code-computer-use-win).
It includes source, English documentation, tests, MIT license and GitHub Actions workflows.
The CLI is `opencode-cu`, and the package root exports the native OpenCode plugin. Keep OpenCode releases in this repository.

## Publish a fork or a clean export

Create an empty GitHub repository under your account. Do not initialize another README,
license or gitignore. In PowerShell, open this exported folder and run:

```powershell
git init -b main
git add .
git commit -m 'Add OpenCode computer use for Windows'
$repositoryUrl = Read-Host 'Paste the HTTPS clone URL of your new GitHub repository'
git remote add origin $repositoryUrl
git push -u origin main
```

GitHub authentication happens through Git or its credential manager. Do not paste a token
into this project, a config file or a public issue. If using the GitHub web upload instead,
upload the contents of this folder, including `.github`, `.gitignore` and `.gitattributes`.

The package contains `PACKAGE-MANIFEST.json` with relative filenames and checksums. It proves
which files were exported; it contains no user configuration. The release ZIP checksum travels
beside the ZIP. Neither checksum is a publisher signature.

## Run the checks

```powershell
node src/verify.js
node test/run.mjs
```

GitHub runs the first two checks on Windows for pushes and pull requests. The hosted runner
does not provide a verified interactive desktop, so CI does not run GUI input or physical ESC tests.
See [VALIDATION.md](VALIDATION.md) for local desktop and OpenCode checks.

The maintained Git source does not carry a release integrity manifest. Every clean release export
includes `PACKAGE-MANIFEST.json`. After extracting a release, verify it with
`node src/package-opencode.js --check .` before editing files.

## Build a release locally

Run from your maintained repository:

```powershell
$repositorySlug = Read-Host 'Enter your GitHub owner/repository'
powershell -NoProfile -ExecutionPolicy Bypass -File .\package-opencode.ps1 -Repository $repositorySlug
```

The wrapper verifies the source and unit tests, creates a new clean repository under `dist`,
checks its contract and unit tests, then writes a ZIP and SHA256 checksum file next to it.
It prints the exact output paths. Existing output folders are never overwritten.
Use `-OutputDir <new folder>` to choose another output directory.

`-Repository owner/repository` records your real GitHub metadata in the exported `package.json`.
It does not create a repository, authenticate, push or publish anything. Without that option,
the package uses `datuloar/open-code-computer-use-win`.

## Publish a version tag

Set the desired version in `package.json`, review changes and commit them. Push a matching tag:

```powershell
$version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
git tag "v$version"
git push origin "v$version"
```

The `release` workflow requires the tag to match `package.json`. It builds and verifies the
export, creates the release with GitHub's generated notes, and attaches the ZIP and checksum.
It uses the repository's workflow token; no personal token or package registry account is needed.
If repository policy blocks release writes, upload the locally built files to a GitHub Release.

For later releases, increment the version before creating a new tag. Do not move an already
published tag to different code. Users can pin a release instead of tracking the default branch.

## Keep documentation and user configuration separate

Tell users to follow [INSTALL.md](INSTALL.md) or give their agent [AGENT_SETUP.md](AGENT_SETUP.md).
Installation runs from the user's permanent clone and merges their local OpenCode configuration.
Never commit a working user's `opencode.json`, auth store, configuration backup or model key.

The shared backend remains MIT-licensed; retain [LICENSE](../LICENSE) and source attribution.
The UI uses OpenCode colors; this independent project is not an official OpenCode release.
