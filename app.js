/*
 * SIAKAD & Absensi Mahasiswa RPL
 * Frontend tanpa framework: HTML + CSS + JavaScript.
 * Backend menggunakan Google Apps Script REST API.
 */

"use strict";

const CONFIG = Object.freeze({
  API_URL: "https://script.google.com/macros/s/AKfycbwE7yUa96819AjBq5gqfiD8snyXwCBgQbbAl2GE5e0Mpa_lMdNLzElNvtIdj-dZCsURqQ/exec",
  SPREADSHEET_URL: "https://docs.google.com/spreadsheets/d/1ps9t-2JpAhO17qXowq6S2KTB9E_vOYhfeHkvDzLQI4s/edit?gid=686153308#gid=686153308",
  TIMEZONE: "Asia/Jakarta",
  TOKEN_KEY: "rpl_session_token",
  USER_KEY: "rpl_session_user",
  EXAM_DRAFT_KEY: "rpl_exam_draft_",
  PAGE_SIZE: 10,
  REQUEST_TIMEOUT: 25000,
});

const state = {
  token: localStorage.getItem(CONFIG.TOKEN_KEY) || "",
  user: safeJSON(localStorage.getItem(CONFIG.USER_KEY), null),
  route: "dashboard",
  serverOffsetMs: 0,
  lastServerSync: null,
  cache: new Map(),
  currentList: [],
  currentEntity: null,
  currentPage: 1,
  currentSearch: "",
  currentFilter: "",
  confirmResolver: null,
  exam: null,
  examTimer: null,
  autosaveTimer: null,
};

const dom = {};

const ADMIN_NAV = [
  { section: "UTAMA" },
  { route: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { route: "students", label: "Data Mahasiswa", icon: "users" },
  { route: "lecturers", label: "Data Dosen", icon: "contact-round" },
  { route: "courses", label: "Mata Kuliah", icon: "book-open" },
  { section: "PERKULIAHAN" },
  { route: "schedules", label: "Jadwal Kuliah", icon: "calendar-days" },
  { route: "meetings", label: "Pertemuan", icon: "calendar-clock" },
  { route: "attendance", label: "Monitoring Absensi", icon: "clipboard-check" },
  { route: "attendance-recap", label: "Rekap Absensi", icon: "chart-no-axes-column" },
  { section: "UJIAN & NILAI" },
  { route: "exams", label: "UTS / UAS", icon: "file-pen-line" },
  { route: "questions", label: "Bank Soal", icon: "list-checks" },
  { route: "grading", label: "Penilaian", icon: "graduation-cap" },
  { section: "SISTEM" },
  { route: "announcements", label: "Pengumuman", icon: "megaphone" },
  { route: "settings", label: "Pengaturan", icon: "settings" },
  { route: "audit", label: "Audit Log", icon: "history" },
];

const STUDENT_NAV = [
  { section: "UTAMA" },
  { route: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { route: "my-schedule", label: "Jadwal Kuliah", icon: "calendar-days" },
  { route: "my-attendance", label: "Absensi Hari Ini", icon: "scan-line" },
  { route: "attendance-history", label: "Riwayat Absensi", icon: "clipboard-list" },
  { section: "UJIAN" },
  { route: "my-exams", label: "UTS / UAS", icon: "file-pen-line" },
  { route: "my-results", label: "Hasil Ujian", icon: "award" },
  { section: "INFORMASI" },
  { route: "announcements", label: "Pengumuman", icon: "megaphone" },
  { route: "profile", label: "Profil", icon: "user-round" },
];

const ROUTE_META = {
  dashboard: ["Dashboard", "RINGKASAN SISTEM"],
  students: ["Data Mahasiswa", "MANAJEMEN PENGGUNA"],
  lecturers: ["Data Dosen", "DATA AKADEMIK"],
  courses: ["Mata Kuliah", "DATA AKADEMIK"],
  schedules: ["Jadwal Perkuliahan", "PERKULIAHAN"],
  meetings: ["Pertemuan Perkuliahan", "PERKULIAHAN"],
  attendance: ["Monitoring Absensi", "ABSENSI"],
  "attendance-recap": ["Rekap Absensi", "ABSENSI"],
  exams: ["Data UTS / UAS", "UJIAN"],
  questions: ["Bank Soal", "UJIAN"],
  grading: ["Penilaian", "UJIAN"],
  announcements: ["Pengumuman", "INFORMASI"],
  settings: ["Pengaturan", "SISTEM"],
  audit: ["Audit Log", "SISTEM"],
  "my-schedule": ["Jadwal Kuliah", "PERKULIAHAN"],
  "my-attendance": ["Absensi Hari Ini", "ABSENSI"],
  "attendance-history": ["Riwayat Absensi", "ABSENSI"],
  "my-exams": ["UTS / UAS", "UJIAN"],
  "my-results": ["Hasil Ujian", "UJIAN"],
  profile: ["Profil Saya", "AKUN"],
  "change-password": ["Ganti Password", "KEAMANAN AKUN"],
};

const ENTITY_CONFIG = {
  students: {
    title: "Data Mahasiswa",
    description: "Kelola akun mahasiswa Semester 6 dan Semester 8.",
    icon: "users",
    listAction: "getUsers",
    createAction: "createUser",
    updateAction: "updateUser",
    deleteAction: "deleteUser",
    idKey: "user_id",
    listKeys: ["users", "items", "rows"],
    fixedPayload: { role: "student" },
    columns: [
      { key: "nim", label: "NIM" },
      { key: "full_name", fallback: "name", label: "Nama Mahasiswa", primary: true },
      { key: "semester", label: "Semester", badge: true },
      { key: "email", label: "Email" },
      { key: "phone", label: "No. HP" },
      { key: "status", label: "Status", badge: true },
    ],
    fields: [
      field("nim", "NIM", "text", true),
      field("full_name", "Nama Lengkap", "text", true),
      field("username", "Username", "text", true),
      field("email", "Email", "email"),
      field("phone", "No. HP", "tel"),
      selectField("semester", "Semester", ["6", "8"], true),
      selectField("status", "Status", ["active", "inactive"], true, "active"),
      field("password", "Password", "password", false, "Kosongkan saat edit apabila tidak diubah."),
    ],
  },
  lecturers: {
    title: "Data Dosen",
    description: "Kelola dosen pengampu dan informasi kontak.",
    icon: "contact-round",
    listAction: "getLecturers",
    createAction: "createLecturer",
    updateAction: "updateLecturer",
    deleteAction: "deleteLecturer",
    idKey: "lecturer_id",
    listKeys: ["lecturers", "items", "rows"],
    columns: [
      { key: "lecturer_name", fallback: "name", label: "Nama Dosen", primary: true },
      { key: "phone", label: "No. HP" },
      { key: "email", label: "Email" },
      { key: "status", label: "Status", badge: true },
    ],
    fields: [
      field("lecturer_name", "Nama Dosen", "text", true),
      field("phone", "No. HP", "tel"),
      field("email", "Email", "email"),
      selectField("status", "Status", ["active", "inactive"], true, "active"),
    ],
  },
  courses: {
    title: "Mata Kuliah",
    description: "Data mata kuliah RPL untuk Semester 6 dan Semester 8.",
    icon: "book-open",
    listAction: "getCourses",
    createAction: "createCourse",
    updateAction: "updateCourse",
    deleteAction: "deleteCourse",
    idKey: "course_id",
    listKeys: ["courses", "items", "rows"],
    columns: [
      { key: "course_code", label: "Kode" },
      { key: "course_name", fallback: "name", label: "Mata Kuliah", primary: true },
      { key: "semester", label: "Semester", badge: true },
      { key: "credits", fallback: "sks", label: "SKS" },
      { key: "lecturer_name", fallback: "lecturer_id", label: "Dosen" },
      { key: "learning_media", label: "Media" },
      { key: "status", label: "Status", badge: true },
    ],
    fields: [
      field("course_code", "Kode Mata Kuliah", "text", true),
      field("course_name", "Nama Mata Kuliah", "text", true),
      selectField("semester", "Semester", ["6", "8"], true),
      field("credits", "SKS", "number", true),
      field("lecturer_id", "ID Dosen", "text"),
      field("learning_media", "Media Pembelajaran", "text", false, "Contoh: Zoom Meeting"),
      selectField("status", "Status", ["active", "inactive"], true, "active"),
    ],
  },
  schedules: {
    title: "Jadwal Perkuliahan",
    description: "Atur hari dan jam perkuliahan. Data dapat juga diedit melalui Spreadsheet.",
    icon: "calendar-days",
    listAction: "getSchedules",
    createAction: "createSchedule",
    updateAction: "updateSchedule",
    deleteAction: "deleteSchedule",
    idKey: "schedule_id",
    listKeys: ["schedules", "items", "rows"],
    columns: [
      { key: "course_name", fallback: "course_id", label: "Mata Kuliah", primary: true },
      { key: "semester", label: "Semester", badge: true },
      { key: "day", label: "Hari" },
      { key: "meeting_number", label: "Ke" },
      { key: "start_time", label: "Mulai" },
      { key: "end_time", label: "Selesai" },
      { key: "room_or_media", label: "Media" },
      { key: "status", label: "Status", badge: true },
    ],
    fields: [
      field("course_id", "ID Mata Kuliah", "text", true),
      selectField("semester", "Semester", ["6", "8"], true),
      selectField("day", "Hari", ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"], true),
      field("meeting_number", "Urutan Jadwal", "number", true),
      field("start_time", "Jam Mulai", "time", true),
      field("end_time", "Jam Selesai", "time", true),
      field("room_or_media", "Ruangan / Media", "text"),
      field("attendance_open_minutes_before", "Dibuka Sebelum (menit)", "number", false, "Gunakan 0 apabila dibuka tepat waktu.", "0"),
      field("late_tolerance_minutes", "Toleransi Terlambat (menit)", "number", false, "Contoh: 15", "15"),
      selectField("status", "Status", ["active", "inactive"], true, "active"),
    ],
  },
  meetings: {
    title: "Pertemuan Perkuliahan",
    description: "Buat sesi pertemuan yang menjadi dasar pembukaan absensi.",
    icon: "calendar-clock",
    listAction: "getMeetings",
    createAction: "createMeeting",
    updateAction: "updateMeeting",
    deleteAction: "deleteMeeting",
    idKey: "meeting_id",
    listKeys: ["meetings", "items", "rows"],
    columns: [
      { key: "meeting_date", label: "Tanggal" },
      { key: "course_name", fallback: "course_id", label: "Mata Kuliah", primary: true },
      { key: "semester", label: "Semester", badge: true },
      { key: "meeting_number", label: "Pertemuan" },
      { key: "start_datetime", label: "Mulai", datetime: true },
      { key: "end_datetime", label: "Selesai", datetime: true },
      { key: "attendance_status", label: "Absensi", badge: true },
    ],
    fields: [
      field("schedule_id", "ID Jadwal", "text", true),
      field("course_id", "ID Mata Kuliah", "text", true),
      selectField("semester", "Semester", ["6", "8"], true),
      field("meeting_number", "Pertemuan Ke", "number", true),
      field("meeting_date", "Tanggal Pertemuan", "date", true),
      field("topic", "Topik Perkuliahan", "text"),
      field("start_datetime", "Waktu Mulai", "datetime-local", true),
      field("end_datetime", "Waktu Selesai", "datetime-local", true),
      selectField("attendance_status", "Status Absensi", ["scheduled", "open", "closed"], true, "scheduled"),
      textareaField("notes", "Catatan"),
    ],
    extraActions: [
      { action: "openAttendance", label: "Buka", icon: "door-open", className: "success" },
      { action: "closeAttendance", label: "Tutup", icon: "door-closed", className: "danger" },
    ],
  },
  exams: {
    title: "Data UTS / UAS",
    description: "Atur jadwal ujian, durasi, percobaan, dan publikasi nilai.",
    icon: "file-pen-line",
    listAction: "getExams",
    createAction: "createExam",
    updateAction: "updateExam",
    deleteAction: "deleteExam",
    idKey: "exam_id",
    listKeys: ["exams", "items", "rows"],
    columns: [
      { key: "exam_title", fallback: "title", label: "Nama Ujian", primary: true },
      { key: "exam_type", label: "Jenis", badge: true },
      { key: "course_name", fallback: "course_id", label: "Mata Kuliah" },
      { key: "semester", label: "Semester", badge: true },
      { key: "start_datetime", label: "Mulai", datetime: true },
      { key: "end_datetime", label: "Selesai", datetime: true },
      { key: "duration_minutes", label: "Durasi" },
      { key: "status", label: "Status", badge: true },
    ],
    fields: [
      field("exam_title", "Judul Ujian", "text", true),
      selectField("exam_type", "Jenis Ujian", ["UTS", "UAS"], true),
      field("course_id", "ID Mata Kuliah", "text", true),
      selectField("semester", "Semester", ["6", "8"], true),
      field("start_datetime", "Mulai Ujian", "datetime-local", true),
      field("end_datetime", "Batas Akhir Ujian", "datetime-local", true),
      field("duration_minutes", "Durasi (menit)", "number", true),
      field("max_attempts", "Maksimal Percobaan", "number", true, "Umumnya diisi 1.", "1"),
      checkboxField("randomize_questions", "Acak urutan soal"),
      checkboxField("randomize_options", "Acak pilihan jawaban"),
      checkboxField("show_score", "Tampilkan nilai setelah dipublikasikan"),
      checkboxField("published", "Publikasikan nilai"),
      selectField("status", "Status", ["draft", "active", "inactive", "closed"], true, "draft"),
    ],
  },
  questions: {
    title: "Bank Soal",
    description: "Kelola soal pilihan ganda dan esai untuk UTS/UAS.",
    icon: "list-checks",
    listAction: "getQuestions",
    createAction: "createQuestion",
    updateAction: "updateQuestion",
    deleteAction: "deleteQuestion",
    idKey: "question_id",
    listKeys: ["questions", "items", "rows"],
    columns: [
      { key: "exam_id", label: "ID Ujian" },
      { key: "question_number", label: "No." },
      { key: "question_type", label: "Jenis", badge: true },
      { key: "question_text", label: "Pertanyaan", primary: true, truncate: 80 },
      { key: "weight", label: "Bobot" },
      { key: "status", label: "Status", badge: true },
    ],
    fields: [
      field("exam_id", "ID Ujian", "text", true),
      field("question_number", "Nomor Soal", "number", true),
      selectField("question_type", "Jenis Soal", ["multiple_choice", "essay"], true),
      textareaField("question_text", "Pertanyaan", true),
      field("image_url", "URL Gambar", "url"),
      field("option_a", "Pilihan A", "text"),
      field("option_b", "Pilihan B", "text"),
      field("option_c", "Pilihan C", "text"),
      field("option_d", "Pilihan D", "text"),
      field("option_e", "Pilihan E", "text"),
      field("correct_answer", "Kunci Jawaban", "text", false, "Isi A, B, C, D, atau E untuk pilihan ganda."),
      field("weight", "Bobot Nilai", "number", true, "Contoh: 5", "1"),
      textareaField("explanation", "Pembahasan"),
      selectField("status", "Status", ["active", "inactive"], true, "active"),
    ],
  },
  announcements: {
    title: "Pengumuman",
    description: "Publikasikan informasi untuk admin, mahasiswa, atau semester tertentu.",
    icon: "megaphone",
    listAction: "getAnnouncements",
    createAction: "createAnnouncement",
    updateAction: "updateAnnouncement",
    deleteAction: "deleteAnnouncement",
    idKey: "announcement_id",
    listKeys: ["announcements", "items", "rows"],
    columns: [
      { key: "title", label: "Judul", primary: true },
      { key: "target_role", label: "Target", badge: true },
      { key: "target_semester", label: "Semester", badge: true },
      { key: "start_date", label: "Mulai" },
      { key: "end_date", label: "Selesai" },
      { key: "status", label: "Status", badge: true },
    ],
    fields: [
      field("title", "Judul", "text", true),
      textareaField("content", "Isi Pengumuman", true),
      selectField("target_role", "Target Pengguna", ["all", "admin", "student"], true, "all"),
      selectField("target_semester", "Target Semester", ["all", "6", "8"], true, "all"),
      field("start_date", "Tanggal Mulai", "date", true),
      field("end_date", "Tanggal Selesai", "date", true),
      selectField("status", "Status", ["active", "inactive", "draft"], true, "active"),
    ],
  },
};

function field(name, label, type = "text", required = false, help = "", defaultValue = "") {
  return { name, label, type, required, help, defaultValue };
}
function selectField(name, label, options, required = false, defaultValue = "") {
  return { name, label, type: "select", options, required, defaultValue };
}
function textareaField(name, label, required = false, help = "") {
  return { name, label, type: "textarea", required, help };
}
function checkboxField(name, label, defaultValue = false) {
  return { name, label, type: "checkbox", defaultValue };
}

window.addEventListener("DOMContentLoaded", init);

async function init() {
  mapDom();
  bindGlobalEvents();
  dom.spreadsheetLink.href = CONFIG.SPREADSHEET_URL;
  startServerClock();
  refreshIcons();
  await pingApi();

  if (state.token) {
    await restoreSession();
  } else {
    showLogin();
  }
}

function mapDom() {
  [
    "loginView", "appView", "loginForm", "loginUsername", "loginPassword", "loginError", "loginButton",
    "togglePassword", "connectionBadge", "sidebar", "sidebarNav", "sidebarBackdrop", "menuButton",
    "syncButton", "spreadsheetLink", "logoutButton", "dropdownLogout", "notificationButton", "notificationDot",
    "userMenuButton", "userDropdown", "userAvatar", "userName", "userRole", "pageTitle", "pageEyebrow",
    "serverTime", "serverDate", "mainContent", "lastSync", "modal", "modalBackdrop", "modalClose",
    "modalTitle", "modalEyebrow", "modalBody", "modalFooter", "confirmDialog", "confirmTitle", "confirmMessage",
    "confirmCancel", "confirmOkay", "loadingOverlay", "loadingText", "toastContainer"
  ].forEach((id) => { dom[id] = document.getElementById(id); });
}

function bindGlobalEvents() {
  dom.loginForm.addEventListener("submit", handleLogin);
  dom.togglePassword.addEventListener("click", () => {
    const isPassword = dom.loginPassword.type === "password";
    dom.loginPassword.type = isPassword ? "text" : "password";
    dom.togglePassword.innerHTML = icon(isPassword ? "eye-off" : "eye");
    refreshIcons();
  });

  dom.sidebarNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-route]");
    if (!button) return;
    navigate(button.dataset.route);
    closeSidebar();
  });

  dom.menuButton.addEventListener("click", openSidebar);
  dom.sidebarBackdrop.addEventListener("click", closeSidebar);
  dom.syncButton.addEventListener("click", async () => {
    state.cache.clear();
    await navigate(state.route, true);
    toast("success", "Sinkronisasi selesai", "Data terbaru telah dimuat dari Google Spreadsheet.");
  });
  dom.logoutButton.addEventListener("click", requestLogout);
  dom.dropdownLogout.addEventListener("click", requestLogout);

  dom.userMenuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    dom.userDropdown.classList.toggle("hidden");
  });
  dom.userDropdown.addEventListener("click", (event) => {
    const button = event.target.closest("[data-route]");
    if (button) navigate(button.dataset.route);
    dom.userDropdown.classList.add("hidden");
  });
  document.addEventListener("click", () => dom.userDropdown.classList.add("hidden"));

  dom.notificationButton.addEventListener("click", () => navigate("announcements"));
  dom.modalClose.addEventListener("click", closeModal);
  dom.modalBackdrop.addEventListener("click", closeModal);
  dom.confirmCancel.addEventListener("click", () => resolveConfirm(false));
  dom.confirmOkay.addEventListener("click", () => resolveConfirm(true));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!dom.confirmDialog.classList.contains("hidden")) resolveConfirm(false);
      else if (!dom.modal.classList.contains("hidden")) closeModal();
      else closeSidebar();
    }
  });
}

