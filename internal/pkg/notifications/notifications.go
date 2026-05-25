package notifications

// Notification rappresenta una notifica di sistema.
type Notification struct {
	Title   string
	Message string
}

// Send invia una notifica nativa utilizzando il backend specifico per la piattaforma.
func Send(title, message string) error {
	return platformSend(title, message)
}
