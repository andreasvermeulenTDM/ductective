/**
 * reconcile.scope.test.mjs — the Phase 1 answer scope, pinned in CI.
 *
 * `OUT_OF_SCOPE_EQUIPMENT` decides which documents a technician's rooftop question
 * can retrieve. It is derived from manifest columns, which means a manifest edit can
 * move it — and a widening meant to keep a furnace out can clip a rooftop on the way
 * past. Both directions are regressions and neither shows up in a passing build
 * otherwise: retrieval simply gets quietly worse.
 *
 * So both directions are asserted here:
 *
 *  - every rooftop document that Phase 1 answers on stays in scope, by name;
 *  - the equipment classes Phase 1 does not answer on stay out, by name.
 *
 * The by-name list is the point. A generic "count the in-scope docs" assertion
 * passes when one rooftop drops out and one furnace drops in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documents, isInScope, OUT_OF_SCOPE_EQUIPMENT } from './reconcile.mjs';

const corpus = documents();
const byFile = (f) => corpus.find((d) => d.file === f);

/**
 * The rooftop documents Phase 1 answers on. Written as files rather than a count so
 * a substitution cannot pass. `RT-SVX075A` and `48TC` joined on 7 Aug 2026 with the
 * owner's ZIP batch; the rest predate it.
 */
const MUST_BE_IN_SCOPE = [
  'PKGP-PRC013AA-EN_12202022.pdf',        // Trane packaged rooftop catalogue
  'RT-SVX23R-EN_09222022.pdf',            // Precedent IOM
  'RT-SVX21AD-EN_06172022.pdf',
  'RT-SVX34W-EN_03112023.pdf',
  'RT-SVX46G-EN_01162021.pdf',            // Precedent eFlex
  'RT-SVX072E-EN_10122024.pdf',           // IntelliPak 1 / Symbio 800
  'PKGP-SVX010A-EN_12152022.pdf',         // Precedent HEAT PUMP — must survive the widening
  'RT-SVX056D-GB_1120.pdf',               // Airfinity
  '48-50LC-4-6-C01T.pdf',
  '48-50K-01APD.pdf',
  '48-50PGPM-03T.pdf',
  '48_50A-19PD.pdf',                      // WeatherMaker
  '48HJ-32SI.pdf',
  '50HC-7-12-07SI.pdf',
  '50E-C2SI.pdf',
  '48-50FE-20-30-01PD.pdf',
  '48-50FC-20-30-01PD.pdf',
  '15_Carrier_Carrier-48TC-3-15-Ton-Packaged-Rooftop-Service-Maintenance-Instructions.pdf',
  '16_Trane_Trane-Precedent-3-25-Ton-Rooftop-Installation-Operation-Maintenance-RT-SVX075A-EN.pdf',
  '18_Carrier_Carrier-50V-Packaged-Unit-Installation-Start-Up-Instructions.pdf',
  '30_Trane_Trane-Packaged-Rooftop-Application-Guide-APP-PRC005H-EN.pdf',
];

/**
 * Trane and Carrier documents that are NOT rooftops. Every one of these passes the
 * manufacturer half of the rule, so each is a document that would have entered Phase 1
 * retrieval before the 7 Aug widening.
 */
