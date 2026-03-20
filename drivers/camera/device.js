"use strict";

const SomfyProtectBaseDevice = require("../../lib/SomfyProtectBaseDevice");

class CameraDevice extends SomfyProtectBaseDevice {
  async onInit() {
    await super.onInit();
    this.log(`Camera ready: ${this.getName()}`);
  }

  async applyExternalUpdate(statePatch) {
    await super.applyExternalUpdate(statePatch);

    if (typeof statePatch.alarm_motion !== "undefined") {
      await this.updateMotionState(statePatch.alarm_motion);
    }

    if (typeof statePatch.alarm_generic !== "undefined") {
      await this.updateAlarmGenericState(statePatch.alarm_generic);
    }
  }

  async updateMotionState(value) {
    await this.updateCapabilityIfChanged("alarm_motion", Boolean(value));
  }

  async updateAlarmGenericState(value) {
    await this.updateCapabilityIfChanged("alarm_generic", Boolean(value));
  }
}

module.exports = CameraDevice;
