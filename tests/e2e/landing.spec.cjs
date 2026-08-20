const { test, expect } = require('@playwright/test');

const base = 'http://127.0.0.1:4173';
const routes = [
  ['/', 'inicio'],
  ['/calculadora', 'calculadora'],
  ['/checklist-10-errores', 'checklist'],
  ['/autodiagnostico', 'interactive-checklist'],
  ['/webinar', 'webinar'],
];

for (const [route, sectionId] of routes) {
  test(`${route} renders without runtime errors`, async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await expect(page.locator(`#${sectionId}`)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('estimaci?n');
    await expect(page.locator('body')).not.toContainText('pol?tica');
    expect(errors).toEqual([]);
  });
}

for (const [route, expected] of [
  ['/aviso-legal', 'Paseo de la Castellana, 141, 28046 Madrid'],
  ['/privacidad', 'administracion@gfs.es'],
  ['/cookies', 'Analítica opcional'],
]) {
  test(`${route} has dedicated legal content`, async ({ page }) => {
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByText(expected, { exact: false }).first()).toBeVisible();
  });
}

test('mobile layout has no horizontal overflow and consent has equal choices', async ({ page }) => {
  const analyticsRequests = [];
  page.on('request', (request) => {
    if (/posthog|google-analytics|googletagmanager|linkedin/i.test(request.url())) {
      analyticsRequests.push(request.url());
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/calculadora', { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Rechazar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Aceptar analítica/i })).toBeVisible();
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => ({
    local: Object.keys(localStorage).filter((key) => key.startsWith('fundae_')),
    session: Object.keys(sessionStorage).filter((key) => key.startsWith('fundae_')),
  }))).toEqual({ local: [], session: [] });
  expect(analyticsRequests).toEqual([]);
});

test('privacy preferences remain accessible and withdrawal clears analytics storage', async ({ page }) => {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Aceptar analítica/i }).click();
  const preferences = page.getByRole('button', { name: 'Preferencias de privacidad' });
  await expect(preferences).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem('fundae_journey_v2', 'stored');
    localStorage.setItem('fundae_first_touch_v2', 'stored');
    localStorage.setItem('fundae_last_touch_v2', 'stored');
    sessionStorage.setItem('fundae_session_v2', 'stored');
    sessionStorage.setItem('fundae_campaign_context_v1', 'stored');
  });

  await preferences.click();
  await expect(page.locator('#privacy-preferences')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Rechazar' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Rechazar' }).click();
  await expect(preferences).toBeVisible();
  await expect(preferences).toBeFocused();

  const stored = await page.evaluate(() => ({
    consent: JSON.parse(localStorage.getItem('fundae_analytics_consent_v1') ?? 'null'),
    journey: localStorage.getItem('fundae_journey_v2'),
    firstTouch: localStorage.getItem('fundae_first_touch_v2'),
    lastTouch: localStorage.getItem('fundae_last_touch_v2'),
    session: sessionStorage.getItem('fundae_session_v2'),
    campaignContext: sessionStorage.getItem('fundae_campaign_context_v1'),
  }));
  expect(stored.consent.state).toBe('rejected');
  expect(stored.journey).toBeNull();
  expect(stored.firstTouch).toBeNull();
  expect(stored.lastTouch).toBeNull();
  expect(stored.session).toBeNull();
  expect(stored.campaignContext).toBeNull();
});

