# Installazione StreamAI su Linux

StreamAI distribuisce pacchetti nativi firmati per le principali famiglie di
distribuzioni Linux tramite un repository pubblico ospitato su GitHub Pages:

> `https://<user>.github.io/StreamAI-IPTV`

Sostituisci `<user>` con l'organizzazione/utente GitHub del progetto.

---

## Debian / Ubuntu / Linux Mint / Pop!_OS

```bash
sudo install -d /etc/apt/keyrings
curl -fsSL https://<user>.github.io/StreamAI-IPTV/pubkey.asc \
  | sudo gpg --dearmor -o /etc/apt/keyrings/streamai.gpg
echo "deb [signed-by=/etc/apt/keyrings/streamai.gpg] https://<user>.github.io/StreamAI-IPTV/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/streamai.list
sudo apt update
sudo apt install streamai
```

## Fedora / RHEL / Rocky / AlmaLinux

```bash
sudo rpm --import https://<user>.github.io/StreamAI-IPTV/pubkey.asc
sudo curl -fsSL https://<user>.github.io/StreamAI-IPTV/rpm/streamai.repo \
  -o /etc/yum.repos.d/streamai.repo
sudo dnf install streamai
```

## openSUSE

```bash
sudo rpm --import https://<user>.github.io/StreamAI-IPTV/pubkey.asc
sudo zypper addrepo https://<user>.github.io/StreamAI-IPTV/rpm streamai
sudo zypper refresh
sudo zypper install streamai
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

## AppImage (universale)

```bash
curl -fsSLO https://<user>.github.io/StreamAI-IPTV/appimage/StreamAI-x.y.z.AppImage
curl -fsSLO https://<user>.github.io/StreamAI-IPTV/appimage/StreamAI-x.y.z.AppImage.asc
gpg --verify StreamAI-x.y.z.AppImage.asc
chmod +x StreamAI-x.y.z.AppImage
./StreamAI-x.y.z.AppImage
```

## tar.xz portable

```bash
curl -fsSLO https://<user>.github.io/StreamAI-IPTV/tar/streamai-x.y.z.tar.xz
curl -fsSLO https://<user>.github.io/StreamAI-IPTV/tar/streamai-x.y.z.tar.xz.asc
gpg --verify streamai-x.y.z.tar.xz.asc
tar -xJf streamai-x.y.z.tar.xz
./streamai-x.y.z/streamai
```

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

