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

## Problemi noti

### Crash del WebKitWebProcess su GPU NVIDIA

Su sistemi con driver NVIDIA proprietari può comparire la notifica:

> `/usr/libexec/libwebkit2gtk-4_1-0/WebKitWebProcess ha riscontrato un errore grave ed è stato chiuso`

**Non è un difetto di StreamAI.** Il crash avviene dentro il driver EGL di
NVIDIA (`libnvidia-eglcore.so`), nel processo di rendering di WebKitGTK — la
libreria webview condivisa da tutte le applicazioni GTK. Lo stesso crash si
osserva in altre applicazioni basate su WebKitGTK (IDE JetBrains, ecc.).

Verificato su WebKitGTK 2.52.6 + NVIDIA 580.178.04. Riferimenti:

- [WebKit PR #18614 — Disable DMABuf renderer for NVIDIA proprietary drivers](https://github.com/WebKit/WebKit/pull/18614)
- [Wails PR #5295 — apply WEBKIT_DISABLE_DMABUF_RENDERER for NVIDIA GPUs](https://github.com/wailsapp/wails/pull/5295)
- [WebKit bug 262607](https://bugs.webkit.org/show_bug.cgi?id=262607)

Cosa fa già StreamAI: applica automaticamente la mitigazione nota
(`WEBKIT_DISABLE_DMABUF_RENDERER=1`, la stessa che Wails imposta sui sistemi
NVIDIA), che evita i crash da import DMA-BUF ma non quelli del percorso EGL.

Cosa può fare l'utente:

- **Aggiornare o cambiare driver NVIDIA.** Il crash è nel driver: è lì che va
  corretta la causa.
- **Far girare l'app sulla GPU integrata**, se il sistema è ibrido: si evita
  del tutto il percorso EGL di NVIDIA.
- **Segnalare il problema** con il backtrace:
  `coredumpctl info <pid>` — serve a chi mantiene driver e WebKitGTK.

Per verificare che si tratti dello stesso problema, il backtrace mostra
`libnvidia-eglcore.so` ai primi frame e `WebProcessMain` in fondo; le
applicazioni diverse differiscono solo nelle frame intermedie di WebKit.

### La finestra PiP non resta sopra le altre (Linux/Wayland)

Su Wayland — la sessione predefinita di GNOME e KDE Plasma — **nessuna
applicazione può chiedere di restare sopra le altre finestre**: quel protocollo
non esiste, quindi la richiesta della finestra Picture-in-Picture viene
semplicemente ignorata dal compositor. Su X11, Windows e macOS funziona.

L'unico meccanismo che ottiene l'effetto è una regola del compositor. Su KDE
Plasma lo script incluso la crea e la rimuove:

```bash
scripts/kwin-pip-above.sh            # crea la regola
scripts/kwin-pip-above.sh --status   # verifica cosa è impostato
scripts/kwin-pip-above.sh --remove   # annulla
```

In alternativa, a mano: Impostazioni di sistema → Regole delle finestre →
Nuova → *Rileva proprietà finestra* → titolo `StreamAI PiP` → *Mantieni sopra le
altre finestre* = **Forza**. Su altri desktop serve lo strumento equivalente del
proprio compositor: la regola da esprimere è la stessa.

Se preferisci non toccare la configurazione del desktop, l'alternativa è
avviare l'app sotto XWayland (`GDK_BACKEND=x11 streamai`), dove il compositor
onora la richiesta — al costo di un livello di compatibilità in più su tutto il
rendering.

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

