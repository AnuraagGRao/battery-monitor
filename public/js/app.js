/**
 * VoltWatch Dashboard Client Application
 * Chart.js timeline rendering, live stats polling, and simulator modal
 */

let chartInstance = null;
let currentRangeHours = 24;
let pollInterval = null;

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

// ── API Fetcher ────────────────────────────────────────────────────────────
async function loadDashboardData() {
  const refreshIcon = document.getElementById('refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const res = await fetch(`/api/battery/stats?hours=${currentRangeHours}`, {
      headers: { 'Accept': 'application/json' },
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
function updateDashboardUI(data) {
  const { current, timeline, activity, stats } = data;
  const colors = getBatteryColor(current.battery_level);

  // 1. Hero Percent & Liquid Bar
  const heroPercent = document.getElementById('hero-percent');
  heroPercent.innerText = `${current.battery_level}%`;
  heroPercent.className = `text-6xl font-extrabold tracking-tight font-mono ${colors.text}`;

  const batteryFill = document.getElementById('battery-fill');
  batteryFill.style.width = `${Math.max(4, current.battery_level)}%`;
  batteryFill.style.backgroundColor = colors.hex;
  batteryFill.style.color = colors.hex;

  // Charging indicator badge
  const chargingBadge = document.getElementById('charging-badge');
  const chargingIcon = document.getElementById('charging-icon');
  const chargingText = document.getElementById('charging-text');
  const heroDesc = document.getElementById('hero-status-desc');

  if (current.is_charging) {
    chargingBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 is-charging-indicator';
    chargingIcon.innerText = '⚡';
    chargingText.innerText = 'Charging';
    heroDesc.innerText = 'Power Connected';
  } else {
    chargingBadge.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold ${colors.badgeBg} ${colors.badgeText} border ${colors.badgeBorder}`;
    chargingIcon.innerText = current.battery_level <= 20 ? '🪫' : '🔋';
    chargingText.innerText = current.battery_level <= 20 ? 'Battery Low' : 'Discharging';
    heroDesc.innerText = 'On Battery';
  }

  const updatedDate = new Date(current.recorded_at);
  document.getElementById('hero-updated-at').innerText = updatedDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // 2. Daily Insights
  document.getElementById('cycle-count').innerText = stats.cycles_today.toFixed(2);
  document.getElementById('min-max-today').innerText = `${stats.min_level}% / ${stats.max_level}%`;
  document.getElementById('sessions-count').innerText = `${stats.charging_sessions} times`;

  // 3. Last Event Pill
  document.getElementById('last-event-icon').innerText = getEventIcon(current.event);
  document.getElementById('last-event-name').innerText = current.event.replace(/_/g, ' ');
  document.getElementById('last-event-time').innerText = `Recorded at ${updatedDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })} · ${updatedDate.toLocaleDateString()}`;

  // 4. Activity Feed
  renderActivityFeed(activity);

  // 5. Timeline Chart
  renderTimelineChart(timeline);
}

// ── Render Activity Feed ───────────────────────────────────────────────────
function renderActivityFeed(items) {
  const container = document.getElementById('activity-feed');
  const badge = document.getElementById('feed-count-badge');

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-xs font-mono text-[#889096]">
        No battery events recorded yet.
      </div>
    `;
    badge.innerText = '0 events';
    return;
  }

  badge.innerText = `${items.length} recent`;

  container.innerHTML = items
    .map((item) => {
      const colors = getBatteryColor(item.battery_level);
      const icon = getEventIcon(item.event);
      const d = new Date(item.recorded_at);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

      return `
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="text-base select-none shrink-0">${icon}</span>
            <div class="min-w-0">
              <div class="text-xs font-semibold text-[#ECEDEE] capitalize truncate">
                ${item.event.replace(/_/g, ' ')}
              </div>
              <div class="text-[0.68rem] font-mono text-[#889096] truncate">
                ${dateStr} · ${timeStr}
              </div>
            </div>
          </div>
          <span class="text-xs font-mono font-bold shrink-0 ml-3 ${colors.text}">
            ${item.battery_level}%
          </span>
        </div>
      `;
    })
    .join('');
}

