#!/usr/bin/env bash
#
# Guides a mitmproxy capture of the EcoFlow and/or Tesla app traffic, the manual step behind
# scripts/ecoflow_app_download.py and scripts/tesla_parse_charge_history.py. This script only
# automates what can be automated on the Mac side (finding its LAN IP, running mitmdump); the
# proxy/certificate setup and in-app navigation on the phone stay manual and are printed as
# numbered steps to follow before each capture starts.
#
# Usage:
#   scripts/mitm_capture.sh              # both captures, one after the other
#   scripts/mitm_capture.sh ecoflow      # only the EcoFlow capture
#   scripts/mitm_capture.sh tesla        # only the Tesla capture

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAPTURE_DIR="$REPO_ROOT/data/mitmproxy"

bold=$(tput bold 2>/dev/null || true)
dim=$(tput dim 2>/dev/null || true)
green=$(tput setaf 2 2>/dev/null || true)
yellow=$(tput setaf 3 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)

step() { printf "\n%s%s%s\n" "$bold" "$1" "$reset"; }
info() { printf "  %s\n" "$1"; }
pause() { printf "\n%s%s%s" "$yellow" "$1" "$reset"; read -r _; }

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
    targets=("ecoflow" "tesla")
fi
for t in "${targets[@]}"; do
    if [[ "$t" != "ecoflow" && "$t" != "tesla" ]]; then
        echo "Usage: $0 [ecoflow] [tesla]" >&2
        exit 1
    fi
done

if ! command -v mitmdump >/dev/null 2>&1; then
    echo "mitmdump introuvable. Installe mitmproxy d'abord :" >&2
    echo "  brew install mitmproxy" >&2
    exit 1
fi

mkdir -p "$CAPTURE_DIR"

mac_ip=""
for iface in en0 en1 en2; do
    ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    if [ -n "$ip" ]; then
        mac_ip="$ip"
        break
    fi
done
if [ -z "$mac_ip" ]; then
    echo "Impossible de trouver l'IP locale du Mac (essayé en0/en1/en2)." >&2
    echo "Trouve-la manuellement (Réglages Système > Réseau) et configure le proxy avec." >&2
    exit 1
fi

step "=== Capture mitmproxy : ${targets[*]} ==="
info "IP du Mac sur le réseau local : ${bold}${mac_ip}${reset}"

step "1. Configurer le proxy sur l'iPhone (une seule fois, valable pour les deux captures)"
info "Réglages -> Wi-Fi -> (i) sur le réseau connecté -> Configurer le proxy -> Manuel"
info "  Serveur = ${bold}${mac_ip}${reset}   Port = ${bold}8080${reset}"

step "2. Installer le certificat mitmproxy sur l'iPhone (une seule fois, sauf s'il est déjà installé)"
info "  a. Dans Safari sur l'iPhone : ${bold}http://mitm.it${reset}"
info "  b. Télécharge et installe le profil \"iOS\""
info "  c. Réglages -> Général -> VPN et gestion de l'appareil -> installe le profil"
info "  d. Réglages -> Général -> À propos -> Réglages de confiance des certificats ->"
info "     active la confiance totale pour le certificat mitmproxy"
info "${dim}(le profil ne peut se télécharger que si le proxy de l'étape 1 est déjà actif)${reset}"

pause "Appuie sur Entrée une fois le proxy et le certificat configurés sur le téléphone... "

run_capture() {
    local name="$1" file="$2"
    shift 2
    local instructions=("$@")

    step "=== Capture ${name} ==="
    printf "%s\n" "${instructions[@]}"
    info "Le fichier sera écrit dans : ${bold}${file}${reset}"

    pause "Appuie sur Entrée pour démarrer mitmdump, puis fais les actions ci-dessus dans l'app... "

    echo
    echo "${green}>> mitmdump en écoute sur le port 8080 (Ctrl+C pour arrêter une fois la capture faite)${reset}"
    echo
    mitmdump -w "$file"
    local status=$?

    if [ -s "$file" ]; then
        echo
        echo "${green}Capture enregistrée : ${file}${reset}"
    else
        echo
        echo "${yellow}Attention : ${file} est vide ou absent — la capture n'a probablement rien enregistré.${reset}"
    fi
    return 0
}

for t in "${targets[@]}"; do
    if [ "$t" == "ecoflow" ]; then
        run_capture "EcoFlow" "$CAPTURE_DIR/ecoflow_flows" \
            "  1. Ouvre l'app EcoFlow, va sur l'écran des stats journalières de ton PowerStream" \
            "  2. Fais un \"pull to refresh\""
    elif [ "$t" == "tesla" ]; then
        run_capture "Tesla" "$CAPTURE_DIR/tesla_flows" \
            "  1. Ouvre l'app Tesla, va sur l'écran d'historique de charge du véhicule" \
            "  2. Navigue sur quelques mois/jours pour déclencher plusieurs appels /charge_history"
    fi
done

step "=== Terminé ==="
info "Pense à repasser le proxy Wi-Fi de l'iPhone en \"Off\" une fois les captures faites."
info "Prochaines étapes :"
for t in "${targets[@]}"; do
    if [ "$t" == "ecoflow" ]; then
        info "  .venv/bin/python scripts/ecoflow_app_download.py   (mois précédent par défaut)"
    elif [ "$t" == "tesla" ]; then
        info "  .venv/bin/python scripts/tesla_parse_charge_history.py"
    fi
done
