"use strict";

const { Buffer } = require("node:buffer");
const https = require("node:https");
const Homey = require("homey");

const DISCOVERY_REGISTRY_KEY = "somfy.discovery.registry";
const TOKEN_KEY = "somfy.token";
const LAST_SYNC_KEY = "somfy.last_sync";
const USERNAME_KEY = "somfy_username";
const PASSWORD_KEY = "somfy_password";
const POLL_INTERVAL_KEY = "somfy_poll_interval";
const ENABLED_KEY = "somfy_enabled";

const SOMFY_BASE_URL = "https://api.myfox.io";
const SOMFY_TOKEN_URL = "https://sso.myfox.io/oauth/oauth/v2/token";

const SOMFY_CLIENT_ID = Buffer.from(
  "ODRlZGRmNDgtMmI4ZS0xMWU1LWIyYTUtMTI0Y2ZhYjI1NTk1XzQ3NWJ1cXJmOHY4a2d3b280Z293MDhna2tjMGNrODA0ODh3bzQ0czhvNDhzZzg0azQw",
  "base64"
).toString("utf-8");

const SOMFY_CLIENT_SECRET = Buffer.from(
  "NGRzcWZudGlldTB3Y2t3d280MGt3ODQ4Z3c0bzBjOGs0b3djODBrNGdvMGNzMGs4NDQ=",
  "base64"
).toString("utf-8");

const DEVICE_TYPE_MAP = {
  site_alarm: {
    driverId: "site_alarm",
    capabilities: ["homealarm_state", "alarm_generic"],
  },
  intellitag: {
    driverId: "intellitag",
    capabilities: ["alarm_contact", "alarm_tamper", "measure_battery"],
  },
  motion: {
    driverId: "motion",
    capabilities: ["alarm_motion", "measure_battery"],
  },
  siren: {
    driverId: "siren",
    capabilities: ["alarm_generic", "onoff"],
  },
};

class SomfyProtectApp extends Homey.App {
  async onInit() {
    this.devicesByExternalId = new Map();
    this.latestStateByExternalId = new Map();
    this.pollIntervalId = null;
    this.syncInProgress = false;
    this._savingCredentials = false;

    if (!this.homey.settings.get(DISCOVERY_REGISTRY_KEY)) {
      this.homey.settings.set(DISCOVERY_REGISTRY_KEY, {});
    }

    if (typeof this.homey.settings.get(POLL_INTERVAL_KEY) === "undefined") {
      this.homey.settings.set(POLL_INTERVAL_KEY, 5);
    }
    if (typeof this.homey.settings.get(ENABLED_KEY) === "undefined") {
      this.homey.settings.set(ENABLED_KEY, false);
    }

    this.homey.settings.on("set", async key => {
      // Skip while saveCredentials is atomically writing multiple keys
      if (this._savingCredentials) return;

      if (![USERNAME_KEY, PASSWORD_KEY, POLL_INTERVAL_KEY, ENABLED_KEY].includes(key)) {
        return;
      }

      try {
        const settings = this.getSettings();
        if (settings.enabled && settings.username && settings.password) {
          await this.startPolling();
        } else {
          this.stopPolling();
        }
      } catch (error) {
        this.error("Failed to apply updated app settings", error);
      }
    });

    await this.startIfConfigured();
    this.log("Somfy Protect Integration ready");
  }

  onUninit() {
    this.stopPolling();
  }

  getSettings() {
    return {
      username: this.homey.settings.get(USERNAME_KEY) || "",
      password: this.homey.settings.get(PASSWORD_KEY) || "",
      pollInterval: Math.max(5, Number(this.homey.settings.get(POLL_INTERVAL_KEY) || 5)),
      enabled: Boolean(this.homey.settings.get(ENABLED_KEY)),
    };
  }

  setSettings(nextSettings) {
    this.homey.settings.set(USERNAME_KEY, nextSettings.username || "");
    this.homey.settings.set(PASSWORD_KEY, nextSettings.password || "");
    this.homey.settings.set(POLL_INTERVAL_KEY, Math.max(5, Number(nextSettings.pollInterval || 5)));
    this.homey.settings.set(ENABLED_KEY, Boolean(nextSettings.enabled));
  }

