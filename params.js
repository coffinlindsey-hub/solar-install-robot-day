/*
 * Every number the model uses, in one place.
 *
 * tag: 'sourced'    = taken from a public source listed in SOURCES
 *      'assumption' = a placeholder chosen to be plausible; no public figure found
 *      'setting'    = a choice about the experiment, not a claim about the world
 *
 * Nothing here comes from any company's internal data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolarParams = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOURCES = {
    module: { label: 'Suntech, 580 to 600 W bifacial module datasheet', url: 'https://suntech-power.com/wp-content/uploads/download/product-specification/STP580-600S-C72-Nsh+.pdf', says: '144 half cells, 2278 x 1134 x 30 mm, 32.0 kg.' },
    pallet: { label: 'Lesso, 560 to 580 W bifacial module datasheet', url: 'https://www.lessosolar.com/uploads/580W-182-N-topcon-Bifacial-Module.pdf', says: '31 pieces per pallet with a 35 mm frame, 36 with a 30 mm frame.' },
    rowNx: { label: 'Single axis tracker datasheet (public planning exhibit)', url: 'https://townofmarlboroughny.gov/DocumentCenter/View/3387/Independent-Solar-Exhibit-N', says: 'Typical row 78 to 90 modules; rotation axis 1.3 to 1.8 m above ground; ground cover ratio typically 28 to 50 percent.' },
    rowArray: { label: 'Single axis tracker datasheet, one module in portrait (public zoning file)', url: 'https://kanecountyil.gov/FDER/Zoning%20Petitions%20Documents/Array%20Datasheet_DuraTrack_September%202022.pdf', says: 'Typical 84 to 112 modules per row; torque tube 54 inches above grade as standard.' },
    enr: { label: 'Engineering News Record, contractor field trial of installation robots', url: 'https://www.enr.com/articles/60249-rosendin-electric-deploys-custom-robots-to-install-solar-panels', says: 'Under a minute per panel; about 600 panels in a 10 hour shift with a two person crew; a traditional crew in similar conditions averaged 100 to 120 panels per 10 hour shift.' },
    pvmag: { label: 'pv magazine USA, robots working beside a crew (2025)', url: 'https://pv-magazine-usa.com/2025/04/08/robots-to-work-side-by-side-with-humans-to-demonstrate-solar-module-installation/', says: '350 to 400 modules per 8 hour shift with a two person crew, described as three times a standard three to four person manual crew.' },
    whitepaper: { label: 'TaiyangNews, summary of a vendor white paper on robotic module mounting', url: 'https://taiyangnews.info/technology/evaluating-robotic-module-mounting-for-utility-scale-pv-projects', says: 'Claimed average 600 modules per day and about 25 minutes per pallet of 36 including loading; battery runtime up to 10 hours; one project averaged a little over 400 per day across 22 working days; manual crews put at 200 to 300 modules per day.' },
    fleet: { label: 'Robotics 24/7, 100 MW installed by a robot fleet (2026)', url: 'https://www.robotics247.com/article/maximo-completes-100-megawatt-robotic-solar-installation', says: 'More than one module per minute; up to 24 modules per shift hour per person, described as nearly double traditional methods.' },
    wind: { label: 'Maxeon, module safety and installation manual', url: 'https://maxeon.com/sites/default/files/2024-09/Safety_Installation_Manual_UL_Certified_product_544753_Rev_H.pdf', says: 'Do not install or handle modules when they are wet or during periods of high wind. No wind speed is given.' },
  };

  // group, key, label, default, unit, min, max, step, tag, src, note
  const P = [
    ['Shift and crew', 'shiftHours', 'Shift length', 10, 'h', 6, 12, 0.5, 'assumption', null, 'Paid hours on site.'],
    ['Shift and crew', 'startupMin', 'Start of shift briefing and checks', 30, 'min', 0, 60, 5, 'assumption', null, 'Safety talk, stretch, walk round the machine. Robot is idle at the depot.'],
    ['Shift and crew', 'wrapUpMin', 'End of shift wrap up', 15, 'min', 0, 60, 5, 'assumption', null, 'Robot is back at the depot this long before the shift ends.'],
    ['Shift and crew', 'lunchMin', 'Lunch', 30, 'min', 0, 60, 5, 'assumption', null, 'Taken about half way through the shift.'],
    ['Shift and crew', 'shortBreakMin', 'Each short break (two per shift)', 15, 'min', 0, 30, 5, 'assumption', null, 'At a quarter and three quarters of the shift.'],
    ['Shift and crew', 'staggerBreaks', 'Stagger breaks so the robot keeps running', 0, 'on/off', 0, 1, 1, 'setting', null, 'The two people take breaks one after the other. One person covers both jobs meanwhile.'],
    ['Shift and crew', 'soloSlowdown', 'Slowdown while one person covers both jobs', 1.6, 'x', 1, 3, 0.1, 'assumption', null, 'Multiplies fastening and move forward times during staggered breaks.'],

    ['Robot cycle', 'cycleMin', 'Pick and place, fastest', 30, 's', 5, 120, 1, 'assumption', null, 'Arm picks from the pallet and sets the panel on the rail.'],
    ['Robot cycle', 'cycleMode', 'Pick and place, typical', 35, 's', 5, 120, 1, 'assumption', null, ''],
    ['Robot cycle', 'cycleMax', 'Pick and place, slowest', 40, 's', 5, 180, 1, 'assumption', null, ''],
    ['Robot cycle', 'panelsPerStop', 'Panels placed per stop', 2, 'panels', 1, 4, 1, 'assumption', null, 'How many panels the arm reaches before the rover has to move.'],
    ['Robot cycle', 'advanceMode', 'Move forward to the next stop, typical', 8, 's', 2, 60, 1, 'assumption', null, 'Triangular from 0.6x to 1.5x of this. The person walking with the robot moves it.'],
    ['Robot cycle', 'repositionPct', 'Stops that need a second try', 3, '%', 0, 30, 0.5, 'assumption', null, 'Rover is not square to the row and has to shuffle. Costs 20 to 90 s.'],
    ['Robot cycle', 'driveSpeed', 'Driving speed between rows and to the depot', 1.0, 'm/s', 0.3, 3, 0.1, 'assumption', null, 'Walking pace, because a person walks with it.'],
    ['Robot cycle', 'rowAlignMode', 'Line up on a new row, typical', 60, 's', 0, 600, 10, 'assumption', null, 'Triangular from 0.5x to 2x of this, on top of the drive around the row end.'],

    ['Crew fastening', 'fastenMin', 'Check and fasten one panel, fastest', 18, 's', 5, 120, 1, 'assumption', null, ''],
    ['Crew fastening', 'fastenMode', 'Check and fasten one panel, typical', 26, 's', 5, 120, 1, 'assumption', null, ''],
    ['Crew fastening', 'fastenMax', 'Check and fasten one panel, slowest', 40, 's', 5, 240, 1, 'assumption', null, ''],
    ['Crew fastening', 'maxAhead', 'Panels the robot may get ahead of the fastener', 3, 'panels', 1, 12, 1, 'assumption', null, 'Unfastened panels are a wind risk, so the robot waits when this many are loose.'],
    ['Crew fastening', 'reworkPct', 'Panels the crew has to reseat', 2, '%', 0, 30, 0.5, 'assumption', null, 'Placed slightly off. Adds 30 to 120 s of crew time and counts against quality.'],

    ['Pallets and reloads', 'panelsPerPallet', 'Panels per pallet', 31, 'panels', 10, 40, 1, 'sourced', 'pallet', ''],
    ['Pallets and reloads', 'reloadGoodMin', 'Good reload, typical', 2, 'min', 0.5, 10, 0.5, 'assumption', null, 'Triangular from 0.75x to 1.5x of this.'],
    ['Pallets and reloads', 'reloadBadLo', 'Bad reload, shortest', 10, 'min', 2, 60, 1, 'assumption', null, 'Many causes: a damaged pallet, a damaged panel on top, or the forklift cannot set the pallet cleanly.'],
    ['Pallets and reloads', 'reloadBadHi', 'Bad reload, longest', 20, 'min', 2, 90, 1, 'assumption', null, ''],
    ['Pallets and reloads', 'badReloadPct', 'Share of reloads that go badly', 15, '%', 0, 100, 1, 'assumption', null, ''],
    ['Pallets and reloads', 'callAhead', 'Forklift is called with this many panels left', 6, 'panels', 0, 20, 1, 'assumption', null, ''],
    ['Pallets and reloads', 'forkliftLoadMin', 'Forklift picks up a pallet at staging, typical', 1.5, 'min', 0.5, 10, 0.5, 'assumption', null, 'Triangular from 0.67x to 2x of this.'],
    ['Pallets and reloads', 'forkliftSpeed', 'Forklift speed on site', 2.5, 'm/s', 0.5, 6, 0.1, 'assumption', null, 'About 5.5 mph on rough ground.'],
    ['Pallets and reloads', 'preStage', 'Second pallet staged beside the robot', 0, 'on/off', 0, 1, 1, 'setting', null, 'The next pallet is delivered early, so a reload is a swap with no wait for delivery.'],
    ['Pallets and reloads', 'swapMin', 'Swap time when a pallet is already staged, typical', 1, 'min', 0.25, 5, 0.25, 'assumption', null, 'Replaces the good reload time when a second pallet is staged.'],

    ['Faults and stops', 'visionFaultPct', 'Vision or placement fault, per panel', 1.5, '%', 0, 20, 0.1, 'assumption', null, 'Recovery 0.5 to 5 min, typically 1.5.'],
    ['Faults and stops', 'rackingPct', 'Racking out of tolerance, per panel', 1.0, '%', 0, 20, 0.1, 'assumption', null, 'Crew adjusts the rail. 2 to 10 min, typically 4.'],
    ['Faults and stops', 'damagedPct', 'Damaged panel found at pick, per panel', 0.3, '%', 0, 10, 0.1, 'assumption', null, 'Panel is set aside. 1 to 4 min, typically 2.'],
    ['Faults and stops', 'weatherPerDay', 'Weather holds per day, average', 0.25, 'per day', 0, 5, 0.05, 'assumption', 'wind', 'Wind, rain or heat. Manuals say not to handle panels in high wind but give no number.'],
    ['Faults and stops', 'weatherMode', 'Weather hold length, typical', 30, 'min', 5, 240, 5, 'assumption', null, 'Triangular from 0.5x to 3x of this.'],

    ['Battery', 'batteryKWh', 'Battery size', 60, 'kWh', 5, 200, 5, 'assumption', 'whitepaper', 'One vendor publishes a runtime of up to 10 hours, not a size.'],
    ['Battery', 'drawPlaceKW', 'Average draw while placing', 3.5, 'kW', 0.5, 20, 0.5, 'assumption', null, ''],
    ['Battery', 'drawDriveKW', 'Average draw while driving', 6, 'kW', 0.5, 30, 0.5, 'assumption', null, ''],
    ['Battery', 'drawIdleKW', 'Average draw while stopped', 0.8, 'kW', 0, 5, 0.1, 'assumption', null, 'Computers, sensors and lights stay on.'],
    ['Battery', 'reservePct', 'Reserve that sends it to the charger', 10, '%', 0, 50, 1, 'assumption', null, ''],
    ['Battery', 'chargeKW', 'Charger power at the depot', 20, 'kW', 2, 150, 1, 'assumption', null, ''],

    ['Site', 'panelsPerRow', 'Panels per row', 84, 'panels', 20, 120, 1, 'sourced', 'rowNx', 'Three strings of 28. Sources give 78 to 112.'],
    ['Site', 'rowPitch', 'Distance between rows', 6, 'm', 4, 12, 0.5, 'sourced', 'rowNx', 'Gives a ground cover of 38 percent, inside the published 28 to 50.'],
    ['Site', 'numRows', 'Rows in the working block', 24, 'rows', 4, 40, 2, 'setting', null, ''],
    ['Site', 'panelLen', 'Panel length', 2.278, 'm', 1.5, 2.6, 0.001, 'sourced', 'module', ''],
    ['Site', 'panelWid', 'Panel width', 1.134, 'm', 0.9, 1.4, 0.001, 'sourced', 'module', ''],
    ['Site', 'axisHeight', 'Torque tube height', 1.5, 'm', 1.2, 2.2, 0.1, 'sourced', 'rowNx', ''],
    ['Site', 'panelWatts', 'Panel rating', 580, 'W', 300, 750, 5, 'sourced', 'module', ''],
    ['Site', 'stagingDistance', 'Pallet staging area to the block', 120, 'm', 0, 1000, 10, 'assumption', null, 'Along the access road. The forklift also drives up the row.'],
    ['Site', 'depotDistance', 'Charging depot to the block', 200, 'm', 0, 2000, 10, 'assumption', null, ''],

    ['Fleet', 'numRobots', 'Robots, each with its own two person crew', 1, 'robots', 1, 2, 1, 'setting', null, ''],
    ['Fleet', 'numForklifts', 'Forklifts shared by the robots', 1, 'forklifts', 1, 2, 1, 'setting', null, ''],

    ['Manual comparison', 'crewSize', 'People per crew', 2, 'people', 2, 6, 1, 'setting', null, 'Used for the manual crew. The robot crew is always two per robot.'],
    ['Manual comparison', 'manualRate', 'Manual install rate', 12, 'panels per person hour', 2, 30, 0.5, 'sourced', 'fleet', 'Public figures run from about 3 to about 13. This default is from the high end.'],

    ['Experiment', 'days', 'Simulated days', 30, 'days', 5, 200, 5, 'setting', null, 'Each day uses a different random seed.'],
    ['Experiment', 'seed', 'First random seed', 1, '', 1, 9999, 1, 'setting', null, ''],
  ];

  const DEFS = P.map((r) => ({ group: r[0], key: r[1], label: r[2], def: r[3], unit: r[4], min: r[5], max: r[6], step: r[7], tag: r[8], src: r[9], note: r[10] }));

  function defaults() {
    const o = {};
    for (const d of DEFS) o[d.key] = d.def;
    return o;
  }

  const SCENARIOS = [
    { id: 'base', name: 'Baseline day', why: 'The default assumptions.', set: {} },
    { id: 'stagger', name: 'Staggered crew breaks', why: 'The robot never stops for lunch or breaks. One person covers both jobs, more slowly, while the other is away.', set: { staggerBreaks: 1 } },
    { id: 'reload', name: 'Bad reloads cut in half', why: 'Half as many reloads turn into a 10 to 20 minute stop.', set: { badReloadPct: 7.5 } },
    { id: 'prestage', name: 'Second pallet staged', why: 'The next pallet is waiting beside the robot, so a reload is a one minute swap.', set: { preStage: 1 } },
    { id: 'fast', name: 'Faster arm, nothing else changed', why: 'Pick and place is 25 percent faster. Tests whether cycle time is really the constraint.', set: { cycleMin: 22.5, cycleMode: 26, cycleMax: 30 } },
    { id: 'two', name: 'Two robots, one forklift', why: 'A second robot and crew work the other half of the block. Both wait on the same forklift.', set: { numRobots: 2 } },
  ];

  return { SOURCES, DEFS, defaults, SCENARIOS };
});
