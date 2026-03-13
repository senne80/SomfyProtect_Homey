"use strict";

const Homey = require("homey");

class SomfyProtectBaseDevice extends Homey.Device {
  async onInit() {
    this.homey.app.registerDevice(this);
  }

  async onDeleted() {
    this.homey.app.unregisterDevice(this);
  }

  async applyExternalUpdate(statePatch) {
    if (typeof statePatch.measure_battery !== "undefined") {
      await this.updateBattery(statePatch.measure_battery);
    }
  }

  async updateBattery(value) {
    return this.updateCapabilityIfChanged("measure_battery", this.normalizeBattery(value));
  }

  async updateCapabilityIfChanged(capabilityId, value) {
    if (!this.hasCapability(capabilityId) || typeof value === "undefined" || value === null) {
      return;
    }

    const currentValue = this.getCapabilityValue(capabilityId);
    if (currentValue === value) {
      return;
    }

    await this.setCapabilityValue(capabilityId, value);
  }

  normalizeBattery(value) {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
      return null;
    }

    return Math.max(0, Math.min(100, Math.round(numericValue)));
  }
}

module.exports = SomfyProtectBaseDevice;