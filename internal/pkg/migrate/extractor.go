package migrate

import (
	"encoding/json"
	"github.com/syndtr/goleveldb/leveldb"
	"github.com/syndtr/goleveldb/leveldb/opt"
	"strings"
)

// LegacyData rappresenta il dump dei dati rilevati dalla versione 1.x
type LegacyData struct {
	Profiles     string            `json:"profiles,omitzero"`     // JSON string di Profile[] da localStorage
	LocalStorage map[string]string `json:"localStorage,omitzero"` // Altri dati localStorage rilevanti
	IndexedDB    map[string]string `json:"indexedDb,omitzero"`    // Record IndexedDB (chiavi/valori base64 o stringhe)
}

// ExtractLegacyData tenta di estrarre i dati sia da Local Storage che da IndexedDB.
func ExtractLegacyData() (*LegacyData, error) {
	data := &LegacyData{
		LocalStorage: make(map[string]string),
		IndexedDB:    make(map[string]string),
	}

	// 1. Estrazione Local Storage (per Profili)
	lsPath := ChromiumLocalStoragePath()
	if lsPath != "" {
		lsEntries, err := readLevelDB(lsPath)
		if err == nil {
			for k, v := range lsEntries {
				// Chromium Local Storage keys usually look like: _file://\x00\x01KeyName
				// We look for our storage key "streamai_profiles"
				if strings.Contains(k, "streamai_profiles") {
					data.Profiles = cleanLSValue(v)
				}
				// Possiamo mappare altre chiavi se necessario
				if strings.Contains(k, "streamai_") {
					cleanK := cleanLSKey(k)
					data.LocalStorage[cleanK] = cleanLSValue(v)
				}
			}
		}
	}

	// 2. Estrazione IndexedDB (per Cache/History se non inclusa nei profili)
	idbPath := ChromiumIndexedDBPath()
	if idbPath != "" {
		idbEntries, err := readLevelDB(idbPath)
		if err == nil {
			for k, v := range idbEntries {
				// IndexedDB è più complesso da parsare deterministicamente senza conoscere l'ObjectStoreID.
				// Forniamo un dump delle chiavi che sembrano stringhe leggibili.
				if isPrintable(k) {
					data.IndexedDB[k] = string(v)
				}
			}
		}
	}

	return data, nil
}

func readLevelDB(path string) (map[string][]byte, error) {
	db, err := leveldb.OpenFile(path, &opt.Options{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer db.Close()

	entries := make(map[string][]byte)
	iter := db.NewIterator(nil, nil)
	for iter.Next() {
		entries[string(iter.Key())] = append([]byte(nil), iter.Value()...)
	}
	iter.Release()
	return entries, iter.Error()
}

// cleanLSKey rimuove i prefissi di Chromium dalle chiavi LocalStorage.
func cleanLSKey(k string) string {
	idx := strings.Index(k, "\x01")
	if idx != -1 {
		return k[idx+1:]
	}
	return k
}

// cleanLSValue rimuove il prefisso di tipo (solitamente \x01) dai valori LocalStorage.
func cleanLSValue(v []byte) string {
	if len(v) > 0 && v[0] == 0x01 {
		return string(v[1:])
	}
	return string(v)
}

func isPrintable(s string) bool {
	for _, r := range s {
		if r < 32 || r > 126 {
			return false
		}
	}
	return true
}

func (d *LegacyData) ToJSON() string {
	b, _ := json.Marshal(d)
	return string(b)
}
