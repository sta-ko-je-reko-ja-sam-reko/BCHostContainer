# BC Container Manager - How to Use

## Quick Start

**Double-click `Start.bat`** - that's it.

It will:
1. Install Node.js automatically if not found on your machine
2. Install project dependencies (first run only)
3. Start the server
4. Open your browser to the app

> Keep the black window open while using the app. Close it to stop the server.

## Prerequisites

The app checks prerequisites for you and offers to **install everything automatically** with one click.

### For Local Docker containers
- **Docker Engine** - Windows service (not Docker Desktop)
- **Hyper-V** - Windows feature for container isolation
- **BCContainerHelper** - PowerShell module for BC container management

### For Azure hosted containers
- **Az PowerShell Module** - for managing Azure resources
- **Azure Login** - authenticated Azure account

> When you select Local or Azure hosting in Step 1, the app shows which prerequisites are installed (green) or missing (red). Click **"Install All Missing"** to install everything at once. Some items may require Administrator privileges or a reboot.

## Creating a Container

The wizard walks you through 4 steps:

### Step 1 - Hosting

Choose where the container runs:

| Option | What it does |
|--------|-------------|
| **Local Docker** | Runs on your machine via Docker Engine + Hyper-V. Shows prerequisites check with install buttons. |
| **Azure Hosted** | Deploys to Azure Container Instances. Shows Azure prerequisites check + configuration fields (Subscription, Resource Group, Region, VM Size). |

Then fill in **Container Name** (alphanumeric, e.g. `BC2700wLSC270`), authentication type, and admin credentials.

### Step 2 - BC Version

- **OnPrem** - standard BC on-premises artifacts. Upload your `.bclicense` or `.flf` license file.
- **SaaS (Sandbox)** - sandbox artifacts, no license needed.

Select a **country** and **BC version**. Click **Load Versions** to fetch available versions from BCContainerHelper, or type the version manually (e.g. `27.1.0.0`).

Optionally upload a **database backup** (`.bak`) to restore into the container.

#### Clean Up User Tables

When you upload a backup file, a **"Clean up user tables after restore"** checkbox appears. Enable this if your backup contains existing users that would prevent you from logging in with the new credentials.

When checked, the following SQL runs inside the container after the backup is restored:

```sql
DELETE FROM [dbo].[User]
DELETE FROM [dbo].[Access Control]
DELETE FROM [dbo].[User Property]
DELETE FROM [dbo].[Page Data Personalization]
DELETE FROM [dbo].[User Default Style Sheet]
DELETE FROM [dbo].[User Metadata]
DELETE FROM [dbo].[User Personalization]
```

Click **"Show SQL"** to see and **edit** the script before building. You can add, remove, or modify statements to fit your database. Click **"Reset to default"** to restore the original script.

> This is commonly needed when restoring a production or customer database into a fresh container — the existing user records conflict with the container's admin user.

### Step 3 - Additional Apps

Upload `.app` files to publish on the container after creation. Examples:
- LS Central System App + LS Central App
- Custom AL extensions
- Per-tenant extensions

You can upload multiple files. Each will be published and installed in order.

> **Note:** SaaS/Sandbox containers may have restrictions on which apps can be published. Runtime packages and per-tenant extensions typically work fine.

### Step 4 - Review & Build

Review your configuration and click **Build Container**. The build log shows progress:
1. Container record created
2. Files uploaded (license, backup, apps)
3. BC container provisioned via PowerShell (this takes several minutes)
4. Apps published and installed
5. License imported
6. User tables cleaned up (if enabled)

Once complete, you're redirected to the dashboard.

## Dashboard

The dashboard shows all your containers with:

- **Status indicator** - green (running), gray (stopped), yellow (building), red (error)
- **Tags** - hosting type, BC type, version
- **URL** - click to open the BC Web Client
- **Action buttons:**
  - **Stop** - stops the container
  - **Start** - starts a stopped container
  - **Restart** - restarts the container
  - **Refresh** - checks current Docker status
  - **Remove** - deletes the container (asks for confirmation)

Container state persists across browser sessions and server restarts.

## New Laptop Setup

When someone gets a new laptop, the setup is:

1. Copy the `HostContainersLocal` folder to their machine
2. Double-click `Start.bat`
3. In the wizard, select hosting type - the app detects what's missing
4. Click **"Install All Missing"** - everything gets installed automatically
5. Reboot if prompted (Hyper-V requires it)
6. Double-click `Start.bat` again and create your container

## Troubleshooting

**Start.bat closes immediately**
Right-click `Start.bat` → "Run as administrator". Some prerequisite installs need admin privileges.

**"Docker not running"**
The Docker Engine service is installed but stopped. The app will show this as a red status - click Install to start it, or manually:
```powershell
Start-Service Docker
```

**"Hyper-V not enabled"**
Requires a reboot after installation. The app installs it but you need to restart your PC once.

**Build takes too long**
First-time container creation downloads the BC Docker image (~10-15 GB). Subsequent builds reuse the cached image.

**Azure build fails**
Make sure you clicked "Install All Missing" in the Azure prerequisites panel and completed the Azure login prompt.
