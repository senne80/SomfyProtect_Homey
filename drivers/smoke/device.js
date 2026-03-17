"use strict";

const SomfyProtectBaseDevice = require("../../lib/SomfyProtectBaseDevice");

class SmokeDevice extends SomfyProtectBaseDevice {
  async onInit() {
    await super.onInit();
    this.log(`Smoke detector ready: ${this.getName()}`);
  }

  async applyExternalUpdate(statePatch) {
    await super.applyExternalUpdate(statePatch);

    if (typeof statePatch.alarm_smoke !== "undefined") {
      await this.updateSmokeState(statePatch.alarm_smoke);
    }
  }

  async updateSmokeState(value) {
    await this.updateCapabilityIfChanged("alarm_smoke", Boolean(value));
  }
}

module.exports = SmokeDevice;
