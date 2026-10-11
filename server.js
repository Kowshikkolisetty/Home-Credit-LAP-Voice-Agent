const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LOAN_AMOUNT = 7500000;
const sessions = new Map();
const enumValues = {
  propertyType: ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Other'],
  ownership: ['Sole', 'Joint', 'Other'],
  occupation: ['Salaried', 'Self-Employed', 'Other'],
  incomeMode: ['Bank', 'Cash', 'Other']
};
const questionOrder = [
  'propertyType',
  'ownership',
  'documentsReady',
  'loanAmount',
  'occupation',
  'incomeMode',
  'marketValue',
  'tenure'
];
const questionGroups = [
  ['propertyType'],
  ['ownership'],
  ['documentsReady'],
  ['loanAmount'],
  ['occupation', 'incomeMode'],
  ['marketValue'],
  ['tenure']
];

const questions = {
  English: {
    identity: 'Hello, may I speak with {{customer_name}}?',
    propertyType: 'What type of property do you own: residential, commercial, or industrial?',
    ownership: 'Is the property solely owned or jointly owned?',
    documentsReady: 'Are the original property documents available with you?',
    loanAmount: 'What loan amount are you looking for?',
    occupation: 'Are you salaried or self-employed?',
    incomeMode: 'Is your income received in your bank account, in cash, or another way?',
    occupationIncome: 'What is your occupation, and is your income received through a bank or in cash?',
    marketValue: 'What is the property’s estimated current market value?',
    tenure: 'What repayment tenure would you prefer, between 3 and 15 years?',
    callback: 'Certainly. What day and time would be convenient for a callback?',
    end: 'Thank you for your time. Have a good day.'
  },
  Hindi: {
    identity: 'नमस्ते, क्या मेरी बात {{customer_name}} जी से हो रही है?',
    propertyType: 'आपकी संपत्ति किस प्रकार की है—आवासीय, कमर्शियल या औद्योगिक?',
    ownership: 'संपत्ति आपके अकेले नाम पर है या संयुक्त रूप से?',
    documentsReady: 'क्या संपत्ति के मूल दस्तावेज़ आपके पास उपलब्ध हैं?',
    loanAmount: 'आपको कितनी ऋण राशि चाहिए?',
    occupation: 'आप नौकरीपेशा हैं या स्वरोज़गार करते हैं?',
    incomeMode: 'आपकी आय बैंक खाते में आती है, नकद मिलती है या किसी अन्य तरीके से?',
    occupationIncome: 'आप नौकरीपेशा हैं या स्वरोज़गार करते हैं, और आपकी आय बैंक खाते में आती है, नकद मिलती है या किसी अन्य तरीके से?',
    marketValue: 'संपत्ति की अनुमानित मौजूदा बाज़ार कीमत कितनी है?',
    tenure: 'आप 3 से 15 साल के बीच कितनी अवधि चाहते हैं?',
    callback: 'ज़रूर। आपके लिए किस दिन और किस समय वापस कॉल करना सुविधाजनक होगा?',
    end: 'आपके समय के लिए धन्यवाद। आपका दिन शुभ हो।'
  }
};

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY_BYTES) {
        reject(new Error('Request body exceeds the 1 MiB limit.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function newSession(sessionId, context = {}) {
  return {
    sessionId,
    context: {
      company_name: context.company_name || 'Home Credit',
      customer_name: context.customer_name || 'Customer',
      agent_name: context.agent_name || 'Aisha',
      agent_gender: context.agent_gender || 'female',
      language: context.language === 'Hindi' ? 'Hindi' : 'English',
      current_datetime: context.current_datetime || new Date().toISOString(),
      rag_context: context.rag_context || '',
      conversation_history: context.conversation_history || ''
    },
    identityConfirmed: false,
    wrongPerson: false,
    offerPresented: false,
    answers: Object.fromEntries(questionOrder.map((field) => [field, null])),
    busy: false,
    transferRequired: false,
    transferReason: null,
    declined: false,
    callbackAt: null,
    completed: false,
    disposition: 'in_progress'
  };
}

function normalizeEnum(field, value) {
  if (typeof value !== 'string') return value;
  return enumValues[field].find((item) => item.toLowerCase() === value.trim().toLowerCase()) || value;
}

function applyExtracted(session, extracted) {
  if (extracted === undefined) return;
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) {
    throw new Error('extracted must be an object of structured customer answers.');
  }

  const allowed = new Set([
    ...questionOrder,
    'identityConfirmed',
    'wrongPerson',
    'busy',
    'callbackAt',
    'transferRequired',
    'transferReason',
    'declined',
    'acceptMaximum'
  ]);
  const unknown = Object.keys(extracted).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unsupported extracted field: ${unknown[0]}.`);

  if (extracted.identityConfirmed !== undefined) {
    if (typeof extracted.identityConfirmed !== 'boolean') throw new Error('identityConfirmed must be a boolean.');
    session.identityConfirmed = extracted.identityConfirmed;
  }
  if (extracted.wrongPerson !== undefined) {
    if (typeof extracted.wrongPerson !== 'boolean') throw new Error('wrongPerson must be a boolean.');
    session.wrongPerson = extracted.wrongPerson;
  }
  if (extracted.busy !== undefined && typeof extracted.busy !== 'boolean') {
    throw new Error('busy must be a boolean.');
  }
  if (extracted.busy !== undefined) session.busy = extracted.busy;
  if (extracted.callbackAt !== undefined) {
    if (typeof extracted.callbackAt !== 'string' || extracted.callbackAt.trim().length > 120) {
      throw new Error('callbackAt must be a short text value.');
    }
    session.callbackAt = extracted.callbackAt.trim();
  }
  if (extracted.transferRequired !== undefined) {
    if (typeof extracted.transferRequired !== 'boolean') throw new Error('transferRequired must be a boolean.');
    session.transferRequired = extracted.transferRequired;
    if (extracted.transferRequired) {
      session.transferReason = typeof extracted.transferReason === 'string'
        ? extracted.transferReason.slice(0, 200)
        : 'Existing loan or EMI reduction request';
    }
  }
  if (extracted.declined !== undefined) {
    if (typeof extracted.declined !== 'boolean') throw new Error('declined must be a boolean.');
    session.declined = extracted.declined;
  }

  for (const field of questionOrder) {
    if (extracted[field] === undefined) continue;
    let value = extracted[field];
    if (enumValues[field]) {
      value = normalizeEnum(field, value);
      if (!enumValues[field].includes(value)) {
        throw new Error(`${field} must be one of: ${enumValues[field].join(', ')}.`);
      }
    } else if (field === 'documentsReady') {
      if (typeof value !== 'boolean') throw new Error('documentsReady must be a boolean.');
    } else if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${field} must be a positive number.`);
    }
    session.answers[field] = value;
  }

  if (extracted.acceptMaximum !== undefined) {
    if (typeof extracted.acceptMaximum !== 'boolean') throw new Error('acceptMaximum must be a boolean.');
    if (extracted.acceptMaximum) session.answers.loanAmount = MAX_LOAN_AMOUNT;
    else session.declined = true;
  }
}