async function pingApi() {
  setConnection("checking", "Memeriksa koneksi API…");
  try {
    const result = await api("getServerTime", {}, { method: "GET", public: true, timeout: 12000, silent: true });
    updateServerClockFromResponse(result);
    setConnection("online", "API terhubung");
  } catch (_) {
    try {
      const result = await api("getSettings", {}, { method: "GET", public: true, timeout: 12000, silent: true });
      updateServerClockFromResponse(result);
      setConnection("online", "API terhubung");
    } catch (error) {
      setConnection("offline", "API belum merespons");
    }
  }
}

function setConnection(status, text) {
  dom.connectionBadge.className = `connection-badge ${status}`;
  dom.connectionBadge.textContent = text;
}

async function restoreSession() {
  showLoading("Memvalidasi sesi…");
  try {
    const response = await api("validateSession", {}, { method: "POST" });
    const data = responseData(response);
    const user = data.user || data.profile || data;
    if (!user || !getValue(user, "role")) throw new Error("Data sesi tidak lengkap.");
    saveSession(state.token, user);
    enterApp();
  } catch (error) {
    clearSession();
    showLogin();
    toast("warning", "Sesi berakhir", "Silakan masuk kembali untuk melanjutkan.");
  } finally {
    hideLoading();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = dom.loginUsername.value.trim();
  const password = dom.loginPassword.value;
  dom.loginError.classList.add("hidden");

  if (!username || !password) {
    showLoginError("NIM/username dan password wajib diisi.");
    return;
  }

  setButtonLoading(dom.loginButton, true, "Memproses…");
  try {
    const response = await api("login", { username, password }, { public: true });
    const data = responseData(response);
    const token = data.token || data.sessionToken || data.session_token || response.token;
    const user = data.user || data.profile || response.user;
    if (!token || !user) throw new Error("Respons login tidak memuat token atau data pengguna.");
    saveSession(token, user);
    dom.loginForm.reset();
    enterApp();
    toast("success", "Login berhasil", `Selamat datang, ${displayName(user)}.`);
  } catch (error) {
    showLoginError(error.message || "Login gagal. Periksa username dan password.");
  } finally {
    setButtonLoading(dom.loginButton, false, "Masuk");
  }
}

function showLoginError(message) {
  dom.loginError.textContent = message;
  dom.loginError.classList.remove("hidden");
}

function saveSession(token, user) {
  state.token = token;
  state.user = normalizeUser(user);
  localStorage.setItem(CONFIG.TOKEN_KEY, token);
  localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(state.user));
}

function clearSession() {
  state.token = "";
  state.user = null;
  state.cache.clear();
  localStorage.removeItem(CONFIG.TOKEN_KEY);
  localStorage.removeItem(CONFIG.USER_KEY);
}

function normalizeUser(user) {
  return {
    ...user,
    user_id: user.user_id || user.userId || user.id || "",
    full_name: user.full_name || user.fullName || user.name || "Pengguna",
    role: String(user.role || "student").toLowerCase(),
    semester: user.semester || "",
    nim: user.nim || "",
  };
}

function showLogin() {
  dom.appView.classList.add("hidden");
  dom.loginView.classList.remove("hidden");
  requestAnimationFrame(() => dom.loginUsername.focus());
  refreshIcons();
}

function enterApp() {
  dom.loginView.classList.add("hidden");
  dom.appView.classList.remove("hidden");
  updateUserDisplay();
  renderSidebar();
  state.route = "dashboard";
  navigate("dashboard", true);
  refreshIcons();
}

function updateUserDisplay() {
  const name = displayName(state.user);
  dom.userName.textContent = name;
  dom.userRole.textContent = isAdmin() ? "Administrator" : `Mahasiswa · Semester ${state.user.semester || "-"}`;
  dom.userAvatar.textContent = initials(name);
  dom.spreadsheetLink.classList.toggle("hidden", !isAdmin());
}

function renderSidebar() {
  const items = isAdmin() ? ADMIN_NAV : STUDENT_NAV;
  dom.sidebarNav.innerHTML = items.map((item) => {
    if (item.section) return `<span class="nav-section-title">${escapeHTML(item.section)}</span>`;
    return `
      <button class="nav-item ${state.route === item.route ? "active" : ""}" data-route="${item.route}" type="button">
        ${icon(item.icon)}<span>${escapeHTML(item.label)}</span>${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ""}
      </button>`;
  }).join("");
  refreshIcons();
}

async function requestLogout() {
  const accepted = await confirmAction("Keluar dari aplikasi?", "Sesi Anda akan diakhiri pada perangkat ini.", "Keluar");
  if (!accepted) return;
  showLoading("Mengakhiri sesi…");
  try {
    await api("logout", {}, { silent: true });
  } catch (_) {
    // Sesi lokal tetap dibersihkan apabila server tidak dapat dihubungi.
  } finally {
    clearSession();
    hideLoading();
    showLogin();
  }
}

async function navigate(route, force = false) {
  if (!route) route = "dashboard";
  if (!isRouteAllowed(route)) route = "dashboard";
  state.route = route;
  state.currentPage = 1;
  state.currentSearch = "";
  state.currentFilter = "";
  updateRouteUI();
  renderSidebar();
  dom.mainContent.innerHTML = skeletonPage();
  refreshIcons();

  try {
    switch (route) {
      case "dashboard": await renderDashboard(force); break;
      case "students": await renderEntityPage("students", force); break;
      case "lecturers": await renderEntityPage("lecturers", force); break;
      case "courses": await renderEntityPage("courses", force); break;
      case "schedules": await renderEntityPage("schedules", force); break;
      case "meetings": await renderEntityPage("meetings", force); break;
      case "attendance": await renderAdminAttendance(force); break;
      case "attendance-recap": await renderAttendanceRecap(force); break;
      case "exams": await renderEntityPage("exams", force); break;
      case "questions": await renderEntityPage("questions", force); break;
      case "grading": await renderGrading(force); break;
      case "announcements": isAdmin() ? await renderEntityPage("announcements", force) : await renderStudentAnnouncements(force); break;
      case "settings": await renderSettings(force); break;
      case "audit": await renderAudit(force); break;
      case "my-schedule": await renderStudentSchedule(force); break;
      case "my-attendance": await renderStudentAttendance(force); break;
      case "attendance-history": await renderStudentAttendanceHistory(force); break;
      case "my-exams": await renderStudentExams(force); break;
      case "my-results": await renderStudentResults(force); break;
      case "profile": renderProfile(); break;
      case "change-password": renderChangePassword(); break;
      default: renderNotFound();
    }
    state.lastServerSync = new Date(serverNow());
    dom.lastSync.textContent = `Sinkronisasi: ${formatDateTime(state.lastServerSync)}`;
  } catch (error) {
    if (error.code === "SESSION_EXPIRED" || error.status === 401) {
      clearSession();
      showLogin();
      toast("warning", "Sesi berakhir", "Silakan masuk kembali.");
      return;
    }
    renderErrorState(error);
  } finally {
    refreshIcons();
    dom.mainContent.focus({ preventScroll: true });
  }
}