// ── Render Chart.js Curve ──────────────────────────────────────────────────
function renderTimelineChart(timeline) {
  const ctx = document.getElementById('batteryChart').getContext('2d');

  if (!timeline || timeline.length === 0) {
    if (chartInstance) chartInstance.destroy();
    return;
  }

  const labels = timeline.map((p) => {
    const d = new Date(p.recorded_at);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const dataPoints = timeline.map((p) => p.battery_level);
  const events = timeline.map((p) => p.event);

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
  gradient.addColorStop(0.7, 'rgba(16, 185, 129, 0.08)');
  gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Battery Level (%)',
          data: dataPoints,
          fill: true,
          backgroundColor: gradient,
          borderColor: '#10B981',
          borderWidth: 2.5,
          tension: 0.35, // Smooth spline
          pointRadius: dataPoints.length > 40 ? 1.5 : 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10B981',
          pointBorderColor: '#08090D',
          pointBorderWidth: 1.5,
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
          backgroundColor: 'rgba(15, 16, 18, 0.95)',
          titleColor: '#ECEDEE',
          bodyColor: '#10B981',
          titleFont: { family: 'JetBrains Mono', size: 11 },
          bodyFont: { family: 'JetBrains Mono', size: 13, weight: 'bold' },
          borderColor: 'rgba(255, 255, 255, 0.12)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 12,
          displayColors: false,
          callbacks: {
            label: function (context) {
              const idx = context.dataIndex;
              const eventName = events[idx] ? events[idx].replace(/_/g, ' ') : '';
              return `${context.parsed.y}% · [${eventName}]`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#64748B',
            font: { family: 'JetBrains Mono', size: 10 },
            maxTicksLimit: 8,
          },
        },
        y: {
          min: 0,
          max: 100,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: '#64748B',
            font: { family: 'JetBrains Mono', size: 10 },
            stepSize: 25,
            callback: (val) => `${val}%`,
          },
        },
      },
    },
  });
}

// ── Event Handlers ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDashboardData();

  // Auto-refresh every 30 seconds
  pollInterval = setInterval(loadDashboardData, 30000);

  // Manual refresh button
  document.getElementById('refresh-btn').addEventListener('click', loadDashboardData);

  // Range Selector Buttons (6H, 12H, 24H, 3D, 7D)
  const rangeBtns = document.querySelectorAll('.range-btn');
  rangeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      rangeBtns.forEach((b) => {
        b.className = 'range-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer';
      });
      btn.className = 'range-btn px-2.5 py-1 rounded-lg bg-emerald-500 text-black font-bold shadow transition cursor-pointer';
      currentRangeHours = parseInt(btn.dataset.hours, 10);
      loadDashboardData();
    });
  });

  // Logout button
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // Simulator Modal Controls
  const modal = document.getElementById('sim-modal');
  const openModalBtn = document.getElementById('open-sim-btn');
  const closeModalBtn = document.getElementById('close-sim-btn');
  const slider = document.getElementById('sim-slider');
  const sliderVal = document.getElementById('sim-level-val');
  const simForm = document.getElementById('sim-form');

  openModalBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
  });

  closeModalBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  slider.addEventListener('input', (e) => {
    sliderVal.innerText = `${e.target.value}%`;
  });

  simForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const battery_level = parseInt(slider.value, 10);
    const event = document.getElementById('sim-event-select').value;

    try {
      const res = await fetch('/api/battery/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battery_level, event }),
      });

      if (res.ok) {
        modal.classList.add('hidden');
        await loadDashboardData();
      }
    } catch (err) {
      console.error('Simulation error:', err);
    }
  });
});
