# Somfy Camera Test Checklist

Use this checklist to validate the camera integration in Homey on branch `feature/camera-integration`.

## Test Environment

- App branch installed: `feature/camera-integration`
- App ID: `com.somfyprotect.integration`
- Homey firmware/version noted
- Camera model(s) noted (for example Somfy One / Outdoor Camera / Indoor Camera)

## Pairing & Discovery

- Pair flow starts and login works with valid Somfy credentials
- Camera appears in pair list (driver: Somfy Camera)
- Camera can be added successfully to Homey
- Camera name and site label look correct

## Device Capability Updates

- `alarm_motion` changes when movement is detected
- `alarm_generic` changes for connection alarms (offline/online related)
- `measure_battery` appears if the camera reports battery
- Device updates keep syncing over multiple poll cycles

## Motion Notification Test

- Trigger movement in front of the camera
- Homey notification is received with camera/site context
- Repeat movement quickly: verify anti-spam cooldown (no flood)
- Trigger movement again after about 1 minute: notification should fire again

## Camera Widget (Somfy Camera View)

- Widget can be added to dashboard
- Camera dropdown lists discovered camera devices
- Snapshot displays when `snapshot_url` is available
- `Open Live` link appears when `live_url` is available
- Sync button refreshes data without errors
- Widget keeps refreshing data automatically

## Regression Checks

- Existing non-camera devices still pair and sync (IntelliTag, motion, smoke, siren, site alarm)
- Existing widgets 1 and 2 still work for alarm state controls
- No crashes in app logs during sync cycles

## Debug Data To Send Back (if something fails)

- Homey app logs around the failing event
- Which camera model/site was used
- Timestamp of the test event
- What was expected vs what happened
- If possible, include sanitized Somfy payload keys for camera state fields (for mapping adjustments)
