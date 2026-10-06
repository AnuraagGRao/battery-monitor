/**
 * VoltWatch Login Client
 * Handles Firebase Google Sign-In and standard password authentication
 */

let firebaseAuth = null;
let googleProvider = null;
let isFirebaseReady = false;

// 1. Fetch server auth config and initialize Firebase
async function initAuth() {
  const googleBtn = document.getElementById('google-signin-btn');
  const googleBtnText = document.getElementById('google-btn-text');

  try {
    const res = await fetch('/api/auth/config');
    const config = await res.json();

    if (config.firebase && config.firebase.apiKey && typeof firebase !== 'undefined') {
      try {
        firebase.initializeApp(config.firebase);
        firebaseAuth = firebase.auth();
        googleProvider = new firebase.auth.GoogleAuthProvider();
        googleProvider.setCustomParameters({ prompt: 'select_account' });
        isFirebaseReady = true;
      } catch (fbErr) {
        console.warn('[FIREBASE INIT]', fbErr);
      }
    }
  } catch (err) {
    console.error('[AUTH CONFIG ERROR]', err);
  }

  // Google sign in button click handler
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      const errAlert = document.getElementById('error-alert');
      errAlert.classList.add('hidden');

      if (!isFirebaseReady || !firebaseAuth) {
        // If Firebase isn't initialized, show helper modal
        const modal = document.getElementById('setup-help-modal');
        if (modal) modal.classList.remove('hidden');
        return;
      }

      try {
        googleBtn.disabled = true;
        googleBtnText.innerText = 'Connecting to Google...';

        const result = await firebaseAuth.signInWithPopup(googleProvider);
        const user = result.user;
        const idToken = await user.getIdToken();

        googleBtnText.innerText = 'Authorizing session...';

        const serverRes = await fetch('/api/auth/firebase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            uid: user.uid,
          }),
        });

        const data = await serverRes.json();
        if (serverRes.ok && data.success) {
          window.location.href = '/';
        } else {
          throw new Error(data.error || 'Server rejected session authorization');
        }
      } catch (err) {
        console.error('[GOOGLE SIGN-IN ERROR]', err);
        googleBtn.disabled = false;
        googleBtnText.innerText = 'Continue with Google';

        let message = err.message || 'Google Sign-In failed.';
        if (err.code === 'auth/popup-closed-by-user') {
          message = 'Sign-in cancelled. You closed the Google popup window.';
        } else if (err.code === 'auth/operation-not-allowed') {
          message =
            'Google Sign-in is not yet enabled in Firebase Console! Go to Firebase Console ➔ Authentication ➔ Sign-in method ➔ Enable Google.';
        } else if (err.code === 'auth/unauthorized-domain') {
          message =
            'Current domain is not authorized in Firebase. Check Authentication ➔ Settings ➔ Authorized domains.';
        }

        errAlert.innerText = message;
        errAlert.classList.remove('hidden');
      }
    });
  }
}

// 2. Traditional password login form
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

// Setup modal close buttons
const closeModalBtn = document.getElementById('close-modal-btn');
const modalOkBtn = document.getElementById('modal-ok-btn');
const modal = document.getElementById('setup-help-modal');

if (closeModalBtn && modal) {
  closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
}
if (modalOkBtn && modal) {
  modalOkBtn.addEventListener('click', () => modal.classList.add('hidden'));
}

initAuth();
