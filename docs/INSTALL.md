# Installazione StreamAI su Linux

StreamAI distribuisce pacchetti nativi firmati per le principali famiglie di
distribuzioni Linux tramite un repository pubblico ospitato su GitHub Pages:

> `https://<user>.github.io/StreamAI-IPTV`

Ogni distro ha un canale dedicato con dipendenze native (nomi pacchetto
specifici della distro, non solo SONAME). Sostituisci `<user>` con
l'organizzazione/utente GitHub del progetto.

---

## Debian

```bash
sudo install -d /etc/apt/keyrings
curl -fsSL https://<user>.github.io/StreamAI-IPTV/pubkey.asc \
  | sudo gpg --dearmor -o /etc/apt/keyrings/streamai.gpg
echo "deb [signed-by=/etc/apt/keyrings/streamai.gpg] https://<user>.github.io/StreamAI-IPTV/apt/debian stable main" \
  | sudo tee /etc/apt/sources.list.d/streamai.list
sudo apt update
sudo apt install streamai
```

## Ubuntu / Linux Mint / Pop!_OS

```bash
sudo install -d /etc/apt/keyrings
curl -fsSL https://<user>.github.io/StreamAI-IPTV/pubkey.asc \
  | sudo gpg --dearmor -o /etc/apt/keyrings/streamai.gpg
echo "deb [signed-by=/etc/apt/keyrings/streamai.gpg] https://<user>.github.io/StreamAI-IPTV/apt/ubuntu stable main" \
  | sudo tee /etc/apt/sources.list.d/streamai.list
sudo apt update
sudo apt install streamai
```

> Ubuntu 24.04+ usa varianti con suffisso `t64` per alcune librerie (es.
> `libgtk-3-0t64`): il pacchetto Ubuntu le richiede con sintassi OR-alternativa
> in modo da funzionare anche su versioni più vecchie e su Debian.

## openSUSE Tumbleweed / Leap

```bash
sudo rpm --import https://<user>.github.io/StreamAI-IPTV/pubkey.asc
sudo zypper addrepo https://<user>.github.io/StreamAI-IPTV/rpm/opensuse streamai
sudo zypper refresh
sudo zypper install streamai
```

## Fedora

```bash
sudo rpm --import https://<user>.github.io/StreamAI-IPTV/pubkey.asc
sudo curl -fsSL https://<user>.github.io/StreamAI-IPTV/rpm/fedora/streamai.repo \
  -o /etc/yum.repos.d/streamai.repo
sudo dnf install streamai
```

## RHEL / Rocky / AlmaLinux

```bash
sudo rpm --import https://<user>.github.io/StreamAI-IPTV/pubkey.asc
sudo curl -fsSL https://<user>.github.io/StreamAI-IPTV/rpm/rhel/streamai.repo \
  -o /etc/yum.repos.d/streamai.repo
sudo dnf install streamai
```

## Arch / Manjaro / EndeavourOS / CachyOS

```bash
# Importa e firma localmente la chiave
curl -fsSL https://<user>.github.io/StreamAI-IPTV/pubkey.asc \
  | sudo pacman-key -a -
sudo pacman-key --lsign-key "$(cat docs/keys/streamai-fingerprint.txt)"

# Aggiungi il repo a /etc/pacman.conf
sudo tee -a /etc/pacman.conf > /dev/null <<'EOF'

[streamai]
Server = https://<user>.github.io/StreamAI-IPTV/arch
EOF

sudo pacman -Sy streamai
```

---

## Requisiti di Sistema

Oltre alle dipendenze gestite automaticamente dal gestore pacchetti, assicurati che il tuo sistema abbia il supporto hardware per la decodifica video (opzionale ma consigliato):

- **Driver Video:** Driver aggiornati per la tua GPU (NVIDIA, Intel o AMD).
- **libmpv:** Il player desktop richiede `libmpv` (versione 1.107+ o API 2.x) installata. Sui pacchetti nativi questa è elencata come dipendenza e verrà installata automaticamente.

## AppImage / tar.xz (disponibili a breve)
Le versioni universali AppImage e tar.xz sono in fase di migrazione verso il nuovo runtime Wails e non sono ancora disponibili per la versione 2.0.0. Utilizza i pacchetti nativi (.deb, .rpm, .pkg.tar.zst) per la migliore integrazione con il sistema.

---

## Verifica integrità

Ogni release pubblica anche `SHA256SUMS` e `SHA256SUMS.asc`:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
```

Per attestazioni SLSA di build provenance:

```bash
gh attestation verify <file> --owner <user>
```

Vedi anche [`docs/SIGNING.md`](SIGNING.md) per il fingerprint corrente e la
procedura di rotazione della chiave.

