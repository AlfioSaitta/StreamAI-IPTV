package com.streamai.iptv;

import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private static final Rational STREAMAI_PIP_ASPECT_RATIO = new Rational(16, 9);

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		updatePictureInPictureParams();
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