function updateRouteUI() {
  const meta = ROUTE_META[state.route] || ["Halaman", "SIAKAD RPL"];
  dom.pageTitle.textContent = meta[0];
  dom.pageEyebrow.textContent = meta[1];
  document.title = `${meta[0]} · SIAKAD RPL`;
}

function isRouteAllowed(route) {
  const adminOnly = ["students", "lecturers", "courses", "schedules", "meetings", "attendance", "attendance-recap", "exams", "questions", "grading", "settings", "audit"];
  const studentOnly = ["my-schedule", "my-attendance", "attendance-history", "my-exams", "my-results"];
  if (adminOnly.includes(route) && !isAdmin()) return false;
  if (studentOnly.includes(route) && isAdmin()) return false;
  return true;
}

async function renderDashboard(force) {
  const action = isAdmin() ? "getAdminDashboard" : "getStudentDashboard";
  const data = await getData(action, {}, `dashboard:${state.user.user_id || state.user.nim}`, force);
  const dashboard = responseData(data);
  dom.mainContent.innerHTML = isAdmin() ? adminDashboardHTML(dashboard) : studentDashboardHTML(dashboard);
  bindRouteButtons();
}

function adminDashboardHTML(data) {
  const metrics = data.metrics || data.summary || data;
  const schedules = asArray(data.schedulesToday || data.todaySchedules || data.schedules);
  const activities = asArray(data.recentActivities || data.auditLogs || data.activities);
  const attendance = data.attendanceSummary || data.attendance || {};

  return `
    ${pageHeader("Dashboard Admin", `Ringkasan kegiatan akademik pada ${formatDate(new Date(serverNow()))}.`, `
      <button class="button button-outline" data-refresh-route type="button">${icon("refresh-cw")} Refresh</button>
      <a class="button button-gold" href="${escapeAttr(CONFIG.SPREADSHEET_URL)}" target="_blank" rel="noopener noreferrer">${icon("sheet")} Spreadsheet</a>
    `)}
    <div class="grid stats-grid">
      ${statCard("Total Mahasiswa", number(metrics.totalStudents || metrics.total_students || 0), "users", "#f8e9ee", "#800020", "Akun mahasiswa aktif")}
      ${statCard("Semester 6", number(metrics.semester6 || metrics.semester_6 || 0), "layers-2", "#dbeafe", "#1d4ed8", "Mahasiswa RPL")}
      ${statCard("Semester 8", number(metrics.semester8 || metrics.semester_8 || 0), "layers-3", "#fef3c7", "#b45309", "Mahasiswa RPL")}
      ${statCard("Mata Kuliah", number(metrics.totalCourses || metrics.total_courses || 0), "book-open", "#dcfce7", "#15803d", "Semester 6 dan 8")}
      ${statCard("Jadwal Hari Ini", number(metrics.todaySchedules || metrics.today_schedules || schedules.length), "calendar-days", "#f3e8ff", "#7e22ce", "Perkuliahan terjadwal")}
      ${statCard("Hadir Hari Ini", number(metrics.presentToday || metrics.present_today || attendance.present || 0), "user-check", "#dcfce7", "#15803d", "Absensi masuk")}
      ${statCard("Belum Absen", number(metrics.notAttended || metrics.not_attended || attendance.pending || 0), "user-x", "#fee2e2", "#b91c1c", "Perlu dipantau")}
      ${statCard("Ujian Aktif", number(metrics.activeExams || metrics.active_exams || 0), "file-pen-line", "#f8e9ee", "#800020", "UTS / UAS")}
    </div>
    <div class="grid two-column">
      <section class="card">
        <div class="card-header"><div><h3>Jadwal Hari Ini</h3><p>Perkuliahan berdasarkan waktu server</p></div><button class="button button-sm button-outline" data-route="schedules">Lihat Semua</button></div>
        <div class="card-body">${scheduleListHTML(schedules)}</div>
      </section>
      <section class="card">
        <div class="card-header"><div><h3>Ringkasan Kehadiran</h3><p>Persentase status absensi</p></div>${icon("chart-pie")}</div>
        <div class="card-body">
          ${progressHTML("Hadir", attendance.present || attendance.hadir || 0, attendance.total || 0)}
          ${progressHTML("Terlambat", attendance.late || attendance.terlambat || 0, attendance.total || 0)}
          ${progressHTML("Izin / Sakit", (number(attendance.permission || attendance.izin) + number(attendance.sick || attendance.sakit)), attendance.total || 0)}
          ${progressHTML("Alfa", attendance.absent || attendance.alfa || 0, attendance.total || 0)}
        </div>
      </section>
      <section class="card" style="grid-column: 1 / -1">
        <div class="card-header"><div><h3>Aktivitas Terbaru</h3><p>Perubahan terakhir yang tercatat dalam sistem</p></div><button class="button button-sm button-outline" data-route="audit">Audit Log</button></div>
        <div class="card-body">${activityListHTML(activities)}</div>
      </section>
    </div>`;
}

function studentDashboardHTML(data) {
  const metrics = data.metrics || data.summary || data;
  const schedules = asArray(data.schedulesToday || data.todaySchedules || data.schedules);
  const exams = asArray(data.upcomingExams || data.exams);
  const announcements = asArray(data.announcements);
  const attendance = data.attendanceSummary || data.attendance || {};
  const percentage = number(attendance.percentage || metrics.attendancePercentage || metrics.attendance_percentage || 0);

  return `
    ${pageHeader(`Assalamu’alaikum, ${escapeHTML(firstName(displayName(state.user)))}`, `Semester ${escapeHTML(state.user.semester || "-")} · ${escapeHTML(state.user.nim || "NIM belum tersedia")}`, `
      <button class="button button-primary" data-route="my-attendance" type="button">${icon("scan-line")} Isi Absensi</button>
    `)}
    <div class="grid stats-grid">
      ${statCard("Kehadiran", `${percentage}%`, "chart-no-axes-column-increasing", "#dcfce7", "#15803d", "Persentase keseluruhan")}
      ${statCard("Total Hadir", number(attendance.present || attendance.hadir || 0), "user-check", "#dbeafe", "#1d4ed8", "Pertemuan")}
      ${statCard("Jadwal Hari Ini", schedules.length, "calendar-days", "#f8e9ee", "#800020", "Mata kuliah")}
      ${statCard("Ujian Tersedia", exams.length, "file-pen-line", "#fef3c7", "#b45309", "UTS / UAS")}
    </div>
    <div class="grid two-column">
      <section class="card">
        <div class="card-header"><div><h3>Jadwal Hari Ini</h3><p>Gunakan waktu server sebagai acuan</p></div><button class="button button-sm button-outline" data-route="my-schedule">Jadwal Lengkap</button></div>
        <div class="card-body">${scheduleListHTML(schedules, true)}</div>
      </section>
      <section class="card">
        <div class="card-header"><div><h3>Ringkasan Kehadiran</h3><p>Semester ${escapeHTML(state.user.semester || "-")}</p></div>${icon("clipboard-check")}</div>
        <div class="card-body">
          ${progressHTML("Hadir", attendance.present || attendance.hadir || 0, attendance.total || 0)}
          ${progressHTML("Terlambat", attendance.late || attendance.terlambat || 0, attendance.total || 0)}
          ${progressHTML("Izin / Sakit", number(attendance.permission || attendance.izin) + number(attendance.sick || attendance.sakit), attendance.total || 0)}
          ${progressHTML("Alfa", attendance.absent || attendance.alfa || 0, attendance.total || 0)}
        </div>
      </section>
      <section class="card">
        <div class="card-header"><div><h3>Ujian Mendatang</h3><p>UTS dan UAS yang dapat diikuti</p></div><button class="button button-sm button-outline" data-route="my-exams">Lihat Ujian</button></div>
        <div class="card-body">${examMiniListHTML(exams)}</div>
      </section>
      <section class="card">
        <div class="card-header"><div><h3>Pengumuman Terbaru</h3><p>Informasi Program Studi</p></div><button class="button button-sm button-outline" data-route="announcements">Lihat Semua</button></div>
        <div class="card-body">${announcementMiniListHTML(announcements)}</div>
      </section>
    </div>`;
}

async function renderEntityPage(entityKey, force = false) {
  const config = ENTITY_CONFIG[entityKey];
  if (!config) throw new Error("Konfigurasi halaman tidak ditemukan.");
  state.currentEntity = entityKey;
  const payload = { ...(config.fixedPayload || {}) };
  const response = await getData(config.listAction, payload, `entity:${entityKey}`, force);
  state.currentList = asArray(responseData(response), config.listKeys);
  renderEntityTable(config);
}

function renderEntityTable(config) {
  const filtered = filterRows(state.currentList, config);
  const totalPages = Math.max(1, Math.ceil(filtered.length / CONFIG.PAGE_SIZE));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  const start = (state.currentPage - 1) * CONFIG.PAGE_SIZE;
  const rows = filtered.slice(start, start + CONFIG.PAGE_SIZE);

  dom.mainContent.innerHTML = `
    ${pageHeader(config.title, config.description, `
      <button class="button button-outline" data-export type="button">${icon("download")} Export CSV</button>
      <button class="button button-primary" data-add type="button">${icon("plus")} Tambah Data</button>
    `)}
    <section class="card">
      <div class="card-header">
        <div><h3>${escapeHTML(config.title)}</h3><p>${filtered.length} data ditemukan</p></div>
        <span class="badge badge-maroon">${icon(config.icon)} Google Spreadsheet</span>
      </div>
      <div class="card-body no-padding">
        <div class="toolbar" style="padding: 15px 16px 0">
          <div class="toolbar-left">
            <div class="search-box">${icon("search")}<input id="entitySearch" type="search" value="${escapeAttr(state.currentSearch)}" placeholder="Cari data…" /></div>
            ${entityFilterHTML(config)}
          </div>
          <div class="toolbar-right"><button class="button button-sm button-secondary" data-refresh-route>${icon("refresh-cw")} Muat Ulang</button></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>${config.columns.map((column) => `<th>${escapeHTML(column.label)}</th>`).join("")}<th>Aksi</th></tr></thead>
            <tbody>
              ${rows.length ? rows.map((row) => entityRowHTML(config, row)).join("") : `<tr><td colspan="${config.columns.length + 1}">${emptyStateHTML("Data belum tersedia", "Tambahkan data melalui aplikasi atau Google Spreadsheet.")}</td></tr>`}
            </tbody>
          </table>
        </div>
        ${paginationHTML(filtered.length, state.currentPage, totalPages)}
      </div>
    </section>`;

  bindEntityEvents(config);
  bindRouteButtons();
  refreshIcons();
}

function entityRowHTML(config, row) {
  const id = row[config.idKey] || row.id || "";
  return `<tr>
    ${config.columns.map((column) => `<td>${formatCell(row, column)}</td>`).join("")}
    <td><div class="table-actions">
      ${config.extraActions ? config.extraActions.map((item) => `<button class="table-icon-button ${item.className || ""}" data-extra-action="${item.action}" data-id="${escapeAttr(id)}" title="${escapeAttr(item.label)}">${icon(item.icon)}</button>`).join("") : ""}
      <button class="table-icon-button" data-edit data-id="${escapeAttr(id)}" title="Edit">${icon("pencil")}</button>
      <button class="table-icon-button danger" data-delete data-id="${escapeAttr(id)}" title="Hapus">${icon("trash-2")}</button>
    </div></td>
  </tr>`;
}

function formatCell(row, column) {
  let value = getValue(row, column.key, column.fallback);
  if (column.datetime && value) value = formatDateTime(value);
  if (column.truncate && value) value = truncate(String(value), column.truncate);
  if (column.badge) return badgeHTML(value);
  if (column.primary) return `<div class="table-primary">${escapeHTML(value || "-")}</div>${row.nim && column.key !== "nim" ? `<div class="table-secondary">${escapeHTML(row.nim)}</div>` : ""}`;
  return escapeHTML(value ?? "-");
}

function entityFilterHTML(config) {
  const hasSemester = config.columns.some((column) => column.key === "semester");
  const hasStatus = config.columns.some((column) => column.key === "status");
  if (hasSemester) return `<select id="entityFilter" class="filter-select"><option value="">Semua Semester</option><option value="6" ${state.currentFilter === "6" ? "selected" : ""}>Semester 6</option><option value="8" ${state.currentFilter === "8" ? "selected" : ""}>Semester 8</option></select>`;
  if (hasStatus) return `<select id="entityFilter" class="filter-select"><option value="">Semua Status</option><option value="active" ${state.currentFilter === "active" ? "selected" : ""}>Aktif</option><option value="inactive" ${state.currentFilter === "inactive" ? "selected" : ""}>Tidak Aktif</option></select>`;
  return "";
}

function filterRows(rows, config) {
  const search = state.currentSearch.toLowerCase().trim();
  return rows.filter((row) => {
    const matchesSearch = !search || config.columns.some((column) => String(getValue(row, column.key, column.fallback) || "").toLowerCase().includes(search));
    if (!matchesSearch) return false;
    if (!state.currentFilter) return true;
    if (config.columns.some((column) => column.key === "semester")) return String(row.semester) === state.currentFilter;
    return String(row.status || "").toLowerCase() === state.currentFilter.toLowerCase();
  });
}

