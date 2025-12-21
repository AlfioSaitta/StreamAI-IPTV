/**
 * Script per sostituire libffmpeg.so di Electron con una versione che supporta
 * codec proprietari come HEVC/H.265
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

// Rileva piattaforma e architettura
const platform = os.platform();
const arch = os.arch();

console.log(`[patch-ffmpeg] Platform: ${platform}, Arch: ${arch}`);

// Versione Electron installata
let electronVersion = '29.0.0';
try {
  // Prova a leggere dal package.json di electron
  const electronPkgPath = path.join(__dirname, '..', 'node_modules', 'electron', 'package.json');
  if (fs.existsSync(electronPkgPath)) {
    const electronPkg = require(electronPkgPath);
    electronVersion = electronPkg.version;
    console.log(`[patch-ffmpeg] Electron version detected: ${electronVersion}`);
  } else {
    // Fallback: prova a eseguire electron --version
    const electronBin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
    const versionOutput = execSync(`${electronBin} --version`).toString().trim();
    electronVersion = versionOutput.replace('v', '');
    console.log(`[patch-ffmpeg] Electron binary version: ${electronVersion}`);
  }
} catch (e) {
  console.log('[patch-ffmpeg] Warning: Could not detect Electron version, using default:', electronVersion);
}

// Mappa piattaforma/arch
const platformMap = {
  'linux-x64': { libName: 'libffmpeg.so', arch: 'x64' },
  'linux-arm64': { libName: 'libffmpeg.so', arch: 'arm64' },
  'darwin-x64': { libName: 'libffmpeg.dylib', arch: 'x64' },
  'darwin-arm64': { libName: 'libffmpeg.dylib', arch: 'arm64' },
  'win32-x64': { libName: 'ffmpeg.dll', arch: 'x64' },
  'win32-ia32': { libName: 'ffmpeg.dll', arch: 'ia32' }
};

const key = `${platform}-${arch}`;
const config = platformMap[key];

if (!config) {
  console.log(`[patch-ffmpeg] Piattaforma non supportata: ${key}`);
  process.exit(0);
}

// Trova la directory di Electron
function findElectronPath() {
  const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
  const electronPath = path.join(nodeModulesPath, 'electron', 'dist');
  if (fs.existsSync(electronPath)) {
    return electronPath;
  }
  return null;
}

// Download con gestione redirect e progress
function download(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
      }
    };

    https.get(options, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        download(response.headers.location, dest, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      let downloaded = 0;
      const total = parseInt(response.headers['content-length'] || '0', 10);

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write(`\r[patch-ffmpeg] Download: ${pct}%`);
        }
      });

      response.pipe(file);
      file.on('finish', () => {
        console.log(''); // newline dopo progress
        file.close();
        resolve();
      });
      file.on('error', reject);
    }).on('error', reject);
  });
}

// Estrai zip
async function extractZip(zipPath, destDir) {
  try {
    if (platform === 'win32') {
      execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'pipe' });
    } else {
      execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' });
    }
    return true;
  } catch (e) {
    console.error('[patch-ffmpeg] Errore estrazione:', e.message);
    return false;
  }
}

// Cerca ricorsivamente un file in una directory
function findFileRecursive(dir, filename) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && file === filename) {
        return fullPath;
      }
      if (stat.isDirectory()) {
        const found = findFileRecursive(fullPath, filename);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

function showManualInstructions(targetPath) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  ISTRUZIONI PER ABILITARE CODEC HEVC/H.265');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Il codec HEVC non è incluso di default in Electron per motivi di licenza.');
  console.log('');
  console.log('OPZIONE 1 - Installa codec di sistema (consigliato):');
  console.log('');
  if (platform === 'linux') {
    console.log('  Ubuntu/Debian:');
    console.log('    sudo apt update');
    console.log('    sudo apt install ubuntu-restricted-extras gstreamer1.0-libav \\');
    console.log('      gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly');
    console.log('');
    console.log('  openSUSE:');
    console.log('    sudo zypper ar -cfp 90 \\');
    console.log('      https://ftp.gwdg.de/pub/linux/misc/packman/suse/openSUSE_Tumbleweed/ packman');
    console.log('    sudo zypper dup --from packman --allow-vendor-change');
    console.log('    sudo zypper install gstreamer-plugins-libav gstreamer-plugins-bad \\');
    console.log('      gstreamer-plugins-ugly ffmpeg x265 libx265');
    console.log('');
    console.log('  Fedora:');
    console.log('    sudo dnf install gstreamer1-libav gstreamer1-plugins-bad-freeworld \\');
    console.log('      gstreamer1-plugins-ugly');
    console.log('');
    console.log('  Arch Linux:');
    console.log('    sudo pacman -S gst-libav gst-plugins-bad gst-plugins-ugly');
    console.log('');
  } else if (platform === 'win32') {
    console.log('  Installa "HEVC Video Extensions" dal Microsoft Store');
    console.log('  (cerca "HEVC Video Extensions from Device Manufacturer" per la versione gratuita)');
    console.log('');
  } else if (platform === 'darwin') {
    console.log('  macOS supporta HEVC nativamente da 10.13 High Sierra');
    console.log('  Assicurati di avere una versione aggiornata del sistema.');
    console.log('');
  }
  console.log('OPZIONE 2 - Scarica libffmpeg manualmente:');
  console.log('');
  console.log('  1. Vai su: https://github.com/BranchBit/electron-chromium-ffmpeg-hevc-prebuilt/releases');
  console.log('     o cerca "electron ffmpeg codecs" su GitHub');
  console.log('');
  console.log('  2. Scarica il file per la tua piattaforma e versione Electron');
  console.log('');
  console.log('  3. Copia il file nel percorso:');
  console.log(`     ${targetPath}`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
}

async function tryDownload(urls, tempDir, zipName) {
  const zipPath = path.join(tempDir, zipName);

  for (const url of urls) {
    try {
      console.log(`[patch-ffmpeg] Tentativo: ${url.substring(0, 60)}...`);
      await download(url, zipPath);
      if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1000) {
        return zipPath;
      }
    } catch (e) {
      console.log(`[patch-ffmpeg] Fallito: ${e.message}`);
    }
  }
  return null;
}

// Copia tutti i file rilevanti da una directory a un'altra
function copyElectronFiles(srcDir, destDir) {
  const filesToCopy = [
    'electron', 'electron.exe',
    'chrome_crashpad_handler', 'chrome_crashpad_handler.exe',
    'chrome-sandbox',
    'libEGL.so', 'libEGL.dll',
    'libGLESv2.so', 'libGLESv2.dll',
    'libvk_swiftshader.so', 'vk_swiftshader.dll',
    'libvulkan.so.1', 'vulkan-1.dll',
    'chrome_100_percent.pak', 'chrome_200_percent.pak', 'resources.pak',
    'snapshot_blob.bin', 'v8_context_snapshot.bin',
    'libffmpeg.so', 'ffmpeg.dll', 'libffmpeg.dylib'
  ];

  let copied = 0;
  for (const file of filesToCopy) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dest);
        if (platform !== 'win32') {
          try { fs.chmodSync(dest, 0o755); } catch {}
        }
        copied++;
      } catch (e) {
        console.error(`[patch-ffmpeg] Errore copia ${file}: ${e.message}`);
      }
    }
  }
  return copied;
}

async function patch() {
  const electronPath = findElectronPath();
  if (!electronPath) {
    console.log('[patch-ffmpeg] Directory Electron non trovata - skip');
    return;
  }

  const targetPath = path.join(electronPath, config.libName);
  if (!fs.existsSync(targetPath)) {
    console.log(`[patch-ffmpeg] File target non trovato: ${targetPath}`);
    return;
  }

  // ============================================
  // CHECK: Verifica se i codec HEVC sono già installati
  // ============================================
  const patchMarkerFile = path.join(electronPath, '.hevc-patch-version');
  const currentPatchVersion = `${electronVersion}-branchbit`;

  if (fs.existsSync(patchMarkerFile)) {
    const installedVersion = fs.readFileSync(patchMarkerFile, 'utf8').trim();
    if (installedVersion === currentPatchVersion) {
      console.log(`[patch-ffmpeg] ✓ Codec HEVC già installati (${installedVersion})`);
      return;
    }
    console.log(`[patch-ffmpeg] Versione patch diversa: ${installedVersion} -> ${currentPatchVersion}`);
  }

  // URLs da provare per scaricare ffmpeg con codec proprietari
  const getPlatformName = () => {
    if (platform === 'darwin') return 'macosx';
    if (platform === 'win32') return 'windows';
    return 'linux-x64';
  };
  const platformName = getPlatformName();

  // Estrai versione major.minor.patch per matching
  const versionParts = electronVersion.split('.');
  const majorVersion = parseInt(versionParts[0], 10);

  const downloadUrls = [
    // BranchBit prebuilt releases - versione esatta
    `https://github.com/BranchBit/electron-chromium-ffmpeg-hevc-prebuilt/releases/download/v${electronVersion}/v${electronVersion}-${platformName}-electron-chromium-ffmpeg-hevc-prebuilt.zip`,
  ];

  // Se la versione non è disponibile, prova versioni vicine (fallback)
  // Nota: questo è rischioso ma spesso funziona per versioni patch diverse
  if (majorVersion >= 37) {
    downloadUrls.push(`https://github.com/BranchBit/electron-chromium-ffmpeg-hevc-prebuilt/releases/download/v37.2.4/v37.2.4-${platformName}-electron-chromium-ffmpeg-hevc-prebuilt.zip`);
  }

  const tempDir = path.join(os.tmpdir(), 'ffmpeg-patch-' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const zipPath = await tryDownload(downloadUrls, tempDir, 'ffmpeg.zip');

    if (zipPath) {
      console.log('[patch-ffmpeg] Estrazione...');
      if (await extractZip(zipPath, tempDir)) {
        // BranchBit fornisce una distribuzione Electron completa
        // Prima cerca il file libffmpeg.so specifico
        const ffmpegFile = findFileRecursive(tempDir, config.libName);

        // Cerca anche il binario electron (la distribuzione BranchBit)
        const electronFile = findFileRecursive(tempDir, platform === 'win32' ? 'electron.exe' : 'electron');

        if (electronFile) {
          // BranchBit distribution - copia tutti i file
          const srcDir = path.dirname(electronFile);
          const backupDir = electronPath + '.original';

          if (!fs.existsSync(backupDir)) {
            console.log(`[patch-ffmpeg] Backup: ${backupDir}`);
            try {
              fs.cpSync(electronPath, backupDir, { recursive: true });
            } catch (e) {
              console.error('[patch-ffmpeg] Errore backup:', e.message);
            }
          }

          console.log('[patch-ffmpeg] Installazione distribuzione Electron con codec HEVC...');
          const copied = copyElectronFiles(srcDir, electronPath);
          
          if (copied > 0) {
            // Salva marker versione
            fs.writeFileSync(patchMarkerFile, currentPatchVersion);
            console.log(`[patch-ffmpeg] ✓ Patch completata! ${copied} file copiati. Codec HEVC/H.265 abilitati.`);
            console.log('[patch-ffmpeg] Nota: I codec HEVC sono compilati staticamente nel binario electron');
            return;
          }
        } else if (ffmpegFile) {
          // Solo libffmpeg.so
          const backupPath = targetPath + '.original';
          if (!fs.existsSync(backupPath)) {
            console.log(`[patch-ffmpeg] Backup: ${backupPath}`);
            fs.copyFileSync(targetPath, backupPath);
          }

          console.log(`[patch-ffmpeg] Installazione ${config.libName}...`);
          fs.copyFileSync(ffmpegFile, targetPath);
          if (platform !== 'win32') fs.chmodSync(targetPath, 0o755);
          // Salva marker versione
          fs.writeFileSync(patchMarkerFile, currentPatchVersion);
          console.log('[patch-ffmpeg] ✓ Patch completata! Codec HEVC/H.265 abilitati.');
          return;
        }
      }
    }

    // Se il download fallisce, mostra istruzioni
    showManualInstructions(targetPath);

  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

// Esegui
patch().catch(err => {
  console.error('[patch-ffmpeg] Errore:', err.message);
});
