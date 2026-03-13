# Somfy Protect Integration

This project exposes Somfy Protect devices in Homey through a standalone Homey SDK v3 app. IntelliTags, motion sensors, and sirens are discovered directly from Somfy Protect, become pairable in Homey, and receive near real-time state updates.

It also adds Somfy site alarm control and status through a dedicated Site Alarm device.

## What this project contains

- A Homey app with drivers for IntelliTags, motion sensors, and sirens.
- A Homey settings page where each user enters their own Somfy credentials.
- Built-in polling and mapping in the app runtime itself (no always-on external bridge required).

## Local prerequisites

1. Install Node.js LTS on macOS:

```bash
brew install node@20
brew link --overwrite node@20
```

2. Install the Homey CLI:

```bash
npm install -g homey
homey --version
```

3. Log in to Homey:

```bash
homey login
```

4. Run and validate the app:

```bash
homey app validate
homey app run --remote
```

## Homey app structure

The app contains the requested directories:

- `drivers/intellitag/`
- `drivers/motion/`
- `drivers/siren/`
- `drivers/site_alarm/`

The IntelliTag driver implements `onInit()`, `updateContactState()`, and battery updates through the device class. Motion and siren drivers follow the same pattern.

## Homey app API

The app exposes internal management endpoints used by the Homey settings page:

- `GET /api/app/com.somfyprotect.integration/health`
- `GET /api/app/com.somfyprotect.integration/devices`
- `GET /api/app/com.somfyprotect.integration/status`
- `POST /api/app/com.somfyprotect.integration/credentials`
- `DELETE /api/app/com.somfyprotect.integration/credentials`
- `POST /api/app/com.somfyprotect.integration/sync/once`
- `POST /api/app/com.somfyprotect.integration/site/:id/state`

Sensor capabilities such as `alarm_contact` and `alarm_motion` are read-only from the normal device control API, so updates are applied internally by the app after polling Somfy.

## User login flow (Homey Store)

For Homey Store users, credentials are entered in Homey settings, not in source files:

1. Install the app.
2. Open app settings in Homey.
3. Enter your own Somfy account email/password.
4. Enable sync and save.
5. Optionally trigger "Sync Now".

No developer or personal credentials are bundled in the app.

## Running the Homey app

Run in development mode:

```bash
homey app run --remote
```

Validate before publish:

```bash
homey app validate
```

## Pairing devices in Homey

1. In Homey, add a device from the Somfy Protect Integration app.
2. Pick the correct driver type: IntelliTag, Motion Sensor, Siren, or Site Alarm.
3. You will first see a Somfy login screen in the pairing flow. Enter credentials there.
4. After successful login, Homey shows discovered Somfy devices for that driver.
5. Select and add the desired devices.

## Supported capability mappings

- IntelliTag
  - `alarm_contact`
  - `alarm_tamper`
  - `measure_battery`
- Motion sensor
  - `alarm_motion`
  - `measure_battery`
- Siren
  - `alarm_generic`
  - `onoff`
- Site Alarm
  - `homealarm_state` (`armed`, `disarmed`, `partially_armed`)
  - `alarm_generic` (true when armed or partially armed)

Current event mappings are derived from Somfy device status and diagnosis payloads:

- door opened -> `alarm_contact = true`
- door closed -> `alarm_contact = false`
- motion detected -> `alarm_motion = true`
- battery level or battery low -> `measure_battery`
- siren active -> `alarm_generic = true`, `onoff = true`
- site armed/disarmed/partial -> `homealarm_state` updated

## Arm/disarm support

Use the Site Alarm device to control the Somfy site mode:

1. Set `homealarm_state` to `armed`, `disarmed`, or `partially_armed`.
2. The app sends the matching Somfy security state to `/v3/site/:id/security`.
3. Dashboard tiles can show whether the site is armed through `homealarm_state` and `alarm_generic`.

## Notes

- `homey app create` is interactive in the installed CLI version, so this repository is scaffolded manually with the same Homey SDK v3 layout.
- Full unattended auto-pairing is not available through the standard Homey device model. The implemented discovery flow makes devices appear automatically in the pairing list, which is the supported pattern.
- No developer credentials are embedded. Every user enters their own Somfy credentials in Homey app settings.
