"use strict";

const SomfyProtectBaseDevice = require("../../lib/SomfyProtectBaseDevice");

class SirenDevice extends SomfyProtectBaseDevice {
  async onInit() {
    await super.onInit();
    this.log(`Siren ready: ${this.getName()}`);
  }

  async applyExternalUpdate(statePatch) {
    await super.applyExternalUpdate(statePatch);

    if (typeof statePatch.alarm_generic !== "undefined") {
      await this.updateAlarmState(statePatch.alarm_generic);
    }

    if (typeof statePatch.onoff !== "undefined") {
      await this.updateOnOffState(statePatch.onoff);
    }
  }

  async updateAlarmState(value) {
    await this.updateCapabilityIfChanged("alarm_generic", Boolean(value));
  }

  async updateOnOffState(value) {
    await this.updateCapabilityIfChanged("onoff", Boolean(value));
  }
}

module.exports = SirenDevice;