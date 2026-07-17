'use strict';

const assert = require('assert');
const {
  SERVICE_MESSENGER,
  SERVICE_DISCORD,
  MESSENGER_URL,
  DISCORD_URL,
  normalizeService,
  getOtherService,
  getServiceHomeUrl,
  buildPartitionName,
  normalizeProfile,
  migrateProfiles,
  isDiscordHost,
  isDiscordAuxHost,
  applyMultiServiceSettings,
  profilesForService,
  pickProfileIdForService,
} = require('../service-model');

function testNormalizeService() {
  assert.strictEqual(normalizeService('discord'), SERVICE_DISCORD);
  assert.strictEqual(normalizeService('messenger'), SERVICE_MESSENGER);
  assert.strictEqual(normalizeService(undefined), SERVICE_MESSENGER);
  assert.strictEqual(normalizeService('nope'), SERVICE_MESSENGER);
  assert.strictEqual(getOtherService('discord'), SERVICE_MESSENGER);
  assert.strictEqual(getOtherService('messenger'), SERVICE_DISCORD);
}

function testUrlsAndPartitions() {
  assert.strictEqual(getServiceHomeUrl('messenger'), MESSENGER_URL);
  assert.strictEqual(getServiceHomeUrl('discord'), DISCORD_URL);
  assert.strictEqual(buildPartitionName('abc', 'messenger'), 'persist:nick_abc');
  assert.strictEqual(buildPartitionName('abc', 'discord'), 'persist:discord_abc');
}

function testMigrateLegacyProfiles() {
  const { profiles, changed } = migrateProfiles([
    { id: '1', name: 'Old', partition: 'persist:nick_1' },
    { id: '2', name: 'D1', service: 'discord', partition: 'persist:discord_2' },
  ]);
  assert.strictEqual(changed, true);
  assert.strictEqual(profiles[0].service, SERVICE_MESSENGER);
  assert.strictEqual(profiles[1].service, SERVICE_DISCORD);
  assert.strictEqual(profiles.length, 2);

  const again = migrateProfiles(profiles);
  assert.strictEqual(again.changed, false);
}

function testNormalizeProfile() {
  const p = normalizeProfile({ id: 9, name: 'X' });
  assert.strictEqual(p.id, '9');
  assert.strictEqual(p.service, SERVICE_MESSENGER);
  assert.strictEqual(p.partition, 'persist:nick_9');
  assert.strictEqual(normalizeProfile(null), null);
  assert.strictEqual(normalizeProfile({}), null);
}

function testHosts() {
  assert.strictEqual(isDiscordHost('discord.com'), true);
  assert.strictEqual(isDiscordHost('canary.discord.com'), true);
  assert.strictEqual(isDiscordHost('cdn.discordapp.com'), true);
  assert.strictEqual(isDiscordHost('evil.com'), false);
  assert.strictEqual(isDiscordHost('google.com'), false);
  assert.strictEqual(isDiscordAuxHost('hcaptcha.com'), true);
  assert.strictEqual(isDiscordAuxHost('newassets.hcaptcha.com'), true);
  assert.strictEqual(isDiscordAuxHost('discord.com'), false);
}

function testSettingsAndPick() {
  const s = applyMultiServiceSettings({}, { exclusiveService: true });
  assert.strictEqual(s.activeService, SERVICE_MESSENGER);
  assert.strictEqual(s.exclusiveService, true);
  assert.deepStrictEqual(s.lastProfileByService, { messenger: null, discord: null });

  const s2 = applyMultiServiceSettings({
    activeService: 'discord',
    exclusiveService: false,
    lastProfileByService: { discord: 'd1', messenger: 'm1' },
  });
  assert.strictEqual(s2.activeService, SERVICE_DISCORD);
  assert.strictEqual(s2.exclusiveService, false);
  assert.strictEqual(s2.lastProfileByService.discord, 'd1');

  const profiles = [
    { id: 'm1', service: 'messenger', partition: 'persist:nick_m1', name: 'M' },
    { id: 'd1', service: 'discord', partition: 'persist:discord_d1', name: 'D' },
    { id: 'd2', service: 'discord', partition: 'persist:discord_d2', name: 'D2' },
  ];
  assert.strictEqual(profilesForService(profiles, 'discord').length, 2);
  assert.strictEqual(
    pickProfileIdForService(profiles, 'discord', { discord: 'd2' }),
    'd2'
  );
  assert.strictEqual(
    pickProfileIdForService(profiles, 'messenger', {}),
    'm1'
  );
}

function main() {
  testNormalizeService();
  testUrlsAndPartitions();
  testMigrateLegacyProfiles();
  testNormalizeProfile();
  testHosts();
  testSettingsAndPick();
  console.log('testServiceModel: all passed');
}

main();
