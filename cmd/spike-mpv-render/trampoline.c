/* Trampoline richiesto da mpv_render_context_set_update_callback.
 *
 * goSpike1UpdateCallback è esportato da Go (cgo //export) — il linker
 * lo risolve a runtime. Tenere questo trampoline in un .c file dedicato
 * (anziché nel preamble di main.go) evita la doppia definizione che
 * cgo introduce quando il preamble è incluso in più translation unit.
 */

extern void goSpike1UpdateCallback(void);

void spike1_update_trampoline(void* ctx) {
    (void)ctx;
    goSpike1UpdateCallback();
}

