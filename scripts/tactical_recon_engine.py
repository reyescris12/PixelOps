#!/usr/bin/env python3
"""
tactical_recon_engine.py

PixelOps Standalone Tactical Reconnaissance & Adversarial Threat Engine.
Can be invoked directly by safehouse operatives (e.g. Cipher, Vance, Nyx)
inside the local sandbox or via terminal:
    python tactical_recon_engine.py <target_ip_or_domain>

Performs multi-vector telemetry collection:
1. RDAP / RIR Autonomous System & Routing Block Allocation
2. Public IPinfo / Geolocation & Hosting Classification
3. crt.sh Certificate Transparency Subdomain Enumeration
4. Shodan InternetDB Open Port & CVE Scan (Zero-Key)
5. Outputs raw structured JSON dossier directly into workspace storage
"""

import sys
import json
import ssl
import urllib.request
import urllib.parse
from datetime import datetime

def log_event(status: str, message: str):
    tag = "[+]" if status == "ok" else "[-]" if status == "err" else "[*]"
    print(f"{tag} {message}", flush=True)

def execute_deep_recon(target: str, output_file: str = None) -> dict:
    target = target.strip().replace("https://", "").replace("http://", "").split("/")[0]
    log_event("info", f"Initializing Tactical Recon Suite against: {target}")

    results = {
        "target": target,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "scanner": "PixelOps-Tactical-Recon-v2.6",
    }

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    is_ip = target.replace(".", "").isdigit()

    # 1. OpenRDAP / RIR Autonomous System & Routing Block Lookup
    try:
        rdap_url = f"https://rdap.org/ip/{target}" if is_ip else f"https://rdap.org/domain/{target}"
        req = urllib.request.Request(rdap_url, headers={"User-Agent": "PixelOps-Recon/2.6"})
        with urllib.request.urlopen(req, timeout=10, context=context) as resp:
            rdap_data = json.loads(resp.read().decode("utf-8"))
            results["rdap"] = {
                "handle": rdap_data.get("handle"),
                "name": rdap_data.get("name"),
                "status": rdap_data.get("status"),
                "country": rdap_data.get("country"),
                "entities": [e.get("handle") for e in rdap_data.get("entities", []) if isinstance(e, dict)],
            }
        log_event("ok", "RDAP / Routing Block telemetry: SUCCESS")
    except Exception as e:
        results["rdap"] = {"error": str(e)}
        log_event("err", f"RDAP lookup failed: {e}")

    # 2. Public IPinfo / Geolocation Consensus Lookup
    if is_ip:
        try:
            ipinfo_url = f"https://ipinfo.io/{target}/json"
            req = urllib.request.Request(ipinfo_url, headers={"User-Agent": "PixelOps-Recon/2.6"})
            with urllib.request.urlopen(req, timeout=10, context=context) as resp:
                results["ipinfo"] = json.loads(resp.read().decode("utf-8"))
            log_event("ok", "IPinfo geolocation consensus telemetry: SUCCESS")
        except Exception as e:
            results["ipinfo"] = {"error": str(e)}
            log_event("err", f"IPinfo lookup failed: {e}")

        # 3. Shodan InternetDB (Zero-Key Port & Vulnerability Scan)
        try:
            shodan_url = f"https://internetdb.shodan.io/{target}"
            req = urllib.request.Request(shodan_url, headers={"User-Agent": "PixelOps-Recon/2.6"})
            with urllib.request.urlopen(req, timeout=10, context=context) as resp:
                idb = json.loads(resp.read().decode("utf-8"))
                results["shodan_internetdb"] = {
                    "ports": idb.get("ports", []),
                    "vulns": idb.get("vulns", []),
                    "hostnames": idb.get("hostnames", []),
                    "cpes": idb.get("cpes", []),
                    "tags": idb.get("tags", []),
                }
            log_event("ok", f"Shodan InternetDB: {len(idb.get('ports', []))} ports, {len(idb.get('vulns', []))} CVEs detected")
        except Exception as e:
            results["shodan_internetdb"] = {"error": str(e)}
            log_event("err", f"Shodan InternetDB query failed: {e}")

    # 4. crt.sh Certificate Transparency Subdomain Recon (For Domains)
    if not is_ip:
        try:
            crt_url = f"https://crt.sh/?q=%25.{target}&output=json"
            req = urllib.request.Request(crt_url, headers={"User-Agent": "PixelOps-Recon/2.6"})
            with urllib.request.urlopen(req, timeout=12, context=context) as resp:
                raw_certs = json.loads(resp.read().decode("utf-8"))
                subdomains = set()
                for c in raw_certs[:50]:
                    nv = c.get("name_value", "")
                    for n in nv.split("\n"):
                        clean_n = n.strip().lower()
                        if clean_n and not clean_n.startswith("*"):
                            subdomains.add(clean_n)
                results["crtsh_subdomains"] = {
                    "total_certificates": len(raw_certs),
                    "unique_subdomains": sorted(list(subdomains))[:30],
                }
            log_event("ok", f"crt.sh CT Logs: {len(subdomains)} unique subdomains discovered")
        except Exception as e:
            results["crtsh_subdomains"] = {"error": str(e)}
            log_event("err", f"crt.sh query failed: {e}")

    # Save structured results to safehouse storage
    clean_name = target.replace(".", "_").replace(":", "_")
    output_path = output_file or f"reports/recon_{clean_name}.json"
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        log_event("ok", f"Structured dossier committed to: {output_path}")
    except Exception:
        # Fallback to local working directory
        output_path = f"recon_{clean_name}.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        log_event("ok", f"Structured dossier committed to: {output_path}")

    return results

if __name__ == "__main__":
    target_arg = sys.argv[1] if len(sys.argv) > 1 else "185.220.101.7"
    out_arg = sys.argv[2] if len(sys.argv) > 2 else None
    execute_deep_recon(target_arg, out_arg)