test('desktop landing visual capture', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
});
test('calculator reveals its result before personal data and submits minimum capture data', async ({ page }) => {
  const leadPayloads = [];
  await page.route('**/api/leads/ingest', async route => {
    leadPayloads.push(route.request().postDataJSON());
    const status = leadPayloads.length === 1 ? 503 : 200;
    await route.fulfill({ status, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/calculadora', { waitUntil: 'networkidle' });
  const calculator = page.locator('#calculadora');
  const selects = calculator.locator('select');
  await selects.nth(0).selectOption('10-49');
  await selects.nth(1).selectOption('no_data');
  await selects.nth(2).selectOption('none');
  await calculator.getByRole('button', { name: 'Ver mi diagnóstico FUNDAE', exact: true }).click();
  await expect(calculator.getByText('Referencia de tramo')).toBeVisible();
  await expect(calculator.getByText('Dato que falta')).toBeVisible();
  await calculator.locator('input[name=name]').fill('Juan');
  await calculator.locator('input[name=email]').fill('juan@gfs.es');
  await calculator.locator('input[name=privacy_accepted]').check();
  await calculator.getByRole('button', { name: 'Solicitar copia', exact: true }).click();

  await expect.poll(() => leadPayloads.length).toBe(2);
  expect(leadPayloads[0].submission_id).toBe(leadPayloads[1].submission_id);
  expect(leadPayloads[1].form_type).toBe('calculator');
  expect(leadPayloads[1].contact.name).toBe('Juan');
  expect(leadPayloads[1].contact.email).toBe('juan@gfs.es');
  expect(leadPayloads[1].contact.company).toBe('');
  expect(leadPayloads[1].consent.privacy_accepted).toBe(true);
  expect(leadPayloads[1].company.employee_range).toBe('10-49');
  expect(leadPayloads[1].company.credit_calculation_mode).toBe('no_data');
  expect(leadPayloads[1].company.special_situation).toBe('no');
  expect(leadPayloads[1].credit_estimate.amount).toBeNull();
  expect(leadPayloads[1].credit_estimate.requires_manual_review).toBe(false);
  await expect(calculator.getByText('Tus próximos 3 pasos')).toBeVisible();
  await expect(calculator.locator('input[name="name"]')).toBeVisible();
  await expect(calculator.locator('input[name="email"]')).toBeVisible();
});

test('autoevaluation reveals the result and requests only capture data', async ({ page }) => {
  let leadPayload;
  await page.route('**/api/leads/ingest', async route => {
    leadPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto(base + '/autodiagnostico', { waitUntil: 'networkidle' });
  const section = page.locator('#interactive-checklist');

  for (let block = 0; block < 3; block += 1) {
    const cards = section.locator('div.bg-white.rounded-2xl').filter({ has: page.locator('h3') });
    await expect(cards).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await cards.nth(index).locator('button').first().click();
    }
    const nextLabel = block === 2 ? 'Ver resultados' : 'Siguiente';
    await section.getByRole('button', { name: nextLabel, exact: true }).click();
  }

  await expect(section.getByText('Resultado orientativo')).toBeVisible();
  await expect(section.locator('input[name="name"]')).toBeVisible();
  await expect(section.locator('input[name="email"]')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Registrar y descargar mi informe' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Descargar PDF' })).toHaveCount(0);

  await section.locator('input[name="name"]').fill('Juan');
  await section.locator('input[name="email"]').fill('juan@gfs.es');
  await section.locator('input[type="checkbox"]').check();
  const downloadPromise = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Registrar y descargar mi informe' }).click();
  const download = await downloadPromise;
  await download.saveAs('output/playwright/autoevaluacion-fundae-final.pdf');

  expect(download.suggestedFilename()).toBe('Resumen_Orientativo_FUNDAE.pdf');
  expect(leadPayload.contact.name).toBe('Juan');
  expect(leadPayload.contact.email).toBe('juan@gfs.es');
  expect(leadPayload.contact.company).toBe('');
  expect(leadPayload.consent.privacy_accepted).toBe(true);
});
test('FAQ exposes accessible disclosure state', async ({ page }) => {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const trigger = page.locator('#faq button[aria-expanded]').first();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const panelId = await trigger.getAttribute('aria-controls');
  await expect(page.locator('#' + panelId)).toHaveAttribute('role', 'region');
});

test('dominant funnel and final diagnostic actions are measurable', async ({ page }) => {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-track-cta="hero_autoevaluation"]')).toBeVisible();
  await expect(page.locator('[data-track-cta="final_diagnostic"]')).toBeVisible();
  await expect(page.locator('[data-track-cta^="entry_"]')).toHaveCount(4);
});
async function prepareChecklistSubmission(page, leadStatus) {
  const trackedEvents = [];
  await page.addInitScript(() => {
    window.__checklistFlow = [];
    window.__pdfOpenCalls = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/events/ingest') && typeof init?.body === 'string') {
        try {
          const payload = JSON.parse(init.body);
          window.__checklistFlow.push(`event:${payload.event_name}`);
        } catch {
          // The real request still runs; malformed payloads remain visible to the route assertion.
        }
      }
      return nativeFetch(input, init);
    };
    window.open = (...args) => {
      window.__checklistFlow.push('pdf:open');
      window.__pdfOpenCalls.push(args);
      return null;
    };
  });
  await page.route('**/api/leads/ingest', async route => {
    await route.fulfill({
      status: leadStatus,
      contentType: 'application/json',
      body: JSON.stringify(leadStatus < 400 ? { ok: true } : { error: 'Unavailable' }),
    });
  });
  await page.route('**/api/events/ingest', async route => {
    const payload = route.request().postDataJSON();
    trackedEvents.push(payload);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto(base + '/checklist-10-errores', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Aceptar anal/i }).click();
  const checklist = page.locator('#checklist');
  await checklist.locator('input[name="name"]').fill('Test User');
  await checklist.locator('input[name="email"]').fill('test@example.com');
  await checklist.locator('input[name="company"]').fill('Example Company');
  await checklist.locator('select[name="employee_range"]').selectOption('10-49');
  await checklist.locator('input[name="privacy_accepted"]').check();
  await checklist.getByRole('button', { name: 'Descargar checklist corporativo' }).click();
  return { checklist, trackedEvents };
}

test('failed checklist delivery keeps the form error and does not open or track the PDF', async ({ page }) => {
  const { checklist, trackedEvents } = await prepareChecklistSubmission(page, 503);
  await expect(checklist.getByText('No se pudo enviar', { exact: false })).toBeVisible();
  await expect.poll(() => trackedEvents.some(event => event.event_name === 'form_error')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__pdfOpenCalls.length)).toBe(0);
  const eventNames = trackedEvents.map(event => event.event_name);
  expect(eventNames).toContain('form_submit');
  expect(eventNames).toContain('form_error');
  expect(eventNames).not.toContain('tool_complete');
  expect(eventNames).not.toContain('resource_download');
});

