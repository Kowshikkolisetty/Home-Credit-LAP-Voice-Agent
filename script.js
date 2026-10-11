const ORDERED_FIELDS = [
  'propertyType',
  'ownership',
  'documentsReady',
  'loanAmount',
  'occupation',
  'incomeMode',
  'marketValue',
  'tenure'
];

const questionsByField = {
  propertyType: 'What type of property do you own?',
  ownership: 'Do you own the property in your own name or jointly?',
  documentsReady: 'Do you have the original property documents ready?',
  loanAmount: 'How much loan amount do you require?',
  occupation: 'What is your occupation and income source?',
  incomeMode: 'Is your income received through the bank or in cash?',
  marketValue: 'What is the current estimated market value of the property?',
  tenure: 'What repayment tenure are you looking for in years?'
};

const state = {
  companyName: 'Home Credit',
  customerName: 'Riya Sharma',
  agentName: 'Aisha',
  agentGender: 'female',
  language: 'English',
  customerUtterance: '',
  propertyType: null,
  ownership: null,
  documentsReady: null,
  loanAmount: null,
  occupation: null,
  incomeMode: null,
  marketValue: null,
  tenure: null,
  transferRequired: false,
  transferReason: '',
  skippedQuestions: [],
  callStatus: 'Waiting for prompt generation',
  transcript: [],
  lastPrompt: ''
};

