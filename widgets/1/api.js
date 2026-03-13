'use strict';

module.exports = {
  async getOverview({ homey }) {
    return homey.app.getWidgetOverview();
  },

  async syncNow({ homey }) {
    await homey.app.syncOnce();
    return homey.app.getWidgetOverview();
  },

  async setSiteState({ homey, params, body }) {
    const externalId = String((params && params.id) || "");
    const state = String((body && body.state) || "disarmed");

    if (!externalId) {
      throw new Error("Missing site id");
    }

    await homey.app.setSiteSecurityLevel(externalId, state);
    return homey.app.getWidgetOverview();
  },
};
