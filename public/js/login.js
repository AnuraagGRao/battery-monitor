/**
 * VoltWatch Login Client
 * Handles Firebase Google Sign-In (Popup & Redirect) and standard password authentication
 */

let firebaseAuth = null;
let googleProvider = null;
let isFirebaseReady = false;

async function handleSuccessfulGoogleUser(user) {
  const googleBtnText = document.getElementById('google-btn-text');
  if (googleBtnText) googleBtnText.innerText = 'Authorizing session...';

  const idToken = await user.getIdToken();

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
}

// 1. Fetch server auth config and initialize Firebase
async function initAuth() {
  const googleBtn = document.getElementById('google-signin-btn');
  const googleBtnText = document.getElementById('google-btn-text');
  const errAlert = document.getElementById('error-alert');

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

        // Catch return from redirect flow if popup was blocked earlier
        const redirectResult = await firebaseAuth.getRedirectResult();
        if (redirectResult && redirectResult.user) {
          if (googleBtn) googleBtn.disabled = true;
          await handleSuccessfulGoogleUser(redirectResult.user);
          return;
        }
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
      errAlert.classList.add('hidden');

      if (!isFirebaseReady || !firebaseAuth) {
        const modal = document.getElementById('setup-help-modal');
        if (modal) modal.classList.remove('hidden');
        return;
      }

      try {
        googleBtn.disabled = true;
        googleBtnText.innerText = 'Connecting to Google...';

        // Try popup first
        const result = await firebaseAuth.signInWithPopup(googleProvider);
        await handleSuccessfulGoogleUser(result.user);
      } catch (err) {
        console.error('[GOOGLE SIGN-IN ERROR]', err);
        googleBtn.disabled = false;
        googleBtnText.innerText = 'Continue with Google';

        let message = err.message || 'Google Sign-In failed.';
        if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/popup-blocked') {
          // If browser popup blocker or policy intercepted it, switch to seamless redirect
          message = 'Popup blocked or closed by browser. Redirecting to Google login directly...';
          errAlert.innerText = message;
          errAlert.classList.remove('hidden');
          setTimeout(() => {
            firebaseAuth.signInWithRedirect(googleProvider);
          }, 800);
          return;
        } else if (err.code === 'auth/operation-not-allowed') {
          message =
            'Google provider is not enabled in Firebase Console! Go to Firebase Console ➔ Authentication ➔ Sign-in method ➔ Enable Google.';
        } else if (err.code === 'auth/unauthorized-domain') {
          message =
            `Domain "${window.location.hostname}" is not authorized in Firebase. Add it in Firebase Console ➔ Authentication ➔ Settings ➔ Authorized domains.`;
        }

        errAlert.innerText = message;
        errAlert.classList.remove('hidden');
      }
    });
  }
}



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
