import assert from 'assert';
import {
  classifyVendorPortalPhase,
  vendorPortalPhaseBreakdown,
} from '../vendorPortalPhaseClassification';

function main(): void {
  assert.strictEqual(classifyVendorPortalPhase('UAT login error'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase('uat: checkout error'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase('[UAT] login error'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase('[uat] checkout error'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase(' [ UAT ] payment error '), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase('[UAT]Search error'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase(' Phase 2B UAT search error '), 'phase2-uat');
  assert.strictEqual(classifyVendorPortalPhase('phase2b uat - payment error'), 'phase2-uat');
  assert.strictEqual(classifyVendorPortalPhase('INC0012345 production outage'), 'production');
  assert.strictEqual(classifyVendorPortalPhase('inc-812 production outage'), 'production');

  assert.strictEqual(classifyVendorPortalPhase('Incident review notes'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase('Incorrect value displayed'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase('Uatility typo'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase('[UATILITY] typo'), 'phase1-uat');
  assert.strictEqual(classifyVendorPortalPhase(''), 'unclassified');
  assert.strictEqual(classifyVendorPortalPhase(undefined), 'unclassified');

  const breakdown = vendorPortalPhaseBreakdown([
    { subject: 'UAT first', open: true },
    { subject: 'UAT second', open: false },
    { subject: 'Phase 2B UAT first', open: true },
    { subject: 'INC001 production', open: true },
    { subject: 'INC002 production', open: false },
    { subject: 'Missing prefix', open: true },
  ]);

  assert.deepStrictEqual(
    breakdown.map((item) => item.category),
    ['phase1-uat', 'phase2-uat', 'production', 'unclassified'],
  );
  assert.deepStrictEqual(
    breakdown.map(({ count, open, closed }) => ({ count, open, closed })),
    [
      { count: 3, open: 2, closed: 1 },
      { count: 1, open: 1, closed: 0 },
      { count: 2, open: 1, closed: 1 },
      { count: 0, open: 0, closed: 0 },
    ],
  );

  const empty = vendorPortalPhaseBreakdown([]);
  assert.strictEqual(empty.length, 4);
  assert.ok(empty.every((item) => item.count === 0));

  console.log('vendor portal phase classification tests passed');
}

main();
