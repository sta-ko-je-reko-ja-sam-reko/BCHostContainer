// === State ===
let currentStep = 1;
const totalSteps = 4;
let selectedAppFiles = [];
let selectedLicenseFile = null;
let selectedBackupFile = null;
let currentContainerId = null;
let nameCheckTimer = null;
let nameIsAvailable = false;

const DEFAULT_CLEANUP_SQL = `DELETE FROM [dbo].[User]
DELETE FROM [dbo].[Access Control]
DELETE FROM [dbo].[User Property]
DELETE FROM [dbo].[Page Data Personalization]
DELETE FROM [dbo].[User Default Style Sheet]
DELETE FROM [dbo].[User Metadata]
DELETE FROM [dbo].[User Personalization]`;

// === DOM Ready ===
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    bindEvents();
});

// === Event Bindings ===
function bindEvents() {
    // Navigation
    document.getElementById('btnNewContainer').addEventListener('click', showWizard);
    document.getElementById('btnNewContainerEmpty').addEventListener('click', showWizard);
    document.getElementById('btnBackToDashboard').addEventListener('click', showDashboard);
    document.getElementById('btnNext').addEventListener('click', nextStep);
    document.getElementById('btnPrev').addEventListener('click', prevStep);
    document.getElementById('btnBuild').addEventListener('click', buildContainer);
    document.getElementById('btnRefreshAll').addEventListener('click', refreshAll);

    // Hosting toggle
    document.querySelectorAll('input[name="hosting"]').forEach(r => {
        r.addEventListener('change', onHostingChange);
    });

    // BC type toggle
    document.querySelectorAll('input[name="bcType"]').forEach(r => {
        r.addEventListener('change', onBcTypeChange);
    });

    // Container name check on typing
    document.getElementById('containerName').addEventListener('input', onContainerNameInput);

    // Load versions
    document.getElementById('btnLoadVersions').addEventListener('click', loadVersions);

    // File uploads
    setupFileUpload('licenseUploadArea', 'licenseFile', (files) => {
        selectedLicenseFile = files[0];
        document.getElementById('licenseFileName').textContent = files[0].name;
    });

    setupFileUpload('backupUploadArea', 'backupFile', (files) => {
        selectedBackupFile = files[0];
        document.getElementById('backupFileName').textContent = files[0].name;
        document.getElementById('cleanupUsersSection').classList.remove('hidden');
    });

    // SQL preview toggle
    document.getElementById('btnToggleSqlPreview').addEventListener('click', () => {
        const preview = document.getElementById('sqlPreview');
        const btn = document.getElementById('btnToggleSqlPreview');
        const hidden = preview.classList.toggle('hidden');
        btn.textContent = hidden ? 'Show SQL' : 'Hide SQL';
    });

    // Reset SQL to default
    document.getElementById('btnResetSql').addEventListener('click', () => {
        document.getElementById('cleanupSql').value = DEFAULT_CLEANUP_SQL;
    });

    setupFileUpload('appUploadArea', 'appFiles', (files) => {
        selectedAppFiles = [...selectedAppFiles, ...Array.from(files)];
        renderAppFileList();
    });
}

// === Dashboard ===
async function loadDashboard() {
    try {
        const res = await fetch('/api/containers');
        const containers = await res.json();
        renderContainers(containers);
    } catch (err) {
        console.error('Failed to load containers:', err);
    }
}