function toTitleCase(value) {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function getFieldValueLabel(key, value) {
  if (value === null || value === undefined) return 'Not captured';
  if (key === 'documentsReady' || key === 'transferRequired') return value ? 'Yes' : 'No';
  if (key === 'loanAmount') return `₹${Number(value).toLocaleString('en-IN')}`;
  if (key === 'marketValue') return `₹${Number(value).toLocaleString('en-IN')}`;
  return toTitleCase(value);
}

function updateStateFromInputs() {
  state.companyName = document.getElementById('companyName').value.trim() || 'Home Credit';
  state.customerName = document.getElementById('customerName').value.trim() || 'Customer';
  state.agentName = document.getElementById('agentName').value.trim() || 'Agent';
  state.agentGender = document.getElementById('agentGender').value;
  state.language = document.getElementById('language').value;
  state.customerUtterance = document.getElementById('customerUtterance').value.trim();
}

function buildSystemPrompt() {
  updateStateFromInputs();

  const prompt = `You are an AI voice agent for ${state.companyName}. Your role is to call existing valued customers, explain a special pre-approved Loan Against Property offer, collect a short eligibility checklist, and qualify them before handing off to a senior loan expert.

Core persona:
- Professional, warm, respectful, natural, and advisory.
- Use ${state.language} language, with empathy and clarity.
- Speak like a trusted financial advisor while keeping the call concise.
- Handle full sentences, conversational fillers, interruptions, and partial responses naturally.
- If the customer is busy, acknowledge it, confirm a preferred callback time, and politely close the call.

Operational context:
- Company name: ${state.companyName}
- Customer name: ${state.customerName}
- Agent name: ${state.agentName}
- Agent gender: ${state.agentGender}
- Date/time context: use the current date and time while staying appropriate to local conversation timing.
- RAG context: use customer profile, previous conversation history, and any account notes when relevant, but never mention internal data unless the customer has already provided it or it is directly useful.
- Language: ${state.language}
- Customer utterance: "${state.customerUtterance}"
- Conversation history: treat this as the current conversation state. If the customer provides information out of order, note the answer and skip asking that specific question later.

Objective:
- Present the reason for the call as a loyalty reward and a special LAP offer, up to ₹75,00,000.
- Collect exactly these 7 eligibility data points in sequence. If details are given out of order, record them and proceed to the next missing question.
  1. Property type: Residential, Commercial, and Industrial are eligible. Agricultural property is an immediate disqualification.
  2. Ownership status: Sole and Joint ownership are eligible.
  3. Document availability: customer must have original property documents ready.
  4. Loan amount: must be ₹75,00,000 or less.
  5. Occupation and income mode: Salaried or Self-Employed are eligible, but income must be received via bank transfer. Cash income is disqualified.
  6. Market value: estimated current market value of the property.
  7. Tenure: repayment period must be between 3 and 15 years.

Business logic and boundaries:
- Immediate disqualification: end the call politely if any ineligible criteria are met, such as agricultural property or cash income.
- Transfer logic switch: if the customer has an existing loan or wants to reduce their current EMI / transfer a loan, inform them that a specialist will contact them shortly and end the call.
- Loan amount limits: if the customer asks for more than ₹75,00,000, explain the cap clearly and ask whether they would like to proceed with the maximum allowed amount of ₹75,00,000.
- Post-qualification handoff: once all 7 points are successfully met, inform the customer that a senior loan expert will call back with exact interest rates. Any skipped questions must be revisited before the final handoff.
- Always ask only the next unanswered or relevant question and avoid repeating questions that have already been answered.

Conversation flow instructions:
- Greet the customer politely, verify the correct person, and if the customer is busy or cannot talk now, acknowledge and schedule a convenient callback time.
- Start by informing the customer that this is a loyalty benefit call with a pre-approved LAP offer.
- Use natural, conversational language. Handle interruptions, fillers, and statements like “I’m busy,” “let me think,” or “I already have a loan.”
- If the customer gives several answers in one sentence, process all valid details and ask only for missing information.
- Keep tone supportive and compliant.
- Do not promise approval before qualification.
- Return a brief summary before handing off: confirm the checklist status, note any skipped items, and then transfer to a specialist.

If customer utterance is provided, use it as the current customer response and respond accordingly.

Output format when interacting:
- 1) greeting and verification
- 2) explain the special offer
- 3) ask the next missing eligibility question
- 4) if eligible, confirm and transfer to senior expert
- 5) if ineligible or transfer logic triggered, politely close the call

Strict rules:
- Agricultural property = immediate disqualification.
- Cash income = immediate disqualification.
- Existing loan or EMI reduction / balance transfer request = specialist transfer and end call.
- Loan amount above ₹75,00,000 = cap communication and ask for maximum value.
- Tenure must be between 3 and 15 years inclusive.
- In case of out-of-order data, note it and skip later repeated questions.
- Final handoff only after all 7 points are confirmed and any skipped items are revisited.
`;

  state.lastPrompt = prompt;
  return prompt;
}

function parseNaturalLanguage(rawUtterance) {
  const utterance = rawUtterance || '';
  const lower = utterance.toLowerCase();

  if (!utterance.trim()) return;

  if (/agricultural|farm|agri|land|farmhouse/i.test(lower)) {
    state.propertyType = 'Agricultural';
  } else if (/residential|home|flat|villa|apartment/i.test(lower)) {
    state.propertyType = 'Residential';
  } else if (/commercial|shop|office|retail|warehouse/i.test(lower)) {
    state.propertyType = 'Commercial';
  } else if (/industrial|factory|plant|industrial unit/i.test(lower)) {
    state.propertyType = 'Industrial';
  }

  if (/joint|with my spouse|co[- ]owner|husband|wife|partner/i.test(lower)) {
    state.ownership = 'Joint';
  } else if (/sole|my name|single|individual/i.test(lower)) {
    state.ownership = 'Sole';
  }

  if (/original documents|documents are ready|have original|papers ready|ready with documents/i.test(lower)) {
    state.documentsReady = true;
  }

  const rupeeMatch = lower.match(/(?:rs\.?\s*|rupees?\s*|inr\s*|₹\s*)?(\d+(?:[.,]\d+)?)(?:\s*(?:lakh|lakhs|lac|lacs|crore|crores|thousand|k))?/i);
  const loanAmount = parseLoanAmount(lower);
  if (loanAmount !== null) {
    state.loanAmount = loanAmount;
  }

  if (/salaried|salary|employee|job/i.test(lower)) {
    state.occupation = 'Salaried';
  } else if (/self[- ]employed|business|entrepreneur|freelancer|own business/i.test(lower)) {
    state.occupation = 'Self-Employed';
  }

  if (/cash income|cash|in hand/i.test(lower)) {
    state.incomeMode = 'Cash';
  } else if (/bank transfer|bank credited|bank account|through bank|salary account|bank to bank/i.test(lower)) {
    state.incomeMode = 'Bank';
  }

  const marketValue = parseCurrencyValue(lower, 'market');
  if (marketValue !== null) state.marketValue = marketValue;

  const tenureMatch = lower.match(/(\d+)\s*(?:years?|yrs?)/i);
  if (tenureMatch) state.tenure = Number(tenureMatch[1]);

  if (/existing loan|current loan|already have a loan|balance transfer|reduce emi|lower my emi|emi reduction|loan transfer|transfer my loan/i.test(lower)) {
    state.transferRequired = true;
    state.transferReason = 'Existing loan or EMI reduction request';
  }
}

function parseLoanAmount(text) {
  const lower = text.toLowerCase();
  const valueMatches = [
    lower.match(/(\d+(?:[.,]\d+)?)\s*(?:lakh|lakhs|lac|lacs)/i),
    lower.match(/(\d+(?:[.,]\d+)?)\s*(?:crore|crores)/i),
    lower.match(/(\d+(?:[.,]\d+)?)\s*(?:thousand|k)/i),
    lower.match(/(?:rs\.?\s*|rupees?\s*|inr\s*|₹\s*)(\d+(?:[.,]\d+)?)(?:\s*(?:lakh|lakhs|lac|lacs|crore|crores|thousand|k))?/i)
  ];

  for (const match of valueMatches) {
    if (!match) continue;
    const rawValue = match[1].replace(/,/g, '');
    const number = Number(rawValue);
    const unit = (match[0] || '').toLowerCase();

    if (/crore|crores/.test(unit)) return number * 10000000;
    if (/lakh|lakhs|lac|lacs/.test(unit)) return number * 100000;
    if (/thousand|k/.test(unit)) return number * 1000;
    return number;
  }

  return null;
}

function parseCurrencyValue(text, type) {
  const lower = text.toLowerCase();
  const candidates = [
    lower.match(/(\d+(?:[.,]\d+)?)\s*(?:lakh|lakhs|lac|lacs)/i),
    lower.match(/(\d+(?:[.,]\d+)?)\s*(?:crore|crores)/i),
    lower.match(/(\d+(?:[.,]\d+)?)\s*(?:thousand|k)/i),
    lower.match(/(?:rs\.?\s*|rupees?\s*|inr\s*|₹\s*)(\d+(?:[.,]\d+)?)/i)
  ];

  for (const match of candidates) {
    if (!match) continue;
    const raw = match[1].replace(/,/g, '');
    const num = Number(raw);
    const unitPhrase = match[0].toLowerCase();

    if (/crore|crores/.test(unitPhrase)) return num * 10000000;
    if (/lakh|lakhs|lac|lacs/.test(unitPhrase)) return num * 100000;
    if (/thousand|k/.test(unitPhrase)) return num * 1000;
    return num;
  }

  return null;
}

function getMissingField() {
  for (const field of ORDERED_FIELDS) {
    if (state[field] === null || state[field] === undefined) {
      return field;
    }
  }
  return null;
}

function updateSummary() {
  const summaryList = document.getElementById('stateSummary');
  summaryList.innerHTML = '';

  ORDERED_FIELDS.forEach((field) => {
    const li = document.createElement('li');
    li.textContent = `${toTitleCase(field)}: ${getFieldValueLabel(field, state[field])}`;
    summaryList.appendChild(li);
  });
}

function addTranscriptEntry(message) {
  state.transcript.push(message);
  const transcriptEl = document.getElementById('transcript');
  transcriptEl.innerHTML = '';
  state.transcript.forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = entry;
    transcriptEl.appendChild(item);
  });
}

