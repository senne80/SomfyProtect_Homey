"use strict";

const SomfyProtectBaseDevice = require("../../lib/SomfyProtectBaseDevice");

class SiteAlarmDevice extends SomfyProtectBaseDevice {
  async onInit() {
    await super.onInit();

    this.registerCapabilityListener("homealarm_state", async value => {
      await this.homey.app.setSiteSecurityLevel(this.getData().id, value);
    });

    this.log(`Site alarm ready: ${this.getName()}`);
  }

  async applyExternalUpdate(statePatch) {
    await super.applyExternalUpdate(statePatch);

    if (typeof statePatch.homealarm_state !== "undefined") {
      await this.updateHomeAlarmState(statePatch.homealarm_state);
    }

    if (typeof statePatch.alarm_generic !== "undefined") {
      await this.updateAlarmGenericState(statePatch.alarm_generic);
    }
  }

  async updateHomeAlarmState(value) {
    await this.updateCapabilityIfChanged("homealarm_state", String(value));
  }

  async updateAlarmGenericState(value) {
    await this.updateCapabilityIfChanged("alarm_generic", Boolean(value));
  }
}

module.exports = SiteAlarmDevice;
