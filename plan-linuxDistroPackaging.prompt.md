## Plan: Pacchetti Linux per-distro (v5 — final)

Sostituire il `tar.gz` con pacchetti nativi `deb`/`rpm`/`pacman` auto-selezionati dalla distro host (`tar.xz` e `AppImage` solo on-demand), firmati con una **nuova chiave GPG del maintainer creata ad-hoc**, pubblicati su repository APT/RPM/Arch ospitati su GitHub Pages (`<user>.github.io/StreamAI-IPTV`), con attestazioni SLSA di build provenance. Aggiungere `.desktop` entry + icone multi-size per integrazione nei menu desktop.

### Analisi dei file ridistribuiti
Da [`package.json`](package.json) `build.files`: payload minimale (`dist/**`, [`main.js`](main.js), [`services/advertisingService.js`](services/advertisingService.js), [`icon.png`](icon.png), `package.json`). Peso del `tar.gz` ≈ runtime Electron + FFmpeg HEVC patchato da [`scripts/patch-ffmpeg.js`](scripts/patch-ffmpeg.js) + locali Chromium. Ottimizzazioni: pruning locali, esclusione `*.map`, `removePackageScripts`, `compression: maximum` (già attiva).

### Steps

1. **Creazione chiave GPG maintainer** — creare [`scripts/setup-gpg-key.sh`](scripts/setup-gpg-key.sh) che, in modalità interattiva o batch (`--batch --name "<name>" --email "<email>"`):
   - Genera chiave primaria **Ed25519 (certify)** + **subkey Ed25519 (sign)** dedicata "StreamAI Release Signing" con scadenza 3 anni (rinnovabile) usando `gpg --batch --generate-key` con template predisposto.
   - Esporta `docs/keys/streamai-pubkey.asc` (armored), `docs/keys/streamai-fingerprint.txt`, e revocation cert in `docs/keys/streamai-revoke.asc` (da custodire offline).
   - **Backup chiave primaria cifrata**: esporta la primaria via `gpg --armor --export-secret-keys <FPR>` e la cifra simmetricamente con AES-256 (`gpg --symmetric --cipher-algo AES256 --output docs/keys/streamai-master.key.asc.gpg`) usando una passphrase di backup distinta da quella di firma; richiesta in modo interattivo o via env `GPG_BACKUP_PASSPHRASE`. Idem per la subkey signing in `docs/keys/streamai-signing.key.asc.gpg`.
   - Aggiunge `docs/keys/*.key.asc`, `docs/keys/*.key.asc.gpg`, `docs/keys/streamai-revoke.asc` a `.gitignore` (creando l'entry se assente) per impedire commit accidentali; mantiene tracciati solo `streamai-pubkey.asc` e `streamai-fingerprint.txt`.
   - Stampa istruzioni per inserire nei GitHub Secrets:
     - `GPG_PRIVATE_KEY` (`gpg --armor --export-secret-subkeys <FPR>` — solo subkey sign, non la primaria).
     - `GPG_PASSPHRASE`, `GPG_KEY_ID` (long key id della subkey signing).
   - Aggiorna `docs/SIGNING.md` con fingerprint, comandi `gpg --recv-keys`, procedura di rotazione/revoca.

2. **Icone & desktop entry** — generare `build/icons/<size>.png` (`16,32,48,64,128,256,512`) da [`icon.png`](icon.png) via `scripts/generate-icons.mjs` (sharp) e creare `build/streamai.desktop` con `Categories=AudioVideo;Video;Player;TV;`, `MimeType=application/vnd.apple.mpegurl;application/x-mpegURL;video/mp2t;`, `StartupWMClass=StreamAI`, `Icon=streamai`. Referenziare `build.linux.icon` (dir) e `build.linux.desktop` (object) in [`package.json`](package.json) → installazione automatica in `/usr/share/icons/hicolor/<size>/apps/streamai.png` e `/usr/share/applications/streamai.desktop`.

3. **Config electron-builder** — in [`package.json`](package.json) `build.linux.target` default `["deb","rpm","pacman"]`, blocchi `build.deb`/`build.rpm`/`build.pacman` (`depends`, `fpm`, `executableName: "streamai"`, `synopsis`, `description`), `electronLanguages: ["en-US","it"]`, `removePackageScripts: true`, esclusione `**/*.map`. `tar.xz`/`AppImage` solo on-demand.

4. **Script build host-detect** — [`scripts/build-linux.sh`](scripts/build-linux.sh) con mapping da `/etc/os-release`: `debian|ubuntu|linuxmint|pop` → `deb`; `fedora|rhel|centos|rocky|almalinux` → `rpm`; `opensuse*|suse|sles` → `rpm`; `arch|manjaro|endeavouros|cachyos` → `pacman`. Flag `--deb|--rpm|--pacman|--appimage|--tar|--all`, env `TARGET=...`. Distro sconosciute → errore con suggerimento `--appimage`/`--tar`. Invoca firma se `GPG_KEY_ID` settato.

5. **Script firma** — [`scripts/sign-linux-packages.sh`](scripts/sign-linux-packages.sh) (env `GPG_KEY_ID`, `GPG_PASSPHRASE`):
   - `.deb` → `dpkg-sig --sign builder -k $GPG_KEY_ID` (+ fallback `debsigs`).
   - `.rpm` → `rpm --addsign` con `~/.rpmmacros` generato al volo.
   - `.pkg.tar.zst` → `gpg --detach-sign -u $GPG_KEY_ID` (`.sig`).
   - `.AppImage` / `.tar.xz` → `gpg --detach-sign --armor` (`.asc`).
   - Genera `dist/SHA256SUMS` + `SHA256SUMS.asc`.

6. **Script npm** — in [`package.json`](package.json):
   - `dist:linux` → `bash scripts/build-linux.sh` (host-detect).
   - `dist:linux:deb|rpm|pacman|appimage|tar|all` alias.
   - `gpg:setup` → `bash scripts/setup-gpg-key.sh`.
   - `repo:publish` → `bash scripts/publish-repo.sh`.

7. **Repository GitHub Pages** — [`scripts/publish-repo.sh`](scripts/publish-repo.sh) assembla `public-repo/`:
   - `public-repo/apt/` → `reprepro -b . includedeb stable dist/*.deb` (canale unico `stable`); espone `dists/stable/{Release,Release.gpg,InRelease}` + `pubkey.asc`.
   - `public-repo/rpm/` → `createrepo_c .` + `gpg --detach-sign --armor repodata/repomd.xml`; `streamai.repo` con `gpgcheck=1`/`repo_gpgcheck=1`.
   - `public-repo/arch/` → dentro container Arch `docker run --rm -v "$PWD":/w -w /w archlinux:latest bash -c "pacman -Sy --noconfirm && repo-add streamai.db.tar.zst *.pkg.tar.zst"`; copia `*.pkg.tar.zst` + `.sig`.
   - `public-repo/appimage/` + `public-repo/tar/` → mirror diretti con `.asc` e `SHA256SUMS`.
   - `public-repo/index.html` con istruzioni install + fingerprint; `public-repo/pubkey.asc` esportato.

8. **GitHub Actions** — [`.github/workflows/linux-release.yml`](.github/workflows/linux-release.yml):
   - Trigger: `push: tags: v*` + `workflow_dispatch`.
   - `permissions: { contents: write, id-token: write, attestations: write, pages: write }`.
   - Job `build` su `ubuntu-latest` Node 20: checkout → `apt-get install rpm fakeroot dpkg-sig debsigs reprepro createrepo-c libarchive-tools zstd gnupg2` → `npm ci` → `crazy-max/ghaction-import-gpg@v6` con secret `GPG_PRIVATE_KEY`/`GPG_PASSPHRASE`/`GPG_KEY_ID` → `bash scripts/build-linux.sh --all` → verifica firma (`rpm --checksig`, `dpkg-sig --verify`, `gpg --verify`).
   - **SLSA provenance**: `actions/attest-build-provenance@v2` su `subject-path: dist/{*.deb,*.rpm,*.pkg.tar.zst,*.AppImage,*.tar.xz,SHA256SUMS}`.
   - `softprops/action-gh-release` carica artefatti firmati + `SHA256SUMS*` + attestazione.
   - Job `pages` (needs `build`) → `bash scripts/publish-repo.sh` (con step container Arch per `repo-add`) → `peaceiris/actions-gh-pages@v3` su `gh-pages` con `keep_files: true`.

9. **Documentazione** — aggiornare [`README.md`](README.md) §Build Produzione, [`AGENTS.md`](AGENTS.md) §Comandi Utili e creare `docs/SIGNING.md` + `docs/INSTALL.md`:
   - Procedura creazione chiave via `npm run gpg:setup` e import nei GitHub Secrets.
   - URL base `https://<user>.github.io/StreamAI-IPTV/{apt,rpm,arch,appimage,tar}`.
   - Snippet `apt`: `deb [signed-by=/etc/apt/keyrings/streamai.gpg] https://<user>.github.io/StreamAI-IPTV/apt stable main`.
   - Snippet `dnf`/`zypper`: import `pubkey.asc` + drop `streamai.repo`.
   - Snippet `pacman`: append `[streamai]` + `Server = https://<user>.github.io/StreamAI-IPTV/arch`, `pacman-key --add pubkey.asc && pacman-key --lsign-key <FPR>`.
   - Fingerprint chiave + revocation policy.
   - Prerequisiti host: `rpm`, `fakeroot`, `dpkg-sig`, `gnupg`, `libarchive-tools`, Docker (solo repo Arch).
   - Verifica provenance: `gh attestation verify <file> --owner <user>`.

### Further Considerations

1. Lo script `setup-gpg-key.sh` chiede in batch nome/email maintainer: vuoi che li parametrizzi via env (`MAINTAINER_NAME`, `MAINTAINER_EMAIL`) o tramite prompt interattivo? Consiglio: entrambi, env prioritari, fallback a prompt.
2. Backup chiave primaria: lo script salva `docs/keys/streamai-master.key.asc.gpg` cifrata simmetricamente AES-256 (gitignored) + revocation cert `streamai-revoke.asc` (anch'esso gitignored). La passphrase di backup è distinta da quella di firma e custodita offline dal maintainer.
3. Ritenzione storica `gh-pages`: `keep_files: true` farà crescere il branch; rotazione futura (mantenere N release) da pianificare quando supera ~1 GB.

