(function () {
  async function syncAdminLink() {
    const adminLink = document.getElementById('adminLink');
    if (!adminLink) return;

    if (window.CampusSession) {
      const user = await window.CampusSession.fetchCurrentUser();
      adminLink.style.display = user?.role === 'admin' ? 'inline' : 'none';
      return;
    }

    const userRole = localStorage.getItem('userRole');
    adminLink.style.display = userRole === 'admin' ? 'inline' : 'none';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncAdminLink);
  } else {
    syncAdminLink();
  }
})();