function makeResult(session, customerUtterance, isFirstTurn) {
  const language = session.context.language;
  const promptSet = questions[language];
  const formatText = (text) => text.replace('{{customer_name}}', session.context.customer_name);
  let action;
  let status;
  let agentMessage;
  let nextField = null;

  if (session.completed) {
    action = 'end_call';
    status = session.disposition;
    agentMessage = promptSet.end;
  } else if (session.wrongPerson) {
    action = 'end_call';
    status = 'wrong_person';
    session.completed = true;
    session.disposition = status;
    agentMessage = language === 'Hindi'
      ? 'क्षमा कीजिए, गलत व्यक्ति को कॉल करने के लिए। आपका दिन शुभ हो।'
      : 'I’m sorry for the interruption. I will end the call now. Have a good day.';
  } else if (session.declined) {
    action = 'end_call';
    status = 'customer_declined';
    session.completed = true;
    session.disposition = status;
    agentMessage = promptSet.end;
  } else if (session.transferRequired) {
    action = 'specialist_callback';
    status = 'specialist_callback';
    session.completed = true;
    session.disposition = status;
    agentMessage = language === 'Hindi'
      ? 'मैं समझ गई। हमारे ऋण विशेषज्ञ आपकी मौजूदा ऋण या ईएमआई संबंधी ज़रूरत पर आपसे संपर्क करेंगे। धन्यवाद।'
      : 'Understood. A loan specialist will contact you shortly about your existing loan or EMI requirement. Thank you for your time.';
  } else if ((session.answers.propertyType !== null && !['Residential', 'Commercial', 'Industrial'].includes(session.answers.propertyType)) ||
    (session.answers.ownership !== null && !['Sole', 'Joint'].includes(session.answers.ownership)) ||
    (session.answers.occupation !== null && !['Salaried', 'Self-Employed'].includes(session.answers.occupation)) ||
    (session.answers.incomeMode !== null && session.answers.incomeMode !== 'Bank') ||
    session.answers.documentsReady === false ||
    (session.answers.tenure !== null && (session.answers.tenure < 3 || session.answers.tenure > 15))) {
    action = 'end_call';
    status = 'disqualified';
    session.completed = true;
    session.disposition = status;
    agentMessage = language === 'Hindi'
      ? 'धन्यवाद। अभी दी गई जानकारी के आधार पर यह प्रस्ताव आपकी ज़रूरत के लिए उपयुक्त नहीं है। आपका दिन शुभ हो।'
      : 'Thank you for sharing that. Based on this information, this offer may not fit your current requirements. Have a good day.';
  } else if (session.answers.loanAmount !== null && session.answers.loanAmount > MAX_LOAN_AMOUNT) {
    action = 'confirm_maximum_amount';
    status = 'maximum_amount_confirmation';
    agentMessage = language === 'Hindi'
      ? 'इस प्रस्ताव में अधिकतम राशि ₹75,00,000 तक है। क्या आप इसी अधिकतम राशि के साथ आगे बढ़ना चाहेंगे?'
      : 'The maximum amount under this offer is ₹75,00,000. Would you like to continue with the maximum amount?';
  } else if (session.busy || (customerUtterance && /\b(i am busy|i'm busy|busy right now|call me later|not a good time)\b/i.test(customerUtterance))) {
    action = session.callbackAt ? 'callback_requested' : 'ask_callback_time';
    status = session.callbackAt ? 'callback_requested' : 'callback_time_needed';
    if (session.callbackAt) {
      session.completed = true;
      session.disposition = status;
      agentMessage = language === 'Hindi'
        ? `ठीक है, ${session.callbackAt} पर वापस कॉल करने का अनुरोध दर्ज किया गया है। धन्यवाद।`
        : `Certainly. A callback request for ${session.callbackAt} has been recorded. Thank you.`;
    } else {
      agentMessage = promptSet.callback;
    }
  } else if (!session.identityConfirmed) {
    action = 'ask_identity';
    status = 'identity_confirmation';
    agentMessage = formatText(promptSet.identity);
  } else {
    const missingGroup = questionGroups.find((group) => group.some((field) => session.answers[field] === null));
    if (missingGroup) {
      action = 'ask_question';
      status = 'in_progress';
      const missing = missingGroup.find((field) => session.answers[field] === null);
      const groupedOccupationIncome = missingGroup.length === 2;
      nextField = groupedOccupationIncome ? 'occupation_income' : missing;
      const offerIntro = language === 'Hindi'
        ? `${session.context.company_name} के साथ आपके भरोसेमंद संबंध के लिए ₹75,00,000 तक के प्री-अप्रूव्ड प्रॉपर्टी लोन प्रस्ताव के बारे में कॉल है। अंतिम स्वीकृति विस्तृत जांच के बाद होगी। `
          : `As a valued ${session.context.company_name} customer, we're calling about a pre-approved Loan Against Property offer up to ₹75,00,000, subject to detailed checks and final approval. `;
      const questionKey = groupedOccupationIncome && missingGroup.every((field) => session.answers[field] === null)
        ? 'occupationIncome'
        : missing;
      agentMessage = `${session.offerPresented ? '' : offerIntro}${promptSet[questionKey]}`;
      session.offerPresented = true;
    } else {
      action = 'qualified_callback';
      status = 'qualified';
      session.completed = true;
      session.disposition = status;
      const formatRupees = (amount) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`;
      const summary = language === 'Hindi'
        ? `संपत्ति ${session.answers.propertyType}, ${session.answers.ownership === 'Joint' ? 'संयुक्त' : 'एकल'} स्वामित्व, मांगी गई राशि ${formatRupees(session.answers.loanAmount)}, अनुमानित बाज़ार मूल्य ${formatRupees(session.answers.marketValue)} और अवधि ${session.answers.tenure} साल दर्ज की है।`
        : `I have noted a ${session.answers.propertyType.toLowerCase()} property with ${session.answers.ownership.toLowerCase()} ownership, a requested amount of ${formatRupees(session.answers.loanAmount)}, estimated market value of ${formatRupees(session.answers.marketValue)}, and a ${session.answers.tenure}-year tenure.`;
      agentMessage = language === 'Hindi'
        ? `${summary} हमारे वरिष्ठ ऋण विशेषज्ञ आपको सटीक ब्याज दर और अगले चरण बताने के लिए संपर्क करेंगे। यह अंतिम स्वीकृति नहीं है।`
        : `${summary} A senior loan expert will contact you with the exact interest rate and next steps. This is not a final loan approval.`;
    }
  }

  return {
    session_id: session.sessionId,
    action,
    status,
    next_field: nextField,
    agent_message: agentMessage,
    disposition: session.disposition,
    answers: session.answers,
    missing_fields: questionOrder.filter((field) => session.answers[field] === null),
    transfer_reason: session.transferReason,
    callback_at: session.callbackAt
  };
}

function toolSchema(endpoint) {
  return {
    name: 'advance_lap_call',
    description: 'Submit the latest customer turn and the voice model extracted answers. The server owns eligibility decisions; speak the returned agent_message and follow its action.',
    url: endpoint,
    method: 'POST',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['session_id', 'customer_utterance', 'extracted'],
      properties: {
        session_id: { type: 'string', description: 'Stable unique ID for this phone call.' },
        customer_utterance: { type: 'string', description: 'Verbatim latest customer utterance.' },
        context: {
          type: 'object',
          properties: {
            company_name: { type: 'string' },
            customer_name: { type: 'string' },
            agent_name: { type: 'string' },
            agent_gender: { type: 'string' },
            current_datetime: { type: 'string' },
            language: { type: 'string', enum: ['English', 'Hindi'] },
            rag_context: { type: 'string' },
            conversation_history: { type: 'string' }
          }
        },
        extracted: {
          type: 'object',
          additionalProperties: false,
          properties: {
            identityConfirmed: { type: 'boolean' },
            wrongPerson: { type: 'boolean' },
            busy: { type: 'boolean' },
            callbackAt: { type: 'string' },
            transferRequired: { type: 'boolean' },
            transferReason: { type: 'string' },
            declined: { type: 'boolean' },
            acceptMaximum: { type: 'boolean' },
            propertyType: { type: 'string', enum: enumValues.propertyType },
            ownership: { type: 'string', enum: enumValues.ownership },
            documentsReady: { type: 'boolean' },
            loanAmount: { type: 'number' },
            occupation: { type: 'string', enum: enumValues.occupation },
            incomeMode: { type: 'string', enum: enumValues.incomeMode },
            marketValue: { type: 'number' },
            tenure: { type: 'number' }
          }
        }
      }
    }
  };
}

function buildSystemPrompt(context) {
  return `You are {{agent_name}}, a warm, professional ${context.agent_gender || 'female'} voice agent for ${context.company_name || 'Home Credit'}. Speak in ${context.language || 'English'} and use natural full-sentence conversation, not yes/no-only scripts.

CALL CONTEXT
- Customer: {{customer_name}}
- Local date/time: {{current_datetime}}
- RAG/customer context: {{rag_context}}
- Conversation history: {{conversation_history}}
- Latest customer utterance: {{customer_utterance}}

PURPOSE AND OPENING
1. First verify you are speaking to {{customer_name}}. Do not disclose loan or account details to another person. If wrong person, send wrongPerson=true, apologize, and end the call.
2. If the customer is busy, ask for a preferred callback time. Call the orchestration tool with busy=true and callbackAt when supplied. The tool records a callback request only; do not claim an actual callback is scheduled unless an external scheduler confirms it.
3. After identity confirmation, explain the loyalty-based, pre-approved LAP offer up to ₹75,00,000. Clearly state that it is preliminary, subject to detailed checks, and not a final sanction or guaranteed approval.

ORCHESTRATION IS AUTHORITATIVE
- Call advance_lap_call on each customer turn. Send a stable unique session_id for the call, the exact customer_utterance, and every answer you can confidently extract in extracted. Answers may be supplied out of order and several may be supplied in one sentence.
- Include context on the first turn: company_name, customer_name, agent_name, agent_gender, language, rag_context, conversation_history. Do not put secrets or unnecessary sensitive data in RAG context.
- Use extracted fields exactly: identityConfirmed, wrongPerson, busy, callbackAt, transferRequired, transferReason, declined, acceptMaximum, propertyType, ownership, documentsReady, loanAmount, occupation, incomeMode, marketValue, tenure.
- Do not infer uncertain facts. Omit unknown fields; ask a natural clarification when an answer is ambiguous.
- Speak the returned agent_message naturally. Follow the returned action; the server decides eligibility, next question, and disposition. Never tell the customer they qualified or were disqualified based on your own calculation.
- For action specialist_callback, qualified_callback, callback_requested, or end_call: speak the returned message and end the call. These actions create a disposition for a downstream CRM/scheduler; they do not themselves connect or place a callback.
- For confirm_maximum_amount, ask whether the customer accepts ₹75,00,000. On acceptance send acceptMaximum=true; on rejection send acceptMaximum=false.

ELIGIBILITY RULES (server enforced; do not override)
- Residential, Commercial, and Industrial property are eligible; Agricultural or any other property type is disqualified.
- Sole and Joint ownership are eligible; any other ownership status is disqualified.
- Original property documents must be available.
- Requested loan must be at most ₹75,00,000. For a larger amount, explain the cap and ask whether the customer wants the maximum.
- Occupation must be Salaried or Self-Employed; income must be received through a bank. Cash or any other income mode is disqualified.
- Capture the estimated current market value.
- Tenure must be from 3 through 15 years inclusive.
- Any existing loan / EMI reduction / balance transfer request goes to a specialist callback and ends this LAP qualification call.

PRIVACY AND CONVERSATION
- Be respectful, concise, and transparent. Do not request account passwords, OTPs, card details, or full bank credentials.
- Handle interruptions and fillers patiently. Do not repeat captured questions. Summarize only the preliminary details needed for the handoff.
- If the customer declines, send declined=true and close politely. Never invent exact interest rates, approval, policy exceptions, or callback timing.`;
}

function providerPackage(provider, requestUrl, context) {
  if (!['retell', 'bolna'].includes(provider)) throw new Error('provider must be retell or bolna.');
  const baseUrl = process.env.PUBLIC_BASE_URL || `${requestUrl.protocol}//${requestUrl.host}`;
  const endpoint = `${baseUrl}/api/turn`;
  const schema = toolSchema(endpoint);
  const prompt = buildSystemPrompt(context || {});

  if (provider === 'retell') {
    return {
      provider: 'Retell AI',
      instructions: 'Add the system_prompt as the agent prompt and register retell_custom_function as a custom function. Set PUBLIC_BASE_URL to a publicly reachable HTTPS URL before importing.',
      system_prompt: prompt,
      retell_custom_function: {
        type: 'custom',
        name: schema.name,
        description: schema.description,
        url: schema.url,
        method: schema.method,
        parameters: schema.parameters
      },
      orchestration_endpoint: endpoint
    };
  }
  return {
    provider: 'Bolna',
    instructions: 'Use system_prompt as the agent task prompt. Register bolna_function as a custom/function tool routed to orchestration_endpoint using the included JSON schema. Confirm the exact tool adapter format for the selected Bolna deployment.',
    system_prompt: prompt,
    bolna_function: {
      type: 'function',
      function: {
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters
      },
      webhook_url: endpoint,
      http_method: schema.method
    },
    orchestration_endpoint: endpoint
  };
}

function contentType(filePath) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8'
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function serveStatic(request, response, requestUrl) {
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Unable to read requested file.');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-store'
    });
    response.end(contents);
  });
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    jsonResponse(response, 200, { status: 'ok', service: 'lap-voice-orchestrator', sessions: sessions.size });
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/integration') {
    const provider = requestUrl.searchParams.get('provider') || 'retell';
    jsonResponse(response, 200, providerPackage(provider, requestUrl, Object.fromEntries(requestUrl.searchParams)));
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/turn') {
    const body = await readJson(request);
    if (typeof body.session_id !== 'string' || !body.session_id.trim() || body.session_id.length > 128) {
      jsonResponse(response, 400, { error: 'session_id is required and must be 1–128 characters.' });
      return;
    }
    if (body.customer_utterance !== undefined && typeof body.customer_utterance !== 'string') {
      jsonResponse(response, 400, { error: 'customer_utterance must be a string.' });
      return;
    }
    const sessionId = body.session_id.trim();
    const session = sessions.get(sessionId) || newSession(sessionId, body.context || {});
    applyExtracted(session, body.extracted);
    if (body.extracted && body.extracted.busy === true) {
      session.callbackAt = body.extracted.callbackAt || session.callbackAt;
    }
    if (body.context && typeof body.context === 'object' && !Array.isArray(body.context) &&
      session.disposition === 'in_progress') {
      for (const key of ['company_name', 'customer_name', 'agent_name', 'agent_gender', 'current_datetime', 'rag_context', 'conversation_history']) {
        if (typeof body.context[key] === 'string') session.context[key] = body.context[key].slice(0, 10000);
      }
      if (body.context.language === 'English' || body.context.language === 'Hindi') session.context.language = body.context.language;
    }
    const firstTurn = !sessions.has(sessionId);
    const result = makeResult(session, body.customer_utterance || '', firstTurn);
    sessions.set(sessionId, session);
    jsonResponse(response, 200, result);
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/reset') {
    const body = await readJson(request);
    if (typeof body.session_id !== 'string' || !body.session_id.trim()) {
      jsonResponse(response, 400, { error: 'session_id is required.' });
      return;
    }
    const removed = sessions.delete(body.session_id.trim());
    jsonResponse(response, 200, { reset: removed });
    return;
  }
  if (request.method === 'GET' && !requestUrl.pathname.startsWith('/api/')) {
    serveStatic(request, response, requestUrl);
    return;
  }
  jsonResponse(response, 404, { error: 'Not found.' });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (!response.headersSent) {
      const badRequest = error instanceof SyntaxError || /must |required|Unsupported|exceeds/i.test(error.message);
      jsonResponse(response, badRequest ? 400 : 500, { error: error.message || 'Request failed.' });
    } else {
      response.destroy(error);
    }
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`LAP voice app and orchestrator listening on http://${HOST}:${PORT}`);
  });
}

module.exports = { server, makeResult, newSession, applyExtracted, providerPackage, buildSystemPrompt };