function renderContainers(containers) {
    const list = document.getElementById('containerList');
    const empty = document.getElementById('emptyState');

    if (containers.length === 0) {
        list.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.classList.remove('hidden');

    list.innerHTML = containers.map(c => `
        <div class="container-card" data-id="${c.id}">
            <div class="card-header">
                <h3>
                    <span class="status-dot ${c.status}"></span>
                    ${esc(c.name)}
                </h3>
                <span class="tag tag-status ${c.status}">${c.status}</span>
            </div>
            <div class="card-meta">
                <span class="tag tag-hosting">${c.hosting === 'local' ? 'Docker' : 'Azure'}</span>
                <span class="tag tag-type">${c.bcType === 'onprem' ? 'OnPrem' : 'SaaS'}</span>
                <span class="tag tag-version">BC ${esc(c.bcVersion)}</span>
            </div>
            ${c.url ? `<div class="card-url"><a href="${c.url}" target="_blank">${esc(c.url)}</a></div>` : ''}
            <div class="card-actions">
                ${c.status === 'running' ? `
                    <button class="btn-icon" title="Stop" onclick="containerAction('${c.id}', 'stop')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                    </button>
                    <button class="btn-icon" title="Restart" onclick="containerAction('${c.id}', 'restart')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                        </svg>
                    </button>
                ` : ''}
                ${c.status === 'stopped' ? `
                    <button class="btn-icon" title="Start" onclick="containerAction('${c.id}', 'start')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                ` : ''}
                ${c.status === 'pending' ? `
                    <button class="btn btn-primary btn-sm" onclick="buildExisting('${c.id}')">Build</button>
                ` : ''}
                <button class="btn-icon" title="Refresh" onclick="refreshContainer('${c.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
                        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                    </svg>
                </button>
                <button class="btn-icon" title="Remove" onclick="containerAction('${c.id}', 'remove')" style="margin-left:auto;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// === Container Actions ===
async function containerAction(id, action) {
    if (action === 'remove' && !confirm('Remove this container? This cannot be undone.')) return;

    // Show progress on the card
    const card = document.querySelector(`.container-card[data-id="${id}"]`);
    if (card) {
        const statusTag = card.querySelector('.tag-status');
        const actionLabels = { remove: 'REMOVING', stop: 'STOPPING', start: 'STARTING', restart: 'RESTARTING', refresh: 'REFRESHING' };
        if (statusTag) {
            statusTag.className = 'tag tag-status building';
            statusTag.textContent = actionLabels[action] || action.toUpperCase();
        }
        // Disable all buttons on this card
        card.querySelectorAll('button, .btn-icon').forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
        // Change status dot to building animation
        const dot = card.querySelector('.status-dot');
        if (dot) dot.className = 'status-dot building';
    }

    try {
        const res = await fetch(`/api/containers/${id}/${action}`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json();
            alert(`Error: ${err.error}`);
        }
        loadDashboard();
    } catch (err) {
        alert(`Action failed: ${err.message}`);
        loadDashboard();
    }
}

async function refreshContainer(id) {
    try {
        await fetch(`/api/containers/${id}/refresh`, { method: 'POST' });
        loadDashboard();
    } catch (err) {
        console.error('Refresh failed:', err);
    }
}

async function refreshAll() {
    try {
        const res = await fetch('/api/containers');
        const containers = await res.json();
        for (const c of containers) {
            await fetch(`/api/containers/${c.id}/refresh`, { method: 'POST' });
        }
        loadDashboard();
    } catch (err) {
        console.error('Refresh all failed:', err);
    }
}

async function buildExisting(id) {
    try {
        const res = await fetch(`/api/containers/${id}/build`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json();
            alert(`Build error: ${err.error}`);
        }
        loadDashboard();
    } catch (err) {
        alert(`Build failed: ${err.message}`);
    }
}

// === Wizard ===
function showWizard() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('wizard').classList.remove('hidden');
    currentStep = 1;
    resetWizard();
    updateWizardUI();
    checkPrerequisites();
}

function showDashboard() {
    document.getElementById('wizard').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    loadDashboard();
}

function resetWizard() {
    selectedAppFiles = [];
    selectedLicenseFile = null;
    selectedBackupFile = null;
    currentContainerId = null;
    document.getElementById('containerName').value = '';
    document.getElementById('nameWarning').classList.add('hidden');
    nameIsAvailable = false;
    document.getElementById('licenseFileName').textContent = '';
    document.getElementById('backupFileName').textContent = '';
    document.getElementById('cleanupUsersSection').classList.add('hidden');
    document.getElementById('cleanupUsers').checked = false;
    document.getElementById('cleanupSql').value = DEFAULT_CLEANUP_SQL;
    document.getElementById('sqlPreview').classList.add('hidden');
    document.getElementById('btnToggleSqlPreview').textContent = 'Show SQL';
    document.getElementById('appFileList').innerHTML = '';
    document.getElementById('buildProgress').classList.add('hidden');
    document.getElementById('bcVersionManual').value = '';
}

function updateWizardUI() {
    // Steps
    document.querySelectorAll('.step').forEach(s => {
        const step = parseInt(s.dataset.step);
        s.classList.remove('active', 'completed');
        if (step === currentStep) s.classList.add('active');
        else if (step < currentStep) s.classList.add('completed');
    });

    // Panels
    for (let i = 1; i <= totalSteps; i++) {
        document.getElementById(`step${i}`).classList.toggle('hidden', i !== currentStep);
    }

    // Buttons
    document.getElementById('btnPrev').disabled = currentStep === 1;
    document.getElementById('btnNext').classList.toggle('hidden', currentStep === totalSteps);
    document.getElementById('btnBuild').classList.toggle('hidden', currentStep !== totalSteps);

    // Step-specific updates
    if (currentStep === 4) renderReview();
}

function nextStep() {
    if (currentStep === 1 && !validateStep1()) return;
    if (currentStep === 2 && !validateStep2()) return;
    if (currentStep < totalSteps) {
        currentStep++;
        updateWizardUI();
    }
}

function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        updateWizardUI();
    }
}