function bindEntityEvents(config) {
  const search = document.getElementById("entitySearch");
  const filter = document.getElementById("entityFilter");
  if (search) search.addEventListener("input", debounce(() => {
    state.currentSearch = search.value;
    state.currentPage = 1;
    renderEntityTable(config);
  }, 250));
  if (filter) filter.addEventListener("change", () => {
    state.currentFilter = filter.value;
    state.currentPage = 1;
    renderEntityTable(config);
  });

  dom.mainContent.querySelector("[data-add]")?.addEventListener("click", () => openEntityForm(config));
  dom.mainContent.querySelector("[data-export]")?.addEventListener("click", () => exportCSV(config.title, filterRows(state.currentList, config), config.columns));
  dom.mainContent.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    const row = findRow(config, button.dataset.id);
    openEntityForm(config, row);
  }));
  dom.mainContent.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteEntity(config, button.dataset.id)));
  dom.mainContent.querySelectorAll("[data-extra-action]").forEach((button) => button.addEventListener("click", () => performExtraAction(config, button.dataset.extraAction, button.dataset.id)));
  bindPagination(config);
}

function findRow(config, id) {
  return state.currentList.find((row) => String(row[config.idKey] || row.id) === String(id)) || {};
}

function openEntityForm(config, row = null) {
  const editing = Boolean(row && Object.keys(row).length);
  const formHTML = `<form id="entityForm" class="form-grid">
    ${config.fields.map((item) => formFieldHTML(item, row || {})).join("")}
  </form>`;
  openModal(editing ? `Edit ${config.title}` : `Tambah ${config.title}`, formHTML, `
    <button type="button" class="button button-secondary" data-modal-cancel>Batal</button>
    <button type="button" class="button button-primary" data-modal-save>${icon("save")} Simpan</button>
  `, editing ? "UBAH DATA" : "DATA BARU");

  document.querySelector("[data-modal-cancel]")?.addEventListener("click", closeModal);
  document.querySelector("[data-modal-save]")?.addEventListener("click", async () => {
    const form = document.getElementById("entityForm");
    if (!form.reportValidity()) return;
    const payload = formToObject(form, config.fields);
    if (editing) payload[config.idKey] = row[config.idKey] || row.id;
    Object.assign(payload, config.fixedPayload || {});
    showLoading("Menyimpan data…");
    try {
      await api(editing ? config.updateAction : config.createAction, payload);
      state.cache.delete(`entity:${state.currentEntity}`);
      closeModal();
      toast("success", "Data tersimpan", `${config.title} berhasil ${editing ? "diperbarui" : "ditambahkan"}.`);
      await renderEntityPage(state.currentEntity, true);
    } catch (error) {
      toast("error", "Gagal menyimpan", error.message);
    } finally {
      hideLoading();
    }
  });
  refreshIcons();
}

function formFieldHTML(item, row) {
  const value = getValue(row, item.name) ?? item.defaultValue ?? "";
  const required = item.required ? "required" : "";
  const full = item.type === "textarea" ? "full" : "";
  if (item.type === "select") {
    return `<div class="form-group ${full}"><label for="field_${item.name}">${escapeHTML(item.label)}${item.required ? " *" : ""}</label><select id="field_${item.name}" name="${item.name}" ${required}><option value="">Pilih…</option>${item.options.map((option) => `<option value="${escapeAttr(option)}" ${String(value).toLowerCase() === String(option).toLowerCase() ? "selected" : ""}>${escapeHTML(humanize(option))}</option>`).join("")}</select>${item.help ? `<small>${escapeHTML(item.help)}</small>` : ""}</div>`;
  }
  if (item.type === "textarea") {
    return `<div class="form-group full"><label for="field_${item.name}">${escapeHTML(item.label)}${item.required ? " *" : ""}</label><textarea id="field_${item.name}" name="${item.name}" ${required}>${escapeHTML(value)}</textarea>${item.help ? `<small>${escapeHTML(item.help)}</small>` : ""}</div>`;
  }
  if (item.type === "checkbox") {
    return `<div class="form-group"><label>${escapeHTML(item.label)}</label><label class="checkbox-row"><input id="field_${item.name}" name="${item.name}" type="checkbox" ${truthy(value) ? "checked" : ""} /><span>Aktifkan pengaturan ini</span></label></div>`;
  }
  const formattedValue = item.type === "datetime-local" ? toDateTimeLocal(value) : value;
  return `<div class="form-group ${full}"><label for="field_${item.name}">${escapeHTML(item.label)}${item.required ? " *" : ""}</label><input id="field_${item.name}" name="${item.name}" type="${item.type}" value="${escapeAttr(formattedValue)}" ${required} ${item.type === "number" ? "step=\"any\"" : ""} />${item.help ? `<small>${escapeHTML(item.help)}</small>` : ""}</div>`;
}

async function deleteEntity(config, id) {
  const row = findRow(config, id);
  const label = row.full_name || row.course_name || row.lecturer_name || row.exam_title || row.title || row.question_text || id;
  const accepted = await confirmAction("Hapus data?", `Data “${truncate(String(label), 70)}” akan dihapus.`, "Hapus");
  if (!accepted) return;
  showLoading("Menghapus data…");
  try {
    await api(config.deleteAction, { [config.idKey]: id, id });
    state.cache.delete(`entity:${state.currentEntity}`);
    toast("success", "Data dihapus", "Data berhasil dihapus dari sistem.");
    await renderEntityPage(state.currentEntity, true);
  } catch (error) {
    toast("error", "Gagal menghapus", error.message);
  } finally {
    hideLoading();
  }
}

async function performExtraAction(config, action, id) {
  const accepted = await confirmAction(`${humanize(action)}?`, "Perubahan akan dicatat pada Audit Log.", "Lanjutkan");
  if (!accepted) return;
  showLoading("Memproses…");
  try {
    await api(action, { [config.idKey]: id, id });
    state.cache.delete(`entity:${state.currentEntity}`);
    toast("success", "Berhasil", `${humanize(action)} berhasil dilakukan.`);
    await renderEntityPage(state.currentEntity, true);
  } catch (error) {
    toast("error", "Proses gagal", error.message);
  } finally {
    hideLoading();
  }
}

async function renderAdminAttendance(force) {
  const response = await getData("getAttendanceRecords", {}, "attendance:admin", force);
  const rows = asArray(responseData(response), ["attendance", "records", "items", "rows"]);
  state.currentList = rows;
  dom.mainContent.innerHTML = `
    ${pageHeader("Monitoring Absensi", "Pantau kehadiran mahasiswa berdasarkan pertemuan dan waktu server.", `
      <button class="button button-outline" id="attendanceExport">${icon("download")} Export CSV</button>
      <button class="button button-primary" data-route="meetings">${icon("calendar-plus")} Kelola Pertemuan</button>
    `)}
    <div class="grid stats-grid">
      ${statCard("Total Rekaman", rows.length, "clipboard-list", "#f8e9ee", "#800020", "Seluruh status")}
      ${statCard("Hadir", rows.filter((r) => lower(r.status) === "hadir" || lower(r.status) === "present").length, "user-check", "#dcfce7", "#15803d", "Tercatat hadir")}
      ${statCard("Terlambat", rows.filter((r) => lower(r.status) === "terlambat" || lower(r.status) === "late").length, "clock-alert", "#fef3c7", "#b45309", "Melewati toleransi")}
      ${statCard("Alfa", rows.filter((r) => lower(r.status) === "alfa" || lower(r.status) === "absent").length, "user-x", "#fee2e2", "#b91c1c", "Tidak hadir")}
    </div>
    <section class="card">
      <div class="card-header"><div><h3>Daftar Absensi</h3><p>${rows.length} rekaman ditemukan</p></div><button class="button button-sm button-secondary" data-refresh-route>${icon("refresh-cw")} Muat Ulang</button></div>
      <div class="card-body no-padding">
        <div class="toolbar" style="padding:15px 16px 0"><div class="toolbar-left"><div class="search-box">${icon("search")}<input id="attendanceSearch" type="search" placeholder="Cari NIM, nama, atau mata kuliah…"></div><select id="attendanceStatus" class="filter-select"><option value="">Semua Status</option><option>Hadir</option><option>Terlambat</option><option>Izin</option><option>Sakit</option><option>Alfa</option></select></div></div>
        <div id="attendanceTable"></div>
      </div>
    </section>`;
  const render = () => renderAttendanceTable(rows);
  document.getElementById("attendanceSearch")?.addEventListener("input", debounce(render, 200));
  document.getElementById("attendanceStatus")?.addEventListener("change", render);
  document.getElementById("attendanceExport")?.addEventListener("click", () => exportCSV("Rekap Absensi", rows));
  render();
  bindRouteButtons();
}

function renderAttendanceTable(rows) {
  const query = lower(document.getElementById("attendanceSearch")?.value || "");
  const status = lower(document.getElementById("attendanceStatus")?.value || "");
  const filtered = rows.filter((row) => {
    const haystack = [row.nim, row.student_name, row.full_name, row.course_name, row.status].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!status || lower(row.status) === status);
  });
  const container = document.getElementById("attendanceTable");
  if (!container) return;
  container.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Tanggal / Waktu</th><th>Mahasiswa</th><th>Mata Kuliah</th><th>Semester</th><th>Status</th><th>Catatan</th><th>Aksi</th></tr></thead><tbody>${filtered.length ? filtered.map((row) => `<tr>
    <td><div class="table-primary">${escapeHTML(formatDate(row.attendance_date || row.server_datetime || row.created_at))}</div><div class="table-secondary">${escapeHTML(row.attendance_time || formatTime(row.server_datetime || row.created_at))}</div></td>
    <td><div class="table-primary">${escapeHTML(row.student_name || row.full_name || "-")}</div><div class="table-secondary">${escapeHTML(row.nim || "-")}</div></td>
    <td>${escapeHTML(row.course_name || row.course_id || "-")}</td><td>${badgeHTML(row.semester)}</td><td>${badgeHTML(row.status)}</td><td>${escapeHTML(row.notes || "-")}</td>
    <td><button class="table-icon-button" data-edit-attendance="${escapeAttr(row.attendance_id || row.id || "")}" title="Ubah status">${icon("pencil")}</button></td>
  </tr>`).join("") : `<tr><td colspan="7">${emptyStateHTML("Tidak ada data", "Sesuaikan pencarian atau filter status.")}</td></tr>`}</tbody></table></div>`;
  container.querySelectorAll("[data-edit-attendance]").forEach((button) => button.addEventListener("click", () => {
    const row = rows.find((item) => String(item.attendance_id || item.id) === button.dataset.editAttendance);
    openAttendanceEdit(row);
  }));
  refreshIcons();
}

function openAttendanceEdit(row) {
  openModal("Ubah Status Absensi", `<form id="attendanceEditForm" class="form-grid">
    <div class="form-group full"><label>Mahasiswa</label><input disabled value="${escapeAttr(`${row.student_name || row.full_name || "-"} (${row.nim || "-"})`)}"></div>
    <div class="form-group"><label>Status *</label><select name="status" required>${["Hadir", "Terlambat", "Izin", "Sakit", "Alfa"].map((item) => `<option ${lower(row.status) === lower(item) ? "selected" : ""}>${item}</option>`).join("")}</select></div>
    <div class="form-group full"><label>Catatan</label><textarea name="notes">${escapeHTML(row.notes || "")}</textarea></div>
  </form>`, `<button class="button button-secondary" data-modal-cancel>Batal</button><button class="button button-primary" data-save-attendance>${icon("save")} Simpan</button>`, "ABSENSI");
  document.querySelector("[data-modal-cancel]")?.addEventListener("click", closeModal);
  document.querySelector("[data-save-attendance]")?.addEventListener("click", async () => {
    const form = document.getElementById("attendanceEditForm");
    if (!form.reportValidity()) return;
    const payload = Object.fromEntries(new FormData(form));
    payload.attendance_id = row.attendance_id || row.id;
    showLoading("Memperbarui absensi…");
    try {
      await api("updateAttendance", payload);
      state.cache.delete("attendance:admin");
      closeModal();
      toast("success", "Absensi diperbarui", "Perubahan dicatat pada Audit Log.");
      await renderAdminAttendance(true);
    } catch (error) { toast("error", "Gagal memperbarui", error.message); }
    finally { hideLoading(); }
  });
  refreshIcons();
}

async function renderAttendanceRecap(force) {
  const response = await getData("getAttendanceRecap", {}, "attendance:recap", force);
  const data = responseData(response);
  const rows = asArray(data, ["recap", "items", "rows", "students"]);
  dom.mainContent.innerHTML = `
    ${pageHeader("Rekap Absensi", "Ringkasan kehadiran per mahasiswa atau mata kuliah.", `<button id="recapExport" class="button button-outline">${icon("download")} Export CSV</button><button class="button button-primary" onclick="window.print()">${icon("printer")} Cetak</button>`)}
    <section class="card"><div class="card-header"><div><h3>Rekap Kehadiran</h3><p>Data diambil dari sheet Attendance</p></div><span class="badge badge-maroon">${rows.length} baris</span></div><div class="card-body no-padding"><div class="table-wrap"><table><thead><tr><th>Mahasiswa</th><th>Semester</th><th>Mata Kuliah</th><th>Hadir</th><th>Terlambat</th><th>Izin</th><th>Sakit</th><th>Alfa</th><th>Persentase</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td><div class="table-primary">${escapeHTML(row.student_name || row.full_name || "-")}</div><div class="table-secondary">${escapeHTML(row.nim || "-")}</div></td><td>${badgeHTML(row.semester)}</td><td>${escapeHTML(row.course_name || "Semua Mata Kuliah")}</td><td>${number(row.present || row.hadir)}</td><td>${number(row.late || row.terlambat)}</td><td>${number(row.permission || row.izin)}</td><td>${number(row.sick || row.sakit)}</td><td>${number(row.absent || row.alfa)}</td><td><strong>${number(row.percentage || row.persentase)}%</strong></td></tr>`).join("") : `<tr><td colspan="9">${emptyStateHTML("Rekap belum tersedia", "Pastikan data absensi sudah tercatat.")}</td></tr>`}</tbody></table></div></div></section>`;
  document.getElementById("recapExport")?.addEventListener("click", () => exportCSV("Rekap Absensi", rows));
  refreshIcons();
}

