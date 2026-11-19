# Spike S4 / R8: install Aider 0.86.2 with a hash-locked uv, into a throwaway folder only. Not Bunny code.
# param: -Root <spike folder holding uv\uv.exe>   Everything (cache, Python, venv, home) lives under -Root; nothing is installed machine-wide and the person's profile is not used.
param([Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Continue'   # uv writes progress to stderr, which Stop would turn into an error
$fake = Join-Path $Root 'fakehome'
New-Item -ItemType Directory -Force -Path (Join-Path $fake 'AppData\Roaming'), (Join-Path $fake 'AppData\Local'), (Join-Path $Root 'uvcache'), (Join-Path $Root 'python') | Out-Null
$env:USERPROFILE = $fake; $env:HOME = $fake; $env:APPDATA = Join-Path $fake 'AppData\Roaming'; $env:LOCALAPPDATA = Join-Path $fake 'AppData\Local'
$env:UV_CACHE_DIR = Join-Path $Root 'uvcache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Root 'python'
$env:UV_NO_CONFIG = '1'
$env:UV_PYTHON_PREFERENCE = 'only-managed'
$env:UV_PYTHON_INSTALL_BIN = '0'          # no shim in a PATH folder
$env:UV_NO_MODIFY_PATH = '1'
$uv = Join-Path $Root 'uv\uv.exe'
Write-Output "== uv python install 3.12"
& $uv python install 3.12 2>&1
Write-Output "== uv pip compile aider-chat==0.86.2 --generate-hashes (python 3.12, windows, wheels only)"
Set-Content -LiteralPath (Join-Path $Root 'aider.in') -Value 'aider-chat==0.86.2'
& $uv pip compile (Join-Path $Root 'aider.in') --generate-hashes --python-version 3.12 --python-platform windows --only-binary :all: -o (Join-Path $Root 'aider.lock') 2>&1 | Select-Object -Last 5
Write-Output "== uv venv"
& $uv venv (Join-Path $Root 'venv') --python 3.12 2>&1
Write-Output "== uv pip install --require-hashes --only-binary :all:"
& $uv pip install --python (Join-Path $Root 'venv\Scripts\python.exe') --require-hashes --only-binary :all: -r (Join-Path $Root 'aider.lock') 2>&1 | Select-Object -Last 8
Write-Output "== done"
