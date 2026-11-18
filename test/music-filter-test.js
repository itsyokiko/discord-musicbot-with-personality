'use strict';

const assert = require('node:assert');
const musicCommands = require('../src/musicCommands');
const musicFilters = require('../src/musicFilters');

console.log('--- Testing Music Audio Filters & Control Panel ---');

// 1. Test Command Parsing
console.log('Checking >fl and natural command parsing...');
const p1 = musicCommands.parseDirectCommand('>fl');
assert.deepStrictEqual(p1, { command: 'filter', args: '', source: 'prefix' });

const p2 = musicCommands.parseDirectCommand('>fl nc');
assert.deepStrictEqual(p2, { command: 'filter', args: 'nc', source: 'prefix' });

const p3 = musicCommands.parseDirectCommand('>filter bassboost');
assert.deepStrictEqual(p3, { command: 'filter', args: 'bassboost', source: 'prefix' });

const p4 = musicCommands.parseDirectCommand('>fx 3d');
assert.deepStrictEqual(p4, { command: 'filter', args: '3d', source: 'prefix' });

const p5 = musicCommands.parseDirectCommand('cal, filter nightcore', { isMentioned: true });
assert.deepStrictEqual(p5, { command: 'filter', args: 'nightcore', source: 'natural' });

// 2. Test Filter Alias Resolution
console.log('Checking filter alias resolution...');
assert.strictEqual(musicFilters.resolveFilterName('nc'), 'nightcore');
assert.strictEqual(musicFilters.resolveFilterName('bb'), 'bassboost');
assert.strictEqual(musicFilters.resolveFilterName('bass'), 'bassboost');
assert.strictEqual(musicFilters.resolveFilterName('vw'), 'vaporwave');
assert.strictEqual(musicFilters.resolveFilterName('slow'), 'vaporwave');
assert.strictEqual(musicFilters.resolveFilterName('3d'), '3d');
assert.strictEqual(musicFilters.resolveFilterName('8d'), '3d');
assert.strictEqual(musicFilters.resolveFilterName('lofi'), 'lofi');
assert.strictEqual(musicFilters.resolveFilterName('lf'), 'lofi');
assert.strictEqual(musicFilters.resolveFilterName('k'), 'karaoke');
assert.strictEqual(musicFilters.resolveFilterName('off'), 'clear');
assert.strictEqual(musicFilters.resolveFilterName('clear'), 'clear');
assert.strictEqual(musicFilters.resolveFilterName('reset'), 'clear');
assert.strictEqual(musicFilters.resolveFilterName('randomxyz'), null);

// 3. Test Panel Payload Generation
console.log('Checking panel payload structure (full vs hidden)...');
const mockQueueActive = {
  songs: [{ name: 'Test Song - Sparkle' }],
  filters: {
    names: ['nightcore', 'bassboost'],
    has: (f) => ['nightcore', 'bassboost'].includes(f),
  }
};

// Full Panel
const fullPayload = musicFilters.buildFilterPanelPayload(mockQueueActive, false);
assert.strictEqual(fullPayload.embeds.length, 1);
assert.ok(fullPayload.embeds[0].data.title.includes('Audio Filter Control Panel'));
assert.strictEqual(fullPayload.components.length, 3, 'Full panel must have 3 rows of buttons');

// Check that Nightcore button in row 1 is ON (ButtonStyle.Success = 3)
const row1Buttons = fullPayload.components[0].components;
const ncBtn = row1Buttons.find(b => b.data.custom_id === 'filter_btn_nightcore');
assert.ok(ncBtn, 'Nightcore button exists');
assert.strictEqual(ncBtn.data.style, 3, 'Nightcore button should be Success (green) when active');
assert.ok(ncBtn.data.label.includes('(ON)'), 'Nightcore button should show (ON)');

// Check that 3D button in row 1 is OFF (ButtonStyle.Secondary = 2)
const tdBtn = row1Buttons.find(b => b.data.custom_id === 'filter_btn_3d');
assert.ok(tdBtn, '3D button exists');
assert.strictEqual(tdBtn.data.style, 2, '3D button should be Secondary (grey) when inactive');

// Hidden Panel
const hiddenPayload = musicFilters.buildFilterPanelPayload(mockQueueActive, true);
assert.strictEqual(hiddenPayload.embeds.length, 1);
assert.ok(hiddenPayload.embeds[0].data.description.includes('Disembunyikan'));
assert.strictEqual(hiddenPayload.components.length, 1, 'Hidden panel has exactly 1 row');
assert.strictEqual(hiddenPayload.components[0].components.length, 1, 'Hidden panel has 1 button');
assert.strictEqual(hiddenPayload.components[0].components[0].data.custom_id, 'filter_btn_show');

// 4. Test Player Integration & safeGetQueue export
console.log('Checking Player & Filter integration...');
const musicPlayer = require('../src/musicPlayer');
assert.strictEqual(typeof musicPlayer.safeGetQueue, 'function', 'safeGetQueue must be exported');
assert.strictEqual(typeof musicPlayer.toggleFilterView, 'function', 'toggleFilterView must be exported');
assert.strictEqual(typeof musicPlayer.hasActivePlayer, 'function', 'hasActivePlayer must be exported');
assert.strictEqual(typeof musicPlayer.getPlayerMode, 'function', 'getPlayerMode must be exported');

// Test Player Components in viewMode: 'filter'
const filterPlayerComponents = musicPlayer.buildPlayerComponents(mockQueueActive, false, { viewMode: 'filter' });
assert.strictEqual(filterPlayerComponents.length, 4, 'Player in filter mode has 4 rows');

// Row 1: Playback buttons
const r1 = filterPlayerComponents[0].components;
assert.ok(r1.find(b => b.data.custom_id === 'player_pause'));

// Row 2: Top filter buttons
const r2 = filterPlayerComponents[1].components;
assert.ok(r2.find(b => b.data.custom_id === 'filter_btn_nightcore'));

// Row 4: Navigation (player_filter has label '🎵 Player')
const r4 = filterPlayerComponents[3].components;
const playerBtn = r4.find(b => b.data.custom_id === 'player_filter');
assert.ok(playerBtn, 'Tombol player_filter harus ada di baris 4');
assert.strictEqual(playerBtn.data.label, '🎵 Player');

// Test buildFilterPlayerEmbed
const filterEmbed = musicFilters.buildFilterPlayerEmbed({ name: 'Radwimps - Sparkle' }, mockQueueActive);
assert.ok(filterEmbed.data.description.includes('nightcore'));
assert.ok(filterEmbed.data.footer.text.includes('🎵 Player'));

console.log('All Music Audio Filters & Control Panel tests passed successfully!');
