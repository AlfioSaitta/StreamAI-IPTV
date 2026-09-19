package netstatus

import (
	"errors"
	"fmt"
	"net"
	"syscall"

	"golang.org/x/net/ipv4"
)

// joinMulticastGroup aggiunge `conn` al gruppo multicast `group` sulla NIC
// indicata.
//
// Il socket creato da `net.ListenUDP` è un normale UDP wildcard: il kernel NON
// gli consegna i datagrammi multicast se non ha fatto join, quindi questa
// chiamata è indispensabile per la ricezione su 239.255.255.251 — non
// un'ottimizzazione. La versione precedente di questa funzione era un no-op con
// un commento che asseriva il contrario.
//
// `ipv4.PacketConn.JoinGroup` è la variante portabile (Linux/Darwin/Windows):
// astrae le differenze fra `ip_mreq`, `ip_mreqn` e le convenzioni di Windows su
// come si indica l'interfaccia, che sono il motivo per cui un'implementazione
// diretta con `syscall` sarebbe stata inevitabilmente platform-specific.
//
// `golang.org/x/net` è già nel module graph (indiretta, via `miekg/dns` usato
// da `grandcat/zeroconf`): il package `ipv4` è quindi già compilato nel binario
// e questo non aggiunge dipendenze né peso.
func joinMulticastGroup(conn *net.UDPConn, group net.IP, iface *net.Interface) error {
	if group.To4() == nil {
		return fmt.Errorf("netstatus: multicast group %s is not IPv4", group)
	}
	if iface == nil {
		return fmt.Errorf("netstatus: nil interface")
	}

	p := ipv4.NewPacketConn(conn)
	if err := p.JoinGroup(iface, &net.UDPAddr{IP: group}); err != nil {
		// EADDRINUSE significa "questa interfaccia è GIÀ membro del gruppo": il
		// join è idempotente lato kernel, che però segnala la condizione come
		// errore. Va trattata come successo, altrimenti il rejoin periodico
		// (ogni 30s) fa sembrare fallito un join che è già attivo — ed è
		// esattamente quello che si vedeva nei log.
		if errors.Is(err, syscall.EADDRINUSE) {
			return nil
		}
		return fmt.Errorf("netstatus: JoinGroup %s on %s: %w", group, iface.Name, err)
	}
	return nil
}
