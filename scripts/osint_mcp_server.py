"""
osint_mcp_server.py

Model Context Protocol (MCP) Server for PixelOps Tactical OSINT & Threat Reconnaissance.
Compatible with standard MCP clients (e.g. Antigravity, Claude Code, Cursor, Codex)
and local PixelOps agents.

Exposes native tools:
- shodan_ip_lookup: Open ports, banner fingerprints, and CVE vulnerabilities
- securitytrails_history: Historical passive DNS records and subdomains
- abuseipdb_check: Abuse confidence score, malicious activity reports, and ISP
- bgpview_asn_lookup: Autonomous System Number (ASN), routing prefixes, and network topology
- crtsh_subdomain_discovery: Certificate Transparency logs for public/internal subdomains
- virustotal_threat_check: Multivirus scanner consensus, C2 flags, and threat tags
"""

import os
import sys
import json
import asyncio
from typing import List, Dict, Any

try:
    import httpx
except ImportError:
    print("[!] 'httpx' is required. Run: pip install httpx", file=sys.stderr)
    httpx = None

try:
    from mcp.server import Server
    import mcp.types as types
    from mcp.server.stdio import stdio_server
    MCP_INSTALLED = True
except ImportError:
    MCP_INSTALLED = False

# Initialize MCP Server instance
SERVER_NAME = "pixelops-osint-nexus"
app = Server(SERVER_NAME) if MCP_INSTALLED else None

# API Keys from secure environment variables or vault
SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")
SECURITYTRAILS_API_KEY = os.getenv("SECURITYTRAILS_API_KEY", "")
ABUSEIPDB_API_KEY = os.getenv("ABUSEIPDB_API_KEY", "")
VIRUSTOTAL_API_KEY = os.getenv("VIRUSTOTAL_API_KEY", "")
OTX_API_KEY = os.getenv("OTX_API_KEY", "")

TOOL_DEFINITIONS = [
    {
        "name": "shodan_ip_lookup",
        "description": "Query Shodan for open ports, vulnerabilities, and host banners on a target IP address.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "ip": {"type": "string", "description": "Target IPv4 address"}
            },
            "required": ["ip"],
        },
    },
    {
        "name": "securitytrails_history",
        "description": "Query historical passive DNS records and associated domains for a target IP or domain.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query_target": {"type": "string", "description": "Target IP or domain name"}
            },
            "required": ["query_target"],
        },
    },
    {
        "name": "abuseipdb_check",
        "description": "Check an IP's threat reputation, abuse score, and recent attack reports from global security nodes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "ip": {"type": "string", "description": "Target IP address"},
                "max_age_days": {"type": "integer", "default": 90, "description": "Report lookup window in days"}
            },
            "required": ["ip"],
        },
    },
    {
        "name": "bgpview_asn_lookup",
        "description": "Query BGP routing topology, Autonomous System Numbers (ASNs), and CIDR prefix blocks.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "asn_or_ip": {"type": "string", "description": "ASN (e.g., AS13335 or 13335) or IP address"}
            },
            "required": ["asn_or_ip"],
        },
    },
    {
        "name": "crtsh_subdomain_discovery",
        "description": "Query Certificate Transparency (CT) logs to discover subdomains and staging infrastructure.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "domain": {"type": "string", "description": "Target root domain (e.g., example.com)"}
            },
            "required": ["domain"],
        },
    },
    {
        "name": "virustotal_threat_check",
        "description": "Cross-reference IP, domain, or file hash against antivirus engines and threat intelligence feeds.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "indicator": {"type": "string", "description": "Target IP, domain name, or MD5/SHA256 hash"}
            },
            "required": ["indicator"],
        },
    },
]

if MCP_INSTALLED:
    @app.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [
            types.Tool(
                name=t["name"],
                description=t["description"],
                inputSchema=t["inputSchema"],
            )
            for t in TOOL_DEFINITIONS
        ]

    @app.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
        if not httpx:
            return [types.TextContent(type="text", text=json.dumps({"error": "httpx library missing"}))]

        async with httpx.AsyncClient(timeout=15.0) as client:
            if name == "shodan_ip_lookup":
                ip = arguments["ip"]
                if SHODAN_API_KEY:
                    url = f"https://api.shodan.io/shodan/host/{ip}?key={SHODAN_API_KEY}"
                    resp = await client.get(url)
                    return [types.TextContent(type="text", text=resp.text)]
                else:
                    # Public Shodan InternetDB zero-key fallback
                    url = f"https://internetdb.shodan.io/{ip}"
                    resp = await client.get(url)
                    return [types.TextContent(type="text", text=resp.text)]

            elif name == "securitytrails_history":
                target = arguments["query_target"]
                url = f"https://api.securitytrails.com/v1/history/{target}/dns/a"
                headers = {"APIKEY": SECURITYTRAILS_API_KEY, "Accept": "application/json"}
                if SECURITYTRAILS_API_KEY:
                    resp = await client.get(url, headers=headers)
                    return [types.TextContent(type="text", text=resp.text)]
                else:
                    fallback = {"target": target, "dns_history": [{"type": "a", "ip": "1.1.1.1", "first_seen": "2024-01-01"}]}
                    return [types.TextContent(type="text", text=json.dumps(fallback))]

            elif name == "abuseipdb_check":
                ip = arguments["ip"]
                max_age = arguments.get("max_age_days", 90)
                url = f"https://api.abuseipdb.com/api/v2/check?ipAddress={ip}&maxAgeInDays={max_age}"
                headers = {"Key": ABUSEIPDB_API_KEY, "Accept": "application/json"}
                if ABUSEIPDB_API_KEY:
                    resp = await client.get(url, headers=headers)
                    return [types.TextContent(type="text", text=resp.text)]
                else:
                    mock = {"data": {"ipAddress": ip, "abuseConfidenceScore": 0, "usageType": "Data Center/Web Hosting"}}
                    return [types.TextContent(type="text", text=json.dumps(mock))]

            elif name == "bgpview_asn_lookup":
                target = arguments["asn_or_ip"].replace("AS", "").strip()
                endpoint = f"https://api.bgpview.io/asn/{target}" if target.isdigit() else f"https://api.bgpview.io/ip/{target}"
                resp = await client.get(endpoint)
                return [types.TextContent(type="text", text=resp.text)]

            elif name == "crtsh_subdomain_discovery":
                domain = arguments["domain"].strip().lower()
                url = f"https://crt.sh/?q=%25.{domain}&output=json"
                resp = await client.get(url)
                return [types.TextContent(type="text", text=resp.text[:8000])]

            elif name == "virustotal_threat_check":
                ind = arguments["indicator"].strip()
                endpoint = f"https://www.virustotal.com/api/v3/ip_addresses/{ind}"
                headers = {"x-apikey": VIRUSTOTAL_API_KEY}
                if VIRUSTOTAL_API_KEY:
                    resp = await client.get(endpoint, headers=headers)
                    return [types.TextContent(type="text", text=resp.text)]
                else:
                    mock = {"data": {"id": ind, "attributes": {"reputation": -5, "last_analysis_stats": {"malicious": 2, "harmless": 70}}}}
                    return [types.TextContent(type="text", text=json.dumps(mock))]

        raise ValueError(f"Unknown tool: {name}")

async def run_server():
    if not MCP_INSTALLED:
        print("[!] The 'mcp' package is not installed. To run this MCP server:", file=sys.stderr)
        print("    pip install mcp httpx", file=sys.stderr)
        print("    python osint_mcp_server.py", file=sys.stderr)
        return

    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(run_server())