function validateStep1() {
    const name = document.getElementById('containerName').value.trim();
    if (!name) {
        alert('Please enter a container name.');
        return false;
    }
    if (!/^[a-zA-Z0-9]+$/.test(name)) {
        alert('Container name must be alphanumeric only.');
        return false;
    }
    if (!nameIsAvailable) {
        alert('This container name is already in use. Please choose a different name.');
        return false;
    }
    return true;
}

// === Container Name Check ===
function onContainerNameInput() {
    const name = document.getElementById('containerName').value.trim();
    const warning = document.getElementById('nameWarning');

    // Clear previous timer
    if (nameCheckTimer) clearTimeout(nameCheckTimer);

    if (!name) {
        warning.classList.add('hidden');
        nameIsAvailable = false;
        return;
    }

    if (!/^[a-zA-Z0-9]+$/.test(name)) {
        warning.className = 'name-warning error';
        warning.textContent = 'Name must be alphanumeric only';
        nameIsAvailable = false;
        return;
    }

    // Debounce — check after 500ms of no typing
    warning.className = 'name-warning checking';
    warning.textContent = 'Checking name...';
    nameIsAvailable = false;

    nameCheckTimer = setTimeout(async () => {
        try {
            const res = await fetch(`/api/containers/check-name/${encodeURIComponent(name)}`);
            const result = await res.json();

            if (result.exists) {
                warning.className = 'name-warning error';
                warning.textContent = result.source;
                nameIsAvailable = false;
            } else {
                warning.className = 'name-warning ok';
                warning.textContent = 'Name is available';
                nameIsAvailable = true;
            }
        } catch {
            warning.className = 'name-warning ok';
            warning.textContent = 'Name is available';
            nameIsAvailable = true;
        }
    }, 500);
}

function validateStep2() {
    const version = getSelectedVersion();
    if (!version) {
        alert('Please select or enter a BC version.');
        return false;
    }
    return true;
}

// === Hosting change ===
function onHostingChange() {
    const isLocal = document.querySelector('input[name="hosting"]:checked').value === 'local';
    document.getElementById('localPrereqs').classList.toggle('hidden', !isLocal);
    document.getElementById('azureFields').classList.toggle('hidden', isLocal);
    if (isLocal) {
        checkPrerequisites();
    } else {
        checkAzurePrerequisites();
    }
}

// === BC Type change ===
function onBcTypeChange() {
    const isOnPrem = document.querySelector('input[name="bcType"]:checked').value === 'onprem';
    document.getElementById('licenseSection').style.display = isOnPrem ? '' : 'none';
    document.getElementById('saasAppWarning').style.display = isOnPrem ? 'none' : '';
}

// === Prerequisites ===
let lastLocalChecks = {};
let lastAzureChecks = {};

async function checkPrerequisites() {
    const items = ['prereqDocker', 'prereqHyperV', 'prereqBCHelper'];
    items.forEach(id => {
        const icon = document.querySelector(`#${id} .prereq-icon`);
        icon.className = 'prereq-icon loading';
        const btn = document.querySelector(`#${id} .prereq-install`);
        if (btn) btn.classList.add('hidden');
    });

    try {
        const res = await fetch('/api/prerequisites');
        const checks = await res.json();
        lastLocalChecks = checks;

        setPrereqStatus('prereqDocker', checks.docker, 'docker');
        setPrereqStatus('prereqHyperV', checks.hyperV, 'hyperv');
        setPrereqStatus('prereqBCHelper', checks.bcContainerHelper, 'bcContainerHelper');

        // Show "Install All" if anything is missing
        const anyMissing = !checks.docker || !checks.hyperV || !checks.bcContainerHelper;
        document.getElementById('btnInstallAllLocal').classList.toggle('hidden', !anyMissing);
    } catch {
        items.forEach(id => setPrereqStatus(id, false));
    }
}

