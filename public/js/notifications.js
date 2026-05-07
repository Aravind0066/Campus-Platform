class NotificationManager {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'Notification' in window;
    this.permission = this.supported ? Notification.permission : 'denied';
    this.lastNoticeCheck = null;
    this.pollHandle = null;
    this.isChecking = false;
  }

  async requestPermission() {
    if (!this.supported) return false;
    if (this.permission === 'granted') return true;

    try {
      this.permission = await Notification.requestPermission();
    } catch (err) {
      console.error('Error requesting notification permission:', err);
    }

    return this.permission === 'granted';
  }

  async show(title, options = {}) {
    if (!this.supported) {
      return false;
    }

    if (this.permission !== 'granted') {
      return false;
    }

    try {
      const notification = new Notification(title, {
        tag: 'campus-platform',
        requireInteraction: false,
        ...options
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      setTimeout(() => notification.close(), 5000);
      return true;
    } catch (err) {
      console.error('Error showing notification:', err);
      return false;
    }
  }

  async showNotice(title, body, priority = 'normal') {
    const icons = {
      normal: 'Notice',
      important: 'Important',
      emergency: 'Emergency'
    };

    return this.show(`${icons[priority] || 'Notice'}: ${title}`, {
      body,
      tag: `notice-${priority}`,
      requireInteraction: priority === 'emergency'
    });
  }

  async checkNewNotices() {
    if (this.permission !== 'granted' || this.isChecking || document.hidden) return;
    this.isChecking = true;

    try {
      const res = await fetch('/api/notices', { credentials: 'include' });
      const json = await res.json();

      if (json.success && json.data && json.data.length > 0) {
        const latestNotice = json.data[0];
        const noticeTime = new Date(latestNotice.created_at).getTime();

        if (!this.lastNoticeCheck || noticeTime > this.lastNoticeCheck) {
          if (this.lastNoticeCheck) {
            await this.showNotice(
              latestNotice.title,
              String(latestNotice.body || '').slice(0, 100),
              latestNotice.priority
            );
          }
          this.lastNoticeCheck = noticeTime;
        }
      }
    } catch (err) {
      console.error('Error checking notices:', err);
    } finally {
      this.isChecking = false;
    }
  }

  startPolling() {
    if (this.permission !== 'granted' || this.pollHandle) return;

    this.checkNewNotices();
    this.pollHandle = window.setInterval(() => {
      this.checkNewNotices();
    }, 30000);
  }

  stopPolling() {
    if (!this.pollHandle) return;
    window.clearInterval(this.pollHandle);
    this.pollHandle = null;
  }
}

const notificationManager = new NotificationManager();

window.CampusNoticeAlerts = {
  async enable() {
    const granted = await notificationManager.requestPermission();
    if (granted) {
      notificationManager.startPolling();
      await notificationManager.showNotice('Campus alerts enabled', 'You will now get browser alerts for new notices.');
    }

    return granted;
  },
  getPermission() {
    return notificationManager.permission;
  },
  startIfAllowed() {
    if (notificationManager.permission === 'granted') {
      notificationManager.startPolling();
    }
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    window.CampusNoticeAlerts.startIfAllowed();
  });

  window.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      notificationManager.stopPolling();
      return;
    }

    window.CampusNoticeAlerts.startIfAllowed();
  });
}
