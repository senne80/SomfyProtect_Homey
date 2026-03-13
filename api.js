"use strict";

module.exports = {
  async getHealth({ homey }) {
    return homey.app.getHealth();
  },

  async getStatus({ homey }) {
    return homey.app.getStatus();
  },

  async getDiscoveredDevices({ homey }) {
    return {
      devices: homey.app.getDiscoveryRegistry(),
    };
  },

  async saveCredentials({ homey, body }) {
    return homey.app.saveCredentials({
      username: body.username,
      password: body.password,
      pollInterval: body.pollInterval,
      enabled: body.enabled,
    });
  },

  async clearCredentials({ homey }) {
    return homey.app.clearCredentials();
  },

  async setEnabled({ homey, body }) {
    return homey.app.setEnabled(body.enabled);
  },

  async syncNow({ homey }) {
    await homey.app.syncOnce();
    return homey.app.getStatus();
  },

  async setSiteState({ homey, params, body }) {
    return homey.app.setSiteSecurityLevel(params.id, body.state);
  },
};