async function checkAzurePrerequisites() {
    const items = ['prereqAzModule', 'prereqAzLogin'];
    items.forEach(id => {
        const icon = document.querySelector(`#${id} .prereq-icon`);
        icon.className = 'prereq-icon loading';
        const btn = document.querySelector(`#${id} .prereq-install`);
        if (btn) btn.classList.add('hidden');
    });

    try {
        const res = await fetch('/api/prerequisites/azure');
        const checks = await res.json();
        lastAzureChecks = checks;

        setPrereqStatus('prereqAzModule', checks.azModule, 'azModule');
        setPrereqStatus('prereqAzLogin', checks.azLoggedIn, 'azLogin');

        if (checks.azLoggedIn && checks.azAccount) {
            document.getElementById('azAccountInfo').textContent = `Logged in as ${checks.azAccount}`;
        } else {
            document.getElementById('azAccountInfo').textContent = 'Not logged in';
        }

        const anyMissing = !checks.azModule || !checks.azLoggedIn;
        document.getElementById('btnInstallAllAzure').classList.toggle('hidden', !anyMissing);
    } catch {
        items.forEach(id => setPrereqStatus(id, false));
    }
}

function setPrereqStatus(id, passed, componentKey) {
    const icon = document.querySelector(`#${id} .prereq-icon`);
    icon.className = `prereq-icon ${passed ? 'pass' : 'fail'}`;

    // Show individual install button if failed
    if (!passed && componentKey) {
        const btn = document.querySelector(`#${id} .prereq-install`);
        if (btn) btn.classList.remove('hidden');
    }
}

// === Install prerequisites ===
async function installSingle(component) {
    const isAzure = component.startsWith('az');
    const logEl = document.getElementById(isAzure ? 'installLogAzure' : 'installLog');
    logEl.classList.remove('hidden');
    logEl.textContent = `Installing ${component}...\n`;

    // Map component to prereq element for spinner
    const prereqMap = {
        docker: 'prereqDocker',
        hyperv: 'prereqHyperV',
        bcContainerHelper: 'prereqBCHelper',
        azModule: 'prereqAzModule',
        azLogin: 'prereqAzLogin'
    };

    const prereqId = prereqMap[component];
    if (prereqId) {
        const icon = document.querySelector(`#${prereqId} .prereq-icon`);
        icon.className = 'prereq-icon installing';
        const btn = document.querySelector(`#${prereqId} .prereq-install`);
        if (btn) { btn.disabled = true; btn.textContent = 'Installing...'; }
    }

    try {
        const res = await fetch('/api/prerequisites/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ component })
        });
        const result = await res.json();
        logEl.textContent += result.output + '\n';
        if (result.success) {
            logEl.textContent += '\nDone.\n';
        } else {
            logEl.textContent += '\nCompleted with warnings. Some steps may require Administrator privileges.\n';
        }
    } catch (err) {
        logEl.textContent += `Error: ${err.message}\n`;
    }

    // Re-check after install
    if (isAzure) {
        await checkAzurePrerequisites();
    } else {
        await checkPrerequisites();
    }
}

