#!/usr/bin/env python3
"""
OddsHarvester Collector — Esegue scraping multi-bookmaker da OddsPortal.

Output: data/oddsharvester/today.json
Formato: array di match con quote per bookmaker

Questo script viene eseguito da GitHub Actions ogni 2 ore.
I dati vengono poi importati nel database da scripts/import-oddsharvester.ts
"""

import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

def run_oddsharvester(sport: str, date: str, markets: list[str]) -> dict:
    """Esegue OddsHarvester e ritorna i dati."""
    cmd = [
        "oddsharvester",
        "upcoming",
        "-s", sport,
        "-d", date,
        "-m", ",".join(markets),
        "--headless",
        "-f", "json"
    ]
    
    print(f"Eseguo: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minuti timeout
        )
        
        if result.returncode != 0:
            print(f"Errore OddsHarvester: {result.stderr}", file=sys.stderr)
            return {"error": result.stderr, "data": []}
        
        # Parsa output JSON
        data = json.loads(result.stdout)
        return {"error": None, "data": data}
        
    except subprocess.TimeoutExpired:
        print("Timeout: OddsHarvester ha impiegato più di 5 minuti", file=sys.stderr)
        return {"error": "timeout", "data": []}
    except Exception as e:
        print(f"Eccezione: {e}", file=sys.stderr)
        return {"error": str(e), "data": []}

def main():
    """Raccoglie odds per oggi e domani."""
    output_dir = Path("data/oddsharvester")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    today = datetime.now().strftime("%Y%m%d")
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y%m%d")
    
    markets = ["1x2", "over_under", "btts"]
    
    results = {
        "collected_at": datetime.now().isoformat(),
        "today": {},
        "tomorrow": {}
    }
    
    # Raccogli per oggi
    print(f"\n=== Raccolta per {today} ===")
    today_data = run_oddsharvester("football", today, markets)
    results["today"] = today_data
    
    # Raccogli per domani
    print(f"\n=== Raccolta per {tomorrow} ===")
    tomorrow_data = run_oddsharvester("football", tomorrow, markets)
    results["tomorrow"] = tomorrow_data
    
    # Salva risultati
    output_file = output_dir / "latest.json"
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\n✓ Dati salvati in {output_file}")
    print(f"  Oggi: {len(today_data['data'])} match")
    print(f"  Domani: {len(tomorrow_data['data'])} match")
    
    # Statistiche
    total_matches = len(today_data['data']) + len(tomorrow_data['data'])
    if total_matches > 0:
        sample = today_data['data'][0] if today_data['data'] else tomorrow_data['data'][0]
        bookmakers = set()
        for match in today_data['data'] + tomorrow_data['data']:
            if 'bookmakers' in match:
                bookmakers.update(match['bookmakers'].keys())
        print(f"  Bookmaker trovati: {len(bookmakers)}")
        print(f"  Esempio: {sample.get('home_team', 'N/A')} vs {sample.get('away_team', 'N/A')}")

if __name__ == "__main__":
    main()
