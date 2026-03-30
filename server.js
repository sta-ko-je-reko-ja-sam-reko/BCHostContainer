const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// Paths
const DATA_FILE = path.join(__dirname, 'data', 'containers.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File upload config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const id = req.params.id || 'temp';
        const dir = path.join(UPLOADS_DIR, id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

// --- Data persistence ---

function loadContainers() {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveContainers(containers) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(containers, null, 2));
}

// --- PowerShell execution ---

function runPowerShell(script) {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', script
        ]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (data) => { stdout += data.toString(); });
        ps.stderr.on('data', (data) => { stderr += data.toString(); });

        ps.on('close', (code) => {
            // Resolve if we got stdout, even if exit code is non-zero
            // (BCContainerHelper writes warnings to stderr which cause non-zero exit)
            if (code === 0 || stdout.trim()) {
                resolve(stdout.trim());
            } else {
                reject(new Error(stderr || `PowerShell exited with code ${code}`));
            }
        });
    });
}

// Like runPowerShell but returns combined stdout+stderr for diagnostics
function runPowerShellVerbose(script) {
    return new Promise((resolve, reject) => {
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', script
        ]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (data) => { stdout += data.toString(); });
        ps.stderr.on('data', (data) => { stderr += data.toString(); });

        ps.on('close', (code) => {
            const combined = (stdout + '\n' + stderr).trim();
            if (code === 0 || stdout.trim()) {
                resolve(combined);
            } else {
                reject(new Error(combined || `PowerShell exited with code ${code}`));
            }
        });
    });
}

// --- API Routes ---

// Check if container name exists (in Docker or in our records)
app.get('/api/containers/check-name/:name', async (req, res) => {
    const name = req.params.name;
    let exists = false;
    let source = '';

    // Check our own records
    const containers = loadContainers();
    const local = containers.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (local) {
        exists = true;
        source = `Already exists in BC Container Manager (status: ${local.status})`;
    }

    // Check Docker
    if (!exists) {
        try {
            const result = await runPowerShell(
                `docker inspect --format='{{.State.Status}}' '${name}' 2>$null`
            );
            if (result && !result.includes('Error')) {
                exists = true;
                source = `Docker container found (status: ${result.trim()})`;
            }
        } catch { /* not found in Docker, that's fine */ }
    }

    res.json({ exists, source });
});

// Get all containers
app.get('/api/containers', (req, res) => {
    res.json(loadContainers());
});

// Get single container
app.get('/api/containers/:id', (req, res) => {
    const containers = loadContainers();
    const container = containers.find(c => c.id === req.params.id);
    if (!container) return res.status(404).json({ error: 'Container not found' });
    res.json(container);
});

// Create container
app.post('/api/containers', (req, res) => {
    const id = uuidv4();
    const container = {
        id,
        name: req.body.name,
        hosting: req.body.hosting, // 'local' or 'azure'
        bcType: req.body.bcType, // 'onprem' or 'saas'
        bcVersion: req.body.bcVersion,
        country: req.body.country || 'dk',
        auth: req.body.auth || 'NavUserPassword',
        username: req.body.username || 'admin',
        password: req.body.password || 'admin',
        // Azure fields
        azureSubscription: req.body.azureSubscription || '',
        azureResourceGroup: req.body.azureResourceGroup || '',
        azureRegion: req.body.azureRegion || '',
        azureVmSize: req.body.azureVmSize || '',
        // File references
        licenseFile: req.body.licenseFile || '',
        backupFile: req.body.backupFile || '',
        appFiles: req.body.appFiles || [],
        cleanupUsers: req.body.cleanupUsers || false,
        cleanupSql: req.body.cleanupSql || '',
        // State
        status: 'pending',
        url: '',
        createdAt: new Date().toISOString(),
        logs: []
    };

    const containers = loadContainers();
    containers.push(container);
    saveContainers(containers);

    res.status(201).json(container);
});

