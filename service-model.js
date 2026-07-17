'use strict';

/**
 * Pure multi-service model (Messenger + Discord).
 * No Electron dependency — unit-testable from Node.
 */

const SERVICE_MESSENGER = 'messenger';
const SERVICE_DISCORD = 'discord';

const MESSENGER_URL = 'https://www.facebook.com/messages';
const DISCORD_URL = 'https://discord.com/app';

const MESSENGER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.156 Safari/537.36';
const DISCORD_USER_AGENT = MESSENGER_USER_AGENT;

/** Discord product hosts (navigation / in-app). Subdomains via endsWith. */
const DISCORD_APP_HOSTS = [
  'discord.com',
  'discordapp.com',
  'discordapp.net',
  'discord.gg',
  'discord.media',
  'discord.co',
  'discordstatus.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'gateway.discord.gg',
  'status.discord.com',
  'latency.discord.media',
];

/** Captcha / challenge hosts during Discord login. */
const DISCORD_AUX_HOSTS = [
  'hcaptcha.com',
  'newassets.hcaptcha.com',
  'recaptcha.net',
  'gstatic.com',
];

function normalizeService(service) {
  return service === SERVICE_DISCORD ? SERVICE_DISCORD : SERVICE_MESSENGER;
}

function getOtherService(service) {
  return normalizeService(service) === SERVICE_DISCORD ? SERVICE_MESSENGER : SERVICE_DISCORD;
}

function getServiceHomeUrl(service) {
  return normalizeService(service) === SERVICE_DISCORD ? DISCORD_URL : MESSENGER_URL;
}

function getServiceUserAgent(service) {
  return normalizeService(service) === SERVICE_DISCORD ? DISCORD_USER_AGENT : MESSENGER_USER_AGENT;
}

function hostMatchesAllowlist(hostname, allowlist) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function isDiscordHost(hostname = '') {
  return hostMatchesAllowlist(hostname, DISCORD_APP_HOSTS);
}

function isDiscordAuxHost(hostname = '') {
  return hostMatchesAllowlist(hostname, DISCORD_AUX_HOSTS);
}

function buildPartitionName(id, service) {
  const sid = String(id || '');
  const svc = normalizeService(service);
  return svc === SERVICE_DISCORD ? `persist:discord_${sid}` : `persist:nick_${sid}`;
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const id = profile.id != null ? String(profile.id) : '';
  if (!id) return null;
  const service = normalizeService(profile.service);
  const partition = profile.partition || buildPartitionName(id, service);
  return {
    ...profile,
    id,
    name: profile.name || (service === SERVICE_DISCORD ? 'Discord' : 'Nick'),
    service,
    partition,
    avatar: profile.avatar || null,
  };
}

function migrateProfiles(list) {
  if (!Array.isArray(list)) return { profiles: [], changed: true };
  let changed = false;
  const profiles = list
    .map((raw) => {
      const beforeService = raw && raw.service;
      const beforePartition = raw && raw.partition;
      const next = normalizeProfile(raw);
      if (!next) {
        changed = true;
        return null;
      }
      if (!beforeService || beforeService !== next.service || !beforePartition) changed = true;
      return next;
    })
    .filter(Boolean);
  return { profiles, changed };
}

function normalizeLastProfileByService(raw = {}) {
  const last = raw && typeof raw === 'object' ? raw : {};
  return {
    messenger: last.messenger != null ? String(last.messenger) : null,
    discord: last.discord != null ? String(last.discord) : null,
  };
}

/**
 * Merge multi-service fields into settings object.
 * @param {object} raw
 * @param {object} [base] existing defaults already merged
 */
function applyMultiServiceSettings(raw = {}, base = {}) {
  const exclusiveDefault = base.exclusiveService !== undefined ? !!base.exclusiveService : true;
  return {
    ...base,
    ...raw,
    activeService: normalizeService(raw.activeService ?? base.activeService ?? SERVICE_MESSENGER),
    exclusiveService: raw.exclusiveService !== undefined
      ? !!raw.exclusiveService
      : exclusiveDefault,
    lastProfileByService: normalizeLastProfileByService(
      raw.lastProfileByService ?? base.lastProfileByService
    ),
  };
}

function profilesForService(profiles, service) {
  const svc = normalizeService(service);
  if (!Array.isArray(profiles)) return [];
  return profiles.filter((p) => p && normalizeService(p.service) === svc);
}

function pickProfileIdForService(profiles, service, lastProfileByService = {}) {
  const list = profilesForService(profiles, service);
  if (list.length === 0) return null;
  const preferred = lastProfileByService[normalizeService(service)];
  if (preferred && list.some((p) => p.id === preferred)) return preferred;
  return list[0].id;
}

module.exports = {
  SERVICE_MESSENGER,
  SERVICE_DISCORD,
  MESSENGER_URL,
  DISCORD_URL,
  MESSENGER_USER_AGENT,
  DISCORD_USER_AGENT,
  DISCORD_APP_HOSTS,
  DISCORD_AUX_HOSTS,
  normalizeService,
  getOtherService,
  getServiceHomeUrl,
  getServiceUserAgent,
  hostMatchesAllowlist,
  isDiscordHost,
  isDiscordAuxHost,
  buildPartitionName,
  normalizeProfile,
  migrateProfiles,
  normalizeLastProfileByService,
  applyMultiServiceSettings,
  profilesForService,
  pickProfileIdForService,
};
