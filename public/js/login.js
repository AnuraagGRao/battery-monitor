document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const errAlert = document.getElementById('error-alert');
  const submitBtn = document.getElementById('submit-btn');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  errAlert.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Verifying...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      window.location.href = '/';
    } else {
      errAlert.innerText = data.error || 'Invalid credentials. Please try again.';
      errAlert.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Authenticate Session';
    }
  } catch (err) {
    errAlert.innerText = 'Server connection error. Check if the server is running.';
    errAlert.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.innerText = 'Authenticate Session';
  }
});
