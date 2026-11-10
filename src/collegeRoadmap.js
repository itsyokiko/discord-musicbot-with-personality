/**
 * College Roadmap Module — Acuan Mutlak Akademik & Jadwal Kuliah Callista (v3.1.0).
 *
 * Mengambil data dari data/collage_roadmap.json:
 * - Identitas DKV Semester berjalan (Tahun Akademik)
 * - Jadwal kuliah mingguan riil per hari (jam mulai-selesai, matkul, dosen, ruangan)
 * - Status akademik real-time (Kuliah Aktif, Libur Jeda Semester, Masa KRS, Ujian)
 * - Pelacakan tugas/PR aktif dan batas deadline
 * - 30 template respons cepat saat sedang di dalam kelas
 * - Generator otomatis untuk semester berikutnya dengan menghormati jeda libur antar-semester
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROADMAP_FILE = path.resolve(__dirname, '../data/collage_roadmap.json');

function loadRoadmap() {
  try {
    if (fs.existsSync(ROADMAP_FILE)) {
      const raw = fs.readFileSync(ROADMAP_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[ROADMAP] Gagal membaca collage_roadmap.json:', err.message);
  }
  return null;
}

function saveRoadmap(data) {
  const tmpFile = `${ROADMAP_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, ROADMAP_FILE);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    console.error('[ROADMAP] Gagal menyimpan collage_roadmap.json:', err.message);
    return false;
  }
}

// 30 Template respons cepat saat di kelas (variatif, natural, mahasiswi DKV santai)
const CLASS_BUSY_TEMPLATES = [
  'lagi di dalem kelas nih, nanti yaa kubalas pas kelar',
  'eh bentar ya, dosennya lagi nerangin di depan wkwk, nanti kukabarin',
  'lagi kelas dulu yaa, nanti pas istirahat kubaca',
  'masih di ruang studio nih, hp ditaruh dulu yaa ntar kubalas',
  'bentar yaa lagi ada kelas, nanti pas kelar aku chat lagi',
  'ssstt lagi kuliah, ntar kuomongin lagi ya pas udah selesai',
  'lagi praktikum di lab nih, ntar yaa pas beres kubalas chatnya',
  'dosennya galak wkwk, hp kusimpen dulu ya ntar kubalas',
  'masih nyatet materi di kelas, ntar yaa kubalasnya',
  'lagi asistensi tugas nih, bentar ya nanti aku bales',
  'eh ntar ya, lagi di kelas dkv gabisa buka hp lama-lama',
  'kuliah dulu sebentar ya, nanti beres kelas langsung kubaca kok',
  'aduh lagi di lab multimedia, ntar yaa chatnya kubalas abis ini',
  'lagi fokus kelas dulu yaa, nanti kutengok lagi pas kelar',
  'bentar ya, lagi presentasi di kelas, ntar kubalas',
  'lagi di dalem kelas, ntar yaa pas bubar kukabarin',
  'dosennya lagi keliling kelas wkwk, hp ku-silent dulu ya ntar kubales',
  'masih ada kelas nih, nanti ya pas jamnya abis kubalesin',
  'lagi ngerjain tugas studio di kelas, ntar yaa abis ini kubalas',
  'bentar yaa, kelasnya baru mulai nih, ntar kubaca pas selesai',
  'lagi di ruangan kelas, gabisa fast resp dulu ya ntar kubalas',
  'eh nanti ya, lagi kuliah gabisa ngetik panjang, ntar ku-reply',
  'masih kelas teori nih, ntar yaa kubalas pas jam istirahat',
  'dosennya lagi jelasin slide, hp kupinggirin dulu yaa',
  'lagi di studio gambar, tangan kotor wkwk ntar ya pas beres',
  'ntar yaa, lagi di kelas bentar lagi selesai kok, ntar kubalas',
  'eh bentaran ya, lagi jam kuliah nih, nanti pas beres kulirik hp lagi',
  'lagi praktikum, ntar yaa kubalas chatnya pas keluar kelas',
  'sshh lagi kuliah, nanti yaa kubalas lengkapnya pas udah di luar',
  'lagi di kelas nih, nanti yaa kubaca dan kubalas pas dosennya kelar'
];

function getRandomClassTemplate(courseName) {
  const tpl = CLASS_BUSY_TEMPLATES[Math.floor(Math.random() * CLASS_BUSY_TEMPLATES.length)];
  return tpl;
}

/**
 * Konversi nama hari ke key bahasa inggris (monday..sunday)
 */
