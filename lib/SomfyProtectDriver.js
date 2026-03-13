"use strict";

const Homey = require("homey");

class SomfyProtectDriver extends Homey.Driver {
  async onPair(session) {
    let validatedUsername = "";
    let validatedPassword = "";
    let validatedToken = null;

    session.setHandler("login", async data => {
      const username = String((data && data.username) || "").trim();
      const password = String((data && data.password) || "");

      if (!username || !password) {
        throw new Error("Username and password are required");
      }

      // Validate against Somfy and surface a useful error message when possible.
      const result = await this.homey.app.validateCredentials(username, password);
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "Somfy login failed");
      }

      validatedUsername = username;
      validatedPassword = password;
      validatedToken = result.token || null;
      return true;
    });

    session.setHandler("list_devices", async () => {
      // Save credentials and start polling only after a confirmed successful login
      const currentSettings = this.homey.app.getSettings();
      await this.homey.app.saveCredentials({
        username: validatedUsername,
        password: validatedPassword,
        pollInterval: currentSettings.pollInterval,
        enabled: true,
        token: validatedToken,
      });

      return this.onPairListDevices();
    });
  }

  async onPairListDevices() {
    const existingIds = new Set(this.getDevices().map(device => device.getData().id));

    return this.homey.app
      .getPairableDevices(this.id)
      .filter(device => !existingIds.has(device.data.id));
  }
}

module.exports = SomfyProtectDriver;