async function renderGrading(force) {
  const response = await getData("getExamAttempts", {}, "grading", force);
  const rows = asArray(responseData(response), ["attempts", "items", "rows"]);
  dom.mainContent.innerHTML = `
    ${pageHeader("Penilaian Ujian", "Periksa jawaban esai, nilai otomatis, dan publikasi hasil.", `<button class="button button-outline" data-refresh-route>${icon("refresh-cw")} Muat Ulang</button>`)}
    <section class="card"><div class="card-header"><div><h3>Percobaan Ujian Mahasiswa</h3><p>${rows.length} percobaan ditemukan</p></div></div><div class="card-body no-padding"><div class="table-wrap"><table><thead><tr><th>Mahasiswa</th><th>Ujian</th><th>Mulai</th><th>Dikirim</th><th>Status</th><th>PG</th><th>Esai</th><th>Nilai Akhir</th><th>Aksi</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td><div class="table-primary">${escapeHTML(row.student_name || row.full_name || "-")}</div><div class="table-secondary">${escapeHTML(row.nim || "-")}</div></td><td>${escapeHTML(row.exam_title || row.exam_id || "-")}</td><td>${escapeHTML(formatDateTime(row.started_at))}</td><td>${escapeHTML(formatDateTime(row.submitted_at))}</td><td>${badgeHTML(row.status)}</td><td>${number(row.objective_score)}</td><td>${number(row.essay_score)}</td><td><strong>${number(row.final_score)}</strong></td><td><button class="button button-sm button-outline" data-grade="${escapeAttr(row.attempt_id || row.id || "")}">${icon("square-pen")} Nilai</button></td></tr>`).join("") : `<tr><td colspan="9">${emptyStateHTML("Belum ada jawaban", "Percobaan ujian akan tampil setelah mahasiswa memulai ujian.")}</td></tr>`}</tbody></table></div></div></section>`;
  dom.mainContent.querySelectorAll("[data-grade]").forEach((button) => button.addEventListener("click", () => openGrading(button.dataset.grade)));
  bindRouteButtons();
  refreshIcons();
}

async function openGrading(attemptId) {
  showLoading("Memuat jawaban…");
  try {
    const response = await api("getExamAttemptDetail", { attempt_id: attemptId });
    const data = responseData(response);
    const answers = asArray(data, ["answers", "items", "rows"]);
    openModal("Penilaian Jawaban", `<form id="gradingForm" class="form-grid">
      <input type="hidden" name="attempt_id" value="${escapeAttr(attemptId)}">
      <div class="form-group full">${answers.length ? answers.map((answer, index) => `<div class="card card-padding" style="margin-bottom:12px"><span class="badge badge-maroon">Soal ${index + 1}</span><p style="font-size:12px;line-height:1.7;font-weight:700">${escapeHTML(answer.question_text || answer.question_id || "Pertanyaan")}</p><div style="background:#f8fafc;padding:12px;border-radius:10px;font-size:11px;line-height:1.6">${escapeHTML(answer.student_answer || "Belum dijawab")}</div><label style="margin-top:12px">Nilai Manual</label><input type="number" step="any" name="score_${escapeAttr(answer.answer_id || answer.question_id)}" value="${escapeAttr(answer.manual_score || 0)}"><label style="margin-top:10px">Komentar</label><textarea name="comment_${escapeAttr(answer.answer_id || answer.question_id)}">${escapeHTML(answer.lecturer_comment || "")}</textarea></div>`).join("") : emptyStateHTML("Jawaban tidak ditemukan", "Endpoint detail percobaan belum mengembalikan jawaban.")}</div>
    </form>`, `<button class="button button-secondary" data-modal-cancel>Batal</button><button class="button button-primary" data-save-grade>${icon("save")} Simpan Nilai</button>`, "PENILAIAN");
    document.querySelector("[data-modal-cancel]")?.addEventListener("click", closeModal);
    document.querySelector("[data-save-grade]")?.addEventListener("click", async () => {
      const form = document.getElementById("gradingForm");
      const raw = Object.fromEntries(new FormData(form));
      const gradedAnswers = answers.map((answer) => {
        const key = answer.answer_id || answer.question_id;
        return { answer_id: answer.answer_id, question_id: answer.question_id, manual_score: raw[`score_${key}`] || 0, lecturer_comment: raw[`comment_${key}`] || "" };
      });
      showLoading("Menyimpan nilai…");
      try {
        await api("gradeEssay", { attempt_id: attemptId, answers: gradedAnswers });
        state.cache.delete("grading");
        closeModal();
        toast("success", "Nilai tersimpan", "Nilai esai berhasil diperbarui.");
        await renderGrading(true);
      } catch (error) { toast("error", "Gagal menyimpan", error.message); }
      finally { hideLoading(); }
    });
    refreshIcons();
  } catch (error) {
    toast("error", "Gagal memuat jawaban", error.message);
  } finally { hideLoading(); }
}

async function renderSettings(force) {
  const response = await getData("getSettings", {}, "settings", force);
  const data = responseData(response);
  const settings = Array.isArray(data) ? Object.fromEntries(data.map((item) => [item.key, item.value])) : (data.settings || data);
  dom.mainContent.innerHTML = `
    ${pageHeader("Pengaturan Aplikasi", "Konfigurasi institusi, tahun akademik, waktu, dan absensi.", `<button id="saveSettings" class="button button-primary">${icon("save")} Simpan Pengaturan</button>`)}
    <form id="settingsForm" class="grid equal-two-column">
      <section class="card"><div class="card-header"><div><h3>Identitas Aplikasi</h3><p>Informasi yang tampil pada sistem</p></div>${icon("school")}</div><div class="card-body form-grid">
        ${simpleInput("app_name", "Nama Aplikasi", settings.app_name || "SIAKAD & Absensi RPL", true)}
        ${simpleInput("institution_name", "Nama Institusi", settings.institution_name || "STAI Al-Musdariyah Kota Cimahi", true)}
        ${simpleInput("study_program", "Program Studi", settings.study_program || "Hukum Ekonomi Syariah", true)}
        ${simpleInput("academic_year", "Tahun Akademik", settings.academic_year || "2025–2026", true)}
        ${simpleInput("logo_url", "URL Logo", settings.logo_url || "", false, "url", true)}
      </div></section>
      <section class="card"><div class="card-header"><div><h3>Waktu dan Absensi</h3><p>Validasi akhir tetap dilakukan di backend</p></div>${icon("clock-3")}</div><div class="card-body form-grid">
        ${simpleInput("timezone", "Zona Waktu", settings.timezone || CONFIG.TIMEZONE, true)}
        ${simpleInput("attendance_late_tolerance", "Toleransi Terlambat (menit)", settings.attendance_late_tolerance || 15, true, "number")}
        <div class="form-group"><label>Mode Absensi</label><select name="attendance_mode"><option value="during_class" ${settings.attendance_mode === "during_class" ? "selected" : ""}>Hanya saat kuliah</option><option value="manual" ${settings.attendance_mode === "manual" ? "selected" : ""}>Dibuka manual admin</option></select></div>
        ${simpleInput("session_expiry_hours", "Masa Sesi (jam)", settings.session_expiry_hours || 8, false, "number")}
      </div></section>
    </form>`;
  document.getElementById("saveSettings")?.addEventListener("click", async () => {
    const form = document.getElementById("settingsForm");
    if (!form.reportValidity()) return;
    const settingsPayload = Object.fromEntries(new FormData(form));
    showLoading("Menyimpan pengaturan…");
    try {
      await api("updateSettings", { settings: settingsPayload, ...settingsPayload });
      state.cache.delete("settings");
      toast("success", "Pengaturan tersimpan", "Konfigurasi aplikasi berhasil diperbarui.");
    } catch (error) { toast("error", "Gagal menyimpan", error.message); }
    finally { hideLoading(); }
  });
  refreshIcons();
}

async function renderAudit(force) {
  const response = await getData("getAuditLogs", {}, "audit", force);
  const rows = asArray(responseData(response), ["logs", "auditLogs", "items", "rows"]);
  dom.mainContent.innerHTML = `
    ${pageHeader("Audit Log", "Riwayat login dan perubahan penting pada sistem.", `<button id="auditExport" class="button button-outline">${icon("download")} Export CSV</button>`)}
    <section class="card"><div class="card-header"><div><h3>Aktivitas Sistem</h3><p>${rows.length} aktivitas ditemukan</p></div><button class="button button-sm button-secondary" data-refresh-route>${icon("refresh-cw")} Muat Ulang</button></div><div class="card-body no-padding"><div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Pengguna</th><th>Role</th><th>Aksi</th><th>Modul</th><th>Record</th><th>Perubahan</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${escapeHTML(formatDateTime(row.timestamp || row.created_at))}</td><td>${escapeHTML(row.full_name || row.user_id || "-")}</td><td>${badgeHTML(row.role)}</td><td><strong>${escapeHTML(humanize(row.action))}</strong></td><td>${escapeHTML(row.module || "-")}</td><td>${escapeHTML(row.record_id || "-")}</td><td title="${escapeAttr(row.new_value || "")}">${escapeHTML(truncate(row.new_value || row.old_value || "-", 65))}</td></tr>`).join("") : `<tr><td colspan="7">${emptyStateHTML("Audit Log kosong", "Aktivitas akan tampil setelah sistem digunakan.")}</td></tr>`}</tbody></table></div></div></section>`;
  document.getElementById("auditExport")?.addEventListener("click", () => exportCSV("Audit Log", rows));
  bindRouteButtons();
  refreshIcons();
}

async function renderStudentSchedule(force) {
  const response = await getData("getStudentSchedules", { semester: state.user.semester }, `student:schedules:${state.user.semester}`, force);
  const rows = asArray(responseData(response), ["schedules", "items", "rows"]);
  const byDay = groupBy(rows, (row) => row.day || formatDay(row.start_datetime));
  dom.mainContent.innerHTML = `
    ${pageHeader("Jadwal Kuliah", `Jadwal Semester ${escapeHTML(state.user.semester || "-")} berdasarkan data Spreadsheet.`, `<button class="button button-outline" data-refresh-route>${icon("refresh-cw")} Sinkronkan</button>`)}
    <div class="grid equal-two-column">${Object.keys(byDay).length ? orderedDays(Object.keys(byDay)).map((day) => `<section class="card"><div class="card-header"><div><h3>${escapeHTML(day)}</h3><p>${byDay[day].length} jadwal</p></div>${icon("calendar")}</div><div class="card-body">${scheduleListHTML(byDay[day], true)}</div></section>`).join("") : `<section class="card" style="grid-column:1/-1">${emptyStateHTML("Jadwal belum tersedia", "Hubungi admin atau periksa data pada Spreadsheet.")}</section>`}</div>`;
  bindRouteButtons();
  refreshIcons();
}

async function renderStudentAttendance(force) {
  const response = await getData("getAttendanceStatus", {}, `student:attendance-status:${state.user.user_id || state.user.nim}`, force);
  const data = responseData(response);
  const sessions = asArray(data, ["sessions", "meetings", "schedules", "items"]);
  const normalized = sessions.length ? sessions : (data.meeting || data.schedule || data.course_name ? [data] : []);
  dom.mainContent.innerHTML = `
    ${pageHeader("Absensi Hari Ini", "Absensi hanya dapat dikirim selama waktu perkuliahan dan divalidasi ulang oleh server.", `<button class="button button-outline" data-refresh-route>${icon("refresh-cw")} Perbarui Status</button>`)}
    <div id="attendanceCards" class="grid">${normalized.length ? normalized.map(attendanceSessionHTML).join("") : `<section class="card">${emptyStateHTML("Tidak ada jadwal aktif", "Absensi akan tersedia saat waktu perkuliahan berlangsung.")}</section>`}</div>
    <section class="card card-padding" style="margin-top:18px"><div style="display:flex;gap:13px;align-items:flex-start"><div class="stat-icon" style="--stat-bg:#dbeafe;--stat-color:#1d4ed8">${icon("shield-check")}</div><div><h3 style="margin:0 0 6px;font-size:13px">Validasi Waktu Server</h3><p style="margin:0;color:var(--text-soft);font-size:10px;line-height:1.65">Jam pada perangkat hanya digunakan untuk tampilan. Google Apps Script tetap memeriksa jadwal, identitas sesi, dan duplikasi absensi sebelum data disimpan.</p></div></div></section>`;
  dom.mainContent.querySelectorAll("[data-submit-attendance]").forEach((button) => button.addEventListener("click", () => submitStudentAttendance(button.dataset.submitAttendance, button.dataset.scheduleId)));
  bindRouteButtons();
  refreshIcons();
  startAttendanceCountdowns();
}