  getToken() {
    return this.homey.settings.get(TOKEN_KEY) || null;
  }

  setToken(token) {
    this.homey.settings.set(TOKEN_KEY, token);
  }

  clearToken() {
    this.homey.settings.unset(TOKEN_KEY);
  }

  getLastSync() {
    return this.homey.settings.get(LAST_SYNC_KEY) || null;
  }

  setLastSync(payload) {
    this.homey.settings.set(LAST_SYNC_KEY, payload);
  }

  getStatus() {
    const settings = this.getSettings();
    const token = this.getToken();

    return {
      ok: true,
      appId: this.manifest.id,
      enabled: Boolean(settings.enabled),
      pollInterval: Number(settings.pollInterval || 5),
      hasCredentials: Boolean(settings.username && settings.password),
      username: settings.username || "",
      hasToken: Boolean(token && token.access_token),
      discoveredDevices: Object.keys(this.getDiscoveryRegistry()).length,
      registeredDevices: this.devicesByExternalId.size,
      running: Boolean(this.pollIntervalId),
      lastSync: this.getLastSync(),
    };
  }

  async saveCredentials({ username, password, pollInterval, enabled, token = null }) {
    if (!username || !password) {
      throw new Error("Somfy username and password are required");
    }

    const nextSettings = {
      username: String(username).trim(),
      password: String(password),
      pollInterval: Math.max(5, Number(pollInterval || 5)),
      enabled: Boolean(enabled),
    };

    this._savingCredentials = true;
    try {
      this.setSettings(nextSettings);
    } finally {
      this._savingCredentials = false;
    }

    if (token && token.access_token) {
      this.setToken(token);
    } else {
      this.clearToken();
    }

    if (nextSettings.enabled) {
      await this.startPolling();
    } else {
      this.stopPolling();
    }

    return this.getStatus();
  }

  async testCredentials(username, password) {
    const result = await this.validateCredentials(String(username || "").trim(), String(password || ""));
    return Boolean(result && result.ok);
  }

  parseSomfyErrorCode(error) {
    const message = String((error && error.message) || "");
    const responseBody = String((error && error.responseBody) || "");

    let parsedBody = null;
    if (responseBody) {
      try {
        parsedBody = JSON.parse(responseBody);
      } catch (parseError) {
        parsedBody = null;
      }
    }

    const tokens = [
      message,
      responseBody,
      String((parsedBody && parsedBody.error) || ""),
      String((parsedBody && parsedBody.message) || ""),
    ].join(" ").toLowerCase();

    if (tokens.includes("invalid_grant")) {
      return "invalid_grant";
    }
    if (tokens.includes("invalid_client")) {
      return "invalid_client";
    }
    if (tokens.includes("error.unauthorized")) {
      return "error.unauthorized";
    }

    if (tokens.includes("unauthorized")) {
      return "error.unauthorized";
    }

    return "unknown";
  }

  summarizeSomfyError(error) {
    const statusCode = Number((error && error.statusCode) || 0);
    const responseBody = String((error && error.responseBody) || "");
    const retryAfter = String(((error && error.responseHeaders && error.responseHeaders["retry-after"]) || "")).trim();
    const message = String((error && error.message) || "Unknown error");

    if (responseBody) {
      try {
        const json = JSON.parse(responseBody);
        const details = [json.error, json.message, json.uid, retryAfter ? `retry_after=${retryAfter}s` : ""].filter(Boolean).join(" | ");
        if (details) {
          return statusCode ? `HTTP ${statusCode}: ${details}` : details;
        }
      } catch (parseError) {
        // Fall through to raw body summary.
      }

      const compactBody = responseBody.replace(/\s+/g, " ").trim().slice(0, 240);
      return statusCode ? `HTTP ${statusCode}: ${compactBody}` : compactBody;
    }

    return statusCode ? `HTTP ${statusCode}: ${message}` : message;
  }

