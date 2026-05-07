import subprocess
import re
import json
import urllib.request
import urllib.error
import ssl
import base64
import psutil


def get_league_client_info():
    for proc in psutil.process_iter(['name', 'cmdline']):
        if proc.info['name'] == 'LeagueClientUx.exe':
            cmdline = ' '.join(proc.info['cmdline'])

            port_match = re.search(r'--app-port=([0-9]*)', cmdline)
            token_match = re.search(r'--remoting-auth-token=([\w-]*)', cmdline)

            if port_match and token_match:
                return port_match.group(1), token_match.group(1)

    raise RuntimeError("League Client not found. Make sure it's running.")

def make_request(url, token):
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    credentials = base64.b64encode(f"riot:{token}".encode()).decode()
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "Authorization": f"Basic {credentials}"
    })

    with urllib.request.urlopen(req, context=ssl_ctx) as response:
        return json.loads(response.read().decode())

def main():
    print("Fetching League Client info...")
    port, token = get_league_client_info()
    base_url = f"https://127.0.0.1:{port}"

    print("Fetching summoner ID...")
    summoner = make_request(f"{base_url}/lol-summoner/v1/current-summoner", token)
    summoner_id = summoner["summonerId"]
    print(f"Summoner ID: {summoner_id}")

    print("Fetching owned skins...")
    skins = make_request(f"{base_url}/lol-champions/v1/inventories/{summoner_id}/skins-minimal", token)
    with open("skins.json", "w", encoding="utf-8") as f:
        json.dump(skins, f, indent=2)
    print("Saved skins.json")

    print("Fetching loot skins...")
    loot = make_request(f"{base_url}/lol-loot/v1/player-loot", token)
    with open("skinsLoot.json", "w", encoding="utf-8") as f:
        json.dump(loot, f, indent=2)
    print("Saved skinsLoot.json")

if __name__ == "__main__":
    main()