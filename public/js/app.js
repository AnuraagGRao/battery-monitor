/**
 * VoltWatch Dashboard Client Application
 * Multi-user telemetry rendering, Chart.js timeline, and personal webhook management
 */

let chartInstance = null;
let currentRangeHours = 24;
let pollInterval = null;
let currentUser = null;

// Color thresholds based on requirement:
// Green > 50%, Yellow 20-50%, Red < 20%
function getBatteryColor(level) {
  if (level > 50) {
    return {
      text: 'text-emerald-400',
      hex: '#10B981',
      bg: 'bg-emerald-400',
      fillRgba: 'rgba(16, 185, 129, 0.25)',
      badgeBg: 'bg-emerald-500/15',
      badgeText: 'text-emerald-300',
      badgeBorder: 'border-emerald-500/30',
    };
  }
  if (level >= 20) {
    return {
      text: 'text-amber-400',
      hex: '#F59E0B',
      bg: 'bg-amber-400',
      fillRgba: 'rgba(245, 158, 11, 0.25)',
      badgeBg: 'bg-amber-500/15',
      badgeText: 'text-amber-300',
      badgeBorder: 'border-amber-500/30',
    };
  }
  return {
    text: 'text-rose-500',
    hex: '#F43F5E',
    bg: 'bg-rose-500',
    fillRgba: 'rgba(244, 63, 94, 0.3)',
    badgeBg: 'bg-rose-500/15',
    badgeText: 'text-rose-300',
    badgeBorder: 'border-rose-500/30',
  };
}

function getEventIcon(eventName) {
  const norm = (eventName || '').toLowerCase();
  if (norm.includes('connected')) return '🔌';
  if (norm.includes('disconnected')) return '⚡';
  if (norm.includes('full')) return '✨';
  if (norm.includes('low')) return '⚠️';
  return '🔋';
}