// Upload files (license, backup, apps)
app.post('/api/containers/:id/upload', upload.array('files'), (req, res) => {
    const containers = loadContainers();
    const container = containers.find(c => c.id === req.params.id);
    if (!container) return res.status(404).json({ error: 'Container not found' });

    const fileType = req.body.fileType; // 'license', 'backup', 'app'
    const uploadedFiles = req.files.map(f => ({
        originalName: f.originalname,
        path: f.path,
        size: f.size
    }));

    if (fileType === 'license' && uploadedFiles.length > 0) {
        container.licenseFile = uploadedFiles[0].path;
    } else if (fileType === 'backup' && uploadedFiles.length > 0) {
        container.backupFile = uploadedFiles[0].path;
    } else if (fileType === 'app') {
        container.appFiles = [...(container.appFiles || []), ...uploadedFiles.map(f => f.path)];
    }

    saveContainers(containers);
    res.json({ files: uploadedFiles, container });
});

// Build/provision container
app.post('/api/containers/:id/build', async (req, res) => {
    const containers = loadContainers();
    const container = containers.find(c => c.id === req.params.id);
    if (!container) return res.status(404).json({ error: 'Container not found' });

    container.status = 'building';
    container.logs = [];
    saveContainers(containers);

    try {
        if (container.hosting === 'local') {
            await buildLocalContainer(container);
        } else {
            await buildAzureContainer(container);
        }

        container.status = 'running';
        saveContainers(containers);
        res.json(container);
    } catch (err) {
        container.status = 'error';
        container.logs.push({ time: new Date().toISOString(), message: err.message });
        saveContainers(containers);
        res.status(500).json({ error: err.message, container });
    }
});

