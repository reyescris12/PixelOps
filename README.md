# PixelOps: Autonomous Agent Command Center & Tactical OSINT Workstation

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-38bdf8.svg)](https://vite-pwa-org.netlify.app/)
[![Storage: Local--First](https://img.shields.io/badge/Storage-Local--First%20(VFS)-f59e0b.svg)](#core-architecture)
[![Architecture: BYOK](https://img.shields.io/badge/Architecture-BYOK%20Multi--Model-a855f7.svg)](#bring-your-own-key-byok-model-mesh)
[![Feeds: Zero--Key Open Data](https://img.shields.io/badge/Feeds-Zero--Key%20Open%20Data-10b981.svg)](#zero-key-public-intel-endpoints)

<p align="center">
  <strong>Retro 16-bit safehouse aesthetics meet real-time multi-domain OSINT telemetry and autonomous AI agent operations.</strong>
</p>

<!-- Hero Screenshot / Demo Placeholder -->
```
+----------------------------------------------------------------------------------------------------+
|  [🛡️ THREAT MATRIX]     [🛰️ TACTICAL RECON MONITOR]     [⚡ SECTOR PLAYBOOK]     [📁 VFS VAULT]      |
|----------------------------------------------------------------------------------------------------|
|                                                                                                    |
|                       [ 4-VIEW RETRO TACTICAL COMMAND HUD / RECON SCREENSHOT ]                     |
|                                                                                                    |
|                  * Replace with demo GIF / screenshot: docs/assets/pixelops_hud.png *               |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

</div>

---

## 🧭 The Vision // Why PixelOps Exists

Modern cybersecurity analysts, researchers, and technical operators are inundated with disconnected tools: noisy threat feeds in one tab, complex terminal scripts in another, siloed cloud LLM consoles, and sprawling dashboards that demand heavy monthly subscriptions.

**PixelOps** bridges the tactile, nostalgic charm of a **16-bit pixel-art safehouse** with **hardened, real-world utility**. It transforms passive monitoring into active multi-agent operations:

- **Immersive Spatial Command Center:** Interactive isometric facilities—War Room, Server Vault, Armory, Comms Tower, Library, and Briefing Lounge—each housing dedicated workstations and specialized operatives.
- **Multi-Domain Threat Correlation:** Ingests live global telemetry (undersea cable status, satellite orbital passes, seismic events, open aviation transponders, CISA Known Exploited Vulnerabilities, and BGP/DNS routing anomalies).
- **Autonomous Agent Workflows:** Deploy specialized autonomous operatives—**Vance** (Command Chief & Executive Synthesis), **Nyx** (Deep Recon & OSINT), and **Cipher** (Cryptographic Code-Ops & Stack Auditing)—to execute multi-step investigation playbooks, cross-correlate anomalies, and assemble tactical dossiers directly into local encrypted storage.

---

## ⚡ Core Features Grid

| Capability | Technical Details | Operational Value |
| :--- | :--- | :--- |
| **Local-First VFS Vault** | IndexedDB (Dexie.js) + OPFS persistence with Web Cryptography AES-GCM envelope encryption | Zero vendor lock-in. Dossiers, playbooks, intelligence notes, and telemetry remain 100% on your local machine. |
| **BYOK Multi-Model Mesh** | Direct browser-to-provider routing for Gemini 2.5/Flash/Pro, OpenRouter, Claude, and local Ollama runtimes | Freedom to route tasks to cost-effective or air-gapped local models without centralized proxy markups. |
| **Zero-Key Public Feeds** | Native client-side collectors for USGS Earthquakes, Cloudflare DNS-over-HTTPS (DoH), crt.sh certificate transparency, and NASA GIBS / Esri orbital WMTS | Instant operational readiness out of the box with zero third-party account registration or billing hurdles. |
| **Autonomous Playbooks** | Declarative task chains with dynamic agent routing, verification checkpoints, and report synthesis | Trigger one-click threat sweeps, automated vulnerability cross-referencing, or scheduled Night Shift surveillance. |
| **4-Pillar Threat Radar** | Macro-to-Micro correlation: Global Event Matrix, Infrastructure & Grid Stability, CVE Vulnerability Radar, and Supply Line Disruptions | Translates macro geopolitical or transit anomalies into actionable local impact flags for your infrastructure. |
| **PWA & Offline Telemetry** | Full Progressive Web App manifest, service worker caching, and resilient local-first queues | Pin to your desktop or mobile home screen; continues monitoring and logging telemetry when disconnected. |

---

## 🌐 Zero-Key Public Intel Endpoints

PixelOps connects directly to reputable, zero-authentication public data oracles:

1. **NASA GIBS & Esri Basemaps:** Real-time daily orbital imagery (true color, thermal, aerosol, and storm tracking) without requiring Earthdata keys.
2. **USGS Real-Time Seismic API:** Live global seismic telemetry and tsunami watch advisories.
3. **Cloudflare DoH & crt.sh:** Real-time DNS resolution, domain WHOIS verification, and SSL certificate transparency log inspection.
4. **CISA Known Exploited Vulnerabilities (KEV):** Live feeds of weaponized zero-day exploits and high-priority CVE alerts.

---

## 🚀 Quick Start Guide

Run PixelOps locally in under two minutes. **No database setup, Docker cluster, or paid API subscription required.**

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- `npm` or `pnpm`

### 1. Clone & Install

```bash
# Clone the repository
git clone https://github.com/reyescris12/PixelOps.git

# Navigate to the workspace
cd PixelOps

# Install dependencies cleanly
npm ci
```

### 2. Launch Development Server

```bash
npm run dev
```

Open your browser to `http://localhost:5173` to enter the Command Center.

### 3. (Optional) Configure AI Operative Keys

All public telemetry layers, satellite map rasters, and local VFS storage work immediately with **zero configuration**.

When you are ready to enable autonomous LLM sweeps with **Agent Vance**, **Agent Nyx**, and **Agent Cipher**:
1. Open the in-app **Gear Vault** (`⚙️ Settings`) or add your keys to a `.env.local` file:
   ```env
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   # Optional fallback or alternative providers:
   # VITE_OPENROUTER_API_KEY=your_openrouter_key
   ```
2. Keys are stored locally inside your browser's encrypted credential vault and are never transmitted to external telemetry servers.

---

## 🛠️ Build & Production Deployment

To compile the production-ready PWA bundle:

```bash
# Type check and build optimized bundle
npm run build

# Preview production build locally
npm run preview
```

The resulting `dist/` folder contains static assets and service workers ready for deployment on Cloudflare Pages, Vercel, Netlify, or self-hosted static file servers.

---

## 🤝 Contributing

Contributions to PixelOps are warmly welcomed! Whether you are designing new 16-bit pixel-art rooms and agent sprites, adding open OSINT oracles, or extending autonomous task chains:

1. **Fork** the repository.
2. **Create a feature branch:** `git checkout -b feature/tactical-sensor-module`.
3. **Commit your changes:** `git commit -m "feat: add marine AIS telemetry oracle"`.
4. **Push to branch:** `git push origin feature/tactical-sensor-module`.
5. **Open a Pull Request** describing your additions and verification tests.

---

## 📄 License

PixelOps is licensed under the [MIT License](LICENSE). Feel free to adapt, extend, and deploy it for research, security operations, and personal defense workstations.