function determineStatus() {
  if (state.transferRequired) {
    state.callStatus = 'Specialist transfer required';
    document.getElementById('callStatus').textContent = 'Specialist transfer required';
    document.getElementById('callStatus').style.color = '#9c1d3d';
    document.getElementById('nextQuestion').textContent = 'The customer has an existing loan or wants EMI reduction; handoff to a specialist is required.';
    return;
  }

  if (state.propertyType === 'Agricultural' || state.incomeMode === 'Cash') {
    state.callStatus = 'Disqualified';
    document.getElementById('callStatus').textContent = 'Disqualified';
    document.getElementById('callStatus').style.color = '#9c1d3d';
    document.getElementById('nextQuestion').textContent = 'This customer does not meet the eligibility criteria. End the call politely.';
    return;
  }

  if (state.loanAmount !== null && state.loanAmount > 7500000) {
    state.callStatus = 'Cap reached';
    document.getElementById('callStatus').textContent = 'Cap reached';
    document.getElementById('callStatus').style.color = '#b66a00';
    document.getElementById('nextQuestion').textContent = 'The requested loan exceeds the maximum amount. Explain the cap and ask whether the customer would like to proceed with ₹75,00,000.';
    return;
  }

  const hasAll = ORDERED_FIELDS.every((field) => state[field] !== null && state[field] !== undefined);
  const properRange = state.tenure === null || (state.tenure >= 3 && state.tenure <= 15);

  if (hasAll && properRange && state.propertyType !== 'Agricultural' && state.incomeMode !== 'Cash') {
    state.callStatus = 'Ready for senior handoff';
    document.getElementById('callStatus').textContent = 'Ready for senior handoff';
    document.getElementById('callStatus').style.color = '#176b41';
    document.getElementById('nextQuestion').textContent = 'All 7 eligibility checks passed. Revisit any skipped items and then transfer to a senior loan expert for exact rates.';
    return;
  }

  const missing = getMissingField();
  state.callStatus = 'In progress';
  document.getElementById('callStatus').textContent = 'In progress';
  document.getElementById('callStatus').style.color = '#0f3d7a';
  document.getElementById('nextQuestion').textContent = missing ? questionsByField[missing] : 'Confirm all remaining fields before handoff.';
}

