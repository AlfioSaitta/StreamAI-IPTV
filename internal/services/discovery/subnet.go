package discovery

import (
	"context"
	"fmt"
	"github.com/rs/zerolog/log"
	"sync"
	"sync/atomic"
)

// scanSubnet fa probe in parallelo di base.1..base.maxHosts. Mantiene la
// stessa semantica di main.js -> scanSubnet (worker pool a `concurrency`).
func scanSubnet(ctx context.Context, base string, maxHosts, concurrency int) []Device {
	if concurrency < 1 {
		concurrency = 1
	}
	if maxHosts < 1 {
		return nil
	}
	tasks := make(chan int, maxHosts)
	for i := 1; i <= maxHosts; i++ {
		tasks <- i
	}
	close(tasks)
	var mu sync.Mutex
	devices := make([]Device, 0)
	var probed atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case n, ok := <-tasks:
					if !ok {
						return
					}
					ip := fmt.Sprintf("%s.%d", base, n)
					probed.Add(1)
					if d := buildDeviceFromIP(ctx, ip, ""); d != nil {
						mu.Lock()
						devices = append(devices, *d)
						mu.Unlock()
					}
				}
			}
		}()
	}
	wg.Wait()

	// Il troncamento da deadline va reso VISIBILE: senza questo log una
	// scansione interrotta a metà è indistinguibile da una scansione completa
	// che non ha trovato nulla, e l'utente non ha modo di sapere che i
	// dispositivi oltre il punto di interruzione non sono mai stati sondati.
	if n := int(probed.Load()); n < maxHosts {
		log.Warn().
			Str("base", base).
			Int("probed", n).
			Int("total", maxHosts).
			Msg("discovery: subnet scan truncated (deadline reached before completion)")
	}
	return devices
}
