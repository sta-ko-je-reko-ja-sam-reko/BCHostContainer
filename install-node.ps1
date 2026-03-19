$ProgressPreference = 'SilentlyContinue'
$installer = Join-Path $env:TEMP 'node-setup.msi'
Write-Host 'Downloading Node.js 22 LTS...'
Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi' -OutFile $installer -UseBasicParsing
Write-Host 'Installing Node.js...'
Start-Process msiexec.exe -ArgumentList '/i', $installer, '/quiet', '/norestart' -Wait
Remove-Item $installer -Force -ErrorAction SilentlyContinue
Write-Host 'Node.js installed.'
