package discovery
import (
	"context"
	"fmt"
	"sync"
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
	return devices
}