function attendanceSessionHTML(item, index) {
  const canAttend = truthy(item.canAttend ?? item.can_attend ?? item.isOpen ?? item.is_open);
  const already = truthy(item.alreadyAttended ?? item.already_attended ?? item.has_attended) || Boolean(item.attendance_id);
  const status = item.attendance_status || item.status || (canAttend ? "open" : "scheduled");
  const end = item.end_datetime || combineDateTime(item.meeting_date || new Date(serverNow()), item.end_time);
  const start = item.start_datetime || combineDateTime(item.meeting_date || new Date(serverNow()), item.start_time);
  let label = "Absensi belum dibuka";
  if (already) label = `Sudah absen: ${item.student_status || item.attendance_value || item.recorded_status || "Hadir"}`;
  else if (canAttend) label = "Absensi sedang dibuka";
  else if (new Date(serverNow()) > new Date(end)) label = "Waktu absensi telah berakhir";
  return `<section class="card attendance-card">
    <div><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">${badgeHTML(status)}<span class="badge badge-neutral">Semester ${escapeHTML(item.semester || state.user.semester || "-")}</span></div><h3>${escapeHTML(item.course_name || item.course || `Perkuliahan ${index + 1}`)}</h3><p>${escapeHTML(item.topic || item.lecturer_name || "Jadwal perkuliahan RPL")}</p><div class="attendance-meta"><span class="meta-chip">${icon("calendar")} ${escapeHTML(formatDate(item.meeting_date || start))}</span><span class="meta-chip">${icon("clock-3")} ${escapeHTML(formatTime(start))}–${escapeHTML(formatTime(end))}</span><span class="meta-chip">${icon("video")} ${escapeHTML(item.room_or_media || item.learning_media || "-")}</span></div></div>
    <div class="attendance-action"><div class="countdown-label">${escapeHTML(label)}</div><div class="countdown" data-countdown-end="${escapeAttr(end || "")}" data-countdown-start="${escapeAttr(start || "")}">--:--:--</div><button class="button ${canAttend && !already ? "button-primary" : "button-secondary"}" style="margin-top:12px" data-submit-attendance="${escapeAttr(item.meeting_id || item.id || "")}" data-schedule-id="${escapeAttr(item.schedule_id || "")}" ${!canAttend || already ? "disabled" : ""}>${icon(already ? "circle-check-big" : "scan-line")} ${already ? "Sudah Diisi" : "Isi Absensi"}</button></div>
  </section>`;
}

async function submitStudentAttendance(meetingId, scheduleId) {
  const accepted = await confirmAction("Kirim absensi sekarang?", "Absensi hanya dapat dikirim satu kali untuk pertemuan ini.", "Kirim Absensi");
  if (!accepted) return;
  showLoading("Mengirim absensi…");
  try {
    const response = await api("submitAttendance", { meeting_id: meetingId, schedule_id: scheduleId });
    const data = responseData(response);
    toast("success", "Absensi berhasil", `Status: ${data.status || "Hadir"}. Waktu server: ${formatDateTime(data.server_datetime || response.serverTime || serverNow())}.`);
    state.cache.delete(`student:attendance-status:${state.user.user_id || state.user.nim}`);
    state.cache.delete(`student:attendance-history:${state.user.user_id || state.user.nim}`);
    await renderStudentAttendance(true);
  } catch (error) {
    toast("error", "Absensi gagal", error.message);
  } finally { hideLoading(); }
}

async function renderStudentAttendanceHistory(force) {
  const response = await getData("getStudentAttendanceHistory", {}, `student:attendance-history:${state.user.user_id || state.user.nim}`, force);
  const rows = asArray(responseData(response), ["attendance", "history", "items", "rows"]);
  const present = rows.filter((r) => ["hadir", "present"].includes(lower(r.status))).length;
  const percentage = rows.length ? Math.round((present / rows.length) * 100) : 0;
  dom.mainContent.innerHTML = `
    ${pageHeader("Riwayat Absensi", "Seluruh absensi yang tercatat pada akun Anda.", `<button id="historyExport" class="button button-outline">${icon("download")} Unduh CSV</button>`)}
    <div class="grid stats-grid">${statCard("Total Pertemuan", rows.length, "calendar-range", "#f8e9ee", "#800020", "Tercatat")}${statCard("Hadir", present, "user-check", "#dcfce7", "#15803d", "Tepat waktu")}${statCard("Terlambat", rows.filter((r) => ["terlambat", "late"].includes(lower(r.status))).length, "clock-alert", "#fef3c7", "#b45309", "Melewati toleransi")}${statCard("Persentase", `${percentage}%`, "chart-no-axes-column-increasing", "#dbeafe", "#1d4ed8", "Kehadiran")}</div>
    <section class="card"><div class="card-header"><div><h3>Catatan Kehadiran</h3><p>${rows.length} rekaman</p></div></div><div class="card-body no-padding"><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Mata Kuliah</th><th>Pertemuan</th><th>Jam Absen</th><th>Status</th><th>Catatan</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${escapeHTML(formatDate(row.attendance_date || row.server_datetime))}</td><td><div class="table-primary">${escapeHTML(row.course_name || row.course_id || "-")}</div></td><td>${escapeHTML(row.meeting_number || "-")}</td><td>${escapeHTML(row.attendance_time || formatTime(row.server_datetime))}</td><td>${badgeHTML(row.status)}</td><td>${escapeHTML(row.notes || "-")}</td></tr>`).join("") : `<tr><td colspan="6">${emptyStateHTML("Riwayat masih kosong", "Data akan muncul setelah Anda melakukan absensi.")}</td></tr>`}</tbody></table></div></div></section>`;
  document.getElementById("historyExport")?.addEventListener("click", () => exportCSV("Riwayat Absensi", rows));
  refreshIcons();
}

async function renderStudentExams(force) {
  const response = await getData("getAvailableExams", {}, `student:exams:${state.user.user_id || state.user.nim}`, force);
  const rows = asArray(responseData(response), ["exams", "items", "rows"]);
  dom.mainContent.innerHTML = `
    ${pageHeader("UTS / UAS", "Ujian hanya dapat dimulai pada jadwal yang telah ditentukan.", `<button class="button button-outline" data-refresh-route>${icon("refresh-cw")} Perbarui</button>`)}
    <div class="exam-grid">${rows.length ? rows.map(studentExamCardHTML).join("") : `<section class="card" style="grid-column:1/-1">${emptyStateHTML("Belum ada ujian tersedia", "Ujian akan tampil sesuai semester dan jadwal yang ditetapkan admin.")}</section>`}</div>`;
  dom.mainContent.querySelectorAll("[data-start-exam]").forEach((button) => button.addEventListener("click", () => startExam(button.dataset.startExam)));
  bindRouteButtons();
  refreshIcons();
}

function studentExamCardHTML(exam) {
  const canStart = truthy(exam.canStart ?? exam.can_start ?? exam.available ?? (lower(exam.status) === "active"));
  const completed = truthy(exam.completed || exam.submitted) || lower(exam.attempt_status) === "submitted";
  const remaining = number(exam.remaining_attempts ?? exam.remainingAttempts ?? exam.max_attempts ?? 1);
  return `<article class="card exam-card"><div class="exam-type">${escapeHTML(exam.exam_type || "UJIAN")}</div><h3>${escapeHTML(exam.exam_title || exam.title || "Ujian")}</h3><p>${escapeHTML(exam.course_name || exam.course_id || "Mata Kuliah")} · Semester ${escapeHTML(exam.semester || state.user.semester || "-")}</p><div class="list" style="gap:7px;margin-bottom:14px"><div class="meta-chip">${icon("calendar")} ${escapeHTML(formatDateTime(exam.start_datetime))}</div><div class="meta-chip">${icon("timer")} ${number(exam.duration_minutes)} menit · Sisa ${remaining} percobaan</div></div><div class="exam-card-footer">${badgeHTML(completed ? "submitted" : (canStart ? "active" : exam.status || "scheduled"))}<button class="button button-sm ${canStart && !completed && remaining > 0 ? "button-primary" : "button-secondary"}" data-start-exam="${escapeAttr(exam.exam_id || exam.id || "")}" ${!canStart || completed || remaining <= 0 ? "disabled" : ""}>${icon(completed ? "circle-check-big" : "play")} ${completed ? "Selesai" : "Mulai"}</button></div></article>`;
}

async function startExam(examId) {
  const accepted = await confirmAction("Mulai ujian sekarang?", "Timer akan berjalan setelah server membuat percobaan ujian.", "Mulai Ujian");
  if (!accepted) return;
  showLoading("Menyiapkan ujian…");
  try {
    let response = await api("startExam", { exam_id: examId });
    let data = responseData(response);
    if (!asArray(data, ["questions", "items"]).length) {
      response = await api("getExamDetail", { exam_id: examId, attempt_id: data.attempt_id || data.attemptId });
      data = { ...data, ...responseData(response) };
    }
    const questions = asArray(data, ["questions", "items"]);
    if (!questions.length) throw new Error("Soal ujian belum tersedia.");
    state.exam = {
      examId,
      attemptId: data.attempt_id || data.attemptId || data.attempt?.attempt_id,
      title: data.exam_title || data.title || data.exam?.exam_title || "Ujian",
      questions,
      answers: loadExamDraft(data.attempt_id || data.attemptId || examId),
      current: 0,
      endAt: resolveExamEnd(data),
      submitted: false,
    };
    renderExamWorkspace();
  } catch (error) {
    toast("error", "Ujian tidak dapat dimulai", error.message);
  } finally { hideLoading(); }
}

function resolveExamEnd(data) {
  if (data.attempt_end_at || data.end_at) return new Date(data.attempt_end_at || data.end_at).getTime();
  const duration = number(data.duration_minutes || data.exam?.duration_minutes || 60);
  return serverNow() + duration * 60000;
}

function renderExamWorkspace() {
  const exam = state.exam;
  if (!exam) return;
  let workspace = document.getElementById("examWorkspace");
  if (!workspace) {
    workspace = document.createElement("section");
    workspace.id = "examWorkspace";
    workspace.className = "exam-workspace";
    document.body.appendChild(workspace);
  }
  workspace.innerHTML = `
    <header class="exam-topbar"><div><p class="page-eyebrow">UJIAN BERLANGSUNG</p><h2>${escapeHTML(exam.title)}</h2></div><div style="display:flex;align-items:center;gap:10px"><span id="examSaveStatus" class="badge badge-neutral">Tersimpan lokal</span><span id="examTimer" class="exam-timer">--:--:--</span><button id="finishExam" class="button button-danger">${icon("send")} Akhiri Ujian</button></div></header>
    <div class="exam-layout"><main id="questionArea"></main><aside class="card card-padding exam-sidebar"><h3 style="margin:0 0 12px;font-size:13px">Navigasi Soal</h3><div id="questionPalette" class="question-palette"></div><div style="border-top:1px solid var(--border);margin-top:16px;padding-top:15px"><p style="font-size:9px;color:var(--text-soft);line-height:1.6;margin:0">Jawaban disimpan otomatis. Pengiriman akhir tetap divalidasi oleh waktu server.</p></div></aside></div>`;
  renderQuestion();
  document.getElementById("finishExam").addEventListener("click", finishExam);
  startExamTimers();
  refreshIcons();
}

function renderQuestion() {
  const exam = state.exam;
  if (!exam) return;
  const question = exam.questions[exam.current];
  const questionId = question.question_id || question.id || String(exam.current + 1);
  const answer = exam.answers[questionId] || "";
  const isEssay = lower(question.question_type) === "essay" || lower(question.type) === "essay";
  const area = document.getElementById("questionArea");
  const palette = document.getElementById("questionPalette");
  if (!area || !palette) return;
  area.innerHTML = `<section class="card question-card"><div class="question-number">SOAL ${exam.current + 1} DARI ${exam.questions.length} · ${isEssay ? "ESAI" : "PILIHAN GANDA"}</div><div class="question-text">${escapeHTML(question.question_text || question.text || "")}</div>${question.image_url ? `<img src="${escapeAttr(question.image_url)}" alt="Gambar soal" style="max-width:100%;border-radius:12px;margin-bottom:18px">` : ""}${isEssay ? `<textarea id="essayAnswer" placeholder="Ketik jawaban Anda…">${escapeHTML(answer)}</textarea>` : `<div class="option-list">${["A", "B", "C", "D", "E"].filter((letter) => question[`option_${letter.toLowerCase()}`] || question.options?.[letter]).map((letter) => { const text = question[`option_${letter.toLowerCase()}`] || question.options?.[letter]; return `<label class="option-item"><input type="radio" name="answer" value="${letter}" ${String(answer) === letter ? "checked" : ""}><span class="option-letter">${letter}</span><span style="font-size:11px;line-height:1.6">${escapeHTML(text)}</span></label>`; }).join("")}</div>`}<div style="display:flex;justify-content:space-between;gap:10px;margin-top:22px"><button id="prevQuestion" class="button button-secondary" ${exam.current === 0 ? "disabled" : ""}>${icon("arrow-left")} Sebelumnya</button><button id="nextQuestion" class="button button-primary">${exam.current === exam.questions.length - 1 ? "Periksa Jawaban" : "Selanjutnya"} ${icon("arrow-right")}</button></div></section>`;
  palette.innerHTML = exam.questions.map((q, index) => { const id = q.question_id || q.id || String(index + 1); return `<button class="question-dot ${exam.answers[id] ? "answered" : ""} ${index === exam.current ? "active" : ""}" data-question-index="${index}">${index + 1}</button>`; }).join("");

  document.querySelectorAll("input[name=answer]").forEach((input) => input.addEventListener("change", () => saveExamAnswer(questionId, input.value)));
  document.getElementById("essayAnswer")?.addEventListener("input", debounce((event) => saveExamAnswer(questionId, event.target.value), 350));
  document.getElementById("prevQuestion")?.addEventListener("click", () => { exam.current -= 1; renderQuestion(); });
  document.getElementById("nextQuestion")?.addEventListener("click", () => { if (exam.current < exam.questions.length - 1) exam.current += 1; renderQuestion(); });
  palette.querySelectorAll("[data-question-index]").forEach((button) => button.addEventListener("click", () => { exam.current = number(button.dataset.questionIndex); renderQuestion(); }));
  refreshIcons();
}

function saveExamAnswer(questionId, value) {
  if (!state.exam) return;
  state.exam.answers[questionId] = value;
  localStorage.setItem(CONFIG.EXAM_DRAFT_KEY + (state.exam.attemptId || state.exam.examId), JSON.stringify(state.exam.answers));
  const status = document.getElementById("examSaveStatus");
  if (status) { status.className = "badge badge-warning"; status.textContent = "Menyimpan…"; }
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(async () => {
    try {
      await api("saveAnswer", { attempt_id: state.exam.attemptId, exam_id: state.exam.examId, question_id: questionId, student_answer: value }, { silent: true });
      if (status) { status.className = "badge badge-success"; status.textContent = "Tersimpan"; }
    } catch (_) {
      if (status) { status.className = "badge badge-warning"; status.textContent = "Tersimpan lokal"; }
    }
    renderQuestionPaletteOnly();
  }, 700);
}

function renderQuestionPaletteOnly() {
  const palette = document.getElementById("questionPalette");
  if (!palette || !state.exam) return;
  palette.innerHTML = state.exam.questions.map((q, index) => { const id = q.question_id || q.id || String(index + 1); return `<button class="question-dot ${state.exam.answers[id] ? "answered" : ""} ${index === state.exam.current ? "active" : ""}" data-question-index="${index}">${index + 1}</button>`; }).join("");
  palette.querySelectorAll("[data-question-index]").forEach((button) => button.addEventListener("click", () => { state.exam.current = number(button.dataset.questionIndex); renderQuestion(); }));
}

function startExamTimers() {
  clearInterval(state.examTimer);
  const tick = () => {
    if (!state.exam) return;
    const remaining = state.exam.endAt - serverNow();
    const timer = document.getElementById("examTimer");
    if (timer) timer.textContent = formatDuration(Math.max(0, remaining));
    if (remaining <= 0 && !state.exam.submitted) finishExam(true);
  };
  tick();
  state.examTimer = setInterval(tick, 1000);
}

async function finishExam(automatic = false) {
  if (!state.exam || state.exam.submitted) return;
  if (!automatic) {
    const answered = Object.values(state.exam.answers).filter((value) => String(value).trim()).length;
    const accepted = await confirmAction("Akhiri dan kirim ujian?", `${answered} dari ${state.exam.questions.length} soal telah dijawab. Jawaban tidak dapat diubah setelah dikirim.`, "Kirim Ujian");
    if (!accepted) return;
  }
  state.exam.submitted = true;
  showLoading(automatic ? "Waktu habis. Mengirim jawaban…" : "Mengirim jawaban…");
  try {
    await api("submitExam", { attempt_id: state.exam.attemptId, exam_id: state.exam.examId, answers: Object.entries(state.exam.answers).map(([question_id, student_answer]) => ({ question_id, student_answer })) });
    localStorage.removeItem(CONFIG.EXAM_DRAFT_KEY + (state.exam.attemptId || state.exam.examId));
    closeExamWorkspace();
    state.cache.delete(`student:exams:${state.user.user_id || state.user.nim}`);
    state.cache.delete(`student:results:${state.user.user_id || state.user.nim}`);
    toast("success", "Ujian berhasil dikirim", automatic ? "Jawaban dikirim otomatis karena waktu habis." : "Jawaban Anda telah disimpan.");
    await renderStudentExams(true);
  } catch (error) {
    state.exam.submitted = false;
    toast("error", "Gagal mengirim ujian", error.message);
  } finally { hideLoading(); }
}

function closeExamWorkspace() {
  clearInterval(state.examTimer);
  clearTimeout(state.autosaveTimer);
  document.getElementById("examWorkspace")?.remove();
  state.exam = null;
}

async function renderStudentResults(force) {
  let response;
  try {
    response = await getData("getStudentResults", {}, `student:results:${state.user.user_id || state.user.nim}`, force);
  } catch (_) {
    response = await getData("getExamAttempts", { user_id: state.user.user_id }, `student:results:${state.user.user_id || state.user.nim}`, force);
  }
  const rows = asArray(responseData(response), ["results", "grades", "attempts", "items", "rows"]);
  dom.mainContent.innerHTML = `
    ${pageHeader("Hasil Ujian", "Nilai hanya ditampilkan setelah dipublikasikan oleh admin.", `<button class="button button-outline" data-refresh-route>${icon("refresh-cw")} Perbarui</button>`)}
    <div class="exam-grid">${rows.length ? rows.map((row) => `<article class="card exam-card"><div class="exam-type">${escapeHTML(row.exam_type || "UJIAN")}</div><h3>${escapeHTML(row.exam_title || row.course_name || "Hasil Ujian")}</h3><p>${escapeHTML(row.course_name || row.course_id || "-")}</p><div style="font-size:34px;font-weight:900;color:var(--maroon-700);letter-spacing:-.04em;margin:14px 0">${truthy(row.published ?? true) ? number(row.final_score ?? row.score) : "—"}</div><div class="exam-card-footer">${badgeHTML(truthy(row.published ?? true) ? "published" : "waiting")}<span style="font-size:9px;color:var(--text-soft)">${escapeHTML(formatDate(row.submitted_at || row.updated_at))}</span></div></article>`).join("") : `<section class="card" style="grid-column:1/-1">${emptyStateHTML("Nilai belum tersedia", "Nilai akan tampil setelah ujian selesai dan dipublikasikan.")}</section>`}</div>`;
  bindRouteButtons();
  refreshIcons();
}

async function renderStudentAnnouncements(force) {
  const response = await getData("getAnnouncements", { target_role: "student", semester: state.user.semester }, `student:announcements:${state.user.semester}`, force);
  const rows = asArray(responseData(response), ["announcements", "items", "rows"]);
  dom.notificationDot.classList.toggle("hidden", rows.length === 0);
  dom.mainContent.innerHTML = `
    ${pageHeader("Pengumuman", "Informasi terbaru dari Program Studi dan pengelola akademik.", `<button class="button button-outline" data-refresh-route>${icon("refresh-cw")} Perbarui</button>`)}
    <div class="grid">${rows.length ? rows.map((row) => `<article class="card card-padding"><div style="display:flex;justify-content:space-between;gap:15px;align-items:flex-start"><div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px">${badgeHTML(row.target_semester === "all" ? "Semua Semester" : `Semester ${row.target_semester || state.user.semester}`)}${badgeHTML(row.status || "active")}</div><h3 style="margin:0 0 10px;font-size:16px">${escapeHTML(row.title || "Pengumuman")}</h3><p style="margin:0;color:var(--text-soft);font-size:11px;line-height:1.75;white-space:pre-line">${escapeHTML(row.content || "")}</p></div><span class="schedule-time">${escapeHTML(formatDate(row.start_date || row.created_at))}</span></div></article>`).join("") : `<section class="card">${emptyStateHTML("Belum ada pengumuman", "Informasi terbaru akan ditampilkan di halaman ini.")}</section>`}</div>`;
  bindRouteButtons();
  refreshIcons();
}

function renderProfile() {
  const user = state.user || {};
  dom.mainContent.innerHTML = `
    ${pageHeader("Profil Saya", "Data identitas akun yang sedang digunakan.", `<button class="button button-primary" data-route="change-password">${icon("key-round")} Ganti Password</button>`)}
    <div class="grid two-column"><section class="card"><div class="profile-hero"><div class="profile-avatar">${escapeHTML(initials(displayName(user)))}</div><div><h2>${escapeHTML(displayName(user))}</h2><p>${escapeHTML(isAdmin() ? "Administrator" : `Mahasiswa Semester ${user.semester || "-"}`)}</p><div style="margin-top:10px">${badgeHTML(user.status || "active")}</div></div></div><div class="detail-list">${detailItem("NIM", user.nim || "-")}${detailItem("Username", user.username || "-")}${detailItem("Email", user.email || "-")}${detailItem("No. HP", user.phone || "-")}${detailItem("Semester", user.semester || "-")}${detailItem("Role", humanize(user.role || "student"))}</div></section><section class="card"><div class="card-header"><div><h3>Keamanan Akun</h3><p>Jaga kerahasiaan akun Anda</p></div>${icon("shield-check")}</div><div class="card-body"><div class="list"><div class="list-item"><div class="list-item-main"><p class="list-item-title">Password</p><div class="list-item-meta">Gunakan kombinasi huruf, angka, dan simbol</div></div><button class="button button-sm button-outline" data-route="change-password">Ubah</button></div><div class="list-item"><div class="list-item-main"><p class="list-item-title">Sesi Login</p><div class="list-item-meta">Token sesi disimpan pada perangkat ini</div></div>${badgeHTML("active")}</div></div></div></section></div>`;
  bindRouteButtons();
  refreshIcons();
}

function renderChangePassword() {
  dom.mainContent.innerHTML = `
    ${pageHeader("Ganti Password", "Password akan diproses oleh Google Apps Script dan tidak disimpan di frontend.", "")}
    <section class="card" style="max-width:650px"><div class="card-header"><div><h3>Perbarui Password</h3><p>Masukkan password lama dan password baru</p></div>${icon("key-round")}</div><div class="card-body"><form id="changePasswordForm" class="form-grid"><div class="form-group full"><label>Password Lama *</label><input name="current_password" type="password" required autocomplete="current-password"></div><div class="form-group"><label>Password Baru *</label><input id="newPassword" name="new_password" type="password" minlength="8" required autocomplete="new-password"><small>Minimal 8 karakter.</small></div><div class="form-group"><label>Ulangi Password Baru *</label><input id="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></div><div class="form-group full"><button class="button button-primary" type="submit">${icon("save")} Simpan Password Baru</button></div></form></div></section>`;
  document.getElementById("changePasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (document.getElementById("newPassword").value !== document.getElementById("confirmPassword").value) {
      toast("warning", "Password tidak sama", "Konfirmasi password baru harus sama.");
      return;
    }
    const payload = Object.fromEntries(new FormData(form));
    showLoading("Mengubah password…");
    try {
      await api("changePassword", payload);
      form.reset();
      toast("success", "Password diperbarui", "Gunakan password baru pada login berikutnya.");
    } catch (error) { toast("error", "Gagal mengubah password", error.message); }
    finally { hideLoading(); }
  });
  refreshIcons();
}

