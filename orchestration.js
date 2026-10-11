const providerSelect = document.getElementById('provider');
const packageField = document.getElementById('integrationPackage');
const healthLabel = document.getElementById('orchestratorHealth');
const endpointField = document.getElementById('orchestratorUrl');

endpointField.value = `${window.location.origin}/api/turn`;

function readPromptContext() {
  return {
    company_name: document.getElementById('companyName').value.trim() || 'Home Credit',
    customer_name: document.getElementById('customerName').value.trim() || 'Customer',
    agent_name: document.getElementById('agentName').value.trim() || 'Aisha',
    agent_gender: document.getElementById('agentGender').value,
    language: document.getElementById('language').value
  };
}

async function checkOrchestrator() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}.`);
    const health = await response.json();
    healthLabel.dataset.state = 'online';
    healthLabel.textContent = `Orchestrator online · ${health.sessions} active in-memory call(s)`;
  } catch (error) {
    healthLabel.dataset.state = 'offline';
    healthLabel.textContent = `Orchestrator unavailable: ${error.message}. Start with node server.js.`;
  }
}

async function generateIntegrationPackage() {
  const params = new URLSearchParams({ provider: providerSelect.value, ...readPromptContext() });
  const response = await fetch(`/api/integration?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Package request returned HTTP ${response.status}.`);
  packageField.value = JSON.stringify(payload, null, 2);
  endpointField.value = payload.orchestration_endpoint;
}

document.getElementById('generateIntegrationBtn').addEventListener('click', async () => {
  try {
    await generateIntegrationPackage();
    await checkOrchestrator();
  } catch (error) {
    healthLabel.dataset.state = 'offline';
    healthLabel.textContent = `Could not build platform package: ${error.message}`;
  }
});

document.getElementById('copyIntegrationBtn').addEventListener('click', async () => {
  if (!packageField.value) {
    healthLabel.textContent = 'Build the platform package before copying it.';
    return;
  }
  try {
    await navigator.clipboard.writeText(packageField.value);
    healthLabel.textContent = 'Platform package copied.';
  } catch (error) {
    healthLabel.textContent = `Copy failed: ${error.message}`;
  }
});

providerSelect.addEventListener('change', () => {
  generateIntegrationPackage().catch((error) => {
    healthLabel.textContent = `Could not build platform package: ${error.message}`;
  });
});

checkOrchestrator();
generateIntegrationPackage().catch((error) => {
  healthLabel.dataset.state = 'offline';
  healthLabel.textContent = `Could not build platform package: ${error.message}`;
});