function getDayKey(dateStr) {
  const d = new Date(dateStr);
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[d.getDay()] || 'monday';
}

/**
 * Evaluasi status akademik real-time berdasarkan tanggal kalender (v3.1.0):
 * - Libur Kalender / Pengecualian
 * - Masa Libur Jeda Semester (Break Period)
 * - Masa Persiapan / Pengisian KRS
 * - Masa Ujian (UTS / UAS)
 * - Masa Kuliah Berjalan
 */
function getAcademicStatus(dateStr, roadmap = null) {
  const data = roadmap || loadRoadmap();
  if (!data) return { status: 'unknown', label: 'Data tidak tersedia', isClassDay: false };

  // 1. Cek Libur / Kalender Pengecualian
  const exceptions = data.calendar_exceptions || [];
  const exceptionToday = exceptions.find(e => e.date === dateStr);
  if (exceptionToday) {
    return {
      status: 'holiday',
      label: exceptionToday.type === 'holiday' ? 'Libur Nasional / Kampus' : 'Tidak Ada Perkuliahan',
      isClassDay: false,
      exception: exceptionToday
    };
  }

  // 2. Cek Masa Jeda Libur Semester (Break Period)
  const transition = data.semester_transition;

  // 2. Cek Masa Persiapan Semester Baru / Pemilihan KRS (dapat berlangsung di sela masa libur)
  const prep = transition?.next_semester_preparation;
  if (prep && prep.course_registration_start && prep.course_registration_end) {
    if (dateStr >= prep.course_registration_start && dateStr <= prep.course_registration_end) {
      return {
        status: 'preparing_next_semester',
        label: 'Masa Pengisian KRS Online & Bimbingan DPA',
        isClassDay: false,
        krsPeriod: prep,
      };
    }
  }

  // 3. Cek Jeda Antar Semester (Break Period / Libur)
  const breakPeriod = transition?.break_period;
  if (breakPeriod && breakPeriod.start_date && breakPeriod.end_date) {
    if (dateStr >= breakPeriod.start_date && dateStr <= breakPeriod.end_date) {
      return {
        status: 'on_break',
        label: 'Libur Jeda Antar-Semester',
        isClassDay: false,
        breakPeriod,
        transitionStatus: transition.transition_status || 'on_break',
      };
    }
  }

  // 4. Cek Fase Semester Aktif (Perkuliahan, UTS, UAS)
  const phases = data.semester_phases || [];
  const activePhase = phases.find(p => p.start <= dateStr && p.end >= dateStr);
  const isWeekend = ['sunday', 'saturday'].includes(getDayKey(dateStr));

  if (activePhase) {
    const isExam = activePhase.name.toLowerCase().includes('uas') || activePhase.name.toLowerCase().includes('uts');
    return {
      status: isExam ? 'exam_period' : 'ongoing',
      label: activePhase.name,
      phase: activePhase,
      isClassDay: !isWeekend,
    };
  }

  // 5. Default jika dalam rentang semester_start dan semester_end
  const profile = data.profile || {};
  if (profile.semester_start && profile.semester_end && dateStr >= profile.semester_start && dateStr <= profile.semester_end) {
    return {
      status: profile.semester_status || 'ongoing',
      label: 'Semester Berjalan',
      isClassDay: !isWeekend,
    };
  }

  return {
    status: profile.semester_status || 'ongoing',
    label: 'Di Luar Jadwal Perkuliahan',
    isClassDay: false,
  };
}

/**
 * Ambil jadwal kelas lengkap untuk hari tertentu beserta metadata mata kuliahnya.
 * Otomatis kosong jika sedang masa libur semester (break period) atau hari libur kalender.
 */