// Import license to an existing container
app.post('/api/containers/:id/import-license', upload.single('file'), async (req, res) => {
    const containers = loadContainers();
    const container = containers.find(c => c.id === req.params.id);
    if (!container) return res.status(404).json({ error: 'Container not found' });

    if (!req.file) {
        return res.status(400).json({ error: 'No license file uploaded' });
    }

    try {
        const script = `Import-Module BCContainerHelper -Force -WarningAction SilentlyContinue 3>$null; ` +
            `Import-BCContainerLicense -containerName '${container.name}' -licenseFile '${req.file.path}';`;

        const output = await runPowerShellVerbose(script);
        container.licenseFile = req.file.path;
        saveContainers(containers);
        res.json({ success: true, output });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Publish additional apps to an existing container
app.post('/api/containers/:id/publish-apps', upload.array('files'), async (req, res) => {
    const containers = loadContainers();
    const container = containers.find(c => c.id === req.params.id);
    if (!container) return res.status(404).json({ error: 'Container not found' });

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No app files uploaded' });
    }

    const results = [];
    for (const file of req.files) {
        try {
            const script = `Import-Module BCContainerHelper -Force -WarningAction SilentlyContinue 3>$null; ` +
                `$credential = New-Object pscredential '${container.username}', (ConvertTo-SecureString -String '${container.password}' -AsPlainText -Force); ` +
                `Publish-BCContainerApp -containerName '${container.name}' -credential $credential -appFile '${file.path}' -install -sync -skipVerification;`;

            const output = await runPowerShellVerbose(script);
            container.appFiles = [...(container.appFiles || []), file.path];
            results.push({ file: file.originalname, success: true, output });
        } catch (err) {
            results.push({ file: file.originalname, success: false, error: err.message });
        }
    }

    saveContainers(containers);
    res.json({ results, container });
});

// Container actions: stop, start, restart, remove
app.post('/api/containers/:id/:action', async (req, res) => {
    const { id, action } = req.params;
    if (!['stop', 'start', 'restart', 'remove', 'refresh'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }

    const containers = loadContainers();
    const idx = containers.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Container not found' });

    const container = containers[idx];

    // Handle refresh inline
    if (action === 'refresh') {
        try {
            if (container.hosting === 'local') {
                const result = await runPowerShell(
                    `docker inspect --format='{{.State.Status}}' '${container.name}' 2>$null`
                );
                if (result.includes('running')) container.status = 'running';
                else if (result.includes('exited')) container.status = 'stopped';
                else container.status = 'unknown';

                // Ensure URL uses container name
                container.url = `http://${container.name}/BC`;
            }
            saveContainers(containers);
            return res.json(container);
        } catch {
            container.status = 'unknown';
            saveContainers(containers);
            return res.json(container);
        }
    }

    try {
        if (container.hosting === 'local') {
            await localContainerAction(container, action);
        } else {
            await azureContainerAction(container, action);
        }

        if (action === 'remove') {
            // Clean up uploaded files
            const uploadDir = path.join(UPLOADS_DIR, container.id);
            if (fs.existsSync(uploadDir)) {
                fs.rmSync(uploadDir, { recursive: true, force: true });
            }
            containers.splice(idx, 1);
        } else if (action === 'stop') {
            container.status = 'stopped';
        } else if (action === 'start' || action === 'restart') {
            container.status = 'running';
        }

        saveContainers(containers);
        res.json(action === 'remove' ? { removed: true } : container);
    } catch (err) {
        container.logs.push({ time: new Date().toISOString(), message: err.message });
        saveContainers(containers);
        res.status(500).json({ error: err.message });
    }
});

// Refresh container status from Docker/Azure
app.post('/api/containers/:id/refresh', async (req, res) => {
    const containers = loadContainers();
    const container = containers.find(c => c.id === req.params.id);
    if (!container) return res.status(404).json({ error: 'Container not found' });

    try {
        if (container.hosting === 'local') {
            const result = await runPowerShell(
                `docker inspect --format='{{.State.Status}}' '${container.name}' 2>$null`
            );
            if (result.includes('running')) container.status = 'running';
            else if (result.includes('exited')) container.status = 'stopped';
            else container.status = 'unknown';
        }
        saveContainers(containers);
        res.json(container);
    } catch {
        container.status = 'unknown';
        saveContainers(containers);
        res.json(container);
    }
});

// Get available BC versions
app.get('/api/bc-versions', async (req, res) => {
    const type = req.query.type || 'OnPrem';
    const country = req.query.country || 'dk';
    try {
        const result = await runPowerShell(
            `Import-Module BCContainerHelper -Force -WarningAction SilentlyContinue 3>$null; ` +
            `Get-BCArtifactUrl -type ${type} -country ${country} -select All -after ([DateTime]::Now.AddYears(-2)) | ` +
            `ForEach-Object { if($_ -match '/(\\d+\\.\\d+\\.\\d+\\.\\d+)/') { $Matches[1] } } | ` +
            `Select-Object -Unique | Sort-Object { [version]$_ } -Descending | Select-Object -First 30`
        );
        // Parse line-by-line instead of JSON (avoids BCContainerHelper info lines breaking JSON)
        const versions = result.split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => /^\d+\.\d+\.\d+\.\d+$/.test(l));
        res.json(versions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Check local prerequisites
app.get('/api/prerequisites', async (req, res) => {
    const checks = {};
    try {
        const svcResult = await runPowerShell("Get-Service 'Docker' -ErrorAction Stop | Select-Object -ExpandProperty Status");
        checks.docker = svcResult.includes('Running');
    } catch { checks.docker = false; }

    try {
        await runPowerShell('Get-Module -ListAvailable BCContainerHelper | Select-Object -First 1');
        checks.bcContainerHelper = true;
    } catch { checks.bcContainerHelper = false; }

    try {
        const hvResult = await runPowerShell(
            "if (Get-Service 'vmcompute' -ErrorAction SilentlyContinue) { " +
            "(Get-Service 'vmcompute').Status.ToString() } else { 'NotFound' }"
        );
        checks.hyperV = hvResult.trim() === 'Running';
    } catch { checks.hyperV = false; }

    res.json(checks);
});

// Check Azure prerequisites
app.get('/api/prerequisites/azure', async (req, res) => {
    const checks = {};
    try {
        const result = await runPowerShell('Get-Module -ListAvailable Az.Accounts | Select-Object -First 1 | ForEach-Object { $_.Version.ToString() }');
        checks.azModule = result ? true : false;
    } catch { checks.azModule = false; }

    try {
        const result = await runPowerShell(
            'Import-Module Az.Accounts -ErrorAction Stop; ' +
            '(Get-AzContext).Account.Id'
        );
        checks.azLoggedIn = result ? true : false;
        checks.azAccount = result || '';
    } catch {
        checks.azLoggedIn = false;
        checks.azAccount = '';
    }

    res.json(checks);
});

// Install prerequisites
app.post('/api/prerequisites/install', async (req, res) => {
    const { component } = req.body;

    const installScripts = {
        docker: `
            Write-Output 'Enabling Windows Containers feature...';
            Enable-WindowsOptionalFeature -Online -FeatureName Containers -All -NoRestart -ErrorAction Stop;
            Write-Output 'Installing Docker Engine via PowerShell...';
            Install-Module DockerMsftProvider -Force -ErrorAction Stop;
            Install-Package Docker -ProviderName DockerMsftProvider -Force -ErrorAction Stop;
            Write-Output 'Starting Docker service...';
            Start-Service Docker -ErrorAction SilentlyContinue;
            Set-Service Docker -StartupType Automatic;
            Write-Output 'Docker Engine installed and started. A restart may be required if this is the first time.';
        `,
        hyperv: `
            Write-Output 'Enabling Hyper-V (requires Administrator privileges)...';
            Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart;
            Write-Output 'Hyper-V enabled. A system restart is required to complete setup.';
        `,
        bcContainerHelper: `
            Write-Output 'Setting execution policy...';
            Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force;
            if (Get-Module -ListAvailable -Name NavContainerHelper) {
                Write-Output 'Removing old NavContainerHelper...';
                Uninstall-Module NavContainerHelper -Force -AllVersions -ErrorAction SilentlyContinue;
            }
            Write-Output 'Installing BCContainerHelper module...';
            Install-Module BCContainerHelper -Force -Scope CurrentUser -AllowClobber;
            Import-Module BCContainerHelper -Force;
            Write-Output 'BCContainerHelper installed successfully.';
        `,
        azModule: `
            Write-Output 'Installing Az PowerShell module (this may take several minutes)...';
            Install-Module Az -Force -Scope CurrentUser -AllowClobber -Repository PSGallery;
            Write-Output 'Az module installed successfully.';
        `,
        azLogin: `
            Write-Output 'Opening Azure login prompt...';
            Import-Module Az.Accounts -Force;
            Connect-AzAccount;
            $ctx = Get-AzContext;
            Write-Output "Logged in as $($ctx.Account.Id) on subscription $($ctx.Subscription.Name)";
        `,
        installAllLocal: `
            $errors = @();

            # 1. Hyper-V
            Write-Output '--- [1/3] Checking Hyper-V ---';
            $hv = (Get-WindowsOptionalFeature -FeatureName Microsoft-Hyper-V -Online).State;
            if ($hv -ne 'Enabled') {
                Write-Output 'Enabling Hyper-V...';
                try { Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart -ErrorAction Stop; Write-Output 'Hyper-V enabled (restart required).'; }
                catch { $errors += "Hyper-V: $_"; Write-Output "WARNING: Hyper-V failed - may need Administrator. $_"; }
            } else { Write-Output 'Hyper-V already enabled.'; }

            # 2. Docker Engine
            Write-Output '--- [2/3] Checking Docker Engine ---';
            $dockerSvc = Get-Service 'Docker' -ErrorAction SilentlyContinue;
            if (-not $dockerSvc) {
                Write-Output 'Enabling Windows Containers feature...';
                try { Enable-WindowsOptionalFeature -Online -FeatureName Containers -All -NoRestart -ErrorAction Stop; } catch { Write-Output "Containers feature: $_"; }
                Write-Output 'Installing Docker Engine...';
                try {
                    Install-Module DockerMsftProvider -Force -ErrorAction Stop;
                    Install-Package Docker -ProviderName DockerMsftProvider -Force -ErrorAction Stop;
                    Start-Service Docker -ErrorAction SilentlyContinue;
                    Set-Service Docker -StartupType Automatic;
                    Write-Output 'Docker Engine installed and started.';
                } catch { $errors += "Docker: $_"; Write-Output "WARNING: Docker Engine install failed. $_"; }
            } elseif ($dockerSvc.Status -ne 'Running') {
                Write-Output 'Docker Engine found but not running. Starting...';
                Start-Service Docker;
                Write-Output 'Docker Engine started.';
            } else { Write-Output 'Docker Engine already running.'; }

            # 3. BCContainerHelper
            Write-Output '--- [3/3] Checking BCContainerHelper ---';
            Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force;
            if (Get-Module -ListAvailable -Name NavContainerHelper) {
                Uninstall-Module NavContainerHelper -Force -AllVersions -ErrorAction SilentlyContinue;
            }
            $bcHelper = Get-Module -ListAvailable BCContainerHelper | Select-Object -First 1;
            if (-not $bcHelper) {
                Write-Output 'Installing BCContainerHelper...';
                try { Install-Module BCContainerHelper -Force -Scope CurrentUser -AllowClobber; Write-Output 'BCContainerHelper installed.'; }
                catch { $errors += "BCContainerHelper: $_"; Write-Output "WARNING: BCContainerHelper install failed. $_"; }
            } else { Write-Output 'BCContainerHelper already installed.'; }

            # Summary
            Write-Output '--- Done ---';
            if ($errors.Count -gt 0) { Write-Output "Completed with $($errors.Count) warning(s). Some items may need Administrator privileges or a restart."; }
            else { Write-Output 'All prerequisites installed successfully!'; }
        `,
        installAllAzure: `
            $errors = @();

            # 1. Az module
            Write-Output '--- [1/2] Checking Az PowerShell module ---';
            $azMod = Get-Module -ListAvailable Az.Accounts | Select-Object -First 1;
            if (-not $azMod) {
                Write-Output 'Installing Az module (this takes several minutes)...';
                try { Install-Module Az -Force -Scope CurrentUser -AllowClobber -Repository PSGallery; Write-Output 'Az module installed.'; }
                catch { $errors += "Az: $_"; Write-Output "WARNING: Az module install failed. $_"; }
            } else { Write-Output 'Az module already installed.'; }

            # 2. Azure login
            Write-Output '--- [2/2] Azure login ---';
            try {
                Import-Module Az.Accounts -Force;
                $ctx = Get-AzContext;
                if (-not $ctx) {
                    Write-Output 'Opening Azure login prompt...';
                    Connect-AzAccount;
                    $ctx = Get-AzContext;
                }
                Write-Output "Logged in as $($ctx.Account.Id)";
            } catch { $errors += "AzLogin: $_"; Write-Output "WARNING: Azure login failed. $_"; }

            # Summary
            Write-Output '--- Done ---';
            if ($errors.Count -gt 0) { Write-Output "Completed with $($errors.Count) warning(s)."; }
            else { Write-Output 'All Azure prerequisites ready!'; }
        `
    };

    const script = installScripts[component];
    if (!script) {
        return res.status(400).json({ error: `Unknown component: ${component}` });
    }

    try {
        const output = await runPowerShell(script);
        res.json({ success: true, output });
    } catch (err) {
        res.json({ success: false, output: err.message });
    }
});

// --- Container build logic ---

async function buildLocalContainer(container) {
    // Build a single PowerShell script that does everything
    const bcType = container.bcType === 'saas' ? 'Sandbox' : 'OnPrem';

    let script = `
Import-Module BCContainerHelper -Force -WarningAction SilentlyContinue 3>$null;
$artifactUrl = Get-BCArtifactUrl -type ${bcType} -country ${container.country} -version ${container.bcVersion} -select Closest;
$credential = New-Object pscredential '${container.username}', (ConvertTo-SecureString -String '${container.password}' -AsPlainText -Force);
New-BCContainer -accept_eula -containerName '${container.name}' -credential $credential -auth ${container.auth} -artifactUrl $artifactUrl -assignPremiumPlan -shortcuts DesktopFolder -updateHosts`;

    if (container.licenseFile) {
        script += ` -licenseFile '${container.licenseFile}'`;
    }
    if (container.backupFile) {
        script += ` -bakfile '${container.backupFile}'`;
    }

    script += ';\n';

    // Publish additional apps
    if (container.appFiles && container.appFiles.length > 0) {
        for (const appFile of container.appFiles) {
            script += `Publish-NewApplicationToBcContainer -containerName '${container.name}' -credential $credential -appFile '${appFile}' -doNotUseDevEndpoint;\n`;
        }
    }

    // Import license after backup restore
    if (container.licenseFile) {
        script += `Import-BCContainerLicense -containerName '${container.name}' -licenseFile '${container.licenseFile}';\n`;
    }

    // Clean up user tables after backup restore so new credentials work
    if (container.backupFile && container.cleanupUsers && container.cleanupSql) {
        const sqlLines = container.cleanupSql.replace(/'/g, "''");
        script += `Invoke-ScriptInBCContainer -containerName '${container.name}' -scriptblock {\n`;
        script += `  $sql = @"\n`;
        script += `${sqlLines}\n`;
        script += `"@\n`;
        script += `  $svc = (Get-Service -Name 'MicrosoftDynamicsNavServer*')[0]\n`;
        script += `  $instance = $svc.Name.Replace('MicrosoftDynamicsNavServer$', '')\n`;
        script += `  $config = Get-NAVServerConfiguration -ServerInstance $instance\n`;
        script += `  $dbName = ($config | Where-Object { $_.Key -eq 'DatabaseName' }).Value\n`;
        script += `  $dbServer = ($config | Where-Object { $_.Key -eq 'DatabaseServer' }).Value\n`;
        script += `  $dbInstance = ($config | Where-Object { $_.Key -eq 'DatabaseInstance' }).Value\n`;
        script += `  if ($dbInstance) { $dbServer = "$dbServer\\$dbInstance" }\n`;
        script += `  Invoke-Sqlcmd -ServerInstance $dbServer -Database $dbName -Query $sql\n`;
        script += `  Write-Host "User tables cleaned up in database $dbName"\n`;
        script += `};\n`;
    }

    await runPowerShell(script);

    // -updateHosts adds the container name to hosts file, so use it directly
    container.url = `http://${container.name}/BC`;
}

async function buildAzureContainer(container) {
    let script = `
Import-Module BCContainerHelper -Force;
$credential = New-Object pscredential '${container.username}', (ConvertTo-SecureString -String '${container.password}' -AsPlainText -Force);
New-BCContainer -accept_eula `
        + `-containerName '${container.name}' `
        + `-credential $credential `
        + `-auth ${container.auth} `
        + `-artifactUrl (Get-BCArtifactUrl -type ${container.bcType === 'saas' ? 'Sandbox' : 'OnPrem'} -country ${container.country} -version ${container.bcVersion} -select Closest) `
        + `-assignPremiumPlan `
        + `-azureDevOps`;

    // Azure-specific: use ACI (Azure Container Instances)
    // This is a simplified version - real Azure provisioning would use New-BcContainerInACI or ARM templates
    container.logs.push({
        time: new Date().toISOString(),
        message: 'Azure container provisioning started. Note: Full Azure ACI integration requires additional Azure PowerShell modules and configuration.'
    });

    throw new Error(
        'Azure Container Instances provisioning requires Az module and proper Azure authentication. ' +
        'Please ensure Az module is installed and run Connect-AzAccount before building Azure containers.'
    );
}

async function localContainerAction(container, action) {
    const commands = {
        stop: `Import-Module BCContainerHelper -Force -WarningAction SilentlyContinue 3>$null; Stop-BCContainer -containerName '${container.name}'`,
        start: `Import-Module BCContainerHelper -Force -WarningAction SilentlyContinue 3>$null; Start-BCContainer -containerName '${container.name}'`,
        restart: `Import-Module BCContainerHelper -Force -WarningAction SilentlyContinue 3>$null; Restart-BCContainer -containerName '${container.name}'`,
        remove: `Import-Module BCContainerHelper -Force -WarningAction SilentlyContinue 3>$null; Remove-BCContainer -containerName '${container.name}'`
    };
    await runPowerShell(commands[action]);
}

async function azureContainerAction(container, action) {
    container.logs.push({
        time: new Date().toISOString(),
        message: `Azure action '${action}' requires Az module. Ensure Azure authentication is configured.`
    });
    throw new Error(`Azure container ${action} not yet fully implemented. Requires Az module configuration.`);
}

// --- Start server ---

app.listen(PORT, () => {
    console.log(`BC Container Manager running at http://localhost:${PORT}`);
});