async function installAll(type) {
    const logEl = document.getElementById(type === 'azure' ? 'installLogAzure' : 'installLog');
    logEl.classList.remove('hidden');

    const component = type === 'azure' ? 'installAllAzure' : 'installAllLocal';
    const btnId = type === 'azure' ? 'btnInstallAllAzure' : 'btnInstallAllLocal';
    const btn = document.getElementById(btnId);
    btn.disabled = true;
    btn.textContent = 'Installing...';

    logEl.textContent = `Installing all ${type} prerequisites...\n\n`;

    // Set all icons to installing state
    if (type === 'local') {
        ['prereqDocker', 'prereqHyperV', 'prereqBCHelper'].forEach(id => {
            const icon = document.querySelector(`#${id} .prereq-icon`);
            if (icon && icon.classList.contains('fail')) icon.className = 'prereq-icon installing';
        });
    } else {
        ['prereqAzModule', 'prereqAzLogin'].forEach(id => {
            const icon = document.querySelector(`#${id} .prereq-icon`);
            if (icon && icon.classList.contains('fail')) icon.className = 'prereq-icon installing';
        });
    }

    try {
        const res = await fetch('/api/prerequisites/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ component })
        });
        const result = await res.json();
        logEl.textContent += result.output + '\n';
    } catch (err) {
        logEl.textContent += `Error: ${err.message}\n`;
    }

    btn.disabled = false;
    btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Install All Missing`;

    // Re-check everything
    if (type === 'azure') {
        await checkAzurePrerequisites();
    } else {
        await checkPrerequisites();
    }
}

// === Version loading ===
async function loadVersions() {
    const btn = document.getElementById('btnLoadVersions');
    const select = document.getElementById('bcVersion');
    const bcType = document.querySelector('input[name="bcType"]:checked').value;
    const country = document.getElementById('bcCountry').value;

    btn.textContent = 'Loading...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/bc-versions?type=${bcType === 'saas' ? 'Sandbox' : 'OnPrem'}&country=${country}`);
        const versions = await res.json();

        select.innerHTML = '<option value="">-- Select version --</option>';
        versions.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        });

        // Auto-select first version and open dropdown
        if (versions.length > 0) {
            select.value = versions[0];
            select.focus();
            select.size = Math.min(versions.length + 1, 10);
            select.addEventListener('change', () => { select.size = 1; }, { once: true });
            select.addEventListener('blur', () => { select.size = 1; }, { once: true });
        }
    } catch (err) {
        alert('Failed to load versions. Make sure BCContainerHelper is installed.');
    } finally {
        btn.textContent = 'Load Versions';
        btn.disabled = false;
    }
}

function getSelectedVersion() {
    const manual = document.getElementById('bcVersionManual').value.trim();
    if (manual) return manual;
    return document.getElementById('bcVersion').value;
}

// === File Upload ===
function setupFileUpload(areaId, inputId, onFiles) {
    const area = document.getElementById(areaId);
    const input = document.getElementById(inputId);

    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('drag-over');
    });

    area.addEventListener('dragleave', () => {
        area.classList.remove('drag-over');
    });

    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('drag-over');
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    });

    input.addEventListener('change', () => {
        if (input.files.length) onFiles(input.files);
    });
}

function renderAppFileList() {
    const list = document.getElementById('appFileList');
    list.innerHTML = selectedAppFiles.map((f, i) => `
        <div class="file-item">
            <span class="file-item-name">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                    <polyline points="13 2 13 9 20 9"/>
                </svg>
                ${esc(f.name)} <small style="color:var(--text-dim)">(${formatSize(f.size)})</small>
            </span>
            <button onclick="removeAppFile(${i})">&times;</button>
        </div>
    `).join('');
}

function removeAppFile(index) {
    selectedAppFiles.splice(index, 1);
    renderAppFileList();
}

// === Review ===
function renderReview() {
    const hosting = document.querySelector('input[name="hosting"]:checked').value;
    const bcType = document.querySelector('input[name="bcType"]:checked').value;
    const version = getSelectedVersion();
    const name = document.getElementById('containerName').value;
    const country = document.getElementById('bcCountry').value;
    const auth = document.getElementById('authType').value;

    let rows = [
        { label: 'Container Name', value: name },
        { label: 'Hosting', value: hosting === 'local' ? 'Local Docker' : 'Azure' },
        { label: 'BC Type', value: bcType === 'onprem' ? 'OnPrem' : 'SaaS (Sandbox)' },
        { label: 'BC Version', value: version },
        { label: 'Country', value: country.toUpperCase() },
        { label: 'Authentication', value: auth },
    ];

    if (hosting === 'azure') {
        rows.push(
            { label: 'Azure Region', value: document.getElementById('azureRegion').value },
            { label: 'Azure VM Size', value: document.getElementById('azureVmSize').value },
        );
    }

    if (selectedLicenseFile) {
        rows.push({ label: 'License File', value: selectedLicenseFile.name });
    }
    if (selectedBackupFile) {
        rows.push({ label: 'Database Backup', value: selectedBackupFile.name });
        if (document.getElementById('cleanupUsers').checked) {
            rows.push({ label: 'Clean Up Users', value: 'Yes — user tables will be cleared after restore' });
        }
    }
    if (selectedAppFiles.length > 0) {
        rows.push({ label: 'Additional Apps', value: selectedAppFiles.map(f => f.name).join(', ') });
    }

    document.getElementById('reviewContent').innerHTML = rows.map(r => `
        <div class="review-row">
            <span class="review-label">${r.label}</span>
            <span class="review-value">${esc(r.value)}</span>
        </div>
    `).join('');
}