const MUST_BE_OUT_OF_SCOPE = [
  'TEMP-SVX001A-EN_02142023.pdf',                                                          // chiller (the original case)
  '01_Carrier_Carrier-59MN7B-Multipoise-Condensing-Gas-Furnace-Installation-Start-Up-Operating-Service-Mainte.pdf',
  '04_Trane_Trane-Gas-Furnace-Installation-Manual-18-CE19D1-1B-EN.pdf',
  '06_Carrier_Carrier-25VNA8-24VNA9-Infinity-Variable-Speed-Heat-Pump-Service-Manual.pdf',  // residential SPLIT heat pump
  '11_Trane_Trane-Air-Handler-Installation-Operation-Maintenance-AHR-SVX001C-EN.pdf',
  '13_Carrier_Carrier-CNPV-CNRV-Cased-N-Evaporator-Coils-Product-Data-airflow-pressure-drop.pdf',
  '14_Carrier_Carrier-CAPMP-CARMP-Multipoise-Evaporator-Coils-Installation-Instructions.pdf',
  '20_Carrier_Carrier-38MURA-Ductless-Multi-Zone-Outdoor-Unit-Service-Manual.pdf',
  '22_Carrier_Carrier-40VM-VRF-Indoor-Units-Installation-Operating-Instructions.pdf',
  '24_Carrier_Carrier-ERV-HRV-User-and-Installer-Manual-ventilation-airflow-balancing.pdf',
  '25_Carrier_Carrier-DEHXXCDA-Whole-House-Dehumidifier-Installation-Instructions-duct-connection.pdf',
  '26_Carrier_Carrier-HUMCRSTM-Steam-Humidifier-Installation-Maintenance-Instructions.pdf',
  '27_Carrier_Carrier-BWBC-Cast-Iron-Gas-Boiler-Forced-Hot-Water-Installation-Operating.pdf',
  '29_Carrier_Carrier-VFD-Variable-Frequency-Drive-Installation-Start-Up-and-Service-Instructions.pdf',
];

for (const file of MUST_BE_IN_SCOPE) {
  test(`scope: IN — ${file.slice(0, 60)}`, () => {
    const doc = byFile(file);
    assert.ok(doc, `not in the corpus at all — manifest row missing or unmatched`);
    assert.equal(doc.inScope, true, `a rooftop document fell OUT of Phase 1 scope (coverage: "${doc.coverage}")`);
  });
}

for (const file of MUST_BE_OUT_OF_SCOPE) {
  test(`scope: OUT — ${file.slice(0, 60)}`, () => {
    const doc = byFile(file);
    assert.ok(doc, `not in the corpus at all — manifest row missing or unmatched`);
    assert.equal(doc.inScope, false, `non-rooftop equipment entered Phase 1 retrieval (coverage: "${doc.coverage}")`);
  });
}

test('scope: the doc-type escape still admits PT charts', () => {
  const pt = corpus.filter((d) => d.docType === 'PT Chart');
  assert.ok(pt.length >= 3, `expected the refrigerant PT charts, found ${pt.length}`);
  for (const d of pt) assert.equal(d.inScope, true, `${d.file} — a PT chart must stay in scope`);
});

test('scope: the widened pattern cannot fire on the "erv" inside "Service"', () => {
  // Nine in-scope rows carry a doc type containing "Service". An unanchored ERV
  // alternative would have taken every one of them out of scope.
  assert.equal(OUT_OF_SCOPE_EQUIPMENT.test('Install/Startup/Service'), false);
  assert.equal(OUT_OF_SCOPE_EQUIPMENT.test('IOM + diagnostics'), false);
  assert.equal(OUT_OF_SCOPE_EQUIPMENT.test('ERV / HRV ventilator, airflow balancing'), true);
});

test('scope: no document is in scope without a Phase 1 manufacturer or doc type', () => {
  for (const d of corpus.filter((x) => x.inScope)) {
    assert.ok(
      ['Trane', 'Carrier'].includes(d.manufacturer) || d.docType === 'PT Chart',
      `${d.file} is in scope but is neither Trane/Carrier nor a PT chart (${d.manufacturer})`
    );
  }
});

test('scope: isInScope is driven by the manifest, not the filename', () => {
  // A synthetic row proves the rule reads columns. If this ever starts consulting
  // the filename, the derivation promise in reconcile.mjs is broken.
  assert.equal(isInScope({ manufacturer: 'Carrier', docType: 'IOM', coverage: '48TC rooftop' }), true);
  assert.equal(isInScope({ manufacturer: 'Carrier', docType: 'IOM', coverage: 'gas furnace' }), false);
  assert.equal(isInScope({ manufacturer: 'Lennox', docType: 'IOM', coverage: 'rooftop' }), false);
});
