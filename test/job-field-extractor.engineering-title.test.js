const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { isEngineeringRelevantTitle } = require('../src/utils/jobFieldExtractor');

describe('isEngineeringRelevantTitle — design/engineer adjacency (#47)', () => {
  test('"Design System Engineer" is accepted (intervening word between design and engineer)', () => {
    assert.equal(isEngineeringRelevantTitle('Design System Engineer'), true);
  });

  test('"UI Design Tools Engineer" is accepted', () => {
    assert.equal(isEngineeringRelevantTitle('UI Design Tools Engineer'), true);
  });

  test('"Design System Platform Engineer" is accepted (two intervening words)', () => {
    assert.equal(isEngineeringRelevantTitle('Design System Platform Engineer'), true);
  });

  test('"Design Engineer" (immediate adjacency) still accepted', () => {
    assert.equal(isEngineeringRelevantTitle('Design Engineer'), true);
  });

  test('pure design roles with no nearby "engineer" are still rejected', () => {
    assert.equal(isEngineeringRelevantTitle('Product Designer'), false);
    assert.equal(isEngineeringRelevantTitle('UX Designer'), false);
    assert.equal(isEngineeringRelevantTitle('Senior Creative Designer'), false);
  });

  // Regression: the adjacency tolerance is deliberately capped at 2
  // intervening words. A wider tolerance starts accepting non-engineering
  // titles where "engineer" merely appears later in a long title (real job
  // titles often carry seniority/location/employment-type boilerplate),
  // e.g. a design-adjacent support/coordination role that happens to
  // mention "Engineer" a few words later is still not itself an
  // engineering role.
  test('non-engineering design-adjacent titles with "engineer" more than 2 words away are still rejected', () => {
    assert.equal(isEngineeringRelevantTitle('Design Liaison to the Engineer Team'), false);
    assert.equal(isEngineeringRelevantTitle('Design Coordinator for our Engineer Onboarding'), false);
    assert.equal(isEngineeringRelevantTitle('Design Intern shadowing a Senior Engineer'), false);
    assert.equal(isEngineeringRelevantTitle('Junior Designer assisting the Lead Engineer'), false);
    assert.equal(isEngineeringRelevantTitle('Design Assistant to the Chief Engineer'), false);
  });
});

describe('isEngineeringRelevantTitle — backend/java data engineer qualifiers (#48)', () => {
  test('"Backend Data Engineer" is accepted (qualifier precedes "data engineer")', () => {
    assert.equal(isEngineeringRelevantTitle('Backend Data Engineer'), true);
  });

  test('"Java Backend Data Engineer" is accepted', () => {
    assert.equal(isEngineeringRelevantTitle('Java Backend Data Engineer'), true);
  });

  test('"Senior Backend Data Engineer, Platform Team" is accepted', () => {
    assert.equal(isEngineeringRelevantTitle('Senior Backend Data Engineer, Platform Team'), true);
  });

  test('plain "Data Engineer" (no backend/java qualifier) is still rejected', () => {
    assert.equal(isEngineeringRelevantTitle('Data Engineer'), false);
  });
});

describe('isEngineeringRelevantTitle — no false positives introduced', () => {
  test('genuinely non-engineering titles still return false', () => {
    assert.equal(isEngineeringRelevantTitle('Sales Engineer'), false);
    assert.equal(isEngineeringRelevantTitle('Sales Representative'), false);
    assert.equal(isEngineeringRelevantTitle('Marketing Manager'), false);
    assert.equal(isEngineeringRelevantTitle('Data Scientist'), false);
    assert.equal(isEngineeringRelevantTitle('Data Analyst'), false);
    assert.equal(isEngineeringRelevantTitle('Engineering Manager'), false);
  });

  test('genuinely engineering titles still return true', () => {
    assert.equal(isEngineeringRelevantTitle('Software Engineer'), true);
    assert.equal(isEngineeringRelevantTitle('Backend Engineer'), true);
    assert.equal(isEngineeringRelevantTitle('Platform Engineer'), true);
  });
});