// === Build ===
async function buildContainer() {
    const hosting = document.querySelector('input[name="hosting"]:checked').value;
    const bcType = document.querySelector('input[name="bcType"]:checked').value;

    const body = {
        name: document.getElementById('containerName').value.trim(),
        hosting,
        bcType,
        bcVersion: getSelectedVersion(),
        country: document.getElementById('bcCountry').value,
        auth: document.getElementById('authType').value,
        username: document.getElementById('adminUser').value,
        password: document.getElementById('adminPass').value,
        cleanupUsers: document.getElementById('cleanupUsers').checked,
        cleanupSql: document.getElementById('cleanupUsers').checked ? document.getElementById('cleanupSql').value : '',
    };

    if (hosting === 'azure') {
        body.azureSubscription = document.getElementById('azureSubscription').value;
        body.azureResourceGroup = document.getElementById('azureResourceGroup').value;
        body.azureRegion = document.getElementById('azureRegion').value;
        body.azureVmSize = document.getElementById('azureVmSize').value;
    }

    // Show build progress
    const buildBtn = document.getElementById('btnBuild');
    buildBtn.disabled = true;
    buildBtn.textContent = 'Creating...';

    const progress = document.getElementById('buildProgress');
    const log = document.getElementById('buildLog');
    progress.classList.remove('hidden');
    log.innerHTML = '<div class="log-line">Creating container record...</div>';

    try {
        // Step 1: Create container record
        const createRes = await fetch('/api/containers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const container = await createRes.json();
        currentContainerId = container.id;
        log.innerHTML += '<div class="log-line log-success">Container record created.</div>';

        // Step 2: Upload files
        if (selectedLicenseFile || selectedBackupFile || selectedAppFiles.length > 0) {
            log.innerHTML += '<div class="log-line">Uploading files...</div>';

            if (selectedLicenseFile) {
                await uploadFile(container.id, 'license', [selectedLicenseFile]);
                log.innerHTML += '<div class="log-line log-success">License file uploaded.</div>';
            }
            if (selectedBackupFile) {
                await uploadFile(container.id, 'backup', [selectedBackupFile]);
                log.innerHTML += '<div class="log-line log-success">Backup file uploaded.</div>';
            }
            if (selectedAppFiles.length > 0) {
                await uploadFile(container.id, 'app', selectedAppFiles);
                log.innerHTML += `<div class="log-line log-success">${selectedAppFiles.length} app file(s) uploaded.</div>`;
            }
        }

        // Step 3: Build
        log.innerHTML += '<div class="log-line">Building container (this may take several minutes)...</div>';
        log.scrollTop = log.scrollHeight;

        const buildRes = await fetch(`/api/containers/${container.id}/build`, { method: 'POST' });
        const result = await buildRes.json();

        if (buildRes.ok) {
            log.innerHTML += '<div class="log-line log-success">Container built successfully!</div>';
            if (result.url) {
                log.innerHTML += `<div class="log-line log-success">URL: <a href="${esc(result.url)}" target="_blank">${esc(result.url)}</a></div>`;
            }
            buildBtn.textContent = 'Done!';
            setTimeout(() => showDashboard(), 2000);
        } else {
            log.innerHTML += `<div class="log-line log-error">Build failed: ${esc(result.error)}</div>`;
            buildBtn.textContent = 'Retry Build';
            buildBtn.disabled = false;
        }
    } catch (err) {
        log.innerHTML += `<div class="log-line log-error">Error: ${esc(err.message)}</div>`;
        buildBtn.textContent = 'Retry Build';
        buildBtn.disabled = false;
    }
}

async function uploadFile(containerId, fileType, files) {
    const formData = new FormData();
    formData.append('fileType', fileType);
    for (const f of files) {
        formData.append('files', f);
    }
    const res = await fetch(`/api/containers/${containerId}/upload`, {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
}

// === Utilities ===
function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
