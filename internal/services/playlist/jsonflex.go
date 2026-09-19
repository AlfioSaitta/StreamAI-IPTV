package playlist

import (
	"encoding/json"
	"strconv"
	"strings"
)

// Decodifica tollerante dei campi Xtream.
//
// L'API Xtream non è tipizzata in modo coerente: lo stesso campo arriva a volte
// come numero e a volte come stringa a seconda del provider e dell'endpoint
// (`"category_id":"5"` vs `5`, `"parent_id":"0"` vs `0`, `"rating_5based":"4.0"`
// vs `4.0`, `"added":"1620000000"` vs `1620000000`).
//
// Con i tipi Go nativi UN SOLO campo con il tipo "sbagliato" fa fallire il
// `json.Unmarshal` dell'INTERA risposta: la slice resta `nil`, il blocco (VOD o
// serie) finisce vuoto e — poiché il chiamante scartava l'errore con `_` —
// l'utente vedeva semplicemente un catalogo vuoto, senza alcuna spiegazione.
//
// Questi tipi accettano entrambe le forme. Il marshalling resta identico a
// prima (stringa → stringa, numero → numero), quindi il payload verso il
// frontend non cambia.

// flexString decodifica un campo che può arrivare come stringa o come numero.
type flexString string

func (f *flexString) UnmarshalJSON(data []byte) error {
	raw := strings.TrimSpace(string(data))

	if raw == "" || raw == "null" {
		*f = ""
		return nil
	}

	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		*f = flexString(s)
		return nil
	}

	switch raw {
	case "true":
		*f = "1"
		return nil
	case "false":
		*f = "0"
		return nil
	}

	// Numero: conserviamo la forma testuale così com'è, così gli id restano
	// confrontabili fra categorie e stream anche quando il provider usa un
	// numero in un endpoint e una stringa nell'altro.
	if _, err := strconv.ParseFloat(raw, 64); err != nil {
		// Valore inatteso (oggetto/array): non è un motivo sufficiente per far
		// fallire l'intero catalogo.
		*f = ""
		return nil
	}
	*f = flexString(raw)
	return nil
}

// flexInt decodifica un campo che può arrivare come numero o come stringa
// numerica (es. `stream_id`, `series_id`, `num`, `parent_id`).
type flexInt int

func (f *flexInt) UnmarshalJSON(data []byte) error {
	raw := strings.TrimSpace(string(data))

	if raw == "" || raw == "null" || raw == `""` {
		*f = 0
		return nil
	}

	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		raw = strings.TrimSpace(s)
		if raw == "" {
			*f = 0
			return nil
		}
	}

	switch raw {
	case "true":
		*f = 1
		return nil
	case "false":
		*f = 0
		return nil
	}

	n, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		*f = 0
		return nil
	}
	*f = flexInt(int(n))
	return nil
}

// flexFloat decodifica un campo numerico che può arrivare come stringa.
type flexFloat float32

func (f *flexFloat) UnmarshalJSON(data []byte) error {
	raw := strings.TrimSpace(string(data))

	if raw == "" || raw == "null" || raw == `""` {
		*f = 0
		return nil
	}

	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		raw = strings.TrimSpace(s)
		if raw == "" {
			*f = 0
			return nil
		}
	}

	n, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		*f = 0
		return nil
	}
	*f = flexFloat(n)
	return nil
}