function formatEventTitle(eventName) {
  if (!eventName) return 'Level Update';
  return eventName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// ── API Fetcher ────────────────────────────────────────────────────────────
async function loadDashboardData() {
  const refreshIcon = document.getElementById('refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const res = await fetch(`/api/battery/stats?hours=${currentRangeHours}`, {
      headers: { Accept: 'application/json' },
    });

    if (res.status === 401 || res.redirected) {
      window.location.href = '/login';
      return;
    }

    if (!res.ok) throw new Error('Failed to fetch battery stats');

    const data = await res.json();
    updateDashboardUI(data);
  } catch (err) {
    console.error('[DASHBOARD ERROR]', err);
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

// ── UI Updates ─────────────────────────────────────────────────────────────
// ── Telemetry Badge Controller ─────────────────────────────────────────────
function updateTelemetryBadge(hasData, current) {
  const badge = document.getElementById('telemetry-status-badge');
  const dot = document.getElementById('telemetry-status-dot');
  const text = document.getElementById('telemetry-status-text');
  if (!badge || !dot || !text) return;

  if (!hasData || !current || current.battery_level === null) {
    badge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[0.65rem] font-mono uppercase font-bold bg-amber-500/10 text-amber-400 border border-amber-500/25';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400';
    text.innerText = 'Standby · Awaiting Data';
    return;
  }

  const lastRecorded = current.recorded_at ? new Date(current.recorded_at).getTime() : 0;
  const now = Date.now();
  const diffMinutes = Math.floor((now - lastRecorded) / (1000 * 60));

  if (current.is_charging) {
    badge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[0.65rem] font-mono uppercase font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 animate-pulse';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-cyan-400';
    text.innerText = 'Charging Live';
  } else if (diffMinutes <= 30) {
    badge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[0.65rem] font-mono uppercase font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse';
    text.innerText = 'Live Telemetry';
  } else if (diffMinutes <= 120) {
    badge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[0.65rem] font-mono uppercase font-bold bg-white/[0.06] text-slate-300 border border-white/10';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-400';
    text.innerText = `Idle · ${diffMinutes}m Ago`;
  } else {
    badge.className =
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[0.65rem] font-mono uppercase font-bold bg-white/[0.04] text-slate-400 border border-white/10';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-500';
    text.innerText = 'Standby';
  }
}

// ── UI Updates ─────────────────────────────────────────────────────────────
function updateDashboardUI(data) {
  const { user, current, timeline, activity, stats } = data;
  currentUser = user;

  // 0. Update User Profile & Personal Webhook Secret
  if (user) {
    const nameEl = document.getElementById('user-display-name');
    const badgeEl = document.getElementById('user-account-badge');
    const monogramEl = document.getElementById('user-monogram');
    const avatarImg = document.getElementById('user-avatar-img');
    const setupEmailEl = document.getElementById('setup-user-email');

    if (nameEl) nameEl.innerText = user.display_name || user.username || 'User';
    if (badgeEl) {
      badgeEl.innerText = user.email ? user.email : 'Personal Vault';
    }
    if (setupEmailEl && user.email) {
      setupEmailEl.innerText = user.email;
    }

    if (user.avatar_url && avatarImg) {
      avatarImg.src = user.avatar_url;
      avatarImg.classList.remove('hidden');
      if (monogramEl) monogramEl.classList.add('hidden');
    } else if (monogramEl) {
      const initial = (user.display_name || user.username || 'U')[0].toUpperCase();
      monogramEl.innerText = initial;
      monogramEl.classList.remove('hidden');
      if (avatarImg) avatarImg.classList.add('hidden');
    }

    // Personal Webhook URL & Secret display
    const secretDisplay = document.getElementById('user-webhook-secret-display');
    const quickUrlEl = document.getElementById('user-quick-url');

    if (secretDisplay) secretDisplay.innerText = user.webhook_key;
    if (quickUrlEl) {
      const origin = window.location.origin;
      quickUrlEl.innerText = `${origin}/api/webhook/battery?secret=${user.webhook_key}&level={battery_level}&event=charger_connected`;
    }
  }

  // 1. Dynamic Telemetry Status Badge
  const hasData = Boolean(data.has_data && current && current.battery_level !== null);
  updateTelemetryBadge(hasData, current);

  // 2. Hero Percent & Liquid Bar
  const heroPercent = document.getElementById('hero-percent');
  const batteryFill = document.getElementById('battery-fill');
  const chargingBadge = document.getElementById('charging-badge');
  const chargingIcon = document.getElementById('charging-icon');
  const chargingText = document.getElementById('charging-text');
  const heroDesc = document.getElementById('hero-status-desc');
  const heroUpdated = document.getElementById('hero-updated-at');

  if (!hasData) {
    if (heroPercent) {
      heroPercent.innerText = '--%';
      heroPercent.className = 'text-6xl font-extrabold tracking-tight font-mono text-slate-500';
    }
    if (batteryFill) {
      batteryFill.style.width = '0%';
      batteryFill.style.backgroundColor = '#64748b';
    }
    if (chargingBadge) {
      chargingBadge.className =
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-white/[0.05] text-slate-400 border border-white/10';
    }
    if (chargingIcon) chargingIcon.innerText = '📡';
    if (chargingText) chargingText.innerText = 'Standby';
    if (heroDesc) {
      heroDesc.innerText = 'Awaiting first reading';
      heroDesc.className = 'text-xs font-semibold uppercase tracking-wider text-slate-400';
    }
    if (heroUpdated) heroUpdated.innerText = 'Connect phone webhook to stream';
  } else {
    const colors = getBatteryColor(current.battery_level);
    if (heroPercent) {
      heroPercent.innerText = `${current.battery_level}%`;
      heroPercent.className = `text-6xl font-extrabold tracking-tight font-mono ${colors.text}`;
    }
    if (batteryFill) {
      batteryFill.style.width = `${Math.max(4, current.battery_level)}%`;
      batteryFill.style.backgroundColor = colors.hex;
      batteryFill.style.color = colors.hex;
    }

    const heroEta = document.getElementById('hero-charge-eta');
    if (current.is_charging) {
      if (chargingBadge) {
        chargingBadge.className =
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse';
      }
      if (chargingIcon) chargingIcon.innerText = '⚡';
      if (chargingText) chargingText.innerText = 'Charging';
      if (heroDesc) {
        heroDesc.innerText = 'AC / Fast Power';
        heroDesc.className = 'text-xs font-semibold uppercase tracking-wider text-amber-300';
      }
      if (heroEta) {
        if (current.time_to_full && current.time_to_full > 0) {
          const totalMin = Math.round(current.time_to_full / 60);
          const hrs = Math.floor(totalMin / 60);
          const mins = totalMin % 60;
          const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
          heroEta.innerText = `⚡ ~${timeStr} to full`;
          heroEta.classList.remove('hidden');
        } else {
          heroEta.classList.add('hidden');
        }
      }
    } else {
      if (chargingBadge) {
        chargingBadge.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold ${colors.badgeBg} ${colors.badgeText} border ${colors.badgeBorder}`;
      }
      if (chargingIcon) chargingIcon.innerText = getEventIcon(current.event);
      if (chargingText) chargingText.innerText = formatEventTitle(current.event);
      if (heroDesc) {
        heroDesc.innerText = 'Discharging';
        heroDesc.className = 'text-xs font-semibold uppercase tracking-wider text-slate-300';
      }
      if (heroEta) heroEta.classList.add('hidden');
    }

    if (heroUpdated) {
      const d = new Date(current.recorded_at);
      heroUpdated.innerText = isNaN(d.getTime()) ? 'Just now' : d.toLocaleTimeString();
    }
  }

  // 2. Daily Stats
  const statCycles = document.getElementById('stat-cycles');
  const statChargingCount = document.getElementById('stat-charging-count');
  const statMinLevel = document.getElementById('stat-min-level');
  const statMaxLevel = document.getElementById('stat-max-level');
  const statTotalLogs = document.getElementById('stat-total-logs');

  if (statCycles) statCycles.innerText = stats.cycles_today.toFixed(2);
  if (statChargingCount) statChargingCount.innerText = stats.charging_sessions;
  if (statMinLevel) statMinLevel.innerText = `${stats.min_level}%`;
  if (statMaxLevel) statMaxLevel.innerText = `${stats.max_level}%`;
  if (statTotalLogs) statTotalLogs.innerText = stats.total_logs_today;

  // 3. Render Chart
  renderTimelineChart(timeline);

  // 4. Render Activity Feed
  renderActivityFeed(activity);
}

// ── Chart.js Spline Curve ──────────────────────────────────────────────────
function renderTimelineChart(timeline) {
  const ctx = document.getElementById('batteryChart');
  if (!ctx) return;

  const labels = timeline.map((item) => {
    const d = new Date(item.recorded_at);
    return isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const levels = timeline.map((item) => item.battery_level);
  const events = timeline.map((item) => item.event);

  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = levels;
    chartInstance.data.datasets[0].customEvents = events;
    chartInstance.update();
    return;
  }

  const canvasContext = ctx.getContext('2d');
  const gradient = canvasContext.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
  gradient.addColorStop(0.7, 'rgba(16, 185, 129, 0.05)');
  gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Battery Level (%)',
          data: levels,
          customEvents: events,
          borderColor: '#10B981',
          borderWidth: 2.5,
          tension: 0.38,
          pointRadius: levels.length > 30 ? 1.5 : 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10B981',
          pointBorderColor: '#0B0D11',
          pointBorderWidth: 2,
          fill: true,
          backgroundColor: gradient,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleFont: { family: '"JetBrains Mono"', size: 12 },
          bodyFont: { family: '"Plus Jakarta Sans"', size: 13, weight: 600 },
          borderColor: 'rgba(255, 255, 255, 0.12)',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (context) => {
              const event = context.dataset.customEvents?.[context.dataIndex] || '';
              return `🔋 ${context.parsed.y}% · ${formatEventTitle(event)}`;
            },
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawBorder: false,
          },
          ticks: {
            color: '#889096',
            font: { family: '"JetBrains Mono"', size: 11 },
            stepSize: 20,
            callback: (value) => `${value}%`,
          },
        },
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: '#889096',
            font: { family: '"JetBrains Mono"', size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
        },
      },
    },
  });
}

// ── Activity Feed Timeline ─────────────────────────────────────────────────
function renderActivityFeed(activity) {
  const container = document.getElementById('activity-feed');
  const countBadge = document.getElementById('feed-count-badge');
  if (!container) return;

  if (countBadge) countBadge.innerText = `${activity.length} events`;

  if (activity.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-xs font-mono text-slate-500 space-y-3">
        <p>No telemetry events recorded yet.</p>
        <button id="feed-open-setup-btn" class="px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 transition cursor-pointer">
          📲 Open Phone Setup Guide
        </button>
      </div>
    `;
    document.getElementById('feed-open-setup-btn')?.addEventListener('click', () => {
      document.getElementById('open-setup-btn')?.click();
    });
    return;
  }

  container.innerHTML = activity
    .map((item) => {
      const colors = getBatteryColor(item.battery_level);
      const icon = getEventIcon(item.event);
      const title = formatEventTitle(item.event);
      const date = new Date(item.recorded_at);
      const timeStr = isNaN(date.getTime())
        ? 'Recent'
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const etaBadge = item.time_to_full && item.time_to_full > 0
        ? `<span class="text-[0.62rem] font-mono text-cyan-400 font-medium">⚡ ~${Math.round(item.time_to_full / 60)}m to full</span>`
        : '';

      return `
        <div class="flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-white/5 flex items-center justify-center text-xs">
              ${icon}
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-semibold text-slate-200">${title}</span>
                ${etaBadge}
              </div>
              <span class="text-[0.65rem] font-mono text-slate-500">${timeStr}</span>
            </div>
          </div>
          <div class="text-right">
            <span class="text-xs font-mono font-bold ${colors.text}">${item.battery_level}%</span>
          </div>
        </div>
      `;
    })
    .join('');
}

// ── Event Handlers & Initializers ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial Data Fetch & 15-second background auto-refresh
  loadDashboardData();
  pollInterval = setInterval(loadDashboardData, 15000);

  // Clear Feed Button
  const clearFeedBtn = document.getElementById('clear-feed-btn');
  if (clearFeedBtn) {
    clearFeedBtn.addEventListener('click', async () => {
      if (!confirm('Clear all battery telemetry history and start fresh?')) return;
      try {
        clearFeedBtn.disabled = true;
        clearFeedBtn.innerText = '...';
        const res = await fetch('/api/battery/clear', { method: 'POST' });
        if (res.ok) {
          await loadDashboardData();
        }
      } catch (err) {
        console.error('Failed to clear feed', err);
      } finally {
        clearFeedBtn.disabled = false;
        clearFeedBtn.innerText = 'Clear';
      }
    });
  }

  // 2. Manual Refresh
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDashboardData();
    });
  }

  // 3. Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  // 4. Time Range Filter Buttons
  const rangeBtns = document.querySelectorAll('.range-btn');
  rangeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      rangeBtns.forEach((b) => {
        b.classList.remove('active-range', 'text-emerald-400', 'bg-emerald-500/15', 'font-bold');
        b.classList.add('text-slate-400');
      });
      btn.classList.add('active-range', 'text-emerald-400', 'bg-emerald-500/15', 'font-bold');
      btn.classList.remove('text-slate-400');

      currentRangeHours = parseInt(btn.dataset.hours, 10);
      loadDashboardData();
    });
  });

  // 5. Setup Modal (On-Demand Guide)
  const openSetupBtn = document.getElementById('open-setup-btn');
  const closeSetupModalBtn = document.getElementById('close-setup-modal-btn');
  const modalCloseDoneBtn = document.getElementById('modal-close-done-btn');
  const setupModal = document.getElementById('setup-modal');

  const openSetup = () => {
    if (setupModal) setupModal.classList.remove('hidden');
  };
  const closeSetup = () => {
    if (setupModal) setupModal.classList.add('hidden');
  };

  if (openSetupBtn) openSetupBtn.addEventListener('click', openSetup);
  if (closeSetupModalBtn) closeSetupModalBtn.addEventListener('click', closeSetup);
  if (modalCloseDoneBtn) modalCloseDoneBtn.addEventListener('click', closeSetup);

  if (setupModal) {
    setupModal.addEventListener('click', (e) => {
      if (e.target === setupModal) closeSetup();
    });
  }

  // 6. Custom Secret Key Editing in Setup Modal
  const editKeyToggleBtn = document.getElementById('edit-key-toggle-btn');
  const customKeyRow = document.getElementById('custom-key-row');
  const customKeyInput = document.getElementById('custom-key-input');
  const saveCustomKeyBtn = document.getElementById('save-custom-key-btn');
  const cancelCustomKeyBtn = document.getElementById('cancel-custom-key-btn');

  if (editKeyToggleBtn && customKeyRow) {
    editKeyToggleBtn.addEventListener('click', () => {
      customKeyRow.classList.toggle('hidden');
      if (!customKeyRow.classList.contains('hidden') && customKeyInput && currentUser) {
        customKeyInput.value = currentUser.webhook_key || '';
        customKeyInput.focus();
      }
    });
  }

  if (cancelCustomKeyBtn && customKeyRow) {
    cancelCustomKeyBtn.addEventListener('click', () => {
      customKeyRow.classList.add('hidden');
    });
  }

  if (saveCustomKeyBtn && customKeyInput) {
    saveCustomKeyBtn.addEventListener('click', async () => {
      const newKey = customKeyInput.value.trim();
      if (newKey.length < 8) {
        alert('Webhook secret key must be at least 8 characters.');
        return;
      }

      try {
        saveCustomKeyBtn.disabled = true;
        saveCustomKeyBtn.innerText = 'Saving...';

        const res = await fetch('/api/user/set-webhook-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webhook_key: newKey }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          currentUser.webhook_key = data.webhook_key;
          const secretDisplay = document.getElementById('user-webhook-secret-display');
          if (secretDisplay) secretDisplay.innerText = data.webhook_key;
          const quickUrlEl = document.getElementById('user-quick-url');
          if (quickUrlEl) {
            const origin = window.location.origin;
            quickUrlEl.innerText = `${origin}/api/webhook/battery?secret=${data.webhook_key}&level={battery_level}&event=charger_connected`;
          }
          if (customKeyRow) customKeyRow.classList.add('hidden');
          alert('Webhook secret saved! Your phone automation can now ping using this key.');
        } else {
          alert(data.error || 'Failed to update key.');
        }
      } catch (err) {
        alert('Network error saving custom key.');
      } finally {
        saveCustomKeyBtn.disabled = false;
        saveCustomKeyBtn.innerText = 'Save';
      }
    });
  }

  // 7. Personal Webhook Key Actions (Copy & Rotate)
  const copySecretBtn = document.getElementById('copy-secret-btn');
  if (copySecretBtn) {
    copySecretBtn.addEventListener('click', () => {
      if (!currentUser?.webhook_key) return;
      navigator.clipboard.writeText(currentUser.webhook_key);
      const original = copySecretBtn.innerText;
      copySecretBtn.innerText = 'Copied!';
      copySecretBtn.classList.add('text-emerald-400');
      setTimeout(() => {
        copySecretBtn.innerText = original;
        copySecretBtn.classList.remove('text-emerald-400');
      }, 2000);
    });
  }

  const copyUrlBtn = document.getElementById('copy-url-btn');
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
      const urlText = document.getElementById('user-quick-url')?.innerText;
      if (!urlText) return;
      navigator.clipboard.writeText(urlText);
      const original = copyUrlBtn.innerText;
      copyUrlBtn.innerText = 'Copied!';
      setTimeout(() => {
        copyUrlBtn.innerText = original;
      }, 2000);
    });
  }

  const rotateKeyBtn = document.getElementById('rotate-key-btn');
  if (rotateKeyBtn) {
    rotateKeyBtn.addEventListener('click', async () => {
      const confirmed = confirm(
        'Rotate your private webhook key? Your old key will stop accepting requests and you will need to update your phone automation.'
      );
      if (!confirmed) return;

      try {
        rotateKeyBtn.disabled = true;
        rotateKeyBtn.innerText = 'Rotating...';

        const res = await fetch('/api/user/regenerate-webhook-key', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          currentUser.webhook_key = data.webhook_key;
          document.getElementById('user-webhook-secret-display').innerText = data.webhook_key;
          const origin = window.location.origin;
          document.getElementById('user-quick-url').innerText =
            `${origin}/api/webhook/battery?secret=${data.webhook_key}&level={battery_level}&event=charger_connected`;
          alert('Webhook key rotated successfully! Update your Android automation action with the new key.');
        } else {
          alert('Failed to rotate key.');
        }
      } catch (err) {
        alert('Network error rotating key.');
      } finally {
        rotateKeyBtn.disabled = false;
        rotateKeyBtn.innerText = 'Rotate Key';
      }
    });
  }

  // 8. Simulator Modal
  const openSimBtn = document.getElementById('open-sim-btn');
  const closeSimBtn = document.getElementById('close-sim-btn');
  const simModal = document.getElementById('sim-modal');
  const simForm = document.getElementById('sim-form');
  const simSlider = document.getElementById('sim-slider');
  const simLevelVal = document.getElementById('sim-level-val');

  if (openSimBtn && simModal) {
    openSimBtn.addEventListener('click', () => simModal.classList.remove('hidden'));
  }
  if (closeSimBtn && simModal) {
    closeSimBtn.addEventListener('click', () => simModal.classList.add('hidden'));
  }

  if (simModal) {
    simModal.addEventListener('click', (e) => {
      if (e.target === simModal) simModal.classList.add('hidden');
    });
  }

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (setupModal && !setupModal.classList.contains('hidden')) closeSetup();
      if (simModal && !simModal.classList.contains('hidden')) simModal.classList.add('hidden');
    }
  });

  if (simSlider && simLevelVal) {
    simSlider.addEventListener('input', (e) => {
      simLevelVal.innerText = `${e.target.value}%`;
    });
  }

  if (simForm) {
    simForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const level = parseInt(simSlider.value, 10);
      const event = document.getElementById('sim-event-select').value;

      try {
        const res = await fetch('/api/battery/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ battery_level: level, event }),
        });

        if (res.ok) {
          if (simModal) simModal.classList.add('hidden');
          await loadDashboardData();
        } else {
          alert('Failed to simulate battery event.');
        }
      } catch (err) {
        console.error('[SIMULATE ERROR]', err);
      }
    });
  }
});