test('successful checklist delivery confirms conversion before opening the PDF', async ({ page }) => {
  const { checklist, trackedEvents } = await prepareChecklistSubmission(page, 200);
  await expect(checklist.getByText('Descarga iniciada')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pdfOpenCalls.length)).toBe(1);
  await expect.poll(() => trackedEvents.some(event => event.event_name === 'resource_download')).toBe(true);

  const eventNames = trackedEvents.map(event => event.event_name);
  expect(eventNames).toContain('form_submit');
  expect(eventNames).toContain('form_success');

  const completionEvent = trackedEvents.find(event => event.event_name === 'tool_complete');
  expect(completionEvent?.properties).toMatchObject({ tool_id: 'checklist' });
  const downloadEvent = trackedEvents.find(event => event.event_name === 'resource_download');
  expect(downloadEvent?.properties).toMatchObject({
    tool_id: 'checklist',
    asset_id: 'fundae_resource',
  });

  const browserFlow = await page.evaluate(() => window.__checklistFlow);
  const completionIndex = browserFlow.indexOf('event:tool_complete');
  const downloadIndex = browserFlow.indexOf('event:resource_download');
  const openIndex = browserFlow.indexOf('pdf:open');
  expect(completionIndex).toBeGreaterThanOrEqual(0);
  expect(downloadIndex).toBeGreaterThan(completionIndex);
  expect(openIndex).toBeGreaterThan(downloadIndex);
});
