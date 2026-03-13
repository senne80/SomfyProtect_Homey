"use strict";

const SomfyProtectBaseDevice = require("../../lib/SomfyProtectBaseDevice");

class IntelliTagDevice extends SomfyProtectBaseDevice {
  async onInit() {
    await super.onInit();
    this.log(`IntelliTag ready: ${this.getName()}`);
  }

  async applyExternalUpdate(statePatch) {
    await super.applyExternalUpdate(statePatch);

    if (typeof statePatch.alarm_contact !== "undefined") {
      await this.updateContactState(statePatch.alarm_contact);
    }

    if (typeof statePatch.alarm_tamper !== "undefined") {
      await this.updateTamperState(statePatch.alarm_tamper);
    }
  }

  async updateContactState(value) {
    await this.updateCapabilityIfChanged("alarm_contact", Boolean(value));
  }

  async updateTamperState(value) {
    await this.updateCapabilityIfChanged("alarm_tamper", Boolean(value));
  }
}

module.exports = IntelliTagDevice;