function simulateScenario() {
  resetSimulation();
  const utterance = document.getElementById('customerUtterance').value.trim();
  const prompt = buildSystemPrompt();
  document.getElementById('systemPrompt').value = prompt;

  if (!utterance) {
    addTranscriptEntry('Customer: no utterance provided');
    determineStatus();
    updateSummary();
    return;
  }

  const pieces = utterance
    .split(/(?<=[.!?])\s+|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  pieces.forEach((sentence) => {
    parseNaturalLanguage(sentence);
    addTranscriptEntry(`Customer: ${sentence}`);
    updateSummary();
    determineStatus();
  });

  addTranscriptEntry('Agent: This is a loyalty reward call to share a special LAP offer.');
  updateSummary();
  determineStatus();
}

function resetSimulation() {
  Object.keys(state).forEach((key) => {
    if (key === 'companyName' || key === 'customerName' || key === 'agentName' || key === 'agentGender' || key === 'language' || key === 'customerUtterance' || key === 'lastPrompt') {
      return;
    }
    if (Array.isArray(state[key])) {
      state[key] = [];
    } else if (typeof state[key] === 'boolean') {
      state[key] = false;
    } else {
      state[key] = null;
    }
  });

  state.transcript = [];
  state.companyName = document.getElementById('companyName').value.trim() || 'Home Credit';
  state.customerName = document.getElementById('customerName').value.trim() || 'Customer';
  state.agentName = document.getElementById('agentName').value.trim() || 'Agent';
  state.agentGender = document.getElementById('agentGender').value;
  state.language = document.getElementById('language').value;
  state.customerUtterance = document.getElementById('customerUtterance').value.trim();

  const transcript = document.getElementById('transcript');
  transcript.innerHTML = '';
  document.getElementById('systemPrompt').value = '';
  updateSummary();
}

function installEvents() {
  document.getElementById('generatePromptBtn').addEventListener('click', () => {
    const prompt = buildSystemPrompt();
    document.getElementById('systemPrompt').value = prompt;
    addTranscriptEntry('System prompt generated for the current call context.');
    updateSummary();
    determineStatus();
  });

  document.getElementById('simulateBtn').addEventListener('click', () => {
    simulateScenario();
  });
}

installEvents();
updateSummary();
determineStatus();
document.getElementById('systemPrompt').value = buildSystemPrompt();
