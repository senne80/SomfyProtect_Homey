"use strict";

const SomfyProtectBaseDevice = require("../../lib/SomfyProtectBaseDevice");

class MotionDevice extends SomfyProtectBaseDevice {
  async onInit() {
    await super.onInit();
    this.log(`Motion sensor ready: ${this.getName()}`);
  }

  async applyExternalUpdate(statePatch) {
    await super.applyExternalUpdate(statePatch);

    if (typeof statePatch.alarm_motion !== "undefined") {
      await this.updateMotionState(statePatch.alarm_motion);
    }
  }

  async updateMotionState(value) {
    await this.updateCapabilityIfChanged("alarm_motion", Boolean(value));
  }
}

module.exports = MotionDevice;