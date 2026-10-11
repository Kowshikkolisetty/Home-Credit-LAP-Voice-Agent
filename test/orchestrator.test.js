const test = require('node:test');
const assert = require('node:assert/strict');
const { applyExtracted, buildSystemPrompt, makeResult, newSession, providerPackage } = require('../server');

function qualify(session) {
  applyExtracted(session, {
    identityConfirmed: true,
    propertyType: 'Residential',
    ownership: 'Joint',
    documentsReady: true,
    loanAmount: 4000000,
    occupation: 'Salaried',
    incomeMode: 'Bank',
    marketValue: 9000000,
    tenure: 8
  });
}

test('asks identity first, then presents the offer and next unanswered question', () => {
  const session = newSession('call-1', { customer_name: 'Riya Sharma' });
  assert.equal(makeResult(session, '', true).action, 'ask_identity');

  applyExtracted(session, { identityConfirmed: true, propertyType: 'Residential', ownership: 'Joint' });
  const result = makeResult(session, 'Yes, this is Riya.', false);
  assert.equal(result.action, 'ask_question');
  assert.equal(result.next_field, 'documentsReady');
  assert.match(result.agent_message, /pre-approved Loan Against Property offer/);
});

test('qualifies only when every required answer is captured', () => {
  const session = newSession('call-2', { language: 'English' });
  qualify(session);
  const result = makeResult(session, '', false);
  assert.equal(result.action, 'qualified_callback');
  assert.equal(result.status, 'qualified');
  assert.equal(result.missing_fields.length, 0);
  assert.match(result.agent_message, /not a final loan approval/i);
});

test('collects occupation and income mode as the combined fifth eligibility check', () => {
  const session = newSession('call-income', {});
  applyExtracted(session, {
    identityConfirmed: true,
    propertyType: 'Residential',
    ownership: 'Sole',
    documentsReady: true,
    loanAmount: 5000000
  });
  const combined = makeResult(session, '', false);
  assert.equal(combined.next_field, 'occupation_income');
  assert.match(combined.agent_message, /occupation.*income/i);

  applyExtracted(session, { occupation: 'Salaried' });
  const remaining = makeResult(session, '', false);
  assert.equal(remaining.next_field, 'occupation_income');
  assert.match(remaining.agent_message, /income received/i);
});

test('disqualifies ineligible property, ownership, document, income, occupation, and tenure answers', () => {
  for (const extracted of [
    { identityConfirmed: true, propertyType: 'Agricultural' },
    { identityConfirmed: true, incomeMode: 'Cash' },
    { identityConfirmed: true, incomeMode: 'Other' },
    { identityConfirmed: true, ownership: 'Other' },
    { identityConfirmed: true, occupation: 'Other' },
    { identityConfirmed: true, documentsReady: false },
    { identityConfirmed: true, tenure: 2 }
  ]) {
    const session = newSession(`disqualified-${Math.random()}`);
    applyExtracted(session, extracted);
    assert.equal(makeResult(session, '', false).action, 'end_call');
    assert.equal(session.disposition, 'disqualified');
  }
});

test('asks for confirmation when requested amount exceeds the cap', () => {
  const session = newSession('call-cap', {});
  applyExtracted(session, { identityConfirmed: true, loanAmount: 8000000 });
  assert.equal(makeResult(session, '', false).action, 'confirm_maximum_amount');
  applyExtracted(session, { acceptMaximum: true });
  assert.equal(session.answers.loanAmount, 7500000);
});

test('routes existing-loan and EMI requests to a specialist', () => {
  const session = newSession('call-transfer', {});
  applyExtracted(session, { transferRequired: true, transferReason: 'EMI reduction' });
  const result = makeResult(session, '', false);
  assert.equal(result.action, 'specialist_callback');
  assert.equal(result.transfer_reason, 'EMI reduction');
});

test('records busy callback requests without claiming they are scheduled', () => {
  const session = newSession('call-busy', {});
  applyExtracted(session, { busy: true });
  assert.equal(makeResult(session, '', false).action, 'ask_callback_time');
  applyExtracted(session, { callbackAt: 'tomorrow afternoon' });
  const result = makeResult(session, '', false);
  assert.equal(result.action, 'callback_requested');
  assert.match(result.agent_message, /callback request .* recorded/i);
});

test('validates structured values and produces provider-specific packages', () => {
  const session = newSession('call-invalid', {});
  assert.throws(() => applyExtracted(session, { tenure: 0 }), /positive number/);
  assert.throws(() => applyExtracted(session, { propertyType: 'farm' }), /must be one of/);

  const retell = providerPackage('retell', new URL('http://localhost:8000'), { customer_name: 'Riya' });
  const bolna = providerPackage('bolna', new URL('http://localhost:8000'), { language: 'Hindi' });
  assert.equal(retell.retell_custom_function.name, 'advance_lap_call');
  assert.equal(retell.retell_custom_function.url, 'http://localhost:8000/api/turn');
  assert.equal(bolna.bolna_function.function.name, 'advance_lap_call');
  assert.match(bolna.system_prompt, /Hindi/);
  assert.match(buildSystemPrompt({}), /conversation_history/);
});