function renderNotFound() {
  dom.mainContent.innerHTML = `<section class="card">${emptyStateHTML("Halaman tidak ditemukan", "Menu yang dipilih tidak tersedia untuk akun Anda.")}</section>`;
  refreshIcons();
}

function renderErrorState(error) {
  dom.mainContent.innerHTML = `<section class="card"><div class="empty-state"><div class="empty-icon">${icon("circle-alert")}</div><h3>Data tidak dapat dimuat</h3><p>${escapeHTML(error.message || "Terjadi kesalahan saat menghubungi server.")}</p><button class="button button-primary" data-refresh-route style="margin-top:16px">${icon("refresh-cw")} Coba Lagi</button></div></section>`;
  bindRouteButtons();
  refreshIcons();
}

function bindRouteButtons() {
  dom.mainContent.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.route)));
  dom.mainContent.querySelectorAll("[data-refresh-route]").forEach((button) => button.addEventListener("click", () => navigate(state.route, true)));
}

async function getData(action, payload = {}, cacheKey = action, force = false) {
  if (!force && state.cache.has(cacheKey)) return state.cache.get(cacheKey);
  const response = await api(action, payload);
  state.cache.set(cacheKey, response);
  return response;
}

async function api(action, payload = {}, options = {}) {
  const method = options.method || "POST";
  const timeout = options.timeout || CONFIG.REQUEST_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const token = options.public ? "" : state.token;
  const requestPayload = { action, ...(payload || {}) };
  if (token) requestPayload.token = token;

  let url = `${CONFIG.API_URL}?action=${encodeURIComponent(action)}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  const fetchOptions = { method, mode: "cors", cache: "no-store", redirect: "follow", signal: controller.signal };
  if (method === "GET") {
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && typeof value !== "object") url += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    });
  } else {
    fetchOptions.headers = { "Content-Type": "text/plain;charset=utf-8" };
    fetchOptions.body = JSON.stringify(requestPayload);
  }

  try {
    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : {}; }
    catch (_) { throw new Error("Respons Apps Script bukan JSON. Periksa deployment Web App dan fungsi doGet/doPost."); }
    updateServerClockFromResponse(result);
    if (!response.ok) {
      const error = new Error(result.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = result.errorCode || result.code;
      throw error;
    }
    if (result.success === false || result.ok === false) {
      const error = new Error(result.message || result.error || "Permintaan gagal diproses.");
      error.code = result.errorCode || result.code;
      if (["SESSION_EXPIRED", "UNAUTHORIZED", "INVALID_SESSION"].includes(error.code)) error.status = 401;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Koneksi ke Apps Script terlalu lama. Coba kembali.");
    if (error instanceof TypeError && /fetch/i.test(error.message)) throw new Error("Tidak dapat terhubung ke Apps Script. Jalankan index.html melalui Live Server (bukan langsung dari file:///), lalu pastikan deployment dapat diakses oleh siapa saja.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function updateServerClockFromResponse(response) {
  const value = response?.serverTime || response?.server_time || response?.data?.serverTime || response?.data?.server_time;
  if (!value) return;
  const serverDate = new Date(value);
  if (Number.isNaN(serverDate.getTime())) return;
  state.serverOffsetMs = serverDate.getTime() - Date.now();
}

function startServerClock() {
  const tick = () => {
    const now = new Date(serverNow());
    dom.serverTime.textContent = now.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: CONFIG.TIMEZONE });
    dom.serverDate.textContent = now.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: CONFIG.TIMEZONE });
  };
  tick();
  setInterval(tick, 1000);
}

function serverNow() { return Date.now() + state.serverOffsetMs; }

function startAttendanceCountdowns() {
  const tick = () => {
    document.querySelectorAll("[data-countdown-end]").forEach((element) => {
      const end = new Date(element.dataset.countdownEnd).getTime();
      const start = new Date(element.dataset.countdownStart).getTime();
      const now = serverNow();
      if (!Number.isFinite(end) || !Number.isFinite(start)) { element.textContent = "--:--:--"; return; }
      if (now < start) element.textContent = `Buka ${formatDuration(start - now)}`;
      else if (now <= end) element.textContent = formatDuration(end - now);
      else element.textContent = "Ditutup";
    });
  };
  tick();
  setTimeout(function loop() { if (state.route === "my-attendance") { tick(); setTimeout(loop, 1000); } }, 1000);
}

function pageHeader(title, description, actions = "") {
  return `<div class="page-header"><div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
}

