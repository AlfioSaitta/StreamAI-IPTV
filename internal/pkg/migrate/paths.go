package migrate

import (
	"os"
	"path/filepath"
	"runtime"
)

// ElectronAppData ritorna il path della directory dei dati di Electron (v1)
// a seconda del sistema operativo.
func ElectronAppData() string {
	var appData string
	switch runtime.GOOS {
	case "linux":
		// Su Linux Electron usa ~/.config/<appname>
		configDir, err := os.UserConfigDir()
		if err != nil {
			return ""
		}
		appData = filepath.Join(configDir, "StreamAI-IPTV")
	case "windows":
		// Su Windows Electron usa %APPDATA%/<appname>
		appData = filepath.Join(os.Getenv("APPDATA"), "StreamAI-IPTV")
	case "darwin":
		// Su macOS Electron usa ~/Library/Application Support/<appname>
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		appData = filepath.Join(home, "Library", "Application Support", "StreamAI-IPTV")
	default:
		return ""
	}
	return appData
}

// ChromiumIndexedDBPath ritorna il path del database IndexedDB di Chromium (Electron)
func ChromiumIndexedDBPath() string {
	base := ElectronAppData()
	if base == "" {
		return ""
	}
	// Il path standard per file:// origin in Electron/Chromium
	return filepath.Join(base, "IndexedDB", "file__0.indexeddb.leveldb")
}

// ChromiumLocalStoragePath ritorna il path del database Local Storage di Chromium (Electron)
func ChromiumLocalStoragePath() string {
	base := ElectronAppData()
	if base == "" {
		return ""
	}
	return filepath.Join(base, "Local Storage", "leveldb")
}

// LegacyExists verifica se esiste la directory dei dati della versione 1.x (Electron)
func LegacyExists() bool {
	idb := ChromiumIndexedDBPath()
	ls := ChromiumLocalStoragePath()

	exists := func(p string) bool {
		if p == "" {
			return false
		}
		info, err := os.Stat(p)
		return err == nil && info.IsDir()
	}

	return exists(idb) || exists(ls)
}