  async validateCredentials(username, password) {
    const validateSiteAccessWithToken = async accessToken => this.httpJsonRequest("GET", `${SOMFY_BASE_URL}/v3/site`, {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Somfy Protect Homey App",
      Accept: "application/json",
    });

    const settings = this.getSettings();
    const currentToken = this.getToken();
    const sameUserAsStored = settings.username && settings.username === username;

    if (sameUserAsStored && currentToken && currentToken.access_token) {
      const stillValid = Number(currentToken.expires_at || 0) > Date.now() + 60_000;
      if (stillValid) {
        try {
          await validateSiteAccessWithToken(currentToken.access_token);
          return {
            ok: true,
            token: currentToken,
          };
        } catch (error) {
          if (Number((error && error.statusCode) || 0) === 401) {
            this.clearToken();
          }
        }
      }
    }

    if (sameUserAsStored && currentToken && currentToken.refresh_token) {
      try {
        const refreshedToken = await this.requestToken({
          grant_type: "refresh_token",
          refresh_token: currentToken.refresh_token,
        });
        await validateSiteAccessWithToken(refreshedToken.access_token);
        return {
          ok: true,
          token: refreshedToken,
        };
      } catch (refreshError) {
        this.log("validateCredentials refresh attempt failed:", refreshError.message);
      }
    }

    try {
      const token = await this.requestToken({
        grant_type: "password",
        username,
        password,
      });

      if (!token || !token.access_token) {
        return {
          ok: false,
          error: "Somfy login failed: no access token returned",
        };
      }

      const validateSiteAccess = async () => validateSiteAccessWithToken(token.access_token);

      try {
        await validateSiteAccess();
      } catch (siteError) {
        const statusCode = Number((siteError && siteError.statusCode) || 0);
        if (statusCode >= 500 || statusCode === 429 || String((siteError && siteError.message) || "").toLowerCase().includes("timeout")) {
          await this.homey.setTimeout(() => {}, 750);
          await validateSiteAccess();
        } else {
          throw siteError;
        }
      }

      return {
        ok: true,
        token,
      };
    } catch (error) {
      const code = this.parseSomfyErrorCode(error);
      this.error("validateCredentials failed:", error.message);

      if (code === "invalid_grant") {
        return {
          ok: false,
          error: "Somfy rejected username/password (invalid_grant)",
        };
      }

      if (code === "invalid_client") {
        return {
          ok: false,
          error: "Somfy OAuth client rejected (invalid_client)",
        };
      }

      if (code === "error.unauthorized") {
        return {
          ok: false,
          error: "Somfy API unauthorized for this account",
        };
      }

      if (String((error && error.message) || "").toLowerCase().includes("timeout")) {
        return {
          ok: false,
          error: "Somfy login timed out, please try again",
        };
      }

      return {
        ok: false,
        error: `Somfy login failed: ${this.summarizeSomfyError(error)}`,
      };
    }
  }

  async startIfConfigured() {
    const settings = this.getSettings();
    if (!settings.enabled) {
      return;
    }

    if (!settings.username || !settings.password) {
      this.error("Somfy sync is enabled but credentials are missing");
      return;
    }

    await this.startPolling();
  }

  async startPolling() {
    this.stopPolling();

    const settings = this.getSettings();
    const pollInterval = Math.max(5, Number(settings.pollInterval || 5));

    await this.syncOnce();

    this.pollIntervalId = this.homey.setInterval(async () => {
      try {
        await this.syncOnce();
      } catch (error) {
        this.error("Somfy sync cycle failed", error);
      }
    }, pollInterval * 1000);
  }