function statCard(label, value, iconName, bg, color, note) {
  return `<article class="card stat-card" style="--stat-bg:${bg};--stat-color:${color}"><div><div class="stat-label">${escapeHTML(label)}</div><div class="stat-value">${escapeHTML(value)}</div><div class="stat-note">${escapeHTML(note)}</div></div><div class="stat-icon">${icon(iconName)}</div></article>`;
}

function scheduleListHTML(items, student = false) {
  if (!items.length) return emptyStateHTML("Tidak ada jadwal", "Belum ada perkuliahan yang terjadwal.");
  return `<div class="list">${items.map((item) => `<div class="list-item"><div class="list-item-main"><p class="list-item-title">${escapeHTML(item.course_name || item.course || item.course_id || "Mata Kuliah")}</p><div class="list-item-meta"><span>${escapeHTML(item.lecturer_name || "Dosen belum ditentukan")}</span><span>Semester ${escapeHTML(item.semester || state.user?.semester || "-")}</span><span>${escapeHTML(item.room_or_media || item.learning_media || "-")}</span></div></div><div class="schedule-time">${escapeHTML(item.day || formatDay(item.start_datetime))} · ${escapeHTML(item.start_time || formatTime(item.start_datetime))}${item.end_time || item.end_datetime ? `–${escapeHTML(item.end_time || formatTime(item.end_datetime))}` : ""}</div></div>`).join("")}</div>`;
}

function activityListHTML(items) {
  if (!items.length) return emptyStateHTML("Belum ada aktivitas", "Aktivitas sistem akan tampil di sini.");
  return `<div class="list">${items.slice(0, 8).map((item) => `<div class="list-item"><div class="list-item-main"><p class="list-item-title">${escapeHTML(humanize(item.action || item.title || "Aktivitas"))}</p><div class="list-item-meta"><span>${escapeHTML(item.full_name || item.user_id || "Sistem")}</span><span>${escapeHTML(item.module || "-")}</span></div></div><span class="schedule-time">${escapeHTML(formatDateTime(item.timestamp || item.created_at))}</span></div>`).join("")}</div>`;
}

function progressHTML(label, value, total) {
  const numericValue = number(value);
  const numericTotal = number(total);
  const percentage = numericTotal > 0 ? Math.min(100, Math.round((numericValue / numericTotal) * 100)) : 0;
  return `<div class="progress-row"><div class="progress-label"><span>${escapeHTML(label)}</span><strong>${numericValue} (${percentage}%)</strong></div><div class="progress-track"><div class="progress-bar" style="width:${percentage}%"></div></div></div>`;
}

function examMiniListHTML(items) {
  if (!items.length) return emptyStateHTML("Tidak ada ujian", "Belum ada UTS/UAS yang akan datang.");
  return `<div class="list">${items.slice(0, 4).map((item) => `<div class="list-item"><div class="list-item-main"><p class="list-item-title">${escapeHTML(item.exam_title || item.title || "Ujian")}</p><div class="list-item-meta"><span>${escapeHTML(item.course_name || "-")}</span><span>${number(item.duration_minutes)} menit</span></div></div>${badgeHTML(item.exam_type || item.status || "Ujian")}</div>`).join("")}</div>`;
}

function announcementMiniListHTML(items) {
  if (!items.length) return emptyStateHTML("Belum ada pengumuman", "Informasi baru akan tampil di sini.");
  return `<div class="list">${items.slice(0, 4).map((item) => `<div class="list-item"><div class="list-item-main"><p class="list-item-title">${escapeHTML(item.title || "Pengumuman")}</p><div class="list-item-meta"><span>${escapeHTML(truncate(item.content || "", 80))}</span></div></div><span class="schedule-time">${escapeHTML(formatDate(item.start_date || item.created_at))}</span></div>`).join("")}</div>`;
}

function emptyStateHTML(title, description) {
  return `<div class="empty-state"><div class="empty-icon">${icon("inbox")}</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p></div>`;
}

function paginationHTML(total, page, totalPages) {
  if (total <= CONFIG.PAGE_SIZE) return `<div class="pagination"><span>Menampilkan ${total} data</span></div>`;
  return `<div class="pagination"><span>Halaman ${page} dari ${totalPages} · ${total} data</span><div class="pagination-buttons"><button class="button button-sm button-secondary" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Sebelumnya</button><button class="button button-sm button-secondary" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Berikutnya</button></div></div>`;
}

function bindPagination(config) {
  dom.mainContent.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => {
    state.currentPage = number(button.dataset.page);
    renderEntityTable(config);
  }));
}

function badgeHTML(value) {
  const text = value === undefined || value === null || value === "" ? "-" : String(value);
  const normalized = lower(text);
  let type = "neutral";
  if (["active", "aktif", "hadir", "present", "open", "published", "submitted", "selesai", "success"].some((key) => normalized.includes(key))) type = "success";
  else if (["terlambat", "late", "waiting", "scheduled", "draft", "pending", "izin", "sakit", "warning"].some((key) => normalized.includes(key))) type = "warning";
  else if (["inactive", "nonaktif", "closed", "alfa", "absent", "failed", "gagal", "danger"].some((key) => normalized.includes(key))) type = "danger";
  else if (["uts", "uas", "student", "mahasiswa", "essay", "multiple_choice"].some((key) => normalized.includes(key))) type = "info";
  else if (["admin", "6", "8", "semester"].some((key) => normalized === key || normalized.includes(key))) type = "maroon";
  return `<span class="badge badge-${type}">${escapeHTML(humanize(text))}</span>`;
}

function simpleInput(name, label, value, required = false, type = "text", full = false) {
  return `<div class="form-group ${full ? "full" : ""}"><label>${escapeHTML(label)}${required ? " *" : ""}</label><input name="${escapeAttr(name)}" type="${type}" value="${escapeAttr(value)}" ${required ? "required" : ""}></div>`;
}

function detailItem(label, value) {
  return `<div class="detail-item"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`;
}

function skeletonPage() {
  return `<div class="page-header"><div><div class="skeleton" style="width:220px;height:30px"></div><div class="skeleton" style="width:360px;max-width:70vw;height:12px;margin-top:10px"></div></div></div><div class="grid stats-grid">${Array.from({ length: 4 }, () => `<div class="card card-padding"><div class="skeleton" style="width:90px;height:10px"></div><div class="skeleton" style="width:75px;height:31px;margin-top:14px"></div></div>`).join("")}</div><div class="card card-padding"><div class="skeleton" style="width:160px;height:17px"></div><div class="skeleton" style="height:220px;margin-top:20px"></div></div>`;
}

function openModal(title, body, footer = "", eyebrow = "FORMULIR") {
  dom.modalTitle.textContent = title;
  dom.modalEyebrow.textContent = eyebrow;
  dom.modalBody.innerHTML = body;
  dom.modalFooter.innerHTML = footer;
  dom.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  refreshIcons();
}
function closeModal() {
  dom.modal.classList.add("hidden");
  dom.modalBody.innerHTML = "";
  dom.modalFooter.innerHTML = "";
  if (!document.getElementById("examWorkspace")) document.body.style.overflow = "";
}

function confirmAction(title, message, confirmLabel = "Ya, Lanjutkan") {
  dom.confirmTitle.textContent = title;
  dom.confirmMessage.textContent = message;
  dom.confirmOkay.textContent = confirmLabel;
  dom.confirmDialog.classList.remove("hidden");
  return new Promise((resolve) => { state.confirmResolver = resolve; });
}
function resolveConfirm(value) {
  dom.confirmDialog.classList.add("hidden");
  if (state.confirmResolver) state.confirmResolver(value);
  state.confirmResolver = null;
}

function showLoading(text = "Memuat data…") {
  dom.loadingText.textContent = text;
  dom.loadingOverlay.classList.remove("hidden");
}
function hideLoading() { dom.loadingOverlay.classList.add("hidden"); }

function toast(type, title, message, duration = 4500) {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  const iconName = type === "success" ? "circle-check-big" : type === "error" ? "circle-x" : type === "warning" ? "triangle-alert" : "info";
  item.innerHTML = `<div class="toast-icon">${icon(iconName)}</div><div class="toast-content"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message || "")}</p></div><button class="toast-close" aria-label="Tutup">${icon("x")}</button>`;
  item.querySelector(".toast-close").addEventListener("click", () => item.remove());
  dom.toastContainer.appendChild(item);
  refreshIcons();
  setTimeout(() => item.remove(), duration);
}

function openSidebar() { dom.sidebar.classList.add("open"); dom.sidebarBackdrop.classList.add("show"); }
function closeSidebar() { dom.sidebar.classList.remove("open"); dom.sidebarBackdrop.classList.remove("show"); }

function setButtonLoading(button, loading, label) {
  button.disabled = loading;
  button.innerHTML = loading ? `<span class="loader" style="width:17px;height:17px;border-width:2px"></span><span>${escapeHTML(label)}</span>` : `${icon("log-in")}<span>${escapeHTML(label)}</span>`;
  refreshIcons();
}

function exportCSV(filename, rows, columns = null) {
  if (!rows.length) { toast("warning", "Tidak ada data", "Tidak ada data yang dapat diekspor."); return; }
  const headers = columns ? columns.map((column) => column.key) : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const labels = columns ? columns.map((column) => column.label) : headers;
  const escapeCSV = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [labels.map(escapeCSV).join(","), ...rows.map((row) => headers.map((key) => escapeCSV(row[key])).join(","))].join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(filename)}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formToObject(form, fields) {
  const formData = new FormData(form);
  const result = Object.fromEntries(formData.entries());
  fields.filter((item) => item.type === "checkbox").forEach((item) => { result[item.name] = form.elements[item.name]?.checked || false; });
  return result;
}

function responseData(response) {
  if (response && Object.prototype.hasOwnProperty.call(response, "data")) return response.data ?? {};
  return response ?? {};
}

function asArray(data, keys = []) {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getValue(object, key, fallback = "") {
  if (!object) return "";
  if (object[key] !== undefined && object[key] !== null && object[key] !== "") return object[key];
  if (fallback && object[fallback] !== undefined) return object[fallback];
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (object[camel] !== undefined) return object[camel];
  return "";
}

function safeJSON(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
function isAdmin() { return lower(state.user?.role) === "admin"; }
function displayName(user) { return user?.full_name || user?.fullName || user?.name || user?.username || "Pengguna"; }
function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || "Mahasiswa"; }
function initials(name) { return String(name || "U").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function lower(value) { return String(value ?? "").toLowerCase().trim(); }
function truthy(value) { return value === true || value === 1 || ["true", "1", "yes", "ya", "active", "open"].includes(lower(value)); }
function truncate(value, length) { const text = String(value ?? ""); return text.length > length ? `${text.slice(0, length - 1)}…` : text; }
function humanize(value) { return String(value ?? "-").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function icon(name) { return `<i data-lucide="${escapeAttr(name)}"></i>`; }
function refreshIcons() { if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { "stroke-width": 2 } }); }
function escapeHTML(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function escapeAttr(value) { return escapeHTML(value); }
function debounce(fn, delay = 250) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }

function formatDate(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: CONFIG.TIMEZONE });
}
function formatDateTime(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CONFIG.TIMEZONE });
}
function formatTime(value) {
  if (!value) return "-";
  if (/^\d{1,2}:\d{2}/.test(String(value))) return String(value).slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CONFIG.TIMEZONE });
}
function formatDay(value) {
  if (!value) return "Hari";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("id-ID", { weekday: "long", timeZone: CONFIG.TIMEZONE });
}
function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}
function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const formatter = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CONFIG.TIMEZONE });
  return formatter.format(date).replace(" ", "T");
}
function combineDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return "";
  const date = typeof dateValue === "string" ? dateValue.slice(0, 10) : new Date(dateValue).toISOString().slice(0, 10);
  return `${date}T${String(timeValue).slice(0, 5)}:00+07:00`;
}
function groupBy(items, selector) { return items.reduce((result, item) => { const key = selector(item) || "Lainnya"; (result[key] ||= []).push(item); return result; }, {}); }
function orderedDays(days) { const order = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]; return [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b)); }
function loadExamDraft(key) { return safeJSON(localStorage.getItem(CONFIG.EXAM_DRAFT_KEY + key), {}); }

