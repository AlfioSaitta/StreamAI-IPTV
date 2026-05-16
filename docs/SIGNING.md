# StreamAI Package Signing

Tutti i pacchetti Linux di StreamAI sono firmati con la chiave GPG del
maintainer. La chiave è una **Ed25519** con sottochiave di firma dedicata
(`StreamAI Release Signing`) e scadenza triennale.

## Fingerprint corrente

Il fingerprint pubblico è disponibile in:

```
docs/keys/streamai-fingerprint.txt
docs/keys/streamai-pubkey.asc
```

Importa la chiave pubblica nel tuo keyring:

```bash
curl -fsSL https://<user>.github.io/StreamAI-IPTV/pubkey.asc \
  | gpg --import
```

## Verifica firme

| Formato            | Comando                                                  |
|--------------------|----------------------------------------------------------|
| `.deb`             | `dpkg-sig --verify streamai_*.deb`                       |
| `.rpm`             | `rpm --checksig streamai-*.rpm`                          |
| `.pkg.tar.zst`     | `gpg --verify streamai-*.pkg.tar.zst.sig`                |
| `.AppImage`        | `gpg --verify StreamAI-*.AppImage.asc`                   |
| `.tar.xz`          | `gpg --verify streamai-*.tar.xz.asc`                     |
| `SHA256SUMS`       | `gpg --verify SHA256SUMS.asc && sha256sum -c SHA256SUMS` |

## SLSA Build Provenance

Ogni release pubblicata da GitHub Actions include attestazioni
[SLSA v1 build provenance](https://slsa.dev/) generate da
`actions/attest-build-provenance`. Per verificarle:

```bash
gh attestation verify <file> --owner <user>
```

## Generazione della chiave (maintainer)

> Da eseguire **una sola volta**, su una macchina di fiducia, offline se
> possibile.

```bash
MAINTAINER_NAME="Mario Rossi" \
MAINTAINER_EMAIL="mario@example.com" \
GPG_KEY_PASSPHRASE="..." \
GPG_BACKUP_PASSPHRASE="..." \
  npm run gpg:setup
```

Lo script produce:

| File                                       | Tracciato? | Note                                       |
|--------------------------------------------|------------|--------------------------------------------|
| `docs/keys/streamai-pubkey.asc`            | ✅ commit  | Chiave pubblica armored                    |
| `docs/keys/streamai-fingerprint.txt`       | ✅ commit  | Fingerprint primaria                       |
| `docs/keys/streamai-revoke.asc`            | ❌ ignored | Revocation certificate (custodire offline) |
| `docs/keys/streamai-master.key.asc.gpg`    | ❌ ignored | Backup AES-256 chiave primaria             |
| `docs/keys/streamai-signing.key.asc.gpg`   | ❌ ignored | Backup AES-256 subkey di firma             |

I file `*.gpg` sono cifrati simmetricamente con AES-256 usando una passphrase
**distinta** da quella di firma (`GPG_BACKUP_PASSPHRASE`). Conservali offline
(USB/HSM), non depositarli in alcun cloud.

## GitHub Secrets richiesti

Dopo aver generato la chiave, configura sul repository:

| Secret             | Valore                                                            |
|--------------------|-------------------------------------------------------------------|
| `GPG_PRIVATE_KEY`  | Output di `gpg --armor --export-secret-subkeys <FPR>` (solo sub.) |
| `GPG_PASSPHRASE`   | Passphrase di firma                                               |
| `GPG_KEY_ID`       | Long key id della subkey di firma                                 |

> ⚠️ **Esporta solo la subkey** (`--export-secret-subkeys`). La chiave
> primaria non deve mai lasciare il backup offline: la CI ne userà solo la
> capability di firma.

## Rotazione / revoca

1. Genera una nuova chiave con `npm run gpg:setup` (cambia `MAINTAINER_EMAIL`
   se necessario).
2. Sostituisci `docs/keys/streamai-pubkey.asc` e `streamai-fingerprint.txt`
   nel repository, e i tre `GPG_*` secrets su GitHub.
3. In caso di compromissione:
   ```bash
   gpg --import docs/keys/streamai-revoke.asc
   gpg --keyserver hkps://keys.openpgp.org --send-keys <FPR>
   ```
   Aggiorna `pubkey.asc` su GitHub Pages e pubblica un annuncio nelle release
   notes della successiva versione.