function getClassesForDate(dateStr, roadmap = null) {
  const data = roadmap || loadRoadmap();
  if (!data || !data.class_schedule || !data.class_schedule.weekly) return [];

  // Jika masa libur semester atau tanggal pengecualian libur -> KOSONGKAN kelas
  const academicStatus = getAcademicStatus(dateStr, data);
  if (!academicStatus.isClassDay || academicStatus.status === 'on_break' || academicStatus.status === 'holiday') {
    return [];
  }

  const dayKey = getDayKey(dateStr);
  const daySchedule = data.class_schedule.weekly[dayKey] || [];
  const coursesMap = new Map((data.courses || []).map(c => [c.id, c]));

  return daySchedule.map(slot => {
    const course = coursesMap.get(slot.course_id) || {};
    return {
      courseId: slot.course_id,
      courseName: course.name || slot.course_id,
      credits: course.credits || 3,
      lecturer: course.lecturer || 'Dosen',
      type: course.type || 'kuliah',
      location: slot.location || 'Kampus',
      start: slot.start,
      end: slot.end,
    };
  });
}

/**
 * Ambil daftar tugas/PR aktif untuk tanggal tertentu.
 * Kriteria aktif:
 * - assigned_date <= dateStr
 * - status != 'completed' ATAU due_date >= dateStr
 * Diurutkan berdasarkan batas waktu terdekat (due_date ascending) lalu prioritas.
 */
function getActiveAssignments(dateStr, roadmap = null) {
  const data = roadmap || loadRoadmap();
  if (!data || !Array.isArray(data.assignments)) return [];

  const coursesMap = new Map((data.courses || []).map(c => [c.id, c]));

  return data.assignments
    .filter(a => {
      if (a.assigned_date && a.assigned_date > dateStr) return false;
      if (a.status === 'completed') return false;
      return true;
    })
    .map(a => {
      const course = coursesMap.get(a.course_id) || {};
      return {
        id: a.id,
        courseId: a.course_id,
        courseName: course.name || a.course_id,
        title: a.title,
        assignedDate: a.assigned_date,
        dueDate: a.due_date,
        dueTime: a.due_time || '23:59',
        type: a.type,
        priority: a.priority || 'medium',
        status: a.status,
        progress: a.progress || 0,
        estimatedHours: a.estimated_hours || 0,
        description: a.description || '',
        milestones: a.milestones || []
      };
    })
    .sort((a, b) => {
      const cmpDate = (a.dueDate || '').localeCompare(b.dueDate || '');
      if (cmpDate !== 0) return cmpDate;
      const prioWeight = { high: 1, medium: 2, low: 3 };
      return (prioWeight[a.priority] || 2) - (prioWeight[b.priority] || 2);
    });
}

/**
 * Cek apakah saat ini Callista sedang dalam jam perkuliahan di kelas.
 * @param {Date} now
 * @param {string} timezone
 * @returns {{ inClass: boolean, session: object|null }}
 */
function getCurrentClassSession(now = new Date(), timezone = 'Asia/Jakarta') {
  const data = loadRoadmap();
  if (!data) return { inClass: false, session: null };

  const store = require('./dailyContextStore');
  const { dateStr, timeStr } = store.getTimeInTimezone(now, timezone);

  const classes = getClassesForDate(dateStr, data);
  if (!classes || classes.length === 0) {
    return { inClass: false, session: null };
  }

  for (const c of classes) {
    if (timeStr >= c.start && timeStr < c.end) {
      const [endH, endM] = c.end.split(':').map(Number);
      const [curH, curM] = timeStr.split(':').map(Number);
      const remainingMinutes = Math.max(0, (endH * 60 + endM) - (curH * 60 + curM));

      return {
        inClass: true,
        session: {
          sessionKey: `${dateStr}_${c.courseId}_${c.start}`,
          dateStr,
          ...c,
          remainingMinutes,
        }
      };
    }
  }

  return { inClass: false, session: null };
}

/**
 * Buat roadmap baru untuk semester berikutnya sesuai aturan v3.1.0:
 * - Mengarsipkan riwayat semester saat ini ke academic_history
 * - Mengubah semester dari N ke N+1 (misal Semester 5 -> 6)
 * - Menetapkan jadwal perkuliahan baru & mata kuliah baru
 * - Mengatur masa libur berikutnya
 */
