'use strict';

(() => {
  const API_BASE = document.querySelector('meta[name="api-base"]')?.content?.trim() || '';
  const STORAGE_KEY = 'siakad_rpl_token';
  const SESSION_KEY = 'siakad_rpl_session_token';

  const state = {
    token: localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(SESSION_KEY) || '',
    user: null,
    config: {
      academicYear: '2025/2026',
      activeSemesters: ['6', '8'],
      serverTime: '',
      timezone: 'Asia/Jakarta'
    },
    users: [],
    courses: [],
    schedules: [],
    attendance: [],
    exams: [],
    responses: [],
    questions: [],
    studentExams: [],
    studentSchedules: [],
    examStateFilter: 'ALL',
    currentExam: null,
    examTimerId: null,
    confirmResolver: null
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindStaticEvents();
    updateCopyright();
    startClock();
    refreshIcons();

    // Tampilkan halaman login segera agar preview tidak berhenti pada loader
    // ketika koneksi ke Apps Script lambat atau diblokir oleh preview browser.
    if (!state.token) showLogin();

    try {
      const health = await api('health', {}, 'GET');
      applyHealth(health.data || {});
    } catch (error) {
      console.warn('Health check gagal:', error);
      toast('Koneksi backend belum siap', error.message, 'warning', 7000);
    }

    if (state.token) {
      try {
        const response = await api('auth.me', { token: state.token });
        state.user = response.data.user;
        await enterApplication();
        return;
      } catch (error) {
        clearSession();
      }
    }

    showLogin();
  }

  /* ========================================================
     API DAN SESSION
     ======================================================== */

  async function api(action, payload = {}, method = 'POST') {
    if (!API_BASE) throw new Error('URL Google Apps Script belum dipasang pada index.html.');

    let response;
    if (method === 'GET') {
      const url = new URL(API_BASE);
      url.searchParams.set('action', action);
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== '' && value != null) url.searchParams.set(key, String(value));
      });
      url.searchParams.set('_', Date.now().toString());
      response = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    } else {
      response = await fetch(API_BASE, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload })
      });
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('Respons backend tidak dapat dibaca. Pastikan deployment Apps Script memakai akses Anyone.');
    }

    if (!response.ok || !result.success) {
      const message = result?.message || `Permintaan gagal (${response.status}).`;
      if (/sesi|login/i.test(message) && action !== 'auth.login') {
        clearSession();
        showLogin();
      }
      throw new Error(message);
    }

    if (result.serverTime) state.config.serverTime = result.serverTime;
    return result;
  }

  function saveSession(token, remember) {
    clearSession();
    state.token = token;
    if (remember) localStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.setItem(SESSION_KEY, token);
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    state.token = '';
    state.user = null;
    stopExamTimer();
  }

  async function logout() {
    try {
      if (state.token) await api('auth.logout', { token: state.token });
    } catch (error) {
      console.warn(error);
    } finally {
      clearSession();
      showLogin();
      toast('Berhasil keluar', 'Sesi akun telah ditutup.', 'success');
    }
  }

  /* ========================================================
     INIT UI
     ======================================================== */

  function applyHealth(data) {
    state.config = {
      ...state.config,
      academicYear: data.academicYear || state.config.academicYear,
      activeSemesters: Array.isArray(data.activeSemesters) && data.activeSemesters.length
        ? data.activeSemesters.map(String)
        : state.config.activeSemesters,
      serverTime: data.serverTime || state.config.serverTime,
      timezone: data.timezone || state.config.timezone
    };

    text('loginAcademicYear', state.config.academicYear);
    text('dashboardAcademicYear', state.config.academicYear);
    text('dashboardActiveSemesters', state.config.activeSemesters.join(' dan '));
    populateSemesterSelects();
  }

  function showLogin() {
    $('appLoader').hidden = true;
    $('appShell').hidden = true;
    $('loginPage').hidden = false;
    $('loginPassword').value = '';
    setTimeout(() => $('loginIdentifier')?.focus(), 100);
    refreshIcons();
  }

  async function enterApplication() {
    $('appLoader').hidden = true;
    $('loginPage').hidden = true;
    $('appShell').hidden = false;
    configureUserUI();
    showPage('dashboard');
    await loadDashboard();
    refreshIcons();
  }

  function configureUserUI() {
    const user = state.user || {};
    const isAdmin = user.ROLE === 'ADMIN';
    const name = user.NAME || user.USERNAME || 'Pengguna';
    const initial = name.trim().charAt(0) || 'P';
    const roleLabel = isAdmin ? 'Administrator' : 'Mahasiswa';
    const detail = isAdmin ? 'Akses penuh sistem' : `NIM ${user.NIM || '-'} • Semester ${user.SEMESTER || '-'}`;

    ['sidebarAvatar', 'topbarAvatar'].forEach((id) => text(id, initial));
    ['sidebarUserName', 'topbarUserName'].forEach((id) => text(id, name));
    ['sidebarUserRole', 'topbarUserRole'].forEach((id) => text(id, roleLabel));
    text('sidebarUserDetail', detail);
    text('welcomeName', name);
    text('welcomeMessage', isAdmin
      ? 'Kelola data mahasiswa, jadwal, absensi, serta UTS dan UAS dari satu dashboard.'
      : 'Lihat jadwal kuliah, isi absensi, dan kerjakan ujian sesuai waktu yang ditentukan.');

    $('adminNavigation').hidden = !isAdmin;
    $('studentNavigation').hidden = isAdmin;
    $('adminDashboard').hidden = !isAdmin;
    $('studentDashboard').hidden = isAdmin;
    $$('.student-only').forEach((el) => { el.hidden = isAdmin; });

    if (!isAdmin) fillProfile();
  }

  function populateSemesterSelects() {
    const ids = [
      'userSemesterFilter', 'courseSemesterFilter', 'scheduleSemesterFilter',
      'attendanceSemesterFilter', 'examSemesterFilter', 'userSemester',
      'courseSemester', 'scheduleSemester', 'examSemester'
    ];

    ids.forEach((id) => {
      const select = $(id);
      if (!select) return;
      const current = select.value;
      const placeholder = select.options[0]?.outerHTML || '<option value="">Pilih semester</option>';
      select.innerHTML = placeholder + state.config.activeSemesters
        .map((semester) => `<option value="${escapeHtml(semester)}">Semester ${escapeHtml(semester)}</option>`)
        .join('');
      if (state.config.activeSemesters.includes(current)) select.value = current;
    });
  }

  function bindStaticEvents() {
    $('loginForm')?.addEventListener('submit', handleLogin);
    $('toggleLoginPassword')?.addEventListener('click', () => togglePassword('loginPassword'));
    $$('.password-toggle').forEach((button) => {
      button.addEventListener('click', () => togglePassword(button.dataset.passwordTarget));
    });

    $('sidebarLogoutButton')?.addEventListener('click', logout);
    $('topbarLogoutButton')?.addEventListener('click', logout);
    $('sidebarOpenButton')?.addEventListener('click', openSidebar);
    $('sidebarCloseButton')?.addEventListener('click', closeSidebar);
    $('sidebarBackdrop')?.addEventListener('click', closeSidebar);

    $('userMenuButton')?.addEventListener('click', () => {
      const dropdown = $('userMenuDropdown');
      dropdown.hidden = !dropdown.hidden;
      $('userMenuButton').setAttribute('aria-expanded', String(!dropdown.hidden));
    });

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeTopModal();
    });

    $('refreshUsersButton')?.addEventListener('click', loadUsers);
    $('userSemesterFilter')?.addEventListener('change', loadUsers);
    $('userStatusFilter')?.addEventListener('change', renderUsers);
    $('userSearch')?.addEventListener('input', debounce(renderUsers, 180));

    $('refreshCoursesButton')?.addEventListener('click', loadCourses);
    $('courseSemesterFilter')?.addEventListener('change', loadCourses);
    $('courseSearch')?.addEventListener('input', debounce(renderCourses, 180));

    $('refreshSchedulesButton')?.addEventListener('click', loadSchedules);
    $('scheduleSemesterFilter')?.addEventListener('change', loadSchedules);
    $('scheduleDayFilter')?.addEventListener('change', loadSchedules);

    $('refreshAttendanceButton')?.addEventListener('click', loadAttendance);
    $('exportAttendanceButton')?.addEventListener('click', exportAttendanceCsv);

    $('refreshExamsButton')?.addEventListener('click', loadAdminExams);
    $('examSemesterFilter')?.addEventListener('change', loadAdminExams);
    $('examTypeFilter')?.addEventListener('change', loadAdminExams);

    $('refreshGradingButton')?.addEventListener('click', loadResponses);
    $('gradingExamFilter')?.addEventListener('change', loadResponses);
    $('gradingStatusFilter')?.addEventListener('change', loadResponses);

    $('studentScheduleDate')?.addEventListener('change', loadStudentSchedule);
    $('previousScheduleDate')?.addEventListener('click', () => shiftScheduleDate(-1));
    $('nextScheduleDate')?.addEventListener('click', () => shiftScheduleDate(1));
    $('todayScheduleButton')?.addEventListener('click', () => {
      $('studentScheduleDate').value = todayJakarta();
      loadStudentSchedule();
    });

    $('refreshStudentExamsButton')?.addEventListener('click', loadStudentExams);
    $$('.exam-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.examStateFilter = tab.dataset.examStateFilter;
        $$('.exam-tab').forEach((item) => item.classList.toggle('is-active', item === tab));
        renderStudentExams();
      });
    });

    $('userForm')?.addEventListener('submit', saveUser);
    $('courseForm')?.addEventListener('submit', saveCourse);
    $('scheduleForm')?.addEventListener('submit', saveSchedule);
    $('examForm')?.addEventListener('submit', saveExam);
    $('questionForm')?.addEventListener('submit', saveQuestion);
    $('gradingForm')?.addEventListener('submit', saveGrade);
    $('attendanceForm')?.addEventListener('submit', submitAttendance);
    $('examAnswerForm')?.addEventListener('submit', submitExam);

    $('questionType')?.addEventListener('change', toggleQuestionFields);
    $('resetQuestionButton')?.addEventListener('click', resetQuestionForm);
    $('refreshQuestionsButton')?.addEventListener('click', loadQuestions);
    $('gradingManualScore')?.addEventListener('input', updateGradingPreview);

    $('scheduleCourse')?.addEventListener('change', syncCourseSemesterForSchedule);
    $('examCourse')?.addEventListener('change', syncCourseSemesterForExam);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const button = $('loginButton');
    setLoading(button, true, 'Memproses...');
    try {
      const result = await api('auth.login', {
        identifier: $('loginIdentifier').value.trim(),
        password: $('loginPassword').value
      });
      saveSession(result.data.token, $('rememberSession').checked);
      state.user = result.data.user;
      toast('Login berhasil', `Selamat datang, ${state.user.NAME || state.user.USERNAME}.`, 'success');
      await enterApplication();
    } catch (error) {
      toast('Login gagal', error.message, 'error');
      $('loginPassword').select();
    } finally {
      setLoading(button, false);
    }
  }

  /* ========================================================
     NAVIGASI
     ======================================================== */

  async function showPage(page) {
    const isAdmin = state.user?.ROLE === 'ADMIN';
    const adminPages = ['dashboard', 'users', 'courses', 'schedules', 'attendance-admin', 'exams-admin', 'grading'];
    const studentPages = ['dashboard', 'attendance-student', 'exams-student', 'profile', 'exam-room'];
    if ((isAdmin && !adminPages.includes(page)) || (!isAdmin && !studentPages.includes(page))) return;

    $$('.app-page').forEach((section) => {
      const active = section.dataset.page === page;
      section.hidden = !active;
      section.classList.toggle('is-active', active);
    });
    $$('[data-page-link]').forEach((link) => link.classList.toggle('is-active', link.dataset.pageLink === page));

    const titles = {
      dashboard: ['Dashboard', 'SIAKAD RPL'],
      users: ['Data Mahasiswa', 'Administrasi Akun'],
      courses: ['Mata Kuliah', 'Data Akademik'],
      schedules: ['Jadwal Perkuliahan', 'Pengaturan Waktu'],
      'attendance-admin': ['Rekap Absensi', 'Kehadiran Mahasiswa'],
      'exams-admin': ['UTS dan UAS', 'Pengelolaan Ujian'],
      grading: ['Penilaian Ujian', 'Hasil Pengerjaan'],
      'attendance-student': ['Jadwal dan Absensi', 'Perkuliahan'],
      'exams-student': ['UTS dan UAS', 'Ujian Mahasiswa'],
      profile: ['Profil Saya', 'Informasi Akun'],
      'exam-room': ['Ruang Ujian', 'Pengerjaan Soal']
    };
    text('pageTitle', titles[page]?.[0] || 'SIAKAD RPL');
    text('pageEyebrow', titles[page]?.[1] || 'SIAKAD RPL');
    closeSidebar();
    $('userMenuDropdown').hidden = true;

    try {
      if (page === 'dashboard') await loadDashboard();
      else if (page === 'users') await loadUsers();
      else if (page === 'courses') await loadCourses();
      else if (page === 'schedules') await loadSchedules();
      else if (page === 'attendance-admin') await prepareAttendancePage();
      else if (page === 'exams-admin') await loadAdminExams();
      else if (page === 'grading') await prepareGradingPage();
      else if (page === 'attendance-student') await loadStudentSchedule();
      else if (page === 'exams-student') await loadStudentExams();
      else if (page === 'profile') fillProfile();
    } catch (error) {
      toast('Gagal memuat halaman', error.message, 'error');
    }
  }

  function openSidebar() {
    $('sidebar').classList.add('is-open');
    $('sidebarBackdrop').hidden = false;
  }

  function closeSidebar() {
    $('sidebar').classList.remove('is-open');
    $('sidebarBackdrop').hidden = true;
  }

  function handleDocumentClick(event) {
    const pageLink = event.target.closest('[data-page-link]');
    if (pageLink) {
      event.preventDefault();
      showPage(pageLink.dataset.pageLink);
      return;
    }

    const openButton = event.target.closest('[data-open-modal]');
    if (openButton) {
      openEntityModal(openButton.dataset.openModal);
      return;
    }

    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) {
      closeModal(closeButton.dataset.closeModal);
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (actionButton) handleDynamicAction(actionButton);

    if (!event.target.closest('.user-menu')) $('userMenuDropdown').hidden = true;
  }

  async function handleDynamicAction(button) {
    const { action, id } = button.dataset;
    try {
      if (action === 'edit-user') editUser(id);
      if (action === 'delete-user') await deleteUser(id);
      if (action === 'edit-course') editCourse(id);
      if (action === 'delete-course') await deleteCourse(id);
      if (action === 'edit-schedule') editSchedule(id);
      if (action === 'delete-schedule') await deleteSchedule(id);
      if (action === 'edit-exam') editExam(id);
      if (action === 'delete-exam') await deleteExam(id);
      if (action === 'manage-questions') await openQuestions(id);
      if (action === 'edit-question') editQuestion(id);
      if (action === 'delete-question') await deleteQuestion(id);
      if (action === 'grade-response') openGrading(id);
      if (action === 'open-attendance') openAttendance(id);
      if (action === 'start-exam') await startExam(id);
    } catch (error) {
      toast('Proses gagal', error.message, 'error');
    }
  }

  /* ========================================================
     DASHBOARD
     ======================================================== */

  async function loadDashboard() {
    if (!state.user) return;
    if (state.user.ROLE === 'ADMIN') {
      const result = await api('admin.dashboard', { token: state.token });
      const data = result.data || {};
      text('statStudents', data.students || 0);
      text('statCourses', data.courses || 0);
      text('statAttendanceToday', data.attendanceToday || 0);
      text('statActiveExams', data.activeExams || 0);
      text('statPendingGrading', `${data.pendingGrading || 0} menunggu penilaian`);
      text('dashboardSchedules', data.schedules || 0);
      text('dashboardAcademicYear', state.config.academicYear);
      text('dashboardActiveSemesters', state.config.activeSemesters.join(' dan '));
      text('gradingBadge', data.pendingGrading || 0);
      $('gradingBadge').hidden = !(data.pendingGrading > 0);
    } else {
      const result = await api('student.dashboard', { token: state.token });
      const data = result.data || {};
      text('studentStatSchedules', data.todaySchedules?.length || 0);
      text('studentStatAttendance', data.attendanceTotal || 0);
      text('studentStatPresent', data.presentTotal || 0);
      text('studentStatLate', data.lateTotal || 0);
      renderDashboardSchedules(data.todaySchedules || []);
      renderDashboardExams(data.openExams || []);
    }
  }

  function renderDashboardSchedules(rows) {
    const container = $('dashboardTodaySchedules');
    if (!rows.length) {
      container.innerHTML = emptyInline('Tidak ada jadwal kuliah hari ini.');
      return;
    }
    container.innerHTML = rows.slice(0, 4).map((row) => `
      <div class="mini-list-item">
        <div>
          <strong>${escapeHtml(row.COURSE_NAME || '-')}</strong>
          <span>${escapeHtml(row.START_TIME || '--:--')}–${escapeHtml(row.END_TIME || '--:--')} • ${escapeHtml(row.ROOM || 'Ruang belum diatur')}</span>
        </div>
        ${attendanceBadge(row)}
      </div>`).join('');
  }

  function renderDashboardExams(rows) {
    const container = $('dashboardOpenExams');
    if (!rows.length) {
      container.innerHTML = emptyInline('Tidak ada ujian yang sedang dibuka.');
      return;
    }
    container.innerHTML = rows.slice(0, 4).map((exam) => `
      <div class="mini-list-item">
        <div>
          <strong>${escapeHtml(exam.TITLE || '-')}</strong>
          <span>${escapeHtml(exam.COURSE_NAME || '-')} • ${escapeHtml(exam.TYPE || 'UJIAN')}</span>
        </div>
        <button class="button button--primary button--small" data-action="start-exam" data-id="${escapeHtml(exam.EXAM_ID)}">Kerjakan</button>
      </div>`).join('');
  }

  /* ========================================================
     USERS
     ======================================================== */

  async function loadUsers() {
    loadingRow('usersTableBody', 8);
    const result = await api('admin.listUsers', {
      token: state.token,
      role: 'STUDENT',
      semester: $('userSemesterFilter').value
    });
    state.users = result.data.rows || [];
    renderUsers();
  }

  function renderUsers() {
    const query = ($('userSearch')?.value || '').trim().toLowerCase();
    const status = $('userStatusFilter')?.value || '';
    const rows = state.users.filter((row) => {
      const matchesText = !query || [row.NIM, row.NAME, row.EMAIL, row.USERNAME].join(' ').toLowerCase().includes(query);
      const matchesStatus = !status || row.STATUS === status;
      return matchesText && matchesStatus;
    });

    $('usersTableBody').innerHTML = rows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><strong class="cell-title">${escapeHtml(row.NIM || row.USERNAME || '-')}</strong></td>
        <td><span class="cell-title">${escapeHtml(row.NAME || '-')}</span><span class="cell-subtitle">${escapeHtml(row.EMAIL || 'Email belum diisi')}</span></td>
        <td>Semester ${escapeHtml(row.SEMESTER || '-')}</td>
        <td>${statusBadge(row.STATUS)}</td>
        <td class="table-actions-column"><div class="table-actions">
          <button class="icon-button" data-action="edit-user" data-id="${escapeHtml(row.USER_ID)}" title="Edit">✎</button>
          <button class="icon-button" data-action="delete-user" data-id="${escapeHtml(row.USER_ID)}" title="Hapus">🗑</button>
        </div></td>
      </tr>`).join('');

    setEmpty('usersEmptyState', rows.length === 0, 'Belum ada data mahasiswa', 'Tambahkan mahasiswa dari tombol di kanan atas.');
    text('usersTableInfo', `Menampilkan ${rows.length} mahasiswa`);
  }

  function editUser(id) {
    const row = state.users.find((item) => item.USER_ID === id);
    if (!row) return;
    resetForm('userForm');
    value('userId', row.USER_ID);
    value('userNim', row.NIM || row.USERNAME);
    value('userName', row.NAME);
    value('userEmail', row.EMAIL);
    value('userSemester', row.SEMESTER);
    value('userStatus', row.STATUS);
    text('userModalTitle', 'Edit Mahasiswa');
    openModal('userModal');
  }

  async function saveUser(event) {
    event.preventDefault();
    const button = $('saveUserButton');
    setLoading(button, true);
    try {
      const data = formObject($('userForm'));
      data.USERNAME = data.NIM;
      data.ROLE = 'STUDENT';
      await api('admin.saveUser', { token: state.token, data });
      closeModal('userModal');
      toast('Data tersimpan', 'Data mahasiswa berhasil disimpan.', 'success');
      await loadUsers();
    } catch (error) {
      toast('Gagal menyimpan', error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function deleteUser(id) {
    const row = state.users.find((item) => item.USER_ID === id);
    if (!await confirmAction('Hapus mahasiswa?', `Data akun ${row?.NAME || 'mahasiswa'} akan dihapus dari sistem.`)) return;
    await api('admin.deleteUser', { token: state.token, userId: id });
    toast('Data dihapus', 'Akun mahasiswa berhasil dihapus.', 'success');
    await loadUsers();
  }

  /* ========================================================
     COURSES
     ======================================================== */

  async function loadCourses(force = true) {
    if (force) loadingRow('coursesTableBody', 8);
    const result = await api('admin.listCourses', {
      token: state.token,
      semester: $('courseSemesterFilter')?.value || ''
    });
    state.courses = result.data.rows || [];
    renderCourses();
    populateCourseSelects();
  }

  async function ensureCourses() {
    if (state.courses.length) return;
    const result = await api('admin.listCourses', { token: state.token });
    state.courses = result.data.rows || [];
    populateCourseSelects();
  }

  function renderCourses() {
    const query = ($('courseSearch')?.value || '').trim().toLowerCase();
    const rows = state.courses.filter((row) => !query || [row.COURSE_CODE, row.COURSE_NAME, row.LECTURER].join(' ').toLowerCase().includes(query));
    $('coursesTableBody').innerHTML = rows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><strong class="cell-title">${escapeHtml(row.COURSE_CODE || '-')}</strong></td>
        <td>${escapeHtml(row.COURSE_NAME || '-')}</td>
        <td>${escapeHtml(row.LECTURER || '-')}</td>
        <td>Semester ${escapeHtml(row.SEMESTER || '-')}</td>
        <td>${escapeHtml(row.SKS || '0')}</td>
        <td>${statusBadge(row.STATUS)}</td>
        <td class="table-actions-column"><div class="table-actions">
          <button class="icon-button" data-action="edit-course" data-id="${escapeHtml(row.COURSE_ID)}" title="Edit">✎</button>
          <button class="icon-button" data-action="delete-course" data-id="${escapeHtml(row.COURSE_ID)}" title="Hapus">🗑</button>
        </div></td>
      </tr>`).join('');
    setEmpty('coursesEmptyState', rows.length === 0, 'Belum ada mata kuliah', 'Tambahkan mata kuliah agar jadwal dapat dibuat.');
    text('coursesTableInfo', `Menampilkan ${rows.length} mata kuliah`);
  }

  function populateCourseSelects() {
    const ids = ['scheduleCourse', 'examCourse', 'attendanceCourseFilter'];
    ids.forEach((id) => {
      const select = $(id);
      if (!select) return;
      const current = select.value;
      const firstText = id === 'attendanceCourseFilter' ? 'Semua Mata Kuliah' : 'Pilih mata kuliah';
      select.innerHTML = `<option value="">${firstText}</option>` + state.courses
        .filter((course) => course.STATUS !== 'INACTIVE')
        .map((course) => `<option value="${escapeHtml(course.COURSE_ID)}">${escapeHtml(course.COURSE_CODE || '')} — ${escapeHtml(course.COURSE_NAME || '')}</option>`)
        .join('');
      select.value = current;
    });
  }

  function editCourse(id) {
    const row = state.courses.find((item) => item.COURSE_ID === id);
    if (!row) return;
    resetForm('courseForm');
    value('courseId', row.COURSE_ID);
    value('courseCode', row.COURSE_CODE);
    value('courseName', row.COURSE_NAME);
    value('courseLecturer', row.LECTURER);
    value('courseSemester', row.SEMESTER);
    value('courseSks', row.SKS);
    value('courseStatus', row.STATUS);
    text('courseModalTitle', 'Edit Mata Kuliah');
    openModal('courseModal');
  }

  async function saveCourse(event) {
    event.preventDefault();
    const button = $('saveCourseButton');
    setLoading(button, true);
    try {
      const data = formObject($('courseForm'));
      await api('admin.saveCourse', { token: state.token, data });
      closeModal('courseModal');
      toast('Mata kuliah tersimpan', 'Data mata kuliah berhasil diperbarui.', 'success');
      await loadCourses();
    } catch (error) {
      toast('Gagal menyimpan', error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function deleteCourse(id) {
    const row = state.courses.find((item) => item.COURSE_ID === id);
    if (!await confirmAction('Hapus mata kuliah?', `${row?.COURSE_NAME || 'Mata kuliah'} akan dihapus.`)) return;
    await api('admin.deleteCourse', { token: state.token, courseId: id });
    toast('Mata kuliah dihapus', 'Data berhasil dihapus.', 'success');
    await loadCourses();
  }

  /* ========================================================
     SCHEDULES
     ======================================================== */

  async function loadSchedules() {
    loadingRow('schedulesTableBody', 10);
    const result = await api('admin.listSchedules', {
      token: state.token,
      semester: $('scheduleSemesterFilter').value,
      day: $('scheduleDayFilter').value
    });
    state.schedules = result.data.rows || [];
    renderSchedules();
    await ensureCourses();
  }

  function renderSchedules() {
    $('schedulesTableBody').innerHTML = state.schedules.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${capitalize(row.DAY || '-')}</td>
        <td><strong class="cell-title">${escapeHtml(row.START_TIME || '--:--')}–${escapeHtml(row.END_TIME || '--:--')}</strong></td>
        <td><span class="cell-title">${escapeHtml(row.COURSE_NAME || '-')}</span><span class="cell-subtitle">${escapeHtml(row.COURSE_CODE || '')}</span></td>
        <td>${escapeHtml(row.LECTURER || '-')}</td>
        <td>${escapeHtml(row.ROOM || '-')}</td>
        <td>Semester ${escapeHtml(row.SEMESTER || '-')}</td>
        <td>${escapeHtml(formatDate(row.DATE_START))} – ${escapeHtml(formatDate(row.DATE_END))}</td>
        <td>${statusBadge(row.STATUS)}</td>
        <td class="table-actions-column"><div class="table-actions">
          <button class="icon-button" data-action="edit-schedule" data-id="${escapeHtml(row.SCHEDULE_ID)}" title="Edit">✎</button>
          <button class="icon-button" data-action="delete-schedule" data-id="${escapeHtml(row.SCHEDULE_ID)}" title="Hapus">🗑</button>
        </div></td>
      </tr>`).join('');
    setEmpty('schedulesEmptyState', state.schedules.length === 0, 'Belum ada jadwal', 'Tambahkan jadwal perkuliahan untuk membuka absensi.');
    text('schedulesTableInfo', `Menampilkan ${state.schedules.length} jadwal`);
  }

  function editSchedule(id) {
    const row = state.schedules.find((item) => item.SCHEDULE_ID === id);
    if (!row) return;
    resetForm('scheduleForm');
    value('scheduleId', row.SCHEDULE_ID);
    value('scheduleCourse', row.COURSE_ID);
    value('scheduleSemester', row.SEMESTER);
    value('scheduleDay', row.DAY);
    value('scheduleStartTime', normalizeTimeInput(row.START_TIME));
    value('scheduleEndTime', normalizeTimeInput(row.END_TIME));
    value('scheduleRoom', row.ROOM);
    value('scheduleStatus', row.STATUS);
    value('scheduleDateStart', normalizeDateInput(row.DATE_START));
    value('scheduleDateEnd', normalizeDateInput(row.DATE_END));
    text('scheduleModalTitle', 'Edit Jadwal');
    openModal('scheduleModal');
  }

  async function saveSchedule(event) {
    event.preventDefault();
    const button = $('saveScheduleButton');
    setLoading(button, true);
    try {
      const data = formObject($('scheduleForm'));
      await api('admin.saveSchedule', { token: state.token, data });
      closeModal('scheduleModal');
      toast('Jadwal tersimpan', 'Jadwal perkuliahan berhasil disimpan.', 'success');
      await loadSchedules();
    } catch (error) {
      toast('Gagal menyimpan jadwal', error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function deleteSchedule(id) {
    if (!await confirmAction('Hapus jadwal?', 'Jadwal ini tidak lagi tersedia untuk absensi.')) return;
    await api('admin.deleteSchedule', { token: state.token, scheduleId: id });
    toast('Jadwal dihapus', 'Data jadwal berhasil dihapus.', 'success');
    await loadSchedules();
  }

  function syncCourseSemesterForSchedule() {
    const course = state.courses.find((item) => item.COURSE_ID === $('scheduleCourse').value);
    if (course) $('scheduleSemester').value = course.SEMESTER;
  }

  /* ========================================================
     ATTENDANCE ADMIN
     ======================================================== */

  async function prepareAttendancePage() {
    if (!$('attendanceDateFilter').value) $('attendanceDateFilter').value = todayJakarta();
    await ensureCourses();
    await loadAttendance();
  }

  async function loadAttendance() {
    loadingRow('attendanceTableBody', 9);
    const result = await api('admin.listAttendance', {
      token: state.token,
      date: $('attendanceDateFilter').value,
      semester: $('attendanceSemesterFilter').value,
      courseId: $('attendanceCourseFilter').value
    });
    state.attendance = result.data.rows || [];
    renderAttendance();
  }

  function renderAttendance() {
    $('attendanceTableBody').innerHTML = state.attendance.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(formatDate(row.DATE))}</td>
        <td>${escapeHtml(row.CHECKIN_TIME || '-')}</td>
        <td>${escapeHtml(row.NIM || '-')}</td>
        <td>${escapeHtml(row.NAME || '-')}</td>
        <td><span class="cell-title">${escapeHtml(row.COURSE_NAME || '-')}</span><span class="cell-subtitle">${escapeHtml(row.COURSE_CODE || '')}</span></td>
        <td>Semester ${escapeHtml(row.SEMESTER || '-')}</td>
        <td>${attendanceStatusBadge(row.STATUS)}</td>
        <td>${escapeHtml(row.NOTE || '-')}</td>
      </tr>`).join('');
    setEmpty('attendanceEmptyState', state.attendance.length === 0, 'Belum ada data absensi', 'Tidak ditemukan data untuk filter yang dipilih.');
    text('attendanceTableInfo', `Menampilkan ${state.attendance.length} data absensi`);
    text('attendanceSummaryTotal', state.attendance.length);
    text('attendanceSummaryPresent', state.attendance.filter((row) => row.STATUS === 'HADIR').length);
    text('attendanceSummaryLate', state.attendance.filter((row) => row.STATUS === 'TERLAMBAT').length);
  }

  function exportAttendanceCsv() {
    if (!state.attendance.length) {
      toast('Tidak ada data', 'Tampilkan data absensi terlebih dahulu.', 'warning');
      return;
    }
    const headers = ['Tanggal', 'Waktu', 'NIM', 'Nama', 'Kode Mata Kuliah', 'Mata Kuliah', 'Semester', 'Status', 'Catatan'];
    const rows = state.attendance.map((row) => [row.DATE, row.CHECKIN_TIME, row.NIM, row.NAME, row.COURSE_CODE, row.COURSE_NAME, row.SEMESTER, row.STATUS, row.NOTE]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `rekap-absensi-${$('attendanceDateFilter').value || 'semua'}.csv`);
  }

  /* ========================================================
     EXAMS ADMIN
     ======================================================== */

  async function loadAdminExams() {
    const result = await api('admin.listExams', {
      token: state.token,
      semester: $('examSemesterFilter').value,
      type: $('examTypeFilter').value
    });
    state.exams = result.data.rows || [];
    renderAdminExams();
    await ensureCourses();
    populateGradingExamFilter();
  }

  function renderAdminExams() {
    $('adminExamGrid').innerHTML = state.exams.map((exam) => `
      <article class="exam-card">
        <div class="exam-card__top">
          ${examTypeBadge(exam.TYPE)}
          ${examStatusBadge(exam)}
        </div>
        <h3>${escapeHtml(exam.TITLE || '-')}</h3>
        <p>${escapeHtml(exam.COURSE_CODE || '')} — ${escapeHtml(exam.COURSE_NAME || '-')}</p>
        <div class="card-meta">
          <div>📅 ${escapeHtml(formatDateTime(exam.START_AT))}</div>
          <div>⏱ ${escapeHtml(exam.DURATION_MINUTES || '0')} menit • Semester ${escapeHtml(exam.SEMESTER || '-')}</div>
          <div>🔀 Acak soal: ${String(exam.RANDOMIZE).toUpperCase() === 'TRUE' ? 'Ya' : 'Tidak'}</div>
        </div>
        <div class="card-actions">
          <button class="button button--primary button--small" data-action="manage-questions" data-id="${escapeHtml(exam.EXAM_ID)}">Kelola Soal</button>
          <button class="button button--secondary button--small" data-action="edit-exam" data-id="${escapeHtml(exam.EXAM_ID)}">Edit</button>
          <button class="button button--ghost button--small" data-action="delete-exam" data-id="${escapeHtml(exam.EXAM_ID)}">Hapus</button>
        </div>
      </article>`).join('');
    setEmpty('adminExamsEmptyState', state.exams.length === 0, 'Belum ada ujian', 'Buat UTS, UAS, kuis, atau tugas baru.');
  }

  function editExam(id) {
    const row = state.exams.find((item) => item.EXAM_ID === id);
    if (!row) return;
    resetForm('examForm');
    value('examId', row.EXAM_ID);
    value('examTitle', row.TITLE);
    value('examCourse', row.COURSE_ID);
    value('examSemester', row.SEMESTER);
    value('examType', row.TYPE);
    value('examDuration', row.DURATION_MINUTES);
    value('examStartAt', datetimeLocal(row.START_AT));
    value('examEndAt', datetimeLocal(row.END_AT));
    value('examStatus', row.STATUS);
    $('examRandomize').checked = String(row.RANDOMIZE).toUpperCase() === 'TRUE';
    text('examModalTitle', 'Edit Ujian');
    openModal('examModal');
  }

  async function saveExam(event) {
    event.preventDefault();
    const button = $('saveExamButton');
    setLoading(button, true);
    try {
      const data = formObject($('examForm'));
      data.RANDOMIZE = $('examRandomize').checked;
      await api('admin.saveExam', { token: state.token, data });
      closeModal('examModal');
      toast('Ujian tersimpan', 'Jadwal dan pengaturan ujian berhasil disimpan.', 'success');
      await loadAdminExams();
    } catch (error) {
      toast('Gagal menyimpan ujian', error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function deleteExam(id) {
    const exam = state.exams.find((item) => item.EXAM_ID === id);
    if (!await confirmAction('Hapus ujian?', `${exam?.TITLE || 'Ujian'} akan dihapus.`)) return;
    await api('admin.deleteExam', { token: state.token, examId: id });
    toast('Ujian dihapus', 'Data ujian berhasil dihapus.', 'success');
    await loadAdminExams();
  }

  function syncCourseSemesterForExam() {
    const course = state.courses.find((item) => item.COURSE_ID === $('examCourse').value);
    if (course) $('examSemester').value = course.SEMESTER;
  }

  /* ========================================================
     QUESTIONS
     ======================================================== */

  async function openQuestions(examId) {
    const exam = state.exams.find((item) => item.EXAM_ID === examId);
    value('questionExamId', examId);
    text('questionsModalTitle', 'Kelola Soal Ujian');
    text('questionsModalSubtitle', exam ? `${exam.TITLE} • ${exam.COURSE_NAME || '-'}` : '-');
    resetQuestionForm(false);
    openModal('questionsModal');
    await loadQuestions();
  }

  async function loadQuestions() {
    const examId = $('questionExamId').value;
    if (!examId) return;
    const result = await api('admin.listQuestions', { token: state.token, examId });
    state.questions = result.data.rows || [];
    renderQuestions();
  }

  function renderQuestions() {
    $('adminQuestionList').innerHTML = state.questions.map((question) => `
      <article class="admin-question-item">
        <div class="admin-question-item__top">
          <div>
            <span class="badge badge--maroon">Soal ${escapeHtml(question.NUMBER)}</span>
            ${question.TYPE === 'ESSAY' ? '<span class="badge badge--info">Esai</span>' : '<span class="badge badge--muted">Pilihan Ganda</span>'}
          </div>
          <div class="admin-question-item__actions">
            <button class="icon-button" data-action="edit-question" data-id="${escapeHtml(question.QUESTION_ID)}">✎</button>
            <button class="icon-button" data-action="delete-question" data-id="${escapeHtml(question.QUESTION_ID)}">🗑</button>
          </div>
        </div>
        <p>${escapeHtml(truncate(question.QUESTION_TEXT || '-', 160))}</p>
        <span class="cell-subtitle">Bobot ${escapeHtml(question.SCORE || 0)} • ${escapeHtml(question.STATUS || 'ACTIVE')}</span>
      </article>`).join('');
    text('questionTotalLabel', `${state.questions.length} soal`);
    setEmpty('questionsEmptyState', state.questions.length === 0, 'Belum ada soal', 'Tambahkan soal menggunakan formulir di sebelah kiri.');
  }

  function editQuestion(id) {
    const row = state.questions.find((item) => item.QUESTION_ID === id);
    if (!row) return;
    value('questionId', row.QUESTION_ID);
    value('questionNumber', row.NUMBER);
    value('questionType', row.TYPE);
    value('questionText', row.QUESTION_TEXT);
    value('questionOptionA', row.OPTION_A);
    value('questionOptionB', row.OPTION_B);
    value('questionOptionC', row.OPTION_C);
    value('questionOptionD', row.OPTION_D);
    value('questionOptionE', row.OPTION_E);
    value('questionAnswerKey', row.ANSWER_KEY);
    value('questionScore', row.SCORE);
    value('questionImageUrl', row.IMAGE_URL);
    value('questionStatus', row.STATUS);
    toggleQuestionFields();
    $('questionText').focus();
  }

  function resetQuestionForm(keepExam = true) {
    const examId = $('questionExamId').value;
    resetForm('questionForm');
    if (keepExam) value('questionExamId', examId);
    value('questionNumber', state.questions.length + 1);
    value('questionType', 'MULTIPLE_CHOICE');
    value('questionScore', '1');
    value('questionStatus', 'ACTIVE');
    toggleQuestionFields();
  }

  function toggleQuestionFields() {
    const essay = $('questionType').value === 'ESSAY';
    $('multipleChoiceFields').hidden = essay;
    $('questionAnswerKey').required = !essay;
  }

  async function saveQuestion(event) {
    event.preventDefault();
    const button = $('saveQuestionButton');
    setLoading(button, true);
    try {
      const data = formObject($('questionForm'));
      await api('admin.saveQuestion', { token: state.token, data });
      toast('Soal tersimpan', 'Soal ujian berhasil disimpan.', 'success');
      await loadQuestions();
      resetQuestionForm();
    } catch (error) {
      toast('Gagal menyimpan soal', error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function deleteQuestion(id) {
    if (!await confirmAction('Hapus soal?', 'Soal ini akan dihapus dari bank soal ujian.')) return;
    await api('admin.deleteQuestion', { token: state.token, questionId: id });
    toast('Soal dihapus', 'Soal berhasil dihapus.', 'success');
    await loadQuestions();
    resetQuestionForm();
  }

  /* ========================================================
     GRADING
     ======================================================== */

  async function prepareGradingPage() {
    if (!state.exams.length) {
      const result = await api('admin.listExams', { token: state.token });
      state.exams = result.data.rows || [];
    }
    populateGradingExamFilter();
    await loadResponses();
  }

  function populateGradingExamFilter() {
    const select = $('gradingExamFilter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Semua Ujian</option>' + state.exams.map((exam) => `<option value="${escapeHtml(exam.EXAM_ID)}">${escapeHtml(exam.TYPE)} — ${escapeHtml(exam.TITLE)}</option>`).join('');
    select.value = current;
  }

  async function loadResponses() {
    loadingRow('gradingTableBody', 10);
    const result = await api('admin.listResponses', {
      token: state.token,
      examId: $('gradingExamFilter').value,
      status: $('gradingStatusFilter').value
    });
    state.responses = result.data.rows || [];
    renderResponses();
  }

  function renderResponses() {
    $('gradingTableBody').innerHTML = state.responses.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.NIM || '-')}</td>
        <td>${escapeHtml(row.NAME || '-')}</td>
        <td>${escapeHtml(formatDateTime(row.START_AT))}</td>
        <td>${escapeHtml(formatDateTime(row.SUBMIT_AT))}</td>
        <td>${escapeHtml(row.AUTO_SCORE || 0)}</td>
        <td>${escapeHtml(row.MANUAL_SCORE || 0)}</td>
        <td><strong>${escapeHtml(row.FINAL_SCORE || 0)}</strong></td>
        <td>${responseStatusBadge(row.STATUS)}</td>
        <td class="table-actions-column"><button class="button button--secondary button--small" data-action="grade-response" data-id="${escapeHtml(row.RESPONSE_ID)}">Nilai</button></td>
      </tr>`).join('');
    setEmpty('gradingEmptyState', state.responses.length === 0, 'Belum ada jawaban', 'Jawaban mahasiswa akan muncul setelah ujian dikumpulkan.');
  }

  function openGrading(id) {
    const row = state.responses.find((item) => item.RESPONSE_ID === id);
    if (!row) return;
    value('gradingResponseId', row.RESPONSE_ID);
    value('gradingManualScore', row.MANUAL_SCORE || 0);
    value('gradingReviewNote', row.REVIEW_NOTE || '');
    text('gradingStudentInfo', `${row.NAME || '-'} • NIM ${row.NIM || '-'}`);
    text('gradingAutoScore', row.AUTO_SCORE || 0);
    updateGradingPreview();
    renderGradingAnswers(row);
    openModal('gradingModal');
  }

  function renderGradingAnswers(row) {
    let preview = $('gradingAnswersPreview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'gradingAnswersPreview';
      preview.className = 'grading-answer-preview';
      $('gradingForm').insertBefore(preview, $('gradingForm').firstChild.nextSibling);
    }
    let answers = {};
    try { answers = JSON.parse(row.ANSWERS_JSON || '{}'); } catch { answers = {}; }
    const entries = Object.entries(answers);
    preview.innerHTML = entries.length
      ? `<h4>Jawaban Mahasiswa</h4><dl>${entries.map(([key, answer], index) => `<div><dt>Jawaban ${index + 1} (${escapeHtml(key)})</dt><dd>${escapeHtml(answer || '(kosong)')}</dd></div>`).join('')}</dl>`
      : '<h4>Jawaban Mahasiswa</h4><p>Tidak ada jawaban yang tersimpan.</p>';
  }

  function updateGradingPreview() {
    const auto = Number($('gradingAutoScore').textContent || 0);
    const manual = Number($('gradingManualScore').value || 0);
    text('gradingManualScorePreview', formatNumber(manual));
    text('gradingFinalScorePreview', formatNumber(auto + manual));
  }

  async function saveGrade(event) {
    event.preventDefault();
    const button = $('saveGradeButton');
    setLoading(button, true);
    try {
      await api('admin.gradeResponse', {
        token: state.token,
        responseId: $('gradingResponseId').value,
        manualScore: $('gradingManualScore').value,
        note: $('gradingReviewNote').value
      });
      closeModal('gradingModal');
      toast('Nilai tersimpan', 'Nilai akhir mahasiswa berhasil diperbarui.', 'success');
      await loadResponses();
    } catch (error) {
      toast('Gagal menyimpan nilai', error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  /* ========================================================
     STUDENT SCHEDULE AND ATTENDANCE
     ======================================================== */

  async function loadStudentSchedule() {
    if (!$('studentScheduleDate').value) $('studentScheduleDate').value = todayJakarta();
    const result = await api('student.schedule', {
      token: state.token,
      date: $('studentScheduleDate').value
    });
    state.studentSchedules = result.data.rows || [];
    renderStudentSchedule();
  }

  function renderStudentSchedule() {
    $('studentScheduleList').innerHTML = state.studentSchedules.map((row) => `
      <article class="schedule-card">
        <div class="schedule-card__top">
          <span class="badge badge--maroon">${capitalize(row.DAY || '-')}</span>
          ${attendanceBadge(row)}
        </div>
        <h3>${escapeHtml(row.COURSE_NAME || '-')}</h3>
        <p>${escapeHtml(row.COURSE_CODE || '')} • Semester ${escapeHtml(row.SEMESTER || '-')}</p>
        <div class="card-meta">
          <div>🕘 ${escapeHtml(row.START_TIME || '--:--')}–${escapeHtml(row.END_TIME || '--:--')}</div>
          <div>👨‍🏫 ${escapeHtml(row.LECTURER || 'Dosen belum diatur')}</div>
          <div>📍 ${escapeHtml(row.ROOM || 'Ruang belum diatur')}</div>
        </div>
        <p>${escapeHtml(row.ATTENDANCE_MESSAGE || '')}</p>
        <div class="card-actions">
          ${row.CAN_CHECK_IN ? `<button class="button button--primary" data-action="open-attendance" data-id="${escapeHtml(row.SCHEDULE_ID)}">Isi Absensi</button>` : ''}
          ${row.ATTENDANCE ? `<span class="badge ${row.ATTENDANCE.STATUS === 'HADIR' ? 'badge--success' : 'badge--warning'}">${escapeHtml(row.ATTENDANCE.STATUS)}</span>` : ''}
        </div>
      </article>`).join('');
    setEmpty('studentScheduleEmptyState', state.studentSchedules.length === 0, 'Tidak ada jadwal', 'Tidak ditemukan perkuliahan pada tanggal yang dipilih.');
  }

  function openAttendance(scheduleId) {
    const row = state.studentSchedules.find((item) => item.SCHEDULE_ID === scheduleId);
    if (!row) return;
    value('attendanceScheduleId', scheduleId);
    value('attendanceNote', '');
    text('attendanceCourseName', row.COURSE_NAME || '-');
    text('attendanceScheduleInfo', `${row.START_TIME || '--:--'}–${row.END_TIME || '--:--'} • ${row.ROOM || 'Ruang belum diatur'}`);
    openModal('attendanceModal');
  }

  async function submitAttendance(event) {
    event.preventDefault();
    const button = $('checkInButton');
    setLoading(button, true);
    try {
      const result = await api('student.checkIn', {
        token: state.token,
        scheduleId: $('attendanceScheduleId').value,
        note: $('attendanceNote').value,
        device: navigator.userAgent
      });
      closeModal('attendanceModal');
      toast('Absensi berhasil', `Status kehadiran: ${result.data.attendance.STATUS}.`, 'success');
      await loadStudentSchedule();
      await loadDashboard();
    } catch (error) {
      toast('Absensi gagal', error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  function shiftScheduleDate(days) {
    const value = $('studentScheduleDate').value || todayJakarta();
    const date = new Date(`${value}T12:00:00+07:00`);
    date.setUTCDate(date.getUTCDate() + days);
    $('studentScheduleDate').value = date.toISOString().slice(0, 10);
    loadStudentSchedule();
  }

  /* ========================================================
     STUDENT EXAMS
     ======================================================== */

  async function loadStudentExams() {
    const result = await api('student.exams', { token: state.token });
    state.studentExams = result.data.rows || [];
    renderStudentExams();
  }

  function renderStudentExams() {
    const rows = state.studentExams.filter((exam) => state.examStateFilter === 'ALL' || exam.STATE === state.examStateFilter);
    $('studentExamGrid').innerHTML = rows.map((exam) => {
      const response = exam.RESPONSE;
      const submitted = response && ['SELESAI', 'MENUNGGU_PENILAIAN', 'TERLAMBAT'].includes(response.STATUS);
      const button = exam.STATE === 'OPEN' && !submitted
        ? `<button class="button button--primary" data-action="start-exam" data-id="${escapeHtml(exam.EXAM_ID)}">${response?.STATUS === 'IN_PROGRESS' ? 'Lanjutkan Ujian' : 'Mulai Ujian'}</button>`
        : '';
      return `
        <article class="exam-card">
          <div class="exam-card__top">${examTypeBadge(exam.TYPE)}${examStateBadge(exam.STATE)}</div>
          <h3>${escapeHtml(exam.TITLE || '-')}</h3>
          <p>${escapeHtml(exam.COURSE_CODE || '')} — ${escapeHtml(exam.COURSE_NAME || '-')}</p>
          <div class="card-meta">
            <div>📅 ${escapeHtml(formatDateTime(exam.START_AT))}</div>
            <div>⏱ ${escapeHtml(exam.DURATION_MINUTES || 0)} menit</div>
            <div>🏁 Batas akhir ${escapeHtml(formatDateTime(exam.END_AT))}</div>
          </div>
          ${response ? `<p>Status pengerjaan: ${responseStatusBadge(response.STATUS)}${response.STATUS === 'SELESAI' ? ` • Nilai ${escapeHtml(response.FINAL_SCORE || 0)}` : ''}</p>` : '<p>Ujian belum dikerjakan.</p>'}
          <div class="card-actions">${button}</div>
        </article>`;
    }).join('');
    setEmpty('studentExamsEmptyState', rows.length === 0, 'Tidak ada ujian', 'Belum ada ujian pada kategori ini.');
  }

  async function startExam(examId) {
    const exam = state.studentExams.find((item) => item.EXAM_ID === examId) || state.currentExam?.exam;
    if (!await confirmAction('Mulai ujian?', 'Timer akan berjalan setelah ujian dibuka. Pastikan koneksi internet stabil.', 'Mulai Ujian')) return;
    const result = await api('student.startExam', { token: state.token, examId });
    state.currentExam = {
      exam: result.data.exam,
      responseId: result.data.responseId,
      questions: result.data.questions || [],
      remainingSeconds: Number(result.data.remainingSeconds || 0)
    };
    renderExamRoom();
    showPage('exam-room');
    startExamTimer();
  }

  function renderExamRoom() {
    const session = state.currentExam;
    if (!session) return;
    const exam = session.exam || {};
    text('examRoomType', exam.TYPE || 'UJIAN');
    text('examRoomTitle', exam.TITLE || 'Ujian');
    const course = state.studentExams.find((item) => item.EXAM_ID === exam.EXAM_ID);
    text('examRoomCourse', course ? `${course.COURSE_CODE || ''} — ${course.COURSE_NAME || ''}` : `Semester ${exam.SEMESTER || '-'}`);

    $('examQuestionsContainer').innerHTML = session.questions.map((question, index) => {
      const id = escapeHtml(question.QUESTION_ID);
      const image = question.IMAGE_URL ? `<img class="question-card__image" src="${escapeHtml(question.IMAGE_URL)}" alt="Gambar soal ${index + 1}">` : '';
      let answerField;
      if (question.TYPE === 'ESSAY') {
        answerField = `<textarea name="answer_${id}" data-question-id="${id}" rows="7" placeholder="Tuliskan jawaban Anda..."></textarea>`;
      } else {
        const options = ['A', 'B', 'C', 'D', 'E'].filter((letter) => question[`OPTION_${letter}`]);
        answerField = `<div class="answer-options">${options.map((letter) => `
          <label class="answer-option">
            <input type="radio" name="answer_${id}" value="${letter}" data-question-id="${id}">
            <span><strong>${letter}.</strong> ${escapeHtml(question[`OPTION_${letter}`])}</span>
          </label>`).join('')}</div>`;
      }
      return `
        <article id="question-${id}" class="question-card" data-question-card="${id}">
          <div class="question-card__header">
            <span class="question-card__number">Soal ${index + 1}</span>
            <span class="question-card__score">Bobot ${escapeHtml(question.SCORE || 0)}</span>
          </div>
          <div class="question-card__text">${escapeHtml(question.QUESTION_TEXT || '')}</div>
          ${image}
          ${answerField}
        </article>`;
    }).join('');

    $('examQuestionNavigator').innerHTML = session.questions.map((question, index) => `<button type="button" class="question-number" data-question-nav="${escapeHtml(question.QUESTION_ID)}">${index + 1}</button>`).join('');

    $$('[data-question-nav]').forEach((button) => {
      button.addEventListener('click', () => $('question-' + button.dataset.questionNav)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
    $$('[data-question-id]').forEach((input) => input.addEventListener('input', updateQuestionNavigator));
    updateQuestionNavigator();
    refreshIcons();
  }

  function updateQuestionNavigator() {
    if (!state.currentExam) return;
    state.currentExam.questions.forEach((question) => {
      const inputs = $$(`[data-question-id="${cssEscape(question.QUESTION_ID)}"]`);
      const answered = inputs.some((input) => input.type === 'radio' ? input.checked : input.value.trim() !== '');
      const nav = document.querySelector(`[data-question-nav="${cssEscape(question.QUESTION_ID)}"]`);
      nav?.classList.toggle('is-answered', answered);
    });
  }

  function startExamTimer() {
    stopExamTimer();
    updateExamTimerDisplay();
    state.examTimerId = window.setInterval(() => {
      if (!state.currentExam) return;
      state.currentExam.remainingSeconds -= 1;
      updateExamTimerDisplay();
      if (state.currentExam.remainingSeconds <= 0) {
        stopExamTimer();
        toast('Waktu habis', 'Jawaban akan dikumpulkan secara otomatis.', 'warning');
        submitExam(null, true);
      }
    }, 1000);
  }

  function stopExamTimer() {
    if (state.examTimerId) clearInterval(state.examTimerId);
    state.examTimerId = null;
  }

  function updateExamTimerDisplay() {
    const seconds = Math.max(0, state.currentExam?.remainingSeconds || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    text('examTimer', [h, m, s].map((value) => String(value).padStart(2, '0')).join(':'));
    $('examTimer')?.classList.toggle('is-danger', seconds <= 300);
  }

  async function submitExam(event, forced = false) {
    event?.preventDefault();
    if (!state.currentExam) return;
    if (!forced && !await confirmAction('Kumpulkan jawaban?', 'Jawaban tidak dapat diubah setelah dikumpulkan.', 'Kumpulkan')) return;
    const button = $('submitExamButton');
    setLoading(button, true);
    try {
      const answers = {};
      state.currentExam.questions.forEach((question) => {
        const inputs = $$(`[data-question-id="${cssEscape(question.QUESTION_ID)}"]`);
        if (question.TYPE === 'ESSAY') answers[question.QUESTION_ID] = inputs[0]?.value || '';
        else answers[question.QUESTION_ID] = inputs.find((input) => input.checked)?.value || '';
      });
      const result = await api('student.submitExam', {
        token: state.token,
        examId: state.currentExam.exam.EXAM_ID,
        answers
      });
      stopExamTimer();
      toast('Jawaban dikumpulkan', result.message || 'Ujian berhasil diselesaikan.', result.data.late ? 'warning' : 'success', 7000);
      state.currentExam = null;
      await loadStudentExams();
      showPage('exams-student');
    } catch (error) {
      toast('Gagal mengumpulkan', error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  /* ========================================================
     MODALS
     ======================================================== */

  async function openEntityModal(modalId) {
    if (modalId === 'userModal') {
      resetForm('userForm');
      text('userModalTitle', 'Tambah Mahasiswa');
      value('userStatus', 'ACTIVE');
    }
    if (modalId === 'courseModal') {
      resetForm('courseForm');
      text('courseModalTitle', 'Tambah Mata Kuliah');
      value('courseSks', '2');
      value('courseStatus', 'ACTIVE');
    }
    if (modalId === 'scheduleModal') {
      await ensureCourses();
      resetForm('scheduleForm');
      text('scheduleModalTitle', 'Tambah Jadwal');
      value('scheduleStatus', 'ACTIVE');
      value('scheduleDateStart', todayJakarta());
    }
    if (modalId === 'examModal') {
      await ensureCourses();
      resetForm('examForm');
      text('examModalTitle', 'Buat Ujian');
      value('examType', 'UTS');
      value('examDuration', '90');
      value('examStatus', 'DRAFT');
    }
    openModal(modalId);
  }

  function openModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => modal.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus(), 50);
    refreshIcons();
  }

  function closeModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.hidden = true;
    if (!$$('.modal:not([hidden])').length) document.body.classList.remove('modal-open');
    if (id === 'confirmModal' && state.confirmResolver) {
      state.confirmResolver(false);
      state.confirmResolver = null;
    }
  }

  function closeTopModal() {
    const open = $$('.modal:not([hidden])').pop();
    if (open) closeModal(open.id);
  }

  function confirmAction(title, message, confirmLabel = 'Ya, Lanjutkan') {
    text('confirmModalTitle', title);
    text('confirmModalMessage', message);
    text('confirmModalButton', confirmLabel);
    openModal('confirmModal');
    return new Promise((resolve) => {
      state.confirmResolver = resolve;
      $('confirmModalButton').onclick = () => {
        $('confirmModal').hidden = true;
        document.body.classList.remove('modal-open');
        state.confirmResolver = null;
        resolve(true);
      };
    });
  }

  /* ========================================================
     PROFILE / CLOCK
     ======================================================== */

  function fillProfile() {
    const user = state.user || {};
    const initial = (user.NAME || 'M').trim().charAt(0);
    text('profileAvatar', initial);
    text('profileName', user.NAME || '-');
    text('profileNim', `NIM ${user.NIM || '-'}`);
    text('profileStatus', user.STATUS === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif');
    $('profileStatus').className = `badge ${user.STATUS === 'ACTIVE' ? 'badge--success' : 'badge--danger'}`;
    text('profileUsername', user.USERNAME || '-');
    text('profileNimDetail', user.NIM || '-');
    text('profileNameDetail', user.NAME || '-');
    text('profileEmail', user.EMAIL || '-');
    text('profileSemester', `Semester ${user.SEMESTER || '-'}`);
  }

  function startClock() {
    const update = () => {
      const now = new Date();
      const time = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(now);
      const date = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
      }).format(now);
      text('topbarClock', `${time} WIB`);
      text('topbarDate', date);
      text('sidebarServerTime', `${time} WIB`);
      text('loginServerTime', `Waktu server: ${time} WIB`);
    };
    update();
    setInterval(update, 1000);
  }

  /* ========================================================
     HELPERS
     ======================================================== */

  function text(id, content) {
    const element = $(id);
    if (element) element.textContent = String(content ?? '');
  }

  function value(id, content) {
    const element = $(id);
    if (element) element.value = content == null ? '' : String(content);
  }

  function formObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function resetForm(id) {
    $(id)?.reset();
  }

  function togglePassword(id) {
    const input = $(id);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  function setLoading(button, loading, label = '') {
    if (!button) return;
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.classList.add('is-loading');
      button.disabled = true;
      if (label) button.textContent = label;
    } else {
      button.classList.remove('is-loading');
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
      refreshIcons();
    }
  }

  function loadingRow(bodyId, colspan) {
    const body = $(bodyId);
    if (body) body.innerHTML = `<tr><td colspan="${colspan}"><div class="content-loader"><span class="spinner"></span><span>Memuat data...</span></div></td></tr>`;
  }

  function setEmpty(id, show, title, message) {
    const element = $(id);
    if (!element) return;
    element.hidden = !show;
    element.innerHTML = show ? `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>` : '';
  }

  function emptyInline(message) {
    return `<div class="empty-state"><strong>Belum ada data</strong><p>${escapeHtml(message)}</p></div>`;
  }

  function toast(title, message, type = 'success', duration = 4500) {
    const container = $('toastContainer');
    if (!container) return;
    const element = document.createElement('div');
    element.className = `toast toast--${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';
    element.innerHTML = `<div class="toast__icon">${icon}</div><div class="toast__content"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message || '')}</p></div>`;
    container.appendChild(element);
    setTimeout(() => element.remove(), duration);
  }

  function statusBadge(status) {
    const active = String(status).toUpperCase() === 'ACTIVE';
    return `<span class="badge ${active ? 'badge--success' : 'badge--danger'}">${active ? 'Aktif' : 'Tidak Aktif'}</span>`;
  }

  function attendanceStatusBadge(status) {
    const late = String(status).toUpperCase() === 'TERLAMBAT';
    return `<span class="badge ${late ? 'badge--warning' : 'badge--success'}">${escapeHtml(status || '-')}</span>`;
  }

  function attendanceBadge(row) {
    if (row.ATTENDANCE) return attendanceStatusBadge(row.ATTENDANCE.STATUS);
    const states = {
      OPEN: ['badge--success', 'Dibuka'],
      UPCOMING: ['badge--info', 'Belum Dibuka'],
      CLOSED: ['badge--muted', 'Ditutup'],
      DONE: ['badge--success', 'Selesai']
    };
    const [klass, label] = states[row.ATTENDANCE_STATE] || ['badge--muted', row.ATTENDANCE_STATE || '-'];
    return `<span class="badge ${klass}">${escapeHtml(label)}</span>`;
  }

  function examTypeBadge(type) {
    return `<span class="badge badge--maroon">${escapeHtml(type || 'UJIAN')}</span>`;
  }

  function examStatusBadge(exam) {
    if (exam.IS_OPEN) return '<span class="badge badge--success">Sedang Dibuka</span>';
    const status = String(exam.STATUS || '').toUpperCase();
    if (status === 'PUBLISHED' || status === 'ACTIVE') return '<span class="badge badge--info">Dipublikasikan</span>';
    if (status === 'DRAFT') return '<span class="badge badge--warning">Draft</span>';
    return `<span class="badge badge--muted">${escapeHtml(status || '-')}</span>`;
  }

  function examStateBadge(stateName) {
    const map = {
      OPEN: ['badge--success', 'Sedang Dibuka'],
      UPCOMING: ['badge--info', 'Akan Datang'],
      CLOSED: ['badge--muted', 'Selesai']
    };
    const [klass, label] = map[stateName] || ['badge--muted', stateName || '-'];
    return `<span class="badge ${klass}">${label}</span>`;
  }

  function responseStatusBadge(status) {
    const map = {
      IN_PROGRESS: ['badge--info', 'Sedang Dikerjakan'],
      MENUNGGU_PENILAIAN: ['badge--warning', 'Menunggu Penilaian'],
      SELESAI: ['badge--success', 'Selesai'],
      TERLAMBAT: ['badge--danger', 'Terlambat']
    };
    const [klass, label] = map[status] || ['badge--muted', status || '-'];
    return `<span class="badge ${klass}">${escapeHtml(label)}</span>`;
  }

  function formatDate(value) {
    if (!value) return '-';
    const normalized = String(value).slice(0, 10);
    const date = new Date(`${normalized}T12:00:00+07:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const textValue = String(value).replace(' ', 'T');
    const date = new Date(textValue.includes('+') ? textValue : `${textValue}+07:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta'
    }).format(date).replace('.', ':') + ' WIB';
  }

  function datetimeLocal(value) {
    if (!value) return '';
    return String(value).replace(' ', 'T').slice(0, 16);
  }

  function normalizeDateInput(value) {
    return value ? String(value).slice(0, 10) : '';
  }

  function normalizeTimeInput(value) {
    return value ? String(value).slice(0, 5) : '';
  }

  function todayJakarta() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const data = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${data.year}-${data.month}-${data.day}`;
  }

  function updateCopyright() {
    text('copyrightYear', new Date().getFullYear());
    if ($('studentScheduleDate')) $('studentScheduleDate').value = todayJakarta();
    if ($('attendanceDateFilter')) $('attendanceDateFilter').value = todayJakarta();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function cssEscape(value) {
    return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function capitalize(value) {
    const textValue = String(value || '').toLowerCase();
    return textValue.charAt(0).toUpperCase() + textValue.slice(1);
  }

  function truncate(value, length) {
    const textValue = String(value || '');
    return textValue.length > length ? textValue.slice(0, length - 1) + '…' : textValue;
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  }

  function refreshIcons() {
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }
})();