  stopPolling() {
    if (this.pollIntervalId) {
      this.homey.clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  async syncOnce() {
    if (this.syncInProgress) {
      return;
    }

    this.syncInProgress = true;

    try {
      const sites = await this.getSites();
      const registry = {
        ...this.getDiscoveryRegistry(),
      };

      for (const site of sites) {
        const siteId = site.site_id || site.id;
        if (!siteId) {
          this.error("Skipping site without valid id", site);
          continue;
        }

        const mappedSite = this.mapSite(site);
        registry[mappedSite.discovery.externalId] = {
          ...registry[mappedSite.discovery.externalId],
          ...mappedSite.discovery,
          updatedAt: new Date().toISOString(),
        };
        await this.updateDeviceState(mappedSite.discovery.externalId, mappedSite.state);

        const devices = await this.getDevices(siteId);

        for (const device of devices) {
          const mapped = this.mapSomfyDevice(site, device);
          if (!mapped) {
            continue;
          }

          registry[mapped.discovery.externalId] = {
            ...registry[mapped.discovery.externalId],
            ...mapped.discovery,
            updatedAt: new Date().toISOString(),
          };

          await this.updateDeviceState(mapped.discovery.externalId, mapped.state);
        }
      }

      this.setDiscoveryRegistry(registry);
      this.setLastSync({
        success: true,
        at: new Date().toISOString(),
        discoveredDevices: Object.keys(registry).length,
      });
    } catch (error) {
      this.setLastSync({
        success: false,
        at: new Date().toISOString(),
        error: error.message,
      });
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  async getSites() {
    return this.apiGet("/v3/site").then(response => response.items || []);
  }

  async getDevices(siteId) {
    return this.apiGet(`/v3/site/${siteId}/device`).then(response => response.items || []);
  }

  async apiGet(path) {
    return this.apiRequest("GET", path);
  }

  async apiPut(path, payload) {
    return this.apiRequest("PUT", path, payload);
  }

  async apiRequest(method, path, payload = null) {
    const runRequest = async () => {
      const token = await this.ensureAccessToken();
      const headers = {
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "Somfy Protect Homey App",
        Accept: "application/json",
      };

      let body = null;
      if (payload !== null) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(payload);
      }

      return this.httpJsonRequest(method, `${SOMFY_BASE_URL}${path}`, headers, body);
    };

    try {
      return await runRequest();
    } catch (error) {
      if (error && error.statusCode === 401) {
        this.log(`Somfy API returned 401 for ${method} ${path}, clearing token and retrying once`);
        this.clearToken();
        return runRequest();
      }

      throw error;
    }
  }

  async ensureAccessToken() {
    const currentToken = this.getToken();
    if (currentToken && currentToken.access_token && Number(currentToken.expires_at || 0) > Date.now() + 60_000) {
      return currentToken;
    }

    if (currentToken && currentToken.refresh_token) {
      try {
        const refreshedToken = await this.requestToken({
          grant_type: "refresh_token",
          refresh_token: currentToken.refresh_token,
        });
        this.setToken(refreshedToken);
        return refreshedToken;
      } catch (error) {
        this.error("Somfy token refresh failed, requesting a new token", error.message);
      }
    }

    const settings = this.getSettings();
    if (!settings.username || !settings.password) {
      throw new Error("Somfy credentials are not configured");
    }

    const freshToken = await this.requestToken({
      grant_type: "password",
      username: settings.username,
      password: settings.password,
    });

    this.setToken(freshToken);
    return freshToken;
  }

  async requestToken(data) {
    const payload = {
      client_id: SOMFY_CLIENT_ID,
      client_secret: SOMFY_CLIENT_SECRET,
      ...data,
    };

    const body = new URLSearchParams(payload).toString();

    const response = await this.httpRawRequest("POST", SOMFY_TOKEN_URL, {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
      "User-Agent": "Somfy Protect Homey App",
      Accept: "application/json",
    }, body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const error = new Error(`Somfy OAuth failed (${response.statusCode}): ${response.body}`);
      error.statusCode = response.statusCode;
      error.responseBody = response.body;
      error.responseHeaders = response.headers;
      throw error;
    }

    const json = JSON.parse(response.body || "{}");

    const accessToken = json.access_token || json.accessToken || "";
    const refreshToken = json.refresh_token || json.refreshToken || "";
    const expiresIn = Number(json.expires_in ?? json.expiresIn ?? 0);

    let expiresAt = 0;
    const rawExpiresAt = json.expires_at ?? json.expiresAt;
    if (typeof rawExpiresAt === "number" && Number.isFinite(rawExpiresAt)) {
      expiresAt = rawExpiresAt > 1_000_000_000_000 ? rawExpiresAt : rawExpiresAt * 1000;
    } else if (typeof rawExpiresAt === "string" && rawExpiresAt.trim()) {
      const asNumber = Number(rawExpiresAt);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        expiresAt = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
      } else {
        const asDate = Date.parse(rawExpiresAt);
        if (!Number.isNaN(asDate)) {
          expiresAt = asDate;
        }
      }
    }

    if (!expiresAt && expiresIn > 0) {
      expiresAt = Date.now() + expiresIn * 1000;
    }

    // Avoid immediate re-auth loops when the server omits expiry fields.
    if (!expiresAt) {
      expiresAt = Date.now() + 55 * 60 * 1000;
    }

    return {
      ...json,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      expires_at: expiresAt,
    };
  }

  async httpJsonRequest(method, url, headers = {}, body = null) {
    const response = await this.httpRawRequest(method, url, headers, body);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const error = new Error(`Somfy API error (${response.statusCode}) for ${method} ${url}: ${response.body}`);
      error.statusCode = response.statusCode;
      error.responseBody = response.body;
      error.responseHeaders = response.headers;
      throw error;
    }

    return JSON.parse(response.body || "{}");
  }

  async httpRawRequest(method, url, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options = {
        method,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
      };

      const req = https.request(options, res => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          responseBody += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: responseBody,
            headers: res.headers || {},
          });
        });
      });

      req.on("error", reject);
      req.setTimeout(15_000, () => {
        req.destroy(new Error("HTTP request timeout"));
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }

  detectDeviceType(device) {
    // Somfy returns the canonical device type at the top-level `type` field,
    // e.g. "INTELLITAG", "PIR", "SIREN". Also check nested definition fields
    // and the user-supplied label as a last resort.
    const labels = [
      String(device.type || ""),
      String(device.label || ""),
      String((device.device_definition && device.device_definition.type) || ""),
      String((device.device_definition && device.device_definition.label) || ""),
      String(device.device_definition_id || ""),
    ].join(" ").toLowerCase();

    if (labels.includes("intellitag")) {
      return "intellitag";
    }

    if (
      labels.includes("pir") ||
      labels.includes("infrared") ||
      labels.includes("motion") ||
      labels.includes("detector")
    ) {
      return "motion";
    }

    if (labels.includes("siren") || labels.includes("alarm")) {
      return "siren";
    }

    this.log(`[detectDeviceType] Unrecognised device — type: "${device.type || ""}", label: "${device.label || ""}", definition_type: "${(device.device_definition && device.device_definition.type) || ""}", definition_label: "${(device.device_definition && device.device_definition.label) || ""}", definition_id: "${device.device_definition_id || ""}"`);
    return null;
  }

  mapSomfyDevice(site, device) {
    const type = this.detectDeviceType(device);
    if (!type) {
      return null;
    }

    const config = DEVICE_TYPE_MAP[type];
    const externalId = `${site.site_id || site.id}:${device.device_id || device.id}`;

    return {
      discovery: {
        externalId,
        name: `${site.label || "Site"} ${device.label || "Device"}`,
        siteId: site.site_id || site.id,
        siteLabel: site.label || "",
        somfyDeviceId: device.device_id || device.id,
        driverId: config.driverId,
        deviceType: type,
        capabilities: config.capabilities,
      },
      state: this.buildState(type, device),
    };
  }

  mapSite(site) {
    const siteId = site.site_id || site.id;
    const homeAlarmState = this.toHomeySecurityState(site.security_level || "disarmed");
    const isArmed = homeAlarmState !== "disarmed";

    return {
      discovery: {
        externalId: `site:${siteId}`,
        name: `${site.label || "Site"} Alarm`,
        siteId,
        siteLabel: site.label || "",
        somfyDeviceId: siteId,
        driverId: DEVICE_TYPE_MAP.site_alarm.driverId,
        deviceType: "site_alarm",
        capabilities: DEVICE_TYPE_MAP.site_alarm.capabilities,
      },
      state: {
        homealarm_state: homeAlarmState,
        alarm_generic: isArmed,
      },
    };
  }

  buildState(type, device) {
    const lookup = {
      ...this.flatten(device.status || {}),
      ...this.flatten(device.diagnosis || {}),
      ...this.flatten(device.settings || {}),
      ...this.flatten(device.device_definition || {}),
    };

    const state = {};

    const batteryLevel = this.coercePercentage(this.pick(lookup, [
      "battery_level",
      "battery_percent",
      "battery_percentage",
      "rlink_quality_percent",
    ]));

    if (batteryLevel !== null) {
      state.measure_battery = batteryLevel;
    }

    if (type === "intellitag") {
      const contact = this.coerceBool(this.pick(lookup, ["open", "opened", "door_open", "open_detected", "is_open"]));
      const tamper = this.coerceBool(this.pick(lookup, ["tamper", "tamper_detected", "device_tamper", "cover_removed"]));

      if (contact !== null) {
        state.alarm_contact = contact;
      }
      if (tamper !== null) {
        state.alarm_tamper = tamper;
      }
    }

    if (type === "motion") {
      const motion = this.coerceBool(this.pick(lookup, ["motion", "motion_detected", "presence", "pir_detected", "human_detected"]));
      if (motion !== null) {
        state.alarm_motion = motion;
      }
    }

    if (type === "siren") {
      const siren = this.coerceBool(this.pick(lookup, ["alarm", "alarm_triggered", "sounding", "active", "ringing"]));
      if (siren !== null) {
        state.alarm_generic = siren;
        state.onoff = siren;
      }
    }

    return state;
  }

  getDiscoveryRegistry() {
    return this.homey.settings.get(DISCOVERY_REGISTRY_KEY) || {};
  }

  setDiscoveryRegistry(registry) {
    this.homey.settings.set(DISCOVERY_REGISTRY_KEY, registry);
  }

  getPairableDevices(driverId) {
    const registry = this.getDiscoveryRegistry();

    return Object.values(registry)
      .filter(entry => entry.driverId === driverId)
      .map(entry => ({
        name: entry.name,
        data: {
          id: entry.externalId,
        },
        store: {
          externalId: entry.externalId,
          siteId: entry.siteId,
          siteLabel: entry.siteLabel,
          somfyDeviceId: entry.somfyDeviceId,
          driverId: entry.driverId,
          deviceType: entry.deviceType,
        },
      }));
  }

  async syncDiscovery(payload) {
    const devices = Array.isArray(payload.devices) ? payload.devices : [];
    const registry = {
      ...this.getDiscoveryRegistry(),
    };

    for (const device of devices) {
      if (!device.externalId || !device.driverId || !device.name) {
        continue;
      }

      registry[device.externalId] = {
        ...registry[device.externalId],
        ...device,
        updatedAt: new Date().toISOString(),
      };
    }

    this.setDiscoveryRegistry(registry);

    return {
      count: Object.keys(registry).length,
    };
  }

  registerDevice(device) {
    const externalId = device.getStoreValue("externalId") || device.getData().id;
    this.devicesByExternalId.set(externalId, device);

    const cachedState = this.latestStateByExternalId.get(externalId);
    if (cachedState) {
      setImmediate(async () => {
        try {
          await device.applyExternalUpdate(cachedState);
        } catch (error) {
          this.error(`Failed to replay cached state for ${externalId}`, error);
        }
      });
    }
  }

  unregisterDevice(device) {
    const externalId = device.getStoreValue("externalId") || device.getData().id;
    this.devicesByExternalId.delete(externalId);
  }

  async updateDeviceState(externalId, statePatch) {
    const nextState = {
      ...(this.latestStateByExternalId.get(externalId) || {}),
      ...statePatch,
      updatedAt: new Date().toISOString(),
    };

    this.latestStateByExternalId.set(externalId, nextState);

    const device = this.devicesByExternalId.get(externalId);
    if (!device) {
      return {
        accepted: true,
        delivered: false,
      };
    }

    await device.applyExternalUpdate(nextState);

    return {
      accepted: true,
      delivered: true,
    };
  }

  getHealth() {
    return this.getStatus();
  }

  getWidgetOverview() {
    const status = this.getStatus();
    const registry = this.getDiscoveryRegistry();

    const sites = Object.values(registry)
      .filter(entry => entry && entry.deviceType === "site_alarm")
      .map(entry => {
        const state = this.latestStateByExternalId.get(entry.externalId) || {};

        return {
          externalId: entry.externalId,
          siteId: entry.siteId,
          siteLabel: entry.siteLabel || entry.name || "Site",
          state: String(state.homealarm_state || "disarmed"),
          isArmed: String(state.homealarm_state || "disarmed") !== "disarmed",
          updatedAt: state.updatedAt || entry.updatedAt || null,
        };
      })
      .sort((a, b) => String(a.siteLabel).localeCompare(String(b.siteLabel)));

    return {
      ok: true,
      status: {
        enabled: Boolean(status.enabled),
        running: Boolean(status.running),
        hasCredentials: Boolean(status.hasCredentials),
        discoveredDevices: Number(status.discoveredDevices || 0),
        username: status.username || "",
        lastSync: status.lastSync || null,
      },
      sites,
      now: new Date().toISOString(),
    };
  }

  flatten(payload, prefix = "") {
    const out = {};

    if (Array.isArray(payload)) {
      payload.forEach((value, index) => {
        const key = prefix ? `${prefix}.${index}` : String(index);
        out[key] = value;
        if (typeof value === "object" && value !== null) {
          Object.assign(out, this.flatten(value, key));
        }
      });
      return out;
    }

    if (typeof payload === "object" && payload !== null) {
      Object.entries(payload).forEach(([rawKey, value]) => {
        const keyPart = String(rawKey).toLowerCase();
        const key = prefix ? `${prefix}.${keyPart}` : keyPart;
        out[key] = value;
        if (typeof value === "object" && value !== null) {
          Object.assign(out, this.flatten(value, key));
        }
      });
    }

    return out;
  }

  pick(lookup, keys) {
    for (const key of keys) {
      const normalized = key.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(lookup, normalized)) {
        return lookup[normalized];
      }
    }

    for (const key of keys) {
      const suffix = `.${key.toLowerCase()}`;
      const found = Object.keys(lookup).find(lookupKey => lookupKey.endsWith(suffix));
      if (found) {
        return lookup[found];
      }
    }

    return null;
  }

  coerceBool(value) {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return Boolean(value);
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "on", "open", "opened", "active", "detected", "alarm"].includes(normalized)) {
        return true;
      }
      if (["0", "false", "off", "closed", "idle", "clear", "normal", "standby"].includes(normalized)) {
        return false;
      }
    }

    return null;
  }

  coercePercentage(value) {
    if (value === null || typeof value === "undefined") {
      return null;
    }

    const num = Number(value);
    if (Number.isNaN(num)) {
      return null;
    }

    const scaled = num <= 1 ? num * 100 : num;
    return Math.max(0, Math.min(100, Math.round(scaled)));
  }

  toHomeySecurityState(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized === "armed") {
      return "armed";
    }
    if (normalized === "partial" || normalized === "partially_armed") {
      return "partially_armed";
    }
    return "disarmed";
  }

  toSomfySecurityState(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized === "armed") {
      return "armed";
    }
    if (normalized === "partially_armed" || normalized === "partial") {
      return "partial";
    }
    return "disarmed";
  }

  async setSiteSecurityLevel(externalId, state) {
    if (!externalId) {
      throw new Error("Invalid site external id");
    }

    const siteId = String(externalId).startsWith("site:")
      ? String(externalId).replace("site:", "")
      : String(externalId);
    const siteExternalId = `site:${siteId}`;
    const securityState = this.toSomfySecurityState(state);
    await this.apiPut(`/v3/site/${siteId}/security`, { status: securityState });

    await this.updateDeviceState(siteExternalId, {
      homealarm_state: this.toHomeySecurityState(securityState),
      alarm_generic: securityState !== "disarmed",
    });

    return {
      ok: true,
      siteId,
      state: this.toHomeySecurityState(securityState),
    };
  }

  async clearCredentials() {
    this.stopPolling();
    this.setSettings({
      username: "",
      password: "",
      pollInterval: 5,
      enabled: false,
    });
    this.clearToken();

    return this.getStatus();
  }

  async setEnabled(enabled) {
    const settings = this.getSettings();
    const next = {
      ...settings,
      enabled: Boolean(enabled),
    };
    this.setSettings(next);

    if (next.enabled) {
      await this.startPolling();
    } else {
      this.stopPolling();
    }

    return this.getStatus();
  }
}

module.exports = SomfyProtectApp;