function generateNextSemesterRoadmap(options = {}) {
  const current = loadRoadmap();
  if (!current) return null;

  const prevSemester = current.profile.semester || 5;
  const nextSemesterNum = prevSemester + 1;
  const academicYear = current.next_semester?.academic_year || current.profile.academic_year || '2026/2027';
  const newStartDate = options.startDate || current.next_semester?.expected_start || '2027-02-22';
  const newEndDate = options.endDate || current.next_semester?.expected_end || '2027-07-16';

  // Daftar mata kuliah Semester 6 DKV (Kurikulum Lanjut DKV)
  const semester6Courses = [
    {
      id: "DKV601",
      name: "Desain Kemasan (Packaging Design)",
      credits: 3,
      lecturer: "Pak Hendra",
      type: "studio",
      assessment: ["analisis pasar", "desain struktur kemasan", "mockup 3D & cetak"]
    },
    {
      id: "DKV602",
      name: "Desain Kampanye Sosial & Komersial",
      credits: 4,
      lecturer: "Bu Ratna",
      type: "studio",
      assessment: ["riset target audiens", "key visual & media plan", "presentasi kampanye"]
    },
    {
      id: "DKV603",
      name: "Animasi 3D Dasar",
      credits: 3,
      lecturer: "Pak Dimas",
      type: "practice",
      assessment: ["modelling 3D", "rigging & tekstur", "render animasi 10 detik"]
    },
    {
      id: "DKV604",
      name: "Portofolio Desain & Pameran Karya",
      credits: 3,
      lecturer: "Pak Ardi",
      type: "studio",
      assessment: ["kurasi karya", "buku portofolio & web portofolio", "display pameran"]
    },
    {
      id: "DKV605",
      name: "Manajemen & Kewirausahaan Desain",
      credits: 2,
      lecturer: "Bu Maya",
      type: "theory",
      assessment: ["proposal bisnis studio", "pricing & kontrak desain", "ujian teori"]
    },
    {
      id: "DKV606",
      name: "Persiapan Magang / Kerja Praktik DKV",
      credits: 3,
      lecturer: "Pak Budi",
      type: "practice",
      assessment: ["surat pengantar & CV", "portfolio review", "laporan kemitraan studio"]
    }
  ];

  // Jadwal mingguan Semester 6 DKV
  const semester6Schedule = {
    valid_from: newStartDate,
    valid_until: newEndDate,
    weekly: {
      monday: [
        { course_id: "DKV601", start: "08:00", end: "10:30", location: "Studio Kemasan" },
        { course_id: "DKV605", start: "13:00", end: "14:40", location: "Ruang 302" }
      ],
      tuesday: [
        { course_id: "DKV602", start: "08:00", end: "11:30", location: "Studio DKV 3" }
      ],
      wednesday: [
        { course_id: "DKV603", start: "08:00", end: "10:30", location: "Lab 3D & Animasi" },
        { course_id: "DKV606", start: "13:00", end: "15:30", location: "Ruang Seminar DKV" }
      ],
      thursday: [
        { course_id: "DKV604", start: "08:00", end: "11:00", location: "Studio Pameran DKV" }
      ],
      friday: [
        { course_id: "DKV602", start: "13:00", end: "15:30", location: "Studio DKV 3" }
      ],
      saturday: [],
      sunday: []
    }
  };

  // Arsipkan semester sebelumnya ke academic_history
  const history = current.academic_history || {};
  const archivedAssignments = (current.assignments || []).map(a => ({
    ...a,
    status: a.status === 'in_progress' ? 'completed' : a.status,
    archived_from_semester: prevSemester,
  }));

  const newRoadmap = {
    ...current,
    version: "3.1.0",
    last_updated: new Date().toISOString(),
    profile: {
      ...current.profile,
      semester: nextSemesterNum,
      academic_year: academicYear,
      semester_start: newStartDate,
      semester_end: newEndDate,
      total_credits: 18,
      semester_status: "ongoing"
    },
    semester_transition: {
      previous_semester: prevSemester,
      next_semester: nextSemesterNum + 1,
      transition_status: "completed",
      transition_start: current.semester_transition?.transition_start || "2027-02-01",
      transition_end: newStartDate,
      break_period: {
        start_date: "2027-07-17",
        end_date: "2027-08-30",
        duration_days: 44,
        status: "scheduled",
        description: `Libur jeda semester genap menuju semester ${nextSemesterNum + 1}. Masa magang atau istirahat panjang.`
      },
      next_semester_preparation: {
        academic_calendar_available: false,
        course_registration_start: "2027-08-20",
        course_registration_end: "2027-08-27",
        class_schedule_available: false,
        preparation_activities: [
          `Persiapan KRS Semester ${nextSemesterNum + 1}`,
          "Penyusunan topik skripsi / tugas akhir DKV"
        ]
      }
    },
    semester_phases: [
      {
        id: "PHASE_01",
        name: `Awal perkuliahan Semester ${nextSemesterNum}`,
        start: newStartDate,
        end: "2027-03-27",
        status: "active",
        description: `Pengenalan materi studio Semester ${nextSemesterNum}, pembentukan kelompok kemasan & kampanye.`
      },
      {
        id: "PHASE_02",
        name: "UTS & Evaluasi Proyek Kemasan",
        start: "2027-04-05",
        end: "2027-04-17",
        status: "upcoming",
        description: "Evaluasi tengah semester dan pameran progress."
      },
      {
        id: "PHASE_03",
        name: "Produksi Karya & Animasi 3D",
        start: "2027-04-19",
        end: "2027-05-29",
        status: "upcoming",
        description: "Penyelesaian render 3D dan materi kampanye visual."
      },
      {
        id: "PHASE_04",
        name: "UAS & Pameran Akhir Semester",
        start: "2027-06-21",
        end: newEndDate,
        status: "upcoming",
        description: "Penilaian akhir portofolio dan penutupan semester."
      }
    ],
    courses: semester6Courses,
    class_schedule: semester6Schedule,
    academic_history: {
      ...history,
      completed_assignments: [...(history.completed_assignments || []), ...archivedAssignments],
      notes: [
        ...(history.notes || []),
        {
          date: newStartDate,
          content: `Transisi sukses ke Semester ${nextSemesterNum} (${academicYear}). Acuan mutlak baru telah aktif.`
        }
      ]
    },
    assignments: [
      {
        id: "A601",
        course_id: "DKV601",
        title: "Perancangan Kemasan Produk Makanan Lokal",
        assigned_date: newStartDate,
        due_date: "2027-03-15",
        due_time: "23:59",
        type: "individual_project",
        priority: "high",
        status: "in_progress",
        progress: 10,
        estimated_hours: 15,
        description: "Riset bentuk kemasan ramah lingkungan untuk UMKM lokal."
      },
      {
        id: "A602",
        course_id: "DKV604",
        title: "Kurasi 10 Karya Terbaik untuk Portofolio DKV",
        assigned_date: newStartDate,
        due_date: "2027-03-20",
        due_time: "23:59",
        type: "individual",
        priority: "medium",
        status: "not_started",
        progress: 0,
        estimated_hours: 10,
        description: "Menyeleksi dan memoles karya studio semester 1 sampai 5."
      }
    ],
    semester_closure: {
      final_grades_available_date: null,
      academic_status: "ongoing",
      all_assignments_resolved: false,
      semester_completed: false,
      notes: []
    },
    next_semester: {
      semester: nextSemesterNum + 1,
      academic_year: "2027/2028",
      expected_start: "2027-09-01",
      expected_end: "2028-01-31",
      generation_status: "not_generated",
      roadmap_file: null
    }
  };

  saveRoadmap(newRoadmap);
  return newRoadmap;
}

module.exports = {
  ROADMAP_FILE,
  loadRoadmap,
  saveRoadmap,
  getDayKey,
  getAcademicStatus,
  getClassesForDate,
  getActiveAssignments,
  getCurrentClassSession,
  generateNextSemesterRoadmap,
  getRandomClassTemplate,
  CLASS_BUSY_TEMPLATES,
};
