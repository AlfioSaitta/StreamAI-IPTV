package com.streamai.iptv;

import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private static final Rational STREAMAI_PIP_ASPECT_RATIO = new Rational(16, 9);

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		updatePictureInPictureParams();
		enableImmersiveMode();
	}

	@Override
	public void onWindowFocusChanged(boolean hasFocus) {
		super.onWindowFocusChanged(hasFocus);
		// Android ripristina le system bars dopo dialog/notifiche di sistema.
		// Quando l'activity riprende il focus, ri-applichiamo l'immersive
		// sticky per mantenere l'esperienza fullscreen.
		if (hasFocus) {
			enableImmersiveMode();
		}
	}

	/**
	 * Modalità landscape immersiva (2026-05-15).
	 *
	 * Disegna edge-to-edge sotto status bar e navigation bar, le nasconde
	 * entrambe e abilita lo swipe-to-reveal transient. Il content view della
	 * WebView Capacitor riempie quindi l'intero schermo, incluso lo spazio
	 * normalmente occupato dal notch in landscape (grazie a
	 * `windowLayoutInDisplayCutoutMode=shortEdges` in `styles.xml`).
	 *
	 * Usa le API AndroidX `WindowCompat` / `WindowInsetsControllerCompat` per
	 * un'implementazione uniforme su API 22+ senza branch manuali per
	 * vecchie versioni.
	 */
	private void enableImmersiveMode() {
		WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
		WindowInsetsControllerCompat controller =
				new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
		controller.hide(WindowInsetsCompat.Type.systemBars());
		controller.setSystemBarsBehavior(
				WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
	}

	@Override
	protected void onUserLeaveHint() {
		super.onUserLeaveHint();

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !isInPictureInPictureMode()) {
			try {
				enterPictureInPictureMode(buildPictureInPictureParams());
			} catch (IllegalStateException ignored) {
				// PiP può essere rifiutato dal sistema se l'activity non è in stato valido.
			}
		}
	}

	@Override
	public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
		super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
		updatePictureInPictureParams();
		// Quando si esce dal PiP rientriamo in immersive landscape.
		if (!isInPictureInPictureMode) {
			enableImmersiveMode();
		}
	}

	private void updatePictureInPictureParams() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			setPictureInPictureParams(buildPictureInPictureParams());
		}
	}

	private PictureInPictureParams buildPictureInPictureParams() {
		PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
				.setAspectRatio(STREAMAI_PIP_ASPECT_RATIO);

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
			builder.setAutoEnterEnabled(true);
			builder.setSeamlessResizeEnabled(true);
		}

		return builder.build();
	}
}
