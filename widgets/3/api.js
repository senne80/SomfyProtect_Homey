'use strict';

module.exports = {
  async getCameras({ homey }) {
    return homey.app.getCameraWidgetOverview();
  },

  async syncNow({ homey }) {
    await homey.app.syncOnce();
    return homey.app.getCameraWidgetOverview();
  },
};
