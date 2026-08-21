import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalChecklistPdfUrl,
  TransactionalResourceConfigurationError,
  transactionalResourceDeliveryClaims,
} from './transactional-resources';

const config = {
  TRANSACTIONAL_LANDING_ORIGIN: 'https://landing.example.test',
  TRANSACTIONAL_WEBINAR_TITLE: 'Webinar FUNDAE',
  TRANSACTIONAL_WEBINAR_START_AT: '2026-10-01T12:00:00+02:00',
  TRANSACTIONAL_WEBINAR_DURATION_MINUTES: '45',
  TRANSACTIONAL_WEBINAR_TIMEZONE: 'Europe/Madrid',
  TRANSACTIONAL_WEBINAR_ACCESS_NOTE: 'El enlace se enviará antes de la sesión.',
};

async function withConfig(callback: () => void | Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(config)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('all four resources use canonical server-side delivery claims', async () => {
  await withConfig(() => {
    const calculator = transactionalResourceDeliveryClaims('calculator');
    const interactive = transactionalResourceDeliveryClaims('interactive_checklist');
    const checklist = transactionalResourceDeliveryClaims('checklist');
    const webinar = transactionalResourceDeliveryClaims('webinar');

    assert.equal(calculator.template_id, 'calculator_result_v1');
    assert.equal(calculator.resource_url, 'https://landing.example.test/#calculadora');
    assert.equal(interactive.attachment?.endpoint_path, '/api/transactional/interactive-checklist/pdf');
    assert.equal(checklist.resource_url, 'https://landing.example.test/checklist_fundae_10_errores.pdf');
    assert.equal(checklist.attachment?.endpoint_path, '/api/transactional/checklist/pdf');
    assert.equal(canonicalChecklistPdfUrl(), checklist.resource_url);
    assert.equal(webinar.webinar?.date, '01/10/2026');
    assert.equal(webinar.webinar?.time, '12:00');
    assert.equal(webinar.webinar?.duration, '45 minutos');
    assert.match(webinar.webinar?.calendar_url ?? '', /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    assert.doesNotMatch(JSON.stringify({ calculator, interactive, checklist, webinar }), /contact|email|recipient|checklist_pdf_url/i);
  });
});

test('invalid or incomplete canonical configuration fails closed', async () => {
  await withConfig(() => {
    process.env.TRANSACTIONAL_LANDING_ORIGIN = 'http://landing.example.test';
    assert.throws(
      () => transactionalResourceDeliveryClaims('checklist'),
      TransactionalResourceConfigurationError,
    );
    process.env.TRANSACTIONAL_LANDING_ORIGIN = config.TRANSACTIONAL_LANDING_ORIGIN;
    delete process.env.TRANSACTIONAL_WEBINAR_START_AT;
    assert.throws(
      () => transactionalResourceDeliveryClaims('webinar'),
      TransactionalResourceConfigurationError,
    );
  });
});
